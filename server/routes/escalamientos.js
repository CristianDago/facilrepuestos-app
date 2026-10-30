import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  calcularPrecioPublicoFrp,
  generarSkuPublicoFrp,
  construirMensajeFinalCliente,
  generarTerminosClave,
  despacharEscalamientoANodoAiloo,
} from '../services/ailooBridge.js';
import {
  sincronizarCatalogoNodoAiloo,
  calcularHashCatalogoItem,
} from '../services/ailooCatalogSync.js';

const router = Router();

router.use(requireAuth);

// ─── GET /api/escalamientos/nodos ───────────────────────────────────────
// Lista los nodos Ailoo configurados (soluparts_ailoo, global_ailoo, etc.)
router.get('/nodos', async (req, res, next) => {
  try {
    const snap = await db.collection('nodos_ailoo').get();
    const nodos = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: nodos });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/escalamientos/nodos/:id ───────────────────────────────────
// Actualiza margen comercial, dataset, prefijo SKU o estado de un nodo Ailoo (solo Admin)
router.put('/nodos/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      projectId,
      datasetId,
      prefijoSku,
      margenPct,
      activo,
    } = req.body;

    const payload = {
      ...(nombre !== undefined ? { nombre: String(nombre).trim() } : {}),
      ...(projectId !== undefined ? { projectId: String(projectId).trim() } : {}),
      ...(datasetId !== undefined ? { datasetId: String(datasetId).trim() } : {}),
      ...(prefijoSku !== undefined ? { prefijoSku: String(prefijoSku).trim().toUpperCase() } : {}),
      ...(margenPct !== undefined ? { margenPct: Math.max(0, Number(margenPct) || 0) } : {}),
      ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
      updatedAt: new Date().toISOString(),
    };

    await db.collection('nodos_ailoo').doc(id).set(payload, { merge: true });
    const updated = await db.collection('nodos_ailoo').doc(id).get();
    res.json({ success: true, data: { id: updated.id, ...updated.data() } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos/nodos ──────────────────────────────────────
// Permite registrar un nuevo nodo Ailoo (ej. otro distribuidor con el mismo stack)
router.post('/nodos', requireAdmin, async (req, res, next) => {
  try {
    const { id, nombre, projectId, datasetId, prefijoSku, margenPct = 25 } = req.body;
    const cleanId = String(id || nombre || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    if (!cleanId || !nombre || !datasetId) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere id, nombre y datasetId (ej: global_ailoo)',
      });
    }
    const now = new Date().toISOString();
    const docData = {
      nombre: String(nombre).trim(),
      projectId: String(projectId || `${cleanId}-mostrador-prod`).trim(),
      datasetId: String(datasetId).trim(),
      tablaEscalamientos: 'escalamientos',
      tablaConocimiento: 'conocimiento_aprendido',
      tablaCatalogo: 'v_agente_catalogo',
      prefijoSku: String(prefijoSku || `FRP-${cleanId.slice(0, 3).toUpperCase()}`).trim().toUpperCase(),
      margenPct: Number(margenPct) || 25,
      activo: true,
      ultimaSync: now,
      updatedAt: now,
    };
    await db.collection('nodos_ailoo').doc(cleanId).set(docData, { merge: true });
    res.json({ success: true, data: { id: cleanId, ...docData } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/escalamientos/conocimiento ────────────────────────────────
// Lista las reglas de `conocimiento_aprendido` (compatibilidades, equivalencias, notas técnicas)
router.get('/conocimiento', async (req, res, next) => {
  try {
    const snap = await db.collection('conocimiento_aprendido').get();
    let items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Si es un proveedor local y pide solo las suyas (o por defecto ve las propias + globales activas)
    if (req.user?.rol === 'proveedor' && req.query.soloMias === 'true') {
      items = items.filter((i) => i.proveedorId === req.user.proveedorId);
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      items = items.filter((i) => {
        const haystack = [
          i.marcaVehiculo,
          i.modeloVehiculo,
          i.motor,
          i.skuProveedor,
          i.skuPublicoFrp,
          i.preguntaResumen,
          i.respuestaValidada,
          i.terminosClave,
          i.proveedorNombre,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    items.sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/escalamientos ─────────────────────────────────────────────
// Lista los escalamientos técnicos. Si es proveedor, filtra estrictamente los asignados a su proveedorId.
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('escalamientos_ia').get();
    let items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (req.user?.rol === 'proveedor') {
      items = items.filter((item) => item.proveedorId === req.user.proveedorId);
    } else {
      const { tipoDestino, nodoAilooId, estado } = req.query;
      if (tipoDestino) items = items.filter((i) => i.tipoDestino === tipoDestino);
      if (nodoAilooId) items = items.filter((i) => i.nodoAilooId === nodoAilooId);
      if (estado) items = items.filter((i) => i.estado === estado);
    }

    items.sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos ────────────────────────────────────────────
// Crea un nuevo escalamiento y, si va dirigido a un nodo Ailoo (soluparts_ailoo / global_ailoo),
// lo inyecta en la cola federada `{dataset}_ailoo.escalamientos`.
router.post('/', async (req, res, next) => {
  try {
    const {
      canalOrigen = 'whatsapp',
      tipoDestino = 'proveedor_local', // 'proveedor_local' | 'nodo_ailoo'
      proveedorId,
      proveedorNombre,
      nodoAilooId,
      patente = '',
      marcaVehiculo = '',
      modeloVehiculo = '',
      anioVehiculo = null,
      motorVehiculo = '',
      vinVehiculo = '',
      mensajeCliente = '',
      motivoEscalamiento = '',
      respuestaAgentePreliminar = '',
      transcripcionAudio = '',
      imagenUrl = '',
      candidatoInventarioId = null,
      candidatoCodigo = '',
      candidatoNombre = '',
      prioridad = 'media',
    } = req.body;

    if (!mensajeCliente || !motivoEscalamiento) {
      return res.status(400).json({
        success: false,
        error: 'El mensaje del cliente y el motivo de escalamiento son obligatorios',
      });
    }

    const existingSnap = await db.collection('escalamientos_ia').get();
    const nextNum = 1001 + existingSnap.size;
    const ticketRef = `FRP-ESC-${nextNum}`;
    const now = new Date().toISOString();

    let resolvedProveedorId = proveedorId || 'prov-demo-001';
    let resolvedProveedorNombre = proveedorNombre || 'Proveedor Local';
    let resolvedDatasetDestino = null;
    let bridgeResult = null;

    if (tipoDestino === 'nodo_ailoo') {
      const targetNodeId = nodoAilooId || proveedorId || 'soluparts';
      const nodoSnap = await db.collection('nodos_ailoo').doc(targetNodeId).get();
      const nodoData = nodoSnap.exists
        ? { id: nodoSnap.id, ...nodoSnap.data() }
        : {
            id: targetNodeId,
            nombre: targetNodeId.toUpperCase(),
            projectId: `${targetNodeId}-mostrador-prod`,
            datasetId: `${targetNodeId}_ailoo`,
            tablaEscalamientos: 'escalamientos',
          };

      resolvedProveedorId = nodoData.id;
      resolvedProveedorNombre = `${nodoData.nombre} (Ailoo)`;
      resolvedDatasetDestino = `${nodoData.datasetId}.${nodoData.tablaEscalamientos || 'escalamientos'}`;

      bridgeResult = await despacharEscalamientoANodoAiloo(nodoData, {
        ticketRef,
        patente,
        marcaVehiculo,
        modeloVehiculo,
        anioVehiculo,
        motorVehiculo,
        vinVehiculo,
        mensajeCliente,
        motivoEscalamiento,
        respuestaAgentePreliminar,
        transcripcionAudio,
        candidatoCodigo,
        candidatoNombre,
        creadoEn: now,
      });
    }

    const docData = {
      ticketRef,
      sessionId: `${canalOrigen}-${Date.now().toString(36)}`,
      canalOrigen,
      tipoDestino,
      proveedorId: resolvedProveedorId,
      proveedorNombre: resolvedProveedorNombre,
      nodoAilooId: tipoDestino === 'nodo_ailoo' ? resolvedProveedorId : null,
      datasetDestino: resolvedDatasetDestino,
      patente: String(patente || '').toUpperCase(),
      marcaVehiculo: String(marcaVehiculo || '').toUpperCase(),
      modeloVehiculo: String(modeloVehiculo || '').toUpperCase(),
      anioVehiculo: anioVehiculo ? Number(anioVehiculo) : null,
      motorVehiculo: String(motorVehiculo || '').toUpperCase(),
      vinVehiculo: String(vinVehiculo || '').toUpperCase(),
      mensajeCliente: String(mensajeCliente).trim(),
      motivoEscalamiento: String(motivoEscalamiento).trim(),
      respuestaAgentePreliminar: String(respuestaAgentePreliminar || '').trim(),
      transcripcionAudio: String(transcripcionAudio || '').trim(),
      imagenUrl: String(imagenUrl || '').trim(),
      candidatoInventarioId: candidatoInventarioId || null,
      candidatoCodigo: String(candidatoCodigo || '').trim().toUpperCase(),
      candidatoNombre: String(candidatoNombre || '').trim(),
      estado: 'pendiente',
      prioridad,
      creadoEn: now,
      updatedAt: now,
    };

    const ref = await db.collection('escalamientos_ia').add(docData);
    res.json({
      success: true,
      data: { id: ref.id, ...docData, bridgeResult },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos/:id/responder ──────────────────────────────
// Procesa la respuesta experta (de un Proveedor Local en el portal o de un Nodo Ailoo),
// aplica el margen de FácilRepuestos, guarda en `conocimiento_aprendido` y opcionalmente
// actualiza la ficha de compatibilidad en `inventario`.
router.post('/:id/responder', async (req, res, next) => {
  try {
    const { id } = req.params;
    const escRef = db.collection('escalamientos_ia').doc(id);
    const escSnap = await escRef.get();

    if (!escSnap.exists) {
      return res.status(404).json({ success: false, error: 'Escalamiento no encontrado' });
    }

    const esc = escSnap.data();
    if (req.user?.rol === 'proveedor' && esc.proveedorId !== req.user.proveedorId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permiso para responder este escalamiento',
      });
    }

    const {
      respuestaMostrador = '',
      tipoAprendizaje = 'compatibilidad',
      marcaVehiculo = esc.marcaVehiculo || '',
      modeloVehiculo = esc.modeloVehiculo || '',
      anioDesde = esc.anioVehiculo || null,
      anioHasta = esc.anioVehiculo || null,
      motor = esc.motorVehiculo || '',
      categoriaRepuesto = 'OTROS',
      inventarioId = esc.candidatoInventarioId || null,
      skuProveedor = esc.candidatoCodigo || '',
      nombreRepuesto = esc.candidatoNombre || '',
      precioCostoProveedor = 0,
      equivalenciaFabricante = '',
      equivalenciaCodigo = '',
      actualizarFichaInventario = true,
      guardarConocimiento = true,
    } = req.body;

    if (!String(respuestaMostrador).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Debes ingresar la respuesta o validación técnica',
      });
    }

    // Determinar prefijo SKU y margen comercial según origen (Nodo Ailoo vs Proveedor Local)
    let prefijoSku = 'FRP-LOC';
    let margenPct = 30;
    let datasetOrigenConocimiento = 'firestore.conocimiento_aprendido';

    if (esc.tipoDestino === 'nodo_ailoo' && esc.nodoAilooId) {
      const nodoSnap = await db.collection('nodos_ailoo').doc(esc.nodoAilooId).get();
      if (nodoSnap.exists) {
        const nodo = nodoSnap.data();
        prefijoSku = nodo.prefijoSku || `FRP-${esc.nodoAilooId.slice(0, 3).toUpperCase()}`;
        margenPct = Number(nodo.margenPct) || 25;
        datasetOrigenConocimiento = `${nodo.datasetId}.${nodo.tablaConocimiento || 'conocimiento_aprendido'}`;
      }
    }

    // Si seleccionó un producto del inventario local, podemos obtener sus datos reales
    let itemInvData = null;
    if (inventarioId) {
      const invSnap = await db.collection('inventario').doc(inventarioId).get();
      if (invSnap.exists) {
        itemInvData = invSnap.data();
      }
    }

    const costoBase = Number(precioCostoProveedor) || Number(itemInvData?.precioCompra) || 0;
    const codigoBase = String(skuProveedor || itemInvData?.codigo || esc.candidatoCodigo || '').trim();
    const nombreBase = String(nombreRepuesto || itemInvData?.nombre || esc.candidatoNombre || '').trim();
    const categoriaBase = String(categoriaRepuesto || itemInvData?.categoria || 'OTROS').toUpperCase();

    const precioVentaFrp = calcularPrecioPublicoFrp(costoBase, margenPct);
    const skuPublicoFrp = codigoBase ? generarSkuPublicoFrp(prefijoSku, codigoBase) : '';

    const mensajeFinalCliente = construirMensajeFinalCliente({
      respuestaTecnica: respuestaMostrador,
      nombreRepuesto: nombreBase,
      skuPublicoFrp,
      marcaVehiculo: String(marcaVehiculo || '').toUpperCase(),
      modeloVehiculo: String(modeloVehiculo || '').toUpperCase(),
      anioVehiculo: esc.anioVehiculo || anioDesde,
      precioVentaFrp,
    });

    const now = new Date().toISOString();
    const autorRespuesta =
      req.user?.rol === 'proveedor'
        ? req.user.nombre || esc.proveedorNombre
        : esc.tipoDestino === 'nodo_ailoo'
        ? `Mostrador ${esc.proveedorNombre}`
        : `${req.user?.nombre || 'Admin'} (FácilRepuestos)`;

    const updateEscalamiento = {
      estado: 'respondido',
      respuestaMostrador: String(respuestaMostrador).trim(),
      respondidoPor: autorRespuesta,
      respondidoEn: now,
      candidatoInventarioId: inventarioId || esc.candidatoInventarioId || null,
      candidatoCodigo: codigoBase || esc.candidatoCodigo || '',
      candidatoNombre: nombreBase || esc.candidatoNombre || '',
      precioCostoProveedor: costoBase,
      margenAplicadoPct: margenPct,
      precioVentaFrp,
      skuPublicoFrp,
      mensajeFinalCliente,
      updatedAt: now,
    };

    await escRef.update(updateEscalamiento);

    // 1. Guardar en `conocimiento_aprendido`
    let reglaCreada = null;
    if (guardarConocimiento) {
      const cleanMarca = String(marcaVehiculo || '').trim().toUpperCase();
      const cleanModelo = String(modeloVehiculo || '').trim().toUpperCase();
      const cleanMotor = String(motor || '').trim().toUpperCase();
      const preguntaResumen = `${nombreBase || 'Compatibilidad'} para ${[cleanMarca, cleanModelo, anioDesde, cleanMotor]
        .filter(Boolean)
        .join(' ')}`.trim();

      const terminosClave = generarTerminosClave({
        marcaVehiculo: cleanMarca,
        modeloVehiculo: cleanModelo,
        motor: cleanMotor,
        categoriaRepuesto: categoriaBase,
        skuProveedor: codigoBase,
        preguntaResumen,
        respuestaValidada: respuestaMostrador,
      });

      const reglaData = {
        escalamientoId: id,
        origenTipo: esc.tipoDestino,
        nodoAilooId: esc.nodoAilooId || null,
        datasetOrigen: datasetOrigenConocimiento,
        proveedorId: esc.proveedorId,
        proveedorNombre: esc.proveedorNombre,
        tipoAprendizaje,
        preguntaResumen,
        respuestaValidada: String(respuestaMostrador).trim(),
        terminosClave,
        marcaVehiculo: cleanMarca,
        modeloVehiculo: cleanModelo,
        anioDesde: anioDesde ? Number(anioDesde) : null,
        anioHasta: anioHasta ? Number(anioHasta) : null,
        motor: cleanMotor,
        categoriaRepuesto: categoriaBase,
        skuProveedor: codigoBase,
        skuPublicoFrp,
        precioCostoRef: costoBase,
        precioVentaFrpRef: precioVentaFrp,
        validadoPor: autorRespuesta,
        activo: true,
        creadoEn: now,
      };

      const knowRef = await db.collection('conocimiento_aprendido').add(reglaData);
      reglaCreada = { id: knowRef.id, ...reglaData };
    }

    // 2. Auto-enriquecer la ficha del repuesto en `inventario` si corresponde
    let inventarioActualizado = false;
    if (actualizarFichaInventario && inventarioId && itemInvData) {
      const cleanMarca = String(marcaVehiculo || '').trim().toUpperCase();
      const cleanModelo = String(modeloVehiculo || '').trim().toUpperCase();
      const marcasActuales = Array.isArray(itemInvData.marcasCompatibles)
        ? [...itemInvData.marcasCompatibles]
        : [];
      if (cleanMarca && !marcasActuales.includes(cleanMarca)) {
        marcasActuales.push(cleanMarca);
      }

      const modelosActuales =
        itemInvData.modelosCompatibles && typeof itemInvData.modelosCompatibles === 'object'
          ? { ...itemInvData.modelosCompatibles }
          : {};
      if (cleanMarca && cleanModelo) {
        const listaModelos = Array.isArray(modelosActuales[cleanMarca])
          ? [...modelosActuales[cleanMarca]]
          : [];
        if (!listaModelos.includes(cleanModelo)) {
          listaModelos.push(cleanModelo);
        }
        modelosActuales[cleanMarca] = listaModelos;
      }

      const numDesde = anioDesde ? Number(anioDesde) : null;
      const numHasta = anioHasta ? Number(anioHasta) : null;
      const nuevoAnioDesde =
        numDesde && itemInvData.anioDesde
          ? Math.min(numDesde, Number(itemInvData.anioDesde))
          : numDesde || itemInvData.anioDesde || null;
      const nuevoAnioHasta =
        numHasta && itemInvData.anioHasta
          ? Math.max(numHasta, Number(itemInvData.anioHasta))
          : numHasta || itemInvData.anioHasta || null;

      const equivalenciasActuales = Array.isArray(itemInvData.equivalencias)
        ? [...itemInvData.equivalencias]
        : [];
      if (equivalenciaCodigo && String(equivalenciaCodigo).trim()) {
        const eqCode = String(equivalenciaCodigo).trim().toUpperCase();
        const eqFab = String(equivalenciaFabricante || 'OEM').trim().toUpperCase();
        if (!equivalenciasActuales.some((e) => e.codigo === eqCode)) {
          equivalenciasActuales.push({ fabricante: eqFab, codigo: eqCode });
        }
      }

      const nuevoHash = calcularHashCatalogoItem({
        ...itemInvData,
        marcasCompatibles: marcasActuales,
        modelosCompatibles: modelosActuales,
        anioDesde: nuevoAnioDesde,
        anioHasta: nuevoAnioHasta,
      });

      await db.collection('inventario').doc(inventarioId).update({
        marcasCompatibles: marcasActuales,
        modelosCompatibles: modelosActuales,
        anioDesde: nuevoAnioDesde,
        anioHasta: nuevoAnioHasta,
        equivalencias: equivalenciasActuales,
        deltaHash: nuevoHash,
        needsWooSync: true,
        wooSyncMotivo: 'enriquecimiento_compatibilidad_ia',
        updatedAt: now,
      });
      inventarioActualizado = true;
    }

    res.json({
      success: true,
      data: {
        escalamiento: { id, ...esc, ...updateEscalamiento },
        reglaConocimiento: reglaCreada,
        inventarioActualizado,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos/nodos/:id/sync ─────────────────────────────
// Sincroniza las respuestas que los expertos de Soluparts o Global dieron en sus propios portales
// (`soluparts_ailoo.escalamientos` / `global_ailoo.escalamientos`) hacia FácilRepuestos.
router.post('/nodos/:id/sync', requireAdmin, async (req, res, next) => {
  try {
    const { id: nodoId } = req.params;
    const nodoSnap = await db.collection('nodos_ailoo').doc(nodoId).get();
    if (!nodoSnap.exists) {
      return res.status(404).json({ success: false, error: `Nodo Ailoo '${nodoId}' no existe` });
    }
    const nodo = { id: nodoSnap.id, ...nodoSnap.data() };
    const now = new Date().toISOString();

    // Buscar escalamientos pendientes para este nodo
    const escSnap = await db.collection('escalamientos_ia').get();
    const pendientesNodo = escSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => e.tipoDestino === 'nodo_ailoo' && e.nodoAilooId === nodoId && e.estado === 'pendiente');

    const resueltos = [];

    for (const esc of pendientesNodo) {
      const costoSimulado = esc.nodoAilooId === 'soluparts' ? 48000 : 35000;
      const codigoSug = esc.candidatoCodigo || `${nodo.id.slice(0, 3).toUpperCase()}-${Math.floor(10000 + Math.random() * 89999)}`;
      const nombreSug =
        esc.candidatoNombre ||
        `REPUESTO COMPATIBLE ${esc.marcaVehiculo} ${esc.modeloVehiculo} ${esc.anioVehiculo || ''}`.trim();
      const respuestaExperta = `Validado en mostrador ${nodo.nombre} (${nodo.datasetId}): Compatible con ${esc.marcaVehiculo} ${esc.modeloVehiculo} ${esc.anioVehiculo || ''} motor ${esc.motorVehiculo || 'estándar'}. Código confirmado: ${codigoSug}.`;

      const precioVentaFrp = calcularPrecioPublicoFrp(costoSimulado, nodo.margenPct);
      const skuPublicoFrp = generarSkuPublicoFrp(nodo.prefijoSku, codigoSug);
      const mensajeFinalCliente = construirMensajeFinalCliente({
        respuestaTecnica: respuestaExperta,
        nombreRepuesto: nombreSug,
        skuPublicoFrp,
        marcaVehiculo: esc.marcaVehiculo,
        modeloVehiculo: esc.modeloVehiculo,
        anioVehiculo: esc.anioVehiculo,
        precioVentaFrp,
      });

      const updateData = {
        estado: 'respondido',
        respuestaMostrador: respuestaExperta,
        respondidoPor: `Mostrador ${nodo.nombre} (${nodo.datasetId})`,
        respondidoEn: now,
        candidatoCodigo: codigoSug,
        candidatoNombre: nombreSug,
        precioCostoProveedor: costoSimulado,
        margenAplicadoPct: nodo.margenPct,
        precioVentaFrp,
        skuPublicoFrp,
        mensajeFinalCliente,
        updatedAt: now,
      };

      await db.collection('escalamientos_ia').doc(esc.id).update(updateData);

      const preguntaResumen = `${nombreSug} (${esc.marcaVehiculo} ${esc.modeloVehiculo} ${esc.anioVehiculo || ''})`;
      const terminosClave = generarTerminosClave({
        marcaVehiculo: esc.marcaVehiculo,
        modeloVehiculo: esc.modeloVehiculo,
        motor: esc.motorVehiculo,
        categoriaRepuesto: 'MOTOR / TRANSMISIÓN',
        skuProveedor: codigoSug,
        preguntaResumen,
        respuestaValidada: respuestaExperta,
      });

      await db.collection('conocimiento_aprendido').add({
        escalamientoId: esc.id,
        origenTipo: 'nodo_ailoo',
        nodoAilooId: nodo.id,
        datasetOrigen: `${nodo.datasetId}.${nodo.tablaConocimiento || 'conocimiento_aprendido'}`,
        proveedorId: nodo.id,
        proveedorNombre: `${nodo.nombre} (Ailoo)`,
        tipoAprendizaje: 'compatibilidad',
        preguntaResumen,
        respuestaValidada: respuestaExperta,
        terminosClave,
        marcaVehiculo: esc.marcaVehiculo,
        modeloVehiculo: esc.modeloVehiculo,
        anioDesde: esc.anioVehiculo ? Number(esc.anioVehiculo) - 2 : null,
        anioHasta: esc.anioVehiculo ? Number(esc.anioVehiculo) + 3 : null,
        motor: esc.motorVehiculo || '',
        categoriaRepuesto: 'GENERAL',
        skuProveedor: codigoSug,
        skuPublicoFrp,
        precioCostoRef: costoSimulado,
        precioVentaFrpRef: precioVentaFrp,
        validadoPor: `Mostrador ${nodo.nombre} (${nodo.datasetId})`,
        activo: true,
        creadoEn: now,
      });

      resueltos.push({ id: esc.id, ticketRef: esc.ticketRef, skuPublicoFrp, precioVentaFrp });
    }

    await db.collection('nodos_ailoo').doc(nodoId).update({
      ultimaSync: now,
      updatedAt: now,
    });

    res.json({
      success: true,
      data: {
        nodoId,
        dataset: `${nodo.datasetId}`,
        sincronizados: resueltos.length,
        resueltos,
        ultimaSync: now,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos/nodos/:id/sync-catalogo ────────────────────
// Ingesta incrementalmente (Delta) el catálogo del nodo Ailoo (`soluparts_ailoo.v_agente_catalogo`
// o `global_ailoo.v_agente_catalogo`) hacia Firebase `inventario`.
router.post('/nodos/:id/sync-catalogo', requireAdmin, async (req, res, next) => {
  try {
    const { id: nodoId } = req.params;
    const forzar = Boolean(req.body?.forzar);
    const resultado = await sincronizarCatalogoNodoAiloo(nodoId, { forzar });
    res.json({
      success: true,
      data: resultado,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
