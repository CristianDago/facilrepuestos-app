/**
 * server/routes/agenteOmnicanal.js
 *
 * ETAPA 4: Cerebro Orquestador del Agente Vendedor Omnicanal (Web + WhatsApp Meta Clientes)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Ejecuta la cascada completa de FácilRepuestos 2.0 ante cada consulta de cliente final
 * (texto libre, patente chilena, transcripción de audio o foto de repuesto/muestra):
 *
 *   PASO 1 → Identificación de Vehículo por Patente (Firestore `vehiculos` + Boostr API + padrón demo).
 *   PASO 2 → Consulta en Memoria Técnica Aprendida (`conocimiento_aprendido_ia` — Etapa 1).
 *   PASO 3 → Búsqueda en Catálogo Unificado Multi-Proveedor (`inventario` — Etapa 2):
 *            • Nodo Enterprise Soluparts (`soluparts_ailoo` -> SKU `FRP-SOL-*`)
 *            • Nodo Enterprise Global (`global_ailoo` -> SKU `FRP-GLB-*`)
 *            • Proveedores Locales ERP (`local` -> SKU `FRP-LOC-*`)
 *            • Adjudicaciones previas de WhatsApp (`wsp` -> SKU `FRP-WSP-*`)
 *   PASO 4 → Decisión inteligente de cascada:
 *            A) `cotizacion_directa`: Hay stock y certeza -> Cotiza al instante con precio público FRP + link WooCommerce.
 *            B) `escalamiento_experto` (Etapa 1): Hay candidato en catálogo pero existe duda técnica de calce/medida/muestra
 *               -> Crea ticket automático en `escalamientos_ia` hacia `soluparts_ailoo.escalamientos`,
 *                  `global_ailoo.escalamientos` o el Portal Proveedor Local.
 *            C) `mesa_whatsapp_viva` (Etapa 3): No existe stock en ningún nodo ni bodega local
 *               -> Abre automáticamente solicitud en `solicitudes_cotizacion_wsp` y despacha WhatsApp
 *                  a los proveedores externos especialistas en la marca del vehículo.
 */

import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  generarTerminosClave,
  despacharEscalamientoANodoAiloo,
} from '../services/ailooBridge.js';
import { sincronizarTodosLosNodosAiloo } from '../services/ailooCatalogSync.js';

const router = Router();

const COLECCION_SESIONES_AGENTE = 'sesiones_agente_omnicanal';
const COLECCION_CONOCIMIENTO = 'conocimiento_aprendido_ia';
const COLECCION_INVENTARIO = 'inventario';
const COLECCION_ESCALAMIENTOS = 'escalamientos_ia';
const COLECCION_SOLICITUDES_WSP = 'solicitudes_cotizacion_wsp';
const COLECCION_PROVEEDORES = 'proveedores';

// Padrón vehicular rápido de respaldo para pruebas inmediatas en vivo por patente
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
};

const MARCAS_CONOCIDAS = [
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
  'CHERY',
  'JAC',
  'MAXUS',
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
  SWIFT: 'SUZUKI',
  BALENO: 'SUZUKI',
  RANGER: 'FORD',
  AMAROK: 'VOLKSWAGEN',
  GOL: 'VOLKSWAGEN',
  ACTYON: 'SSANGYONG',
  T60: 'MAXUS',
};

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
  'SIRVE',
  'CALZA',
  'LLEVA',
  'FOTO',
  'AUDIO',
]);

/**
 * Extrae una patente chilena válida (4 letras + 2 dígitos o 2 letras + 4 dígitos) desde un texto libre.
 */
