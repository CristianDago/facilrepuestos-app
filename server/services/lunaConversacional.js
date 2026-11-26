/**
 * server/services/lunaConversacional.js
 *
 * CEREBRO CONVERSACIONAL DE REPUESTÍN (BASADO EN LUNA DE SOLUPARTS + MEJORAS FÁCILREPUESTOS 2.0)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Integra la lógica probada en producción de `soluparts-agent` (`web.py`, `flujo_compra.py`,
 * `confirmacion.py`, `precio.py` e `instrucciones.txt`) con la arquitectura de 2 Agentes de FácilRepuestos:
 *
 *  1. Clasificador estricto de intención antes de tocar inventario o disparar el Agente Interno (#WSP / ESC):
 *     - Prohibido abrir tickets en Mesa WSP o Escalamiento cuando el cliente solo saluda ("Hola"),
 *       hace preguntas de tienda/horarios, o aún no ha indicado AMBOS datos: Vehículo + Repuesto.
 *     - Memoria de turno: si el cliente pide "Pastillas de freno" sin dar auto, recuerda el repuesto
 *       en `repuestoPendienteContexto` y pide la patente/auto; cuando el cliente da la patente en el
 *       turno siguiente, cruza ambos automáticamente.
 *  2. Flujo de Compra Determinístico paso a paso (`flujoCompra` en sesión, portado de `flujo_compra.py`):
 *     - COMPRAR -> Modalidad (Retiro en La Florida vs Despacho) -> Dirección (si es despacho)
 *       -> Boleta o Factura -> Nombre, RUT (validado con Módulo 11) y Correo -> Medio de pago -> Pedido FRP-PED-*.
 *     - Permite cambiar entre retiro y despacho en cualquier paso y pausa la compra si el cliente hace otra pregunta.
 *  3. Redacción Conversacional con Gemini (`gemini-3.8-flash` vía Vertex AI en `facilrepuestos-prod`)
 *     bajo las reglas de `instrucciones.txt` de Luna + verificador anti-alucinación de SKUs y precios (`precio.py`).
 */

import { google } from 'googleapis';
import {
  cotizarDespachoAnticipado,
  calcularPromesaRetiroYDespacho,
  NODOS_DESPACHO_DEFAULT,
} from './logisticaTarifarioService.js';
import { esItemStockPropioOlivares224 } from '../agents/agente2BuscadorErp.js';
import { obtenerConfiguracionAgentesIA } from '../agents/configAgentesService.js';

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'facilrepuestos-prod';
const GEMINI_MODEL = process.env.GEMINI_AGENT_MODEL || 'gemini-4.0-neon';

const googleAuth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// Diccionario de sustantivos reales de repuestos automotrices para distinguir si el cliente
// ya nombró una pieza real o si solo está saludando / conversando.
export const PALABRAS_CLAVE_PIEZAS_REALES = new Set([
  'PASTILLA', 'PASTILLAS', 'FRENO', 'FRENOS', 'DISCO', 'DISCOS', 'BALATA', 'BALATAS', 'CALIPER', 'TAMBOR', 'BOMBIN', 'PIOLA',
  'EMBRAGUE', 'KIT', 'PRENSA', 'VOLANTE', 'BIMASA', 'MONOMASA', 'RODAMIENTO', 'EMPUJE', 'HORQUILLA', 'ESCLAVO',
  'AMORTIGUADOR', 'AMORTIGUADORES', 'BANDEJA', 'BANDEJAS', 'ROTULA', 'ROTULAS', 'BIELETA', 'BIELETAS', 'CAZOLETA', 'CAZOLETAS',
  'ESPIRAL', 'ESPIRALES', 'CREMALLERA', 'TERMINAL', 'TERMINALES', 'AXIAL', 'AXIALES', 'MAZA', 'MAZAS', 'BUJE', 'BUJES', 'BARRA',
  'FILTRO', 'FILTROS', 'ACEITE', 'AIRE', 'COMBUSTIBLE', 'PETROLEO', 'BENCINA', 'CABINA', 'POLEN', 'DECANTADOR',
  'BOMBA', 'AGUA', 'TERMOSTATO', 'RADIADOR', 'ELECTROVENTILADOR', 'VENTILADOR', 'MANGUERA', 'DEPOSITO', 'TAPA',
  'DISTRIBUCION', 'CORREA', 'CADENA', 'TENSOR', 'POLEA', 'DAMPER',
  'CULATA', 'EMPAQUETADURA', 'EMPAQUETADURAS', 'VALVULA', 'VALVULAS', 'PISTON', 'PISTONES', 'ANILLO', 'ANILLOS',
  'METALES', 'BIELA', 'BANCADA', 'CIGUENAL', 'LEVA', 'LEVAS', 'TAQUI', 'TAQUIS', 'RETEN', 'RETENES', 'CARTER',
  'TURBO', 'INTERCOOLER', 'INYECTOR', 'INYECTORES', 'CUERPO', 'ACELERACION', 'ADMISION', 'ESCAPE', 'MULTIPLE', 'EGR', 'DPF',
  'SOPORTE', 'SOPORTES', 'MOTOR', 'CAJA',
  'ALTERNADOR', 'PARTIDA', 'ARRANQUE', 'BUJIA', 'BUJIAS', 'BOBINA', 'BOBINAS', 'CABLE', 'CABLES',
  'SENSOR', 'TPS', 'CKP', 'CMP', 'MAP', 'MAF', 'OXIGENO', 'LAMBDA', 'TEMPERATURA', 'ABS', 'SONDA', 'FLUJO', 'FLUJOMETRO',
  'CINTA', 'AIRBAG', 'TELECOMANDO', 'ALZAVIDRIO', 'SWITCH', 'INTERRUPTOR', 'RELE', 'BATERIA',
  'HOMOCINETICA', 'TRIPOIDE', 'SEMIEJE', 'EJE', 'CARDAN', 'CRUCETA', 'DIFERENCIAL', 'SELECTORA',
  'OPTICO', 'OPTICOS', 'FOCO', 'FOCOS', 'FAROL', 'NEBLINERO', 'NEBLINEROS', 'PARACHOQUE', 'PARACHOQUES',
  'CAPOT', 'TAPABARRO', 'GUARDABARRO', 'ESPEJO', 'ESPEJOS', 'MASCARA', 'GRILLA', 'MANILLA', 'PORTALON', 'PARABRISA', 'PARABRISAS',
  'PLUMILLA', 'PLUMILLAS', 'COMPRESOR', 'CONDENSADOR', 'EVAPORADOR', ' CALEFACCION',
]);

const FRASES_CANCELAR = new Set([
  'cancelar', 'cancela', 'cancelalo', 'anular', 'anula', 'anulalo',
  'cancelar pedido', 'anular pedido', 'cancelar compra', 'anular compra',
  'cancelar el pedido', 'anular el pedido', 'ya no lo quiero', 'no lo quiero',
  'ya no', 'no gracias cancelar',
]);

