/**
 * server/agents/agente1Recepcion.js
 *
 * AGENTE 1 — RECEPCIÓN, DIAGNÓSTICO AUTOMOTRIZ Y PERFILAMIENTO DE NECESIDAD
 * ─────────────────────────────────────────────────────────────────────────
 * Responsabilidad única:
 *  1. Entender qué busca el cliente (Vehículo/Patente + Repuesto + Lado/Posición).
 *  2. Detectar la URGENCIA del cliente (¿lo necesita hoy urgente / auto en taller o puede esperar?).
 *  3. Detectar la UBICACIÓN / COMUNA del cliente (¿de qué parte de Santiago o de qué región de Chile escribe?).
 *  4. Si falta un dato crítico (ej. vehículo o repuesto), redactar una pregunta corta (2 líneas) sin divagar.
 */

import { obtenerContextoHoraChile } from '../services/lunaConversacional.js';
import { cotizarDespachoAnticipado } from '../services/logisticaTarifarioService.js';

const REGEX_URGENCIA_INMEDIATA =
  /\b(urgente|para\s+hoy|hoy\s+mismo|ahora\s+ya|lo\s+necesito\s+ya|auto\s+en\s+(?:el\s+)?taller|en\s+pana|varado|desarmado|retirar\s+ahora|inmediato|apuro|rapido|r[aá]pido)\b/i;

const REGEX_PUEDE_ESPERAR =
  /\b(puedo\s+esperar|no\s+es\s+urgente|para\s+la\s+semana|cotizando|sin\s+apuro|ma[ñn]ana|encargo)\b/i;

const COMUNAS_Y_CIUDADES_CLAVE = [
  'la florida', 'puente alto', 'macul', 'peñalolen', 'penalolen', 'la granja', 'san joaquin',
  'ñuñoa', 'nunoa', 'providencia', 'santiago', 'santiago centro', 'san miguel', 'la cisterna',
  'la reina', 'las condes', 'vitacura', 'lo barnechea', 'maipu', 'maipú', 'pudahuel',
  'estacion central', 'cerrillos', 'quilicura', 'huechuraba', 'recoleta', 'independencia',
  'conchali', 'renca', 'san bernardo', 'el bosque', 'lo espejo', 'colina', 'chicureo', 'lampa',
  'peñaflor', 'penaflor', 'talagante', 'buin', 'paine', 'melipilla',
  'valparaiso', 'viña del mar', 'vina del mar', 'rancagua', 'talca', 'curico', 'la serena',
  'coquimbo', 'concepcion', 'chillan', 'temuco', 'valdivia', 'osorno', 'puerto montt',
  'antofagasta', 'calama', 'iquique', 'arica', 'copiapo', 'punta arenas', 'coyhaique',
];

/**
 * Extrae urgencia y comuna/ciudad desde el mensaje del cliente o historial de sesión.
 */
export function perfilarNecesidadYComunaCliente({ textoCliente = '', sesion = {} }) {
  const lower = String(textoCliente || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let urgencia = sesion.urgenciaCliente || 'normal';
  if (REGEX_URGENCIA_INMEDIATA.test(lower)) {
    urgencia = 'inmediata_hoy';
  } else if (REGEX_PUEDE_ESPERAR.test(lower)) {
    urgencia = 'flexible';
  }

  let comunaDetectada = sesion.comunaCliente || null;
  for (const c of COMUNAS_Y_CIUDADES_CLAVE) {
    const cNorm = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rx = new RegExp(`\\b${cNorm}\\b`, 'i');
    if (rx.test(lower)) {
      const cot = cotizarDespachoAnticipado({ direccionOComuna: c });
      comunaDetectada = cot?.comunaDetectada || c.toUpperCase();
      break;
    }
  }

  return {
    urgencia,
    comunaCliente: comunaDetectada,
    horaChile: obtenerContextoHoraChile(),
  };
}

/**
 * Genera respuestas cortas y enfocadas cuando el cliente solo saluda o falta vehículo/repuesto.
 */
export function construirRespuestaAgente1Recepcion({
  intencion,
  vehiculo,
  repuestoDetectado,
}) {
  if (intencion === 'SALUDO_O_CONVERSACION_INICIAL') {
    if (vehiculo?.marca && vehiculo.marca !== 'MULTIMARCA') {
      return `¡Hola! 👋 Soy **Repuestín** de **facilrepuestos.cl**. Tengo en pantalla tu **${vehiculo.marca} ${vehiculo.modelo || ''} ${vehiculo.anio || ''}**.\nCuéntame, ¿qué repuesto necesitas hoy y de qué comuna o ciudad nos escribes?`;
    }
    return '¡Hola! 👋 Soy **Repuestín** de **facilrepuestos.cl**.\nCuéntame **qué repuesto buscas**, la **patente** de tu vehículo (o marca, modelo y año) y de qué **comuna o ciudad** eres para verlo al tiro.';
  }

  if (intencion === 'SOLO_VEHICULO_SIN_REPUESTO' && vehiculo) {
    return `¡Perfecto! 🚗 Identifiqué tu **${vehiculo.marca} ${vehiculo.modelo || ''} ${
      vehiculo.anio ? `(${vehiculo.anio})` : ''
    }**${vehiculo.patente ? ` [Patente ${vehiculo.patente}]` : ''}.\n¿Qué repuesto necesitas para este vehículo y para qué comuna o ciudad lo buscas?`;
  }

  if (intencion === 'SOLO_REPUESTO_SIN_VEHICULO') {
    const nomPieza = repuestoDetectado?.resumenRepuesto || 'ese repuesto';
    return `¡Buenísimo! Anotado **${nomPieza}**. 🔧\nPara buscar el calce exacto, ¿me das la **patente** de tu vehículo (o marca, modelo y año) y me cuentas de qué **comuna** nos escribes?`;
  }

  return null;
}
