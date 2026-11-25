/**
 * server/agents/agente6PedidosAdicionales.js
 *
 * AGENTE 6 — DETECTOR DE COTIZACIÓN ADICIONAL Y FUSIÓN DE CARRITO ACTIVO
 * ──────────────────────────────────────────────────────────────────────
 * Responsabilidad única:
 *  - Detectar cuando un cliente que ya tiene productos cotizados en su sesión (`carritoCotizado`)
 *    pide un repuesto ADICIONAL (ej. "además necesito...", "y tendrás también...", "agrégale...",
 *    o simplemente nombra otra pieza distinta antes de terminar la compra).
 *  - Garantiza que NUNCA se borren los productos que ya tenía cotizados, sumando el nuevo repuesto
 *    como pedido adicional.
 */

const REGEX_INTENCION_ADICIONAL =
  /\b(adem[aá]s|tambien|tambi[eé]n|agrega|agr[eé]gale|sumale|s[uú]male|otro\s+repuesto|otra\s+pieza|aprovecho\s+de|y\s+tienes|y\s+tendr[aá]s|me\s+falta\s+tambien)\b/i;

/**
 * Evalúa si el turno actual corresponde a un pedido adicional sobre una sesión que ya tenía productos cotizados,
 * y fusiona sin duplicar los productos previos con los nuevos encontrados.
 */
export function fusionarPedidoAdicionalEnCarrito({
  textoCliente = '',
  carritoPrevio = [],
  nuevosCandidatos = [],
}) {
  const prev = Array.isArray(carritoPrevio) ? carritoPrevio : [];
  const nuevos = Array.isArray(nuevosCandidatos) ? nuevosCandidatos : [];

  const mencionaAdicionalExplicito = REGEX_INTENCION_ADICIONAL.test(String(textoCliente || ''));
  const teniaCarritoPrevio = prev.length > 0;

  if (!teniaCarritoPrevio || nuevos.length === 0) {
    return {
      esPedidoAdicional: false,
      carritoConsolidado: nuevos.length > 0 ? nuevos.map((c) => ({ ...c, cantidad: c.cantidad || 1 })) : prev,
      itemsPreviosConservados: 0,
      itemsNuevosAgregados: nuevos.length,
    };
  }

  // Verificar si los nuevos candidatos son de una pieza distinta a los que ya estaban en el carrito
  const skusPrevios = new Set(prev.map((p) => p.skuPublicoFrp));
  const sonPiezasDistintas = nuevos.some((n) => !skusPrevios.has(n.skuPublicoFrp));

  if (!mencionaAdicionalExplicito && !sonPiezasDistintas) {
    return {
      esPedidoAdicional: false,
      carritoConsolidado: nuevos.map((c) => ({ ...c, cantidad: c.cantidad || 1 })),
      itemsPreviosConservados: 0,
      itemsNuevosAgregados: nuevos.length,
    };
  }

  const mapaConsolidado = new Map();
  for (const itemPrev of prev) {
    mapaConsolidado.set(itemPrev.skuPublicoFrp, { ...itemPrev, cantidad: itemPrev.cantidad || 1 });
  }
  let agregados = 0;
  for (const itemNuevo of nuevos) {
    if (!mapaConsolidado.has(itemNuevo.skuPublicoFrp)) {
      mapaConsolidado.set(itemNuevo.skuPublicoFrp, { ...itemNuevo, cantidad: 1 });
      agregados++;
    }
  }

  return {
    esPedidoAdicional: agregados > 0,
    carritoConsolidado: Array.from(mapaConsolidado.values()),
    itemsPreviosConservados: prev.length,
    itemsNuevosAgregados: agregados,
  };
}
