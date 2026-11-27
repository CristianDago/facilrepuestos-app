/**
 * server/agents/agente4MesaYPublicadorTemporal.js
 *
 * AGENTE 4 — MESA DE ABASTECIMIENTO AUTOMÁTICA (TOP 3 PROVEEDORES) Y PUBLICADOR DE PRODUCTO TEMPORAL (TTL 4 HORAS)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Responsabilidades:
 *  1. Seleccionar el TOP 3 de proveedores compatibles de `proveedores` (`canalWspActivo === true`)
 *     cruzando Marca del Vehículo + Especialidad/Categoría + Cercanía geográfica / Tiempo de respuesta.
 *  2. Evaluar automáticamente las respuestas de los proveedores y elegir la MEJOR alternativa según lo que pidió el cliente.
 *  3. Buscar automáticamente una FOTO REFERENCIAL limpia (`resolverImagenEfectivaProducto`) y publicar el
 *     PRODUCTO TEMPORAL tanto en Firebase (`inventario`) como en WordPress (`POST /wp-json/wc/v3/products`)
 *     con vigencia de 4 HORAS (`ttlHoras: 4`, `expiraEn`).
 *  4. Enviar al cliente por WhatsApp (< 24h) el LINK DEL PRODUCTO EN LA TIENDA (`https://facilrepuestos.cl/?p=<wooId>`)
 *     (jamás un link de pago suelto) + valor de despacho calculado por el Agente 3.
 *  5. Ejecutar cada 15 minutos el Worker de Expiración para bajar de WordPress y Firebase los productos temporales
 *     de 4 horas que no fueron comprados.
 */

import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import { resolverImagenEfectivaProducto } from '../services/catalogoImagenesService.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';
import {
  publicarProductoTemporalEnWooCommerce,
  eliminarProductoDeWooCommerce,
  obtenerUrlBaseTiendaWoo,
} from '../services/woocommerceSync.js';
import { evaluarLogisticaYDespachoAgente3 } from './agente3LogisticaYProveedores.js';
import { obtenerConfiguracionAgentesIA } from './configAgentesService.js';

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'facilrepuestos-prod';
const GEMINI_MODEL_DEFAULT = process.env.GEMINI_AGENT_MODEL || 'gemini-4.0-neon';

const googleAuth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const TTL_PRODUCTO_TEMPORAL_HORAS = 4;

/**
 * Datos oficiales de facturación de nuestra empresa para entregar a proveedores de la Mesa de Abastecimiento
 * cuando cerramos la compra de un repuesto cotizado y solicitamos la emisión de factura para depositar.
 */
export const DATOS_FACTURACION_EMCY_GROUP = {
  razonSocial: 'EMCY GROUP SPA',
  direccion: 'Enrique Olivares 224, La florida. Santiago de Chile.',
  rut: '78298093-9',
  descripcionActividad: 'Venta de partes, piezas y Accesorios para vehiculos automotores',
  contacto: 'admin@facilrepuestos.cl',
  bloqueTextoWhatsapp:
    `📄 *Datos para emisión de factura:*\n` +
    `Nombre o razón social: EMCY GROUP SPA\n` +
    `Dirección: Enrique Olivares 224, La florida. Santiago de Chile.\n` +
    `RUT: 78298093-9\n` +
    `Descripción de Act: Venta de partes, piezas y Accesorios para vehiculos automotores\n` +
    `Contacto: admin@facilrepuestos.cl`,
};

/**
 * Detecta si un proveedor en la Mesa de Abastecimiento está pidiendo los datos de nuestra empresa
 * para emitir la factura (RUT, razón social, giro, dirección, correo de facturación, etc.).
 */
export function esPreguntaDatosFacturacionProveedor(texto = '') {
  const limpio = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!limpio) return false;
  return /\b(datos\s+(?:de\s+|para\s+)?(?:la\s+)?factur|rut\b|razon\s+social|a\s+nombre\s+de\s+quien|giro\b|datos\s+de\s+(?:la\s+|tu\s+|su\s+)?empresa|para\s+(?:hacer(?:te|les)?|emitir(?:te|les)?)\s+la\s+factura|mandame\s+(?:el\s+rut|los\s+datos)|enviame\s+(?:el\s+rut|los\s+datos)|pasame\s+(?:el\s+rut|los\s+datos)|cual\s+es\s+(?:el\s+|tu\s+|su\s+)?rut|correo\s+para\s+(?:la\s+)?factura|a\s+que\s+rut\s+factur)\b/i.test(
    limpio
  );
}

/**
 * Construye el mensaje de WhatsApp con los datos oficiales de facturación de EMCY GROUP SPA.
 */
export function construirMensajeDatosFacturacionProveedor() {
  return (
    `¡Claro estimado! Aquí tienes los datos de nuestra empresa para emitir la factura:\n\n` +
    `${DATOS_FACTURACION_EMCY_GROUP.bloqueTextoWhatsapp}\n\n` +
    `Apenas tengas emitida la factura, compártenosla por aquí junto con los datos de transferencia para realizar el depósito de inmediato.`
  );
}

/**
 * Ejecuta el protocolo de cierre de compra con el proveedor de la Mesa de Abastecimiento cuando
 * vendemos un producto que él nos cotizó:
 *  1) Si ha pasado MÁS DE 1 HORA (> 60 min) desde que el proveedor envió su cotización:
 *     primero le pregunta si aún lo tiene disponible en stock.
 *  2) Si ha pasado 1 HORA O MENOS (<= 60 min):
 *     le confirma la compra directamente y le pide que haga la factura para poder depositar
 *     (y si pide los datos de la empresa, le entrega los datos de EMCY GROUP SPA).
 */
