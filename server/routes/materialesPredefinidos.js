import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// GET /api/materiales-predefinidos
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('materiales_predefinidos')
      .orderBy('nombre', 'asc').get();
    const materiales = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: materiales });
  } catch (error) { next(error); }
});

// POST /api/materiales-predefinidos
router.post('/', async (req, res, next) => {
  try {
    const { nombre, unidad } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'Nombre requerido' });
    const now    = new Date().toISOString();
    const docRef = await db.collection('materiales_predefinidos').add({
      nombre:    nombre.trim().toUpperCase(),
      unidad:    (unidad || 'UNIDAD').trim().toUpperCase(),
      createdAt: now,
      updatedAt: now,
    });
    res.json({ success: true, data: { id: docRef.id } });
  } catch (error) { next(error); }
});

// PUT /api/materiales-predefinidos/:id
router.put('/:id', async (req, res, next) => {
  try {
    await db.collection('materiales_predefinidos').doc(req.params.id).update({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// DELETE /api/materiales-predefinidos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('materiales_predefinidos').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;