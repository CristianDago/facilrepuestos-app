import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// GET /api/categorias
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('categorias')
      .orderBy('nombre', 'asc')
      .get();
    const categorias = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: categorias });
  } catch (error) {
    next(error);
  }
});

// POST /api/categorias
router.post('/', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'Nombre requerido' });
    }

    const existing = await db.collection('categorias')
      .where('nombre', '==', nombre.trim().toUpperCase())
      .get();

    if (!existing.empty) {
      return res.status(400).json({ success: false, error: 'Esta categoría ya existe' });
    }

    const now    = new Date().toISOString();
    const docRef = await db.collection('categorias').add({
      nombre:    nombre.trim().toUpperCase(),
      custom:    true,
      createdAt: now,
    });

    res.json({ success: true, data: { id: docRef.id, nombre: nombre.trim().toUpperCase() } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/categorias/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('categorias').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;