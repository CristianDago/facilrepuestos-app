import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  sincronizarInventarioConWooCommerce,
  obtenerEstadoColaWooCommerce,
  exportarCatalogoCSV,
  obtenerPedidosWooCommerceRecientes,
  obtenerResumenMarcasCompatibilidadInventario,
  sincronizarMarcasCompatibilidadWooCommerce,
} from '../services/woocommerceSync.js';
import {
  sincronizarCatalogoNodoAiloo,
  sincronizarTodosLosNodosAiloo,
  calcularHashCatalogoItem,
} from '../services/ailooCatalogSync.js';

const router = Router();

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Permite disparar el sync de dos formas:
// 1) Cloud Scheduler (automático) → header X-Sync-Key con el secreto del servidor
// 2) Un admin logueado en el sistema → botón "Sincronizar ahora" (Firebase Auth normal)
function requireSyncAccess(req, res, next) {
  const key = req.headers['x-sync-key'];
  if (key && process.env.DRMOTORS_SYNC_SECRET && key === process.env.DRMOTORS_SYNC_SECRET) {
    return next();
  }
  // Permitir a administradores y proveedores autenticados disparar la sincronización hacia WooCommerce
  return requireAuth(req, res, () => {
    if (req.user?.rol === 'admin' || req.user?.rol === 'proveedor') {
      return next();
    }
    return requireAdmin(req, res, next);
  });
}

// GET /api/woocommerce/status
// Estado de la cola de sincronización incremental (Delta) y desglose por origen (Soluparts, Global, Locales)
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const estado = await obtenerEstadoColaWooCommerce();
    res.json({ success: true, data: estado });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/woocommerce/canales-venta
