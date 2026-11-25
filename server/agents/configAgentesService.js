/**
 * server/agents/configAgentesService.js
 *
 * GESTOR EN CALIENTE DE LOS 6 SUBAGENTES + ORQUESTADOR DESDE EL PORTAL (sistema.facilrepuestos.cl)
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Permite modificar desde la interfaz web (sin tocar código ni entrar a Cloud Run):
 *  - El modelo de IA de cada agente (por defecto `gemini-4.0-neon`, con fallback transparente a `gemini-3.8-flash`).
 *  - Las reglas operativas, prompts y contexto nuevo de cada uno de los 6 subagentes + Orquestador.
 *  - Los parámetros de negocio (TTL de 4 horas para productos temporales, Top 3 de proveedores, reglas de proveedores).
 */

import { db } from '../config/firebase.js';

const COLECCION_CONFIG = 'configuracion_sistema';
const DOC_AGENTES_IA = 'cerebros_agentes_ia';

export const MODELOS_GEMINI_DISPONIBLES = [
  { id: 'gemini-4.0-neon', nombre: 'Gemini 4 Neon (Ultra Rápido · Recomendado Agentes)' },
  { id: 'gemini-3.8-flash', nombre: 'Gemini 3.8 Flash (Estable Baja Latencia)' },
  { id: 'gemini-3.8-pro', nombre: 'Gemini 3.8 Pro (Razonamiento Profundo)' },
  { id: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash (Clásico)' },
];

export const CONFIG_AGENTES_DEFAULT = {
  modeloGlobalPreferido: 'gemini-4.0-neon',
  ttlHorasProductoTemporal: 4,
  topProveedoresMesaWsp: 3,
  numeroMesaAbastecimiento: '56950960294',
  numeroRepuestinClientes: '56921109851',
  agentes: {
    orquestador: {
      id: 'orquestador',
      nombre: 'Agente 0 · Orquestador Central',
      modelo: 'gemini-4.0-neon',
      rol: 'Coordina a los 6 subagentes, mantiene el contexto de la sesión y redacta respuestas breves (máximo 3-4 líneas) sin divagar.',
      instrucciones:
        'Habla como vendedor experto chileno de facilrepuestos.cl (sin tilde). Nunca mezcles pasos ni inventes SKUs. Envía siempre links de producto de la tienda, jamás links de pago sueltos.',
      contextoExtra: '',
      activo: true,
    },
    agente1_recepcion: {
      id: 'agente1_recepcion',
      nombre: 'Agente 1 · Recepción, Patente, Urgencia y Comuna',
      modelo: 'gemini-4.0-neon',
      rol: 'Saluda como Repuestín, busca la patente, entiende qué repuesto busca el cliente, si lo necesita urgente hoy o puede esperar, y de qué comuna de Santiago o región de Chile escribe.',
      instrucciones:
        'Si falta el vehículo o el repuesto, pregunta solo el dato faltante en 2 líneas. Identifica siempre comuna y urgencia del cliente.',
      contextoExtra: '',
      activo: true,
    },
    agente2_buscador_erp: {
      id: 'agente2_buscador_erp',
      nombre: 'Agente 2 · Buscador ERP y Clasificador de Stock',
      modelo: 'gemini-4.0-neon',
      rol: 'Cruza patente + SKU/repuesto contra nuestro ERP (Olivares 224, Soluparts, Global y tiendas). Si no existe, entrega el caso automáticamente al Agente 4 (Mesa de Abastecimiento).',
      instrucciones:
        'Diferencia estrictamente el stock propio en Enrique Olivares 224 del stock de proveedores externos. Si hay duda técnica de calce o foto de muestra, escala de forma anónima a Mostrador IA.',
      contextoExtra: '',
      activo: true,
    },
    agente3_logistica_proveedores: {
      id: 'agente3_logistica_proveedores',
      nombre: 'Agente 3 · Reglas de Proveedores y Tarifario de Despacho',
      modelo: 'gemini-4.0-neon',
      rol: 'Conoce cómo opera cada proveedor y aplica la lista de precios de despacho en Santiago (4 Anillos) y Regiones (Tallas XS a XL).',
      instrucciones:
        'REGLA ESTRICTA: Los únicos pagos y retiros presenciales en La Florida son para productos de stock local en Enrique Olivares 224. Todo lo demás debe ser despachado a domicilio y comprado en la tienda web facilrepuestos.cl.',
      contextoExtra:
        'Bodega Olivares 224: retiro inmediato o despacho. Soluparts: corte 12:00 hrs sale el mismo día, sólo despacho. Global: despacho en el día antes de las 15:00 hrs.',
      activo: true,
    },
    agente4_mesa_abastecimiento: {
      id: 'agente4_mesa_abastecimiento',
      nombre: 'Agente 4 · Mesa de Abastecimiento (+56950960294) y Producto Temporal (4h)',
      modelo: 'gemini-4.0-neon',
      rol: 'Cotiza por WhatsApp al Top 3 de proveedores según marca y cercanía desde el +56950960294. Elige automáticamente la mejor oferta, asigna foto referencial y crea el producto temporal por 4 horas en Firebase y WordPress.',
      instrucciones:
        'Priorizar ofertas con stock inmediato y mejor relación precio/calidad. El producto temporal dura 4 horas en facilrepuestos.cl y se elimina automáticamente si no se compra.',
      contextoExtra: '',
      activo: true,
    },
    agente5_cajero_wordpress: {
      id: 'agente5_cajero_wordpress',
      nombre: 'Agente 5 · Cajero Tienda y Validador de Pagos WordPress',
      modelo: 'gemini-4.0-neon',
      rol: 'Entrega siempre el link del producto en la tienda facilrepuestos.cl (nunca links de pago sueltos) y valida en vivo cuando el cliente paga en WordPress para confirmarle por WhatsApp.',
      instrucciones:
        'Al recibir el webhook de pago confirmado desde WooCommerce, proteger el producto temporal para que no expire y enviar mensaje de confirmación por WhatsApp al cliente.',
      contextoExtra: '',
      activo: true,
    },
    agente6_pedidos_adicionales: {
      id: 'agente6_pedidos_adicionales',
      nombre: 'Agente 6 · Detector de Cotización Adicional y Carrito Vivo',
      modelo: 'gemini-4.0-neon',
      rol: 'Detecta cuando un cliente pide un segundo o tercer repuesto adicional antes de terminar su compra y lo suma a su cotización actual sin perder los productos anteriores.',
      instrucciones:
        'Conservar siempre los productos ya cotizados en la sesión y sumar el nuevo repuesto como adicional en la misma lista.',
      contextoExtra: '',
      activo: true,
    },
  },
};

let _cacheAgentes = { data: null, loadedAt: 0 };

/**
 * Obtiene la configuración viva de los 6 subagentes + Orquestador desde Firestore.
 */
export async function obtenerConfiguracionAgentesIA({ forceRefresh = false } = {}) {
  const ahora = Date.now();
  if (!forceRefresh && _cacheAgentes.data && ahora - _cacheAgentes.loadedAt < 15000) {
    return _cacheAgentes.data;
  }

  let guardado = {};
  try {
    const snap = await db.collection(COLECCION_CONFIG).doc(DOC_AGENTES_IA).get();
    if (snap.exists) {
      guardado = snap.data() || {};
    }
  } catch (err) {
    console.warn('[ConfigAgentesIA] Aviso leyendo configuracion de agentes:', err.message);
  }

  const agentesMerge = {};
  for (const [key, def] of Object.entries(CONFIG_AGENTES_DEFAULT.agentes)) {
    agentesMerge[key] = {
      ...def,
      ...(guardado.agentes?.[key] || {}),
    };
  }

  const resultado = {
    modeloGlobalPreferido: guardado.modeloGlobalPreferido || CONFIG_AGENTES_DEFAULT.modeloGlobalPreferido,
    ttlHorasProductoTemporal: Number(guardado.ttlHorasProductoTemporal) || CONFIG_AGENTES_DEFAULT.ttlHorasProductoTemporal,
    topProveedoresMesaWsp: Number(guardado.topProveedoresMesaWsp) || CONFIG_AGENTES_DEFAULT.topProveedoresMesaWsp,
    numeroMesaAbastecimiento: guardado.numeroMesaAbastecimiento || CONFIG_AGENTES_DEFAULT.numeroMesaAbastecimiento,
    numeroRepuestinClientes: guardado.numeroRepuestinClientes || CONFIG_AGENTES_DEFAULT.numeroRepuestinClientes,
    agentes: agentesMerge,
    modelosDisponibles: MODELOS_GEMINI_DISPONIBLES,
    updatedAt: guardado.updatedAt || null,
  };

  _cacheAgentes = { data: resultado, loadedAt: ahora };
  return resultado;
}

/**
 * Actualiza en caliente en Firestore las instrucciones, contexto o modelo de cualquiera de los agentes
 * directamente desde el portal `sistema.facilrepuestos.cl` sin reiniciar Cloud Run.
 */
export async function guardarConfiguracionAgentesIA(payload = {}) {
  const actual = await obtenerConfiguracionAgentesIA({ forceRefresh: true });
  const nuevosAgentes = { ...actual.agentes };

  if (payload.agentes && typeof payload.agentes === 'object') {
    for (const [k, val] of Object.entries(payload.agentes)) {
      if (nuevosAgentes[k] && val && typeof val === 'object') {
        nuevosAgentes[k] = {
          ...nuevosAgentes[k],
          ...val,
          modelo: val.modelo || payload.modeloGlobalPreferido || nuevosAgentes[k].modelo,
        };
      }
    }
  }

  if (payload.modeloGlobalPreferido) {
    for (const k of Object.keys(nuevosAgentes)) {
      if (!payload.agentes?.[k]?.modelo) {
        nuevosAgentes[k].modelo = payload.modeloGlobalPreferido;
      }
    }
  }

  const docGuardar = {
    modeloGlobalPreferido: payload.modeloGlobalPreferido || actual.modeloGlobalPreferido,
    ttlHorasProductoTemporal: Number(payload.ttlHorasProductoTemporal) || actual.ttlHorasProductoTemporal,
    topProveedoresMesaWsp: Number(payload.topProveedoresMesaWsp) || actual.topProveedoresMesaWsp,
    numeroMesaAbastecimiento: payload.numeroMesaAbastecimiento || actual.numeroMesaAbastecimiento,
    numeroRepuestinClientes: payload.numeroRepuestinClientes || actual.numeroRepuestinClientes,
    agentes: nuevosAgentes,
    updatedAt: new Date().toISOString(),
  };

  await db.collection(COLECCION_CONFIG).doc(DOC_AGENTES_IA).set(docGuardar, { merge: true });
  _cacheAgentes = { data: null, loadedAt: 0 };
  return obtenerConfiguracionAgentesIA({ forceRefresh: true });
}
