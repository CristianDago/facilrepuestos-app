import { db } from '../config/firebase.js';

/**
 * Genera el próximo número de Orden de Trabajo de forma atómica usando
 * un documento contador en Firestore (contadores/ordenes_trabajo).
 *
 * Por qué existe esto:
 * Antes, el número se calculaba como `existing.size + 1` leyendo el total
 * de documentos de la colección. Eso falla en dos escenarios:
 *   1. Dos OTs creadas casi al mismo tiempo (o una OT creada mientras se
 *      aprueba una cotización) leen el mismo `size` antes de que la otra
 *      termine de guardar, y ambas terminan con el mismo número.
 *   2. Si se borra una OT, `size` baja y el próximo número generado puede
 *      coincidir con uno que ya existe.
 *
 * Usar una transacción de Firestore que lee e incrementa el contador en
 * la misma operación elimina ambos problemas: Firestore serializa las
 * transacciones en conflicto y reintenta automáticamente, así que dos
 * llamadas simultáneas nunca pueden obtener el mismo valor.
 */
export async function getNextNumeroOT() {
  const counterRef = db.collection('contadores').doc('ordenes_trabajo');

  const seq = await db.runTransaction(async (t) => {
    const counterSnap = await t.get(counterRef);

    let siguiente;
    if (counterSnap.exists && typeof counterSnap.data().seq === 'number') {
      siguiente = counterSnap.data().seq + 1;
    } else {
      // Primera vez que se usa el contador: se inicializa en base a las
      // OTs que ya existen, para no repetir números ya usados.
      const otSnap = await t.get(db.collection('ordenes_trabajo'));
      siguiente = otSnap.size + 1;
    }

    t.set(counterRef, { seq: siguiente, updatedAt: new Date().toISOString() }, { merge: true });
    return siguiente;
  });

  return `OT-${String(seq).padStart(4, '0')}`;
}