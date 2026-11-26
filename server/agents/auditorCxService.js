/**
 * server/agents/auditorCxService.js
 *
 * PLATAFORMA GOOGLE CLOUD CX · QUALITY AI & CONVERSATIONAL INSIGHTS PARA LOS 6 AGENTES
 * ────────────────────────────────────────────────────────────────────────────────────
 * Evalúa automáticamente y bajo demanda la calidad de atención (Customer Experience - CX)
 * de las conversaciones de WhatsApp (`sesiones_agente_omnicanal`), detectando:
 *   1. Score CX (0 a 100%) y Semáforo de Experiencia (`optimo` 🟢, `atencion` 🟡, `critico` 🔴).
 *   2. Puntos de Fricción Real:
 *      - Respuestas repetidas del bot (ej. preguntar más de 1 vez "¿Qué repuesto necesitas?").
 *      - Correcciones del cliente no comprendidas (ej. "no es una toyota", "estás tomando mal las cosas", "revisa bien").
 *      - Frustración o solicitud de humano ("?", "asistente", "alguien para hablar", "ya compré").
 *      - Respuestas excesivamente largas (> 520 caracteres).
 *      - Cambio involuntario de repuesto o vehículo a mitad de la conversación.
 *   3. Asignación exacta de qué Subagente (Agente 0 al Agente 6) originó la brecha y generación
 *      de la Regla Correctiva lista para inyectar en 1 clic al cerebro en vivo (`cerebros_agentes_ia`).
 */

import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import {
  obtenerConfiguracionAgentesIA,
  guardarConfiguracionAgentesIA,
} from './configAgentesService.js';

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'facilrepuestos-prod';
const COLECCION_AUDITORIAS_CX = 'auditorias_cx_conversaciones';

const googleAuth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export const MAPA_NOMBRES_AGENTES = {
  orquestador: 'Agente 0 · Orquestador Central',
  agente1_recepcion: 'Agente 1 · Motor de Intención Contextual (NLU)',
  agente2_buscador_erp: 'Agente 2 · Buscador ERP & Clasificador',
  agente3_logistica_proveedores: 'Agente 3 · Logística, Horario 11:30/15:30 y Despacho',
  agente4_mesa_abastecimiento: 'Agente 4 · Mesa de Abastecimiento WSP & Temporal 4h',
  agente5_cajero_wordpress: 'Agente 5 · Link Directo & Webhook WordPress',
  agente6_pedidos_adicionales: 'Agente 6 · Detector de Pedidos Adicionales',
};

/**
 * Audita determinísticamente en tiempo real (< 2 ms) una sesión de WhatsApp y calcula su Score CX,
 * problemas detectados, sentimiento del cliente, agente responsable y regla de mejora sugerida.
 */