/**
 * Devuelve el contexto de día, fecha, hora actual en Chile y si la sucursal está abierta o cerrada.
 */
export function obtenerContextoHoraChile() {
  const ahora = new Date();
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(ahora);

  const map = {};
  for (const p of partes) map[p.type] = p.value;
  const diaSemana = (map.weekday || '').toLowerCase();
  const hora = parseInt(map.hour || '12', 10);
  const minuto = parseInt(map.minute || '0', 10);
  const minutosDia = hora * 60 + minuto;

  // Horario FácilRepuestos: L-J 9:30 a 18:00, V 9:30 a 17:00, S 9:30 a 14:00, D cerrado
  let abierto = false;
  let cierreHoy = '';
  if (['lunes', 'martes', 'miércoles', 'miercoles', 'jueves'].includes(diaSemana)) {
    abierto = minutosDia >= 9 * 60 + 30 && minutosDia < 18 * 60;
    cierreHoy = '18:00';
  } else if (diaSemana === 'viernes') {
    abierto = minutosDia >= 9 * 60 + 30 && minutosDia < 17 * 60;
    cierreHoy = '17:00';
  } else if (['sábado', 'sabado'].includes(diaSemana)) {
    abierto = minutosDia >= 9 * 60 + 30 && minutosDia < 14 * 60;
    cierreHoy = '14:00';
  }

  const estadoTienda = abierto
    ? `La sucursal está ABIERTA en este momento (hoy cierra a las ${cierreHoy}).`
    : 'La sucursal está CERRADA en este momento (horario de atención: lunes a jueves 9:30 a 18:00, viernes 9:30 a 17:00 y sábados 9:30 a 14:00).';

  return {
    diaSemana,
    horaStr: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`,
    fechaStr: `${map.day}/${map.month}/${map.year}`,
    abierto,
    cierreHoy,
    lineaContextoSistema: `[Contexto del sistema: hoy es ${diaSemana} ${map.day}/${map.month}/${map.year} y son las ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')} en Chile. ${estadoTienda}]`,
  };
}

/**
 * Validación de RUT chileno con Módulo 11 (portado de `flujo_compra.py` de Soluparts).
 */
export function validarDvRutChileno(cuerpoStr, dvStr) {
  const cuerpo = String(cuerpoStr || '').replace(/\D/g, '');
  const dv = String(dvStr || '').trim().toUpperCase();
  if (!cuerpo || cuerpo.length < 7 || cuerpo.length > 8 || !dv) return false;

  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mult;
    mult = mult < 7 ? mult + 1 : 2;
  }
  const resto = 11 - (suma % 11);
  const calc = resto === 10 ? 'K' : resto === 11 ? '0' : String(resto);
  return calc === dv;
}

/**
 * Extrae Nombre, RUT (con Módulo 11) y Email desde un mensaje libre del cliente (portado de `flujo_compra.py`).
 */