export async function iniciarCierreCompraConProveedorMesaWsp({
  solicitud,
  ofertaGanadora = null,
  ahoraMs = Date.now(),
  enviarMensajeMesaFn = null,
}) {
  if (!solicitud) return null;

  const ofertas = Array.isArray(solicitud.ofertasRecibidas) ? solicitud.ofertasRecibidas : [];
  const oferta =
    ofertaGanadora ||
    ofertas.find((o) => o.id === solicitud.ofertaGanadoraId) ||
    ofertas.find((o) => o.ganadora === true) ||
    elegirMejorOfertaMesaWsp(ofertas);

  if (!oferta) return null;

  const contactoMatch = (solicitud.proveedoresContactados || []).find(
    (c) => c.proveedorId === oferta.proveedorId || (c.telefono && c.telefono === oferta.telefonoProveedor)
  );
  const telefonoProveedor = String(
    oferta.telefonoProveedor || contactoMatch?.telefono || ''
  ).trim();

  const tsRef =
    Date.parse(
      oferta.recibidoEn ||
        oferta.respondidoEn ||
        contactoMatch?.respondidoEn ||
        solicitud.adjudicadaEn ||
        solicitud.updatedAt ||
        solicitud.createdAt ||
        ''
    ) || 0;

  const minutosTranscurridos =
    tsRef > 0 ? Math.max(0, Math.round((ahoraMs - tsRef) / 60000)) : 0;
  const pasoMasDeUnaHora = minutosTranscurridos > 60;

  const vehiculoTxt = [
    solicitud.marcaVehiculo,
    solicitud.modeloVehiculo,
    solicitud.anioVehiculo,
  ]
    .filter(Boolean)
    .join(' ');
  const repuestoTxt = solicitud.repuestoBuscado || 'repuesto';
  const precioNetoStr =
    Number(oferta.precioCostoNeto) > 0
      ? ` ($${Math.round(Number(oferta.precioCostoNeto)).toLocaleString('es-CL')} + IVA)`
      : '';

  const nowIso = new Date(ahoraMs).toISOString();
  let textoMensajeProveedor = '';
  let nuevoEstadoCompra = '';

  if (pasoMasDeUnaHora) {
    nuevoEstadoCompra = 'esperando_reconfirmacion_stock_1h';
    textoMensajeProveedor =
      `Hola estimado, necesito comprar el *${repuestoTxt}*${vehiculoTxt ? ` para *${vehiculoTxt}*` : ''} que me cotizaste${precioNetoStr}. ` +
      `Confírmame por favor para depositarte que aún está disponible y envíame los datos.`;
  } else {
    nuevoEstadoCompra = 'esperando_factura_para_deposito';
    textoMensajeProveedor =
      `Hola estimado, necesito comprar el *${repuestoTxt}*${vehiculoTxt ? ` para *${vehiculoTxt}*` : ''} que me cotizaste${precioNetoStr}. ` +
      `Por favor haznos la factura y confírmanos la cuenta para transferencia o link de pago para depositarte:\n\n` +
      `${DATOS_FACTURACION_EMCY_GROUP.bloqueTextoWhatsapp}`;
  }

  const updatePayload = {
    estadoCompraProveedor: nuevoEstadoCompra,
    minutosDesdeCotizacionAlVender: minutosTranscurridos,
    pasoMasDeUnaHoraAlVender: pasoMasDeUnaHora,
    telefonoProveedorGanador: telefonoProveedor,
    proveedorGanadorId: oferta.proveedorId || null,
    proveedorGanadorNombre: oferta.proveedorNombre || null,
    ultimoMensajeCompraProveedor: textoMensajeProveedor,
    cierreCompraIniciadoEn: nowIso,
    updatedAt: nowIso,
  };

  if (solicitud.id) {
    await db
      .collection('solicitudes_cotizacion_wsp')
      .doc(solicitud.id)
      .update(updatePayload)
      .catch(() => null);
  }

  let envioWsp = null;
  if (typeof enviarMensajeMesaFn === 'function' && telefonoProveedor) {
    envioWsp = await enviarMensajeMesaFn({
      telefonoDestino: telefonoProveedor,
      texto: textoMensajeProveedor,
    }).catch(() => null);
  }

  return {
    solicitudId: solicitud.id || null,
    telefonoProveedor,
    minutosTranscurridos,
    pasoMasDeUnaHora,
    estadoCompraProveedor: nuevoEstadoCompra,
    textoMensajeProveedor,
    envioWsp,
  };
}

/**
 * Procesa los mensajes entrantes del proveedor en la Mesa de Abastecimiento (+56 9 5096 0294)
 * posteriores al inicio del cierre de compra:
 *  - Si estábamos en `esperando_reconfirmacion_stock_1h` y el proveedor confirma que sí lo tiene ->
 *    le pide que haga la factura para poder depositar (y si ya pidió datos de facturación, se los adjunta).
 *  - Si el proveedor pregunta en cualquier momento por los datos de facturación / RUT / razón social ->
 *    le envía los datos oficiales de EMCY GROUP SPA (RUT 78298093-9).
 */
