/**
 * server/agents/agente3LogisticaYProveedores.js
 *
 * AGENTE 3 — ESPECIALISTA EN REGLAS DE PROVEEDORES Y TARIFARIO DE DESPACHO (SANTIAGO Y CHILE)
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * Base de Conocimiento en 2 Capas:
 *   • Capa 3A (Reglas por Proveedor / Origen):
 *     - Stock Local Propio (`Enrique Olivares 224, La Florida`): Es el ÚNICO que permite Retiro y Pago Presencial en La Florida (o Despacho).
 *     - Proveedores Externos (`Soluparts`, `Global`, `ERPs Tiendas`, `Mesa Abastecimiento`): 100% con Despacho a domicilio y compra mediante el link del producto en `facilrepuestos.cl`.
 *   • Capa 3B (Lista de Precios de Despacho en Santiago y Todo Chile):
 *     - Usa `cotizarDespachoAnticipado` de `logisticaTarifarioService.js` (4 Anillos RM + 4 Macrozonas Regiones × Tallas XS..XL).
 */

import { cotizarDespachoAnticipado } from '../services/logisticaTarifarioService.js';
import { esItemStockPropioOlivares224 } from './agente2BuscadorErp.js';

export const REGLAS_OPERATIVAS_PROVEEDORES = {
  bodega_olivares_224: {
    id: 'bodega_olivares_224',
    nombreInterno: 'Stock Propio Enrique Olivares 224',
    permitePagoPresencialLaFlorida: true,
    permiteRetiroLaFlorida: true,
    promesaPreparacion: 'Disponible para retiro inmediato en Enrique Olivares 224, La Florida (con pago en tienda o web) o despacho express a domicilio.',
  },
  soluparts: {
    id: 'soluparts',
    nombreInterno: 'Nodo Central Soluparts',
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    promesaPreparacion: 'Modalidad exclusiva con Despacho a domicilio comprando en facilrepuestos.cl (compras antes de las 12:00 hrs salen a ruta el mismo día; después de las 12:00 hrs salen el día hábil siguiente).',
  },
  global: {
    id: 'global',
    nombreInterno: 'Nodo Global Repuestos',
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    promesaPreparacion: 'Modalidad exclusiva con Despacho a domicilio comprando en facilrepuestos.cl (despacho en el día para compras antes de las 15:00 hrs).',
  },
  mesa_wsp: {
    id: 'mesa_wsp',
    nombreInterno: 'Proveedor Mesa de Abastecimiento',
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    promesaPreparacion: 'Producto especial habilitado por 4 horas en facilrepuestos.cl con Despacho directo a domicilio.',
  },
};

/**
 * Calcula las condiciones logísticas y de pago exactas para una lista de productos y la comuna del cliente.
 */
export function evaluarLogisticaYDespachoAgente3({
  items = [],
  comunaCliente = null,
}) {
  const lista = Array.isArray(items) ? items : [];
  const todosSonPropioOlivares =
    lista.length > 0 && lista.every((it) => esItemStockPropioOlivares224(it));

  const cotizacionEnvio = cotizarDespachoAnticipado({
    direccionOComuna: comunaCliente || 'Santiago',
    itemsCarrito: lista,
    modalidad: 'Despacho a domicilio',
  });

  const costoDespachoIva = Number(cotizacionEnvio?.costoDespachoConIva || 0);
  const textoTarifaDespacho = comunaCliente
    ? `🚚 **Despacho a ${cotizacionEnvio.comunaDetectada || comunaCliente}:** **$${costoDespachoIva.toLocaleString('es-CL')} IVA inc.** (${cotizacionEnvio.tiempoEstimado || '24 a 48 hrs'})`
    : `🚚 **Despacho a domicilio en Santiago (desde $3.990) y Regiones:** Dime de qué **comuna o ciudad** eres para darte el valor exacto de envío`;

  if (todosSonPropioOlivares) {
    return {
      permitePagoPresencialLaFlorida: true,
      permiteRetiroLaFlorida: true,
      cotizacionDespacho: cotizacionEnvio,
      resumenLogisticoParaCliente:
        `📍 **Retiro y Pago en Tienda:** Disponible en **Enrique Olivares 224, La Florida** (retiro inmediato, puedes pagar en mesón o en la web).\n` +
        `${textoTarifaDespacho}.`,
    };
  }

  return {
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    cotizacionDespacho: cotizacionEnvio,
    resumenLogisticoParaCliente:
      `${textoTarifaDespacho}.\n` +
      `🛒 **Modalidad de compra:** Este repuesto se gestiona con **despacho directo** comprándolo desde el link del producto en **facilrepuestos.cl** (no aplica pago presencial en sucursal La Florida).`,
  };
}