export function extraerDatosClienteCompra(texto = '', faltan = ['nombre', 'rut', 'email']) {
  const hallado = {};
  const t = String(texto || '').trim();

  // 1. RUT chileno (con puntos o sin puntos, con guion o espacio)
  const reRut = /\b(\d{1,2}\.?\d{3}\.?\d{3})[\s-]*([\dkK])\b/;
  const mRut = t.match(reRut);
  let rutValidoDetectado = false;
  let rutInvalidoDetectado = false;
  if (mRut && faltan.includes('rut')) {
    const cuerpo = mRut[1].replace(/\./g, '');
    const dv = mRut[2].toUpperCase();
    if (validarDvRutChileno(cuerpo, dv)) {
      hallado.rut = `${cuerpo}-${dv}`;
      rutValidoDetectado = true;
    } else {
      rutInvalidoDetectado = true;
    }
  }

  // 2. Correo electrónico
  const reEmail = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
  const mEmail = t.match(reEmail);
  if (mEmail && faltan.includes('email')) {
    hallado.email = mEmail[0].toLowerCase();
  }

  // 3. Nombre completo (quitando el RUT y el email del texto)
  if (faltan.includes('nombre')) {
    const resto = t
      .replace(reEmail, ' ')
      .replace(reRut, ' ')
      .replace(/\b(boleta|factura|rut|nombre|correo|email|mi|es|soy|datos)\b/gi, ' ')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const palabras = resto.split(' ').filter((w) => w.length >= 2);
    if (palabras.length >= 2 && palabras.length <= 5) {
      hallado.nombre = palabras
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }

  return { hallado, rutValidoDetectado, rutInvalidoDetectado };
}

export function esMensajeCancelarPedido(texto = '') {
  const limpio = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return FRASES_CANCELAR.has(limpio);
}

/**
 * Verifica si los tokens extraídos contienen al menos un repuesto automotriz real o un código OEM/SKU.
 */
export function contieneRepuestoRealOCodigo(textoBruto = '', tokensRepuesto = []) {
  const upper = String(textoBruto || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // ¿Menciona un código OEM (ej. 13420-65D00, 0986..., FRP-...) o código de barras?
  if (/\b([A-Z0-9]{4,6}[-][A-Z0-9]{4,8}|FRP-[A-Z]{3}-[A-Z0-9-]+|\d{12,13})\b/.test(upper)) {
    return true;
  }

  for (const tok of tokensRepuesto) {
    const limpio = tok.replace(/[^A-Z0-9]/g, '');
    if (PALABRAS_CLAVE_PIEZAS_REALES.has(limpio)) {
      return true;
    }
    // Plurales simples (ej. TERMINALES -> TERMINAL, BUJES -> BUJE)
    if (limpio.endsWith('ES') && PALABRAS_CLAVE_PIEZAS_REALES.has(limpio.slice(0, -2))) {
      return true;
    }
    if (limpio.endsWith('S') && PALABRAS_CLAVE_PIEZAS_REALES.has(limpio.slice(0, -1))) {
      return true;
    }
  }

  return false;
}

/**
 * Clasifica la intención conversacional del mensaje en el contexto real de la sesión (Agente 1 NLU).
 * Distingue entre:
 *  - Búsqueda de un repuesto nuevo (`BUSQUEDA_CATALOGO`)
 *  - Pregunta sobre el producto YA cotizado en el carrito (`PREGUNTA_SOBRE_PRODUCTO_COTIZADO`, ej. "¿Es el par completo?", "¿Tienes más fotos?")
 *  - Elección de envío sin indicar comuna aún (`PIDIO_ENVIO_SIN_COMUNA`, ej. "Quiero para envío a región")
 *  - Modificación de dirección de despacho (`MODIFICAR_DIRECCION_ENVIO`, ej. "Cómo lo hago para modificar la dirección")
 *  - Postventa / seguimiento de compra (`ESTADO_PEDIDO`, ej. "Ya compré necesito el número de envío")
 *  - Solicitud de asistente/ejecutivo humano (`ATENCION_HUMANA`, ej. "Habrá algún asistente para hablar")
 *  - Pregunta puntual de tienda/sucursal/horario/garantía (`CONSULTA_SUCURSAL`, `CONSULTA_HORARIO`, `CONSULTA_GARANTIAS`)
 */
export function clasificarIntencionConversacional({
  textoBruto = '',
  vehiculoMensajeActual = null,
  vehiculoContextoSesion = null,
  tokensRepuesto = [],
  resumenRepuesto = '',
  tieneFoto = false,
  sesion = {},
}) {
  const limpio = String(textoBruto || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const carritoCotizado = Array.isArray(sesion.carritoCotizado) ? sesion.carritoCotizado : [];
  const tieneCarritoActivo = carritoCotizado.length > 0;
  const tienePiezaEnMensaje = contieneRepuestoRealOCodigo(textoBruto, tokensRepuesto);
  const repuestoPendiente = sesion.repuestoPendienteContexto || null;
  const vehiculoEfectivo = vehiculoMensajeActual || vehiculoContextoSesion || null;
  const tieneVehiculoReal = Boolean(
    vehiculoEfectivo &&
      ((vehiculoEfectivo.marca && vehiculoEfectivo.marca !== 'MULTIMARCA') ||
        vehiculoEfectivo.modelo ||
        vehiculoEfectivo.patente)
  );
  const dioVehiculoNuevoEnEsteMensaje = Boolean(
    vehiculoMensajeActual &&
      ((vehiculoMensajeActual.marca && vehiculoMensajeActual.marca !== 'MULTIMARCA') ||
        vehiculoMensajeActual.modelo ||
        vehiculoMensajeActual.patente)
  );
  const esCodigoOemDirecto = /\b([A-Z0-9]{5}[-][A-Z0-9]{4,7}|FRP-[A-Z]{3}-[A-Z0-9-]+|\d{12,13})\b/i.test(textoBruto);

  // 1. Cancelar pedido pendiente
  if (esMensajeCancelarPedido(textoBruto)) {
    return { tipo: 'CANCELAR_PEDIDO' };
  }

  // 2. Solicitud de atención humana / asistente / ejecutivo (máxima prioridad ante frustración o consulta directa)
  if (
    /\b(HABLAR\s+CON\s+(?:UNA?\s+)?(?:PERSONA|EJECUTIVO|HUMANO|VENDEDOR|ASISTENTE|ALGUIEN)|ALGUN\s+ASISTENTE|ASISTENTE\s+PARA\s+HABLAR|ALGUIEN\s+PARA\s+HABLAR|ATENCION\s+HUMANA|PASAME\s+CON\s+ALGUIEN|NECESITO\s+UN\s+VENDEDOR|EJECUTIVO\s+HUMANO|OPERADOR)\b/.test(
      limpio
    )
  ) {
    return { tipo: 'ATENCION_HUMANA' };
  }

  // 3. Modificación o cambio de dirección de envío / despacho
  if (
    /\b(MODIFICAR\s+(?:LA\s+|MI\s+)?DIRECCION|CAMBIAR\s+(?:LA\s+|MI\s+)?DIRECCION|CORREGIR\s+(?:LA\s+|MI\s+)?DIRECCION|ME\s+EQUIVOQUE\s+DE\s+DIRECCION|DIRECCION\s+DE\s+(?:ENVIO|DESPACHO))\b/.test(
      limpio
    )
  ) {
    return { tipo: 'MODIFICAR_DIRECCION_ENVIO' };
  }

  // 4. Postventa: Estado de pedido, "Ya compré", "Número de envío / seguimiento", comprobante
  if (
    /\b(MI\s+PEDIDO|ESTADO\s+DE\s+MI\s+PEDIDO|COMO\s+VA\s+MI\s+PEDIDO|YA\s+PAGUE|YA\s+COMPRE|COMPRE\s+EN\s+LA\s+PAGINA|COMPRE\s+EN\s+LA\s+WEB|NUMERO\s+DE\s+ENVIO|NUMERO\s+DE\s+SEGUIMIENTO|CODIGO\s+DE\s+ENVIO|CODIGO\s+DE\s+SEGUIMIENTO|ORDEN\s+DE\s+TRANSPORTE|TRANSFERI|MANDE\s+EL\s+COMPROBANTE|VALIDARON\s+MI\s+PAGO|QUE\s+HAGO\s+AQUI|FRP-PED-\d+)\b/.test(
      limpio
    )
  ) {
    return { tipo: 'ESTADO_PEDIDO' };
  }

  // 5. Si YA tiene un producto cotizado en el carrito y pide más fotos o hace una pregunta sobre ESE mismo repuesto
  //    (incluso si repite el nombre del repuesto como "Tienes más fotos de la tapa termostato") -> NO re-buscar ni cambiarle el ítem!
  const pideMasFotosDelCotizado =
    tieneCarritoActivo &&
    /\b(MAS\s+FOTOS?|OTRA\s+FOTO|TIENES?\s+FOTO|VER\s+FOTO|MANDAME\s+FOTO|FOTO\s+REAL|IMAGEN)\b/.test(limpio);

  const esPreguntaSobreItemCotizado =
    tieneCarritoActivo &&
    !tienePiezaEnMensaje &&
    (/\b(ES\s+EL\s+PAR|VIENE\s+EL\s+PAR|POR\s+PAR|COMPLETO|COMPLETA|VIENE\s+CON|TRAE|INCLUYE|QUE\s+MARCA|DE\s+QUE\s+ORIGEN|ES\s+ORIGINAL|ES\s+ALTERNATIVO|SIRVE\s+PARA|LE\s+HACE|CALZA|CUANTAS?\s+UNIDADES|PRECIO\s+POR\s+UNIDAD|PRECIO\s+POR\s+PAR)\b/.test(
      limpio
    ) ||
      (limpio.includes('?') &&
        !/\b(SUCURSAL|DIRECCION|UBICADOS|HORARIO|ABREN|CIERRAN|GARANTIA|DESPACHO|ENVIO|RETIRO)\b/.test(limpio)));

  if (pideMasFotosDelCotizado || esPreguntaSobreItemCotizado) {
    return { tipo: 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO' };
  }

  // 6. Si el cliente dice "Quiero para envío a región" / "Con despacho a domicilio" pero aún no nombra la ciudad/comuna
  if (
    !tienePiezaEnMensaje &&
    /\b(ENVIO\s+A\s+REGION|DESPACHO\s+A\s+REGION|ENVIAN\s+A\s+REGION|PARA\s+REGION|QUIERO\s+(?:PARA\s+)?(?:ENVIO|DESPACHO)|CON\s+(?:ENVIO|DESPACHO)\s+A\s+DOMICILIO|LO\s+QUIERO\s+CON\s+(?:ENVIO|DESPACHO))\b/.test(
      limpio
    )
  ) {
    return { tipo: 'PIDIO_ENVIO_SIN_COMUNA' };
  }

  // 7. Consulta específica sobre reglas/tiempos de retiro o despacho
  if (
    !tienePiezaEnMensaje &&
    /\b(CUANDO\s+PUEDO\s+RETIRAR|A\s+QUE\s+HORA\s+PUEDO\s+RETIRAR|PUEDO\s+RETIRAR\s+HOY|CUANTO\s+DEMORA\s+EL\s+RETIRO|CUANTO\s+TARDA\s+EL\s+RETIRO|COMO\s+FUNCIONA\s+EL\s+RETIRO|TIENEN\s+RETIRO|DONDE\s+RETIRO|PUEDO\s+IR\s+A\s+RETIRAR|CUANTO\s+DEMORA\s+EL\s+DESPACHO|CUANTO\s+TARDA\s+EL\s+DESPACHO|DESPACHAN\s+HOY|TIENEN\s+DELIVERY|PARA\s+RETIRO|QUIERO\s+RETIRAR)\b/.test(
      limpio
    )
  ) {
    return { tipo: 'CONSULTA_RETIRO_DESPACHO' };
  }

  // 8. Preguntas de horario, sucursal o garantías (sin pedir repuesto nuevo)
  if (!tienePiezaEnMensaje && !tieneFoto) {
    if (/\b(GARANTIA|GARANTIAS|DEVOLUCION|DEVOLUCIONES|CAMBIO|CAMBIOS)\b/.test(limpio)) {
      return { tipo: 'CONSULTA_GARANTIAS' };
    }
    if (
      /\b(HORARIO|HORARIOS|A\s+QUE\s+HORA\s+ABREN|A\s+QUE\s+HORA\s+CIERRAN|TRABAJAN\s+HOY|ATIENDEN\s+HOY|ABIERTOS?\s+HOY|SABADO|DOMINGO)\b/.test(
        limpio
      )
    ) {
      return { tipo: 'CONSULTA_HORARIO' };
    }
    if (
      /\b(DONDE\s+ESTAN|DONDE\s+QUEDA|UBICACION|UBICADOS|SUCURSAL|SUCURSALES|UNICA\s+SUCURSAL|OTRA\s+SUCURSAL|TIENDA\s+FISICA|COMO\s+LLEGO|LA\s+FLORIDA|ENRIQUE\s+OLIVARES)\b/.test(
        limpio
      )
    ) {
      return { tipo: 'CONSULTA_SUCURSAL' };
    }
  }

  // 9. Si el cliente envía un vehículo/patente ahora y TENÍA un repuesto pendiente del turno anterior -> ¡Combinar!
  if (!tienePiezaEnMensaje && tieneVehiculoReal && repuestoPendiente?.resumenRepuesto) {
    return {
      tipo: 'BUSQUEDA_CATALOGO',
      usarRepuestoPendiente: true,
      repuestoCombinado: repuestoPendiente,
    };
  }

  // 10. Si YA tiene un carrito cotizado y envía datos adicionales de su vehículo (ej. "Es para mi changan s100 año 2012 1.0" o "S100")
  //     sin nombrar otra pieza distinta -> confirmar compatibilidad sobre el producto ya cotizado!
  if (!tienePiezaEnMensaje && tieneCarritoActivo && dioVehiculoNuevoEnEsteMensaje) {
    return { tipo: 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO' };
  }

  // 11. Si el cliente SOLO dio su vehículo o patente en ESTE mensaje, y AÚN NO tiene carrito cotizado
  if (!tienePiezaEnMensaje && dioVehiculoNuevoEnEsteMensaje && !tieneCarritoActivo && !tieneFoto) {
    return { tipo: 'SOLO_VEHICULO_SIN_REPUESTO' };
  }

  // 12. Si el cliente pide un repuesto real (ej. "Pastillas de freno"), pero NO sabemos qué vehículo tiene (y no es un OEM único)
  if (tienePiezaEnMensaje && !tieneVehiculoReal && !esCodigoOemDirecto && !tieneFoto) {
    return {
      tipo: 'SOLO_REPUESTO_SIN_VEHICULO',
      repuestoDetectado: {
        tokensRepuesto,
        resumenRepuesto,
        textoOriginal: textoBruto,
      },
    };
  }

  // 13. Si no nombró ni vehículo nuevo ni repuesto (ej. "Hola", "?", comentario suelto)
  if (!tienePiezaEnMensaje && !tieneFoto) {
    if (tieneCarritoActivo) {
      return { tipo: 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO' };
    }
    return { tipo: 'SALUDO_O_CONVERSACION_INICIAL' };
  }

  // 14. Tenemos Vehículo + Repuesto (o Código OEM / Foto de muestra) -> Búsqueda real en catálogo
  return {
    tipo: 'BUSQUEDA_CATALOGO',
    usarRepuestoPendiente: false,
  };
}

/**
 * Máquina de estados determinística para el flujo de compra después de escribir COMPRAR
 * (portado fielmente de `chat/flujo_compra.py` de Soluparts).
 */
export async function conducirFlujoCompraDeterministico({
  sesion,
  textoCliente = '',
  carritoActual = [],
  esComandoComprar = false,
  crearPedidoRealFn,
  nodosDespachoActivos = NODOS_DESPACHO_DEFAULT,
}) {
  const texto = String(textoCliente || '').trim();
  const upper = texto.toUpperCase();
  let estado = sesion.flujoCompra || null;

  // Si no hay compra en curso y no escribió COMPRAR, no interceptar
  if (!estado && !esComandoComprar) {
    return { interceptado: false };
  }

  // Si escribió COMPRAR pero el carrito está vacío
  if (esComandoComprar && carritoActual.length === 0) {
    return {
      interceptado: true,
      flujoCompra: null,
      respuestaTexto:
        'Aún no tenemos un repuesto seleccionado en tu cotización. Cuéntame qué repuesto necesitas y la patente de tu vehículo (o marca, modelo y año) para cotizarte al tiro.',
      accionTomada: 'flujo_compra_sin_items',
    };
  }

  const totalIva = carritoActual.reduce(
    (acc, it) => acc + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1),
    0
  );
  const lineasResumen = carritoActual
    .map(
      (it) =>
        `- ${it.cantidad || 1} x ${it.nombre} (\`${it.skuPublicoFrp}\`) — $${Number(
          it.precioVentaConIva
        ).toLocaleString('es-CL')} IVA inc.`
    )
    .join('\n');

  const faltantesPendientes = [
    ...(Array.isArray(sesion.solicitudesWspAbiertas) ? sesion.solicitudesWspAbiertas : []).map(
      (w) => `${w.resumenRepuesto || 'Repuesto'} (\`#${w.codigoSolicitud}\`)`
    ),
    ...(Array.isArray(sesion.escalamientosAbiertos) ? sesion.escalamientosAbiertos : []).map(
      (e) => `${e.resumenRepuesto || 'Repuesto'} (Ticket \`${e.ticketRef}\`)`
    ),
  ];
  const notaFaltanteEnBusqueda =
    faltantesPendientes.length > 0
      ? `\n\n🔎 **Repuesto pendiente en búsqueda (${faltantesPendientes.join(', ')}):** No detenemos la venta de los productos disponibles. El repuesto que falta sigue en búsqueda activa en nuestra Mesa de Abastecimiento y te avisaremos por este mismo WhatsApp apenas sea encontrado.`
      : '';
  const promesaSla = calcularPromesaRetiroYDespacho({ itemsCarrito: carritoActual });

  // Inicio del flujo COMPRAR: arma de inmediato el carro consolidado en WooCommerce con todos los productos disponibles
  if (esComandoComprar) {
    const todosPermitenLaFlorida =
      carritoActual.length > 0 && carritoActual.every((it) => esItemStockPropioOlivares224(it));
    const todosPermitenRetiroSolupartsOPropio =
      carritoActual.length > 0 &&
      carritoActual.every(
        (it) =>
          esItemStockPropioOlivares224(it) ||
          it.nodoAilooId === 'soluparts' ||
          it.origen === 'soluparts_ailoo' ||
          String(it.skuPublicoFrp || '').toUpperCase().startsWith('FRP-SOL-')
      );
    // Si tiene productos que no son ni stock propio ni Soluparts (ej. Mesa WSP o portal proveedor externo), va 100% con Despacho
    const modalidadInicial = !todosPermitenRetiroSolupartsOPropio
      ? 'despacho_domicilio'
      : sesion.modalidadEntrega || null;
    const comunaInicial = sesion.comunaCliente || null;

    const linksTiendaProductos = carritoActual
      .map((it) => {
        const nomLimpio = String(it.nombre || '').split(/\s+para\s+/i)[0].trim() || it.nombre;
        return `• **${nomLimpio}** (\`${it.skuPublicoFrp}\`) — **$${Number(it.precioVentaConIva || 0).toLocaleString('es-CL')} IVA inc.**\n  👉 Comprar en tienda: ${it.urlProductoWoo || 'https://facilrepuestos.cl/tienda/'}`;
      })
      .join('\n');

    if (!modalidadInicial) {
      const nuevoEstado = {
        paso: 'ESPERA_MODALIDAD',
        modalidad: null,
        comuna: comunaInicial,
        datosDespacho: null,
        cotizacionDespacho: null,
        documento: null,
        datosCliente: {},
        actualizadoEn: new Date().toISOString(),
      };
      const textoExplicacionRetiro = todosPermitenLaFlorida
        ? `¿Prefieres **retiro inmediato en nuestra sucursal de La Florida** o **despacho a domicilio**?`
        : `¿Lo prefieres con **retiro en nuestra sucursal de La Florida** (${
            promesaSla.esLunesAViernes && promesaSla.antesDeLas1130
              ? 'hoy desde las 15:30 hrs comprando antes de las 11:30'
              : 'disponible desde las 15:30 hrs del siguiente día hábil'
          }) o con **despacho a domicilio / región**?`;
      return {
        interceptado: true,
        flujoCompra: nuevoEstado,
        pedidoCreado: null,
        respuestaTexto:
          `🛒 Puedes comprar directamente en nuestra tienda web **facilrepuestos.cl** aquí:\n${linksTiendaProductos}` +
          `${notaFaltanteEnBusqueda}\n\n` +
          textoExplicacionRetiro,
        accionTomada: 'flujo_compra_paso_modalidad',
      };
    }

    const esDespacho = modalidadInicial === 'despacho_domicilio' || modalidadInicial === 'despacho_regiones';
    const nuevoEstado = {
      paso: esDespacho ? 'ESPERA_DIRECCION' : 'ESPERA_DOCUMENTO',
      modalidad: esDespacho ? 'DESPACHO' : 'RETIRO',
      comuna: comunaInicial || 'La Florida, Santiago (RM)',
      datosDespacho: null,
      cotizacionDespacho: esDespacho
        ? null
        : cotizarDespachoAnticipado({
            direccionOComuna: 'La Florida',
            itemsCarrito: carritoActual,
            nodosActivos: nodosDespachoActivos,
            modalidad: 'Retiro en tienda',
          }),
      documento: null,
      datosCliente: {},
      actualizadoEn: new Date().toISOString(),
    };

    if (esDespacho) {
      return {
        interceptado: true,
        flujoCompra: nuevoEstado,
        pedidoCreado: null,
        respuestaTexto:
          `¡Perfecto! 🛒 Aquí tienes el link directo de tu producto en nuestra tienda **facilrepuestos.cl**:\n${linksTiendaProductos}\n• **Subtotal repuestos:** **$${totalIva.toLocaleString('es-CL')} IVA inc.**` +
          `${notaFaltanteEnBusqueda}\n\n` +
          `🚚 Este pedido va con **Despacho a domicilio**. Mándame tu **comuna o dirección de entrega** para darte el valor exacto del despacho según nuestra tabla de Santiago y Regiones.`,
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }

    return {
      interceptado: true,
      flujoCompra: nuevoEstado,
      pedidoCreado: null,
      respuestaTexto:
        `¡Perfecto! 🛒 Aquí tienes el link de tu producto en **facilrepuestos.cl** (también puedes pagarlo al retirar en **Enrique Olivares 224, La Florida**):\n${linksTiendaProductos}\n• **Total repuestos:** **$${totalIva.toLocaleString('es-CL')} IVA inc.**` +
        `${notaFaltanteEnBusqueda}\n\n` +
        `¿Necesitas **boleta** o **factura**?`,
      accionTomada: 'flujo_compra_paso_documento',
    };
  }

  // Si había compra en curso y el cliente escribe "Cancelar"
  if (esMensajeCancelarPedido(texto)) {
    return {
      interceptado: true,
      flujoCompra: null,
      respuestaTexto:
        'Listo, dejé cancelado el proceso de compra. Si quieres buscar otro repuesto o retomar más adelante, escríbeme por aquí.',
      accionTomada: 'flujo_compra_cancelado',
    };
  }

  // Si el cliente hace una pregunta con "?" o pide otro repuesto en medio de la compra -> Pausar compra (igual que `web.py` en Soluparts)
  if (texto.includes('?') || (contieneRepuestoRealOCodigo(texto, texto.split(/\s+/)) && estado.paso !== 'ESPERA_DIRECCION')) {
    return {
      interceptado: false,
      compraPausada: true,
      flujoCompra: null,
    };
  }

  // Permitir cambiar entre Retiro y Despacho en cualquier paso (mejora del 25 oct en `flujo_compra.py`)
  if (estado.paso !== 'ESPERA_MODALIDAD' && estado.paso !== 'ESPERA_DIRECCION') {
    if (/\b(MEJOR\s+(?:QUIERO\s+)?DESPACHO|CAMBIAR\s+A\s+DESPACHO|PREFIERO\s+DESPACHO|CON\s+ENVIO)\b/i.test(texto)) {
      estado = {
        ...estado,
        modalidad: 'DESPACHO',
        cotizacionDespacho: null,
        paso: 'ESPERA_DIRECCION',
      };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo cambiamos a **Despacho a domicilio**. Mándame la **dirección completa** (calle, número y comuna/ciudad) para calcularte el valor exacto del envío.',
        accionTomada: 'flujo_compra_cambio_entrega',
      };
    }
    if (/\b(MEJOR\s+(?:QUIERO\s+)?RETIRO|CAMBIAR\s+A\s+RETIRO|PREFIERO\s+RETIRAR|VOY\s+A\s+BUSCARLO)\b/i.test(texto)) {
      estado = {
        ...estado,
        modalidad: 'RETIRO',
        cotizacionDespacho: cotizarDespachoAnticipado({
          direccionOComuna: 'La Florida',
          itemsCarrito: carritoActual,
          nodosActivos: nodosDespachoActivos,
          modalidad: 'Retiro en tienda',
        }),
        paso: estado.documento ? 'ESPERA_DATOS' : 'ESPERA_DOCUMENTO',
      };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo cambiamos a **Retiro sin costo en sucursal** (**Enrique Olivares 224, La Florida**). ' +
          (estado.documento
            ? 'Mándame tu **nombre completo, RUT y correo** para generar el pedido.'
            : '¿Necesitas **boleta** o **factura**?'),
        accionTomada: 'flujo_compra_cambio_entrega',
      };
    }
  }

  // PASO 1: ESPERA_MODALIDAD
  if (estado.paso === 'ESPERA_MODALIDAD') {
    const pideDespacho = /\b(DESPACHO|ENV[IÍ]O|DOMICILIO|COURIER|STARKEN|CHILEXPRESS|ENVIAR)\b/i.test(texto);
    const pideRetiro = /\b(RETIRO|RETIRAR|SUCURSAL|TIENDA|FLORIDA|OLIVARES|BUSCAR)\b/i.test(texto);

    if (!pideDespacho && !pideRetiro) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Cuéntame si prefieres **Retiro sin costo en sucursal** (Enrique Olivares 224, La Florida) o **Despacho a domicilio** (con valor calculado según tu comuna o región).',
        accionTomada: 'flujo_compra_paso_modalidad',
      };
    }

    if (pideDespacho) {
      estado = { ...estado, modalidad: 'DESPACHO', paso: 'ESPERA_DIRECCION' };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo anotamos con **Despacho a domicilio**. Mándame tu **dirección de entrega** (calle, número y comuna o ciudad) para calcularte al tiro el valor del despacho desde **Enrique Olivares 224, La Florida**.',
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }

    estado = {
      ...estado,
      modalidad: 'RETIRO',
      cotizacionDespacho: cotizarDespachoAnticipado({
        direccionOComuna: 'La Florida',
        itemsCarrito: carritoActual,
        nodosActivos: nodosDespachoActivos,
        modalidad: 'Retiro en tienda',
      }),
      paso: 'ESPERA_DOCUMENTO',
    };
    return {
      interceptado: true,
      flujoCompra: estado,
      respuestaTexto:
        `Perfecto, queda con **Retiro sin costo en sucursal** (**Enrique Olivares 224, La Florida**).\n⏱️ **Disponibilidad de retiro:** ${promesaSla.promesaRetiroDetallada}\n\n¿Necesitas **boleta** o **factura**?`,
      accionTomada: 'flujo_compra_paso_documento',
    };
  }

  // PASO 2: ESPERA_DIRECCION (cuando eligió despacho -> calcula tarifa anticipada según comuna/región y talla de la pieza)
  if (estado.paso === 'ESPERA_DIRECCION') {
    if (texto.length < 5) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto: 'Por favor indícame la calle, número y comuna (o ciudad) para cotizar tu despacho.',
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }

    const cotizacionDespacho = cotizarDespachoAnticipado({
      direccionOComuna: texto,
      itemsCarrito: carritoActual,
      nodosActivos: nodosDespachoActivos,
      modalidad: 'Despacho a domicilio',
    });

    const costoEnvio = Number(cotizacionDespacho.costoDespachoConIva || 0);
    const totalConDespacho = totalIva + costoEnvio;

    estado = {
      ...estado,
      datosDespacho: texto,
      comuna: cotizacionDespacho.comunaDetectada || texto,
      cotizacionDespacho,
      paso: 'ESPERA_DOCUMENTO',
    };

    return {
      interceptado: true,
      flujoCompra: estado,
      respuestaTexto:
        `🚚 **Despacho a ${cotizacionDespacho.comunaDetectada || texto}:** **$${costoEnvio.toLocaleString('es-CL')} IVA inc.** (${cotizacionDespacho.tiempoEstimado || '24 a 48 hrs'}).\n` +
        `• **Subtotal repuestos:** $${totalIva.toLocaleString('es-CL')} IVA inc.\n` +
        `• **Total final con envío:** **$${totalConDespacho.toLocaleString('es-CL')} IVA inc.**\n\n` +
        `¿Necesitas **boleta** o **factura** para dejar creada tu orden?`,
      accionTomada: 'flujo_compra_paso_documento',
    };
  }


  // PASO 3: ESPERA_DOCUMENTO
  if (estado.paso === 'ESPERA_DOCUMENTO') {
    const esFactura = /\bFACTURA\b/i.test(upper);
    const esBoleta = /\bBOLETA\b/i.test(upper);
    if (!esFactura && !esBoleta) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto: 'Por favor dime si prefieres **boleta** o **factura** para tu compra.',
        accionTomada: 'flujo_compra_paso_documento',
      };
    }

    const docTipo = esFactura ? 'FACTURA' : 'BOLETA';
    // Ver si en el mismo mensaje ya mandó nombre, RUT o correo
    const { hallado } = extraerDatosClienteCompra(texto, ['nombre', 'rut', 'email']);
    const datosCliente = { ...(estado.datosCliente || {}), ...hallado };
    const faltan = ['nombre', 'rut', 'email'].filter((k) => !datosCliente[k]);

    estado = {
      ...estado,
      documento: docTipo,
      datosCliente,
      paso: 'ESPERA_DATOS',
    };

    if (faltan.length > 0) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          `Perfecto, vamos con **${docTipo.toLowerCase()}**. Mándame en un solo mensaje:\n` +
          `- Tu **nombre completo**${docTipo === 'FACTURA' ? ' (o razón social)' : ''}\n` +
          `- Tu **RUT**${docTipo === 'FACTURA' ? ' de facturación' : ''}\n` +
          `- Tu **correo electrónico**`,
        accionTomada: 'flujo_compra_paso_datos',
      };
    }
  }

  // PASO 4: ESPERA_DATOS (Nombre + RUT Módulo 11 + Email)
  if (estado.paso === 'ESPERA_DATOS') {
    const actuales = { ...(estado.datosCliente || {}) };
    const faltantesAntes = ['nombre', 'rut', 'email'].filter((k) => !actuales[k]);
    const { hallado, rutInvalidoDetectado } = extraerDatosClienteCompra(texto, faltantesAntes);
    const combinados = { ...actuales, ...hallado };
    const faltanAhora = ['nombre', 'rut', 'email'].filter((k) => !combinados[k]);

    estado = {
      ...estado,
      datosCliente: combinados,
    };

    if (rutInvalidoDetectado && !combinados.rut) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'El RUT que escribiste no parece válido (revisa el dígito verificador después del guion). ¿Me lo confirmas por favor?',
        accionTomada: 'flujo_compra_rut_invalido',
      };
    }

    if (faltanAhora.length > 0) {
      const etiquetas = {
        nombre: 'tu **nombre completo**',
        rut: 'tu **RUT** (ej: 12.345.678-9)',
        email: 'tu **correo electrónico**',
      };
      const listaFaltan = faltanAhora.map((f) => etiquetas[f]);
      const textoFalta =
        listaFaltan.length === 1
          ? `Me falta ${listaFaltan[0]}.`
          : `Me falta ${listaFaltan.slice(0, -1).join(', ')} y ${listaFaltan[listaFaltan.length - 1]}.`;
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto: `${textoFalta} Mándamelo por aquí para generar tu pedido.`,
        accionTomada: 'flujo_compra_paso_datos',
      };
    }

    // ¡Tenemos todos los datos! Crear el pedido real `FRP-PED-*` con despacho pre-pagado si corresponde
    const modalidadFinal = estado.modalidad === 'DESPACHO' ? 'despacho_domicilio' : 'retiro_bodega';
    const comunaFinal = estado.datosDespacho || estado.comuna || 'La Florida, Santiago (RM)';
    const cotizacionDespachoFinal =
      estado.cotizacionDespacho ||
      cotizarDespachoAnticipado({
        direccionOComuna: comunaFinal,
        itemsCarrito: carritoActual,
        nodosActivos: nodosDespachoActivos,
        modalidad: modalidadFinal === 'retiro_bodega' ? 'Retiro en tienda' : 'Despacho a domicilio',
      });

    const pedidoCreado = await crearPedidoRealFn({
      sesion: {
        ...sesion,
        clienteNombre: combinados.nombre,
        carritoCotizado: carritoActual,
      },
      modalidadEntrega: modalidadFinal,
      comunaEntrega: comunaFinal,
      documentoTributario: estado.documento || 'BOLETA',
      datosCliente: combinados,
      cotizacionDespacho: cotizacionDespachoFinal,
    });

    const costoEnvioFinal = Number(cotizacionDespachoFinal?.costoDespachoConIva || 0);
    const entregaTxt =
      modalidadFinal === 'retiro_bodega'
        ? `Retiro sin costo en Sucursal FácilRepuestos (${cotizacionDespachoFinal?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida, Santiago'})`
        : `${cotizacionDespachoFinal?.tituloTarifa || 'Despacho Pre-Pagado'} hacia ${comunaFinal} (Salida: ${cotizacionDespachoFinal?.nodoOrigen?.direccion || 'Enrique Olivares 224, La Florida'}) — $${costoEnvioFinal.toLocaleString('es-CL')} IVA inc.`;

    const linkCarroWoo =
      pedidoCreado?.urlPagoCheckoutWoo ||
      pedidoCreado?.urlCarroWooCommerce ||
      carritoActual.find((it) => it.urlAgregarAlCarroWoo)?.urlAgregarAlCarroWoo ||
      'https://facilrepuestos.cl/finalizar-compra/';

    const respuestaFinal =
      `¡Listo ${combinados.nombre.split(' ')[0]}! Tu pedido **\`${pedidoCreado.codigoPedido}\`**${
        pedidoCreado?.wooOrderId ? ` (Orden Web **#${pedidoCreado.wooOrderId}**)` : ''
      } quedó creado con todos tus repuestos disponibles:\n\n` +
      `${lineasResumen}\n` +
      `- **Subtotal repuestos:** $${totalIva.toLocaleString('es-CL')} IVA inc.\n` +
      (costoEnvioFinal > 0
        ? `- **Despacho pre-pagado:** $${costoEnvioFinal.toLocaleString('es-CL')} IVA inc. (${cotizacionDespachoFinal?.tiempoEstimado || '24 a 48 hrs'})\n`
        : `- **Despacho / Retiro:** $0 (Retiro en taller Enrique Olivares 224, La Florida)\n`) +
      `- **Documento:** ${estado.documento || 'BOLETA'} (RUT \`${combinados.rut}\`)\n` +
      `- **Entrega:** ${entregaTxt}\n` +
      `- **Total final a pagar:** **$${Number(pedidoCreado.totalConIva).toLocaleString('es-CL')} IVA inc.**\n\n` +
      `🛒 **Paga seguro tu Carro Consolidado en facilrepuestos.cl (Webpay / MercadoPago / Toku / Transferencia):**\n` +
      `👉 ${linkCarroWoo}` +
      `${notaFaltanteEnBusqueda}\n\n` +
      `Recuerda que el stock queda reservado al confirmar tu pago en el carro o enviándonos el comprobante por aquí.`;


    return {
      interceptado: true,
      flujoCompra: null,
      pedidoCreado,
      modalidadEntrega: modalidadFinal,
      comunaCliente: comunaFinal,
      respuestaTexto: respuestaFinal,
      accionTomada: 'checkout_simulado_creado',
    };
  }

  return { interceptado: false };
}

