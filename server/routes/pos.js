import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';

const router = Router();

const COLECCION_RESERVAS_MOSTRADOR = 'reservas_mostrador_pos';
const TTL_MOSTRADOR_MS = 30 * 60 * 1000; // 30 minutos por defecto estilo e-commerce

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Obtiene el ID de documento de reserva de mostrador único para el operador/proveedor actual
 */
function obtenerDocIdMostrador(user) {
  if (!user) return 'mostrador_anon';
  if (user.rol === 'proveedor' && user.docId) {
    return `mostrador_prov_${user.docId}`;
  }
  return `mostrador_usr_${user.uid || 'admin'}`;
}

/**
 * Revisa todas las reservas activas en `reservas_mostrador_pos` y libera el `stockReservado`
 * de aquellas cuyo tiempo de 30 minutos (`expiraEn`) ya venció sin haberse impreso/confirmado.
 */
export async function limpiarReservasMostradorExpiradas() {
  try {
    const snap = await db.collection(COLECCION_RESERVAS_MOSTRADOR).get();
    if (snap.empty) return;

    const ahoraMs = Date.now();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.estado !== 'ACTIVA') continue;
      const expiraMs = data.expiraEn ? new Date(data.expiraEn).getTime() : 0;
      if (expiraMs > 0 && expiraMs <= ahoraMs) {
        // Devolver las unidades retenidas al stock local disponible (restando de stockReservado)
        const itemsReservados = Array.isArray(data.items) ? data.items : [];
        for (const it of itemsReservados) {
          if (!it.id || !(Number(it.cantidad) > 0)) continue;
          const invRef = db.collection('inventario').doc(it.id);
          const invSnap = await invRef.get();
          if (invSnap.exists) {
            const invData = invSnap.data();
            const reservadoActual = Number(invData.stockReservado) || 0;
            const nuevoReservado = Math.max(0, round2(reservadoActual - Number(it.cantidad)));
            await invRef.update({
              stockReservado: nuevoReservado,
              updatedAt: new Date().toISOString(),
            });
          }
        }
        await doc.ref.delete();
      }
    }
  } catch (err) {
    console.warn('[POS Mostrador] Error limpiando reservas expiradas:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pos/mostrador
// Devuelve el carrito activo en Mostrador / Ventana (si no han pasado 30 min)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/mostrador', requireAuth, async (req, res, next) => {
  try {
    await limpiarReservasMostradorExpiradas();

    const docId = obtenerDocIdMostrador(req.user);
    const snap = await db.collection(COLECCION_RESERVAS_MOSTRADOR).doc(docId).get();

    if (!snap.exists) {
      return res.json({ success: true, data: null });
    }

    const data = snap.data();
    const expiraMs = data.expiraEn ? new Date(data.expiraEn).getTime() : 0;
    const segundosRestantes = Math.max(0, Math.floor((expiraMs - Date.now()) / 1000));

    if (segundosRestantes <= 0 || !Array.isArray(data.items) || data.items.length === 0) {
      await snap.ref.delete();
      return res.json({ success: true, data: null });
    }

    res.json({
      success: true,
      data: {
        id: snap.id,
        ...data,
        segundosRestantes,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos/mostrador/sincronizar
// Sincroniza los ítems del Mostrador / Ventana aplicando reserva real inmediata
// sobre el stock local (`stockReservado`) y mantiene la ventana activa por 30 min.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mostrador/sincronizar', requireAuth, async (req, res) => {
  try {
    await limpiarReservasMostradorExpiradas();

    const {
      items = [],
      cliente = {},
      metodoPago = 'EFECTIVO',
      descuentoTipo = 'PORCENTAJE',
      descuentoValor = 0,
      renovarTiempo = true,
    } = req.body || {};

    const docId = obtenerDocIdMostrador(req.user);
    const reservaRef = db.collection(COLECCION_RESERVAS_MOSTRADOR).doc(docId);
    const reservaSnap = await reservaRef.get();
    const reservaActual = reservaSnap.exists ? reservaSnap.data() : null;

    const prevItems = Array.isArray(reservaActual?.items) ? reservaActual.items : [];
    const nuevosItems = Array.isArray(items) ? items.filter((i) => i && i.id && Number(i.cantidad) > 0) : [];

    // Mapa de cantidades previas vs nuevas por inventarioId
    const prevMap = new Map();
    for (const it of prevItems) {
      prevMap.set(it.id, (prevMap.get(it.id) || 0) + (Number(it.cantidad) || 0));
    }

    const nuevoMap = new Map();
    for (const it of nuevosItems) {
      nuevoMap.set(it.id, (nuevoMap.get(it.id) || 0) + (Number(it.cantidad) || 0));
    }

    const todosIds = new Set([...prevMap.keys(), ...nuevoMap.keys()]);
    const ahoraIso = new Date().toISOString();

    // Verificar y ajustar `stockReservado` en cada ítem que cambió en el mostrador
    for (const itemId of todosIds) {
      const cantAntes = prevMap.get(itemId) || 0;
      const cantAhora = nuevoMap.get(itemId) || 0;
      const delta = cantAhora - cantAntes; // >0 = retener más stock; <0 = liberar stock

      if (delta === 0) continue;

      const invRef = db.collection('inventario').doc(itemId);
      const invSnap = await invRef.get();
      if (!invSnap.exists) {
        if (delta > 0) {
          return res.status(404).json({
            success: false,
            error: `El repuesto solicitado (${itemId}) no existe en inventario`,
          });
        }
        continue;
      }

      const invData = invSnap.data();
      const stockTotal = Number(invData.stock) || 0;
      const reservadoActual = Number(invData.stockReservado) || 0;
      const disponibleSinEsteDelta = Math.max(0, round2(stockTotal - reservadoActual));

      if (delta > 0 && disponibleSinEsteDelta < delta) {
        return res.status(400).json({
          success: false,
          error: `Stock disponible insuficiente para "${invData.nombre || invData.codigo}". Disponible en bodega: ${disponibleSinEsteDelta} un.`,
        });
      }

      const nuevoReservado = Math.max(0, round2(reservadoActual + delta));
      await invRef.update({
        stockReservado: nuevoReservado,
        updatedAt: ahoraIso,
      });
    }

    // Si el mostrador quedó vacío, eliminar el documento de reserva
    if (nuevosItems.length === 0) {
      if (reservaSnap.exists) {
        await reservaRef.delete();
      }
      return res.json({ success: true, data: null });
    }

    const expiraEnIso =
      !renovarTiempo && reservaActual?.expiraEn
        ? reservaActual.expiraEn
        : new Date(Date.now() + TTL_MOSTRADOR_MS).toISOString();

    const payloadReserva = {
      estado: 'ACTIVA',
      vendedorId: req.user.uid,
      proveedorId: req.user.rol === 'proveedor' ? req.user.docId : null,
      items: nuevosItems,
      cliente,
      metodoPago,
      descuentoTipo,
      descuentoValor: Number(descuentoValor) || 0,
      creadoEn: reservaActual?.creadoEn || ahoraIso,
      actualizadoEn: ahoraIso,
      expiraEn: expiraEnIso,
    };

    await reservaRef.set(payloadReserva, { merge: true });

    const segundosRestantes = Math.max(0, Math.floor((new Date(expiraEnIso).getTime() - Date.now()) / 1000));

    res.json({
      success: true,
      data: {
        id: docId,
        ...payloadReserva,
        segundosRestantes,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/pos/mostrador
// Cancela la ventana del Mostrador y devuelve inmediatamente todas las unidades
// retenidas al stock local disponible (`stockReservado`).
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/mostrador', requireAuth, async (req, res, next) => {
  try {
    const docId = obtenerDocIdMostrador(req.user);
    const reservaRef = db.collection(COLECCION_RESERVAS_MOSTRADOR).doc(docId);
    const reservaSnap = await reservaRef.get();

    if (reservaSnap.exists) {
      const data = reservaSnap.data();
      const itemsReservados = Array.isArray(data.items) ? data.items : [];
      const ahoraIso = new Date().toISOString();

      for (const it of itemsReservados) {
        if (!it.id || !(Number(it.cantidad) > 0)) continue;
        const invRef = db.collection('inventario').doc(it.id);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          const invData = invSnap.data();
          const reservadoActual = Number(invData.stockReservado) || 0;
          const nuevoReservado = Math.max(0, round2(reservadoActual - Number(it.cantidad)));
          await invRef.update({
            stockReservado: nuevoReservado,
            updatedAt: ahoraIso,
          });
        }
      }
      await reservaRef.delete();
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos/venta
// Procesa una venta de mostrador (confirmación e impresión de ticket),
// convierte la reserva de mostrador en descuento definitivo de stock y genera el ticket
// ─────────────────────────────────────────────────────────────────────────────
router.post('/venta', requireAuth, async (req, res) => {
  try {
    await limpiarReservasMostradorExpiradas();

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
          const subtotalConIva = Math.round(subtotalNeto * 1.19);
          const montoBruto = Math.min(subtotalConIva, val);
          descuentoNeto = Math.min(subtotalNeto, Math.round(montoBruto / 1.19));
          descuentoPorcentaje = round2((descuentoNeto / subtotalNeto) * 100);
        }
      }

      const totalNeto = Math.max(0, subtotalNeto - descuentoNeto);
      const totalIva = Math.round(totalNeto * 0.19);
      const total = totalNeto + totalIva;

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

    // Si es solo cotización, no descuenta stock definitivo en base de datos
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

    // Verificar cuánto stock ya estaba retenido en el Mostrador activo de este operador
    const docIdMostrador = obtenerDocIdMostrador(req.user);
    const reservaRef = db.collection(COLECCION_RESERVAS_MOSTRADOR).doc(docIdMostrador);
    const reservaSnap = await reservaRef.get();
    const reservadoEnEsteMostradorMap = new Map();
    if (reservaSnap.exists) {
      const rData = reservaSnap.data();
      for (const rIt of rData.items || []) {
        if (rIt?.id) {
          reservadoEnEsteMostradorMap.set(
            rIt.id,
            (reservadoEnEsteMostradorMap.get(rIt.id) || 0) + (Number(rIt.cantidad) || 0)
          );
        }
      }
    }

    // Venta en firme: transacción atómica en Firestore para descontar `stock` y liberar la reserva temporal de mostrador
    const resultadoVenta = await db.runTransaction(async (transaction) => {
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

        if (esProveedor && data.proveedorId !== req.user.docId) {
          throw new Error(`No tienes permiso para vender el ítem "${data.nombre || data.codigo}" de otro proveedor`);
        }

        const stockActual = Number(data.stock) || 0;
        const stockReservadoTotal = Number(data.stockReservado) || 0;
        const yaReservadoPorEsteMostrador = reservadoEnEsteMostradorMap.get(it.id) || 0;
        // El stock reservado por OT u otros mostradores (excluyendo el de esta ventana que se está confirmando)
        const reservadoPorOtros = Math.max(0, stockReservadoTotal - yaReservadoPorEsteMostrador);
        const disponibleParaEstaVenta = Math.max(0, stockActual - reservadoPorOtros);
        const cantidadPedida = Number(it.cantidad) || 1;

        if (disponibleParaEstaVenta < cantidadPedida) {
          throw new Error(
            `Stock insuficiente para "${data.nombre || data.codigo}". Disponible: ${disponibleParaEstaVenta}, Solicitado: ${cantidadPedida}`
          );
        }

        itemDocs.push({
          docRef,
          currentData: data,
          cantidad: cantidadPedida,
          yaReservadoPorEsteMostrador,
        });
      }

      // 2. Descontar stock definitivo y liberar la reserva temporal del mostrador
      const ahora = new Date();
      for (const { docRef, currentData, cantidad, yaReservadoPorEsteMostrador } of itemDocs) {
        const nuevoStock = Math.max(0, (Number(currentData.stock) || 0) - cantidad);
        const nuevoStockReservado = Math.max(
          0,
          round2((Number(currentData.stockReservado) || 0) - Math.min(yaReservadoPorEsteMostrador, cantidad))
        );
        const nuevoHash = calcularHashCatalogoItem({ ...currentData, stock: nuevoStock });
        transaction.update(docRef, {
          stock: nuevoStock,
          stockReservado: nuevoStockReservado,
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

    // Eliminar la sesión temporal del mostrador ya confirmada
    if (reservaSnap.exists) {
      await reservaRef.delete();
    }

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
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, 50);

    res.json({ success: true, data: ventas });
  } catch (error) {
    next(error);
  }
});

export default router;
