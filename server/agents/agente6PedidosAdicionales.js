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

  // Extraer la palabra clave principal de la pieza para distinguir si pide OTRA pieza distinta
  // vs si está corrigiendo el modelo/año para la MISMA pieza (ej. otra Tapa de Termostato)
  const extraerFamiliaPieza = (item = {}) => {
    const base = String(item.subConsultaResumen || item.nombre || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+PARA\s+/i)[0]
      .trim();
    return base.split(/\s+/).slice(0, 2).join(' ');
  };

  const skusPrevios = new Set(prev.map((p) => p.skuPublicoFrp));
  const familiasPrevias = new Set(prev.map((p) => extraerFamiliaPieza(p)).filter(Boolean));
  const sonSkusDistintos = nuevos.some((n) => !skusPrevios.has(n.skuPublicoFrp));
  const sonFamiliasPiezaDistintas = nuevos.some((n) => {
    const fam = extraerFamiliaPieza(n);
    return fam && !familiasPrevias.has(fam);
  });

  // Solo fusionar como pedido adicional si el cliente usó conectores de adición ("además", "también", "agrégale")
  // o si efectivamente está pidiendo una familia de pieza distinta a la que ya tenía en el carrito.
  // Si volvió a buscar la misma pieza (ej. corrigiendo que su auto es Changan S100 1.0), reemplaza la pieza anterior.
  if (!mencionaAdicionalExplicito && (!sonSkusDistintos || !sonFamiliasPiezaDistintas)) {
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
