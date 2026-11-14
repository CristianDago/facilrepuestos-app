import { Router } from 'express';
import { db } from '../config/firebase.js';
import { ARBOL_CATEGORIAS_TIENDA, normCat } from '../services/categoriasTaxonomia.js';
import { construirLinksCarroWooCommerce, obtenerUrlBaseTiendaWoo } from '../services/woocommerceSync.js';

const router = Router();

// Número oficial de WhatsApp de FácilRepuestos en facilrepuestos.cl (+56 9 2740 1059)
const WHATSAPP_PUBLIC_NUMBER = (process.env.WHATSAPP_PUBLIC_NUMBER || '56927401059').replace(/\D/g, '');

// Caché en memoria (TTL 3 minutos) para responder al buscador de WordPress en < 15 ms
// sin golpear MySQL ni hacer 8.600 lecturas de Firestore por cada búsqueda.
let cacheInventarioPublico = {
  items: null,
  expiraEn: 0,
};
const CACHE_TTL_MS = 3 * 60 * 1000;

export function invalidarCacheInventarioPublico() {
  cacheInventarioPublico = { items: null, expiraEn: 0 };
}

// Middleware: exige el header X-API-Key con la clave configurada en el servidor.
// Esta API es independiente del login de Firebase que usa el resto del sistema —
// pensada para ser consumida server-to-server (ej: PHP en WordPress).
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const expected = process.env.WORDPRESS_API_KEY;

  if (!expected) {
    return res.status(500).json({ success: false, error: 'API pública no configurada en el servidor' });
  }
  if (!key || key !== expected) {
    return res.status(401).json({ success: false, error: 'API Key inválida o ausente' });
  }
  next();
}

// Evita errores de precisión de punto flotante (ej: 84.8 - 0.9 = 83.90000000000004)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Diccionario de corrección ortográfica y jerga automotriz chilena ($0 tokens Gemini)
const REEMPLAZOS_AUTOMOTRICES_BUSCADOR = [
  [/\b(DONFEN|DONG\s*FENG|DONGFENG|DFLM|DFM\s+DONGFENG)\b/gi, 'DFM'],
  [/\bYAC\b/gi, 'JAC'],
  [/\b(CHERRY|CHERI)\b/gi, 'CHERY'],
  [/\b(SANYON|SAN\s+YONG|SSANG\s+YONG)\b/gi, 'SSANGYONG'],
  [/\b(GREATWALL|GRET\s+WALL|G\.?\s*WALL)\b/gi, 'GREAT WALL'],
  [/\bVOLEX\b/gi, 'VOLEEX'],
  [/\bALVIN\b/gi, 'ALSVIN'],
  [/\b(ARIZZO|ARISO)\b/gi, 'ARRIZO'],
  [/\bHAFEY\b/gi, 'HAFEI'],
  [/\bSC35\b/gi, 'CS35'],
  [/\bSC15\b/gi, 'CS15'],
  [/\bTIGGO2\b/gi, 'TIGGO 2'],
  [/\bTIGGO3\b/gi, 'TIGGO 3'],
  [/\b(EMBRIAGUE|EMBRIAGE|EMBRIAJE)\b/gi, 'EMBRAGUE'],
  [/\b(FUJIAS|BUJIQS|BUGIAS|BUJIAS)\b/gi, 'BUJIA'],
  [/\bBOCO\b/gi, 'OPTICO FOCO'],
  [/\bMASA\s+(DELANTERA|TRASERA|RUEDA)\b/gi, 'MAZA $1'],
  [/\b(SOPORTE\s+DE\s+HUESO|HUESITO)\b/gi, 'SOPORTE MOTOR TRASERO'],
  [/\b(BULBO|VULVO)\s+(DE\s+)?TEMPERATURA\b/gi, 'SENSOR TEMPERATURA'],
  [/\bESTREMOS\b/gi, 'EXTREMO TERMINAL'],
  [/\bPARACHOQUES\b/gi, 'PARACHOQUE'],
  [/\bAMORTIGUADORES\b/gi, 'AMORTIGUADOR'],
  [/\bPASTILLAS\b/gi, 'PASTILLA'],
  [/\bFILTROS\b/gi, 'FILTRO'],
  [/\bDISCOS\b/gi, 'DISCO'],
];