// Relaciona por separado y en conjunto los 3 Canales de Venta de FácilRepuestos:
//   1) Canal Web Directo (WordPress / WooCommerce facilrepuestos.cl — sin pasar por Repuestín)
//   2) Canal Repuestín WhatsApp (+56 9 2110 9851 — carros y pedidos asistidos por WhatsApp)
//   3) Canal POS Sucursal Enrique Olivares 224 (Mesón / Bodega La Florida)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/canales-venta', requireAuth, async (req, res, next) => {
  try {
    const [
      wooLiveRes,
      wooWebhookSnap,
      pedidosRepuestinSnap,
      sesionesWspSnap,
      ventasPosSnap,
    ] = await Promise.all([
      obtenerPedidosWooCommerceRecientes({ maxPedidos: 60 }).catch(() => ({
        configurado: false,
        pedidos: [],
      })),
      db.collection('woocommerce_pedidos_procesados').get().catch(() => ({ docs: [] })),
      db.collection('pedidos_agente_omnicanal').get().catch(() => ({ docs: [] })),
      db.collection('sesiones_agente_omnicanal').get().catch(() => ({ docs: [] })),
      db.collection('ventas_pos').get().catch(() => ({ docs: [] })),
    ]);

    // ── 1. CANAL WEB DIRECTO (WORDPRESS / WOOCOMMERCE SIN REPUESTÍN) ─────────
    const pedidosWooMap = new Map();
    for (const p of wooLiveRes.pedidos || []) {
      pedidosWooMap.set(String(p.id), p);
    }

    // Incorporar también pedidos registrados por webhook en Firestore si no estaban en el lote reciente
    for (const doc of wooWebhookSnap.docs || []) {
      if (pedidosWooMap.has(String(doc.id))) continue;
      const d = doc.data() || {};
      const totalConIva = Math.round(Number(d.totalPedido) || 0);
      const totalNeto = Math.round(totalConIva / 1.19);
      const items = Array.isArray(d.items) ? d.items : [];
      pedidosWooMap.set(String(doc.id), {
        id: String(doc.id),
        numeroPedido: String(d.numeroPedido || doc.id),
        fecha: d.procesadoEn || new Date().toISOString(),
        estadoWoo: d.estadoWoo || 'completed',
        canalOrigen: d.canalOrigen || 'web_directo',
        codigoPedidoFrp: d.codigoPedidoFrp || null,
        clienteNombre: d.clienteNombre || 'Cliente Web WordPress',
        clienteEmail: d.clienteEmail || '',
        clienteTelefono: d.clienteTelefono || '',
        comuna: d.comuna || 'Santiago',
        metodoPago: d.metodoPago || 'Webpay / WooCommerce',
        totalNeto,
        totalConIva,
        itemsCount: items.reduce((s, it) => s + (Number(it.cantidad) || 1), 0),
        items: items.map((it) => ({
          nombre: it.nombre || it.skuPublicoFrp || it.codigo || 'Repuesto Web',
          sku: it.skuPublicoFrp || it.codigo || '',
          cantidad: Number(it.cantidad) || 1,
          totalConIva: 0,
        })),
      });
    }

    const todosPedidosWoo = Array.from(pedidosWooMap.values()).sort((a, b) =>
      String(b.fecha || '').localeCompare(String(a.fecha || ''))
    );

    // Filtrar compras que NO pasaron por Repuestín (100% Web Directo WordPress)
    const estadosCancelados = new Set(['cancelled', 'refunded', 'failed', 'trash']);
    const comprasWebDirecto = todosPedidosWoo.filter(
      (p) => p.canalOrigen === 'web_directo' && !estadosCancelados.has(p.estadoWoo)
    );
    const comprasWebPagadas = comprasWebDirecto.filter((p) =>
      ['processing', 'completed', 'on-hold'].includes(p.estadoWoo)
    );

    const totalMontoWebDirectoConIva = comprasWebDirecto.reduce(
      (acc, p) => acc + (Number(p.totalConIva) || 0),
      0
    );
    const totalMontoWebDirectoNeto = Math.round(totalMontoWebDirectoConIva / 1.19);
    const ticketPromedioWebDirecto =
      comprasWebDirecto.length > 0
        ? Math.round(totalMontoWebDirectoConIva / comprasWebDirecto.length)
        : 0;
    const unidadesWebDirecto = comprasWebDirecto.reduce(
      (acc, p) => acc + (Number(p.itemsCount) || 1),
      0
    );

    // ── 2. CANAL REPUESTÍN WHATSAPP (+56 9 2110 9851) ────────────────────────
    const CORTE_REPUESTIN_ISO = '2026-11-17T02:50:00.000Z';
    const pedidosRepuestinFirestore = (pedidosRepuestinSnap.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => {
        const f = String(p.createdAt || p.updatedAt || '');
        return f >= CORTE_REPUESTIN_ISO && p.estadoPago !== 'cancelado';
      });

    const pedidosWooDeRepuestin = todosPedidosWoo.filter(
      (p) => p.canalOrigen === 'repuestin_wsp' && !estadosCancelados.has(p.estadoWoo)
    );

    // Unificar por codigoPedido / wooOrderId para no duplicar si está en ambos
    const repuestinMap = new Map();
    for (const p of pedidosRepuestinFirestore) {
      const clave = String(p.codigoPedido || p.wooOrderId || p.id);
      const totalConIva = Math.round(
        (Number(p.totalConIva) || 0) + (Number(p.costoDespachoConIva) || 0)
      );
      repuestinMap.set(clave, {
        id: p.id,
        codigo: p.codigoPedido || `WSP-${String(p.id).slice(0, 6)}`,
        wooOrderId: p.wooOrderId || null,
        fecha: p.createdAt || p.updatedAt || new Date().toISOString(),
        clienteNombre: p.clienteNombre || 'Cliente WhatsApp',
        clienteTelefono: p.clienteTelefono || '',
        patente: p.vehiculo?.patente || '',
        modalidadEntrega:
          p.modalidadEntrega === 'retiro_bodega'
            ? 'Retiro Enrique Olivares 224'
            : `Delivery (${p.comunaEntrega || 'Santiago'})`,
        estado: p.estadoPago === 'pagado' ? 'Pagado' : 'Carro Generado',
        totalNeto: Math.round(totalConIva / 1.19),
        totalConIva,
        itemsCount: Array.isArray(p.items)
          ? p.items.reduce((s, it) => s + (Number(it.cantidad) || 1), 0)
          : 1,
        resumenItems: Array.isArray(p.items)
          ? p.items.map((it) => it.nombre || it.skuPublicoFrp).join(', ')
          : 'Pedido Repuestín WhatsApp',
      });
    }

    for (const pw of pedidosWooDeRepuestin) {
      const clave = String(pw.codigoPedidoFrp || pw.id);
      if (repuestinMap.has(clave)) continue;
      repuestinMap.set(clave, {
        id: pw.id,
        codigo: pw.codigoPedidoFrp || `WOO-#${pw.numeroPedido}`,
        wooOrderId: pw.id,
        fecha: pw.fecha,
        clienteNombre: pw.clienteNombre,
        clienteTelefono: pw.clienteTelefono,
        patente: '',
        modalidadEntrega: pw.comuna || 'Santiago',
        estado: ['processing', 'completed'].includes(pw.estadoWoo) ? 'Pagado' : 'Pendiente Pago',
        totalNeto: pw.totalNeto,
        totalConIva: pw.totalConIva,
        itemsCount: pw.itemsCount,
        resumenItems: (pw.items || []).map((i) => i.nombre).join(', '),
      });
    }

    const ventasRepuestin = Array.from(repuestinMap.values()).sort((a, b) =>
      String(b.fecha || '').localeCompare(String(a.fecha || ''))
    );

    const sesionesActivasRepuestin = (sesionesWspSnap.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => {
        const f = String(s.updatedAt || s.createdAt || '');
        return (
          s.canal === 'whatsapp_cliente' &&
          !s.archivadaEnPanel &&
          f >= CORTE_REPUESTIN_ISO
        );
      });

    const carritosActivosRepuestin = sesionesActivasRepuestin.filter(
      (s) => Array.isArray(s.carritoCotizado) && s.carritoCotizado.length > 0
    );

    const totalMontoRepuestinConIva = ventasRepuestin.reduce(
      (acc, v) => acc + (Number(v.totalConIva) || 0),
      0
    );
    const totalMontoRepuestinNeto = Math.round(totalMontoRepuestinConIva / 1.19);
    const ticketPromedioRepuestin =
      ventasRepuestin.length > 0
        ? Math.round(totalMontoRepuestinConIva / ventasRepuestin.length)
        : 0;
    const unidadesRepuestin = ventasRepuestin.reduce(
      (acc, v) => acc + (Number(v.itemsCount) || 1),
      0
    );

    // ── 3. CANAL POS SUCURSAL ENRIQUE OLIVARES 224 (LA FLORIDA) ──────────────
    const todosDocsPos = (ventasPosSnap.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    const ticketsPosConfirmados = todosDocsPos.filter(
      (v) => v.tipoDocumento !== 'COTIZACION' && v.estado !== 'ANULADA'
    );
    const cotizacionesPosMeson = todosDocsPos.filter(
      (v) => v.tipoDocumento === 'COTIZACION'
    );

    const totalMontoPosConIva = ticketsPosConfirmados.reduce(
      (acc, v) => acc + (Number(v.total) || 0),
      0
    );
    const totalMontoPosNeto = ticketsPosConfirmados.reduce(
      (acc, v) => acc + (Number(v.totalNeto) || Math.round((Number(v.total) || 0) / 1.19)),
      0
    );
    const ticketPromedioPos =
      ticketsPosConfirmados.length > 0
        ? Math.round(totalMontoPosConIva / ticketsPosConfirmados.length)
        : 0;
    const unidadesPos = ticketsPosConfirmados.reduce((acc, v) => {
      const its = Array.isArray(v.items) ? v.items : [];
      return acc + its.reduce((s, it) => s + (Number(it.cantidad) || 1), 0);
    }, 0);

    const desgloseMediosPagoPos = {
      EFECTIVO: 0,
      TARJETA: 0,
      TRANSFERENCIA: 0,
    };
    for (const t of ticketsPosConfirmados) {
      const mp = String(t.metodoPago || 'EFECTIVO').toUpperCase();
      if (mp.includes('TARJETA') || mp.includes('DEBITO') || mp.includes('CREDITO')) {
        desgloseMediosPagoPos.TARJETA += Number(t.total) || 0;
      } else if (mp.includes('TRANSF')) {
        desgloseMediosPagoPos.TRANSFERENCIA += Number(t.total) || 0;
      } else {
        desgloseMediosPagoPos.EFECTIVO += Number(t.total) || 0;
      }
    }

    // ── 4. CONSOLIDADO EN CONJUNTO (LOS 3 CANALES UNIDOS) ────────────────────
    const totalConjuntoConIva =
      totalMontoWebDirectoConIva + totalMontoRepuestinConIva + totalMontoPosConIva;
    const totalConjuntoNeto =
      totalMontoWebDirectoNeto + totalMontoRepuestinNeto + totalMontoPosNeto;
    const totalOperacionesConjunto =
      comprasWebDirecto.length + ventasRepuestin.length + ticketsPosConfirmados.length;
    const totalUnidadesConjunto =
      unidadesWebDirecto + unidadesRepuestin + unidadesPos;
    const ticketPromedioConjunto =
      totalOperacionesConjunto > 0
        ? Math.round(totalConjuntoConIva / totalOperacionesConjunto)
        : 0;

    const pct = (monto) =>
      totalConjuntoConIva > 0 ? Math.round((monto / totalConjuntoConIva) * 100) : 0;

    // Flujo unificado de las últimas operaciones de los 3 canales para análisis cruzado
    const operacionesUnificadas = [
      ...comprasWebDirecto.slice(0, 25).map((p) => ({
        id: `web_${p.id}`,
        canal: 'web_directo',
        canalLabel: '🌐 Web Directo (WordPress)',
        codigo: `#${p.numeroPedido}`,
        fecha: p.fecha,
        cliente: p.clienteNombre,
        contacto: p.clienteEmail || p.clienteTelefono || p.comuna,
        detalle: (p.items || []).map((i) => `${i.cantidad}x ${i.nombre}`).join(', ') || 'Compra en facilrepuestos.cl',
        modalidad: p.comuna ? `Web (${p.comuna})` : 'Checkout Web',
        estado: p.estadoWoo === 'completed' || p.estadoWoo === 'processing' ? 'Pagado Web' : p.estadoWoo,
        totalNeto: p.totalNeto,
        totalConIva: p.totalConIva,
      })),
      ...ventasRepuestin.slice(0, 25).map((v) => ({
        id: `wsp_${v.id}`,
        canal: 'repuestin_wsp',
        canalLabel: '🤖 Repuestín WhatsApp',
        codigo: v.codigo,
        fecha: v.fecha,
        cliente: v.clienteNombre,
        contacto: v.clienteTelefono || v.patente || 'WhatsApp',
        detalle: v.resumenItems,
        modalidad: v.modalidadEntrega,
        estado: v.estado,
        totalNeto: v.totalNeto,
        totalConIva: v.totalConIva,
      })),
      ...ticketsPosConfirmados.slice(0, 25).map((t) => ({
        id: `pos_${t.id}`,
        canal: 'pos_olivares',
        canalLabel: '🏪 POS Enrique Olivares 224',
        codigo: t.numeroTicket || `POS-${String(t.id).slice(0, 5)}`,
        fecha: t.fecha,
        cliente: t.cliente?.nombre || 'Cliente Mesón Olivares 224',
        contacto: t.cliente?.rut || t.cliente?.telefono || t.metodoPago || 'Mesón',
        detalle: Array.isArray(t.items)
          ? t.items.map((i) => `${i.cantidad || 1}x ${i.nombre || i.codigo}`).join(', ')
          : 'Venta Mesón POS',
        modalidad: `Sucursal Olivares 224 (${t.metodoPago || 'EFECTIVO'})`,
        estado: 'Completada POS',
        totalNeto: Number(t.totalNeto) || Math.round((Number(t.total) || 0) / 1.19),
        totalConIva: Number(t.total) || 0,
      })),
    ].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    res.json({
      success: true,
      data: {
        actualizadoEn: new Date().toISOString(),
        wooConfigurado: Boolean(wooLiveRes.configurado),
        enConjunto: {
          totalVentasConIva: totalConjuntoConIva,
          totalVentasNeto: totalConjuntoNeto,
          totalOperaciones: totalOperacionesConjunto,
          totalUnidades: totalUnidadesConjunto,
          ticketPromedioConIva: ticketPromedioConjunto,
          participacionPct: {
            webDirecto: pct(totalMontoWebDirectoConIva),
            repuestinWsp: pct(totalMontoRepuestinConIva),
            posOlivares: pct(totalMontoPosConIva),
          },
        },
        canales: {
          webDirecto: {
            id: 'web_directo',
            nombre: 'Ventas Web WordPress (Directo)',
            subtitulo: 'Compras directas en facilrepuestos.cl sin pasar por Repuestín',
            totalVentasConIva: totalMontoWebDirectoConIva,
            totalVentasNeto: totalMontoWebDirectoNeto,
            totalPedidos: comprasWebDirecto.length,
            pedidosPagados: comprasWebPagadas.length,
            unidadesVendidas: unidadesWebDirecto,
            ticketPromedioConIva: ticketPromedioWebDirecto,
            participacionPct: pct(totalMontoWebDirectoConIva),
            pedidosRecientes: comprasWebDirecto.slice(0, 30),
          },
          repuestinWsp: {
            id: 'repuestin_wsp',
            nombre: 'Repuestín WhatsApp (+56 9 2110 9851)',
            subtitulo: 'Ventas y carros cerrados por el asistente en WhatsApp Oficial',
            totalVentasConIva: totalMontoRepuestinConIva,
            totalVentasNeto: totalMontoRepuestinNeto,
            totalPedidos: ventasRepuestin.length,
            conversacionesActivas24h: sesionesActivasRepuestin.length,
            carritosCotizadosActivos: carritosActivosRepuestin.length,
            unidadesVendidas: unidadesRepuestin,
            ticketPromedioConIva: ticketPromedioRepuestin,
            participacionPct: pct(totalMontoRepuestinConIva),
            pedidosRecientes: ventasRepuestin.slice(0, 30),
          },
          posOlivares: {
            id: 'pos_olivares',
            nombre: 'Ventas POS Enrique Olivares 224',
            subtitulo: 'Ventas presenciales y retiro en mesón La Florida',
            totalVentasConIva: totalMontoPosConIva,
            totalVentasNeto: totalMontoPosNeto,
            totalTickets: ticketsPosConfirmados.length,
            cotizacionesMeson: cotizacionesPosMeson.length,
            unidadesVendidas: unidadesPos,
            ticketPromedioConIva: ticketPromedioPos,
            participacionPct: pct(totalMontoPosConIva),
            mediosPago: desgloseMediosPagoPos,
            ticketsRecientes: ticketsPosConfirmados.slice(0, 30),
          },
        },
        operacionesUnificadas: operacionesUnificadas.slice(0, 50),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/woocommerce/marcas-compatibilidad
// Devuelve el árbol de 3 niveles de compatibilidad vehicular (Marca -> Modelo -> Rango Años) extraído del inventario
router.get('/marcas-compatibilidad', requireAuth, async (req, res, next) => {
  try {
    const resumen = await obtenerResumenMarcasCompatibilidadInventario();
    res.json({ success: true, data: resumen });
  } catch (error) {
    next(error);
  }
});

// POST /api/woocommerce/sync-marcas-compatibilidad
// Crea toda la jerarquía de 3 niveles en Productos -> Marcas de WooCommerce (Marca -> Modelo -> Rango de Años)
// y encola/sincroniza los productos para asignarles sus marcas y atributos de compatibilidad.
router.post('/sync-marcas-compatibilidad', requireSyncAccess, async (req, res, next) => {
  try {
    const encolarProductos = req.body?.encolarProductos !== false;
    const sincronizarLoteInmediato = req.body?.sincronizarLoteInmediato !== false;
    const maxProductosLote = Number(req.body?.maxProductosLote || 100) || 100;
    const maxCreacionesTaxonomia = Number(req.body?.maxCreacionesTaxonomia || 180) || 180;
    const resultado = await sincronizarMarcasCompatibilidadWooCommerce({
      encolarProductos,
      sincronizarLoteInmediato,
      maxProductosLote,
      maxCreacionesTaxonomia,
    });
    res.json({ success: true, data: resultado });
  } catch (error) {
    next(error);
  }
});

// POST /api/woocommerce/sync
// Por defecto ejecuta sincronización incremental (`soloDelta: true`), enviando únicamente
// los productos con `needsWooSync === true` en lotes seguros (por defecto 150 por llamada).
router.post('/sync', requireSyncAccess, async (req, res, next) => {
  try {
    const soloDelta = req.body?.soloDelta !== false && req.query?.soloDelta !== 'false';
    const maxItems = Math.min(300, Math.max(25, Number(req.body?.maxItems || req.query?.maxItems || 150) || 150));
    const resultado = await sincronizarInventarioConWooCommerce({ soloDelta, maxItems });
    res.json({ success: true, data: resultado });
  } catch (error) {
    next(error);
  }
});

// POST /api/woocommerce/sync-ailoo
// Ingesta incrementalmente (Delta) los catálogos de TODOS los nodos Ailoo activos (`soluparts` + `global`)
// hacia Firebase `inventario`. Si `autoSyncWoo: true`, dispara inmediatamente el Delta Sync a WooCommerce.
router.post('/sync-ailoo', requireSyncAccess, async (req, res, next) => {
  try {
    const forzar = Boolean(req.body?.forzar);
    const autoSyncWoo = Boolean(req.body?.autoSyncWoo);
    const ingesta = await sincronizarTodosLosNodosAiloo({ forzar });
    let wooSync = null;
    if (autoSyncWoo) {
      wooSync = await sincronizarInventarioConWooCommerce({ soloDelta: true });
    }
    res.json({ success: true, data: { ingesta, wooSync } });
  } catch (error) {
    next(error);
  }
});

// POST /api/woocommerce/sync-ailoo/:nodoId
// Ingesta incrementalmente (Delta) el catálogo de un nodo Ailoo específico (`soluparts` o `global`)
// hacia Firebase `inventario`.
router.post('/sync-ailoo/:nodoId', requireSyncAccess, async (req, res, next) => {
  try {
    const { nodoId } = req.params;
    const forzar = Boolean(req.body?.forzar);
    const autoSyncWoo = Boolean(req.body?.autoSyncWoo);
    const ingesta = await sincronizarCatalogoNodoAiloo(nodoId, { forzar });
    let wooSync = null;
    if (autoSyncWoo) {
      wooSync = await sincronizarInventarioConWooCommerce({ soloDelta: true });
    }
    res.json({ success: true, data: { ingesta, wooSync } });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// WEBHOOK: WooCommerce → nuestro sistema (descuenta stock al vender)
// ═══════════════════════════════════════════════════════════
// WooCommerce firma cada webhook con HMAC-SHA256 usando el "secret" que se
// configura al crear el webhook. Verificamos esa firma para asegurarnos de
// que el pedido realmente viene de WooCommerce y no de cualquiera que
// encuentre la URL.
function verificarFirmaWebhook(req) {
  const firma  = req.headers['x-wc-webhook-signature'];
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  if (!firma || !secret || !req.rawBody) return false;

  const hashEsperado = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hashEsperado), Buffer.from(firma));
  } catch {
    return false; // largos distintos, etc.
  }
}

/**
 * Busca un documento en `inventario` por `skuPublicoFrp` (`FRP-SOL-...`, `FRP-GLB-...`, `FRP-LOC-...`)
 * o por `codigo` interno del proveedor.
 */
async function buscarProductoPorSkuWebhook(skuRaw) {
  const sku = String(skuRaw || '').trim().toUpperCase();
  if (!sku) return null;

  const snapSkuPublico = await db
    .collection('inventario')
    .where('skuPublicoFrp', '==', sku)
    .limit(1)
    .get();
  if (!snapSkuPublico.empty) return snapSkuPublico.docs[0];

  const snapCodigo = await db
    .collection('inventario')
    .where('codigo', '==', sku)
    .limit(1)
    .get();
  if (!snapCodigo.empty) return snapCodigo.docs[0];

  if (sku.startsWith('DRM-')) {
    const docId = sku.slice(4);
    const d = await db.collection('inventario').doc(docId).get();
    if (d.exists) return d;
  }

  return null;
}

// POST /api/woocommerce/webhook/pedido
router.post('/webhook/pedido', async (req, res, next) => {
  try {
    // El "ping" de validación que manda WooCommerce automáticamente al crear/
    // guardar el webhook NO lleva firma ni manda el pedido en JSON (manda un
    // cuerpo mínimo x-www-form-urlencoded) — solo confirma que la URL responde
    // 200. Lo dejamos pasar sin procesar nada; no representa ningún riesgo,
    // ya que sin firma nunca llegamos a descontar stock más abajo.
    if (!req.headers['x-wc-webhook-signature']) {
      return res.json({ success: true, skip: true, motivo: 'Ping de validación de WooCommerce' });
    }

    if (!verificarFirmaWebhook(req)) {
      return res.status(401).json({ success: false, error: 'Firma inválida' });
    }

    const pedido = req.body;

    // WooCommerce manda un "ping" vacío al crear el webhook, para probar la URL
    if (!pedido || !pedido.id) {
      return res.json({ success: true, skip: true, motivo: 'Ping de prueba' });
    }

    const idPedido = String(pedido.id);
    const procesadoRef  = db.collection('woocommerce_pedidos_procesados').doc(idPedido);
    const procesadoSnap = await procesadoRef.get();

    const estadosQueDescuentan = ['processing', 'completed'];
    const estadosQueRestauran  = ['cancelled', 'refunded', 'failed', 'trash'];

    // ── CASO 1: el pedido se pagó/confirmó → descontar stock ──────────
    if (estadosQueDescuentan.includes(pedido.status)) {
      if (procesadoSnap.exists) {
        return res.json({ success: true, skip: true, motivo: 'Pedido ya procesado antes' });
      }

      const lineItems = pedido.line_items || [];
      const batch = db.batch();
      const itemsProcesados = [];
      const ahora = new Date().toISOString();

      for (const li of lineItems) {
        const sku = (li.sku || '').toUpperCase();
        if (!sku) continue;

        const doc = await buscarProductoPorSkuWebhook(sku);
        if (!doc) continue; // no era un producto que viene del inventario (ej: uno cargado a mano)

        const actual = doc.data();
        const cantidad = li.quantity || 0;
        const nuevoStock = Math.max(0, round2((actual.stock || 0) - cantidad));
        const nuevoHash = calcularHashCatalogoItem({ ...actual, stock: nuevoStock });
        batch.update(doc.ref, {
          stock: nuevoStock,
          deltaHash: nuevoHash,
          updatedAt: ahora,
          lastWooSyncAt: ahora,
          needsWooSync: false,
        });
        itemsProcesados.push({
          inventarioId: doc.id,
          codigo: actual.codigo || sku,
          skuPublicoFrp: actual.skuPublicoFrp || sku,
          proveedorId: actual.proveedorId || null,
          origenDatos: actual.origenDatos || 'proveedor_local',
          cantidad,
        });
      }

      batch.set(procesadoRef, {
        procesadoEn: ahora,
        items: itemsProcesados,
        totalPedido: pedido.total || null,
      });
      await batch.commit();

      return res.json({ success: true, itemsDescontados: itemsProcesados.length });
    }

    // ── CASO 2: el pedido se canceló, reembolsó o eliminó → devolver stock ──
    // (WooCommerce a veces manda estos eventos sin "status" cuando el pedido
    // se elimina definitivamente — por eso también entra aquí si ya lo
    // teníamos procesado, sin importar qué venga en pedido.status)
    if (estadosQueRestauran.includes(pedido.status) || (!pedido.status && procesadoSnap.exists)) {
      if (!procesadoSnap.exists) {
        return res.json({ success: true, skip: true, motivo: 'Este pedido nunca había descontado stock' });
      }

      const { items: itemsProcesados = [] } = procesadoSnap.data();
      const batch = db.batch();
      const ahora = new Date().toISOString();

      for (const item of itemsProcesados) {
        const ref = db.collection('inventario').doc(item.inventarioId);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const actual = snap.data();
        const stockRestaurado = round2((actual.stock || 0) + (item.cantidad || 0));
        const nuevoHash = calcularHashCatalogoItem({ ...actual, stock: stockRestaurado });
        batch.update(ref, {
          stock: stockRestaurado,
          deltaHash: nuevoHash,
          updatedAt: ahora,
          lastWooSyncAt: ahora,
          needsWooSync: false,
        });
      }

      batch.delete(procesadoRef); // permite volver a procesarlo si el pedido reaparece
      await batch.commit();

      return res.json({ success: true, itemsRestaurados: itemsProcesados.length });
    }

    // ── Cualquier otro estado (pending, draft, etc.) → no hacemos nada ──
    return res.json({ success: true, skip: true, motivo: `Estado "${pedido.status}" no requiere acción` });
  } catch (error) {
    next(error);
  }
});

// GET /api/woocommerce/export
// Exporta el catálogo completo directo desde la API de WooCommerce — alternativa
// al exportador nativo de WordPress cuando este falla.
router.get('/export', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const csv = await exportarCatalogoCSV();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="catalogo-woocommerce.csv"');
    res.send('\uFEFF' + csv); // BOM para que Excel abra bien las tildes
  } catch (error) {
    next(error);
  }
});

export default router;
