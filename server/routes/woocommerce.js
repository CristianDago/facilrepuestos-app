import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sincronizarInventarioConWooCommerce, exportarCatalogoCSV } from '../services/woocommerceSync.js';

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
  // Si no vino la clave de servidor, exigir sesión de admin normal
  return requireAuth(req, res, () => requireAdmin(req, res, next));
}

// POST /api/woocommerce/sync
router.post('/sync', requireSyncAccess, async (req, res, next) => {
  try {
    const resultado = await sincronizarInventarioConWooCommerce();
    res.json({ success: true, data: resultado });
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

      for (const li of lineItems) {
        const sku = (li.sku || '').toUpperCase();
        if (!sku) continue;

        const snap = await db.collection('inventario').where('codigo', '==', sku).limit(1).get();
        if (snap.empty) continue; // no era un producto que viene del inventario (ej: uno cargado a mano)

        const doc = snap.docs[0];
        const actual = doc.data();
        const cantidad = li.quantity || 0;
        const nuevoStock = Math.max(0, round2((actual.stock || 0) - cantidad));
        batch.update(doc.ref, { stock: nuevoStock, updatedAt: new Date().toISOString() });
        itemsProcesados.push({ inventarioId: doc.id, codigo: sku, cantidad });
      }

      batch.set(procesadoRef, {
        procesadoEn: new Date().toISOString(),
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

      for (const item of itemsProcesados) {
        const ref = db.collection('inventario').doc(item.inventarioId);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const actual = snap.data();
        const stockRestaurado = round2((actual.stock || 0) + (item.cantidad || 0));
        batch.update(ref, { stock: stockRestaurado, updatedAt: new Date().toISOString() });
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