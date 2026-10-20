import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin, requireAuthOrLector, ROL_LECTOR_DRPARTES } from '../middleware/auth.js';
import { eliminarProductoDeWooCommerce } from '../services/woocommerceSync.js';

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
      itemsSinVentas: 0,
    };
    const stockBajoItems = [];
    for (const it of items.values()) {
      const stock     = Number(it.stock) || 0;
      const reservado = Number(it.stockReservado) || 0;
      const precio    = Number(it.precioCompra) || 0;
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

    // Ventas: repuestos de este proveedor en órdenes de trabajo ENTREGADAS
    const otSnap = await db.collection('ordenes_trabajo')
      .select('estado', 'repuestos', 'fechaEntregaReal', 'fechaEntregaEstimada', 'createdAt')
      .get();

    const porItem = new Map();   // inventarioId -> { unidades, monto }
    const porMes  = new Map();   // "YYYY-MM"   -> { unidades, monto, ordenes }
    for (const doc of otSnap.docs) {
      const ot = doc.data();
      if (ot.estado !== 'Entregado') continue;
      const propios = (ot.repuestos || []).filter(r => r && items.has(r.inventarioId));
      if (!propios.length) continue;

      const f = anioMesDeFecha(ot.fechaEntregaReal) || anioMesDeFecha(ot.fechaEntregaEstimada) || anioMesDeFecha(ot.createdAt);
      const mesKey = f ? `${f.y}-${String(f.m).padStart(2, '0')}` : null;

      let unidadesOT = 0, montoOT = 0;
      for (const rep of propios) {
        const cant  = Number(rep.cantidad) || 0;
        const monto = cant * (Number(items.get(rep.inventarioId).precioCompra) || 0);
        const acc = porItem.get(rep.inventarioId) || { unidades: 0, monto: 0 };
        acc.unidades += cant; acc.monto += monto;
        porItem.set(rep.inventarioId, acc);
        unidadesOT += cant; montoOT += monto;
      }
      resumen.unidadesVendidas += unidadesOT;
      resumen.montoVendido     += montoOT;

      if (mesKey) {
        const m = porMes.get(mesKey) || { unidades: 0, monto: 0, ordenes: 0 };
        m.unidades += unidadesOT; m.monto += montoOT; m.ordenes += 1;
        porMes.set(mesKey, m);
      }
    }

    const masVendidos = [...porItem.entries()]
      .map(([id, v]) => ({
        id, nombre: items.get(id).nombre || '', codigo: items.get(id).codigo || '',
        unidades: round2(v.unidades), monto: Math.round(v.monto),
      }))
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 10);

    const sinVentas = [...items.values()]
      .filter(it => !porItem.has(it.id))
      .map(it => ({ id: it.id, nombre: it.nombre || '', codigo: it.codigo || '', stock: Number(it.stock) || 0 }));
    resumen.itemsSinVentas = sinVentas.length;

    const ventasPorMes = [...porMes.entries()]
      .map(([mes, v]) => ({ mes, unidades: round2(v.unidades), monto: Math.round(v.monto), ordenes: v.ordenes }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    resumen.valorStock     = Math.round(resumen.valorStock);
    resumen.valorReservado = Math.round(resumen.valorReservado);
    resumen.montoVendido   = Math.round(resumen.montoVendido);
    resumen.unidadesVendidas = round2(resumen.unidadesVendidas);

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

    const docRef = await db.collection('inventario').add({
      nombre,
      categoria,
      stock: stock || 0,
      stockReservado: 0,
      ...rest,
      createdAt: now,
      updatedAt: now,
    });

    res.json({ success: true, data: { id: docRef.id } });
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

    await db.collection('inventario').doc(id).update({
      ...data,
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
    if (snap.exists) {
      const current = snap.data();
      const reservado = current.stockReservado || 0;
      if (stock < reservado) {
        return res.status(400).json({
          success: false,
          error: `No puedes bajar el stock a ${stock}. Hay ${reservado} unidades reservadas en OTs activas.`,
        });
      }
    }

    await db.collection('inventario').doc(id).update({
      stock,
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