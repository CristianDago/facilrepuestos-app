/**
 * server/agents/orquestadorRepuestin.js
 *
 * AGENTE 0 — ORQUESTADOR MULTI-AGENTE DE REPUESTÍN
 * ────────────────────────────────────────────────
 * Coordina a los 6 Subagentes Especializados manteniendo respuestas breves, directas y sin divagar:
 *   - Agente 1: Recepción, Patente, Urgencia y Comuna.
 *   - Agente 2: Buscador ERP y Clasificador de Stock Propio Olivares 224 vs Proveedor Externo.
 *   - Agente 3: Reglas de Proveedores y Tarifario de Despacho (Santiago y Regiones).
 *   - Agente 4: Mesa de Abastecimiento Automática (Top 3) + Publicador de Producto Temporal (TTL 4h).
 *   - Agente 5: Cajero Tienda / Validador de Pagos en WordPress (solo envía links de tienda, nunca links de pago sueltos).
 *   - Agente 6: Fusión de Pedidos Adicionales en el mismo carrito.
 */

import {
  perfilarNecesidadYComunaCliente,
  construirRespuestaAgente1Recepcion,
  construirRespuestaPreguntaSobreProductoCotizado,
  formatearNombreProductoParaVehiculoCliente,
} from './agente1Recepcion.js';
import {
  clasificarCandidatosErpPorReglaOrigen,
  resolverRutaEscalamientoAgente2,
  esItemSoluparts,
} from './agente2BuscadorErp.js';
import { evaluarLogisticaYDespachoAgente3 } from './agente3LogisticaYProveedores.js';
import { seleccionarTop3ProveedoresMesaWsp } from './agente4MesaYPublicadorTemporal.js';
import { fusionarPedidoAdicionalEnCarrito } from './agente6PedidosAdicionales.js';

export {
  perfilarNecesidadYComunaCliente,
  construirRespuestaAgente1Recepcion,
  construirRespuestaPreguntaSobreProductoCotizado,
  formatearNombreProductoParaVehiculoCliente,
  clasificarCandidatosErpPorReglaOrigen,
  resolverRutaEscalamientoAgente2,
  esItemSoluparts,
  evaluarLogisticaYDespachoAgente3,
  seleccionarTop3ProveedoresMesaWsp,
  fusionarPedidoAdicionalEnCarrito,
};

/**
 * Redacta la respuesta comercial concisa del Orquestador cuando el Agente 2 encuentra productos en el ERP:
 *  - Limpia el título del repuesto para no escupir la lista de 10 autos ajenos.
 *  - Muestra Precio IVA inc. + Link directo del producto en `facilrepuestos.cl`.
 *  - NO vomita el reglamento logístico de 3 párrafos: hace una pregunta corta de 1 línea para entender
 *    si el cliente prefiere retiro en tienda o despacho a domicilio/región.
 */
export function redactarCotizacionOrquestada({
  etiquetaVehiculo,
  candidatosNuevos = [],
  carritoConsolidado = [],
  esPedidoAdicional = false,
  comunaCliente = null,
  notaRespuestasPrevias = '',
  notaAprendida = '',
}) {
  const clasificacion = clasificarCandidatosErpPorReglaOrigen(carritoConsolidado);
  const itemsMostrar = esPedidoAdicional ? clasificacion.candidatos : candidatosNuevos;

  const lineasProductos = itemsMostrar.map((c) => {
    const nombreLimpio = formatearNombreProductoParaVehiculoCliente(c.nombre);
    return (
      `• **${nombreLimpio}** (\`${c.skuPublicoFrp}\`) — **$${Number(
        c.precioVentaConIva || 0
      ).toLocaleString('es-CL')} IVA inc.**\n` +
      `  👉 Ver producto y comprar: ${c.urlProductoWoo}`
    );
  });

  const encabezado = esPedidoAdicional
    ? `➕ ¡Sumado a tu cotización! Compatible con tu **${etiquetaVehiculo}**:`
    : `¡Lo encontré! 🚗 Sí tenemos disponible compatible con tu **${etiquetaVehiculo}**:`;

  const preguntaSiguientePaso =
    comunaCliente && !/^(santiago|rm|region metropolitana)$/i.test(String(comunaCliente).trim())
      ? `¿Lo prefieres con **despacho a ${comunaCliente}** o para **retiro en nuestra sucursal de La Florida**?`
      : `¿Lo necesitas para **retiro en nuestra sucursal de La Florida** o prefieres **despacho a domicilio / región**?`;

  return (
    `${notaRespuestasPrevias}${encabezado}\n\n` +
    `${lineasProductos.join('\n')}${notaAprendida}\n\n` +
    `${preguntaSiguientePaso}`
  );
}
