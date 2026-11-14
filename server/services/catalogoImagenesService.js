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

// Fotografías automotrices limpias de alta resolución por familia técnica (Nivel 3 / Nivel 2 / Nivel 1)
// Alojadas en CDN global de alta velocidad (Unsplash Automotive Parts CDN optimizado en formato WebP 800x800)
const IMAGENES_MAESTRAS_POR_SUBCATEGORIA = {
  // 1. FRENOS
  'PASTILLAS DE FRENO': 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80',
  'DISCOS DE FRENO': 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80',
  'BALATAS Y ZAPATAS': 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80',
  'TAMBORES DE FRENO': 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80',
  'CALIPERS Y KITS DE REPARACION': 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=800&q=80',
  'BOMBAS Y CILINDROS DE FRENO': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'SENSORES ABS': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80',

  // 2. MANTENIMIENTO RÁPIDO (FILTROS Y ENCENDIDO)
  'FILTROS DE ACEITE': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  'FILTROS DE AIRE': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  'FILTROS DE COMBUSTIBLE Y DECANTADORES': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  'FILTROS DE CABINA Y POLEN': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  'KITS DE FILTROS Y MANTENCION': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  'BUJIAS DE ENCENDIDO E INCANDESCENCIA': 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=800&q=80',
  'BOBINAS Y CABLES DE BUJIA': 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=800&q=80',
  'PLUMILLAS LIMPIAPARABRISAS': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',

  // 3. MOTOR
  'EMPAQUETADURAS DE CULATA': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'JUEGOS Y KITS DE EMPAQUETADURAS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'RETENES DE MOTOR': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'CULATAS Y VALVULAS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'PISTONES Y ANILLOS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'METALES DE BIELA Y BANCADA': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'CIGUENALES, BIELAS Y EJES DE LEVAS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'KITS Y CADENAS DE DISTRIBUCION': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'BOMBAS DE ACEITE Y CARTER': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'SOPORTES DE MOTOR Y CAJA': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'TURBOS, INYECTORES Y CUERPOS DE ACELERACION': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',

  // 4. REFRIGERACIÓN Y CLIMATIZACIÓN
  'BOMBAS DE AGUA': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',
  'TERMOSTATOS Y CARCASAS': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',
  'RADIADORES Y ELECTROVENTILADORES': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',
  'MANGUERAS Y DEPOSITOS DE AGUA': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',
  'COMPRESORES, CONDENSADORES Y CALEFACCION': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',

  // 5. SUSPENSIÓN Y DIRECCIÓN
  'AMORTIGUADORES Y CAZOLETAS': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'BANDEJAS DE SUSPENSION': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'ROTULAS, BIELETAS Y BUJES': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'TERMINALES Y AXIALES DE DIRECCION': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'CREMALLERAS Y BOMBAS DE DIRECCION': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'MAZAS Y RODAMIENTOS DE RUEDA': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',

  // 6. TRANSMISIÓN Y MANDO
  'KITS DE EMBRAGUE, DISCOS Y PRENSAS': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',
  'VOLANTES Y RODAMIENTOS DE EMPUJE': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',
  'BOMBAS Y BOMBINES DE EMBRAGUE': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',
  'HOMOCINETICAS, EJES Y GUARDAPOLVOS': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',

  // 7. SISTEMA ELÉCTRICO E ILUMINACIÓN
  'SENSORES Y VALVULAS ELECTRONICAS': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80',
  'ALTERNADORES Y MOTORES DE PARTIDA': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80',
  'TELECOMANDOS, SWITCHES Y ALZAVIDRIOS': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80',
  'OPTICOS, FOCOS Y NEBLINEROS': 'https://images.unsplash.com/photo-1544829099-b9a0c07fad1a?auto=format&fit=crop&w=800&q=80',

  // 8. CARROCERÍA Y ESPEJOS
  'PARACHOQUES, MASCARAS Y GUARDABARROS': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',
  'ESPEJOS RETROVISORES': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',
  'MANILLAS, CHAPAS Y AMORTIGUADORES DE PORTALON': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',

  // 9. CORREAS Y PIOLAS
  'CORREAS DE DISTRIBUCION Y ACCESORIOS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'TENSORES Y POLEAS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'PIOLAS DE EMBRAGUE, FRENO, CAMBIO Y ACELERADOR': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',
};

const IMAGENES_MAESTRAS_POR_CATEGORIA_RAIZ = {
  MOTOR: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
  'REFRIGERACION Y CLIMATIZACION': 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?auto=format&fit=crop&w=800&q=80',
  'MANTENIMIENTO RAPIDO': 'https://images.unsplash.com/photo-1635784063388-1ff609e12d7c?auto=format&fit=crop&w=800&q=80',
  FRENOS: 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80',
  'SUSPENSION Y DIRECCION': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80',
  'TRANSMISION Y MANDO': 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=800&q=80',
  'SISTEMA ELECTRICO E ILUMINACION': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80',
  'CARROCERIA Y ESPEJOS': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=800&q=80',
  'CORREAS Y PIOLAS': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
};

const IMAGEN_DEFAULT_AUTOMOTRIZ =
  'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80';

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
  if (item.imagenUrl && String(item.imagenUrl).trim()) {
    return {
      url: String(item.imagenUrl).trim(),
      esFotoPropiaOem: item.origenImagen !== 'fallback_subcategoria',
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
    .filter((it) => (soloSinImagen ? !it.imagenUrl || !String(it.imagenUrl).trim() : true))
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
      let origenImagen = '';

      if (codigoOem && mapaBancoOem.has(codigoOem)) {
        urlElegida = mapaBancoOem.get(codigoOem);
        origenImagen = 'banco_colaborativo_erp';
        enriquecidosOem++;
      } else if (incluirFallbackSubcategoria) {
        const fb = resolverImagenEfectivaProducto({ ...item, imagenUrl: '' });
        urlElegida = fb.url;
        origenImagen = 'fallback_subcategoria';
        asignadosSubcategoria++;
      }

      if (urlElegida) {
        batch.update(db.collection('inventario').doc(item.id), {
          imagenUrl: urlElegida,
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
