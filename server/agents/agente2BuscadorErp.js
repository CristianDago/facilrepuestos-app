/**
 * server/agents/agente2BuscadorErp.js
 *
 * AGENTE 2 — BUSCADOR TÉCNICO DE ERP Y CLASIFICADOR DE ORIGEN DE STOCK
 * ─────────────────────────────────────────────────────────────────────
 * Responsabilidad única:
 *  - Evaluar los candidatos encontrados en nuestro ERP unificado (`inventario` + `conocimiento_aprendido`).
 *  - Clasificar con precisión quirúrgica si cada producto pertenece a:
 *      A) `stock_propio_olivares_224`: Bodega propia en Enrique Olivares 224, La Florida (ÚNICO que permite pago/retiro presencial en La Florida).
 *      B) `proveedor_externo_erp`: Soluparts (`FRP-SOL-*`), Global (`FRP-GLB-*`), ERPs asociados o Mesa WSP (`FRP-WSP-*`), donde TODO va con Despacho y se compra por el link de la tienda.
 */

export function esItemStockPropioOlivares224(item = {}) {
  const sku = String(item.skuPublicoFrp || item.codigo || '').toUpperCase();
  const nodo = String(item.nodoAilooId || '').toLowerCase();
  const origen = String(item.origen || item.origenDatos || '').toLowerCase();
  const provId = String(item.proveedorId || '').toLowerCase();

  if (
    nodo === 'soluparts' ||
    nodo === 'global' ||
    sku.startsWith('FRP-SOL-') ||
    sku.startsWith('FRP-GLB-') ||
    sku.startsWith('FRP-WSP-') ||
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

/**
 * Enriquecer cada candidato encontrado en el catálogo con su bandera estricta de origen y modalidad permitida.
 */
export function clasificarCandidatosErpPorReglaOrigen(candidatos = []) {
  const enriquecidos = (Array.isArray(candidatos) ? candidatos : []).map((c) => {
    const esPropioOlivares = esItemStockPropioOlivares224(c);
    return {
      ...c,
      esStockPropioOlivares224: esPropioOlivares,
      permitePagoYRetiroEnLaFlorida: esPropioOlivares,
      requiereDespachoObligatorio: !esPropioOlivares,
    };
  });

  const todosSonStockPropioOlivares =
    enriquecidos.length > 0 && enriquecidos.every((c) => c.esStockPropioOlivares224);
  const algunoEsStockPropioOlivares = enriquecidos.some((c) => c.esStockPropioOlivares224);

  return {
    candidatos: enriquecidos,
    todosSonStockPropioOlivares,
    algunoEsStockPropioOlivares,
  };
}
