/**
 * server/agents/agente1Recepcion.js
 *
 * AGENTE 1 — MOTOR DE INTENCIÓN CONTEXTUAL (NLU), RECEPCIÓN Y DIAGNÓSTICO AUTOMOTRIZ
 * ──────────────────────────────────────────────────────────────────────────────────
 * Responsabilidades:
 *  1. Entender la INTENCIÓN REAL del cliente en el contexto de la conversación activa:
 *     - ¿Está pidiendo cotizar un repuesto nuevo?
 *     - ¿Está haciendo una pregunta puntual de Sí/No sobre el producto que YA tiene cotizado en pantalla
 *       (ej. "¿Es el par completo?", "¿Tienes más fotos?", "¿Viene con goma?", "Es para mi Changan S100 1.0")?
 *     - ¿Está indicando cómo quiere recibir su compra (ej. "Quiero para envío a región", "Vallenar", "Para retiro")?
 *     - ¿Ya compró y pide postventa/número de envío o cambiar dirección de despacho?
 *     - ¿Hace una pregunta corta de tienda (ej. "¿Es la única sucursal?") o pide hablar con un asistente humano?
 *  2. Limpiar los nombres largos del ERP (que listan 10 marcas compatibles) para mostrar solo el nombre de la pieza
 *     enfocado en el vehículo del cliente.
 */

import { obtenerContextoHoraChile } from '../services/lunaConversacional.js';
import {
  cotizarDespachoAnticipado,
  calcularPromesaRetiroYDespacho,
} from '../services/logisticaTarifarioService.js';
import { esItemStockPropioOlivares224, esItemSoluparts } from './agente2BuscadorErp.js';

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
  'valparaiso', 'viña del mar', 'vina del mar', 'quilpue', 'villa alemana', 'quillota', 'san antonio', 'los andes', 'san felipe',
  'rancagua', 'machali', 'san fernando', 'santa cruz', 'rengo',
  'talca', 'curico', 'linares', 'constitucion', 'cauquenes',
  'la serena', 'coquimbo', 'ovalle', 'illapel', 'vicuña',
  'copiapo', 'vallenar', 'chañaral', 'caldera',
  'antofagasta', 'calama', 'tocopilla', 'mejillones',
  'iquique', 'alto hospicio', 'arica',
  'concepcion', 'talcahuano', 'chillan', 'los angeles', 'coronel', 'san pedro de la paz', 'tome', 'lebu',
  'temuco', 'villarrica', 'pucon', 'angol', 'victoria',
  'valdivia', 'la union', 'rio bueno',
  'osorno', 'puerto montt', 'puerto varas', 'castro', 'ancud', 'chiloe',
  'coyhaique', 'puerto aysen', 'punta arenas', 'puerto natales',
];

/**
 * Limpia el título crudo del catálogo ERP eliminando la lista interminable de otros vehículos compatibles
 * (ej. "RODAMIENTO CAZOLETA DELANTERA POR PAR para BYD F0 / JAC J2 / ... / CHERY ARRIZO 3 / CHANGAN CS15")
 * para dejar únicamente el nombre limpio de la pieza: "RODAMIENTO CAZOLETA DELANTERA POR PAR".
 */
export function formatearNombreProductoParaVehiculoCliente(nombreCrudo = '') {
  const raw = String(nombreCrudo || '').trim();
  if (!raw) return 'Repuesto Automotriz';
  const partesPara = raw.split(/\s+para\s+/i);
  const basePieza = partesPara[0].replace(/\s+/g, ' ').trim();
  return basePieza || raw;
}

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
 * Responde de forma directa, breve (2-3 líneas) y contextual cuando el cliente hace una pregunta
 * sobre el producto que YA tiene cotizado en `carritoCotizado` (ej. "¿Es el par completo?", "¿Tienes más fotos?",
 * "¿Es original?", "Es para mi changan s100 año 2012 1.0").
 */
