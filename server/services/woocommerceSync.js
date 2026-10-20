import { db } from '../config/firebase.js';

const WC_URL    = process.env.WOOCOMMERCE_URL || '';
const WC_KEY    = process.env.WOOCOMMERCE_CONSUMER_KEY || '';
const WC_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

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
      if (p.sku) mapa.set(p.sku, { id: p.id, tieneImagen: (p.images || []).length > 0 });
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

function skuDeItem(id, item) {
  return item.codigo ? item.codigo.toUpperCase() : `DRM-${id}`;
}

// Busca el producto en WooCommerce por SKU y lo elimina (borrado permanente).
// Se usa cuando un ítem se borra del inventario, para que no quede huérfano
// en la tienda. No lanza error si el producto no existe ahí — simplemente
// no hace nada (puede que nunca se haya sincronizado, por ejemplo).
export async function eliminarProductoDeWooCommerce(id, item) {
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    throw new Error('Faltan credenciales de WooCommerce (WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET)');
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
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
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
      if (creadoPorSync && (!p.sku || !skusVigentes.has(p.sku))) {
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
  if (item.fabricante) partes.push(`<strong>Marca:</strong> ${escHtml(item.fabricante)}`);
  if (item.origen) partes.push(`<strong>Origen:</strong> ${escHtml(item.origen)}`);
  if (item.tipoPieza) partes.push(`<strong>Tipo:</strong> ${item.tipoPieza}`);
  if (item.marcasCompatibles?.length) partes.push(`<strong>Compatible con:</strong> ${item.marcasCompatibles.join(', ')}`);
  if (item.equivalencias?.length) {
    const eq = item.equivalencias.map(e => `${e.fabricante} ${e.codigo}`).join(', ');
    partes.push(`<strong>Equivalencias:</strong> ${eq}`);
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
    meta_data: [{ key: '_drmotors_inventario_id', value: id }],
  };

  if (esNuevo) {
    payload.description = descripcionDeItem(item);
  }

  if (puedeAgregarImagen && item.imagenUrl) {
    payload.images = [{ src: item.imagenUrl }];
  }

  return payload;
}

// Sincroniza TODO el inventario hacia WooCommerce (crea o actualiza según corresponda)
export async function sincronizarInventarioConWooCommerce() {
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    throw new Error('Faltan credenciales de WooCommerce (WOOCOMMERCE_URL / CONSUMER_KEY / CONSUMER_SECRET)');
  }

  const snap = await db.collection('inventario').get();
  const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const categoriasUnicas = [...new Set(items.map(i => i.categoria).filter(Boolean))];
  const categoriasMapa   = await obtenerOCrearCategorias(categoriasUnicas);
  const existentes       = await obtenerProductosExistentes();

  const crear = [];
  const actualizar = [];
  const ocultosParaEliminar = []; // items marcados "no vender online" que ya estaban en la tienda

  for (const item of items) {
    const sku = skuDeItem(item.id, item);
    const existente = existentes.get(sku);
    const idExistente = existente?.id;

    if (item.ocultarEnTienda) {
      if (idExistente) ocultosParaEliminar.push(idExistente);
      continue; // nunca se crea ni se actualiza un ítem oculto
    }

    const esNuevo = !idExistente;
    const puedeAgregarImagen = esNuevo || !existente.tieneImagen;
    const payload = construirPayload(item.id, item, categoriasMapa, esNuevo, puedeAgregarImagen);
    if (idExistente) {
      actualizar.push({ id: idExistente, ...payload });
    } else {
      crear.push(payload);
    }
  }

  // WooCommerce recomienda lotes de máximo ~100 ítems por llamada
  const CHUNK = 90;
  let creados = 0, actualizados = 0, ocultados = 0;

  for (let i = 0; i < crear.length; i += CHUNK) {
    const lote = crear.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ create: lote }) });
    creados += r.create?.length || 0;
  }

  for (let i = 0; i < actualizar.length; i += CHUNK) {
    const lote = actualizar.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ update: lote }) });
    actualizados += r.update?.length || 0;
  }

  for (let i = 0; i < ocultosParaEliminar.length; i += CHUNK) {
    const lote = ocultosParaEliminar.slice(i, i + CHUNK);
    if (!lote.length) continue;
    const r = await wcFetch('/products/batch', { method: 'POST', body: JSON.stringify({ delete: lote }) });
    ocultados += r.delete?.length || 0;
  }

  return { total: items.length, creados, actualizados, ocultados };
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
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
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