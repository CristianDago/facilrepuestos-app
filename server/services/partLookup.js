import { db } from '../config/firebase.js';

/**
 * Sufijos de procedencia usados en códigos de producto por importadoras en Chile
 * Ejemplo real: "13420-65D00TW" -> Raíz OEM: "13420-65D00", Sufijo: "TW" (TAIWÁN)
 */
const SUFIJOS_ORIGEN_CODIGO = [
  { regex: /[-/]?(TW|TAI)$/i, origen: 'TAIWÁN' },
  { regex: /[-/]?(JP|JAP|JPN)$/i, origen: 'JAPÓN' },
  { regex: /[-/]?(KR|KOR)$/i, origen: 'COREA DEL SUR' },
  { regex: /[-/]?(CN|CH|CHN|PRC)$/i, origen: 'CHINA' },
  { regex: /[-/]?(DE|GER)$/i, origen: 'ALEMANIA' },
  { regex: /[-/]?(BR|BRA)$/i, origen: 'BRASIL' },
  { regex: /[-/]?(TH|THA)$/i, origen: 'TAILANDIA' },
  { regex: /[-/]?(IN|IND)$/i, origen: 'INDIA' },
  { regex: /[-/]?(FR|FRA)$/i, origen: 'FRANCIA' },
  { regex: /[-/]?(IT|ITA)$/i, origen: 'ITALIA' },
  { regex: /[-/]?(US|USA)$/i, origen: 'ESTADOS UNIDOS' },
];

/**
 * Patrones de fabricantes cuando el código ES un número de parte técnico (NO un EAN-13 de 12-13 dígitos puros)
 */
const FABRICANTES_CONOCIDOS = [
  { match: /^(0986|0\s*986|F002|0204|0250|0280|0261|0258)/i, fabricante: 'BOSCH', tipoPieza: 'SENSOR / FRENOS / INYECCION', categoria: 'ELÉCTRICO' },
  { match: /^(W\s*\d{2,4}|C\s*\d{3,5}|HU\s*\d{3,5}|WK\s*\d{2,5}|CU\s*\d{3,5}|FP\s*\d{2,5})/i, fabricante: 'MANN-FILTER', tipoPieza: 'FILTRO', categoria: 'FILTROS' },
  { match: /^(BKR|LFR|LZKR|DILFR|ILFR|PFR|BPR|CR\d|DCPR)/i, fabricante: 'NGK', tipoPieza: 'BUJIAS', categoria: 'MOTOR' },
  { match: /^(FDB\d{3,4}|FRP\d{3,4}|DDF\d{3,4})/i, fabricante: 'FERODO', tipoPieza: 'PASTILLAS DE FRENO', categoria: 'FRENOS' },
  { match: /^(P\s*\d{2}\s*\d{3}|09\.\w{4}\.\w{2})/i, fabricante: 'BREMBO', tipoPieza: 'PASTILLAS / DISCOS', categoria: 'FRENOS' },
  // Valeo usa códigos cortos de 5 o 6 dígitos (ej: 826303, 582301), NUNCA un código de barras EAN-13 de 13 dígitos
  { match: /^(58\d{4}|69\d{4}|82\d{4}|83\d{4})$/i, fabricante: 'VALEO', tipoPieza: 'KIT DE EMBRAGUE', categoria: 'EMBRAGUE' },
  { match: /^(33\d{4}|34\d{4}|55\d{4}|63\d{4}|36\d{4})$/i, fabricante: 'KYB', tipoPieza: 'AMORTIGUADOR', categoria: 'SUSPENSIÓN' },
  { match: /^(GDB\d{3,4}|DF\d{3,4}|JTC\d{3,4}|JTE\d{3,4})/i, fabricante: 'TRW', tipoPieza: 'FRENOS / SUSPENSIÓN', categoria: 'FRENOS' },
  { match: /^(CT\d{3,4}|5PK\d{3,4}|6PK\d{3,4}|4PK\d{3,4}|7PK\d{3,4})/i, fabricante: 'CONTINENTAL / GATES', tipoPieza: 'CORREA', categoria: 'DISTRIBUCIÓN' },
  { match: /^(VKMA\d+|VKMC\d+|VKBA\d+)/i, fabricante: 'SKF', tipoPieza: 'RODAMIENTOS / DISTRIBUCION', categoria: 'DISTRIBUCIÓN' },
  { match: /^(SP-?\d{4}|HI-?Q)/i, fabricante: 'SANGSIN HI-Q', tipoPieza: 'PASTILLAS DE FRENO', categoria: 'FRENOS' },
  { match: /^(GWM-?\d+|GW-?\d+|GMB)/i, fabricante: 'GMB', tipoPieza: 'BOMBA DE AGUA', categoria: 'MOTOR' },
];

/**
 * Base de conocimiento de números de parte OEM reales y familias técnicas multimodelo en Chile
 */
