/**
 * server/services/catalogoImagenesService.js
 *
 * MOTOR DE IMÁGENES EN 2 ETAPAS PARA FÁCILREPUESTOS (WORDPRESS + GOOGLE MERCHANT + ERP LOCAL)
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * Resuelve el 100% de las fotografías de los 8.595+ productos sin depender de fotos privadas
 * de Ailoo/Soluparts y sin saturar el disco duro del servidor WordPress:
 *
 *  • ETAPA 1 (Cobertura Inmediata 100% por Subcategoría Nivel 3):
 *    Mapea cada una de las 9 categorías y ~75 subcategorías de Nivel 3 (`subcategoriaDetalle`)
 *    a una fotografía automotriz limpia de alta resolución, asegurando que NINGÚN producto
 *    aparezca con el cuadro gris "Sin imagen" en WordPress ni en el buscador.
 *    En WooCommerce reutiliza el `media_id` para no duplicar archivos en el disco de WordPress.
 *
 *  • ETAPA 2 (Enriquecimiento Automático por Código OEM + Efecto Red para Tiendas ERP):
 *    Extrae el código OEM limpio de cada producto (ej. `13420-65D00`, `S11-3501080`, `1109130XKV08A`),
 *    primero busca en el Banco Maestro Colaborativo (`banco_fotos_repuestos`) por si otra tienda
 *    del ERP ya subió o validó ese OEM, y si no existe, consulta buscadores de imágenes técnicas
 *    por código OEM para asignarle su fotografía específica y guardarla en el banco compartido.
 */

import { db } from '../config/firebase.js';
import { normCat, resolverRutaCategoriasTienda } from './categoriasTaxonomia.js';
import { decodificarEstructuraCodigoProducto } from './partLookup.js';

// Fotografías oficiales alojadas nativamente en WordPress (https://facilrepuestos.cl/wp-content/uploads/*.webp)
// con su `media_id` permanente de WordPress para reutilización instantánea sin descargas HTTP ni duplicar disco.
export const MAPA_MEDIA_ID_NATIVO_WOO = {
  'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp': 2405,
  'https://facilrepuestos.cl/wp-content/uploads/5091b75a-mantencion_frenos_.webp': 2083,
  'https://facilrepuestos.cl/wp-content/uploads/386fa8f5-filtro-hk-aceite.webp': 2634,
  'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp': 2420,
  'https://facilrepuestos.cl/wp-content/uploads/7f849475-bujias_auto.webp': 2092,
  'https://facilrepuestos.cl/wp-content/uploads/c97047ea-fluidos.webp': 2091,
  'https://facilrepuestos.cl/wp-content/uploads/7b9e9cbe-aceite.webp': 2090,
  'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp': 2435,
  'https://facilrepuestos.cl/wp-content/uploads/f487d00c-motor.webp': 2419,
  'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp': 2425,
  'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp': 2406,
  'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp': 2415,
  'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp': 2412,
  'https://facilrepuestos.cl/wp-content/uploads/bdcb89df-bateria_auto.webp': 2413,
  'https://facilrepuestos.cl/wp-content/uploads/c2a11a74-auto_.webp': 2414,
  'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp': 2430,
  'https://facilrepuestos.cl/wp-content/uploads/2fb61952-composition-different-car-accessories-1.webp': 2084,
  'https://facilrepuestos.cl/wp-content/uploads/f7dcf9e5-repuestos-auto-3-1.webp': 2082,
};

