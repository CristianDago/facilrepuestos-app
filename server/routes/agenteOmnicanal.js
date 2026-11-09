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
  sanitizarTextoParaProveedor,
  sanitizarMensajeHaciaClienteFinal,
} from '../services/ailooBridge.js';
import { sincronizarTodosLosNodosAiloo } from '../services/ailooCatalogSync.js';

const router = Router();

const COLECCION_SESIONES_AGENTE = 'sesiones_agente_omnicanal';
const COLECCION_CONOCIMIENTO = 'conocimiento_aprendido_ia';
const COLECCION_INVENTARIO = 'inventario';
const COLECCION_ESCALAMIENTOS = 'escalamientos_ia';
const COLECCION_SOLICITUDES_WSP = 'solicitudes_cotizacion_wsp';
const COLECCION_PROVEEDORES = 'proveedores';
const COLECCION_PEDIDOS_AGENTE = 'pedidos_agente_omnicanal';

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
  RANGER: 'FORD',
  AMAROK: 'VOLKSWAGEN',
  GOL: 'VOLKSWAGEN',
  ACTYON: 'SSANGYONG',
  T60: 'MAXUS',
  // Modelos marcas chinas (Luna Soluparts)
  A500: 'CHANGAN',
  MD201: 'CHANGAN',
  ALSVIN: 'CHANGAN',
  CS15: 'CHANGAN',
  CS35: 'CHANGAN',
  CS55: 'CHANGAN',
  HUNTER: 'CHANGAN',
  TIGGO: 'CHERY',
  ARRIZO: 'CHERY',
  IQ: 'CHERY',
  S2: 'JAC',
  S3: 'JAC',
  J4: 'JAC',
  T6: 'JAC',
  T8: 'JAC',
  URBAN: 'JAC',
  '1061': 'JAC',
  SUNRAY: 'JAC',
  REFINE: 'JAC',
  JOYEAR: 'DFM',
  AX3: 'DFM',
  AX4: 'DFM',
  AX7: 'DFM',
  SX5: 'DFM',
  SX6: 'DFM',
  S50: 'DFM',
  VOLEEX: 'GREAT WALL',
  C30: 'GREAT WALL',
  WINGLE: 'GREAT WALL',
  POER: 'GREAT WALL',
  H3: 'GREAT WALL',
  H6: 'HAVAL',
  JOLION: 'HAVAL',
  VIGUS: 'JMC',
  X35: 'BAIC',
  X25: 'BAIC',
  '580': 'DFSK',
};

