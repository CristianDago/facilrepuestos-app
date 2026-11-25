/**
 * server/agents/agente3LogisticaYProveedores.js
 *
 * AGENTE 3 — ESPECIALISTA EN REGLAS DE PROVEEDORES, HORARIO SOLUPARTS (11:30 -> 15:30) Y TARIFARIO DE DESPACHO
 * ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Base de Conocimiento en 2 Capas:
 *   • Capa 3A (Reglas por Proveedor / Origen):
 *     - Stock Local Propio (`Enrique Olivares 224, La Florida`): Es el ÚNICO que permite Pago Presencial y Retiro Inmediato en La Florida (o Despacho).
 *     - Soluparts (`FRP-SOL-*`): Siempre se paga comprando en nuestro portal `facilrepuestos.cl`.
 *       * Si el cliente compra ANTES de las 11:30 hrs del día en nuestro portal -> se puede ofrecer Retiro en Enrique Olivares 224 a partir de las 15:30 hrs (3:30 PM) del mismo día.
 *       * Si la compra es POSTERIOR a las 11:30 hrs -> pasa para las compras de antes de las 12:00 del día siguiente, pudiendo proponer Retiro en Enrique Olivares 224 a partir de las 15:30 hrs (3:30 PM) del día siguiente.
 *       * O bien se calcula y entrega cotización de Despacho según dimensión (XS..XL) en Santiago y todo Chile.
 *     - Otros Proveedores ERP y Mesa de Abastecimiento WSP (`FRP-LOC-*`, `FRP-WSP-*`): Se calcula y entrega cotización de Despacho según dimensión en Santiago y todo Chile comprando desde el link del producto en `facilrepuestos.cl`.
 *   • Capa 3B (Lista de Precios de Despacho en Santiago y Todo Chile):
 *     - Usa `cotizarDespachoAnticipado` de `logisticaTarifarioService.js` (4 Anillos RM + 4 Macrozonas Regiones × Tallas XS..XL).
 */

import {
  cotizarDespachoAnticipado,
  calcularPromesaRetiroYDespacho,
} from '../services/logisticaTarifarioService.js';
import { esItemStockPropioOlivares224, esItemSoluparts } from './agente2BuscadorErp.js';

