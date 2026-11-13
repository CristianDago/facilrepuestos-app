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
 * para garantizar que NUNCA viaje el teléfono, correo o nombre personal del cliente final.
 * Ante el proveedor, quien consulta es siempre y únicamente FácilRepuestos.
 */
export function sanitizarTextoParaProveedor(texto = '') {
  if (!texto) return '';
  let limpio = String(texto);
  // Eliminar teléfonos chilenos (+569..., 569..., 9 xxxx xxxx) o secuencias de 8-11 dígitos
  limpio = limpio.replace(/(?:\+?56\s*)?9\s*\d{4}[\s.-]*\d{4}\b/g, '[RESERVADO FÁCILREPUESTOS]');
  limpio = limpio.replace(/\b\d{8,11}\b/g, '[RESERVADO FÁCILREPUESTOS]');
  // Eliminar correos electrónicos
  limpio = limpio.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[RESERVADO FÁCILREPUESTOS]');
  // Eliminar presentaciones con nombre propio ("mi nombre es Juan Pérez", "me llamo...", "soy Juan Pérez")
  limpio = limpio.replace(
    /\b(?:mi\s+nombre\s+es|me\s+llamo|habla\s+con|soy\s+don|atenci[oó]n\s+a)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?/gi,
    'Consulta Mesa Técnica FácilRepuestos'
  );
  limpio = limpio.replace(
    /\b(?:hola\s+)?soy\s+(?!de\b|del\b|un\b|una\b|cliente\b|taller\b|mecanico\b|mec[aá]nico\b)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?/g,
    'Consulta Mesa Técnica FácilRepuestos'
  );
  return limpio.trim();
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
    partes.push(sanitizarMensajeHaciaClienteFinal(respuestaTecnica));
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
 * del proveedor Ailoo (ej. `soluparts_ailoo.escalamientos` o `global_ailoo.escalamientos`).
 * Enmascara siempre el teléfono del cliente usando `ticketRef` (`FRP-ESC-...`).
 */
export async function despacharEscalamientoANodoAiloo(nodo, escalamiento) {
  const targetTable = `${nodo.projectId}.${nodo.datasetId}.${nodo.tablaEscalamientos || 'escalamientos'}`;
  const audioLimpio = sanitizarTextoParaProveedor(escalamiento.transcripcionAudio || '');
  const mensajeLimpio = sanitizarTextoParaProveedor(escalamiento.mensajeCliente || '');
  const motivoLimpio = sanitizarTextoParaProveedor(escalamiento.motivoEscalamiento || '');

  const contextoVehiculo = [
    'Solicitante: FácilRepuestos SpA (Mesa Técnica)',
    escalamiento.patente ? `Patente: ${escalamiento.patente}` : null,
    escalamiento.marcaVehiculo ? `Marca: ${escalamiento.marcaVehiculo}` : null,
    escalamiento.modeloVehiculo ? `Modelo: ${escalamiento.modeloVehiculo}` : null,
    escalamiento.anioVehiculo ? `Año: ${escalamiento.anioVehiculo}` : null,
    escalamiento.motorVehiculo ? `Motor: ${escalamiento.motorVehiculo}` : null,
    escalamiento.vinVehiculo ? `VIN: ${escalamiento.vinVehiculo}` : null,
    audioLimpio ? `Audio transcrito (sanitizado): "${audioLimpio}"` : null,
    escalamiento.candidatoCodigo ? `SKU candidato: ${escalamiento.candidatoCodigo} (${escalamiento.candidatoNombre || ''})` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const bqRow = {
    id: escalamiento.id || escalamiento.ticketRef,
    session_id: `frp-${escalamiento.ticketRef}`,
    canal: 'facilrepuestos_b2b',
    // NUNCA viaja teléfono ni nombre del cliente final hacia Soluparts/Global; el solicitante es FácilRepuestos
    telefono: `FÁCILREPUESTOS (${escalamiento.ticketRef})`,
    mensaje_cliente: mensajeLimpio,
    motivo: motivoLimpio,
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
