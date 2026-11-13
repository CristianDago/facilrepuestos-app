import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  sincronizarInventarioConWooCommerce,
  obtenerEstadoColaWooCommerce,
  exportarCatalogoCSV,
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

// POST /api/woocommerce/sync
// Por defecto ejecuta sincronización incremental (`soloDelta: true`), enviando únicamente
// los productos con `needsWooSync === true`. Si se envía `{ soloDelta: false }`, fuerza catálogo completo.
router.post('/sync', requireSyncAccess, async (req, res, next) => {
  try {
    const soloDelta = req.body?.soloDelta !== false && req.query?.soloDelta !== 'false';
    const maxItems = Number(req.body?.maxItems || req.query?.maxItems || 0) || 0;
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
