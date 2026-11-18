import { google } from 'googleapis';

const IVA_CHILE = 1.19;

/**
 * Calcula el precio neto de venta de FácilRepuestos aplicando el % de margen sobre el costo del proveedor.
 */
export function calcularPrecioPublicoFrp(precioCosto, margenPct = 0) {
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
 * Sanitiza cualquier texto de consulta antes de enviarlo a un proveedor externo (Soluparts, Global o Local)
 * para garantizar que NUNCA viaje el teléfono, correo, nombre personal del cliente final NI ninguna
 * referencia a FácilRepuestos, Repuestín o prefijos FRP. Ante Soluparts es una consulta anónima de mostrador.
 */
export function sanitizarTextoParaProveedor(texto = '') {
  if (!texto) return '';
  let limpio = String(texto);
  // Eliminar teléfonos chilenos (+569..., 569..., 9 xxxx xxxx) o secuencias de 8-11 dígitos
  limpio = limpio.replace(/(?:\+?56\s*)?9\s*\d{4}[\s.-]*\d{4}\b/g, '[DATO RESERVADO]');
  limpio = limpio.replace(/\b\d{8,11}\b/g, '[DATO RESERVADO]');
  // Eliminar correos electrónicos
  limpio = limpio.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[DATO RESERVADO]');
  // Eliminar presentaciones con nombre propio ("mi nombre es Juan Pérez", "me llamo...", "soy Juan Pérez")
  limpio = limpio.replace(
    /\b(?:mi\s+nombre\s+es|me\s+llamo|habla\s+con|soy\s+don|atenci[oó]n\s+a)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?/gi,
    'Cliente'
  );
  limpio = limpio.replace(
    /\b(?:hola\s+)?soy\s+(?!de\b|del\b|un\b|una\b|cliente\b|taller\b|mecanico\b|mec[aá]nico\b)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?/g,
    'Cliente'
  );
  // Eliminar cualquier rastro de FácilRepuestos, Repuestín o prefijos FRP-*
  limpio = limpio.replace(/\b(?:f[aá]cil\s*repuestos(?:\.cl|\s+spa)?|repuest[ií]n|mesa\s+t[eé]cnica\s+f[aá]cilrepuestos)\b/gi, '');
  limpio = limpio.replace(/\bFRP-(?:SOL|GLB|LOC|WSP|EXP)-/gi, '');
  limpio = limpio.replace(/\bFRP-ESC-/gi, 'ESC-');
  return limpio.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Sanitiza cualquier texto técnico proveniente de un proveedor antes de mostrarlo al cliente final,
 * ocultando nombres de proveedores (Soluparts, Global, Importadoras) y sus ubicaciones físicas
 * para evitar bypass comercial.
 */
export function sanitizarMensajeHaciaClienteFinal(texto = '') {
  if (!texto) return '';
  return String(texto)
    .replace(/\b(soluparts_ailoo|global_ailoo|soluparts|solupart|global\s+repuestos)\b/gi, 'FácilRepuestos')
    .replace(/\b(gran\s+avenida(?:\s+parad\.?\s*\d+)?|san\s+bernardo|10\s+de\s+julio|diez\s+de\s+julio|lira\s+\d+)\b/gi, 'Enrique Olivares 224, La Florida, Santiago')
    .trim();
}

/**
 * Construye el mensaje comercial listo para enviar al cliente final bajo la marca FácilRepuestos.
 * Nunca revela qué proveedor tiene el repuesto ni direcciones de terceros; ofrece exclusivamente
 * Despacho a todo Santiago y Chile o Retiro en Enrique Olivares 224, La Florida, Santiago de Chile.
 */
export function construirMensajeFinalCliente({
  respuestaTecnica,
  respuestaMostrador,
  respuestaExperto,
  nombreRepuesto,
  candidatoNombre,
  skuPublicoFrp,
  marcaVehiculo,
  modeloVehiculo,
  anioVehiculo,
  precioVentaFrp,
}) {
  const textoTecnico = respuestaTecnica || respuestaMostrador || respuestaExperto || '';
  const nombreItem = nombreRepuesto || candidatoNombre || '';
  const vehiculoStr = [marcaVehiculo, modeloVehiculo, anioVehiculo].filter(Boolean).join(' ');
  const partes = [
    `¡Confirmado por nuestro equipo técnico de FácilRepuestos${vehiculoStr ? ` para tu ${vehiculoStr}` : ''}!`,
  ];
  if (textoTecnico) {
    partes.push(sanitizarMensajeHaciaClienteFinal(textoTecnico));
  }
  if (nombreItem || skuPublicoFrp) {
    partes.push(
      `Repuesto validado: ${nombreItem || 'Repuesto compatible'}${skuPublicoFrp ? ` (SKU: ${skuPublicoFrp})` : ''}.`
    );
  }
  if (Number(precioVentaFrp) > 0) {
    const neto = Math.round(Number(precioVentaFrp));
    const conIva = Math.round(neto * IVA_CHILE);
    partes.push(
      `Valor FácilRepuestos: $${neto.toLocaleString('es-CL')} neto ($${conIva.toLocaleString('es-CL')} IVA incluido).`
    );
  }
  partes.push(
    'Disponible con despacho a domicilio en Santiago y todo Chile, o retiro en nuestra tienda en Enrique Olivares 224, La Florida, Santiago de Chile.'
  );
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
 * del proveedor Ailoo (ej. `soluparts-mostrador-prod.soluparts.escalamientos` que alimenta `portal.soluparts.cl/escalamiento`).
 * Enmascara siempre el teléfono del cliente usando `ticketRef` (`FRP-ESC-...` / `ESC-...`).
 */
export async function despacharEscalamientoANodoAiloo(nodo, escalamiento) {
  const projectId =
    nodo?.projectId ||
    (nodo?.id === 'soluparts' ? 'soluparts-mostrador-prod' : `${nodo?.id || 'soluparts'}-mostrador-prod`);
  const datasetId =
    nodo?.datasetId === 'soluparts_ailoo' || (!nodo?.datasetId && nodo?.id === 'soluparts')
      ? 'soluparts'
      : nodo?.datasetId || 'soluparts';
  const tableId = nodo?.tablaEscalamientos || 'escalamientos';
  const targetTable = `${projectId}.${datasetId}.${tableId}`;

  const audioLimpio = sanitizarTextoParaProveedor(escalamiento.transcripcionAudio || '');
  const mensajeLimpio = sanitizarTextoParaProveedor(escalamiento.mensajeCliente || '');
  const motivoLimpio = sanitizarTextoParaProveedor(escalamiento.motivoEscalamiento || '');
  const respuestaPrelimLimpia = sanitizarTextoParaProveedor(escalamiento.respuestaAgentePreliminar || '');
  const skuNativoProveedor = String(escalamiento.candidatoCodigo || '')
    .replace(/^FRP-(?:SOL|GLB|LOC|WSP|EXP)-/i, '')
    .trim();

  const contextoVehiculo = [
    escalamiento.patente ? `Patente: ${escalamiento.patente}` : null,
    escalamiento.marcaVehiculo ? `Marca: ${escalamiento.marcaVehiculo}` : null,
    escalamiento.modeloVehiculo ? `Modelo: ${escalamiento.modeloVehiculo}` : null,
    escalamiento.anioVehiculo ? `Año: ${escalamiento.anioVehiculo}` : null,
    escalamiento.motorVehiculo ? `Motor: ${escalamiento.motorVehiculo}` : null,
    escalamiento.vinVehiculo ? `VIN: ${escalamiento.vinVehiculo}` : null,
    audioLimpio ? `Audio transcrito: "${audioLimpio}"` : null,
    skuNativoProveedor ? `SKU consultado: ${skuNativoProveedor} (${escalamiento.candidatoNombre || ''})` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const rawRefCode = String(escalamiento.ticketRef || escalamiento.id || '').trim();
  // Ocultar por completo cualquier rastro de FácilRepuestos o siglas FRP en la tabla de Soluparts
  const neutralRef = rawRefCode.replace(/^FRP-/i, '');
  const bqRow = {
    id: neutralRef,
    session_id: `wsp-${neutralRef.toLowerCase()}`,
    canal: 'whatsapp',
    // Jamás se muestra ni el teléfono del cliente ni el nombre de FácilRepuestos
    telefono: `Consulta #${neutralRef}`,
    mensaje_cliente: mensajeLimpio,
    motivo: motivoLimpio,
    respuesta_agente: respuestaPrelimLimpia,
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
        scopes: ['https://www.googleapis.com/auth/bigquery', 'https://www.googleapis.com/auth/cloud-platform'],
      });
      const bigquery = google.bigquery({ version: 'v2', auth });
      await bigquery.tabledata.insertAll({
        projectId,
        datasetId,
        tableId,
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

/**
 * Consulta en BigQuery (`soluparts-mostrador-prod.soluparts.escalamientos`) si los tickets enviados
 * desde FácilRepuestos ya fueron respondidos por el mostrador en `portal.soluparts.cl/escalamiento`.
 */
export async function consultarRespuestasEscalamientosEnBigQuery(nodo, ticketRefs = []) {
  const respuestasPorTicket = new Map();
  if (process.env.AILOO_BQ_LIVE !== 'true' || !Array.isArray(ticketRefs) || ticketRefs.length === 0) {
    return { rows: [], respuestasPorTicket };
  }

  const projectId =
    nodo?.projectId ||
    (nodo?.id === 'soluparts' ? 'soluparts-mostrador-prod' : `${nodo?.id || 'soluparts'}-mostrador-prod`);
  const datasetId =
    nodo?.datasetId === 'soluparts_ailoo' || (!nodo?.datasetId && nodo?.id === 'soluparts')
      ? 'soluparts'
      : nodo?.datasetId || 'soluparts';
  const tableId = nodo?.tablaEscalamientos || 'escalamientos';
  const fullTable = `${projectId}.${datasetId}.${tableId}`;

  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/bigquery', 'https://www.googleapis.com/auth/cloud-platform'],
    });
    const bigquery = google.bigquery({ version: 'v2', auth });
    const bqJobProjectId = process.env.FIREBASE_PROJECT_ID || 'facilrepuestos-prod';

    const idsSet = new Set();
    for (const raw of ticketRefs) {
      const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!clean) continue;
      idsSet.add(clean);
      idsSet.add(clean.replace(/^FRP-/i, ''));
    }
    const idsLimpios = [...idsSet].filter(Boolean);
    if (idsLimpios.length === 0) return { rows: [], respuestasPorTicket };

    const inList = idsLimpios.map((id) => `'${id}'`).join(', ');
    const sessionList = idsLimpios
      .flatMap((id) => [`'wsp-${id.toLowerCase()}'`, `'frp-${id}'`])
      .join(', ');
    const query = `
      SELECT
        CAST(id AS STRING) AS id,
        CAST(session_id AS STRING) AS session_id,
        CAST(estado AS STRING) AS estado,
        CAST(respuesta_mostrador AS STRING) AS respuesta_mostrador,
        CAST(respondido_por AS STRING) AS respondido_por,
        CAST(respondido_en AS STRING) AS respondido_en
      FROM \`${fullTable}\`
      WHERE (CAST(id AS STRING) IN (${inList}) OR CAST(session_id AS STRING) IN (${sessionList}))
        AND (LOWER(IFNULL(estado, '')) = 'respondido' OR (respuesta_mostrador IS NOT NULL AND TRIM(respuesta_mostrador) != ''))
    `;

    const res = await bigquery.jobs.query({
      projectId: bqJobProjectId,
      requestBody: {
        query,
        useLegacySql: false,
        location: 'southamerica-west1',
        timeoutMs: 15000,
      },
    });

    const fields = res.data.schema?.fields || [];
    const rows = (res.data.rows || []).map((r) => {
      const obj = {};
      r.f.forEach((cell, i) => {
        obj[fields[i]?.name || `col_${i}`] = cell.v;
      });
      return obj;
    });

    for (const row of rows) {
      const rawId = String(row.id || '').trim().toUpperCase();
      const neutralId = rawId.replace(/^FRP-/i, '');
      const normalized = {
        id: row.id,
        sessionId: row.session_id,
        estado: row.estado || 'respondido',
        respuestaMostrador: String(row.respuesta_mostrador || '').trim(),
        respondidoPor: row.respondido_por || 'Mostrador',
        respondidoEn: row.respondido_en || new Date().toISOString(),
      };
      if (rawId) respuestasPorTicket.set(rawId, normalized);
      if (neutralId) {
        respuestasPorTicket.set(neutralId, normalized);
        respuestasPorTicket.set(`FRP-${neutralId}`, normalized);
      }
    }

    return { rows, respuestasPorTicket };
  } catch (err) {
    console.warn(`[AilooBridge] Aviso consultando respuestas en ${fullTable}:`, err.message);
    return { rows: [], respuestasPorTicket };
  }
}
