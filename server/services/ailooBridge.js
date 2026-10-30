import { google } from 'googleapis';

const IVA_CHILE = 1.19;

/**
 * Calcula el precio neto de venta de FácilRepuestos aplicando el % de margen sobre el costo del proveedor.
 */
export function calcularPrecioPublicoFrp(precioCosto, margenPct = 25) {
  const costo = Number(precioCosto) || 0;
  const margen = Number(margenPct) || 0;
  if (costo <= 0) return 0;
  return Math.round(costo * (1 + margen / 100));
}

/**
 * Genera el SKU público de FácilRepuestos ocultando el código interno del proveedor
 * y evitando colisiones entre Soluparts, Global y Proveedores Locales.
 */
export function generarSkuPublicoFrp(prefijo = 'FRP-LOC', codigoOriginal = '') {
  const cleanCode = String(codigoOriginal || '').trim().toUpperCase();
  if (!cleanCode) return `${prefijo}-SINCOD`;
  const cleanPrefix = String(prefijo || 'FRP-LOC').trim().toUpperCase();
  if (cleanCode.startsWith(`${cleanPrefix}-`)) return cleanCode;
  // Si viene con prefijo corto del proveedor (ej. SOL-94821 o GLB-55210), lo normaliza a FRP-SOL-94821
  const sinPrefijoCorto = cleanCode.replace(/^(SOL|GLB|LOC)-/i, '');
  return `${cleanPrefix}-${sinPrefijoCorto}`;
}

/**
 * Construye el mensaje comercial listo para enviar al cliente final bajo la marca FácilRepuestos.
 */
export function construirMensajeFinalCliente({
  respuestaTecnica,
  nombreRepuesto,
  skuPublicoFrp,
  marcaVehiculo,
  modeloVehiculo,
  anioVehiculo,
  precioVentaFrp,
}) {
  const vehiculoStr = [marcaVehiculo, modeloVehiculo, anioVehiculo].filter(Boolean).join(' ');
  const partes = [
    `¡Confirmado por nuestro equipo técnico de FácilRepuestos${vehiculoStr ? ` para tu ${vehiculoStr}` : ''}!`,
  ];
  if (respuestaTecnica) {
    partes.push(respuestaTecnica.trim());
  }
  if (nombreRepuesto || skuPublicoFrp) {
    partes.push(
      `Repuesto validado: ${nombreRepuesto || 'Repuesto compatible'}${skuPublicoFrp ? ` (SKU: ${skuPublicoFrp})` : ''}.`
    );
  }
  if (Number(precioVentaFrp) > 0) {
    const neto = Math.round(Number(precioVentaFrp));
    const conIva = Math.round(neto * IVA_CHILE);
    partes.push(
      `Valor FácilRepuestos: $${neto.toLocaleString('es-CL')} neto ($${conIva.toLocaleString('es-CL')} IVA incluido).`
    );
  }
  return partes.join(' ');
}

/**
 * Extrae términos clave normalizados (sin tildes, minúsculas) al estilo de validacion.py en Soluparts.
 */
export function generarTerminosClave({
  marcaVehiculo,
  modeloVehiculo,
  motor,
  categoriaRepuesto,
  skuProveedor,
  preguntaResumen,
  respuestaValidada,
}) {
  const raw = [
    marcaVehiculo,
    modeloVehiculo,
    motor,
    categoriaRepuesto,
    skuProveedor,
    preguntaResumen,
    respuestaValidada,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9./\s-]/g, ' ');

  const stopWords = new Set([
    'para', 'con', 'los', 'las', 'del', 'una', 'uno', 'por', 'que', 'como',
    'este', 'esta', 'son', 'tiene', 'hola', 'busco', 'necesito', 'repuesto',
  ]);
  const tokens = [];
  for (const word of raw.split(/\s+/)) {
    if (word.length >= 2 && !stopWords.has(word) && !tokens.includes(word)) {
      tokens.push(word);
    }
    if (tokens.length >= 18) break;
  }
  return tokens.join(' ');
}

/**
 * Despacha un escalamiento técnico hacia la tabla `{projectId}.{datasetId}.escalamientos`
 * del proveedor Ailoo (ej. `soluparts_ailoo.escalamientos` o `global_ailoo.escalamientos`).
 * Enmascara siempre el teléfono del cliente usando `ticketRef` (`FRP-ESC-...`).
 */
export async function despacharEscalamientoANodoAiloo(nodo, escalamiento) {
  const targetTable = `${nodo.projectId}.${nodo.datasetId}.${nodo.tablaEscalamientos || 'escalamientos'}`;
  const contextoVehiculo = [
    escalamiento.patente ? `Patente: ${escalamiento.patente}` : null,
    escalamiento.marcaVehiculo ? `Marca: ${escalamiento.marcaVehiculo}` : null,
    escalamiento.modeloVehiculo ? `Modelo: ${escalamiento.modeloVehiculo}` : null,
    escalamiento.anioVehiculo ? `Año: ${escalamiento.anioVehiculo}` : null,
    escalamiento.motorVehiculo ? `Motor: ${escalamiento.motorVehiculo}` : null,
    escalamiento.vinVehiculo ? `VIN: ${escalamiento.vinVehiculo}` : null,
    escalamiento.transcripcionAudio ? `Audio transcrito: "${escalamiento.transcripcionAudio}"` : null,
    escalamiento.candidatoCodigo ? `SKU candidato: ${escalamiento.candidatoCodigo} (${escalamiento.candidatoNombre || ''})` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const bqRow = {
    id: escalamiento.id || escalamiento.ticketRef,
    session_id: escalamiento.sessionId || `frp-${escalamiento.ticketRef}`,
    canal: 'facilrepuestos',
    telefono: escalamiento.ticketRef, // Anonimizado para proteger al cliente final de FácilRepuestos
    mensaje_cliente: escalamiento.mensajeCliente,
    motivo: escalamiento.motivoEscalamiento,
    respuesta_agente: escalamiento.respuestaAgentePreliminar || '',
    contexto: contextoVehiculo,
    estado: 'pendiente',
    respuesta_mostrador: null,
    respondido_por: null,
    creado_en: escalamiento.creadoEn || new Date().toISOString(),
    respondido_en: null,
  };

  if (process.env.AILOO_BQ_LIVE === 'true') {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/bigquery'],
      });
      const bigquery = google.bigquery({ version: 'v2', auth });
      await bigquery.tabledata.insertAll({
        projectId: nodo.projectId,
        datasetId: nodo.datasetId,
        tableId: nodo.tablaEscalamientos || 'escalamientos',
        requestBody: {
          rows: [{ insertId: bqRow.id, json: bqRow }],
        },
      });
      return {
        federated: true,
        mode: 'bigquery_live',
        targetTable,
        bqRow,
      };
    } catch (err) {
      console.warn(`[AilooBridge] Fallback a simulación local al insertar en ${targetTable}:`, err.message);
    }
  }

  return {
    federated: true,
    mode: 'local_federated_bridge',
    targetTable,
    bqRow,
  };
}
