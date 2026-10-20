import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('mecanicos').orderBy('nombre', 'asc').get();
    const mecanicos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: mecanicos });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, telefono, especialidad } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'Nombre requerido' });
    const now = new Date().toISOString();
    const docRef = await db.collection('mecanicos').add({
      nombre, telefono: telefono || '', especialidad: especialidad || '',
      activo: true, createdAt: now, updatedAt: now,
    });
    res.json({ success: true, data: { id: docRef.id } });
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    await db.collection('mecanicos').doc(req.params.id).update({
      ...req.body, updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('mecanicos').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;