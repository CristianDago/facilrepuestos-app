import { db } from '../config/firebase.js';
import { generarSkuPublicoFrp } from './ailooBridge.js';
import {
  ARBOL_CATEGORIAS_TIENDA,
  normCat,
  resolverRutaCategoriasTienda,
} from './categoriasTaxonomia.js';

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

// Trae TODOS los productos existentes (id, sku, y si ya tienen alguna imagen) para saber
// cuáles crear vs actualizar, y a cuáles se les puede agregar la foto sin pisar una que ya tengan.
async function obtenerProductosExistentes() {
  const mapa = new Map(); // sku -> { id, tieneImagen }
  let page = 1;
  while (true) {
    const productos = await wcFetch(`/products?per_page=100&page=${page}&_fields=id,sku,images`);
    if (!productos.length) break;
    for (const p of productos) {
      if (p.sku) {
        mapa.set(String(p.sku).trim().toUpperCase(), {
          id: p.id,
          tieneImagen: (p.images || []).length > 0,
        });
      }
    }
    if (productos.length < 100) break;
    page++;
  }
  return mapa;
}

// Trae/crea categorías jerárquicas de WooCommerce (respetando padre -> hijo -> nieto)
// únicamente dentro del árbol oficial de 9 categorías y devuelve una función `resolverIdsParaItem(item)`
// que entrega `[{ id }, ...]`.
async function prepararCategoriasWooCommerce(items = []) {
  const existentes = [];
  let page = 1;
  while (true) {
    const lote = await wcFetch(`/products/categories?per_page=100&page=${page}`);
    if (!Array.isArray(lote) || !lote.length) break;
    existentes.push(...lote);
    if (lote.length < 100) break;
    page++;
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
function construirPayload(id, item, obtenerCategoriasItem, esNuevo, puedeAgregarImagen) {
  const disponible = Math.max(0, Math.floor((item.stock || 0) - (item.stockReservado || 0)));
  const rutaCategorias = resolverRutaCategoriasTienda(item);
  const rutaTexto = rutaCategorias.join(' > ');
  const categories = typeof obtenerCategoriasItem === 'function' ? obtenerCategoriasItem(item) : [];

  const payload = {
    name: item.nombre,
    sku: skuDeItem(id, item),
    regular_price: String(item.precioVenta || 0),
    manage_stock: true,
    stock_quantity: disponible,
    stock_status: disponible > 0 ? 'instock' : 'outofstock',
    categories,
    meta_data: [
      { key: '_drmotors_inventario_id', value: id },
      { key: '_frp_origen_datos', value: String(item.origenDatos || 'proveedor_local') },
      { key: '_frp_proveedor_id', value: String(item.proveedorId || 'local') },
      { key: '_frp_categoria_jerarquia', value: rutaTexto },
      { key: '_frp_categoria_ruta', value: rutaTexto },
    ],
  };

  if (esNuevo || item.wooSyncMotivo === 'enriquecimiento_compatibilidad_ia') {
    payload.description = descripcionDeItem(item);
  }

  if (puedeAgregarImagen && item.imagenUrl) {
    payload.images = [{ src: item.imagenUrl }];
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
    const isPendiente = item.needsWooSync === true || !i.lastWooSyncAt;
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
export async function sincronizarInventarioConWooCommerce({ soloDelta = true, maxItems = 0 } = {}) {
  const configured = isWooConfigured();
  const snap = await db.collection('inventario').get();
  const todos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
  const existentes            = await obtenerProductosExistentes();

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
    const payload = construirPayload(item.id, item, obtenerCategoriasItem, esNuevo, puedeAgregarImagen);
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

  for (let i = 0; i < crear.length; i += CHUNK) {
    const lote = crear.slice(i, i + CHUNK);
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
    const lote = actualizar.slice(i, i + CHUNK);
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
}) {
  const linksCarro = construirLinksCarroWooCommerce(items);
  const conWooId = (Array.isArray(items) ? items : []).filter((it) => Number(it?.wooProductId) > 0);

  if (!isWooConfigured() || conWooId.length === 0) {
    return {
      creadoEnWoo: false,
      wooOrderId: null,
      wooOrderKey: null,
      urlPagoCheckoutWoo: linksCarro.urlCarroPrincipal,
      urlAgregarAlCarroWoo: linksCarro.urlCarroPrincipal,
      enlacesPorItem: linksCarro.enlacesPorItem,
    };
  }

  try {
    const nombreCompleto = String(datosCliente?.nombre || 'Cliente FácilRepuestos').trim();
    const partesNombre = nombreCompleto.split(/\s+/);
    const firstName = partesNombre[0] || 'Cliente';
    const lastName = partesNombre.slice(1).join(' ') || 'FácilRepuestos';
    const direccion =
      modalidadEntrega === 'retiro_bodega'
        ? 'Retiro en Sucursal FácilRepuestos (Enrique Olivares 224, La Florida)'
        : String(comunaEntrega || 'Santiago');

    const payload = {
      status: 'pending',
      customer_note: [
        `Pedido generado por Repuestín (${codigoPedidoFrp})`,
        documentoTributario ? `Documento: ${documentoTributario}` : '',
        datosCliente?.rut ? `RUT: ${datosCliente.rut}` : '',
        vehiculo?.patente ? `Patente: ${vehiculo.patente} (${vehiculo.marca || ''} ${vehiculo.modelo || ''})` : '',
      ]
        .filter(Boolean)
        .join(' | '),
      billing: {
        first_name: firstName,
        last_name: lastName,
        address_1: direccion,
        city: comunaEntrega || 'Santiago',
        state: 'RM',
        country: 'CL',
        email: datosCliente?.email || 'ventas@facilrepuestos.cl',
        phone: String(clienteTelefono || '').replace(/[^\d+]/g, '') || '+56900000000',
      },
      shipping: {
        first_name: firstName,
        last_name: lastName,
        address_1: direccion,
        city: comunaEntrega || 'Santiago',
        state: 'RM',
        country: 'CL',
      },
      line_items: conWooId.map((it) => ({
        product_id: Number(it.wooProductId),
        quantity: Math.max(1, Number(it.cantidad || 1)),
      })),
      meta_data: [
        { key: '_frp_codigo_pedido', value: String(codigoPedidoFrp || '') },
        { key: '_frp_rut_cliente', value: String(datosCliente?.rut || '') },
        { key: '_frp_documento_tributario', value: String(documentoTributario || 'BOLETA') },
        { key: '_frp_modalidad_entrega', value: String(modalidadEntrega || 'retiro_bodega') },
        { key: '_frp_patente_vehiculo', value: String(vehiculo?.patente || '') },
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