export function construirRespuestaPreguntaSobreProductoCotizado({
  textoCliente = '',
  carritoCotizado = [],
  vehiculo = null,
}) {
  const limpio = String(textoCliente || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const vehStr = [vehiculo?.marca, vehiculo?.modelo, vehiculo?.anio, vehiculo?.motor]
    .filter(Boolean)
    .join(' ');

  // 0. ¿El cliente reclama por qué se le envió o repitió un repuesto o aclara que pedía otra posición (delantero vs trasero)?
  if (
    /\b(por\s+que\s+me\s+(?:volviste|mandaste|mandas|envias|enviaste)|ya\s+me\s+(?:mandaste|mostraste|cotizaste)|ese\s+es\s+(?:el\s+)?(?:trasero|delantero)|te\s+pedi\s+(?:el\s+)?(?:delantero|trasero)|no\s+es\s+ese)\b/.test(
      limpio
    )
  ) {
    return (
      `¡Toda la razón, disculpa la confusión! 🙏 Dejamos descartada esa referencia anterior.\n` +
      `Cuéntame exactamente qué pieza o lado necesitas ver ahora para tu **${vehStr || 'vehículo'}** y lo revisamos de inmediato.`
    );
  }

  const item = carritoCotizado[carritoCotizado.length - 1] || carritoCotizado[0];
  if (!item) {
    return `Cuéntame qué repuesto necesitas revisar para tu **${vehStr || 'vehículo'}** y lo vemos de inmediato.`;
  }

  const nombreFull = String(item.nombre || '').toUpperCase();
  const nombreCorto = formatearNombreProductoParaVehiculoCliente(item.nombre);
  const precioIva = Number(item.precioVentaConIva || 0).toLocaleString('es-CL');

  // 1. ¿Pregunta si es el par / juego / kit o si viene completo?
  if (/\b(par|dos|ambos|lados|juego|kit|completo|completa|unidad|individual|viene\s+con)\b/.test(limpio)) {
    const esPorPar = /\b(POR\s+PAR|PAR\b|JUEGO|SET|2\s+UN|KIT)\b/i.test(nombreFull);
    const esSoloRodamiento =
      /\bRODAMIENTO\s+CAZOLETA\b/i.test(nombreFull) && !/\bCAZOLETA\s+COMPLETA\b/i.test(nombreFull);

    if (esSoloRodamiento) {
      return (
        `Sí, el valor de **$${precioIva} IVA inc.** incluye el **par (2 unidades, ambos lados)**, pero ojo: este código (\`${item.skuPublicoFrp}\`) corresponde a los **rodamientos de cazoleta delantera**, no a la cazoleta de goma/metal completa.\n` +
        `¿Buscabas los rodamientos o necesitas que te busquemos la **cazoleta delantera completa** para tu **${vehStr || 'vehículo'}**?`
      );
    }

    if (esPorPar) {
      return (
        `Sí 👍 El valor de **$${precioIva} IVA inc.** (\`${item.skuPublicoFrp}\`) corresponde al **par / conjunto indicado en la publicación** (${nombreCorto}).\n` +
        `👉 Puedes comprarlo directo aquí (en la página eliges tu despacho o retiro en tienda): ${item.urlProductoWoo}`
      );
    }

    return (
      `Este código (\`${item.skuPublicoFrp}\` — **${nombreCorto}** a **$${precioIva} IVA inc.**) se vende **por unidad individual**.\n` +
      `👉 Puedes revisarlo y elegir la cantidad directo en tienda aquí: ${item.urlProductoWoo}`
    );
  }

  // 2. ¿Pide más fotos o imágenes del producto?
  if (/\b(foto|fotos|imagen|imagenes|verlo|mostrar|muestra)\b/.test(limpio)) {
    return (
      `📸 La fotografía oficial de **${nombreCorto}** (\`${item.skuPublicoFrp}\`) la puedes ver directamente en la ficha del producto aquí:\n` +
      `👉 ${item.urlProductoWoo}\n` +
      `Si necesitas verificar algún detalle o medida específica de la pieza física en bodega antes de comprar, dime cuál y lo consultamos al tiro.`
    );
  }

  // 3. ¿Pregunta por marca / origen / calidad?
  if (/\b(marca|origen|chino|coreano|japones|original|alternativo|oem|calidad|procedencia)\b/.test(limpio)) {
    return (
      `El **${nombreCorto}** (\`${item.skuPublicoFrp}\` — **$${precioIva} IVA inc.**) es marca **${
        item.fabricante || 'OEM / Alternativo certificado'
      }** compatible con tu **${vehStr || 'vehículo'}** y cuenta con 3 meses de garantía.\n` +
      `👉 Comprar directo en tienda: ${item.urlProductoWoo}`
    );
  }

  // 4. ¿Está confirmando o detallando el modelo/motor de su auto (ej. "Es para mi changan s100 año 2012 1.0")?
  return (
    `¡Sí, confirmado! ✅ El **${nombreCorto}** (\`${item.skuPublicoFrp}\` — **$${precioIva} IVA inc.**) es compatible con tu **${
      vehStr || 'vehículo'
    }**.\n` +
    `👉 Puedes comprarlo directo aquí (en la web eliges despacho o retiro y el sistema me avisa automáticamente al pagar): ${item.urlProductoWoo}`
  );
}

/**
 * Genera respuestas cortas y enfocadas cuando el cliente solo saluda o falta vehículo/repuesto.
 */
export function construirRespuestaAgente1Recepcion({
  intencion,
  vehiculo,
  repuestoDetectado,
  carritoCotizado = [],
  textoCliente = '',
  minutosInactivo = 0,
}) {
  if (intencion === 'SALUDO_RETOMA_CON_COTIZACION_PREVIA') {
    const vehTxt = [vehiculo?.marca, vehiculo?.modelo, vehiculo?.anio]
      .filter((x) => x && x !== 'MULTIMARCA')
      .join(' ');
    const saludoRetoma =
      minutosInactivo >= 15
        ? '¡Hola, qué bueno tenerte de vuelta! 👋'
        : '¡Hola de nuevo! 👋';

    if (carritoCotizado.length > 0) {
      const nombresProductos = Array.from(
        new Set(
          carritoCotizado
            .map((it) => formatearNombreProductoParaVehiculoCliente(it.nombre))
            .filter(Boolean)
        )
      );
      const listaProdTxt =
        nombresProductos.length === 1
          ? `el **${nombresProductos[0]}**`
          : `los repuestos que vimos (**${nombresProductos.slice(0, 3).join(' / ')}**)`;
      const sufijoAuto = vehTxt ? ` para tu **${vehTxt}**` : '';

      return `${saludoRetoma} ¿Aún sigues interesado en ${listaProdTxt}${sufijoAuto} que cotizamos, o prefieres que veamos algún repuesto o vehículo nuevo?`;
    }

    if (vehTxt) {
      return `${saludoRetoma} ¿Seguimos viendo repuestos para tu **${vehTxt}** o buscas algo para otro vehículo?`;
    }

    return `${saludoRetoma} Cuéntame, ¿qué repuesto buscas hoy y para qué vehículo?`;
  }

  if (intencion === 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO' && carritoCotizado.length > 0) {
    return construirRespuestaPreguntaSobreProductoCotizado({
      textoCliente,
      carritoCotizado,
      vehiculo,
    });
  }

  if (intencion === 'PIDIO_ENVIO_SIN_COMUNA') {
    const item = carritoCotizado[carritoCotizado.length - 1];
    const refProd = item
      ? `tu **${formatearNombreProductoParaVehiculoCliente(item.nombre)}** (\`${item.skuPublicoFrp}\`)`
      : 'tu repuesto';
    return `¡Claro que sí! 🚚 Despachamos a todo Santiago y a todas las regiones de Chile.\n¿A qué **ciudad o comuna** necesitas el envío de ${refProd} para darte el valor exacto?`;
  }

  if (intencion === 'MODIFICAR_DIRECCION_ENVIO') {
    return (
      `📦 ¡Por supuesto! Para actualizar o corregir tu **dirección de envío**, escríbeme aquí mismo:\n` +
      `1️⃣ La **nueva dirección completa y comuna/ciudad**.\n` +
      `2️⃣ Tu **RUT o número de pedido web** (si ya realizaste la compra en facilrepuestos.cl).\n` +
      `Con eso dejamos actualizado tu despacho de inmediato.`
    );
  }

  if (intencion === 'SALUDO_O_CONVERSACION_INICIAL') {
    if (carritoCotizado.length > 0) {
      const ult = carritoCotizado[carritoCotizado.length - 1];
      return (
        `Seguimos atentos a tu cotización de **${formatearNombreProductoParaVehiculoCliente(ult.nombre)}** (\`${ult.skuPublicoFrp}\` — **$${Number(ult.precioVentaConIva || 0).toLocaleString('es-CL')} IVA inc.**).\n` +
        `Cuéntame si tienes alguna duda sobre el repuesto, si necesitas el valor de envío a tu comuna/región o si necesitas ayuda con tu compra.`
      );
    }
    if (vehiculo?.marca && vehiculo.marca !== 'MULTIMARCA') {
      return `¡Hola! 👋 Soy **Repuestín** de **facilrepuestos.cl**. Tengo en pantalla tu **${vehiculo.marca} ${vehiculo.modelo || ''} ${vehiculo.anio || ''}**.\nCuéntame, ¿qué repuesto necesitas hoy?`;
    }
    return '¡Hola! 👋 Soy **Repuestín** de **facilrepuestos.cl**.\nCuéntame **qué repuesto buscas** y la **patente** de tu vehículo (o marca, modelo y año) para verlo al tiro.';
  }

  if (intencion === 'SOLO_VEHICULO_SIN_REPUESTO' && vehiculo) {
    if (carritoCotizado.length > 0) {
      return construirRespuestaPreguntaSobreProductoCotizado({
        textoCliente,
        carritoCotizado,
        vehiculo,
      });
    }
    return `¡Perfecto! 🚗 Identifiqué tu **${vehiculo.marca} ${vehiculo.modelo || ''} ${
      vehiculo.anio ? `(${vehiculo.anio})` : ''
    }**${vehiculo.patente ? ` [Patente ${vehiculo.patente}]` : ''}.\n¿Qué repuesto necesitas cotizar para este vehículo?`;
  }

  if (intencion === 'SOLO_REPUESTO_SIN_VEHICULO') {
    const nomPieza = repuestoDetectado?.resumenRepuesto || 'ese repuesto';
    return `¡Buenísimo! Anotado **${nomPieza}**. 🔧\nPara verificar compatibilidad exacta, ¿me das la **patente** de tu vehículo (o marca, modelo y año)?`;
  }

  return null;
}