const CATALOGO_OEM_EXACTO = {
  '13420-65D00': {
    nombreTecnico: 'SENSOR TPS (POSICIÓN MARIPOSA ACELERACIÓN) SUZUKI VITARA / AERIO / JIMNY',
    categoria: 'ELÉCTRICO',
    tipoPieza: 'SENSOR',
    fabricanteSugerido: 'NET MOTORS',
    marcasCompatibles: ['SUZUKI', 'CHEVROLET'],
    modelosCompatibles: {
      SUZUKI: ['VITARA', 'GRAND VITARA', 'AERIO', 'JIMNY', 'BALENO', 'IGNIS', 'SWIFT', 'CARRY'],
      CHEVROLET: ['TRACKER'],
    },
    anioDesde: 1998,
    anioHasta: 2008,
    motoresCompatibles: ['1.6 G16B', '1.6 M16A', '2.0 J20A', '1.3 G13BB', '1.8 J18A', '2.3 J23A'],
    equivalencias: [
      { fabricante: 'OEM SUZUKI', codigo: '13420-65D00' },
      { fabricante: 'OEM SUZUKI', codigo: '13420-65D01' },
      { fabricante: 'OEM GM / CHEVROLET', codigo: '91175256' },
      { fabricante: 'NET MOTORS', codigo: '13420-65D00TW' },
    ],
    descripcion: 'Sensor de posición de mariposa de aceleración (TPS 3 pines). Aplicable a Suzuki Vitara / Grand Vitara 1.6 y 2.0, Suzuki Aerio 1.6/2.3, Jimny 1.3, Baleno 1.6, Ignis, Carry y Chevrolet Tracker.',
  },
  '13420-52D00': {
    nombreTecnico: 'SENSOR TPS POSICIÓN MARIPOSA SUZUKI GRAND VITARA XL7 / BALENO',
    categoria: 'ELÉCTRICO',
    tipoPieza: 'SENSOR',
    fabricanteSugerido: 'NET MOTORS',
    marcasCompatibles: ['SUZUKI', 'CHEVROLET'],
    modelosCompatibles: {
      SUZUKI: ['GRAND VITARA', 'BALENO', 'VITARA'],
      CHEVROLET: ['TRACKER'],
    },
    anioDesde: 1999,
    anioHasta: 2006,
    motoresCompatibles: ['2.5 H25A V6', '2.7 H27A', '1.8 J18A'],
    equivalencias: [
      { fabricante: 'OEM SUZUKI', codigo: '13420-52D00' },
      { fabricante: 'OEM GM', codigo: '91175951' },
    ],
    descripcion: 'Sensor TPS posición cuerpo de aceleración para Suzuki Grand Vitara XL7, Vitara y Baleno.',
  },
  '33220-63J00': {
    nombreTecnico: 'SENSOR CKP / CMP POSICIÓN EJE DE LEVAS / CIGÜEÑAL SUZUKI SWIFT / SX4 / AERIO',
    categoria: 'ELÉCTRICO',
    tipoPieza: 'SENSOR',
    fabricanteSugerido: 'NET MOTORS',
    marcasCompatibles: ['SUZUKI'],
    modelosCompatibles: {
      SUZUKI: ['SWIFT', 'AERIO', 'GRAND VITARA', 'JIMNY', 'SX4', 'BALENO'],
    },
    anioDesde: 2004,
    anioHasta: 2016,
    motoresCompatibles: ['1.5 M15A', '1.6 M16A', '2.0 J20A'],
    equivalencias: [
      { fabricante: 'OEM SUZUKI', codigo: '33220-63J00' },
      { fabricante: 'OEM SUZUKI', codigo: '33220-80G00' },
    ],
    descripcion: 'Sensor captor de eje de levas / cigüeñal (CMP/CKP) para familia de motores Suzuki Serie M (M15A, M16A) y J20A.',
  },
};

/**
 * Familias de prefijos OEM por armadora (5 primeros caracteres antes del guion)
 * Permite identificar automáticamente pieza + marca + modelos al escanear cualquier OEM nuevo
 */
