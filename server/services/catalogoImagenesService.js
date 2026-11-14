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
 * Analiza un producto y detecta si posee un Código OEM de fábrica explícito (en el SKU o en el nombre)
 * o un Código Técnico de Motor (`4G15`, `4G16`, `4Y 491Q`, `4JB1`, `4D56`, etc.), diferenciándolo
 * de los correlativos internos de estantería de Soluparts (`OPT-147`, `DIS-FRE-002`, etc.).
 */
export function extraerMetadataOemDeProducto(item = {}) {
  const nom = String(item.nombre || '').trim();
  const codRaw = String(item.codigo || item.codigoProducto || '')
    .trim()
    .replace(/^FRP-[A-Z]{3}-/i, '');
  const codBase = codRaw.replace(/^([A-Z]{2,4}-[A-Z0-9]{2,4}-\d{2,4}[A-Z]?)-\d{3,6}$/i, '$1');

  const esCorrelativoSoluparts =
    /^[A-Z]{2,4}-[A-Z0-9]{2,4}-\d{2,4}[A-Z]?$/i.test(codBase) ||
    /^[A-Z]{3}-\d{2,4}[A-Z]?$/i.test(codBase) ||
    /^SOL-\d+$/i.test(codBase);

  // 1) Código OEM explícito dentro del nombre: ej. "(CODIGO 01652264)", "COD 1010320FD060", "F01R00Y113"
  const mOemExplicito =
    nom.match(/(?:CODIGO|COD\.?|OEM)\s*[:#]?\s*([A-Z0-9/-]{4,22})/i) ||
    nom.match(/\b([A-Z0-9]{4,8}-[0-9]{5,8}[A-Z0-9]*|F01R[A-Z0-9]+|0261[0-9]{6}|0280[0-9]{6}|[0-9]{7,12})\b/i);

  // 2) Código de Motor explícito dentro del nombre: ej. "4G15", "4G16", "4Y", "491Q", "4JB1", "4D56"
  const mMotor = nom.match(
    /\b(4G\d{2}[A-Z0-9]*|4Y|491Q|4JB1|4D56|GW4D20|GW4G15|JL47\d\w*|SQR\d+\w*|LJ4\d+\w*|DK12|DK15|DAM15\w*)\b/i
  );

  // Limpiar tipo de pieza base (antes de "para ...")
  const piezaLimpia = nom
    .split(/\bpara\b/i)[0]
    .replace(/\(BODEGAZO\)/gi, '')
    .replace(/\((?:CODIGO|COD\.?|OEM)[^)]*\)/gi, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(STANDARD|STD|COMPLETO|COMPLETA|POR PAR|UNIDAD|DELANTERO|DELANTERA|TRASERO|TRASERA|IZQUIERDO|IZQUIERDA|DERECHO|DERECHA|LH|RH)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const palabrasPieza = piezaLimpia.split(' ').filter(Boolean).slice(0, 3).join(' ').toUpperCase();

  if (mOemExplicito) {
    const oem = String(mOemExplicito[1] || mOemExplicito[0])
      .replace(/^[-/]+|[-/]+$/g, '')
      .toUpperCase();
    return {
      tieneOemReal: true,
      tipoCodigo: 'oem_explicito_en_nombre',
      codigoOemRaiz: oem,
      claveGrupo: oem.length >= 6 ? `OEM::${oem}` : `PIEZA_OEM::${palabrasPieza}::${oem}`,
      queryBusquedaWeb: `${palabrasPieza} ${oem} auto part`,
    };
  }

  if (!esCorrelativoSoluparts && codBase.length >= 4) {
    const { codigoOemRaiz } = decodificarEstructuraCodigoProducto(codBase);
    const oem = (codigoOemRaiz || codBase).toUpperCase();
    return {
      tieneOemReal: true,
      tipoCodigo: 'sku_fabrica_directo',
      codigoOemRaiz: oem,
      claveGrupo: `OEM::${oem}`,
      queryBusquedaWeb: `${palabrasPieza} ${oem} auto part`,
    };
  }

  if (mMotor) {
    const motor = String(mMotor[1] || mMotor[0]).toUpperCase();
    const piezaSinMotor = palabrasPieza.replace(new RegExp(`\\b${motor}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
    return {
      tieneOemReal: true,
      tipoCodigo: 'codigo_motor_explicito',
      codigoOemRaiz: `${piezaSinMotor.replace(/\s+/g, '-')}-${motor}`,
      claveGrupo: `MOTOR::${piezaSinMotor}::${motor}`,
      queryBusquedaWeb: `${piezaSinMotor} ${motor} engine part`,
    };
  }

  return {
    tieneOemReal: false,
    tipoCodigo: 'correlativo_interno_soluparts',
    codigoOemRaiz: codBase.toUpperCase(),
    claveGrupo: null,
    queryBusquedaWeb: null,
  };
}

/**
 * Extrae el código OEM limpio desde un ítem de inventario (quitando prefijos `FRP-SOL-` o sufijos `-TW`/`-CN`).
 */
export function extraerCodigoOemDeProducto(item = {}) {
  const meta = extraerMetadataOemDeProducto(item);
  if (meta.codigoOemRaiz) return meta.codigoOemRaiz;

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
    const sinPrefijo = raw.replace(/^FRP-[A-Z]{3}-/i, '');
    const { codigoOemRaiz } = decodificarEstructuraCodigoProducto(sinPrefijo);
    if (codigoOemRaiz && codigoOemRaiz.length >= 5 && !/^\d{1,4}$/.test(codigoOemRaiz)) {
      return codigoOemRaiz;
    }
  }

  return '';
}

/**
 * Busca en la web pública una fotografía limpia (`.jpg` / `.png` / `.webp`) para un código OEM o pieza+motor,
 * verificando que responda HTTP 200 y sea compatible con la subida de medios de WordPress/WooCommerce.
 */
export async function buscarImagenOemWebPorConsulta(queryTexto) {
  if (!queryTexto) return null;
  try {
    const q = encodeURIComponent(queryTexto);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://www.bing.com/images/search?q=${q}&form=HDRSC2&first=1`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();
    const candidatos = [
      ...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&?]+?\.(?:jpg|jpeg|png|webp))&quot;/gi),
    ]
      .map((m) => m[1])
      .filter(
        (u) =>
          !/logo|banner|icon|avatar|placeholder|diagram|schema|manual/i.test(u) &&
          u.length < 220
      );

    // Verificar los primeros 5 candidatos con una petición rápida para asegurar que el servidor origen no bloquee descarga
    for (const url of candidatos.slice(0, 6)) {
      try {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 3000);
        const check = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'WordPress/6.6; https://facilrepuestos.cl' },
          signal: c2.signal,
        });
        clearTimeout(t2);
        const ct = String(check.headers.get('content-type') || '').toLowerCase();
        if (check.ok && ct.startsWith('image/')) {
          return url;
        }
      } catch {
        // Probar siguiente candidato
      }
    }
  } catch {
    // Ignorar error de red puntual
  }
  return null;
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
  const meta = extraerMetadataOemDeProducto(item);
  const codigoOem = meta.codigoOemRaiz || extraerCodigoOemDeProducto(item);

  // 1. Revisar si ya existe en el Banco Colaborativo de Fotos OEM (`banco_fotos_repuestos`)
  if (codigoOem && mapaBancoOem && mapaBancoOem.has(codigoOem)) {
    return {
      encontrada: true,
      url: mapaBancoOem.get(codigoOem),
      codigoOem,
      fuente: 'banco_colaborativo_erp',
    };
  }

  // 2. Si tiene OEM explícito o código técnico de motor, buscar su fotografía técnica en catálogos web públicos
  if (meta.tieneOemReal && meta.queryBusquedaWeb) {
    const urlWeb = await buscarImagenOemWebPorConsulta(meta.queryBusquedaWeb);
    if (urlWeb) {
      return {
        encontrada: true,
        url: urlWeb,
        codigoOem,
        fuente: 'busqueda_web_oem_automatica',
      };
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
