import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';

const router = Router();

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// POST /api/pos/venta
// Procesa una venta de mostrador, descuenta stock de forma atómica y genera el ticket
router.post('/venta', requireAuth, async (req, res, next) => {
  try {
    const {
      items = [],
      metodoPago = 'EFECTIVO',
      cliente = {},
      tipoDocumento = 'TICKET', // 'TICKET' | 'COTIZACION'
      notas = '',
      descuentoTipo = 'PORCENTAJE', // 'PORCENTAJE' | 'MONTO'
      descuentoValor = 0,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'El carro de venta no tiene productos' });
    }

    const esCotizacion = tipoDocumento === 'COTIZACION';
    const esProveedor = req.user.rol === 'proveedor';
    const proveedorId = esProveedor ? req.user.docId : (req.body.proveedorId || null);

    // Helper para calcular totales con descuento sobre la compra total
    const calcularTotalesConDescuento = (listaItems) => {
      const subtotalNeto = Math.round(
        listaItems.reduce((sum, it) => sum + (Number(it.precioNeto || it.precio) || 0) * (Number(it.cantidad) || 1), 0)
      );
      const val = Math.max(0, Number(descuentoValor) || 0);
      let descuentoNeto = 0;
      let descuentoPorcentaje = 0;

      if (val > 0 && subtotalNeto > 0) {
        if (descuentoTipo === 'PORCENTAJE') {
          const pct = Math.min(100, val);
          descuentoPorcentaje = round2(pct);
          descuentoNeto = Math.round(subtotalNeto * (pct / 100));
        } else {
          // Descuento ingresado como monto en pesos (con IVA incluido en mostrador -> pasamos a neto)
          const subtotalConIva = Math.round(subtotalNeto * 1.19);
          const montoBruto = Math.min(subtotalConIva, val);
          descuentoNeto = Math.min(subtotalNeto, Math.round(montoBruto / 1.19));
          descuentoPorcentaje = round2((descuentoNeto / subtotalNeto) * 100);
        }
      }

      const totalNeto = Math.max(0, subtotalNeto - descuentoNeto);
      const totalIva  = Math.round(totalNeto * 0.19);
      const total     = totalNeto + totalIva;

      return {
        subtotalNeto,
        descuentoTipo: val > 0 ? descuentoTipo : null,
        descuentoValor: val > 0 ? val : 0,
        descuentoPorcentaje,
        descuentoNeto,
        totalNeto,
        totalIva,
        total,
      };
    };

    // Si es solo cotización, no descuenta stock en base de datos
    if (esCotizacion) {
      const ahora = new Date();
      const numTicket = `COT-${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      const calc = calcularTotalesConDescuento(items);

      const cotizacionData = {
        numeroTicket: numTicket,
        tipoDocumento: 'COTIZACION',
        fecha: ahora.toISOString(),
        vendedorId: req.user.uid,
        vendedorNombre: `${req.user.nombre || ''} ${req.user.apellido || ''}`.trim() || 'Vendedor',
        proveedorId,
        items,
        ...calc,
        metodoPago,
        cliente,
        notas,
        estado: 'PENDIENTE',
      };

      const docRef = await db.collection('ventas_pos').add(cotizacionData);
      return res.json({
        success: true,
        data: { id: docRef.id, ...cotizacionData },
      });
    }

    // Venta en firme: transacción atómica en Firestore para garantizar consistencia de stock
    const resultadoVenta = await db.runTransaction(async (transaction) => {
      // 1. Leer y verificar todos los productos
      const itemDocs = [];
      for (const it of items) {
        if (!it.id) {
          throw new Error('Producto sin identificador válido');
        }
        const docRef = db.collection('inventario').doc(it.id);
        const docSnap = await transaction.get(docRef);

        if (!docSnap.exists) {
          throw new Error(`El producto "${it.nombre || it.codigo || it.id}" ya no existe en inventario`);
        }

        const data = docSnap.data();

        // Si es proveedor, solo puede vender de su propio inventario
        if (esProveedor && data.proveedorId !== req.user.docId) {
          throw new Error(`No tienes permiso para vender el ítem "${data.nombre || data.codigo}" de otro proveedor`);
        }

        const stockActual = Number(data.stock) || 0;
        const stockReservado = Number(data.stockReservado) || 0;
        const disponible = Math.max(0, stockActual - stockReservado);
        const cantidadPedida = Number(it.cantidad) || 1;

        if (disponible < cantidadPedida) {
          throw new Error(
            `Stock insuficiente para "${data.nombre || data.codigo}". Disponible: ${disponible}, Solicitado: ${cantidadPedida}`
          );
        }

        itemDocs.push({ docRef, currentData: data, cantidad: cantidadPedida });
      }

      // 2. Descontar stock de cada ítem y encolar sincronización incremental (Delta) a WooCommerce
      const ahora = new Date();
      for (const { docRef, currentData, cantidad } of itemDocs) {
        const nuevoStock = (Number(currentData.stock) || 0) - cantidad;
        const nuevoHash = calcularHashCatalogoItem({ ...currentData, stock: nuevoStock });
        transaction.update(docRef, {
          stock: nuevoStock,
          deltaHash: nuevoHash,
          needsWooSync: true,
          wooSyncMotivo: 'venta_pos',
          updatedAt: ahora.toISOString(),
        });
      }

      // 3. Crear registro de venta POS con número de ticket consecutivo
      const numTicket = `T-${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      const calc = calcularTotalesConDescuento(items);

      const ventaData = {
        numeroTicket: numTicket,
        tipoDocumento: 'TICKET',
        fecha: ahora.toISOString(),
        vendedorId: req.user.uid,
        vendedorNombre: `${req.user.nombre || ''} ${req.user.apellido || ''}`.trim() || 'Vendedor',
        proveedorId,
        items,
        ...calc,
        metodoPago,
        cliente,
        notas,
        estado: 'COMPLETADA',
      };

      const nuevaVentaRef = db.collection('ventas_pos').doc();
      transaction.set(nuevaVentaRef, ventaData);

      return { id: nuevaVentaRef.id, ...ventaData };
    });

    res.json({ success: true, data: resultadoVenta });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /api/pos/ventas
// Listado de ventas recientes del mostrador
router.get('/ventas', requireAuth, async (req, res, next) => {
  try {
    let snap;
    if (req.user.rol === 'proveedor') {
      snap = await db.collection('ventas_pos').where('proveedorId', '==', req.user.docId).get();
    } else {
      snap = await db.collection('ventas_pos').orderBy('fecha', 'desc').limit(50).get();
    }

    const ventas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, 50);

    res.json({ success: true, data: ventas });
  } catch (error) {
    next(error);
  }
});

export default router;
