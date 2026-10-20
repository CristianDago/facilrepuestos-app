import { Router } from 'express';
import { db }      from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/liquidaciones — lista TODAS (admin), usado para sumar sueldos en reportes
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection('liquidaciones').get();
    const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/liquidaciones/:usuarioId — lista por trabajador
router.get('/:usuarioId', requireAuth, async (req, res, next) => {
  try {
    // Solo el administrador o el propio trabajador pueden ver sus liquidaciones
    const esPropio = req.user?.docId && req.user.docId === req.params.usuarioId;
    if (req.user?.rol !== 'admin' && !esPropio) {
      return res.status(403).json({ success: false, error: 'Sin permiso' });
    }
    const snap = await db.collection('liquidaciones')
      .where('usuarioId', '==', req.params.usuarioId)
      .get();
    const data = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => b.periodo.localeCompare(a.periodo));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/liquidaciones — crear registro (admin)
// El PDF ya fue subido al cliente a Firebase Storage, aquí guardamos metadata
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { usuarioId, periodo, monto, url, fileName } = req.body;
    if (!usuarioId || !periodo || !url)
      return res.status(400).json({ success: false, error: 'Faltan datos requeridos' });

    const now = new Date().toISOString();
    const docRef = await db.collection('liquidaciones').add({
      usuarioId, periodo, monto: monto || 0,
      url, fileName: fileName || 'liquidacion.pdf',
      createdAt: now,
    });
    res.json({ success: true, data: { id: docRef.id } });
  } catch (err) { next(err); }
});

// DELETE /api/liquidaciones/:id — eliminar registro (admin)
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.collection('liquidaciones').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;