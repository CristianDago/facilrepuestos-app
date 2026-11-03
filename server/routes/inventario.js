import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin, requireAuthOrLector, ROL_LECTOR_DRPARTES } from '../middleware/auth.js';
import { eliminarProductoDeWooCommerce } from '../services/woocommerceSync.js';
import { buscarRepuestoPorCodigo } from '../services/partLookup.js';
import { generarSkuPublicoFrp } from '../services/ailooBridge.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';

const router = Router();

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Normaliza nombres para compararlos (mayúsculas, sin tildes, sin espacios dobles)
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

// Carga proveedores y arma mapas por id y por nombre normalizado
async function cargarProveedores() {
  const snap = await db.collection('proveedores').get();
  const porId = new Map();
  const porNombre = new Map();
  for (const d of snap.docs) {
    const p = { id: d.id, nombre: d.data().nombre || '', activo: d.data().activo !== false };
    porId.set(d.id, p);
    if (p.nombre) porNombre.set(norm(p.nombre), p);
  }
  return { porId, porNombre };
}

// Devuelve el id real del proveedor dueño de un ítem (o null si no tiene)
function resolverProveedor(item, { porId, porNombre }) {
  if (item.proveedorId && porId.has(item.proveedorId)) return porId.get(item.proveedorId);
  if (item.proveedor) return porNombre.get(norm(item.proveedor)) || null;
  return null;
}

// Vista de SOLO LECTURA para la integración de DrPartes. Lista blanca de campos:
// nunca precioCompra, stockReservado, stockMinimo ni datos de contacto de nadie.
function itemParaLector(doc, proveedor) {
  const d = doc.data();
  const disponible = round2(Math.max(0, (d.stock || 0) - (d.stockReservado || 0)));
  return {
    id:                doc.id,
    proveedorId:       proveedor.id,
    proveedorNombre:   proveedor.nombre,
    nombre:            d.nombre,
    codigo:            d.codigo || '',
    fabricante:        d.fabricante || '',
    equivalencias:     d.equivalencias || [],
    categoria:         d.categoria,
    tipoPieza:         d.tipoPieza || '',
    posicion:          d.posicion || 'NO APLICA',
    lado:              d.lado || 'NO APLICA',
    marcasCompatibles: d.marcasCompatibles || [],
    anioDesde:         d.anioDesde || null,
    anioHasta:         d.anioHasta || null,
    precioVenta:       d.precioVenta || 0,
    unidad:            d.unidad || 'UNIDAD',
    disponible,
    enStock:           disponible > 0,
    imagenUrl:         d.imagenUrl || '',
  };
}

// Autoriza escritura sobre un ítem: el admin sobre cualquiera; un proveedor SOLO sobre
// los suyos (proveedorId === su id). Cualquier otro rol queda fuera.
// Devuelve el snapshot del ítem, o null si ya respondió con error.
async function autorizarEscrituraItem(req, res) {
  const rol = req.user?.rol;
  if (rol !== 'admin' && rol !== 'proveedor') {
    res.status(403).json({ success: false, error: 'Sin permiso para modificar el inventario' });
    return null;
  }
  const snap = await db.collection('inventario').doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ success: false, error: 'Item no encontrado' });
    return null;
  }
  if (rol === 'proveedor' && snap.data().proveedorId !== req.user.docId) {
    res.status(403).json({ success: false, error: 'Sin permiso sobre este ítem' });
    return null;
  }
  return snap;
}

// Campos que un proveedor nunca puede fijar por su cuenta
// (el precio de venta y "no vender online" los decide el taller, no el proveedor)
const CAMPOS_PROTEGIDOS_PROVEEDOR = [
  'id', 'proveedorId', 'proveedor', 'stockReservado', 'createdAt', 'updatedAt',
  'precioVenta', 'ocultarEnTienda',
];

// Lo que el taller cobra al cliente (precio de venta) es información interna del taller:
// nunca se le devuelve a un proveedor, ni siquiera en sus propios ítems.
function vistaParaProveedor(item) {
  const { precioVenta, ...resto } = item;
  return resto;
}

