import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';
import {
  obtenerConfigMetaWhatsapp,
  manejarWebhookGetMeta,
  manejarWebhookPostMeta,
  enviarRespuestaClienteMetaWhatsapp,
} from './agenteOmnicanal.js';
import {
  seleccionarTop3ProveedoresMesaWsp,
  elegirMejorOfertaMesaWsp,
  crearYPublicarProductoTemporalMesaWsp,
  analizarRespuestaMultimodalProveedorAgente4,
  construirResumenFormalProveedorIa,
  construirResumenEjecutivoSolicitudIa,
} from '../agents/agente4MesaYPublicadorTemporal.js';
import {
  obtenerConfiguracionAgentesIA,
  guardarConfiguracionAgentesIA,
} from '../agents/configAgentesService.js';

const router = Router();

const COLECCION_SOLICITUDES_WSP = 'solicitudes_cotizacion_wsp';
const COLECCION_CONOCIMIENTO = 'conocimiento_aprendido_ia';
const COLECCION_INVENTARIO = 'inventario';
const COLECCION_PROVEEDORES = 'proveedores';

const FABRICANTES_CONOCIDOS = [
  'VALEO',
  'LUK',
  'SACHS',
  'AISIN',
  'EXEDY',
  'BOSCH',
  'BREMBO',
  'TRW',
  'SANGSIN',
  'HI-Q',
  'KYB',
  'KAYABA',
  'MONROE',
  'GABRIEL',
  'GMB',
  'SKF',
  'NTN',
  'KOYO',
  'GATES',
  'DAYCO',
  'CONTITECH',
  'MANN',
  'MAHLE',
  'FILTEC',
  'MOBIS',
  'GENUINO',
  'MANDO',
  'DENSO',
  'NGK',
  'DELPHI',
];

const ORIGENES_MAP = [
  { regex: /\b(corea|coreano|korea|koreano)\b/i, valor: 'COREA' },
  { regex: /\b(japon|japonés|japones|japan)\b/i, valor: 'JAPÓN' },
  { regex: /\b(alemania|aleman|alemán|germany)\b/i, valor: 'ALEMANIA' },
  { regex: /\b(brasil|brasileño|brasileno)\b/i, valor: 'BRASIL' },
  { regex: /\b(original|oem|genuino)\b/i, valor: 'ORIGINAL OEM' },
  { regex: /\b(taiwan|taiwán|taiwanes)\b/i, valor: 'TAIWÁN' },
  { regex: /\b(china|chino|alternativo)\b/i, valor: 'ALTERNATIVO' },
];

function generarCodigoSolicitud() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `WSP-${num}`;
}

