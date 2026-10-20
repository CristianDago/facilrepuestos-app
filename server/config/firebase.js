import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db;

try {
  // ── Producción (Cloud Run): credenciales vienen como variable de entorno ──
  // ── Local: se leen desde server/serviceAccount.json ────────────────────────
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(join(__dirname, '../serviceAccount.json'), 'utf8'));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  db = admin.firestore();
  console.log('✓ Firebase conectado');
} catch (error) {
  console.error('✕ Error conectando Firebase:', error.message);
  console.log('  Asegúrate de tener serviceAccount.json en la carpeta server/, o FIREBASE_SERVICE_ACCOUNT configurado.');
}

export { db };