export async function procesarMensajePostventaProveedorMesaWsp({
  solicitud = null,
  textoEntrante = '',
  remitenteTel = '',
  enviarMensajeMesaFn = null,
  esSinStock = false,
}) {
  const texto = String(textoEntrante || '').trim();
  if (!texto) return { procesado: false };

  const pideDatosFactura = esPreguntaDatosFacturacionProveedor(texto);
  const estadoCompra = solicitud?.estadoCompraProveedor || '';
  const nowIso = new Date().toISOString();

  // Caso 1: Estábamos esperando reconfirmación porque había pasado > 1 hora desde la cotización
  if (estadoCompra === 'esperando_reconfirmacion_stock_1h') {
    if (esSinStock) {
      const msgSinStockPost =
        'Muchas gracias por avisar estimado, quedamos atentos para una próxima oportunidad.';
      if (solicitud?.id) {
        await db
          .collection('solicitudes_cotizacion_wsp')
          .doc(solicitud.id)
          .update({
            estadoCompraProveedor: 'sin_stock_post_1h',
            ultimoMensajeCompraProveedor: msgSinStockPost,
            updatedAt: nowIso,
          })
          .catch(() => null);
      }
      if (typeof enviarMensajeMesaFn === 'function' && remitenteTel) {
        await enviarMensajeMesaFn({ telefonoDestino: remitenteTel, texto: msgSinStockPost }).catch(
          () => null
        );
      }
      return {
        procesado: true,
        accion: 'proveedor_sin_stock_post_1h',
        estadoCompraProveedor: 'sin_stock_post_1h',
        respuestaEnviada: msgSinStockPost,
      };
    }

    // El proveedor confirmó que sí lo tiene disponible después de > 1 hora -> enviar datos de factura y pedir cuenta para transferencia o link de pago
    const msgPedirFactura =
      `Perfecto estimado, haznos la factura por favor y confírmanos la cuenta para transferencia o link de pago para depositarte:\n\n` +
      `${DATOS_FACTURACION_EMCY_GROUP.bloqueTextoWhatsapp}`;

    const nuevoEstado = 'datos_facturacion_enviados';

    if (solicitud?.id) {
      await db
        .collection('solicitudes_cotizacion_wsp')
        .doc(solicitud.id)
        .update({
          estadoCompraProveedor: nuevoEstado,
          stockReconfirmadoPost1hEn: nowIso,
          ultimoMensajeCompraProveedor: msgPedirFactura,
          updatedAt: nowIso,
        })
        .catch(() => null);
    }

    if (typeof enviarMensajeMesaFn === 'function' && remitenteTel) {
      await enviarMensajeMesaFn({ telefonoDestino: remitenteTel, texto: msgPedirFactura }).catch(
        () => null
      );
    }

    return {
      procesado: true,
      accion: 'reconfirmado_1h_solicitar_factura_para_deposito',
      estadoCompraProveedor: nuevoEstado,
      respuestaEnviada: msgPedirFactura,
    };
  }

  // Caso 2: El proveedor pide los datos de facturación / RUT / razón social de nuestra empresa
  if (pideDatosFactura) {
    const msgDatos = construirMensajeDatosFacturacionProveedor();
    if (solicitud?.id) {
      await db
        .collection('solicitudes_cotizacion_wsp')
        .doc(solicitud.id)
        .update({
          estadoCompraProveedor: 'datos_facturacion_enviados',
          datosFacturacionEnviadosEn: nowIso,
          ultimoMensajeCompraProveedor: msgDatos,
          updatedAt: nowIso,
        })
        .catch(() => null);
    }
    if (typeof enviarMensajeMesaFn === 'function' && remitenteTel) {
      await enviarMensajeMesaFn({ telefonoDestino: remitenteTel, texto: msgDatos }).catch(() => null);
    }
    return {
      procesado: true,
      accion: 'envio_datos_facturacion_emcy_group',
      estadoCompraProveedor: 'datos_facturacion_enviados',
      respuestaEnviada: msgDatos,
    };
  }

  return { procesado: false };
}

const SECTORES_CERCANIA_SCORE = [
  { regex: /\b(la\s+florida|macul|puente\s+alto|pe[ñn]alolen|san\s+joaquin)\b/i, score: 15 },
  { regex: /\b(10\s+de\s+julio|diez\s+de\s+julio|lira|santiago\s+centro|san\s+miguel|gran\s+avenida|ñuñoa|nunoa)\b/i, score: 12 },
  { regex: /\b(estacion\s+central|quinta\s+normal|recoleta|independencia|cerrillos|maipu|san\s+bernardo)\b/i, score: 8 },
];

/**
 * Selecciona el TOP 3 de proveedores de WhatsApp según Marca del Vehículo, Categoría de Repuesto y Cercanía.
 */
export function seleccionarTop3ProveedoresMesaWsp({
  proveedores = [],
  marcaVehiculo = '',
  categoriaRepuesto = '',
  comunaCliente = '',
}) {
  const marcaUpper = String(marcaVehiculo || '').trim().toUpperCase();
  const catUpper = String(categoriaRepuesto || '').trim().toUpperCase();
  const comunaLower = String(comunaCliente || '').trim().toLowerCase();

  const puntuados = proveedores
    .filter((p) => p && p.activo !== false && p.canalWspActivo === true && p.telefono)
    .map((p) => {
      let score = 0;
      const marcasProv = (p.marcas || p.marcasVehiculo || p.marcasEspecialidad || []).map((m) =>
        String(m).trim().toUpperCase()
      );
      const catsProv = [
        p.categoria,
        ...(Array.isArray(p.categoriasEspecialidad) ? p.categoriasEspecialidad : []),
      ]
        .filter(Boolean)
        .map((c) => String(c).trim().toUpperCase());

      // 1. Coincidencia de Marca de Vehículo (+35 pts; multimarca +10 pts)
      if (marcaUpper && marcasProv.includes(marcaUpper)) {
        score += 35;
      } else if (marcasProv.includes('MULTIMARCA') || marcasProv.length === 0) {
        score += 10;
      }

      // 2. Coincidencia de Categoría de Repuesto (+25 pts)
      if (catUpper && catUpper !== 'GENERAL' && catsProv.some((c) => c.includes(catUpper) || catUpper.includes(c))) {
        score += 25;
      } else if (catsProv.includes('GENERAL') || catsProv.length === 0) {
        score += 8;
      }

      // 3. Cercanía geográfica (Anillos de abastecimiento + cercanía a comuna del cliente)
      const dirTexto = `${p.direccion || ''} ${p.comuna || ''} ${p.notas || ''}`;
      for (const sec of SECTORES_CERCANIA_SCORE) {
        if (sec.regex.test(dirTexto)) {
          score += sec.score;
          break;
        }
      }
      if (comunaLower && dirTexto.toLowerCase().includes(comunaLower)) {
        score += 12;
      }

      // 4. Velocidad histórica de respuesta
      const minResp = Number(p.tiempoRespuestaPromMin) || 10;
      score += Math.max(0, 15 - Math.min(15, minResp));

      return { proveedor: p, score };
    })
    .sort((a, b) => b.score - a.score);

  return puntuados.slice(0, 3).map((x) => x.proveedor);
}

