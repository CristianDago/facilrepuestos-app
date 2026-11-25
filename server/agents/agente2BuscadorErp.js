/**
 * server/agents/agente2BuscadorErp.js
 *
 * AGENTE 2 — BUSCADOR TÉCNICO DE ERP, CLASIFICADOR DE ORIGEN Y ENRUTADOR DE ESCALAMIENTOS
 * ───────────────────────────────────────────────────────────────────────────────────────
 * Responsabilidad única:
 *  - Evaluar los candidatos encontrados en nuestro ERP unificado (`inventario` + `conocimiento_aprendido`).
 *  - Clasificar con precisión quirúrgica si cada producto pertenece a:
 *      A) `stock_propio_olivares_224`: Bodega propia en Enrique Olivares 224, La Florida (ÚNICO que permite pago/retiro presencial directo en La Florida).
 *      B) `soluparts_ailoo`: Nodo Soluparts (`FRP-SOL-*`). Compra siempre en nuestro portal `facilrepuestos.cl`; si compra antes de las 11:30 hrs puede retirar en Enrique Olivares 224 desde las 15:30 hrs del mismo día; si compra después de las 11:30 hrs puede retirar desde las 15:30 hrs del día siguiente; o despacho según dimensión.
 *      C) `proveedor_erp_local`: Otros proveedores con Tenant ERP propio (`FRP-LOC-*`, `FRP-TND-*`).
 *      D) `mesa_whatsapp`: Cotizaciones de terceros por WhatsApp (`FRP-WSP-*`), incluido Global Repuestos u otras tiendas registradas en la Mesa de Abastecimiento.
 *  - Enrutar los escalamientos técnicos exactamente al canal que corresponde según el origen del producto:
 *      1. Si el candidato es de Soluparts -> se carga en `soluparts-mostrador-prod.soluparts.escalamientos` (Soluparts).
 *      2. Si el candidato es de otro proveedor ERP -> se carga en el propio portal ERP de ese proveedor (`tipoDestino: 'proveedor_local'`, `proveedorId`).
 *      3. Si proviene de una cotización de un tercero por WhatsApp de la Mesa de Abastecimiento -> el escalamiento/pregunta técnica se traspasa directamente por WhatsApp desde el +56950960294 a los números específicos de esos proveedores.
 */

export function esItemStockPropioOlivares224(item = {}) {
  const sku = String(item.skuPublicoFrp || item.codigo || '').toUpperCase();
  const nodo = String(item.nodoAilooId || '').toLowerCase();
  const origen = String(item.origen || item.origenDatos || '').toLowerCase();
  const provId = String(item.proveedorId || '').toLowerCase();

  if (
    nodo === 'soluparts' ||
    sku.startsWith('FRP-SOL-') ||
    sku.startsWith('FRP-WSP-') ||
    sku.startsWith('FRP-TND-') ||
    origen.includes('ailoo') ||
    origen.includes('wsp') ||
    origen.includes('mesa_whatsapp') ||
    item.esProductoTemporalWsp === true
  ) {
    return false;
  }

  if (
    origen === 'stock_propio' ||
    origen === 'bodega_local' ||
    provId === 'local' ||
    provId === 'bodega_olivares_224' ||
    sku.startsWith('FRP-OWN-') ||
    sku.startsWith('DRM-')
  ) {
    return true;
  }

  return !item.proveedorId || provId === 'prov-demo-001';
}

export function esItemSoluparts(item = {}) {
  const sku = String(item.skuPublicoFrp || item.codigo || '').toUpperCase();
  const nodo = String(item.nodoAilooId || '').toLowerCase();
  const origen = String(item.origen || item.origenDatos || '').toLowerCase();
  const prov = String(item.proveedorNombre || item.proveedor || '').toLowerCase();

  return (
    nodo === 'soluparts' ||
    origen === 'soluparts_ailoo' ||
    sku.startsWith('FRP-SOL-') ||
    prov.includes('solupart')
  );
}

