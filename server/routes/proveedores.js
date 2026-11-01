import { Router } from 'express';
import { db } from '../config/firebase.js';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asegurarProveedoresWspDemo } from './mesaWsp.js';

const router = Router();

const rutToEmail = (rut) => {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return `${clean}@drmotors.internal`;
};

function normalizarProveedorPayload(body = {}) {
  const marcas = Array.isArray(body.marcas)
    ? body.marcas.map((m) => String(m).trim().toUpperCase()).filter(Boolean)
    : Array.isArray(body.marcasVehiculo)
      ? body.marcasVehiculo.map((m) => String(m).trim().toUpperCase()).filter(Boolean)
      : [];

  const categoriaPrincipal = String(body.categoria || 'General').trim();
  const categoriasEspecialidad = Array.isArray(body.categoriasEspecialidad) && body.categoriasEspecialidad.length > 0
    ? [...new Set(body.categoriasEspecialidad.map((c) => String(c).trim()).filter(Boolean))]
    : [categoriaPrincipal];

  const tipoIntegracion = body.tipoIntegracion || (body.uid ? 'portal_erp_local' : 'cotizacion_whatsapp');
  const canalWspActivo =
    body.canalWspActivo !== undefined
      ? Boolean(body.canalWspActivo)
      : tipoIntegracion === 'cotizacion_whatsapp' || tipoIntegracion === 'hibrido_erp_wsp';

  const margenPct = Number(body.margenPct) > 0 ? Number(body.margenPct) : 28;
  const prefijoSku = String(
    body.prefijoSku ||
      (tipoIntegracion === 'nodo_ailoo'
        ? 'FRP-AIL'
        : tipoIntegracion === 'cotizacion_whatsapp'
          ? 'FRP-WSP'
          : 'FRP-LOC')
  )
    .trim()
    .toUpperCase();

  const tiempoRespuestaPromMin =
    Number(body.tiempoRespuestaPromMin) > 0 ? Number(body.tiempoRespuestaPromMin) : 5;

  return {
    ...body,
    categoria: categoriaPrincipal,
    categoriasEspecialidad,
    marcas,
    marcasVehiculo: marcas,
    tipoIntegracion,
    canalWspActivo,
    margenPct,
    prefijoSku,
    tiempoRespuestaPromMin,
  };
}

function enriquecerProveedorLectura(p = {}) {
  const marcas = Array.isArray(p.marcas) && p.marcas.length > 0
    ? p.marcas
    : Array.isArray(p.marcasVehiculo)
      ? p.marcasVehiculo
      : [];
  const categoriasEspecialidad =
    Array.isArray(p.categoriasEspecialidad) && p.categoriasEspecialidad.length > 0
      ? p.categoriasEspecialidad
      : p.categoria
        ? [p.categoria]
        : ['General'];
  const tipoIntegracion =
    p.tipoIntegracion ||
    (p.nodoAilooId
      ? 'nodo_ailoo'
      : p.uid && p.canalWspActivo
        ? 'hibrido_erp_wsp'
        : p.uid
          ? 'portal_erp_local'
          : p.canalWspActivo
            ? 'cotizacion_whatsapp'
            : 'portal_erp_local');
  const canalWspActivo =
    p.canalWspActivo !== undefined
      ? Boolean(p.canalWspActivo)
      : tipoIntegracion === 'cotizacion_whatsapp' || tipoIntegracion === 'hibrido_erp_wsp';

  return {
    ...p,
    marcas,
    marcasVehiculo: marcas,
    categoriasEspecialidad,
    tipoIntegracion,
    canalWspActivo,
    margenPct: Number(p.margenPct) > 0 ? Number(p.margenPct) : 28,
    prefijoSku:
      p.prefijoSku ||
      (tipoIntegracion === 'nodo_ailoo'
        ? 'FRP-AIL'
        : tipoIntegracion === 'cotizacion_whatsapp'
          ? 'FRP-WSP'
          : 'FRP-LOC'),
    tiempoRespuestaPromMin: Number(p.tiempoRespuestaPromMin) > 0 ? Number(p.tiempoRespuestaPromMin) : 5,
  };
}