/**
 * Elige automáticamente la mejor oferta recibida en una solicitud de Mesa de Abastecimiento
 * según stock disponible, disponibilidad inmediata/urgencia, calidad (OEM/marca reconocida) y mejor precio.
 */
export function elegirMejorOfertaMesaWsp(ofertas = []) {
  const validas = (Array.isArray(ofertas) ? ofertas : []).filter(
    (o) => o && o.tieneStock && Number(o.precioCostoNeto) > 0
  );
  if (validas.length === 0) return null;

  const puntuadas = validas.map((o) => {
    let score = 0;
    const disp = String(o.disponibilidad || '').toLowerCase();
    if (disp.includes('inmediata') || disp.includes('mesón') || disp.includes('meson')) score += 30;
    else if (disp.includes('hoy')) score += 20;
    else if (disp.includes('24')) score += 10;

    if (o.origen === 'ORIGINAL OEM' || o.fabricante !== 'ALTERNATIVO') score += 15;
    if (o.fotoUrl) score += 10;

    return { oferta: o, score, precio: Number(o.precioCostoNeto) };
  });

  puntuadas.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.precio - b.precio;
  });

  return puntuadas[0].oferta;
}

/**
 * Crea el Producto Temporal (TTL 4 horas) en Firebase `inventario` y en WordPress (`facilrepuestos.cl`),
 * le asigna una foto referencial limpia y devuelve el link directo del producto en la tienda.
 */
