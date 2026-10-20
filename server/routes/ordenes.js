import { Router } from "express";
import { db } from "../config/firebase.js";
import { getNextNumeroOT } from "../utils/contadores.js";

const router = Router();

// Evita errores de precisión de punto flotante al sumar/restar stock decimal
// (ej: 84.8 - 0.9 = 83.90000000000004 en JS)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET /api/ordenes
router.get("/", async (req, res, next) => {
  try {
    const snap = await db
      .collection("ordenes_trabajo")
      .orderBy("createdAt", "desc")
      .get();
    const ordenes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: ordenes });
  } catch (error) {
    next(error);
  }
});

// GET /api/ordenes/cliente/:patente  ← PÚBLICO, sin precios
router.get("/cliente/:patente", async (req, res, next) => {
  try {
    const patente = req.params.patente.toUpperCase();

    // Buscar vehículo
    let vehiculo = null;
    try {
      const vSnap = await db.collection("vehiculos").doc(patente).get();
      if (vSnap.exists) {
        const v = vSnap.data();
        vehiculo = { make: v.make, model: v.model, year: v.year };
      }
    } catch { /* sin vehículo */ }

    // Buscar OTs de esa patente (sin orderBy para evitar índice compuesto)
    const snap = await db.collection("ordenes_trabajo")
      .where("patente", "==", patente)
      .get();

    const docsOrdenados = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const ordenes = docsOrdenados.map(d => ({
      id:               d.id,
      numero:           d.numero,
      estado:           d.estado,
      fechaIngreso:     d.fechaIngreso,
      fechaEntregaReal: d.fechaEntregaReal,
      marca:            d.marca,
      modelo:           d.modelo,
      anio:             d.anio,
      km:               d.km,
      trabajos: (d.trabajos || []).map(t => ({
        descripcion: t.descripcion,
        cantidad:    t.cantidad,
      })),
      repuestos: (d.repuestos || []).map(r => ({
        nombre:   r.nombre,
        cantidad: r.cantidad,
      })),
      observaciones: d.observaciones || '',
    }));

    res.json({ success: true, data: { vehiculo, ordenes } });
  } catch (error) { next(error); }
});

