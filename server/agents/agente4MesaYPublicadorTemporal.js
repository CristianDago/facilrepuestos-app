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

import { db } from '../config/firebase.js';
import { resolverImagenEfectivaProducto } from '../services/catalogoImagenesService.js';
import { calcularHashCatalogoItem } from '../services/ailooCatalogSync.js';
import {
  publicarProductoTemporalEnWooCommerce,
  eliminarProductoDeWooCommerce,
  obtenerUrlBaseTiendaWoo,
} from '../services/woocommerceSync.js';
import { evaluarLogisticaYDespachoAgente3 } from './agente3LogisticaYProveedores.js';

const TTL_PRODUCTO_TEMPORAL_HORAS = 4;

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

  const mensajeClienteWsp =
    `✅ ¡Encontramos tu repuesto para tu **${vehiculoTxt}**!\n\n` +
    `• **${itemPayload.nombre}** (\`${skuPublicoFrp}\`) — **$${precioIva.toLocaleString('es-CL')} IVA inc.**\n` +
    `🔎 **Ver foto referencial y comprar en nuestra tienda web:**\n👉 ${linkTiendaProducto}\n\n` +
    `${logistica.resumenLogisticoParaCliente}\n\n` +
    `⏱️ *Importante: Subimos este producto especialmente para ti y estará disponible en la página por **${ttlHoras} horas** (ya que el stock y precio en bodega externa pueden variar pasado ese tiempo).*`;

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

// Ejecutar limpieza automática cada 15 minutos en segundo plano
const _ttlTimer = setInterval(() => {
  limpiarProductosTemporalesExpirados().catch(() => null);
}, 15 * 60 * 1000);
if (typeof _ttlTimer.unref === 'function') _ttlTimer.unref();