export async function crearYPublicarProductoTemporalMesaWsp({
  solicitud,
  ofertaGanadora,
  ttlHoras = TTL_PRODUCTO_TEMPORAL_HORAS,
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiraEnIso = new Date(now.getTime() + ttlHoras * 60 * 60 * 1000).toISOString();

  const codigoBase =
    solicitud.codigoReferencia?.split('/')[0]?.trim() ||
    `${String(solicitud.marcaVehiculo || 'REP').slice(0, 3)}-${String(solicitud.codigoSolicitud || '').replace('WSP-', '')}`;
  const codigoLimpio = codigoBase.replace(/[^A-Z0-9-]/gi, '').toUpperCase() || solicitud.codigoSolicitud;
  const skuPublicoFrp = `FRP-WSP-${codigoLimpio}`;
  const docInvId = `wsp_temp_${String(solicitud.codigoSolicitud || Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  const categoriaUpper = String(solicitud.categoriaRepuesto || 'MOTOR').toUpperCase();
  const marcaUpper = String(solicitud.marcaVehiculo || '').toUpperCase();
  const modeloUpper = String(solicitud.modeloVehiculo || '').toUpperCase();
  const vehiculoTxt = [
    solicitud.marcaVehiculo,
    solicitud.modeloVehiculo,
    solicitud.anioVehiculo,
    solicitud.motorVehiculo,
  ]
    .filter(Boolean)
    .join(' ');

  // 1. Resolver foto referencial limpia (foto enviada por el proveedor o foto maestra de subcategoría con media_id nativo)
  const itemBorradorParaImagen = {
    nombre: `${solicitud.repuestoBuscado} para ${vehiculoTxt}`.trim().toUpperCase(),
    categoria: categoriaUpper,
    tipoPieza: solicitud.repuestoBuscado,
    imagenUrl: ofertaGanadora.fotoUrl || '',
  };
  const imgRef = resolverImagenEfectivaProducto(itemBorradorParaImagen);

  const itemPayload = {
    nombre: `${solicitud.repuestoBuscado} ${ofertaGanadora.fabricante !== 'ALTERNATIVO' ? ofertaGanadora.fabricante : ''} para ${vehiculoTxt}`
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase(),
    codigo: codigoLimpio,
    skuPublicoFrp,
    fabricante: ofertaGanadora.fabricante || 'ALTERNATIVO',
    origen: ofertaGanadora.origen || 'IMPORTACIÓN',
    descripcion: `Cotización verificada para ${vehiculoTxt}. Producto habilitado temporalmente por ${ttlHoras} horas sujeto a confirmación de compra en facilrepuestos.cl. Modalidad de entrega: Despacho a domicilio.`,
    equivalencias: solicitud.codigoReferencia
      ? [{ fabricante: ofertaGanadora.fabricante || 'OEM', codigo: solicitud.codigoReferencia }]
      : [],
    categoria: categoriaUpper,
    proveedor: ofertaGanadora.proveedorNombre,
    proveedorId: ofertaGanadora.proveedorId,
    origenDatos: 'mesa_whatsapp_vivo',
    esProductoTemporalWsp: true,
    estadoTemporal: 'activo_temporal',
    ttlHoras,
    expiraEn: expiraEnIso,
    compradoEnTienda: false,
    solicitudWspId: solicitud.id || null,
    codigoSolicitudWsp: solicitud.codigoSolicitud || null,
    tipoPieza: solicitud.repuestoBuscado,
    posicion: 'NO APLICA',
    lado: 'NO APLICA',
    marcasCompatibles: marcaUpper && marcaUpper !== 'POR CONFIRMAR' ? [marcaUpper] : [],
    modelosCompatibles:
      marcaUpper && modeloUpper ? { [marcaUpper]: [modeloUpper] } : {},
    anioDesde: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) : null,
    anioHasta: solicitud.anioVehiculo ? Number(solicitud.anioVehiculo) : null,
    precioImportacion: 0,
    precioLista: ofertaGanadora.precioCostoNeto,
    descuentoTaller: 0,
    precioCompra: ofertaGanadora.precioCostoNeto,
    precioVenta: ofertaGanadora.precioVentaFrpNeto,
    margenAplicadoPct: ofertaGanadora.margenAplicadoPct,
    stock: 1,
    stockReservado: 0,
    stockMinimo: 1,
    unidad: 'unidad',
    imagenUrl: imgRef.url,
    wooMediaId: imgRef.wooMediaId || null,
    origenImagen: imgRef.origenImagen || 'foto_referencial_subcategoria',
    ocultarEnTienda: false,
    needsWooSync: false,
    wooSyncMotivo: 'producto_temporal_mesa_wsp',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  itemPayload.deltaHash = calcularHashCatalogoItem(itemPayload);

  // 2. Publicar inmediatamente en WordPress/WooCommerce para obtener el link real de la tienda
  const pubWoo = await publicarProductoTemporalEnWooCommerce(docInvId, itemPayload);
  itemPayload.wooProductId = pubWoo.wooProductId || null;
  itemPayload.urlProductoTienda = pubWoo.urlProductoTienda;

  await db.collection('inventario').doc(docInvId).set(itemPayload, { merge: true });

  // 3. Calcular despacho con Agente 3 (100% con despacho + link de la tienda, sin link de pago suelto)
  const logistica = evaluarLogisticaYDespachoAgente3({
    items: [itemPayload],
    comunaCliente: solicitud.comunaCliente || null,
  });

  const precioIva = Math.round(Number(ofertaGanadora.precioVentaFrpConIva || ofertaGanadora.precioVentaFrpNeto * 1.19));
  const baseUrl = obtenerUrlBaseTiendaWoo();
  const linkTiendaProducto = pubWoo.urlProductoTienda || `${baseUrl}/?s=${encodeURIComponent(skuPublicoFrp)}&post_type=product`;

  const nombrePiezaLimpio = String(itemPayload.nombre || '').split(/\s+PARA\s+/i)[0].trim() || itemPayload.nombre;
  const mensajeClienteWsp =
    `✅ ¡Encontramos tu repuesto compatible con tu **${vehiculoTxt}**!\n\n` +
    `• **${nombrePiezaLimpio}** (\`${skuPublicoFrp}\`) — **$${precioIva.toLocaleString('es-CL')} IVA inc.**\n` +
    `👉 Ver producto y comprar en tienda: ${linkTiendaProducto}\n\n` +
    `⏱️ *Lo habilitamos especialmente para ti en la web por **${ttlHoras} horas**. ¿A qué comuna o ciudad necesitas el despacho para darte el valor exacto de envío?*`;

  return {
    inventarioId: docInvId,
    skuPublicoFrp,
    wooProductId: pubWoo.wooProductId,
    urlProductoTienda: linkTiendaProducto,
    expiraEn: expiraEnIso,
    ttlHoras,
    itemPublicado: { id: docInvId, ...itemPayload },
    mensajeClienteWsp,
  };
}

/**
 * Worker de limpieza automática (TTL Cleaner):
 * Despublica y elimina de WordPress/WooCommerce los productos temporales de la Mesa WSP
 * cuyas 4 horas de validez (`expiraEn`) ya expiraron sin haber sido comprados.
 */
export async function limpiarProductosTemporalesExpirados() {
  try {
    const snap = await db
      .collection('inventario')
      .where('esProductoTemporalWsp', '==', true)
      .get();
    if (snap.empty) return { revisados: 0, expiradosEliminados: 0 };

    const ahoraIso = new Date().toISOString();
    let expiradosEliminados = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (data.estadoTemporal === 'expirado_4h' || data.compradoEnTienda === true) {
        continue;
      }
      if (data.expiraEn && String(data.expiraEn) <= ahoraIso) {
        await eliminarProductoDeWooCommerce(doc.id, data).catch(() => null);
        await doc.ref.update({
          ocultarEnTienda: true,
          stock: 0,
          wooProductId: null,
          estadoTemporal: 'expirado_4h',
          expiradoEn: ahoraIso,
          updatedAt: ahoraIso,
        });
        expiradosEliminados++;
      }
    }

    return { revisados: snap.size, expiradosEliminados };
  } catch (err) {
    console.warn('[Agente4 TTL Cleaner] Aviso limpiando productos temporales:', err.message);
    return { revisados: 0, expiradosEliminados: 0 };
  }
}

/**
 * Descarga un archivo multimedia (audio de voz, imagen de caja/repuesto o documento) desde Meta Cloud API
 * usando su `mediaId` y lo devuelve en `base64` listo para ser analizado por Gemini Multimodal (Vertex AI).
 */
export async function descargarMediaMetaWhatsapp({
  mediaId = '',
  accessToken = '',
  graphVersion = 'v21.0',
}) {
  const idLimpio = String(mediaId || '').trim();
  const tokenLimpio = String(accessToken || '').trim();
  if (!idLimpio || !tokenLimpio) return null;

  try {
    const metaResp = await fetch(`https://graph.facebook.com/${graphVersion}/${idLimpio}`, {
      headers: { Authorization: `Bearer ${tokenLimpio}` },
    });
    if (!metaResp.ok) return null;
    const metaData = await metaResp.json();
    const downloadUrl = metaData?.url;
    const mimeType = metaData?.mime_type || 'application/octet-stream';
    if (!downloadUrl) return null;

    const binResp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${tokenLimpio}` },
    });
    if (!binResp.ok) return null;

    const arrayBuffer = await binResp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return {
      mediaId: idLimpio,
      mimeType,
      base64,
      dataUri: `data:${mimeType};base64,${base64}`,
    };
  } catch (err) {
    console.warn('[Agente4 Multimodal] Aviso descargando media de Meta:', err.message);
    return null;
  }
}

/**
 * Extrae `{ mimeType, base64 }` desde un Data URL (`data:image/jpeg;base64,...`) o descarga desde una URL HTTPS.
 */
async function resolverMediaBase64DesdeEntrada({
  base64Directo = '',
  mimeTypeDirecto = '',
  dataUrlOrHttpUrl = '',
  defaultMime = 'image/jpeg',
}) {
  if (base64Directo) {
    return {
      base64: String(base64Directo).replace(/^data:[^;]+;base64,/i, '').trim(),
      mimeType: mimeTypeDirecto || defaultMime,
    };
  }
  const raw = String(dataUrlOrHttpUrl || '').trim();
  if (!raw) return null;

  const matchData = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (matchData) {
    return {
      mimeType: matchData[1] || defaultMime,
      base64: matchData[2].trim(),
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 5500);
      const r = await fetch(raw, { signal: controller.signal });
      clearTimeout(tId);
      if (!r.ok) return null;
      const cType = r.headers.get('content-type') || defaultMime;
      const ab = await r.arrayBuffer();
      return {
        mimeType: cType.split(';')[0].trim() || defaultMime,
        base64: Buffer.from(ab).toString('base64'),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Analiza con Gemini Multimodal (Vertex AI) la respuesta enviada por un proveedor en la Mesa de Abastecimiento:
 *  - Escucha notas de voz / audios (`audio/ogg`, `audio/mpeg`, `audio/mp4`, `audio/wav`) y los transcribe íntegramente.
 *  - Lee fotografías (`image/jpeg`, `image/png`, `image/webp`) de cajas de repuestos, etiquetas OEM, piezas en mesón
 *    o capturas de pantalla del sistema ERP del proveedor.
 *  - Detecta con precisión si el proveedor NO TIENE el repuesto (`tieneStock: false`) o SI LO TIENE (`tieneStock: true`).
 *  - Genera un Resumen Formal Ejecutivo (`resumenFormalIa`) de lo informado por el proveedor.
 */
export async function analizarRespuestaMultimodalProveedorAgente4({
  mensajeTexto = '',
  transcripcionAudioManual = '',
  audioBase64 = '',
  audioMimeType = 'audio/ogg',
  audioDataUrl = '',
  imagenBase64 = '',
  imagenMimeType = 'image/jpeg',
  imagenUrl = '',
  repuestoBuscado = '',
  vehiculoStr = '',
  proveedorNombre = 'Proveedor',
}) {
  const mediaAudio = await resolverMediaBase64DesdeEntrada({
    base64Directo: audioBase64,
    mimeTypeDirecto: audioMimeType,
    dataUrlOrHttpUrl: audioDataUrl,
    defaultMime: 'audio/ogg',
  });

  const mediaImagen = await resolverMediaBase64DesdeEntrada({
    base64Directo: imagenBase64,
    mimeTypeDirecto: imagenMimeType,
    dataUrlOrHttpUrl: imagenUrl,
    defaultMime: 'image/jpeg',
  });

  const tieneMultimedia = Boolean(mediaAudio?.base64 || mediaImagen?.base64);
  const textoCombinado = `${mensajeTexto || ''} ${transcripcionAudioManual || ''}`.trim();

  if (!tieneMultimedia && !textoCombinado) {
    return null;
  }

  try {
    const client = await googleAuth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) return null;

    const cfgAgentes = await obtenerConfiguracionAgentesIA().catch(() => null);
    const modeloPreferido =
      cfgAgentes?.agentes?.agente4_mesa_abastecimiento?.modelo ||
      cfgAgentes?.modeloGlobalPreferido ||
      GEMINI_MODEL_DEFAULT;

    const systemPrompt = `Eres el Agente 4 (Agente Cotizador de Abastecimiento B2B) de facilrepuestos.cl en Chile.
Tu misión es analizar la respuesta enviada por el proveedor "${proveedorNombre}" ante nuestra solicitud de cotización para:
- Repuesto consultado: ${repuestoBuscado || 'Repuesto automotriz'}
- Vehículo: ${vehiculoStr || 'Por confirmar'}

CAPACIDADES OBLIGATORIAS:
1. DETECCIÓN DE FALTA DE STOCK (SIN STOCK):
   - Debes identificar con 100% de precisión cuando el proveedor indica (por texto, audio o captura) que NO tiene el repuesto: ej. "no tengo", "no me queda", "agotado", "sin stock", "nada por acá", "no hay", "no trabajamos esa marca", "no me llegó", "se acabó", "paso", "negativo", "0 stock", o simplemente "no estimado".
   - En esos casos marca "tieneStock": false y explica en "motivoSinStock".
2. ESCUCHA Y TRANSCRIPCIÓN DE AUDIO:
   - Si se adjunta un audio de voz del proveedor, escúchalo completo y escribe su transcripción exacta en "transcripcionAudio".
3. LECTURA TÉCNICA DE IMÁGENES (VISIÓN IA):
   - Si se adjunta una imagen (foto de caja de repuesto, etiqueta con código OEM/SKU, pieza física en mesón o pantalla de sistema ERP), léela al detalle y describe en "lecturaImagenIa" la marca impresa, el origen/país de fabricación, el código OEM/fabricante visible (en "codigoOemDetectado"), el estado de la pieza y cualquier precio que aparezca en pantalla.
4. RESUMEN FORMAL EJECUTIVO ("resumenFormalIa"):
   - Redacta un resumen formal, profesional y estructurado en español de todo lo que envió el proveedor (integrando lo dicho en texto, audio e imagen), indicando claramente si tiene o no stock, marca/origen, código OEM detectado, precio neto/IVA y disponibilidad de retiro.

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta (sin bloques markdown):
{
  "tieneStock": true,
  "motivoSinStock": "",
  "transcripcionAudio": "",
  "lecturaImagenIa": "",
  "codigoOemDetectado": "",
  "precioCostoNeto": 0,
  "tieneIvaExplicito": false,
  "mencionaConIva": false,
  "fabricante": "",
  "origen": "",
  "disponibilidad": "",
  "resumenFormalIa": ""
}`;

    const userParts = [];
    if (mediaAudio?.base64) {
      userParts.push({
        inlineData: {
          mimeType: mediaAudio.mimeType || 'audio/ogg',
          data: mediaAudio.base64,
        },
      });
    }
    if (mediaImagen?.base64) {
      userParts.push({
        inlineData: {
          mimeType: mediaImagen.mimeType || 'image/jpeg',
          data: mediaImagen.base64,
        },
      });
    }
    userParts.push({
      text:
        `[Proveedor]: ${proveedorNombre}\n` +
        `[Repuesto Consultado]: ${repuestoBuscado} (${vehiculoStr})\n` +
        `[Mensaje de Texto del Proveedor]: ${mensajeTexto || '(sin texto adicional)'}\n` +
        (transcripcionAudioManual
          ? `[Transcripción Manual de Audio]: ${transcripcionAudioManual}\n`
          : '') +
        (imagenUrl && !mediaImagen?.base64 ? `[URL Imagen Adjunta]: ${imagenUrl}\n` : '') +
        `Analiza la respuesta del proveedor y devuelve el JSON estructurado.`,
    });

    const modelosIntento = Array.from(
      new Set([modeloPreferido, 'gemini-3.8-flash', 'gemini-2.5-flash'])
    );

    let resp = null;
    for (const modId of modelosIntento) {
      const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${modId}:generateContent`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const intento = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: userParts }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 650,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (intento.ok) {
          resp = intento;
          break;
        }
      } catch {
        clearTimeout(timeoutId);
      }
    }

    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    const rawText = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim();
    if (!rawText) return null;

    const jsonLimpio = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonLimpio);
    return {
      tieneStock: typeof parsed.tieneStock === 'boolean' ? parsed.tieneStock : null,
      motivoSinStock: String(parsed.motivoSinStock || '').trim(),
      transcripcionAudio: String(parsed.transcripcionAudio || transcripcionAudioManual || '').trim(),
      lecturaImagenIa: String(parsed.lecturaImagenIa || '').trim(),
      codigoOemDetectado: String(parsed.codigoOemDetectado || '').trim().toUpperCase(),
      precioCostoNeto: Number(parsed.precioCostoNeto) || 0,
      tieneIvaExplicito: Boolean(parsed.tieneIvaExplicito),
      mencionaConIva: Boolean(parsed.mencionaConIva),
      fabricante: String(parsed.fabricante || '').trim().toUpperCase(),
      origen: String(parsed.origen || '').trim().toUpperCase(),
      disponibilidad: String(parsed.disponibilidad || '').trim(),
      resumenFormalIa: String(parsed.resumenFormalIa || '').trim(),
    };
  } catch (err) {
    console.warn('[Agente4 Multimodal] Fallback a extractor determinístico:', err.message);
    return null;
  }
}