// GET /api/ordenes/taller/panel  ← PÚBLICO, panorama general del taller
// Pensado para una pantalla/TV en el taller: solo patente, marca, estado,
// puesto y tareas asignadas — sin precios ni datos de contacto del cliente.
router.get("/taller/panel", async (req, res, next) => {
  try {
    const snap = await db.collection("ordenes_trabajo")
      .where("estado", "in", ["Recibido", "En Proceso", "Listo"])
      .get();

    const ordenes = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .map(d => ({
        id:           d.id,
        numero:       d.numero,
        patente:      d.patente,
        marca:        d.marca,
        modelo:       d.modelo,
        estado:       d.estado,
        puesto:       d.puesto || null,
        fechaIngreso: d.fechaIngreso,
        createdAt:    d.createdAt,
        tareas: (d.tareas || []).map(t => ({
          descripcion:    t.descripcion,
          estado:         t.estado,
          mecanicoNombre: t.mecanicoNombre,
        })),
        trabajos: (d.trabajos || []).map(t => ({
          descripcion: t.descripcion,
        })),
      }));

    res.json({ success: true, data: ordenes });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ordenes/:id/tareas/:tareaId
router.put("/:id/tareas/:tareaId", async (req, res, next) => {
  try {
    const { id, tareaId } = req.params;
    const { estado, usuarioNombre, usuarioId } = req.body;

    const docRef = db.collection("ordenes_trabajo").doc(id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "OT no encontrada" });

    const now = new Date().toISOString();
    const tareas = (snap.data().tareas || []).map(t => {
      if (t.id !== tareaId) return t;
      const historial = t.historial || [];
      if (t.estado !== estado) {
        historial.push({
          de:            t.estado,
          a:             estado,
          fecha:         now,
          usuarioNombre: usuarioNombre || "Usuario",
          usuarioId:     usuarioId    || "",
        });
      }
      return { ...t, estado, updatedAt: now, historial };
    });

    await docRef.update({ tareas, updatedAt: now });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// POST /api/ordenes/:id/tareas
router.post("/:id/tareas", async (req, res, next) => {
  try {
    const { descripcion, mecanicoId, mecanicoNombre } = req.body;
    if (!descripcion || !mecanicoId) {
      return res.status(400).json({ success: false, error: "Descripción y mecánico son requeridos" });
    }

    const docRef = db.collection("ordenes_trabajo").doc(req.params.id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "OT no encontrada" });

    const now     = new Date().toISOString();
    const tareaId = `tarea_${Date.now()}`;
    const nuevaTarea = { id: tareaId, descripcion, mecanicoId, mecanicoNombre, estado: "pendiente", createdAt: now };
    const tareas  = [...(snap.data().tareas || []), nuevaTarea];

    await docRef.update({ tareas, updatedAt: now });
    res.json({ success: true, data: { id: tareaId } });
  } catch (error) { next(error); }
});

// DELETE /api/ordenes/:id/tareas/:tareaId
router.delete("/:id/tareas/:tareaId", async (req, res, next) => {
  try {
    const { id, tareaId } = req.params;
    const docRef = db.collection("ordenes_trabajo").doc(id);
    const snap   = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "OT no encontrada" });

    const tareas = (snap.data().tareas || []).filter(t => t.id !== tareaId);
    await docRef.update({ tareas, updatedAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// GET /api/ordenes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const snap = await db.collection("ordenes_trabajo").doc(req.params.id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: "Orden de trabajo no encontrada" });
    }
    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ordenes
router.post("/", async (req, res, next) => {
  try {
    const { patente, nombre, trabajos, ...rest } = req.body;
    if (!patente || !nombre || !trabajos?.length) {
      return res.status(400).json({ success: false, error: "Patente, nombre y trabajos son requeridos" });
    }

    const numero = await getNextNumeroOT();
    const now    = new Date().toISOString();

    // Reservar stock de repuestos
    const repuestos = rest.repuestos || [];
    if (repuestos.length > 0) {
      const batch = db.batch();
      for (const rep of repuestos) {
        const invRef  = db.collection("inventario").doc(rep.inventarioId);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          const current = invSnap.data();
          batch.update(invRef, {
            stockReservado: round2((current.stockReservado || 0) + rep.cantidad),
            updatedAt: now,
          });
        }
      }
      await batch.commit();
    }

    const docRef = await db.collection("ordenes_trabajo").add({
      numero,
      patente,
      nombre,
      telefono:             rest.telefono             || "",
      email:                rest.email                || "",
      marca:                rest.marca                || "",
      modelo:               rest.modelo               || "",
      anio:                 rest.anio                 || "",
      tipo:                 rest.tipo                 || "",
      motor:                rest.motor                || "",
      km:                   rest.km                   || "",
      cotizacionId:         rest.cotizacionId         || null,
      cotizacionRef:        rest.cotizacionRef        || "",
      trabajos,
      repuestos,
      materialesExternos:   rest.materialesExternos   || [],
      total:                rest.total                || 0,
      totalIva:             rest.totalIva             || Math.round((rest.total || 0) * 0.19),
      totalConIva:          rest.totalConIva          || Math.round((rest.total || 0) * 1.19),
      descuento:            rest.descuento            || 0,
      tipoDescuento:        rest.tipoDescuento        || null,
      descuentoPct:         rest.descuentoPct         || 0,
      observaciones:        rest.observaciones        || "",
      notasInternas:        rest.notasInternas        || "",
      estado:               rest.estado               || "Recibido",
      fechaIngreso:         rest.fechaIngreso         || "",
      fechaEntregaEstimada: rest.fechaEntregaEstimada || "",
      fechaEntregaReal:     null,
      stockDescontado:      false,
      createdAt:            now,
      updatedAt:            now,
    });

    // Actualizar km del vehículo si el nuevo valor es mayor
    if (rest.km && patente) {
      try {
        const vSnap = await db.collection('vehiculos').doc(patente.toUpperCase()).get();
        if (vSnap.exists) {
          const kmActual = parseInt(vSnap.data().km || '0');
          const kmNuevo  = parseInt(rest.km || '0');
          if (kmNuevo > kmActual) {
            await db.collection('vehiculos').doc(patente.toUpperCase()).update({
              km: String(kmNuevo),
              updatedAt: now,
            });
          }
        }
      } catch { /* no bloquear si falla la actualización de km */ }
    }

    res.json({ success: true, data: { id: docRef.id, numero } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ordenes/:id
router.put("/:id", async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    await db.collection("ordenes_trabajo").doc(req.params.id).update({
      ...req.body,
      updatedAt: now,
    });

    // Actualizar km del vehículo si el nuevo valor es mayor
    const { patente, km } = req.body;
    if (km && patente) {
      try {
        const vSnap = await db.collection('vehiculos').doc(patente.toUpperCase()).get();
        if (vSnap.exists) {
          const kmActual = parseInt(vSnap.data().km || '0');
          const kmNuevo  = parseInt(km || '0');
          if (kmNuevo > kmActual) {
            await db.collection('vehiculos').doc(patente.toUpperCase()).update({
              km: String(kmNuevo),
              updatedAt: now,
            });
          }
        }
      } catch { /* no bloquear si falla */ }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ordenes/:id/estado
router.put("/:id/estado", async (req, res, next) => {
  try {
    const { id } = req.params;
    // ← metodoPago, pagoSinIva y puesto agregados
    const { estado, fechaEntregaReal, usuarioNombre, usuarioId, metodoPago, pagoSinIva, puesto } = req.body;

    const validEstados = ["Recibido", "En Proceso", "Listo", "Entregado"];
    if (!validEstados.includes(estado)) {
      return res.status(400).json({ success: false, error: "Estado no válido" });
    }

    const otSnap = await db.collection("ordenes_trabajo").doc(id).get();
    if (!otSnap.exists) {
      return res.status(404).json({ success: false, error: "OT no encontrada" });
    }

    const ot  = otSnap.data();
    const now = new Date().toISOString();

    const historialEstados = ot.historialEstados || [];
    if (ot.estado !== estado) {
      historialEstados.push({
        de:            ot.estado || "Recibido",
        a:             estado,
        fecha:         now,
        usuarioNombre: usuarioNombre || "Admin",
        usuarioId:     usuarioId    || "",
      });
    }

    const update = { estado, updatedAt: now, historialEstados };

    // Ubicación física en el taller (Elevador, Piso, Sitio) — se puede
    // asignar/actualizar en cualquier cambio de estado, típicamente al
    // pasar a "En Proceso" o "Listo"
    if (puesto !== undefined) update.puesto = puesto || null;

    // Al entregar: descontar stock y guardar método/forma de pago
    if (estado === "Entregado" && !ot.stockDescontado) {
      const repuestos = ot.repuestos || [];
      if (repuestos.length > 0) {
        const batch = db.batch();
        for (const rep of repuestos) {
          const invRef  = db.collection("inventario").doc(rep.inventarioId);
          const invSnap = await invRef.get();
          if (invSnap.exists) {
            const current = invSnap.data();
            batch.update(invRef, {
              stock:         round2(Math.max(0, (current.stock || 0) - rep.cantidad)),
              stockReservado: round2(Math.max(0, (current.stockReservado || 0) - rep.cantidad)),
              updatedAt:     now,
            });
          }
        }
        await batch.commit();
      }
      update.stockDescontado  = true;
      update.fechaEntregaReal = fechaEntregaReal || now.slice(0, 10).split("-").reverse().join("/");
      update.metodoPago       = metodoPago  || null;   // ← nuevo
      update.pagoSinIva       = pagoSinIva  || false;  // ← nuevo
    }

    await db.collection("ordenes_trabajo").doc(id).update(update);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ordenes/:id/repuestos
router.put("/:id/repuestos", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { repuestos: nuevosRepuestos } = req.body;

    const otSnap = await db.collection("ordenes_trabajo").doc(id).get();
    if (!otSnap.exists) {
      return res.status(404).json({ success: false, error: "OT no encontrada" });
    }

    const ot = otSnap.data();
    if (ot.stockDescontado) {
      return res.status(400).json({ success: false, error: "No se pueden modificar repuestos de una OT ya entregada" });
    }

    const now   = new Date().toISOString();
    const batch = db.batch();

    for (const rep of ot.repuestos || []) {
      const invRef  = db.collection("inventario").doc(rep.inventarioId);
      const invSnap = await invRef.get();
      if (invSnap.exists) {
        const current = invSnap.data();
        batch.update(invRef, {
          stockReservado: round2(Math.max(0, (current.stockReservado || 0) - rep.cantidad)),
          updatedAt: now,
        });
      }
    }

    for (const rep of nuevosRepuestos) {
      const invRef  = db.collection("inventario").doc(rep.inventarioId);
      const invSnap = await invRef.get();
      if (invSnap.exists) {
        const current = invSnap.data();
        batch.update(invRef, {
          stockReservado: round2((current.stockReservado || 0) + rep.cantidad),
          updatedAt: now,
        });
      }
    }

    await batch.commit();
    await db.collection("ordenes_trabajo").doc(id).update({
      repuestos: nuevosRepuestos,
      updatedAt: now,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/ordenes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const otSnap = await db.collection("ordenes_trabajo").doc(id).get();
    if (!otSnap.exists) {
      return res.status(404).json({ success: false, error: "OT no encontrada" });
    }

    const ot  = otSnap.data();
    const now = new Date().toISOString();

    if (!ot.stockDescontado && (ot.repuestos || []).length > 0) {
      const batch = db.batch();
      for (const rep of ot.repuestos) {
        const invRef  = db.collection("inventario").doc(rep.inventarioId);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          const current = invSnap.data();
          batch.update(invRef, {
            stockReservado: round2(Math.max(0, (current.stockReservado || 0) - rep.cantidad)),
            updatedAt: now,
          });
        }
      }
      await batch.commit();
    }

    if (ot.cotizacionId) {
      await db.collection("cotizaciones").doc(ot.cotizacionId).update({
        otId:      null,
        estado:    "Enviada",
        updatedAt: now,
      });
    }

    await db.collection("ordenes_trabajo").doc(id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ordenes/:id/registrar-envio
router.put("/:id/registrar-envio", async (req, res, next) => {
  try {
    const { id }    = req.params;
    const { canal } = req.body;

    if (!["WhatsApp", "Email", "Físico"].includes(canal)) {
      return res.status(400).json({ success: false, error: "Canal inválido" });
    }

    const snap = await db.collection("ordenes_trabajo").doc(id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: "OT no encontrada" });
    }

    const ot     = snap.data();
    const envios = ot.envios || [];
    const now    = new Date();
    const fecha  = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;

    const nuevosEnvios = [...envios, { fecha, canal }];

    await db.collection("ordenes_trabajo").doc(id).update({
      envios:    nuevosEnvios,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: { envios: nuevosEnvios } });
  } catch (error) {
    next(error);
  }
});

export default router;