export const REGLAS_OPERATIVAS_PROVEEDORES = {
  bodega_olivares_224: {
    id: 'bodega_olivares_224',
    nombreInterno: 'Stock Propio Enrique Olivares 224',
    permitePagoPresencialLaFlorida: true,
    permiteRetiroLaFlorida: true,
    promesaPreparacion:
      'Disponible para retiro inmediato en Enrique Olivares 224, La Florida (con pago en tienda o web) o despacho express a domicilio.',
  },
  soluparts: {
    id: 'soluparts',
    nombreInterno: 'Nodo Central Soluparts',
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: true,
    promesaPreparacion:
      'Comprando en nuestro portal facilrepuestos.cl antes de las 11:30 hrs puedes retirar el mismo día desde las 15:30 hrs en Enrique Olivares 224; si compras después de las 11:30 hrs queda disponible para retiro desde las 15:30 hrs del día siguiente, o con Despacho a domicilio según dimensión en Santiago y Chile.',
  },
  mesa_wsp: {
    id: 'mesa_wsp',
    nombreInterno: 'Proveedor Mesa de Abastecimiento WhatsApp',
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    promesaPreparacion:
      'Producto especial habilitado por 4 horas en facilrepuestos.cl con Despacho directo a domicilio calculado según dimensión en Santiago y Chile.',
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
  const todosSonSolupartsOPropio =
    lista.length > 0 &&
    lista.every((it) => esItemStockPropioOlivares224(it) || esItemSoluparts(it));
  const algunoEsSoluparts = lista.some((it) => esItemSoluparts(it));

  const cotizacionEnvio = cotizarDespachoAnticipado({
    direccionOComuna: comunaCliente || 'Santiago',
    itemsCarrito: lista,
    modalidad: 'Despacho a domicilio',
  });
  const promesaSla = calcularPromesaRetiroYDespacho({ itemsCarrito: lista });

  const costoDespachoIva = Number(cotizacionEnvio?.costoDespachoConIva || 0);
  const tallaCod = cotizacionEnvio?.volumetria?.tallaConsolidada || 'S';
  const dim = cotizacionEnvio?.volumetria?.dimensionesReferencialesCm || {
    largo: 32,
    ancho: 25,
    alto: 18,
  };

  const textoTarifaDespacho = comunaCliente
    ? `🚚 **Despacho a ${cotizacionEnvio.comunaDetectada || comunaCliente} (Talla ${tallaCod} · ${dim.largo}×${dim.ancho}×${dim.alto} cm):** **$${costoDespachoIva.toLocaleString('es-CL')} IVA inc.** (${cotizacionEnvio.tiempoEstimado || '24 a 48 hrs'})`
    : `🚚 **Despacho en Santiago y todo Chile (Talla ${tallaCod} · ${dim.largo}×${dim.ancho}×${dim.alto} cm):** Dime de qué **comuna o ciudad** eres para darte la cotización exacta de envío (en Santiago desde $3.990 IVA inc.)`;

  if (todosSonPropioOlivares) {
    return {
      permitePagoPresencialLaFlorida: true,
      permiteRetiroLaFlorida: true,
      cotizacionDespacho: cotizacionEnvio,
      resumenLogisticoParaCliente:
        `📍 **Retiro y Pago en Tienda:** Disponible de inmediato en **Enrique Olivares 224, La Florida** (puedes pagar en mesón o en la web).\n` +
        `${textoTarifaDespacho}.`,
    };
  }

  if (todosSonSolupartsOPropio && algunoEsSoluparts) {
    const textoRetiroSoluparts =
      promesaSla.esLunesAViernes && promesaSla.antesDeLas1130
        ? `📍 **Retiro en Sucursal (Enrique Olivares 224, La Florida):** Si realizas tu compra en nuestro portal **antes de las 11:30 hrs**, puedes retirarlo **hoy mismo a partir de las 15:30 hrs (3:30 PM)** en **Enrique Olivares 224, La Florida** (si compras después de las 11:30 hrs, queda disponible para retiro mañana desde las 15:30 hrs).`
        : `📍 **Retiro en Sucursal (Enrique Olivares 224, La Florida):** Comprando en nuestro portal **facilrepuestos.cl**, tu pedido entra en el corte de antes de las 12:00 del siguiente día hábil y puedes retirarlo **a partir de las 15:30 hrs (3:30 PM) del día siguiente** en **Enrique Olivares 224, La Florida** (las compras antes de las 11:30 hrs se retiran el mismo día desde las 15:30 hrs).`;

    return {
      permitePagoPresencialLaFlorida: false,
      permiteRetiroLaFlorida: true,
      cotizacionDespacho: cotizacionEnvio,
      resumenLogisticoParaCliente:
        `${textoRetiroSoluparts}\n` +
        `${textoTarifaDespacho}.\n` +
        `🛒 **Compra online:** Se adquiere directamente desde el link del producto en **facilrepuestos.cl** (el pago presencial en La Florida aplica solo para stock local propio).`,
    };
  }

  return {
    permitePagoPresencialLaFlorida: false,
    permiteRetiroLaFlorida: false,
    cotizacionDespacho: cotizacionEnvio,
    resumenLogisticoParaCliente:
      `${textoTarifaDespacho}.\n` +
      `🛒 **Modalidad de compra:** Este repuesto se gestiona con **despacho calculado según dimensión en Santiago y Chile** comprándolo desde el link del producto en **facilrepuestos.cl** (no aplica pago presencial en sucursal La Florida).`,
  };
}
