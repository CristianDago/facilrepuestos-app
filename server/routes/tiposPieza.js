import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// GET /api/tipos-pieza — devuelve los tipos personalizados guardados
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('tipos_pieza')
      .orderBy('nombre', 'asc')
      .get();
    const tipos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: tipos });
  } catch (error) {
    next(error);
  }
});

// POST /api/tipos-pieza — agrega un tipo personalizado
router.post('/', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'Nombre requerido' });
    }

    // Verificar que no exista ya
    const existing = await db.collection('tipos_pieza')
      .where('nombre', '==', nombre.trim())
      .get();

    if (!existing.empty) {
      return res.status(400).json({ success: false, error: 'Este tipo ya existe' });
    }

    const now = new Date().toISOString();
    const docRef = await db.collection('tipos_pieza').add({
      nombre: nombre.trim(),
      custom: true,
      createdAt: now,
    });

    res.json({ success: true, data: { id: docRef.id, nombre: nombre.trim() } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tipos-pieza/:id — elimina un tipo personalizado
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('tipos_pieza').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;