/**
 * Construye siempre un Resumen Formal Ejecutivo (`resumenFormalIa`) de la respuesta de un proveedor,
 * combinando texto, audio transcrito, lectura de imagen y estado de disponibilidad (Con Stock / Sin Stock / En Reconsulta).
 */
export function construirResumenFormalProveedorIa({
  proveedorNombre = 'Proveedor',
  repuestoBuscado = 'Repuesto',
  vehiculoStr = '',
  tieneStock = true,
  ofertaCompleta = false,
  precioCostoNeto = 0,
  precioVentaFrpNeto = 0,
  precioVentaFrpConIva = 0,
  margenPct = 30,
  fabricante = 'ALTERNATIVO',
  origen = 'IMPORTACIÓN',
  disponibilidad = 'Por confirmar retiro',
  codigoOemDetectado = '',
  mensajeOriginal = '',
  transcripcionAudio = '',
  lecturaImagenIa = '',
  faltantesCotizacion = [],
  resumenGemini = '',
}) {
  const vehLabel = vehiculoStr ? ` para ${vehiculoStr}` : '';
  const notasMultimodales = [];
  if (transcripcionAudio) {
    notasMultimodales.push(`🎙️ Audio transcrito: "${transcripcionAudio}"`);
  }
  if (lecturaImagenIa) {
    notasMultimodales.push(`📷 Lectura de imagen IA: ${lecturaImagenIa}`);
  }
  if (codigoOemDetectado) {
    notasMultimodales.push(`🔖 Código OEM/Ref leído: ${codigoOemDetectado}`);
  }
  const sufijoMultimodal = notasMultimodales.length > 0 ? ` | ${notasMultimodales.join(' · ')}` : '';

  if (!tieneStock) {
    const detalleNegativa =
      transcripcionAudio ||
      mensajeOriginal ||
      'El proveedor indica que no cuenta con unidades disponibles en bodega.';
    return (
      `📋 INFORME FORMAL PROVEEDOR (${proveedorNombre}): SIN STOCK DISPONIBLE para ${repuestoBuscado}${vehLabel}. ` +
      `Respuesta reportada: "${detalleNegativa}". Cotización descartada sin repreguntas.${sufijoMultimodal}`
    );
  }

  if (!ofertaCompleta || precioCostoNeto <= 0) {
    const faltantesTxt = (faltantesCotizacion || [])
      .map((f) =>
        f === 'precio'
          ? 'precio y condición de IVA'
          : f === 'iva'
          ? 'confirmación si es +IVA o IVA incluido'
          : f === 'marca_origen'
          ? 'marca u origen del repuesto'
          : 'plazo de disponibilidad para retiro'
      )
      .join(', ');
    return (
      `📋 INFORME FORMAL EN VALIDACIÓN (${proveedorNombre}): El proveedor indica disponibilidad para ${repuestoBuscado}${vehLabel}` +
      (precioCostoNeto > 0 ? ` (valor preliminar informado: $${precioCostoNeto.toLocaleString('es-CL')})` : '') +
      (fabricante && fabricante !== 'ALTERNATIVO' ? `, marca ${fabricante}` : '') +
      `, pendiente confirmar: ${faltantesTxt || 'datos comerciales'}.${sufijoMultimodal}`
    );
  }

  const baseResumen =
    `📋 RESUMEN FORMAL DE COTIZACIÓN (${proveedorNombre}): Dispone de ${repuestoBuscado}${vehLabel} · ` +
    `Marca/Fabricante: ${fabricante} (${origen})` +
    (codigoOemDetectado ? ` · Cód. OEM: ${codigoOemDetectado}` : '') +
    ` · Costo Proveedor: $${Math.round(precioCostoNeto).toLocaleString('es-CL')} neto (+IVA) · ` +
    `Precio Venta facilrepuestos.cl (+${margenPct}%): $${Math.round(precioVentaFrpNeto).toLocaleString('es-CL')} neto ($${Math.round(precioVentaFrpConIva).toLocaleString('es-CL')} IVA inc.) · ` +
    `Disponibilidad de retiro: ${disponibilidad}.${sufijoMultimodal}`;

  if (resumenGemini && resumenGemini.length > 25 && !resumenGemini.includes('📋')) {
    return `${baseResumen}\n💡 Síntesis IA: ${resumenGemini}`;
  }
  return baseResumen;
}

