// Completa/corrige el campo proveedorId de los ítems de inventario, vinculándolo
// al id real del proveedor a partir del nombre guardado en "proveedor".
//
// Uso (desde server/):
//   node scripts/completar-proveedor-id.js            → simulación (no escribe nada)
//   node scripts/completar-proveedor-id.js --aplicar  → aplica los cambios
import '../config/firebase.js';
import admin from 'firebase-admin';

const APLICAR = process.argv.includes('--aplicar');
const db = admin.firestore(admin.apps[0]);

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

const provSnap = await db.collection('proveedores').get();
const porId = new Map(), porNombre = new Map();
for (const d of provSnap.docs) {
  porId.set(d.id, d.data().nombre);
  if (d.data().nombre) porNombre.set(norm(d.data().nombre), d.id);
}

const invSnap = await db.collection('inventario').get();
let ok = 0, completar = 0, corregir = 0, sinProveedor = 0;
const sinMatch = [];
let batch = db.batch(), enLote = 0;

for (const doc of invSnap.docs) {
  const it = doc.data();
  if (!it.proveedor && !it.proveedorId) { sinProveedor++; continue; } // ítem propio del taller

  const porNom = it.proveedor ? porNombre.get(norm(it.proveedor)) : undefined;
  const idValido = it.proveedorId && porId.has(it.proveedorId);

  let nuevoId = null;
  if (idValido) { ok++; continue; }
  if (porNom)   nuevoId = porNom;

  if (!nuevoId) { sinMatch.push({ id: doc.id, nombre: it.nombre, proveedor: it.proveedor || '', proveedorId: it.proveedorId || '' }); continue; }

  if (it.proveedorId) corregir++; else completar++;
  if (APLICAR) {
    batch.update(doc.ref, { proveedorId: nuevoId, updatedAt: new Date().toISOString() });
    if (++enLote >= 400) { await batch.commit(); batch = db.batch(); enLote = 0; }
  }
}
if (APLICAR && enLote) await batch.commit();

console.log(APLICAR ? '== APLICADO ==' : '== SIMULACIÓN (usa --aplicar para escribir) ==');
console.log({ yaCorrectos: ok, completados: completar, corregidos: corregir, itemsPropiosDelTaller: sinProveedor, sinCoincidencia: sinMatch.length });
if (sinMatch.length) {
  console.log('Ítems con proveedor que no coincide con ningún proveedor registrado (revisar a mano):');
  console.table(sinMatch);
}
process.exit(0);