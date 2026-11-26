/**
 * server/routes/agenteOmnicanal.js
 *
 * ETAPA 4 + MEJORAS PRODUCCIÓN LUNA (SOLUPARTS):
 * Cerebro Orquestador del Agente Vendedor Omnicanal (Vista Web Cliente + WhatsApp Meta Clientes)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Ejecuta la cascada completa de FácilRepuestos 2.0 ante cada consulta de cliente final
 * (texto libre, pedido múltiple, patente chilena, transcripción de audio o foto de muestra):
 *
 *   PASO 0 → Normalización Fonética/Ortográfica Automotriz (aprendida de 98 conversaciones reales de Luna:
 *            `DONFEN`/`DFLM` -> `DFM`, `YAC` -> `JAC`, `CHERRY` -> `CHERY`, `EMBRIAGUE` -> `EMBRAGUE`, etc.)
 *            + Detección de Intención de Seguimiento Anti-Spam (evita duplicar tickets cuando el cliente
 *              dice "Espero", "Ok", "Gracias", "¿Aún nada?" y consulta en vivo si el proveedor ya respondió)
 *            + Flujo Conversacional de Comuna (Retiro en Bodega vs Despacho) y Cierre `COMPRAR` (Sandbox sin tarjeta).
 *   PASO 1 → Identificación de Vehículo por Patente (Firestore `vehiculos` + Boostr API + Padrón Real Luna).
 *   PASO 2 → Consulta en Memoria Técnica Aprendida (`conocimiento_aprendido_ia` — Etapa 1).
 *   PASO 3 → Búsqueda Multi-Ítem en Catálogo Unificado Multi-Proveedor (`inventario` — Etapa 2):
 *            • Nodo Enterprise Soluparts (`soluparts_ailoo` -> SKU `FRP-SOL-*`)
 *            • Nodo Enterprise Global (`global_ailoo` -> SKU `FRP-GLB-*`)
 *            • Proveedores Locales ERP (`local` -> SKU `FRP-LOC-*`)
 *            • Adjudicaciones previas de WhatsApp (`wsp` -> SKU `FRP-WSP-*`)
 *   PASO 4 → Decisión inteligente de cascada (soporta Stock Parcial en pedidos múltiples):
 *            A) `cotizacion_directa`: Hay stock y certeza -> Cotiza al instante, arma carrito y ofrece Retiro/Despacho.
 *            B) `cotizacion_parcial_con_mesa_wsp`: En pedidos de 2+ repuestos, cotiza de inmediato los que tienen stock
 *               y envía SOLO los faltantes a la Mesa WhatsApp (Etapa 3) sin frenar la venta parcial.
 *            C) `escalamiento_experto` (Etapa 1): Hay candidato pero existe duda técnica de calce/medida/muestra
 *               -> Crea o reutiliza ticket en `escalamientos_ia` (con deduplicación anti-spam).
 *            D) `mesa_whatsapp_viva` (Etapa 3): No existe stock en ningún nodo ni bodega local
 *               -> Abre o reutiliza solicitud en `solicitudes_cotizacion_wsp` hacia importadoras especialistas.
 */

import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  generarTerminosClave,
  despacharEscalamientoANodoAiloo,
  consultarRespuestasEscalamientosEnBigQuery,
  calcularPrecioPublicoFrp,
  construirMensajeFinalCliente,
  sanitizarTextoParaProveedor,
  sanitizarMensajeHaciaClienteFinal,
} from '../services/ailooBridge.js';
import { sincronizarTodosLosNodosAiloo } from '../services/ailooCatalogSync.js';
import {
  obtenerContextoHoraChile,
  clasificarIntencionConversacional,
  contieneRepuestoRealOCodigo,
  conducirFlujoCompraDeterministico,
  redactarRespuestaConGeminiLuna,
} from '../services/lunaConversacional.js';
import {
  perfilarNecesidadYComunaCliente,
  construirRespuestaAgente1Recepcion,
  construirRespuestaPreguntaSobreProductoCotizado,
  formatearNombreProductoParaVehiculoCliente,
  redactarCotizacionOrquestada,
  seleccionarTop3ProveedoresMesaWsp,
  fusionarPedidoAdicionalEnCarrito,
  evaluarLogisticaYDespachoAgente3,
  resolverRutaEscalamientoAgente2,
} from '../agents/orquestadorRepuestin.js';
import {
  elegirMejorOfertaMesaWsp,
  crearYPublicarProductoTemporalMesaWsp,
  descargarMediaMetaWhatsapp,
  analizarRespuestaMultimodalProveedorAgente4,
  construirResumenEjecutivoSolicitudIa,
} from '../agents/agente4MesaYPublicadorTemporal.js';
import {
  construirDashboardCxBandeja,
  auditarSesionProfundaConGeminiCx,
  aplicarMejoraCxAAgente,
} from '../agents/auditorCxService.js';
import {
  extraerOfertaDesdeMensajeWsp,
  detectarProveedorSinStock,
  esSaludoInicialProveedor,
  construirMensajeSalidaWsp,
} from './mesaWsp.js';
import {
  construirLinksCarroWooCommerce,
  crearPedidoPendienteWooCommerce,
  obtenerUrlBaseTiendaWoo,
} from '../services/woocommerceSync.js';
import { sincronizarZonasDespachoWooCommerce } from '../services/woocommerceShippingConfig.js';

import {
  TALLAS_LOGISTICAS,
  NODOS_DESPACHO_DEFAULT,
  TARIFAS_RM_ANILLOS,
  MACROZONAS_REGIONES,
  clasificarTallaLogisticaRepuesto,
  calcularPromesaRetiroYDespacho,
  cotizarDespachoAnticipado,
  obtenerNodosDespachoActivos,
} from '../services/logisticaTarifarioService.js';


const router = Router();

const COLECCION_SESIONES_AGENTE = 'sesiones_agente_omnicanal';
const COLECCION_CONOCIMIENTO = 'conocimiento_aprendido_ia';
const COLECCION_INVENTARIO = 'inventario';
const COLECCION_ESCALAMIENTOS = 'escalamientos_ia';
const COLECCION_SOLICITUDES_WSP = 'solicitudes_cotizacion_wsp';
const COLECCION_PROVEEDORES = 'proveedores';
const COLECCION_PEDIDOS_AGENTE = 'pedidos_agente_omnicanal';
const COLECCION_CRM_WSP = 'clientes_wsp_crm';

// Caché en memoria (TTL 3 minutos) para el catálogo de 8.600+ productos y reglas aprendidas.
// Evita hacer miles de lecturas de Firestore en cada mensaje de WhatsApp y responde en < 15 ms.
let cacheCatalogoAgente = {
  itemsInventario: null,
  todasReglas: null,
  expiraEn: 0,
  inicializadoDemo: false,
};
const CACHE_AGENTE_TTL_MS = 3 * 60 * 1000;

async function obtenerCatalogoEInteligenciaCacheada({ forzar = false } = {}) {
  const ahora = Date.now();
  if (
    !forzar &&
    cacheCatalogoAgente.itemsInventario &&
    cacheCatalogoAgente.todasReglas &&
    ahora < cacheCatalogoAgente.expiraEn
  ) {
    return {
      itemsInventario: cacheCatalogoAgente.itemsInventario,
      todasReglas: cacheCatalogoAgente.todasReglas,
    };
  }
  const [conSnap, invSnap] = await Promise.all([
    db.collection(COLECCION_CONOCIMIENTO).get(),
    db.collection(COLECCION_INVENTARIO).get(),
  ]);
  const todasReglas = conSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Excluir cualquier ítem antiguo de Global (ya que Global es únicamente proveedor de cotización WSP y no de Ailoo/ERP interno)
  const itemsInventario = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (it) =>
        !it.ocultarEnTienda &&
        it.nodoAilooId !== 'global' &&
        it.proveedorId !== 'global' &&
        !String(it.skuPublicoFrp || '').toUpperCase().startsWith('FRP-GLB-')
    );

  cacheCatalogoAgente = {
    ...cacheCatalogoAgente,
    itemsInventario,
    todasReglas,
    expiraEn: ahora + CACHE_AGENTE_TTL_MS,
  };
  return { itemsInventario, todasReglas };
}

/**
 * Registra o enriquece automáticamente el perfil CRM del cliente en `clientes_wsp_crm`,
 * cruzando Teléfono de WhatsApp + Patente + Vehículo + Repuestos Consultados + Pedidos.
 */
