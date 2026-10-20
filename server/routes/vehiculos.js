import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// ─── SINCRONIZACIÓN CON COTIZACIONES Y OTs ─────────────────────
// Cotizaciones y OTs guardan una copia de los datos del cliente/vehículo.
// Cuando se edita el vehículo (ej. cambiar "TOMÁS" por "TOMÁS VALDERRAMA"),
// se propagan los cambios a todos los documentos con esa patente para que
// las listas queden consistentes. Consulta por un solo campo (sin índices).
const CAMPOS_SYNC = {
  owner:     'nombre',
  telefono:  'telefono',
  email:     'email',
  make:      'marca',
  model:     'modelo',
  year:      'anio',
  type:      'tipo',
  engine:    'motor',
};

async function propagarCambiosVehiculo(patente, data) {
  const cambios = {};
  for (const [campoVeh, campoDoc] of Object.entries(CAMPOS_SYNC)) {
    if (data[campoVeh] !== undefined && data[campoVeh] !== null && data[campoVeh] !== '') {
      cambios[campoDoc] = data[campoVeh];
    }
  }
  if (!Object.keys(cambios).length) return 0;

  const now = new Date().toISOString();
  let total = 0;
  for (const coleccion of ['cotizaciones', 'ordenes_trabajo']) {
    const snap = await db.collection(coleccion).where('patente', '==', patente).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach(d => {
        batch.update(d.ref, { ...cambios, updatedAt: now });
      });
      await batch.commit();
      total += Math.min(400, snap.docs.length - i);
    }
  }
  return total;
}

// GET /api/vehiculos
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('vehiculos')
      .orderBy('updatedAt', 'desc')
      .get();

    const vehiculos = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ success: true, data: vehiculos });
  } catch (error) {
    next(error);
  }
});

// GET /api/vehiculos/:patente
router.get('/:patente', async (req, res, next) => {
  try {
    const { patente } = req.params;
    const snap = await db.collection('vehiculos').doc(patente).get();

    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        error: 'Vehículo no encontrado',
      });
    }

    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (error) {
    next(error);
  }
});

// POST /api/vehiculos
router.post('/', async (req, res, next) => {
  try {
    const { patente, ...data } = req.body;

    if (!patente) {
      return res.status(400).json({
        success: false,
        error: 'La patente es requerida',
      });
    }

    const now = new Date().toISOString();
    await db.collection('vehiculos').doc(patente).set({
      patente,
      ...data,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    // Propagar cambios de cliente/vehículo a cotizaciones y OTs existentes
    try { await propagarCambiosVehiculo(patente, data); }
    catch (e) { console.error('Error sincronizando vehículo:', e.message); }

    res.json({ success: true, data: { patente } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/vehiculos/:patente
router.put('/:patente', async (req, res, next) => {
  try {
    const { patente } = req.params;
    const data = req.body;

    await db.collection('vehiculos').doc(patente).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });

    // Propagar cambios de cliente/vehículo a cotizaciones y OTs existentes
    try { await propagarCambiosVehiculo(patente, data); }
    catch (e) { console.error('Error sincronizando vehículo:', e.message); }

    res.json({ success: true, data: { patente } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/vehiculos/:patente
router.delete('/:patente', async (req, res, next) => {
  try {
    const { patente } = req.params;
    await db.collection('vehiculos').doc(patente).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;