/**
 * Construye el Resumen Ejecutivo consolidado a nivel de Solicitud de la Mesa de Abastecimiento (`resumenFormalMesaIa`),
 * sintetizando cuántos proveedores respondieron con stock, cuántos informaron sin stock y cuál es la mejor opción.
 */
export function construirResumenEjecutivoSolicitudIa({
  codigoSolicitud = '',
  repuestoBuscado = '',
  vehiculoStr = '',
  proveedoresContactados = [],
  ofertasRecibidas = [],
}) {
  const totalContactados = Array.isArray(proveedoresContactados) ? proveedoresContactados.length : 0;
  const ofertasValidas = (Array.isArray(ofertasRecibidas) ? ofertasRecibidas : []).filter(
    (o) => o && o.tieneStock && Number(o.precioCostoNeto) > 0
  );
  const ofertasEnReconsulta = (Array.isArray(ofertasRecibidas) ? ofertasRecibidas : []).filter(
    (o) => o && o.tieneStock && (!o.ofertaCompleta || Number(o.precioCostoNeto) <= 0)
  );
  const sinStockList = (Array.isArray(ofertasRecibidas) ? ofertasRecibidas : []).filter(
    (o) => o && o.tieneStock === false
  );
  const respondidosIds = new Set(
    (Array.isArray(ofertasRecibidas) ? ofertasRecibidas : []).map((o) => o.proveedorId)
  );
  const pendientesCount = Math.max(0, totalContactados - respondidosIds.size);

  if (sinStockList.length > 0 && ofertasValidas.length === 0 && ofertasEnReconsulta.length === 0 && pendientesCount === 0) {
    const nombresSinStock = sinStockList.map((o) => o.proveedorNombre).join(', ');
    return `📊 RESUMEN EJECUTIVO MESA #${codigoSolicitud}: Los ${sinStockList.length} proveedor(es) consultado(s) (${nombresSinStock}) confirmaron NO TENER STOCK disponible para ${repuestoBuscado} (${vehiculoStr}).`;
  }

  const partes = [];
  if (ofertasValidas.length > 0) {
    const mejor = elegirMejorOfertaMesaWsp(ofertasValidas) || ofertasValidas[0];
    partes.push(
      `✅ ${ofertasValidas.length} con stock confirmado (Mejor opción: ${mejor.proveedorNombre} · ${mejor.fabricante} ${mejor.origen} a $${Math.round(mejor.precioCostoNeto).toLocaleString('es-CL')} neto · ${mejor.disponibilidad})`
    );
  }
  if (ofertasEnReconsulta.length > 0) {
    partes.push(
      `⏳ ${ofertasEnReconsulta.length} en validación de datos (${ofertasEnReconsulta.map((o) => o.proveedorNombre).join(', ')})`
    );
  }
  if (sinStockList.length > 0) {
    partes.push(
      `❌ ${sinStockList.length} sin stock (${sinStockList.map((o) => o.proveedorNombre).join(', ')})`
    );
  }
  if (pendientesCount > 0) {
    partes.push(`📨 ${pendientesCount} pendiente(s) de respuesta`);
  }

  return `📊 RESUMEN EJECUTIVO MESA #${codigoSolicitud} (${repuestoBuscado} · ${vehiculoStr}): ${partes.join(' · ')}.`;
}

// Ejecutar limpieza automática cada 15 minutos en segundo plano
const _ttlTimer = setInterval(() => {
  limpiarProductosTemporalesExpirados().catch(() => null);
}, 15 * 60 * 1000);
if (typeof _ttlTimer.unref === 'function') _ttlTimer.unref();
