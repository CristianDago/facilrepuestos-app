import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// GET /api/marcas-vehiculo — devuelve las marcas personalizadas guardadas
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('marcas_vehiculo')
      .orderBy('nombre', 'asc')
      .get();
    const marcas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: marcas });
  } catch (error) {
    next(error);
  }
});

// POST /api/marcas-vehiculo — agrega una marca personalizada
router.post('/', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'Nombre requerido' });
    }

    const nombreUpper = nombre.trim().toUpperCase();
    const existing = await db.collection('marcas_vehiculo')
      .where('nombre', '==', nombreUpper)
      .get();

    if (!existing.empty) {
      return res.status(400).json({ success: false, error: 'Esta marca ya existe' });
    }

    const now = new Date().toISOString();
    const docRef = await db.collection('marcas_vehiculo').add({
      nombre: nombreUpper,
      custom: true,
      createdAt: now,
    });

    res.json({ success: true, data: { id: docRef.id, nombre: nombreUpper } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/marcas-vehiculo/:id — elimina una marca personalizada
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('marcas_vehiculo').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;