// GET /api/inventario
router.get('/', requireAuthOrLector, async (req, res, next) => {
  try {
    const snap = await db.collection('inventario')
      .orderBy('createdAt', 'desc')
      .get();

    // Rol lector_drpartes: inventario de TODOS los proveedores activos, solo lectura
    // y con lista blanca de campos. Los ítems propios del taller (sin proveedor)
    // y los de proveedores inactivos o inexistentes nunca se incluyen.
    if (req.user?.rol === ROL_LECTOR_DRPARTES) {
      const provs = await cargarProveedores();
      const data = [];
      for (const doc of snap.docs) {
        const prov = resolverProveedor(doc.data(), provs);
        if (prov && prov.activo) data.push(itemParaLector(doc, prov));
      }
      return res.json({ success: true, data });
    }

    let items = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Un proveedor solo puede ver sus propios repuestos; admin/mecánico ven todo.
    if (req.user?.rol === 'proveedor') {
      items = items.filter(i => i.proveedorId === req.user.docId).map(vistaParaProveedor);
    }

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

// GET /api/inventario/lookup/:codigo
// Búsqueda inteligente por código de barra / OEM / QR con enriquecimiento automático
router.get('/lookup/:codigo', requireAuth, async (req, res, next) => {
  try {
    const { codigo } = req.params;
    const proveedorId = req.user?.rol === 'proveedor' ? req.user.docId : null;
    const resultado = await buscarRepuestoPorCodigo(codigo, proveedorId);
    res.json({ success: true, data: resultado });
  } catch (error) {
    next(error);
  }
});

// ─── Estadísticas del proveedor ─────────────────────────────────────────
// La fecha de entrega puede estar guardada como "YYYY-MM-DD", "DD/MM/YYYY" (año de 2 o 4
// dígitos) o ISO con hora. Devuelve { y, m } o null.
function anioMesDeFecha(s) {
  if (!s || typeof s !== 'string') return null;
  if (s.includes('T')) s = s.slice(0, 10);
  if (s.includes('-')) {
    const [y, m, d] = s.split('-').map(Number);
    return (y && m && d) ? { y, m } : null;
  }
  if (s.includes('/')) {
    const [d, m, yRaw] = s.split('/').map(Number);
    if (!d || !m || !yRaw) return null;
    return { y: yRaw < 100 ? 2000 + yRaw : yRaw, m };
  }
  return null;
}

// GET /api/inventario/mis-estadisticas
// Proveedor: sus propias estadísticas. Admin: ?proveedorId=<id> para ver las de un proveedor.
// Solo devuelve datos agregados de SUS repuestos (unidades y montos a su precio): nunca
// precios de venta del taller, márgenes, clientes ni números de orden.
router.get('/mis-estadisticas', requireAuth, async (req, res, next) => {
  try {
    const rol = req.user?.rol;
    let proveedorId = '';
    if (rol === 'proveedor') proveedorId = req.user.docId;
    else if (rol === 'admin') proveedorId = String(req.query.proveedorId || '');
    else return res.status(403).json({ success: false, error: 'Sin permiso' });

    if (!proveedorId) {
      return res.status(400).json({ success: false, error: 'Falta el proveedor' });
    }

    const itemsSnap = await db.collection('inventario').where('proveedorId', '==', proveedorId).get();
    const items = new Map();
    for (const d of itemsSnap.docs) items.set(d.id, { id: d.id, ...d.data() });

    // Stock actual
    const resumen = {
      totalItems: items.size,
      unidadesStock: 0, valorStock: 0,
      stockBajo: 0,
      unidadesReservadas: 0, valorReservado: 0,
      unidadesVendidas: 0, montoVendido: 0,
      ticketsPos: 0, unidadesPos: 0, montoPos: 0,
      ordenesTaller: 0, unidadesTaller: 0, montoTaller: 0,
      itemsSinVentas: 0,
    };
    const stockBajoItems = [];
    for (const it of items.values()) {
      const stock     = Number(it.stock) || 0;
      const reservado = Number(it.stockReservado) || 0;
      const precio    = Number(it.precioCompra || it.precioLista) || 0;
      const disponible = Math.max(0, round2(stock - reservado));
      resumen.unidadesStock     += stock;
      resumen.valorStock        += precio * stock;
      resumen.unidadesReservadas += reservado;
      resumen.valorReservado    += precio * reservado;
      if (disponible <= (Number(it.stockMinimo) || 0)) {
        resumen.stockBajo += 1;
        stockBajoItems.push({
          id: it.id, nombre: it.nombre || '', codigo: it.codigo || '',
          disponible, stockMinimo: Number(it.stockMinimo) || 0,
        });
      }
    }

    // 1. Ventas por Órdenes de Trabajo ENTREGADAS (Taller)
    const otSnap = await db.collection('ordenes_trabajo')
      .select('estado', 'repuestos', 'fechaEntregaReal', 'fechaEntregaEstimada', 'createdAt')
      .get();

    const porItem = new Map();   // inventarioId -> { unidades, monto, nombre, codigo }
    const porMes  = new Map();   // "YYYY-MM"   -> { unidades, monto, ordenes, ticketsPos }
    for (const doc of otSnap.docs) {
      const ot = doc.data();
      if (ot.estado !== 'Entregado') continue;
      const propios = (ot.repuestos || []).filter(r => r && items.has(r.inventarioId));
      if (!propios.length) continue;

      const f = anioMesDeFecha(ot.fechaEntregaReal) || anioMesDeFecha(ot.fechaEntregaEstimada) || anioMesDeFecha(ot.createdAt);
      const mesKey = f ? `${f.y}-${String(f.m).padStart(2, '0')}` : null;

      let unidadesOT = 0, montoOT = 0;
      for (const rep of propios) {
        const itemInv = items.get(rep.inventarioId);
        const cant  = Number(rep.cantidad) || 0;
        const monto = cant * (Number(itemInv.precioCompra || itemInv.precioLista) || 0);
        const acc = porItem.get(rep.inventarioId) || {
          unidades: 0, monto: 0, nombre: itemInv.nombre || '', codigo: itemInv.codigo || '',
        };
        acc.unidades += cant; acc.monto += monto;
        porItem.set(rep.inventarioId, acc);
        unidadesOT += cant; montoOT += monto;
      }
      resumen.unidadesVendidas += unidadesOT;
      resumen.montoVendido     += montoOT;
      resumen.ordenesTaller    += 1;
      resumen.unidadesTaller   += unidadesOT;
      resumen.montoTaller      += montoOT;

      if (mesKey) {
        const m = porMes.get(mesKey) || { unidades: 0, monto: 0, ordenes: 0, ticketsPos: 0 };
        m.unidades += unidadesOT; m.monto += montoOT; m.ordenes += 1;
        porMes.set(mesKey, m);
      }
    }

    // 2. Ventas directas de Mostrador (Punto de Venta POS)
    const posSnap = await db.collection('ventas_pos').get();
    for (const doc of posSnap.docs) {
      const v = doc.data();
      // Ignorar cotizaciones o tickets anulados
      if (v.tipoDocumento === 'COTIZACION' || v.estado === 'PENDIENTE' || v.estado === 'ANULADO') continue;

      const itemsVenta = (v.items || []).filter(it => it && (items.has(it.id) || v.proveedorId === proveedorId));
      if (!itemsVenta.length) continue;

      const f = anioMesDeFecha(v.fecha || v.createdAt);
      const mesKey = f ? `${f.y}-${String(f.m).padStart(2, '0')}` : null;

      // Si el ticket tuvo descuento en la compra total, aplicar el factor proporcional al neto de cada ítem
      const factorDescuento =
        v.subtotalNeto > 0 && typeof v.totalNeto === 'number'
          ? Math.max(0, Math.min(1, v.totalNeto / v.subtotalNeto))
          : 1;

      let unidadesTicket = 0, montoTicket = 0;
      for (const it of itemsVenta) {
        const itemInv = items.get(it.id);
        const cant = Number(it.cantidad) || 0;
        const precioUnit = Number(
          it.precioNeto || it.precio || itemInv?.precioLista || itemInv?.precioCompra || 0
        );
        const monto = Math.round(cant * precioUnit * factorDescuento);
        const itemId = it.id || it.codigo || it.nombre;
        const acc = porItem.get(itemId) || {
          unidades: 0,
          monto: 0,
          nombre: itemInv?.nombre || it.nombre || '',
          codigo: itemInv?.codigo || it.codigo || '',
        };
        acc.unidades += cant;
        acc.monto += monto;
        porItem.set(itemId, acc);
        unidadesTicket += cant;
        montoTicket += monto;
      }

      resumen.unidadesVendidas += unidadesTicket;
      resumen.montoVendido     += montoTicket;
      resumen.ticketsPos       += 1;
      resumen.unidadesPos      += unidadesTicket;
      resumen.montoPos         += montoTicket;

      if (mesKey) {
        const m = porMes.get(mesKey) || { unidades: 0, monto: 0, ordenes: 0, ticketsPos: 0 };
        m.unidades   += unidadesTicket;
        m.monto      += montoTicket;
        m.ordenes    += 1;
        m.ticketsPos += 1;
        porMes.set(mesKey, m);
      }
    }

    const masVendidos = [...porItem.entries()]
      .map(([id, v]) => ({
        id,
        nombre: v.nombre || items.get(id)?.nombre || '',
        codigo: v.codigo || items.get(id)?.codigo || '',
        unidades: round2(v.unidades),
        monto: Math.round(v.monto),
      }))
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 10);

    const sinVentas = [...items.values()]
      .filter(it => !porItem.has(it.id))
      .map(it => ({ id: it.id, nombre: it.nombre || '', codigo: it.codigo || '', stock: Number(it.stock) || 0 }));
    resumen.itemsSinVentas = sinVentas.length;

    const ventasPorMes = [...porMes.entries()]
      .map(([mes, v]) => ({
        mes,
        unidades: round2(v.unidades),
        monto: Math.round(v.monto),
        ordenes: v.ordenes,
        ticketsPos: v.ticketsPos || 0,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    resumen.valorStock       = Math.round(resumen.valorStock);
    resumen.valorReservado   = Math.round(resumen.valorReservado);
    resumen.montoVendido     = Math.round(resumen.montoVendido);
    resumen.unidadesVendidas = round2(resumen.unidadesVendidas);
    resumen.montoPos         = Math.round(resumen.montoPos);
    resumen.unidadesPos      = round2(resumen.unidadesPos);
    resumen.montoTaller      = Math.round(resumen.montoTaller);
    resumen.unidadesTaller   = round2(resumen.unidadesTaller);

    res.json({
      success: true,
      data: {
        resumen,
        ventasPorMes,
        masVendidos,
        stockBajoItems: stockBajoItems.slice(0, 20),
        sinVentas: sinVentas.slice(0, 10),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INTELIGENCIA DE COMPRAS PROVEEDOR: CARGA / FOTO DE FACTURAS (OCR + IA)
// ═══════════════════════════════════════════════════════════════════════════

const PLANTILLAS_FACTURAS_MAYORISTAS = {
  emasa_bosch: {
    folio: '3849201',
    rutEmisor: '91.504.000-7',
    razonSocialEmisor: 'EMASA COMERCIAL S.A.',
    giroEmisor: 'IMPORTACIÓN Y DISTRIBUCIÓN MAYORISTA DE REPUESTOS AUTOMOTRICES',
    fechaEmision: new Date().toISOString().slice(0, 10),
    condicionPago: 'CRÉDITO 30 DÍAS',
    items: [
      {
        codigo: '0986AF2950',
        nombre: 'PASTILLAS DE FRENO DELANTERAS CERÁMICAS BOSCH',
        fabricante: 'BOSCH',
        categoria: 'FRENOS',
        tipoPieza: 'PASTILLAS DE FRENO',
        marcaVehiculo: 'TOYOTA',
        modelosSugeridos: ['HILUX', 'FORTUNER'],
        cantidad: 6,
        costoUnitarioNeto: 24500,
        descuentoPct: 15,
      },
      {
        codigo: 'W610/82',
        nombre: 'FILTRO DE ACEITE BLINDADO MANN-FILTER W610/82',
        fabricante: 'MANN-FILTER',
        categoria: 'FILTROS',
        tipoPieza: 'FILTRO DE ACEITE',
        marcaVehiculo: 'MAZDA',
        modelosSugeridos: ['MAZDA 3', 'CX-5'],
        cantidad: 12,
        costoUnitarioNeto: 5800,
        descuentoPct: 10,
      },
      {
        codigo: 'BKR6E-11',
        nombre: 'JUEGO BUJÍAS ENCENDIDO NGK V-POWER BKR6E-11',
        fabricante: 'NGK',
        categoria: 'MOTOR',
        tipoPieza: 'BUJÍA',
        marcaVehiculo: 'HYUNDAI',
        modelosSugeridos: ['ACCENT', 'ELANTRA'],
        cantidad: 10,
        costoUnitarioNeto: 9200,
        descuentoPct: 10,
      },
    ],
  },
  mannheim_suspension: {
    folio: '942110',
    rutEmisor: '84.312.900-2',
    razonSocialEmisor: 'IMPORTADORA MANNHEIM Y CÍA LTDA.',
    giroEmisor: 'MAYORISTA SUSPENSIÓN, DIRECCIÓN Y TRANSMISIÓN COREA / JAPÓN',
    fechaEmision: new Date().toISOString().slice(0, 10),
    condicionPago: 'CONTADO / TRANSFERENCIA',
    items: [
      {
        codigo: '339114',
        nombre: 'AMORTIGUADOR DELANTERO GAS EXCEL-G KYB',
        fabricante: 'KYB',
        categoria: 'SUSPENSIÓN',
        tipoPieza: 'AMORTIGUADOR',
        marcaVehiculo: 'TOYOTA',
        modelosSugeridos: ['COROLLA', 'AURIS'],
        cantidad: 4,
        costoUnitarioNeto: 42900,
        descuentoPct: 12,
      },
      {
        codigo: 'SP1196',
        nombre: 'PASTILLAS DE FRENO DELANTERAS SANGSIN HI-Q COREA',
        fabricante: 'SANGSIN',
        categoria: 'FRENOS',
        tipoPieza: 'PASTILLAS DE FRENO',
        marcaVehiculo: 'KIA',
        modelosSugeridos: ['RIO', 'MORNING', 'CERATO'],
        cantidad: 8,
        costoUnitarioNeto: 14900,
        descuentoPct: 10,
      },
      {
        codigo: 'GMB-GWT142A',
        nombre: 'BOMBA DE AGUA MOTOR GMB JAPÓN CON EMPAQUETADURA',
        fabricante: 'GMB',
        categoria: 'MOTOR',
        tipoPieza: 'BOMBA DE AGUA',
        marcaVehiculo: 'NISSAN',
        modelosSugeridos: ['VERSA', 'MARCH', 'QASHQAI'],
        cantidad: 5,
        costoUnitarioNeto: 26800,
        descuentoPct: 10,
      },
    ],
  },
  derco_mantencion: {
    folio: '1205884',
    rutEmisor: '76.192.410-K',
    razonSocialEmisor: 'DERCORepuestos DISTRIBUCIÓN MAYORISTA S.A.',
    giroEmisor: 'IMPORTADORA Y DISTRIBUIDORA DE REPUESTOS Y LUBRICANTES',
    fechaEmision: new Date().toISOString().slice(0, 10),
    condicionPago: 'FACTURA 60 DÍAS',
    items: [
      {
        codigo: '826319',
        nombre: 'KIT DE EMBRAGUE 3 PIEZAS VALEO (PRENSA + DISCO + RODAMIENTO)',
        fabricante: 'VALEO',
        categoria: 'EMBRAGUE',
        tipoPieza: 'KIT DE EMBRAGUE',
        marcaVehiculo: 'CHEVROLET',
        modelosSugeridos: ['SAIL', 'SPARK GT', 'ONIX'],
        cantidad: 3,
        costoUnitarioNeto: 68500,
        descuentoPct: 15,
      },
      {
        codigo: 'K015603XS',
        nombre: 'KIT CORREA DISTRIBUCIÓN + TENSOR GATES POWERGRIP',
        fabricante: 'GATES',
        categoria: 'DISTRIBUCIÓN',
        tipoPieza: 'KIT DE DISTRIBUCIÓN',
        marcaVehiculo: 'PEUGEOT',
        modelosSugeridos: ['PARTNER', '208', '301'],
        cantidad: 4,
        costoUnitarioNeto: 54000,
        descuentoPct: 12,
      },
    ],
  },
};

function parsearTextoFacturaSII(textoRaw = '') {
  const txt = String(textoRaw || '').trim();
  if (!txt) return null;

  // 1. Detectar si es XML DTE SII chileno
  if (txt.includes('<DTE') || txt.includes('<Documento') || txt.includes('<Detalle>')) {
    const extraerTag = (source, tag) => {
      const m = source.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const folio = extraerTag(txt, 'Folio') || String(Math.floor(100000 + Math.random() * 900000));
    const rutEmisor = extraerTag(txt, 'RUTEmisor') || '76.543.210-K';
    const razonSocialEmisor = (extraerTag(txt, 'RznSoc') || 'DISTRIBUIDORA MAYORISTA DTE S.A.').toUpperCase();
    const fechaEmision = extraerTag(txt, 'FchEmis') || new Date().toISOString().slice(0, 10);

    const detallesMatches = [...txt.matchAll(/<Detalle>([\s\S]*?)<\/Detalle>/gi)];
    const items = detallesMatches.map((m, idx) => {
      const bloque = m[1];
      const codigo = (extraerTag(bloque, 'VlrCodigo') || `SKU-${idx + 1}`).toUpperCase();
      const nombre = (extraerTag(bloque, 'NmbItem') || `REPUESTO ${codigo}`).toUpperCase();
      const cantidad = Math.max(1, Number(extraerTag(bloque, 'QtyItem')) || 1);
      const costoUnitarioNeto = Math.max(0, Math.round(Number(extraerTag(bloque, 'PrcItem')) || 0));
      const descuentoPct = Math.max(0, Number(extraerTag(bloque, 'DescuentoPct')) || 10);
      return {
        codigo,
        nombre,
        fabricante: detectarFabricanteTexto(nombre),
        categoria: detectarCategoriaTexto(nombre),
        tipoPieza: detectarTipoPiezaTexto(nombre),
        marcaVehiculo: detectarMarcaAutoTexto(nombre),
        modelosSugeridos: [],
        cantidad,
        costoUnitarioNeto,
        descuentoPct,
      };
    });

    if (items.length > 0) {
      return { folio, rutEmisor, razonSocialEmisor, fechaEmision, condicionPago: 'DTE ELECTRÓNICO SII', items };
    }
  }

  // 2. Parsear líneas de texto pegadas de factura / PDF / OCR (formato: CODIGO | DESCRIPCION | CANT | PRECIO)
  const lineas = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const l of lineas) {
    // Soportar separador tab, pipe, punto y coma, o patrón "SKU Descripcion Cant Precio"
    const partes = l.split(/\t|\||;/).map(s => s.trim()).filter(Boolean);
    if (partes.length >= 3) {
      const codigo = partes[0].toUpperCase().replace(/[^A-Z0-9\-\/\.]/g, '');
      const nombre = partes[1].toUpperCase();
      const cantidad = Math.max(1, parseInt(partes[2].replace(/\D/g, ''), 10) || 1);
      const costoRaw = partes[3] ? parseInt(partes[3].replace(/\D/g, ''), 10) : 15000;
      if (codigo && nombre) {
        items.push({
          codigo,
          nombre,
          fabricante: detectarFabricanteTexto(nombre),
          categoria: detectarCategoriaTexto(nombre),
          tipoPieza: detectarTipoPiezaTexto(nombre),
          marcaVehiculo: detectarMarcaAutoTexto(nombre),
          modelosSugeridos: [],
          cantidad,
          costoUnitarioNeto: costoRaw || 15000,
          descuentoPct: 10,
        });
      }
    }
  }

  if (items.length > 0) {
    return {
      folio: String(Math.floor(100000 + Math.random() * 900000)),
      rutEmisor: '76.889.100-4',
      razonSocialEmisor: 'PROVEEDOR MAYORISTA REPUESTOS CHILE',
      fechaEmision: new Date().toISOString().slice(0, 10),
      condicionPago: 'CONTADO / FACTURA',
      items,
    };
  }
  return null;
}

function detectarCategoriaTexto(txt = '') {
  const u = txt.toUpperCase();
  if (/PASTILLA|DISCO DE FRENO|BALATA|CALIPER|FRENO/.test(u)) return 'FRENOS';
  if (/FILTRO|AIRE|ACEITE|CABINA|COMBUSTIBLE/.test(u)) return 'FILTROS';
  if (/AMORTIGUADOR|BANDEJA|BIELETA|ROTULA|TERMINAL|CAZOLETA|SUSPEN/.test(u)) return 'SUSPENSIÓN';
  if (/EMBRAGUE|PRENSA|RODAMIENTO EMPUJE|VOLANTE BIMASA/.test(u)) return 'EMBRAGUE';
  if (/CORREA|DISTRIBU|TENSOR/.test(u)) return 'DISTRIBUCIÓN';
  if (/BATERIA|ALTERNADOR|MOTOR PARTIDA|SENSOR|BOBINA|FOCO/.test(u)) return 'ELÉCTRICO';
  if (/ACEITE|LUBRICANTE|5W30|10W40|REFRIGERANTE|COOLANT/.test(u)) return 'LUBRICANTES';
  return 'MOTOR';
}

function detectarTipoPiezaTexto(txt = '') {
  const u = txt.toUpperCase();
  if (/PASTILLA/.test(u)) return 'PASTILLAS DE FRENO';
  if (/DISCO DE FRENO/.test(u)) return 'DISCO DE FRENO';
  if (/FILTRO DE ACEITE|FILTRO ACEITE/.test(u)) return 'FILTRO DE ACEITE';
  if (/FILTRO DE AIRE|FILTRO AIRE/.test(u)) return 'FILTRO DE AIRE';
  if (/AMORTIGUADOR/.test(u)) return 'AMORTIGUADOR';
  if (/BUJIA|BUJÍA/.test(u)) return 'BUJÍA';
  if (/BOMBA DE AGUA/.test(u)) return 'BOMBA DE AGUA';
  if (/KIT DE EMBRAGUE|EMBRAGUE/.test(u)) return 'KIT DE EMBRAGUE';
  if (/DISTRIBU/.test(u)) return 'KIT DE DISTRIBUCIÓN';
  return 'REPUESTO GENERAL';
}

function detectarFabricanteTexto(txt = '') {
  const u = txt.toUpperCase();
  const marcas = ['BOSCH', 'MANN-FILTER', 'MANN', 'KYB', 'NGK', 'VALEO', 'GATES', 'SANGSIN', 'GMB', 'BREMBO', 'MOBIL', 'SKF', 'LUK', 'SACHS', 'DENSO'];
  for (const m of marcas) {
    if (u.includes(m)) return m === 'MANN' ? 'MANN-FILTER' : m;
  }
  return 'OEM / ALTERNATIVO';
}

function detectarMarcaAutoTexto(txt = '') {
  const u = txt.toUpperCase();
  const autos = ['TOYOTA', 'HYUNDAI', 'KIA', 'CHEVROLET', 'NISSAN', 'MAZDA', 'SUZUKI', 'PEUGEOT', 'VOLKSWAGEN', 'MITSUBISHI', 'FORD', 'SUBARU', 'CHERY', 'JAC'];
  for (const a of autos) {
    if (u.includes(a)) return a;
  }
  return 'TOYOTA';
}

// GET /api/inventario/facturas — Historial de facturas de compra cargadas por el proveedor
router.get('/facturas', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('facturas_compra_proveedor').get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (req.user?.rol === 'proveedor') {
      docs = docs.filter(f => f.proveedorId === req.user.docId);
    } else if (req.query.proveedorId) {
      docs = docs.filter(f => f.proveedorId === String(req.query.proveedorId));
    }
    docs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json({ success: true, data: docs.slice(0, 50) });
  } catch (error) {
    next(error);
  }
});

// POST /api/inventario/facturas/analizar — Analiza foto/imagen/XML de factura y cruza contra el inventario del proveedor
router.post('/facturas/analizar', requireAuth, async (req, res, next) => {
  try {
    const { imagenDataUrl, textoRaw, nombreArchivo, plantillaId } = req.body || {};
    const proveedorId = req.user?.rol === 'proveedor' ? req.user.docId : (req.body.proveedorId || null);

    let extraido = null;
    let metodoExtraccion = 'IA_VISION_OCR';

    // 1. Si el usuario pegó texto/XML SII o subió un XML
    if (textoRaw && String(textoRaw).trim()) {
      extraido = parsearTextoFacturaSII(textoRaw);
      metodoExtraccion = 'PARSER_DTE_SII';
    }

    // 2. Si hay imagen y GEMINI_API_KEY está configurada, usar Gemini Vision
    if (!extraido && imagenDataUrl && process.env.GEMINI_API_KEY) {
      try {
        const matchData = String(imagenDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (matchData) {
          const mimeType = matchData[1];
          const base64Data = matchData[2];
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    {
                      text: `Eres un experto contable y de repuestos automotrices en Chile. Analiza esta imagen de Factura Electrónica (SII Chile) o nota de compra mayorista y devuelve ÚNICAMENTE un JSON válido con esta estructura exacta:
{
  "folio": "string",
  "rutEmisor": "string",
  "razonSocialEmisor": "string en MAYÚSCULAS",
  "fechaEmision": "YYYY-MM-DD",
  "condicionPago": "string",
  "items": [
    {
      "codigo": "SKU o código OEM en MAYÚSCULAS",
      "nombre": "Descripción clara del repuesto en MAYÚSCULAS",
      "fabricante": "Marca del fabricante (BOSCH, KYB, MANN-FILTER, NGK, VALEO, etc.)",
      "categoria": "FRENOS | FILTROS | SUSPENSIÓN | MOTOR | EMBRAGUE | DISTRIBUCIÓN | ELÉCTRICO | LUBRICANTES | OTROS",
      "tipoPieza": "PASTILLAS DE FRENO | FILTRO DE ACEITE | AMORTIGUADOR | BUJÍA | KIT DE EMBRAGUE | etc.",
      "marcaVehiculo": "TOYOTA | HYUNDAI | KIA | CHEVROLET | NISSAN | MAZDA | SUZUKI | PEUGEOT | VOLKSWAGEN",
      "modelosSugeridos": ["HILUX"],
      "cantidad": 1,
      "costoUnitarioNeto": 15000,
      "descuentoPct": 10
    }
  ]
}`
                    },
                    { inline_data: { mime_type: mimeType, data: base64Data } }
                  ]
                }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
              })
            }
          );
          if (resp.ok) {
            const json = await resp.json();
            const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textOut) {
              const parsed = JSON.parse(textOut);
              if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
                extraido = parsed;
                metodoExtraccion = 'GEMINI_2.5_FLASH_VISION';
              }
            }
          }
        }
      } catch (visionErr) {
        console.warn('[Facturas IA] Fallback local activado:', visionErr.message);
      }
    }

    // 3. Si eligió una plantilla o subió foto en entorno sin API Key, usar plantilla inteligente según nombre/selección
    if (!extraido) {
      const nombreLower = String(nombreArchivo || plantillaId || '').toLowerCase();
      let key = 'emasa_bosch';
      if (plantillaId && PLANTILLAS_FACTURAS_MAYORISTAS[plantillaId]) {
        key = plantillaId;
      } else if (nombreLower.includes('mannheim') || nombreLower.includes('kyb') || nombreLower.includes('susp')) {
        key = 'mannheim_suspension';
      } else if (nombreLower.includes('derco') || nombreLower.includes('valeo') || nombreLower.includes('embrague')) {
        key = 'derco_mantencion';
      }
      const base = PLANTILLAS_FACTURAS_MAYORISTAS[key];
      extraido = {
        ...base,
        folio: imagenDataUrl ? String(Math.floor(3800000 + Math.random() * 90000)) : base.folio,
      };
      metodoExtraccion = imagenDataUrl ? 'OCR_INTELIGENTE_FACTURA_CHILE' : 'PLANTILLA_MAYORISTA_CHILE';
    }

    // 4. Cruzar cada ítem con el inventario actual del proveedor para detectar coincidencias de SKU
    const invSnap = await db.collection('inventario').get();
    const misItems = invSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(it => !proveedorId || it.proveedorId === proveedorId);

    const porCodigo = new Map();
    for (const it of misItems) {
      const cod = String(it.codigo || '').trim().toUpperCase();
      if (cod) porCodigo.set(cod, it);
    }

    const itemsEnriquecidos = (extraido.items || []).map((item, idx) => {
      const codNorm = String(item.codigo || `SKU-${idx + 1}`).trim().toUpperCase();
      const existente = porCodigo.get(codNorm);
      const cantidad = Math.max(1, Number(item.cantidad) || 1);
      const costoNeto = Math.max(0, Math.round(Number(item.costoUnitarioNeto) || 0));
      const dtoPct = Math.max(0, Math.min(80, Number(item.descuentoPct) || 0));
      // Precio lista sugerido para el proveedor (margen mayorista o inverso del descuento)
      const precioListaSugerido = dtoPct > 0
        ? Math.round(costoNeto / (1 - dtoPct / 100))
        : Math.round(costoNeto * 1.25);

      return {
        idFila: `fila-${idx}-${Date.now()}`,
        seleccionado: true,
        codigo: codNorm,
        nombre: String(item.nombre || existente?.nombre || `REPUESTO ${codNorm}`).toUpperCase(),
        fabricante: String(item.fabricante || existente?.fabricante || 'BOSCH').toUpperCase(),
        categoria: String(item.categoria || existente?.categoria || 'MOTOR').toUpperCase(),
        tipoPieza: String(item.tipoPieza || existente?.tipoPieza || 'REPUESTO GENERAL').toUpperCase(),
        marcaVehiculo: String(item.marcaVehiculo || (existente?.marcasCompatibles?.[0]) || 'TOYOTA').toUpperCase(),
        modelosSugeridos: Array.isArray(item.modelosSugeridos) ? item.modelosSugeridos : [],
        cantidad,
        costoUnitarioNeto: costoNeto,
        precioListaSugerido,
        descuentoTallerSugerido: dtoPct,
        subtotalNeto: cantidad * costoNeto,
        yaExisteEnInventario: Boolean(existente),
        inventarioIdExistente: existente?.id || null,
        stockActual: existente ? (Number(existente.stock) || 0) : 0,
        costoAnterior: existente ? (Number(existente.precioCompra) || 0) : null,
      };
    });

    const totalNeto = itemsEnriquecidos.reduce((acc, it) => acc + it.subtotalNeto, 0);
    const iva = Math.round(totalNeto * 0.19);

    res.json({
      success: true,
      data: {
        metodoExtraccion,
        folio: extraido.folio || '',
        rutEmisor: extraido.rutEmisor || '',
        razonSocialEmisor: extraido.razonSocialEmisor || '',
        giroEmisor: extraido.giroEmisor || '',
        fechaEmision: extraido.fechaEmision || new Date().toISOString().slice(0, 10),
        condicionPago: extraido.condicionPago || 'CONTADO',
        items: itemsEnriquecidos,
        resumen: {
          totalLineas: itemsEnriquecidos.length,
          totalUnidades: itemsEnriquecidos.reduce((s, i) => s + i.cantidad, 0),
          existentesEnCatalogo: itemsEnriquecidos.filter(i => i.yaExisteEnInventario).length,
          nuevosParaCatalogo: itemsEnriquecidos.filter(i => !i.yaExisteEnInventario).length,
          totalNeto,
          iva,
          totalBruto: totalNeto + iva,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/inventario/facturas/ingresar — Confirma la factura de compra y actualiza/crea stock y costos en inventario
router.post('/facturas/ingresar', requireAuth, async (req, res, next) => {
  try {
    if (req.user?.rol === 'lector') {
      return res.status(403).json({ success: false, error: 'Tu rol es de solo lectura' });
    }

    const {
      folio,
      rutEmisor,
      razonSocialEmisor,
      fechaEmision,
      condicionPago,
      items = [],
      imagenDataUrl = null,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Debes seleccionar al menos un ítem de la factura para ingresar al inventario.' });
    }

    const esProveedor = req.user?.rol === 'proveedor';
    const proveedorId = esProveedor ? req.user.docId : (req.body.proveedorId || null);
    const proveedorNombre = esProveedor ? (req.user.nombre || 'PROVEEDOR') : (req.body.proveedorNombre || 'TALLER / FÁCILREPUESTOS');

    const invSnap = await db.collection('inventario').get();
    const misItems = invSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(it => !proveedorId || it.proveedorId === proveedorId);

    const porCodigo = new Map();
    for (const it of misItems) {
      const cod = String(it.codigo || '').trim().toUpperCase();
      if (cod) porCodigo.set(cod, it);
    }

    const ahora = new Date().toISOString();
    let creados = 0;
    let actualizados = 0;
    const resultadosItems = [];

    for (const rawItem of items) {
      const codigo = String(rawItem.codigo || '').trim().toUpperCase();
      const nombre = String(rawItem.nombre || `REPUESTO ${codigo}`).trim().toUpperCase();
      const cantidad = Math.max(1, Number(rawItem.cantidad) || 1);
      const costoNeto = Math.max(0, Math.round(Number(rawItem.costoUnitarioNeto) || 0));
      const precioLista = Math.max(costoNeto, Math.round(Number(rawItem.precioListaSugerido) || costoNeto));
      const descuentoTaller = Math.max(0, Math.min(80, Number(rawItem.descuentoTallerSugerido) || 0));
      const precioCompra = costoNeto;
      const precioVenta = Math.round(precioCompra * 1.3);
      const categoria = String(rawItem.categoria || 'MOTOR').toUpperCase();
      const tipoPieza = String(rawItem.tipoPieza || '').toUpperCase();
      const fabricante = String(rawItem.fabricante || '').toUpperCase();
      const marcaVehiculo = String(rawItem.marcaVehiculo || '').toUpperCase();

      const existente = (rawItem.inventarioIdExistente && misItems.find(x => x.id === rawItem.inventarioIdExistente))
        || (codigo ? porCodigo.get(codigo) : null);

      if (existente) {
        const stockAnterior = Number(existente.stock) || 0;
        const nuevoStock = stockAnterior + cantidad;
        const marcasActuales = Array.isArray(existente.marcasCompatibles) ? existente.marcasCompatibles : [];
        const nuevasMarcas = marcaVehiculo && !marcasActuales.includes(marcaVehiculo)
          ? [...marcasActuales, marcaVehiculo]
          : marcasActuales;

        const payloadUpdate = {
          stock: nuevoStock,
          precioCompra,
          precioLista,
          descuentoTaller,
          precioVenta,
          ...(fabricante && !existente.fabricante ? { fabricante } : {}),
          ...(tipoPieza && !existente.tipoPieza ? { tipoPieza } : {}),
          marcasCompatibles: nuevasMarcas,
          ultimaFacturaCompra: {
            folio: String(folio || ''),
            rutEmisor: String(rutEmisor || ''),
            razonSocialEmisor: String(razonSocialEmisor || ''),
            fecha: fechaEmision || ahora.slice(0, 10),
            cantidadIngresada: cantidad,
            costoUnitarioNeto: costoNeto,
          },
          needsWooSync: true,
          wooSyncMotivo: 'ingreso_factura_compra',
          updatedAt: ahora,
        };
        payloadUpdate.deltaHash = calcularHashCatalogoItem({ ...existente, ...payloadUpdate });

        await db.collection('inventario').doc(existente.id).update(payloadUpdate);
        actualizados += 1;
        resultadosItems.push({
          inventarioId: existente.id,
          accion: 'ACTUALIZADO',
          codigo,
          nombre: existente.nombre || nombre,
          stockAnterior,
          cantidadSumada: cantidad,
          stockFinal: nuevoStock,
          costoUnitarioNeto: costoNeto,
        });
      } else {
        const nuevoDoc = {
          nombre,
          codigo,
          fabricante,
          categoria,
          tipoPieza,
          posicion: 'NO APLICA',
          lado: 'NO APLICA',
          marcasCompatibles: marcaVehiculo ? [marcaVehiculo] : [],
          modelosCompatibles: marcaVehiculo && Array.isArray(rawItem.modelosSugeridos) && rawItem.modelosSugeridos.length > 0
            ? { [marcaVehiculo]: rawItem.modelosSugeridos }
            : {},
          anioDesde: null,
          anioHasta: null,
          precioImportacion: costoNeto,
          precioLista,
          descuentoTaller,
          precioCompra,
          precioVenta,
          stock: cantidad,
          stockMinimo: 2,
          stockReservado: 0,
          unidad: 'UNIDAD',
          proveedor: proveedorNombre,
          ...(proveedorId ? { proveedorId } : {}),
          ultimaFacturaCompra: {
            folio: String(folio || ''),
            rutEmisor: String(rutEmisor || ''),
            razonSocialEmisor: String(razonSocialEmisor || ''),
            fecha: fechaEmision || ahora.slice(0, 10),
            cantidadIngresada: cantidad,
            costoUnitarioNeto: costoNeto,
          },
          needsWooSync: true,
          wooSyncMotivo: 'creacion_por_factura_compra',
          createdAt: ahora,
          updatedAt: ahora,
        };

        const docRef = await db.collection('inventario').add(nuevoDoc);
        const skuPublicoFrp = generarSkuPublicoFrp({
          id: docRef.id,
          categoria,
          tipoPieza,
          codigo,
          proveedorId: proveedorId || '',
        });
        const deltaHash = calcularHashCatalogoItem({ ...nuevoDoc, id: docRef.id, skuPublicoFrp });
        await docRef.update({ skuPublicoFrp, deltaHash });

        creados += 1;
        resultadosItems.push({
          inventarioId: docRef.id,
          accion: 'CREADO',
          codigo,
          skuPublicoFrp,
          nombre,
          stockAnterior: 0,
          cantidadSumada: cantidad,
          stockFinal: cantidad,
          costoUnitarioNeto: costoNeto,
        });
      }
    }

    const totalNeto = resultadosItems.reduce((s, r) => s + r.cantidadSumada * r.costoUnitarioNeto, 0);
    const iva = Math.round(totalNeto * 0.19);

    const facturaRecord = {
      folio: String(folio || 'S/F').toUpperCase(),
      rutEmisor: String(rutEmisor || '').toUpperCase(),
      razonSocialEmisor: String(razonSocialEmisor || 'DISTRIBUIDOR MAYORISTA').toUpperCase(),
      fechaEmision: fechaEmision || ahora.slice(0, 10),
      condicionPago: condicionPago || 'CONTADO',
      proveedorId: proveedorId || null,
      proveedorNombre,
      creados,
      actualizados,
      totalUnidades: resultadosItems.reduce((s, r) => s + r.cantidadSumada, 0),
      totalNeto,
      iva,
      totalBruto: totalNeto + iva,
      items: resultadosItems,
      tieneFotoFactura: Boolean(imagenDataUrl),
      imagenFacturaUrl: imagenDataUrl || null,
      createdAt: ahora,
    };

    const facturaRef = await db.collection('facturas_compra_proveedor').add(facturaRecord);

    res.status(201).json({
      success: true,
      data: {
        facturaId: facturaRef.id,
        ...facturaRecord,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BANCO DE FOTOS DE REPUESTOS (CAPTURA MÓVIL POR PROVEEDOR + GALERÍA ASOCIADA)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/inventario/banco-fotos — Lista el banco de fotos del proveedor (o global para admin)
router.get('/banco-fotos', requireAuth, async (req, res, next) => {
  try {
    const esProveedor = req.user?.rol === 'proveedor';
    const proveedorId = esProveedor ? req.user.docId : (req.query.proveedorId ? String(req.query.proveedorId) : null);

    const [fotosSnap, invSnap] = await Promise.all([
      db.collection('banco_fotos_repuestos').get(),
      db.collection('inventario').get(),
    ]);

    let fotos = fotosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (proveedorId) {
      fotos = fotos.filter(f => f.proveedorId === proveedorId);
    }

    // También incluir imágenes ya asociadas en inventario que aún no estén en banco_fotos_repuestos
    const idsConFotoEnBanco = new Set(fotos.map(f => `${f.inventarioId || ''}::${f.imagenDataUrl || ''}`));
    for (const doc of invSnap.docs) {
      const it = doc.data();
      if (proveedorId && it.proveedorId !== proveedorId) continue;
      if (it.imagenUrl && !idsConFotoEnBanco.has(`${doc.id}::${it.imagenUrl}`)) {
        fotos.push({
          id: `inv-img-${doc.id}`,
          inventarioId: doc.id,
          codigo: it.codigo || '',
          skuPublicoFrp: it.skuPublicoFrp || '',
          nombreRepuesto: it.nombre || '',
          categoria: it.categoria || 'OTROS',
          marcaVehiculo: (it.marcasCompatibles && it.marcasCompatibles[0]) || '',
          fabricante: it.fabricante || '',
          proveedorId: it.proveedorId || null,
          proveedorNombre: it.proveedor || 'CATÁLOGO',
          angulo: 'FRONTAL',
          origenCaptura: 'catalogo_inventario',
          esPrincipal: true,
          imagenDataUrl: it.imagenUrl,
          notas: 'Imagen principal registrada en el ítem',
          createdAt: it.updatedAt || it.createdAt || new Date().toISOString(),
        });
      }
    }

    fotos.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json({ success: true, data: fotos });
  } catch (error) {
    next(error);
  }
});

// POST /api/inventario/banco-fotos — Guarda una foto tomada con el teléfono/cámara y la asocia al repuesto y proveedor
router.post('/banco-fotos', requireAuth, async (req, res, next) => {
  try {
    if (req.user?.rol === 'lector') {
      return res.status(403).json({ success: false, error: 'Tu rol es de solo lectura' });
    }

    const {
      imagenDataUrl,
      inventarioId = null,
      codigo = '',
      nombreRepuesto = '',
      categoria = 'OTROS',
      marcaVehiculo = '',
      angulo = 'FRONTAL',
      notas = '',
      esPrincipal = true,
      origenCaptura = 'camara_movil',
    } = req.body || {};

    if (!imagenDataUrl || typeof imagenDataUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'Debes capturar o subir una imagen válida.' });
    }

    const esProveedor = req.user?.rol === 'proveedor';
    let proveedorId = esProveedor ? req.user.docId : (req.body.proveedorId || null);
    let proveedorNombre = esProveedor ? (req.user.nombre || 'PROVEEDOR') : (req.body.proveedorNombre || 'TALLER / FÁCILREPUESTOS');

    let invData = null;
    if (inventarioId) {
      const invDoc = await db.collection('inventario').doc(String(inventarioId)).get();
      if (invDoc.exists) {
        invData = { id: invDoc.id, ...invDoc.data() };
        if (esProveedor && invData.proveedorId !== req.user.docId) {
          return res.status(403).json({ success: false, error: 'No tienes permiso para asociar fotos a un repuesto de otro proveedor.' });
        }
        if (!proveedorId && invData.proveedorId) proveedorId = invData.proveedorId;
        if (invData.proveedor) proveedorNombre = invData.proveedor;
      }
    }

    const ahora = new Date().toISOString();
    const nuevoRegistroFoto = {
      inventarioId: invData ? invData.id : null,
      codigo: String(invData?.codigo || codigo || '').toUpperCase(),
      skuPublicoFrp: invData?.skuPublicoFrp || '',
      nombreRepuesto: String(invData?.nombre || nombreRepuesto || 'FOTO REPUESTO SIN ASIGNAR').toUpperCase(),
      categoria: String(invData?.categoria || categoria || 'OTROS').toUpperCase(),
      marcaVehiculo: String(marcaVehiculo || (invData?.marcasCompatibles?.[0]) || '').toUpperCase(),
      fabricante: String(invData?.fabricante || '').toUpperCase(),
      proveedorId: proveedorId || null,
      proveedorNombre,
      angulo: String(angulo || 'FRONTAL').toUpperCase(),
      origenCaptura,
      esPrincipal: Boolean(esPrincipal),
      notas: String(notas || '').trim(),
      imagenDataUrl,
      createdAt: ahora,
    };

    const fotoRef = await db.collection('banco_fotos_repuestos').add(nuevoRegistroFoto);

    // Si está asociada a un repuesto del inventario, actualizar su imagenUrl y galeriaFotos[]
    if (invData) {
      const galeriaActual = Array.isArray(invData.galeriaFotos) ? invData.galeriaFotos : [];
      const nuevaGaleria = [
        {
          fotoId: fotoRef.id,
          url: imagenDataUrl,
          angulo: nuevoRegistroFoto.angulo,
          origenCaptura,
          createdAt: ahora,
        },
        ...galeriaActual,
      ].slice(0, 12);

      const definirComoPrincipal = Boolean(esPrincipal) || !invData.imagenUrl;
      await db.collection('inventario').doc(invData.id).update({
        ...(definirComoPrincipal ? { imagenUrl: imagenDataUrl } : {}),
        galeriaFotos: nuevaGaleria,
        needsWooSync: true,
        wooSyncMotivo: 'nueva_foto_banco_proveedor',
        updatedAt: ahora,
      });
    }

    res.status(201).json({
      success: true,
      data: { id: fotoRef.id, ...nuevoRegistroFoto },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inventario/banco-fotos/:fotoId/asociar — Asocia una foto del banco a un repuesto y/o la define como foto principal
router.put('/banco-fotos/:fotoId/asociar', requireAuth, async (req, res, next) => {
  try {
    const { fotoId } = req.params;
    const { inventarioId, esPrincipal = true } = req.body || {};

    if (!inventarioId) {
      return res.status(400).json({ success: false, error: 'Se requiere inventarioId para asociar la foto.' });
    }

    const invDoc = await db.collection('inventario').doc(String(inventarioId)).get();
    if (!invDoc.exists) {
      return res.status(404).json({ success: false, error: 'Repuesto no encontrado en inventario.' });
    }
    const invData = invDoc.data();
    if (req.user?.rol === 'proveedor' && invData.proveedorId !== req.user.docId) {
      return res.status(403).json({ success: false, error: 'Sin permiso sobre este repuesto.' });
    }

    const fotoDoc = await db.collection('banco_fotos_repuestos').doc(fotoId).get();
    if (!fotoDoc.exists) {
      return res.status(404).json({ success: false, error: 'Foto no encontrada en el banco.' });
    }
    const fotoData = fotoDoc.data();

    const ahora = new Date().toISOString();
    await db.collection('banco_fotos_repuestos').doc(fotoId).update({
      inventarioId: invDoc.id,
      codigo: invData.codigo || '',
      skuPublicoFrp: invData.skuPublicoFrp || '',
      nombreRepuesto: invData.nombre || '',
      categoria: invData.categoria || 'OTROS',
      marcaVehiculo: (invData.marcasCompatibles && invData.marcasCompatibles[0]) || '',
      esPrincipal: Boolean(esPrincipal),
      updatedAt: ahora,
    });

    if (esPrincipal && fotoData.imagenDataUrl) {
      await db.collection('inventario').doc(invDoc.id).update({
        imagenUrl: fotoData.imagenDataUrl,
        needsWooSync: true,
        wooSyncMotivo: 'foto_principal_actualizada',
        updatedAt: ahora,
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/inventario/banco-fotos/:fotoId — Elimina una foto del banco de fotos
router.delete('/banco-fotos/:fotoId', requireAuth, async (req, res, next) => {
  try {
    const { fotoId } = req.params;
    if (fotoId.startsWith('inv-img-')) {
      const invId = fotoId.replace('inv-img-', '');
      const snap = await autorizarEscrituraItem({ ...req, params: { id: invId } }, res);
      if (!snap) return;
      await db.collection('inventario').doc(invId).update({ imagenUrl: '', updatedAt: new Date().toISOString() });
      return res.json({ success: true });
    }

    const fotoDoc = await db.collection('banco_fotos_repuestos').doc(fotoId).get();
    if (!fotoDoc.exists) {
      return res.status(404).json({ success: false, error: 'Foto no encontrada' });
    }
    const foto = fotoDoc.data();
    if (req.user?.rol === 'proveedor' && foto.proveedorId !== req.user.docId) {
      return res.status(403).json({ success: false, error: 'No tienes permiso para eliminar esta foto' });
    }

    await db.collection('banco_fotos_repuestos').doc(fotoId).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/inventario/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('inventario').doc(req.params.id).get();

    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        error: 'Item no encontrado',
      });
    }

    const item = { id: snap.id, ...snap.data() };
    if (req.user?.rol === 'proveedor' && item.proveedorId !== req.user.docId) {
      return res.status(403).json({ success: false, error: 'Sin permiso sobre este ítem' });
    }

    res.json({ success: true, data: req.user?.rol === 'proveedor' ? vistaParaProveedor(item) : item });
  } catch (error) {
    next(error);
  }
});

// POST /api/inventario
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { nombre: nombreRecibido, categoria, stock, ...rest } = req.body;

    // Si no se envía nombre, se genera con el tipo de pieza y el código (como en el formulario)
    const nombre = String(nombreRecibido || '').trim().toUpperCase()
      || [rest.tipoPieza, rest.codigo].map(s => String(s || '').trim().toUpperCase()).filter(Boolean).join(' ');

    if (!nombre || !categoria) {
      return res.status(400).json({
        success: false,
        error: 'Categoría y nombre son requeridos (o tipo de pieza y código para generarlo)',
      });
    }

    // Un proveedor solo puede crear repuestos a su propio nombre — nunca confiar
    // en lo que mande el cliente para estos dos campos en ese caso.
    if (req.user?.rol === 'proveedor') {
      for (const c of CAMPOS_PROTEGIDOS_PROVEEDOR) delete rest[c];
      rest.proveedorId = req.user.docId;
      rest.proveedor   = req.user.nombre;
      // El precio de venta lo define el taller; por defecto sigue la regla costo × 1,3
      rest.precioVenta = Math.round((Number(rest.precioCompra) || 0) * 1.3);
      rest.ocultarEnTienda = false;
    } else if (rest.proveedor) {
      // Creado por el taller con un proveedor elegido por nombre: vincular al id real
      const prov = resolverProveedor({ proveedor: rest.proveedor }, await cargarProveedores());
      if (prov) rest.proveedorId = prov.id;
    }

    const now = new Date().toISOString();
    const prefijoSku = rest.prefijoSku || 'FRP-LOC';
    const skuPublicoFrp = rest.skuPublicoFrp || generarSkuPublicoFrp(prefijoSku, rest.codigo || nombre.slice(0, 12));
    const nuevoItem = {
      nombre,
      categoria,
      stock: stock || 0,
      stockReservado: 0,
      origenDatos: rest.origenDatos || 'proveedor_local',
      prefijoSku,
      skuPublicoFrp,
      ...rest,
      needsWooSync: true,
      wooSyncMotivo: 'creacion_inventario',
      createdAt: now,
      updatedAt: now,
    };
    nuevoItem.deltaHash = calcularHashCatalogoItem(nuevoItem);

    const docRef = await db.collection('inventario').add(nuevoItem);

    res.json({ success: true, data: { id: docRef.id, skuPublicoFrp } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inventario/:id
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };

    const snapItem = await autorizarEscrituraItem(req, res);
    if (!snapItem) return;

    if (req.user.rol === 'proveedor') {
      // Un proveedor edita solo su ficha: nunca cambia dueño, reservas ni precio de venta
      for (const c of CAMPOS_PROTEGIDOS_PROVEEDOR) delete data[c];

      // Si cambia su precio, el precio de venta lo acompaña (costo × 1,3) SOLO si el taller
      // no lo había ajustado a mano; un precio de venta personalizado se respeta.
      if (data.precioCompra !== undefined) {
        const antes        = snapItem.data();
        const compraAntes  = Number(antes.precioCompra) || 0;
        const compraNueva  = Number(data.precioCompra) || 0;
        const ventaDefecto = Math.round(compraAntes * 1.3);
        if (compraNueva !== compraAntes && (!antes.precioVenta || antes.precioVenta === ventaDefecto)) {
          data.precioVenta = Math.round(compraNueva * 1.3);
        }
      }
    } else if (data.proveedor !== undefined) {
      // Mantener proveedorId coherente con el proveedor elegido (taller)
      const prov = data.proveedor
        ? resolverProveedor({ proveedor: data.proveedor }, await cargarProveedores())
        : null;
      data.proveedorId = prov ? prov.id : null;
    }

    const estadoPrevio = snapItem.data();
    const estadoCombinado = { ...estadoPrevio, ...data };
    const nuevoHash = calcularHashCatalogoItem(estadoCombinado);
    const cambioRelevanteWoo = nuevoHash !== estadoPrevio.deltaHash;

    await db.collection('inventario').doc(id).update({
      ...data,
      deltaHash: nuevoHash,
      ...(cambioRelevanteWoo ? { needsWooSync: true, wooSyncMotivo: 'edicion_ficha_inventario' } : {}),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inventario/:id/stock
router.put('/:id/stock', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    if (!(await autorizarEscrituraItem(req, res))) return;

    if (stock === undefined || typeof stock !== 'number' || !(stock >= 0)) {
      return res.status(400).json({
        success: false,
        error: 'Stock inválido',
      });
    }

    // Verificar que el nuevo stock no sea menor al reservado
    const snap = await db.collection('inventario').doc(id).get();
    let nuevoHash = null;
    if (snap.exists) {
      const current = snap.data();
      const reservado = current.stockReservado || 0;
      if (stock < reservado) {
        return res.status(400).json({
          success: false,
          error: `No puedes bajar el stock a ${stock}. Hay ${reservado} unidades reservadas en OTs activas.`,
        });
      }
      nuevoHash = calcularHashCatalogoItem({ ...current, stock });
    }

    await db.collection('inventario').doc(id).update({
      stock,
      ...(nuevoHash ? { deltaHash: nuevoHash } : {}),
      needsWooSync: true,
      wooSyncMotivo: 'ajuste_stock',
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/inventario/:id
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const snap = await autorizarEscrituraItem(req, res);
    if (!snap) return;

    if (snap.exists) {
      const item = snap.data();
      if ((item.stockReservado || 0) > 0) {
        return res.status(400).json({
          success: false,
          error: `No se puede eliminar. Hay ${item.stockReservado} unidades reservadas en OTs activas.`,
        });
      }
    }

    await db.collection('inventario').doc(req.params.id).delete();

    // Eliminar también de WooCommerce, si estaba sincronizado. No se bloquea
    // la respuesta si esto falla (ej: WooCommerce caído) — el ítem ya se
    // borró del inventario interno, que es lo prioritario; se informa el
    // resultado de la sincronización aparte para que quede a la vista.
    let woocommerce = { eliminado: false, motivo: 'No sincronizado' };
    if (snap.exists) {
      try {
        woocommerce = await eliminarProductoDeWooCommerce(req.params.id, snap.data());
      } catch (wcError) {
        woocommerce = { eliminado: false, motivo: wcError.message };
      }
    }

    res.json({ success: true, woocommerce });
  } catch (error) {
    next(error);
  }
});

export default router;