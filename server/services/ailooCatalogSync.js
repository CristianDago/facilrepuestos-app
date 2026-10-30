import crypto from 'crypto';
import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import { calcularPrecioPublicoFrp, generarSkuPublicoFrp } from './ailooBridge.js';

/**
 * Catálogos semilla representativos de la vista `v_agente_catalogo` de cada nodo Ailoo
 * (`soluparts_ailoo.v_agente_catalogo` y `global_ailoo.v_agente_catalogo`) cuando no se
 * encuentra activo `AILOO_BQ_LIVE=true`.
 */
const CATALOGO_SEMILLA_NODOS = {
  soluparts: [
    {
      id_ailoo: 94821,
      codigo: 'SOL-94821',
      oem: '1611284080',
      nombre: 'KIT DISTRIBUCIÓN PEUGEOT 208 / CITROËN C3 1.2 PURETECH (CORREA HÚMEDA DAYCO)',
      categoria: 'MOTOR',
      tipo_pieza: 'KIT DE DISTRIBUCION',
      marca_repuesto: 'DAYCO',
      origen_pais: 'ITALIA',
      marcas_compatibles: ['PEUGEOT', 'CITROËN'],
      modelos_por_marca: {
        PEUGEOT: ['208', '2008'],
        'CITROËN': ['C3'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 9,
      costo_neto: 78990,
      ubicacion_bodega: 'Bodega Central Soluparts - Pasillo B4',
    },
    {
      id_ailoo: 88310,
      codigo: 'SOL-88310',
      oem: '04465-0K380',
      nombre: 'PASTILLAS DE FRENO DELANTERAS CERÁMICAS TOYOTA HILUX 2.4 / 2.8 REVO (ADVICS)',
      categoria: 'FRENOS',
      tipo_pieza: 'PASTILLAS DE FRENO',
      posicion: 'DELANTERA',
      marca_repuesto: 'ADVICS',
      origen_pais: 'JAPÓN',
      marcas_compatibles: ['TOYOTA'],
      modelos_por_marca: {
        TOYOTA: ['HILUX', 'FORTUNER'],
      },
      anio_desde: 2016,
      anio_hasta: 2024,
      stock_disponible: 14,
      costo_neto: 42500,
      ubicacion_bodega: 'Bodega Central Soluparts - Pasillo A1',
    },
    {
      id_ailoo: 77412,
      codigo: 'SOL-77412',
      oem: 'MN187235',
      nombre: 'KIT EMBRAGUE EXEDY 240MM MITSUBISHI L200 KATANA 2.4 DID (4N15)',
      categoria: 'TRANSMISIÓN',
      tipo_pieza: 'KIT DE EMBRAGUE',
      marca_repuesto: 'EXEDY',
      origen_pais: 'JAPÓN',
      marcas_compatibles: ['MITSUBISHI', 'FIAT'],
      modelos_por_marca: {
        MITSUBISHI: ['L200'],
        FIAT: ['FULLBACK'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 5,
      costo_neto: 185000,
      ubicacion_bodega: 'Bodega Central Soluparts - Pasillo C2',
    },
    {
      id_ailoo: 61209,
      codigo: 'SOL-61209',
      oem: '15208-65F0A',
      nombre: 'FILTRO DE ACEITE ORIGINAL NISSAN NP300 NAVARA 2.3 DCI / QASHQAI',
      categoria: 'FILTROS',
      tipo_pieza: 'FILTRO DE ACEITE',
      marca_repuesto: 'MANN-FILTER',
      origen_pais: 'ALEMANIA',
      marcas_compatibles: ['NISSAN', 'RENAULT'],
      modelos_por_marca: {
        NISSAN: ['NAVARA', 'FRONTIER', 'QASHQAI'],
        RENAULT: ['ALASKAN'],
      },
      anio_desde: 2015,
      anio_hasta: 2024,
      stock_disponible: 32,
      costo_neto: 8900,
      ubicacion_bodega: 'Bodega Central Soluparts - Pasillo F1',
    },
    {
      id_ailoo: 90514,
      codigo: 'SOL-90514',
      oem: '54302-4JA0B',
      nombre: 'PAR AMORTIGUADORES DELANTEROS KYB GAS-A-JUST NISSAN NP300 4X4',
      categoria: 'SUSPENSIÓN',
      tipo_pieza: 'AMORTIGUADOR',
      posicion: 'DELANTERA',
      lado: 'AMBOS',
      marca_repuesto: 'KYB',
      origen_pais: 'JAPÓN',
      marcas_compatibles: ['NISSAN'],
      modelos_por_marca: {
        NISSAN: ['NAVARA', 'FRONTIER'],
      },
      anio_desde: 2016,
      anio_hasta: 2024,
      stock_disponible: 6,
      costo_neto: 112000,
      ubicacion_bodega: 'Bodega Central Soluparts - Pasillo D3',
    },
  ],
  global: [
    {
      id_ailoo: 55210,
      codigo: 'GLB-55210',
      oem: '333202',
      nombre: 'AMORTIGUADOR DELANTERO DERECHO GAS (3 OREJAS ABS) CHEVROLET SAIL 1.5',
      categoria: 'SUSPENSIÓN',
      tipo_pieza: 'AMORTIGUADOR',
      posicion: 'DELANTERA',
      lado: 'DERECHO',
      marca_repuesto: 'GABRIEL',
      origen_pais: 'EE.UU.',
      marcas_compatibles: ['CHEVROLET'],
      modelos_por_marca: {
        CHEVROLET: ['SAIL'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 11,
      costo_neto: 38000,
      ubicacion_bodega: 'CD Global Repuestos - Estante S4',
    },
    {
      id_ailoo: 55211,
      codigo: 'GLB-55211',
      oem: '333203',
      nombre: 'AMORTIGUADOR DELANTERO IZQUIERDO GAS (3 OREJAS ABS) CHEVROLET SAIL 1.5',
      categoria: 'SUSPENSIÓN',
      tipo_pieza: 'AMORTIGUADOR',
      posicion: 'DELANTERA',
      lado: 'IZQUIERDO',
      marca_repuesto: 'GABRIEL',
      origen_pais: 'EE.UU.',
      marcas_compatibles: ['CHEVROLET'],
      modelos_por_marca: {
        CHEVROLET: ['SAIL'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 10,
      costo_neto: 38000,
      ubicacion_bodega: 'CD Global Repuestos - Estante S4',
    },
    {
      id_ailoo: 41098,
      codigo: 'GLB-41098',
      oem: '21410-1HS0A',
      nombre: 'RADIADOR DE AGUA ALUMINIO BRAZADO NISSAN VERSA / MARCH 1.6 HR16DE',
      categoria: 'MOTOR',
      tipo_pieza: 'RADIADOR',
      marca_repuesto: 'KOYORAD',
      origen_pais: 'JAPÓN',
      marcas_compatibles: ['NISSAN'],
      modelos_por_marca: {
        NISSAN: ['MARCH', 'NOTE'],
      },
      anio_desde: 2012,
      anio_hasta: 2021,
      stock_disponible: 7,
      costo_neto: 64000,
      ubicacion_bodega: 'CD Global Repuestos - Estante R2',
    },
    {
      id_ailoo: 48920,
      codigo: 'GLB-48920',
      oem: '25100-2B700',
      nombre: 'BOMBA DE AGUA ORIGINAL GMB HYUNDAI ACCENT RB / KIA RIO 4 1.4 - 1.6 GAMMA',
      categoria: 'MOTOR',
      tipo_pieza: 'BOMBA DE AGUA',
      marca_repuesto: 'GMB',
      origen_pais: 'COREA',
      marcas_compatibles: ['HYUNDAI', 'KIA'],
      modelos_por_marca: {
        HYUNDAI: ['ACCENT'],
        KIA: ['RIO', 'CERATO'],
      },
      anio_desde: 2012,
      anio_hasta: 2022,
      stock_disponible: 18,
      costo_neto: 29500,
      ubicacion_bodega: 'CD Global Repuestos - Estante M1',
    },
  ],
};

/**
 * Calcula un hash determinístico (SHA-1) sobre los atributos comerciales y técnicos
 * que impactan el catálogo en Firebase y WooCommerce. Si el hash no cambia, no se
 * reescribe el documento ni se encola en la sincronización incremental hacia WooCommerce.
 */
export function calcularHashCatalogoItem(item = {}) {
  const marcas = Array.isArray(item.marcasCompatibles)
    ? [...item.marcasCompatibles].map(m => String(m).trim().toUpperCase()).sort()
    : [];

  let modelosSerialized = '';
  if (Array.isArray(item.modelosCompatibles)) {
    modelosSerialized = [...item.modelosCompatibles].map(m => String(m).trim().toUpperCase()).sort().join('|');
  } else if (item.modelosCompatibles && typeof item.modelosCompatibles === 'object') {
    modelosSerialized = Object.keys(item.modelosCompatibles)
      .sort()
      .map(k => `${k}:${(item.modelosCompatibles[k] || []).slice().sort().join(',')}`)
      .join(';');
  }

  const payload = JSON.stringify({
    skuPublicoFrp: String(item.skuPublicoFrp || item.codigo || '').trim().toUpperCase(),
    nombre: String(item.nombre || '').trim(),
    categoria: String(item.categoria || '').trim().toUpperCase(),
    stock: Number(item.stock) || 0,
    precioCompra: Number(item.precioCompra) || 0,
    precioVenta: Number(item.precioVenta) || 0,
    ocultarEnTienda: Boolean(item.ocultarEnTienda),
    marcas,
    modelos: modelosSerialized,
    anioDesde: item.anioDesde ? Number(item.anioDesde) : null,
    anioHasta: item.anioHasta ? Number(item.anioHasta) : null,
  });

  return crypto.createHash('sha1').update(payload).digest('hex');
}

/**
 * Consulta la vista `{projectId}.{datasetId}.v_agente_catalogo` en BigQuery cuando
 * `AILOO_BQ_LIVE=true`, o retorna el catálogo semilla del nodo Ailoo en desarrollo local.
 */
async function obtenerCatalogoDesdeOrigenAiloo(nodo) {
  const vistaCatalogo = nodo.tablaCatalogo || nodo.vistaCatalogo || 'v_agente_catalogo';
  const fullView = `${nodo.projectId}.${nodo.datasetId}.${vistaCatalogo}`;

  if (process.env.AILOO_BQ_LIVE === 'true') {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/bigquery.readonly'],
      });
      const bigquery = google.bigquery({ version: 'v2', auth });
      const query = `
        SELECT
          id_ailoo,
          codigo,
          oem,
          nombre,
          categoria,
          marca_repuesto,
          marcas_compatibles,
          anio_desde,
          anio_hasta,
          stock_disponible,
          costo_neto,
          ubicacion_bodega
        FROM \`${fullView}\`
        WHERE stock_disponible >= 0
        LIMIT 2000
      `;
      const res = await bigquery.jobs.query({
        projectId: nodo.projectId,
        requestBody: { query, useLegacySql: false },
      });
      const schemaFields = res.data.schema?.fields || [];
      const rows = (res.data.rows || []).map(row => {
        const obj = {};
        row.f.forEach((cell, idx) => {
          const fieldName = schemaFields[idx]?.name || `col_${idx}`;
          obj[fieldName] = cell.v;
        });
        return obj;
      });
      return {
        modoOrigen: 'bigquery_live',
        vistaOrigen: fullView,
        items: rows,
      };
    } catch (err) {
      console.warn(`[AilooCatalogSync] Fallback a catálogo semilla para ${fullView}:`, err.message);
    }
  }

  return {
    modoOrigen: 'local_federated_seed',
    vistaOrigen: fullView,
    items: CATALOGO_SEMILLA_NODOS[nodo.id] || [],
  };
}

/**
 * Normaliza un registro crudo de `v_agente_catalogo` al esquema unificado de `inventario`
 * de FácilRepuestos, preservando el conocimiento de compatibilidad aprendido previamente.
 */
function normalizarItemAilooAInventario(raw, nodo, docExistente = null) {
  const idAiloo = String(raw.id_ailoo || raw.codigo || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const codigoInternoProveedor = String(raw.codigo || `${nodo.id.toUpperCase()}-${idAiloo}`).trim().toUpperCase();
  const skuPublicoFrp = generarSkuPublicoFrp(nodo.prefijoSku || 'FRP-AIL', codigoInternoProveedor);

  const costoNeto = Math.round(Number(raw.costo_neto ?? raw.precioCompra ?? 0));
  const margenPct = Number(nodo.margenPct ?? 25);
  const precioVenta = calcularPrecioPublicoFrp(costoNeto, margenPct);
  const stock = Math.max(0, Number(raw.stock_disponible ?? raw.stock ?? 0));

  // Unir marcas compatibles en MAYÚSCULAS para compatibilidad con filtros de Inventario y POS
  const marcasBase = Array.isArray(raw.marcas_compatibles)
    ? raw.marcas_compatibles.map(s => String(s).trim().toUpperCase())
    : typeof raw.marcas_compatibles === 'string'
      ? raw.marcas_compatibles.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
  const marcasPrevias = Array.isArray(docExistente?.marcasCompatibles)
    ? docExistente.marcasCompatibles.map(s => String(s).trim().toUpperCase())
    : [];
  const marcasCompatibles = Array.from(new Set([...marcasPrevias, ...marcasBase]));

  // Unir modelos compatibles por marca ({ [marca]: string[] })
  const modelosPrevios =
    docExistente?.modelosCompatibles && typeof docExistente.modelosCompatibles === 'object' && !Array.isArray(docExistente.modelosCompatibles)
      ? { ...docExistente.modelosCompatibles }
      : {};
  const modelosBase = raw.modelos_por_marca && typeof raw.modelos_por_marca === 'object'
    ? raw.modelos_por_marca
    : {};
  const modelosCompatibles = { ...modelosPrevios };
  for (const [marca, lista] of Object.entries(modelosBase)) {
    const cleanM = marca.toUpperCase();
    const prev = Array.isArray(modelosCompatibles[cleanM]) ? modelosCompatibles[cleanM] : [];
    modelosCompatibles[cleanM] = Array.from(new Set([...prev, ...(Array.isArray(lista) ? lista : [])]));
  }

  // Equivalencias en formato [{ fabricante, codigo }]
  const eqPrevias = Array.isArray(docExistente?.equivalencias)
    ? docExistente.equivalencias.filter(e => e && typeof e === 'object' && e.codigo)
    : [];
  const oemCode = raw.oem ? String(raw.oem).trim().toUpperCase() : null;
  const equivalencias = [...eqPrevias];
  if (oemCode && !equivalencias.some(e => e.codigo === oemCode)) {
    equivalencias.push({ fabricante: 'OEM', codigo: oemCode });
  }

  const fabricante = String(raw.marca_repuesto || docExistente?.fabricante || docExistente?.marcaRepuesto || '').trim().toUpperCase();

  const itemNormalizado = {
    codigo: codigoInternoProveedor,
    skuPublicoFrp,
    prefijoSku: nodo.prefijoSku || 'FRP-AIL',
    oem: oemCode || docExistente?.oem || '',
    nombre: String(raw.nombre || docExistente?.nombre || 'REPUESTO AILOO').trim(),
    categoria: String(raw.categoria || docExistente?.categoria || 'MOTOR').trim().toUpperCase(),
    tipoPieza: String(raw.tipo_pieza || docExistente?.tipoPieza || '').trim().toUpperCase(),
    posicion: String(raw.posicion || docExistente?.posicion || 'NO APLICA').trim().toUpperCase(),
    lado: String(raw.lado || docExistente?.lado || 'NO APLICA').trim().toUpperCase(),
    fabricante,
    marcaRepuesto: fabricante,
    origen: String(raw.origen_pais || docExistente?.origen || '').trim().toUpperCase(),
    descripcion: docExistente?.descripcion || `Catálogo federado ${nodo.nombre} (${skuPublicoFrp})`,
    stock,
    stockReservado: Number(docExistente?.stockReservado || 0),
    stockMinimo: docExistente?.stockMinimo ?? 2,
    unidad: docExistente?.unidad || 'unidad',
    precioImportacion: 0,
    precioLista: costoNeto,
    descuentoTaller: 0,
    precioCompra: costoNeto,
    precioVenta,
    margenAplicadoPct: margenPct,
    proveedor: `${nodo.nombre} (Ailoo)`,
    proveedorId: nodo.id,
    origenDatos: 'nodo_ailoo',
    nodoAilooId: nodo.id,
    idAiloo: raw.id_ailoo || idAiloo,
    datasetOrigen: `${nodo.projectId}.${nodo.datasetId}.${nodo.tablaCatalogo || 'v_agente_catalogo'}`,
    ubicacion: String(raw.ubicacion_bodega || docExistente?.ubicacion || `Bodega ${nodo.nombre}`).trim(),
    marcasCompatibles,
    modelosCompatibles,
    anioDesde: Number(raw.anio_desde || docExistente?.anioDesde) || null,
    anioHasta: Number(raw.anio_hasta || docExistente?.anioHasta) || null,
    equivalencias,
    imagenUrl: docExistente?.imagenUrl || '',
    ocultarEnTienda: Boolean(docExistente?.ocultarEnTienda ?? false),
  };

  itemNormalizado.deltaHash = calcularHashCatalogoItem(itemNormalizado);
  return {
    docId: `ailoo_${nodo.id}_${idAiloo}`,
    itemNormalizado,
  };
}

/**
 * Sincroniza incrementalmente (Delta) el catálogo de un nodo Ailoo (`soluparts` o `global`)
 * hacia la colección `inventario` de Firebase.
 * - Solo escribe en Firestore los ítems nuevos o cuyo `deltaHash` haya cambiado (o si `forzar=true`).
 * - Marca `needsWooSync: true` únicamente en los documentos con cambios reales.
 */
export async function sincronizarCatalogoNodoAiloo(nodoId, { forzar = false } = {}) {
  const nodoDoc = await db.collection('nodos_ailoo').doc(nodoId).get();
  if (!nodoDoc.exists) {
    throw new Error(`El nodo Ailoo "${nodoId}" no está registrado en nodos_ailoo.`);
  }

  const nodo = { id: nodoDoc.id, ...nodoDoc.data() };
  const origen = await obtenerCatalogoDesdeOrigenAiloo(nodo);

  // Cargar inventario existente para detectar cambios por deltaHash y evitar escrituras redundantes
  const invSnap = await db.collection('inventario').get();
  const existentesPorId = new Map();
  const existentesPorCodigo = new Map();

  invSnap.docs.forEach(doc => {
    const data = doc.data();
    existentesPorId.set(doc.id, { id: doc.id, ...data });
    if (data.codigo && (data.nodoAilooId === nodo.id || data.proveedorId === nodo.id)) {
      existentesPorCodigo.set(String(data.codigo).toUpperCase(), { id: doc.id, ...data });
    }
  });

  let nuevos = 0;
  let actualizados = 0;
  let sinCambiosOmitidos = 0;
  const itemsConDelta = [];
  const ahora = new Date().toISOString();

  for (const rawItem of origen.items) {
    const codigoLookup = String(rawItem.codigo || '').trim().toUpperCase();
    const idAiloo = String(rawItem.id_ailoo || rawItem.codigo || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const compositeId = `ailoo_${nodo.id}_${idAiloo}`;

    const existente = existentesPorId.get(compositeId) || existentesPorCodigo.get(codigoLookup) || null;
    const targetDocId = existente ? existente.id : compositeId;

    const { itemNormalizado } = normalizarItemAilooAInventario(rawItem, nodo, existente);

    if (!existente) {
      await db.collection('inventario').doc(targetDocId).set({
        ...itemNormalizado,
        needsWooSync: true,
        wooSyncMotivo: 'nuevo_catalogo_ailoo',
        createdAt: ahora,
        updatedAt: ahora,
        creadoEn: ahora,
        actualizadoEn: ahora,
        ultimaIngestaAiloo: ahora,
      });
      nuevos++;
      itemsConDelta.push({
        id: targetDocId,
        skuPublicoFrp: itemNormalizado.skuPublicoFrp,
        nombre: itemNormalizado.nombre,
        accion: 'creado',
        stock: itemNormalizado.stock,
        precioVenta: itemNormalizado.precioVenta,
      });
    } else if (forzar || !existente.createdAt || existente.deltaHash !== itemNormalizado.deltaHash) {
      await db.collection('inventario').doc(targetDocId).update({
        ...itemNormalizado,
        needsWooSync: true,
        wooSyncMotivo: 'delta_catalogo_ailoo',
        createdAt: existente.createdAt || existente.creadoEn || ahora,
        updatedAt: ahora,
        actualizadoEn: ahora,
        ultimaIngestaAiloo: ahora,
      });
      actualizados++;
      itemsConDelta.push({
        id: targetDocId,
        skuPublicoFrp: itemNormalizado.skuPublicoFrp,
        nombre: itemNormalizado.nombre,
        accion: 'actualizado',
        stock: itemNormalizado.stock,
        precioVenta: itemNormalizado.precioVenta,
      });
    } else {
      sinCambiosOmitidos++;
    }
  }

  await db.collection('nodos_ailoo').doc(nodo.id).update({
    ultimaSincronizacionCatalogo: ahora,
    ultimoResumenCatalogo: {
      totalLeidos: origen.items.length,
      nuevos,
      actualizados,
      sinCambiosOmitidos,
      modoOrigen: origen.modoOrigen,
    },
  });

  return {
    nodoId: nodo.id,
    nombreNodo: nodo.nombre,
    prefijoSku: nodo.prefijoSku,
    margenPct: nodo.margenPct,
    vistaOrigen: origen.vistaOrigen,
    modoOrigen: origen.modoOrigen,
    totalLeidos: origen.items.length,
    nuevos,
    actualizados,
    sinCambiosOmitidos,
    itemsConDelta,
    sincronizadoEn: ahora,
  };
}

/**
 * Ejecuta la ingesta Delta de catálogo para todos los nodos Ailoo activos (`soluparts`, `global`).
 */
export async function sincronizarTodosLosNodosAiloo({ forzar = false } = {}) {
  const snap = await db.collection('nodos_ailoo').get();
  const nodos = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => n.activo !== false);

  const resultados = [];
  for (const nodo of nodos) {
    const res = await sincronizarCatalogoNodoAiloo(nodo.id, { forzar });
    resultados.push(res);
  }

  return {
    totalNodos: resultados.length,
    totalLeidos: resultados.reduce((acc, r) => acc + r.totalLeidos, 0),
    totalNuevos: resultados.reduce((acc, r) => acc + r.nuevos, 0),
    totalActualizados: resultados.reduce((acc, r) => acc + r.actualizados, 0),
    totalSinCambiosOmitidos: resultados.reduce((acc, r) => acc + r.sinCambiosOmitidos, 0),
    nodos: resultados,
    sincronizadoEn: new Date().toISOString(),
  };
}