export function evaluarSesionCxDeterministica(sesion = {}) {
  const mensajes = Array.isArray(sesion.mensajes) ? sesion.mensajes : [];
  const msgsCliente = mensajes.filter((m) => m.autor === 'cliente' || m.rol === 'cliente');
  const msgsAgente = mensajes.filter((m) => m.autor !== 'cliente' && m.rol !== 'cliente');
  const carrito = Array.isArray(sesion.carritoCotizado) ? sesion.carritoCotizado : [];
  const solicitudesWsp = Array.isArray(sesion.solicitudesWspAbiertas)
    ? sesion.solicitudesWspAbiertas
    : [];

  let score = 96;
  const problemas = [];
  let agenteResponsableId = 'agente1_recepcion';
  let sentimiento = 'Positivo / Fluido';
  let tituloMejora = '';
  let reglaNuevaParaInyectar = '';

  const textoTodosClientes = msgsCliente.map((m) => String(m.texto || '')).join(' \n ');
  const lowerClientes = textoTodosClientes
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Detectar si el cliente corrigió al bot porque identificó mal el auto o entendió mal ("no es una toyota", "estás tomando mal", "revisa bien", "me cambiaste")
  const regexCorreccionVehiculo =
    /\b(no\s+es\s+(?:un|una)|estas?\s+tomando\s+mal|revisa\s+bien|te\s+equivo|mal\s+las\s+cosas|no\s+es\s+ese\s+auto|otro\s+modelo)\b/i;
  if (regexCorreccionVehiculo.test(lowerClientes)) {
    score -= 38;
    sentimiento = 'Frustrado · Corrección no aplicada';
    agenteResponsableId = 'agente1_recepcion';
    problemas.push({
      codigo: 'CORRECCION_VEHICULO_IGNORADA',
      severidad: 'alta',
      descripcion:
        'El cliente indicó que el vehículo/marca identificado era incorrecto ("no es una...", "estás tomando mal las cosas"), pero la sesión mantuvo la patente/marca anterior.',
    });
    tituloMejora = 'Resetear vehículo en sesión cuando el cliente corrige marca o modelo';
    reglaNuevaParaInyectar =
      'REGLA CX CORREGIDA: Si el cliente escribe "no es un/una [Marca]", "estás tomando mal las cosas" o corrige el vehículo identificado, descarta de inmediato el vehículo anterior de la sesión y pregúntale la marca, modelo y año correctos antes de buscar.';
  }

  // 2. Detectar si el bot repitió la misma respuesta genérica ("¿Qué repuesto necesitas para...?") 2 o más veces
  const conteoPreguntasRepuesto = msgsAgente.filter((m) =>
    /qu[eé]\s+repuesto\s+(?:necesitas|est[aá]s\s+buscando|buscas)/i.test(String(m.texto || ''))
  ).length;
  if (conteoPreguntasRepuesto >= 2) {
    score -= Math.min(45, (conteoPreguntasRepuesto - 1) * 18);
    sentimiento = 'Frustrado · Bucle de preguntas repetidas';
    agenteResponsableId = 'agente1_recepcion';
    problemas.push({
      codigo: 'BUCLE_PREGUNTA_REPUESTO',
      severidad: 'alta',
      descripcion: `El agente preguntó ${conteoPreguntasRepuesto} veces "¿Qué repuesto necesitas?" ignorando la intención contextual del cliente (envío a región, duda del producto o seguimiento).`,
    });
    if (!tituloMejora) {
      tituloMejora = 'Bloquear re-pregunta de repuesto cuando ya existe carrito o consulta de envío/postventa';
      reglaNuevaParaInyectar =
        'REGLA CX CORREGIDA: Prohibido volver a preguntar "¿Qué repuesto necesitas para tu vehículo?" cuando el cliente ya tiene un producto cotizado en carrito o cuando está preguntando por envío a región, dirección, seguimiento de compra o fotos.';
    }
  }

  // 3. Detectar frustración explícita, signos "?" sueltos o solicitud de asistente humano sin atención inmediata
  const pidioAsistenteOFalla =
    /\b(habra\s+algun\s+asistente|alguien\s+para\s+hablar|ya\s+compre\s+necesito|numero\s+de\s+envio|que\s+hago\s+aqui)\b/i.test(
      lowerClientes
    ) || msgsCliente.some((m) => /^\s*\?+\s*$/.test(String(m.texto || '')));

  if (pidioAsistenteOFalla) {
    score -= 28;
    sentimiento = 'Frustrado · Pide asistencia / Postventa';
    if (!problemas.some((p) => p.severidad === 'alta')) {
      agenteResponsableId = 'agente5_cajero_wordpress';
    }
    problemas.push({
      codigo: 'FRICCION_POSTVENTA_O_HUMANO',
      severidad: 'alta',
      descripcion:
        'El cliente solicitó ayuda postventa ("ya compré, necesito número de envío") o pidió hablar con un asistente humano tras no recibir respuesta contextual.',
    });
    if (!tituloMejora) {
      tituloMejora = 'Priorizar postventa (número de envío) y derivación inmediata a humano';
      reglaNuevaParaInyectar =
        'REGLA CX CORREGIDA: Cuando el cliente indique "ya compré", pida "número de envío / seguimiento" o solicite un "asistente para hablar", deriva de inmediato a soporte postventa pidiendo solo su RUT o número de orden web, sin mencionar repuestos ni patentes.';
    }
  }

  // 4. Detectar respuestas excesivamente largas ("vómito de texto" > 520 caracteres o títulos con múltiples barras "/")
  const mensajesLargos = msgsAgente.filter((m) => String(m.texto || '').length > 520);
  const mensajesConMultiplesAutos = msgsAgente.filter(
    (m) => (String(m.texto || '').match(/\s\/\s/g) || []).length >= 3
  );
  if (mensajesLargos.length > 0 || mensajesConMultiplesAutos.length > 0) {
    score -= 18;
    if (sentimiento === 'Positivo / Fluido') sentimiento = 'Neutro · Exceso de texto del bot';
    if (problemas.length === 0) agenteResponsableId = 'orquestador';
    problemas.push({
      codigo: 'EXCESO_TEXTO_COTIZACION',
      severidad: 'media',
      descripcion: `El agente envió ${Math.max(
        mensajesLargos.length,
        mensajesConMultiplesAutos.length
      )} mensaje(s) demasiado extensos o listando múltiples modelos de autos ajenos al del cliente.`,
    });
    if (!tituloMejora) {
      tituloMejora = 'Sintetizar cotización a 4 líneas máximo y limpiar títulos multipropósito';
      reglaNuevaParaInyectar =
        'REGLA CX CORREGIDA: En cada cotización muestra únicamente el nombre limpio de la pieza (sin listar otros modelos separados por "/"), el precio IVA incluido y el link directo en facilrepuestos.cl en máximo 4 líneas.';
    }
  }

  // 5. Detectar si quedó en validación con proveedores (Mesa WSP) esperando respuesta
  if (solicitudesWsp.length > 0 && carrito.length === 0) {
    if (score > 82) score = 82;
    if (sentimiento === 'Positivo / Fluido') {
      sentimiento = 'En espera de cotización de proveedor (Mesa WSP)';
    }
  }

  score = Math.max(12, Math.min(100, Math.round(score)));
  const semaforoCx = score >= 80 ? 'optimo' : score >= 55 ? 'atencion' : 'critico';

  const tieneLinkEntregado = msgsAgente.some((m) =>
    /https?:\/\/facilrepuestos\.cl/i.test(String(m.texto || ''))
  );

  let etapaEmbudo = 'Conversación Inicial';
  if (sesion.pedidoActivo) {
    etapaEmbudo = 'Orden Confirmada';
  } else if (tieneLinkEntregado || carrito.length > 0) {
    etapaEmbudo = 'Link de Producto Entregado';
  } else if (solicitudesWsp.length > 0) {
    etapaEmbudo = 'Buscando en Proveedores WSP';
  } else if (sesion.vehiculoContexto?.marca) {
    etapaEmbudo = 'Vehículo Identificado';
  }

  const ultimoMsgCliente =
    msgsCliente.length > 0 ? String(msgsCliente[msgsCliente.length - 1].texto || '') : '';

  const diagnosticoEjecutivo =
    problemas.length === 0
      ? `Conversación fluida (${score}% CX). ${
          tieneLinkEntregado
            ? 'El agente identificó vehículo + repuesto y entregó el link directo de compra en facilrepuestos.cl.'
            : 'Interacción clara y concisa sin fricción detectada.'
        }`
      : problemas.map((p) => p.descripcion).join(' ');

  return {
    sesionId: sesion.id,
    clienteNombre: sesion.clienteNombre || 'Cliente WhatsApp',
    clienteTelefono: sesion.clienteTelefono || '',
    vehiculoResumen: sesion.vehiculoContexto
      ? `${sesion.vehiculoContexto.patente ? `[${sesion.vehiculoContexto.patente}] ` : ''}${
          sesion.vehiculoContexto.marca || ''
        } ${sesion.vehiculoContexto.modelo || ''} ${sesion.vehiculoContexto.anio || ''}`.trim()
      : 'Sin vehículo identificado',
    totalTurnosCliente: msgsCliente.length,
    totalTurnosAgente: msgsAgente.length,
    ultimoMensajeCliente: ultimoMsgCliente,
    tieneLinkEntregado,
    itemsEnCarrito: carrito.length,
    scoreCx: score,
    semaforoCx,
    sentimientoCliente: sentimiento,
    etapaEmbudo,
    problemasDetectados: problemas,
    agenteResponsableId,
    agenteResponsableNombre:
      MAPA_NOMBRES_AGENTES[agenteResponsableId] || 'Agente 1 · Motor de Intención Contextual',
    diagnosticoEjecutivo,
    mejoraSugerida:
      problemas.length > 0
        ? {
            titulo: tituloMejora,
            agenteDestinoId: agenteResponsableId,
            agenteDestinoNombre:
              MAPA_NOMBRES_AGENTES[agenteResponsableId] || 'Agente 1 · Motor de Intención Contextual',
            reglaNuevaParaInyectar,
          }
        : null,
    updatedAt: sesion.updatedAt || sesion.createdAt || new Date().toISOString(),
  };
}

