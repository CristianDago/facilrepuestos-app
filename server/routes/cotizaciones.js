import { Router } from 'express';
import { db } from '../config/firebase.js';
import { getNextNumeroOT } from '../utils/contadores.js';

const router = Router();

// GET /api/cotizaciones
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('cotizaciones')
      .orderBy('createdAt', 'desc')
      .get();
    const cotizaciones = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: cotizaciones });
  } catch (error) { next(error); }
});

// GET /api/cotizaciones/:id
router.get('/:id', async (req, res, next) => {
  try {
    const snap = await db.collection('cotizaciones').doc(req.params.id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Cotización no encontrada' });
    }
    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (error) { next(error); }
});

// POST /api/cotizaciones
router.post('/', async (req, res, next) => {
  try {
    const { patente, nombre, fecha, servicios, ...rest } = req.body;
    if (!patente || !nombre || !servicios?.length) {
      return res.status(400).json({ success: false, error: 'Patente, nombre y servicios son requeridos' });
    }

    const existing = await db.collection('cotizaciones')
      .where('patente', '==', patente)
      .where('fecha', '==', fecha)
      .get();

    const seq      = existing.size + 1;
    const fechaTag = fecha.replace(/\//g, '').slice(0, 6);
    const numero   = `${patente}-${fechaTag}-${seq}`;
    const now      = new Date().toISOString();

    const docRef = await db.collection('cotizaciones').add({
      numero,
      patente,
      nombre,
      telefono:     rest.telefono     || '',
      email:        rest.email        || '',
      marca:        rest.marca        || '',
      modelo:       rest.modelo       || '',
      anio:         rest.anio         || '',
      tipo:         rest.tipo         || '',
      motor:        rest.motor        || '',
      fecha,
      servicios,
      total:        rest.total        || 0,
      totalIva:     rest.totalIva     || Math.round((rest.total || 0) * 0.19),
      totalConIva:  rest.totalConIva  || Math.round((rest.total || 0) * 1.19),
      descuento:    rest.descuento    || 0,      // ← nuevo
      tipoDescuento: rest.tipoDescuento || null, // ← nuevo
      descuentoPct: rest.descuentoPct || 0,      // ← nuevo
      condiciones:  rest.condiciones  || '',
      observaciones: rest.observaciones || '',
      costos:       rest.costos       || [],
      totalCostos:  rest.totalCostos  || 0,
      estado:       rest.estado       || 'Borrador',
      otId:         null,
      createdAt:    now,
      updatedAt:    now,
    });

    res.json({ success: true, data: { id: docRef.id, numero } });
  } catch (error) { next(error); }
});

// PUT /api/cotizaciones/:id
router.put('/:id', async (req, res, next) => {
  try {
    await db.collection('cotizaciones').doc(req.params.id).update({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// PUT /api/cotizaciones/:id/estado
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const validEstados = ['Borrador', 'Enviada', 'Aprobada', 'Rechazada'];
    if (!validEstados.includes(estado)) {
      return res.status(400).json({ success: false, error: 'Estado no válido' });
    }
    await db.collection('cotizaciones').doc(id).update({
      estado,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// PUT /api/cotizaciones/:id/aprobar
router.put('/:id/aprobar', async (req, res, next) => {
  try {
    const { id } = req.params;

    const cotSnap = await db.collection('cotizaciones').doc(id).get();
    if (!cotSnap.exists) {
      return res.status(404).json({ success: false, error: 'Cotización no encontrada' });
    }

    const cot = cotSnap.data();
    if (cot.estado === 'Aprobada') {
      return res.status(400).json({ success: false, error: 'Esta cotización ya fue aprobada' });
    }

    const numero = await getNextNumeroOT();
    const now    = new Date().toISOString();

    // Pasar repuestos de costos a la OT.
    // cot.costos mezcla dos tipos de ítems (sección "Repuestos e Insumos"
    // unificada en la cotización): los vinculados a inventario (inventarioId
    // presente) y los insumos opcionales agregados a mano, sin inventario
    // (inventarioId === ''). Antes se filtraban con `.filter(c => c.inventarioId)`,
    // lo que descartaba silenciosamente los insumos opcionales al convertir
    // la cotización en OT. Ahora se separan y ambos se conservan:
    //  - con inventarioId  → ot.repuestos (RepuestoOT, afecta stock)
    //  - sin inventarioId  → ot.materialesExternos (MaterialExterno, sin stock)
    const costos = cot.costos || [];

    const repuestosOT = costos
      .filter(c => c.inventarioId)
      .map(c => ({
        inventarioId:   c.inventarioId,
        nombre:         c.descripcion,
        cantidad:       c.cantidad,
        precioUnitario: c.precioVenta || 0,
        total:          (c.precioVenta || 0) * c.cantidad,
      }));

    const materialesExternosOT = costos
      .filter(c => !c.inventarioId)
      .map(c => ({
        descripcion: c.descripcion,
        unidad:      'UNIDAD',
        ...(c.costo ? { costo: c.costo } : {}), // Firestore no acepta 'undefined': se omite la clave si no hay costo
        precio:      c.precioVenta || c.costo || 0,
        cantidad:    c.cantidad,
        total:       (c.precioVenta || c.costo || 0) * c.cantidad,
      }));

    // Reservar stock de repuestos (solo los vinculados a inventario)
    if (repuestosOT.length > 0) {
      const batch = db.batch();
      for (const rep of repuestosOT) {
        const invRef  = db.collection('inventario').doc(rep.inventarioId);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          const current = invSnap.data();
          batch.update(invRef, {
            stockReservado: (current.stockReservado || 0) + rep.cantidad,
            updatedAt: now,
          });
        }
      }
      await batch.commit();
    }

    const otRef = await db.collection('ordenes_trabajo').add({
      numero,
      patente:              cot.patente,
      nombre:               cot.nombre,
      telefono:             cot.telefono      || '',
      email:                cot.email         || '',
      marca:                cot.marca         || '',
      modelo:               cot.modelo        || '',
      anio:                 cot.anio          || '',
      tipo:                 cot.tipo          || '',
      motor:                cot.motor         || '',
      km:                   '',
      cotizacionId:         id,
      cotizacionRef:        cot.numero,
      trabajos:             (cot.servicios || []).map(s => ({...s, detalle: s.detalle || ''})),
      repuestos:            repuestosOT,
      materialesExternos:   materialesExternosOT,
      total:                cot.total         || 0,
      totalIva:             cot.totalIva      || Math.round((cot.total || 0) * 0.19),
      totalConIva:          cot.totalConIva   || Math.round((cot.total || 0) * 1.19),
      descuento:            cot.descuento     || 0,      // ← nuevo
      tipoDescuento:        cot.tipoDescuento || null,   // ← nuevo
      descuentoPct:         cot.descuentoPct  || 0,      // ← nuevo
      observaciones:        '',
      notasInternas:        '',
      estado:               'Recibido',
      fechaIngreso:         now.slice(0, 10).split('-').reverse().join('/'),
      fechaEntregaEstimada: '',
      fechaEntregaReal:     null,
      stockDescontado:      false,
      createdAt:            now,
      updatedAt:            now,
    });

    await db.collection('cotizaciones').doc(id).update({
      estado:    'Aprobada',
      otId:      otRef.id,
      updatedAt: now,
    });

    res.json({ success: true, data: { otId: otRef.id, otNumero: numero } });
  } catch (error) { next(error); }
});

// PUT /api/cotizaciones/:id/costos
router.put('/:id/costos', async (req, res, next) => {
  try {
    const { costos, totalCostos } = req.body;
    await db.collection('cotizaciones').doc(req.params.id).update({
      costos:      costos      || [],
      totalCostos: totalCostos || 0,
      updatedAt:   new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// DELETE /api/cotizaciones/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const snap = await db.collection('cotizaciones').doc(req.params.id).get();
    if (snap.exists && snap.data().estado === 'Aprobada') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar una cotización aprobada. Primero cancela la OT asociada.',
      });
    }
    await db.collection('cotizaciones').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) { next(error); }
});

// PUT /api/cotizaciones/:id/registrar-envio
router.put('/:id/registrar-envio', async (req, res, next) => {
  try {
    const { id }    = req.params;
    const { canal } = req.body;

    if (!['WhatsApp', 'Email'].includes(canal)) {
      return res.status(400).json({ success: false, error: 'Canal inválido' });
    }

    const snap = await db.collection('cotizaciones').doc(id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Cotización no encontrada' });
    }

    const cot    = snap.data();
    const envios = cot.envios || [];
    const now    = new Date();
    const fecha  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getFullYear()).slice(2)}`;

    const nuevosEnvios = [...envios, { fecha, canal }];

    const updateData = {
      envios:    nuevosEnvios,
      updatedAt: new Date().toISOString(),
    };
    // Actualizar estado a Enviada si era Borrador
    if (cot.estado === 'Borrador') {
      updateData.estado = 'Enviada';
    }

    await db.collection('cotizaciones').doc(id).update(updateData);
    res.json({ success: true, data: { envios: nuevosEnvios } });
  } catch (error) { next(error); }
});

export default router;