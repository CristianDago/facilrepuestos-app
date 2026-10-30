import { db } from '../config/firebase.js';
import { generarSkuPublicoFrp } from './ailooBridge.js';

const WC_URL    = process.env.WOOCOMMERCE_URL || '';
const WC_KEY    = process.env.WOOCOMMERCE_CONSUMER_KEY || '';
const WC_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

function isWooConfigured() {
  return Boolean(WC_URL && WC_KEY && WC_SECRET);
}

function wcAuthHeader() {
  const token = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

async function wcFetch(path, options = {}) {
  const res = await fetch(`${WC_URL}/wp-json/wc/v3${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: wcAuthHeader(),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || `WooCommerce respondió ${res.status}`;
    throw new Error(msg);
  }
  return data;
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
      if (p.sku) mapa.set(String(p.sku).trim().toUpperCase(), { id: p.id, tieneImagen: (p.images || []).length > 0 });
    }
    if (productos.length < 100) break;
    page++;
  }
  return mapa;
}

// Trae/crea categorías de WooCommerce y devuelve nombre -> id
async function obtenerOCrearCategorias(nombresCategorias) {
  const existentes = await wcFetch('/products/categories?per_page=100');
  const mapa = new Map();
  for (const c of existentes) mapa.set(c.name.toUpperCase(), c.id);

  for (const nombre of nombresCategorias) {
    if (!nombre || mapa.has(nombre.toUpperCase())) continue;
    const creada = await wcFetch('/products/categories', {
      method: 'POST',
      body: JSON.stringify({ name: nombre }),
    });
    mapa.set(nombre.toUpperCase(), creada.id);
  }
  return mapa;
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

// Busca el producto en WooCommerce por SKU y lo elimina (borrado permanente).
// Se usa cuando un ítem se borra del inventario, para que no quede huérfano
// en la tienda. No lanza error si el producto no existe ahí — simplemente
// no hace nada (puede que nunca se haya sincronizado, por ejemplo).
export async function eliminarProductoDeWooCommerce(id, item) {
  if (!isWooConfigured()) {
    return { eliminado: false, motivo: 'Simulación local (sin credenciales WooCommerce)' };
  }

  const sku = skuDeItem(id, item);
  console.log('[woo-delete] Buscando en WooCommerce el SKU:', sku, '(item:', item.nombre, ')');

  const encontrados = await wcFetch(`/products?sku=${encodeURIComponent(sku)}&_fields=id,sku`);
  console.log('[woo-delete] Resultado de la búsqueda:', JSON.stringify(encontrados));

  if (!encontrados.length) {
    console.log('[woo-delete] No se encontró ningún producto con ese SKU en WooCommerce.');
    return { eliminado: false, motivo: 'No existía en WooCommerce' };
  }

  console.log('[woo-delete] Eliminando producto WooCommerce id:', encontrados[0].id);
  await wcFetch(`/products/${encontrados[0].id}?force=true`, { method: 'DELETE' });
  console.log('[woo-delete] Eliminado correctamente.');
  return { eliminado: true, wooId: encontrados[0].id };
}

// Limpia productos "huérfanos": los que el propio sistema creó en WooCommerce
// (tienen el meta _drmotors_inventario_id) pero cuyo SKU ya no existe en el
// inventario actual — típicamente porque se eliminaron directo del inventario
// antes de que existiera la sincronización de borrado, o porque el código del
// repuesto cambió después de la primera sincronización (el SKU quedó viejo).
// NUNCA toca productos que no tengan ese meta — o sea, nunca borra algo que
// hayas agregado a mano en WooCommerce.
export async function limpiarProductosHuerfanos() {
  if (!isWooConfigured()) {
    throw new Error('Faltan credenciales de WooCommerce (WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET)');
  }

  const invSnap = await db.collection('inventario').get();
  const skusVigentes = new Set(invSnap.docs.map(doc => skuDeItem(doc.id, doc.data())));

  const huerfanos = [];
  let page = 1;
  while (true) {
    const productos = await wcFetch(`/products?per_page=100&page=${page}&_fields=id,sku,name,meta_data`);
    if (!productos.length) break;
    for (const p of productos) {
      const creadoPorSync = (p.meta_data || []).some(m => m.key === '_drmotors_inventario_id');
      if (creadoPorSync && (!p.sku || !skusVigentes.has(String(p.sku).trim().toUpperCase()))) {
        huerfanos.push({ id: p.id, sku: p.sku, nombre: p.name });
      }
    }
    if (productos.length < 100) break;
    page++;
  }

  for (const h of huerfanos) {
    await wcFetch(`/products/${h.id}?force=true`, { method: 'DELETE' });
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
  if (item.modelosCompatibles?.length) {
    partes.push(`<strong>Modelos compatibles:</strong> ${item.modelosCompatibles.join(', ')}`);
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
function construirPayload(id, item, categoriasMapa, esNuevo, puedeAgregarImagen) {
  const disponible = Math.max(0, Math.floor((item.stock || 0) - (item.stockReservado || 0)));
  const catId = categoriasMapa.get((item.categoria || '').toUpperCase());

  const payload = {
    name: item.nombre,
    sku: skuDeItem(id, item),
    regular_price: String(item.precioVenta || 0),
    manage_stock: true,
    stock_quantity: disponible,
    stock_status: disponible > 0 ? 'instock' : 'outofstock',
    categories: catId ? [{ id: catId }] : [],
    meta_data: [
      { key: '_drmotors_inventario_id', value: id },
      { key: '_frp_origen_datos', value: String(item.origenDatos || 'proveedor_local') },
      { key: '_frp_proveedor_id', value: String(item.proveedorId || 'local') },
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
    tiendaUrl: WC_URL || 'https://facilrepuestos.cl (Simulación Local)',
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
 * - Si las credenciales `WOOCOMMERCE_*` no están configuradas en entorno local, ejecuta el
 *   procesamiento de la cola en modo simulación local para permitir pruebas end-to-end.
 */
export async function sincronizarInventarioConWooCommerce({ soloDelta = true } = {}) {
  const configured = isWooConfigured();
  const snap = await db.collection('inventario').get();
  const todos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const items = soloDelta
    ? todos.filter(i => i.needsWooSync === true || !i.lastWooSyncAt)
    : todos;

  const omitidosSinCambio = todos.length - items.length;
  const ahora = new Date().toISOString();

  if (items.length === 0) {
    return {
      modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
      modoConexion: configured ? 'woocommerce_rest_live' : 'simulacion_local_delta',
      total: todos.length,
      procesados: 0,
      creados: 0,
      actualizados: 0,
      ocultados: 0,
      omitidosSinCambio,
      procesadosDetalle: [],
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
      creados,
      actualizados,
      ocultados,
      omitidosSinCambio,
      procesadosDetalle,
      sincronizadoEn: ahora,
    };
  }

  // Modo WooCommerce REST API Live
  const categoriasUnicas = [...new Set(items.map(i => i.categoria).filter(Boolean))];
  const categoriasMapa   = await obtenerOCrearCategorias(categoriasUnicas);
  const existentes       = await obtenerProductosExistentes();

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
    const payload = construirPayload(item.id, item, categoriasMapa, esNuevo, puedeAgregarImagen);
    if (idExistente) {
      actualizar.push({ id: idExistente, ...payload });
      metaActualizar.push({ docId: item.id, sku, wooId: idExistente, item });
    } else {
      crear.push(payload);
      metaCrear.push({ docId: item.id, sku, item });
    }
  }

  // WooCommerce recomienda lotes de máximo ~90 ítems por llamada
  const CHUNK = 90;
  let creados = 0, actualizados = 0, ocultados = 0;
  const procesadosDetalle = [];

  for (let i = 0; i < crear.length; i += CHUNK) {
    const lote = crear.slice(i, i + CHUNK);
    const metaLote = metaCrear.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ create: lote }) });
    const createdList = r.create || [];
    creados += createdList.length;

    for (let j = 0; j < metaLote.length; j++) {
      const m = metaLote[j];
      const cw = createdList[j];
      if (m && cw && !cw.error) {
        await db.collection('inventario').doc(m.docId).update({
          skuPublicoFrp: m.sku,
          wooProductId: cw.id || null,
          needsWooSync: false,
          wooSyncMotivo: null,
          lastWooSyncAt: ahora,
        });
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

  for (let i = 0; i < actualizar.length; i += CHUNK) {
    const lote = actualizar.slice(i, i + CHUNK);
    const metaLote = metaActualizar.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ update: lote }) });
    const updatedList = r.update || [];
    actualizados += updatedList.length;

    for (let j = 0; j < metaLote.length; j++) {
      const m = metaLote[j];
      const uw = updatedList[j];
      if (m && (!uw || !uw.error)) {
        await db.collection('inventario').doc(m.docId).update({
          skuPublicoFrp: m.sku,
          wooProductId: uw?.id || m.wooId,
          needsWooSync: false,
          wooSyncMotivo: null,
          lastWooSyncAt: ahora,
        });
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

  for (let i = 0; i < ocultosParaEliminar.length; i += CHUNK) {
    const lote = ocultosParaEliminar.slice(i, i + CHUNK);
    const metaLote = metaOcultos.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ delete: lote }) });
    ocultados += r.delete?.length || 0;

    for (const m of metaLote) {
      await db.collection('inventario').doc(m.docId).update({
        skuPublicoFrp: m.sku,
        wooProductId: null,
        needsWooSync: false,
        wooSyncMotivo: null,
        lastWooSyncAt: ahora,
      });
    }
  }

  return {
    modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
    modoConexion: 'woocommerce_rest_live',
    total: todos.length,
    procesados: items.length,
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