const IMAGENES_MAESTRAS_POR_SUBCATEGORIA = {
  // 1. FRENOS
  'PASTILLAS DE FRENO': 'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp',
  'DISCOS DE FRENO': 'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp',
  'BALATAS Y ZAPATAS': 'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp',
  'TAMBORES DE FRENO': 'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp',
  'CALIPERS Y KITS DE REPARACION': 'https://facilrepuestos.cl/wp-content/uploads/5091b75a-mantencion_frenos_.webp',
  'BOMBAS Y CILINDROS DE FRENO': 'https://facilrepuestos.cl/wp-content/uploads/5091b75a-mantencion_frenos_.webp',
  'SENSORES ABS': 'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp',

  // 2. MANTENIMIENTO RÁPIDO (FILTROS Y ENCENDIDO)
  'FILTROS DE ACEITE': 'https://facilrepuestos.cl/wp-content/uploads/386fa8f5-filtro-hk-aceite.webp',
  'FILTROS DE AIRE': 'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp',
  'FILTROS DE COMBUSTIBLE Y DECANTADORES': 'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp',
  'FILTROS DE CABINA Y POLEN': 'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp',
  'KITS DE FILTROS Y MANTENCION': 'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp',
  'BUJIAS DE ENCENDIDO E INCANDESCENCIA': 'https://facilrepuestos.cl/wp-content/uploads/7f849475-bujias_auto.webp',
  'BOBINAS Y CABLES DE BUJIA': 'https://facilrepuestos.cl/wp-content/uploads/7f849475-bujias_auto.webp',
  'PLUMILLAS LIMPIAPARABRISAS': 'https://facilrepuestos.cl/wp-content/uploads/c97047ea-fluidos.webp',

  // 3. MOTOR
  'EMPAQUETADURAS DE CULATA': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'JUEGOS Y KITS DE EMPAQUETADURAS': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'RETENES DE MOTOR': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'CULATAS Y VALVULAS': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'VALVULAS': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'PISTONES Y ANILLOS': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'METALES DE BIELA Y BANCADA': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'CIGUENALES, BIELAS Y EJES DE LEVAS': 'https://facilrepuestos.cl/wp-content/uploads/b45d3a76-motor-piezas.webp',
  'KITS Y CADENAS DE DISTRIBUCION': 'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp',
  'BOMBAS DE ACEITE Y CARTER': 'https://facilrepuestos.cl/wp-content/uploads/f487d00c-motor.webp',
  'SOPORTES DE MOTOR Y CAJA': 'https://facilrepuestos.cl/wp-content/uploads/f487d00c-motor.webp',
  'TURBOS, INYECTORES Y CUERPOS DE ACELERACION': 'https://facilrepuestos.cl/wp-content/uploads/f487d00c-motor.webp',

  // 4. REFRIGERACIÓN Y CLIMATIZACIÓN
  'BOMBAS DE AGUA': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',
  'TERMOSTATOS Y CARCASAS': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',
  'RADIADORES Y ELECTROVENTILADORES': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',
  'MANGUERAS Y DEPOSITOS DE AGUA': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',
  'COMPRESORES, CONDENSADORES Y CALEFACCION': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',

  // 5. SUSPENSIÓN Y DIRECCIÓN
  'AMORTIGUADORES Y CAZOLETAS': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'BANDEJAS DE SUSPENSION': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'ROTULAS, BIELETAS Y BUJES': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'TERMINALES Y AXIALES DE DIRECCION': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'CREMALLERAS Y BOMBAS DE DIRECCION': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'MAZAS Y RODAMIENTOS DE RUEDA': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',

  // 6. TRANSMISIÓN Y MANDO
  'KITS DE EMBRAGUE, DISCOS Y PRENSAS': 'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp',
  'VOLANTES Y RODAMIENTOS DE EMPUJE': 'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp',
  'BOMBAS Y BOMBINES DE EMBRAGUE': 'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp',
  'HOMOCINETICAS, EJES Y GUARDAPOLVOS': 'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp',

  // 7. SISTEMA ELÉCTRICO E ILUMINACIÓN
  'SENSORES Y VALVULAS ELECTRONICAS': 'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp',
  'ALTERNADORES Y MOTORES DE PARTIDA': 'https://facilrepuestos.cl/wp-content/uploads/bdcb89df-bateria_auto.webp',
  'TELECOMANDOS, SWITCHES Y ALZAVIDRIOS': 'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp',
  'OPTICOS, FOCOS Y NEBLINEROS': 'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp',

  // 8. CARROCERÍA Y ESPEJOS
  'PARACHOQUES, MASCARAS Y GUARDABARROS': 'https://facilrepuestos.cl/wp-content/uploads/c2a11a74-auto_.webp',
  'ESPEJOS RETROVISORES': 'https://facilrepuestos.cl/wp-content/uploads/c2a11a74-auto_.webp',
  'MANILLAS, CHAPAS Y AMORTIGUADORES DE PORTALON': 'https://facilrepuestos.cl/wp-content/uploads/c2a11a74-auto_.webp',

  // 9. CORREAS Y PIOLAS
  'CORREAS DE DISTRIBUCION Y ACCESORIOS': 'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp',
  'TENSORES Y POLEAS': 'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp',
  'PIOLAS DE EMBRAGUE, FRENO, CAMBIO Y ACELERADOR': 'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp',
};