/**
 * Determina a dónde debe enviarse un escalamiento técnico según el origen del producto o consulta:
 *  - 'nodo_soluparts': Producto de Soluparts -> `soluparts-mostrador-prod.soluparts.escalamientos`
 *  - 'portal_proveedor_erp': Producto de otro proveedor con portal ERP -> bandeja `escalamientos_ia` filtrada por su `proveedorId`
 *  - 'traspaso_wsp_mesa': Cotización de un tercero por WSP en la Mesa de Abastecimiento -> envío directo por WhatsApp a los números específicos de esos proveedores
 */
export function resolverRutaEscalamientoAgente2({
  mejorCandidato = null,
  solicitudesWspAbiertas = [],
} = {}) {
  const sku = String(mejorCandidato?.skuPublicoFrp || mejorCandidato?.codigo || '').toUpperCase();
  const origen = String(mejorCandidato?.origen || mejorCandidato?.origenDatos || '').toLowerCase();

  // Caso 3: Es una cotización de un tercero por WSP de la Mesa de Abastecimiento (o hay solicitud WSP activa sin candidato ERP)
  if (
    mejorCandidato?.esProductoTemporalWsp === true ||
    origen.includes('mesa_whatsapp') ||
    sku.startsWith('FRP-WSP-') ||
    (!mejorCandidato && Array.isArray(solicitudesWspAbiertas) && solicitudesWspAbiertas.length > 0)
  ) {
    return {
      canalEscalamiento: 'traspaso_wsp_mesa',
      tipoDestino: 'mesa_wsp_tercero',
      nodoAilooId: null,
      proveedorId: mejorCandidato?.proveedorId || null,
      proveedorNombre: mejorCandidato?.proveedorNombre || 'Proveedor Mesa Abastecimiento WSP',
    };
  }

  // Caso 1: Producto de Soluparts -> Cargar en Soluparts (`soluparts-mostrador-prod.soluparts.escalamientos`)
  if (!mejorCandidato || esItemSoluparts(mejorCandidato)) {
    return {
      canalEscalamiento: 'nodo_soluparts',
      tipoDestino: 'nodo_ailoo',
      nodoAilooId: 'soluparts',
      datasetDestino: 'soluparts-mostrador-prod.soluparts.escalamientos',
      proveedorId: 'soluparts',
      proveedorNombre: 'Soluparts (Ailoo Enterprise)',
    };
  }

  // Caso 2: Producto de otro proveedor ERP -> Escalar en su propio Portal Proveedor ERP
  return {
    canalEscalamiento: 'portal_proveedor_erp',
    tipoDestino: 'proveedor_local',
    nodoAilooId: null,
    datasetDestino: null,
    proveedorId: mejorCandidato.proveedorId || 'prov-demo-001',
    proveedorNombre: mejorCandidato.proveedorNombre || mejorCandidato.proveedor || 'Portal Proveedor ERP',
  };
}

/**
 * Enriquecer cada candidato encontrado en el catálogo con su bandera estricta de origen y modalidad permitida.
 */
export function clasificarCandidatosErpPorReglaOrigen(candidatos = []) {
  const enriquecidos = (Array.isArray(candidatos) ? candidatos : []).map((c) => {
    const esPropioOlivares = esItemStockPropioOlivares224(c);
    const esSol = esItemSoluparts(c);
    return {
      ...c,
      esStockPropioOlivares224: esPropioOlivares,
      esSoluparts: esSol,
      permitePagoYRetiroEnLaFlorida: esPropioOlivares,
      permiteRetiroSolupartsConCompraWeb: esSol,
      requiereDespachoObligatorio: !esPropioOlivares && !esSol,
    };
  });

  const todosSonStockPropioOlivares =
    enriquecidos.length > 0 && enriquecidos.every((c) => c.esStockPropioOlivares224);
  const algunoEsStockPropioOlivares = enriquecidos.some((c) => c.esStockPropioOlivares224);
  const todosSonSolupartsOPropio =
    enriquecidos.length > 0 &&
    enriquecidos.every((c) => c.esStockPropioOlivares224 || c.esSoluparts);

  return {
    candidatos: enriquecidos,
    todosSonStockPropioOlivares,
    algunoEsStockPropioOlivares,
    todosSonSolupartsOPropio,
  };
}
