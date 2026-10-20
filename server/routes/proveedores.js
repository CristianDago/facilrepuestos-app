import { Router } from 'express';
import { db } from '../config/firebase.js';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

const rutToEmail = (rut) => {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return `${clean}@drmotors.internal`;
};

// GET /api/proveedores
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('proveedores')
      .orderBy('nombre', 'asc')
      .get();
    const proveedores = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (error) {
    next(error);
  }
});

// POST /api/proveedores
router.post('/', async (req, res, next) => {
  try {
    const { nombre, ...rest } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }
    const now = new Date().toISOString();
    const docRef = await db.collection('proveedores').add({
      nombre, ...rest,
      createdAt: now,
      updatedAt: now,
    });
    res.json({ success: true, data: { id: docRef.id } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/proveedores/:id
router.put('/:id', async (req, res, next) => {
  try {
    await db.collection('proveedores').doc(req.params.id).update({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
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