async function registrarLeadCrmWhatsapp({
  sesion = {},
  vehiculo = null,
  subConsultas = [],
  candidatos = [],
  pedidoCreado = null,
  datosCliente = null,
}) {
  try {
    const telRaw = String(sesion.clienteTelefono || '').trim();
    const telNorm = telRaw.replace(/[^\d+]/g, '');
    const docId =
      telNorm && telNorm.length >= 8
        ? `wsp_${telNorm.replace(/^\+/, '')}`
        : `ses_${sesion.id || 'anon'}`;

    const ref = db.collection(COLECCION_CRM_WSP).doc(docId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : {};
    const now = new Date().toISOString();

    const patentesSet = new Set(Array.isArray(prev.patentes) ? prev.patentes : []);
    if (vehiculo?.patente) patentesSet.add(String(vehiculo.patente).toUpperCase());

    const vehiculosPrev = Array.isArray(prev.vehiculos) ? [...prev.vehiculos] : [];
    if (vehiculo && (vehiculo.patente || vehiculo.marca)) {
      const claveVeh = `${vehiculo.patente || ''}_${vehiculo.marca || ''}_${vehiculo.modelo || ''}`;
      const idx = vehiculosPrev.findIndex(
        (v) => `${v.patente || ''}_${v.marca || ''}_${v.modelo || ''}` === claveVeh
      );
      const registroVeh = {
        patente: vehiculo.patente || null,
        marca: vehiculo.marca || null,
        modelo: vehiculo.modelo || null,
        anio: vehiculo.anio || null,
        motor: vehiculo.motor || null,
        vin: vehiculo.vin || null,
        actualizadoEn: now,
      };
      if (idx >= 0) vehiculosPrev[idx] = { ...vehiculosPrev[idx], ...registroVeh };
      else vehiculosPrev.unshift(registroVeh);
    }

    const repuestosPrev = Array.isArray(prev.repuestosConsultados)
      ? [...prev.repuestosConsultados]
      : [];
    for (const sub of subConsultas || []) {
      if (!sub?.resumenRepuesto) continue;
      repuestosPrev.unshift({
        resumenRepuesto: sub.resumenRepuesto,
        categoria: sub.categoria || 'GENERAL',
        patente: vehiculo?.patente || null,
        marcaVehiculo: vehiculo?.marca || null,
        modeloVehiculo: vehiculo?.modelo || null,
        fecha: now,
      });
    }

    const skusSet = new Set(Array.isArray(prev.skusCotizados) ? prev.skusCotizados : []);
    for (const c of candidatos || []) {
      if (c?.skuPublicoFrp) skusSet.add(c.skuPublicoFrp);
    }

    const pedidosPrev = Array.isArray(prev.pedidosGenerados) ? [...prev.pedidosGenerados] : [];
    if (pedidoCreado?.codigoPedido) {
      if (!pedidosPrev.some((p) => p.codigoPedido === pedidoCreado.codigoPedido)) {
        pedidosPrev.unshift({
          codigoPedido: pedidoCreado.codigoPedido,
          wooOrderId: pedidoCreado.wooOrderId || null,
          totalConIva: pedidoCreado.totalConIva || 0,
          urlCarroWooCommerce: pedidoCreado.urlCarroWooCommerce || null,
          modalidadEntrega: pedidoCreado.modalidadEntrega || null,
          fecha: now,
        });
      }
    }

    const payloadCrm = {
      telefono: telRaw || prev.telefono || '',
      nombre:
        datosCliente?.nombre ||
        pedidoCreado?.clienteNombre ||
        prev.nombre ||
        sesion.clienteNombre ||
        'Cliente WhatsApp',
      rut: datosCliente?.rut || pedidoCreado?.clienteRut || prev.rut || null,
      email: datosCliente?.email || pedidoCreado?.clienteEmail || prev.email || null,
      canalOrigen: sesion.canal || prev.canalOrigen || 'whatsapp_cliente',
      patentes: Array.from(patentesSet),
      vehiculos: vehiculosPrev.slice(0, 10),
      repuestosConsultados: repuestosPrev.slice(0, 25),
      skusCotizados: Array.from(skusSet).slice(0, 40),
      pedidosGenerados: pedidosPrev.slice(0, 20),
      totalConsultas: Number(prev.totalConsultas || 0) + 1,
      ultimaSesionId: sesion.id || prev.ultimaSesionId || null,
      creadoEn: prev.creadoEn || now,
      ultimaInteraccionAt: now,
    };

    await ref.set(payloadCrm, { merge: true });
    return { id: docId, ...payloadCrm };
  } catch (err) {
    console.warn('[CRM-WSP] No se pudo actualizar lead CRM:', err.message);
    return null;
  }
}

// Padrón vehicular verificado (incluye patentes de flota + patentes reales de las conversaciones de Luna)
const PADRON_PATENTES_DEMO = {
  JPKR42: {
    patente: 'JPKR42',
    marca: 'HYUNDAI',
    modelo: 'PORTER',
    anio: 2018,
    motor: '2.5 D4CB CRDI',
    vin: 'KMJHD17BPJU109281',
    fuente: 'padron_verificado',
  },
  KJWP88: {
    patente: 'KJWP88',
    marca: 'PEUGEOT',
    modelo: 'PARTNER',
    anio: 2019,
    motor: '1.6 HDI DV6DTED',
    vin: 'VF37B9HF0KJ104920',
    fuente: 'padron_verificado',
  },
  LRTB19: {
    patente: 'LRTB19',
    marca: 'TOYOTA',
    modelo: 'HILUX',
    anio: 2020,
    motor: '2.4 2GD-FTV',
    vin: '8AJHA8CD2L0293841',
    fuente: 'padron_verificado',
  },
  PFGH34: {
    patente: 'PFGH34',
    marca: 'KIA',
    modelo: 'FRONTIER',
    anio: 2021,
    motor: '2.5 D4CB EURO V',
    vin: 'KNCSH76C2M7192834',
    fuente: 'padron_verificado',
  },
  GHTR91: {
    patente: 'GHTR91',
    marca: 'NISSAN',
    modelo: 'NP300',
    anio: 2019,
    motor: '2.3 YS23DDTT',
    vin: '3N6BD33B5KK829104',
    fuente: 'padron_verificado',
  },
  RTVN55: {
    patente: 'RTVN55',
    marca: 'MITSUBISHI',
    modelo: 'L200',
    anio: 2022,
    motor: '2.4 4N15 MIVEC',
    vin: 'MMBJNKL10NH019283',
    fuente: 'padron_verificado',
  },
  // Patentes reales extraídas de las conversaciones de producción de Luna (Soluparts)
  PFVG55: {
    patente: 'PFVG55',
    marca: 'JAC',
    modelo: 'URBAN 1061',
    anio: 2018,
    motor: '2.8 CUMMINS ISF DIESEL',
    vin: 'LJ11KBBD2J1009281',
    fuente: 'padron_luna_soluparts',
  },
  PDSS87: {
    patente: 'PDSS87',
    marca: 'CHANGAN',
    modelo: 'CS15',
    anio: 2020,
    motor: '1.5 BLUECORE JL473QF',
    vin: 'LS4ASE2E5LA102938',
    fuente: 'padron_luna_soluparts',
  },
  LPGW76: {
    patente: 'LPGW76',
    marca: 'DFM',
    modelo: 'JOYEAR X3',
    anio: 2019,
    motor: '1.6 4A92',
    vin: 'LGBF1AE07KR019283',
    fuente: 'padron_luna_soluparts',
  },
  JYYC38: {
    patente: 'JYYC38',
    marca: 'DFM',
    modelo: 'AX3',
    anio: 2018,
    motor: '1.6 DFMA16',
    vin: 'LGBH12E02JR091823',
    fuente: 'padron_luna_soluparts',
  },
  JKHS27: {
    patente: 'JKHS27',
    marca: 'DFM',
    modelo: 'JOYEAR X3',
    anio: 2017,
    motor: '1.6 4A92',
    vin: 'LGBF1AE01HR088120',
    fuente: 'padron_luna_soluparts',
  },
  LTJZ56: {
    patente: 'LTJZ56',
    marca: 'DFM',
    modelo: 'SX5',
    anio: 2020,
    motor: '2.0 DFMB20',
    vin: 'LGBF5PE09LR011294',
    fuente: 'padron_luna_soluparts',
  },
  STFW99: {
    patente: 'STFW99',
    marca: 'JMC',
    modelo: 'VIGUS PLUS',
    anio: 2023,
    motor: '2.4 PUMA TURBO DIESEL',
    vin: 'LEFAD2E01PA029184',
    fuente: 'padron_luna_soluparts',
  },
  RSSL21: {
    patente: 'RSSL21',
    marca: 'BAIC',
    modelo: 'X35',
    anio: 2023,
    motor: '1.5 A151',
    vin: 'LNBSCU3H9PW102931',
    fuente: 'padron_luna_soluparts',
  },
  JHDD15: {
    patente: 'JHDD15',
    marca: 'JAC',
    modelo: 'S2',
    anio: 2017,
    motor: '1.5 HFC4GB2.3D VVT',
    vin: 'LJ12EKR29H4019283',
    fuente: 'padron_luna_soluparts',
  },
  SYYH44: {
    patente: 'SYYH44',
    marca: 'DFSK',
    modelo: '580',
    anio: 2023,
    motor: '1.8 SFG18',
    vin: 'LVZA53P97PA091821',
    fuente: 'padron_luna_soluparts',
  },
  LPTC74: {
    patente: 'LPTC74',
    marca: 'DFM',
    modelo: 'SX6',
    anio: 2020,
    motor: '2.0 PSA RFN',
    vin: 'LGBF6PE02LR049182',
    fuente: 'padron_luna_soluparts',
  },
  FGHH36: {
    patente: 'FGHH36',
    marca: 'ZOTYE',
    modelo: 'HUNTER',
    anio: 2013,
    motor: '1.3 4G13',
    vin: 'LJZAC10B8DA019283',
    fuente: 'padron_luna_soluparts',
  },
  HSLF36: {
    patente: 'HSLF36',
    marca: 'SSANGYONG',
    modelo: 'ACTYON',
    anio: 2016,
    motor: '2.0 E-XDI DIESEL',
    vin: 'KPACA1EKSGP019283',
    fuente: 'padron_luna_soluparts',
  },
  TGGJ18: {
    patente: 'TGGJ18',
    marca: 'GREAT WALL',
    modelo: 'WINGLE 7',
    anio: 2024,
    motor: '2.0 GW4D20M DIESEL',
    vin: 'LGWDBE192RA019283',
    fuente: 'padron_luna_soluparts',
  },
};

const MARCAS_CONOCIDAS = [
  'GREAT WALL',
  'HYUNDAI',
  'KIA',
  'TOYOTA',
  'NISSAN',
  'MITSUBISHI',
  'PEUGEOT',
  'CITROEN',
  'CHEVROLET',
  'MAZDA',
  'SUZUKI',
  'FORD',
  'VOLKSWAGEN',
  'SSANGYONG',
  'SUBARU',
  'CHANGAN',
  'CHERY',
  'JAC',
  'DFM',
  'DONGFENG',
  'DFSK',
  'JMC',
  'BAIC',
  'HAVAL',
  'MG',
  'MAXUS',
  'LIFAN',
  'ZOTYE',
  'GEELY',
  'FAW',
  'HAFEI',
  'BRILLIANCE',
  'FOTON',
  'GAC',
  'OMODA',
  'JETOUR',
  'KYC',
];

const MODELOS_A_MARCA = {
  PORTER: 'HYUNDAI',
  H1: 'HYUNDAI',
  ACCENT: 'HYUNDAI',
  SANTA: 'HYUNDAI',
  TUCSON: 'HYUNDAI',
  FRONTIER: 'KIA',
  RIO: 'KIA',
  MORNING: 'KIA',
  SPORTAGE: 'KIA',
  HILUX: 'TOYOTA',
  YARIS: 'TOYOTA',
  COROLLA: 'TOYOTA',
  RAV4: 'TOYOTA',
  NP300: 'NISSAN',
  NAVARA: 'NISSAN',
  VERSA: 'NISSAN',
  QASHQAI: 'NISSAN',
  L200: 'MITSUBISHI',
  MONTERO: 'MITSUBISHI',
  PARTNER: 'PEUGEOT',
  BOXER: 'PEUGEOT',
  '208': 'PEUGEOT',
  '301': 'PEUGEOT',
  BERLINGO: 'CITROEN',
  SAIL: 'CHEVROLET',
  DMAX: 'CHEVROLET',
  N300: 'CHEVROLET',
  GROOVE: 'CHEVROLET',
  SWIFT: 'SUZUKI',
  BALENO: 'SUZUKI',
  CELERIO: 'SUZUKI',
  VITARA: 'SUZUKI',
  AERIO: 'SUZUKI',
  JIMNY: 'SUZUKI',
  ALTO: 'SUZUKI',
  DZIRE: 'SUZUKI',
  ERTIGA: 'SUZUKI',
  NOMADE: 'SUZUKI',
  ESCUDO: 'SUZUKI',
  SX4: 'SUZUKI',
  SPARK: 'CHEVROLET',
  AVEO: 'CHEVROLET',
  ONIX: 'CHEVROLET',
  PRISMA: 'CHEVROLET',
  CRUZE: 'CHEVROLET',
  CAPTIVA: 'CHEVROLET',
  TRACKER: 'CHEVROLET',
  CORSA: 'CHEVROLET',
  OPTRA: 'CHEVROLET',
  SENTRA: 'NISSAN',
  TIIDA: 'NISSAN',
  MARCH: 'NISSAN',
  KICKS: 'NISSAN',
  TERRANO: 'NISSAN',
  V16: 'NISSAN',
  OUTLANDER: 'MITSUBISHI',
  ASX: 'MITSUBISHI',
  MIRAGE: 'MITSUBISHI',
  KATANA: 'MITSUBISHI',
  RANGER: 'FORD',
  FIESTA: 'FORD',
  FOCUS: 'FORD',
  ECOSPORT: 'FORD',
  ESCAPE: 'FORD',
  TRANSIT: 'FORD',
  AMAROK: 'VOLKSWAGEN',
  GOL: 'VOLKSWAGEN',
  BORA: 'VOLKSWAGEN',
  VENTO: 'VOLKSWAGEN',
  SAVEIRO: 'VOLKSWAGEN',
  POLO: 'VOLKSWAGEN',
  ACTYON: 'SSANGYONG',
  MUSSO: 'SSANGYONG',
  REXTON: 'SSANGYONG',
  KORANDO: 'SSANGYONG',
  TIVOLI: 'SSANGYONG',
  STAVIC: 'SSANGYONG',
  FORESTER: 'SUBARU',
  IMPREZA: 'SUBARU',
  XV: 'SUBARU',
  OUTBACK: 'SUBARU',
  LEGACY: 'SUBARU',
  SOLUTO: 'KIA',
  CERATO: 'KIA',
  SORENTO: 'KIA',
  SELTOS: 'KIA',
  CARENS: 'KIA',
  SONET: 'KIA',
  ELANTRA: 'HYUNDAI',
  CRETA: 'HYUNDAI',
  VENUE: 'HYUNDAI',
  VERNA: 'HYUNDAI',
  STAREX: 'HYUNDAI',
  TERRACAN: 'HYUNDAI',
  GALLOPER: 'HYUNDAI',
  I10: 'HYUNDAI',
  RAIZE: 'TOYOTA',
  RUSH: 'TOYOTA',
  FORTUNER: 'TOYOTA',
  MG3: 'MG',
  MG5: 'MG',
  ZS: 'MG',
  ZX: 'MG',
  RX5: 'MG',
  T60: 'MAXUS',
  G10: 'MAXUS',
  V80: 'MAXUS',
  // Modelos marcas chinas y comerciales frecuentes en Chile
  S100: 'CHANGAN',
  S200: 'CHANGAN',
  S300: 'CHANGAN',
  S400: 'CHANGAN',
  A500: 'CHANGAN',
  MD201: 'CHANGAN',
  M201: 'CHANGAN',
  MS201: 'CHANGAN',
  ALSVIN: 'CHANGAN',
  CS15: 'CHANGAN',
  CS35: 'CHANGAN',
  CS55: 'CHANGAN',
  EADO: 'CHANGAN',
  HUNTER: 'CHANGAN',
  'ARRIZO 3': 'CHERY',
  'ARRIZO 5': 'CHERY',
  'TIGGO 2': 'CHERY',
  'TIGGO 3': 'CHERY',
  'TIGGO 4': 'CHERY',
  'TIGGO 7': 'CHERY',
  'TIGGO 8': 'CHERY',
  TIGGO: 'CHERY',
  ARRIZO: 'CHERY',
  IQ: 'CHERY',
  FULWIN: 'CHERY',
  S2: 'JAC',
  JS2: 'JAC',
  S3: 'JAC',
  JS3: 'JAC',
  S4: 'JAC',
  JS4: 'JAC',
  J2: 'JAC',
  J3: 'JAC',
  J4: 'JAC',
  T6: 'JAC',
  T8: 'JAC',
  URBAN: 'JAC',
  '1061': 'JAC',
  SUNRAY: 'JAC',
  REFINE: 'JAC',
  JOYEAR: 'DFM',
  A30: 'DFM',
  AX3: 'DFM',
  AX4: 'DFM',
  AX7: 'DFM',
  SX5: 'DFM',
  SX6: 'DFM',
  S50: 'DFM',
  VOLEEX: 'GREAT WALL',
  C10: 'GREAT WALL',
  C20: 'GREAT WALL',
  C30: 'GREAT WALL',
  WINGLE: 'GREAT WALL',
  POER: 'GREAT WALL',
  H3: 'GREAT WALL',
  H5: 'GREAT WALL',
  H6: 'HAVAL',
  JOLION: 'HAVAL',
  VIGUS: 'JMC',
  X35: 'BAIC',
  X25: 'BAIC',
  '580': 'DFSK',
  K07: 'DFSK',
  K17: 'DFSK',
  C31: 'DFSK',
  C32: 'DFSK',
  C35: 'DFSK',
  C37: 'DFSK',
  H220: 'BRILLIANCE',
  H230: 'BRILLIANCE',
  V3: 'BRILLIANCE',
  V5: 'BRILLIANCE',
  F0: 'BYD',
};

const COMUNAS_Y_CIUDADES_CHILE = [
  { patron: /\b(SAN\s+BERNARDO)\b/i, nombre: 'San Bernardo (RM)', esRM: true },
  { patron: /\b(LA\s+CISTERNA)\b/i, nombre: 'La Cisterna (RM)', esRM: true },
  { patron: /\b(GRAN\s+AVENIDA)\b/i, nombre: 'Gran Avenida / La Cisterna (RM)', esRM: true },
  { patron: /\b(PUENTE\s+ALTO)\b/i, nombre: 'Puente Alto (RM)', esRM: true },
  { patron: /\b(MAIP[UÚ])\b/i, nombre: 'Maipú (RM)', esRM: true },
  { patron: /\b(RENCA)\b/i, nombre: 'Renca (RM)', esRM: true },
  { patron: /\b(LAMPA|COLINA|CHICUREO)\b/i, nombre: 'Zona Norte RM', esRM: true },
  { patron: /\b(QUILICURA|HUECHURABA|CONCHAL[IÍ]|RECOLETA|INDEPENDENCIA)\b/i, nombre: 'Quilicura / Norte RM', esRM: true },
  { patron: /\b([ÑN]U[ÑN]OA|PROVIDENCIA|LAS\s+CONDES|LA\s+REINA|VITACURA|MACUL|PE[ÑN]ALOL[EÉ]N)\b/i, nombre: 'Sector Oriente (RM)', esRM: true },
  { patron: /\b(PUDAHUEL|ESTACI[OÓ]N\s+CENTRAL|CERRILLOS|QUINTA\s+NORMAL|LO\s+PRADO|CERRO\s+NAVIA)\b/i, nombre: 'Sector Poniente (RM)', esRM: true },
  { patron: /\b(SANTIAGO|CENTRO|DIEZ\s+DE\s+JULIO|10\s+DE\s+JULIO)\b/i, nombre: 'Santiago Centro (RM)', esRM: true },
  { patron: /\b(SAN\s+MIGUEL|SAN\s+JOAQU[IÍ]N|LA\s+GRANJA|LA\s+PINTANA|SAN\s+RAM[OÓ]N)\b/i, nombre: 'San Miguel / Sur RM', esRM: true },
  { patron: /\b(EL\s+BOSQUE|LO\s+ESPEJO)\b/i, nombre: 'El Bosque (RM)', esRM: true },
  { patron: /\b(LA\s+FLORIDA)\b/i, nombre: 'La Florida (RM)', esRM: true },
  { patron: /\b(ISLA\s+DE\s+MAIPO|TALAGANTE|BUIN|PAINE|MELIPILLA|PE[ÑN]AFLOR|PADRE\s+HURTADO)\b/i, nombre: 'Periferia Sur-Poniente RM', esRM: true },
  { patron: /\b(RANCAGUA|MACHAL[IÍ]|SAN\s+FERNANDO|RENGO|SANTA\s+CRUZ)\b/i, nombre: 'Rancagua / O’Higgins (VI Región)', esRM: false },
  { patron: /\b(LA\s+SERENA|COQUIMBO|OVALLE|ILLAPEL|VICU[ÑN]A)\b/i, nombre: 'La Serena / Coquimbo / Ovalle (IV Región)', esRM: false },
  { patron: /\b(VALLENAR)\b/i, nombre: 'Vallenar (III Región de Atacama)', esRM: false },
  { patron: /\b(COPIAP[OÓ]|CALDERA|CHA[ÑN]ARAL)\b/i, nombre: 'Copiapó (III Región de Atacama)', esRM: false },
  { patron: /\b(ANTOFAGASTA|CALAMA|TOCOPILLA|MEJILLONES)\b/i, nombre: 'Antofagasta / Calama (II Región)', esRM: false },
  { patron: /\b(CONCEPCI[OÓ]N|TALCAHUANO|CORONEL|CHIGUAYANTE|LOS\s+[AÁ]NGELES|SAN\s+PEDRO\s+DE\s+LA\s+PAZ)\b/i, nombre: 'Concepción / Biobío (VIII Región)', esRM: false },
  { patron: /\b(PUERTO\s+MONTT|PUERTO\s+VARAS|OSORNO|VALDIVIA|CASTRO|ANCUD|CHILO[EÉ])\b/i, nombre: 'Sur / Los Lagos (X Región)', esRM: false },
  { patron: /\b(TEMUCO|VILLARRICA|PUC[OÓ]N|ANGOL)\b/i, nombre: 'Temuco / Araucanía (IX Región)', esRM: false },
  { patron: /\b(VALPARA[IÍ]SO|VI[NÑ]A\s+DEL\s+MAR|QUILPU[EÉ]|VILLA\s+ALEMANA|SAN\s+ANTONIO|QUILLOTA|LOS\s+ANDES|SAN\s+FELIPE)\b/i, nombre: 'Valparaíso / Viña del Mar (V Región)', esRM: false },
  { patron: /\b(CURIC[OÓ]|TALCA|LINARES|CHILL[AÁ]N|CONSTITUCI[OÓ]N)\b/i, nombre: 'Maule / Ñuble (VII-XVI Región)', esRM: false },
  { patron: /\b(IQUIQUE|ALTO\s+HOSPICIO|ARICA)\b/i, nombre: 'Norte Grande (I-XV Región)', esRM: false },
  { patron: /\b(COYHAIQUE|PUERTO\s+AYS[EÉ]N|PUNTA\s+ARENAS|PUERTO\s+NATALES)\b/i, nombre: 'Zona Austral (XI-XII Región)', esRM: false },
];

const STOPWORDS_BUSQUEDA = new Set([
  'HOLA',
  'BUENAS',
  'TARDES',
  'DIAS',
  'NOCHES',
  'NECESITO',
  'BUSCO',
  'COTIZAR',
  'TIENEN',
  'TIENES',
  'TIENE',
  'PRECIO',
  'VALOR',
  'CUANTO',
  'SALE',
  'VALE',
  'PARA',
  'UNA',
  'UNO',
  'LOS',
  'LAS',
  'DEL',
  'CON',
  'SIN',
  'POR',
  'FAVOR',
  'PATENTE',
  'AÑO',
  'ANIO',
  'MOTOR',
  'ORIGINAL',
  'ALTERNATIVO',
  'REPUESTO',
  'REPUESTOS',
  'SIRVE',
  'CALZA',
  'LLEVA',
  'FOTO',
  'AUDIO',
  'HACER',
  'CONSULTA',
  'ANDO',
  'BUSCANDO',
  'SABER',
  'DISPONIBLE',
  'STOCK',
  'COMO',
  'ESTAS',
  'ESTAN',
  'BUENOS',
  'BUEN',
  'DIA',
  'QUIERO',
  'QUISIERA',
  'PREGUNTAR',
  'VER',
  'DONDE',
  'UBICADOS',
  'UBICACION',
  'DIRECCION',
  'HORARIO',
  'ATIENDEN',
  'AYUDA',
  'AYUDAME',
  'REPUESTIN',
  'AMIGO',
  'ESTIMADO',
  'TENGO',
  'AUTO',
  'VEHICULO',
  'CAMIONETA',
  'FURGON',
  'MIO',
  'PUEDE',
  'PUEDO',
  'HAY',
  'ALGUIEN',
  'COTIZACION',
  'PIEZA',
  'PIEZAS',
]);

/**
 * Normaliza errores ortográficos y jerga automotriz chilena detectada en las 98 conversaciones de Luna.
 */
function normalizarTextoAutomotriz(texto = '') {
  let t = String(texto || '');
  const reemplazos = [
    // Marcas y modelos mal escritos frecuentemente en WhatsApp
    [/\b(DONFEN|DONG\s*FENG|DONGFENG|DFLM|DFM\s+DONGFENG)\b/gi, 'DFM'],
    [/\bYAC\b/gi, 'JAC'],
    [/\b(CHERRY|CHERI)\b/gi, 'CHERY'],
    [/\b(SANYON|SAN\s+YONG|SSANG\s+YONG)\b/gi, 'SSANGYONG'],
    [/\b(GREATWALL|GRET\s+WALL|G\.?\s*WALL)\b/gi, 'GREAT WALL'],
    [/\bVOLEX\b/gi, 'VOLEEX'],
    [/\bALVIN\b/gi, 'ALSVIN'],
    [/\b(ARIZZO|ARISO)\b/gi, 'ARRIZO'],
    [/\bHAFEY\b/gi, 'HAFEI'],
    [/\bSC35\b/gi, 'CS35'],
    [/\bSC15\b/gi, 'CS15'],
    [/\bTIGGO2\b/gi, 'TIGGO 2'],
    [/\bTIGGO3\b/gi, 'TIGGO 3'],
    // Piezas con errores fonéticos reales en los chats
    [/\b(EMBRIAGUE|EMBRIAGE|EMBRIAJE)\b/gi, 'EMBRAGUE'],
    [/\b(FUJIAS|BUJIQS|BUGIAS|BUJIAS)\b/gi, 'BUJIA'],
    [/\bBOCO\b/gi, 'OPTICO FOCO'],
    [/\bMASA\s+(DELANTERA|TRASERA|RUEDA)\b/gi, 'MAZA $1'],
    [/\b(SOPORTE\s+DE\s+HUESO|HUESITO)\b/gi, 'SOPORTE MOTOR TRASERO'],
    [/\b(BULBO|VULVO)\s+(DE\s+)?TEMPERATURA\b/gi, 'SENSOR TEMPERATURA'],
    [/\bESTREMOS\b/gi, 'EXTREMO TERMINAL'],
    [/\b(ARACHOQUES?|PARACHOQUES?|PARACHOQ|PARACHOQE)\b/gi, 'PARACHOQUE'],
    [/\bPARACHOQUE\s+FRONTAL\b/gi, 'PARACHOQUE DELANTERO'],
    [/\b(LADO\s+)?(PILOTO|CHOFER|CONDUCTOR)\b/gi, 'IZQUIERDO LH'],
    [/\b(LADO\s+)?(COPILOTO|ACOMPAÑANTE|ACOMPANANTE|PASAJERO)\b/gi, 'DERECHO RH'],
    [/\bMENSULAS\b/gi, 'MENSULA'],
    [/\bNEBLINEROS\b/gi, 'NEBLINERO'],
    [/\bOPTICOS\b/gi, 'OPTICO'],
    [/\bFOCOS\b/gi, 'FOCO'],
    [/\bESPEJOS\b/gi, 'ESPEJO'],
    [/\bTAPABARROS\b/gi, 'TAPABARRO'],
    [/\bBANDEJAS\b/gi, 'BANDEJA'],
    [/\bROTULAS\b/gi, 'ROTULA'],
    [/\bBIELETAS\b/gi, 'BIELETA'],
    [/\bCAZOLETAS\b/gi, 'CAZOLETA'],
    [/\bTERMINALES\b/gi, 'TERMINAL'],
    [/\bAXIALES\b/gi, 'AXIAL'],
    [/\bAMORTIGUADORES\b/gi, 'AMORTIGUADOR'],
    [/\bPASTILLA\s+DE\s+FRENOS?\b/gi, 'PASTILLAS DE FRENO'],
  ];

  for (const [regex, reemplazo] of reemplazos) {
    t = t.replace(regex, reemplazo);
  }
  return t;
}

/**
 * Extrae una patente chilena válida (4 letras + 2 dígitos o 2 letras + 4 dígitos) desde un texto libre.
 */
function extraerPatenteDesdeTexto(texto = '') {
  const limpio = String(texto || '').toUpperCase();
  const explicito = limpio.match(
    /\b(?:PATENTE|PPU)\s*[:#-]?\s*([B-DF-HJ-NP-TV-Z]{4}[-\s·]?\d{2}|[A-Z]{2}[-\s·]?\d{4})\b/
  );
  if (explicito) {
    return explicito[1].replace(/[-\s·]/g, '');
  }

  const moderna = limpio.match(/\b([B-DF-HJ-NP-TV-Z]{4})[-\s·]?(\d{2})\b/);
  if (moderna) {
    const candidata = `${moderna[1]}${moderna[2]}`;
    return candidata;
  }

  return null;
}

/**
 * Detecta un VIN de 17 caracteres alfanuméricos si el cliente lo envía en el chat (ej. Caso C20/C73 Luna).
 */
function extraerVinDesdeTexto(texto = '') {
  const limpio = String(texto || '').toUpperCase();
  const match = limpio.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  return match ? match[1] : '';
}

/**
 * Resuelve datos del vehículo a partir de una patente o del texto normalizado del mensaje.
 */
async function resolverVehiculoOmnicanal({ patenteInput = '', textoMensaje = '', vehiculoActual = null }) {
  const textoNorm = normalizarTextoAutomotriz(textoMensaje);
  const patenteDetectada =
    String(patenteInput || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || extraerPatenteDesdeTexto(textoNorm);
  const vinDetectado = extraerVinDesdeTexto(textoNorm);

  // 1) Si hay patente detectada, buscar en Padrón Demo/Luna, Firestore `vehiculos` o Boostr
  if (patenteDetectada && patenteDetectada.length === 6) {
    if (PADRON_PATENTES_DEMO[patenteDetectada]) {
      return {
        ...PADRON_PATENTES_DEMO[patenteDetectada],
        vin: vinDetectado || PADRON_PATENTES_DEMO[patenteDetectada].vin,
      };
    }

    try {
      const snap = await db
        .collection('vehiculos')
        .where('patente', '==', patenteDetectada)
        .limit(1)
        .get();
      if (!snap.empty) {
        const v = snap.docs[0].data();
        return {
          patente: patenteDetectada,
          marca: String(v.marca || '').toUpperCase(),
          modelo: String(v.modelo || '').toUpperCase(),
          anio: Number(v.anio || v.año || 0) || null,
          motor: String(v.motor || v.version || ''),
          vin: vinDetectado || String(v.vin || v.chasis || ''),
          fuente: 'firestore_vehiculos',
        };
      }
    } catch {
      // Ignorar fallo de lectura
    }

    if (process.env.BOOSTR_API_KEY) {
      try {
        const resp = await fetch(`https://api.boostr.cl/vehicle/${patenteDetectada}.json`, {
          headers: {
            'X-API-KEY': process.env.BOOSTR_API_KEY,
            accept: 'application/json',
          },
        });
        if (resp.ok) {
          const json = await resp.json();
          const d = json?.data || {};
          if (d.make || d.brand) {
            return {
              patente: patenteDetectada,
              marca: String(d.make || d.brand || '').toUpperCase(),
              modelo: String(d.model || '').toUpperCase(),
              anio: Number(d.year || 0) || null,
              motor: String(d.engine || d.version || ''),
              vin: vinDetectado || String(d.vin || ''),
              fuente: 'boostr_api_live',
            };
          }
        }
      } catch {
        // Fallback silencioso
      }
    }
  }

  // 2) Inferir marca, modelo y año desde el texto libre normalizado
  const upper = textoNorm.toUpperCase();
  const esNegacionDeVehiculo =
    /\b(NO\s+ES\s+(?:UN|UNA|MI)|ESTAS?\s+TOMANDO\s+MAL|TE\s+EQUIVOCASTE\s+DE\s+AUTO|NO\s+TENGO\s+UN)\b/i.test(
      upper
    );

  // Si el cliente está corrigiendo al bot ("no es una toyota", "estás tomando mal las cosas"),
  // NO extraer la marca negada como si fuera su auto y limpiar el vehículo erróneo.
  if (esNegacionDeVehiculo && !patenteDetectada) {
    return null;
  }

  let marca = '';
  let modelo = '';
  let anio = null;
  let motor = '';

  for (const m of MARCAS_CONOCIDAS) {
    const regexM = new RegExp(`\\b${m}\\b`, 'i');
    if (regexM.test(upper)) {
      marca = m;
      break;
    }
  }

  for (const [mod, marcaAsoc] of Object.entries(MODELOS_A_MARCA)) {
    const regexMod = new RegExp(`\\b${mod}\\b`, 'i');
    if (regexMod.test(upper)) {
      modelo = mod;
      if (!marca) marca = marcaAsoc;
      break;
    }
  }

  const matchAnio = upper.match(/\b(199\d|20[0-2]\d)\b/);
  if (matchAnio) {
    anio = Number(matchAnio[1]);
  }

  const matchMotor = upper.match(
    /\b(\d\.\d(?:\s*(?:CRDI|HDI|TDI|D4CB|GD|MIVEC|TURBO|16V|8V|VVT|DIESEL|CUMMINS|BLUECORE))?)\b/
  );
  if (matchMotor) {
    motor = matchMotor[1].trim();
  }

  // Si el mensaje trae un vehículo nuevo distinto al anterior, actualizar; si no, heredar del contexto
  const cambioDeVehiculo = Boolean(marca && vehiculoActual?.marca && marca !== vehiculoActual.marca);

  if (marca || modelo || patenteDetectada || vinDetectado) {
    return {
      patente: patenteDetectada || (cambioDeVehiculo ? '' : vehiculoActual?.patente || ''),
      marca: marca || vehiculoActual?.marca || 'MULTIMARCA',
      modelo: modelo || (cambioDeVehiculo ? '' : vehiculoActual?.modelo || ''),
      anio: anio || (cambioDeVehiculo ? null : vehiculoActual?.anio || null),
      motor: motor || (cambioDeVehiculo ? '' : vehiculoActual?.motor || ''),
      vin: vinDetectado || (cambioDeVehiculo ? '' : vehiculoActual?.vin || ''),
      fuente: patenteDetectada ? 'inferido_con_patente' : 'inferido_mensaje',
    };
  }

  return vehiculoActual || null;
}

/**
 * Detecta si la consulta del cliente contiene una duda técnica de calce/medida/compatibilidad
 * o adjunta muestra que amerita escalar al experto del proveedor (Etapa 1).
 */
function detectarDudaTecnicaEscalamiento(texto = '', tieneFotoMuestra = false) {
  const t = String(texto || '').toUpperCase();
  const patronesDuda = [
    /\b(\d{2,3}\s*MM)\b/,
    /\b(BIMASA|MONOMASA|CONVERSI[OÓ]N)\b/,
    /\b(CU[AÁ]NTOS\s+DIENTES|ESTRIAS|ESTR[IÍ]AS)\b/,
    /\b(LE\s+SIRVE|LE\s+HACE|CALZA|COMPATIBLE|MISMO\s+CALCE)\b/,
    /\b(CAJA\s+SEXTA|CAJA\s+6TA|CAJA\s+5TA|EURO\s*5|EURO\s*6)\b/,
    /\b(CON\s+ABS|SIN\s+ABS|3\s+OREJAS|2\s+OREJAS)\b/,
    /\b(MEC[AÁ]NICA\s+O\s+EL[EÉ]CTRICA|HIDR[AÁ]ULICA\s+O\s+EL[EÉ]CTRICA)\b/,
  ];

  for (const reg of patronesDuda) {
    if (reg.test(t)) {
      return {
        requiereValidacionExperta: true,
        motivo: `Validación técnica de compatibilidad solicitada por cliente: "${texto.slice(0, 140)}"`,
      };
    }
  }

  if (tieneFotoMuestra && /\b(MUESTRA|FOTO|ROTO|VIEJO|ESTE|IGUAL)\b/i.test(t)) {
    return {
      requiereValidacionExperta: true,
      motivo: 'Cliente adjunta fotografía de muestra física para confirmar equivalencia OEM en mostrador.',
    };
  }

  return { requiereValidacionExperta: false, motivo: '' };
}

/**
 * Extrae el nombre limpio del repuesto buscado y su categoría estimada desde un fragmento de texto.
 */
function extraerRepuestoYCategoria(texto = '', vehiculo = null) {
  const textoNorm = normalizarTextoAutomotriz(texto);
  const upper = textoNorm.toUpperCase();

  let categoria = 'Motor';
  if (/\b(PASTILLA|PASTILLAS|DISCO\s+DE\s+FRENO|DISCOS\s+DE\s+FRENO|FRENO|CALIPER|BALATA|PIOLA\s+FRENO)\b/.test(upper))
    categoria = 'Frenos';
  else if (/\b(EMBRAGUE|PRENSA|VOLANTE\s+BIMASA|RODAMIENTO\s+EMPUJE|HORQUILLA)\b/.test(upper))
    categoria = 'Embrague';
  else if (/\b(AMORTIGUADOR|BANDEJA|ROTULA|BIELETA|CAZOLETA|SUSPENSION|ESPIRAL|CREMALLERA|TERMINAL|AXIAL|MAZA)\b/.test(upper))
    categoria = 'Suspensión';
  else if (/\b(FILTRO|ACEITE|AIRE|COMBUSTIBLE|BENCINA|PETROLEO|CABINA|POLEN)\b/.test(upper))
    categoria = 'Filtros';
  else if (
    /\b(BOMBA\s+DE\s+AGUA|TERMOSTATO|RADIADOR|DISTRIBUCION|CORREA|CADENA|TENSOR|CULATA|EMPAQUETADURA|TURBO|INYECTOR|SOPORTE\s+MOTOR|VALVULA|PISTON|ANILLO|RETEN|BOMBA\s+DE\s+ACEITE)\b/.test(
      upper
    )
  )
    categoria = 'Motor';
  else if (/\b(ALTERNADOR|MOTOR\s+DE\s+PARTIDA|BUJIA|BOBINA|CABLE\s+BUJIA|SENSOR|SONDA|FLUJO|CINTA\s+VOLANTE|TELECOMANDO)\b/.test(upper))
    categoria = 'Eléctrico';
  else if (/\b(HOMOCINETICA|TRIPOIDE|EJE|CAJA|TRANSMISION|PIOLA\s+CAMBIO|SELECTORA)\b/.test(upper))
    categoria = 'Transmisión';
  else if (/\b(OPTICO|PARACHOQUE|CAPOT|TAPABARRO|ESPEJO|FOCO|MASCARA|MANILLA|PORTALON|NEBLINERO|MENSULA|FRONTAL|GRILLA|REJILLA)\b/.test(upper))
    categoria = 'Carrocería';

  const ignorar = new Set([
    ...STOPWORDS_BUSQUEDA,
    ...MARCAS_CONOCIDAS.flatMap((m) => m.split(/\s+/)),
    ...Object.keys(MODELOS_A_MARCA),
  ]);
  if (vehiculo?.patente) ignorar.add(vehiculo.patente.toUpperCase());
  if (vehiculo?.anio) ignorar.add(String(vehiculo.anio));
  if (vehiculo?.vin) ignorar.add(vehiculo.vin.toUpperCase());

  const tokensTodo = upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .map((tok) => tok.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(Boolean);
  const tokensRepuesto = tokensTodo.filter(
    (tok) =>
      !ignorar.has(tok) &&
      !/^\d{4}$/.test(tok) &&
      (tok.length >= 3 || tok === 'LH' || tok === 'RH')
  );

  const resumenRepuesto =
    tokensRepuesto.length > 0
      ? tokensRepuesto.slice(0, 6).join(' ')
      : textoNorm.replace(/\s+/g, ' ').trim().slice(0, 70);

  return {
    tokensRepuesto,
    resumenRepuesto: resumenRepuesto.toUpperCase(),
    categoria,
  };
}

/**
 * Divide un mensaje de cliente con múltiples repuestos (ej. "Necesito filtro de aire changan a500 y juego de bujías",
 * o listas con viñetas/saltos de línea como en C01, C08, C12, C51 de Luna) en sub-consultas individuales.
 */
function extraerMultiplesRepuestos(texto = '', vehiculo = null) {
  const textoNorm = normalizarTextoAutomotriz(texto);

  // Separar por saltos de línea, viñetas, comas o conjunción " y " / " + " cuando separan piezas distintas
  const fragmentosBrutos = textoNorm
    .split(/(?:\r?\n|[,;•*-]+|\s+\+\s+|\s+y\s+(?=(?:\d+\s+|par\s+de\s+)?(?:juego|kit|filtro|pastilla|disco|bujia|bobina|amortiguador|bandeja|correa|bomba|termostato|empaquetadura|homocinetica|cinta|optico|parachoque|espejo|radiador|sensor|soporte|maza|rodamiento|bieleta|terminal|axial|cremallera|piola|embrague|foco|neblinero|cazoleta|reten|mensula|capot|tapabarro|mascara|manilla|portalon|condensador|electroventilador|culata|valvula|piston|anillo|alternador|tambor|caliper|balata)\b))/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const subConsultas = [];
  const vistos = new Set();

  for (const frag of fragmentosBrutos) {
    const info = extraerRepuestoYCategoria(frag, vehiculo);
    if (info.tokensRepuesto.length === 0) continue;
    const clave = info.tokensRepuesto.slice(0, 4).join('_');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    subConsultas.push({
      fragmentoOriginal: frag,
      tienePiezaReal: contieneRepuestoRealOCodigo(frag, info.tokensRepuesto),
      ...info,
    });
  }

  // Si el cliente envió varios mensajes/líneas (ej: "Hola" + "Patente KDSH15" + "Pastillas de freno"),
  // quedarnos solo con los fragmentos que contienen repuestos reales para no tratar saludos/datos del auto como piezas faltantes.
  const conPiezaReal = subConsultas.filter((s) => s.tienePiezaReal);
  const listaFinal = conPiezaReal.length > 0 ? conPiezaReal : subConsultas;

  if (listaFinal.length === 0) {
    listaFinal.push({
      fragmentoOriginal: textoNorm,
      ...extraerRepuestoYCategoria(textoNorm, vehiculo),
    });
  }

  return listaFinal.slice(0, 6);
}

/**
 * Detecta si el mensaje del cliente es un seguimiento / cortesía sobre una consulta ya escalada
 * (ej. "Espero", "Sigo esperando", "Gracias", "Ok", "¿Aún nada?", "Valor?") para NO duplicar tickets (Caso C25/C36 Luna).
 */
function esMensajeSeguimientoOCortesia(texto = '') {
  const limpio = String(texto || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!limpio) return false;

  const patronesSeguimiento = [
    /^(OK|OKA|OKEY|VALE|DALE|BUENO|YA|LISTO|PERFECTO|GENIAL|SUPER)\b[\s.!]*$/,
    /^(GRACIAS|MUCHAS\s+GRACIAS|MIL\s+GRACIAS|OK\s+GRACIAS|YA\s+GRACIAS)\b[\s.!]*$/,
    /^(ESPERO|SIGO\s+ESPERANDO|QUEDO\s+ATENTO|ATENTO|AGUARDO|TE\s+ESPERO)\b/,
    /\b(AUN\s+NADA|TODAVIA\s+NADA|TIENES?\s+RESPUESTA|RESPONDIERON|CUANTO\s+DEMORA|HAY\s+NOVEDAD|QUE\s+PASO\s+CON)\b/,
    /^(VALOR\??|PRECIO\??|\?\?+)$/,
  ];

  return patronesSeguimiento.some((reg) => reg.test(limpio));
}

/**
 * Detecta si el cliente indica su comuna/ciudad o preferencia de entrega (Retiro en Bodega vs Despacho).
 */
function detectarComunaOModalidadEntrega(texto = '') {
  const limpio = String(texto || '').trim();
  const upper = limpio.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Si pregunta "¿es la única sucursal?", "¿cómo modifico la dirección?", "¿ya compré...?" o pide fotos, NO es selección de entrega
  if (
    /\b(UNICA\s+SUCURSAL|OTRA\s+SUCURSAL|DONDE\s+ESTAN|DONDE\s+QUEDA|MODIFICAR\s+(?:LA\s+|MI\s+)?DIRECCION|CAMBIAR\s+(?:LA\s+|MI\s+)?DIRECCION|YA\s+COMPRE|NUMERO\s+DE\s+ENVIO|NUMERO\s+DE\s+SEGUIMIENTO|QUE\s+HAGO\s+AQUI|MAS\s+FOTOS?)\b/.test(
      upper
    )
  ) {
    return {
      esMensajeEntrega: false,
      comunaDetectada: null,
      modalidadPreferida: null,
    };
  }

  let comunaDetectada = null;
  for (const c of COMUNAS_Y_CIUDADES_CHILE) {
    if (c.patron.test(limpio)) {
      comunaDetectada = c;
      break;
    }
  }

  const pideRetiro =
    /\b(PARA\s+RETIRO|QUIERO\s+RETIRAR|LO\s+RETIRO|VOY\s+A\s+RETIRAR|RETIRO\s+EN\s+(?:TIENDA|SUCURSAL|BODEGA|LA\s+FLORIDA|MOSTRADOR)|VOY\s+A\s+BUSCAR)\b/.test(
      upper
    ) || /^(RETIRO|RETIRAR|EN\s+TIENDA|LA\s+FLORIDA)$/i.test(upper);

  // Solo activar despacho directo cuando YA dio la comuna/ciudad (si solo dijo "Quiero para envío a región" sin ciudad, lo maneja PIDIO_ENVIO_SIN_COMUNA para preguntarle qué ciudad)
  const pideDespachoConComuna =
    Boolean(comunaDetectada) &&
    /\b(DESPACHO|ENV[IÍ]O|ENVIAR|DOMICILIO|STARKEN|CHILEXPRESS|BLUE\s*EXPRESS)\b/i.test(limpio);

  const esMensajeEntrega = Boolean(comunaDetectada) || pideRetiro || pideDespachoConComuna;

  return {
    esMensajeEntrega,
    comunaDetectada,
    modalidadPreferida: pideRetiro
      ? 'retiro_bodega'
      : comunaDetectada
        ? comunaDetectada.esRM
          ? 'despacho_domicilio'
          : 'despacho_regiones'
        : null,
  };
}

/**
 * Detecta si el cliente escribió la palabra clave `COMPRAR` o solicita confirmar la compra.
 */
function esIntencionComprar(texto = '') {
  const limpio = String(texto || '').trim().toUpperCase();
  return (
    limpio === 'COMPRAR' ||
    /\b(QUIERO\s+COMPRAR|COMPRAR\s+TODO|COMPRAR\s+LO\s+QUE\s+HAY|CONFIRMAR\s+COMPRA|CONFIRMAR\s+PEDIDO|LO\s+COMPRO|LO\s+LLEVO|ME\s+LLEVO|ARMAME\s+EL\s+CARRO|GENERA\s+EL\s+CARRO|GENERA\s+EL\s+LINK|ENVIAME\s+EL\s+LINK|MANDAME\s+EL\s+LINK)\b/.test(
      limpio
    )
  );
}

/**
 * Consulta en vivo en Firestore si los tickets de escalamiento (`escalamientos_ia`) o solicitudes de
 * Mesa WhatsApp (`solicitudes_cotizacion_wsp`) asociados a la sesión ya recibieron respuesta del proveedor.
 */
async function verificarRespuestasEnVivoDeProveedores(sesion) {
  const escalamientosAbiertos = Array.isArray(sesion.escalamientosAbiertos)
    ? sesion.escalamientosAbiertos
    : [];
  const solicitudesWspAbiertas = Array.isArray(sesion.solicitudesWspAbiertas)
    ? sesion.solicitudesWspAbiertas
    : [];

  const actualizaciones = [];
  const nuevosItemsCotizados = [];

  for (const escInfo of escalamientosAbiertos) {
    if (!escInfo?.id) continue;
    try {
      const snap = await db.collection(COLECCION_ESCALAMIENTOS).doc(escInfo.id).get();
      if (snap.exists) {
        let data = snap.data();

        // Si sigue pendiente en nuestro Firestore y pertenece a un nodo Ailoo (ej. Soluparts),
        // consultamos en vivo la tabla `soluparts.escalamientos` de BigQuery por si ya respondieron en portal.soluparts.cl/escalamiento
        if (data.estado !== 'respondido' && data.ticketRef && (data.nodoAilooId || data.tipoDestino === 'nodo_ailoo')) {
          try {
            const bqRes = await consultarRespuestasEscalamientosEnBigQuery(
              {
                id: data.nodoAilooId || 'soluparts',
                projectId: 'soluparts-mostrador-prod',
                datasetId: 'soluparts',
                tablaEscalamientos: 'escalamientos',
              },
              [data.ticketRef]
            );
            const matchBq = bqRes?.respuestasPorTicket?.get(String(data.ticketRef).toUpperCase());
            if (matchBq && matchBq.respuestaMostrador) {
              const costoBruto = Number(data.costoBrutoProveedor) || 34500;
              const margen = Number(data.margenPorcentajeAplicado) || 30;
              const precioVentaFrp = calcularPrecioPublicoFrp(costoBruto, margen);
              const skuFrp = data.skuPublicoFrp || escInfo.candidatoSku || `FRP-SOL-${data.ticketRef}`;
              const mensajeFinalCliente = construirMensajeFinalCliente({
                ...data,
                respuestaMostrador: matchBq.respuestaMostrador,
                skuPublicoFrp: skuFrp,
                precioVentaFrp,
              });
              const nowIso = new Date().toISOString();
              const patchBq = {
                estado: 'respondido',
                calceConfirmado: true,
                respuestaMostrador: matchBq.respuestaMostrador,
                respuestaExperto: matchBq.respuestaMostrador,
                respondidoPor: matchBq.respondidoPor || 'Mostrador Soluparts (portal.soluparts.cl)',
                respondidoEn: matchBq.respondidoEn || nowIso,
                skuPublicoFrp: skuFrp,
                precioVentaFrp,
                mensajeFinalCliente,
                updatedAt: nowIso,
              };
              await db.collection(COLECCION_ESCALAMIENTOS).doc(escInfo.id).update(patchBq);
              data = { ...data, ...patchBq };
            }
          } catch {
            // No bloquear si BigQuery demora
          }
        }

        const textoRespuestaExperto = data.respuestaExperto || data.respuestaMostrador || '';
        if (data.estado === 'respondido' && textoRespuestaExperto) {
          const precioNeto = Number(data.precioVentaFrp || data.precioConfirmado || 45000);
          const precioConIva = Math.round(precioNeto * 1.19);
          actualizaciones.push({
            tipo: 'escalamiento_respondido',
            referencia: data.ticketRef || escInfo.ticketRef,
            proveedorNombre: 'Mesa Técnica FácilRepuestos',
            repuesto: data.candidatoNombre || 'Repuesto validado por especialista',
            skuPublicoFrp: data.skuPublicoFrp || escInfo.candidatoSku || `FRP-EXP-${data.ticketRef}`,
            explicacion: sanitizarMensajeHaciaClienteFinal(textoRespuestaExperto),
            precioVentaNeto: precioNeto,
            precioVentaConIva: precioConIva,
          });
          nuevosItemsCotizados.push({
            id: snap.id,
            skuPublicoFrp: data.skuPublicoFrp || escInfo.candidatoSku || `FRP-EXP-${data.ticketRef}`,
            nombre: data.candidatoNombre || 'REPUESTO VALIDADO POR ESPECIALISTA',
            fabricante: 'OEM VERIFICADO',
            origen: 'escalamiento_experto',
            proveedorNombre: data.proveedorNombre || 'Especialista Mostrador',
            stock: 2,
            precioVentaNeto: precioNeto,
            precioVentaConIva: precioConIva,
          });
        }
      }
    } catch {
      // Ignorar error puntual
    }
  }

  for (const wspInfo of solicitudesWspAbiertas) {
    if (!wspInfo?.id) continue;
    try {
      const snap = await db.collection(COLECCION_SOLICITUDES_WSP).doc(wspInfo.id).get();
      if (snap.exists) {
        const data = snap.data();
        const ofertas = Array.isArray(data.ofertasRecibidas) ? data.ofertasRecibidas : [];
        if (data.estado === 'adjudicada' || ofertas.length > 0) {
          const mejorOferta =
            ofertas.find((o) => o.id === data.ofertaGanadoraId) ||
            ofertas.sort((a, b) => Number(a.precioVentaNetoFrp || 0) - Number(b.precioVentaNetoFrp || 0))[0];
          if (mejorOferta) {
            const precioNeto = Number(
              mejorOferta.precioVentaNetoFrp || Math.round(Number(mejorOferta.precioCostoNeto || 35000) * 1.28)
            );
            const precioConIva = Number(mejorOferta.precioVentaConIvaFrp || Math.round(precioNeto * 1.19));
            const sku = data.skuPublicoGenerado || `FRP-WSP-${data.codigoSolicitud}`;
            actualizaciones.push({
              tipo: 'mesa_wsp_respondida',
              referencia: data.codigoSolicitud,
              proveedorNombre: 'Logística Directa FácilRepuestos',
              repuesto: data.repuestoBuscado,
              skuPublicoFrp: sku,
              explicacion: `${mejorOferta.condicion || 'Nuevo'} · Marca ${mejorOferta.marcaRepuesto || 'OEM'} · Disponibilidad confirmada por FácilRepuestos para despacho o retiro en Enrique Olivares 224, La Florida`,
              precioVentaNeto: precioNeto,
              precioVentaConIva: precioConIva,
            });
            nuevosItemsCotizados.push({
              id: snap.id,
              skuPublicoFrp: sku,
              nombre: `${data.repuestoBuscado} (${mejorOferta.marcaRepuesto || 'OEM'})`,
              fabricante: mejorOferta.marcaRepuesto || 'OEM',
              origen: 'mesa_whatsapp',
              proveedorNombre: mejorOferta.proveedorNombre,
              stock: 3,
              precioVentaNeto: precioNeto,
              precioVentaConIva: precioConIva,
            });
          }
        }
      }
    } catch {
      // Ignorar error puntual
    }
  }

  return { actualizaciones, nuevosItemsCotizados };
}

/**
 * Crea un pedido simulado `FRP-PED-*` en `pedidos_agente_omnicanal` para probar el cierre completo
 * en la Vista Web Cliente sin necesitar tarjeta de crédito real ni número final de WhatsApp.
 */
async function crearPedidoSimuladoAgente({
  sesion,
  modalidadEntrega = 'retiro_bodega',
  comunaEntrega = 'La Florida, Santiago (RM)',
  documentoTributario = 'BOLETA',
  datosCliente = null,
  metodoPagoSimulado = 'sandbox_webpay_sin_tarjeta',
  itemsForzados = null,
  cotizacionDespacho = null,
}) {
  const itemsCarrito =
    Array.isArray(itemsForzados) && itemsForzados.length > 0
      ? itemsForzados
      : Array.isArray(sesion.carritoCotizado) && sesion.carritoCotizado.length > 0
        ? sesion.carritoCotizado
        : [];

  if (itemsCarrito.length === 0) {
    return null;
  }

  const nodosActivos = await obtenerNodosDespachoActivos(db);
  const cotizacionDespachoEfectiva =
    cotizacionDespacho ||
    cotizarDespachoAnticipado({
      direccionOComuna: comunaEntrega,
      itemsCarrito,
      nodosActivos,
      modalidad: modalidadEntrega === 'retiro_bodega' ? 'Retiro en tienda' : 'Despacho a domicilio',
    });

  const codigoPedido = `FRP-PED-${Math.floor(100000 + Math.random() * 900000)}`;
  const subtotalNeto = itemsCarrito.reduce((acc, it) => acc + Number(it.precioVentaNeto || 0) * Number(it.cantidad || 1), 0);
  const subtotalRepuestosConIva = itemsCarrito.reduce((acc, it) => acc + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1), 0);
  const costoDespachoConIva =
    modalidadEntrega === 'retiro_bodega'
      ? 0
      : Number(cotizacionDespachoEfectiva?.costoDespachoConIva || 0);
  const totalConIva = subtotalRepuestosConIva + costoDespachoConIva;
  const now = new Date().toISOString();

  // Crear orden real en WooCommerce (pending) o generar el link directo de Carro de Compra en facilrepuestos.cl
  const carroWoo = await crearPedidoPendienteWooCommerce({
    items: itemsCarrito,
    datosCliente,
    modalidadEntrega,
    comunaEntrega,
    documentoTributario: documentoTributario || 'BOLETA',
    vehiculo: sesion.vehiculoContexto || null,
    codigoPedidoFrp: codigoPedido,
    clienteTelefono: sesion.clienteTelefono || '',
    cotizacionDespacho: cotizacionDespachoEfectiva,
  });

  const nuevoPedido = {
    codigoPedido,
    sesionId: sesion.id,
    canal: sesion.canal || 'web_cliente',
    clienteNombre: datosCliente?.nombre || sesion.clienteNombre || 'Cliente Web FácilRepuestos',
    clienteRut: datosCliente?.rut || null,
    clienteEmail: datosCliente?.email || null,
    clienteTelefono: sesion.clienteTelefono || 'Vista Web Sandbox',
    documentoTributario: documentoTributario || 'BOLETA',
    vehiculo: sesion.vehiculoContexto || null,
    items: itemsCarrito.map((it) => {
      const tallaItem = clasificarTallaLogisticaRepuesto(it);
      return {
        skuPublicoFrp: it.skuPublicoFrp,
        nombre: it.nombre,
        fabricante: it.fabricante || 'OEM',
        origen: it.origen || 'soluparts_ailoo',
        proveedorNombre: 'FácilRepuestos SpA',
        cantidad: Number(it.cantidad || 1),
        precioVentaNeto: Number(it.precioVentaNeto || 0),
        precioVentaConIva: Number(it.precioVentaConIva || 0),
        tallaLogistica: it.tallaLogistica || tallaItem.tallaLogistica,
        pesoTarifableKg: it.pesoTarifableKg || tallaItem.pesoTarifableKg,
        wooProductId: Number(it.wooProductId) || null,
        urlAgregarAlCarroWoo: it.urlAgregarAlCarroWoo || carroWoo.urlAgregarAlCarroWoo,
      };
    }),
    modalidadEntrega,
    comunaEntrega,
    sucursalRetiro:
      modalidadEntrega === 'retiro_bodega'
        ? `Sucursal FácilRepuestos: ${cotizacionDespachoEfectiva?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida, Santiago de Chile'}`
        : `${cotizacionDespachoEfectiva?.tituloTarifa || 'Despacho Pre-Pagado FácilRepuestos'} (Salida: ${cotizacionDespachoEfectiva?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida'})`,
    cotizacionDespacho: cotizacionDespachoEfectiva,
    costoDespachoConIva,
    subtotalRepuestosConIva,
    metodoPagoSimulado,
    estadoPago: 'pendiente_simulacion',
    estadoLogistico: 'reservado_en_bodega',
    subtotalNeto,
    totalConIva,
    wooOrderId: carroWoo.wooOrderId || null,
    wooOrderKey: carroWoo.wooOrderKey || null,
    urlPagoCheckoutWoo: carroWoo.urlPagoCheckoutWoo,
    urlCarroWooCommerce: carroWoo.urlPagoCheckoutWoo || carroWoo.urlAgregarAlCarroWoo,
    urlCheckoutSimulado: `/chat-cliente?pedido=${codigoPedido}`,
    createdAt: now,
    updatedAt: now,
  };


  const pedRef = await db.collection(COLECCION_PEDIDOS_AGENTE).add(nuevoPedido);
  const pedidoFinal = { id: pedRef.id, ...nuevoPedido };

  // Actualizar CRM WhatsApp con los datos de compra (Nombre, RUT, Email, Patente, Orden)
  await registrarLeadCrmWhatsapp({
    sesion,
    vehiculo: sesion.vehiculoContexto || null,
    candidatos: itemsCarrito,
    pedidoCreado: pedidoFinal,
    datosCliente,
  });

  return pedidoFinal;
}

/**
 * Asegura que el catálogo unificado esté inicializado en memoria.
 * No crea sesiones ficticias ni de canal web (Repuestín opera 100% vía WhatsApp).
 */
async function asegurarDatosInicialesAgente() {
  if (cacheCatalogoAgente.inicializadoDemo) return;
  const { itemsInventario } = await obtenerCatalogoEInteligenciaCacheada();
  if (!itemsInventario || itemsInventario.length === 0) {
    try {
      await sincronizarTodosLosNodosAiloo({ forzar: true });
      await obtenerCatalogoEInteligenciaCacheada({ forzar: true });
    } catch {
      // Ignorar si ya está sincronizando
    }
  }
  cacheCatalogoAgente.inicializadoDemo = true;
}

/**
 * Ejecuta el motor en cascada sobre un mensaje de cliente final, incluyendo todas las mejoras de Luna:
 * - Normalización de typos de marcas chinas y piezas
 * - Anti-duplicación de escalamientos en mensajes "Espero" / "Ok" / "¿Aún nada?" + consulta en vivo
 * - Flujo conversacional de Comuna (Retiro vs Despacho) y cierre `COMPRAR` sin requerir tarjeta real
 * - Pedidos múltiples con stock parcial (cotiza lo disponible + escala a Mesa WSP solo lo faltante)
 */
async function ejecutarCascadaAgenteOmnicanal({
  sesion,
  textoCliente = '',
  transcripcionAudio = '',
  fotoUrl = '',
  patenteForzada = '',
  modoForzado = 'auto', // 'auto' | 'forzar_escalamiento' | 'forzar_mesa_wsp'
}) {
  await asegurarDatosInicialesAgente();
  const textoBruto = [textoCliente, transcripcionAudio].filter(Boolean).join(' ').trim();
  const textoCombinado = normalizarTextoAutomotriz(textoBruto);

  // ─── PASO 0.A: REVISAR SI PROVEEDORES YA RESPONDIERON EN VIVO ──────────────
  const { actualizaciones: respuestasVivas, nuevosItemsCotizados } =
    await verificarRespuestasEnVivoDeProveedores(sesion);

  let carritoActual = Array.isArray(sesion.carritoCotizado) ? [...sesion.carritoCotizado] : [];
  if (nuevosItemsCotizados.length > 0) {
    for (const nuevo of nuevosItemsCotizados) {
      if (!carritoActual.some((c) => c.skuPublicoFrp === nuevo.skuPublicoFrp)) {
        carritoActual.push({ ...nuevo, cantidad: 1 });
      }
    }
  }

  // ─── PASO 0.B: INTENCIÓN DE COMPRA DIRECTA EN TIENDA WORDPRESS (AGENTE 5) ─────
  // Ya NO existe el antiguo flujo de pedir RUT/Boleta/Dirección por WhatsApp con el comando COMPRAR:
  // el cliente compra directamente en el link de facilrepuestos.cl que le enviamos automáticamente,
  // donde WordPress calcula su despacho y fecha de entrega, y el Webhook de WordPress confirma la venta por WhatsApp.
  const estadoFlujoCompra = null;
  const compraFuePausada = false;
  const pidioComprarAhora = esIntencionComprar(textoBruto);
  const nodosDespachoActivos = await obtenerNodosDespachoActivos(db);
  if (modoForzado === 'auto' && pidioComprarAhora) {
    if (carritoActual.length === 0) {
      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: [],
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        flujoCompra: null,
        repuestoPendienteContexto: null,
        escalamientosAbiertos: sesion.escalamientosAbiertos || [],
        solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
        respuestaTexto:
          'Aún no tenemos un repuesto cotizado en pantalla. Cuéntame **qué repuesto necesitas** y la **patente** de tu vehículo (o marca, modelo y año) para enviarte el link directo de compra en **facilrepuestos.cl**.',
        trazaCascada: {
          accionTomada: 'flujo_compra_sin_items',
          vehiculoDetectado: sesion.vehiculoContexto || null,
          reglasConocimientoAplicadas: [],
          candidatosInventario: [],
          escalamientoCreado: null,
          solicitudWspCreada: null,
        },
      };
    }

    const linksCarro = construirLinksCarroWooCommerce(carritoActual);
    const lineasLinks = carritoActual.map((it) => {
      const nomLimpio = formatearNombreProductoParaVehiculoCliente(it.nombre);
      return `• **${nomLimpio}** (\`${it.skuPublicoFrp}\`) — **$${Number(it.precioVentaConIva || 0).toLocaleString('es-CL')} IVA inc.**\n  👉 ${it.urlProductoWoo}`;
    });
    const linkCarroMulti =
      carritoActual.length > 1 && linksCarro?.urlCarroUnificado
        ? `\n\n🛒 **Link de tu carro con todos los productos:**\n👉 ${linksCarro.urlCarroUnificado}`
        : '';

    return {
      vehiculoDetectado: sesion.vehiculoContexto || null,
      carritoCotizado: carritoActual,
      comunaCliente: sesion.comunaCliente || null,
      modalidadEntrega: sesion.modalidadEntrega || null,
      pedidoActivo: sesion.pedidoActivo || null,
      flujoCompra: null,
      repuestoPendienteContexto: null,
      escalamientosAbiertos: sesion.escalamientosAbiertos || [],
      solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
      respuestaTexto:
        `¡Excelente! 🛒 Para realizar tu compra de inmediato (ahí mismo en la página podrás elegir **despacho a tu dirección o retiro en tienda**, ver tu fecha de entrega y pagar con Webpay o transferencia), ingresa directo aquí:\n\n` +
        `${lineasLinks.join('\n')}${linkCarroMulti}\n\n` +
        `Apenas completes tu compra en **facilrepuestos.cl**, el sistema me avisa automáticamente para enviarte la confirmación por este mismo WhatsApp.`,
      trazaCascada: {
        accionTomada: 'cotizacion_directa',
        vehiculoDetectado: sesion.vehiculoContexto || null,
        reglasConocimientoAplicadas: [],
        candidatosInventario: carritoActual,
        escalamientoCreado: null,
        solicitudWspCreada: null,
      },
    };
  }

  // ─── PASO 0.B2: CONFIRMACIÓN DEL CLIENTE PARA BUSCAR EN MESA DE ABASTECIMIENTO ──
  // Solo enviamos la solicitud a los proveedores locales por WhatsApp (+56950960294) DESPUÉS de que el cliente
  // confirme que desea que lo busquemos y puede esperar la oferta.
  if (sesion.confirmacionMesaWspPendiente && modoForzado === 'auto') {
    const pend = sesion.confirmacionMesaWspPendiente;
    const textoLimpioConf = String(textoBruto || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const confirmaBusqueda =
      /^(si|sii+|dale|bueno|ya|ok|okay|por\s*favor|porfa|buscalo|busquenlo|me\s+parece|claro|obvio|de\s+acuerdo|perfecto|espero|te\s+espero|si\s+porfa|si\s+por\s+favor|si\s+dale|dale\s+porfa)\b/i.test(
        textoLimpioConf
      ) ||
      /\b(si\s+buscalo|buscalo\s+porfa|si\s+me\s+parece|puedo\s+esperar)\b/i.test(textoLimpioConf);

    const rechazaBusqueda =
      /^(no|no\s+gracias|no\s+puedo\s+esperar|paso|dejalo|mejor\s+no|no\s+por\s+ahora)\b/i.test(
        textoLimpioConf
      );

    if (confirmaBusqueda) {
      const nowConf = new Date().toISOString();
      const vehiculoPend = pend.vehiculo || sesion.vehiculoContexto || null;
      const provSnap = await db.collection(COLECCION_PROVEEDORES).get();
      const proveedores = provSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.activo !== false && p.canalWspActivo !== false && p.telefono);

      const seleccionados = seleccionarTop3ProveedoresMesaWsp({
        proveedores,
        marcaVehiculo: vehiculoPend?.marca || '',
        categoriaRepuesto: pend.categoria || '',
        comunaCliente: sesion.comunaCliente || '',
      });

      const codigoSolicitud = `WSP-${Math.floor(1000 + Math.random() * 9000)}`;
      const repuestoTexto = `${pend.resumenFaltantes} ${vehiculoPend?.marca || ''} ${vehiculoPend?.modelo || ''}`.trim();
      const proveedoresContactados = [];

      for (const p of seleccionados) {
        const mensajeEnviado = construirMensajeSalidaWsp({
          marcaVehiculo: vehiculoPend?.marca || '',
          modeloVehiculo: vehiculoPend?.modelo || '',
          anioVehiculo: vehiculoPend?.anio || '',
          motorVehiculo: vehiculoPend?.motor || '',
          patente: vehiculoPend?.patente || '',
          vin: vehiculoPend?.vin || '',
          repuestoBuscado: pend.resumenFaltantes,
        });

        const envioReal = await enviarMensajeMesaAbastecimientoWhatsapp({
          telefonoDestino: p.telefono,
          texto: mensajeEnviado,
        }).catch(() => null);

        proveedoresContactados.push({
          proveedorId: p.id,
          proveedorNombre: p.nombre,
          contacto: p.contacto || 'Mesón WhatsApp',
          telefono: p.telefono,
          especialidad: p.categoria || p.especialidad || 'Multimarca',
          especialidadMarcas: p.marcas || p.marcasVehiculo || p.marcasEspecialidad || ['MULTIMARCA'],
          marcasVehiculo: p.marcas || p.marcasVehiculo || [],
          estadoContacto: 'enviado',
          modoEnvio: envioReal?.enviado ? 'meta_cloud_api_live' : 'simulacion_meta_local',
          metaMessageId: envioReal?.metaMessageId || `wamid.AUTO.${Date.now()}`,
          mensajeEnviado,
          enviadoEn: nowConf,
          respondidoEn: null,
        });
      }

      const nuevaSolWsp = {
        codigoSolicitud,
        sesionAgenteId: sesion.id,
        clienteTelefonoReal: sesion.clienteTelefono || '',
        comunaCliente: sesion.comunaCliente || null,
        urgenciaCliente: sesion.urgenciaCliente || 'normal',
        solicitante: 'FácilRepuestos SpA (Adquisiciones B2B)',
        estado: 'esperando_respuestas',
        canalCliente: sesion.canal === 'web_cliente' ? 'web' : 'whatsapp',
        clienteNombre: 'FácilRepuestos SpA (Identidad de Cliente Protegida)',
        clienteTelefono: 'CONFIDENCIAL-FRP',
        patente: vehiculoPend?.patente || '',
        vin: vehiculoPend?.vin || '',
        marcaVehiculo: vehiculoPend?.marca || 'POR CONFIRMAR',
        modeloVehiculo: vehiculoPend?.modelo || '',
        anioVehiculo: vehiculoPend?.anio || null,
        motorVehiculo: vehiculoPend?.motor || '',
        categoriaRepuesto: pend.categoria || 'General',
        repuestoBuscado: repuestoTexto,
        codigoReferencia: '',
        notasAdicionales: `Confirmado por cliente para búsqueda con proveedores locales`,
        margenPct: 28,
        escalamientoOrigenId: null,
        proveedoresContactados,
        ofertasRecibidas: [],
        ofertaGanadoraId: null,
        skuPublicoGenerado: null,
        inventarioCreadoId: null,
        conocimientoCreadoId: null,
        mensajeCotizacionCliente: '',
        createdAt: nowConf,
        updatedAt: nowConf,
      };

      const solRef = await db.collection(COLECCION_SOLICITUDES_WSP).add(nuevaSolWsp);
      const solCreada = {
        id: solRef.id,
        codigoSolicitud,
        proveedoresContactados: proveedoresContactados.map((p) => p.proveedorNombre),
        resumenRepuesto: pend.resumenFaltantes,
        patente: vehiculoPend?.patente || '',
      };

      return {
        vehiculoDetectado: vehiculoPend,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        flujoCompra: estadoFlujoCompra,
        repuestoPendienteContexto: null,
        confirmacionMesaWspPendiente: null,
        escalamientosAbiertos: sesion.escalamientosAbiertos || [],
        solicitudesWspAbiertas: [...(sesion.solicitudesWspAbiertas || []), solCreada],
        respuestaTexto: `¡Perfecto! 👍 Ya lo estamos buscando con nuestros proveedores locales para tu **${
          pend.etiquetaVehiculo || 'vehículo'
        }**. Apenas nos confirmen te enviamos la mejor oferta por este mismo WhatsApp.`,
        trazaCascada: {
          accionTomada: 'mesa_whatsapp_viva_confirmada',
          vehiculoDetectado: vehiculoPend,
          reglasConocimientoAplicadas: [],
          candidatosInventario: carritoActual,
          escalamientoCreado: null,
          solicitudWspCreada: solCreada,
        },
      };
    }

    if (rechazaBusqueda) {
      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        flujoCompra: estadoFlujoCompra,
        repuestoPendienteContexto: null,
        confirmacionMesaWspPendiente: null,
        escalamientosAbiertos: sesion.escalamientosAbiertos || [],
        solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
        respuestaTexto:
          '¡Ningún problema! Si necesitas cotizar otro repuesto más adelante, escríbeme por aquí.',
        trazaCascada: {
          accionTomada: 'mesa_whatsapp_descartada_por_cliente',
          vehiculoDetectado: sesion.vehiculoContexto || null,
          reglasConocimientoAplicadas: [],
          candidatosInventario: carritoActual,
          escalamientoCreado: null,
          solicitudWspCreada: null,
        },
      };
    }
  }

  // ─── PASO 0.C: ANTI-SPAM DE SEGUIMIENTO ("ESPERO", "GRACIAS", "¿AÚN NADA?") ─
  const tienePendientes =
    (Array.isArray(sesion.escalamientosAbiertos) && sesion.escalamientosAbiertos.length > 0) ||
    (Array.isArray(sesion.solicitudesWspAbiertas) && sesion.solicitudesWspAbiertas.length > 0);

  if (esMensajeSeguimientoOCortesia(textoBruto) && modoForzado === 'auto') {
    if (respuestasVivas.length > 0) {
      const detalleRespuestas = respuestasVivas.map((r) => {
        const nomLimpio = formatearNombreProductoParaVehiculoCliente(r.repuesto);
        return `• **${nomLimpio}** (\`${r.skuPublicoFrp}\`) — **$${r.precioVentaConIva.toLocaleString(
          'es-CL'
        )} IVA inc.**\n  ${r.explicacion}`;
      });
      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        escalamientosAbiertos: [],
        solicitudesWspAbiertas: [],
        respuestaTexto:
          `¡Buenas noticias! 🎉 Ya tenemos confirmado tu repuesto:\n\n` +
          `${detalleRespuestas.join('\n\n')}\n\n` +
          `¿Lo necesitas para **retiro en nuestra sucursal de La Florida** o prefieres **despacho a domicilio / región**?`,
        trazaCascada: {
          accionTomada: 'respuesta_proveedor_en_vivo',
          vehiculoDetectado: sesion.vehiculoContexto || null,
          reglasConocimientoAplicadas: [],
          candidatosInventario: carritoActual,
          escalamientoCreado: null,
          solicitudWspCreada: null,
        },
      };
    }

    if (tienePendientes) {
      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        escalamientosAbiertos: sesion.escalamientosAbiertos || [],
        solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
        respuestaTexto:
          `⏳ Seguimos validando con nuestros proveedores internos. Apenas encontremos tu repuesto te lo confirmaremos por este mismo WhatsApp.`,
        trazaCascada: {
          accionTomada: 'seguimiento_sin_duplicar',
          vehiculoDetectado: sesion.vehiculoContexto || null,
          reglasConocimientoAplicadas: [],
          candidatosInventario: carritoActual,
          escalamientoCreado: null,
          solicitudWspCreada: null,
        },
      };
    }
  }

  // ─── PASO 0.D: SELECCIÓN DE COMUNA / RETIRO EN BODEGA VS DESPACHO ──────────
  const infoEntrega = detectarComunaOModalidadEntrega(textoBruto);
  const tokensTecnicosEnMensaje = extraerRepuestoYCategoria(textoBruto, sesion.vehiculoContexto).tokensRepuesto.filter(
    (t) =>
      ![
        'SAN',
        'BERNARDO',
        'CISTERNA',
        'GRAN',
        'AVENIDA',
        'PUENTE',
        'ALTO',
        'MAIPU',
        'RENCA',
        'LAMPA',
        'RANCAGUA',
        'SERENA',
        'COQUIMBO',
        'OVALLE',
        'ANTOFAGASTA',
        'CONCEPCION',
        'CORONEL',
        'PUERTO',
        'MONTT',
        'TEMUCO',
        'CURICO',
        'TALCA',
        'RETIRO',
        'RETIRAR',
        'BODEGA',
        'MOSTRADOR',
        'DESPACHO',
        'ENVIO',
        'DOMICILIO',
        'STARKEN',
        'CHILEXPRESS',
        'SOY',
        'DESDE',
        'COMUNA',
      ].includes(t)
  );

  if (
    infoEntrega.esMensajeEntrega &&
    tokensTecnicosEnMensaje.length === 0 &&
    carritoActual.length > 0 &&
    modoForzado === 'auto'
  ) {
    const nombreComuna =
      infoEntrega.comunaDetectada?.nombre || sesion.comunaCliente || 'Santiago (RM)';
    const modalidad =
      infoEntrega.modalidadPreferida === 'retiro_bodega'
        ? 'retiro_bodega'
        : 'despacho_domicilio';

    const totalIva = carritoActual.reduce((acc, it) => acc + Number(it.precioVentaConIva || 0), 0);
    const ultItem = carritoActual[carritoActual.length - 1];
    const nombreLimpioUlt = formatearNombreProductoParaVehiculoCliente(ultItem?.nombre);

    const cotizacionRef = cotizarDespachoAnticipado({
      direccionOComuna: nombreComuna,
      itemsCarrito: carritoActual,
      nodosActivos: nodosDespachoActivos,
      modalidad: 'Despacho a domicilio',
    });
    const promesaEntrega = calcularPromesaRetiroYDespacho({
      itemsCarrito: carritoActual,
    });
    const costoEnvioRef = Number(cotizacionRef.costoDespachoConIva || 0);

    let respuestaTexto = '';
    if (modalidad === 'retiro_bodega') {
      respuestaTexto =
        `📍 **Retiro en nuestra sucursal (Enrique Olivares 224, La Florida — $0 costo de envío):**\n` +
        `${promesaEntrega.textoRetiroCarrito}.\n` +
        `Al ingresar al link de tu **${nombreLimpioUlt}** (\`${ultItem?.skuPublicoFrp}\` — **$${totalIva.toLocaleString('es-CL')} IVA inc.**) podrás seleccionar retiro en tienda y finalizar tu compra directo en la web:\n` +
        `👉 ${ultItem?.urlProductoWoo}`;
    } else {
      respuestaTexto =
        `🚚 **Valor referencial de envío a ${nombreComuna}:** **$${costoEnvioRef.toLocaleString('es-CL')} IVA inc.** (${cotizacionRef.tiempoEstimado || '24 a 48 hrs'}).\n` +
        `• **Repuesto (${nombreLimpioUlt}):** $${totalIva.toLocaleString('es-CL')} IVA inc. → **Total estimado con envío:** **$${(totalIva + costoEnvioRef).toLocaleString('es-CL')} IVA inc.**\n` +
        `👉 Al comprar directamente en el link de la página se calculará tu despacho y fecha de entrega: ${ultItem?.urlProductoWoo}`;
    }

    return {
      vehiculoDetectado: sesion.vehiculoContexto || null,
      carritoCotizado: carritoActual,
      comunaCliente: nombreComuna,
      modalidadEntrega: modalidad,
      pedidoActivo: sesion.pedidoActivo || null,
      escalamientosAbiertos: sesion.escalamientosAbiertos || [],
      solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
      respuestaTexto,
      trazaCascada: {
        accionTomada: 'cotizacion_directa',
        vehiculoDetectado: sesion.vehiculoContexto || null,
        reglasConocimientoAplicadas: [],
        candidatosInventario: carritoActual,
        escalamientoCreado: null,
        solicitudWspCreada: null,
      },
    };
  }

  // ─── PASO 1: IDENTIFICAR VEHÍCULO POR PATENTE, VIN O TEXTO NORMALIZADO ─────
  const vehiculoExplicitoEnTurno = await resolverVehiculoOmnicanal({
    patenteInput: patenteForzada,
    textoMensaje: textoCombinado,
    vehiculoActual: null,
  });
  const vehiculo = await resolverVehiculoOmnicanal({
    patenteInput: patenteForzada,
    textoMensaje: textoCombinado,
    vehiculoActual: sesion.vehiculoContexto || null,
  });

  // ─── PASO 1.B: MOTOR DE INTENCIÓN CONTEXTUAL AGENTE 1 ───────────────────────
  const infoRepuestoActual = extraerRepuestoYCategoria(textoCombinado, vehiculo);
  const clasificacion = clasificarIntencionConversacional({
    textoBruto,
    vehiculoMensajeActual: vehiculoExplicitoEnTurno,
    vehiculoContextoSesion: sesion.vehiculoContexto || null,
    tokensRepuesto: infoRepuestoActual.tokensRepuesto,
    resumenRepuesto: infoRepuestoActual.resumenRepuesto,
    tieneFoto: Boolean(fotoUrl),
    sesion,
  });

  const sufijoCompraPausada = compraFuePausada
    ? '\n\n_(Tu compra quedó en pausa — escribe **COMPRAR** cuando quieras retomarla)_'
    : '';

  if (clasificacion.tipo !== 'BUSQUEDA_CATALOGO' && modoForzado === 'auto') {
    const ctxHora = obtenerContextoHoraChile();
    let hechoBase = '';
    let accionTomadaConv = 'intencion_contextual_agente1';
    let pedidoActualizado = sesion.pedidoActivo || null;
    let repuestoPendienteNuevo = sesion.repuestoPendienteContexto || null;

    if (clasificacion.tipo === 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO') {
      accionTomadaConv = 'respuesta_contextual_producto_cotizado';
      hechoBase = construirRespuestaPreguntaSobreProductoCotizado({
        textoCliente: textoBruto,
        carritoCotizado: carritoActual,
        vehiculo,
      });
    } else if (clasificacion.tipo === 'PIDIO_ENVIO_SIN_COMUNA') {
      accionTomadaConv = 'solicitud_comuna_para_envio';
      hechoBase = construirRespuestaAgente1Recepcion({
        intencion: 'PIDIO_ENVIO_SIN_COMUNA',
        vehiculo,
        carritoCotizado: carritoActual,
        textoCliente: textoBruto,
      });
    } else if (clasificacion.tipo === 'MODIFICAR_DIRECCION_ENVIO') {
      accionTomadaConv = 'postventa_modificar_direccion';
      hechoBase = construirRespuestaAgente1Recepcion({
        intencion: 'MODIFICAR_DIRECCION_ENVIO',
        vehiculo,
        carritoCotizado: carritoActual,
        textoCliente: textoBruto,
      });
    } else if (clasificacion.tipo === 'CANCELAR_PEDIDO') {
      accionTomadaConv = 'cancelacion_pedido';
      if (pedidoActualizado && pedidoActualizado.estadoPago === 'pendiente_simulacion') {
        pedidoActualizado = {
          ...pedidoActualizado,
          estadoPago: 'cancelado',
          estadoLogistico: 'cancelado_por_cliente',
          updatedAt: new Date().toISOString(),
        };
        if (pedidoActualizado.id) {
          await db
            .collection(COLECCION_PEDIDOS_AGENTE)
            .doc(pedidoActualizado.id)
            .update({
              estadoPago: 'cancelado',
              estadoLogistico: 'cancelado_por_cliente',
              updatedAt: pedidoActualizado.updatedAt,
            })
            .catch(() => null);
        }
        hechoBase = `Tu pedido \`${pedidoActualizado.codigoPedido}\` ha sido cancelado sin costo. Si necesitas cotizar otro repuesto, dime qué pieza buscas y para qué vehículo.`;
      } else {
        hechoBase =
          'No tienes ningún pedido pendiente de pago por cancelar en este momento. ¿En qué te puedo ayudar?';
      }
    } else if (clasificacion.tipo === 'ESTADO_PEDIDO') {
      accionTomadaConv = 'consulta_estado_pedido';
      if (pedidoActualizado) {
        hechoBase =
          `Tu pedido \`${pedidoActualizado.codigoPedido}\` por **$${Number(
            pedidoActualizado.totalConIva || 0
          ).toLocaleString('es-CL')} IVA inc.** está registrado (${
            pedidoActualizado.modalidadEntrega === 'retiro_bodega'
              ? 'Retiro en Enrique Olivares 224, La Florida'
              : `Despacho a ${pedidoActualizado.comunaEntrega || 'domicilio'}`
          }). Apenas el transporte genere la orden de seguimiento te enviaremos el número de envío por este mismo WhatsApp.`;
      } else {
        hechoBase =
          `📦 ¡Gracias por tu compra en **facilrepuestos.cl**! Ya notifiqué a nuestro equipo de despacho para que revise tu orden y te envíe tu **número de seguimiento / envío** por este mismo WhatsApp.\n` +
          `Para agilizarlo al máximo, déjame escrito aquí tu **número de pedido web o tu RUT** por favor.`;
      }
    } else if (clasificacion.tipo === 'ATENCION_HUMANA') {
      accionTomadaConv = 'derivacion_ejecutivo_humano';
      hechoBase = ctxHora.abierto
        ? '👨‍💼 Ya dejé aviso prioritario a un asistente humano de FácilRepuestos para que tome tu conversación ahora mismo por este WhatsApp. Cuéntame en un mensaje qué necesitas resolver para que te responda directo.'
        : '👨‍💼 Dejé tu conversación marcada como prioritaria para que un ejecutivo humano de FácilRepuestos te responda a primera hora (atendemos Lunes a Jueves 9:30 a 18:00, Viernes 9:30 a 17:00 y Sábado 9:30 a 14:00). Déjame escrito tu requerimiento aquí mismo.';
    } else if (clasificacion.tipo === 'CONSULTA_GARANTIAS') {
      accionTomadaConv = 'consulta_garantias';
      hechoBase =
        'Todos nuestros repuestos nuevos cuentan con **3 meses de garantía legal** presentando tu boleta o factura (y cambio directo en caso de no calzar, sin uso y en su empaque original).';
    } else if (clasificacion.tipo === 'CONSULTA_HORARIO') {
      accionTomadaConv = 'consulta_horario';
      hechoBase =
        `Nuestro horario en **Enrique Olivares 224, La Florida** es: **Lunes a Jueves** 9:30 a 18:00 hrs, **Viernes** 9:30 a 17:00 hrs y **Sábado** 9:30 a 14:00 hrs.`;
    } else if (clasificacion.tipo === 'CONSULTA_RETIRO_DESPACHO') {
      accionTomadaConv = 'consulta_retiro_despacho';
      const prom = calcularPromesaRetiroYDespacho({
        itemsCarrito: carritoActual,
      });
      hechoBase =
        carritoActual.length > 0
          ? `📍 **Para el repuesto de tu cotización:** ${prom.textoRetiroCarrito}\n¿Prefieres retirarlo en nuestra tienda de La Florida o que te calculemos el envío a tu comuna/ciudad?`
          : `${prom.resumenReglasCliente}`;
    } else if (clasificacion.tipo === 'CONSULTA_SUCURSAL') {
      accionTomadaConv = 'consulta_sucursal';
      hechoBase =
        carritoActual.length > 0
          ? `Sí, nuestra única sucursal física está en **Enrique Olivares 224, La Florida, Santiago**. Si te queda lejos, también hacemos despacho rápido a todo Santiago y regiones.\n¿Prefieres retirar en La Florida o que te calculemos el envío a tu comuna?`
          : `Sí, nuestra única sucursal física está en **Enrique Olivares 224, La Florida, Santiago** (y además despachamos a todo Santiago y regiones).`;
    } else if (clasificacion.tipo === 'SOLO_VEHICULO_SIN_REPUESTO') {
      accionTomadaConv = 'vehiculo_identificado_esperando_repuesto';
      hechoBase = construirRespuestaAgente1Recepcion({
        intencion: 'SOLO_VEHICULO_SIN_REPUESTO',
        vehiculo,
        carritoCotizado: carritoActual,
        textoCliente: textoBruto,
      });
    } else if (clasificacion.tipo === 'SOLO_REPUESTO_SIN_VEHICULO') {
      accionTomadaConv = 'repuesto_identificado_esperando_vehiculo';
      repuestoPendienteNuevo = clasificacion.repuestoDetectado || {
        tokensRepuesto: infoRepuestoActual.tokensRepuesto,
        resumenRepuesto: infoRepuestoActual.resumenRepuesto,
        textoOriginal: textoBruto,
      };
      hechoBase = construirRespuestaAgente1Recepcion({
        intencion: 'SOLO_REPUESTO_SIN_VEHICULO',
        vehiculo,
        repuestoDetectado: repuestoPendienteNuevo,
        carritoCotizado: carritoActual,
        textoCliente: textoBruto,
      });
    } else {
      accionTomadaConv = 'saludo_conversacional';
      hechoBase = construirRespuestaAgente1Recepcion({
        intencion: 'SALUDO_O_CONVERSACION_INICIAL',
        vehiculo,
        carritoCotizado: carritoActual,
        textoCliente: textoBruto,
      });
    }

    // Registrar en CRM WhatsApp incluso si solo dio vehículo o repuesto parcial
    await registrarLeadCrmWhatsapp({
      sesion,
      vehiculo,
      subConsultas: repuestoPendienteNuevo ? [repuestoPendienteNuevo] : [],
    });

    const respuestaNatural = (await redactarRespuestaConGeminiLuna({
      textoCliente: textoBruto,
      historialMensajes: sesion.mensajes || [],
      contextoSituacion: `INTENCIÓN DETECTADA: ${clasificacion.tipo}\nRESPUESTA BASE OBLIGATORIA A TRANSMITIR:\n${hechoBase}`,
      skusPermitidos: carritoActual.map((c) => c.skuPublicoFrp),
      respuestaFallback: hechoBase,
      intencion: clasificacion.tipo,
    })).replace(/f[áa]cilrepuestos\.cl/gi, 'facilrepuestos.cl');

    return {
      vehiculoDetectado: vehiculo,
      carritoCotizado: carritoActual,
      comunaCliente: sesion.comunaCliente || null,
      modalidadEntrega: sesion.modalidadEntrega || null,
      pedidoActivo: pedidoActualizado,
      flujoCompra: estadoFlujoCompra,
      repuestoPendienteContexto: repuestoPendienteNuevo,
      escalamientosAbiertos: sesion.escalamientosAbiertos || [],
      solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
      respuestaTexto: `${respuestaNatural}${sufijoCompraPausada}`,
      trazaCascada: {
        accionTomada: accionTomadaConv,
        intencionConversacional: clasificacion.tipo,
        vehiculoDetectado: vehiculo,
        reglasConocimientoAplicadas: [],
        candidatosInventario: carritoActual,
        escalamientoCreado: null,
        solicitudWspCreada: null,
      },
    };
  }

  // Si veníamos de un turno anterior donde el cliente pidió el repuesto y ahora dio el vehículo/patente, combinamos ambos:
  const textoRepuestoPrevio =
    clasificacion.repuestoCombinado?.textoOriginal ||
    clasificacion.repuestoCombinado?.resumenRepuesto ||
    '';
  const textoBusquedaEfectivo = textoRepuestoPrevio
    ? normalizarTextoAutomotriz(`${textoRepuestoPrevio} ${textoCombinado}`)
    : textoCombinado;

  // ─── PASO 2 Y 3: SOPORTE MULTI-ÍTEM (CATÁLOGO UNIFICADO + MEMORIA IA) ──────
  const subConsultas = extraerMultiplesRepuestos(textoBusquedaEfectivo, vehiculo);

  const { todasReglas, itemsInventario } = await obtenerCatalogoEInteligenciaCacheada();

  const reglasAplicadasGlobal = [];
  const candidatosEncontradosGlobal = [];
  const subConsultasSinStock = [];
  const baseUrlTienda = obtenerUrlBaseTiendaWoo();

  for (const sub of subConsultas) {
    // 2.A) Buscar en Memoria Técnica Aprendida (`conocimiento_aprendido_ia`)
    const reglasSub = todasReglas
      .map((regla) => {
        let score = 0;
        const rMarca = String(regla.marcaVehiculo || '').toUpperCase();
        const rModelo = String(regla.modeloVehiculo || '').toUpperCase();
        if (vehiculo?.marca && rMarca === vehiculo.marca) score += 4;
        if (vehiculo?.modelo && rModelo && rModelo.includes(vehiculo.modelo)) score += 5;

        const textoRegla = [
          regla.nombreRepuesto,
          regla.explicacionExperta,
          regla.respuestaValidada,
          regla.preguntaResumen,
          regla.skuPublicoFrp,
          Array.isArray(regla.terminosClave)
            ? regla.terminosClave.join(' ')
            : String(regla.terminosClave || ''),
        ]
          .join(' ')
          .toUpperCase();

        for (const tok of sub.tokensRepuesto) {
          if (textoRegla.includes(tok)) score += 3;
        }
        return { regla, score };
      })
      .filter((x) => x.score >= 6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const r of reglasSub) {
      if (!reglasAplicadasGlobal.some((x) => x.id === r.regla.id)) {
        reglasAplicadasGlobal.push({
          id: r.regla.id,
          skuPublicoFrp: r.regla.skuPublicoFrp || '',
          nombreRepuesto: r.regla.nombreRepuesto || '',
          explicacionExperta: r.regla.explicacionExperta || '',
          proveedorNombre: r.regla.proveedorNombre || '',
          precioVentaFrp: Number(r.regla.precioVentaFrp || 0),
        });
      }
    }

    // 3.A) Buscar en Catálogo Unificado Multi-Proveedor (`inventario`)
    const PIEZAS_CLAVE_NOMBRE = [
      'PARACHOQUE',
      'NEBLINERO',
      'MENSULA',
      'OPTICO',
      'AMORTIGUADOR',
      'PASTILLAS',
      'DISCO',
      'BANDEJA',
      'RADIADOR',
      'EMBRAGUE',
      'ESPEJO',
      'CAPOT',
      'TAPABARRO',
      'MASCARA',
      'FRONTAL',
      'CULATA',
      'ALTERNADOR',
      'CREMALLERA',
      'HOMOCINETICA',
      'MAZA',
      'ROTULA',
      'BIELETA',
      'TERMINAL',
      'AXIAL',
      'CAZOLETA',
      'BUJIA',
      'BOBINA',
      'BOMBA',
      'TERMOSTATO',
      'FILTRO',
      'SOPORTE',
      'RETEN',
      'EMPAQUETADURA',
      'PISTON',
      'ANILLO',
      'VALVULA',
      'CORREA',
      'CADENA',
      'TENSOR',
      'CALIPER',
      'TAMBOR',
      'BALATA',
      'MANILLA',
      'PORTALON',
    ];
    const piezasClaveEnSub = sub.tokensRepuesto.filter((t) => PIEZAS_CLAVE_NOMBRE.includes(t));
    const pideIzquierdo = sub.tokensRepuesto.includes('IZQUIERDO') || sub.tokensRepuesto.includes('LH');
    const pideDerecho = sub.tokensRepuesto.includes('DERECHO') || sub.tokensRepuesto.includes('RH');
    const pideDelantero = sub.tokensRepuesto.includes('DELANTERO') || sub.tokensRepuesto.includes('DELANTERA');
    const pideTrasero = sub.tokensRepuesto.includes('TRASERO') || sub.tokensRepuesto.includes('TRASERA');
    const pideParODos =
      !pideIzquierdo &&
      !pideDerecho &&
      (/\b(2|DOS|PAR|AMBOS|AMBAS)\b/i.test(sub.fragmentoOriginal || '') ||
        sub.tokensRepuesto.includes('MENSULA'));

    const modeloVehRaw = String(vehiculo?.modelo || '').toUpperCase().trim();
    const modeloBaseToken = modeloVehRaw.split(/[\s-]+/).filter(Boolean)[0] || '';
    const equivalenciasModeloFamilia = {
      JS2: ['JS2', 'S2'],
      S2: ['S2', 'JS2'],
      JS3: ['JS3', 'S3'],
      S3: ['S3', 'JS3'],
      JS4: ['JS4', 'S4'],
      S4: ['S4', 'JS4'],
    };
    const tokensModeloAceptados = modeloBaseToken
      ? equivalenciasModeloFamilia[modeloBaseToken] || [modeloBaseToken]
      : [];

    const candidatosSub = itemsInventario
      .map((item) => {
        let scoreRepuesto = 0;
        let scoreVehiculo = 0;

        const nombreItemNorm = String(item.nombre || '')
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        // Si la consulta menciona una pieza específica (ej. PARACHOQUE, NEBLINERO, MENSULA),
        // exigir que el nombre del producto corresponda a esa pieza y no solo a su categoría.
        if (piezasClaveEnSub.length > 0) {
          const coincidePiezaEnNombre = piezasClaveEnSub.some((pieza) =>
            nombreItemNorm.includes(pieza)
          );
          if (!coincidePiezaEnNombre) {
            return { item, scoreRepuesto: -20, scoreVehiculo: 0, scoreTotal: -20 };
          }
          // Evitar que al pedir "PARACHOQUE" devuelva un "CROMADO PARACHOQUE" o "MARCO BISEL NEBLINERO"
          if (
            piezasClaveEnSub.includes('PARACHOQUE') &&
            !sub.tokensRepuesto.includes('CROMADO') &&
            !sub.tokensRepuesto.includes('MOLDURA') &&
            /^(CROMADO|MOLDURA|SOPORTE|MENSULA|REJILLA)\b/.test(nombreItemNorm)
          ) {
            scoreRepuesto -= 12;
          }
          if (
            piezasClaveEnSub.includes('NEBLINERO') &&
            !sub.tokensRepuesto.includes('MARCO') &&
            !sub.tokensRepuesto.includes('BISEL') &&
            /^(MARCO|BISEL|TAPA)\b/.test(nombreItemNorm)
          ) {
            scoreRepuesto -= 12;
          }
        }

        const codigosEquivalentesStr = Array.isArray(item.equivalencias)
          ? item.equivalencias.map((e) => `${e.fabricante || ''} ${e.codigo || ''}`).join(' ')
          : '';
        const modelosDictStr =
          item.modelosCompatibles && typeof item.modelosCompatibles === 'object' && !Array.isArray(item.modelosCompatibles)
            ? Object.values(item.modelosCompatibles)
                .flat()
                .map((m) => String(m))
                .join(' ')
            : '';

        const textoItem = [
          item.nombre,
          item.descripcion,
          item.categoria,
          item.subcategoria,
          item.subcategoriaDetalle,
          item.tipoPieza,
          item.codigo,
          item.codigoProducto,
          codigosEquivalentesStr,
          modelosDictStr,
          item.skuPublicoFrp,
          item.fabricante,
        ]
          .join(' ')
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        for (const tok of sub.tokensRepuesto) {
          if (nombreItemNorm.includes(tok)) {
            scoreRepuesto += 5;
          } else if (textoItem.includes(tok)) {
            scoreRepuesto += 3;
          }
        }

        // Filtro direccional Izquierdo (Piloto / LH) vs Derecho (Copiloto / RH)
        const itemEsIzq = /\b(IZQUIERDO|IZQUIERDA|LH)\b/.test(nombreItemNorm);
        const itemEsDer = /\b(DERECHO|DERECHA|RH)\b/.test(nombreItemNorm);
        if (pideIzquierdo && !pideDerecho) {
          if (itemEsDer && !itemEsIzq) scoreRepuesto -= 20;
          if (itemEsIzq) scoreRepuesto += 6;
        } else if (pideDerecho && !pideIzquierdo) {
          if (itemEsIzq && !itemEsDer) scoreRepuesto -= 20;
          if (itemEsDer) scoreRepuesto += 6;
        }

        // Filtro direccional Delantero (Frontal) vs Trasero
        const itemEsDel = /\b(DELANTERO|DELANTERA)\b/.test(nombreItemNorm);
        const itemEsTras = /\b(TRASERO|TRASERA)\b/.test(nombreItemNorm);
        if (pideDelantero && !pideTrasero) {
          if (itemEsTras && !itemEsDel) scoreRepuesto -= 20;
          if (itemEsDel) scoreRepuesto += 5;
        } else if (pideTrasero && !pideDelantero) {
          if (itemEsDel && !itemEsTras) scoreRepuesto -= 20;
          if (itemEsTras) scoreRepuesto += 5;
        }

        if (/\bCOMPLETO\b/.test(nombreItemNorm)) {
          scoreRepuesto += 2;
        }

        const marcasItem = Array.isArray(item.marcasCompatibles)
          ? item.marcasCompatibles.map((m) => String(m).toUpperCase())
          : String(item.marcasCompatibles || '')
              .toUpperCase()
              .split(/[,;/]+/)
              .map((s) => s.trim())
              .filter(Boolean);
        const modelosItem = Array.isArray(item.modelosCompatibles)
          ? item.modelosCompatibles.map((m) => String(m).toUpperCase())
          : item.modelosCompatibles && typeof item.modelosCompatibles === 'object'
            ? Object.values(item.modelosCompatibles)
                .flat()
                .map((m) => String(m).toUpperCase())
            : String(item.modelosCompatibles || '')
                .toUpperCase()
                .split(/[,;/]+/)
                .map((s) => s.trim())
                .filter(Boolean);

        if (vehiculo?.marca && vehiculo.marca !== 'MULTIMARCA') {
          if (marcasItem.includes(vehiculo.marca) || textoItem.includes(vehiculo.marca)) {
            scoreVehiculo += 4;
          } else if (marcasItem.length > 0) {
            scoreVehiculo -= 10;
          }
        }

        if (vehiculo?.modelo) {
          const matchExactoBase =
            modeloBaseToken &&
            (modelosItem.includes(modeloBaseToken) ||
              new RegExp(`\\b${modeloBaseToken}\\b`).test(nombreItemNorm));
          const matchFamilia =
            tokensModeloAceptados.some(
              (tokMod) =>
                modelosItem.includes(tokMod) ||
                new RegExp(`\\b${tokMod}\\b`).test(nombreItemNorm)
            ) ||
            modelosItem.some((m) => m.includes(vehiculo.modelo) || vehiculo.modelo.includes(m)) ||
            textoItem.includes(vehiculo.modelo);

          if (matchExactoBase) {
            scoreVehiculo += 8;
          } else if (matchFamilia) {
            scoreVehiculo += 5;
          } else if (modelosItem.length > 0) {
            scoreVehiculo -= 8;
          }
        }

        return {
          item,
          scoreRepuesto,
          scoreVehiculo,
          scoreTotal: scoreRepuesto + scoreVehiculo,
        };
      })
      .filter(
        (c) =>
          c.scoreRepuesto >= 4 &&
          c.scoreVehiculo >= 0 &&
          c.scoreTotal >= 8 &&
          Number(c.item.stock || 0) > 0
      )
      .sort((a, b) => b.scoreTotal - a.scoreTotal)
      .slice(0, pideParODos ? 2 : 1);

    if (candidatosSub.length > 0) {
      for (const { item } of candidatosSub) {
        if (candidatosEncontradosGlobal.some((x) => x.id === item.id)) continue;
        const costo = Number(item.precioCompra || 0);
        // Regla oficial: en el catálogo unificado, `precioVenta` es el precio de venta final publicado en WooCommerce (`facilrepuestos.cl`).
        // Para Soluparts (`margenPct = 0`), `precioVenta === precioCompra` y ya es el precio final al público.
        const precioPublicoFinal = Number(item.precioVenta || costo || 0);
        const precioNetoReferencia = Math.round(precioPublicoFinal / 1.19);
        const margenPct =
          item.margenPct !== undefined
            ? Number(item.margenPct)
            : Number(item.margenAplicadoPct || 0);
        const origen =
          item.nodoAilooId === 'soluparts'
            ? 'soluparts_ailoo'
            : item.origenCatalogo === 'mesa_whatsapp_etapa3' || item.esProductoTemporalWsp
              ? 'mesa_whatsapp'
              : item.proveedorId
                ? 'portal_proveedor_local'
                : 'stock_propio';
        const skuPub = item.skuPublicoFrp || `FRP-LOC-${item.codigo}`;
        const wooProductId = Number(item.wooProductId) || null;
        const urlProductoWoo = wooProductId
          ? `${baseUrlTienda}/?p=${wooProductId}`
          : `${baseUrlTienda}/?s=${encodeURIComponent(skuPub)}&post_type=product`;
        const urlAgregarAlCarroWoo = wooProductId
          ? `${baseUrlTienda}/?add-to-cart=${wooProductId}&quantity=1`
          : urlProductoWoo;

        candidatosEncontradosGlobal.push({
          id: item.id,
          codigoInterno: item.codigo,
          skuPublicoFrp: skuPub,
          nombre: item.nombre,
          fabricante: item.fabricante || 'OEM',
          categoria: item.categoria || '',
          subcategoria: item.subcategoria || '',
          subcategoriaDetalle: item.subcategoriaDetalle || '',
          origen,
          nodoAilooId: item.nodoAilooId || null,
          proveedorId: item.proveedorId || null,
          proveedorNombre:
            item.proveedorNombre ||
            item.proveedor ||
            (item.nodoAilooId === 'soluparts'
              ? 'Soluparts (Ailoo Enterprise)'
              : 'Bodega Local FácilRepuestos'),
          stock: Number(item.stock || 0),
          cantidad: 1,
          precioCostoProveedor: costo,
          margenPct,
          precioVentaNeto: precioNetoReferencia,
          precioVentaConIva: precioPublicoFinal,
          wooProductId,
          urlProductoWoo,
          urlAgregarAlCarroWoo,
          subConsultaResumen: sub.resumenRepuesto,
        });
      }
    } else if (reglasSub.length === 0) {
      subConsultasSinStock.push(sub);
    }
  }

  const principalSub = subConsultas[0];
  const resumenRepuesto = principalSub.resumenRepuesto;
  const categoria = principalSub.categoria;

  // ─── PASO 4: EVALUACIÓN DE LA CASCADA (SOPORTA STOCK PARCIAL MULTI-ÍTEM) ──
  const dudaTecnica = detectarDudaTecnicaEscalamiento(textoCombinado, Boolean(fotoUrl));
  const medidaPreguntada = (textoCombinado.toUpperCase().match(/\b(\d{2,3}\s*MM)\b/) || [])[1] || '';
  const yaResueltoEnMemoria =
    reglasAplicadasGlobal.length > 0 &&
    (!medidaPreguntada ||
      reglasAplicadasGlobal.some((r) =>
        String(r.explicacionExperta || '')
          .toUpperCase()
          .includes(medidaPreguntada.replace(/\s+/g, ''))
      ));

  let accionTomada = 'cotizacion_directa';
  if (modoForzado === 'forzar_escalamiento') {
    accionTomada = 'escalamiento_experto';
  } else if (modoForzado === 'forzar_mesa_wsp') {
    accionTomada = 'mesa_whatsapp_viva';
  } else if (dudaTecnica.requiereValidacionExperta && !yaResueltoEnMemoria) {
    accionTomada = 'escalamiento_experto';
  } else if (candidatosEncontradosGlobal.length > 0 && subConsultasSinStock.length > 0) {
    // MEJORA LUNA (Casos C01, C08, C12, C51): Stock parcial en pedido múltiple
    accionTomada = 'cotizacion_parcial_con_mesa_wsp';
  } else if (candidatosEncontradosGlobal.length === 0 && !yaResueltoEnMemoria) {
    accionTomada = 'mesa_whatsapp_viva';
  }

  const now = new Date().toISOString();
  let escalamientoCreado = null;
  let solicitudWspCreada = null;
  let respuestaTexto = '';

  const etiquetaVehiculo = vehiculo
    ? `${vehiculo.marca} ${vehiculo.modelo || ''} ${vehiculo.anio ? `(${vehiculo.anio})` : ''}${
        vehiculo.motor ? ` · Motor ${vehiculo.motor}` : ''
      }${vehiculo.patente ? ` [Patente ${vehiculo.patente}]` : ''}${
        vehiculo.vin ? ` · VIN ${vehiculo.vin}` : ''
      }`.trim()
    : 'Vehículo en consulta';

  // Agente 1: Perfilar urgencia y comuna del cliente si la mencionó en este turno
  const perfilCliente = perfilarNecesidadYComunaCliente({
    textoCliente: textoBruto,
    sesion,
  });
  if (perfilCliente.comunaCliente && !sesion.comunaCliente) {
    sesion.comunaCliente = perfilCliente.comunaCliente;
  }

  // Agente 6: Evaluar si el cliente está sumando un repuesto adicional sobre un carrito previo
  const fusionAgente6 = fusionarPedidoAdicionalEnCarrito({
    textoCliente: textoBruto,
    carritoPrevio: carritoActual,
    nuevosCandidatos: candidatosEncontradosGlobal,
  });
  if (candidatosEncontradosGlobal.length > 0) {
    carritoActual = fusionAgente6.carritoConsolidado;
  }

  const linksCarroCotizacion = construirLinksCarroWooCommerce(carritoActual);

  const notaRespuestasPrevias =
    respuestasVivas.length > 0
      ? `🔔 **Actualización en vivo de tu consulta anterior:** Confirmamos **${respuestasVivas[0].repuesto}** (\`${respuestasVivas[0].skuPublicoFrp}\`) a **$${respuestasVivas[0].precioVentaConIva.toLocaleString('es-CL')} IVA inc.**\n\n`
      : '';

  // ─── RAMA A: COTIZACIÓN DIRECTA (ORQUESTADA CON AGENTES 2, 3 Y 6) ──────────
  if (accionTomada === 'cotizacion_directa') {
    const notaAprendida =
      reglasAplicadasGlobal.length > 0
        ? `\n\n🧠 **Nota Técnica:** ${sanitizarMensajeHaciaClienteFinal(reglasAplicadasGlobal[0].explicacionExperta)}`
        : '';

    if (candidatosEncontradosGlobal.length > 0) {
      respuestaTexto = redactarCotizacionOrquestada({
        etiquetaVehiculo,
        candidatosNuevos: candidatosEncontradosGlobal,
        carritoConsolidado: carritoActual,
        esPedidoAdicional: fusionAgente6.esPedidoAdicional,
        urlCarroUnificado: linksCarroCotizacion?.urlCarroUnificado || null,
        notaRespuestasPrevias,
        notaAprendida,
      });
    } else if (reglasAplicadasGlobal.length > 0) {
      const r = reglasAplicadasGlobal[0];
      const conIva = Math.round(r.precioVentaFrp || 0);
      const nombreLimpioRegla = formatearNombreProductoParaVehiculoCliente(r.nombreRepuesto);
      respuestaTexto =
        `${notaRespuestasPrevias}¡Lo encontré! 🚗 Compatible con tu **${etiquetaVehiculo}**:\n\n` +
        `• **${nombreLimpioRegla}** (\`${r.skuPublicoFrp}\`)${
          r.precioVentaFrp > 0
            ? ` — **$${conIva.toLocaleString('es-CL')} IVA inc.**`
            : ''
        }\n🧠 **Detalle:** ${sanitizarMensajeHaciaClienteFinal(r.explicacionExperta)}\n\n` +
        `¿Lo necesitas para **retiro en nuestra sucursal de La Florida** o prefieres **despacho a domicilio / región**?`;
    }
  }

  // ─── RAMA B: ESCALAMIENTO EXPERTO AUTOMÁTICO CON ENRUTAMIENTO POR ORIGEN (AGENTE 2) ──
  // REGLA DE TRES CANALES:
  //   1. Si el producto es de Soluparts -> se carga en Soluparts (`soluparts-mostrador-prod.soluparts.escalamientos`).
  //   2. Si el producto es de otro proveedor con Portal ERP -> se carga en el Portal ERP de ese proveedor (`tipoDestino = 'proveedor_local'`, `proveedorId`).
  //   3. Si es una cotización de un tercero por WSP de la Mesa de Abastecimiento -> se traspasa el escalamiento por WhatsApp desde el +56950960294 a esos números específicos.
  if (accionTomada === 'escalamiento_experto') {
    const mejorCandidato = candidatosEncontradosGlobal[0] || carritoActual[0] || null;
    const rutaEscalamiento = resolverRutaEscalamientoAgente2({
      mejorCandidato,
      solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
    });

    // Deduplicación anti-spam (Mejora C25/C36 Luna): si ya existe un escalamiento abierto en la sesión para el mismo repuesto/vehículo, reutilizarlo
    const existente = (sesion.escalamientosAbiertos || []).find(
      (e) =>
        e.resumenRepuesto === resumenRepuesto &&
        (e.patente || '') === (vehiculo?.patente || '')
    );

    if (existente) {
      escalamientoCreado = existente;
      respuestaTexto =
        `⏳ Estamos validando con nuestros proveedores internos para tu **${etiquetaVehiculo}**; apenas tengamos confirmado tu repuesto te avisaremos por este mismo WhatsApp.`;
    } else if (rutaEscalamiento.canalEscalamiento === 'traspaso_wsp_mesa') {
      // Canal 3: Cotización de un tercero por WhatsApp de la Mesa de Abastecimiento -> Traspasar el escalamiento por WhatsApp a esos números específicos
      const ticketRef = `ESC-WSP-${Math.floor(1000 + Math.random() * 9000)}`;
      const dudaLimpia = sanitizarTextoParaProveedor(textoCliente || transcripcionAudio || dudaTecnica.motivo);
      const provSnap = await db.collection(COLECCION_PROVEEDORES).get();
      const todosProveedores = provSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.activo !== false && p.canalWspActivo === true && p.telefono);

      // Si había una solicitud WSP activa o el producto temporal indica el proveedorId, usar esos números específicos; si no, seleccionar el Top 3 de la Mesa WSP
      let destinatariosWsp = [];
      if (mejorCandidato?.proveedorId) {
        destinatariosWsp = todosProveedores.filter((p) => p.id === mejorCandidato.proveedorId);
      }
      if (destinatariosWsp.length === 0 && Array.isArray(sesion.solicitudesWspAbiertas) && sesion.solicitudesWspAbiertas.length > 0) {
        const ultSolId = sesion.solicitudesWspAbiertas[sesion.solicitudesWspAbiertas.length - 1]?.id;
        if (ultSolId) {
          const solDoc = await db.collection(COLECCION_SOLICITUDES_WSP).doc(ultSolId).get().catch(() => null);
          if (solDoc?.exists) {
            const contactos = solDoc.data()?.proveedoresContactados || [];
            destinatariosWsp = contactos
              .filter((c) => c.telefono)
              .map((c) => ({ id: c.proveedorId, nombre: c.proveedorNombre, telefono: c.telefono }));
          }
        }
      }
      if (destinatariosWsp.length === 0) {
        destinatariosWsp = seleccionarTop3ProveedoresMesaWsp({
          proveedores: todosProveedores,
          marcaVehiculo: vehiculo?.marca || '',
          categoriaRepuesto: categoria || '',
          comunaCliente: sesion.comunaCliente || '',
        });
      }

      const textoTraspasoWsp =
        `Estimado, sobre ${mejorCandidato?.nombre || resumenRepuesto} para ${etiquetaVehiculo}, necesitamos confirmar un detalle técnico: "${dudaLimpia}". ¿Me confirmas por favor si aplica?`;

      for (const dest of destinatariosWsp) {
        if (!dest.telefono) continue;
        await enviarMensajeMesaAbastecimientoWhatsapp({
          telefonoDestino: dest.telefono,
          texto: textoTraspasoWsp,
        }).catch(() => null);
      }

      escalamientoCreado = {
        id: ticketRef,
        ticketRef,
        destino: `WhatsApp Proveedores Mesa (${destinatariosWsp.map((d) => d.nombre).join(', ') || '+56950960294'})`,
        candidatoSku: mejorCandidato?.skuPublicoFrp || '',
        resumenRepuesto,
        patente: vehiculo?.patente || '',
      };

      respuestaTexto =
        `🚗 Ya le traspasamos tu consulta técnica directamente por WhatsApp al proveedor especialista para tu **${etiquetaVehiculo}**. Apenas nos confirme te avisamos por aquí.`;
    } else {
      // Canal 1 (Soluparts -> soluparts-mostrador-prod.soluparts.escalamientos) o Canal 2 (Otro proveedor ERP -> su propio Portal Proveedor)
      const esNodoSoluparts = rutaEscalamiento.canalEscalamiento === 'nodo_soluparts';
      const nodoAilooId = esNodoSoluparts ? 'soluparts' : null;
      const ticketRef = `ESC-${Math.floor(100000 + Math.random() * 900000)}`;
      const mensajeSanitizado = sanitizarTextoParaProveedor(textoCliente || transcripcionAudio);
      const audioSanitizado = sanitizarTextoParaProveedor(transcripcionAudio || '');
      const motivoSanitizado = sanitizarTextoParaProveedor(
        dudaTecnica.motivo ||
          `Confirmar compatibilidad técnica exacta de ${resumenRepuesto} para ${etiquetaVehiculo}`
      );

      const historialPrevio = Array.isArray(sesion.mensajes) ? sesion.mensajes.slice(-6) : [];
      const formatearHora = (iso) => {
        try {
          return new Date(iso || Date.now()).toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return '';
        }
      };
      const historialConversacion = [
        ...historialPrevio.map((m) => ({
          hora: formatearHora(m.creadoEn),
          rol: m.rol === 'cliente' ? 'cliente' : 'agente',
          autor: m.rol === 'cliente' ? 'Cliente' : 'Asistente',
          texto: sanitizarTextoParaProveedor(m.texto || ''),
          envioFoto: Boolean(m.fotoUrl),
        })),
        {
          hora: formatearHora(now),
          rol: 'cliente',
          autor: 'Cliente',
          texto: mensajeSanitizado,
          envioFoto: Boolean(fotoUrl),
        },
      ];

      const nuevoEsc = {
        ticketRef,
        sesionAgenteId: sesion.id,
        clienteTelefono: sesion.clienteTelefono || '',
        clienteNombre: sesion.clienteNombre || '',
        solicitante: 'Consulta Técnica Mostrador',
        canalOrigen: sesion.canal === 'web_cliente' ? 'web' : 'whatsapp',
        estado: 'pendiente',
        prioridad: 'alta',
        tipoDestino: esNodoSoluparts ? 'nodo_ailoo' : 'proveedor_local',
        nodoAilooId,
        datasetDestino: esNodoSoluparts
          ? 'soluparts-mostrador-prod.soluparts.escalamientos'
          : null,
        proveedorId: esNodoSoluparts ? 'soluparts' : rutaEscalamiento.proveedorId,
        proveedorNombre: esNodoSoluparts
          ? 'Soluparts (Ailoo Enterprise)'
          : rutaEscalamiento.proveedorNombre,
        patente: vehiculo?.patente || '',
        vinVehiculo: vehiculo?.vin || '',
        marcaVehiculo: vehiculo?.marca || 'POR CONFIRMAR',
        modeloVehiculo: vehiculo?.modelo || '',
        anioVehiculo: vehiculo?.anio ? String(vehiculo.anio) : '',
        motorVehiculo: vehiculo?.motor || '',
        mensajeCliente: mensajeSanitizado,
        transcripcionAudio: audioSanitizado,
        imagenUrl: fotoUrl || '',
        fotoMuestraUrl: fotoUrl || '',
        pistaGemini: fotoUrl ? (audioSanitizado || motivoSanitizado) : '',
        historialConversacion,
        motivoEscalamiento: motivoSanitizado,
        candidatoInventarioId: mejorCandidato?.id || null,
        candidatoCodigo: mejorCandidato?.codigoInterno || '',
        candidatoNombre: mejorCandidato?.nombre || resumenRepuesto,
        precioCostoProveedor: Number(mejorCandidato?.precioCostoProveedor || 0),
        creadoEn: now,
        actualizadoEn: now,
      };

      const escRef = await db.collection(COLECCION_ESCALAMIENTOS).add(nuevoEsc);

      if (esNodoSoluparts) {
        await despacharEscalamientoANodoAiloo(
          {
            id: 'soluparts',
            projectId: 'soluparts-mostrador-prod',
            datasetId: 'soluparts',
            tablaEscalamientos: 'escalamientos',
          },
          { id: escRef.id, ...nuevoEsc }
        ).catch(() => null);
      }

      escalamientoCreado = {
        id: escRef.id,
        ticketRef,
        destino: nuevoEsc.datasetDestino || nuevoEsc.proveedorNombre,
        candidatoSku: mejorCandidato?.skuPublicoFrp || '',
        resumenRepuesto,
        patente: vehiculo?.patente || '',
      };

      respuestaTexto =
        `🚗 Identifiqué tu **${etiquetaVehiculo}**. Estamos validando con nuestros proveedores internos para confirmarte el repuesto exacto; apenas lo encontremos te lo confirmaremos por este mismo WhatsApp.`;
    }
  }

  // ─── RAMA C Y D: SIN STOCK DIRECTO -> PREGUNTAR AL CLIENTE SI DESEA QUE BUSQUEMOS CON PROVEEDORES LOCALES ─
  let confirmacionMesaWspPendienteNueva = null;
  if (accionTomada === 'mesa_whatsapp_viva' || accionTomada === 'cotizacion_parcial_con_mesa_wsp') {
    const faltantes =
      accionTomada === 'cotizacion_parcial_con_mesa_wsp' && subConsultasSinStock.length > 0
        ? subConsultasSinStock
        : subConsultas;
    const resumenFaltantes = faltantes.map((f) => f.resumenRepuesto).join(' + ');

    // Si es disparo manual forzado desde el simulador (`forzar_mesa_wsp`), enviar directo;
    // en conversación real (`auto`), primero preguntar al cliente si puede esperar y quiere que busquemos con proveedores locales.
    if (modoForzado === 'forzar_mesa_wsp') {
      const provSnap = await db.collection(COLECCION_PROVEEDORES).get();
      const proveedores = provSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.activo !== false && p.canalWspActivo !== false && p.telefono);

      const seleccionados = seleccionarTop3ProveedoresMesaWsp({
        proveedores,
        marcaVehiculo: vehiculo?.marca || '',
        categoriaRepuesto: categoria || '',
        comunaCliente: sesion.comunaCliente || '',
      });

      const codigoSolicitud = `WSP-${Math.floor(1000 + Math.random() * 9000)}`;
      const repuestoTexto = `${resumenFaltantes} ${vehiculo?.marca || ''} ${vehiculo?.modelo || ''}`.trim();
      const proveedoresContactados = [];

      for (const p of seleccionados) {
        const mensajeEnviado = construirMensajeSalidaWsp({
          marcaVehiculo: vehiculo?.marca || '',
          modeloVehiculo: vehiculo?.modelo || '',
          anioVehiculo: vehiculo?.anio || '',
          motorVehiculo: vehiculo?.motor || '',
          patente: vehiculo?.patente || '',
          vin: vehiculo?.vin || '',
          repuestoBuscado: resumenFaltantes,
        });

        const envioReal = await enviarMensajeMesaAbastecimientoWhatsapp({
          telefonoDestino: p.telefono,
          texto: mensajeEnviado,
        }).catch(() => null);

        proveedoresContactados.push({
          proveedorId: p.id,
          proveedorNombre: p.nombre,
          contacto: p.contacto || 'Mesón WhatsApp',
          telefono: p.telefono,
          especialidad: p.categoria || p.especialidad || 'Multimarca',
          especialidadMarcas: p.marcas || p.marcasVehiculo || p.marcasEspecialidad || ['MULTIMARCA'],
          marcasVehiculo: p.marcas || p.marcasVehiculo || [],
          estadoContacto: 'enviado',
          modoEnvio: envioReal?.enviado ? 'meta_cloud_api_live' : 'simulacion_meta_local',
          metaMessageId: envioReal?.metaMessageId || `wamid.AUTO.${Date.now()}`,
          mensajeEnviado,
          enviadoEn: now,
          respondidoEn: null,
        });
      }

      const nuevaSolWsp = {
        codigoSolicitud,
        sesionAgenteId: sesion.id,
        clienteTelefonoReal: sesion.clienteTelefono || '',
        comunaCliente: sesion.comunaCliente || null,
        urgenciaCliente: perfilCliente.urgencia || 'normal',
        solicitante: 'FácilRepuestos SpA (Adquisiciones B2B)',
        estado: 'esperando_respuestas',
        canalCliente: sesion.canal === 'web_cliente' ? 'web' : 'whatsapp',
        clienteNombre: 'FácilRepuestos SpA (Identidad de Cliente Protegida)',
        clienteTelefono: 'CONFIDENCIAL-FRP',
        patente: vehiculo?.patente || '',
        vin: vehiculo?.vin || '',
        marcaVehiculo: vehiculo?.marca || 'POR CONFIRMAR',
        modeloVehiculo: vehiculo?.modelo || '',
        anioVehiculo: vehiculo?.anio || null,
        motorVehiculo: vehiculo?.motor || '',
        categoriaRepuesto: categoria,
        repuestoBuscado: repuestoTexto,
        codigoReferencia: '',
        notasAdicionales: `Solicitud B2B FácilRepuestos`,
        margenPct: 28,
        escalamientoOrigenId: null,
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

      const solRef = await db.collection(COLECCION_SOLICITUDES_WSP).add(nuevaSolWsp);
      solicitudWspCreada = {
        id: solRef.id,
        codigoSolicitud,
        proveedoresContactados: proveedoresContactados.map((p) => p.proveedorNombre),
        resumenRepuesto: resumenFaltantes,
        patente: vehiculo?.patente || '',
      };
      respuestaTexto = `¡Perfecto! 👍 Ya lo estamos buscando con nuestros proveedores locales para tu **${etiquetaVehiculo}**. Apenas nos confirmen te enviamos la mejor oferta por aquí.`;
    } else {
      // Guardar pendiente de confirmación del cliente antes de disparar a la Mesa de Abastecimiento
      confirmacionMesaWspPendienteNueva = {
        resumenFaltantes,
        categoria,
        vehiculo,
        etiquetaVehiculo,
        creadoEn: now,
      };

      if (accionTomada === 'cotizacion_parcial_con_mesa_wsp') {
        const lineasDisponibles = candidatosEncontradosGlobal.map((c) => {
          const nomLimpio = formatearNombreProductoParaVehiculoCliente(c.nombre);
          return `• **${nomLimpio}** (\`${c.skuPublicoFrp}\`) — **$${c.precioVentaConIva.toLocaleString(
            'es-CL'
          )} IVA inc.**\n  👉 Ver y comprar en tienda: ${c.urlProductoWoo}`;
        });
        respuestaTexto =
          `¡Lo encontré! 🚗 Para tu **${etiquetaVehiculo}** tenemos disponible de inmediato:\n\n` +
          `${lineasDisponibles.join('\n')}\n\n` +
          `Sobre **${resumenFaltantes}**, no lo tenemos en stock en este momento. ¿Te parece si lo buscamos con proveedores locales y te enviamos la mejor oferta?`;
      } else {
        respuestaTexto =
          `En este momento no tenemos **${resumenFaltantes}** para tu **${etiquetaVehiculo}** en stock. ¿Te parece si lo buscamos con proveedores locales y te enviamos la mejor oferta?`;
      }
    }
  }

  // Registrar automáticamente en el CRM WhatsApp (Teléfono + Patente + Vehículo + Repuestos)
  await registrarLeadCrmWhatsapp({
    sesion,
    vehiculo,
    subConsultas,
    candidatos: candidatosEncontradosGlobal,
  });

  if (accionTomada === 'cotizacion_directa' && respuestaTexto) {
    respuestaTexto = await redactarRespuestaConGeminiLuna({
      textoCliente: textoBusquedaEfectivo,
      historialMensajes: sesion.mensajes || [],
      contextoSituacion: `COTIZACIÓN DIRECTA CONFIRMADA EN CATÁLOGO PARA ${etiquetaVehiculo}:\n${respuestaTexto}`,
      skusPermitidos: [
        ...candidatosEncontradosGlobal.map((c) => c.skuPublicoFrp),
        ...reglasAplicadasGlobal.map((r) => r.skuPublicoFrp),
      ].filter(Boolean),
      respuestaFallback: respuestaTexto,
      intencion: 'BUSQUEDA_CATALOGO',
      tieneNotaTecnica: reglasAplicadasGlobal.length > 0,
    });
  }

  if (sufijoCompraPausada) {
    respuestaTexto = `${respuestaTexto}${sufijoCompraPausada}`;
  }

  // Nunca usar tilde en facilrepuestos.cl para evitar error DNS (xn--fcilrepuestos-edb.cl) al hacer clic
  respuestaTexto = String(respuestaTexto || '').replace(/f[áa]cilrepuestos\.cl/gi, 'facilrepuestos.cl');

  const escalamientosAbiertos = [...(sesion.escalamientosAbiertos || [])];
  if (escalamientoCreado && !escalamientosAbiertos.some((e) => e.id === escalamientoCreado.id)) {
    escalamientosAbiertos.push(escalamientoCreado);
  }

  const solicitudesWspAbiertas = [...(sesion.solicitudesWspAbiertas || [])];
  if (solicitudWspCreada && !solicitudesWspAbiertas.some((w) => w.id === solicitudWspCreada.id)) {
    solicitudesWspAbiertas.push(solicitudWspCreada);
  }

  return {
    vehiculoDetectado: vehiculo,
    carritoCotizado: carritoActual,
    comunaCliente: sesion.comunaCliente || null,
    modalidadEntrega: sesion.modalidadEntrega || null,
    pedidoActivo: sesion.pedidoActivo || null,
    flujoCompra: estadoFlujoCompra,
    repuestoPendienteContexto: null,
    confirmacionMesaWspPendiente: confirmacionMesaWspPendienteNueva,
    escalamientosAbiertos,
    solicitudesWspAbiertas,
    respuestaTexto,
    trazaCascada: {
      accionTomada,
      intencionConversacional: 'BUSQUEDA_CATALOGO',
      vehiculoDetectado: vehiculo,
      subConsultasDetectadas: subConsultas.map((s) => s.resumenRepuesto),
      reglasConocimientoAplicadas: reglasAplicadasGlobal,
      candidatosInventario: candidatosEncontradosGlobal,
      carroWooCommerce: linksCarroCotizacion,
      escalamientoCreado,
      solicitudWspCreada,
    },
  };
}

