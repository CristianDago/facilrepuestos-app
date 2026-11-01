import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';

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
export function extraerOfertaDesdeMensajeWsp({
  mensajeTexto = '',
  transcripcionAudio = '',
  precioManualNeto = null,
  fabricanteManual = '',
  origenManual = '',
  disponibilidadManual = '',
}) {
  const fuente = `${mensajeTexto || ''} ${transcripcionAudio || ''}`.trim();
  const lower = fuente.toLowerCase();

  // 1. Detectar si el proveedor indica que NO tiene stock
  const sinStockRegex = /\b(no\s+me\s+queda|sin\s+stock|agotado|no\s+tenemos|no\s+lo\s+trabajo|no\s+tengo)\b/i;
  const tieneStock = !sinStockRegex.test(lower) || Boolean(precioManualNeto && Number(precioManualNeto) > 0);

  // 2. Extraer precio en CLP desde lenguaje natural chileno ("$95.000", "95000", "95 mil", "95k", "95 lucas")
  let precioDetectado = Number(precioManualNeto) || 0;
  if (!precioDetectado && fuente) {
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

  // 3. Determinar si el precio mencionado venía con IVA incluido para normalizarlo a NETO
  const mencionaConIva = /\b(con\s+iva|iva\s+incluido|bruto)\b/i.test(lower) && !/\b(mas\s+iva|\+\s*iva|neto)\b/i.test(lower);
  const precioCostoNeto = mencionaConIva
    ? Math.round(precioDetectado / 1.19)
    : Math.round(precioDetectado);

  // 4. Detectar fabricante / marca de la pieza
  let fabricante = String(fabricanteManual || '').trim().toUpperCase();
  if (!fabricante) {
    const upperFuente = fuente.toUpperCase();
    const encontrado = FABRICANTES_CONOCIDOS.find((fab) => {
      const rx = new RegExp(`\\b${fab.replace('-', '[-\\s]?')}\\b`, 'i');
      return rx.test(upperFuente);
    });
    fabricante = encontrado || (/\boriginal\b/i.test(fuente) ? 'ORIGINAL OEM' : 'ALTERNATIVO');
  }

  // 5. Detectar origen del repuesto
  let origen = String(origenManual || '').trim().toUpperCase();
  if (!origen) {
    const matchOrigen = ORIGENES_MAP.find((o) => o.regex.test(fuente));
    origen = matchOrigen ? matchOrigen.valor : 'IMPORTACIÓN';
  }

  // 6. Detectar disponibilidad / tiempo de entrega
  let disponibilidad = String(disponibilidadManual || '').trim();
  if (!disponibilidad) {
    if (!tieneStock) {
      disponibilidad = 'Sin stock';
    } else if (/\b(inmediat[ao]|en\s+meson|en\s+mesón|retiro\s+inmediato|ahora\s+mismo|disponible\s+aca)\b/i.test(lower)) {
      disponibilidad = 'Entrega inmediata';
    } else if (/\b(hoy|esta\s+tarde|en\s+2\s+horas|mediodia)\b/i.test(lower)) {
      disponibilidad = 'Despacho hoy mismo';
    } else if (/\b(mañana|manana|24\s*h|24\s*horas)\b/i.test(lower)) {
      disponibilidad = 'Pedido 24 hrs';
    } else if (/\b(48\s*h|2\s*dias|dos\s*dias)\b/i.test(lower)) {
      disponibilidad = 'Pedido 48 hrs';
    } else {
      disponibilidad = 'Disponible en mesón';
    }
  }

  // 7. Nivel de confianza del parser
  let confianzaIa = 0.72;
  if (precioCostoNeto > 0 && fabricante !== 'ALTERNATIVO') confianzaIa = 0.96;
  else if (precioCostoNeto > 0) confianzaIa = 0.89;

  return {
    tieneStock,
    precioCostoNeto,
    mencionaConIva,
    fabricante,
    origen,
    disponibilidad,
    confianzaIa,
  };
}

/**
 * Construye el mensaje de WhatsApp que FácilRepuestos envía a los proveedores reales en vivo.
 */
function construirMensajeSalidaWsp({
  codigoSolicitud,
  nombreProveedor,
  marcaVehiculo,
  modeloVehiculo,
  anioVehiculo,
  motorVehiculo,
  patente,
  vin,
  repuestoBuscado,
  codigoReferencia,
  notasAdicionales,
}) {
  const vehiculoStr = [marcaVehiculo, modeloVehiculo, anioVehiculo, motorVehiculo]
    .filter(Boolean)
    .join(' ');
  const identStr = [
    patente ? `Patente: ${patente}` : '',
    vin ? `VIN: ${vin}` : '',
    codigoReferencia ? `OEM/Ref: ${codigoReferencia}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    `👋 Hola *${nombreProveedor}*, te escribimos de *FácilRepuestos* (Mesa Cotización *#${codigoSolicitud}*).\n\n` +
    `🔎 Buscamos cotización en vivo para cliente en espera:\n` +
    `• *Repuesto:* ${repuestoBuscado}\n` +
    `• *Vehículo:* ${vehiculoStr || 'Por confirmar'}\n` +
    (identStr ? `• *Datos técnicos:* ${identStr}\n` : '') +
    (notasAdicionales ? `• *Detalle:* ${notasAdicionales}\n` : '') +
    `\n💬 Por favor respóndenos por aquí con *precio neto, marca/origen, disponibilidad y foto* si lo tienes en mesón. ¡Gracias!`
  );
}

/**
 * Envía el mensaje por Meta WhatsApp Cloud API si existen `META_WA_TOKEN` y `META_WA_PHONE_ID`.
 * Si no están configurados en `.env`, opera en modo simulación local conservando la trazabilidad completa.
 */
async function enviarMensajeMetaWhatsApp({ telefono, textoMensaje, codigoSolicitud }) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
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

/**
 * Asegura que existan proveedores especialistas con WhatsApp activo para demostrar el
 * enrutamiento por Marca + Categoría en la Etapa 3 y que aparezcan enriquecidos en `/proveedores`.
 */
export async function asegurarProveedoresWspDemo() {
  const snap = await db.collection(COLECCION_PROVEEDORES).get();
  const existentes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const demosWsp = [
    {
      id: 'prov-wsp-corea-01',
      nombre: 'Importadora CoreaParts 10 de Julio',
      rut: '76.512.890-4',
      contacto: 'Don Patricio Rojas (Mesón WhatsApp)',
      telefono: '+56984120931',
      email: 'ventas@coreaparts.cl',
      direccion: 'Av. 10 de Julio 482, Santiago',
      categoria: 'Embrague',
      categoriasEspecialidad: ['Embrague', 'Motor', 'Transmisión', 'Filtros'],
      marcas: ['HYUNDAI', 'KIA', 'CHEVROLET', 'SSANGYONG'],
      marcasVehiculo: ['HYUNDAI', 'KIA', 'CHEVROLET', 'SSANGYONG'],
      notas: 'Especialista en embragues, cajas y motores diésel coreanos (D4CB, D4BH, G4FD). Responde WhatsApp con fotos de mesón.',
      tipoIntegracion: 'cotizacion_whatsapp',
      canalWspActivo: true,
      margenPct: 28,
      prefijoSku: 'FRP-WSP',
      tiempoRespuestaPromMin: 4,
    },
    {
      id: 'prov-wsp-nippon-02',
      nombre: 'Nippon Frenos & Suspensión Ltda.',
      rut: '77.219.440-K',
      contacto: 'Rodrigo Muñoz (Cotizaciones WSP)',
      telefono: '+56976541120',
      email: 'meson@nipponfrenos.cl',
      direccion: 'Lira 615, Santiago',
      categoria: 'Frenos',
      categoriasEspecialidad: ['Frenos', 'Suspensión', 'Embrague'],
      marcas: ['TOYOTA', 'NISSAN', 'MITSUBISHI', 'MAZDA', 'SUZUKI', 'SUBARU'],
      marcasVehiculo: ['TOYOTA', 'NISSAN', 'MITSUBISHI', 'MAZDA', 'SUZUKI', 'SUBARU'],
      notas: 'Importador directo de frenos, amortiguadores KYB y embragues Aisin/Exedy para japoneses y camionetas.',
      tipoIntegracion: 'cotizacion_whatsapp',
      canalWspActivo: true,
      margenPct: 30,
      prefijoSku: 'FRP-WSP',
      tiempoRespuestaPromMin: 6,
    },
    {
      id: 'prov-wsp-euro-03',
      nombre: 'EuroPSA & Multimarcas Lira',
      rut: '78.901.332-1',
      contacto: 'Camila Soto (Ventas WhatsApp)',
      telefono: '+56963218845',
      email: 'wsp@europsa.cl',
      direccion: 'Lira 840, Santiago',
      categoria: 'Distribución',
      categoriasEspecialidad: ['Distribución', 'Embrague', 'Motor', 'Suspensión'],
      marcas: ['PEUGEOT', 'CITROËN', 'RENAULT', 'VOLKSWAGEN', 'HYUNDAI', 'FORD'],
      marcasVehiculo: ['PEUGEOT', 'CITROËN', 'RENAULT', 'VOLKSWAGEN', 'HYUNDAI', 'FORD'],
      notas: 'Especialistas en kits de distribución, bombas de agua, embragues bimasa Luk/Valeo y tren delantero.',
      tipoIntegracion: 'cotizacion_whatsapp',
      canalWspActivo: true,
      margenPct: 28,
      prefijoSku: 'FRP-WSP',
      tiempoRespuestaPromMin: 5,
    },
    {
      id: 'prov-ailoo-soluparts',
      nombre: 'Soluparts (Nodo Enterprise Ailoo)',
      rut: '76.890.110-2',
      contacto: 'Mesa Técnica Soluparts Ailoo',
      telefono: '+56988112233',
      email: 'escalamientos@soluparts.cl',
      direccion: 'Nodo BigQuery: soluparts_ailoo',
      categoria: 'Frenos',
      categoriasEspecialidad: ['Frenos', 'Embrague', 'Suspensión', 'Filtros', 'Motor'],
      marcas: ['HYUNDAI', 'KIA', 'NISSAN', 'TOYOTA', 'CHEVROLET', 'MITSUBISHI', 'SUZUKI'],
      marcasVehiculo: ['HYUNDAI', 'KIA', 'NISSAN', 'TOYOTA', 'CHEVROLET', 'MITSUBISHI', 'SUZUKI'],
      notas: 'Proveedor Enterprise conectado vía BigQuery (soluparts_ailoo.inventario y soluparts_ailoo.escalamientos). Sincroniza stock en tiempo real.',
      tipoIntegracion: 'nodo_ailoo',
      nodoAilooId: 'soluparts',
      canalWspActivo: false,
      margenPct: 28,
      prefijoSku: 'FRP-SOL',
      tiempoRespuestaPromMin: 3,
    },
    {
      id: 'prov-ailoo-global',
      nombre: 'Global Repuestos (Nodo Enterprise Ailoo)',
      rut: '76.940.220-8',
      contacto: 'Soporte Técnico Global Ailoo',
      telefono: '+56977445566',
      email: 'meson@globalrepuestos.cl',
      direccion: 'Nodo BigQuery: global_ailoo',
      categoria: 'Motor',
      categoriasEspecialidad: ['Motor', 'Distribución', 'Suspensión', 'Eléctrico', 'Embrague'],
      marcas: ['PEUGEOT', 'CITROËN', 'TOYOTA', 'MITSUBISHI', 'NISSAN', 'VOLKSWAGEN', 'FORD'],
      marcasVehiculo: ['PEUGEOT', 'CITROËN', 'TOYOTA', 'MITSUBISHI', 'NISSAN', 'VOLKSWAGEN', 'FORD'],
      notas: 'Proveedor Enterprise conectado vía BigQuery (global_ailoo.inventario y global_ailoo.escalamientos). Especialista en europeos y camionetas diésel.',
      tipoIntegracion: 'nodo_ailoo',
      nodoAilooId: 'global',
      canalWspActivo: false,
      margenPct: 30,
      prefijoSku: 'FRP-GLB',
      tiempoRespuestaPromMin: 4,
    },
  ];

  const now = new Date().toISOString();
  for (const demo of demosWsp) {
    const existente = existentes.find((p) => p.id === demo.id || p.rut === demo.rut);
    if (!existente) {
      await db.collection(COLECCION_PROVEEDORES).doc(demo.id).set({
        ...demo,
        createdAt: now,
        updatedAt: now,
      });
    } else if (!existente.tipoIntegracion || !existente.categoriasEspecialidad) {
      await db.collection(COLECCION_PROVEEDORES).doc(existente.id).update({
        tipoIntegracion: existente.tipoIntegracion || demo.tipoIntegracion,
        categoriasEspecialidad: existente.categoriasEspecialidad || demo.categoriasEspecialidad,
        marcasVehiculo: existente.marcasVehiculo || demo.marcasVehiculo,
        margenPct: existente.margenPct ?? demo.margenPct,
        prefijoSku: existente.prefijoSku || demo.prefijoSku,
        nodoAilooId: existente.nodoAilooId ?? demo.nodoAilooId ?? null,
        canalWspActivo: existente.canalWspActivo ?? demo.canalWspActivo,
        tiempoRespuestaPromMin: existente.tiempoRespuestaPromMin ?? demo.tiempoRespuestaPromMin,
      });
    }
  }
}

/**
 * Semilla inicial de Solicitudes de Cotización en Vivo por WhatsApp (`solicitudes_cotizacion_wsp`)
 * para que la Mesa de Cotización muestre casos reales funcionando desde el primer vistazo.
 */
async function asegurarSolicitudesWspDemo() {
  const snap = await db.collection(COLECCION_SOLICITUDES_WSP).limit(1).get();
  if (!snap.empty) return;

  await asegurarProveedoresWspDemo();
  const now = new Date().toISOString();

  const solicitudDemo1 = {
    codigoSolicitud: 'WSP-4821',
    estado: 'con_ofertas', // 'esperando_respuestas' | 'con_ofertas' | 'adjudicada' | 'cerrada'
    canalCliente: 'whatsapp',
    clienteNombre: 'Transportes San Miguel (Cliente WhatsApp)',
    clienteTelefono: '+56991234567',
    patente: 'JPKR42',
    vin: 'KMJHD17BPJU109281',
    marcaVehiculo: 'HYUNDAI',
    modeloVehiculo: 'PORTER',
    anioVehiculo: 2018,
    motorVehiculo: '2.5 D4CB CRDI',
    categoriaRepuesto: 'Embrague',
    repuestoBuscado: 'VOLANTE BIMASA + KIT EMBRAGUE HYUNDAI PORTER 2.5 CRDI CAJA 6TA',
    codigoReferencia: '23200-4A500 / LUK-415049210',
    notasAdicionales: 'No disponible con stock inmediato en nodos Ailoo; cliente necesita retirar hoy en Santiago.',
    margenPct: 28,
    escalamientoOrigenId: null,
    proveedoresContactados: [
      {
        proveedorId: 'prov-wsp-corea-01',
        proveedorNombre: 'Importadora CoreaParts 10 de Julio',
        contacto: 'Don Patricio Rojas (Mesón WhatsApp)',
        telefono: '+56984120931',
        especialidadMarcas: ['HYUNDAI', 'KIA', 'CHEVROLET', 'SSANGYONG'],
        estadoContacto: 'respondido',
        modoEnvio: 'simulacion_meta_local',
        metaMessageId: 'sim_wamid_WSP-4821_1',
        mensajeEnviado: construirMensajeSalidaWsp({
          codigoSolicitud: 'WSP-4821',
          nombreProveedor: 'Importadora CoreaParts 10 de Julio',
          marcaVehiculo: 'HYUNDAI',
          modeloVehiculo: 'PORTER',
          anioVehiculo: 2018,
          motorVehiculo: '2.5 D4CB CRDI',
          patente: 'JPKR42',
          vin: 'KMJHD17BPJU109281',
          repuestoBuscado: 'VOLANTE BIMASA + KIT EMBRAGUE HYUNDAI PORTER 2.5 CRDI CAJA 6TA',
          codigoReferencia: '23200-4A500 / LUK-415049210',
          notasAdicionales: 'Confirmar si incluye volante rígido de conversión o bimasa original.',
        }),
        enviadoEn: now,
        respondidoEn: now,
      },
      {
        proveedorId: 'prov-wsp-euro-03',
        proveedorNombre: 'EuroPSA & Multimarcas Lira',
        contacto: 'Camila Soto (Ventas WhatsApp)',
        telefono: '+56963218845',
        especialidadMarcas: ['PEUGEOT', 'CITROËN', 'RENAULT', 'VOLKSWAGEN', 'HYUNDAI', 'FORD'],
        estadoContacto: 'respondido',
        modoEnvio: 'simulacion_meta_local',
        metaMessageId: 'sim_wamid_WSP-4821_2',
        mensajeEnviado: construirMensajeSalidaWsp({
          codigoSolicitud: 'WSP-4821',
          nombreProveedor: 'EuroPSA & Multimarcas Lira',
          marcaVehiculo: 'HYUNDAI',
          modeloVehiculo: 'PORTER',
          anioVehiculo: 2018,
          motorVehiculo: '2.5 D4CB CRDI',
          patente: 'JPKR42',
          vin: 'KMJHD17BPJU109281',
          repuestoBuscado: 'VOLANTE BIMASA + KIT EMBRAGUE HYUNDAI PORTER 2.5 CRDI CAJA 6TA',
          codigoReferencia: '23200-4A500 / LUK-415049210',
          notasAdicionales: 'Confirmar si incluye volante rígido de conversión o bimasa original.',
        }),
        enviadoEn: now,
        respondidoEn: now,
      },
    ],
    ofertasRecibidas: [
      {
        id: 'of-wsp-demo-1',
        proveedorId: 'prov-wsp-corea-01',
        proveedorNombre: 'Importadora CoreaParts 10 de Julio',
        telefonoProveedor: '+56984120931',
        mensajeOriginalWsp:
          'Hola jefe sí lo tengo acá en mesón, kit completo conversión Valeo coreano original con volante + prensa + disco + rodamiento para Porter 2.5 caja sexta en $215.000 neto entrega inmediata, te mando foto de la caja.',
        transcripcionAudio:
          'Audio 0:11s — "Amigo el kit Valeo coreano completo con volante llega y calza en el D4CB 2018 caja de 6 cambios, te lo dejo en 215 neto retiro inmediato en 10 de Julio."',
        fotoUrl:
          'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=640&q=80',
        tieneStock: true,
        fabricante: 'VALEO',
        origen: 'COREA',
        disponibilidad: 'Entrega inmediata',
        garantia: '6 meses',
        precioCostoNeto: 215000,
        margenAplicadoPct: 28,
        precioVentaFrpNeto: Math.round(215000 * 1.28),
        precioVentaFrpConIva: Math.round(Math.round(215000 * 1.28) * 1.19),
        confianzaIa: 0.96,
        ganadora: false,
        recibidoEn: now,
      },
      {
        id: 'of-wsp-demo-2',
        proveedorId: 'prov-wsp-euro-03',
        proveedorNombre: 'EuroPSA & Multimarcas Lira',
        telefonoProveedor: '+56963218845',
        mensajeOriginalWsp:
          'Hola! Tenemos el conjunto LuK alemán con volante bimasa en $265.000 más IVA, disponible para despacho mañana a primera hora desde bodega central.',
        transcripcionAudio: '',
        fotoUrl: '',
        tieneStock: true,
        fabricante: 'LUK',
        origen: 'ALEMANIA',
        disponibilidad: 'Pedido 24 hrs',
        garantia: '6 meses',
        precioCostoNeto: 265000,
        margenAplicadoPct: 28,
        precioVentaFrpNeto: Math.round(265000 * 1.28),
        precioVentaFrpConIva: Math.round(Math.round(265000 * 1.28) * 1.19),
        confianzaIa: 0.94,
        ganadora: false,
        recibidoEn: now,
      },
    ],
    ofertaGanadoraId: null,
    skuPublicoGenerado: null,
    inventarioCreadoId: null,
    conocimientoCreadoId: null,
    mensajeCotizacionCliente: '',
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(COLECCION_SOLICITUDES_WSP).doc('wsp-demo-porter-4821').set(solicitudDemo1);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mesa-wsp/solicitudes
// Lista todas las solicitudes de cotización por WhatsApp y los proveedores con WhatsApp
// ─────────────────────────────────────────────────────────────────────────────
router.get('/solicitudes', requireAuth, async (req, res, next) => {
  try {
    await asegurarSolicitudesWspDemo();

    const [solSnap, provSnap] = await Promise.all([
      db.collection(COLECCION_SOLICITUDES_WSP).get(),
      db.collection(COLECCION_PROVEEDORES).get(),
    ]);

    const solicitudes = solSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const proveedoresWsp = provSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => Boolean(p.telefono) && p.canalWspActivo !== false)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

    const credencialesMetaActivas = Boolean(
      process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID
    );

    res.json({
      success: true,
      data: {
        credencialesMetaActivas,
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
      .filter((p) => Boolean(p.telefono) && p.canalWspActivo !== false);

    const marcaUpper = String(marcaVehiculo || '').trim().toUpperCase();
    const catUpper = String(categoriaRepuesto || '').trim().toUpperCase();

    // Si el usuario seleccionó proveedores específicos, usarlos; si no, filtrar por marca y especialidad compatible
    let seleccionados = [];
    if (Array.isArray(proveedorIds) && proveedorIds.length > 0) {
      seleccionados = todosProveedores.filter((p) => proveedorIds.includes(p.id));
    } else {
      seleccionados = todosProveedores.filter((p) => {
        const marcasProv = (p.marcas || p.marcasVehiculo || []).map((m) => String(m).toUpperCase());
        const catsProv = [
          p.categoria,
          ...(Array.isArray(p.categoriasEspecialidad) ? p.categoriasEspecialidad : []),
        ]
          .filter(Boolean)
          .map((c) => String(c).toUpperCase());

        const matchMarca = !marcaUpper || marcasProv.includes(marcaUpper);
        const matchCat =
          !catUpper || catUpper === 'GENERAL' || catsProv.length === 0 || catsProv.includes(catUpper);
        return matchMarca && matchCat;
      });
      if (seleccionados.length === 0 && marcaUpper) {
        seleccionados = todosProveedores.filter((p) =>
          (p.marcas || p.marcasVehiculo || []).map((m) => String(m).toUpperCase()).includes(marcaUpper)
        );
      }
      if (seleccionados.length === 0) {
        seleccionados = todosProveedores.slice(0, 3);
      }
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
      fotoUrl = '',
      precioManualNeto = null,
      fabricanteManual = '',
      origenManual = '',
      disponibilidadManual = '',
      garantia = '6 meses',
    } = req.body || {};

    if (!mensajeOriginalWsp.trim() && !transcripcionAudio.trim() && !precioManualNeto) {
      return res.status(400).json({
        success: false,
        error: 'Ingresa el mensaje de WhatsApp del proveedor, transcripción de audio o precio neto',
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

    const extraido = extraerOfertaDesdeMensajeWsp({
      mensajeTexto: mensajeOriginalWsp,
      transcripcionAudio,
      precioManualNeto,
      fabricanteManual,
      origenManual,
      disponibilidadManual,
    });

    const margenPct = Number(solicitud.margenPct) || 30;
    const precioCostoNeto = extraido.precioCostoNeto;
    const precioVentaFrpNeto =
      precioCostoNeto > 0 ? Math.round(precioCostoNeto * (1 + margenPct / 100)) : 0;
    const precioVentaFrpConIva =
      precioVentaFrpNeto > 0 ? Math.round(precioVentaFrpNeto * 1.19) : 0;

    const now = new Date().toISOString();
    const nuevaOferta = {
      id: `of-wsp-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      proveedorId: provInfo.proveedorId,
      proveedorNombre: provInfo.proveedorNombre,
      telefonoProveedor: provInfo.telefono || '',
      mensajeOriginalWsp: String(mensajeOriginalWsp || '').trim(),
      transcripcionAudio: String(transcripcionAudio || '').trim(),
      fotoUrl: String(fotoUrl || '').trim(),
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
      ganadora: false,
      recibidoEn: now,
    };

    const ofertasActualizadas = [...(solicitud.ofertasRecibidas || []), nuevaOferta];
    const contactosActualizados = (solicitud.proveedoresContactados || []).map((c) =>
      c.proveedorId === provInfo.proveedorId
        ? {
            ...c,
            estadoContacto: extraido.tieneStock ? 'respondido' : 'sin_stock',
            respondidoEn: now,
          }
        : c
    );

    const nuevoEstado =
      solicitud.estado === 'adjudicada'
        ? 'adjudicada'
        : ofertasActualizadas.some((o) => o.tieneStock && o.precioCostoNeto > 0)
        ? 'con_ofertas'
        : 'esperando_respuestas';

    await solRef.update({
      ofertasRecibidas: ofertasActualizadas,
      proveedoresContactados: contactosActualizados,
      estado: nuevoEstado,
      updatedAt: now,
    });

    res.json({
      success: true,
      data: {
        oferta: nuevaOferta,
        solicitud: {
          ...solicitud,
          ofertasRecibidas: ofertasActualizadas,
          proveedoresContactados: contactosActualizados,
          estado: nuevoEstado,
          updatedAt: now,
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
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expectedToken = process.env.META_WA_VERIFY_TOKEN || 'facilrepuestos_wsp_verify';

  if (mode === 'subscribe' && token === expectedToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ success: false, error: 'Token de verificación Meta inválido' });
});

router.post('/webhook', async (req, res, next) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const remitenteTel = String(msg.from || '').replace(/[^\d]/g, '');
    const textoEntrante =
      msg.text?.body || msg.image?.caption || msg.document?.caption || '';

    // Buscar la solicitud abierta más reciente donde participe este teléfono de proveedor
    const snap = await db.collection(COLECCION_SOLICITUDES_WSP).get();
    const abiertas = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.estado !== 'adjudicada' && s.estado !== 'cerrada')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const solicitudMatch =
      abiertas.find((s) =>
        (s.proveedoresContactados || []).some((p) =>
          String(p.telefono || '').replace(/[^\d]/g, '').endsWith(remitenteTel.slice(-8))
        )
      ) || abiertas[0];

    if (!solicitudMatch) {
      return res.status(200).json({ received: true, matched: false });
    }

    const provMatch =
      (solicitudMatch.proveedoresContactados || []).find((p) =>
        String(p.telefono || '').replace(/[^\d]/g, '').endsWith(remitenteTel.slice(-8))
      ) || solicitudMatch.proveedoresContactados?.[0];

    const extraido = extraerOfertaDesdeMensajeWsp({
      mensajeTexto: textoEntrante,
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
      id: `of-wsp-meta-${Date.now()}`,
      proveedorId: provMatch?.proveedorId || 'prov-wsp-meta',
      proveedorNombre: provMatch?.proveedorNombre || `Proveedor WhatsApp (+${remitenteTel})`,
      telefonoProveedor: `+${remitenteTel}`,
      mensajeOriginalWsp: textoEntrante,
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
      ganadora: false,
      recibidoEn: now,
    };

    const ofertasActualizadas = [...(solicitudMatch.ofertasRecibidas || []), nuevaOferta];
    await db
      .collection(COLECCION_SOLICITUDES_WSP)
      .doc(solicitudMatch.id)
      .update({
        ofertasRecibidas: ofertasActualizadas,
        estado: 'con_ofertas',
        updatedAt: now,
      });

    return res.status(200).json({ received: true, matched: true, solicitudId: solicitudMatch.id });
  } catch (error) {
    next(error);
  }
});

export default router;
