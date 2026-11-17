import { db } from '../config/firebase.js';
import { generarSkuPublicoFrp } from './ailooBridge.js';
import {
  ARBOL_CATEGORIAS_TIENDA,
  normCat,
  resolverRutaCategoriasTienda,
} from './categoriasTaxonomia.js';
import { resolverImagenEfectivaProducto } from './catalogoImagenesService.js';
import {
  clasificarTallaLogisticaRepuesto,
  cotizarDespachoAnticipado,
} from './logisticaTarifarioService.js';


export { ARBOL_CATEGORIAS_TIENDA, resolverRutaCategoriasTienda };

function getWooConfig() {
  return {
    url: (process.env.WOOCOMMERCE_URL || '').replace(/\/+$/, ''),
    key: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
    secret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
  };
}

function isWooConfigured() {
  const { url, key, secret } = getWooConfig();
  return Boolean(url && key && secret);
}

function wcAuthHeader() {
  const { key, secret } = getWooConfig();
  const token = Buffer.from(`${key}:${secret}`).toString('base64');
  return `Basic ${token}`;
}

async function wcFetch(path, options = {}, retries = 3) {
  const { url } = getWooConfig();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${url}/wp-json/wc/v3${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: wcAuthHeader(),
          ...(options.headers || {}),
        },
      });
      const rawText = await res.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          const waitMs = attempt * 2500;
          console.warn(`[woo-sync] Respuesta no-JSON (${res.status}) en ${path}. Reintentando (${attempt}/${retries}) en ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`WooCommerce respondió HTTP ${res.status} (no-JSON) en ${path}: ${rawText.slice(0, 160)}`);
      }
      if (!res.ok) {
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          const waitMs = attempt * 2500;
          console.warn(`[woo-sync] HTTP ${res.status} en ${path}. Reintentando (${attempt}/${retries}) en ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        const msg = data?.message || `WooCommerce respondió ${res.status}`;
        throw new Error(msg);
      }
      return data;
    } catch (err) {
      if (attempt < retries && !String(err.message || '').includes('WooCommerce respondió 4')) {
        const waitMs = attempt * 2500;
        console.warn(`[woo-sync] Error de red en ${path}: ${err.message}. Reintentando (${attempt}/${retries}) en ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

let _cacheCategoriasWooMemoria = null;
let _cacheCategoriasWooTimestamp = 0;
const CACHE_CATEGORIAS_WOO_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Resuelve los productos existentes para el lote actual (`items`):
// 1. Si el ítem en Firestore ya tiene `wooProductId`, lo usa directo sin repaginar los 8.600 productos de WooCommerce.
// 2. Solo para los ítems del lote que NO tienen `wooProductId`, consulta a WooCommerce por lista de SKUs (`/products?sku=...`).
async function obtenerProductosExistentes(items = []) {
  const mapa = new Map(); // sku -> { id, tieneImagen }
  const skusSinWooId = [];

  for (const item of items) {
    const sku = skuDeItem(item.id, item);
    if (item.wooProductId && Number(item.wooProductId) > 0) {
      mapa.set(sku, {
        id: Number(item.wooProductId),
        tieneImagen: Boolean(item.imagenUrl || item.wooMediaId),
      });
    } else if (sku) {
      skusSinWooId.push(sku);
    }
  }

  const skusUnicos = [...new Set(skusSinWooId)];
  const CHUNK_SKUS = 40;
  for (let i = 0; i < skusUnicos.length; i += CHUNK_SKUS) {
    const loteSkus = skusUnicos.slice(i, i + CHUNK_SKUS);
    try {
      const productos = await wcFetch(
        `/products?sku=${encodeURIComponent(loteSkus.join(','))}&per_page=100&_fields=id,sku,images`
      );
      if (Array.isArray(productos)) {
        for (const p of productos) {
          if (p?.sku) {
            mapa.set(String(p.sku).trim().toUpperCase(), {
              id: p.id,
              tieneImagen: (p.images || []).length > 0,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[woo-sync] Aviso consultando lote de SKUs en WooCommerce:', err.message);
    }
  }

  return mapa;
}

// Trae/crea categorías jerárquicas de WooCommerce (respetando padre -> hijo -> nieto)
// únicamente dentro del árbol oficial de 9 categorías y devuelve una función `resolverIdsParaItem(item)`
// que entrega `[{ id }, ...]`.
async function prepararCategoriasWooCommerce(items = []) {
  let existentes = [];
  if (_cacheCategoriasWooMemoria && (Date.now() - _cacheCategoriasWooTimestamp < CACHE_CATEGORIAS_WOO_TTL_MS)) {
    existentes = _cacheCategoriasWooMemoria;
  } else {
    let page = 1;
    while (true) {
      const lote = await wcFetch(`/products/categories?per_page=100&page=${page}`);
      if (!Array.isArray(lote) || !lote.length) break;
      existentes.push(...lote);
      if (lote.length < 100) break;
      page++;
    }
    _cacheCategoriasWooMemoria = existentes;
    _cacheCategoriasWooTimestamp = Date.now();
  }

  // Índice por `${parentId || 0}::${normCat(name)}` y fallback por `${normCat(name)}`
  const porPadreYNombre = new Map();
  const porNombreRaiz = new Map();
  const porNombreCualquiera = new Map();

  const indexarCat = (c) => {
    const n = normCat(c.name);
    const parentId = Number(c.parent || 0);
    porPadreYNombre.set(`${parentId}::${n}`, c.id);
    if (parentId === 0) {
      porNombreRaiz.set(n, c.id);
    }
    if (!porNombreCualquiera.has(n)) {
      porNombreCualquiera.set(n, c.id);
    }
  };

  for (const c of existentes) {
    indexarCat(c);
  }

  const asegurarRuta = async (rutaNombres) => {
    let parentId = 0;
    const ids = [];
    for (const nombreOriginal of rutaNombres) {
      const n = normCat(nombreOriginal);
      if (!n) continue;
      let id =
        porPadreYNombre.get(`${parentId}::${n}`) ||
        (parentId === 0 ? porNombreRaiz.get(n) : null) ||
        porNombreCualquiera.get(n);

      if (!id) {
        try {
          const creada = await wcFetch('/products/categories', {
            method: 'POST',
            body: JSON.stringify({
              name: nombreOriginal,
              ...(parentId ? { parent: parentId } : {}),
            }),
          });
          if (creada?.id) {
            indexarCat(creada);
            id = creada.id;
          }
        } catch (err) {
          console.warn('[woo-cat] No se pudo crear categoría', nombreOriginal, ':', err.message);
        }
      }

      if (id) {
        ids.push(id);
        parentId = id;
      }
    }
    return [...new Set(ids)];
  };

  // Pre-asegurar todas las rutas de los ítems a sincronizar
  const cacheRutas = new Map();
  for (const item of items) {
    const ruta = resolverRutaCategoriasTienda(item);
    const clave = ruta.join(' > ');
    if (!cacheRutas.has(clave)) {
      const ids = await asegurarRuta(ruta);
      cacheRutas.set(clave, ids);
    }
  }

  return (item) => {
    const ruta = resolverRutaCategoriasTienda(item);
    const clave = ruta.join(' > ');
    const ids = cacheRutas.get(clave) || [];
    return ids.map((id) => ({ id }));
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// JERARQUÍA DE COMPATIBILIDAD VEHICULAR EN "MARCAS DE PRODUCTOS" (OPCIÓN A)
// Nivel 1 (Marca Principal): SUZUKI, JAC, TOYOTA, CHERY, GREAT WALL, HAVAL...
// Nivel 2 (Sub-marca Modelo): JAC S3, SUZUKI SWIFT, GREAT WALL WINGLE 5...
// Nivel 3 (Rango de Años):    JAC S3 (2016 - 2023), MG GT NEW (2021+)...
// ═══════════════════════════════════════════════════════════════════════════

const MARCAS_VEHICULOS_CONOCIDAS = [
  'GREAT WALL', 'LAND ROVER', 'MERCEDES-BENZ', 'ALFA ROMEO', 'SSANGYONG',
  'CHANGAN', 'CHANGLIN', 'DONGFENG', 'CHEVROLET', 'MITSUBISHI', 'VOLKSWAGEN',
  'PEUGEOT', 'CITROËN', 'CITROEN', 'HYUNDAI', 'RENAULT', 'TOYOTA', 'SUZUKI',
  'SUBARU', 'NISSAN', 'CHERY', 'HAVAL', 'MAZDA', 'HONDA', 'MAXUS', 'FOTON',
  'DODGE', 'VOLVO', 'LEXUS', 'ISUZU', 'MAHINDRA', 'GEELY', 'DFSK', 'FORD',
  'JEEP', 'FIAT', 'AUDI', 'OPEL', 'MINI', 'JAC', 'KIA', 'MG', 'BYD', 'DFM',
  'RAM', 'BMW', 'ZNA',
];

function normalizarNombreMarcaAuto(raw) {
  const m = String(raw || '').trim().toUpperCase();
  if (!m || m === 'OTRO' || m === 'GENERAL' || m === 'UNIVERSAL') return '';
  if (m === 'CITROEN') return 'CITROËN';
  if (m === 'VW') return 'VOLKSWAGEN';
  if (m === 'GREATWALL') return 'GREAT WALL';
  return m;
}

function normalizarNombreModeloAuto(marca, modeloRaw) {
  let mod = String(modeloRaw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!mod || mod === 'TODOS' || mod === 'GENERAL') return '';
  // Si el modelo ya empieza con el nombre de la marca, quitar el prefijo repetido
  if (marca && mod.startsWith(`${marca} `)) {
    mod = mod.slice(marca.length).trim();
  }
  return mod;
}

export function formatearRangoAniosCompatibilidad(anioDesdeRaw, anioHastaRaw, nombreProducto = '') {
  let d = Number(anioDesdeRaw) || null;
  let h = Number(anioHastaRaw) || null;
  if (d && (d < 1970 || d > 2035)) d = null;
  if (h && (h < 1970 || h > 2035)) h = null;

  // Si no vienen explícitos en los campos numéricos, intentar extraer del título del producto
  if (!d && !h && nombreProducto) {
    const txt = String(nombreProducto).toUpperCase();
    const mRango = txt.match(/\b(19\d{2}|20\d{2})\s*(?:-|AL|A|\/)\s*(19\d{2}|20\d{2})\b/);
    if (mRango) {
      d = Number(mRango[1]);
      h = Number(mRango[2]);
    } else {
      const mDesde = txt.match(/\b(?:DESDE|AÑO)\s+(19\d{2}|20\d{2})\b/) || txt.match(/\b(19\d{2}|20\d{2})\s*\+/);
      if (mDesde) {
        d = Number(mDesde[1]);
      } else {
        const mHasta = txt.match(/\bHASTA\s+(19\d{2}|20\d{2})\b/);
        if (mHasta) {
          h = Number(mHasta[1]);
        }
      }
    }
  }

  if (d && h && d > h) {
    const tmp = d;
    d = h;
    h = tmp;
  }

  let etiquetaRango = '';
  if (d && h) {
    etiquetaRango = d === h ? `${d}` : `${d} - ${h}`;
  } else if (d && !h) {
    etiquetaRango = `${d} en adelante`;
  } else if (!d && h) {
    etiquetaRango = `Hasta ${h}`;
  }

  // Expandir años individuales (ej. 2016..2023) para atributo de filtro por año puntual
  const aniosIndividuales = [];
  if (d) {
    const fin = h || Math.min(new Date().getFullYear() + 1, d + 6);
    for (let y = d; y <= Math.min(fin, d + 20); y++) {
      aniosIndividuales.push(String(y));
    }
  } else if (h) {
    aniosIndividuales.push(String(h));
  }

  return {
    anioDesde: d,
    anioHasta: h,
    etiquetaRango,
    aniosIndividuales,
  };
}

/**
 * Extrae toda la estructura de compatibilidades vehiculares de un ítem:
 * - `marcas`: `["JAC", "SUZUKI", ...]`
 * - `modelosJerarquicos`: `[{ marca: "JAC", modelo: "S3", etiquetaModelo: "JAC S3", etiquetaRango: "2016 - 2023", etiquetaCompleta: "JAC S3 (2016 - 2023)" }]`
 * - `rutasJerarquicasBrand`: arreglos de 1, 2 o 3 niveles `[Marca, Marca Modelo, Marca Modelo (Años)]`
 */
export function extraerCompatibilidadesVehiculoDeItem(item = {}) {
  const rangoGlobal = formatearRangoAniosCompatibilidad(
    item.anioDesde,
    item.anioHasta,
    item.nombre || ''
  );

  const marcasSet = new Set();
  const entradasMap = new Map(); // `${marca}::${modelo}` -> { marca, modelo, anioDesde, anioHasta }

  // 1. Si tiene `compatibilidadesVehiculo` detalladas (desde BigQuery v_agente_catalogo)
  if (Array.isArray(item.compatibilidadesVehiculo)) {
    for (const c of item.compatibilidadesVehiculo) {
      const m = normalizarNombreMarcaAuto(c?.marca);
      if (!m) continue;
      marcasSet.add(m);
      const mod = normalizarNombreModeloAuto(m, c?.modelo);
      if (mod) {
        const k = `${m}::${mod}`;
        entradasMap.set(k, {
          marca: m,
          modelo: mod,
          anioDesde: Number(c.anioDesde) || rangoGlobal.anioDesde,
          anioHasta: Number(c.anioHasta) || rangoGlobal.anioHasta,
        });
      }
    }
  }

  // 2. Incorporar `marcasCompatibles` y `modelosCompatibles`
  if (Array.isArray(item.marcasCompatibles)) {
    for (const mRaw of item.marcasCompatibles) {
      const m = normalizarNombreMarcaAuto(mRaw);
      if (m) marcasSet.add(m);
    }
  }

  if (item.modelosCompatibles && typeof item.modelosCompatibles === 'object' && !Array.isArray(item.modelosCompatibles)) {
    for (const [mRaw, listaMods] of Object.entries(item.modelosCompatibles)) {
      const m = normalizarNombreMarcaAuto(mRaw);
      if (!m) continue;
      marcasSet.add(m);
      if (Array.isArray(listaMods)) {
        for (const modRaw of listaMods) {
          const mod = normalizarNombreModeloAuto(m, modRaw);
          if (!mod) continue;
          const k = `${m}::${mod}`;
          if (!entradasMap.has(k)) {
            entradasMap.set(k, {
              marca: m,
              modelo: mod,
              anioDesde: rangoGlobal.anioDesde,
              anioHasta: rangoGlobal.anioHasta,
            });
          }
        }
      }
    }
  }

  // 3. Fallback: extraer marca y modelo desde el título ("... PARA GREAT WALL WINGLE 5", "... PARA JAC S3")
  if (marcasSet.size === 0 && item.nombre) {
    const upper = String(item.nombre).toUpperCase();
    for (const marcaConocida of MARCAS_VEHICULOS_CONOCIDAS) {
      const regex = new RegExp(`\\b${marcaConocida.replace('-', '[\\s-]')}\\b`, 'i');
      if (regex.test(upper)) {
        const mNorm = normalizarNombreMarcaAuto(marcaConocida);
        if (mNorm) {
          marcasSet.add(mNorm);
          const idx = upper.indexOf(marcaConocida);
          if (idx >= 0) {
            const post = upper
              .slice(idx + marcaConocida.length)
              .replace(/^[\s,-]+/, '')
              .replace(/\b(?:DESDE|HASTA|AÑO|MOTOR|\d{4}).*$/i, '')
              .trim();
            const primerModelo = post.split(/[,/]/)[0]?.trim() || '';
            const mod = normalizarNombreModeloAuto(mNorm, primerModelo.split(/\s+/).slice(0, 2).join(' '));
            if (mod && mod.length >= 2) {
              entradasMap.set(`${mNorm}::${mod}`, {
                marca: mNorm,
                modelo: mod,
                anioDesde: rangoGlobal.anioDesde,
                anioHasta: rangoGlobal.anioHasta,
              });
            }
          }
        }
      }
    }
  }

  const marcas = Array.from(marcasSet).sort();
  const modelosJerarquicos = [];
  const rutasJerarquicasBrand = [];
  const aniosIndividualesSet = new Set(rangoGlobal.aniosIndividuales);
  const rangosTextoSet = new Set();
  if (rangoGlobal.etiquetaRango) rangosTextoSet.add(rangoGlobal.etiquetaRango);

  const marcasConModelo = new Set();

  for (const entry of entradasMap.values()) {
    marcasConModelo.add(entry.marca);
    const infoRango = formatearRangoAniosCompatibilidad(
      entry.anioDesde,
      entry.anioHasta,
      item.nombre || ''
    );
    infoRango.aniosIndividuales.forEach((y) => aniosIndividualesSet.add(y));
    if (infoRango.etiquetaRango) rangosTextoSet.add(infoRango.etiquetaRango);

    const etiquetaModelo = `${entry.marca} ${entry.modelo}`;
    const etiquetaCompleta = infoRango.etiquetaRango
      ? `${etiquetaModelo} (${infoRango.etiquetaRango})`
      : etiquetaModelo;

    modelosJerarquicos.push({
      marca: entry.marca,
      modelo: entry.modelo,
      etiquetaModelo,
      anioDesde: infoRango.anioDesde,
      anioHasta: infoRango.anioHasta,
      etiquetaRango: infoRango.etiquetaRango,
      etiquetaCompleta,
    });

    if (infoRango.etiquetaRango) {
      rutasJerarquicasBrand.push([entry.marca, etiquetaModelo, etiquetaCompleta]);
    } else {
      rutasJerarquicasBrand.push([entry.marca, etiquetaModelo]);
    }
  }

  // Si una marca no tenía modelo específico pero sí está en `marcas`, agregar ruta de Nivel 1 (o con rango general)
  for (const m of marcas) {
    if (!marcasConModelo.has(m)) {
      if (rangoGlobal.etiquetaRango) {
        rutasJerarquicasBrand.push([m, `${m} (${rangoGlobal.etiquetaRango})`]);
      } else {
        rutasJerarquicasBrand.push([m]);
      }
    }
  }

  return {
    marcas,
    modelosJerarquicos,
    rutasJerarquicasBrand,
    rangosTexto: Array.from(rangosTextoSet),
    aniosIndividuales: Array.from(aniosIndividualesSet).sort(),
  };
}

// Caché en memoria de marcas existentes en WooCommerce (`/products/brands`)
// para no repaginar ni recrear términos repetidos en cada lote incremental.
let _cacheMarcasWooMemoria = null;
let _cacheMarcasWooTimestamp = 0;
const CACHE_MARCAS_WOO_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Trae y crea en WooCommerce (`Productos -> Marcas`, endpoint `/products/brands`)
 * la jerarquía de 3 niveles de compatibilidad:
 *   Nivel 1 (Marca Principal): `JAC`, `SUZUKI`, `TOYOTA`...
 *   Nivel 2 (Modelo hijo): `JAC S3`, `SUZUKI SWIFT`...
 *   Nivel 3 (Rango de años hijo del modelo): `JAC S3 (2016 - 2023)`...
 * Devuelve una función `obtenerBrandsYAtributosItem(item)` lista para inyectar en `construirPayload`.
 */
async function prepararMarcasVehiculoWooCommerce(items = [], { maxCreacionesPorPase = 160, forzarRefrescoCache = false } = {}) {
  let existentes = [];
  let endpointMarcasDisponible = true;

  if (!forzarRefrescoCache && _cacheMarcasWooMemoria && (Date.now() - _cacheMarcasWooTimestamp < CACHE_MARCAS_WOO_TTL_MS)) {
    existentes = _cacheMarcasWooMemoria;
  } else {
    let page = 1;
    while (endpointMarcasDisponible) {
      try {
        const lote = await wcFetch(`/products/brands?per_page=100&page=${page}`);
        if (!Array.isArray(lote) || !lote.length) break;
        existentes.push(...lote);
        if (lote.length < 100) break;
        page++;
      } catch (err) {
        console.warn('[woo-brands] Aviso consultando /products/brands:', err.message);
        endpointMarcasDisponible = false;
        break;
      }
    }
    if (endpointMarcasDisponible) {
      _cacheMarcasWooMemoria = existentes;
      _cacheMarcasWooTimestamp = Date.now();
    }
  }

  const porPadreYNombre = new Map();
  const porNombreRaiz = new Map();
  const porNombreCualquiera = new Map();

  const indexarBrand = (b) => {
    if (!b || !b.id || !b.name) return;
    const n = normCat(b.name);
    const parentId = Number(b.parent || 0);
    porPadreYNombre.set(`${parentId}::${n}`, b.id);
    if (parentId === 0) {
      porNombreRaiz.set(n, b.id);
    }
    if (!porNombreCualquiera.has(n)) {
      porNombreCualquiera.set(n, b.id);
    }
  };

  for (const b of existentes) {
    indexarBrand(b);
  }

  let creadasCount = 0;
  let pendientesPorCrearCount = 0;

  // Recolectar todas las rutas únicas primero
  const rutasUnicasMap = new Map(); // clave -> ruta array
  for (const item of items) {
    const compat = extraerCompatibilidadesVehiculoDeItem(item);
    for (const ruta of compat.rutasJerarquicasBrand) {
      const clave = ruta.join(' > ');
      if (!rutasUnicasMap.has(clave)) {
        rutasUnicasMap.set(clave, ruta);
      }
    }
  }

  // Crear términos faltantes nivel por nivel (Nivel 0 -> Nivel 1 -> Nivel 2) en lotes paralelos de 6
  // para que sea hasta 6x más rápido y respete el presupuesto maxCreacionesPorPase sin timeout HTTP.
  if (endpointMarcasDisponible) {
    for (let nivel = 0; nivel < 3; nivel++) {
      const candidatosNivel = new Map(); // `${parentId}::${n}` -> { nombreOriginal, parentId, n }
      for (const ruta of rutasUnicasMap.values()) {
        if (ruta.length <= nivel) continue;
        let parentId = 0;
        let padreValido = true;
        for (let k = 0; k < nivel; k++) {
          const nk = normCat(ruta[k]);
          const pid = porPadreYNombre.get(`${parentId}::${nk}`) || (parentId === 0 ? porNombreRaiz.get(nk) : null) || porNombreCualquiera.get(nk);
          if (!pid) {
            padreValido = false;
            break;
          }
          parentId = pid;
        }
        if (!padreValido) continue;

        const nombreOriginal = ruta[nivel];
        const n = normCat(nombreOriginal);
        if (!n) continue;
        const yaExiste =
          porPadreYNombre.get(`${parentId}::${n}`) ||
          (parentId === 0 ? porNombreRaiz.get(n) : null);
        if (!yaExiste) {
          const keyCand = `${parentId}::${n}`;
          if (!candidatosNivel.has(keyCand)) {
            candidatosNivel.set(keyCand, { nombreOriginal, parentId, n });
          }
        }
      }

      const listaCandidatos = Array.from(candidatosNivel.values());
      const CONCURRENCY = 6;
      for (let i = 0; i < listaCandidatos.length; i += CONCURRENCY) {
        if (creadasCount >= maxCreacionesPorPase) {
          pendientesPorCrearCount += (listaCandidatos.length - i);
          break;
        }
        const chunk = listaCandidatos.slice(i, Math.min(listaCandidatos.length, i + CONCURRENCY, i + (maxCreacionesPorPase - creadasCount)));
        await Promise.all(
          chunk.map(async ({ nombreOriginal, parentId }) => {
            try {
              const creada = await wcFetch('/products/brands', {
                method: 'POST',
                body: JSON.stringify({
                  name: nombreOriginal,
                  ...(parentId ? { parent: parentId } : {}),
                  description:
                    parentId === 0
                      ? `Repuestos compatibles con vehículos ${nombreOriginal}`
                      : `Repuestos compatibles con ${nombreOriginal}`,
                }),
              });
              if (creada?.id) {
                indexarBrand(creada);
                if (_cacheMarcasWooMemoria) {
                  _cacheMarcasWooMemoria.push(creada);
                }
                creadasCount++;
              }
            } catch (err) {
              console.warn('[woo-brands] Aviso creando marca compatible', nombreOriginal, ':', err.message);
            }
          })
        );
      }
    }
  }

  // Resolver los IDs existentes para cada ruta única
  const cacheRutasBrand = new Map();
  for (const [clave, ruta] of rutasUnicasMap.entries()) {
    let parentId = 0;
    const ids = [];
    for (const nombreOriginal of ruta) {
      const n = normCat(nombreOriginal);
      if (!n) continue;
      const id =
        porPadreYNombre.get(`${parentId}::${n}`) ||
        (parentId === 0 ? porNombreRaiz.get(n) : null) ||
        porNombreCualquiera.get(n);
      if (id) {
        ids.push(id);
        parentId = id;
      } else {
        break;
      }
    }
    cacheRutasBrand.set(clave, [...new Set(ids)]);
  }

  const resolverParaItem = (item) => {
    const compat = extraerCompatibilidadesVehiculoDeItem(item);
    const idsSet = new Set();
    for (const ruta of compat.rutasJerarquicasBrand) {
      const clave = ruta.join(' > ');
      const ids = cacheRutasBrand.get(clave) || [];
      ids.forEach((id) => idsSet.add(id));
    }

    const brands = Array.from(idsSet).map((id) => ({ id }));

    // Construir también atributos estructurados para filtros de barra lateral y ficha técnica
    const attributes = [];
    if (compat.marcas.length > 0) {
      attributes.push({
        name: 'Marca Vehículo',
        visible: true,
        variation: false,
        options: compat.marcas,
      });
    }
    if (compat.modelosJerarquicos.length > 0) {
      attributes.push({
        name: 'Modelo Compatible',
        visible: true,
        variation: false,
        options: Array.from(new Set(compat.modelosJerarquicos.map((m) => m.etiquetaModelo))),
      });
      const compatConAnios = Array.from(
        new Set(compat.modelosJerarquicos.map((m) => m.etiquetaCompleta))
      );
      if (compatConAnios.length > 0) {
        attributes.push({
          name: 'Compatibilidad (Marca / Modelo / Años)',
          visible: true,
          variation: false,
          options: compatConAnios,
        });
      }
    }
    if (compat.rangosTexto.length > 0) {
      attributes.push({
        name: 'Rango de Años',
        visible: true,
        variation: false,
        options: compat.rangosTexto,
      });
    }
    if (compat.aniosIndividuales.length > 0) {
      attributes.push({
        name: 'Año Vehículo',
        visible: true,
        variation: false,
        options: compat.aniosIndividuales,
      });
    }

    // Dejar el fabricante de origen (ej. MANN-FILTER, KYB) solo como atributo técnico secundario
    const fab = String(item.fabricante || item.marcaRepuesto || '').trim().toUpperCase();
    if (fab) {
      attributes.push({
        name: 'Fabricante Repuesto',
        visible: true,
        variation: false,
        options: [fab],
      });
    }

    return {
      brands,
      attributes,
      compat,
    };
  };

  resolverParaItem.estadisticas = {
    endpointMarcasDisponible,
    marcasExistentesEnWoo: existentes.length,
    marcasNuevasCreadasEnWoo: creadasCount,
    pendientesPorCrearEnWoo: pendientesPorCrearCount,
    totalRutasAseguradas: cacheRutasBrand.size,
  };

  return resolverParaItem;
}

/**
 * Resuelve el SKU público de FácilRepuestos para un ítem de inventario,
 * priorizando `skuPublicoFrp` (`FRP-SOL-...`, `FRP-GLB-...`, `FRP-LOC-...`)
 * para evitar colisiones entre nodos Ailoo y proveedores locales.
 */
export function skuDeItem(id, item = {}) {
  if (item.skuPublicoFrp && String(item.skuPublicoFrp).trim()) {
    return String(item.skuPublicoFrp).trim().toUpperCase();
  }
  if (item.origenDatos === 'nodo_ailoo' || item.nodoAilooId) {
    const prefijo =
      item.prefijoSku ||
      (item.nodoAilooId === 'soluparts'
        ? 'FRP-SOL'
        : item.nodoAilooId === 'global'
          ? 'FRP-GLB'
          : 'FRP-AIL');
    return generarSkuPublicoFrp(prefijo, item.codigo || id);
  }
  return item.codigo ? String(item.codigo).trim().toUpperCase() : `DRM-${id}`;
}

// Busca el producto en WooCommerce (por wooProductId, SKU público FRP o código interno) y lo elimina (borrado permanente).
// Se usa cuando un ítem se borra del inventario, para que no quede huérfano
// en la tienda. No lanza error si el producto no existe ahí — simplemente
// no hace nada (puede que nunca se haya sincronizado, por ejemplo).
export async function eliminarProductoDeWooCommerce(id, item = {}) {
  if (!isWooConfigured()) {
    return { eliminado: false, motivo: 'Simulación local (sin credenciales WooCommerce)' };
  }

  const idsParaBorrar = new Set();

  // 1. Si el ítem ya tiene guardado su wooProductId directo, usarlo primero
  if (item.wooProductId) {
    idsParaBorrar.add(Number(item.wooProductId));
  }

  // 2. Buscar también por SKU público FRP y por código interno por seguridad
  const skusCandidatos = new Set([
    skuDeItem(id, item),
    item.codigo ? String(item.codigo).trim().toUpperCase() : '',
    `DRM-${id}`,
  ].filter(Boolean));

  for (const sku of skusCandidatos) {
    try {
      const encontrados = await wcFetch(`/products?sku=${encodeURIComponent(sku)}&_fields=id,sku`);
      for (const p of encontrados || []) {
        if (p?.id) idsParaBorrar.add(Number(p.id));
      }
    } catch (err) {
      console.warn('[woo-delete] Error buscando SKU', sku, ':', err.message);
    }
  }

  if (idsParaBorrar.size === 0) {
    console.log('[woo-delete] No se encontró ningún producto en WooCommerce para:', item.nombre);
    return { eliminado: false, motivo: 'No existía en WooCommerce' };
  }

  const eliminadosIds = [];
  for (const wooId of idsParaBorrar) {
    try {
      console.log('[woo-delete] Eliminando producto WooCommerce id:', wooId, '(item:', item.nombre, ')');
      await wcFetch(`/products/${wooId}?force=true`, { method: 'DELETE' });
      eliminadosIds.push(wooId);
    } catch (err) {
      console.warn('[woo-delete] No se pudo eliminar id', wooId, ':', err.message);
    }
  }

  return {
    eliminado: eliminadosIds.length > 0,
    wooId: eliminadosIds[0] || null,
    eliminadosIds,
  };
}

// Limpia productos "huérfanos": los que el propio sistema creó en WooCommerce
// (tienen el meta _drmotors_inventario_id o SKU con prefijo FRP-) pero cuyo documento/SKU ya no existe en el
// inventario actual — típicamente porque se eliminaron del inventario.
// NUNCA toca productos agregados a mano en WooCommerce.
export async function limpiarProductosHuerfanos(invDocsOpcional = null) {
  if (!isWooConfigured()) {
    throw new Error('Faltan credenciales de WooCommerce (WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET)');
  }

  const docs = invDocsOpcional || (await db.collection('inventario').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const docsVisibles = docs.filter(d => !d.ocultarEnTienda);
  const idsVigentes = new Set(docsVisibles.map(d => String(d.id)));
  const skusVigentes = new Set(docsVisibles.map(d => skuDeItem(d.id, d)));

  const huerfanos = [];
  let page = 1;
  while (true) {
    const productos = await wcFetch(`/products?per_page=100&page=${page}&_fields=id,sku,name,meta_data`);
    if (!productos.length) break;
    for (const p of productos) {
      const metaInv = (p.meta_data || []).find(m => m.key === '_drmotors_inventario_id');
      const skuUpper = String(p.sku || '').trim().toUpperCase();
      const creadoPorSync = Boolean(metaInv) || skuUpper.startsWith('FRP-') || skuUpper.startsWith('DRM-');
      if (!creadoPorSync) continue;

      const idSigueVigente = metaInv?.value ? idsVigentes.has(String(metaInv.value)) : false;
      const skuSigueVigente = skuUpper ? skusVigentes.has(skuUpper) : false;

      if (!idSigueVigente && !skuSigueVigente) {
        huerfanos.push({ id: p.id, sku: p.sku, nombre: p.name });
      }
    }
    if (productos.length < 100) break;
    page++;
  }

  const CHUNK = 90;
  for (let i = 0; i < huerfanos.length; i += CHUNK) {
    const loteIds = huerfanos.slice(i, i + CHUNK).map(h => h.id);
    if (loteIds.length) {
      await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ delete: loteIds }) });
    }
  }

  return { eliminados: huerfanos.length, detalle: huerfanos };
}

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function descripcionDeItem(item) {
  const partes = [];
  if (item.descripcion) partes.push(escHtml(item.descripcion).replace(/\r?\n/g, '<br>'));
  if (item.fabricante || item.marcaRepuesto) {
    partes.push(`<strong>Marca:</strong> ${escHtml(item.fabricante || item.marcaRepuesto)}`);
  }
  if (item.origen) partes.push(`<strong>Origen:</strong> ${escHtml(item.origen)}`);
  if (item.tipoPieza) partes.push(`<strong>Tipo:</strong> ${item.tipoPieza}`);
  if (item.marcasCompatibles?.length) {
    partes.push(`<strong>Compatible con:</strong> ${item.marcasCompatibles.join(', ')}`);
  }
  if (Array.isArray(item.modelosCompatibles) && item.modelosCompatibles.length) {
    partes.push(`<strong>Modelos compatibles:</strong> ${item.modelosCompatibles.join(', ')}`);
  } else if (item.modelosCompatibles && typeof item.modelosCompatibles === 'object') {
    const entradasModelos = Object.entries(item.modelosCompatibles)
      .filter(([, mods]) => Array.isArray(mods) && mods.length > 0)
      .map(([marca, mods]) => `${escHtml(marca)}: ${mods.map(escHtml).join(', ')}`);
    if (entradasModelos.length > 0) {
      partes.push(`<strong>Modelos compatibles:</strong> ${entradasModelos.join(' · ')}`);
    }
  }
  if (Array.isArray(item.cilindradasCompatibles) && item.cilindradasCompatibles.length) {
    partes.push(`<strong>Cilindrada:</strong> ${item.cilindradasCompatibles.map(escHtml).join(', ')}`);
  }
  if (item.anioDesde || item.anioHasta) {
    partes.push(`<strong>Años compatibles:</strong> ${item.anioDesde || ''}${item.anioHasta ? ` - ${item.anioHasta}` : '+'}`);
  }
  if (item.oem) {
    partes.push(`<strong>OEM:</strong> ${escHtml(item.oem)}`);
  }
  if (item.equivalencias?.length) {
    const eq = item.equivalencias
      .map(e => (typeof e === 'string' ? e : `${e.fabricante || ''} ${e.codigo || ''}`.trim()))
      .filter(Boolean)
      .join(', ');
    if (eq) partes.push(`<strong>Equivalencias:</strong> ${escHtml(eq)}`);
  }
  return partes.length ? `<p>${partes.join('</p><p>')}</p>` : '';
}

// Construye el payload de un producto para la API de WooCommerce a partir de un ítem de inventario.
// `esNuevo` controla si se manda la descripción autogenerada: solo al CREAR el producto —
// en las actualizaciones se omite a propósito para no pisar descripciones editadas a mano
// en WordPress (WooCommerce solo modifica los campos que se le mandan, deja el resto igual).
// `puedeAgregarImagen` es true si el producto es nuevo, o si ya existe pero todavía no tiene
// ninguna foto en WooCommerce — así se rellenan huecos sin pisar fotos puestas a mano.
function construirPayload(
  id,
  item,
  obtenerCategoriasItem,
  esNuevo,
  puedeAgregarImagen,
  mapaMediaWoo = null,
  obtenerMarcasCompatibilidadItem = null
) {
  const disponible = Math.max(0, Math.floor((item.stock || 0) - (item.stockReservado || 0)));
  const rutaCategorias = resolverRutaCategoriasTienda(item);
  const rutaTexto = rutaCategorias.join(' > ');
  const categories = typeof obtenerCategoriasItem === 'function' ? obtenerCategoriasItem(item) : [];
  const tallaInfo = clasificarTallaLogisticaRepuesto(item);
  const infoCompatWoo =
    typeof obtenerMarcasCompatibilidadItem === 'function'
      ? obtenerMarcasCompatibilidadItem(item)
      : null;

  const payload = {
    name: item.nombre,
    sku: skuDeItem(id, item),
    regular_price: String(item.precioVenta || 0),
    manage_stock: true,
    stock_quantity: disponible,
    stock_status: disponible > 0 ? 'instock' : 'outofstock',
    weight: String(item.pesoTarifableKg || tallaInfo.pesoTarifableKg || 2.5),
    dimensions: {
      length: String(item.dimensionesCm?.largo || tallaInfo.dimensionesCm.largo || 32),
      width: String(item.dimensionesCm?.ancho || tallaInfo.dimensionesCm.ancho || 25),
      height: String(item.dimensionesCm?.alto || tallaInfo.dimensionesCm.alto || 18),
    },
    categories,
    ...(infoCompatWoo?.brands?.length ? { brands: infoCompatWoo.brands } : {}),
    ...(infoCompatWoo?.attributes?.length ? { attributes: infoCompatWoo.attributes } : {}),
    meta_data: [
      { key: '_drmotors_inventario_id', value: id },
      { key: '_frp_origen_datos', value: String(item.origenDatos || 'proveedor_local') },
      { key: '_frp_proveedor_id', value: String(item.proveedorId || 'local') },
      { key: '_frp_categoria_jerarquia', value: rutaTexto },
      { key: '_frp_categoria_ruta', value: rutaTexto },
      { key: '_frp_talla_logistica', value: String(item.tallaLogistica || tallaInfo.tallaLogistica || 'S') },
      ...(infoCompatWoo?.compat?.marcas?.length
        ? [{ key: '_frp_marcas_compatibles', value: infoCompatWoo.compat.marcas.join(', ') }]
        : []),
      ...(infoCompatWoo?.compat?.rangosTexto?.length
        ? [{ key: '_frp_rango_anios', value: infoCompatWoo.compat.rangosTexto.join(', ') }]
        : []),
    ],
  };


  if (esNuevo || item.wooSyncMotivo === 'enriquecimiento_compatibilidad_ia') {
    payload.description = descripcionDeItem(item);
  }

  // Etapa 1 + Etapa 2 de Imágenes: si el producto puede recibir imagen (es nuevo o aún no tiene imagen en WooCommerce,
  // o viene con motivo de actualización de foto), resolvemos su imagen efectiva (propia/OEM o maestra de subcategoría Nivel 3).
  const forzarActualizacionFoto =
    item.wooSyncMotivo === 'nueva_foto_banco_proveedor' ||
    item.wooSyncMotivo === 'foto_principal_actualizada' ||
    item.wooSyncMotivo === 'enriquecimiento_imagen_catalogo' ||
    item.wooSyncMotivo === 'foto_estudio_soluparts';

  if (puedeAgregarImagen || forzarActualizacionFoto) {
    const imgEfectiva = resolverImagenEfectivaProducto(item);
    if (imgEfectiva?.url) {
      const mediaIdExistente =
        Number(item.wooMediaId) ||
        Number(imgEfectiva.wooMediaId) ||
        (mapaMediaWoo ? Number(mapaMediaWoo.get(imgEfectiva.url)) : 0);
      if (mediaIdExistente > 0) {
        // Reutiliza el attachment ID existente en la galería de WordPress (0 bytes extra en disco)
        payload.images = [{ id: mediaIdExistente }];
      } else {
        const urlOptimaWoo = imgEfectiva.url.includes('soluparts.cl/Content/products/')
          ? imgEfectiva.url.replace('_900.', '_600.')
          : imgEfectiva.url;
        payload.images = [{ src: urlOptimaWoo }];
        payload._imagenUrlPendienteCache = imgEfectiva.url;
      }
    }
  }

  return payload;
}

/**
 * Obtiene el estado de la cola de sincronización incremental (Delta) hacia WooCommerce,
 * desglosado por origen (`soluparts`, `global`, `locales`).
 */
export async function obtenerEstadoColaWooCommerce() {
  const configured = isWooConfigured();
  const snap = await db.collection('inventario').get();
  const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const pendientes = items.filter(i => i.needsWooSync === true || !i.lastWooSyncAt);
  const sincronizados = items.length - pendientes.length;

  const desglosePorOrigen = {
    soluparts: { total: 0, pendientes: 0 },
    global: { total: 0, pendientes: 0 },
    locales: { total: 0, pendientes: 0 },
  };

  for (const item of items) {
    const isPendiente = item.needsWooSync === true || !item.lastWooSyncAt;
    const bucket =
      item.nodoAilooId === 'soluparts' || item.proveedorId === 'soluparts'
        ? 'soluparts'
        : item.nodoAilooId === 'global' || item.proveedorId === 'global'
          ? 'global'
          : 'locales';

    desglosePorOrigen[bucket].total += 1;
    if (isPendiente) {
      desglosePorOrigen[bucket].pendientes += 1;
    }
  }

  return {
    credencialesConfiguradas: configured,
    modoOperacion: configured ? 'woocommerce_rest_live' : 'simulacion_local_delta',
    tiendaUrl: getWooConfig().url || 'https://facilrepuestos.cl (Simulación Local)',
    totalInventario: items.length,
    pendientesSync: pendientes.length,
    sincronizados,
    desglosePorOrigen,
    itemsPendientes: pendientes.slice(0, 30).map(i => ({
      id: i.id,
      skuPublicoFrp: skuDeItem(i.id, i),
      codigoInterno: i.codigo || '',
      nombre: i.nombre,
      categoria: i.categoria || 'General',
      subcategoria: i.subcategoria || '',
      subcategoriaDetalle: i.subcategoriaDetalle || '',
      proveedor: i.proveedor || 'Taller / Local',
      origenDatos: i.origenDatos || 'proveedor_local',
      nodoAilooId: i.nodoAilooId || null,
      stock: Math.max(0, Math.floor((Number(i.stock) || 0) - (Number(i.stockReservado) || 0))),
      precioCompra: Number(i.precioCompra) || 0,
      precioVenta: Number(i.precioVenta) || 0,
      wooSyncMotivo: i.wooSyncMotivo || 'pendiente_inicial',
      actualizadoEn: i.actualizadoEn || i.updatedAt || i.createdAt || null,
    })),
  };
}

/**
 * Sincroniza el inventario hacia WooCommerce.
 * - Por defecto (`soloDelta = true`) sincroniza únicamente los ítems con `needsWooSync === true`
 *   o que nunca se han sincronizado (`!lastWooSyncAt`), logrando sincronización incremental rápida.
 * - Si `soloDelta = false`, sincroniza el catálogo completo.
 * - Soporta `maxItems` para procesar grandes volúmenes (ej. 8.500 SKUs) en lotes seguros.
 */
export async function sincronizarInventarioConWooCommerce({ soloDelta = true, maxItems = 0, todosPreCargados = null } = {}) {
  const configured = isWooConfigured();
  let todos = todosPreCargados;
  if (!Array.isArray(todos)) {
    const snap = await db.collection('inventario').get();
    todos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  const candidatos = soloDelta
    ? todos.filter(i => i.needsWooSync === true || !i.lastWooSyncAt)
    : todos;
  const items = maxItems > 0 ? candidatos.slice(0, maxItems) : candidatos;
  const pendientesRestantes = Math.max(0, candidatos.length - items.length);

  const omitidosSinCambio = todos.length - items.length;
  const ahora = new Date().toISOString();

  if (items.length === 0) {
    let huerfanosEliminados = 0;
    let detalleHuerfanos = [];
    if (configured) {
      const limpieza = await limpiarProductosHuerfanos(todos);
      huerfanosEliminados = limpieza.eliminados || 0;
      detalleHuerfanos = (limpieza.detalle || []).map(h => ({
        id: String(h.id),
        skuPublicoFrp: h.sku || '',
        nombre: h.nombre || '',
        proveedor: 'Eliminado de inventario',
        accion: 'eliminado_huerfano',
        wooProductId: h.id,
      }));
    }
    return {
      modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
      modoConexion: configured ? 'woocommerce_rest_live' : 'simulacion_local_delta',
      total: todos.length,
      procesados: huerfanosEliminados,
      pendientesRestantes: 0,
      creados: 0,
      actualizados: 0,
      ocultados: huerfanosEliminados,
      omitidosSinCambio,
      procesadosDetalle: detalleHuerfanos,
      sincronizadoEn: ahora,
    };
  }

  // Modo Simulación Local cuando no están definidas las variables WOOCOMMERCE_*
  if (!configured) {
    let creados = 0;
    let actualizados = 0;
    let ocultados = 0;
    const procesadosDetalle = [];

    for (const item of items) {
      const sku = skuDeItem(item.id, item);
      const teniaWooId = Boolean(item.wooProductId);
      const simulatedWooId = item.wooProductId || Math.floor(100000 + Math.random() * 900000);

      if (item.ocultarEnTienda) {
        if (teniaWooId) ocultados++;
      } else if (teniaWooId) {
        actualizados++;
      } else {
        creados++;
      }

      await db.collection('inventario').doc(item.id).update({
        skuPublicoFrp: sku,
        wooProductId: item.ocultarEnTienda ? null : simulatedWooId,
        needsWooSync: false,
        wooSyncMotivo: null,
        lastWooSyncAt: ahora,
      });

      procesadosDetalle.push({
        id: item.id,
        skuPublicoFrp: sku,
        nombre: item.nombre,
        proveedor: item.proveedor || 'Local',
        accion: item.ocultarEnTienda ? 'ocultado' : teniaWooId ? 'actualizado' : 'creado',
        wooProductId: item.ocultarEnTienda ? null : simulatedWooId,
      });
    }

    return {
      modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
      modoConexion: 'simulacion_local_delta',
      total: todos.length,
      procesados: items.length,
      pendientesRestantes,
      creados,
      actualizados,
      ocultados,
      omitidosSinCambio,
      procesadosDetalle,
      sincronizadoEn: ahora,
    };
  }

  // Modo WooCommerce REST API Live
  const obtenerCategoriasItem = await prepararCategoriasWooCommerce(items);
  const obtenerMarcasCompatibilidadItem = await prepararMarcasVehiculoWooCommerce(items);
  const existentes            = await obtenerProductosExistentes(items);

  // Cargar mapa de URL de imagen -> media_id de WordPress para reutilizar adjuntos sin duplicar disco
  const mediaDocRef = db.collection('configuracion_sistema').doc('mapa_imagenes_woo_media');
  const mediaSnap = await mediaDocRef.get().catch(() => null);
  const mapaMediaObj = mediaSnap?.exists ? mediaSnap.data()?.porUrl || {} : {};
  const mapaMediaWoo = new Map(Object.entries(mapaMediaObj).map(([k, v]) => [k, Number(v)]));
  let mapaMediaModificado = false;

  const crear = [];
  const metaCrear = [];
  const actualizar = [];
  const metaActualizar = [];
  const ocultosParaEliminar = [];
  const metaOcultos = [];

  for (const item of items) {
    const sku = skuDeItem(item.id, item);
    const existente = existentes.get(sku);
    const idExistente = item.wooProductId || existente?.id;

    if (item.ocultarEnTienda) {
      if (idExistente) {
        ocultosParaEliminar.push(idExistente);
        metaOcultos.push({ docId: item.id, sku, item });
      } else {
        await db.collection('inventario').doc(item.id).update({
          skuPublicoFrp: sku,
          needsWooSync: false,
          wooSyncMotivo: null,
          lastWooSyncAt: ahora,
        });
      }
      continue;
    }

    const esNuevo = !idExistente;
    const puedeAgregarImagen = esNuevo || !existente?.tieneImagen;
    const payload = construirPayload(
      item.id,
      item,
      obtenerCategoriasItem,
      esNuevo,
      puedeAgregarImagen,
      mapaMediaWoo,
      obtenerMarcasCompatibilidadItem
    );
    if (idExistente) {
      actualizar.push({ id: idExistente, ...payload });
      metaActualizar.push({ docId: item.id, sku, wooId: idExistente, item });
    } else {
      crear.push(payload);
      metaCrear.push({ docId: item.id, sku, item });
    }
  }

  // Lotes de 50 ítems por llamada para evitar timeouts PHP/Cloudflare en WordPress
  const CHUNK = 50;
  let creados = 0, actualizados = 0, ocultados = 0;
  const procesadosDetalle = [];
  const totalLotesCrear = Math.ceil(crear.length / CHUNK);
  const totalLotesActualizar = Math.ceil(actualizar.length / CHUNK);

  const prepararLoteReutilizandoMediaId = (loteRaw) => {
    const urlsYaEnviadasEnEsteLote = new Set();
    return loteRaw.map((p) => {
      const copia = { ...p };
      const urlPend = copia._imagenUrlPendienteCache;
      delete copia._imagenUrlPendienteCache;
      if (urlPend) {
        const idConocido = mapaMediaWoo.get(urlPend);
        if (idConocido > 0) {
          copia.images = [{ id: idConocido }];
        } else if (urlsYaEnviadasEnEsteLote.has(urlPend)) {
          // Si otro ítem de este mismo lote de 50 ya subirá esta URL por primera vez,
          // evitamos subir 50 copias repetidas en el mismo lote; si el ítem ya tenía imagenUrl
          // en el siguiente pase usará el mediaId, o solo el primero del lote la sube a la librería.
          copia._urlCompartidaEnLote = urlPend;
        } else {
          urlsYaEnviadasEnEsteLote.add(urlPend);
          copia._urlSubidaPorPrimeraVez = urlPend;
        }
      }
      return copia;
    });
  };

  for (let i = 0; i < crear.length; i += CHUNK) {
    const lotePrep = prepararLoteReutilizandoMediaId(crear.slice(i, i + CHUNK));
    const lote = lotePrep.map(({ _urlCompartidaEnLote, _urlSubidaPorPrimeraVez, ...rest }) => rest);
    const metaLote = metaCrear.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const numLote = Math.floor(i / CHUNK) + 1;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ create: lote }) });
    const createdList = r.create || [];
    creados += createdList.filter(x => x && !x.error).length;
    console.log(`[woo-sync] Crear lote ${numLote}/${totalLotesCrear}: +${createdList.length} (acumulado creados: ${creados}/${crear.length})`);

    const batch = db.batch();
    let batchCount = 0;
    for (let j = 0; j < metaLote.length; j++) {
      const m = metaLote[j];
      const cw = createdList[j];
      const pPrep = lotePrep[j];
      if (pPrep?._urlSubidaPorPrimeraVez && cw?.images?.[0]?.id) {
        mapaMediaWoo.set(pPrep._urlSubidaPorPrimeraVez, Number(cw.images[0].id));
        mapaMediaModificado = true;
      }
      if (m && cw && !cw.error) {
        batch.update(db.collection('inventario').doc(m.docId), {
          skuPublicoFrp: m.sku,
          wooProductId: cw.id || null,
          needsWooSync: false,
          wooSyncMotivo: null,
          lastWooSyncAt: ahora,
        });
        batchCount++;
        if (procesadosDetalle.length < 200) {
          procesadosDetalle.push({
            id: m.docId,
            skuPublicoFrp: m.sku,
            nombre: m.item.nombre,
            proveedor: m.item.proveedor || 'Local',
            accion: 'creado',
            wooProductId: cw.id || null,
          });
        }
      }
    }
    if (batchCount > 0) await batch.commit();
  }

  for (let i = 0; i < actualizar.length; i += CHUNK) {
    const lotePrep = prepararLoteReutilizandoMediaId(actualizar.slice(i, i + CHUNK));
    const lote = lotePrep.map(({ _urlCompartidaEnLote, _urlSubidaPorPrimeraVez, ...rest }) => rest);
    const metaLote = metaActualizar.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const numLote = Math.floor(i / CHUNK) + 1;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ update: lote }) });
    const updatedList = r.update || [];
    actualizados += updatedList.filter(x => x && !x.error).length;
    console.log(`[woo-sync] Actualizar lote ${numLote}/${totalLotesActualizar}: +${updatedList.length} (acumulado actualizados: ${actualizados}/${actualizar.length})`);

    const batch = db.batch();
    let batchCount = 0;
    for (let j = 0; j < metaLote.length; j++) {
      const m = metaLote[j];
      const uw = updatedList[j];
      const pPrep = lotePrep[j];
      if (pPrep?._urlSubidaPorPrimeraVez && uw?.images?.[0]?.id) {
        mapaMediaWoo.set(pPrep._urlSubidaPorPrimeraVez, Number(uw.images[0].id));
        mapaMediaModificado = true;
      }
      if (m && (!uw || !uw.error)) {
        batch.update(db.collection('inventario').doc(m.docId), {
          skuPublicoFrp: m.sku,
          wooProductId: uw?.id || m.wooId,
          needsWooSync: false,
          wooSyncMotivo: null,
          lastWooSyncAt: ahora,
        });
        batchCount++;
        if (procesadosDetalle.length < 200) {
          procesadosDetalle.push({
            id: m.docId,
            skuPublicoFrp: m.sku,
            nombre: m.item.nombre,
            proveedor: m.item.proveedor || 'Local',
            accion: 'actualizado',
            wooProductId: uw?.id || m.wooId,
          });
        }
      }
    }
    if (batchCount > 0) await batch.commit();
  }

  if (mapaMediaModificado) {
    await mediaDocRef
      .set({
        porUrl: Object.fromEntries(mapaMediaWoo.entries()),
        actualizadoEn: ahora,
      }, { merge: true })
      .catch(() => null);
  }

  for (let i = 0; i < ocultosParaEliminar.length; i += CHUNK) {
    const lote = ocultosParaEliminar.slice(i, i + CHUNK);
    const metaLote = metaOcultos.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ delete: lote }) });
    ocultados += r.delete?.length || 0;

    const batch = db.batch();
    for (const m of metaLote) {
      batch.update(db.collection('inventario').doc(m.docId), {
        skuPublicoFrp: m.sku,
        wooProductId: null,
        needsWooSync: false,
        wooSyncMotivo: null,
        lastWooSyncAt: ahora,
      });
    }
    if (metaLote.length > 0) await batch.commit();
  }

  // Cuando terminamos todos los lotes pendientes (o no se paginó con maxItems), limpiamos huérfanos
  let huerfanosEliminados = 0;
  if (pendientesRestantes === 0) {
    const limpieza = await limpiarProductosHuerfanos(todos);
    huerfanosEliminados = limpieza.eliminados || 0;
    ocultados += huerfanosEliminados;
  }

  return {
    modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
    modoConexion: 'woocommerce_rest_live',
    total: todos.length,
    procesados: items.length + huerfanosEliminados,
    pendientesRestantes,
    creados,
    actualizados,
    ocultados,
    omitidosSinCambio,
    procesadosDetalle,
    sincronizadoEn: ahora,
  };
}

function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

const quitarHtml = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Exporta el catálogo completo directo desde la API de WooCommerce, con
// columnas equivalentes a las del exportador nativo de WordPress — para usar
// como alternativa cuando ese exportador falla (bug conocido con los filtros
// de categoría/tipo en algunos hostings).
export async function exportarCatalogoCSV() {
  if (!isWooConfigured()) {
    throw new Error('Faltan credenciales de WooCommerce (WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET)');
  }

  const columnas = [
    'ID', 'Tipo', 'SKU', 'Nombre', 'Publicado', 'Visibilidad en el catálogo',
    'Descripción corta', 'Descripción', 'Estado del impuesto', '¿Existencias?',
    'Inventario', 'Precio normal', 'Categorías', 'Imágenes',
  ];
  const filas = [columnas.join(',')];

  let page = 1;
  while (true) {
    const productos = await wcFetch(`/products?per_page=100&page=${page}`);
    if (!productos.length) break;

    for (const p of productos) {
      const categorias = (p.categories || []).map(c => c.name).join(', ');
      const imagenes    = (p.images || []).map(i => i.src).join(', ');
      const fila = [
        p.id,
        p.type,
        p.sku,
        p.name,
        p.status === 'publish' ? 1 : 0,
        p.catalog_visibility,
        quitarHtml(p.short_description),
        quitarHtml(p.description),
        p.tax_status,
        p.manage_stock ? 1 : 0,
        p.stock_quantity,
        p.regular_price,
        categorias,
        imagenes,
      ].map(csvEscape).join(',');
      filas.push(fila);
    }

    if (productos.length < 100) break;
    page++;
  }

  return filas.join('\n');
}

/**
 * Devuelve la URL pública base de la tienda WordPress/WooCommerce (por defecto https://facilrepuestos.cl).
 */
export function obtenerUrlBaseTiendaWoo() {
  const configured = (process.env.WOOCOMMERCE_URL || '').replace(/\/+$/, '');
  return configured || 'https://facilrepuestos.cl';
}

/**
 * Construye los enlaces directos al carro de compras y ficha de producto en WordPress/WooCommerce
 * para uno o más ítems cotizados por Repuestín o listados en el buscador inteligente.
 */
export function construirLinksCarroWooCommerce(items = []) {
  const baseUrl = obtenerUrlBaseTiendaWoo();
  const lista = Array.isArray(items) ? items : [];
  const conWooId = lista.filter((it) => Number(it?.wooProductId) > 0);

  if (conWooId.length === 0) {
    const primerSku = lista[0]?.skuPublicoFrp || lista[0]?.codigo || '';
    const urlBusqueda = primerSku
      ? `${baseUrl}/?s=${encodeURIComponent(primerSku)}&post_type=product`
      : `${baseUrl}/tienda/`;
    return {
      tieneWooIds: false,
      urlCarroPrincipal: urlBusqueda,
      urlCheckoutDirecto: `${baseUrl}/finalizar-compra/`,
      enlacesPorItem: lista.map((it) => ({
        skuPublicoFrp: it.skuPublicoFrp || it.codigo || '',
        wooProductId: null,
        urlProducto: `${baseUrl}/?s=${encodeURIComponent(it.skuPublicoFrp || it.nombre || '')}&post_type=product`,
        urlAgregarAlCarro: urlBusqueda,
      })),
    };
  }

  const enlacesPorItem = lista.map((it) => {
    const wid = Number(it?.wooProductId) || null;
    const qty = Math.max(1, Number(it?.cantidad || 1));
    return {
      skuPublicoFrp: it.skuPublicoFrp || it.codigo || '',
      wooProductId: wid,
      cantidad: qty,
      urlProducto: wid ? `${baseUrl}/?p=${wid}` : `${baseUrl}/?s=${encodeURIComponent(it.skuPublicoFrp || '')}&post_type=product`,
      urlAgregarAlCarro: wid ? `${baseUrl}/?add-to-cart=${wid}&quantity=${qty}` : `${baseUrl}/tienda/`,
    };
  });

  const primero = conWooId[0];
  const qtyPrimero = Math.max(1, Number(primero.cantidad || 1));
  const urlCarroPrincipal = `${baseUrl}/?add-to-cart=${Number(primero.wooProductId)}&quantity=${qtyPrimero}`;

  return {
    tieneWooIds: true,
    urlCarroPrincipal,
    urlCheckoutDirecto: `${baseUrl}/finalizar-compra/`,
    enlacesPorItem,
  };
}

/**
 * Crea una orden real en estado `pending` en WooCommerce (`/wp-json/wc/v3/orders`) cuando el cliente
 * completa el flujo COMPRAR en WhatsApp/Repuestín, devolviendo el `payment_url` oficial del checkout
 * de WordPress (para pagar con Webpay / MercadoPago / Toku / Transferencia en facilrepuestos.cl).
 * Si las credenciales de WooCommerce no están presentes o algún ítem no tiene `wooProductId`,
 * devuelve de forma transparente el link directo de carrito (`?add-to-cart=`).
 */
export async function crearPedidoPendienteWooCommerce({
  items = [],
  datosCliente = {},
  modalidadEntrega = 'retiro_bodega',
  comunaEntrega = 'La Florida, Santiago (RM)',
  documentoTributario = 'BOLETA',
  vehiculo = null,
  codigoPedidoFrp = '',
  clienteTelefono = '',
  cotizacionDespacho = null,
}) {
  const linksCarro = construirLinksCarroWooCommerce(items);
  const conWooId = (Array.isArray(items) ? items : []).filter((it) => Number(it?.wooProductId) > 0);
  const cotizacionEfectiva =
    cotizacionDespacho ||
    cotizarDespachoAnticipado({
      direccionOComuna: comunaEntrega,
      itemsCarrito: items,
      modalidad: modalidadEntrega === 'retiro_bodega' ? 'Retiro en tienda' : 'Despacho a domicilio',
    });

  if (!isWooConfigured() || conWooId.length === 0) {
    return {
      creadoEnWoo: false,
      wooOrderId: null,
      wooOrderKey: null,
      urlPagoCheckoutWoo: linksCarro.urlCarroPrincipal,
      urlAgregarAlCarroWoo: linksCarro.urlCarroPrincipal,
      enlacesPorItem: linksCarro.enlacesPorItem,
      cotizacionDespacho: cotizacionEfectiva,
    };
  }

  try {
    const nombreCompleto = String(datosCliente?.nombre || 'Cliente FácilRepuestos').trim();
    const partesNombre = nombreCompleto.split(/\s+/);
    const firstName = partesNombre[0] || 'Cliente';
    const lastName = partesNombre.slice(1).join(' ') || 'FácilRepuestos';
    const direccion =
      modalidadEntrega === 'retiro_bodega'
        ? `Retiro en Sucursal FácilRepuestos (${cotizacionEfectiva?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida'})`
        : String(comunaEntrega || 'Santiago');
    const costoEnvioIva = Number(cotizacionEfectiva?.costoDespachoConIva || 0);

    const payload = {
      status: 'pending',
      customer_note: [
        `Pedido generado por Repuestín (${codigoPedidoFrp})`,
        documentoTributario ? `Documento: ${documentoTributario}` : '',
        datosCliente?.rut ? `RUT: ${datosCliente.rut}` : '',
        vehiculo?.patente ? `Patente: ${vehiculo.patente} (${vehiculo.marca || ''} ${vehiculo.modelo || ''})` : '',
        cotizacionEfectiva?.nodoOrigen?.direccion ? `Origen Despacho: ${cotizacionEfectiva.nodoOrigen.direccion}` : '',
        cotizacionEfectiva?.volumetria?.tallaConsolidada ? `Talla Caja: ${cotizacionEfectiva.volumetria.tallaConsolidada} (~${cotizacionEfectiva.volumetria.pesoTarifableConsolidadoKg} kg)` : '',
      ]
        .filter(Boolean)
        .join(' | '),
      billing: {
        first_name: firstName,
        last_name: lastName,
        address_1: direccion,
        city: cotizacionEfectiva?.comunaDetectada || comunaEntrega || 'Santiago',
        state: cotizacionEfectiva?.esRegionMetropolitana === false ? 'Regiones' : 'RM',
        country: 'CL',
        email: datosCliente?.email || 'ventas@facilrepuestos.cl',
        phone: String(clienteTelefono || '').replace(/[^\d+]/g, '') || '+56900000000',
      },
      shipping: {
        first_name: firstName,
        last_name: lastName,
        address_1: direccion,
        city: cotizacionEfectiva?.comunaDetectada || comunaEntrega || 'Santiago',
        state: cotizacionEfectiva?.esRegionMetropolitana === false ? 'Regiones' : 'RM',
        country: 'CL',
      },
      line_items: conWooId.map((it) => ({
        product_id: Number(it.wooProductId),
        quantity: Math.max(1, Number(it.cantidad || 1)),
      })),
      shipping_lines: [
        {
          method_id: modalidadEntrega === 'retiro_bodega' ? 'local_pickup' : 'flat_rate',
          method_title:
            cotizacionEfectiva?.tituloTarifa ||
            (modalidadEntrega === 'retiro_bodega'
              ? 'Retiro Gratis en Enrique Olivares 224, La Florida'
              : 'Despacho Pre-Pagado FácilRepuestos'),
          total: String(costoEnvioIva),
        },
      ],
      meta_data: [
        { key: '_frp_codigo_pedido', value: String(codigoPedidoFrp || '') },
        { key: '_frp_rut_cliente', value: String(datosCliente?.rut || '') },
        { key: '_frp_documento_tributario', value: String(documentoTributario || 'BOLETA') },
        { key: '_frp_modalidad_entrega', value: String(modalidadEntrega || 'retiro_bodega') },
        { key: '_frp_patente_vehiculo', value: String(vehiculo?.patente || '') },
        { key: '_frp_nodo_origen_despacho', value: String(cotizacionEfectiva?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida, Santiago') },
        { key: '_frp_talla_logistica', value: String(cotizacionEfectiva?.volumetria?.tallaConsolidada || 'S') },
        { key: '_frp_costo_despacho_iva', value: String(costoEnvioIva) },
      ],
    };


    const ordenWoo = await wcFetch('/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      creadoEnWoo: true,
      wooOrderId: ordenWoo?.id || null,
      wooOrderKey: ordenWoo?.order_key || null,
      urlPagoCheckoutWoo: ordenWoo?.payment_url || linksCarro.urlCarroPrincipal,
      urlAgregarAlCarroWoo: linksCarro.urlCarroPrincipal,
      enlacesPorItem: linksCarro.enlacesPorItem,
    };
  } catch (err) {
    console.warn('[woo-sync] No se pudo crear orden pending en WooCommerce, usando link directo de carro:', err.message);
    return {
      creadoEnWoo: false,
      wooOrderId: null,
      wooOrderKey: null,
      urlPagoCheckoutWoo: linksCarro.urlCarroPrincipal,
      urlAgregarAlCarroWoo: linksCarro.urlCarroPrincipal,
      enlacesPorItem: linksCarro.enlacesPorItem,
    };
  }
}

/**
 * Obtiene los últimos pedidos de WooCommerce desde la REST API de WordPress (`facilrepuestos.cl`)
 * y clasifica si cada pedido fue una compra Web Directa (sin pasar por Repuestín)
 * o si provino de Repuestín WhatsApp.
 */
export async function obtenerPedidosWooCommerceRecientes({ maxPedidos = 60 } = {}) {
  if (!isWooConfigured()) {
    return { configurado: false, pedidos: [] };
  }
  try {
    const perPage = Math.min(100, Math.max(10, Number(maxPedidos) || 60));
    const orders = await wcFetch(`/orders?per_page=${perPage}&orderby=date&order=desc`, {}, 2);
    if (!Array.isArray(orders)) {
      return { configurado: true, pedidos: [] };
    }

    const pedidos = orders.map((o) => {
      const metaList = Array.isArray(o.meta_data) ? o.meta_data : [];
      const metaCodigoFrp = metaList.find((m) => m?.key === '_frp_codigo_pedido')?.value || '';
      const notaCliente = String(o.customer_note || '');
      const esDeRepuestin =
        Boolean(metaCodigoFrp) || /repuest[ií]n/i.test(notaCliente);

      const nombreCliente = [o.billing?.first_name, o.billing?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Cliente Web';

      const items = (Array.isArray(o.line_items) ? o.line_items : []).map((li) => ({
        nombre: li.name || 'Repuesto',
        sku: li.sku || '',
        cantidad: Number(li.quantity) || 1,
        totalConIva: Math.round(Number(li.total || 0) + Number(li.total_tax || 0)),
      }));

      const totalConIva = Math.round(Number(o.total) || 0);
      const totalNeto = Math.round(totalConIva / 1.19);

      return {
        id: String(o.id),
        numeroPedido: String(o.number || o.id),
        fecha: o.date_created_gmt ? new Date(o.date_created_gmt + 'Z').toISOString() : o.date_created || new Date().toISOString(),
        estadoWoo: String(o.status || 'pending'),
        canalOrigen: esDeRepuestin ? 'repuestin_wsp' : 'web_directo',
        codigoPedidoFrp: metaCodigoFrp || null,
        clienteNombre: nombreCliente,
        clienteEmail: o.billing?.email || '',
        clienteTelefono: o.billing?.phone || '',
        comuna: o.shipping?.city || o.billing?.city || 'Santiago',
        metodoPago: o.payment_method_title || o.payment_method || 'Webpay / Transferencia',
        totalNeto,
        totalConIva,
        itemsCount: items.reduce((s, it) => s + it.cantidad, 0),
        items,
      };
    });

    return { configurado: true, pedidos };
  } catch (err) {
    console.warn('[woo-sync] Aviso consultando pedidos recientes de WooCommerce:', err.message);
    return { configurado: true, pedidos: [], error: err.message };
  }
}

/**
 * Construye el resumen del árbol de compatibilidad vehicular (Nivel 1 Marca -> Nivel 2 Modelo -> Nivel 3 Rango Años)
 * a partir del inventario actual en Firestore (alimentado por BigQuery `v_agente_catalogo` y tiendas locales).
 */
export async function obtenerResumenMarcasCompatibilidadInventario(itemsPreCargados = null) {
  let items = itemsPreCargados;
  if (!Array.isArray(items)) {
    const snap = await db.collection('inventario').get();
    items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => !i.ocultarEnTienda);
  }

  const marcasMap = new Map(); // marca -> { nombre, count, modelos: Map<modeloLabel, { nombre, count, rangos: Map<rangoLabel, number> }> }
  let itemsConCompatibilidad = 0;

  for (const item of items) {
    const compat = extraerCompatibilidadesVehiculoDeItem(item);
    if (compat.marcas.length > 0) {
      itemsConCompatibilidad++;
    }

    for (const m of compat.marcas) {
      if (!marcasMap.has(m)) {
        marcasMap.set(m, { nombre: m, count: 0, modelos: new Map() });
      }
      marcasMap.get(m).count += 1;
    }

    for (const mod of compat.modelosJerarquicos) {
      let mEntry = marcasMap.get(mod.marca);
      if (!mEntry) {
        mEntry = { nombre: mod.marca, count: 1, modelos: new Map() };
        marcasMap.set(mod.marca, mEntry);
      }
      let modEntry = mEntry.modelos.get(mod.etiquetaModelo);
      if (!modEntry) {
        modEntry = {
          nombre: mod.etiquetaModelo,
          modeloCorto: mod.modelo,
          count: 0,
          rangos: new Map(),
        };
        mEntry.modelos.set(mod.etiquetaModelo, modEntry);
      }
      modEntry.count += 1;
      if (mod.etiquetaRango) {
        modEntry.rangos.set(
          mod.etiquetaCompleta,
          (modEntry.rangos.get(mod.etiquetaCompleta) || 0) + 1
        );
      }
    }
  }

  let totalModelos = 0;
  let totalRangosAnios = 0;

  const arbolMarcas = Array.from(marcasMap.values())
    .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre))
    .map((m) => {
      const modelos = Array.from(m.modelos.values())
        .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre))
        .map((mod) => {
          totalModelos += 1;
          const rangos = Array.from(mod.rangos.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([etiqueta, count]) => {
              totalRangosAnios += 1;
              return { nombre: etiqueta, count };
            });
          return {
            nombre: mod.nombre,
            modeloCorto: mod.modeloCorto,
            count: mod.count,
            rangos,
          };
        });
      return {
        nombre: m.nombre,
        count: m.count,
        modelos,
      };
    });

  return {
    totalProductosVisibles: items.length,
    productosConCompatibilidad: itemsConCompatibilidad,
    totalMarcasVehiculo: arbolMarcas.length,
    totalModelosVehiculo: totalModelos,
    totalRangosAnios,
    arbolMarcas,
  };
}

/**
 * Sincroniza hacia WooCommerce (`Productos -> Marcas`) la jerarquía completa de 3 niveles:
 *   Nivel 1 (Marca Principal): `SUZUKI`, `JAC`, `TOYOTA`, `CHERY`, `GREAT WALL`, `HAVAL`...
 *   Nivel 2 (Sub-marca Modelo): `JAC S3`, `SUZUKI SWIFT`...
 *   Nivel 3 (Sub-marca Rango de Años): `JAC S3 (2016 - 2023)`...
 * Y opcionalmente actualiza un lote de productos en WooCommerce (o encola todos con `needsWooSync: true`)
 * para dejar asignados `brands` y `attributes` (100% dedicado a compatibilidad vehicular).
 */
export async function sincronizarMarcasCompatibilidadWooCommerce({
  encolarProductos = true,
  sincronizarLoteInmediato = true,
  maxProductosLote = 100,
  maxCreacionesTaxonomia = 180,
} = {}) {
  const snap = await db.collection('inventario').get();
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => !i.ocultarEnTienda);

  const resumen = await obtenerResumenMarcasCompatibilidadInventario(items);
  const configured = isWooConfigured();

  let estadisticasTaxonomia = {
    endpointMarcasDisponible: false,
    marcasExistentesEnWoo: 0,
    marcasNuevasCreadasEnWoo: 0,
    pendientesPorCrearEnWoo: 0,
    totalRutasAseguradas: 0,
  };

  if (configured) {
    const resolver = await prepararMarcasVehiculoWooCommerce(items, {
      maxCreacionesPorPase: Math.max(30, Math.min(350, Number(maxCreacionesTaxonomia) || 180)),
    });
    if (resolver.estadisticas) {
      estadisticasTaxonomia = resolver.estadisticas;
    }
  }

  let encoladosCount = 0;
  if (encolarProductos) {
    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let ops = 0;
    for (const item of items) {
      if (item.needsWooSync === true) continue;
      const compat = extraerCompatibilidadesVehiculoDeItem(item);
      if (compat.marcas.length === 0) continue;
      batch.update(db.collection('inventario').doc(item.id), {
        needsWooSync: true,
        wooSyncMotivo: 'enriquecimiento_compatibilidad_ia',
      });
      ops++;
      encoladosCount++;
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) {
      await batch.commit();
    }
  }

  let resultadoLote = null;
  // Solo sincronizar el lote de productos cuando ya no queden términos pendientes de la jerarquía
  // (o cuando el pase de taxonomía fue liviano), evitando superar el timeout HTTP de un solo request.
  if (sincronizarLoteInmediato && configured && (estadisticasTaxonomia.pendientesPorCrearEnWoo || 0) === 0) {
    resultadoLote = await sincronizarInventarioConWooCommerce({
      soloDelta: true,
      maxItems: Math.max(25, Math.min(250, Number(maxProductosLote) || 100)),
      todosPreCargados: items,
    });
  }

  return {
    modoConexion: configured ? 'woocommerce_rest_live' : 'simulacion_local',
    resumenCatalogo: {
      totalProductosVisibles: resumen.totalProductosVisibles,
      productosConCompatibilidad: resumen.productosConCompatibilidad,
      totalMarcasVehiculo: resumen.totalMarcasVehiculo,
      totalModelosVehiculo: resumen.totalModelosVehiculo,
      totalRangosAnios: resumen.totalRangosAnios,
    },
    taxonomiaMarcasWoo: estadisticasTaxonomia,
    productosEncoladosParaAsignacion: encoladosCount,
    loteSincronizado: resultadoLote
      ? {
          procesados: resultadoLote.procesados,
          actualizados: resultadoLote.actualizados,
          creados: resultadoLote.creados,
          pendientesRestantes: resultadoLote.pendientesRestantes,
        }
      : null,
  };
}

