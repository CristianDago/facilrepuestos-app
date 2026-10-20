import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { limpiarProductosHuerfanos } from '../services/woocommerceSync.js';

const router = Router();

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const LOCALHOST_PREFIX = 'http://localhost:3001';
const PROD_PREFIX      = 'https://api.drmotors.cl';

// POST /api/mantenimiento/fix-localhost-urls
// Corrige links de Drive que quedaron apuntando a localhost (subidos durante
// pruebas locales) — reemplaza el prefijo por el de producción. Los archivos
// ya están en Drive, esto solo corrige el link guardado en Firestore.
router.post('/fix-localhost-urls', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    let corregidos = 0;
    const detalle = [];

    const usuariosSnap = await db.collection('usuarios').get();
    for (const doc of usuariosSnap.docs) {
      const data = doc.data();
      if (data.contratoUrl?.startsWith(LOCALHOST_PREFIX)) {
        const nuevaUrl = data.contratoUrl.replace(LOCALHOST_PREFIX, PROD_PREFIX);
        await doc.ref.update({ contratoUrl: nuevaUrl });
        corregidos++;
        detalle.push({ tipo: 'contrato', persona: `${data.nombre} ${data.apellido}`, nuevaUrl });
      }
    }

    const liqSnap = await db.collection('liquidaciones').get();
    for (const doc of liqSnap.docs) {
      const data = doc.data();
      if (data.url?.startsWith(LOCALHOST_PREFIX)) {
        const nuevaUrl = data.url.replace(LOCALHOST_PREFIX, PROD_PREFIX);
        await doc.ref.update({ url: nuevaUrl });
        corregidos++;
        detalle.push({ tipo: 'liquidacion', periodo: data.periodo, nuevaUrl });
      }
    }

    res.json({ success: true, corregidos, detalle });
  } catch (error) {
    next(error);
  }
});

// POST /api/mantenimiento/reconciliar-stock-reservado
// El "stockReservado" de cada ítem se va sumando/restando incrementalmente
// cada vez que se crea, edita, entrega o elimina una OT. Si algún paso de ese
// proceso falla a medias (ej: un error de red a mitad de una actualización),
// el contador queda desincronizado de la realidad ("reservas fantasma").
// Este endpoint recalcula el valor REAL sumando directamente las OT activas
// (no Entregadas) que usan cada repuesto, y corrige cualquier diferencia.
router.post('/reconciliar-stock-reservado', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ordenesSnap = await db.collection('ordenes_trabajo').get();
    const reservasReales = new Map(); // inventarioId -> cantidad reservada real

    for (const doc of ordenesSnap.docs) {
      const ot = doc.data();
      if (ot.estado === 'Entregado') continue; // ya se descontó del stock, no reserva
      for (const rep of ot.repuestos || []) {
        if (!rep.inventarioId) continue;
        reservasReales.set(
          rep.inventarioId,
          round2((reservasReales.get(rep.inventarioId) || 0) + (rep.cantidad || 0))
        );
      }
    }

    const invSnap = await db.collection('inventario').get();
    let corregidos = 0;
    const detalle = [];

    for (const doc of invSnap.docs) {
      const item = doc.data();
      const real   = reservasReales.get(doc.id) || 0;
      const actual = round2(item.stockReservado || 0);
      if (Math.abs(real - actual) > 0.001) {
        await doc.ref.update({ stockReservado: real, updatedAt: new Date().toISOString() });
        corregidos++;
        detalle.push({ nombre: item.nombre, antes: actual, despues: real });
      }
    }

    res.json({ success: true, corregidos, detalle });
  } catch (error) {
    next(error);
  }
});

// POST /api/mantenimiento/limpiar-productos-huerfanos-woocommerce
// Busca productos en WooCommerce que el sistema creó (tienen el meta
// _drmotors_inventario_id) pero cuyo SKU ya no existe en el inventario actual,
// y los elimina. Nunca toca productos agregados a mano en WooCommerce.
router.post('/limpiar-productos-huerfanos-woocommerce', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const resultado = await limpiarProductosHuerfanos();
    res.json({ success: true, corregidos: resultado.eliminados, detalle: resultado.detalle });
  } catch (error) {
    next(error);
  }
});

export default router;