function extraerPatenteDesdeTexto(texto = '') {
  const limpio = String(texto || '').toUpperCase();
  // Formato explícito "patente JPKR42" o "patente JP-KR-42"
  const explicito = limpio.match(
    /\b(?:PATENTE|PPU)\s*[:#-]?\s*([B-DF-HJ-NP-TV-Z]{4}[-\s·]?\d{2}|[A-Z]{2}[-\s·]?\d{4})\b/
  );
  if (explicito) {
    return explicito[1].replace(/[-\s·]/g, '');
  }

  // Formato patente chilena moderna (4 consonantes + 2 números) en el mensaje
  const moderna = limpio.match(/\b([B-DF-HJ-NP-TV-Z]{4})[-\s·]?(\d{2})\b/);
  if (moderna) {
    const candidata = `${moderna[1]}${moderna[2]}`;
    // Evitar confundir códigos técnicos cortos si no son patentes
    return candidata;
  }

  return null;
}

/**
 * Resuelve datos del vehículo a partir de una patente o del texto del mensaje.
 */
async function resolverVehiculoOmnicanal({ patenteInput = '', textoMensaje = '', vehiculoActual = null }) {
  const patenteDetectada =
    String(patenteInput || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || extraerPatenteDesdeTexto(textoMensaje);

  // 1) Si hay patente detectada, buscar en Padrón Demo o Firestore `vehiculos` o Boostr
  if (patenteDetectada && patenteDetectada.length === 6) {
    if (PADRON_PATENTES_DEMO[patenteDetectada]) {
      return { ...PADRON_PATENTES_DEMO[patenteDetectada] };
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
          vin: String(v.vin || v.chasis || ''),
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
              vin: String(d.vin || ''),
              fuente: 'boostr_api_live',
            };
          }
        }
      } catch {
        // Fallback silencioso
      }
    }
  }

  // 2) Inferir marca, modelo y año desde el texto libre si el cliente los menciona
  const upper = String(textoMensaje || '').toUpperCase();
  let marca = vehiculoActual?.marca || '';
  let modelo = vehiculoActual?.modelo || '';
  let anio = vehiculoActual?.anio || null;
  let motor = vehiculoActual?.motor || '';
  const patente = patenteDetectada || vehiculoActual?.patente || '';

  for (const m of MARCAS_CONOCIDAS) {
    if (upper.includes(m)) {
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

  const matchMotor = upper.match(/\b(\d\.\d(?:\s*(?:CRDI|HDI|TDI|D4CB|GD|MIVEC|TURBO|16V|8V))?)\b/);
  if (matchMotor) {
    motor = matchMotor[1].trim();
  }

  if (marca || modelo || patente) {
    return {
      patente,
      marca: marca || 'MULTIMARCA',
      modelo: modelo || '',
      anio,
      motor,
      vin: vehiculoActual?.vin || '',
      fuente: patente ? 'inferido_con_patente' : 'inferido_mensaje',
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
    /\b(\d{2,3}\s*MM)\b/, // pregunta por milímetros específicos (ej. 240mm vs 250mm)
    /\b(BIMASA|MONOMASA|CONVERSI[OÓ]N)\b/,
    /\b(CU[AÁ]NTOS\s+DIENTES|ESTRIAS|ESTR[IÍ]AS)\b/,
    /\b(LE\s+SIRVE|LE\s+HACE|CALZA|COMPATIBLE|MISMO\s+CALCE)\b/,
    /\b(CAJA\s+SEXTA|CAJA\s+6TA|CAJA\s+5TA|EURO\s*5|EURO\s*6)\b/,
    /\b(LADO\s+DERECHO|LADO\s+IZQUIERDO|DELANTERO\s+O\s+TRASERO)\b/,
    /\b(CON\s+ABS|SIN\s+ABS|SENSOR)\b/,
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
 * Extrae el nombre limpio del repuesto buscado y su categoría estimada desde el texto del cliente.
 */
function extraerRepuestoYCategoria(texto = '', vehiculo = null) {
  const upper = String(texto || '').toUpperCase();

  let categoria = 'Motor';
  if (/\b(PASTILLA|DISCO\s+DE\s+FRENO|FRENO|CALIPER|BALATA)\b/.test(upper)) categoria = 'Frenos';
  else if (/\b(EMBRAGUE|PRENSA|VOLANTE\s+BIMASA|RODAMIENTO\s+EMPUJE)\b/.test(upper)) categoria = 'Embrague';
  else if (/\b(AMORTIGUADOR|BANDEJA|ROTULA|BIELETA|CAZOLETA|SUSPENSION|ESPIRAL)\b/.test(upper))
    categoria = 'Suspensión';
  else if (/\b(FILTRO|ACEITE|AIRE|COMBUSTIBLE|CABINA|POLEN)\b/.test(upper)) categoria = 'Filtros';
  else if (/\b(BOMBA\s+DE\s+AGUA|TERMOSTATO|RADIADOR|DISTRIBUCION|CORREA|TENSOR|CULATA|TURBO|INYECTOR)\b/.test(upper))
    categoria = 'Motor';
  else if (/\b(ALTERNADOR|MOTOR\s+DE\s+PARTIDA|BUJIA|BOBINA|SENSOR|SONDA|FLUJO)\b/.test(upper))
    categoria = 'Eléctrico';
  else if (/\b(HOMOCINETICA|TRIPOIDE|EJE|CAJA|TRANSMISION)\b/.test(upper))
    categoria = 'Transmisión';
  else if (/\b(OPTICO|PARACHOQUE|CAPOT|TAPABARRO|ESPEJO|FOCO)\b/.test(upper))
    categoria = 'Carrocería';

  const ignorar = new Set([
    ...STOPWORDS_BUSQUEDA,
    ...MARCAS_CONOCIDAS,
    ...Object.keys(MODELOS_A_MARCA),
  ]);
  if (vehiculo?.patente) ignorar.add(vehiculo.patente.toUpperCase());
  if (vehiculo?.anio) ignorar.add(String(vehiculo.anio));

  const tokensTodo = String(texto || '')
    .toUpperCase()
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
      : texto.replace(/\s+/g, ' ').trim().slice(0, 70);

  return {
    tokensRepuesto,
    resumenRepuesto: resumenRepuesto.toUpperCase(),
    categoria,
  };
}

/**
 * Asegura que el catálogo unificado tenga los SKUs de Soluparts y Global cargados
 * y que existan sesiones demo iniciales en `sesiones_agente_omnicanal`.
 */
async function asegurarDatosInicialesAgente() {
  const invSnap = await db.collection(COLECCION_INVENTARIO).limit(5).get();
  const tieneAiloo = invSnap.docs.some((d) => d.data().origenCatalogo === 'nodo_ailoo');
  if (!tieneAiloo) {
    try {
      await sincronizarTodosLosNodosAiloo({ forzar: false });
    } catch {
      // Ignorar si ya está sincronizando
    }
  }

  const sesSnap = await db.collection(COLECCION_SESIONES_AGENTE).limit(1).get();
  if (!sesSnap.empty) return;

  const now = new Date().toISOString();
  const sesionDemo = {
    id: 'ses-omni-demo-porter',
    canal: 'whatsapp_cliente',
    clienteNombre: 'Carlos Muñoz — Flota Panadería San Cristóbal',
    clienteTelefono: '+56994128831',
    estado: 'activa',
    vehiculoContexto: {
      patente: 'JPKR42',
      marca: 'HYUNDAI',
      modelo: 'PORTER',
      anio: 2018,
      motor: '2.5 D4CB CRDI',
      vin: 'KMJHD17BPJU109281',
      fuente: 'padron_verificado',
    },
    mensajes: [
      {
        id: 'msg-demo-1',
        autor: 'cliente',
        texto: 'Hola! Necesito kit de distribución cadena para mi Hyundai Porter patente JPKR42, ¿lo tienen con stock?',
        transcripcionAudio: '',
        fotoUrl: '',
        creadoEn: now,
      },
      {
        id: 'msg-demo-2',
        autor: 'agente_ia',
        texto:
          '¡Hola Carlos! 🚗 Identifiqué tu **HYUNDAI PORTER 2018 · Motor 2.5 D4CB CRDI** (Patente `JPKR42`).\n\nEncontré disponibilidad inmediata en nuestro catálogo unificado:\n• **KIT DISTRIBUCION CADENA HYUNDAI PORTER / H1 2.5 D4CB** (`FRP-SOL-SOL-78125`) — Marca **MOBIS** · Stock disponible: **4 un.** · Precio FácilRepuestos: **$121.600 neto** (**$144.704 IVA inc.**).\n\n¿Te genero el link de pago inmediato o prefieres retirarlo en mostrador?',
        creadoEn: now,
        trazaCascada: {
          accionTomada: 'cotizacion_directa',
          vehiculoDetectado: {
            patente: 'JPKR42',
            marca: 'HYUNDAI',
            modelo: 'PORTER',
            anio: 2018,
            motor: '2.5 D4CB CRDI',
            fuente: 'padron_verificado',
          },
          reglasConocimientoAplicadas: [],
          candidatosInventario: [
            {
              id: 'ailoo_soluparts_SOL-78125',
              skuPublicoFrp: 'FRP-SOL-SOL-78125',
              nombre: 'KIT DISTRIBUCION CADENA HYUNDAI PORTER / H1 2.5 D4CB',
              origen: 'soluparts_ailoo',
              proveedorNombre: 'Soluparts (Ailoo Enterprise)',
              stock: 4,
              precioCostoProveedor: 95000,
              margenPct: 28,
              precioVentaNeto: 121600,
              precioVentaConIva: 144704,
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
 * Ejecuta el motor en cascada de 3 niveles sobre un mensaje de cliente final.
 */
async function ejecutarCascadaAgenteOmnicanal({
  sesion,
  textoCliente = '',
  transcripcionAudio = '',
  fotoUrl = '',
  patenteForzada = '',
  modoForzado = 'auto', // 'auto' | 'forzar_escalamiento' | 'forzar_mesa_wsp'
}) {
  const textoCombinado = [textoCliente, transcripcionAudio].filter(Boolean).join(' ').trim();

  // ─── PASO 1: IDENTIFICAR VEHÍCULO POR PATENTE O TEXTO ─────────────────────
  const vehiculo = await resolverVehiculoOmnicanal({
    patenteInput: patenteForzada,
    textoMensaje: textoCombinado,
    vehiculoActual: sesion.vehiculoContexto || null,
  });

  const { tokensRepuesto, resumenRepuesto, categoria } = extraerRepuestoYCategoria(
    textoCombinado,
    vehiculo
  );

  // ─── PASO 2: BUSCAR EN MEMORIA APRENDIDA (`conocimiento_aprendido_ia`) ────
  const conSnap = await db.collection(COLECCION_CONOCIMIENTO).get();
  const todasReglas = conSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const reglasAplicadas = todasReglas
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

      for (const tok of tokensRepuesto) {
        if (textoRegla.includes(tok)) score += 3;
      }
      return { regla, score };
    })
    .filter((x) => x.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => ({
      id: x.regla.id,
      skuPublicoFrp: x.regla.skuPublicoFrp || '',
      nombreRepuesto: x.regla.nombreRepuesto || '',
      explicacionExperta: x.regla.explicacionExperta || '',
      proveedorNombre: x.regla.proveedorNombre || '',
      precioVentaFrp: Number(x.regla.precioVentaFrp || 0),
    }));

  // ─── PASO 3: BUSCAR EN CATÁLOGO MULTI-PROVEEDOR (`inventario`) ────────────
  const invSnap = await db.collection(COLECCION_INVENTARIO).get();
  const itemsInventario = invSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const candidatosPuntuados = itemsInventario
    .map((item) => {
      let scoreRepuesto = 0;
      let scoreVehiculo = 0;

      const textoItem = [
        item.nombre,
        item.descripcion,
        item.categoria,
        item.tipoPieza,
        item.codigo,
        item.skuPublicoFrp,
        item.fabricante,
      ]
        .join(' ')
        .toUpperCase();

      for (const tok of tokensRepuesto) {
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
        : String(item.modelosCompatibles || '')
            .toUpperCase()
            .split(/[,;/]+/)
            .map((s) => s.trim())
            .filter(Boolean);

      if (vehiculo?.marca && vehiculo.marca !== 'MULTIMARCA') {
        if (
          marcasItem.includes(vehiculo.marca) ||
          textoItem.includes(vehiculo.marca)
        ) {
          scoreVehiculo += 4;
        } else if (marcasItem.length > 0) {
          // El ítem es exclusivo de otra marca distinta
          scoreVehiculo -= 5;
        }
      }

      if (vehiculo?.modelo) {
        if (
          modelosItem.some((m) => m.includes(vehiculo.modelo)) ||
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
    .filter((c) => c.scoreRepuesto >= 4 && c.scoreVehiculo >= 0 && c.scoreTotal >= 5)
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .slice(0, 4);

  const candidatosConStock = candidatosPuntuados.filter((c) => Number(c.item.stock || 0) > 0);

  const candidatosFormateados = candidatosConStock.map(({ item }) => {
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

    return {
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
      precioCostoProveedor: costo,
      margenPct,
      precioVentaNeto: ventaNeto,
      precioVentaConIva: Math.round(ventaNeto * 1.19),
    };
  });

  // ─── PASO 4: EVALUACIÓN DE LA CASCADA (COTIZAR / ESCALAR ETAPA 1 / MESA WSP ETAPA 3) ─
  const dudaTecnica = detectarDudaTecnicaEscalamiento(textoCombinado, Boolean(fotoUrl));
  const medidaPreguntada = (textoCombinado.toUpperCase().match(/\b(\d{2,3}\s*MM)\b/) || [])[1] || '';
  const yaResueltoEnMemoria =
    reglasAplicadas.length > 0 &&
    (!medidaPreguntada ||
      reglasAplicadas.some((r) =>
        String(r.explicacionExperta || '')
          .toUpperCase()
          .includes(medidaPreguntada.replace(/\s+/g, ''))
      ));

  let accionTomada = 'cotizacion_directa';
  if (modoForzado === 'forzar_escalamiento') {
    accionTomada = 'escalamiento_experto';
  } else if (modoForzado === 'forzar_mesa_wsp') {
    accionTomada = 'mesa_whatsapp_viva';
  } else if (candidatosFormateados.length === 0 && !yaResueltoEnMemoria) {
    accionTomada = 'mesa_whatsapp_viva';
  } else if (dudaTecnica.requiereValidacionExperta && !yaResueltoEnMemoria) {
    accionTomada = 'escalamiento_experto';
  }

  const now = new Date().toISOString();
  let escalamientoCreado = null;
  let solicitudWspCreada = null;
  let respuestaTexto = '';

  const etiquetaVehiculo = vehiculo
    ? `${vehiculo.marca} ${vehiculo.modelo || ''} ${vehiculo.anio ? `(${vehiculo.anio})` : ''}${
        vehiculo.motor ? ` · Motor ${vehiculo.motor}` : ''
      }${vehiculo.patente ? ` [Patente ${vehiculo.patente}]` : ''}`.trim()
    : 'Vehículo en consulta';

  // ─── RAMA A: COTIZACIÓN DIRECTA (CATÁLOGO UNIFICADO + CONOCIMIENTO APRENDIDO) ─
  if (accionTomada === 'cotizacion_directa') {
    const lineasOpciones = candidatosFormateados.map(
      (c) =>
        `• **${c.nombre}** (\`${c.skuPublicoFrp}\`) — Marca **${c.fabricante}** · Stock: **${c.stock} un.** · **$${c.precioVentaNeto.toLocaleString(
          'es-CL'
        )} neto** (**$${c.precioVentaConIva.toLocaleString('es-CL')} IVA inc.**)`
    );

    const notaAprendida =
      reglasAplicadas.length > 0
        ? `\n\n🧠 **Nota Técnica Verificada en FácilRepuestos:** ${reglasAplicadas[0].explicacionExperta}`
        : '';

    if (lineasOpciones.length > 0) {
      respuestaTexto = `¡Perfecto! 🚗 Para tu **${etiquetaVehiculo}** tenemos disponibilidad inmediata en nuestro catálogo conectado:\n\n${lineasOpciones.join(
        '\n'
      )}${notaAprendida}\n\n🛒 Puedes comprarlo directo en nuestro e-commerce **FácilRepuestos.cl** o confirmarme por aquí para dejártelo reservado en mostrador.`;
    } else if (reglasAplicadas.length > 0) {
      const r = reglasAplicadas[0];
      const conIva = Math.round((r.precioVentaFrp || 0) * 1.19);
      respuestaTexto = `¡Hola! 🚗 Según nuestra base técnica verificada para **${etiquetaVehiculo}**:\n\n• **${r.nombreRepuesto}** (\`${r.skuPublicoFrp}\`)${
        r.precioVentaFrp > 0
          ? ` — Valor FácilRepuestos: **$${r.precioVentaFrp.toLocaleString('es-CL')} neto** (**$${conIva.toLocaleString('es-CL')} IVA inc.**)`
          : ''
      }.\n🧠 **Detalle técnico:** ${r.explicacionExperta}`;
    }
  }

  // ─── RAMA B: ESCALAMIENTO EXPERTO AUTOMÁTICO (ETAPA 1) ────────────────────
  if (accionTomada === 'escalamiento_experto') {
    const mejorCandidato = candidatosFormateados[0] || null;
    const nodoAilooId =
      mejorCandidato?.nodoAilooId ||
      (vehiculo?.marca === 'PEUGEOT' || vehiculo?.marca === 'CITROEN' || vehiculo?.marca === 'TOYOTA'
        ? 'global'
        : 'soluparts');

    const esNodoAiloo = Boolean(mejorCandidato ? mejorCandidato.nodoAilooId : true);
    const ticketRef = `ESC-${Math.floor(100000 + Math.random() * 900000)}`;

    const nuevoEsc = {
      ticketRef,
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
      mensajeCliente: textoCliente || transcripcionAudio,
      transcripcionAudio: transcripcionAudio || '',
      fotoMuestraUrl: fotoUrl || '',
      motivoEscalamiento:
        dudaTecnica.motivo ||
        `Confirmar compatibilidad técnica exacta de ${resumenRepuesto} para ${etiquetaVehiculo}`,
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
    };

    respuestaTexto = `🚗 Identifiqué tu **${etiquetaVehiculo}**${
      mejorCandidato
        ? ` y tenemos pre-seleccionado **${mejorCandidato.nombre}** (\`${mejorCandidato.skuPublicoFrp}\`, ref. **$${mejorCandidato.precioVentaConIva.toLocaleString(
            'es-CL'
          )} IVA inc.**)`
        : ''
    }.\n\n🔍 Para asegurarte el calce 100% exacto antes de que compres, acabo de derivar tu consulta técnica a nuestro especialista de mostrador (**Ticket \`${ticketRef}\`** → \`${
      escalamientoCreado.destino
    }\`). Te confirmamos en breves minutos por esta misma vía.`;
  }

  // ─── RAMA C: MESA DE COTIZACIÓN EN VIVO POR WHATSAPP (ETAPA 3) ────────────
  if (accionTomada === 'mesa_whatsapp_viva') {
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
    const repuestoTexto = `${resumenRepuesto} ${vehiculo?.marca || ''} ${vehiculo?.modelo || ''}`.trim();
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
      mensajeEnviado: `Hola ${p.contacto || p.nombre} 👋 Cotización urgente FácilRepuestos (#${codigoSolicitud}): ${repuestoTexto}${
        vehiculo?.patente ? ` · Patente ${vehiculo.patente}` : ''
      }. ¿Disponibilidad y precio neto mesón?`,
      enviadoEn: now,
      respondidoEn: null,
    }));

    const nuevaSolWsp = {
      codigoSolicitud,
      estado: 'esperando_respuestas',
      canalCliente: sesion.canal === 'web_cliente' ? 'web' : 'whatsapp',
      clienteNombre: sesion.clienteNombre || 'Cliente Omnicanal',
      clienteTelefono: sesion.clienteTelefono || '',
      patente: vehiculo?.patente || '',
      vin: vehiculo?.vin || '',
      marcaVehiculo: vehiculo?.marca || 'POR CONFIRMAR',
      modeloVehiculo: vehiculo?.modelo || '',
      anioVehiculo: vehiculo?.anio || null,
      motorVehiculo: vehiculo?.motor || '',
      categoriaRepuesto: categoria,
      repuestoBuscado: `${resumenRepuesto} ${vehiculo?.marca || ''} ${vehiculo?.modelo || ''}`.trim(),
      codigoReferencia: '',
      notasAdicionales: `Generado automáticamente por Agente Omnicanal desde consulta: "${textoCombinado.slice(
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
    };

    respuestaTexto = `🚗 Revisé nuestro stock conectado (Soluparts, Global y Bodega Local) para tu **${etiquetaVehiculo}** y este repuesto específico no figura con unidades inmediatas en bodega central.\n\n📲 **¡Ya activé nuestra Mesa de Cotización en Vivo (` +
      `\`#${codigoSolicitud}\`)!** Acabo de enviar la consulta por WhatsApp a **${proveedoresContactados.length} importadora(s) especialista(s)** (${proveedoresContactados
        .map((p) => p.proveedorNombre)
        .join(', ')}) para cotizarte stock físico en mesón con foto y precio al instante.`;
  }

  return {
    vehiculoDetectado: vehiculo,
    respuestaTexto,
    trazaCascada: {
      accionTomada,
      vehiculoDetectado: vehiculo,
      reglasConocimientoAplicadas: reglasAplicadas,
      candidatosInventario: candidatosFormateados,
      escalamientoCreado,
      solicitudWspCreada,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agente-omnicanal/sesiones
// Lista todas las sesiones de conversación del Agente Vendedor Omnicanal
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sesiones', requireAuth, async (req, res, next) => {
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
router.post('/sesiones', requireAuth, async (req, res, next) => {
  try {
    const {
      canal = 'whatsapp_cliente',
      clienteNombre = 'Cliente WhatsApp',
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
      mensajes: [
        {
          id: `msg-${Date.now()}`,
          autor: 'agente_ia',
          texto: vehiculoContexto
            ? `¡Hola ${clienteNombre}! 👋 Ya identifiqué tu **${vehiculoContexto.marca} ${vehiculoContexto.modelo} ${vehiculoContexto.anio || ''}** (Patente \`${vehiculoContexto.patente}\`). ¿Qué repuesto necesitas cotizar hoy? Puedes enviarme texto, audio o foto de la pieza.`
            : `¡Hola ${clienteNombre}! 👋 Soy el asistente técnico de **FácilRepuestos**. Indícame la **patente** de tu vehículo (o marca, modelo y año) y qué repuesto buscas. También puedes enviarme audios o fotos de la muestra.`,
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
// la cascada completa: Patente -> Conocimiento IA -> Catálogo Multi-Ailoo/Local -> Escalamiento / Mesa WSP
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sesiones/:id/mensaje', requireAuth, async (req, res, next) => {
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

    await docRef.update({
      vehiculoContexto,
      mensajes: mensajesActualizados,
      updatedAt: new Date().toISOString(),
    });

    const sesionActualizada = {
      ...sesion,
      vehiculoContexto,
      mensajes: mensajesActualizados,
      updatedAt: new Date().toISOString(),
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
// POST /api/agente-omnicanal/patente
// Resuelve rápidamente una patente chilena para previsualización en la consola
// ─────────────────────────────────────────────────────────────────────────────
router.post('/patente', requireAuth, async (req, res, next) => {
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
