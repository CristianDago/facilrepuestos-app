import crypto from 'crypto';
import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import { calcularPrecioPublicoFrp, generarSkuPublicoFrp } from './ailooBridge.js';
import { clasificarProductoEnTaxonomiaFrp } from './categoriasTaxonomia.js';

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
    {
      id_ailoo: 11090,
      codigo: 'SOL-11090',
      oem: '1109013-W01',
      nombre: 'FILTRO DE AIRE MOTOR CHANGAN A500 1.5 / MD201 / HONOR S',
      categoria: 'FILTROS',
      tipo_pieza: 'FILTRO DE AIRE',
      marca_repuesto: 'CHANGAN OEM',
      origen_pais: 'CHINA',
      marcas_compatibles: ['CHANGAN'],
      modelos_por_marca: {
        CHANGAN: ['A500', 'MD201', 'HONOR'],
      },
      anio_desde: 2016,
      anio_hasta: 2024,
      stock_disponible: 15,
      costo_neto: 7300,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 29900,
      codigo: 'SOL-29900',
      oem: '3501110-AW01',
      nombre: 'PASTILLAS DE FRENO DELANTERAS CERÁMICAS CHANGAN CS15 / ALSVIN 1.4 - 1.5',
      categoria: 'FRENOS',
      tipo_pieza: 'PASTILLAS DE FRENO',
      posicion: 'DELANTERA',
      marca_repuesto: 'NETO / OEM',
      origen_pais: 'CHINA',
      marcas_compatibles: ['CHANGAN'],
      modelos_por_marca: {
        CHANGAN: ['CS15', 'ALSVIN', 'CS35'],
      },
      anio_desde: 2017,
      anio_hasta: 2025,
      stock_disponible: 12,
      costo_neto: 19500,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 38900,
      codigo: 'SOL-38900',
      oem: 'DFM-3501050',
      nombre: 'PASTILLAS DE FRENO DELANTERAS DFM AX3 / JOYEAR X3 / SX5 1.5 - 1.6 - 2.0',
      categoria: 'FRENOS',
      tipo_pieza: 'PASTILLAS DE FRENO',
      posicion: 'DELANTERA',
      marca_repuesto: 'DONGFENG OEM',
      origen_pais: 'CHINA',
      marcas_compatibles: ['DFM', 'DONGFENG'],
      modelos_por_marca: {
        DFM: ['AX3', 'JOYEAR', 'X3', 'SX5', 'SX6'],
      },
      anio_desde: 2016,
      anio_hasta: 2024,
      stock_disponible: 8,
      costo_neto: 25500,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 59900,
      codigo: 'SOL-59900',
      oem: 'DFM-3774010',
      nombre: 'CINTA VOLANTE AIRBAG (CLOCK SPRING) DFM JOYEAR X3 / S50 / AX4',
      categoria: 'ELÉCTRICO',
      tipo_pieza: 'CINTA VOLANTE',
      marca_repuesto: 'DONGFENG OEM',
      origen_pais: 'CHINA',
      marcas_compatibles: ['DFM', 'DONGFENG'],
      modelos_por_marca: {
        DFM: ['JOYEAR', 'X3', 'S50', 'AX4'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 4,
      costo_neto: 39400,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 36900,
      codigo: 'SOL-36900',
      oem: '1306010FA140',
      nombre: 'TERMOSTATO CON CARCASA MOTOR 2.8 CUMMINS JAC URBAN 1061 / T6 / T8 DIESEL',
      categoria: 'MOTOR',
      tipo_pieza: 'TERMOSTATO',
      marca_repuesto: 'JAC ORIGINAL',
      origen_pais: 'CHINA',
      marcas_compatibles: ['JAC'],
      modelos_por_marca: {
        JAC: ['URBAN', '1061', 'T6', 'T8', 'SUNRAY'],
      },
      anio_desde: 2016,
      anio_hasta: 2024,
      stock_disponible: 7,
      costo_neto: 24200,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 29901,
      codigo: 'SOL-29901',
      oem: 'JAC-3501100U8510',
      nombre: 'PASTILLAS DE FRENO DELANTERAS JAC S2 / S3 / J4 1.5 VVT',
      categoria: 'FRENOS',
      tipo_pieza: 'PASTILLAS DE FRENO',
      posicion: 'DELANTERA',
      marca_repuesto: 'JAC OEM',
      origen_pais: 'CHINA',
      marcas_compatibles: ['JAC'],
      modelos_por_marca: {
        JAC: ['S2', 'S3', 'J4'],
      },
      anio_desde: 2016,
      anio_hasta: 2023,
      stock_disponible: 10,
      costo_neto: 19600,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 74900,
      codigo: 'SOL-74900',
      oem: 'CHERY-A21-1601020',
      nombre: 'KIT DE EMBRAGUE COMPLETO (PRENSA + DISCO + RODAMIENTO) CHERY TIGGO 2 / ARRIZO 5 1.5',
      categoria: 'TRANSMISIÓN',
      tipo_pieza: 'KIT DE EMBRAGUE',
      marca_repuesto: 'VALEO / CHERY',
      origen_pais: 'CHINA',
      marcas_compatibles: ['CHERY'],
      modelos_por_marca: {
        CHERY: ['TIGGO 2', 'TIGGO 2 PRO', 'ARRIZO 5', 'TIGGO 3'],
      },
      anio_desde: 2017,
      anio_hasta: 2024,
      stock_disponible: 6,
      costo_neto: 56000,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
    },
    {
      id_ailoo: 39900,
      codigo: 'SOL-39900',
      oem: 'GW-2203100-G08',
      nombre: 'HOMOCINÉTICA LADO RUEDA CON ABS GREAT WALL VOLEEX C30 1.5 (24X22 ESTRÍAS)',
      categoria: 'TRANSMISIÓN',
      tipo_pieza: 'HOMOCINETICA',
      marca_repuesto: 'GSP',
      origen_pais: 'CHINA',
      marcas_compatibles: ['GREAT WALL'],
      modelos_por_marca: {
        'GREAT WALL': ['VOLEEX', 'C30'],
      },
      anio_desde: 2012,
      anio_hasta: 2020,
      stock_disponible: 9,
      costo_neto: 26200,
      ubicacion_bodega: 'Bodega Central Soluparts - Gran Avenida',
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
    subcategoria: String(item.subcategoria || '').trim().toUpperCase(),
    subcategoriaDetalle: String(item.subcategoriaDetalle || item.categoriaHoja || '').trim().toUpperCase(),
    categoriaRuta: String(item.categoriaRuta || '').trim(),
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
 * Extrae y consolida el catálogo real directamente desde la API productiva de Ailoo
 * (`https://api.ailoo.cl/v1/facility/list` + `https://api.ailoo.cl/v1/inventory/all/list`),
 * aplicando las mismas reglas de negocio de Soluparts (`ingesta/inventario.py` y `60_stock.sql`):
 * 1. Solo suma stock de instalaciones vendibles (`type IN (0, 2)` -> TIENDA y BODEGA; excluye MERMA/Garantías `type = 5`).
 * 2. Deduplica por `inventoryItemId` (la API repite filas hasta 10 veces).
 * 3. `quantity` negativa se trata como `0` (`GREATEST(quantity, 0)`).
 */
async function obtenerCatalogoDesdeApiAilooDirecta(nodo, token) {
  const baseUrl = (process.env.AILOO_API_URL || nodo.ailooApiUrl || 'https://api.ailoo.cl/v1').replace(/\/+$/, '');
  const headers = { 'X-Ailoo-Access-Token': token, Accept: 'application/json' };

  const facRes = await fetch(`${baseUrl}/facility/list`, { headers });
  if (!facRes.ok) {
    throw new Error(`Ailoo /facility/list respondió HTTP ${facRes.status}`);
  }
  const facData = await facRes.json();
  const facilities = facData.facilities || [];
  // Solo TIENDA (0) y BODEGA (2) son vendibles; MERMA (5) son Garantías
  const vendiblesSet = new Set(
    facilities.filter(f => f.type === 0 || f.type === 2).map(f => f.id)
  );

  const invRes = await fetch(`${baseUrl}/inventory/all/list`, { headers });
  if (!invRes.ok) {
    throw new Error(`Ailoo /inventory/all/list respondió HTTP ${invRes.status}`);
  }
  const invData = await invRes.json();
  const rawItems = invData.inventoryItems || [];

  // 1. Deduplicar por inventoryItemId
  const unicosPorInvId = new Map();
  for (const row of rawItems) {
    if (row.inventoryItemId != null && !unicosPorInvId.has(row.inventoryItemId)) {
      unicosPorInvId.set(row.inventoryItemId, row);
    }
  }

  // 2. Agrupar por productId consolidando stock vendible, precio y sucursales
  const porProducto = new Map();
  for (const item of unicosPorInvId.values()) {
    const prodId = item.productId || item.sku || item.code;
    if (!prodId) continue;

    const esVendible = vendiblesSet.size === 0 || vendiblesSet.has(item.facilityId);
    const qty = esVendible ? Math.max(0, Number(item.quantity) || 0) : 0;
    const price = Math.max(0, Number(item.price) || 0);

    let prod = porProducto.get(prodId);
    if (!prod) {
      const rawName = String(item.productName || item.name || item.description || '').trim();
      const partesPara = rawName.toUpperCase().split(/\s+PARA\s+/);
      const tipoPieza = partesPara.length > 1 ? partesPara[0].trim() : '';
      const categoria = Array.isArray(item.categories) && item.categories.length > 0
        ? String(item.categories[0].name || item.categories[0] || 'REPUESTOS').trim().toUpperCase()
        : (tipoPieza.split(/\s+/)[0] || 'REPUESTOS');

      prod = {
        id_ailoo: String(prodId),
        codigo: String(item.sku || item.code || prodId).trim().toUpperCase(),
        oem: String(item.code || item.oem || '').trim().toUpperCase(),
        nombre: rawName || `REPUESTO ${prodId}`,
        categoria,
        tipo_pieza: tipoPieza,
        marca_repuesto: String(item.brandName || item.brand || '').trim().toUpperCase(),
        marcas_compatibles: [],
        anio_desde: null,
        anio_hasta: null,
        stock_disponible: 0,
        costo_neto: price,
        ubicacionesSet: new Set(),
      };
      porProducto.set(prodId, prod);
    }

    prod.stock_disponible += qty;
    if (price > 0 && (prod.costo_neto === 0 || price > prod.costo_neto)) {
      prod.costo_neto = price;
    }
    if (qty > 0 && item.facilityName) {
      prod.ubicacionesSet.add(`${item.facilityName} (${qty})`);
    }
  }

  const items = [];
  for (const p of porProducto.values()) {
    const { ubicacionesSet, ...rest } = p;
    rest.ubicacion_bodega = ubicacionesSet.size > 0
      ? Array.from(ubicacionesSet).slice(0, 4).join(' · ')
      : `Bodega ${nodo.nombre}`;
    items.push(rest);
  }

  return {
    modoOrigen: 'ailoo_api_v1_live',
    vistaOrigen: `${baseUrl}/inventory/all/list`,
    items,
  };
}

/**
 * Consulta la vista `{projectId}.{datasetId}.v_agente_catalogo` en BigQuery cuando
 * `AILOO_BQ_LIVE=true`, o la API directa de Ailoo cuando `AILOO_API_TOKEN` está definido,
 * o retorna el catálogo semilla del nodo Ailoo en desarrollo local.
 */
async function obtenerCatalogoDesdeOrigenAiloo(nodo) {
  const tokenApi =
    (nodo.id === 'soluparts' ? process.env.AILOO_API_TOKEN_SOLUPARTS : null) ||
    process.env.AILOO_API_TOKEN ||
    nodo.ailooApiToken ||
    '';

  if (tokenApi) {
    try {
      return await obtenerCatalogoDesdeApiAilooDirecta(nodo, tokenApi);
    } catch (err) {
      console.warn(`[AilooCatalogSync] Error en API directa Ailoo (${nodo.id}):`, err.message);
    }
  }

  const datasetId = nodo.datasetId === 'soluparts_ailoo' ? 'soluparts' : (nodo.datasetId || 'soluparts');
  const vistaCatalogo = nodo.tablaCatalogo || nodo.vistaCatalogo || 'v_agente_catalogo';
  const fullView = `${nodo.projectId}.${datasetId}.${vistaCatalogo}`;

  if (process.env.AILOO_BQ_LIVE === 'true') {
    try {
      const baseAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/bigquery'],
      });
      let bqAuth = baseAuth;

      // En desarrollo local (ADC de usuario), impersonamos automáticamente la cuenta
      // compute de facilrepuestos-prod que tiene rol BigQuery Data Viewer en soluparts-mostrador-prod.
      if (!process.env.K_SERVICE) {
        try {
          const iamcredentials = google.iamcredentials({ version: 'v1', auth: baseAuth });
          const saEmail = '271258776702-compute@developer.gserviceaccount.com';
          const tokenRes = await iamcredentials.projects.serviceAccounts.generateAccessToken({
            name: `projects/-/serviceAccounts/${saEmail}`,
            requestBody: {
              scope: ['https://www.googleapis.com/auth/bigquery', 'https://www.googleapis.com/auth/cloud-platform'],
            },
          });
          if (tokenRes.data?.accessToken) {
            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: tokenRes.data.accessToken });
            bqAuth = oauth2Client;
          }
        } catch {
          // Si falla la impersonación, intentamos con baseAuth directo
        }
      }

      const bigquery = google.bigquery({ version: 'v2', auth: bqAuth });
      const bqProjectId = process.env.FIREBASE_PROJECT_ID || 'facilrepuestos-prod';
      const bqLocation = 'southamerica-west1';

      // En v_agente_catalogo (70_sucursales.sql), un producto aparece en varias filas
      // (una por cada vehículo compatible). Agrupamos por producto_id para consolidar
      // todas sus marcas/modelos compatibles sin duplicar documentos en Firestore.
      const query = `
        SELECT
          CAST(producto_id AS STRING) AS id_ailoo,
          ANY_VALUE(CAST(product_item_id AS STRING)) AS product_item_id,
          ANY_VALUE(COALESCE(sku, codigo, CAST(producto_id AS STRING))) AS codigo,
          ANY_VALUE(codigo) AS oem,
          ANY_VALUE(producto) AS nombre,
          ANY_VALUE(COALESCE(SPLIT(tipo_pieza, ' ')[SAFE_OFFSET(0)], 'REPUESTOS')) AS categoria,
          ANY_VALUE(tipo_pieza) AS tipo_pieza,
          STRING_AGG(DISTINCT marca, ',') AS marcas_compatibles,
          STRING_AGG(
            DISTINCT IF(marca IS NOT NULL AND modelo IS NOT NULL, CONCAT(marca, '::', modelo), NULL),
            '||'
          ) AS pares_marca_modelo,
          STRING_AGG(DISTINCT cilindrada, ',') AS cilindradas_compatibles,
          MIN(anio_desde) AS anio_desde,
          MAX(anio_hasta) AS anio_hasta,
          MAX(IFNULL(stock, 0)) AS stock_disponible,
          MAX(IFNULL(stock_santiago, 0)) AS stock_santiago,
          MAX(IFNULL(stock_rancagua, 0)) AS stock_rancagua,
          MAX(IFNULL(stock_serena, 0)) AS stock_serena,
          MAX(IFNULL(sucursales_con_stock, 0)) AS sucursales_con_stock,
          MAX(IFNULL(precio, 0)) AS costo_neto,
          LOGICAL_OR(IFNULL(publicado_web, false)) AS publicado_web,
          ANY_VALUE(
            (SELECT STRING_AGG(CONCAT(s.sucursal, ' (', CAST(CAST(s.cantidad AS INT64) AS STRING), ')'), ' · ')
             FROM UNNEST(sucursales) s)
          ) AS ubicacion_bodega
        FROM \`${fullView}\`
        WHERE IFNULL(stock, 0) > 0 AND IFNULL(precio, 0) > 0
        GROUP BY producto_id
      `;
      const res = await bigquery.jobs.query({
        projectId: bqProjectId,
        requestBody: {
          query,
          useLegacySql: false,
          location: bqLocation,
          maxResults: 10000,
          timeoutMs: 60000,
        },
      });
      const schemaFields = res.data.schema?.fields || [];
      const allRawRows = [...(res.data.rows || [])];
      let pageToken = res.data.pageToken;
      const jobId = res.data.jobReference?.jobId;

      while (pageToken && jobId) {
        const pageRes = await bigquery.jobs.getQueryResults({
          projectId: bqProjectId,
          jobId,
          location: bqLocation,
          pageToken,
          maxResults: 10000,
        });
        if (pageRes.data.rows?.length) {
          allRawRows.push(...pageRes.data.rows);
        }
        pageToken = pageRes.data.pageToken;
      }

      const rows = allRawRows.map(row => {
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
  // Regla de negocio Soluparts: el precio de venta de Soluparts es el mismo precio de venta en FácilRepuestos (margen 0%)
  const margenPct = nodo.id === 'soluparts' ? 0 : Number(nodo.margenPct ?? 0);
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
    ? { ...raw.modelos_por_marca }
    : {};

  if (typeof raw.pares_marca_modelo === 'string' && raw.pares_marca_modelo.trim()) {
    for (const par of raw.pares_marca_modelo.split('||')) {
      const [mRaw, modRaw] = par.split('::');
      const m = String(mRaw || '').trim().toUpperCase();
      const mod = String(modRaw || '').trim().toUpperCase();
      if (m && mod) {
        if (!Array.isArray(modelosBase[m])) modelosBase[m] = [];
        if (!modelosBase[m].includes(mod)) modelosBase[m].push(mod);
      }
    }
  }

  const modelosCompatibles = { ...modelosPrevios };
  for (const [marca, lista] of Object.entries(modelosBase)) {
    const cleanM = marca.toUpperCase();
    const prev = Array.isArray(modelosCompatibles[cleanM]) ? modelosCompatibles[cleanM] : [];
    modelosCompatibles[cleanM] = Array.from(new Set([...prev, ...(Array.isArray(lista) ? lista : [])]));
  }

  const cilindradasCompatibles = typeof raw.cilindradas_compatibles === 'string' && raw.cilindradas_compatibles.trim()
    ? raw.cilindradas_compatibles.split(',').map(c => c.trim()).filter(Boolean)
    : Array.isArray(docExistente?.cilindradasCompatibles)
      ? docExistente.cilindradasCompatibles
      : [];

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
  const datasetId = nodo.datasetId === 'soluparts_ailoo' ? 'soluparts' : (nodo.datasetId || 'soluparts');

  const nombreLimpio = String(raw.nombre || docExistente?.nombre || 'REPUESTO AILOO')
    .replace(/\(\s*(?:OFERTA|LIQUIDACI[OÓ]N|PROMO)[^)]*\)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const upperText = `${nombreLimpio} ${raw.tipo_pieza || ''}`.toUpperCase();
  const posicionInferida = raw.posicion || docExistente?.posicion || (
    /\b(DELANTER[OA]|DEL\.?)\b/.test(upperText) ? 'DELANTERA' :
    /\b(TRASER[OA]|TRAS\.?)\b/.test(upperText) ? 'TRASERA' : 'NO APLICA'
  );
  const ladoInferido = raw.lado || docExistente?.lado || (
    /\b(IZQUIERD[OA]|LH)\b/.test(upperText) && /\b(DERECH[OA]|RH)\b/.test(upperText) ? 'AMBOS LADOS' :
    /\b(IZQUIERD[OA]|LH)\b/.test(upperText) ? 'IZQUIERDO (LH)' :
    /\b(DERECH[OA]|RH)\b/.test(upperText) ? 'DERECHO (RH)' : 'NO APLICA'
  );

  const tipoPiezaLimpio = String(raw.tipo_pieza || docExistente?.tipoPieza || '').trim().toUpperCase();
  const taxonomia = clasificarProductoEnTaxonomiaFrp({
    nombre: nombreLimpio,
    tipoPieza: tipoPiezaLimpio,
    categoria: raw.categoria || docExistente?.categoria || '',
    subcategoria: docExistente?.subcategoria || '',
    subcategoriaDetalle: docExistente?.subcategoriaDetalle || docExistente?.categoriaHoja || '',
  });

  const itemNormalizado = {
    codigo: codigoInternoProveedor,
    skuPublicoFrp,
    prefijoSku: nodo.prefijoSku || 'FRP-AIL',
    oem: oemCode || docExistente?.oem || '',
    nombre: nombreLimpio,
    categoria: taxonomia.categoria,
    subcategoria: taxonomia.subcategoria,
    subcategoriaDetalle: taxonomia.subcategoriaDetalle,
    categoriaHoja: taxonomia.categoriaHoja,
    categoriaFinal: taxonomia.categoriaFinal,
    categoriaRuta: taxonomia.categoriaRuta,
    tipoPieza: tipoPiezaLimpio,
    posicion: String(posicionInferida).trim().toUpperCase(),
    lado: String(ladoInferido).trim().toUpperCase(),
    fabricante,
    marcaRepuesto: fabricante,
    origen: String(raw.origen_pais || docExistente?.origen || '').trim().toUpperCase(),
    descripcion: docExistente?.descripcion || `Catálogo federado ${nodo.nombre} (${skuPublicoFrp})`,
    stock,
    stockSantiago: Number(raw.stock_santiago ?? docExistente?.stockSantiago ?? stock),
    stockRancagua: Number(raw.stock_rancagua ?? docExistente?.stockRancagua ?? 0),
    stockSerena: Number(raw.stock_serena ?? docExistente?.stockSerena ?? 0),
    stockCentro: Number((Number(raw.stock_santiago) || 0) + (Number(raw.stock_rancagua) || 0)) || Number(docExistente?.stockCentro ?? stock),
    stockNorte: Number(raw.stock_serena ?? docExistente?.stockNorte ?? 0),
    sucursalesConStock: Number(raw.sucursales_con_stock ?? docExistente?.sucursalesConStock ?? (stock > 0 ? 1 : 0)),
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
    productItemIdAiloo: raw.product_item_id || docExistente?.productItemIdAiloo || null,
    datasetOrigen: `${nodo.projectId}.${datasetId}.${nodo.tablaCatalogo || 'v_agente_catalogo'}`,
    ubicacion: String(raw.ubicacion_bodega || docExistente?.ubicacion || `Bodega ${nodo.nombre}`).trim(),
    marcasCompatibles,
    modelosCompatibles,
    cilindradasCompatibles,
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

  // Escritura por lotes (WriteBatch de máximo 400 operaciones por commit)
  // para soportar 5.000 - 15.000 SKUs en segundos sin timeouts de Firestore.
  const BATCH_LIMIT = 400;
  let batch = db.batch();
  let opsInBatch = 0;

  async function flushBatch() {
    if (opsInBatch > 0) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  for (const rawItem of origen.items) {
    const codigoLookup = String(rawItem.codigo || '').trim().toUpperCase();
    const idAiloo = String(rawItem.id_ailoo || rawItem.codigo || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const compositeId = `ailoo_${nodo.id}_${idAiloo}`;

    const existente = existentesPorId.get(compositeId) || existentesPorCodigo.get(codigoLookup) || null;
    const targetDocId = existente ? existente.id : compositeId;

    const { itemNormalizado } = normalizarItemAilooAInventario(rawItem, nodo, existente);

    if (!existente) {
      const ref = db.collection('inventario').doc(targetDocId);
      batch.set(ref, {
        ...itemNormalizado,
        needsWooSync: true,
        wooSyncMotivo: 'nuevo_catalogo_ailoo',
        createdAt: ahora,
        updatedAt: ahora,
        creadoEn: ahora,
        actualizadoEn: ahora,
        ultimaIngestaAiloo: ahora,
      });
      opsInBatch++;
      nuevos++;
      if (itemsConDelta.length < 200) {
        itemsConDelta.push({
          id: targetDocId,
          skuPublicoFrp: itemNormalizado.skuPublicoFrp,
          nombre: itemNormalizado.nombre,
          accion: 'creado',
          stock: itemNormalizado.stock,
          precioVenta: itemNormalizado.precioVenta,
        });
      }
    } else if (forzar || !existente.createdAt || existente.deltaHash !== itemNormalizado.deltaHash) {
      const ref = db.collection('inventario').doc(targetDocId);
      batch.update(ref, {
        ...itemNormalizado,
        needsWooSync: true,
        wooSyncMotivo: 'delta_catalogo_ailoo',
        createdAt: existente.createdAt || existente.creadoEn || ahora,
        updatedAt: ahora,
        actualizadoEn: ahora,
        ultimaIngestaAiloo: ahora,
      });
      opsInBatch++;
      actualizados++;
      if (itemsConDelta.length < 200) {
        itemsConDelta.push({
          id: targetDocId,
          skuPublicoFrp: itemNormalizado.skuPublicoFrp,
          nombre: itemNormalizado.nombre,
          accion: 'actualizado',
          stock: itemNormalizado.stock,
          precioVenta: itemNormalizado.precioVenta,
        });
      }
    } else {
      sinCambiosOmitidos++;
    }

    if (opsInBatch >= BATCH_LIMIT) {
      await flushBatch();
    }
  }

  await flushBatch();

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
    margenPct: nodo.id === 'soluparts' ? 0 : nodo.margenPct,
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
  let snap = await db.collection('nodos_ailoo').get();
  if (snap.empty) {
    const ahora = new Date().toISOString();
    await Promise.all([
      db.collection('nodos_ailoo').doc('soluparts').set({
        nombre: 'Soluparts',
        projectId: 'soluparts-mostrador-prod',
        datasetId: 'soluparts',
        tablaEscalamientos: 'escalamientos',
        tablaConocimiento: 'conocimiento_aprendido',
        tablaCatalogo: 'v_agente_catalogo',
        prefijoSku: 'FRP-SOL',
        margenPct: 0,
        activo: true,
        updatedAt: ahora,
      }),
      db.collection('nodos_ailoo').doc('global').set({
        nombre: 'Global Repuestos',
        projectId: 'global-mostrador-prod',
        datasetId: 'global_ailoo',
        tablaEscalamientos: 'escalamientos',
        tablaConocimiento: 'conocimiento_aprendido',
        tablaCatalogo: 'v_agente_catalogo',
        prefijoSku: 'FRP-GLB',
        margenPct: 28,
        activo: true,
        updatedAt: ahora,
      }),
    ]);
    snap = await db.collection('nodos_ailoo').get();
  }
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
