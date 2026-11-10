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

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'facilrepuestos-prod';
const GEMINI_MODEL = process.env.GEMINI_AGENT_MODEL || 'gemini-3.8-flash';

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
 * Clasifica la intención conversacional del mensaje ANTES de ejecutar búsquedas o abrir tickets.
 * Garantiza que un saludo ("Hola") o una consulta incompleta jamás dispare la Mesa WhatsApp a ciegas.
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

  const tienePiezaEnMensaje = contieneRepuestoRealOCodigo(textoBruto, tokensRepuesto);
  const repuestoPendiente = sesion.repuestoPendienteContexto || null;
  const vehiculoEfectivo = vehiculoMensajeActual || vehiculoContextoSesion || null;
  const tieneVehiculoReal = Boolean(
    vehiculoEfectivo &&
      ((vehiculoEfectivo.marca && vehiculoEfectivo.marca !== 'MULTIMARCA') ||
        vehiculoEfectivo.modelo ||
        vehiculoEfectivo.patente)
  );
  const esCodigoOemDirecto = /\b([A-Z0-9]{5}[-][A-Z0-9]{4,7}|FRP-[A-Z]{3}-[A-Z0-9-]+|\d{12,13})\b/i.test(textoBruto);

  // 1. Cancelar pedido pendiente
  if (esMensajeCancelarPedido(textoBruto)) {
    return { tipo: 'CANCELAR_PEDIDO' };
  }

  // 2. Consulta por estado de pedido o pago
  if (
    /\b(MI\s+PEDIDO|ESTADO\s+DE\s+MI\s+PEDIDO|COMO\s+VA\s+MI\s+PEDIDO|YA\s+PAGUE|TRANSFERI|MANDE\s+EL\s+COMPROBANTE|VALIDARON\s+MI\s+PAGO|CUANDO\s+PUEDO\s+RETIRAR|FRP-PED-\d+)\b/.test(
      limpio
    )
  ) {
    return { tipo: 'ESTADO_PEDIDO' };
  }

  // 3. Solicitud de atención humana / ejecutivo
  if (
    /\b(HABLAR\s+CON\s+(?:UNA?\s+)?(?:PERSONA|EJECUTIVO|HUMANO|VENDEDOR)|ATENCION\s+HUMANA|PASAME\s+CON\s+ALGUIEN)\b/.test(
      limpio
    )
  ) {
    return { tipo: 'ATENCION_HUMANA' };
  }

  // 4. Preguntas de horario, dirección/sucursal, garantías o devoluciones (sin pedir repuesto)
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
      /\b(DONDE\s+ESTAN|DONDE\s+QUEDA|DIRECCION|UBICACION|UBICADOS|SUCURSAL|SUCURSALES|TIENDA\s+FISICA|COMO\s+LLEGO|LA\s+FLORIDA|ENRIQUE\s+OLIVARES)\b/.test(
        limpio
      )
    ) {
      return { tipo: 'CONSULTA_SUCURSAL' };
    }
  }

  // 5. Si el cliente envía un vehículo/patente ahora y TENÍA un repuesto pendiente del turno anterior -> ¡Combinar!
  if (!tienePiezaEnMensaje && tieneVehiculoReal && repuestoPendiente?.resumenRepuesto) {
    return {
      tipo: 'BUSQUEDA_CATALOGO',
      usarRepuestoPendiente: true,
      repuestoCombinado: repuestoPendiente,
    };
  }

  // 6. Si el cliente solo dio su vehículo o patente, pero aún no dice qué repuesto busca
  if (!tienePiezaEnMensaje && tieneVehiculoReal && !tieneFoto) {
    return { tipo: 'SOLO_VEHICULO_SIN_REPUESTO' };
  }

  // 7. Si el cliente pide un repuesto real (ej. "Pastillas de freno"), pero NO sabemos qué vehículo tiene (y no es un OEM único)
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

  // 8. Si no nombró ni vehículo ni repuesto (ej. "Hola", "Buenas tardes", "Quiero cotizar", "¿Hay alguien?")
  if (!tienePiezaEnMensaje && !tieneVehiculoReal && !tieneFoto) {
    return { tipo: 'SALUDO_O_CONVERSACION_INICIAL' };
  }

  // 9. Tenemos Vehículo + Repuesto (o Código OEM / Foto de muestra) -> Búsqueda real en catálogo
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

  // Inicio del flujo COMPRAR
  if (esComandoComprar) {
    const modalidadInicial = sesion.modalidadEntrega || null;
    const comunaInicial = sesion.comunaCliente || null;

    if (!modalidadInicial) {
      const nuevoEstado = {
        paso: 'ESPERA_MODALIDAD',
        modalidad: null,
        comuna: comunaInicial,
        datosDespacho: null,
        documento: null,
        datosCliente: {},
        actualizadoEn: new Date().toISOString(),
      };
      return {
        interceptado: true,
        flujoCompra: nuevoEstado,
        respuestaTexto:
          `Perfecto, armemos tu pedido:\n${lineasResumen}\nTotal: **$${totalIva.toLocaleString('es-CL')} IVA inc.**\n\n` +
          `¿Prefieres **Retiro en sucursal** (Enrique Olivares 224, La Florida, sin costo) o **Despacho por pagar** a domicilio?`,
        accionTomada: 'flujo_compra_paso_modalidad',
      };
    }

    const esDespacho = modalidadInicial === 'despacho_domicilio' || modalidadInicial === 'despacho_regiones';
    const nuevoEstado = {
      paso: esDespacho ? 'ESPERA_DIRECCION' : 'ESPERA_DOCUMENTO',
      modalidad: esDespacho ? 'DESPACHO' : 'RETIRO',
      comuna: comunaInicial || 'La Florida, Santiago (RM)',
      datosDespacho: null,
      documento: null,
      datosCliente: {},
      actualizadoEn: new Date().toISOString(),
    };

    if (esDespacho) {
      return {
        interceptado: true,
        flujoCompra: nuevoEstado,
        respuestaTexto:
          `Perfecto, anoto tu pedido con despacho por pagar:\n${lineasResumen}\nTotal productos: **$${totalIva.toLocaleString('es-CL')} IVA inc.**\n\n` +
          `El envío se paga al recibir vía courier (Starken, Chilexpress o Blue Express). Mándame tu **dirección de entrega** (calle, número y comuna).`,
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }

    return {
      interceptado: true,
      flujoCompra: nuevoEstado,
      respuestaTexto:
        `Perfecto, anoto para retiro en nuestra sucursal (**Enrique Olivares 224, La Florida**):\n${lineasResumen}\nTotal: **$${totalIva.toLocaleString('es-CL')} IVA inc.**\n\n` +
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
        paso: 'ESPERA_DIRECCION',
      };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo cambiamos a **Despacho por pagar**. Mándame la **dirección completa** (calle, número y comuna) donde enviamos el pedido.',
        accionTomada: 'flujo_compra_cambio_entrega',
      };
    }
    if (/\b(MEJOR\s+(?:QUIERO\s+)?RETIRO|CAMBIAR\s+A\s+RETIRO|PREFIERO\s+RETIRAR|VOY\s+A\s+BUSCARLO)\b/i.test(texto)) {
      estado = {
        ...estado,
        modalidad: 'RETIRO',
        paso: estado.documento ? 'ESPERA_DATOS' : 'ESPERA_DOCUMENTO',
      };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo cambiamos a **Retiro en sucursal** (Enrique Olivares 224, La Florida). ' +
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
          'Cuéntame si prefieres **Retiro en sucursal** (Enrique Olivares 224, La Florida) o **Despacho por pagar** a domicilio.',
        accionTomada: 'flujo_compra_paso_modalidad',
      };
    }

    if (pideDespacho) {
      estado = { ...estado, modalidad: 'DESPACHO', paso: 'ESPERA_DIRECCION' };
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto:
          'Perfecto, lo anotamos con **Despacho por pagar**. Mándame la **dirección de entrega** (calle, número y comuna).',
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }

    estado = { ...estado, modalidad: 'RETIRO', paso: 'ESPERA_DOCUMENTO' };
    return {
      interceptado: true,
      flujoCompra: estado,
      respuestaTexto:
        'Perfecto, queda con **Retiro en sucursal** (Enrique Olivares 224, La Florida).\n\n¿Necesitas **boleta** o **factura**?',
      accionTomada: 'flujo_compra_paso_documento',
    };
  }

  // PASO 2: ESPERA_DIRECCION (cuando eligió despacho)
  if (estado.paso === 'ESPERA_DIRECCION') {
    if (texto.length < 5) {
      return {
        interceptado: true,
        flujoCompra: estado,
        respuestaTexto: 'Por favor indícame la calle, número y comuna para el despacho.',
        accionTomada: 'flujo_compra_paso_direccion',
      };
    }
    estado = {
      ...estado,
      datosDespacho: texto,
      comuna: texto,
      paso: 'ESPERA_DOCUMENTO',
    };
    return {
      interceptado: true,
      flujoCompra: estado,
      respuestaTexto: `Anotada la dirección: **${texto}**.\n\n¿Necesitas **boleta** o **factura**?`,
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

    // ¡Tenemos todos los datos! Crear el pedido real `FRP-PED-*`
    const modalidadFinal = estado.modalidad === 'DESPACHO' ? 'despacho_domicilio' : 'retiro_bodega';
    const comunaFinal = estado.datosDespacho || estado.comuna || 'La Florida, Santiago (RM)';

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
    });

    const entregaTxt =
      modalidadFinal === 'retiro_bodega'
        ? 'Retiro en Sucursal FácilRepuestos (Enrique Olivares 224, La Florida, Santiago)'
        : `Despacho por pagar a: ${comunaFinal}`;

    const respuestaFinal =
      `¡Listo ${combinados.nombre.split(' ')[0]}! Tu pedido **\`${pedidoCreado.codigoPedido}\`** quedó creado:\n\n` +
      `${lineasResumen}\n` +
      `- **Documento:** ${estado.documento || 'BOLETA'} (RUT \`${combinados.rut}\`)\n` +
      `- **Entrega:** ${entregaTxt}\n` +
      `- **Total a pagar:** **$${Number(pedidoCreado.totalConIva).toLocaleString('es-CL')} IVA inc.**\n\n` +
      `Recuerda que el stock queda reservado una vez confirmado el pago. Puedes completar el pago desde el botón de tu pantalla o enviarnos el comprobante por aquí.`;

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
 * Llama a Gemini (`gemini-3.8-flash` en Vertex AI `facilrepuestos-prod`, location `global`)
 * con las instrucciones reales de Luna adaptadas a FácilRepuestos.
 * Si Vertex AI no responde o el modelo inventa un SKU, cae de forma transparente al redactor determinístico.
 */
