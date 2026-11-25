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

import { perfilarNecesidadYComunaCliente, construirRespuestaAgente1Recepcion } from './agente1Recepcion.js';
import { clasificarCandidatosErpPorReglaOrigen } from './agente2BuscadorErp.js';
import { evaluarLogisticaYDespachoAgente3 } from './agente3LogisticaYProveedores.js';
import { seleccionarTop3ProveedoresMesaWsp } from './agente4MesaYPublicadorTemporal.js';
import { fusionarPedidoAdicionalEnCarrito } from './agente6PedidosAdicionales.js';

export {
  perfilarNecesidadYComunaCliente,
  construirRespuestaAgente1Recepcion,
  clasificarCandidatosErpPorReglaOrigen,
  evaluarLogisticaYDespachoAgente3,
  seleccionarTop3ProveedoresMesaWsp,
  fusionarPedidoAdicionalEnCarrito,
};

/**
 * Redacta la respuesta comercial concisa del Orquestador cuando el Agente 2 encuentra productos en el ERP,
 * aplicando las reglas del Agente 3 (Stock Propio Olivares 224 = único con pago/retiro en La Florida;
 * todo lo demás = Despacho a domicilio + link de producto en tienda `facilrepuestos.cl`) y del Agente 6 (pedido adicional).
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
  const logistica = evaluarLogisticaYDespachoAgente3({
    items: clasificacion.candidatos,
    comunaCliente,
  });

  const itemsMostrar = esPedidoAdicional ? clasificacion.candidatos : candidatosNuevos;
  const lineasProductos = itemsMostrar.map(
    (c) =>
      `• **${c.nombre}** (\`${c.skuPublicoFrp}\`) — **$${Number(c.precioVentaConIva || 0).toLocaleString('es-CL')} IVA inc.**\n  🔎 Comprar en tienda: ${c.urlProductoWoo}`
  );

  const encabezado = esPedidoAdicional
    ? `➕ ¡Sumado a tu cotización para **${etiquetaVehiculo}**! Así queda tu lista actualizada en **facilrepuestos.cl**:`
    : `¡Perfecto! 🚗 Para tu **${etiquetaVehiculo}** tenemos disponible en **facilrepuestos.cl**:`;

  return (
    `${notaRespuestasPrevias}${encabezado}\n\n` +
    `${lineasProductos.join('\n')}${notaAprendida}\n\n` +
    `${logistica.resumenLogisticoParaCliente}`
  );
}
