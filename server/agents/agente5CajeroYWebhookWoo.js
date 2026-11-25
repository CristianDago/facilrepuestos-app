/**
 * server/agents/agente5CajeroYWebhookWoo.js
 *
 * AGENTE 5 — CAJERO Y CONCILIADOR DE COMPRAS EN WORDPRESS / TIENDA
 * ────────────────────────────────────────────────────────────────
 * Reglas inquebrantables:
 *  1. NUNCA enviamos links de pago sueltos: siempre enviamos el link del producto o del carro en la tienda
 *     `facilrepuestos.cl`.
 *  2. Los ÚNICOS productos que pueden pagarse presencialmente en Enrique Olivares 224, La Florida son los de
 *     Stock Local Propio (`bodega_olivares_224`). Todo lo demás se compra en la tienda web con Despacho.
 *  3. Cuando el cliente completa la compra en WordPress (`POST /api/woocommerce/webhook/pedido`),
 *     este agente valida el pago, protege cualquier producto temporal para que no expire y le envía
 *     automáticamente la confirmación por WhatsApp al cliente.
 */

import { db } from '../config/firebase.js';

/**
 * Procesa la confirmación de pago entrante desde el Webhook de WordPress/WooCommerce
 * y notifica automáticamente al cliente por WhatsApp.
 */
export async function confirmarPagoWordPressPorWhatsapp({
  pedidoWoo = {},
  itemsProcesados = [],
  enviarWhatsappFn,
}) {
  try {
    const numeroOrden = pedidoWoo.number || pedidoWoo.id;
    const telefonoBilling = String(pedidoWoo.billing?.phone || '').replace(/[^\d+]/g, '');
    const emailBilling = String(pedidoWoo.billing?.email || '').trim().toLowerCase();
    const nombreCliente = [pedidoWoo.billing?.first_name, pedidoWoo.billing?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Cliente';
    const comunaDestino = pedidoWoo.shipping?.city || pedidoWoo.billing?.city || 'tu dirección';
    const totalPagado = Math.round(Number(pedidoWoo.total || 0));

    // 1. Marcar como `compradoEnTienda: true` cualquier producto temporal para que el TTL cleaner no lo borre
    for (const it of itemsProcesados) {
      if (it.inventarioId) {
        await db
          .collection('inventario')
          .doc(it.inventarioId)
          .update({
            compradoEnTienda: true,
            estadoTemporal: 'comprado_confirmado',
            ultimaCompraWooId: String(numeroOrden),
          })
          .catch(() => null);
      }
    }

    // 2. Buscar sesión activa de WhatsApp por teléfono o por código de pedido
    let telefonoDestino = telefonoBilling;
    const snapSes = await db.collection('sesiones_agente_omnicanal').get();
    const ultimos8 = telefonoBilling.replace(/\D/g, '').slice(-8);

    const sesionMatch = snapSes.docs.find((d) => {
      const s = d.data() || {};
      const telSes = String(s.clienteTelefono || '').replace(/\D/g, '');
      if (ultimos8.length === 8 && telSes.endsWith(ultimos8)) return true;
      if (emailBilling && String(s.datosCliente?.email || '').toLowerCase() === emailBilling) return true;
      return false;
    });

    if (sesionMatch) {
      const sesData = sesionMatch.data() || {};
      if (!telefonoDestino && sesData.clienteTelefono) {
        telefonoDestino = sesData.clienteTelefono;
      }
    }

    const resumenLineas = (pedidoWoo.line_items || [])
      .map((li) => `• ${li.quantity || 1}x **${li.name || li.sku}**`)
      .join('\n');

    const textoConfirmacion =
      `✅ **¡Pago confirmado en facilrepuestos.cl!** (Orden **#${numeroOrden}**)\n\n` +
      `Hola ${nombreCliente.split(' ')[0]}, recibimos correctamente tu compra por **$${totalPagado.toLocaleString('es-CL')} IVA inc.**:\n` +
      `${resumenLineas}\n\n` +
      `🚚 **Coordinación de entrega (${comunaDestino}):** Nuestro equipo ya está preparando tu pedido y te avisaremos por este mismo WhatsApp apenas salga a despacho.`;

    if (sesionMatch) {
      const sesData = sesionMatch.data() || {};
      const mensajes = Array.isArray(sesData.mensajes) ? [...sesData.mensajes] : [];
      mensajes.push({
        id: `msg-woo-paid-${Date.now()}`,
        rol: 'agente',
        autor: 'Repuestín · facilrepuestos.cl',
        texto: textoConfirmacion,
        creadoEn: new Date().toISOString(),
        origen: 'confirmacion_pago_wordpress',
      });
      await sesionMatch.ref.update({
        mensajes,
        flujoCompra: null,
        ultimoPedidoPagadoWoo: {
          ordenId: String(numeroOrden),
          totalConIva: totalPagado,
          pagadoEn: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    if (
      typeof enviarWhatsappFn === 'function' &&
      telefonoDestino &&
      /\d{8,15}/.test(telefonoDestino.replace(/\D/g, ''))
    ) {
      return await enviarWhatsappFn({
        telefonoDestino,
        texto: textoConfirmacion,
      });
    }
  } catch (err) {
    console.warn('[Agente5 Webhook Woo->WSP] Aviso al notificar pago de WordPress:', err.message);
  }
  return null;
}