const STOPWORDS_BUSCADOR = new Set([
  'PARA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'UN', 'UNA', 'CON', 'SIN', 'POR',
  'BUSCO', 'NECESITO', 'TIENEN', 'PRECIO', 'VALOR', 'REPUESTO', 'REPUESTOS',
  'AUTO', 'VEHICULO', 'PATENTE', 'PPU', 'AÑO', 'ANIO', 'MOTOR',
]);

export function normalizarConsultaBuscador(texto = '') {
  let t = String(texto || '');
  for (const [regex, reemplazo] of REEMPLAZOS_AUTOMOTRICES_BUSCADOR) {
    t = t.replace(regex, reemplazo);
  }
  return t
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extraerPatenteChilena(texto = '') {
  const limpio = String(texto || '').toUpperCase();
  const explicito = limpio.match(
    /\b(?:PATENTE|PPU)\s*[:#-]?\s*([B-DF-HJ-NP-TV-Z]{4}[-\s·]?\d{2}|[A-Z]{2}[-\s·]?\d{4})\b/
  );
  if (explicito) return explicito[1].replace(/[-\s·]/g, '');

  const moderna = limpio.match(/\b([B-DF-HJ-NP-TV-Z]{4})[-\s·]?(\d{2})\b/);
  if (moderna) return `${moderna[1]}${moderna[2]}`;
  return null;
}

// Solo campos públicos — nunca precioCompra, proveedor, proveedorId, stockReservado, stockMinimo
function sanitizarItem(doc) {
  const d = typeof doc.data === 'function' ? doc.data() : doc;
  const id = doc.id || d.id;
  const disponible = round2(Math.max(0, (d.stock || 0) - (d.stockReservado || 0)));
  const wooProductId = Number(d.wooProductId) || null;
  const baseUrl = obtenerUrlBaseTiendaWoo();
  const skuPublicoFrp = d.skuPublicoFrp || d.codigo || '';

  return {
    id,
    nombre: d.nombre || '',
    descripcion: d.descripcion || '',
    codigo: d.codigo || '',
    skuPublicoFrp,
    fabricante: d.fabricante || '',
    equivalencias: d.equivalencias || [],
    categoria: d.categoria || '',
    subcategoria: d.subcategoria || '',
    subcategoriaDetalle: d.subcategoriaDetalle || '',
    tipoPieza: d.tipoPieza || '',
    posicion: d.posicion || 'NO APLICA',
    lado: d.lado || 'NO APLICA',
    marcasCompatibles: Array.isArray(d.marcasCompatibles) ? d.marcasCompatibles : [],
    modelosCompatibles: d.modelosCompatibles || [],
    anioDesde: d.anioDesde || null,
    anioHasta: d.anioHasta || null,
    precio: Number(d.precioVenta || d.precioCompra || 0),
    unidad: d.unidad || 'unidad',
    disponible,
    enStock: disponible > 0,
    ocultarEnTienda: Boolean(d.ocultarEnTienda),
    wooProductId,
    urlProductoWoo: wooProductId
      ? `${baseUrl}/?p=${wooProductId}`
      : `${baseUrl}/?s=${encodeURIComponent(skuPublicoFrp || d.nombre || '')}&post_type=product`,
    urlAgregarAlCarroWoo: wooProductId
      ? `${baseUrl}/?add-to-cart=${wooProductId}&quantity=1`
      : `${baseUrl}/?s=${encodeURIComponent(skuPublicoFrp || d.nombre || '')}&post_type=product`,
  };
}

async function obtenerInventarioPublicoCacheado({ forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && cacheInventarioPublico.items && ahora < cacheInventarioPublico.expiraEn) {
    return cacheInventarioPublico.items;
  }
  const snap = await db.collection('inventario').get();
  const items = snap.docs
    .map(sanitizarItem)
    .filter((i) => !i.ocultarEnTienda);
  cacheInventarioPublico = {
    items,
    expiraEn: ahora + CACHE_TTL_MS,
  };
  return items;
}

function construirPuenteWhatsapp({ consultaOriginal = '', vehiculo = null, candidatos = [] }) {
  const consultaLimpia = String(consultaOriginal || '').trim();
  const etiquetaAuto = vehiculo
    ? `${vehiculo.marca || ''} ${vehiculo.modelo || ''} ${vehiculo.anio || ''} (Patente ${vehiculo.patente})`.replace(/\s+/g, ' ').trim()
    : '';
  const primerCandidato = candidatos[0] || null;

  let mensajePrellenado = 'Hola Repuestín! 👋 Vengo desde facilrepuestos.cl.';
  if (consultaLimpia && etiquetaAuto) {
    mensajePrellenado = `Hola Repuestín! 👋 Busqué en facilrepuestos.cl "${consultaLimpia}" para mi ${etiquetaAuto}.`;
  } else if (consultaLimpia) {
    mensajePrellenado = `Hola Repuestín! 👋 Busqué en facilrepuestos.cl "${consultaLimpia}" y quiero confirmar compatibilidad con mi patente.`;
  } else if (etiquetaAuto) {
    mensajePrellenado = `Hola Repuestín! 👋 Quiero cotizar un repuesto para mi ${etiquetaAuto}.`;
  }

  if (primerCandidato) {
    mensajePrellenado += ` Vi la opción ${primerCandidato.nombre} (${primerCandidato.skuPublicoFrp || primerCandidato.codigo}) a $${Number(primerCandidato.precio || 0).toLocaleString('es-CL')}. ¿Me confirmas si le calza y me armas el carro de compra?`;
  } else {
    mensajePrellenado += ' ¿Me ayudas a revisarlo en bodega y armarme el carro de compra?';
  }

  return {
    telefonoWhatsapp: `+${WHATSAPP_PUBLIC_NUMBER}`,
    mensajePrellenado,
    urlWhatsapp: `https://wa.me/${WHATSAPP_PUBLIC_NUMBER}?text=${encodeURIComponent(mensajePrellenado)}`,
    textoBoton: candidatos.length > 0
      ? '📲 Confirmar calce con mi Patente y recibir Carro por WhatsApp'
      : '📲 Consultar esta pieza por WhatsApp con Repuestín (Respuesta inmediata)',
  };
}

// GET /api/public/categorias-arbol
// Devuelve el árbol oficial de 9 categorías y 3 niveles para menús o buscadores en WordPress
router.get('/categorias-arbol', (_req, res) => {
  res.json({
    success: true,
    totalCategorias: ARBOL_CATEGORIAS_TIENDA.length,
    data: ARBOL_CATEGORIAS_TIENDA,
  });
});

// GET /api/public/buscador-inteligente
// Buscador determinístico automotriz ($0 tokens Gemini) para la barra de búsqueda de WordPress.
// Soporta jerga chilena, detección de patente, filtro de 3 niveles de categoría, links de carro WooCommerce
// y genera el puente Click-to-WhatsApp (wa.me) para capturar el teléfono + patente sin costo de apertura Meta.
router.get('/buscador-inteligente', async (req, res, next) => {
  try {
    const {
      q = '',
      search = '',
      patente = '',
      categoria = '',
      subcategoria = '',
      subcategoriaDetalle = '',
      marca = '',
      soloDisponibles = 'true',
      limit = '12',
    } = req.query;

    const consultaRaw = String(q || search || '').trim();
    const consultaNorm = normalizarConsultaBuscador(consultaRaw);
    const patenteDetectada =
      String(patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '') ||
      extraerPatenteChilena(consultaRaw);

    let vehiculoDetectado = null;
    if (patenteDetectada && patenteDetectada.length === 6) {
      try {
        const snapVeh = await db
          .collection('vehiculos')
          .where('patente', '==', patenteDetectada)
          .limit(1)
          .get();
        if (!snapVeh.empty) {
          const v = snapVeh.docs[0].data();
          vehiculoDetectado = {
            patente: patenteDetectada,
            marca: String(v.marca || '').toUpperCase(),
            modelo: String(v.modelo || '').toUpperCase(),
            anio: Number(v.anio || v.año || 0) || null,
            motor: String(v.motor || v.version || ''),
            vin: String(v.vin || v.chasis || ''),
          };
        }
      } catch {
        // Ignorar fallo puntual
      }
    }

    const todos = await obtenerInventarioPublicoCacheado();
    let candidatos = todos;

    if (soloDisponibles !== 'false') {
      candidatos = candidatos.filter((i) => i.enStock && i.precio > 0);
    }
    if (categoria) {
      const catNorm = normCat(categoria);
      candidatos = candidatos.filter((i) => normCat(i.categoria) === catNorm);
    }
    if (subcategoria) {
      const subNorm = normCat(subcategoria);
      candidatos = candidatos.filter((i) => normCat(i.subcategoria) === subNorm);
    }
    if (subcategoriaDetalle) {
      const detNorm = normCat(subcategoriaDetalle);
      candidatos = candidatos.filter((i) => normCat(i.subcategoriaDetalle) === detNorm);
    }
    if (marca) {
      const marcaNorm = normCat(marca);
      candidatos = candidatos.filter(
        (i) =>
          (Array.isArray(i.marcasCompatibles) && i.marcasCompatibles.some((m) => normCat(m) === marcaNorm)) ||
          normCat(i.nombre).includes(marcaNorm)
      );
    }

    const tokens = consultaNorm
      .replace(patenteDetectada || '', ' ')
      .split(/[^A-Z0-9.-]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS_BUSCADOR.has(t));

    if (tokens.length > 0 || vehiculoDetectado) {
      candidatos = candidatos
        .map((item) => {
          let score = 0;
          const textoItem = normCat(
            [
              item.nombre,
              item.descripcion,
              item.codigo,
              item.skuPublicoFrp,
              item.fabricante,
              item.categoria,
              item.subcategoria,
              item.subcategoriaDetalle,
              ...(Array.isArray(item.marcasCompatibles) ? item.marcasCompatibles : []),
            ].join(' ')
          );

          for (const tok of tokens) {
            if (normCat(item.codigo) === tok || normCat(item.skuPublicoFrp) === tok) {
              score += 20;
            } else if (textoItem.includes(tok)) {
              score += 5;
            }
          }

          if (vehiculoDetectado?.marca) {
            if (textoItem.includes(normCat(vehiculoDetectado.marca))) score += 6;
          }
          if (vehiculoDetectado?.modelo) {
            if (textoItem.includes(normCat(vehiculoDetectado.modelo))) score += 8;
          }

          return { item, score };
        })
        .filter((x) => (tokens.length > 0 ? x.score >= 5 : x.score > 0))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item);
    }

    const maxLimit = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 12));
    const resultados = candidatos.slice(0, maxLimit);
    const linksCarro = construirLinksCarroWooCommerce(resultados.slice(0, 1));
    const puenteWhatsapp = construirPuenteWhatsapp({
      consultaOriginal: consultaRaw,
      vehiculo: vehiculoDetectado,
      candidatos: resultados,
    });

    res.json({
      success: true,
      costoTokensGemini: 0,
      consultaNormalizada: consultaNorm,
      vehiculoDetectado,
      totalCoincidencias: candidatos.length,
      mostrando: resultados.length,
      carroWooCommerceSugerido: linksCarro.urlCarroPrincipal,
      puenteWhatsapp,
      data: resultados,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/inventario
// Query params opcionales: ?categoria=Motor ?subcategoria=... ?search=pastilla ?soloDisponibles=true
router.get('/inventario', requireApiKey, async (req, res, next) => {
  try {
    const { categoria, subcategoria, subcategoriaDetalle, search, soloDisponibles } = req.query;

    let items = await obtenerInventarioPublicoCacheado();

    if (categoria) {
      const catNorm = normCat(categoria);
      items = items.filter((i) => normCat(i.categoria) === catNorm);
    }
    if (subcategoria) {
      const subNorm = normCat(subcategoria);
      items = items.filter((i) => normCat(i.subcategoria) === subNorm);
    }
    if (subcategoriaDetalle) {
      const detNorm = normCat(subcategoriaDetalle);
      items = items.filter((i) => normCat(i.subcategoriaDetalle) === detNorm);
    }
    if (search) {
      const q = normalizarConsultaBuscador(search);
      items = items.filter(
        (i) =>
          normCat(i.nombre).includes(q) ||
          normCat(i.codigo).includes(q) ||
          normCat(i.skuPublicoFrp).includes(q) ||
          normCat(i.fabricante).includes(q)
      );
    }
    if (soloDisponibles === 'true') {
      items = items.filter((i) => i.enStock);
    }

    res.json({ success: true, total: items.length, data: items });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/inventario/:id — detalle de un ítem puntual
router.get('/inventario/:id', requireApiKey, async (req, res, next) => {
  try {
    const doc = await db.collection('inventario').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    res.json({ success: true, data: sanitizarItem(doc) });
  } catch (error) {
    next(error);
  }
});

export default router;
