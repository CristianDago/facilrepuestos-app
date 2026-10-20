import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('servicios_predefinidos')
      .orderBy('nombre', 'asc').get();
    const servicios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: servicios });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, precioAuto, precioSUV, precioCamioneta, detalle } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'Nombre requerido' });
    const now    = new Date().toISOString();
    const docRef = await db.collection('servicios_predefinidos').add({
      nombre:          nombre.trim().toUpperCase(),
      precioAuto:      precioAuto      || 0,
      precioSUV:       precioSUV       || 0,
      precioCamioneta: precioCamioneta || 0,
      detalle:         detalle         || '',
      createdAt: now,
      updatedAt: now,
    });
    res.json({ success: true, data: { id: docRef.id } });
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    await db.collection('servicios_predefinidos').doc(req.params.id).update({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('servicios_predefinidos').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;