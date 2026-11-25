import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  calcularPrecioPublicoFrp,
  generarSkuPublicoFrp,
  construirMensajeFinalCliente,
  generarTerminosClave,
  despacharEscalamientoANodoAiloo,
  consultarRespuestasEscalamientosEnBigQuery,
  sanitizarTextoParaProveedor,
} from '../services/ailooBridge.js';
import {
  sincronizarCatalogoNodoAiloo,
  calcularHashCatalogoItem,
} from '../services/ailooCatalogSync.js';
import { enviarRespuestaClienteMetaWhatsapp } from './agenteOmnicanal.js';

const router = Router();

const VENTANA_WSP_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Cuando un escalamiento es respondido (ya sea en `portal.soluparts.cl/escalamiento` o en nuestro Mostrador IA),
 * inyecta la respuesta en la conversación activa de Repuestín WhatsApp y, si han pasado menos de 24 horas
 * desde que el cliente preguntó, envía el push directo por WhatsApp al teléfono del cliente.
 */
async function notificarRespuestaEscalamientoAClienteWsp(esc, updateData) {
  try {
    let telefonoDestino = String(esc.clienteTelefono || '').trim();
    const sesionId = esc.sesionAgenteId || null;
    let timestampUltimaPreguntaCliente = esc.creadoEn || null;

    if (sesionId) {
      const sesRef = db.collection('sesiones_agente_omnicanal').doc(sesionId);
      const sesSnap = await sesRef.get();
      if (sesSnap.exists) {
        const sesData = sesSnap.data() || {};
        if (!telefonoDestino && sesData.clienteTelefono) {
          telefonoDestino = String(sesData.clienteTelefono).trim();
        }
        const mensajes = Array.isArray(sesData.mensajes) ? [...sesData.mensajes] : [];
        const ultimoMsgCliente = [...mensajes].reverse().find((m) => m.rol === 'cliente' && m.creadoEn);
        if (ultimoMsgCliente?.creadoEn) {
          timestampUltimaPreguntaCliente = ultimoMsgCliente.creadoEn;
        }

        mensajes.push({
          id: `msg-esc-${Date.now()}`,
          rol: 'agente',
          autor: 'Repuestín · facilrepuestos.cl',
          texto: updateData.mensajeFinalCliente,
          creadoEn: new Date().toISOString(),
          origen: 'respuesta_escalamiento_mostrador',
        });

        const carrito = Array.isArray(sesData.carritoCotizado) ? [...sesData.carritoCotizado] : [];
        if (updateData.skuPublicoFrp && Number(updateData.precioVentaFrp) > 0) {
          const neto = Math.round(Number(updateData.precioVentaFrp));
          const conIva = Math.round(neto * 1.19);
          if (!carrito.some((c) => c.skuPublicoFrp === updateData.skuPublicoFrp)) {
            carrito.push({
              id: updateData.candidatoInventarioId || esc.id || `esc-${Date.now()}`,
              skuPublicoFrp: updateData.skuPublicoFrp,
              nombre: updateData.candidatoNombre || esc.candidatoNombre || 'REPUESTO VALIDADO',
              fabricante: 'OEM VERIFICADO',
              origen: esc.nodoAilooId === 'soluparts' ? 'soluparts_ailoo' : 'escalamiento_experto',
              proveedorNombre: 'FácilRepuestos SpA',
              stock: 2,
              cantidad: 1,
              precioVentaNeto: neto,
              precioVentaConIva: conIva,
            });
          }
        }

        await sesRef.update({
          mensajes,
          carritoCotizado: carrito,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const msRef = timestampUltimaPreguntaCliente
      ? new Date(timestampUltimaPreguntaCliente).getTime()
      : Date.now();
    const msTranscurridos = Math.max(0, Date.now() - (Number.isFinite(msRef) ? msRef : Date.now()));
    const horasTranscurridas = Number((msTranscurridos / (1000 * 60 * 60)).toFixed(2));
    const dentroVentana24h = msTranscurridos <= VENTANA_WSP_24H_MS;

    if (!dentroVentana24h) {
      if (esc.id) {
        await db
          .collection('escalamientos_ia')
          .doc(esc.id)
          .update({
            pushWspEnviado: false,
            pushWspDentro24h: false,
            pushWspHorasTranscurridas: horasTranscurridas,
            pushWspMotivo: `Consulta supera ventana de 24h (${horasTranscurridas}h); respuesta guardada en sesión.`,
          })
          .catch(() => null);
      }
      return {
        enviado: false,
        dentroVentana24h: false,
        horasTranscurridas,
        motivo: 'ventana_24h_expirada',
      };
    }

    if (telefonoDestino && /\d{8,15}/.test(telefonoDestino.replace(/\D/g, ''))) {
      const resWsp = await enviarRespuestaClienteMetaWhatsapp({
        telefonoDestino,
        texto: `${updateData.mensajeFinalCliente}\n\n👉 Si deseas confirmarlo, escribe *COMPRAR* por este mismo WhatsApp.`,
      });
      if (esc.id) {
        await db
          .collection('escalamientos_ia')
          .doc(esc.id)
          .update({
            pushWspEnviado: Boolean(resWsp?.enviado),
            pushWspDentro24h: true,
            pushWspHorasTranscurridas: horasTranscurridas,
            pushWspEnviadoEn: new Date().toISOString(),
            pushWspModo: resWsp?.modo || 'meta_cloud_api',
          })
          .catch(() => null);
      }
      return {
        ...resWsp,
        dentroVentana24h: true,
        horasTranscurridas,
      };
    }
  } catch (err) {
    console.warn('[Escalamientos->WSP] Aviso al notificar al cliente por WhatsApp:', err.message);
  }
  return null;
}

router.use(requireAuth);

// ─── GET /api/escalamientos/nodos ───────────────────────────────────────
// Lista los nodos Ailoo configurados (soluparts)
router.get('/nodos', async (req, res, next) => {
  try {
    await db.collection('nodos_ailoo').doc('global').delete().catch(() => null);
    const snap = await db.collection('nodos_ailoo').get();
    const nodos = snap.docs
      .filter((doc) => doc.id !== 'global')
      .map((doc) => ({ id: doc.id, ...doc.data() }));
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

let ultimoAutoSyncBqAt = 0;

/**
 * Sincroniza automáticamente respuestas desde `soluparts-mostrador-prod.soluparts.escalamientos`
 * para tickets pendientes y envía el push directo por WhatsApp al cliente si han pasado < 24h.
 */
async function sincronizarRespuestasPendientesAiloo(snapExistente = null) {
  const nowMs = Date.now();
  if (nowMs - ultimoAutoSyncBqAt < 20000) return false;
  ultimoAutoSyncBqAt = nowMs;

  try {
    const snap = snapExistente || (await db.collection('escalamientos_ia').get());
    const pendientesAiloo = snap.docs.filter((d) => {
      const data = d.data();
      return (
        (data.estado === 'pendiente' || data.estado === 'pendiente_mostrador') &&
        data.ticketRef &&
        (data.tipoDestino === 'nodo_ailoo' || data.nodoAilooId === 'soluparts')
      );
    });
    if (pendientesAiloo.length === 0) return false;

    const ticketRefs = pendientesAiloo.map((d) => d.data().ticketRef).filter(Boolean);
    const bqConsulta = await consultarRespuestasEscalamientosEnBigQuery(
      {
        id: 'soluparts',
        projectId: 'soluparts-mostrador-prod',
        datasetId: 'soluparts',
        tablaEscalamientos: 'escalamientos',
      },
      ticketRefs
    );
    if (!bqConsulta?.respuestasPorTicket || bqConsulta.respuestasPorTicket.size === 0) {
      return false;
    }

    let huboCambios = false;
    for (const docSnap of pendientesAiloo) {
      const esc = docSnap.data();
      const rawRef = String(esc.ticketRef || '').toUpperCase();
      const neutralRef = rawRef.replace(/^FRP-/i, '');
      const matchBq =
        bqConsulta.respuestasPorTicket.get(rawRef) ||
        bqConsulta.respuestasPorTicket.get(neutralRef);
      if (!matchBq || !matchBq.respuestaMostrador) continue;

      const costoBruto = Number(esc.precioCostoProveedor || esc.costoBrutoProveedor) || 0;
      const margen = esc.nodoAilooId === 'soluparts' ? 0 : Number(esc.margenPorcentajeAplicado || 30);
      const precioVentaFrp = costoBruto > 0 ? calcularPrecioPublicoFrp(costoBruto, margen) : 0;
      const skuPublicoFrp =
        esc.skuPublicoFrp ||
        (esc.candidatoCodigo ? generarSkuPublicoFrp('FRP-SOL', esc.candidatoCodigo) : '');
      const mensajeFinalCliente = construirMensajeFinalCliente({
        ...esc,
        respuestaMostrador: matchBq.respuestaMostrador,
        skuPublicoFrp,
        precioVentaFrp,
      });
      const nowIso = new Date().toISOString();
      const updateData = {
        estado: 'respondido',
        calceConfirmado: true,
        respuestaMostrador: matchBq.respuestaMostrador,
        respuestaExperto: matchBq.respuestaMostrador,
        respondidoPor: matchBq.respondidoPor || 'Mostrador Especialista',
        respondidoEn: matchBq.respondidoEn || nowIso,
        precioCostoProveedor: costoBruto,
        margenAplicadoPct: margen,
        precioVentaFrp,
        skuPublicoFrp,
        mensajeFinalCliente,
        updatedAt: nowIso,
      };
      await db.collection('escalamientos_ia').doc(docSnap.id).update(updateData);
      await notificarRespuestaEscalamientoAClienteWsp({ id: docSnap.id, ...esc }, updateData);
      huboCambios = true;
    }
    return huboCambios;
  } catch (autoErr) {
    console.warn('[Escalamientos AutoSync BQ] Aviso:', autoErr.message);
    return false;
  }
}

// Poller en background cada 45s para enviar el push directo al WhatsApp del cliente (< 24h)
// apenas respondan en `portal.soluparts.cl/escalamiento`, incluso si nadie tiene abierto nuestro portal.
const bgTimer = setInterval(() => {
  sincronizarRespuestasPendientesAiloo().catch(() => null);
}, 45000);
if (typeof bgTimer.unref === 'function') bgTimer.unref();

// ─── GET /api/escalamientos ─────────────────────────────────────────────
// Lista los escalamientos técnicos. Si es proveedor, filtra estrictamente los asignados a su proveedorId.
// REGLA ANTI-BYPASS ETAPA 1: Jamás se incluye el nombre ni el teléfono del cliente final hacia los proveedores;
// el solicitante es siempre FácilRepuestos SpA y el texto se sanitiza contra teléfonos/emails/nombres propios.
router.get('/', async (req, res, next) => {
  try {
    let snap = await db.collection('escalamientos_ia').get();
    const huboCambios = await sincronizarRespuestasPendientesAiloo(snap);
    if (huboCambios) {
      snap = await db.collection('escalamientos_ia').get();
    }

    let items = snap.docs.map((doc) => {
      const raw = doc.data();
      // Eliminar cualquier campo de identidad del cliente final y sanitizar texto técnico
      const { clienteNombre, clienteTelefono, telefonoCliente, nombreCliente, telefono, ...safeData } = raw;
      const imgFinal = String(raw.imagenUrl || raw.fotoMuestraUrl || '').trim();
      const msgLimpio = sanitizarTextoParaProveedor(raw.mensajeCliente || '');
      const motivoLimpio = sanitizarTextoParaProveedor(raw.motivoEscalamiento || '');
      const audioLimpio = sanitizarTextoParaProveedor(raw.transcripcionAudio || '');
      const pistaLimpia = sanitizarTextoParaProveedor(raw.pistaGemini || raw.transcripcionAudio || raw.motivoEscalamiento || '');

      const horaFallback = (() => {
        try {
          return new Date(raw.creadoEn || Date.now()).toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return '';
        }
      })();

      const historialConversacion = Array.isArray(raw.historialConversacion) && raw.historialConversacion.length > 0
        ? raw.historialConversacion.map((m) => ({
            hora: m.hora || horaFallback,
            rol: m.rol === 'cliente' ? 'cliente' : 'agente',
            autor: m.rol === 'cliente' ? 'Cliente' : 'Asistente',
            texto: sanitizarTextoParaProveedor(m.texto || ''),
            envioFoto: Boolean(m.envioFoto),
          }))
        : [
            {
              hora: horaFallback,
              rol: 'cliente',
              autor: 'Cliente',
              texto: msgLimpio,
              envioFoto: Boolean(imgFinal),
            },
            ...(raw.respuestaAgentePreliminar
              ? [
                  {
                    hora: horaFallback,
                    rol: 'agente',
                    autor: 'Asistente',
                    texto: sanitizarTextoParaProveedor(raw.respuestaAgentePreliminar),
                    envioFoto: false,
                  },
                ]
              : [
                  {
                    hora: horaFallback,
                    rol: 'agente',
                    autor: 'Asistente',
                    texto: imgFinal
                      ? '¡Recibí tu foto! 📸 Se la paso a nuestro equipo técnico para identificar el repuesto y confirmar compatibilidad a la brevedad.'
                      : 'Se la paso a nuestro equipo técnico para confirmar compatibilidad exacta con tu vehículo.',
                    envioFoto: false,
                  },
                ]),
          ];

      return {
        id: doc.id,
        ...safeData,
        ticketRef: String(raw.ticketRef || doc.id).replace(/^FRP-/i, ''),
        solicitante: 'Consulta Técnica Mostrador',
        imagenUrl: imgFinal,
        fotoMuestraUrl: imgFinal,
        pistaGemini: pistaLimpia,
        historialConversacion,
        mensajeCliente: msgLimpio,
        motivoEscalamiento: motivoLimpio,
        transcripcionAudio: audioLimpio,
      };
    });

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
      fotoMuestraUrl = '',
      pistaGemini = '',
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
    const ticketRef = `ESC-${nextNum}`;
    const now = new Date().toISOString();

    let resolvedProveedorId = proveedorId || 'prov-demo-001';
    let resolvedProveedorNombre = proveedorNombre || 'Proveedor Local';
    let resolvedDatasetDestino = null;
    let bridgeResult = null;

    const mensajeTecnicoSanitizado = sanitizarTextoParaProveedor(mensajeCliente);
    const motivoSanitizado = sanitizarTextoParaProveedor(motivoEscalamiento);
    const audioSanitizado = sanitizarTextoParaProveedor(transcripcionAudio);

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
        mensajeCliente: mensajeTecnicoSanitizado,
        motivoEscalamiento: motivoSanitizado,
        respuestaAgentePreliminar,
        transcripcionAudio: audioSanitizado,
        candidatoCodigo,
        candidatoNombre,
        creadoEn: now,
      });
    }

    const docData = {
      ticketRef,
      sessionId: `${canalOrigen}-${Date.now().toString(36)}`,
      solicitante: 'Consulta Técnica Mostrador',
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
      mensajeCliente: mensajeTecnicoSanitizado,
      motivoEscalamiento: motivoSanitizado,
      respuestaAgentePreliminar: String(respuestaAgentePreliminar || '').trim(),
      transcripcionAudio: audioSanitizado,
      imagenUrl: String(imagenUrl || fotoMuestraUrl || '').trim(),
      fotoMuestraUrl: String(imagenUrl || fotoMuestraUrl || '').trim(),
      pistaGemini: sanitizarTextoParaProveedor(pistaGemini || transcripcionAudio || motivoSanitizado),
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
        margenPct = esc.nodoAilooId === 'soluparts' ? 0 : (nodo.margenPct !== undefined ? Number(nodo.margenPct) : 0);
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

    // 3. Notificar automáticamente al cliente por WhatsApp y actualizar su sesión en Repuestín
    const envioWhatsapp = await notificarRespuestaEscalamientoAClienteWsp(
      { id, ...esc },
      updateEscalamiento
    );

    res.json({
      success: true,
      data: {
        escalamiento: { id, ...esc, ...updateEscalamiento },
        reglaConocimiento: reglaCreada,
        inventarioActualizado,
        envioWhatsapp,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/escalamientos/nodos/:id/sync ─────────────────────────────
// Sincroniza las respuestas reales que los expertos de Soluparts dieron en `portal.soluparts.cl/escalamiento`
// (tabla BigQuery `soluparts-mostrador-prod.soluparts.escalamientos`) hacia nuestro portal y responde por WSP al cliente.
router.post('/nodos/:id/sync', requireAdmin, async (req, res, next) => {
  try {
    const { id: nodoId } = req.params;
    const nodoSnap = await db.collection('nodos_ailoo').doc(nodoId).get();
    const nodo = nodoSnap.exists
      ? { id: nodoSnap.id, ...nodoSnap.data() }
      : {
          id: nodoId,
          nombre: nodoId === 'soluparts' ? 'Soluparts' : nodoId.toUpperCase(),
          projectId: `${nodoId}-mostrador-prod`,
          datasetId: nodoId === 'soluparts' ? 'soluparts' : `${nodoId}_ailoo`,
          tablaEscalamientos: 'escalamientos',
          prefijoSku: nodoId === 'soluparts' ? 'FRP-SOL' : 'FRP-GLB',
          margenPct: nodoId === 'soluparts' ? 0 : 28,
        };
    const now = new Date().toISOString();

    // Buscar escalamientos pendientes para este nodo
    const escSnap = await db.collection('escalamientos_ia').get();
    const pendientesNodo = escSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => e.tipoDestino === 'nodo_ailoo' && e.nodoAilooId === nodoId && e.estado === 'pendiente');

    const ticketRefs = pendientesNodo
      .flatMap((e) => [e.ticketRef, e.id])
      .filter(Boolean);

    // Consultar en BigQuery (`soluparts-mostrador-prod.soluparts.escalamientos`) cuáles ya fueron respondidos en portal.soluparts.cl/escalamiento
    const filasRespondidasBq = await consultarRespuestasEscalamientosEnBigQuery(nodo, ticketRefs);
    const porIdBq = new Map();
    for (const row of filasRespondidasBq) {
      if (row.id) porIdBq.set(String(row.id), row);
      if (row.session_id) porIdBq.set(String(row.session_id).replace(/^frp-/, ''), row);
    }

    const resueltos = [];

    for (const esc of pendientesNodo) {
      const filaBq = porIdBq.get(String(esc.ticketRef || '')) || porIdBq.get(String(esc.id || ''));
      if (!filaBq || !filaBq.respuesta_mostrador) {
        continue;
      }

      const costoBase = Number(esc.precioCostoProveedor) || 0;
      const codigoSug = esc.candidatoCodigo || '';
      const nombreSug =
        esc.candidatoNombre ||
        `REPUESTO COMPATIBLE ${esc.marcaVehiculo} ${esc.modeloVehiculo} ${esc.anioVehiculo || ''}`.trim();
      const respuestaExperta = String(filaBq.respuesta_mostrador).trim();
      const margenEfectivo = nodo.id === 'soluparts' ? 0 : Number(nodo.margenPct || 0);

      const precioVentaFrp = calcularPrecioPublicoFrp(costoBase, margenEfectivo);
      const skuPublicoFrp = codigoSug ? generarSkuPublicoFrp(nodo.prefijoSku || 'FRP-SOL', codigoSug) : '';
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
        respuestaExperto: respuestaExperta,
        respondidoPor: filaBq.respondido_por || `Mostrador ${nodo.nombre}`,
        respondidoEn: filaBq.respondido_en || now,
        candidatoCodigo: codigoSug,
        candidatoNombre: nombreSug,
        precioCostoProveedor: costoBase,
        margenAplicadoPct: margenEfectivo,
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
        precioCostoRef: costoBase,
        precioVentaFrpRef: precioVentaFrp,
        validadoPor: filaBq.respondido_por || `Mostrador ${nodo.nombre}`,
        activo: true,
        creadoEn: now,
      });

      // Enviar la respuesta directamente al WhatsApp del cliente y a su sesión activa en Repuestín
      await notificarRespuestaEscalamientoAClienteWsp(esc, updateData);

      resueltos.push({ id: esc.id, ticketRef: esc.ticketRef, skuPublicoFrp, precioVentaFrp });
    }

    if (nodoSnap.exists) {
      await db.collection('nodos_ailoo').doc(nodoId).update({
        ultimaSync: now,
        updatedAt: now,
      });
    }

    res.json({
      success: true,
      data: {
        nodoId,
        dataset: `${nodo.projectId}.${nodo.datasetId}.escalamientos`,
        pendientesConsultados: pendientesNodo.length,
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