function normalizarTerminos(texto = '') {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Analiza un mensaje libre de WhatsApp (texto + transcripción de audio opcional) enviado
 * por un proveedor humano y extrae estructuradamente:
 * - Si tiene stock o no
 * - Precio costo neto (convirtiendo "95 mil", "$95.000", "+ iva" vs "con iva")
 * - Marca / Fabricante del repuesto (Valeo, LuK, Bosch, Mobis, etc.)
 * - Origen (Corea, Japón, Alemania, Original OEM, Alternativo)
 * - Disponibilidad de entrega (Inmediata, Hoy, 24h, Sin stock)
 */
/**
 * Detector exhaustivo de falta de stock ("Sin Stock") en lenguaje natural chileno B2B de proveedores de repuestos.
 * Reconoce negativas directas ("no tengo", "agotado", "nada por acá", "no hay", "no trabajamos esa marca", "0 stock",
 * "no me llegó", "se acabó", "paso", "negativo") y respuestas cortas negativas ("No", "No estimado", "Nada").
 */
export function detectarProveedorSinStock(texto = '') {
  const limpio = String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!limpio) return false;

  const frasesSinStockRegex =
    /\b(no\s+me\s+queda[n]?|no\s+nos\s+queda[n]?|no\s+queda[n]?|sin\s+stock|agotad[oa]s?|no\s+tenemos|no\s+lo\s+tenemos|no\s+la\s+tenemos|no\s+lo\s+trabajo|no\s+la\s+trabajo|no\s+trabajamos|no\s+vemos\s+esa\s+marca|no\s+traemos|no\s+tengo|no\s+le\s+tengo|tampoco\s+tengo|no\s+hay|no\s+hay\s+mano|no\s+hay\s+disponible|sin\s+disponibilidad|no\s+disponible|nada\s+por\s+aca|nada\s+estimado|nada\s+amigo|nada\s+para\s+ese|nada\s+por\s+ahora|nada\s+por\s+el\s+momento|no\s+me\s+llego|no\s+nos\s+llego|se\s+me\s+acabo|se\s+acabo|se\s+agoto|0\s*stock|cero\s+stock|stock\s*0|negativo|paso\s+por\s+ahora|por\s+ahora\s+no|no\s+por\s+ahora|no\s+aplica|no\s+me\s+aparece|no\s+sale\s+nada|solo\s+por\s+encargo|no\s+manejamos)\b/i;

  if (frasesSinStockRegex.test(limpio)) {
    return true;
  }

  // Respuestas breves de negativa directa sin monto económico (ej. "No", "No estimado", "Hola, no", "Nada", "Paso")
  const sinSignos = limpio.replace(/[.,!¡?¿;:-]/g, ' ').replace(/\s+/g, ' ').trim();
  const tieneAlgunPrecio = /\b(\d{2,3}\s*(?:mil|lucas|k)|\d{1,3}\.\d{3}|\d{5,7})\b/i.test(limpio);
  if (
    !tieneAlgunPrecio &&
    /^(hola\s+|buenas\s+|buen\s+dia\s+|buenas\s+tardes\s+)?(no|nop|no\s+estimado|no\s+amigo|no\s+compadre|no\s+jefe|no\s+maestro|no\s+colega|nada|nada\s+estimado|nada\s+amigo|paso|negativo|nop\s+nada|no\s+nada)(\s+estimado|\s+amigo|\s+gracias|\s+disculpa|\s+por\s+aca|\s+por\s+ahora)?$/i.test(
      sinSignos
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Analiza un mensaje libre de WhatsApp (texto + transcripción de audio + lectura de imagen IA opcional) enviado
 * por un proveedor humano y extrae estructuradamente:
 * - Si tiene stock o no (reconociendo todas las variantes chilenas de "sin stock" sin repreguntar IVA ni marca)
 * - Precio costo neto (convirtiendo "95 mil", "$95.000", "+ iva" vs "con iva")
 * - Marca / Fabricante del repuesto (Valeo, LuK, Bosch, Mobis, Koyorad, etc.)
 * - Origen (Corea, Japón, Alemania, Original OEM, Alternativo)
 * - Disponibilidad de entrega (Inmediata, Hoy, 24h, Sin stock)
 * - Resumen Formal Ejecutivo (`resumenFormalIa`) de lo enviado por el proveedor
 */
export function extraerOfertaDesdeMensajeWsp({
  mensajeTexto = '',
  mensajeUltimoTurno = '',
  transcripcionAudio = '',
  lecturaImagenIa = '',
  codigoOemDetectado = '',
  precioManualNeto = null,
  fabricanteManual = '',
  origenManual = '',
  disponibilidadManual = '',
  sinStockExplicito = false,
  datosMultimodalesIa = null,
  proveedorNombre = 'Proveedor',
  repuestoBuscado = 'Repuesto',
  vehiculoStr = '',
  margenPct = 30,
}) {
  const audioEfectivo = String(
    transcripcionAudio || datosMultimodalesIa?.transcripcionAudio || ''
  ).trim();
  const lecturaImgEfectiva = String(
    lecturaImagenIa || datosMultimodalesIa?.lecturaImagenIa || ''
  ).trim();
  const oemEfectivo = String(
    codigoOemDetectado || datosMultimodalesIa?.codigoOemDetectado || ''
  )
    .trim()
    .toUpperCase();

  const fuente = [mensajeTexto, audioEfectivo, lecturaImgEfectiva].filter(Boolean).join(' . ').trim();
  const lower = fuente.toLowerCase();
  const ultimoTextoEvaluar = String(mensajeUltimoTurno || mensajeTexto || audioEfectivo || '').trim();

  // 1. Detectar si el proveedor indica que NO tiene stock (priorizando el último turno o la detección de Gemini Multimodal)
  const sinStockUltimoTurno = detectarProveedorSinStock(ultimoTextoEvaluar);
  const sinStockAcumulado = detectarProveedorSinStock(fuente);
  const sinStockGemini = datosMultimodalesIa?.tieneStock === false;
  const hayPrecioManual = Boolean(precioManualNeto && Number(precioManualNeto) > 0);

  const esSinStock =
    Boolean(sinStockExplicito) ||
    (!hayPrecioManual && (sinStockUltimoTurno || sinStockGemini || sinStockAcumulado));

  const tieneStock = !esSinStock;

  // 2. Extraer precio en CLP desde lenguaje natural chileno ("$95.000", "95000", "95 mil", "95k", "95 lucas") o desde Gemini Multimodal
  let precioDetectado = tieneStock
    ? Number(precioManualNeto) || Number(datosMultimodalesIa?.precioCostoNeto) || 0
    : 0;
  if (tieneStock && !precioDetectado && fuente) {
    const matchMil = fuente.match(/\$?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:mil|lucas|k)\b/i);
    if (matchMil) {
      const base = parseFloat(matchMil[1].replace(',', '.'));
      if (!isNaN(base)) {
        precioDetectado = Math.round(base * 1000);
      }
    }

    if (!precioDetectado) {
      // Buscar montos tipo $95.000 o 125.000 o 85000
      const matchMonto = fuente.match(/\$?\s*(\d{1,3}(?:\.\d{3})+|\d{4,7})\b/);
      if (matchMonto) {
        const limpio = parseInt(matchMonto[1].replace(/\./g, ''), 10);
        if (!isNaN(limpio) && limpio >= 2500) {
          precioDetectado = limpio;
        }
      }
    }
  }

  // 3. Determinar si el proveedor aclaró explícitamente si es + IVA (neto) o con IVA incluido
  const mencionaMasIva = /\b(mas\s+iva|m[aá]s\s+iva|\+\s*iva|neto|mas\s+impuesto)\b/i.test(lower);
  const mencionaConIvaExplicito =
    /\b(con\s+iva|iva\s+incluido|iva\s+inc|bruto)\b/i.test(lower) ||
    Boolean(datosMultimodalesIa?.mencionaConIva);
  const tieneIvaExplicito =
    mencionaMasIva ||
    mencionaConIvaExplicito ||
    Boolean(precioManualNeto) ||
    Boolean(datosMultimodalesIa?.tieneIvaExplicito);
  const mencionaConIva = mencionaConIvaExplicito && !mencionaMasIva;

  const precioCostoNeto = !tieneStock
    ? 0
    : mencionaConIva
    ? Math.round(precioDetectado / 1.19)
    : Math.round(precioDetectado);

  // 4. Detectar fabricante / marca de la pieza (en texto, audio o leída por Visión IA en la caja)
  let fabricante = String(fabricanteManual || datosMultimodalesIa?.fabricante || '')
    .trim()
    .toUpperCase();
  let tieneMarcaExplicita = Boolean(fabricante && fabricante !== 'ALTERNATIVO');
  if (!fabricante) {
    const upperFuente = fuente.toUpperCase();
    const encontrado = FABRICANTES_CONOCIDOS.find((fab) => {
      const rx = new RegExp(`\\b${fab.replace('-', '[-\\s]?')}\\b`, 'i');
      return rx.test(upperFuente);
    });
    if (encontrado) {
      fabricante = encontrado;
      tieneMarcaExplicita = true;
    } else if (/\b(original|oem|genuino)\b/i.test(fuente)) {
      fabricante = 'ORIGINAL OEM';
      tieneMarcaExplicita = true;
    } else if (/\b(alternativo|chino|taiwanes|taiwan|coreano|japones)\b/i.test(fuente)) {
      fabricante = 'ALTERNATIVO';
      tieneMarcaExplicita = true;
    } else {
      fabricante = tieneStock ? 'ALTERNATIVO' : 'SIN STOCK';
    }
  }

  // 5. Detectar origen del repuesto
  let origen = String(origenManual || datosMultimodalesIa?.origen || '')
    .trim()
    .toUpperCase();
  let tieneOrigenExplicito = Boolean(origen && origen !== 'IMPORTACIÓN');
  if (!origen) {
    const matchOrigen = ORIGENES_MAP.find((o) => o.regex.test(fuente));
    if (matchOrigen) {
      origen = matchOrigen.valor;
      tieneOrigenExplicito = true;
    } else {
      origen = tieneStock ? 'IMPORTACIÓN' : 'NO DISPONIBLE';
    }
  }

  // 6. Detectar disponibilidad / cuándo lo tiene listo para retiro si lo pagamos
  let disponibilidad = String(disponibilidadManual || datosMultimodalesIa?.disponibilidad || '').trim();
  let tieneTiempoRetiroExplicito = Boolean(disponibilidad && disponibilidad !== 'Por confirmar retiro');
  if (!disponibilidad) {
    if (!tieneStock) {
      disponibilidad = 'Sin stock disponible';
      tieneTiempoRetiroExplicito = true;
    } else if (
      /\b(inmediat[ao]|en\s+meson|en\s+mesón|retiro\s+inmediato|ahora\s+mismo|disponible\s+aca|lo\s+tengo\s+aca|para\s+retirar\s+ahora|llegar\s+y\s+llevar|en\s+local|en\s+tienda)\b/i.test(
        lower
      )
    ) {
      disponibilidad = 'Entrega inmediata en mesón';
      tieneTiempoRetiroExplicito = true;
    } else if (/\b(hoy|esta\s+tarde|en\s+\d+\s*(?:hora|hr|min)|mediodia|medio\s+dia)\b/i.test(lower)) {
      disponibilidad = 'Disponible hoy para retiro';
      tieneTiempoRetiroExplicito = true;
    } else if (/\b(mañana|manana|24\s*h|24\s*horas|bodega)\b/i.test(lower)) {
      disponibilidad = 'Disponible en 24 hrs';
      tieneTiempoRetiroExplicito = true;
    } else if (/\b(48\s*h|2\s*dias|dos\s*dias)\b/i.test(lower)) {
      disponibilidad = 'Pedido 48 hrs';
      tieneTiempoRetiroExplicito = true;
    } else {
      disponibilidad = 'Por confirmar retiro';
    }
  }

  // Si NO tiene stock, jamás pedir precio, IVA ni marca
  const faltantesCotizacion = [];
  if (tieneStock) {
    if (precioCostoNeto <= 0) {
      faltantesCotizacion.push('precio');
    } else if (!tieneIvaExplicito) {
      faltantesCotizacion.push('iva');
    }
    if (!tieneMarcaExplicita && !tieneOrigenExplicito) {
      faltantesCotizacion.push('marca_origen');
    }
    if (!tieneTiempoRetiroExplicito) {
      faltantesCotizacion.push('tiempo_retiro');
    }
  }

  let preguntaSeguimientoProveedor = null;
  if (tieneStock && faltantesCotizacion.length > 0) {
    const preguntas = [];
    if (faltantesCotizacion.includes('precio')) {
      preguntas.push('¿a qué precio lo tienes y si es más IVA o con IVA?');
    } else if (faltantesCotizacion.includes('iva')) {
      preguntas.push('¿ese valor es más IVA o con IVA incluido?');
    }
    if (faltantesCotizacion.includes('marca_origen')) {
      preguntas.push('¿qué marca u origen es?');
    }
    if (faltantesCotizacion.includes('tiempo_retiro')) {
      preguntas.push('¿cuándo lo tienes listo para retiro si te lo pagamos?');
    }
    preguntaSeguimientoProveedor = `Gracias estimado, ${preguntas.join(' ¿Y ').replace(/\?\s*¿Y\s+/g, ', ')}`;
  }

  const ofertaCompleta = tieneStock && precioCostoNeto > 0 && faltantesCotizacion.length === 0;
  const precioVentaFrpNeto =
    tieneStock && precioCostoNeto > 0 ? Math.round(precioCostoNeto * (1 + (Number(margenPct) || 30) / 100)) : 0;
  const precioVentaFrpConIva = precioVentaFrpNeto > 0 ? Math.round(precioVentaFrpNeto * 1.19) : 0;

  // 7. Construir Resumen Formal Ejecutivo (`resumenFormalIa`) de lo enviado por el proveedor
  const resumenFormalIa = construirResumenFormalProveedorIa({
    proveedorNombre,
    repuestoBuscado,
    vehiculoStr,
    tieneStock,
    ofertaCompleta,
    precioCostoNeto,
    precioVentaFrpNeto,
    precioVentaFrpConIva,
    margenPct: Number(margenPct) || 30,
    fabricante,
    origen,
    disponibilidad,
    codigoOemDetectado: oemEfectivo,
    mensajeOriginal: ultimoTextoEvaluar || mensajeTexto,
    transcripcionAudio: audioEfectivo,
    lecturaImagenIa: lecturaImgEfectiva,
    faltantesCotizacion,
    resumenGemini: datosMultimodalesIa?.resumenFormalIa || '',
  });

  // 8. Nivel de confianza del parser
  let confianzaIa = !tieneStock ? 0.99 : 0.72;
  if (tieneStock && precioCostoNeto > 0 && faltantesCotizacion.length === 0) confianzaIa = 0.98;
  else if (tieneStock && precioCostoNeto > 0) confianzaIa = 0.85;

  return {
    tieneStock,
    esSinStock,
    precioCostoNeto,
    mencionaConIva,
    tieneIvaExplicito,
    tieneMarcaUOrigenExplicito: tieneMarcaExplicita || tieneOrigenExplicito,
    tieneTiempoRetiroExplicito,
    faltantesCotizacion,
    ofertaCompleta,
    preguntaSeguimientoProveedor,
    mensajeCierreSinStockProveedor: !tieneStock
      ? 'Muchas gracias por avisar estimado, quedamos atentos para la próxima.'
      : null,
    fabricante,
    origen,
    disponibilidad,
    transcripcionAudio: audioEfectivo,
    lecturaImagenIa: lecturaImgEfectiva,
    codigoOemDetectado: oemEfectivo,
    resumenFormalIa,
    confianzaIa,
  };
}

/**
 * Construye el mensaje natural de WhatsApp que el agente cotizador envía a los proveedores desde el +56950960294.
 */
export function construirMensajeSalidaWsp({
  marcaVehiculo,
  modeloVehiculo,
  anioVehiculo,
  motorVehiculo,
  patente,
  vin,
  repuestoBuscado,
  codigoReferencia,
}) {
  const repuestoNatural = String(repuestoBuscado || 'repuesto')
    .trim()
    .toLowerCase();
  const formatTitulo = (s) =>
    String(s || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');

  const vehiculoStr = [
    formatTitulo(marcaVehiculo),
    String(modeloVehiculo || '').trim().toUpperCase(),
    anioVehiculo,
    motorVehiculo,
  ]
    .filter(Boolean)
    .join(' ');

  const datosExtra = [
    patente ? `patente ${String(patente).trim().toUpperCase()}` : '',
    vin ? `VIN ${String(vin).trim().toUpperCase()}` : '',
    codigoReferencia ? `código ${String(codigoReferencia).trim().toUpperCase()}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    `Estimado,\n` +
    `Necesito ${repuestoNatural} para ${vehiculoStr || 'vehículo en consulta'}${
      datosExtra ? ` ${datosExtra}` : ''
    }, compárteme por favor las opciones que tengas con stock disponible y precio.`
  );
}

/**
 * Envía el mensaje por Meta WhatsApp Cloud API si existen `META_WA_TOKEN` y `META_WA_PHONE_ID`.
 * Si no están configurados en `.env`, opera en modo simulación local conservando la trazabilidad completa.
 */
async function enviarMensajeMetaWhatsApp({ telefono, textoMensaje, codigoSolicitud }) {
  const cfg = await obtenerConfigMetaWhatsapp();
  const token = cfg.accessToken || process.env.META_WA_TOKEN;
  // Usar prioritariamente el Phone Number ID exclusivo del nuevo número de Mesa de Abastecimiento (+56950960294)
  const phoneId =
    cfg.phoneNumberIdMesaB2b ||
    process.env.META_WA_MESA_PHONE_ID ||
    cfg.phoneNumberId ||
    process.env.META_WA_PHONE_ID;
  const telLimpio = String(telefono || '').replace(/[^\d]/g, '');

  if (token && phoneId && telLimpio.length >= 8) {
    try {
      const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: telLimpio,
          type: 'text',
          text: { preview_url: false, body: textoMensaje },
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        return {
          enviadoReal: true,
          modoEnvio: 'meta_cloud_api_live',
          metaMessageId: data?.messages?.[0]?.id || `wamid.${Date.now()}`,
          enviadoEn: new Date().toISOString(),
        };
      }
      return {
        enviadoReal: false,
        modoEnvio: 'meta_cloud_api_fallback',
        errorMeta: data?.error?.message || `HTTP ${resp.status}`,
        metaMessageId: `sim_wamid_${codigoSolicitud}_${Date.now()}`,
        enviadoEn: new Date().toISOString(),
      };
    } catch (err) {
      return {
        enviadoReal: false,
        modoEnvio: 'meta_cloud_api_fallback',
        errorMeta: err.message,
        metaMessageId: `sim_wamid_${codigoSolicitud}_${Date.now()}`,
        enviadoEn: new Date().toISOString(),
      };
    }
  }

  return {
    enviadoReal: false,
    modoEnvio: 'simulacion_meta_local',
    metaMessageId: `sim_wamid_${codigoSolicitud}_${Date.now()}_${Math.floor(Math.random() * 999)}`,
    enviadoEn: new Date().toISOString(),
  };
}

const PROVEEDORES_DEMO_ELIMINAR = new Set([
  'prov-wsp-corea-01',
  'prov-wsp-nippon-02',
  'prov-wsp-euro-03',
]);
const CORTE_LIMPIEZA_MESA_WSP_ISO = '2026-11-17T03:05:00.000Z';

/**
 * Mantiene únicamente los nodos Enterprise Ailoo (con `canalWspActivo: false`) y elimina
 * cualquier proveedor ficticio de prueba de WhatsApp (`prov-wsp-corea-01`, `prov-wsp-nippon-02`, `prov-wsp-euro-03`).
 */
export async function asegurarProveedoresWspDemo() {
  try {
    const snap = await db.collection(COLECCION_PROVEEDORES).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (
        PROVEEDORES_DEMO_ELIMINAR.has(doc.id) ||
        ['76.512.890-4', '77.219.440-K', '78.901.332-1'].includes(String(data.rut || ''))
      ) {
        await doc.ref.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[MesaWsp] Aviso limpiando proveedores demo:', err.message);
  }
}

/**
 * Purga solicitudes de prueba/demo anteriores al corte de producción para dejar la Mesa WSP en 0.
 */
async function limpiarDatosPruebaMesaWsp() {
  await asegurarProveedoresWspDemo();
  try {
    const snap = await db.collection(COLECCION_SOLICITUDES_WSP).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const fechaDoc = String(data.createdAt || data.updatedAt || '');
      const tieneContactoDemo = Array.isArray(data.proveedoresContactados) &&
        data.proveedoresContactados.some((c) => PROVEEDORES_DEMO_ELIMINAR.has(c?.proveedorId));
      if (
        doc.id === 'wsp-demo-porter-4821' ||
        data.codigoSolicitud === 'WSP-4821' ||
        tieneContactoDemo ||
        !fechaDoc ||
        fechaDoc < CORTE_LIMPIEZA_MESA_WSP_ISO
      ) {
        await doc.ref.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[MesaWsp] Aviso limpiando solicitudes demo:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mesa-wsp/solicitudes
// Lista todas las solicitudes de cotización por WhatsApp y los proveedores reales con WhatsApp
// ─────────────────────────────────────────────────────────────────────────────
router.get('/solicitudes', requireAuth, async (req, res, next) => {
  try {
    await limpiarDatosPruebaMesaWsp();

    const [solSnap, provSnap] = await Promise.all([
      db.collection(COLECCION_SOLICITUDES_WSP).get(),
      db.collection(COLECCION_PROVEEDORES).get(),
    ]);

    const solicitudes = solSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const proveedoresWsp = provSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (p) =>
          Boolean(p.telefono) &&
          p.canalWspActivo === true &&
          !PROVEEDORES_DEMO_ELIMINAR.has(p.id)
      )
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

    const cfgMeta = await obtenerConfigMetaWhatsapp();
    const credencialesMetaActivas = Boolean(
      (cfgMeta.accessToken || process.env.META_WA_TOKEN) &&
        (cfgMeta.phoneNumberIdMesaB2b || cfgMeta.phoneNumberId || process.env.META_WA_PHONE_ID)
    );

    res.json({
      success: true,
      data: {
        credencialesMetaActivas,
        numeroMesaAbastecimiento: `+${cfgMeta.numeroMesaB2b || '56950960294'}`,
        phoneNumberIdMesaB2b: cfgMeta.phoneNumberIdMesaB2b || '',
        numeroRepuestinClientes: `+${cfgMeta.numeroPublico || '56921109851'}`,
        phoneNumberIdRepuestin: cfgMeta.phoneNumberId || '',
        wabaId: cfgMeta.wabaId || '',
        modoOperacionMeta: credencialesMetaActivas
          ? 'meta_cloud_api_live'
          : 'simulacion_meta_local',
        solicitudes,
        proveedoresWsp,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET y PUT /api/mesa-wsp/agentes-config
// Permite ver y editar desde `sistema.facilrepuestos.cl` (sin entrar a Cloud Run)
// el modelo IA (`gemini-4.0-neon`), instrucciones, reglas y contexto de los 6 Subagentes + Orquestador
// ─────────────────────────────────────────────────────────────────────────────
router.get('/agentes-config', requireAuth, async (req, res, next) => {
  try {
    const config = await obtenerConfiguracionAgentesIA({ forceRefresh: true });
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

router.put('/agentes-config', requireAuth, async (req, res, next) => {
  try {
    const actualizado = await guardarConfiguracionAgentesIA(req.body || {});
    res.json({ success: true, data: actualizado });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/config-numero-mesa
// Guarda el Phone Number ID de Meta para el número +56950960294 o lo auto-detecta en el WABA
// ─────────────────────────────────────────────────────────────────────────────
router.post('/config-numero-mesa', requireAuth, async (req, res, next) => {
  try {
    const { phoneNumberIdMesaB2b = '', numeroMesaB2b = '56950960294' } = req.body || {};
    const cfg = await obtenerConfigMetaWhatsapp({ forceRefresh: true });
    let idFinal = String(phoneNumberIdMesaB2b || '').trim();
    let numerosEnWaba = [];

    if (cfg.accessToken && cfg.wabaId) {
      const rNums = await fetch(
        `https://graph.facebook.com/${cfg.graphVersion || 'v21.0'}/${cfg.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status`,
        { headers: { Authorization: `Bearer ${cfg.accessToken}` } }
      ).catch(() => null);
      if (rNums && rNums.ok) {
        const dNums = await rNums.json();
        numerosEnWaba = Array.isArray(dNums?.data) ? dNums.data : [];
        if (!idFinal) {
          const limp = String(numeroMesaB2b).replace(/\D/g, '').slice(-8);
          const encontrado = numerosEnWaba.find((n) =>
            String(n.display_phone_number || '').replace(/\D/g, '').endsWith(limp)
          );
          if (encontrado?.id) {
            idFinal = String(encontrado.id);
          }
        }
      }
    }

    if (idFinal) {
      await db
        .collection('configuracion_sistema')
        .doc('whatsapp_meta')
        .set(
          {
            phoneNumberIdMesaB2b: idFinal,
            numeroMesaB2b: String(numeroMesaB2b).replace(/\D/g, '') || '56950960294',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
    }

    await obtenerConfigMetaWhatsapp({ forceRefresh: true });

    res.json({
      success: true,
      data: {
        phoneNumberIdMesaB2b: idFinal,
        numeroMesaB2b: String(numeroMesaB2b).replace(/\D/g, '') || '56950960294',
        numerosRegistradosEnMetaWaba: numerosEnWaba,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/probar-envio
// Dispara una solicitud de cotización de prueba en vivo al número indicado (ej. +56951387986)
// y deja creada la solicitud abierta para que al responder desde tu WhatsApp personal
// el Agente 4 cree automáticamente el Producto Temporal (4h) en WordPress.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/probar-envio', requireAuth, async (req, res, next) => {
  try {
    const {
      telefonoPrueba = '+56951387986',
      marcaVehiculo = 'JAC',
      modeloVehiculo = 'S3',
      anioVehiculo = 2019,
      patente = 'LKWP42',
      repuestoBuscado = 'RADIADOR DE AGUA',
      categoriaRepuesto = 'Refrigeración y Climatización',
    } = req.body || {};

    const telLimpio = `+${String(telefonoPrueba || '+56951387986').replace(/\D/g, '')}`;
    const codigoSolicitud = generarCodigoSolicitud();
    const now = new Date().toISOString();

    const mensajeEnviado = construirMensajeSalidaWsp({
      codigoSolicitud,
      nombreProveedor: 'Prueba Personal Abastecimiento',
      marcaVehiculo,
      modeloVehiculo,
      anioVehiculo,
      motorVehiculo: '1.6',
      patente,
      vin: '',
      repuestoBuscado,
      codigoReferencia: '',
      notasAdicionales: 'Prueba en vivo de Mesa de Abastecimiento -> Responde ej: "Sí lo tengo a 55 mil neto entrega inmediata" para probar la subida temporal de 4h a WordPress.',
    });

    const resMeta = await enviarMensajeMetaWhatsApp({
      telefono: telLimpio,
      textoMensaje: mensajeEnviado,
      codigoSolicitud,
    });

    const nuevaSolicitud = {
      codigoSolicitud,
      estado: 'esperando_respuestas',
      canalCliente: 'whatsapp',
      clienteNombre: 'Prueba Directa Usuario (+56951387986)',
      clienteTelefono: telLimpio,
      clienteTelefonoReal: telLimpio,
      comunaCliente: 'La Florida',
      patente,
      vin: '',
      marcaVehiculo,
      modeloVehiculo,
      anioVehiculo: Number(anioVehiculo) || 2019,
      motorVehiculo: '1.6',
      categoriaRepuesto,
      repuestoBuscado,
      codigoReferencia: '',
      notasAdicionales: 'Prueba de circuito completo Agente 4 (Mesa WSP -> Producto Temporal 4h en WordPress -> Link de tienda)',
      margenPct: 30,
      escalamientoOrigenId: null,
      proveedoresContactados: [
        {
          proveedorId: 'prov-prueba-personal',
          proveedorNombre: `Mi WhatsApp Personal (${telLimpio})`,
          contacto: 'Prueba Directa',
          telefono: telLimpio,
          especialidadMarcas: [marcaVehiculo],
          estadoContacto: 'enviado',
          modoEnvio: resMeta.modoEnvio,
          metaMessageId: resMeta.metaMessageId,
          errorMeta: resMeta.errorMeta || null,
          mensajeEnviado,
          enviadoEn: resMeta.enviadoEn,
          respondidoEn: null,
        },
      ],
      ofertasRecibidas: [],
      ofertaGanadoraId: null,
      skuPublicoGenerado: null,
      inventarioCreadoId: null,
      conocimientoCreadoId: null,
      mensajeCotizacionCliente: '',
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection(COLECCION_SOLICITUDES_WSP).add(nuevaSolicitud);

    res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        ...nuevaSolicitud,
        resultadoEnvioMeta: resMeta,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/proveedores
// Crea un nuevo proveedor real con WhatsApp activo directamente desde la Mesa WSP
// ─────────────────────────────────────────────────────────────────────────────
router.post('/proveedores', requireAuth, async (req, res, next) => {
  try {
    const {
      nombre = '',
      telefono = '',
      contacto = '',
      categoria = 'General',
      marcas = [],
      margenPct = 30,
      direccion = '',
      notas = '',
    } = req.body || {};

    if (!String(nombre).trim() || !String(telefono).trim()) {
      return res.status(400).json({
        success: false,
        error: 'El nombre del proveedor y su teléfono de WhatsApp son obligatorios',
      });
    }

    const telLimpio = String(telefono).trim().startsWith('+')
      ? String(telefono).trim()
      : `+${String(telefono).replace(/[^\d]/g, '')}`;

    const marcasLimpias = (Array.isArray(marcas) ? marcas : String(marcas || '').split(','))
      .map((m) => String(m || '').trim().toUpperCase())
      .filter(Boolean);

    const now = new Date().toISOString();
    const nuevoProv = {
      nombre: String(nombre).trim(),
      telefono: telLimpio,
      contacto: String(contacto || 'Ventas WhatsApp').trim(),
      categoria: String(categoria || 'General').trim(),
      categoriasEspecialidad: [String(categoria || 'General').trim()],
      marcas: marcasLimpias,
      marcasVehiculo: marcasLimpias,
      direccion: String(direccion || '').trim(),
      notas: String(notas || '').trim(),
      tipoIntegracion: 'cotizacion_whatsapp',
      canalWspActivo: true,
      margenPct: Number(margenPct) || 30,
      prefijoSku: 'FRP-WSP',
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection(COLECCION_PROVEEDORES).add(nuevoProv);
    res.status(201).json({
      success: true,
      data: { id: docRef.id, ...nuevoProv },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/mesa-wsp/proveedores/:id
// Elimina o desactiva un proveedor WhatsApp desde la Mesa de Abastecimiento
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/proveedores/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.collection(COLECCION_PROVEEDORES).doc(id).delete();
    res.json({ success: true, deletedId: id });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/mesa-wsp/solicitudes/:id
// Elimina una solicitud específica de la Mesa de Abastecimiento WSP
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/solicitudes/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.collection(COLECCION_SOLICITUDES_WSP).doc(id).delete();
    res.json({ success: true, deletedId: id });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/limpiar
// Lleva a 0 todas las solicitudes de la Mesa de Abastecimiento WSP
// ─────────────────────────────────────────────────────────────────────────────
router.post('/limpiar', requireAuth, async (req, res, next) => {
  try {
    const snap = await db.collection(COLECCION_SOLICITUDES_WSP).get();
    let eliminadas = 0;
    for (const doc of snap.docs) {
      await doc.ref.delete();
      eliminadas++;
    }
    await asegurarProveedoresWspDemo();
    res.json({ success: true, data: { eliminadas } });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/solicitudes
// Dispara una nueva cotización multidifusión por WhatsApp a proveedores seleccionados
// o filtrados automáticamente por marca de vehículo y especialidad.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/solicitudes', requireAuth, async (req, res, next) => {
  try {
    await asegurarProveedoresWspDemo();

    const {
      canalCliente = 'whatsapp',
      clienteNombre = 'Cliente Mostrador / WhatsApp',
      clienteTelefono = '',
      patente = '',
      vin = '',
      marcaVehiculo = '',
      modeloVehiculo = '',
      anioVehiculo = null,
      motorVehiculo = '',
      categoriaRepuesto = 'General',
      repuestoBuscado = '',
      codigoReferencia = '',
      notasAdicionales = '',
      margenPct = 30,
      proveedorIds = [],
      escalamientoOrigenId = null,
    } = req.body || {};

    if (!String(repuestoBuscado).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Debes indicar el repuesto que necesitas cotizar por WhatsApp',
      });
    }

    const provSnap = await db.collection(COLECCION_PROVEEDORES).get();
    const todosProveedores = provSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (p) =>
          Boolean(p.telefono) &&
          p.canalWspActivo === true &&
          !PROVEEDORES_DEMO_ELIMINAR.has(p.id)
      );

    const marcaUpper = String(marcaVehiculo || '').trim().toUpperCase();
    const catUpper = String(categoriaRepuesto || '').trim().toUpperCase();

    // Si el usuario seleccionó proveedores específicos, usarlos; si no, Agente 4 selecciona el TOP 3 por marca, categoría y cercanía
    let seleccionados = [];
    if (Array.isArray(proveedorIds) && proveedorIds.length > 0) {
      seleccionados = todosProveedores.filter((p) => proveedorIds.includes(p.id));
    } else {
      seleccionados = seleccionarTop3ProveedoresMesaWsp({
        proveedores: todosProveedores,
        marcaVehiculo: marcaUpper,
        categoriaRepuesto: catUpper,
      });
    }

    const codigoSolicitud = generarCodigoSolicitud();
    const now = new Date().toISOString();

    const proveedoresContactados = [];
    for (const prov of seleccionados) {
      const mensajeEnviado = construirMensajeSalidaWsp({
        codigoSolicitud,
        nombreProveedor: prov.nombre,
        marcaVehiculo: marcaUpper,
        modeloVehiculo: String(modeloVehiculo || '').trim().toUpperCase(),
        anioVehiculo,
        motorVehiculo,
        patente: String(patente || '').trim().toUpperCase(),
        vin: String(vin || '').trim().toUpperCase(),
        repuestoBuscado: String(repuestoBuscado).trim(),
        codigoReferencia: String(codigoReferencia || '').trim().toUpperCase(),
        notasAdicionales,
      });

      const resMeta = await enviarMensajeMetaWhatsApp({
        telefono: prov.telefono,
        textoMensaje: mensajeEnviado,
        codigoSolicitud,
      });

      proveedoresContactados.push({
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        contacto: prov.contacto || 'Ventas WhatsApp',
        telefono: prov.telefono,
        especialidadMarcas: prov.marcas || [],
        estadoContacto: 'enviado',
        modoEnvio: resMeta.modoEnvio,
        metaMessageId: resMeta.metaMessageId,
        mensajeEnviado,
        enviadoEn: resMeta.enviadoEn,
        respondidoEn: null,
      });
    }

    const nuevaSolicitud = {
      codigoSolicitud,
      estado: 'esperando_respuestas',
      canalCliente,
      clienteNombre,
      clienteTelefono,
      patente: String(patente || '').trim().toUpperCase(),
      vin: String(vin || '').trim().toUpperCase(),
      marcaVehiculo: marcaUpper,
      modeloVehiculo: String(modeloVehiculo || '').trim().toUpperCase(),
      anioVehiculo: anioVehiculo ? Number(anioVehiculo) : null,
      motorVehiculo: String(motorVehiculo || '').trim(),
      categoriaRepuesto: String(categoriaRepuesto || 'General').trim(),
      repuestoBuscado: String(repuestoBuscado).trim().toUpperCase(),
      codigoReferencia: String(codigoReferencia || '').trim().toUpperCase(),
      notasAdicionales: String(notasAdicionales || '').trim(),
      margenPct: Number(margenPct) || 30,
      escalamientoOrigenId: escalamientoOrigenId || null,
      proveedoresContactados,
      ofertasRecibidas: [],
      ofertaGanadoraId: null,
      skuPublicoGenerado: null,
      inventarioCreadoId: null,
      conocimientoCreadoId: null,
      mensajeCotizacionCliente: '',
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection(COLECCION_SOLICITUDES_WSP).add(nuevaSolicitud);

    res.status(201).json({
      success: true,
      data: { id: docRef.id, ...nuevaSolicitud },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/solicitudes/:id/respuesta
// Recibe una respuesta en vivo de un proveedor por WhatsApp (con texto, audio y/o foto),
// ejecuta el extractor inteligente de ofertas y calcula el precio de venta FácilRepuestos.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/solicitudes/:id/respuesta', requireAuth, async (req, res, next) => {
  try {
    const solRef = db.collection(COLECCION_SOLICITUDES_WSP).doc(req.params.id);
    const solSnap = await solRef.get();
    if (!solSnap.exists) {
      return res.status(404).json({ success: false, error: 'Solicitud WhatsApp no encontrada' });
    }

    const solicitud = { id: solSnap.id, ...solSnap.data() };
    const {
      proveedorId = '',
      mensajeOriginalWsp = '',
      transcripcionAudio = '',
      audioDataUrl = '',
      fotoUrl = '',
      imagenDataUrl = '',
      precioManualNeto = null,
      fabricanteManual = '',
      origenManual = '',
      disponibilidadManual = '',
      sinStockExplicito = false,
      garantia = '6 meses',
    } = req.body || {};

    if (
      !mensajeOriginalWsp.trim() &&
      !transcripcionAudio.trim() &&
      !audioDataUrl &&
      !fotoUrl.trim() &&
      !imagenDataUrl &&
      !precioManualNeto &&
      !sinStockExplicito
    ) {
      return res.status(400).json({
        success: false,
        error: 'Ingresa el mensaje de WhatsApp del proveedor, audio, imagen o estado de stock',
      });
    }

    // Identificar proveedor dentro de los contactados o en la colección de proveedores
    let provInfo = (solicitud.proveedoresContactados || []).find(
      (p) => p.proveedorId === proveedorId
    );
    if (!provInfo && proveedorId) {
      const pDoc = await db.collection(COLECCION_PROVEEDORES).doc(proveedorId).get();
      if (pDoc.exists) {
        const pd = pDoc.data();
        provInfo = {
          proveedorId: pDoc.id,
          proveedorNombre: pd.nombre,
          telefono: pd.telefono || '',
        };
      }
    }
    if (!provInfo) {
      provInfo = solicitud.proveedoresContactados?.[0] || {
        proveedorId: 'prov-wsp-ext',
        proveedorNombre: 'Proveedor Externo WhatsApp',
        telefono: '+56900000000',
      };
    }

    // Acumular con respuesta previa del mismo proveedor si venía en conversación multi-turno
    const prevOfertaProv = [...(solicitud.ofertasRecibidas || [])]
      .reverse()
      .find((o) => o.proveedorId === provInfo.proveedorId);

    const esNegativaDirecta =
      Boolean(sinStockExplicito) || detectarProveedorSinStock(mensajeOriginalWsp || transcripcionAudio);

    const textoAcumuladoProv =
      !esNegativaDirecta && prevOfertaProv?.mensajeOriginalWsp && mensajeOriginalWsp
        ? `${prevOfertaProv.mensajeOriginalWsp} . ${mensajeOriginalWsp}`
        : mensajeOriginalWsp || (sinStockExplicito ? 'Sin stock disponible en bodega' : '');
    const turnosReconsultaPrevios = Number(prevOfertaProv?.turnosReconsulta || 0);

    const vehiculoStr = [
      solicitud.marcaVehiculo,
      solicitud.modeloVehiculo,
      solicitud.anioVehiculo,
      solicitud.motorVehiculo,
    ]
      .filter(Boolean)
      .join(' ');

    const imagenEfectivaUrl = String(imagenDataUrl || fotoUrl || prevOfertaProv?.fotoUrl || '').trim();

    // Analizar imagen, audio y texto con Gemini Multimodal (Agente 4)
    const datosMultimodalesIa = await analizarRespuestaMultimodalProveedorAgente4({
      mensajeTexto: textoAcumuladoProv,
      transcripcionAudioManual: transcripcionAudio || prevOfertaProv?.transcripcionAudio || '',
      audioDataUrl,
      imagenUrl: imagenEfectivaUrl,
      repuestoBuscado: solicitud.repuestoBuscado,
      vehiculoStr,
      proveedorNombre: provInfo.proveedorNombre,
    });

    const margenPct = Number(solicitud.margenPct) || 30;
    const extraido = extraerOfertaDesdeMensajeWsp({
      mensajeTexto: textoAcumuladoProv,
      mensajeUltimoTurno: mensajeOriginalWsp,
      transcripcionAudio: datosMultimodalesIa?.transcripcionAudio || transcripcionAudio || prevOfertaProv?.transcripcionAudio || '',
      lecturaImagenIa: datosMultimodalesIa?.lecturaImagenIa || prevOfertaProv?.lecturaImagenIa || '',
      codigoOemDetectado: datosMultimodalesIa?.codigoOemDetectado || prevOfertaProv?.codigoOemDetectado || '',
      precioManualNeto,
      fabricanteManual,
      origenManual,
      disponibilidadManual,
      sinStockExplicito,
      datosMultimodalesIa,
      proveedorNombre: provInfo.proveedorNombre,
      repuestoBuscado: solicitud.repuestoBuscado,
      vehiculoStr,
      margenPct,
    });

    const precioCostoNeto = extraido.precioCostoNeto;
    const precioVentaFrpNeto =
      extraido.tieneStock && precioCostoNeto > 0
        ? Math.round(precioCostoNeto * (1 + margenPct / 100))
        : 0;
    const precioVentaFrpConIva =
      precioVentaFrpNeto > 0 ? Math.round(precioVentaFrpNeto * 1.19) : 0;

    const now = new Date().toISOString();
    const nuevaOferta = {
      id: prevOfertaProv?.id || `of-wsp-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      proveedorId: provInfo.proveedorId,
      proveedorNombre: provInfo.proveedorNombre,
      telefonoProveedor: provInfo.telefono || '',
      mensajeOriginalWsp: String(
        textoAcumuladoProv || extraido.transcripcionAudio || (extraido.tieneStock ? 'Adjunto multimedia recibido' : 'Sin stock disponible')
      ).trim(),
      transcripcionAudio: extraido.transcripcionAudio || '',
      lecturaImagenIa: extraido.lecturaImagenIa || '',
      codigoOemDetectado: extraido.codigoOemDetectado || '',
      resumenFormalIa: extraido.resumenFormalIa || '',
      fotoUrl: imagenEfectivaUrl,
      tieneStock: extraido.tieneStock,
      fabricante: extraido.fabricante,
      origen: extraido.origen,
      disponibilidad: extraido.disponibilidad,
      garantia: String(garantia || '6 meses').trim(),
      precioCostoNeto,
      margenAplicadoPct: margenPct,
      precioVentaFrpNeto,
      precioVentaFrpConIva,
      confianzaIa: extraido.confianzaIa,
      ofertaCompleta: extraido.ofertaCompleta,
      faltantesCotizacion: extraido.faltantesCotizacion || [],
      preguntaSeguimientoProveedor: extraido.preguntaSeguimientoProveedor || null,
      turnosReconsulta: extraido.tieneStock ? turnosReconsultaPrevios + (extraido.ofertaCompleta ? 0 : 1) : 0,
      ganadora: false,
      recibidoEn: now,
    };

    const ofertasSinPrev = (solicitud.ofertasRecibidas || []).filter((o) => o.id !== nuevaOferta.id);
    const ofertasActualizadas = [...ofertasSinPrev, nuevaOferta];

    const resumenFormalMesaIa = construirResumenEjecutivoSolicitudIa({
      codigoSolicitud: solicitud.codigoSolicitud,
      repuestoBuscado: solicitud.repuestoBuscado,
      vehiculoStr,
      proveedoresContactados: solicitud.proveedoresContactados,
      ofertasRecibidas: ofertasActualizadas,
    });

    // Si faltan datos clave (¿es más IVA?, marca/origen o cuándo está listo para retiro) y aún no superamos 2 repreguntas,
    // el Agente Cotizador le repregunta al proveedor por WhatsApp antes de publicar en WordPress.
    if (
      extraido.tieneStock &&
      !extraido.ofertaCompleta &&
      extraido.preguntaSeguimientoProveedor &&
      turnosReconsultaPrevios < 2 &&
      provInfo.telefono
    ) {
      await enviarMensajeMetaWhatsApp({
        telefono: provInfo.telefono,
        textoMensaje: extraido.preguntaSeguimientoProveedor,
        codigoSolicitud: solicitud.codigoSolicitud,
      }).catch(() => null);

      await solRef.update({
        ofertasRecibidas: ofertasActualizadas,
        resumenFormalMesaIa,
        updatedAt: now,
      });

      return res.json({
        success: true,
        data: {
          oferta: nuevaOferta,
          reconsultaEnviadaAProveedor: extraido.preguntaSeguimientoProveedor,
          faltantesCotizacion: extraido.faltantesCotizacion,
          solicitud: {
            ...solicitud,
            ofertasRecibidas: ofertasActualizadas,
            resumenFormalMesaIa,
            updatedAt: now,
          },
        },
      });
    }

    // Si el proveedor informó que NO tiene stock, agradecerle con cortesía sin hacerle más preguntas
    if (!extraido.tieneStock && extraido.mensajeCierreSinStockProveedor && provInfo.telefono) {
      await enviarMensajeMetaWhatsApp({
        telefono: provInfo.telefono,
        textoMensaje: extraido.mensajeCierreSinStockProveedor,
        codigoSolicitud: solicitud.codigoSolicitud,
      }).catch(() => null);
    }

    const contactosActualizados = (solicitud.proveedoresContactados || []).map((c) =>
      c.proveedorId === provInfo.proveedorId
        ? {
            ...c,
            estadoContacto: extraido.tieneStock ? 'respondido' : 'sin_stock',
            respondidoEn: now,
          }
        : c
    );

    const todosSinStock =
      contactosActualizados.length > 0 &&
      contactosActualizados.every((c) => c.estadoContacto === 'sin_stock');

    const nuevoEstado =
      solicitud.estado === 'adjudicada'
        ? 'adjudicada'
        : ofertasActualizadas.some((o) => o.tieneStock && o.precioCostoNeto > 0)
        ? 'con_ofertas'
        : 'esperando_respuestas';

    // Agente 4: Selección automática de la mejor alternativa, creación del Producto Temporal (4h) en Firebase + WordPress
    // con foto referencial y envío directo del link de la tienda al WhatsApp del cliente (< 24h)
    let publicacionTemporal = null;
    const mejorOferta = elegirMejorOfertaMesaWsp(ofertasActualizadas);
    let ofertasFinales = ofertasActualizadas;
    let estadoFinal = nuevoEstado;
    const updatePayload = {
      ofertasRecibidas: ofertasActualizadas,
      proveedoresContactados: contactosActualizados,
      resumenFormalMesaIa,
      estado: nuevoEstado,
      updatedAt: now,
    };

    // Si TODOS los proveedores contactados confirmaron NO tener stock, avisar amablemente al cliente en espera
    if (todosSinStock && !mejorOferta && solicitud.estado !== 'adjudicada') {
      const msgClienteSinStock = `Hola 👋 Te comentamos que consultamos con nuestros proveedores locales por el **${solicitud.repuestoBuscado}** para tu **${vehiculoStr}** y en este momento ninguno cuenta con stock disponible. Si necesitas cotizar otro repuesto para tu vehículo me avisas por aquí.`;
      updatePayload.mensajeCotizacionCliente = msgClienteSinStock;
      let telCliente = String(solicitud.clienteTelefonoReal || solicitud.clienteTelefono || '').trim();
      if (solicitud.sesionAgenteId) {
        const sesRef = db.collection('sesiones_agente_omnicanal').doc(solicitud.sesionAgenteId);
        const sesSnap = await sesRef.get().catch(() => null);
        if (sesSnap?.exists) {
          const sesData = sesSnap.data() || {};
          if ((!telCliente || telCliente === 'CONFIDENCIAL-FRP') && sesData.clienteTelefono) {
            telCliente = String(sesData.clienteTelefono).trim();
          }
          const mensajes = Array.isArray(sesData.mensajes) ? [...sesData.mensajes] : [];
          mensajes.push({
            id: `msg-wsp-sinstock-${Date.now()}`,
            rol: 'agente',
            autor: 'Repuestín · facilrepuestos.cl',
            texto: msgClienteSinStock,
            creadoEn: now,
            origen: 'mesa_wsp_sin_stock_confirmado',
          });
          await sesRef.update({ mensajes, updatedAt: now });
        }
      }
      if (telCliente && /\d{8,15}/.test(telCliente.replace(/\D/g, ''))) {
        await enviarRespuestaClienteMetaWhatsapp({
          telefonoDestino: telCliente,
          texto: msgClienteSinStock,
        }).catch(() => null);
      }
    }

    if (mejorOferta && solicitud.estado !== 'adjudicada') {
      publicacionTemporal = await crearYPublicarProductoTemporalMesaWsp({
        solicitud,
        ofertaGanadora: mejorOferta,
        ttlHoras: 4,
      });

      ofertasFinales = ofertasActualizadas.map((o) => ({
        ...o,
        ganadora: o.id === mejorOferta.id,
      }));
      estadoFinal = 'adjudicada';

      Object.assign(updatePayload, {
        ofertasRecibidas: ofertasFinales,
        estado: 'adjudicada',
        ofertaGanadoraId: mejorOferta.id,
        skuPublicoGenerado: publicacionTemporal.skuPublicoFrp,
        inventarioCreadoId: publicacionTemporal.inventarioId,
        wooProductIdTemporal: publicacionTemporal.wooProductId,
        urlProductoTienda: publicacionTemporal.urlProductoTienda,
        expiraEn: publicacionTemporal.expiraEn,
        mensajeCotizacionCliente: publicacionTemporal.mensajeClienteWsp,
        adjudicadaEn: now,
      });

      // Enviar push directo al WhatsApp del cliente (< 24h) con el link del producto en la tienda
      let telCliente = String(solicitud.clienteTelefonoReal || solicitud.clienteTelefono || '').trim();
      if (solicitud.sesionAgenteId) {
        const sesRef = db.collection('sesiones_agente_omnicanal').doc(solicitud.sesionAgenteId);
        const sesSnap = await sesRef.get().catch(() => null);
        if (sesSnap?.exists) {
          const sesData = sesSnap.data() || {};
          if ((!telCliente || telCliente === 'CONFIDENCIAL-FRP') && sesData.clienteTelefono) {
            telCliente = String(sesData.clienteTelefono).trim();
          }
          const mensajes = Array.isArray(sesData.mensajes) ? [...sesData.mensajes] : [];
          mensajes.push({
            id: `msg-wsp-temp-${Date.now()}`,
            rol: 'agente',
            autor: 'Repuestín · facilrepuestos.cl',
            texto: publicacionTemporal.mensajeClienteWsp,
            creadoEn: now,
            origen: 'producto_temporal_mesa_wsp',
          });
          const carrito = Array.isArray(sesData.carritoCotizado) ? [...sesData.carritoCotizado] : [];
          carrito.push({
            id: publicacionTemporal.inventarioId,
            skuPublicoFrp: publicacionTemporal.skuPublicoFrp,
            nombre: publicacionTemporal.itemPublicado.nombre,
            fabricante: mejorOferta.fabricante,
            origen: 'mesa_whatsapp_temporal_4h',
            proveedorNombre: 'FácilRepuestos SpA',
            stock: 1,
            cantidad: 1,
            precioVentaNeto: mejorOferta.precioVentaFrpNeto,
            precioVentaConIva: mejorOferta.precioVentaFrpConIva,
            wooProductId: publicacionTemporal.wooProductId,
            urlProductoWoo: publicacionTemporal.urlProductoTienda,
            esProductoTemporalWsp: true,
            expiraEn: publicacionTemporal.expiraEn,
          });
          await sesRef.update({
            mensajes,
            carritoCotizado: carrito,
            updatedAt: now,
          });
        }
      }

      if (telCliente && /\d{8,15}/.test(telCliente.replace(/\D/g, ''))) {
        await enviarRespuestaClienteMetaWhatsapp({
          telefonoDestino: telCliente,
          texto: publicacionTemporal.mensajeClienteWsp,
        }).catch(() => null);
      }
    }

    await solRef.update(updatePayload);

    res.json({
      success: true,
      data: {
        oferta: nuevaOferta,
        publicacionTemporal,
        solicitud: {
          ...solicitud,
          ...updatePayload,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesa-wsp/solicitudes/:id/adjudicar
// Adjudica una oferta ganadora de WhatsApp en 1 clic:
// 1. Genera el SKU público `FRP-WSP-{codigo}` y el mensaje listo para el cliente final.
// 2. Opcionalmente publica el repuesto en Firebase `inventario` con `needsWooSync: true` (Etapa 2).
// 3. Opcionalmente guarda la regla en `conocimiento_aprendido_ia` para que el Agente IA aprenda (Etapa 1).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/solicitudes/:id/adjudicar', requireAuth, async (req, res, next) => {
  try {
    const solRef = db.collection(COLECCION_SOLICITUDES_WSP).doc(req.params.id);
    const solSnap = await solRef.get();
    if (!solSnap.exists) {
      return res.status(404).json({ success: false, error: 'Solicitud WhatsApp no encontrada' });
    }

    const solicitud = { id: solSnap.id, ...solSnap.data() };
    const {
      ofertaId,
      publicarEnInventario = true,
      guardarConocimientoIa = true,
      stockInicialPublicacion = 2,
    } = req.body || {};

    const ofertaGanadora = (solicitud.ofertasRecibidas || []).find((o) => o.id === ofertaId);
    if (!ofertaGanadora) {
      return res.status(404).json({
        success: false,
        error: 'No se encontró la oferta seleccionada dentro de esta solicitud',
      });
    }

    const now = new Date().toISOString();
    const codigoBase =
      solicitud.codigoReferencia?.split('/')[0]?.trim() ||
      `${solicitud.marcaVehiculo.slice(0, 3)}-${solicitud.codigoSolicitud.replace('WSP-', '')}`;
    const codigoLimpio = codigoBase.replace(/[^A-Z0-9-]/gi, '').toUpperCase() || solicitud.codigoSolicitud;
    const skuPublicoFrp = `FRP-WSP-${codigoLimpio}`;

    // 1. Construir mensaje comercial para el cliente final (WhatsApp / Web)
    const fmtCLP = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
    const vehiculoTxt = [
      solicitud.marcaVehiculo,
      solicitud.modeloVehiculo,
      solicitud.anioVehiculo,
      solicitud.motorVehiculo,
    ]
      .filter(Boolean)
      .join(' ');

    const mensajeCotizacionCliente =
      `✅ *Cotización Confirmada FácilRepuestos* (${skuPublicoFrp})\n` +
      `🚗 *Vehículo:* ${vehiculoTxt}${solicitud.patente ? ` (Patente ${solicitud.patente})` : ''}\n` +
      `🔧 *Repuesto:* ${solicitud.repuestoBuscado}\n` +
      `🏭 *Marca / Origen:* ${ofertaGanadora.fabricante} (${ofertaGanadora.origen})\n` +
      `⚡ *Disponibilidad:* ${ofertaGanadora.disponibilidad}\n` +
      `💰 *Precio Neto:* ${fmtCLP(ofertaGanadora.precioVentaFrpNeto)} (+ IVA: *${fmtCLP(ofertaGanadora.precioVentaFrpConIva)}*)\n` +
      (ofertaGanadora.fotoUrl ? `📸 *Foto verificada en mesón:* ${ofertaGanadora.fotoUrl}\n` : '');

    // 2. Si publicarEnInventario === true, inyectar en `inventario` con `needsWooSync: true` (Etapa 2)
    let inventarioCreadoId = solicitud.inventarioCreadoId || null;
    if (publicarEnInventario && ofertaGanadora.precioCostoNeto > 0) {
      const docInvId = `wsp_${solicitud.codigoSolicitud.toLowerCase()}_${ofertaGanadora.id.slice(-4)}`;
      const categoriaUpper = String(solicitud.categoriaRepuesto || 'GENERAL').toUpperCase();
      const marcaUpper = String(solicitud.marcaVehiculo || '').toUpperCase();
      const modeloUpper = String(solicitud.modeloVehiculo || '').toUpperCase();

      const itemPayload = {
        nombre: `${solicitud.repuestoBuscado} ${ofertaGanadora.fabricante}`.trim().toUpperCase(),
        codigo: codigoLimpio,
        skuPublicoFrp,
        fabricante: ofertaGanadora.fabricante,
        origen: ofertaGanadora.origen,
        descripcion: `Repuesto cotizado y verificado en vivo vía Mesa WhatsApp (#${solicitud.codigoSolicitud}). Compatibilidad confirmada para ${vehiculoTxt}.`,
        equivalencias: solicitud.codigoReferencia
          ? [{ fabricante: ofertaGanadora.fabricante, codigo: solicitud.codigoReferencia }]
          : [],
        categoria: categoriaUpper,
        proveedor: ofertaGanadora.proveedorNombre,
        proveedorId: ofertaGanadora.proveedorId,
        origenDatos: 'mesa_whatsapp_vivo',
        tipoPieza: solicitud.repuestoBuscado,
        posicion: 'NO APLICA',
        lado: 'NO APLICA',
        marcasCompatibles: marcaUpper ? [marcaUpper] : [],
        modelosCompatibles:
          marcaUpper && modeloUpper ? { [marcaUpper]: [modeloUpper] } : {},
        anioDesde: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) - 2 : null,
        anioHasta: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) + 2 : null,
        precioImportacion: 0,
        precioLista: ofertaGanadora.precioCostoNeto,
        descuentoTaller: 0,
        precioCompra: ofertaGanadora.precioCostoNeto,
        precioVenta: ofertaGanadora.precioVentaFrpNeto,
        margenAplicadoPct: ofertaGanadora.margenAplicadoPct,
        stock: Number(stockInicialPublicacion) || 2,
        stockReservado: 0,
        stockMinimo: 1,
        unidad: 'unidad',
        imagenUrl: ofertaGanadora.fotoUrl || '',
        ocultarEnTienda: false,
        needsWooSync: true,
        wooSyncMotivo: 'adjudicacion_mesa_whatsapp',
        createdAt: now,
        updatedAt: now,
      };
      itemPayload.deltaHash = calcularHashCatalogoItem(itemPayload);

      await db.collection(COLECCION_INVENTARIO).doc(docInvId).set(itemPayload, { merge: true });
      inventarioCreadoId = docInvId;
    }

    // 3. Si guardarConocimientoIa === true, inyectar en `conocimiento_aprendido_ia` (Etapa 1)
    let conocimientoCreadoId = solicitud.conocimientoCreadoId || null;
    if (guardarConocimientoIa) {
      const reglaPayload = {
        escalamientoId: solicitud.id,
        ticketRef: solicitud.codigoSolicitud,
        origenTipo: 'proveedor_wsp_vivo',
        proveedorId: ofertaGanadora.proveedorId,
        proveedorNombre: ofertaGanadora.proveedorNombre,
        nodoAilooId: null,
        datasetOrigen: 'mesa_whatsapp_vivo',
        tipoAprendizaje: 'cotizacion_wsp_vivo',
        marcaVehiculo: solicitud.marcaVehiculo,
        modeloVehiculo: solicitud.modeloVehiculo,
        anioDesde: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) - 2 : null,
        anioHasta: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) + 2 : null,
        motor: solicitud.motorVehiculo || '',
        patenteReferencia: solicitud.patente || '',
        categoriaRepuesto: String(solicitud.categoriaRepuesto || 'GENERAL').toUpperCase(),
        inventarioId: inventarioCreadoId,
        skuProveedor: codigoLimpio,
        skuPublicoFrp,
        nombreRepuesto: `${solicitud.repuestoBuscado} (${ofertaGanadora.fabricante} - ${ofertaGanadora.origen})`,
        precioCostoProveedor: ofertaGanadora.precioCostoNeto,
        margenAplicadoPct: ofertaGanadora.margenAplicadoPct,
        precioVentaFrp: ofertaGanadora.precioVentaFrpNeto,
        equivalencia: solicitud.codigoReferencia
          ? { fabricante: ofertaGanadora.fabricante, codigo: solicitud.codigoReferencia }
          : null,
        preguntaResumen: `Cotización en vivo WhatsApp: ${solicitud.repuestoBuscado} para ${vehiculoTxt}`,
        respuestaValidada: `${ofertaGanadora.mensajeOriginalWsp} — Validado en ${ofertaGanadora.fabricante} (${ofertaGanadora.origen}), ${ofertaGanadora.disponibilidad}.`,
        terminosClave: normalizarTerminos(
          `${solicitud.marcaVehiculo} ${solicitud.modeloVehiculo} ${solicitud.motorVehiculo} ${solicitud.repuestoBuscado} ${ofertaGanadora.fabricante} ${skuPublicoFrp}`
        ),
        usosEnAgente: 1,
        activo: true,
        createdAt: now,
        updatedAt: now,
      };
      const knowRef = await db.collection(COLECCION_CONOCIMIENTO).add(reglaPayload);
      conocimientoCreadoId = knowRef.id;
    }

    const ofertasMarcadas = (solicitud.ofertasRecibidas || []).map((o) => ({
      ...o,
      ganadora: o.id === ofertaGanadora.id,
    }));

    const actualizacionSolicitud = {
      estado: 'adjudicada',
      ofertasRecibidas: ofertasMarcadas,
      ofertaGanadoraId: ofertaGanadora.id,
      skuPublicoGenerado: skuPublicoFrp,
      inventarioCreadoId,
      conocimientoCreadoId,
      mensajeCotizacionCliente,
      adjudicadaEn: now,
      updatedAt: now,
    };

    await solRef.update(actualizacionSolicitud);

    res.json({
      success: true,
      data: {
        solicitud: {
          ...solicitud,
          ...actualizacionSolicitud,
        },
        inventarioCreadoId,
        conocimientoCreadoId,
        skuPublicoFrp,
        mensajeCotizacionCliente,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK OFICIAL META WHATSAPP CLOUD API (GET verificación + POST mensajes entrantes)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/webhook', manejarWebhookGetMeta);

router.post('/webhook', async (req, res, next) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const remitenteTel = String(msg.from || '').replace(/[^\d]/g, '');
    const displayReceptor = String(change?.metadata?.display_phone_number || '').replace(/\D/g, '');
    const phoneIdReceptor = String(change?.metadata?.phone_number_id || '').trim();

    // Si el mensaje entró al número exclusivo de la Mesa de Abastecimiento (+56950960294),
    // registrar automáticamente su phoneNumberIdMesaB2b en Firestore
    if (displayReceptor.endsWith('50960294') && phoneIdReceptor) {
      await db
        .collection('configuracion_sistema')
        .doc('whatsapp_meta')
        .set(
          {
            phoneNumberIdMesaB2b: phoneIdReceptor,
            numeroMesaB2b: '56950960294',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
        .catch(() => null);
    }

    const textoEntrante =
      msg.text?.body || msg.image?.caption || msg.document?.caption || '';

    // Buscar si el remitente es un proveedor contactado en una solicitud abierta de Mesa WSP
    const snap = await db.collection(COLECCION_SOLICITUDES_WSP).get();
    const abiertas = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.estado !== 'adjudicada' && s.estado !== 'cerrada')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const solicitudMatch = abiertas.find((s) =>
      (s.proveedoresContactados || []).some(
        (p) =>
          remitenteTel.length >= 8 &&
          String(p.telefono || '')
            .replace(/[^\d]/g, '')
            .endsWith(remitenteTel.slice(-8))
      )
    );

    // Si NO es un proveedor respondiendo una solicitud abierta, es un CLIENTE escribiéndole a Repuestín
    if (!solicitudMatch) {
      return manejarWebhookPostMeta(req, res);
    }

    const provMatch =
      (solicitudMatch.proveedoresContactados || []).find((p) =>
        String(p.telefono || '').replace(/[^\d]/g, '').endsWith(remitenteTel.slice(-8))
      ) || solicitudMatch.proveedoresContactados?.[0];

    const prevOfertaProv = [...(solicitudMatch.ofertasRecibidas || [])]
      .reverse()
      .find((o) => String(o.telefonoProveedor || '').replace(/\D/g, '').endsWith(remitenteTel.slice(-8)));

    const textoAcumuladoProv = prevOfertaProv?.mensajeOriginalWsp
      ? `${prevOfertaProv.mensajeOriginalWsp} . ${textoEntrante}`
      : textoEntrante;
    const turnosReconsultaPrevios = Number(prevOfertaProv?.turnosReconsulta || 0);

    const extraido = extraerOfertaDesdeMensajeWsp({
      mensajeTexto: textoAcumuladoProv,
    });
    const margenPct = Number(solicitudMatch.margenPct) || 30;
    const precioVentaFrpNeto =
      extraido.precioCostoNeto > 0
        ? Math.round(extraido.precioCostoNeto * (1 + margenPct / 100))
        : 0;
    const precioVentaFrpConIva =
      precioVentaFrpNeto > 0 ? Math.round(precioVentaFrpNeto * 1.19) : 0;

    const now = new Date().toISOString();
    const nuevaOferta = {
      id: prevOfertaProv?.id || `of-wsp-meta-${Date.now()}`,
      proveedorId: provMatch?.proveedorId || 'prov-wsp-meta',
      proveedorNombre: provMatch?.proveedorNombre || `Proveedor WhatsApp (+${remitenteTel})`,
      telefonoProveedor: `+${remitenteTel}`,
      mensajeOriginalWsp: textoAcumuladoProv,
      transcripcionAudio: '',
      fotoUrl: '',
      tieneStock: extraido.tieneStock,
      fabricante: extraido.fabricante,
      origen: extraido.origen,
      disponibilidad: extraido.disponibilidad,
      garantia: '6 meses',
      precioCostoNeto: extraido.precioCostoNeto,
      margenAplicadoPct: margenPct,
      precioVentaFrpNeto,
      precioVentaFrpConIva,
      confianzaIa: extraido.confianzaIa,
      ofertaCompleta: extraido.ofertaCompleta,
      faltantesCotizacion: extraido.faltantesCotizacion || [],
      turnosReconsulta: turnosReconsultaPrevios + (extraido.ofertaCompleta ? 0 : 1),
      ganadora: false,
      recibidoEn: now,
    };

    const ofertasSinPrev = (solicitudMatch.ofertasRecibidas || []).filter((o) => o.id !== nuevaOferta.id);
    const ofertasActualizadas = [...ofertasSinPrev, nuevaOferta];

    // Si faltan datos clave (¿es más IVA?, marca/origen o cuándo está listo para retiro), repreguntar al proveedor
    if (
      extraido.tieneStock &&
      !extraido.ofertaCompleta &&
      extraido.preguntaSeguimientoProveedor &&
      turnosReconsultaPrevios < 2
    ) {
      await db
        .collection(COLECCION_SOLICITUDES_WSP)
        .doc(solicitudMatch.id)
        .update({
          ofertasRecibidas: ofertasActualizadas,
          updatedAt: now,
        });

      await enviarMensajeMetaWhatsApp({
        telefono: `+${remitenteTel}`,
        textoMensaje: extraido.preguntaSeguimientoProveedor,
        codigoSolicitud: solicitudMatch.codigoSolicitud,
      }).catch(() => null);

      return res.status(200).json({
        received: true,
        matched: true,
        reconsultaEnviada: extraido.preguntaSeguimientoProveedor,
      });
    }
    const mejorOfertaAuto = elegirMejorOfertaMesaWsp(ofertasActualizadas);
    const updateWebhook = {
      ofertasRecibidas: ofertasActualizadas,
      estado: 'con_ofertas',
      updatedAt: now,
    };

    if (mejorOfertaAuto && solicitudMatch.estado !== 'adjudicada') {
      const pubTemp = await crearYPublicarProductoTemporalMesaWsp({
        solicitud: solicitudMatch,
        ofertaGanadora: mejorOfertaAuto,
        ttlHoras: 4,
      });
      Object.assign(updateWebhook, {
        ofertasRecibidas: ofertasActualizadas.map((o) => ({
          ...o,
          ganadora: o.id === mejorOfertaAuto.id,
        })),
        estado: 'adjudicada',
        ofertaGanadoraId: mejorOfertaAuto.id,
        skuPublicoGenerado: pubTemp.skuPublicoFrp,
        inventarioCreadoId: pubTemp.inventarioId,
        wooProductIdTemporal: pubTemp.wooProductId,
        urlProductoTienda: pubTemp.urlProductoTienda,
        expiraEn: pubTemp.expiraEn,
        mensajeCotizacionCliente: pubTemp.mensajeClienteWsp,
        adjudicadaEn: now,
      });

      let telCliente = String(solicitudMatch.clienteTelefonoReal || solicitudMatch.clienteTelefono || '').trim();
      if (solicitudMatch.sesionAgenteId) {
        const sesRef = db.collection('sesiones_agente_omnicanal').doc(solicitudMatch.sesionAgenteId);
        const sesSnap = await sesRef.get().catch(() => null);
        if (sesSnap?.exists) {
          const sesData = sesSnap.data() || {};
          if ((!telCliente || telCliente === 'CONFIDENCIAL-FRP') && sesData.clienteTelefono) {
            telCliente = String(sesData.clienteTelefono).trim();
          }
          const mensajes = Array.isArray(sesData.mensajes) ? [...sesData.mensajes] : [];
          mensajes.push({
            id: `msg-wsp-temp-${Date.now()}`,
            rol: 'agente',
            autor: 'Repuestín · facilrepuestos.cl',
            texto: pubTemp.mensajeClienteWsp,
            creadoEn: now,
            origen: 'producto_temporal_mesa_wsp',
          });
          await sesRef.update({ mensajes, updatedAt: now });
        }
      }
      if (telCliente && /\d{8,15}/.test(telCliente.replace(/\D/g, ''))) {
        await enviarRespuestaClienteMetaWhatsapp({
          telefonoDestino: telCliente,
          texto: pubTemp.mensajeClienteWsp,
        }).catch(() => null);
      }
    }

    await db
      .collection(COLECCION_SOLICITUDES_WSP)
      .doc(solicitudMatch.id)
      .update(updateWebhook);

    return res.status(200).json({ received: true, matched: true, solicitudId: solicitudMatch.id });
  } catch (error) {
    next(error);
  }
});

export default router;