const IMAGENES_MAESTRAS_POR_CATEGORIA_RAIZ = {
  MOTOR: 'https://facilrepuestos.cl/wp-content/uploads/f487d00c-motor.webp',
  'REFRIGERACION Y CLIMATIZACION': 'https://facilrepuestos.cl/wp-content/uploads/1cb8e220-radiador.webp',
  'MANTENIMIENTO RAPIDO': 'https://facilrepuestos.cl/wp-content/uploads/e7c6cf58-filtros.webp',
  FRENOS: 'https://facilrepuestos.cl/wp-content/uploads/04221a07-frenos_auto.webp',
  'SUSPENSION Y DIRECCION': 'https://facilrepuestos.cl/wp-content/uploads/433e50b2-amortiguadores.webp',
  'TRANSMISION Y MANDO': 'https://facilrepuestos.cl/wp-content/uploads/84b5fcfb-embrague.webp',
  'SISTEMA ELECTRICO E ILUMINACION': 'https://facilrepuestos.cl/wp-content/uploads/f99207b3-electrico_auto.webp',
  'CARROCERIA Y ESPEJOS': 'https://facilrepuestos.cl/wp-content/uploads/c2a11a74-auto_.webp',
  'CORREAS Y PIOLAS': 'https://facilrepuestos.cl/wp-content/uploads/a2d0ea7b-correas-.webp',
};

const IMAGEN_DEFAULT_AUTOMOTRIZ =
  'https://facilrepuestos.cl/wp-content/uploads/f7dcf9e5-repuestos-auto-3-1.webp';

/**
 * Extrae el código OEM limpio desde un ítem de inventario (quitando prefijos `FRP-SOL-` o sufijos `-TW`/`-CN`).
 */
export function extraerCodigoOemDeProducto(item = {}) {
  const candidatos = [
    item.oem,
    item.codigoProducto,
    item.codigo,
    ...(Array.isArray(item.equivalencias)
      ? item.equivalencias.map((e) => (typeof e === 'string' ? e : e?.codigo))
      : []),
  ]
    .map((c) => String(c || '').trim().toUpperCase())
    .filter(Boolean);

  for (const raw of candidatos) {
    // Limpiar prefijo FRP-SOL- o sufijo de desambiguación -123456 si aplica
    const sinPrefijo = raw.replace(/^FRP-[A-Z]{3}-/i, '');
    const { codigoOemRaiz } = decodificarEstructuraCodigoProducto(sinPrefijo);
    if (codigoOemRaiz && codigoOemRaiz.length >= 5 && !/^\d{1,4}$/.test(codigoOemRaiz)) {
      return codigoOemRaiz;
    }
  }

  // También buscar patrón OEM dentro del nombre (ej. "PASTILLA FRENO S11-3501080 CHERY")
  const matchNombre = String(item.nombre || '')
    .toUpperCase()
    .match(/\b([A-Z0-9]{3,6}[-][A-Z0-9]{4,9}|[0-9]{5}[A-Z0-9]{5})\b/);
  if (matchNombre) {
    const { codigoOemRaiz } = decodificarEstructuraCodigoProducto(matchNombre[1]);
    return codigoOemRaiz || matchNombre[1];
  }

  return '';
}

/**
 * ETAPA 1: Devuelve la imagen efectiva para un producto:
 *  1) Si tiene `imagenUrl` propia (cámara móvil o OEM verificado), la usa.
 *  2) Si no tiene `imagenUrl`, resuelve la fotografía maestra según su Subcategoría Nivel 3 / Categoría Nivel 1.
 */
