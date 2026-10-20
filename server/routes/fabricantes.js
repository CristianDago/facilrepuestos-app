import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

const FABRICANTES_DEFAULT = [
  'HK', 'MANN-FILTER', 'BOSCH', 'LPR', 'BREMBO', 'FRAM', 'ORIGINAL/OEM'
];

// GET /api/fabricantes
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('fabricantes').orderBy('nombre', 'asc').get();
    const custom = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Merge defaults with custom, avoiding duplicates
    const customNombres = custom.map(f => f.nombre);
    const defaults = FABRICANTES_DEFAULT
      .filter(n => !customNombres.includes(n))
      .map(n => ({ nombre: n, default: true }));
    const all = [
      ...FABRICANTES_DEFAULT.map(n => {
        const found = custom.find(f => f.nombre === n);
        return found || { nombre: n, default: true };
      }),
      ...custom.filter(f => !FABRICANTES_DEFAULT.includes(f.nombre)),
    ];
    res.json({ success: true, data: all });
  } catch (error) { next(error); }
});

// POST /api/fabricantes
router.post('/', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'Nombre requerido' });
    const existing = await db.collection('fabricantes').where('nombre', '==', nombre.trim()).get();
    if (!existing.empty) return res.status(400).json({ success: false, error: 'Ya existe' });
    const docRef = await db.collection('fabricantes').add({
      nombre: nombre.trim().toUpperCase(), custom: true, createdAt: new Date().toISOString()
    });
    res.json({ success: true, data: { id: docRef.id, nombre: nombre.trim().toUpperCase() } });
  } catch (error) { next(error); }
});

// DELETE /api/fabricantes/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('fabricantes').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;