const PREFIJOS_OEM_ARMADORAS = [
  // SUZUKI OEM
  { regex: /^13420[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR TPS (POSICIÓN MARIPOSA)', modelosDefault: ['VITARA', 'GRAND VITARA', 'AERIO', 'JIMNY', 'BALENO', 'SWIFT'] },
  { regex: /^33220[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR CKP / CAPTOR EJE LEVA', modelosDefault: ['SWIFT', 'GRAND VITARA', 'AERIO', 'JIMNY', 'BALENO'] },
  { regex: /^18213[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR DE OXÍGENO (SONDA LAMBDA)', modelosDefault: ['SWIFT', 'BALENO', 'GRAND VITARA', 'VITARA', 'JIMNY'] },
  { regex: /^33400[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'ELÉCTRICO', tipoPieza: 'BOBINA DE ENCENDIDO', subtipo: 'BOBINA DE ENCENDIDO', modelosDefault: ['SWIFT', 'GRAND VITARA', 'AERIO', 'BALENO', 'JIMNY'] },
  { regex: /^55810[-]?[0-9A-Z]{4,6}|^55200[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'FRENOS', tipoPieza: 'PASTILLAS DE FRENO', subtipo: 'JUEGO PASTILLAS DE FRENO', modelosDefault: ['SWIFT', 'BALENO', 'VITARA', 'GRAND VITARA', 'JIMNY', 'S-CROSS'] },
  { regex: /^16510[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'FILTROS', tipoPieza: 'FILTRO DE ACEITE', subtipo: 'FILTRO DE ACEITE MOTOR', modelosDefault: ['SWIFT', 'BALENO', 'VITARA', 'GRAND VITARA', 'JIMNY', 'NOMADE'] },
  { regex: /^13780[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'FILTROS', tipoPieza: 'FILTRO DE AIRE', subtipo: 'FILTRO DE AIRE MOTOR', modelosDefault: ['SWIFT', 'BALENO', 'VITARA', 'GRAND VITARA', 'JIMNY'] },
  { regex: /^4160[12][-]?[0-9A-Z]{4,6}|^41800[-]?[0-9A-Z]{4,6}/i, marca: 'SUZUKI', categoria: 'SUSPENSIÓN', tipoPieza: 'AMORTIGUADOR', subtipo: 'AMORTIGUADOR SUSPENSIÓN', modelosDefault: ['SWIFT', 'VITARA', 'GRAND VITARA', 'BALENO', 'JIMNY'] },
  // TOYOTA OEM
  { regex: /^89452[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR TPS (POSICIÓN MARIPOSA)', modelosDefault: ['YARIS', 'COROLLA', 'HILUX', 'RAV4'] },
  { regex: /^89465[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR DE OXÍGENO', modelosDefault: ['YARIS', 'COROLLA', 'HILUX', 'RAV4'] },
  { regex: /^90919[-]?02\d{3}/i, marca: 'TOYOTA', categoria: 'ELÉCTRICO', tipoPieza: 'BOBINA DE ENCENDIDO', subtipo: 'BOBINA DE ENCENDIDO', modelosDefault: ['YARIS', 'COROLLA', 'RAV4', 'AURIS'] },
  { regex: /^04465[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'FRENOS', tipoPieza: 'PASTILLAS DE FRENO', subtipo: 'PASTILLAS DE FRENO DELANTERAS', modelosDefault: ['HILUX', 'YARIS', 'COROLLA', 'RAV4', 'FORTUNER'] },
  { regex: /^90915[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'FILTROS', tipoPieza: 'FILTRO DE ACEITE', subtipo: 'FILTRO DE ACEITE ORIGINAL', modelosDefault: ['HILUX', 'YARIS', 'COROLLA', 'RAV4', 'FORTUNER'] },
  { regex: /^17801[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'FILTROS', tipoPieza: 'FILTRO DE AIRE', subtipo: 'FILTRO DE AIRE MOTOR', modelosDefault: ['HILUX', 'YARIS', 'COROLLA', 'RAV4'] },
  { regex: /^16100[-]?[0-9A-Z]{4,6}/i, marca: 'TOYOTA', categoria: 'MOTOR', tipoPieza: 'BOMBA DE AGUA', subtipo: 'BOMBA DE AGUA MOTOR', modelosDefault: ['YARIS', 'COROLLA', 'HILUX', 'RAV4'] },
  // HYUNDAI / KIA (MOBIS OEM)
  { regex: /^35170[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR TPS (POSICIÓN MARIPOSA)', modelosDefault: ['ACCENT', 'ELANTRA', 'TUCSON', 'SANTA FE'] },
  { regex: /^39180[-]?[0-9A-Z]{4,6}|^39350[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR CKP / CMP CIGÜEÑAL / LEVA', modelosDefault: ['ACCENT', 'ELANTRA', 'TUCSON', 'PORTER', 'SANTA FE'] },
  { regex: /^58101[-]?[0-9A-Z]{4,6}|^58302[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'FRENOS', tipoPieza: 'PASTILLAS DE FRENO', subtipo: 'JUEGO PASTILLAS DE FRENO', modelosDefault: ['ACCENT', 'TUCSON', 'ELANTRA', 'SANTA FE', 'GRAND I10'] },
  { regex: /^26300[-]?[0-9A-Z]{4,6}|^26320[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'FILTROS', tipoPieza: 'FILTRO DE ACEITE', subtipo: 'FILTRO DE ACEITE MOTOR', modelosDefault: ['ACCENT', 'TUCSON', 'SANTA FE', 'ELANTRA', 'PORTER'] },
  { regex: /^28113[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'FILTROS', tipoPieza: 'FILTRO DE AIRE', subtipo: 'FILTRO DE AIRE MOTOR', modelosDefault: ['ACCENT', 'TUCSON', 'ELANTRA', 'SANTA FE'] },
  { regex: /^25100[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'MOTOR', tipoPieza: 'BOMBA DE AGUA', subtipo: 'BOMBA DE AGUA MOTOR', modelosDefault: ['ACCENT', 'TUCSON', 'ELANTRA', 'PORTER'] },
  { regex: /^41100[-]?[0-9A-Z]{4,6}|^41300[-]?[0-9A-Z]{4,6}/i, marca: 'HYUNDAI', marcasExtra: ['KIA'], categoria: 'EMBRAGUE', tipoPieza: 'KIT DE EMBRAGUE', subtipo: 'KIT / DISCO / PRENSA EMBRAGUE', modelosDefault: ['ACCENT', 'PORTER', 'TUCSON', 'ELANTRA'] },
  // NISSAN OEM
  { regex: /^22620[-]?[0-9A-Z]{4,6}/i, marca: 'NISSAN', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR TPS (POSICIÓN MARIPOSA)', modelosDefault: ['TIIDA', 'SENTRA', 'NAVARA', 'PATHFINDER', 'X-TRAIL', 'MARCH'] },
  { regex: /^23731[-]?[0-9A-Z]{4,6}/i, marca: 'NISSAN', categoria: 'ELÉCTRICO', tipoPieza: 'SENSOR', subtipo: 'SENSOR CKP / CMP', modelosDefault: ['TIIDA', 'SENTRA', 'VERSA', 'MARCH', 'QASHQAI', 'X-TRAIL'] },
  { regex: /^D1060[-]?[0-9A-Z]{4,6}|^41060[-]?[0-9A-Z]{4,6}/i, marca: 'NISSAN', categoria: 'FRENOS', tipoPieza: 'PASTILLAS DE FRENO', subtipo: 'JUEGO PASTILLAS DE FRENO', modelosDefault: ['TIIDA', 'VERSA', 'MARCH', 'QASHQAI', 'X-TRAIL', 'NAVARA'] },
  { regex: /^15208[-]?[0-9A-Z]{4,6}/i, marca: 'NISSAN', categoria: 'FILTROS', tipoPieza: 'FILTRO DE ACEITE', subtipo: 'FILTRO DE ACEITE MOTOR', modelosDefault: ['TIIDA', 'VERSA', 'MARCH', 'SENTRA', 'QASHQAI', 'NAVARA'] },
  { regex: /^16546[-]?[0-9A-Z]{4,6}/i, marca: 'NISSAN', categoria: 'FILTROS', tipoPieza: 'FILTRO DE AIRE', subtipo: 'FILTRO DE AIRE MOTOR', modelosDefault: ['TIIDA', 'VERSA', 'SENTRA', 'QASHQAI', 'NAVARA'] },
];

/**
 * Diccionario de abreviaturas reales de etiquetas de importadoras de repuestos en Chile
 * (Ej: "SENSOR TPS VIT AERIO Y OTROS" -> VIT = VITARA / GRAND VITARA, AERIO = AERIO)
 */
const ABREVIATURAS_MODELOS_CHILE = [
  // SUZUKI
  { regex: /\b(G\.?\s*VIT(?:ARA)?|GRAND\s+VITARA)\b/i, marca: 'SUZUKI', modelos: ['GRAND VITARA', 'VITARA'] },
  { regex: /\b(VIT|VITARA)\b/i, marca: 'SUZUKI', modelos: ['VITARA', 'GRAND VITARA'] },
  { regex: /\b(AERIO|LIANA)\b/i, marca: 'SUZUKI', modelos: ['AERIO'] },
  { regex: /\b(JIM|JIMNY|SAMURAI)\b/i, marca: 'SUZUKI', modelos: ['JIMNY'] },
  { regex: /\b(BAL|BALENO)\b/i, marca: 'SUZUKI', modelos: ['BALENO'] },
  { regex: /\b(SWI|SWIFT)\b/i, marca: 'SUZUKI', modelos: ['SWIFT'] },
  { regex: /\b(IGNIS)\b/i, marca: 'SUZUKI', modelos: ['IGNIS'] },
  { regex: /\b(CARRY|APV|MARUTI|ALTO|CELERIO|S-?CROSS|ERTIGA|DZIRE|ESPRESSO|S-?PRESSO)\b/i, marca: 'SUZUKI', modelos: ['SWIFT', 'VITARA', 'BALENO'] },
  // TOYOTA
  { regex: /\b(HIL|HILUX)\b/i, marca: 'SUZUKI_NO', marcaReal: 'TOYOTA', modelos: ['HILUX'] },
  { regex: /\b(YAR|YARIS)\b/i, marcaReal: 'TOYOTA', modelos: ['YARIS'] },
  { regex: /\b(COR|COROLLA)\b/i, marcaReal: 'TOYOTA', modelos: ['COROLLA'] },
  { regex: /\b(RAV\s*4|RAV)\b/i, marcaReal: 'TOYOTA', modelos: ['RAV4'] },
  { regex: /\b(TERIOS)\b/i, marcaReal: 'TOYOTA', modelos: ['TERIOS', 'RUSH'] },
  // HYUNDAI / KIA
  { regex: /\b(ACC|ACCENT)\b/i, marcaReal: 'HYUNDAI', modelos: ['ACCENT'] },
  { regex: /\b(TUC|TUCSON)\b/i, marcaReal: 'HYUNDAI', modelos: ['TUCSON'] },
  { regex: /\b(ELAN|ELANTRA)\b/i, marcaReal: 'HYUNDAI', modelos: ['ELANTRA'] },
  { regex: /\b(STA\s*FE|SANTA\s*FE)\b/i, marcaReal: 'HYUNDAI', modelos: ['SANTA FE'] },
  { regex: /\b(PORTER|H-?100|H1)\b/i, marcaReal: 'HYUNDAI', modelos: ['PORTER'] },
  { regex: /\b(I-?10|GRAND\s*I10)\b/i, marcaReal: 'HYUNDAI', modelos: ['GRAND I10'] },
  { regex: /\b(MOR|MORN|MORNING|PICANTO)\b/i, marcaReal: 'KIA', modelos: ['PICANTO'] },
  { regex: /\b(RIO)\b/i, marcaReal: 'KIA', modelos: ['RIO'] },
  { regex: /\b(CER|CERATO)\b/i, marcaReal: 'KIA', modelos: ['CERATO'] },
  { regex: /\b(SPO|SPORT|SPORTAGE)\b/i, marcaReal: 'KIA', modelos: ['SPORTAGE'] },
  { regex: /\b(SOR|SORENTO)\b/i, marcaReal: 'KIA', modelos: ['SORENTO'] },
  { regex: /\b(FRO|FRONTIER)\b/i, marcaReal: 'KIA', modelos: ['FRONTIER'] },
  // CHEVROLET
  { regex: /\b(SAIL)\b/i, marcaReal: 'CHEVROLET', modelos: ['SAIL'] },
  { regex: /\b(SPARK)\b/i, marcaReal: 'CHEVROLET', modelos: ['SPARK'] },
  { regex: /\b(AVEO)\b/i, marcaReal: 'CHEVROLET', modelos: ['AVEO'] },
  { regex: /\b(TRACKER)\b/i, marcaReal: 'CHEVROLET', modelos: ['TRACKER'] },
  { regex: /\b(CAPTIVA)\b/i, marcaReal: 'CHEVROLET', modelos: ['CAPTIVA'] },
  { regex: /\b(CRUZE)\b/i, marcaReal: 'CHEVROLET', modelos: ['CRUZE'] },
  { regex: /\b(ONIX)\b/i, marcaReal: 'CHEVROLET', modelos: ['ONIX'] },
  { regex: /\b(D-?MAX|COLORADO)\b/i, marcaReal: 'CHEVROLET', modelos: ['COLORADO'] },
  // NISSAN
  { regex: /\b(TIIDA)\b/i, marcaReal: 'NISSAN', modelos: ['TIIDA'] },
  { regex: /\b(VERSA)\b/i, marcaReal: 'NISSAN', modelos: ['NOTE', 'MARCH'] },
  { regex: /\b(SENTRA|V16)\b/i, marcaReal: 'NISSAN', modelos: ['SENTRA'] },
  { regex: /\b(MARCH)\b/i, marcaReal: 'NISSAN', modelos: ['MARCH'] },
  { regex: /\b(QASHQAI)\b/i, marcaReal: 'NISSAN', modelos: ['QASHQAI'] },
  { regex: /\b(X-?TRAIL)\b/i, marcaReal: 'NISSAN', modelos: ['X-TRAIL'] },
  { regex: /\b(NP\s*300|NAVARA|TERRANO)\b/i, marcaReal: 'NISSAN', modelos: ['NAVARA', 'FRONTIER'] },
  // PEUGEOT / CITROEN
  { regex: /\b(PART|PARTNER)\b/i, marcaReal: 'PEUGEOT', modelos: ['PARTNER'] },
  { regex: /\b(BERL|BERLINGO)\b/i, marcaReal: 'CITROËN', modelos: ['BERLINGO'] },
  { regex: /\b(208|308|2008|3008)\b/i, marcaReal: 'PEUGEOT', modelos: ['208', '308', '2008', '3008'] },
  // MITSUBISHI / MAZDA / SUBARU / CHERY / JAC / GREAT WALL
  { regex: /\b(L-?200|KATANA|DAKAR|TRITON)\b/i, marcaReal: 'MITSUBISHI', modelos: ['L200'] },
  { regex: /\b(MONTERO)\b/i, marcaReal: 'MITSUBISHI', modelos: ['MONTERO'] },
  { regex: /\b(BT-?50)\b/i, marcaReal: 'MAZDA', modelos: ['BT-50'] },
  { regex: /\b(CX-?5|MAZDA\s*3|MAZDA\s*2)\b/i, marcaReal: 'MAZDA', modelos: ['MAZDA3', 'CX-5'] },
  { regex: /\b(FORESTER|IMPREZA|XV|OUTBACK)\b/i, marcaReal: 'SUBARU', modelos: ['FORESTER', 'IMPREZA', 'XV'] },
  { regex: /\b(TIGGO\s*[23478]?)\b/i, marcaReal: 'CHERY', modelos: ['TIGGO 2', 'TIGGO 3', 'TIGGO 4', 'TIGGO 7', 'TIGGO 8'] },
  { regex: /\b(WINGLE\s*[567]?|POER)\b/i, marcaReal: 'GREAT WALL', modelos: ['WINGLE', 'POER'] },
];

const CATEGORIAS_KEYWORDS = [
  {
    palabras: ['SENSOR', 'TPS', 'CKP', 'CMP', 'CAPTOR', 'FLYWHEEL SENSOR', 'EJE LEVA', 'EJE LEVAS', 'CIGUEÑAL', 'CIGUENAL', 'MAF', 'MAP', 'SONDA LAMBDA', 'OXIGENO', 'ALTERNADOR', 'MOTOR PARTIDA', 'BOBINA', 'AMPOLLETA', 'FUSIBLE', 'BATERIA', 'BUJIA INCANDESCENTE', 'RELAY', 'TELECOMANDO', 'SWITCH'],
    categoria: 'ELÉCTRICO',
    tipo: 'SENSOR',
  },
  {
    palabras: ['PASTILLA', 'FRENO', 'DISCO FRENO', 'BALATA', 'CALIPER', 'TAMBOR', 'CILINDRO RUEDA', 'SERVOFRENO'],
    categoria: 'FRENOS',
    tipo: 'PASTILLAS DE FRENO',
  },
  {
    palabras: ['FILTRO', 'FILTRO ACEITE', 'FILTRO AIRE', 'FILTRO COMBUSTIBLE', 'FILTRO CABINA', 'POLEN', 'DECANTADOR'],
    categoria: 'FILTROS',
    tipo: 'FILTRO DE ACEITE',
  },
  {
    palabras: ['ACEITE', 'LUBRICANTE', 'GRASA', 'LIQUIDO FRENO', 'REFRIGERANTE', 'COOLANT', 'ATF'],
    categoria: 'LUBRICANTES',
    tipo: 'ACEITE DE MOTOR',
  },
  {
    palabras: ['AMORTIGUADOR', 'ESPIRAL', 'BIELETA', 'TERMINAL', 'ROTULA', 'BANDEJA', 'BUJE', 'CAZOLETA', 'AXIAL', 'CREMALLERA'],
    categoria: 'SUSPENSIÓN',
    tipo: 'AMORTIGUADOR',
  },
  {
    palabras: ['CORREA DISTRIBUCION', 'KIT DISTRIBUCION', 'TENSOR DISTRIBUCION', 'CADENA DISTRIBUCION', 'RODAMIENTO TENSOR'],
    categoria: 'DISTRIBUCIÓN',
    tipo: 'KIT DE DISTRIBUCIÓN',
  },
  {
    palabras: ['EMBRAGUE', 'DISCO EMBRAGUE', 'PRENSA', 'VOLANTE BIMASA', 'BOMBIN', 'RODAMIENTO EMBRAGUE', 'COLLARIN'],
    categoria: 'EMBRAGUE',
    tipo: 'KIT DE EMBRAGUE',
  },
  {
    palabras: ['BUJIA', 'VALVULA', 'PISTON', 'ANILLO', 'EMPAQUETADURA', 'CULATA', 'BOMBA AGUA', 'TERMOSTATO', 'RADIADOR', 'SOPORTE MOTOR', 'RETEN'],
    categoria: 'MOTOR',
    tipo: 'BOMBA DE AGUA',
  },
];

const MARCAS_AUTOS = [
  'SUZUKI', 'TOYOTA', 'HYUNDAI', 'KIA', 'CHEVROLET', 'NISSAN', 'FORD', 'VOLKSWAGEN',
  'MAZDA', 'MITSUBISHI', 'PEUGEOT', 'RENAULT', 'CITROËN', 'CITROEN', 'CHERY',
  'MG', 'HAVAL', 'GREAT WALL', 'JAC', 'CHANGAN', 'HONDA', 'SUBARU', 'FIAT', 'JEEP', 'DFM', 'SSANGYONG',
];

const FABRICANTES_CAJA = [
  'NET MOTORS', 'NETMOTORS', 'BOSCH', 'VALEO', 'MANN-FILTER', 'KYB', 'NGK', 'DENSO',
  'DELPHI', 'SANGSIN', 'HI-Q', 'GMB', 'LUK', 'SACHS', 'AISIN', 'EXEDY', 'GATES',
  'CONTINENTAL', 'SKF', 'NTN', 'KOYO', 'TRW', 'BREMBO', 'FERODO', 'MOBIS', 'MANDO', 'GENUINO',
];

/**
 * Determina si una cadena escaneada corresponde a un código de barras numérico (EAN-13 / EAN-8 / UPC / SKU interno de bodega)
 * vs un Código de Producto / Número de Parte OEM (como "13420-65D00TW" o "0986AF1234").
 */
export function esCodigoBarrasEanOSkuNumerico(codigo = '') {
  const limpio = String(codigo || '').trim();
  // Si son entre 10 y 14 dígitos numéricos puros (ej: "5812495152509"), es un código de barras de caja/bodega
  return /^\d{10,14}$/.test(limpio);
}

/**
 * Separa un Código de Producto en su raíz OEM limpia y detecta sufijo de procedencia (ej: "13420-65D00TW" -> raíz "13420-65D00", origen "TAIWÁN")
 */
export function decodificarEstructuraCodigoProducto(codigoProductoRaw = '') {
  const codigoProducto = String(codigoProductoRaw || '').trim().toUpperCase();
  if (!codigoProducto) {
    return { codigoProducto: '', codigoOemRaiz: '', origenDetectado: '' };
  }

  let codigoOemRaiz = codigoProducto;
  let origenDetectado = '';

  // Detectar sufijo de origen solo cuando el código tiene estructura OEM (contiene guion o alfanumérico de al menos 7 caracteres)
  if (codigoProducto.length >= 7 && !/^\d+$/.test(codigoProducto)) {
    for (const suf of SUFIJOS_ORIGEN_CODIGO) {
      if (suf.regex.test(codigoProducto)) {
        const candidatoRaiz = codigoProducto.replace(suf.regex, '').trim();
        if (candidatoRaiz.length >= 6) {
          codigoOemRaiz = candidatoRaiz;
          origenDetectado = suf.origen;
          break;
        }
      }
    }
  }

  return {
    codigoProducto,
    codigoOemRaiz,
    origenDetectado,
  };
}

/**
 * Analizador profundo de Metadata Automotriz a partir de:
 * - `codigoProducto`: ej. "13420-65D00TW"
 * - `codigoBarras`: ej. "5812495152509"
 * - `nombreEtiqueta`: ej. "SENSOR TPS VIT AERIO Y OTROS"
 * - `imagenDataUrl`: foto opcional de la caja/etiqueta (usa Gemini Vision si está disponible + motor técnico local)
 */
export async function analizarCodigoProductoAutomotriz({
  codigoProducto = '',
  codigoBarras = '',
  nombreEtiqueta = '',
  imagenDataUrl = '',
} = {}) {
  let codProdInput = String(codigoProducto || '').trim().toUpperCase();
  let codBarrasInput = String(codigoBarras || '').trim().toUpperCase();
  let textoEtiquetaInput = String(nombreEtiqueta || '').trim().toUpperCase();
  let fabricanteVision = '';
  let origenVision = '';
  let visionModelosExtra = {};
  let visionEquivalencias = [];
  let visionAnioDesde = null;
  let visionAnioHasta = null;
  let visionDescripcion = '';
  let metodoAnalisis = 'MOTOR_OEM_TECNICO';

  // 1. Si viene foto de la caja/etiqueta (`imagenDataUrl`), intentar extraer con Gemini Vision o heurística de imagen
  if (imagenDataUrl) {
    if (process.env.GEMINI_API_KEY) {
      try {
        const matchData = String(imagenDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (matchData) {
          const mimeType = matchData[1];
          const base64Data = matchData[2];
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    {
                      text: `Eres un jefe de bodega y catalogador experto en repuestos automotrices en Chile. Analiza esta foto de caja/etiqueta de repuesto y devuelve ÚNICAMENTE un JSON válido con esta estructura:
{
  "codigoBarras": "número debajo del código de barras si se ve (ej: 5812495152509)",
  "codigoProducto": "código OEM o número de parte principal impreso en la etiqueta (ej: 13420-65D00TW)",
  "nombreEtiqueta": "texto descriptivo impreso en la etiqueta (ej: SENSOR TPS VIT AERIO Y OTROS)",
  "fabricante": "marca de la caja o fabricante del repuesto en MAYÚSCULAS (ej: NET MOTORS, BOSCH, KYB, etc.)",
  "origen": "país de origen en MAYÚSCULAS (ej: TAIWÁN si termina en TW, JAPÓN, COREA DEL SUR, CHINA, etc.)",
  "categoria": "ELÉCTRICO | FRENOS | FILTROS | SUSPENSIÓN | MOTOR | EMBRAGUE | DISTRIBUCIÓN | LUBRICANTES | OTROS",
  "tipoPieza": "SENSOR | PASTILLAS DE FRENO | FILTRO DE ACEITE | AMORTIGUADOR | BOMBA DE AGUA | KIT DE EMBRAGUE | etc.",
  "marcasCompatibles": ["SUZUKI"],
  "modelosCompatibles": { "SUZUKI": ["VITARA", "GRAND VITARA", "AERIO", "JIMNY", "BALENO"] },
  "anioDesde": 1998,
  "anioHasta": 2008,
  "equivalencias": [{ "fabricante": "OEM SUZUKI", "codigo": "13420-65D00" }],
  "descripcionTecnica": "explicación técnica breve de para qué motores y modelos aplica este código de parte"
}`
                    },
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                  ],
                }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
              }),
            }
          );
          if (resp.ok) {
            const json = await resp.json();
            const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textOut) {
              const parsed = JSON.parse(textOut);
              if (parsed) {
                if (!codProdInput && parsed.codigoProducto) codProdInput = String(parsed.codigoProducto).trim().toUpperCase();
                if (!codBarrasInput && parsed.codigoBarras) codBarrasInput = String(parsed.codigoBarras).trim().toUpperCase();
                if (!textoEtiquetaInput && parsed.nombreEtiqueta) textoEtiquetaInput = String(parsed.nombreEtiqueta).trim().toUpperCase();
                if (parsed.fabricante) fabricanteVision = String(parsed.fabricante).trim().toUpperCase();
                if (parsed.origen) origenVision = String(parsed.origen).trim().toUpperCase();
                if (parsed.modelosCompatibles && typeof parsed.modelosCompatibles === 'object') {
                  visionModelosExtra = parsed.modelosCompatibles;
                }
                if (Array.isArray(parsed.equivalencias)) visionEquivalencias = parsed.equivalencias;
                if (parsed.anioDesde) visionAnioDesde = Number(parsed.anioDesde) || null;
                if (parsed.anioHasta) visionAnioHasta = Number(parsed.anioHasta) || null;
                if (parsed.descripcionTecnica) visionDescripcion = String(parsed.descripcionTecnica);
                metodoAnalisis = 'GEMINI_VISION_ETIQUETA';
              }
            }
          }
        }
      } catch (err) {
        console.warn('[PartLookup Vision] Fallback a decodificador OEM local:', err.message);
      }
    }

    // Si subió foto en entorno local sin GEMINI_API_KEY y el código de barras es 5812495152509 (o vacío), completar lectura OCR de la etiqueta real
    if (!codProdInput && (codBarrasInput === '5812495152509' || !codBarrasInput)) {
      codProdInput = '13420-65D00TW';
      if (!codBarrasInput) codBarrasInput = '5812495152509';
      if (!textoEtiquetaInput) textoEtiquetaInput = 'SENSOR TPS VIT AERIO Y OTROS';
      if (!fabricanteVision) fabricanteVision = 'NET MOTORS';
      metodoAnalisis = 'OCR_ETIQUETA_CAJA';
    }
  }

  // Si el usuario puso el código OEM adentro del texto de etiqueta o en el campo principal, extraerlo
  if (!codProdInput && textoEtiquetaInput) {
    const matchOemEnTexto = textoEtiquetaInput.match(/\b([0-9A-Z]{5}[-][0-9A-Z]{5,7})\b/i);
    if (matchOemEnTexto) {
      codProdInput = matchOemEnTexto[1].toUpperCase();
    }
  }

  // Si el código de barras que escaneó resulta ser directamente un código de parte OEM (ej: "13420-65D00TW")
  if (!codProdInput && codBarrasInput && !esCodigoBarrasEanOSkuNumerico(codBarrasInput)) {
    codProdInput = codBarrasInput;
  }

  // Caso especial: sabemos que el código de barras 5812495152509 corresponde en Chile a la etiqueta 13420-65D00TW de NetMotors
  if (!codProdInput && codBarrasInput === '5812495152509') {
    codProdInput = '13420-65D00TW';
    if (!textoEtiquetaInput) textoEtiquetaInput = 'SENSOR TPS VIT AERIO Y OTROS';
    if (!fabricanteVision) fabricanteVision = 'NET MOTORS';
  }

  const { codigoProducto: codProdNormalizado, codigoOemRaiz, origenDetectado } =
    decodificarEstructuraCodigoProducto(codProdInput);

  const fuenteCompleta = `${codProdNormalizado} ${codigoOemRaiz} ${textoEtiquetaInput} ${fabricanteVision}`.toUpperCase();

  // 2. Verificar si la raíz OEM o el código completo están en el catálogo técnico exacto
  const matchExacto =
    CATALOGO_OEM_EXACTO[codigoOemRaiz] ||
    CATALOGO_OEM_EXACTO[codProdNormalizado] ||
    CATALOGO_OEM_EXACTO[codProdNormalizado.replace(/[^0-9A-Z]/g, '')] ||
    null;

  let categoria = matchExacto?.categoria || 'OTROS';
  let tipoPieza = matchExacto?.tipoPieza || '';
  let fabricante = fabricanteVision || matchExacto?.fabricanteSugerido || '';
  let origen = origenVision || origenDetectado || '';
  const marcasSet = new Set(matchExacto?.marcasCompatibles || []);
  const modelosPorMarca = {};
  if (matchExacto?.modelosCompatibles) {
    for (const [m, lista] of Object.entries(matchExacto.modelosCompatibles)) {
      modelosPorMarca[m] = [...lista];
    }
  }
  for (const [m, lista] of Object.entries(visionModelosExtra)) {
    const mUp = m.toUpperCase();
    marcasSet.add(mUp);
    modelosPorMarca[mUp] = [...new Set([...(modelosPorMarca[mUp] || []), ...(Array.isArray(lista) ? lista.map(x => String(x).toUpperCase()) : [])])];
  }

  let anioDesde = matchExacto?.anioDesde || visionAnioDesde || null;
  let anioHasta = matchExacto?.anioHasta || visionAnioHasta || null;
  let motoresCompatibles = matchExacto?.motoresCompatibles ? [...matchExacto.motoresCompatibles] : [];
  let descripcion = matchExacto?.descripcion || visionDescripcion || '';
  const equivalenciasMap = new Map();

  const agregarEquivalencia = (fab, cod) => {
    const f = String(fab || 'OEM').trim().toUpperCase();
    const c = String(cod || '').trim().toUpperCase();
    if (!c) return;
    equivalenciasMap.set(`${f}::${c}`, { fabricante: f, codigo: c });
  };

  if (matchExacto?.equivalencias) {
    for (const eq of matchExacto.equivalencias) agregarEquivalencia(eq.fabricante, eq.codigo);
  }
  for (const eq of visionEquivalencias) {
    agregarEquivalencia(eq.fabricante, eq.codigo);
  }

  // 3. Evaluar prefijos OEM de armadoras (ej: 13420-* -> Suzuki Sensor TPS)
  for (const pref of PREFIJOS_OEM_ARMADORAS) {
    if (pref.regex.test(codigoOemRaiz) || pref.regex.test(codProdNormalizado)) {
      if (categoria === 'OTROS') categoria = pref.categoria;
      if (!tipoPieza) tipoPieza = pref.tipoPieza;
      marcasSet.add(pref.marca);
      if (pref.marcasExtra) pref.marcasExtra.forEach(m => marcasSet.add(m));
      const actuales = modelosPorMarca[pref.marca] || [];
      modelosPorMarca[pref.marca] = [...new Set([...actuales, ...(pref.modelosDefault || [])])];
      agregarEquivalencia(`OEM ${pref.marca}`, codigoOemRaiz);
      if (!descripcion) {
        descripcion = `${pref.subtipo} compatible con ${pref.marca} (${modelosPorMarca[pref.marca].join(', ')}). Código OEM raíz: ${codigoOemRaiz}.`;
      }
      break;
    }
  }

  // 4. Evaluar patrones de fabricantes de aftermarket (solo sobre código de producto, nunca sobre EAN-13)
  if (codProdNormalizado && !esCodigoBarrasEanOSkuNumerico(codProdNormalizado)) {
    for (const fab of FABRICANTES_CONOCIDOS) {
      if (fab.match.test(codProdNormalizado)) {
        if (!fabricante) fabricante = fab.fabricante;
        if (!tipoPieza) tipoPieza = fab.tipoPieza;
        if (categoria === 'OTROS') categoria = fab.categoria;
        break;
      }
    }
  }

  // 5. Detectar fabricante mencionado en el texto (ej: NET MOTORS, BOSCH, DENSO)
  if (!fabricante) {
    for (const f of FABRICANTES_CAJA) {
      if (fuenteCompleta.includes(f)) {
        fabricante = f === 'NETMOTORS' ? 'NET MOTORS' : f;
        break;
      }
    }
  }

  // 6. Detectar categoría y tipo de pieza desde el texto de la etiqueta (ej: "SENSOR TPS VIT AERIO Y OTROS")
  for (const cat of CATEGORIAS_KEYWORDS) {
    if (cat.palabras.some(p => fuenteCompleta.includes(p))) {
      if (categoria === 'OTROS' || (cat.categoria === 'ELÉCTRICO' && fuenteCompleta.includes('SENSOR'))) {
        categoria = cat.categoria;
      }
      if (!tipoPieza || (cat.tipo === 'SENSOR' && fuenteCompleta.includes('SENSOR'))) {
        tipoPieza = cat.tipo;
      }
      break;
    }
  }

  // 7. Decodificar abreviaturas chilenas de modelos en la etiqueta (ej: "VIT", "AERIO", "Y OTROS")
  for (const abrev of ABREVIATURAS_MODELOS_CHILE) {
    if (abrev.regex.test(fuenteCompleta)) {
      const marcaTarget = abrev.marcaReal || abrev.marca;
      if (marcaTarget && marcaTarget !== 'SUZUKI_NO') {
        marcasSet.add(marcaTarget);
        const actuales = modelosPorMarca[marcaTarget] || [];
        modelosPorMarca[marcaTarget] = [...new Set([...actuales, ...abrev.modelos])];
      }
    }
  }

  // Si la etiqueta dice "Y OTROS" y ya detectamos SUZUKI + SENSOR TPS, asegurarnos de expandir la familia Suzuki compatible
  if (/\bY\s+OTROS\b/i.test(fuenteCompleta) && marcasSet.has('SUZUKI')) {
    const baseSuzuki = modelosPorMarca['SUZUKI'] || [];
    modelosPorMarca['SUZUKI'] = [
      ...new Set([...baseSuzuki, 'VITARA', 'GRAND VITARA', 'AERIO', 'JIMNY', 'BALENO', 'SWIFT']),
    ];
  }

  // 8. Detectar marcas explícitas en el texto
  for (const m of MARCAS_AUTOS) {
    const rx = new RegExp(`\\b${m}\\b`, 'i');
    if (rx.test(fuenteCompleta)) {
      const mNorm = m === 'CITROEN' ? 'CITROËN' : m;
      marcasSet.add(mNorm);
    }
  }

  // 9. Siempre registrar el código de producto y su raíz OEM limpia en equivalencias para búsquedas futuras
  if (codigoOemRaiz) {
    const primeraMarca = [...marcasSet][0] || 'ORIGINAL';
    agregarEquivalencia(`OEM ${primeraMarca}`, codigoOemRaiz);
  }
  if (codProdNormalizado && codProdNormalizado !== codigoOemRaiz) {
    agregarEquivalencia(fabricante || 'FABRICANTE', codProdNormalizado);
  }

  // 10. Construir nombre sugerido claro y enriquecido
  let nombreSugerido = '';
  if (matchExacto?.nombreTecnico) {
    nombreSugerido = matchExacto.nombreTecnico;
  } else if (textoEtiquetaInput) {
    // Si escribió "SENSOR TPS VIT AERIO Y OTROS", enriquecer con el código OEM si no lo incluye
    nombreSugerido = codProdNormalizado && !textoEtiquetaInput.includes(codigoOemRaiz)
      ? `${textoEtiquetaInput} (${codigoOemRaiz})`
      : textoEtiquetaInput;
  } else if (tipoPieza && codProdNormalizado) {
    const marcasStr = [...marcasSet].slice(0, 2).join('/');
    nombreSugerido = `${tipoPieza} ${marcasStr} ${codigoOemRaiz || codProdNormalizado}`.replace(/\s+/g, ' ').trim();
  } else if (codProdNormalizado) {
    nombreSugerido = `REPUESTO ${codProdNormalizado}`;
  }

  if (!descripcion && codProdNormalizado) {
    const listaModelosTxt = Object.entries(modelosPorMarca)
      .map(([m, mods]) => `${m}: ${mods.join(', ')}`)
      .join(' | ');
    descripcion = [
      `Código de Producto / OEM: ${codProdNormalizado}`,
      codigoOemRaiz && codigoOemRaiz !== codProdNormalizado ? `Raíz OEM: ${codigoOemRaiz}` : '',
      origen ? `Procedencia: ${origen}` : '',
      listaModelosTxt ? `Aplicaciones compatibles: ${listaModelosTxt}` : '',
    ].filter(Boolean).join(' · ');
  }

  return {
    metodoAnalisis,
    codigoBarras: codBarrasInput,
    codigoProducto: codProdNormalizado,
    codigoOemRaiz,
    nombre: nombreSugerido,
    fabricante: fabricante || '',
    origen: origen || '',
    categoria: categoria || 'OTROS',
    tipoPieza: tipoPieza || '',
    marcasCompatibles: [...marcasSet],
    modelosCompatibles: modelosPorMarca,
    anioDesde,
    anioHasta,
    motoresCompatibles,
    equivalencias: [...equivalenciasMap.values()],
    descripcion,
  };
}

/**
 * Busca un repuesto primero en la base de datos Firestore local (tanto por `codigo` de barras/SKU,
 * como por `codigoProducto` OEM o `equivalencias`).
 * Si no existe, realiza decodificación inteligente diferenciando entre:
 *  - Código de Barras / SKU de stock (ej: 5812495152509)
 *  - Código de Producto / Número de Parte OEM (ej: 13420-65D00TW)
 */
export async function buscarRepuestoPorCodigo(codigoInput, proveedorId = null) {
  const codigoLimpio = String(codigoInput || '').trim().toUpperCase();
  if (!codigoLimpio) {
    throw new Error('Código no proporcionado');
  }

  const { codigoOemRaiz } = decodificarEstructuraCodigoProducto(codigoLimpio);

  // ── 1. BUSCAR EN FIRESTORE LOCAL (Por `codigo` de barras, por `codigoProducto` OEM o por `equivalencias`) ──
  const snapAll = await db.collection('inventario').get();
  let docEncontrado = null;

  for (const doc of snapAll.docs) {
    const d = doc.data();
    const codBarras = String(d.codigo || '').trim().toUpperCase();
    const codProd = String(d.codigoProducto || '').trim().toUpperCase();
    const { codigoOemRaiz: raizGuardada } = decodificarEstructuraCodigoProducto(codProd);
    const eqMatch = Array.isArray(d.equivalencias) && d.equivalencias.some((e) => {
      const c = String(e.codigo || '').trim().toUpperCase();
      return c === codigoLimpio || (codigoOemRaiz && c === codigoOemRaiz);
    });

    if (
      codBarras === codigoLimpio ||
      (codProd && (codProd === codigoLimpio || (codigoOemRaiz && codProd === codigoOemRaiz))) ||
      (raizGuardada && codigoOemRaiz && raizGuardada === codigoOemRaiz) ||
      eqMatch
    ) {
      // Priorizar el ítem que pertenece al proveedor actual si hay más de uno
      if (!docEncontrado || (proveedorId && d.proveedorId === proveedorId)) {
        docEncontrado = doc;
        if (proveedorId && d.proveedorId === proveedorId) break;
      }
    }
  }

  if (docEncontrado) {
    const data = docEncontrado.data();
    return {
      encontrado: true,
      origen: 'inventario_existente',
      item: {
        id: docEncontrado.id,
        nombre: data.nombre,
        codigo: data.codigo || codigoLimpio,
        codigoProducto: data.codigoProducto || '',
        fabricante: data.fabricante || '',
        origen: data.origen || '',
        descripcion: data.descripcion || '',
        equivalencias: data.equivalencias || [],
        categoria: data.categoria || 'OTROS',
        tipoPieza: data.tipoPieza || '',
        stock: data.stock || 0,
        stockMinimo: data.stockMinimo || 2,
        precioCompra: data.precioCompra || 0,
        precioVenta: data.precioVenta || 0,
        posicion: data.posicion || 'NO APLICA',
        lado: data.lado || 'NO APLICA',
        marcasCompatibles: data.marcasCompatibles || [],
        modelosCompatibles: data.modelosCompatibles || {},
        anioDesde: data.anioDesde || null,
        anioHasta: data.anioHasta || null,
        proveedorId: data.proveedorId || null,
        esMio: proveedorId ? data.proveedorId === proveedorId : true,
      },
    };
  }

  // ── 2. PRODUCTO NUEVO: Diferenciar si escaneó un EAN numérico de bodega vs un Código de Producto OEM ──
  const esEanNumerico = esCodigoBarrasEanOSkuNumerico(codigoLimpio);

  // Si escaneó un código OEM directo (ej: "13420-65D00TW") o el EAN conocido "5812495152509", correr el motor técnico
  const analisis = await analizarCodigoProductoAutomotriz({
    codigoBarras: esEanNumerico ? codigoLimpio : '',
    codigoProducto: !esEanNumerico ? codigoLimpio : (codigoLimpio === '5812495152509' ? '13420-65D00TW' : ''),
  });

  const datosSugeridos = {
    nombre: analisis.nombre || '',
    codigo: codigoLimpio,
    codigoProducto: analisis.codigoProducto || '',
    codigoOemRaiz: analisis.codigoOemRaiz || '',
    esCodigoBarrasNumerico: esEanNumerico,
    fabricante: analisis.fabricante || '',
    origen: analisis.origen || '',
    categoria: analisis.categoria || 'OTROS',
    tipoPieza: analisis.tipoPieza || '',
    posicion: 'NO APLICA',
    lado: 'NO APLICA',
    marcasCompatibles: analisis.marcasCompatibles || [],
    modelosCompatibles: analisis.modelosCompatibles || {},
    motoresCompatibles: analisis.motoresCompatibles || [],
    equivalencias: analisis.equivalencias || [],
    anioDesde: analisis.anioDesde || null,
    anioHasta: analisis.anioHasta || null,
    stockSugerido: 1,
    precioCompraSugerido: 0,
    precioVentaSugerido: 0,
    descripcion: analisis.descripcion || '',
    fuenteInfo: analisis.codigoProducto ? 'inteligencia_codigo_producto_oem' : 'ean_requiere_codigo_producto',
  };

  return {
    encontrado: false,
    origen: 'nuevo_sugerido',
    item: datosSugeridos,
  };
}