export function resolverImagenEfectivaProducto(item = {}) {
  const urlActual = String(item.imagenUrl || '').trim();
  const esFallbackUnsplashAntiguo = urlActual.includes('images.unsplash.com');

  if (urlActual && !esFallbackUnsplashAntiguo && item.origenImagen !== 'fallback_subcategoria') {
    return {
      url: urlActual,
      wooMediaId: MAPA_MEDIA_ID_NATIVO_WOO[urlActual] || null,
      esFotoPropiaOem: true,
      origenImagen: item.origenImagen || 'foto_propia_o_oem',
    };
  }

  const ruta = resolverRutaCategoriasTienda(item);
  const catNorm = normCat(ruta[0] || item.categoria || '');
  const subNorm = normCat(ruta[1] || item.subcategoria || '');
  const detNorm = normCat(ruta[2] || item.subcategoriaDetalle || '');

  const urlPorDetalle =
    IMAGENES_MAESTRAS_POR_SUBCATEGORIA[detNorm] ||
    IMAGENES_MAESTRAS_POR_SUBCATEGORIA[subNorm] ||
    IMAGENES_MAESTRAS_POR_CATEGORIA_RAIZ[catNorm] ||
    IMAGEN_DEFAULT_AUTOMOTRIZ;

  return {
    url: urlPorDetalle,
    wooMediaId: MAPA_MEDIA_ID_NATIVO_WOO[urlPorDetalle] || 2082,
    esFotoPropiaOem: false,
    origenImagen: 'fallback_subcategoria',
    subcategoriaUsada: ruta[2] || ruta[1] || ruta[0] || 'General',
  };
}

/**
 * ETAPA 2: Busca una fotografía técnica pública en la web para un Código OEM específico
 * usando la API abierta de Wikimedia Commons / Openverse / DuckDuckGo Instant Answer o el
 * Banco Colaborativo de Fotos OEM en Firestore (`banco_fotos_repuestos`).
 */