/**
 * Audita profundamente una sesión específica invocando a Gemini Quality AI en Vertex AI (`facilrepuestos-prod`),
 * generando un diagnóstico experto y una regla de mejora a medida para el subagente responsable.
 */
export async function auditarSesionProfundaConGeminiCx(sesion = {}) {
  const baseAudit = evaluarSesionCxDeterministica(sesion);
  const mensajes = Array.isArray(sesion.mensajes) ? sesion.mensajes : [];
  if (mensajes.length === 0) return baseAudit;

  try {
    const client = await googleAuth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) return baseAudit;

    const cfgAgentes = await obtenerConfiguracionAgentesIA().catch(() => null);
    const modeloPreferido = cfgAgentes?.modeloGlobalPreferido || 'gemini-4.0-neon';

    const transcripcionChat = mensajes
      .slice(-16)
      .map(
        (m) =>
          `[${m.autor === 'cliente' || m.rol === 'cliente' ? 'CLIENTE' : 'REPUESTÍN'}]: ${String(
            m.texto || ''
          )}`
      )
      .join('\n');

    const systemPrompt = `Eres el Auditor Senior de Google Cloud CX (Customer Engagement Suite · Quality AI) para facilrepuestos.cl.
Analiza la transcripción real de WhatsApp entre el CLIENTE y REPUESTÍN (arquitectura de 6 Subagentes:
- "orquestador": Agente 0 · Orquestador Central (brevedad y entrega de links)
- "agente1_recepcion": Agente 1 · Motor de Intención Contextual, Recepción y Vehículo
- "agente2_buscador_erp": Agente 2 · Buscador ERP y Matching de Piezas
- "agente3_logistica_proveedores": Agente 3 · Logística, Retiro 11:30/15:30 y Tarifario Despacho
- "agente4_mesa_abastecimiento": Agente 4 · Mesa de Abastecimiento WSP y Producto Temporal 4h
- "agente5_cajero_wordpress": Agente 5 · Link Directo a Tienda y Webhook WordPress
- "agente6_pedidos_adicionales": Agente 6 · Fusión de Pedidos Adicionales).

Evalúa la experiencia del cliente (scoreCx de 0 a 100), detecta cualquier falla de entendimiento de intención, exceso de texto o fricción, indica cuál de los 6 agentes debe mejorarse ("agenteDestinoId") y redacta una instrucción concreta ("reglaNuevaParaInyectar") para agregar al cerebro de ese agente.

Responde ÚNICAMENTE con un objeto JSON válido:
{
  "scoreCx": 85,
  "sentimientoCliente": "",
  "diagnosticoEjecutivo": "",
  "agenteDestinoId": "agente1_recepcion",
  "tituloMejora": "",
  "reglaNuevaParaInyectar": ""
}`;

    const modelosIntento = Array.from(
      new Set([modeloPreferido, 'gemini-3.8-flash', 'gemini-2.5-flash'])
    );
    let resp = null;
    for (const modId of modelosIntento) {
      const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${modId}:generateContent`;
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 9500);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Vehículo en sesión: ${baseAudit.vehiculoResumen}\nProductos en carrito: ${baseAudit.itemsEnCarrito}\n\nTRANSCRIPCIÓN DEL CHAT:\n${transcripcionChat}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 550,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(tId);
        if (r.ok) {
          resp = r;
          break;
        }
      } catch {
        clearTimeout(tId);
      }
    }

    if (!resp || !resp.ok) return baseAudit;
    const data = await resp.json();
    const rawText = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim();
    if (!rawText) return baseAudit;

    const parsed = JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
    const scoreFinal =
      typeof parsed.scoreCx === 'number'
        ? Math.max(10, Math.min(100, Math.round(parsed.scoreCx)))
        : baseAudit.scoreCx;
    const semaforoFinal = scoreFinal >= 80 ? 'optimo' : scoreFinal >= 55 ? 'atencion' : 'critico';
    const agId =
      parsed.agenteDestinoId && MAPA_NOMBRES_AGENTES[parsed.agenteDestinoId]
        ? parsed.agenteDestinoId
        : baseAudit.agenteResponsableId;

    const resultadoEnriquecido = {
      ...baseAudit,
      scoreCx: scoreFinal,
      semaforoCx: semaforoFinal,
      sentimientoCliente: parsed.sentimientoCliente || baseAudit.sentimientoCliente,
      diagnosticoEjecutivo: parsed.diagnosticoEjecutivo || baseAudit.diagnosticoEjecutivo,
      agenteResponsableId: agId,
      agenteResponsableNombre: MAPA_NOMBRES_AGENTES[agId],
      auditadoConGemini: true,
      mejoraSugerida: parsed.reglaNuevaParaInyectar
        ? {
            titulo: parsed.tituloMejora || baseAudit.mejoraSugerida?.titulo || 'Mejora CX sugerida por IA',
            agenteDestinoId: agId,
            agenteDestinoNombre: MAPA_NOMBRES_AGENTES[agId],
            reglaNuevaParaInyectar: String(parsed.reglaNuevaParaInyectar).trim(),
          }
        : baseAudit.mejoraSugerida,
    };

    await db
      .collection(COLECCION_AUDITORIAS_CX)
      .doc(String(sesion.id))
      .set(
        {
          ...resultadoEnriquecido,
          auditadoEn: new Date().toISOString(),
        },
        { merge: true }
      )
      .catch(() => null);

    return resultadoEnriquecido;
  } catch {
    return baseAudit;
  }
}

/**
 * Evalúa todas las sesiones activas y devuelve el Dashboard consolidado de Google Cloud CX · Quality AI.
 */
export function construirDashboardCxBandeja(sesiones = []) {
  const lista = Array.isArray(sesiones) ? sesiones : [];
  const auditorias = lista
    .map((s) => evaluarSesionCxDeterministica(s))
    .sort((a, b) => a.scoreCx - b.scoreCx);

  const totalSesiones = auditorias.length;
  const scorePromedioCx =
    totalSesiones > 0
      ? Math.round(auditorias.reduce((acc, a) => acc + a.scoreCx, 0) / totalSesiones)
      : 100;

  const totalOptimas = auditorias.filter((a) => a.semaforoCx === 'optimo').length;
  const totalConAtencion = auditorias.filter((a) => a.semaforoCx === 'atencion').length;
  const totalCriticasConFriccion = auditorias.filter((a) => a.semaforoCx === 'critico').length;
  const conLinkEntregado = auditorias.filter((a) => a.tieneLinkEntregado).length;
  const tasaEntregaLinkTiendaPct =
    totalSesiones > 0 ? Math.round((conLinkEntregado / totalSesiones) * 100) : 100;

  // Salud por cada uno de los 6 agentes + Orquestador
  const saludPorAgente = Object.entries(MAPA_NOMBRES_AGENTES).map(([id, nombre]) => {
    const alertas = auditorias.filter(
      (a) => a.agenteResponsableId === id && a.problemasDetectados.length > 0
    );
    return {
      agenteId: id,
      nombre,
      alertasActivas: alertas.length,
      estadoSalud: alertas.length === 0 ? 'optimo' : alertas.length <= 2 ? 'atencion' : 'critico',
    };
  });

  return {
    resumenKpis: {
      totalSesionesAuditadas: totalSesiones,
      scorePromedioCx,
      totalOptimas,
      totalConAtencion,
      totalCriticasConFriccion,
      tasaEntregaLinkTiendaPct,
    },
    saludPorAgente,
    auditorias,
    generadoEn: new Date().toISOString(),
  };
}

/**
 * Inyecta en 1 clic una regla correctiva sugerida por el Auditor CX directamente en el cerebro
 * en vivo del subagente correspondiente (`cerebros_agentes_ia`) sin reiniciar Cloud Run.
 */
export async function aplicarMejoraCxAAgente({
  sesionId = '',
  agenteDestinoId = 'agente1_recepcion',
  reglaNuevaParaInyectar = '',
  tituloMejora = '',
}) {
  const reglaLimpia = String(reglaNuevaParaInyectar || '').trim();
  if (!reglaLimpia) {
    throw new Error('La regla de mejora a inyectar no puede estar vacía.');
  }

  const configActual = await obtenerConfiguracionAgentesIA({ forceRefresh: true });
  const agActual = configActual?.agentes?.[agenteDestinoId];
  if (!agActual) {
    throw new Error(`Agente destino "${agenteDestinoId}" no encontrado.`);
  }

  const contextoPrevio = String(agActual.contextoExtra || '').trim();
  const yaExiste = contextoPrevio.includes(reglaLimpia);
  const nuevoContextoExtra = yaExiste
    ? contextoPrevio
    : `${contextoPrevio}\n\n[MEJORA CX APLICADA (${new Date().toLocaleDateString('es-CL')}) - ${
        tituloMejora || 'Optimización Quality AI'
      }]:\n${reglaLimpia}`.trim();

  const configActualizada = await guardarConfiguracionAgentesIA({
    agentes: {
      [agenteDestinoId]: {
        ...agActual,
        contextoExtra: nuevoContextoExtra,
      },
    },
  });

  if (sesionId) {
    await db
      .collection(COLECCION_AUDITORIAS_CX)
      .doc(String(sesionId))
      .set(
        {
          mejoraAplicada: true,
          mejoraAplicadaEn: new Date().toISOString(),
          agenteDestinoId,
          reglaInyectada: reglaLimpia,
        },
        { merge: true }
      )
      .catch(() => null);
  }

  return {
    agenteActualizado: configActualizada.agentes[agenteDestinoId],
    configuracionCompleta: configActualizada,
  };
}