/**
 * Verificador anti-alucinación de SKUs y precios (portado de `chat/precio.py` de Soluparts).
 * Si el LLM inventa un SKU `FRP-*` que no existe en los candidatos ni en el carrito, lo detecta.
 */
export function verificarSkusEnRespuesta(textoRespuesta = '', skusPermitidos = []) {
  const permitidosSet = new Set(skusPermitidos.map((s) => String(s || '').toUpperCase()));
  const matches = String(textoRespuesta || '').toUpperCase().match(/\bFRP-[A-Z]{3}-[A-Z0-9-]+\b/g) || [];
  const fantasmas = matches.filter((sku) => !permitidosSet.has(sku));
  return {
    tieneSkusFantasmas: fantasmas.length > 0,
    fantasmas,
  };
}

/**
 * Determina si vale la pena invocar Gemini 4 Neon o si la respuesta determinística ya resuelve el turno.
 * Invocamos a Gemini cuando el cliente hace una pregunta sobre el producto cotizado o una pregunta abierta con '?'.
 */
export function requiereRedaccionConGemini({
  textoCliente = '',
  intencion = '',
  forzarGemini = false,
  tieneNotaTecnica = false,
}) {
  if (forzarGemini || tieneNotaTecnica) return true;
  if (intencion === 'PREGUNTA_SOBRE_PRODUCTO_COTIZADO') return true;

  const intencionesCeroTokens = new Set([
    'CANCELAR_PEDIDO',
    'SOLO_VEHICULO_SIN_REPUESTO',
    'SOLO_REPUESTO_SIN_VEHICULO',
    'PIDIO_ENVIO_SIN_COMUNA',
    'MODIFICAR_DIRECCION_ENVIO',
  ]);
  if (intencionesCeroTokens.has(intencion)) return false;

  const limpio = String(textoCliente || '').trim();
  const palabras = limpio.split(/\s+/).filter(Boolean);

  if (intencion === 'SALUDO_O_CONVERSACION_INICIAL' && palabras.length <= 8 && !limpio.includes('?')) {
    return false;
  }

  // En una búsqueda de catálogo inicial directa, la plantilla concisa de 4 líneas del Orquestador es óptima y exacta
  if (
    intencion === 'BUSQUEDA_CATALOGO' &&
    !/\b(DIFERENCIA|CUAL\s+ME\s+CONVIENE|ORIGINAL\s+O\s+ALTERNATIVO|GARANTIA|COMO\s+SE\s+SI|POR\s+QUE|EXPLICA|RECOMIENDAS)\b/i.test(
      limpio
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Llama a Gemini (`gemini-3.8-flash` en Vertex AI `facilrepuestos-prod`, location `global`)
 * con las instrucciones reales de Luna adaptadas a FácilRepuestos.
 * Optimizado con filtro de ahorro de tokens (0 tokens en turnos determinísticos).
 * Si Vertex AI no responde o el modelo inventa un SKU, cae de forma transparente al redactor determinístico.
 */
export async function redactarRespuestaConGeminiLuna({
  textoCliente = '',
  historialMensajes = [],
  contextoSituacion = '',
  skusPermitidos = [],
  respuestaFallback = '',
  intencion = '',
  forzarGemini = false,
  tieneNotaTecnica = false,
}) {
  if (
    !requiereRedaccionConGemini({
      textoCliente,
      intencion,
      forzarGemini,
      tieneNotaTecnica,
    })
  ) {
    return respuestaFallback;
  }

  try {
    const client = await googleAuth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) return respuestaFallback;

    const horaCtx = obtenerContextoHoraChile();
    const cfgAgentes = await obtenerConfiguracionAgentesIA().catch(() => null);
    const modeloPreferido =
      cfgAgentes?.agentes?.orquestador?.modelo ||
      cfgAgentes?.modeloGlobalPreferido ||
      GEMINI_MODEL;

    const bloqueContextoEditablePortal = cfgAgentes?.agentes
      ? Object.values(cfgAgentes.agentes)
          .filter((a) => a.activo !== false && (a.instrucciones || a.contextoExtra))
          .map(
            (a) =>
              `• [${a.nombre}]: ${a.instrucciones || ''} ${
                a.contextoExtra ? `| Contexto adicional: ${a.contextoExtra}` : ''
              }`
          )
          .join('\n')
      : '';

    const instruccionSistema = `Te llamas Repuestín y eres el vendedor experto de mostrador de facilrepuestos.cl en Chile. Atiendes a clientes por WhatsApp bajo la arquitectura de 6 Agentes Especializados de FácilRepuestos.
Hablas como un vendedor experto chileno: directo, breve, empático y al grano (MÁXIMO 3 a 4 líneas por respuesta). Tratas al cliente de "tú".

REGLAS ESTRICTAS DE RESPUESTA CONVERSACIONAL:
1. PROHIBIDO VOMITAR PÁRRAFOS LARGOS O LISTAS DE OTROS AUTOS:
   - Si el cliente tiene un vehículo identificado (ej. Chery Arrizo 3 o Changan S100), habla SOLO de su vehículo. Jamás listes otros 10 modelos de autos compatibles que vienen en el título del catálogo.
2. RESPONDE PRIMERO LO QUE EL CLIENTE PREGUNTÓ (SÍ / NO DIRECTO):
   - Si el cliente hace una pregunta puntual (ej. "¿Es el par completo?", "¿Es la única sucursal?", "¿Tienes más fotos?"), respóndele primero con un "Sí" o "No" claro en 1 o 2 líneas usando los [DATOS VERIFICADOS DEL SISTEMA].
   - Si ya tiene un producto cotizado en pantalla, NUNCA le vuelvas a preguntar "¿Qué repuesto estás buscando y para qué vehículo?".
3. FLUJO DE COMPRA DIRECTA EN WORDPRESS (SIN COMANDO "COMPRAR"):
   - Ya NO existe el comando "COMPRAR" por chat: el link del producto en facilrepuestos.cl (sin tilde) se entrega automáticamente desde la primera cotización.
   - Al entrar al link en WordPress, el cliente ve sus valores de despacho o retiro, fechas de entrega y paga directo en la web; luego el Webhook de WordPress confirma la compra automáticamente por WhatsApp.
   - Solo entrega valores de despacho o tiempos de retiro en el chat cuando el cliente lo pregunte expresamente.
4. NUNCA inventes un SKU, stock ni precio que no esté en [DATOS VERIFICADOS DEL SISTEMA]. NUNCA menciones nombres de proveedores internos (todo es de facilrepuestos.cl).
${bloqueContextoEditablePortal ? `\nDIRECTRICES DE SUBAGENTES ACTIVOS:\n${bloqueContextoEditablePortal}` : ''}`;

    const ultimosTurnos = (historialMensajes || []).slice(-6).map((m) => ({
      role: m.autor === 'cliente' ? 'user' : 'model',
      parts: [{ text: String(m.texto || '').slice(0, 600) }],
    }));

    const promptTurno =
      `${horaCtx.lineaContextoSistema}\n` +
      `[DATOS VERIFICADOS DEL SISTEMA PARA ESTE TURNO]:\n${contextoSituacion}\n\n` +
      `[MENSAJE DEL CLIENTE]:\n${textoCliente}`;

    const modelosIntento = Array.from(
      new Set([modeloPreferido, 'gemini-3.8-flash', 'gemini-2.5-flash'])
    );
    let resp = null;

    for (const modId of modelosIntento) {
      const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${modId}:generateContent`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);
      try {
        const intento = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: instruccionSistema }],
            },
            contents: [
              ...ultimosTurnos,
              {
                role: 'user',
                parts: [{ text: promptTurno }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 450,
              thinkingConfig: { thinkingBudget: 0 },
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

    if (!resp || !resp.ok) {
      return respuestaFallback;
    }

    const data = await resp.json();
    const partes = data?.candidates?.[0]?.content?.parts || [];
    const textoGenerado = partes
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim();

    if (!textoGenerado) return respuestaFallback;

    // Verificar que no haya inventado ningún SKU (igual que `precio.py` en Soluparts)
    const checkSkus = verificarSkusEnRespuesta(textoGenerado, skusPermitidos);
    if (checkSkus.tieneSkusFantasmas) {
      console.warn('[LunaConversacional] SKU fantasma bloqueado:', checkSkus.fantasmas);
      return respuestaFallback;
    }

    return textoGenerado;
  } catch (err) {
    console.warn('[LunaConversacional] Usando respuesta determinística de respaldo:', err.message);
    return respuestaFallback;
  }
}