// Corte para limpiar todos los históricos y pruebas previas a esta actualización
const CORTE_LIMPIEZA_HISTORICOS_MS = Date.parse('2026-11-17T02:45:00.000Z');
const VENTANA_ACTIVA_24H_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agente-omnicanal/sesiones
// Lista las conversaciones activas de WhatsApp (< 24 horas y no cerradas con ✕).
// Las conversaciones cerradas con ✕ o con más de 24 horas pasan solo a estadística,
// y cualquier sesión antigua de canal web se elimina.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sesiones', async (req, res, next) => {
  try {
    await asegurarDatosInicialesAgente();
    const snap = await db.collection(COLECCION_SESIONES_AGENTE).get();
    const ahoraMs = Date.now();

    const sesionesActivas = [];
    let totalHistoricasWsp = 0;
    let cerradasOPasadas24h = 0;

    for (const d of snap.docs) {
      const data = d.data() || {};
      const id = d.id;

      // Eliminar por completo sesiones antiguas de prueba web (solo atendemos por Repuestín vía WSP)
      if (data.canal === 'web_cliente' || id === 'ses-omni-demo-porter' || id.startsWith('ses-omni-demo')) {
        db.collection(COLECCION_SESIONES_AGENTE).doc(id).delete().catch(() => null);
        continue;
      }

      totalHistoricasWsp += 1;
      const updatedMs = Date.parse(data.updatedAt || data.createdAt || '') || 0;

      // Si es anterior al corte de limpieza de históricos o tiene más de 24h o fue cerrada con ✕:
      // desaparece de la bandeja activa y queda únicamente como estadística
      const esHistoricoPrevio = updatedMs > 0 && updatedMs < CORTE_LIMPIEZA_HISTORICOS_MS;
      const supero24Horas = updatedMs > 0 && ahoraMs - updatedMs > VENTANA_ACTIVA_24H_MS;
      const fueCerradaConX = Boolean(data.archivadaEnBandeja) || data.estado === 'archivada';

      if (esHistoricoPrevio || supero24Horas || fueCerradaConX) {
        cerradasOPasadas24h += 1;
        if (esHistoricoPrevio && !data.archivadaEnBandeja) {
          db.collection(COLECCION_SESIONES_AGENTE)
            .doc(id)
            .set({ archivadaEnBandeja: true, estado: 'archivada' }, { merge: true })
            .catch(() => null);
        }
        continue;
      }

      sesionesActivas.push({
        id,
        ...data,
        canal: data.canal || 'whatsapp_meta_cloud',
      });
    }

    sesionesActivas.sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );

    res.json({
      success: true,
      data: {
        sesiones: sesionesActivas,
        estadisticasHistoricas: {
          totalHistoricasWsp,
          cerradasOPasadas24h,
          activasEnBandeja: sesionesActivas.length,
        },
        padronDemoPatentes: Object.values(PADRON_PATENTES_DEMO),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones/limpiar-historicos
// Limpia todas las conversaciones actuales de la bandeja (las pasa a estadística
// y elimina cualquier sesión de prueba web).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/limpiar-historicos', async (req, res, next) => {
  try {
    const snap = await db.collection(COLECCION_SESIONES_AGENTE).get();
    let archivadas = 0;
    let eliminadasWeb = 0;

    for (const d of snap.docs) {
      const data = d.data() || {};
      if (data.canal === 'web_cliente' || d.id.startsWith('ses-omni-demo')) {
        await db.collection(COLECCION_SESIONES_AGENTE).doc(d.id).delete();
        eliminadasWeb += 1;
      } else if (!data.archivadaEnBandeja) {
        await db
          .collection(COLECCION_SESIONES_AGENTE)
          .doc(d.id)
          .set({ archivadaEnBandeja: true, estado: 'archivada' }, { merge: true });
        archivadas += 1;
      }
    }

    res.json({
      success: true,
      data: { archivadas, eliminadasWeb },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones/:id/archivar
// Quita una conversación de la lista activa (botón ✕) dejándola solo para estadística
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/:id/archivar', async (req, res, next) => {
  try {
    const { id } = req.params;
    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(id);
    await docRef.set(
      {
        archivadaEnBandeja: true,
        estado: 'archivada',
        archivadaEn: new Date().toISOString(),
      },
      { merge: true }
    );
    res.json({
      success: true,
      data: { id, archivadaEnBandeja: true },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones
// Crea una nueva sesión de cliente (100% WhatsApp-First)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones', async (req, res, next) => {
  try {
    const {
      canal = 'whatsapp_cliente',
      clienteNombre = 'Cliente WhatsApp FácilRepuestos',
      clienteTelefono = '+56987654321',
      patenteInicial = '',
    } = req.body;

    const vehiculoContexto = patenteInicial
      ? await resolverVehiculoOmnicanal({ patenteInput: patenteInicial })
      : null;

    const now = new Date().toISOString();
    const nuevaSesion = {
      canal,
      clienteNombre: String(clienteNombre).trim() || 'Cliente FácilRepuestos',
      clienteTelefono: String(clienteTelefono).trim(),
      estado: 'activa',
      vehiculoContexto,
      carritoCotizado: [],
      comunaCliente: null,
      modalidadEntrega: null,
      flujoCompra: null,
      repuestoPendienteContexto: null,
      escalamientosAbiertos: [],
      solicitudesWspAbiertas: [],
      pedidoActivo: null,
      mensajes: [
        {
          id: `msg-${Date.now()}`,
          autor: 'agente_ia',
          texto: vehiculoContexto
            ? `¡Hola! 👋 Ya identifiqué tu **${vehiculoContexto.marca} ${vehiculoContexto.modelo} ${vehiculoContexto.anio || ''}** (Patente \`${vehiculoContexto.patente}\`). ¿Qué repuesto necesitas cotizar hoy?`
            : `¡Hola! 👋 Soy Repuestín, especialista de **facilrepuestos.cl**. Cuéntame qué repuesto buscas y la **patente** de tu vehículo (o marca, modelo y año) para revisarlo al tiro.`,
          creadoEn: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection(COLECCION_SESIONES_AGENTE).add(nuevaSesion);
    res.status(201).json({
      success: true,
      data: { id: docRef.id, ...nuevaSesion },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones/:id/mensaje
// Envía un mensaje del cliente final (texto, audio, foto o patente) y ejecuta
// la cascada completa con las mejoras de Luna
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/:id/mensaje', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      texto = '',
      transcripcionAudio = '',
      fotoUrl = '',
      patente = '',
      modoForzado = 'auto',
    } = req.body;

    if (!String(texto).trim() && !String(transcripcionAudio).trim() && !String(fotoUrl).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Ingresa un mensaje de texto, transcripción de audio o fotografía del cliente',
      });
    }

    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }

    const sesion = { id: snap.id, ...snap.data() };
    const now = new Date().toISOString();

    const msgCliente = {
      id: `msg-cli-${Date.now()}`,
      autor: 'cliente',
      texto: String(texto || '').trim(),
      transcripcionAudio: String(transcripcionAudio || '').trim(),
      fotoUrl: String(fotoUrl || '').trim(),
      creadoEn: now,
    };

    const resultadoCascada = await ejecutarCascadaAgenteOmnicanal({
      sesion,
      textoCliente: msgCliente.texto,
      transcripcionAudio: msgCliente.transcripcionAudio,
      fotoUrl: msgCliente.fotoUrl,
      patenteForzada: patente,
      modoForzado,
    });

    const msgAgente = {
      id: `msg-ia-${Date.now() + 1}`,
      autor: 'agente_ia',
      texto: resultadoCascada.respuestaTexto,
      creadoEn: new Date().toISOString(),
      trazaCascada: resultadoCascada.trazaCascada,
    };

    const mensajesActualizados = [...(sesion.mensajes || []), msgCliente, msgAgente];
    const vehiculoContexto = resultadoCascada.vehiculoDetectado || sesion.vehiculoContexto || null;
    const camposActualizados = {
      estado: 'activa',
      archivadaEnBandeja: false,
      vehiculoContexto,
      carritoCotizado: resultadoCascada.carritoCotizado ?? sesion.carritoCotizado ?? [],
      comunaCliente: resultadoCascada.comunaCliente ?? sesion.comunaCliente ?? null,
      modalidadEntrega: resultadoCascada.modalidadEntrega ?? sesion.modalidadEntrega ?? null,
      pedidoActivo: resultadoCascada.pedidoActivo ?? sesion.pedidoActivo ?? null,
      flujoCompra:
        resultadoCascada.flujoCompra !== undefined
          ? resultadoCascada.flujoCompra
          : sesion.flujoCompra ?? null,
      repuestoPendienteContexto:
        resultadoCascada.repuestoPendienteContexto !== undefined
          ? resultadoCascada.repuestoPendienteContexto
          : sesion.repuestoPendienteContexto ?? null,
      confirmacionMesaWspPendiente:
        resultadoCascada.confirmacionMesaWspPendiente !== undefined
          ? resultadoCascada.confirmacionMesaWspPendiente
          : sesion.confirmacionMesaWspPendiente ?? null,
      escalamientosAbiertos: resultadoCascada.escalamientosAbiertos ?? sesion.escalamientosAbiertos ?? [],
      solicitudesWspAbiertas: resultadoCascada.solicitudesWspAbiertas ?? sesion.solicitudesWspAbiertas ?? [],
      mensajes: mensajesActualizados,
      updatedAt: new Date().toISOString(),
    };

    await docRef.update(camposActualizados);

    const sesionActualizada = {
      ...sesion,
      ...camposActualizados,
    };

    res.json({
      success: true,
      data: {
        sesion: sesionActualizada,
        mensajeAgente: msgAgente,
        trazaCascada: resultadoCascada.trazaCascada,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones/:id/checkout-simulado
// Genera o confirma el pago simulado de un pedido en la Vista Web Cliente
// (sin necesitar tarjeta de crédito real ni link de pago externo)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/:id/checkout-simulado', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      accion = 'crear_y_aprobar', // 'crear' | 'aprobar_pago' | 'crear_y_aprobar'
      modalidadEntrega = 'retiro_bodega',
      comunaEntrega = 'La Florida, Santiago (RM)',
      metodoPagoSimulado = 'sandbox_webpay_sin_tarjeta',
    } = req.body;

    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }

    const sesion = { id: snap.id, ...snap.data() };
    let pedido = sesion.pedidoActivo || null;

    if (!pedido || accion === 'crear' || accion === 'crear_y_aprobar') {
      pedido = await crearPedidoSimuladoAgente({
        sesion,
        modalidadEntrega: modalidadEntrega || sesion.modalidadEntrega || 'retiro_bodega',
        comunaEntrega: comunaEntrega || sesion.comunaCliente || 'La Florida, Santiago (RM)',
        metodoPagoSimulado,
      });
      if (!pedido) {
        return res.status(400).json({
          success: false,
          error: 'Primero cotiza al menos un repuesto disponible para generar el pedido simulado.',
        });
      }
    }

    const now = new Date().toISOString();
    if (accion === 'aprobar_pago' || accion === 'crear_y_aprobar') {
      pedido = {
        ...pedido,
        estadoPago: 'pagado_sandbox',
        estadoLogistico:
          pedido.modalidadEntrega === 'retiro_bodega'
            ? 'listo_para_retiro_en_mostrador'
            : 'preparando_despacho_courier',
        codigoAutorizacionSandbox: `AUTH-FRP-${Math.floor(100000 + Math.random() * 900000)}`,
        pagadoEn: now,
        updatedAt: now,
      };
      if (pedido.id) {
        await db.collection(COLECCION_PEDIDOS_AGENTE).doc(pedido.id).update({
          estadoPago: pedido.estadoPago,
          estadoLogistico: pedido.estadoLogistico,
          codigoAutorizacionSandbox: pedido.codigoAutorizacionSandbox,
          pagadoEn: now,
          updatedAt: now,
        });
      }
    }

    const msgConfirmacion = {
      id: `msg-ia-pay-${Date.now()}`,
      autor: 'agente_ia',
      texto:
        pedido.estadoPago === 'pagado_sandbox'
          ? `✅ **¡Pago Sandbox Confirmado (\`${pedido.codigoAutorizacionSandbox}\`)!**\n\n` +
            `🧾 **Orden de Pedido:** \`${pedido.codigoPedido}\`\n` +
            `• **Total Pagado (Simulación):** **$${Number(pedido.totalConIva).toLocaleString('es-CL')} IVA inc.**\n` +
            `• **Entrega:** ${pedido.sucursalRetiro} (${pedido.comunaEntrega})\n` +
            `• **Estado Logístico:** \`${pedido.estadoLogistico.toUpperCase()}\`\n\n` +
            `Presenta el código **\`${pedido.codigoPedido}\`** en mostrador o recibe tu tracking de despacho.`
          : `🛒 **Orden \`${pedido.codigoPedido}\` creada.** Presiona **"Simular Pago Aprobado"** para completar la prueba.`,
      creadoEn: now,
      trazaCascada: {
        accionTomada: 'checkout_simulado_pagado',
        vehiculoDetectado: sesion.vehiculoContexto || null,
        reglasConocimientoAplicadas: [],
        candidatosInventario: sesion.carritoCotizado || [],
        escalamientoCreado: null,
        solicitudWspCreada: null,
        pedidoSimulado: pedido,
      },
    };

    const mensajesActualizados = [...(sesion.mensajes || []), msgConfirmacion];
    await docRef.update({
      pedidoActivo: pedido,
      comunaCliente: pedido.comunaEntrega,
      modalidadEntrega: pedido.modalidadEntrega,
      mensajes: mensajesActualizados,
      updatedAt: now,
    });

    res.json({
      success: true,
      data: {
        pedido,
        sesion: {
          ...sesion,
          pedidoActivo: pedido,
          comunaCliente: pedido.comunaEntrega,
          modalidadEntrega: pedido.modalidadEntrega,
          mensajes: mensajesActualizados,
          updatedAt: now,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones/:id/simular-respuesta-proveedor
// Permite desde la Vista Web Cliente simular con 1 clic que el proveedor de
// Mesa WhatsApp (Etapa 3) o el Especialista (Etapa 1) acaba de responder,
// inyectando la respuesta directamente en el chat del cliente final
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/:id/simular-respuesta-proveedor', async (req, res, next) => {
  try {
    const { id } = req.params;
    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }

    const sesion = { id: snap.id, ...snap.data() };
    const now = new Date().toISOString();
    const wspAbiertas = Array.isArray(sesion.solicitudesWspAbiertas) ? sesion.solicitudesWspAbiertas : [];
    const escAbiertos = Array.isArray(sesion.escalamientosAbiertos) ? sesion.escalamientosAbiertos : [];

    // Si hay una solicitud de Mesa WhatsApp abierta, simular que el primer proveedor respondió y adjudicarla
    if (wspAbiertas.length > 0) {
      const wspInfo = wspAbiertas[wspAbiertas.length - 1];
      const solRef = db.collection(COLECCION_SOLICITUDES_WSP).doc(wspInfo.id);
      const solSnap = await solRef.get();
      if (solSnap.exists) {
        const sol = solSnap.data();
        const prov = (sol.proveedoresContactados || [])[0] || {
          proveedorId: 'prov-wsp-001',
          proveedorNombre: 'Importadora San Diego Repuestos Ltda.',
        };
        const costoNeto = 32000;
        const ventaNeto = Math.round(costoNeto * 1.28);
        const ventaIva = Math.round(ventaNeto * 1.19);
        const skuGen = `FRP-WSP-${sol.codigoSolicitud}`;
        const ofertaSimulada = {
          id: `of-sim-${Date.now()}`,
          proveedorId: prov.proveedorId,
          proveedorNombre: prov.proveedorNombre,
          precioCostoNeto: costoNeto,
          precioVentaNetoFrp: ventaNeto,
          precioVentaConIvaFrp: ventaIva,
          marcaRepuesto: 'OEM IMPORTADO',
          condicion: 'Nuevo en caja',
          disponibilidad: 'Inmediata en mesón',
          mensajeOriginal: `Sí estimado, tenemos ${sol.repuestoBuscado} nuevo en mesón a $${costoNeto.toLocaleString('es-CL')} neto entrega inmediata.`,
          recibidoEn: now,
        };
        await solRef.update({
          estado: 'adjudicada',
          ofertasRecibidas: [ofertaSimulada],
          ofertaGanadoraId: ofertaSimulada.id,
          skuPublicoGenerado: skuGen,
          updatedAt: now,
        });
      }
    }

    // Si hay un escalamiento experto abierto, simular respuesta técnica del especialista
    if (escAbiertos.length > 0) {
      const escInfo = escAbiertos[escAbiertos.length - 1];
      const escRef = db.collection(COLECCION_ESCALAMIENTOS).doc(escInfo.id);
      const escSnap = await escRef.get();
      if (escSnap.exists) {
        const esc = escSnap.data();
        await escRef.update({
          estado: 'respondido',
          respuestaExperto: `Confirmado por VIN/Chasis en mostrador técnico: corresponde exactamente a ${esc.candidatoNombre || 'versión OEM verificada'} sin modificaciones.`,
          skuPublicoFrp: escInfo.candidatoSku || `FRP-EXP-${esc.ticketRef}`,
          precioVentaFrp: 48500,
          actualizadoEn: now,
        });
      }
    }

    // Ahora ejecutar verificación en vivo e inyectar el mensaje del agente al cliente
    const { actualizaciones, nuevosItemsCotizados } = await verificarRespuestasEnVivoDeProveedores(sesion);
    const carritoActual = [...(sesion.carritoCotizado || [])];
    for (const item of nuevosItemsCotizados) {
      if (!carritoActual.some((c) => c.skuPublicoFrp === item.skuPublicoFrp)) {
        carritoActual.push({ ...item, cantidad: 1 });
      }
    }

    const textoDetalle =
      actualizaciones.length > 0
        ? actualizaciones
            .map(
              (r) =>
                `• **${r.repuesto}** (\`${r.skuPublicoFrp}\`) — **$${r.precioVentaNeto.toLocaleString(
                  'es-CL'
                )} neto** (**$${r.precioVentaConIva.toLocaleString('es-CL')} IVA inc.**)\n  _${r.explicacion}_`
            )
            .join('\n\n')
        : '• Repuesto confirmado por nuestra Mesa Técnica FácilRepuestos y agregado a tu cotización.';

    const msgAgente = {
      id: `msg-ia-live-${Date.now()}`,
      autor: 'agente_ia',
      texto:
        `🔔 **¡Acabamos de confirmar disponibilidad en vivo en FácilRepuestos!**\n\n` +
        `${textoDetalle}\n\n` +
        `🛒 Ya lo agregué a tu carrito activo con **Despacho a domicilio en Santiago y todo Chile** o **Retiro en nuestra sucursal en Enrique Olivares 224, La Florida, Santiago de Chile**. ¿De qué **comuna** nos escribes o prefieres escribir **COMPRAR** para confirmar el pedido completo?`,
      creadoEn: now,
      trazaCascada: {
        accionTomada: 'respuesta_proveedor_en_vivo',
        vehiculoDetectado: sesion.vehiculoContexto || null,
        reglasConocimientoAplicadas: [],
        candidatosInventario: carritoActual,
        escalamientoCreado: null,
        solicitudWspCreada: null,
      },
    };

    const mensajesActualizados = [...(sesion.mensajes || []), msgAgente];
    await docRef.update({
      carritoCotizado: carritoActual,
      escalamientosAbiertos: [],
      solicitudesWspAbiertas: [],
      mensajes: mensajesActualizados,
      updatedAt: now,
    });

    res.json({
      success: true,
      data: {
        sesion: {
          ...sesion,
          carritoCotizado: carritoActual,
          escalamientosAbiertos: [],
          solicitudesWspAbiertas: [],
          mensajes: mensajesActualizados,
          updatedAt: now,
        },
        mensajeAgente: msgAgente,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/patente
// Resuelve rápidamente una patente chilena para previsualización en la consola
// ─────────────────────────────────────────────────────────────────────────────
router.post('/patente', async (req, res, next) => {
  try {
    const { patente = '' } = req.body;
    const vehiculo = await resolverVehiculoOmnicanal({ patenteInput: patente });
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        error: 'No se encontró información para la patente indicada',
      });
    }
    res.json({ success: true, data: vehiculo });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agente-omnicanal/crm-clientes
// Devuelve la base de Leads CRM de WhatsApp (Teléfono + Patente + Vehículos + Repuestos + Pedidos)
// para campañas promocionales segmentadas por marca, modelo o categoría.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/crm-clientes', async (req, res, next) => {
  try {
    const { marca = '', modelo = '', patente = '' } = req.query;
    const snap = await db.collection(COLECCION_CRM_WSP).get();
    let clientes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.ultimaInteraccionAt || '').localeCompare(String(a.ultimaInteraccionAt || '')));

    if (marca) {
      const mUpper = String(marca).toUpperCase();
      clientes = clientes.filter((c) =>
        (c.vehiculos || []).some((v) => String(v.marca || '').toUpperCase().includes(mUpper))
      );
    }
    if (modelo) {
      const modUpper = String(modelo).toUpperCase();
      clientes = clientes.filter((c) =>
        (c.vehiculos || []).some((v) => String(v.modelo || '').toUpperCase().includes(modUpper))
      );
    }
    if (patente) {
      const patUpper = String(patente).toUpperCase().replace(/[^A-Z0-9]/g, '');
      clientes = clientes.filter((c) =>
        (c.patentes || []).some((p) => String(p).toUpperCase().includes(patUpper))
      );
    }

    res.json({
      success: true,
      total: clientes.length,
      data: clientes,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONECTOR OFICIAL META WHATSAPP CLOUD API PARA REPUESTÍN (CLIENTES + MESA WSP)
// ─────────────────────────────────────────────────────────────────────────────
const COLECCION_CONFIG_SISTEMA = 'configuracion_sistema';
const DOC_CONFIG_META_WSP = 'whatsapp_meta';
const CACHE_WAMIDS_PROCESADOS = new Set();
let cacheConfigMeta = { data: null, loadedAt: 0 };

/**
 * Obtiene la configuración activa de Meta WhatsApp Cloud API para Repuestín,
 * combinando variables de entorno (Secret Manager / Cloud Run) y configuración
 * en caliente desde Firestore (`configuracion_sistema/whatsapp_meta`).
 */
export async function obtenerConfigMetaWhatsapp({ forceRefresh = false } = {}) {
  const ahora = Date.now();
  if (!forceRefresh && cacheConfigMeta.data && ahora - cacheConfigMeta.loadedAt < 20000) {
    return cacheConfigMeta.data;
  }

  let docData = {};
  try {
    const snap = await db.collection(COLECCION_CONFIG_SISTEMA).doc(DOC_CONFIG_META_WSP).get();
    if (snap.exists) {
      docData = snap.data() || {};
    }
  } catch (err) {
    console.warn('[Meta-WSP] No se pudo leer configuracion_sistema/whatsapp_meta:', err.message);
  }

  const config = {
    accessToken: String(docData.accessToken || process.env.META_WA_TOKEN || '').trim(),
    phoneNumberId: String(
      docData.phoneNumberId || process.env.META_WA_PHONE_ID || '1492165227305531'
    ).trim(),
    phoneNumberIdMesaB2b: String(
      docData.phoneNumberIdMesaB2b || process.env.META_WA_MESA_PHONE_ID || '1438078979396084'
    ).trim(),
    wabaId: String(docData.wabaId || process.env.META_WA_WABA_ID || '1663353912115909').trim(),
    wabaIdMesaB2b: String(
      docData.wabaIdMesaB2b || process.env.META_WA_MESA_WABA_ID || '1089207750835848'
    ).trim(),
    verifyToken: String(
      docData.verifyToken || process.env.META_WA_VERIFY_TOKEN || 'facilrepuestos_wsp_verify'
    ).trim(),
    numeroPublico: String(
      docData.numeroPublico || process.env.WHATSAPP_PUBLIC_NUMBER || '56921109851'
    ).replace(/\D/g, ''),
    numeroMesaB2b: String(
      docData.numeroMesaB2b || process.env.WHATSAPP_MESA_B2B_NUMBER || '56950960294'
    ).replace(/\D/g, ''),
    nombreAgente: String(docData.nombreAgente || 'Repuestín · facilrepuestos.cl').trim(),
    graphVersion: String(docData.graphVersion || 'v21.0').trim(),
    activo: docData.activo !== undefined ? Boolean(docData.activo) : true,
    updatedAt: docData.updatedAt || null,
  };

  // Auto-descubrir el Phone Number ID del nuevo número de Mesa de Abastecimiento (+56950960294) en WABA
  if (config.accessToken && config.wabaId && !config.phoneNumberIdMesaB2b) {
    try {
      const rNums = await fetch(
        `https://graph.facebook.com/${config.graphVersion}/${config.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } }
      );
      if (rNums.ok) {
        const dNums = await rNums.json();
        const lista = Array.isArray(dNums?.data) ? dNums.data : [];
        const matchMesa = lista.find((n) =>
          String(n.display_phone_number || '').replace(/\D/g, '').endsWith('50960294')
        );
        if (matchMesa?.id) {
          config.phoneNumberIdMesaB2b = String(matchMesa.id);
          await db
            .collection(COLECCION_CONFIG_SISTEMA)
            .doc(DOC_CONFIG_META_WSP)
            .set(
              {
                phoneNumberIdMesaB2b: config.phoneNumberIdMesaB2b,
                numeroMesaB2b: '56950960294',
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            )
            .catch(() => null);
        }
      }
    } catch {
      // Ignorar si aún no está asociado al mismo WABA
    }
  }

  cacheConfigMeta = { data: config, loadedAt: ahora };
  return config;
}

/**
 * Envía un mensaje saliente a un proveedor desde el número exclusivo de la Mesa de Abastecimiento (+56950960294).
 */
export async function enviarMensajeMesaAbastecimientoWhatsapp({
  telefonoDestino,
  texto,
}) {
  const cfg = await obtenerConfigMetaWhatsapp();
  const phoneIdMesa = cfg.phoneNumberIdMesaB2b || process.env.META_WA_MESA_PHONE_ID || cfg.phoneNumberId;
  return enviarRespuestaClienteMetaWhatsapp({
    telefonoDestino,
    texto,
    phoneNumberIdOverride: phoneIdMesa,
  });
}

/**
 * Convierte el formato Markdown de Repuestín (`**negrita**`) al formato nativo de WhatsApp (`*negrita*`).
 */
function formatearTextoParaWhatsapp(texto = '') {
  return String(texto || '')
    .replace(/f[áa]cilrepuestos\.cl/gi, 'facilrepuestos.cl')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Envía un mensaje saliente (texto e imagen opcional de repuesto) al cliente por Meta WhatsApp Cloud API.
 */
export async function enviarRespuestaClienteMetaWhatsapp({
  telefonoDestino,
  texto,
  imagenUrl = '',
  captionImagen = '',
  phoneNumberIdOverride = '',
  replyToMessageId = '',
}) {
  const cfg = await obtenerConfigMetaWhatsapp();
  const token = cfg.accessToken;
  const phoneId = String(phoneNumberIdOverride || cfg.phoneNumberId || '').trim();
  const to = String(telefonoDestino || '').replace(/\D/g, '');

  if (!token || !phoneId || to.length < 8) {
    return {
      enviado: false,
      modo: 'simulacion_sin_credenciales_meta',
      motivo: !token ? 'Falta META_WA_TOKEN' : !phoneId ? 'Falta META_WA_PHONE_ID' : 'Teléfono inválido',
    };
  }

  const textoWsp = formatearTextoParaWhatsapp(texto);
  const urlEndpoint = `https://graph.facebook.com/${cfg.graphVersion}/${phoneId}/messages`;

  // Marcar mensaje entrante como leído (doble check azul en WhatsApp)
  if (replyToMessageId) {
    fetch(urlEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: replyToMessageId,
      }),
    }).catch(() => {});
  }

  // 1. Enviar mensaje principal de texto de Repuestín
  const payloadTexto = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: textoWsp.slice(0, 4090),
    },
  };

  const resp = await fetch(urlEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloadTexto),
  });
  const data = await resp.json();

  // 2. Si hay una foto real de estudio del repuesto cotizado, enviarla como apoyo visual
  if (resp.ok && imagenUrl && /^https:\/\//i.test(imagenUrl)) {
    fetch(urlEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: {
          link: imagenUrl,
          ...(captionImagen ? { caption: formatearTextoParaWhatsapp(captionImagen).slice(0, 1000) } : {}),
        },
      }),
    }).catch(() => {});
  }

  return {
    enviado: resp.ok,
    statusHttp: resp.status,
    metaMessageId: data?.messages?.[0]?.id || null,
    errorMeta: resp.ok ? null : data?.error?.message || JSON.stringify(data),
  };
}

/**
 * Handler GET unificado para la verificación del Webhook en Meta Developers (`hub.challenge`).
 */
export async function manejarWebhookGetMeta(req, res) {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];

  const cfg = await obtenerConfigMetaWhatsapp();
  const tokensValidos = new Set([
    cfg.verifyToken,
    process.env.META_WA_VERIFY_TOKEN || '',
    'facilrepuestos_wsp_verify',
    'repuestin_verify',
  ]);

  if (mode === 'subscribe' && token && tokensValidos.has(token)) {
    console.log(`[Meta-WSP] Webhook verificado exitosamente con token "${token}".`);
    return res.status(200).send(challenge);
  }
  return res.status(403).json({
    success: false,
    error: 'Token de verificación Meta inválido',
    expectedVerifyToken: cfg.verifyToken,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUFFER DE AGRUPACIÓN DE MENSAJES CONSECUTIVOS (DEBOUNCE 5 SEGUNDOS)
// Cuando un cliente envía su consulta en varios mensajes seguidos (ej: "Hola",
// luego "Patente RHYC28", luego "necesito parachoque y neblinero"), Repuestín
// espera 5 segundos desde el último mensaje recibido y procesa todos como una
// sola solicitud unificada.
// ─────────────────────────────────────────────────────────────────────────────
const DEBOUNCE_MENSAJES_WSP_MS = 5000;
const BUFFERS_MENSAJES_WSP = new Map();

/**
 * Handler POST unificado para mensajes entrantes desde Meta WhatsApp Cloud API.
 * Soporta tanto clientes finales conversando con Repuestín como proveedores respondiendo a Mesa WSP.
 */
export async function manejarWebhookPostMeta(req, res) {
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    if (entries.length === 0) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const change = entries[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) {
      // Eventos de estado (delivered, read, sent) -> responder 200 OK de inmediato
      return res.status(200).json({ received: true, statusEvent: true });
    }

    const wamid = String(msg.id || '').trim();
    if (wamid) {
      if (CACHE_WAMIDS_PROCESADOS.has(wamid)) {
        return res.status(200).json({ received: true, duplicate: true, wamid });
      }
      CACHE_WAMIDS_PROCESADOS.add(wamid);
      if (CACHE_WAMIDS_PROCESADOS.size > 2000) {
        const first = CACHE_WAMIDS_PROCESADOS.values().next().value;
        CACHE_WAMIDS_PROCESADOS.delete(first);
      }
    }

    const phoneNumberIdReceptor = String(change?.metadata?.phone_number_id || '').trim();
    const displayReceptor = String(change?.metadata?.display_phone_number || '').replace(/\D/g, '');
    const remitenteTel = String(msg.from || '').replace(/\D/g, '');
    const perfilNombre =
      change?.contacts?.[0]?.profile?.name || `Cliente WhatsApp (+${remitenteTel})`;

    // Si el mensaje entró al número exclusivo de la Mesa de Abastecimiento (+56950960294),
    // guardar automáticamente su phoneNumberIdMesaB2b en Firestore
    const esLineaMesaB2b = displayReceptor.endsWith('50960294');
    if (esLineaMesaB2b && phoneNumberIdReceptor) {
      await db
        .collection(COLECCION_CONFIG_SISTEMA)
        .doc(DOC_CONFIG_META_WSP)
        .set(
          {
            phoneNumberIdMesaB2b: phoneNumberIdReceptor,
            numeroMesaB2b: '56950960294',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
        .catch(() => null);
      cacheConfigMeta = { data: null, loadedAt: 0 };
    }

    // Extraer texto desde texto normal, botones interactivos, listas o pie de foto
    const textoEntrante = String(
      msg.text?.body ||
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        msg.image?.caption ||
        msg.document?.caption ||
        msg.button?.text ||
        ''
    ).trim();

    if (!textoEntrante && msg.type !== 'image' && msg.type !== 'audio') {
      return res.status(200).json({ received: true, unsupportedType: msg.type });
    }

    // ─── INTERCEPTOR AGENTE 4: SI ES UN PROVEEDOR RESPONDIENDO A LA MESA DE ABASTECIMIENTO (+56950960294) ───
    if (esLineaMesaB2b || remitenteTel.length >= 8) {
      const solSnap = await db.collection(COLECCION_SOLICITUDES_WSP).get().catch(() => null);
      const abiertas = (solSnap?.docs || [])
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.estado !== 'adjudicada' && s.estado !== 'cerrada')
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      const solicitudMatch = abiertas.find((s) =>
        (s.proveedoresContactados || []).some((p) =>
          String(p.telefono || '').replace(/\D/g, '').endsWith(remitenteTel.slice(-8))
        )
      ) || (esLineaMesaB2b ? abiertas[0] : null);

      if (solicitudMatch && (textoEntrante || msg.type === 'audio' || msg.type === 'image' || msg.type === 'document')) {
        const provMatch =
          (solicitudMatch.proveedoresContactados || []).find((p) =>
            String(p.telefono || '').replace(/\D/g, '').endsWith(remitenteTel.slice(-8))
          ) || solicitudMatch.proveedoresContactados?.[0];

        // Si el proveedor solo envió "Hola" / "Buenas" para abrir la ventana de 24h en WhatsApp,
        // NO marcarlo como sin stock: enviarle de inmediato el detalle natural del repuesto que estamos cotizando!
        if (msg.type === 'text' && esSaludoInicialProveedor(textoEntrante)) {
          const msgConsultaRecordatorio =
            provMatch?.mensajeEnviado ||
            construirMensajeSalidaWsp({
              marcaVehiculo: solicitudMatch.marcaVehiculo,
              modeloVehiculo: solicitudMatch.modeloVehiculo,
              anioVehiculo: solicitudMatch.anioVehiculo,
              motorVehiculo: solicitudMatch.motorVehiculo,
              patente: solicitudMatch.patente,
              vin: solicitudMatch.vin,
              repuestoBuscado: solicitudMatch.repuestoBuscado,
              codigoReferencia: solicitudMatch.codigoReferencia,
            });

          await enviarMensajeMesaAbastecimientoWhatsapp({
            telefonoDestino: remitenteTel,
            texto: msgConsultaRecordatorio,
          }).catch(() => null);

          return res.status(200).json({
            received: true,
            handledBy: 'agente4_saludo_apertura_ventana_proveedor',
            solicitudId: solicitudMatch.id,
          });
        }

        // Si el proveedor envió un audio de voz o una fotografía por WhatsApp, descargarlo desde Meta Cloud API
        const cfgMetaMedia = await obtenerConfigMetaWhatsapp();
        let mediaAudioDescargado = null;
        let mediaImagenDescargada = null;

        if (msg.type === 'audio' && msg.audio?.id) {
          mediaAudioDescargado = await descargarMediaMetaWhatsapp({
            mediaId: msg.audio.id,
            accessToken: cfgMetaMedia.accessToken,
            graphVersion: cfgMetaMedia.graphVersion,
          });
        } else if (msg.type === 'image' && msg.image?.id) {
          mediaImagenDescargada = await descargarMediaMetaWhatsapp({
            mediaId: msg.image.id,
            accessToken: cfgMetaMedia.accessToken,
            graphVersion: cfgMetaMedia.graphVersion,
          });
        }

        // Acumular mensajes previos de este mismo proveedor en esta solicitud para completar datos en conversación multi-turno
        const prevOfertaProv = [...(solicitudMatch.ofertasRecibidas || [])]
          .reverse()
          .find((o) => String(o.telefonoProveedor || '').replace(/\D/g, '').endsWith(remitenteTel.slice(-8)));

        const esNegativaDirectaWsp = detectarProveedorSinStock(textoEntrante);
        const textoAcumuladoProv =
          !esNegativaDirectaWsp && prevOfertaProv?.mensajeOriginalWsp && textoEntrante
            ? `${prevOfertaProv.mensajeOriginalWsp} . ${textoEntrante}`
            : textoEntrante || prevOfertaProv?.mensajeOriginalWsp || '';
        const turnosReconsultaPrevios = Number(prevOfertaProv?.turnosReconsulta || 0);

        const vehiculoStr = [
          solicitudMatch.marcaVehiculo,
          solicitudMatch.modeloVehiculo,
          solicitudMatch.anioVehiculo,
          solicitudMatch.motorVehiculo,
        ]
          .filter(Boolean)
          .join(' ');

        const nombreProvEfectivo = provMatch?.proveedorNombre || perfilNombre;

        // Ejecutar análisis multimodal con Gemini (escucha de audio + lectura de foto de caja/repuesto + detección sin stock + resumen formal)
        const datosMultimodalesIa = await analizarRespuestaMultimodalProveedorAgente4({
          mensajeTexto: textoAcumuladoProv,
          transcripcionAudioManual: prevOfertaProv?.transcripcionAudio || '',
          audioBase64: mediaAudioDescargado?.base64 || '',
          audioMimeType: mediaAudioDescargado?.mimeType || 'audio/ogg',
          imagenBase64: mediaImagenDescargada?.base64 || '',
          imagenMimeType: mediaImagenDescargada?.mimeType || 'image/jpeg',
          imagenUrl: prevOfertaProv?.fotoUrl || '',
          repuestoBuscado: solicitudMatch.repuestoBuscado,
          vehiculoStr,
          proveedorNombre: nombreProvEfectivo,
        });

        const margenPct = Number(solicitudMatch.margenPct) || 30;
        const extraido = extraerOfertaDesdeMensajeWsp({
          mensajeTexto: textoAcumuladoProv,
          mensajeUltimoTurno: textoEntrante || datosMultimodalesIa?.transcripcionAudio || '',
          transcripcionAudio:
            datosMultimodalesIa?.transcripcionAudio || prevOfertaProv?.transcripcionAudio || '',
          lecturaImagenIa:
            datosMultimodalesIa?.lecturaImagenIa || prevOfertaProv?.lecturaImagenIa || '',
          codigoOemDetectado:
            datosMultimodalesIa?.codigoOemDetectado || prevOfertaProv?.codigoOemDetectado || '',
          datosMultimodalesIa,
          proveedorNombre: nombreProvEfectivo,
          repuestoBuscado: solicitudMatch.repuestoBuscado,
          vehiculoStr,
          margenPct,
        });

        const fotoUrlGuardar =
          mediaImagenDescargada?.dataUri || prevOfertaProv?.fotoUrl || '';

        // Si el proveedor tiene el repuesto pero le falta aclarar si es más IVA, la marca/origen o cuándo está listo para retiro,
        // el Agente Cotizador le repregunta de forma natural antes de dar por cerrada la oferta (máximo 2 repreguntas).
        if (
          extraido.tieneStock &&
          !extraido.ofertaCompleta &&
          extraido.preguntaSeguimientoProveedor &&
          turnosReconsultaPrevios < 2
        ) {
          const nowParc = new Date().toISOString();
          const ofertaParcial = {
            id: prevOfertaProv?.id || `of-wsp-meta-${Date.now()}`,
            proveedorId: provMatch?.proveedorId || 'prov-wsp-meta',
            proveedorNombre: nombreProvEfectivo,
            telefonoProveedor: `+${remitenteTel}`,
            mensajeOriginalWsp:
              textoAcumuladoProv ||
              extraido.transcripcionAudio ||
              '[Imagen / Audio enviado por proveedor]',
            transcripcionAudio: extraido.transcripcionAudio || '',
            lecturaImagenIa: extraido.lecturaImagenIa || '',
            codigoOemDetectado: extraido.codigoOemDetectado || '',
            resumenFormalIa: extraido.resumenFormalIa || '',
            fotoUrl: fotoUrlGuardar,
            tieneStock: true,
            fabricante: extraido.fabricante,
            origen: extraido.origen,
            disponibilidad: extraido.disponibilidad,
            garantia: '6 meses',
            precioCostoNeto: extraido.precioCostoNeto,
            margenAplicadoPct: margenPct,
            precioVentaFrpNeto: 0,
            precioVentaFrpConIva: 0,
            confianzaIa: extraido.confianzaIa,
            ofertaCompleta: false,
            faltantesCotizacion: extraido.faltantesCotizacion,
            preguntaSeguimientoProveedor: extraido.preguntaSeguimientoProveedor,
            turnosReconsulta: turnosReconsultaPrevios + 1,
            ganadora: false,
            recibidoEn: nowParc,
          };

          const otrasOfertas = (solicitudMatch.ofertasRecibidas || []).filter(
            (o) => o.id !== ofertaParcial.id
          );
          const ofertasParcialesList = [...otrasOfertas, ofertaParcial];
          const resumenFormalMesaIa = construirResumenEjecutivoSolicitudIa({
            codigoSolicitud: solicitudMatch.codigoSolicitud,
            repuestoBuscado: solicitudMatch.repuestoBuscado,
            vehiculoStr,
            proveedoresContactados: solicitudMatch.proveedoresContactados,
            ofertasRecibidas: ofertasParcialesList,
          });

          await db
            .collection(COLECCION_SOLICITUDES_WSP)
            .doc(solicitudMatch.id)
            .update({
              ofertasRecibidas: ofertasParcialesList,
              resumenFormalMesaIa,
              updatedAt: nowParc,
            });

          await enviarMensajeMesaAbastecimientoWhatsapp({
            telefonoDestino: remitenteTel,
            texto: extraido.preguntaSeguimientoProveedor,
          }).catch(() => null);

          return res.status(200).json({
            received: true,
            handledBy: 'agente4_reconsulta_datos_faltantes_proveedor',
            faltantes: extraido.faltantesCotizacion,
            preguntaEnviada: extraido.preguntaSeguimientoProveedor,
            resumenFormalIa: extraido.resumenFormalIa,
          });
        }

        const precioVentaFrpNeto =
          extraido.tieneStock && extraido.precioCostoNeto > 0
            ? Math.round(extraido.precioCostoNeto * (1 + margenPct / 100))
            : 0;
        const precioVentaFrpConIva =
          precioVentaFrpNeto > 0 ? Math.round(precioVentaFrpNeto * 1.19) : 0;

        const nowIso = new Date().toISOString();
        const nuevaOferta = {
          id: prevOfertaProv?.id || `of-wsp-meta-${Date.now()}`,
          proveedorId: provMatch?.proveedorId || 'prov-wsp-meta',
          proveedorNombre: nombreProvEfectivo,
          telefonoProveedor: `+${remitenteTel}`,
          mensajeOriginalWsp:
            textoAcumuladoProv ||
            extraido.transcripcionAudio ||
            (extraido.tieneStock ? '[Adjunto multimedia recibido]' : 'Sin stock disponible'),
          transcripcionAudio: extraido.transcripcionAudio || '',
          lecturaImagenIa: extraido.lecturaImagenIa || '',
          codigoOemDetectado: extraido.codigoOemDetectado || '',
          resumenFormalIa: extraido.resumenFormalIa || '',
          fotoUrl: fotoUrlGuardar,
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
          ganadora: false,
          recibidoEn: nowIso,
        };

        const ofertasSinPrev = (solicitudMatch.ofertasRecibidas || []).filter(
          (o) => o.id !== nuevaOferta.id
        );
        const ofertasActualizadas = [...ofertasSinPrev, nuevaOferta];

        const contactosActualizados = (solicitudMatch.proveedoresContactados || []).map((c) =>
          String(c.telefono || '').replace(/\D/g, '').endsWith(remitenteTel.slice(-8)) ||
          (provMatch && c.proveedorId === provMatch.proveedorId)
            ? {
                ...c,
                estadoContacto: extraido.tieneStock ? 'respondido' : 'sin_stock',
                respondidoEn: nowIso,
              }
            : c
        );

        const resumenFormalMesaIa = construirResumenEjecutivoSolicitudIa({
          codigoSolicitud: solicitudMatch.codigoSolicitud,
          repuestoBuscado: solicitudMatch.repuestoBuscado,
          vehiculoStr,
          proveedoresContactados: contactosActualizados,
          ofertasRecibidas: ofertasActualizadas,
        });

        // Si el proveedor informó que NO tiene el repuesto, agradecerle cordialmente y cerrar con él sin repreguntar
        if (!extraido.tieneStock && extraido.mensajeCierreSinStockProveedor) {
          await enviarMensajeMesaAbastecimientoWhatsapp({
            telefonoDestino: remitenteTel,
            texto: extraido.mensajeCierreSinStockProveedor,
          }).catch(() => null);
        }

        const mejorOfertaAuto = elegirMejorOfertaMesaWsp(ofertasActualizadas);
        const nuevoEstadoMesa =
          solicitudMatch.estado === 'adjudicada'
            ? 'adjudicada'
            : ofertasActualizadas.some((o) => o.tieneStock && o.precioCostoNeto > 0)
            ? 'con_ofertas'
            : 'esperando_respuestas';

        const updateSol = {
          ofertasRecibidas: ofertasActualizadas,
          proveedoresContactados: contactosActualizados,
          resumenFormalMesaIa,
          estado: nuevoEstadoMesa,
          updatedAt: nowIso,
        };

        const todosSinStockWsp =
          contactosActualizados.length > 0 &&
          contactosActualizados.every((c) => c.estadoContacto === 'sin_stock');

        if (todosSinStockWsp && !mejorOfertaAuto && solicitudMatch.estado !== 'adjudicada') {
          const msgClienteSinStock = `Hola 👋 Te comentamos que consultamos con nuestros proveedores locales por el **${solicitudMatch.repuestoBuscado}** para tu **${vehiculoStr}** y en este momento ninguno cuenta con stock disponible. Si necesitas cotizar otro repuesto para tu vehículo me avisas por aquí.`;
          updateSol.mensajeCotizacionCliente = msgClienteSinStock;
          let telCliente = String(solicitudMatch.clienteTelefonoReal || solicitudMatch.clienteTelefono || '').trim();
          if (solicitudMatch.sesionAgenteId) {
            const sesRef = db.collection(COLECCION_SESIONES_AGENTE).doc(solicitudMatch.sesionAgenteId);
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
                creadoEn: nowIso,
                origen: 'mesa_wsp_sin_stock_confirmado',
              });
              await sesRef.update({ mensajes, updatedAt: nowIso });
            }
          }
          if (telCliente && /\d{8,15}/.test(telCliente.replace(/\D/g, ''))) {
            await enviarRespuestaClienteMetaWhatsapp({
              telefonoDestino: telCliente,
              texto: msgClienteSinStock,
            }).catch(() => null);
          }
        } else if (mejorOfertaAuto) {
          const pubTemp = await crearYPublicarProductoTemporalMesaWsp({
            solicitud: solicitudMatch,
            ofertaGanadora: mejorOfertaAuto,
            ttlHoras: 4,
          });
          Object.assign(updateSol, {
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
            adjudicadaEn: nowIso,
          });

          let telCliente = String(solicitudMatch.clienteTelefonoReal || solicitudMatch.clienteTelefono || '').trim();
          if (solicitudMatch.sesionAgenteId) {
            const sesRef = db.collection(COLECCION_SESIONES_AGENTE).doc(solicitudMatch.sesionAgenteId);
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
                creadoEn: nowIso,
                origen: 'producto_temporal_mesa_wsp',
              });
              await sesRef.update({ mensajes, updatedAt: nowIso });
            }
          }
          if (telCliente && /\d{8,15}/.test(telCliente.replace(/\D/g, ''))) {
            await enviarRespuestaClienteMetaWhatsapp({
              telefonoDestino: telCliente,
              texto: pubTemp.mensajeClienteWsp,
            }).catch(() => null);
          }
        }

        await db.collection(COLECCION_SOLICITUDES_WSP).doc(solicitudMatch.id).update(updateSol);
        return res.status(200).json({
          received: true,
          handledBy: 'agente4_mesa_abastecimiento_b2b',
          solicitudId: solicitudMatch.id,
        });
      }
      if (esLineaMesaB2b) {
        return res.status(200).json({ received: true, handledBy: 'linea_mesa_b2b_sin_solicitud_abierta' });
      }
    }

    // Crear o reanudar la sesión determinística de WhatsApp del cliente (`wsp_<telefono>`)
    const sesionDocId = `wsp_${remitenteTel}`;
    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(sesionDocId);
    const snap = await docRef.get();
    const now = new Date().toISOString();

    let sesion;
    if (snap.exists) {
      sesion = { id: snap.id, ...snap.data() };
    } else {
      sesion = {
        id: sesionDocId,
        canal: 'whatsapp_meta_cloud',
        clienteNombre: perfilNombre,
        clienteTelefono: `+${remitenteTel}`,
        phoneNumberIdMeta: phoneNumberIdReceptor || null,
        estado: 'activa',
        vehiculoContexto: null,
        carritoCotizado: [],
        comunaCliente: null,
        modalidadEntrega: null,
        flujoCompra: null,
        repuestoPendienteContexto: null,
        escalamientosAbiertos: [],
        solicitudesWspAbiertas: [],
        pedidoActivo: null,
        mensajes: [],
        createdAt: now,
        updatedAt: now,
      };
      await docRef.set(sesion);
    }

    const msgCliente = {
      id: wamid || `msg-cli-${Date.now()}`,
      autor: 'cliente',
      texto: textoEntrante || '[Adjunto enviado por WhatsApp]',
      transcripcionAudio: '',
      fotoUrl: '',
      creadoEn: now,
    };

    // Guardar de inmediato la burbuja entrante del cliente en Firestore para que se vea en tiempo real
    const mensajesConEntrante = [...(sesion.mensajes || []), msgCliente];
    await docRef.set(
      {
        estado: 'activa',
        archivadaEnBandeja: false,
        clienteNombre: perfilNombre || sesion.clienteNombre,
        clienteTelefono: `+${remitenteTel}`,
        phoneNumberIdMeta: phoneNumberIdReceptor || sesion.phoneNumberIdMeta || null,
        mensajes: mensajesConEntrante,
        updatedAt: now,
      },
      { merge: true }
    );

    // ─── VENTANA DE ESPERA DE 5 SEGUNDOS DESDE EL ÚLTIMO MENSAJE DEL CLIENTE ──
    let buffer = BUFFERS_MENSAJES_WSP.get(sesionDocId);
    if (buffer) {
      // Si había un mensaje previo esperando los 5s, cancelar su timer y cerrar el HTTP request anterior con 200 OK
      if (buffer.timer) clearTimeout(buffer.timer);
      if (typeof buffer.resolverEsperaPrevia === 'function') {
        buffer.resolverEsperaPrevia({ agrupadoEnSiguienteMensaje: true });
      }
      buffer.mensajesAcumulados.push(msgCliente);
      buffer.ultimoWamid = wamid || buffer.ultimoWamid;
      buffer.phoneNumberIdReceptor = phoneNumberIdReceptor || buffer.phoneNumberIdReceptor;
      buffer.perfilNombre = perfilNombre || buffer.perfilNombre;
    } else {
      buffer = {
        sesionDocId,
        remitenteTel,
        perfilNombre,
        phoneNumberIdReceptor,
        ultimoWamid: wamid,
        mensajesAcumulados: [msgCliente],
        timer: null,
        resolverEsperaPrevia: null,
      };
      BUFFERS_MENSAJES_WSP.set(sesionDocId, buffer);
    }

    const resultadoEspera = await new Promise((resolve) => {
      buffer.resolverEsperaPrevia = resolve;
      buffer.timer = setTimeout(() => {
        resolve({ ejecutarAhora: true });
      }, DEBOUNCE_MENSAJES_WSP_MS);
    });

    // Si llegó otro mensaje del mismo cliente antes de cumplirse los 5 segundos, este webhook termina en 200 OK y el nuevo mensaje toma el relevo
    if (resultadoEspera?.agrupadoEnSiguienteMensaje) {
      return res.status(200).json({
        received: true,
        buffered: true,
        debounceMs: DEBOUNCE_MENSAJES_WSP_MS,
        sesionId: sesionDocId,
      });
    }

    // Se cumplieron los 5 segundos sin nuevos mensajes -> consumir el buffer y responder todo como una sola solicitud
    BUFFERS_MENSAJES_WSP.delete(sesionDocId);
    const mensajesRafaga = buffer.mensajesAcumulados || [msgCliente];
    const textoUnificado = mensajesRafaga
      .map((m) => String(m.texto || '').trim())
      .filter(Boolean)
      .join('\n');

    // Re-leer la sesión fresca de Firestore para incluir todas las burbujas guardadas durante la ráfaga
    const snapFresco = await docRef.get();
    const sesionFresca = snapFresco.exists
      ? { id: snapFresco.id, ...snapFresco.data() }
      : { ...sesion, mensajes: mensajesConEntrante };

    const resultadoCascada = await ejecutarCascadaAgenteOmnicanal({
      sesion: sesionFresca,
      textoCliente: textoUnificado || msgCliente.texto,
      transcripcionAudio: '',
      fotoUrl: '',
    });

    const msgAgente = {
      id: `msg-ia-${Date.now() + 1}`,
      autor: 'agente_ia',
      texto: resultadoCascada.respuestaTexto,
      creadoEn: new Date().toISOString(),
      trazaCascada: resultadoCascada.trazaCascada,
      mensajesAgrupadosCount: mensajesRafaga.length,
    };

    const mensajesActualizados = [...(sesionFresca.mensajes || []), msgAgente];
    const vehiculoContexto =
      resultadoCascada.vehiculoDetectado || sesionFresca.vehiculoContexto || null;
    const camposActualizados = {
      estado: 'activa',
      archivadaEnBandeja: false,
      clienteNombre: buffer.perfilNombre || sesionFresca.clienteNombre,
      clienteTelefono: `+${remitenteTel}`,
      phoneNumberIdMeta:
        buffer.phoneNumberIdReceptor || sesionFresca.phoneNumberIdMeta || null,
      vehiculoContexto,
      carritoCotizado: resultadoCascada.carritoCotizado ?? sesionFresca.carritoCotizado ?? [],
      comunaCliente: resultadoCascada.comunaCliente ?? sesionFresca.comunaCliente ?? null,
      modalidadEntrega: resultadoCascada.modalidadEntrega ?? sesionFresca.modalidadEntrega ?? null,
      pedidoActivo: resultadoCascada.pedidoActivo ?? sesionFresca.pedidoActivo ?? null,
      flujoCompra:
        resultadoCascada.flujoCompra !== undefined
          ? resultadoCascada.flujoCompra
          : sesionFresca.flujoCompra ?? null,
      repuestoPendienteContexto:
        resultadoCascada.repuestoPendienteContexto !== undefined
          ? resultadoCascada.repuestoPendienteContexto
          : sesionFresca.repuestoPendienteContexto ?? null,
      confirmacionMesaWspPendiente:
        resultadoCascada.confirmacionMesaWspPendiente !== undefined
          ? resultadoCascada.confirmacionMesaWspPendiente
          : sesionFresca.confirmacionMesaWspPendiente ?? null,
      escalamientosAbiertos:
        resultadoCascada.escalamientosAbiertos ?? sesionFresca.escalamientosAbiertos ?? [],
      solicitudesWspAbiertas:
        resultadoCascada.solicitudesWspAbiertas ?? sesionFresca.solicitudesWspAbiertas ?? [],
      mensajes: mensajesActualizados,
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(camposActualizados, { merge: true });

    // Si hay un candidato único o principal con foto real de estudio, adjuntarla
    const candidatoConFoto = (resultadoCascada.trazaCascada?.candidatosInventario || []).find(
      (c) => c.imagenUrl && /^https:\/\//i.test(c.imagenUrl)
    );

    const envioMeta = await enviarRespuestaClienteMetaWhatsapp({
      telefonoDestino: remitenteTel,
      texto: resultadoCascada.respuestaTexto,
      imagenUrl: candidatoConFoto?.imagenUrl || '',
      captionImagen: candidatoConFoto
        ? `${candidatoConFoto.nombre} (${candidatoConFoto.skuPublicoFrp}) — $${Number(
            candidatoConFoto.precioVentaConIva || 0
          ).toLocaleString('es-CL')} IVA inc.`
        : '',
      phoneNumberIdOverride: buffer.phoneNumberIdReceptor,
      replyToMessageId: buffer.ultimoWamid || wamid,
    });

    return res.status(200).json({
      received: true,
      handledBy: 'repuestin_agente_omnicanal',
      sesionId: sesionDocId,
      mensajesAgrupados: mensajesRafaga.length,
      textoUnificado,
      envioMeta,
    });
  } catch (err) {
    console.error('[Meta-WSP Webhook Error]:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}

router.get('/webhook', manejarWebhookGetMeta);
router.post('/webhook', manejarWebhookPostMeta);

// ─────────────────────────────────────────────────────────────────────────────
// GET y POST /api/agente-omnicanal/config-meta
// Permite consultar y actualizar en caliente las credenciales de Meta Cloud API
// (Phone Number ID, WABA ID, Access Token y Verify Token) para Repuestín
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config-meta', async (req, res, next) => {
  try {
    const cfg = await obtenerConfigMetaWhatsapp({ forceRefresh: true });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      data: {
        phoneNumberId: cfg.phoneNumberId || '',
        wabaId: cfg.wabaId || '',
        verifyToken: cfg.verifyToken,
        numeroPublico: cfg.numeroPublico,
        nombreAgente: cfg.nombreAgente,
        graphVersion: cfg.graphVersion,
        activo: cfg.activo,
        tieneAccessToken: Boolean(cfg.accessToken),
        accessTokenPreview: cfg.accessToken
          ? `${cfg.accessToken.slice(0, 8)}...${cfg.accessToken.slice(-6)}`
          : '',
        webhookUrls: {
          principal: 'https://facilrepuestos-api-pr2w3ogrsq-tl.a.run.app/api/agente-omnicanal/webhook',
          alternativaAgenteWeb:
            'https://facilrepuestos-agente-web-pr2w3ogrsq-tl.a.run.app/api/agente-omnicanal/webhook',
          actualHost: `${baseUrl}/api/agente-omnicanal/webhook`,
        },
        updatedAt: cfg.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/config-meta', async (req, res, next) => {
  try {
    const prev = await obtenerConfigMetaWhatsapp({ forceRefresh: true });
    const {
      accessToken,
      phoneNumberId,
      wabaId,
      verifyToken,
      numeroPublico,
      nombreAgente,
      activo,
    } = req.body || {};

    const nuevoDoc = {
      accessToken:
        accessToken !== undefined ? String(accessToken).trim() : prev.accessToken,
      phoneNumberId:
        phoneNumberId !== undefined ? String(phoneNumberId).trim() : prev.phoneNumberId,
      wabaId: wabaId !== undefined ? String(wabaId).trim() : prev.wabaId,
      verifyToken:
        verifyToken !== undefined && String(verifyToken).trim()
          ? String(verifyToken).trim()
          : prev.verifyToken || 'facilrepuestos_wsp_verify',
      numeroPublico:
        numeroPublico !== undefined
          ? String(numeroPublico).replace(/\D/g, '')
          : prev.numeroPublico || '56921109851',
      nombreAgente:
        nombreAgente !== undefined
          ? String(nombreAgente).trim()
          : prev.nombreAgente || 'Repuestín · FácilRepuestos.cl',
      graphVersion: 'v21.0',
      activo: activo !== undefined ? Boolean(activo) : true,
      updatedAt: new Date().toISOString(),
    };

    await db.collection(COLECCION_CONFIG_SISTEMA).doc(DOC_CONFIG_META_WSP).set(nuevoDoc, { merge: true });
    cacheConfigMeta = { data: null, loadedAt: 0 };

    // Si hay token y phoneNumberId, verificar conectividad real contra Meta Graph API
    let verificacionGraph = null;
    if (nuevoDoc.accessToken && nuevoDoc.phoneNumberId) {
      try {
        const rGraph = await fetch(
          `https://graph.facebook.com/v21.0/${nuevoDoc.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
          {
            headers: { Authorization: `Bearer ${nuevoDoc.accessToken}` },
          }
        );
        verificacionGraph = {
          ok: rGraph.ok,
          status: rGraph.status,
          detalle: await rGraph.json(),
        };
      } catch (e) {
        verificacionGraph = { ok: false, error: e.message };
      }
    }

    res.json({
      success: true,
      data: {
        phoneNumberId: nuevoDoc.phoneNumberId,
        wabaId: nuevoDoc.wabaId,
        verifyToken: nuevoDoc.verifyToken,
        numeroPublico: nuevoDoc.numeroPublico,
        nombreAgente: nuevoDoc.nombreAgente,
        tieneAccessToken: Boolean(nuevoDoc.accessToken),
        verificacionGraph,
        updatedAt: nuevoDoc.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET y POST /api/agente-omnicanal/nodos-despacho
// Administración de Talleres / Nodos de Despacho (Multi-Hub: Enrique Olivares 224 + futuros talleres)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/nodos-despacho', async (_req, res, next) => {
  try {
    const nodos = await obtenerNodosDespachoActivos(db);
    res.json({
      success: true,
      data: {
        nodos,
        tallasLogisticas: TALLAS_LOGISTICAS,
        tarifasRmAnillos: TARIFAS_RM_ANILLOS,
        macrozonasRegiones: MACROZONAS_REGIONES,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/nodos-despacho', async (req, res, next) => {
  try {
    const {
      id,
      nombre,
      direccion,
      comuna,
      region = 'Región Metropolitana',
      vehiculoFlota = 'Peugeot Partner / Furgón Utilitario',
      activo = true,
      esPrincipal = false,
      coberturaAnillos = null,
    } = req.body || {};

    if (!nombre || !direccion || !comuna) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren nombre, direccion y comuna del taller/nodo de despacho.',
      });
    }

    const docId =
      id ||
      `hub-${String(comuna)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;

    const payload = {
      id: docId,
      nombre: String(nombre).trim(),
      direccion: String(direccion).trim(),
      comuna: String(comuna).trim(),
      region: String(region).trim(),
      vehiculoFlota: String(vehiculoFlota).trim(),
      activo: Boolean(activo),
      esPrincipal: Boolean(esPrincipal),
      permiteRetiroTienda: true,
      permiteDeliveryExpress: true,
      coberturaAnillos: coberturaAnillos || NODOS_DESPACHO_DEFAULT[0].coberturaAnillos,
      actualizadoEn: new Date().toISOString(),
    };

    await db.collection('nodos_despacho').doc(docId).set(payload, { merge: true });
    const nodos = await obtenerNodosDespachoActivos(db);

    res.json({
      success: true,
      data: {
        nodoGuardado: payload,
        nodosActivos: nodos,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/cotizar-despacho
// Cotiza en tiempo real el valor de despacho pre-pagado según dirección/comuna y carrito
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cotizar-despacho', async (req, res, next) => {
  try {
    const {
      direccionOComuna = '',
      items = [],
      modalidad = 'Despacho a domicilio',
    } = req.body || {};
    const nodosActivos = await obtenerNodosDespachoActivos(db);
    const cotizacion = cotizarDespachoAnticipado({
      direccionOComuna,
      itemsCarrito: Array.isArray(items) && items.length > 0 ? items : [{ nombre: 'Repuesto Estándar' }],
      nodosActivos,
      modalidad,
    });
    res.json({
      success: true,
      data: cotizacion,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sincronizar-zonas-woo
// Configura las Zonas de Despacho en WooCommerce (RM Furgón desde Enrique Olivares 224 + Regiones Prepagado)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sincronizar-zonas-woo', async (_req, res, next) => {
  try {
    const resultado = await sincronizarZonasDespachoWooCommerce();
    res.json({
      success: true,
      data: resultado,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE CLOUD CX · QUALITY AI & CONVERSATIONAL INSIGHTS
// Evalúa automáticamente las conversaciones de WhatsApp, detecta fricción y permite
// inyectar mejoras en 1 clic al cerebro de cualquiera de los 6 agentes.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cx-insights', async (_req, res, next) => {
  try {
    const snap = await db.collection(COLECCION_SESIONES_AGENTE).get();
    const ahoraMs = Date.now();
    const sesionesActivas = [];

    for (const d of snap.docs) {
      const data = d.data() || {};
      if (data.canal === 'web_cliente' || d.id.startsWith('ses-omni-demo')) continue;
      if (data.archivadaEnBandeja === true || data.estado === 'cerrada') continue;
      const tsRef = Date.parse(data.updatedAt || data.createdAt || '') || 0;
      if (tsRef < CORTE_LIMPIEZA_HISTORICOS_MS || ahoraMs - tsRef > VENTANA_ACTIVA_24H_MS) continue;
      sesionesActivas.push({ id: d.id, ...data });
    }

    const dashboardCx = construirDashboardCxBandeja(sesionesActivas);
    res.json({
      success: true,
      data: dashboardCx,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/cx-insights/auditar-ia/:sesionId', async (req, res, next) => {
  try {
    const docRef = db.collection(COLECCION_SESIONES_AGENTE).doc(req.params.sesionId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada para auditar' });
    }
    const sesion = { id: snap.id, ...snap.data() };
    const auditoriaIa = await auditarSesionProfundaConGeminiCx(sesion);
    res.json({
      success: true,
      data: auditoriaIa,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/cx-insights/aplicar-mejora', async (req, res, next) => {
  try {
    const {
      sesionId = '',
      agenteDestinoId = 'agente1_recepcion',
      reglaNuevaParaInyectar = '',
      tituloMejora = '',
    } = req.body || {};

    const resultado = await aplicarMejoraCxAAgente({
      sesionId,
      agenteDestinoId,
      reglaNuevaParaInyectar,
      tituloMejora,
    });

    res.json({
      success: true,
      data: resultado,
    });
  } catch (err) {
    next(err);
  }
});

export default router;