const COMUNAS_Y_CIUDADES_CHILE = [
  { patron: /\b(SAN\s+BERNARDO)\b/i, nombre: 'San Bernardo (RM)', esRM: true },
  { patron: /\b(LA\s+CISTERNA)\b/i, nombre: 'La Cisterna (RM)', esRM: true },
  { patron: /\b(GRAN\s+AVENIDA)\b/i, nombre: 'Gran Avenida / La Cisterna (RM)', esRM: true },
  { patron: /\b(PUENTE\s+ALTO)\b/i, nombre: 'Puente Alto (RM)', esRM: true },
  { patron: /\b(MAIP[UÚ])\b/i, nombre: 'Maipú (RM)', esRM: true },
  { patron: /\b(RENCA)\b/i, nombre: 'Renca (RM)', esRM: true },
  { patron: /\b(LAMPA)\b/i, nombre: 'Lampa (RM)', esRM: true },
  { patron: /\b(QUILICURA)\b/i, nombre: 'Quilicura (RM)', esRM: true },
  { patron: /\b(SANTIAGO|CENTRO|DIEZ\s+DE\s+JULIO|10\s+DE\s+JULIO)\b/i, nombre: 'Santiago Centro (RM)', esRM: true },
  { patron: /\b(SAN\s+MIGUEL)\b/i, nombre: 'San Miguel (RM)', esRM: true },
  { patron: /\b(EL\s+BOSQUE)\b/i, nombre: 'El Bosque (RM)', esRM: true },
  { patron: /\b(LA\s+FLORIDA)\b/i, nombre: 'La Florida (RM)', esRM: true },
  { patron: /\b(ISLA\s+DE\s+MAIPO|TALAGANTE|BUIN|PAINE|MELIPILLA)\b/i, nombre: 'Zona Sur-Poniente RM', esRM: true },
  { patron: /\b(RANCAGUA|MACHAL[IÍ]|SAN\s+FERNANDO)\b/i, nombre: 'Rancagua (VI Región)', esRM: false },
  { patron: /\b(LA\s+SERENA|COQUIMBO|OVALLE)\b/i, nombre: 'La Serena / Coquimbo / Ovalle (IV Región)', esRM: false },
  { patron: /\b(ANTOFAGASTA|CALAMA)\b/i, nombre: 'Antofagasta (II Región)', esRM: false },
  { patron: /\b(CONCEPCI[OÓ]N|TALCAHUANO|CORONEL|CHIGUAYANTE|LOS\s+[AÁ]NGELES)\b/i, nombre: 'Concepción / Coronel (VIII Región)', esRM: false },
  { patron: /\b(PUERTO\s+MONTT|OSORNO|VALDIVIA|CASTRO)\b/i, nombre: 'Puerto Montt / Sur (X Región)', esRM: false },
  { patron: /\b(TEMUCO|VILLARRICA)\b/i, nombre: 'Temuco (IX Región)', esRM: false },
  { patron: /\b(VALPARA[IÍ]SO|VI[NÑ]A\s+DEL\s+MAR|QUILPU[EÉ]|SAN\s+ANTONIO|QUILLOTA)\b/i, nombre: 'Región de Valparaíso (V Región)', esRM: false },
  { patron: /\b(CURIC[OÓ]|TALCA|LINARES|CHILL[AÁ]N)\b/i, nombre: 'Curicó / Talca (VII Región)', esRM: false },
  { patron: /\b(IQUIQUE|ARICA|COPIAP[OÓ])\b/i, nombre: 'Zona Norte Grande', esRM: false },
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
    [/\bPARACHOQUES\b/gi, 'PARACHOQUE'],
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
  else if (/\b(OPTICO|PARACHOQUE|CAPOT|TAPABARRO|ESPEJO|FOCO|MASCARA|MANILLA|PORTALON|NEBLINERO)\b/.test(upper))
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
    .filter(Boolean);
  const tokensRepuesto = tokensTodo.filter(
    (tok) => !ignorar.has(tok) && !/^\d{4}$/.test(tok) && tok.length >= 3
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
    .split(/(?:\r?\n|[,;•*-]+|\s+\+\s+|\s+y\s+(?=(?:juego|kit|filtro|pastilla|disco|bujia|bobina|amortiguador|bandeja|correa|bomba|termostato|empaquetadura|homocinetica|cinta|optico|parachoque|espejo|radiador|sensor|soporte|maza|rodamiento|bieleta|terminal|axial|cremallera|piola|embrague|foco|neblinero|cazoleta|reten)\b))/i)
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
      ...info,
    });
  }

  if (subConsultas.length === 0) {
    subConsultas.push({
      fragmentoOriginal: textoNorm,
      ...extraerRepuestoYCategoria(textoNorm, vehiculo),
    });
  }

  return subConsultas.slice(0, 6);
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
  let comunaDetectada = null;

  for (const c of COMUNAS_Y_CIUDADES_CHILE) {
    if (c.patron.test(limpio)) {
      comunaDetectada = c;
      break;
    }
  }

  const upper = limpio.toUpperCase();
  const pideRetiro = /\b(RETIRO|RETIRAR|MOSTRADOR|BODEGA|TIENDA|SUCURSAL|VOY\s+A\s+BUSCAR|PRESENCIAL|ENRIQUE\s+OLIVARES|OLIVARES\s*224)\b/.test(upper);
  const pideDespacho = /\b(DESPACHO|ENV[IÍ]O|ENVIAR|DOMICILIO|STARKEN|CHILEXPRESS|BLUE\s*EXPRESS|POR\s+PAGAR)\b/.test(upper);

  // Es un mensaje enfocado en entrega/comuna si menciona una comuna o modalidad y tiene pocas palabras técnicas nuevas
  const esMensajeEntrega =
    Boolean(comunaDetectada) ||
    pideRetiro ||
    pideDespacho;

  return {
    esMensajeEntrega,
    comunaDetectada,
    modalidadPreferida: pideRetiro
      ? 'retiro_bodega'
      : pideDespacho
        ? 'despacho_domicilio'
        : comunaDetectada
          ? comunaDetectada.esRM
            ? 'retiro_o_despacho_rm'
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
    /\b(QUIERO\s+COMPRAR|CONFIRMAR\s+COMPRA|CONFIRMAR\s+PEDIDO|LO\s+COMPRO|GENERA\s+EL\s+LINK|ENVIAME\s+EL\s+LINK|MANDAME\s+EL\s+LINK)\b/.test(
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
        const data = snap.data();
        if (data.estado === 'respondido' && data.respuestaExperto) {
          const precioNeto = Number(data.precioVentaFrp || data.precioConfirmado || 45000);
          const precioConIva = Math.round(precioNeto * 1.19);
          actualizaciones.push({
            tipo: 'escalamiento_respondido',
            referencia: data.ticketRef || escInfo.ticketRef,
            proveedorNombre: 'Mesa Técnica FácilRepuestos',
            repuesto: data.candidatoNombre || 'Repuesto validado por especialista',
            skuPublicoFrp: data.skuPublicoFrp || escInfo.candidatoSku || `FRP-EXP-${data.ticketRef}`,
            explicacion: sanitizarMensajeHaciaClienteFinal(data.respuestaExperto || data.respuestaMostrador || ''),
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
  metodoPagoSimulado = 'sandbox_webpay_sin_tarjeta',
  itemsForzados = null,
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

  const codigoPedido = `FRP-PED-${Math.floor(100000 + Math.random() * 900000)}`;
  const subtotalNeto = itemsCarrito.reduce((acc, it) => acc + Number(it.precioVentaNeto || 0) * Number(it.cantidad || 1), 0);
  const totalConIva = itemsCarrito.reduce((acc, it) => acc + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1), 0);
  const now = new Date().toISOString();

  const nuevoPedido = {
    codigoPedido,
    sesionId: sesion.id,
    canal: sesion.canal || 'web_cliente',
    clienteNombre: sesion.clienteNombre || 'Cliente Web FácilRepuestos',
    clienteTelefono: sesion.clienteTelefono || 'Vista Web Sandbox',
    vehiculo: sesion.vehiculoContexto || null,
    items: itemsCarrito.map((it) => ({
      skuPublicoFrp: it.skuPublicoFrp,
      nombre: it.nombre,
      fabricante: it.fabricante || 'OEM',
      origen: it.origen || 'soluparts_ailoo',
      proveedorNombre: 'FácilRepuestos SpA',
      cantidad: Number(it.cantidad || 1),
      precioVentaNeto: Number(it.precioVentaNeto || 0),
      precioVentaConIva: Number(it.precioVentaConIva || 0),
    })),
    modalidadEntrega,
    comunaEntrega,
    sucursalRetiro:
      modalidadEntrega === 'retiro_bodega'
        ? 'Sucursal FácilRepuestos: Enrique Olivares 224, La Florida, Santiago de Chile'
        : 'Despacho a Domicilio FácilRepuestos (Santiago y todo Chile)',
    metodoPagoSimulado,
    estadoPago: 'pendiente_simulacion',
    estadoLogistico: 'reservado_en_bodega',
    subtotalNeto,
    totalConIva,
    urlCheckoutSimulado: `/chat-cliente?pedido=${codigoPedido}`,
    createdAt: now,
    updatedAt: now,
  };

  const pedRef = await db.collection(COLECCION_PEDIDOS_AGENTE).add(nuevoPedido);
  return { id: pedRef.id, ...nuevoPedido };
}

/**
 * Asegura que el catálogo unificado tenga los SKUs de Soluparts y Global cargados (incluyendo
 * los repuestos de marcas chinas de Luna) y que existan sesiones demo iniciales con el blindaje comercial activo.
 */
async function asegurarDatosInicialesAgente() {
  const invSnap = await db.collection(COLECCION_INVENTARIO).get();
  const tieneMarcasChinasLuna = invSnap.docs.some((d) => d.id === 'ailoo_soluparts_SOL-11090');
  if (!tieneMarcasChinasLuna) {
    try {
      await sincronizarTodosLosNodosAiloo({ forzar: true });
    } catch {
      // Ignorar si ya está sincronizando
    }
  }

  const demoDoc = await db.collection(COLECCION_SESIONES_AGENTE).doc('ses-omni-demo-porter').get();
  if (demoDoc.exists) {
    const demoData = demoDoc.data();
    const tieneDireccionAntigua = (demoData.mensajes || []).some((m) =>
      /Gran Avenida|San Bernardo|Soluparts/i.test(String(m.texto || ''))
    );
    if (!tieneDireccionAntigua) return;
  } else {
    const sesSnap = await db.collection(COLECCION_SESIONES_AGENTE).limit(1).get();
    if (!sesSnap.empty) return;
  }

  const now = new Date().toISOString();
  const sesionDemo = {
    id: 'ses-omni-demo-porter',
    canal: 'web_cliente',
    clienteNombre: 'Cliente Prueba Web — Flujo Luna Mejorado',
    clienteTelefono: '+56994128831',
    estado: 'activa',
    vehiculoContexto: {
      patente: 'PDSS87',
      marca: 'CHANGAN',
      modelo: 'CS15',
      anio: 2020,
      motor: '1.5 BLUECORE JL473QF',
      vin: 'LS4ASE2E5LA102938',
      fuente: 'padron_luna_soluparts',
    },
    carritoCotizado: [
      {
        id: 'ailoo_soluparts_SOL-29900',
        skuPublicoFrp: 'FRP-SOL-SOL-29900',
        nombre: 'PASTILLAS DE FRENO DELANTERAS CERÁMICAS CHANGAN CS15 / ALSVIN 1.4 - 1.5',
        fabricante: 'NETO / OEM',
        origen: 'soluparts_ailoo',
        proveedorNombre: 'FácilRepuestos SpA',
        stock: 12,
        cantidad: 1,
        precioVentaNeto: 24960,
        precioVentaConIva: 29702,
      },
    ],
    comunaCliente: 'La Florida, Santiago (RM)',
    modalidadEntrega: 'retiro_bodega',
    escalamientosAbiertos: [],
    solicitudesWspAbiertas: [],
    pedidoActivo: null,
    mensajes: [
      {
        id: 'msg-demo-1',
        autor: 'cliente',
        texto: 'Hola! Busco pastillas de freno delanteras para mi Changan CS15 patente PDSS87, ¿tienen stock?',
        transcripcionAudio: '',
        fotoUrl: '',
        creadoEn: now,
      },
      {
        id: 'msg-demo-2',
        autor: 'agente_ia',
        texto:
          '¡Hola! 🚗 Identifiqué tu **CHANGAN CS15 (2020) · Motor 1.5 BLUECORE JL473QF [Patente PDSS87]**.\n\nTenemos disponibilidad inmediata confirmada en FácilRepuestos:\n• **PASTILLAS DE FRENO DELANTERAS CERÁMICAS CHANGAN CS15 / ALSVIN 1.4 - 1.5** (`FRP-SOL-SOL-29900`) — Marca **NETO / OEM** · Stock: **12 un.** · **$24.960 neto** (**$29.702 IVA inc.**)\n\n📍 ¿Prefieres **Despacho a domicilio en Santiago y todo Chile** o **Retiro en nuestra tienda en Enrique Olivares 224, La Florida, Santiago de Chile**? Indícame tu comuna o escribe **COMPRAR** para confirmar tu pedido en el acto.',
        creadoEn: now,
        trazaCascada: {
          accionTomada: 'cotizacion_directa',
          vehiculoDetectado: {
            patente: 'PDSS87',
            marca: 'CHANGAN',
            modelo: 'CS15',
            anio: 2020,
            motor: '1.5 BLUECORE JL473QF',
            fuente: 'padron_luna_soluparts',
          },
          reglasConocimientoAplicadas: [],
          candidatosInventario: [
            {
              id: 'ailoo_soluparts_SOL-29900',
              skuPublicoFrp: 'FRP-SOL-SOL-29900',
              nombre: 'PASTILLAS DE FRENO DELANTERAS CERÁMICAS CHANGAN CS15 / ALSVIN 1.4 - 1.5',
              fabricante: 'NETO / OEM',
              origen: 'soluparts_ailoo',
              proveedorNombre: 'Soluparts (Ailoo Enterprise)',
              stock: 12,
              precioCostoProveedor: 19500,
              margenPct: 28,
              precioVentaNeto: 24960,
              precioVentaConIva: 29702,
            },
          ],
          escalamientoCreado: null,
          solicitudWspCreada: null,
        },
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(COLECCION_SESIONES_AGENTE).doc(sesionDemo.id).set(sesionDemo);
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

  // ─── PASO 0.B: INTENCIÓN `COMPRAR` (CHECKOUT SANDBOX SIN TARJETA) ──────────
  if (esIntencionComprar(textoBruto) && carritoActual.length > 0 && modoForzado === 'auto') {
    const infoEntrega = detectarComunaOModalidadEntrega(textoBruto);
    const modalidad =
      infoEntrega.modalidadPreferida || sesion.modalidadEntrega || 'retiro_bodega';
    const comuna =
      infoEntrega.comunaDetectada?.nombre || sesion.comunaCliente || 'La Florida, Santiago (RM)';

    const pedidoCreado = await crearPedidoSimuladoAgente({
      sesion: { ...sesion, carritoCotizado: carritoActual },
      modalidadEntrega: modalidad,
      comunaEntrega: comuna,
      metodoPagoSimulado: 'sandbox_webpay_sin_tarjeta',
    });

    const resumenLineas = carritoActual.map(
      (it) =>
        `• 1x **${it.nombre}** (\`${it.skuPublicoFrp}\`) — **$${Number(it.precioVentaConIva).toLocaleString('es-CL')} IVA inc.**`
    );

    const respuestaTexto =
      `🎉 **¡Pedido \`${pedidoCreado.codigoPedido}\` generado con éxito!**\n\n` +
      `📋 **Resumen de tu compra:**\n${resumenLineas.join('\n')}\n` +
      `• **Modalidad:** ${
        modalidad === 'retiro_bodega'
          ? '📍 Retiro en Tienda FácilRepuestos: Enrique Olivares 224, La Florida, Santiago de Chile (Sin costo de envío)'
          : `🚚 Despacho a domicilio en ${comuna} (Despachamos en Santiago y todo Chile)`
      }\n` +
      `• **Total a pagar:** **$${Number(pedidoCreado.totalConIva).toLocaleString('es-CL')} IVA inc.** ($${Number(
        pedidoCreado.subtotalNeto
      ).toLocaleString('es-CL')} neto)\n\n` +
      `💳 **Modo Prueba Web Activo (Sin tarjeta de crédito real):** Puedes simular la aprobación del pago con 1 clic en el botón **"✅ Simular Pago Aprobado"** de tu pantalla para completar la reserva de stock.`;

    return {
      vehiculoDetectado: sesion.vehiculoContexto || null,
      carritoCotizado: carritoActual,
      comunaCliente: comuna,
      modalidadEntrega: modalidad,
      pedidoActivo: pedidoCreado,
      escalamientosAbiertos: sesion.escalamientosAbiertos || [],
      solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
      respuestaTexto,
      trazaCascada: {
        accionTomada: 'checkout_simulado_creado',
        vehiculoDetectado: sesion.vehiculoContexto || null,
        reglasConocimientoAplicadas: [],
        candidatosInventario: carritoActual,
        escalamientoCreado: null,
        solicitudWspCreada: null,
        pedidoSimulado: pedidoCreado,
      },
    };
  }

  // ─── PASO 0.C: ANTI-SPAM DE SEGUIMIENTO ("ESPERO", "GRACIAS", "¿AÚN NADA?") ─
  const tienePendientes =
    (Array.isArray(sesion.escalamientosAbiertos) && sesion.escalamientosAbiertos.length > 0) ||
    (Array.isArray(sesion.solicitudesWspAbiertas) && sesion.solicitudesWspAbiertas.length > 0);

  if (esMensajeSeguimientoOCortesia(textoBruto) && modoForzado === 'auto') {
    if (respuestasVivas.length > 0) {
      const detalleRespuestas = respuestasVivas.map(
        (r) =>
          `✅ **Respuesta confirmada (${r.referencia} — Mesa Técnica FácilRepuestos):**\n• **${r.repuesto}** (\`${r.skuPublicoFrp}\`) — **$${r.precioVentaNeto.toLocaleString(
            'es-CL'
          )} neto** (**$${r.precioVentaConIva.toLocaleString('es-CL')} IVA inc.**)\n  _${r.explicacion}_`
      );
      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        escalamientosAbiertos: [],
        solicitudesWspAbiertas: [],
        respuestaTexto:
          `¡Buenas noticias! 🎉 Nuestra mesa técnica acaba de confirmar tu repuesto en línea:\n\n` +
          `${detalleRespuestas.join('\n\n')}\n\n` +
          `📍 ¿Prefieres **Despacho a domicilio (Santiago y todo Chile)** o **Retiro en nuestra sucursal en Enrique Olivares 224, La Florida, Santiago de Chile**? Escribe tu comuna o escribe **COMPRAR** de inmediato.`,
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
      const refs = [
        ...(sesion.escalamientosAbiertos || []).map((e) => `Ticket Experto \`${e.ticketRef}\``),
        ...(sesion.solicitudesWspAbiertas || []).map((w) => `Gestión Stock \`#${w.codigoSolicitud}\``),
      ].join(' y ');

      return {
        vehiculoDetectado: sesion.vehiculoContexto || null,
        carritoCotizado: carritoActual,
        comunaCliente: sesion.comunaCliente || null,
        modalidadEntrega: sesion.modalidadEntrega || null,
        pedidoActivo: sesion.pedidoActivo || null,
        escalamientosAbiertos: sesion.escalamientosAbiertos || [],
        solicitudesWspAbiertas: sesion.solicitudesWspAbiertas || [],
        respuestaTexto:
          `⏳ ¡Gracias por tu paciencia! Tu consulta sigue activa bajo seguimiento prioritario en FácilRepuestos (${refs}).\n\n` +
          `🛡️ **Anti-Duplicación Activo:** No generamos un ticket repetido para mantener tu prioridad. Apenas nuestro equipo confirme calce y disponibilidad para despacho o retiro en **Enrique Olivares 224, La Florida**, te aparecerá aquí mismo.`,
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
      infoEntrega.comunaDetectada?.nombre || sesion.comunaCliente || 'Región Metropolitana';
    const esRM = infoEntrega.comunaDetectada ? infoEntrega.comunaDetectada.esRM : true;
    const modalidad =
      infoEntrega.modalidadPreferida === 'retiro_bodega'
        ? 'retiro_bodega'
        : infoEntrega.modalidadPreferida === 'despacho_domicilio' || !esRM
          ? 'despacho_domicilio'
          : 'retiro_bodega';

    const totalIva = carritoActual.reduce((acc, it) => acc + Number(it.precioVentaConIva || 0), 0);
    const lineas = carritoActual.map(
      (it) =>
        `• 1x **${it.nombre}** (\`${it.skuPublicoFrp}\`) — **$${Number(it.precioVentaConIva).toLocaleString('es-CL')} IVA inc.**`
    );

    const textoLogistica = esRM
      ? `📍 Para **${nombreComuna}** gestionamos directamente tu entrega con dos opciones:\n` +
        `1️⃣ **Retiro Gratis en Tienda FácilRepuestos:** **Enrique Olivares 224, La Florida, Santiago de Chile**.\n` +
        `2️⃣ **Despacho a domicilio en todo Santiago (RM) y todo Chile.**`
      : `🚚 Para **${nombreComuna}** despachamos directamente desde FácilRepuestos a todo Chile vía **Starken, Chilexpress o Blue Express** (o puedes retirar en nuestra sucursal en **Enrique Olivares 224, La Florida, Santiago de Chile**).`;

    const respuestaTexto =
      `¡Excelente! ${textoLogistica}\n\n` +
      `🧾 **Perfecto, entonces tu pedido sería:**\n${lineas.join('\n')}\n` +
      `• **Total Repuestos:** **$${totalIva.toLocaleString('es-CL')} IVA inc.**\n\n` +
      `👉 Escribe **COMPRAR** o presiona el botón **"🛒 Confirmar Pedido (Sandbox)"** para reservar tu stock ahora mismo (sin necesidad de tarjeta de crédito real).`;

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
  const vehiculo = await resolverVehiculoOmnicanal({
    patenteInput: patenteForzada,
    textoMensaje: textoCombinado,
    vehiculoActual: sesion.vehiculoContexto || null,
  });

  // ─── PASO 2 Y 3: SOPORTE MULTI-ÍTEM (CATÁLOGO UNIFICADO + MEMORIA IA) ──────
  const subConsultas = extraerMultiplesRepuestos(textoCombinado, vehiculo);

  const [conSnap, invSnap] = await Promise.all([
    db.collection(COLECCION_CONOCIMIENTO).get(),
    db.collection(COLECCION_INVENTARIO).get(),
  ]);
  const todasReglas = conSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const itemsInventario = invSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const reglasAplicadasGlobal = [];
  const candidatosEncontradosGlobal = [];
  const subConsultasSinStock = [];

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
    const candidatosSub = itemsInventario
      .map((item) => {
        let scoreRepuesto = 0;
        let scoreVehiculo = 0;

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
          item.tipoPieza,
          item.codigo,
          item.codigoProducto,
          codigosEquivalentesStr,
          modelosDictStr,
          item.skuPublicoFrp,
          item.fabricante,
        ]
          .join(' ')
          .toUpperCase();

        for (const tok of sub.tokensRepuesto) {
          if (textoItem.includes(tok)) {
            scoreRepuesto += 4;
          }
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
            scoreVehiculo -= 6;
          }
        }

        if (vehiculo?.modelo) {
          if (
            modelosItem.some((m) => m.includes(vehiculo.modelo) || vehiculo.modelo.includes(m)) ||
            textoItem.includes(vehiculo.modelo)
          ) {
            scoreVehiculo += 5;
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
          c.scoreTotal >= 5 &&
          Number(c.item.stock || 0) > 0
      )
      .sort((a, b) => b.scoreTotal - a.scoreTotal)
      .slice(0, 2);

    if (candidatosSub.length > 0) {
      for (const { item } of candidatosSub) {
        if (candidatosEncontradosGlobal.some((x) => x.id === item.id)) continue;
        const costo = Number(item.precioCompra || 0);
        const ventaNeto = Number(item.precioVenta || Math.round(costo * 1.28));
        const margenPct =
          Number(item.margenAplicadoPct || 0) ||
          (costo > 0 ? Math.round(((ventaNeto - costo) / costo) * 100) : 28);
        const origen =
          item.nodoAilooId === 'soluparts'
            ? 'soluparts_ailoo'
            : item.nodoAilooId === 'global'
              ? 'global_ailoo'
              : item.origenCatalogo === 'mesa_whatsapp_etapa3'
                ? 'mesa_whatsapp'
                : 'portal_proveedor_local';

        candidatosEncontradosGlobal.push({
          id: item.id,
          codigoInterno: item.codigo,
          skuPublicoFrp: item.skuPublicoFrp || `FRP-LOC-${item.codigo}`,
          nombre: item.nombre,
          fabricante: item.fabricante || 'OEM',
          origen,
          nodoAilooId: item.nodoAilooId || null,
          proveedorId: item.proveedorId || null,
          proveedorNombre:
            item.proveedorNombre ||
            (item.nodoAilooId === 'soluparts'
              ? 'Soluparts (Ailoo Enterprise)'
              : item.nodoAilooId === 'global'
                ? 'Global Repuestos (Ailoo Enterprise)'
                : 'Bodega Local FácilRepuestos'),
          stock: Number(item.stock || 0),
          cantidad: 1,
          precioCostoProveedor: costo,
          margenPct,
          precioVentaNeto: ventaNeto,
          precioVentaConIva: Math.round(ventaNeto * 1.19),
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

  // Actualizar el carrito cotizado de la sesión con los ítems disponibles
  if (candidatosEncontradosGlobal.length > 0) {
    carritoActual = candidatosEncontradosGlobal.map((c) => ({ ...c, cantidad: 1 }));
  }

  const notaRespuestasPrevias =
    respuestasVivas.length > 0
      ? `🔔 **Actualización en vivo de tu consulta anterior:** Confirmamos **${respuestasVivas[0].repuesto}** (\`${respuestasVivas[0].skuPublicoFrp}\`) a **$${respuestasVivas[0].precioVentaConIva.toLocaleString('es-CL')} IVA inc.**\n\n`
      : '';

  // ─── RAMA A: COTIZACIÓN DIRECTA (100% EN STOCK O MEMORIA APRENDIDA) ───────
  if (accionTomada === 'cotizacion_directa') {
    const lineasOpciones = candidatosEncontradosGlobal.map(
      (c) =>
        `• **${c.nombre}** (\`${c.skuPublicoFrp}\`) — Marca **${c.fabricante}** · Stock: **${c.stock} un.** · **$${c.precioVentaNeto.toLocaleString(
          'es-CL'
        )} neto** (**$${c.precioVentaConIva.toLocaleString('es-CL')} IVA inc.**)`
    );

    const notaAprendida =
      reglasAplicadasGlobal.length > 0
        ? `\n\n🧠 **Nota Técnica Verificada en FácilRepuestos:** ${sanitizarMensajeHaciaClienteFinal(reglasAplicadasGlobal[0].explicacionExperta)}`
        : '';

    if (lineasOpciones.length > 0) {
      respuestaTexto =
        `${notaRespuestasPrevias}¡Perfecto! 🚗 Para tu **${etiquetaVehiculo}** tenemos disponibilidad confirmada en FácilRepuestos:\n\n` +
        `${lineasOpciones.join('\n')}${notaAprendida}\n\n` +
        `📍 Despachamos a domicilio en **Santiago y todo Chile**, o puedes retirar directamente en nuestra sucursal en **Enrique Olivares 224, La Florida, Santiago de Chile**. ¿De qué comuna nos escribes o prefieres escribir **COMPRAR** para confirmar tu pedido ahora mismo?`;
    } else if (reglasAplicadasGlobal.length > 0) {
      const r = reglasAplicadasGlobal[0];
      const conIva = Math.round((r.precioVentaFrp || 0) * 1.19);
      respuestaTexto =
        `${notaRespuestasPrevias}¡Hola! 🚗 Según nuestra base técnica verificada en FácilRepuestos para **${etiquetaVehiculo}**:\n\n` +
        `• **${r.nombreRepuesto}** (\`${r.skuPublicoFrp}\`)${
          r.precioVentaFrp > 0
            ? ` — Valor FácilRepuestos: **$${r.precioVentaFrp.toLocaleString('es-CL')} neto** (**$${conIva.toLocaleString(
                'es-CL'
              )} IVA inc.**)`
            : ''
        }.\n🧠 **Detalle técnico:** ${sanitizarMensajeHaciaClienteFinal(r.explicacionExperta)}\n\n` +
        `📍 Disponible con **Despacho a domicilio en Santiago y todo Chile** o **Retiro en Enrique Olivares 224, La Florida, Santiago de Chile**.`;
    }
  }

  // ─── RAMA B: ESCALAMIENTO EXPERTO AUTOMÁTICO CON DEDUPLICACIÓN (ETAPA 1) ──
  // REGLA ANTI-BYPASS: Hacia el proveedor nunca se envía nombre ni teléfono del cliente (solo FácilRepuestos SpA),
  // y hacia el cliente jamás se menciona el nombre o dirección del proveedor (Soluparts, Global, etc.).
  if (accionTomada === 'escalamiento_experto') {
    const mejorCandidato = candidatosEncontradosGlobal[0] || null;
    const nodoAilooId =
      mejorCandidato?.nodoAilooId ||
      (vehiculo?.marca === 'PEUGEOT' || vehiculo?.marca === 'CITROEN' || vehiculo?.marca === 'TOYOTA'
        ? 'global'
        : 'soluparts');

    // Deduplicación anti-spam (Mejora C25/C36 Luna): si ya existe un escalamiento abierto en la sesión para el mismo repuesto/vehículo, reutilizarlo
    const existente = (sesion.escalamientosAbiertos || []).find(
      (e) =>
        e.resumenRepuesto === resumenRepuesto &&
        (e.patente || '') === (vehiculo?.patente || '')
    );

    if (existente) {
      escalamientoCreado = existente;
      respuestaTexto =
        `⏳ Ya tenemos tu validación técnica en curso en nuestra **Mesa Técnica FácilRepuestos (Ticket \`${existente.ticketRef}\`)** para tu **${etiquetaVehiculo}**.\n\n` +
        `🛡️ No duplicamos el ticket para mantener prioridad alta. En cuanto confirmemos la medida/calce exacto te avisamos por aquí para coordinar despacho en Santiago y todo Chile o retiro en **Enrique Olivares 224, La Florida**.`;
    } else {
      const esNodoAiloo = Boolean(mejorCandidato ? mejorCandidato.nodoAilooId : true);
      const ticketRef = `ESC-${Math.floor(100000 + Math.random() * 900000)}`;
      const mensajeSanitizado = sanitizarTextoParaProveedor(textoCliente || transcripcionAudio);
      const audioSanitizado = sanitizarTextoParaProveedor(transcripcionAudio || '');
      const motivoSanitizado = sanitizarTextoParaProveedor(
        dudaTecnica.motivo ||
          `Confirmar compatibilidad técnica exacta de ${resumenRepuesto} para ${etiquetaVehiculo}`
      );

      const nuevoEsc = {
        ticketRef,
        sesionAgenteId: sesion.id,
        solicitante: 'FácilRepuestos SpA (Mesa Técnica)',
        canalOrigen: sesion.canal === 'web_cliente' ? 'web' : 'whatsapp',
        estado: 'pendiente',
        prioridad: 'alta',
        tipoDestino: esNodoAiloo ? 'nodo_ailoo' : 'proveedor_local',
        nodoAilooId: esNodoAiloo ? nodoAilooId : null,
        datasetDestino: esNodoAiloo ? `${nodoAilooId}_ailoo.escalamientos` : null,
        proveedorId: !esNodoAiloo ? mejorCandidato?.proveedorId || 'prov-demo-001' : null,
        proveedorNombre: esNodoAiloo
          ? nodoAilooId === 'global'
            ? 'Global Repuestos (Ailoo Enterprise)'
            : 'Soluparts (Ailoo Enterprise)'
          : mejorCandidato?.proveedorNombre || 'Proveedor Local FácilRepuestos',
        patente: vehiculo?.patente || '',
        vinVehiculo: vehiculo?.vin || '',
        marcaVehiculo: vehiculo?.marca || 'POR CONFIRMAR',
        modeloVehiculo: vehiculo?.modelo || '',
        anioVehiculo: vehiculo?.anio ? String(vehiculo.anio) : '',
        motorVehiculo: vehiculo?.motor || '',
        mensajeCliente: mensajeSanitizado,
        transcripcionAudio: audioSanitizado,
        fotoMuestraUrl: fotoUrl || '',
        motivoEscalamiento: motivoSanitizado,
        candidatoCodigo: mejorCandidato?.codigoInterno || '',
        candidatoNombre: mejorCandidato?.nombre || resumenRepuesto,
        creadoEn: now,
        actualizadoEn: now,
      };

      const escRef = await db.collection(COLECCION_ESCALAMIENTOS).add(nuevoEsc);

      if (esNodoAiloo) {
        await despacharEscalamientoANodoAiloo(
          { id: nodoAilooId, datasetId: `${nodoAilooId}_ailoo` },
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
        `🚗 Identifiqué tu **${etiquetaVehiculo}**${
          mejorCandidato
            ? ` y tenemos pre-seleccionado **${mejorCandidato.nombre}** (\`${mejorCandidato.skuPublicoFrp}\`, ref. **$${mejorCandidato.precioVentaConIva.toLocaleString(
                'es-CL'
              )} IVA inc.**)`
            : ''
        }.\n\n` +
        `🔍 Para asegurarte el calce 100% exacto antes de que pagues, acabo de derivar tu consulta a nuestra **Mesa Técnica Especialista FácilRepuestos (Ticket \`${ticketRef}\`)**. Nosotros verificamos y gestionamos la compra directamente para entregarte con **Despacho en Santiago y todo Chile** o **Retiro en nuestra sucursal en Enrique Olivares 224, La Florida, Santiago de Chile**.`;
    }
  }

  // ─── RAMA C Y D: MESA WHATSAPP VIVA (TOTAL O PARCIAL EN PEDIDOS MÚLTIPLES) ─
  // REGLA ANTI-BYPASS: No revelamos al cliente qué proveedor tiene la pieza ni su dirección;
  // FácilRepuestos consulta, compra y despacha o entrega en Enrique Olivares 224, La Florida.
  if (accionTomada === 'mesa_whatsapp_viva' || accionTomada === 'cotizacion_parcial_con_mesa_wsp') {
    const faltantes =
      accionTomada === 'cotizacion_parcial_con_mesa_wsp' && subConsultasSinStock.length > 0
        ? subConsultasSinStock
        : subConsultas;
    const resumenFaltantes = faltantes.map((f) => f.resumenRepuesto).join(' + ');

    // Deduplicación anti-spam en Mesa WhatsApp
    const wspExistente = (sesion.solicitudesWspAbiertas || []).find(
      (w) =>
        w.resumenRepuesto === resumenFaltantes &&
        (w.patente || '') === (vehiculo?.patente || '')
    );

    if (wspExistente) {
      solicitudWspCreada = wspExistente;
    } else {
      const provSnap = await db.collection(COLECCION_PROVEEDORES).get();
      const proveedores = provSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.activo !== false && p.canalWspActivo !== false && p.telefono);

      const marcaUpper = String(vehiculo?.marca || '').toUpperCase();
      const catUpper = String(categoria || '').toUpperCase();
      let seleccionados = proveedores.filter((p) => {
        const marcas = (p.marcas || p.marcasVehiculo || p.marcasEspecialidad || []).map((m) =>
          String(m).toUpperCase()
        );
        const cats = [
          p.categoria,
          ...(Array.isArray(p.categoriasEspecialidad) ? p.categoriasEspecialidad : []),
        ]
          .filter(Boolean)
          .map((c) => String(c).toUpperCase());
        const matchMarca = !marcaUpper || marcas.includes(marcaUpper);
        const matchCat = !catUpper || cats.length === 0 || cats.includes(catUpper);
        return matchMarca && matchCat;
      });
      if (seleccionados.length === 0 && marcaUpper) {
        seleccionados = proveedores.filter((p) => {
          const marcas = (p.marcas || p.marcasVehiculo || p.marcasEspecialidad || []).map((m) =>
            String(m).toUpperCase()
          );
          return marcas.includes(marcaUpper);
        });
      }
      if (seleccionados.length === 0) {
        seleccionados = proveedores.slice(0, 2);
      }

      const codigoSolicitud = `WSP-${Math.floor(1000 + Math.random() * 9000)}`;
      const repuestoTexto = `${resumenFaltantes} ${vehiculo?.marca || ''} ${vehiculo?.modelo || ''}`.trim();
      const proveedoresContactados = seleccionados.map((p) => ({
        proveedorId: p.id,
        proveedorNombre: p.nombre,
        contacto: p.contacto || 'Mesón WhatsApp',
        telefono: p.telefono,
        especialidad: p.categoria || p.especialidad || 'Multimarca',
        especialidadMarcas: p.marcas || p.marcasVehiculo || p.marcasEspecialidad || ['MULTIMARCA'],
        marcasVehiculo: p.marcas || p.marcasVehiculo || [],
        estadoContacto: 'enviado',
        modoEnvio: 'simulacion_meta_local',
        metaMessageId: `wamid.AUTO.${Date.now()}`,
        mensajeEnviado: `Hola ${p.contacto || p.nombre} 👋 Compra B2B urgente FácilRepuestos SpA (#${codigoSolicitud}): ${repuestoTexto}${
          vehiculo?.patente ? ` · Patente ${vehiculo.patente}` : ''
        }${vehiculo?.vin ? ` · VIN ${vehiculo.vin}` : ''}. ¿Disponibilidad y precio costo neto para retiro por nuestro móvil?`,
        enviadoEn: now,
        respondidoEn: null,
      }));

      const nuevaSolWsp = {
        codigoSolicitud,
        sesionAgenteId: sesion.id,
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
        notasAdicionales: `Solicitud B2B FácilRepuestos: "${sanitizarTextoParaProveedor(textoCombinado).slice(
          0,
          140
        )}"`,
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
    }

    if (accionTomada === 'cotizacion_parcial_con_mesa_wsp') {
      const lineasDisponibles = candidatosEncontradosGlobal.map(
        (c) =>
          `• ✅ **${c.nombre}** (\`${c.skuPublicoFrp}\`) — Stock: **${c.stock} un.** · **$${c.precioVentaNeto.toLocaleString(
            'es-CL'
          )} neto** (**$${c.precioVentaConIva.toLocaleString('es-CL')} IVA inc.**)`
      );
      respuestaTexto =
        `¡Perfecto! 🚗 Para tu **${etiquetaVehiculo}** revisé los ${subConsultas.length} repuestos de tu lista en FácilRepuestos:\n\n` +
        `📦 **Disponibles para entrega inmediata:**\n${lineasDisponibles.join('\n')}\n\n` +
        `📲 **En gestión directa de abastecimiento (${resumenFaltantes}):** Ya activé nuestra **Mesa de Abastecimiento FácilRepuestos (\`#${solicitudWspCreada.codigoSolicitud}\`)** con nuestras bodegas asociadas para confirmarte precio en minutos.\n\n` +
        `💡 Nosotros gestionamos y compramos todo directamente para entregarte con **Despacho en Santiago y todo Chile** o **Retiro en nuestra tienda en Enrique Olivares 224, La Florida, Santiago de Chile**. Puedes escribir **COMPRAR** para asegurar los ítems en stock o esperar la confirmación del faltante.`;
    } else {
      respuestaTexto =
        `🚗 Identifiqué tu **${etiquetaVehiculo}**. Estamos verificando disponibilidad inmediata para **${resumenFaltantes}** en nuestra red de bodegas asociadas.\n\n` +
        `📲 **¡Sin callejones sin salida! Ya activé nuestra Mesa de Abastecimiento en Vivo (\`#${solicitudWspCreada.codigoSolicitud}\`)** (${solicitudWspCreada.proveedoresContactados.length} bodega(s) especialista(s) consultada(s) en línea por FácilRepuestos) para cotizarte en minutos con **Despacho en Santiago y todo Chile** o **Retiro en nuestra sucursal en Enrique Olivares 224, La Florida, Santiago de Chile**.`;
    }
  }

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
    escalamientosAbiertos,
    solicitudesWspAbiertas,
    respuestaTexto,
    trazaCascada: {
      accionTomada,
      vehiculoDetectado: vehiculo,
      subConsultasDetectadas: subConsultas.map((s) => s.resumenRepuesto),
      reglasConocimientoAplicadas: reglasAplicadasGlobal,
      candidatosInventario: candidatosEncontradosGlobal,
      escalamientoCreado,
      solicitudWspCreada,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agente-omnicanal/sesiones
// Lista todas las sesiones de conversación del Agente Vendedor Omnicanal
// Público para permitir el Portal Web de Consultas de Clientes en Cloud Run
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sesiones', async (req, res, next) => {
  try {
    await asegurarDatosInicialesAgente();
    const snap = await db.collection(COLECCION_SESIONES_AGENTE).get();
    const sesiones = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    res.json({
      success: true,
      data: {
        sesiones,
        padronDemoPatentes: Object.values(PADRON_PATENTES_DEMO),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agente-omnicanal/sesiones
// Crea una nueva sesión de cliente (Web o WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones', async (req, res, next) => {
  try {
    const {
      canal = 'web_cliente',
      clienteNombre = 'Cliente Web FácilRepuestos',
      clienteTelefono = '+56987654321',
      patenteInicial = '',
    } = req.body;

    const vehiculoContexto = patenteInicial
      ? await resolverVehiculoOmnicanal({ patenteInput: patenteInicial })
      : null;

    const now = new Date().toISOString();
    const nuevaSesion = {
      canal,
      clienteNombre: String(clienteNombre).trim() || 'Cliente Omnicanal',
      clienteTelefono: String(clienteTelefono).trim(),
      estado: 'activa',
      vehiculoContexto,
      carritoCotizado: [],
      comunaCliente: null,
      modalidadEntrega: null,
      escalamientosAbiertos: [],
      solicitudesWspAbiertas: [],
      pedidoActivo: null,
      mensajes: [
        {
          id: `msg-${Date.now()}`,
          autor: 'agente_ia',
          texto: vehiculoContexto
            ? `¡Hola ${clienteNombre}! 👋 Ya identifiqué tu **${vehiculoContexto.marca} ${vehiculoContexto.modelo} ${vehiculoContexto.anio || ''}** (Patente \`${vehiculoContexto.patente}\`). ¿Qué repuesto(s) necesitas cotizar hoy? Puedes pedirme varios repuestos a la vez, enviarme audio o foto de la muestra.`
            : `¡Hola ${clienteNombre}! 👋 Soy el asistente virtual de **FácilRepuestos.cl**. Indícame la **patente** de tu vehículo (o marca, modelo y año) y qué repuesto(s) buscas. También puedes probar el cierre de compra en modo Sandbox sin tarjeta de crédito.`,
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
      vehiculoContexto,
      carritoCotizado: resultadoCascada.carritoCotizado ?? sesion.carritoCotizado ?? [],
      comunaCliente: resultadoCascada.comunaCliente ?? sesion.comunaCliente ?? null,
      modalidadEntrega: resultadoCascada.modalidadEntrega ?? sesion.modalidadEntrega ?? null,
      pedidoActivo: resultadoCascada.pedidoActivo ?? sesion.pedidoActivo ?? null,
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

export default router;
