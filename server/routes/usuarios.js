import { Router }  from 'express';
import { db }       from '../config/firebase.js';
import admin        from 'firebase-admin';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

const rutToEmail = (rut) => {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return `${clean}@drmotors.internal`;
};

// GET /api/usuarios — lista todos (admin)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection('usuarios').get();
    const data = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/usuarios/me — perfil propio
router.get('/me', requireAuth, async (req, res) => {
  const { uid, docId, ...rest } = req.user;
  res.json({ success: true, data: rest });
});

// GET /api/usuarios/by-uid/:uid — buscar propio perfil por uid
router.get('/by-uid/:uid', requireAuth, async (req, res, next) => {
  try {
    if (req.user?.uid !== req.params.uid && req.user?.rol !== 'admin') {
      return res.status(403).json({ success: false, error: 'Sin permiso' });
    }
    const snap = await db.collection('usuarios')
      .where('uid', '==', req.params.uid)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true, data: { id: snap.docs[0].id, ...snap.docs[0].data() } });
  } catch (err) { next(err); }
});



// GET /api/usuarios/mecanicos — solo mecánicos activos para OT
router.get('/mecanicos', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('usuarios')
      .where('activo', '==', true)
      .where('rol', '==', 'mecanico')
      .get();
    const data = snap.docs
      .map(doc => {
        const d = doc.data();
        return {
          id:           doc.id,
          uid:          d.uid,
          nombre:       `${d.nombre} ${d.apellido || ''}`.trim(),
          apellido:     d.apellido || '',
          telefono:     d.telefono || '',
          especialidad: d.especialidad || d.cargo || '',
          activo:       d.activo,
          rol:          d.rol,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/usuarios/mecanicos/publico — PÚBLICO, solo nombres (panel del taller)
// A diferencia de /mecanicos, no expone teléfono ni requiere sesión — pensado
// para mostrarse en una pantalla del taller sin login.
router.get('/mecanicos/publico', async (req, res, next) => {
  try {
    const snap = await db.collection('usuarios')
      .where('activo', '==', true)
      .where('rol', '==', 'mecanico')
      .get();
    const data = snap.docs
      .map(doc => {
        const d = doc.data();
        return { nombre: `${d.nombre} ${d.apellido || ''}`.trim() };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/usuarios/:id — perfil por id (admin o propio)
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection('usuarios').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (err) { next(err); }
});

// POST /api/usuarios — crear trabajador
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nombre, apellido, rut, telefono, email, especialidad, cargo, rol, activo, password } = req.body;
    if (!nombre || !apellido || !rut || !password)
      return res.status(400).json({ success: false, error: 'Nombre, apellido, RUT y contraseña son requeridos' });

    const existing = await db.collection('usuarios').where('rut', '==', rut).limit(1).get();
    if (!existing.empty)
      return res.status(400).json({ success: false, error: 'Ya existe un trabajador con ese RUT' });

    const authEmail = rol === 'admin' && email ? email : rutToEmail(rut);

    let firebaseUser;
    try {
      firebaseUser = await admin.auth(admin.apps[0]).createUser({
        email: authEmail, password,
        displayName: `${nombre} ${apellido}`, emailVerified: true,
      });
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-exists') {
        // Puede ser un usuario "huérfano": quedó creado en Auth en un intento
        // anterior que falló antes de guardar el documento en Firestore.
        // Si no tiene doc asociado, lo eliminamos y reintentamos la creación.
        const existingAuthUser = await admin.auth(admin.apps[0]).getUserByEmail(authEmail);
        const docConUid = await db.collection('usuarios').where('uid', '==', existingAuthUser.uid).limit(1).get();

        if (docConUid.empty) {
          await admin.auth(admin.apps[0]).deleteUser(existingAuthUser.uid);
          firebaseUser = await admin.auth(admin.apps[0]).createUser({
            email: authEmail, password,
            displayName: `${nombre} ${apellido}`, emailVerified: true,
          });
        } else {
          return res.status(400).json({ success: false, error: 'Ya existe una cuenta con ese RUT/email' });
        }
      } else {
        throw authErr;
      }
    }

    const now = new Date().toISOString();
    const data = {
      uid: firebaseUser.uid, nombre, apellido, rut,
      telefono: telefono || '', email: email || '',
      especialidad: especialidad || '', cargo: cargo || '',
      rol: rol || 'mecanico', activo: activo ?? true,
      fotoUrl: '', createdAt: now, updatedAt: now,
    };

    let docRef;
    try {
      docRef = await db.collection('usuarios').add(data);
    } catch (firestoreErr) {
      // Rollback: si falla el guardado en Firestore, eliminamos el usuario de Auth
      // recién creado para no dejarlo huérfano (bloqueando el RUT/email a futuro).
      try { await admin.auth(admin.apps[0]).deleteUser(firebaseUser.uid); } catch {}
      throw firestoreErr;
    }

    res.json({ success: true, data: { id: docRef.id, uid: firebaseUser.uid } });
  } catch (err) { next(err); }
});

// PUT /api/usuarios/:id — actualizar perfil
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const docRef = db.collection('usuarios').doc(req.params.id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });

    // Solo admin puede cambiar rol; el propio usuario puede actualizar sus datos básicos
    const { password, uid, createdAt, ...allowed } = req.body;
    if (req.user?.rol !== 'admin') {
      delete allowed.rol;
      delete allowed.activo;
    }

    await docRef.update({ ...allowed, updatedAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/usuarios/:id/password
router.put('/:id/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, error: 'Mínimo 6 caracteres' });
    const snap = await db.collection('usuarios').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    await admin.auth(admin.apps[0]).updateUser(snap.data().uid, { password });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/usuarios/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection('usuarios').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'No encontrado' });
    try { await admin.auth(admin.apps[0]).deleteUser(snap.data().uid); } catch {}
    await db.collection('usuarios').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/usuarios/setup-admin
router.post('/setup-admin', async (req, res, next) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    const existing = await db.collection('usuarios').limit(1).get();
    if (!existing.empty)
      return res.status(403).json({ success: false, error: 'Ya existen usuarios en el sistema' });

    const firebaseUser = await admin.auth(admin.apps[0]).createUser({
      email, password, displayName: `${nombre} ${apellido}`, emailVerified: true,
    });
    const now = new Date().toISOString();
    await db.collection('usuarios').add({
      uid: firebaseUser.uid, nombre, apellido,
      rut: '', telefono: '', email,
      especialidad: '', cargo: 'Administrador',
      rol: 'admin', activo: true, fotoUrl: '',
      createdAt: now, updatedAt: now,
    });
    res.json({ success: true, message: 'Administrador creado exitosamente' });
  } catch (err) { next(err); }
});

export default router;