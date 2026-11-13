import { db } from '../config/firebase.js';
import { generarSkuPublicoFrp } from './ailooBridge.js';

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

async function wcFetch(path, options = {}) {
  const { url } = getWooConfig();
  const res = await fetch(`${url}/wp-json/wc/v3${path}`, {
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

// Árbol oficial de 9 categorías y subcategorías de la tienda WordPress (https://facilrepuestos.cl)
const ARBOL_CATEGORIAS_TIENDA = [
  {
    nombre: 'Motor',
    subcategorias: [
      { nombre: 'Soportes de Motor' },
      { nombre: 'Alimentación e Inyección', hijas: ['Inyectores', 'Bombas de Combustible', 'Cuerpo de Aceleración'] },
      { nombre: 'Escape', hijas: ['Múltiples y Catalizadores', 'Silenciadores', 'Sensores de Oxígeno'] },
      { nombre: 'Componentes Internos', hijas: ['Válvulas', 'Empaquetaduras y Juntas', 'Cigüeñal', 'Pistones'] },
      { nombre: 'Distribución', hijas: ['Kits de Distribución', 'Cadenas y Tensores'] },
    ],
  },
  {
    nombre: 'Refrigeración y Climatización',
    subcategorias: [
      { nombre: 'Radiadores y Electroventiladores' },
      { nombre: 'Bombas de Agua y Termostatos' },
      { nombre: 'Mangueras y Depósitos' },
      { nombre: 'Aire Acondicionado', hijas: ['Compresores y Condensadores', 'Evaporadores y Válvulas'] },
    ],
  },
  {
    nombre: 'Mantenimiento Rápido',
    subcategorias: [
      { nombre: 'Filtros', hijas: ['Filtro de Aceite', 'Filtro de Aire', 'Filtro de Combustible', 'Filtro de Cabina y Polen'] },
      { nombre: 'Lubricantes y Fluidos', hijas: ['Aceites de Motor', 'Fluidos de Transmisión', 'Líquido de Frenos', 'Anticongelante y Refrigerante', 'Aditivos'] },
    ],
  },
  {
    nombre: 'Frenos',
    subcategorias: [
      { nombre: 'Pastillas y Balatas' },
      { nombre: 'Discos y Tambores' },
      { nombre: 'Calipers y Cilindros' },
      { nombre: 'Líneas y Bombas de Freno' },
      { nombre: 'Sensores y Cables de Freno', hijas: ['Sensores ABS', 'Cables de Freno de Mano'] },
    ],
  },
  {
    nombre: 'Suspensión y Dirección',
    subcategorias: [
      { nombre: 'Suspensión', hijas: ['Amortiguadores', 'Espirales y Resortes', 'Cazoletas y Rodamientos'] },
      { nombre: 'Dirección', hijas: ['Bandejas y Brazos', 'Terminales de Dirección', 'Cremalleras', 'Rótulas'] },
    ],
  },
  {
    nombre: 'Transmisión y Mando',
    subcategorias: [
      { nombre: 'Embrague y Ejes', hijas: ['Homocinéticas y Ejes', 'Kits de Embrague'] },
      { nombre: 'Rodamientos de Maza' },
    ],
  },
  {
    nombre: 'Sistema Eléctrico e Iluminación',
    subcategorias: [
      { nombre: 'Baterías y Alternadores' },
      { nombre: 'Motores de Arranque' },
      { nombre: 'Iluminación', hijas: ['Intermitentes', 'Faros y Focos Traseros', 'Ampolletas y Bulbos'] },
      { nombre: 'Sensores y Switches', hijas: ['Sensores CKP y CMP', 'Sensores de Temperatura y Presión'] },
      { nombre: 'Encendido', hijas: ['Bujías y Cables', 'Bobinas de Encendido'] },
    ],
  },
  {
    nombre: 'Carrocería y Espejos',
    subcategorias: [
      { nombre: 'Parachoques y Rejillas' },
      { nombre: 'Componentes de Chapa', hijas: ['Capó y Puertas', 'Tapabarros y Guardabarros'] },
      { nombre: 'Espejos Retrovisores', hijas: ['Cristales de Espejo', 'Espejos Completos'] },
      { nombre: 'Accesorios de Carrocería', hijas: ['Manillas y Chapas', 'Amortiguadores de Maleta'] },
      { nombre: 'Limpiaparabrisas', hijas: ['Plumillas'] },
    ],
  },
  {
    nombre: 'Correas y Piolas',
    subcategorias: [
      { nombre: 'Correas de Accesorios' },
      { nombre: 'Tensores y Poleas' },
      { nombre: 'Piolas y Cables' },
    ],
  },
];

const normCat = (s = '') =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resuelve la ruta jerárquica de categorías de la tienda (`[categoria, subcategoria, subcategoriaDetalle]`)
 * para un ítem de inventario, soportando tanto ítems nuevos con subcategorías explícitas como
 * ítems históricos o federados con categorías en mayúsculas.
 */
export function resolverRutaCategoriasTienda(item = {}) {
  const catRaw = normCat(item.categoria);
  const subRaw = normCat(item.subcategoria);
  const detRaw = normCat(item.subcategoriaDetalle);
  const tipoRaw = normCat(item.tipoPieza);
  const nomRaw = normCat(item.nombre);

  // 1. Coincidencia directa con categoría principal del árbol
  const catMatch = ARBOL_CATEGORIAS_TIENDA.find((c) => normCat(c.nombre) === catRaw);
  if (catMatch) {
    const subMatch =
      catMatch.subcategorias.find((s) => normCat(s.nombre) === subRaw) ||
      catMatch.subcategorias.find((s) => normCat(s.nombre) === tipoRaw) ||
      catMatch.subcategorias.find((s) => (s.hijas || []).some((h) => normCat(h) === detRaw || normCat(h) === tipoRaw));

    const detMatch = subMatch?.hijas?.find(
      (h) => normCat(h) === detRaw || normCat(h) === tipoRaw || normCat(h) === subRaw
    );

    return [catMatch.nombre, subMatch?.nombre || '', detMatch || ''].filter(Boolean);
  }

  // 2. Búsqueda de hoja (nivel 3 o nivel 2) por subcategoría o tipoPieza
  const aguja = detRaw || subRaw || tipoRaw;
  if (aguja) {
    for (const c of ARBOL_CATEGORIAS_TIENDA) {
      for (const s of c.subcategorias) {
        if (normCat(s.nombre) === aguja) {
          return [c.nombre, s.nombre];
        }
        for (const h of s.hijas || []) {
          if (normCat(h) === aguja) {
            return [c.nombre, s.nombre, h];
          }
        }
      }
    }
  }

  // 3. Inferencia por palabras clave y categorías legadas
  const texto = `${catRaw} ${tipoRaw} ${nomRaw}`;
  if (texto.includes('PASTILLA') || texto.includes('BALATA')) return ['Frenos', 'Pastillas y Balatas'];
  if (texto.includes('DISCO DE FRENO') || texto.includes('TAMBOR')) return ['Frenos', 'Discos y Tambores'];
  if (texto.includes('CALIPER') || texto.includes('CILINDRO DE FRENO')) return ['Frenos', 'Calipers y Cilindros'];
  if (texto.includes('SENSOR ABS')) return ['Frenos', 'Sensores y Cables de Freno', 'Sensores ABS'];
  if (catRaw === 'FRENOS') return ['Frenos', 'Pastillas y Balatas'];

  if (texto.includes('FILTRO DE ACEITE')) return ['Mantenimiento Rápido', 'Filtros', 'Filtro de Aceite'];
  if (texto.includes('FILTRO DE AIRE')) return ['Mantenimiento Rápido', 'Filtros', 'Filtro de Aire'];
  if (texto.includes('FILTRO DE COMBUSTIBLE') || texto.includes('FILTRO BENCINA') || texto.includes('FILTRO PETROLEO')) {
    return ['Mantenimiento Rápido', 'Filtros', 'Filtro de Combustible'];
  }
  if (texto.includes('CABINA') || texto.includes('POLEN')) return ['Mantenimiento Rápido', 'Filtros', 'Filtro de Cabina y Polen'];
  if (catRaw === 'FILTROS') return ['Mantenimiento Rápido', 'Filtros'];
  if (catRaw === 'LUBRICANTES' || texto.includes('ACEITE')) return ['Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Aceites de Motor'];

  if (texto.includes('AMORTIGUADOR') && !texto.includes('MALETA') && !texto.includes('PORTALON')) {
    return ['Suspensión y Dirección', 'Suspensión', 'Amortiguadores'];
  }
  if (texto.includes('ESPIRAL') || texto.includes('RESORTE')) return ['Suspensión y Dirección', 'Suspensión', 'Espirales y Resortes'];
  if (texto.includes('CAZOLETA')) return ['Suspensión y Dirección', 'Suspensión', 'Cazoletas y Rodamientos'];
  if (texto.includes('BANDEJA') || texto.includes('BRAZO')) return ['Suspensión y Dirección', 'Dirección', 'Bandejas y Brazos'];
  if (texto.includes('TERMINAL') || texto.includes('AXIAL')) return ['Suspensión y Dirección', 'Dirección', 'Terminales de Dirección'];
  if (texto.includes('CREMALLERA')) return ['Suspensión y Dirección', 'Dirección', 'Cremalleras'];
  if (texto.includes('ROTULA')) return ['Suspensión y Dirección', 'Dirección', 'Rótulas'];
  if (catRaw === 'SUSPENSION') return ['Suspensión y Dirección', 'Suspensión'];
  if (catRaw === 'DIRECCION') return ['Suspensión y Dirección', 'Dirección'];

  if (texto.includes('HOMOCINETICA') || texto.includes('EJE')) return ['Transmisión y Mando', 'Embrague y Ejes', 'Homocinéticas y Ejes'];
  if (texto.includes('EMBRAGUE')) return ['Transmisión y Mando', 'Embrague y Ejes', 'Kits de Embrague'];
  if (texto.includes('MAZA')) return ['Transmisión y Mando', 'Rodamientos de Maza'];
  if (catRaw === 'TRANSMISION') return ['Transmisión y Mando', 'Embrague y Ejes'];

  if (texto.includes('RADIADOR') || texto.includes('ELECTROVENTILADOR')) return ['Refrigeración y Climatización', 'Radiadores y Electroventiladores'];
  if (texto.includes('BOMBA DE AGUA') || texto.includes('TERMOSTATO')) return ['Refrigeración y Climatización', 'Bombas de Agua y Termostatos'];

  if (texto.includes('BUJIA')) return ['Sistema Eléctrico e Iluminación', 'Encendido', 'Bujías y Cables'];
  if (texto.includes('BOBINA')) return ['Sistema Eléctrico e Iluminación', 'Encendido', 'Bobinas de Encendido'];
  if (texto.includes('BATERIA') || texto.includes('ALTERNADOR')) return ['Sistema Eléctrico e Iluminación', 'Baterías y Alternadores'];
  if (texto.includes('ARRANQUE')) return ['Sistema Eléctrico e Iluminación', 'Motores de Arranque'];
  if (texto.includes('SENSOR')) return ['Sistema Eléctrico e Iluminación', 'Sensores y Switches'];
  if (catRaw === 'ELECTRICO') return ['Sistema Eléctrico e Iluminación', 'Sensores y Switches'];

  if (texto.includes('PARACHOQUE') || texto.includes('REJILLA') || texto.includes('MASCARA')) return ['Carrocería y Espejos', 'Parachoques y Rejillas'];
  if (texto.includes('ESPEJO')) return ['Carrocería y Espejos', 'Espejos Retrovisores', 'Espejos Completos'];
  if (texto.includes('PLUMILLA')) return ['Carrocería y Espejos', 'Limpiaparabrisas', 'Plumillas'];
  if (catRaw === 'CARROCERIA') return ['Carrocería y Espejos', 'Parachoques y Rejillas'];

  if (texto.includes('CORREA') && !texto.includes('DISTRIBUCION')) return ['Correas y Piolas', 'Correas de Accesorios'];
  if (texto.includes('PIOLA')) return ['Correas y Piolas', 'Piolas y Cables'];

  if (texto.includes('SOPORTE DE MOTOR') || texto.includes('SOPORTE MOTOR')) return ['Motor', 'Soportes de Motor'];
  if (texto.includes('DISTRIBUCION')) return ['Motor', 'Distribución', 'Kits de Distribución'];
  if (texto.includes('EMPAQUETADURA') || texto.includes('JUNTA') || texto.includes('CULATA')) {
    return ['Motor', 'Componentes Internos', 'Empaquetaduras y Juntas'];
  }
  return ['Motor'];
}

// Trae/crea categorías jerárquicas de WooCommerce (respetando padre -> hijo -> nieto)
// y devuelve una función `resolverIdsParaItem(item)` que entrega `[{ id }, ...]`
async function prepararCategoriasWooCommerce(items = []) {
  const existentes = [];
  let page = 1;
  while (true) {
    const lote = await wcFetch(`/products/categories?per_page=100&page=${page}`);
    if (!lote.length) break;
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
function construirPayload(id, item, obtenerCategoriasItem, esNuevo, puedeAgregarImagen) {
  const disponible = Math.max(0, Math.floor((item.stock || 0) - (item.stockReservado || 0)));
  const rutaCategorias = resolverRutaCategoriasTienda(item);
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
      { key: '_frp_categoria_jerarquia', value: rutaCategorias.join(' > ') },
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

  // También limpiar productos que fueron eliminados del inventario y quedaron huérfanos en WooCommerce
  const limpieza = await limpiarProductosHuerfanos(todos);
  ocultados += limpieza.eliminados || 0;

  return {
    modoSync: soloDelta ? 'delta_incremental' : 'catalogo_completo',
    modoConexion: 'woocommerce_rest_live',
    total: todos.length,
    procesados: items.length + (limpieza.eliminados || 0),
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