// GET /api/proveedores
router.get('/', async (req, res, next) => {
  try {
    await asegurarProveedoresWspDemo();
    const snap = await db.collection('proveedores')
      .orderBy('nombre', 'asc')
      .get();
    const proveedores = snap.docs.map(doc => enriquecerProveedorLectura({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: proveedores });
  } catch (error) {
    next(error);
  }
});

// GET /api/proveedores/:id
router.get('/:id', async (req, res, next) => {
  try {
    const snap = await db.collection('proveedores').doc(req.params.id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Proveedor no encontrado' });
    }
    res.json({ success: true, data: enriquecerProveedorLectura({ id: snap.id, ...snap.data() }) });
  } catch (error) {
    next(error);
  }
});

// POST /api/proveedores
router.post('/', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }
    const now = new Date().toISOString();
    const payload = normalizarProveedorPayload(req.body);
    const docRef = await db.collection('proveedores').add({
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
    res.json({ success: true, data: { id: docRef.id, ...payload } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/proveedores/:id
router.put('/:id', async (req, res, next) => {
  try {
    const payload = normalizarProveedorPayload(req.body);
    await db.collection('proveedores').doc(req.params.id).update({
      ...payload,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/proveedores/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('proveedores').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/proveedores/:id/acceso — crea la cuenta de acceso al Panel Proveedor (admin)
router.post('/:id/acceso', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener mínimo 6 caracteres' });
    }

    const docRef = db.collection('proveedores').doc(req.params.id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Proveedor no encontrado' });

    const proveedor = snap.data();
    if (!proveedor.rut) {
      return res.status(400).json({ success: false, error: 'El proveedor necesita un RUT para poder tener acceso' });
    }
    if (proveedor.uid) {
      return res.status(400).json({ success: false, error: 'Este proveedor ya tiene acceso creado' });
    }

    const authEmail = rutToEmail(proveedor.rut);

    let firebaseUser;
    try {
      firebaseUser = await admin.auth(admin.apps[0]).createUser({
        email: authEmail, password,
        displayName: proveedor.nombre, emailVerified: true,
      });
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-exists') {
        // Mismo patrón de auto-reparación que usuarios.js: si el usuario de Auth
        // quedó huérfano (sin proveedor ni trabajador asociado), se limpia y se reintenta.
        const existingAuthUser = await admin.auth(admin.apps[0]).getUserByEmail(authEmail);
        const [docUsuario, docProveedor] = await Promise.all([
          db.collection('usuarios').where('uid', '==', existingAuthUser.uid).limit(1).get(),
          db.collection('proveedores').where('uid', '==', existingAuthUser.uid).limit(1).get(),
        ]);
        if (docUsuario.empty && docProveedor.empty) {
          await admin.auth(admin.apps[0]).deleteUser(existingAuthUser.uid);
          firebaseUser = await admin.auth(admin.apps[0]).createUser({
            email: authEmail, password,
            displayName: proveedor.nombre, emailVerified: true,
          });
        } else {
          return res.status(400).json({ success: false, error: 'Ya existe una cuenta con ese RUT' });
        }
      } else {
        throw authErr;
      }
    }

    try {
      await docRef.update({ uid: firebaseUser.uid, updatedAt: new Date().toISOString() });
    } catch (firestoreErr) {
      try { await admin.auth(admin.apps[0]).deleteUser(firebaseUser.uid); } catch {}
      throw firestoreErr;
    }

    res.json({ success: true, data: { uid: firebaseUser.uid } });
  } catch (err) { next(err); }
});

// PUT /api/proveedores/:id/password — resetea la contraseña del portal (admin)
router.put('/:id/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Mínimo 6 caracteres' });
    }
    const snap = await db.collection('proveedores').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    if (!snap.data().uid) return res.status(400).json({ success: false, error: 'Este proveedor no tiene acceso creado' });
    await admin.auth(admin.apps[0]).updateUser(snap.data().uid, { password });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/proveedores/:id/acceso — revoca el acceso al portal (admin)
router.delete('/:id/acceso', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const docRef = db.collection('proveedores').doc(req.params.id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    const uid = snap.data().uid;
    if (uid) {
      try { await admin.auth(admin.apps[0]).deleteUser(uid); } catch {}
      await docRef.update({ uid: admin.firestore.FieldValue.delete(), updatedAt: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;