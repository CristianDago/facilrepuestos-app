import admin from 'firebase-admin';

// Rol de solo lectura para la integración de DrPartes. Se asigna ÚNICAMENTE como
// custom claim de Firebase (admin.auth().setCustomUserClaims) y nunca vive en
// Firestore. Es deny-by-default: solo las rutas que usan requireAuthOrLector
// lo aceptan; en cualquier otra ruta que use requireAuth recibe 403.
export const ROL_LECTOR_DRPARTES = 'lector_drpartes';

/**
 * Igual que requireAuth, pero además acepta al rol lector_drpartes.
 * Usar SOLO en rutas GET de lectura que ese rol deba poder consumir.
 * Para el lector se verifica también que el token no esté revocado y que la
 * cuenta no esté deshabilitada (verifyIdToken con checkRevoked = true).
 */
export async function requireAuthOrLector(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }
  const token = header.split('Bearer ')[1];
  if (process.env.NODE_ENV !== 'production' && token.startsWith('dev-token:')) {
    return requireAuth(req, res, next);
  }
  // En desarrollo local sin Firebase Admin configurado (.local-db.json), permitir cualquier token como admin local
  if (process.env.NODE_ENV !== 'production' && !admin.apps.length) {
    req.uid = 'dev-user-admin';
    req.user = {
      uid: 'dev-user-admin',
      email: 'taller@drmotors.cl',
      rol: 'admin',
      nombre: 'Taller Dr. Motors',
      apellido: '(Local)',
      docId: 'dev-admin-doc',
      activo: true,
    };
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.rol === ROL_LECTOR_DRPARTES) {
      if (req.method !== 'GET') {
        return res.status(403).json({ success: false, error: 'Rol de solo lectura' });
      }
      await admin.auth().verifyIdToken(token, true); // lanza si fue revocado/deshabilitado
      req.uid  = decoded.uid;
      req.user = { uid: decoded.uid, email: decoded.email, rol: ROL_LECTOR_DRPARTES, soloLectura: true };
      return next();
    }
  } catch {
    return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
  }
  return requireAuth(req, res, next);
}

/**
 * Middleware que verifica el token Firebase en Authorization: Bearer <token>
 * Agrega req.user = { uid, email, rol } si es válido.
 * Si no hay token, devuelve 401.
 * El rol lector_drpartes queda bloqueado aquí (403) — ver requireAuthOrLector.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }

  const token = header.split('Bearer ')[1];

  // Soporte de acceso rápido en desarrollo local (nunca activo en producción)
  if (process.env.NODE_ENV !== 'production' && token.startsWith('dev-token:')) {
    try {
      const payloadJson = Buffer.from(token.slice('dev-token:'.length), 'base64').toString('utf8');
      const devUser = JSON.parse(payloadJson);
      const rol = devUser.rol || 'admin';
      const isProv = rol === 'proveedor';
      req.uid = devUser.uid || (isProv ? 'dev-user-proveedor' : 'dev-user-admin');
      req.user = {
        uid: req.uid,
        email: devUser.email || (isProv ? 'proveedor@facilrepuestos.cl' : 'taller@drmotors.cl'),
        rol,
        nombre: devUser.nombre || (isProv ? 'Proveedor Demo' : 'Taller Dr. Motors'),
        apellido: devUser.apellido || '(Local)',
        docId: isProv ? 'prov-demo-001' : 'dev-admin-doc',
        activo: true,
      };
      return next();
    } catch {
      return res.status(401).json({ success: false, error: 'Token de desarrollo inválido' });
    }
  }

  // En desarrollo local sin Firebase Admin configurado (.local-db.json), permitir cualquier token como admin local
  if (process.env.NODE_ENV !== 'production' && !admin.apps.length) {
    req.uid = 'dev-user-admin';
    req.user = {
      uid: 'dev-user-admin',
      email: 'taller@drmotors.cl',
      rol: 'admin',
      nombre: 'Taller Dr. Motors',
      apellido: '(Local)',
      docId: 'dev-admin-doc',
      activo: true,
    };
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    // El lector de DrPartes nunca entra por esta puerta: solo puede usar las
    // rutas que lo permiten explícitamente (requireAuthOrLector).
    if (decoded.rol === ROL_LECTOR_DRPARTES) {
      return res.status(403).json({ success: false, error: 'Rol de solo lectura: acceso no permitido' });
    }

    req.uid = decoded.uid;

    const { db } = await import('../config/firebase.js');

    // 1) Trabajadores (admin / mecánico / administrativo)
    const snap = await db.collection('usuarios').where('uid', '==', decoded.uid).limit(1).get();
    if (!snap.empty) {
      const perfil = snap.docs[0].data();
      // Un trabajador desactivado pierde el acceso a la API aunque su sesión siga abierta
      if (perfil.activo === false) {
        return res.status(403).json({ success: false, error: 'Cuenta desactivada' });
      }
      req.user = { uid: decoded.uid, ...perfil, docId: snap.docs[0].id };
      return next();
    }

    // 2) Proveedores (acceso limitado: subir/ver solo sus propios repuestos)
    const snapProv = await db.collection('proveedores').where('uid', '==', decoded.uid).limit(1).get();
    if (!snapProv.empty) {
      req.user = { uid: decoded.uid, ...snapProv.docs[0].data(), rol: 'proveedor', docId: snapProv.docs[0].id };
      return next();
    }

    return res.status(403).json({ success: false, error: 'Usuario sin perfil asignado' });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
  }
}

/**
 * Requiere personal del taller (admin / mecánico / administrativo).
 * Bloquea a los proveedores y al lector de DrPartes. Usar SIEMPRE después de requireAuth.
 */
export function requireStaff(req, res, next) {
  const rol = req.user?.rol;
  if (!req.user || rol === 'proveedor' || rol === ROL_LECTOR_DRPARTES) {
    return res.status(403).json({ success: false, error: 'Acceso solo para personal del taller' });
  }
  next();
}

/**
 * Encadena varios middlewares en uno: chain(requireAuth, requireStaff)
 */
export const chain = (...mws) => (req, res, next) => {
  let i = 0;
  const run = (err) => {
    if (err) return next(err);
    const mw = mws[i++];
    if (!mw) return next();
    try { Promise.resolve(mw(req, res, run)).catch(next); } catch (e) { next(e); }
  };
  run();
};

/**
 * Middleware que requiere rol admin
 */
export function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ success: false, error: 'Acceso solo para administradores' });
  }
  next();
}

/**
 * Middleware opcional (no bloquea si no hay token)
 */
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) { return next(); }

  const token = header.split('Bearer ')[1];
  // En desarrollo local sin Firebase Admin configurado (.local-db.json), permitir cualquier token como admin local
  if (process.env.NODE_ENV !== 'production' && !admin.apps.length) {
    req.uid = 'dev-user-admin';
    req.user = {
      uid: 'dev-user-admin',
      email: 'taller@drmotors.cl',
      rol: 'admin',
      nombre: 'Taller Dr. Motors',
      apellido: '(Local)',
      docId: 'dev-admin-doc',
      activo: true,
    };
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.rol === ROL_LECTOR_DRPARTES) return next(); // sin identidad en rutas opcionales
    req.uid = decoded.uid;
    const { db } = await import('../config/firebase.js');
    const snap = await db.collection('usuarios').where('uid', '==', decoded.uid).limit(1).get();
    if (!snap.empty) req.user = { uid: decoded.uid, ...snap.docs[0].data() };
  } catch { /* ignorar */ }
  next();
}