export async function redactarRespuestaConGeminiLuna({
  textoCliente = '',
  historialMensajes = [],
  contextoSituacion = '',
  skusPermitidos = [],
  respuestaFallback = '',
}) {
  try {
    const client = await googleAuth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) return respuestaFallback;

    const horaCtx = obtenerContextoHoraChile();
    const instruccionSistema = `Te llamas Repuestín y eres el asistente de ventas de mostrador de FácilRepuestos.cl en Chile. Atiendes directamente a clientes finales que buscan repuestos para su vehículo por chat web o WhatsApp.
Hablas como un vendedor experto de mostrador en Chile: directo, breve, amable y claro (máximo 3 a 5 líneas por respuesta). Tratas al cliente de "tú". Usas "tenemos", "te puedo ofrecer", "revisemos".

REGLAS INQUEBRANTABLES (HEREDADAS DE LUNA SOLUPARTS):
1. NUNCA inventes un SKU, producto, stock ni precio que no esté explícitamente en los [DATOS VERIFICADOS DEL SISTEMA] de este turno.
2. Si el cliente solo saluda ("Hola", "Buenas tardes") o no ha dicho qué repuesto busca, salúdalo con naturalidad en 2 líneas y pregúntale qué repuesto necesita y la patente de su vehículo (o marca, modelo y año).
3. Si el cliente pide un repuesto pero falta saber para qué vehículo es, NO inventes opciones: pregúntale para qué vehículo lo necesita y ofrécele darte la patente ("si tienes la patente a mano me la das y lo veo al tiro").
4. Si el cliente dio la patente o el vehículo pero aún no dice qué repuesto necesita, confírmale el vehículo identificado y pregúntale qué pieza anda buscando.
5. Cuando ofrezcas productos con stock confirmado en [DATOS VERIFICADOS DEL SISTEMA]:
   - Muestra siempre el nombre del producto, su código SKU exacto entre backticks (ej. \`FRP-...\`) y su precio CON IVA incluido en pesos chilenos.
   - Si quedan 5 unidades o menos, menciona la cantidad como dato sin presionar.
   - Recomienda el Retiro sin costo en nuestra sucursal ubicada en **Enrique Olivares 224, La Florida, Santiago** o **Despacho por pagar** a domicilio en Santiago y todo Chile.
   - Invita al cliente a escribir la palabra **COMPRAR** si quiere confirmar el pedido.
6. NUNCA menciones nombres de proveedores mayoristas internos (jamás nombres a Soluparts, Global Repuestos ni bodegas externas). Todo el stock y la gestión son de FácilRepuestos.cl.
7. Horario de nuestra sucursal (Enrique Olivares 224, La Florida): lunes a jueves de 9:30 a 18:00, viernes de 9:30 a 17:00 y sábados de 9:30 a 14:00. Domingos y festivos cerrado.
8. Usa negritas (**texto**) solo para destacar el vehículo, el precio con IVA o la palabra **COMPRAR**. No uses títulos largos ni lenguaje robótico.`;

    const ultimosTurnos = (historialMensajes || []).slice(-6).map((m) => ({
      role: m.autor === 'cliente' ? 'user' : 'model',
      parts: [{ text: String(m.texto || '').slice(0, 600) }],
    }));

    const promptTurno =
      `${horaCtx.lineaContextoSistema}\n` +
      `[DATOS VERIFICADOS DEL SISTEMA PARA ESTE TURNO]:\n${contextoSituacion}\n\n` +
      `[MENSAJE DEL CLIENTE]:\n${textoCliente}`;

    const url = `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/global/publishers/google/models/${GEMINI_MODEL}:generateContent`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const resp = await fetch(url, {
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

    if (!resp.ok) {
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