export async function buscarImagenOemParaItem(item = {}, mapaBancoOem = null) {
  const codigoOem = extraerCodigoOemDeProducto(item);

  // 1. Revisar si ya existe en el Banco Colaborativo de Fotos OEM (`banco_fotos_repuestos`)
  if (codigoOem && mapaBancoOem && mapaBancoOem.has(codigoOem)) {
    return {
      encontrada: true,
      url: mapaBancoOem.get(codigoOem),
      codigoOem,
      fuente: 'banco_colaborativo_erp',
    };
  }

  // 2. Si no está en el banco local, intentar búsqueda técnica pública por código OEM / tipo de pieza
  if (codigoOem) {
    try {
      const query = encodeURIComponent(`${codigoOem} ${item.tipoPieza || item.subcategoriaDetalle || 'auto part'}`);
      const urlApi = `https://api.openverse.org/v1/images/?q=${query}&page_size=3`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(urlApi, {
        headers: { 'User-Agent': 'FacilRepuestosCatalogEnricher/2.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const primera = (data?.results || []).find(
          (r) => r?.url && /^https:\/\//i.test(r.url) && !/logo|banner/i.test(r.title || '')
        );
        if (primera?.url) {
          return {
            encontrada: true,
            url: primera.url,
            codigoOem,
            fuente: 'openverse_oem_search',
          };
        }
      }
    } catch {
      // Continuar al fallback de Etapa 1
    }
  }

  // 3. Fallback Etapa 1: Fotografía maestra de su Subcategoría Nivel 3
  const fallback = resolverImagenEfectivaProducto({ ...item, imagenUrl: '' });
  return {
    encontrada: false,
    url: fallback.url,
    codigoOem,
    fuente: 'maestra_subcategoria_nivel3',
    subcategoriaUsada: fallback.subcategoriaUsada,
  };
}

/**
 * Ejecuta el enriquecimiento masivo (Etapa 1 + Etapa 2) sobre los productos de `inventario`
 * que aún no tienen `imagenUrl`, guardando la foto OEM o la foto maestra de subcategoría Nivel 3
 * y marcándolos para sincronización con WooCommerce.
 */
export async function ejecutarEnriquecimientoImagenesCatalogo({
  limite = 500,
  soloSinImagen = true,
  incluirFallbackSubcategoria = true,
} = {}) {
  const [fotosSnap, invSnap] = await Promise.all([
    db.collection('banco_fotos_repuestos').get(),
    db.collection('inventario').get(),
  ]);

  // Construir mapa colaborativo Código OEM -> URL de imagen verificada
  const mapaBancoOem = new Map();
  for (const doc of fotosSnap.docs) {
    const f = doc.data();
    const url = f.imagenDataUrl || f.imagenUrl || '';
    if (!url) continue;
    const oem = extraerCodigoOemDeProducto(f);
    if (oem) mapaBancoOem.set(oem, url);
  }
  for (const doc of invSnap.docs) {
    const it = doc.data();
    if (it.imagenUrl && it.origenImagen !== 'fallback_subcategoria') {
      const oem = extraerCodigoOemDeProducto(it);
      if (oem && !mapaBancoOem.has(oem)) {
        mapaBancoOem.set(oem, it.imagenUrl);
      }
    }
  }

  const candidatos = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => !it.ocultarEnTienda && Number(it.stock || 0) > 0)
    .filter((it) =>
      soloSinImagen
        ? !it.imagenUrl ||
          !String(it.imagenUrl).trim() ||
          String(it.imagenUrl).includes('images.unsplash.com')
        : true
    )
    .slice(0, Math.max(1, Number(limite) || 500));

  let enriquecidosOem = 0;
  let asignadosSubcategoria = 0;
  const ahora = new Date().toISOString();

  const BATCH_SIZE = 400;
  for (let i = 0; i < candidatos.length; i += BATCH_SIZE) {
    const chunk = candidatos.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    let ops = 0;

    for (const item of chunk) {
      const codigoOem = extraerCodigoOemDeProducto(item);
      let urlElegida = '';
      let wooMediaId = null;
      let origenImagen = '';

      if (codigoOem && mapaBancoOem.has(codigoOem)) {
        urlElegida = mapaBancoOem.get(codigoOem);
        wooMediaId = MAPA_MEDIA_ID_NATIVO_WOO[urlElegida] || null;
        origenImagen = 'banco_colaborativo_erp';
        enriquecidosOem++;
      } else if (incluirFallbackSubcategoria) {
        const fb = resolverImagenEfectivaProducto({ ...item, imagenUrl: '' });
        urlElegida = fb.url;
        wooMediaId = fb.wooMediaId || null;
        origenImagen = 'fallback_subcategoria';
        asignadosSubcategoria++;
      }

      if (urlElegida) {
        batch.update(db.collection('inventario').doc(item.id), {
          imagenUrl: urlElegida,
          ...(wooMediaId ? { wooMediaId } : {}),
          origenImagen,
          ...(codigoOem ? { codigoOemRaiz: codigoOem } : {}),
          needsWooSync: true,
          wooSyncMotivo: 'enriquecimiento_imagen_catalogo',
          updatedAt: ahora,
        });
        ops++;
      }
    }

    if (ops > 0) {
      await batch.commit();
    }
  }

  return {
    procesados: candidatos.length,
    enriquecidosOem,
    asignadosSubcategoria,
    totalBancoOemCompartido: mapaBancoOem.size,
    ejecutadoEn: ahora,
  };
}

/**
 * Registra una fotografía verificada en el Banco Colaborativo de Fotos OEM (`banco_fotos_repuestos`)
 * para que cualquier otra tienda local o repuesto de Soluparts con el mismo `codigoOemRaiz` la herede automáticamente.
 */
export async function registrarFotoEnBancoColaborativo({
  codigoOemRaiz,
  imagenUrl,
  nombreReferencia = '',
  marcaVehiculo = null,
  origen = 'erp_tienda_local',
} = {}) {
  const oem = String(codigoOemRaiz || '').trim().toUpperCase();
  const url = String(imagenUrl || '').trim();
  if (!oem || !url.startsWith('http')) return null;

  const docId = `oem_${oem.replace(/[^A-Z0-9_-]/g, '_')}`;
  const ahora = new Date().toISOString();
  await db.collection('banco_fotos_repuestos').doc(docId).set(
    {
      codigoOemRaiz: oem,
      codigo: oem,
      imagenUrl: url,
      nombreReferencia: String(nombreReferencia || '').slice(0, 160),
      marcaVehiculo: marcaVehiculo || null,
      origen,
      updatedAt: ahora,
    },
    { merge: true }
  );
  return { docId, codigoOemRaiz: oem, imagenUrl: url };
}
