import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../services/api';
import { cotizacionesService } from '../../services/cotizaciones';
import { ordenesService } from '../../services/ordenes';
import { vehiculosService } from '../../services/vehiculos';
import { inventarioService } from '../../services/inventario';
import {
  ingresoRealOT,
  type ApiResponse,
  type EscalamientoIA,
  type NodoAiloo,
  type Proveedor,
  type SesionAgenteOmnicanal,
  type SolicitudCotizacionWsp,
} from '../../types';
import styles from './Dashboard.module.css';

interface RespuestaSesionesOmnicanal {
  sesiones: SesionAgenteOmnicanal[];
}

interface RespuestaMesaWsp {
  credencialesMetaActivas: boolean;
  modoOperacionMeta: 'meta_cloud_api_live' | 'simulacion_meta_local';
  solicitudes: SolicitudCotizacionWsp[];
  proveedoresWsp: Proveedor[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    cotizaciones,
    ordenes,
    vehiculos,
    inventario,
    setCotizaciones,
    setOrdenes,
    setVehiculos,
    setInventario,
    setLoading,
    notify,
  } = useAppStore();

  const [modoVista, setModoVista] = useState<'repuestos' | 'taller'>('repuestos');
  const [sesionesWsp, setSesionesWsp] = useState<SesionAgenteOmnicanal[]>([]);
  const [solicitudesMesa, setSolicitudesMesa] = useState<SolicitudCotizacionWsp[]>([]);
  const [proveedoresWsp, setProveedoresWsp] = useState<Proveedor[]>([]);
  const [modoMeta, setModoMeta] = useState<'meta_cloud_api_live' | 'simulacion_meta_local'>(
    'meta_cloud_api_live'
  );
  const [escalamientos, setEscalamientos] = useState<EscalamientoIA[]>([]);
  const [nodosAiloo, setNodosAiloo] = useState<NodoAiloo[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    setRefreshing(true);
    try {
      const [
        invRes,
        sesRes,
        mesaRes,
        escRes,
        nodosRes,
        cotsRes,
        ordsRes,
        vehsRes,
      ] = await Promise.all([
        inventarioService.getAll().catch(() => null),
        api.get<ApiResponse<RespuestaSesionesOmnicanal>>('/agente-omnicanal/sesiones').catch(() => null),
        api.get<ApiResponse<RespuestaMesaWsp>>('/mesa-wsp/solicitudes').catch(() => null),
        api.get<ApiResponse<EscalamientoIA[]>>('/escalamientos').catch(() => null),
        api.get<ApiResponse<NodoAiloo[]>>('/escalamientos/nodos').catch(() => null),
        cotizacionesService.getAll().catch(() => null),
        ordenesService.getAll().catch(() => null),
        vehiculosService.getAll().catch(() => null),
      ]);

      if (invRes?.success && invRes.data) setInventario(invRes.data);
      if (sesRes?.success && sesRes.data) setSesionesWsp(sesRes.data.sesiones || []);
      if (mesaRes?.success && mesaRes.data) {
        setSolicitudesMesa(mesaRes.data.solicitudes || []);
        setProveedoresWsp(mesaRes.data.proveedoresWsp || []);
        if (mesaRes.data.modoOperacionMeta) setModoMeta(mesaRes.data.modoOperacionMeta);
      }
      if (escRes?.success && escRes.data) setEscalamientos(escRes.data);
      if (nodosRes?.success && nodosRes.data) setNodosAiloo(nodosRes.data);
      if (cotsRes?.success && cotsRes.data) setCotizaciones(cotsRes.data);
      if (ordsRes?.success && ordsRes.data) setOrdenes(ordsRes.data);
      if (vehsRes?.success && vehsRes.data) setVehiculos(vehsRes.data);
    } catch (e) {
      console.error(e);
      notify('Error al actualizar el centro de mando', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

  // ─── MÉTRICAS DE REPUESTOS & OMNICANALIDAD ─────────────────
  const statsRepuestos = useMemo(() => {
    const totalSkus = inventario.length;
    let conStock = 0;
    let stockCritico = 0;
    let agotados = 0;
    let sincronizadosWoo = 0;
    let unidadesTotales = 0;
    let valorVentaConIva = 0;

    for (const item of inventario) {
      const disp = Math.max(0, (item.stock || 0) - (item.stockReservado || 0));
      const min = item.stockMinimo && item.stockMinimo > 0 ? item.stockMinimo : 2;
      unidadesTotales += disp;
      valorVentaConIva += disp * Math.round((item.precioVenta || 0) * 1.19);
      if (disp > 0) conStock++;
      if (disp === 0) agotados++;
      else if (disp <= min) stockCritico++;
      if (item.wooProductId || !item.ocultarEnTienda) sincronizadosWoo++;
    }

    const sesionesConCarrito = sesionesWsp.filter(
      (s) => (s.carritoCotizado && s.carritoCotizado.length > 0) || s.pedidoActivo
    );
    const pedidosConsolidados = sesionesWsp.filter((s) => Boolean(s.pedidoActivo));
    const mesaAbiertas = solicitudesMesa.filter(
      (m) => m.estado === 'esperando_respuestas' || m.estado === 'con_ofertas'
    );
    const mesaConOfertas = solicitudesMesa.filter((m) => m.estado === 'con_ofertas');
    const escalamientosPendientes = escalamientos.filter(
      (e) => e.estado === 'pendiente' || e.estado === 'en_revision'
    );

    return {
      totalSkus,
      conStock,
      stockCritico,
      agotados,
      sincronizadosWoo,
      unidadesTotales,
      valorVentaConIva,
      sesionesConCarrito: sesionesConCarrito.length,
      pedidosConsolidados: pedidosConsolidados.length,
      mesaAbiertas: mesaAbiertas.length,
      mesaConOfertas: mesaConOfertas.length,
      escalamientosPendientes: escalamientosPendientes.length,
    };
  }, [inventario, sesionesWsp, solicitudesMesa, escalamientos]);

  // Repuestos con stock bajo (entre 1 y stockMinimo) o agotados relevantes para reposición
  const itemsStockBajo = useMemo(() => {
    return inventario
      .filter((i) => {
        const disp = Math.max(0, (i.stock || 0) - (i.stockReservado || 0));
        const min = i.stockMinimo && i.stockMinimo > 0 ? i.stockMinimo : 2;
        return disp > 0 && disp <= min;
      })
      .slice(0, 6);
  }, [inventario]);

  // ─── MÉTRICAS DE TALLER & AUTOS (CONSERVADAS 100%) ─────────
  const vendidas = cotizaciones.filter((c) => c.estado === 'Aprobada');
  const entregadas = ordenes.filter((o) => o.estado === 'Entregado');
  const otAbiertas = ordenes.filter((o) => o.estado !== 'Entregado');
  const ingresos = entregadas.reduce((s, o) => s + ingresoRealOT(o), 0);
  const conMargen = vendidas.filter((c) => (c.totalCostos || 0) > 0);
  const margenProm = conMargen.length
    ? conMargen.reduce((s, c) => s + ((c.total - c.totalCostos) / c.total) * 100, 0) /
      conMargen.length
    : null;

  const badgeOT = (estado: string) =>
    estado === 'Recibido'
      ? 'badge-recibido'
      : estado === 'En Proceso'
      ? 'badge-proceso'
      : estado === 'Listo'
      ? 'badge-listo'
      : 'badge-entregado';

  return (
    <div>
      {/* ── ENCABEZADO CON SELECTOR DE MODO DUAL ────────────── */}
      <div className={`page-header ${styles.headerBar}`}>
        <div>
          <div className="page-title">
            {modoVista === 'repuestos' ? (
              <>
                Centro de Mando <span>FácilRepuestos & Omnicanal</span>
              </>
            ) : (
              <>
                Módulo <span>Taller Mecánico & Autos</span>
              </>
            )}
          </div>
          <div className={styles.headerSubtitle}>
            {modoVista === 'repuestos'
              ? 'Operación en vivo de Repuestín WhatsApp (+56 9 2110 9851), Catálogo WooCommerce, Bodegas Ailoo y Mesa de Abastecimiento'
              : 'Gestión de Órdenes de Trabajo (OT), Cotizaciones de Taller y Padrón de Vehículos'}
          </div>
        </div>

        <div className={styles.headerControls}>
          <div className={styles.modeSwitchGroup}>
            <button
              type="button"
              className={`${styles.modeSwitchBtn} ${
                modoVista === 'repuestos' ? styles.modeSwitchActive : ''
              }`}
              onClick={() => setModoVista('repuestos')}
            >
              📦 Modo Repuestos & Omnicanal
            </button>
            <button
              type="button"
              className={`${styles.modeSwitchBtn} ${
                modoVista === 'taller' ? styles.modeSwitchActive : ''
              }`}
              onClick={() => setModoVista('taller')}
            >
              🔧 Modo Taller & Autos ({otAbiertas.length} OT)
            </button>
          </div>

          <button
            className="btn btn-dark btn-sm"
            onClick={loadAll}
            disabled={refreshing}
          >
            {refreshing ? '↻ Actualizando...' : '↻ Actualizar'}
          </button>
        </div>
      </div>

      {modoVista === 'repuestos' ? (
        <>
          {/* ── BANNER DE OPERACIÓN OMNICANAL EN VIVO ─────────── */}
          <div className={styles.omniStatusBanner}>
            <div className={styles.omniStatusLeft}>
              <span className={styles.liveDot} />
              <div>
                <div className={styles.omniStatusTitle}>
                  Repuestín WhatsApp Cloud API (+56 9 2110 9851) ·{' '}
                  <span className={styles.omniStatusHighlight}>
                    {modoMeta === 'meta_cloud_api_live'
                      ? 'CONECTADO EN PRODUCCIÓN'
                      : 'ACTIVO'}
                  </span>
                </div>
                <div className={styles.omniStatusMeta}>
                  Links directos a ficha en <strong>facilrepuestos.cl</strong> · Carro consolidado automático al confirmar <strong>COMPRAR</strong> · Sucursal Retiro y Despacho: <strong>Enrique Olivares 224, La Florida</strong>
                </div>
              </div>
            </div>
            <div className={styles.omniStatusActions}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/agente-omnicanal')}
              >
                🤖 Abrir Repuestín WSP
              </button>
              <button
                className="btn btn-dark btn-sm"
                onClick={() => navigate('/pos')}
              >
                🛒 Punto de Venta POS
              </button>
              <a
                href="https://facilrepuestos.cl"
                target="_blank"
                rel="noreferrer"
                className={`btn btn-sm ${styles.webLinkBtn}`}
              >
                🌐 Ver facilrepuestos.cl ↗
              </a>
            </div>
          </div>

          {/* ── 6 KPIs PROTAGONISTAS DEL RUBRO REPUESTOS ──────── */}
          <div className={styles.statsGrid}>
            <div
              className={`stat-card ${styles.cardInteractive}`}
              onClick={() => navigate('/inventario')}
            >
              <div className="stat-value">
                {statsRepuestos.totalSkus.toLocaleString('es-CL')}
              </div>
              <div className="stat-label">SKUs en Catálogo Activo</div>
              <div className={styles.statSubtext}>
                {statsRepuestos.conStock.toLocaleString('es-CL')} con stock inmediato ({statsRepuestos.unidadesTotales.toLocaleString('es-CL')} un.)
              </div>
            </div>

            <div
              className={`stat-card ${styles.cardInteractive}`}
              onClick={() => navigate('/agente-omnicanal')}
            >
              <div className={`stat-value ${styles.statWspColor}`}>
                {sesionesWsp.length}
              </div>
              <div className="stat-label">Conversaciones Repuestín</div>
              <div className={styles.statSubtext}>
                {statsRepuestos.sesionesConCarrito} con carrito · {statsRepuestos.pedidosConsolidados} pedidos web
              </div>
            </div>

            <div
              className={`stat-card ${styles.cardInteractive}`}
              onClick={() => navigate('/mesa-wsp')}
            >
              <div className={`stat-value ${styles.statWarningColor}`}>
                {statsRepuestos.mesaAbiertas}
              </div>
              <div className="stat-label">Mesa Cotización WSP</div>
              <div className={styles.statSubtext}>
                {statsRepuestos.mesaConOfertas > 0
                  ? `${statsRepuestos.mesaConOfertas} con ofertas listas para adjudicar`
                  : `${solicitudesMesa.length} búsquedas totales a proveedores`}
              </div>
            </div>

            <div
              className={`stat-card ${styles.cardInteractive}`}
              onClick={() => navigate('/agente-omnicanal')}
            >
              <div className="stat-value">
                {statsRepuestos.sesionesConCarrito}
              </div>
              <div className="stat-label">Carros Cotizados Activos</div>
              <div className={styles.statSubtext}>
                {statsRepuestos.pedidosConsolidados} pedidos consolidados listos
              </div>
            </div>

            <div
              className={`stat-card ${styles.cardInteractive}`}
              onClick={() => navigate('/inventario')}
            >
              <div className={`stat-value ${styles.statAlertColor}`}>
                {statsRepuestos.stockCritico}
              </div>
              <div className="stat-label">Stock Bajo (Reposición)</div>
              <div className={styles.statSubtext}>
                {statsRepuestos.agotados} agotados · Revisar alertas
              </div>
            </div>

            <div
              className={`stat-card dark ${styles.cardInteractive}`}
              onClick={() => navigate('/proveedores')}
            >
              <div className={`stat-value ${styles.statValorStock}`}>
                {nodosAiloo.length > 0 ? `${nodosAiloo.length} Nodos` : 'Activo'}
              </div>
              <div className={`stat-label ${styles.statMargenLabel}`}>
                Bodegas Ailoo & Proveedores
              </div>
              <div className={styles.statSubtextDark}>
                {proveedoresWsp.length} proveedores WSP conectados
              </div>
            </div>
          </div>

          {/* ── BLOQUES PROTAGONISTAS EN 2 COLUMNAS ───────────── */}
          <div className={styles.tablasGrid}>
            {/* BLOQUE 1: CENTRO DE MANDO REPUESTÍN & WHATSAPP EN VIVO */}
            <div className={styles.tableCard}>
              <div className={styles.tableCardHeader}>
                <div>
                  <div className={styles.tableCardTitle}>
                    🤖 Centro de Mando Repuestín & WhatsApp en Vivo
                  </div>
                  <div className={styles.tableCardSubtitle}>
                    Conversaciones de clientes, patentes detectadas, carritos enviados y órdenes consolidadas
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate('/agente-omnicanal')}
                >
                  Abrir CRM WhatsApp →
                </button>
              </div>

              <div className={`tbl-wrap ${styles.tblScrollLarge}`}>
                <table className={styles.tblCompacta}>
                  <thead>
                    <tr>
                      <th>Cliente / Canal</th>
                      <th>Vehículo (Boostr)</th>
                      <th>Cotización / Carrito</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sesionesWsp.slice(0, 7).map((s) => {
                      const veh = s.vehiculoContexto;
                      const cantCarrito = s.carritoCotizado?.length || 0;
                      const totalCarrito = (s.carritoCotizado || []).reduce(
                        (acc, it) =>
                          acc +
                          (it.precioVentaConIva || Math.round((it.precioVentaNeto || 0) * 1.19)) *
                            (it.cantidad || 1),
                        0
                      );
                      const tieneMesa = (s.solicitudesWspAbiertas?.length || 0) > 0;

                      return (
                        <tr
                          key={s.id}
                          className={styles.rowClickable}
                          onClick={() => navigate('/agente-omnicanal')}
                        >
                          <td data-label="Cliente">
                            <div className={styles.cellMainText}>
                              {s.clienteNombre || 'Cliente WhatsApp'}
                            </div>
                            <div className={styles.cellSubText}>
                              {s.clienteTelefono || s.canal}
                            </div>
                          </td>
                          <td data-label="Vehículo">
                            {veh ? (
                              <>
                                <span className="patente-cell">
                                  {veh.patente || veh.marca}
                                </span>
                                <div className={styles.cellSubText}>
                                  {veh.marca} {veh.modelo || ''}{' '}
                                  {veh.anio ? `(${veh.anio})` : ''}
                                </div>
                              </>
                            ) : (
                              <span className={styles.cellSubText}>Sin patente aún</span>
                            )}
                          </td>
                          <td data-label="Carrito">
                            {s.pedidoActivo ? (
                              <div>
                                <div className={styles.priceHighlight}>
                                  {fmtCLP(s.pedidoActivo.totalConIva)}
                                </div>
                                <div className={styles.cellSubText}>
                                  Orden {s.pedidoActivo.codigoPedido}
                                </div>
                              </div>
                            ) : cantCarrito > 0 ? (
                              <div>
                                <div className={styles.cellMainText}>
                                  {cantCarrito} {cantCarrito === 1 ? 'repuesto' : 'repuestos'} ·{' '}
                                  {fmtCLP(totalCarrito)}
                                </div>
                                <div className={styles.cellSubText}>
                                  {(s.carritoCotizado || [])
                                    .slice(0, 2)
                                    .map((c) => c.nombre.split(' para ')[0])
                                    .join(', ')}
                                </div>
                              </div>
                            ) : (
                              <span className={styles.cellSubText}>
                                {s.mensajes?.length || 0} mensajes en chat
                              </span>
                            )}
                          </td>
                          <td data-label="Estado">
                            {s.pedidoActivo ? (
                              <span className="badge badge-sold">
                                🛒 Carro Creado
                              </span>
                            ) : tieneMesa ? (
                              <span className="badge badge-proceso">
                                📲 En Abastecimiento
                              </span>
                            ) : cantCarrito > 0 ? (
                              <span className="badge badge-listo">
                                ✓ Cotizado en WSP
                              </span>
                            ) : (
                              <span className="badge badge-pending">En consulta</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {sesionesWsp.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>
                          Sin conversaciones registradas todavía
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Sub-bloque: Reglas de Atención y Logística Activas en Repuestín */}
              <div className={styles.subSectionDivider}>
                <div className={styles.subSectionHeader}>
                  <span>
                    ⏱️ Reglas Operativas Activas en Repuestín WhatsApp (+56 9 2110 9851)
                  </span>
                  <button
                    className={styles.linkActionBtn}
                    onClick={() => navigate('/agente-omnicanal')}
                  >
                    Abrir Monitor →
                  </button>
                </div>
                <div className={styles.allClearBox}>
                  ✓ <strong>Espera inteligente 5 seg.</strong> para unir mensajes seguidos ·{' '}
                  <strong>Retiro Enrique Olivares 224:</strong> Stock propio inmediato, Portal proveedor 1h 30m, Soluparts 15:00 hrs (compras antes de 12:00 mismo día; después de 12:00 al día siguiente) ·{' '}
                  <strong>Delivery Santiago:</strong> 2 horas (L-V 09:00 a 18:00; compras tras 16:00 hrs al día siguiente).
                </div>
              </div>
            </div>

            {/* BLOQUE 2: RESUMEN DE CATÁLOGO, STOCK Y ABASTECIMIENTO WSP */}
            <div className={styles.tableCard}>
              <div className={styles.tableCardHeader}>
                <div>
                  <div className={styles.tableCardTitle}>
                    📦 Catálogo, Stock & Mesa de Abastecimiento WSP
                  </div>
                  <div className={styles.tableCardSubtitle}>
                    Búsqueda de repuestos faltantes con proveedores y estado de bodegas Ailoo / WooCommerce
                  </div>
                </div>
                <button
                  className="btn btn-dark btn-sm"
                  onClick={() => navigate('/mesa-wsp')}
                >
                  Mesa WSP →
                </button>
              </div>

              {/* Estado de Nodos Ailoo & Catálogo */}
              <div className={styles.nodesSummaryStrip}>
                {nodosAiloo.map((nodo) => (
                  <div
                    key={nodo.id}
                    className={styles.nodeMiniCard}
                    onClick={() => navigate('/escalamientos-ia')}
                  >
                    <div className={styles.nodeMiniTop}>
                      <span className={styles.nodePrefixBadge}>{nodo.prefijoSku}</span>
                      <span className={styles.nodeName}>{nodo.nombre}</span>
                      <span className={styles.nodeMarginPill}>
                        Margen +{nodo.margenPct}%
                      </span>
                    </div>
                    <div className={styles.nodeMiniMeta}>
                      Dataset: <code>{nodo.datasetId}</code> ·{' '}
                      {nodo.ultimoResumenCatalogo?.totalLeidos
                        ? `${nodo.ultimoResumenCatalogo.totalLeidos.toLocaleString('es-CL')} SKUs leídos`
                        : 'Conectado a BigQuery / Firestore'}
                    </div>
                  </div>
                ))}
                {nodosAiloo.length === 0 && (
                  <div
                    className={styles.nodeMiniCard}
                    onClick={() => navigate('/inventario')}
                  >
                    <div className={styles.nodeMiniTop}>
                      <span className={styles.nodePrefixBadge}>FRP-SOL</span>
                      <span className={styles.nodeName}>
                        Catálogo Unificado FácilRepuestos + WooCommerce
                      </span>
                    </div>
                    <div className={styles.nodeMiniMeta}>
                      {statsRepuestos.totalSkus.toLocaleString('es-CL')} SKUs sincronizados con imágenes de estudio limpias
                    </div>
                  </div>
                )}
              </div>

              {/* Tabla de Solicitudes en Mesa de Abastecimiento WSP */}
              <div className={styles.subTableTitleRow}>
                <span>📲 Solicitudes Activas en Mesa de Cotización WSP (Repuestos Faltantes)</span>
                <button
                  className={styles.linkActionBtn}
                  onClick={() => navigate('/mesa-wsp')}
                >
                  + Nueva Búsqueda
                </button>
              </div>
              <div className={`tbl-wrap ${styles.tblScrollMedium}`}>
                <table className={styles.tblCompacta}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Vehículo</th>
                      <th>Repuesto Buscado</th>
                      <th>Estado / Ofertas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solicitudesMesa.slice(0, 5).map((sol) => (
                      <tr
                        key={sol.id}
                        className={styles.rowClickable}
                        onClick={() => navigate('/mesa-wsp')}
                      >
                        <td data-label="Código">
                          <span className={styles.ticketBadge}>
                            {sol.codigoSolicitud}
                          </span>
                        </td>
                        <td data-label="Vehículo">
                          <div className={styles.cellMainText}>
                            {sol.marcaVehiculo} {sol.modeloVehiculo}{' '}
                            {sol.anioVehiculo || ''}
                          </div>
                          <div className={styles.cellSubText}>{sol.patente}</div>
                        </td>
                        <td data-label="Repuesto">
                          <div className={styles.cellMainText}>
                            {sol.repuestoBuscado}
                          </div>
                          <div className={styles.cellSubText}>
                            {sol.proveedoresContactados?.length || 0} proveedores contactados
                          </div>
                        </td>
                        <td data-label="Estado">
                          {sol.estado === 'adjudicada' ? (
                            <span className="badge badge-sold">✓ Adjudicada</span>
                          ) : (sol.ofertasRecibidas?.length || 0) > 0 ? (
                            <span className="badge badge-listo">
                              {sol.ofertasRecibidas.length} Oferta(s) lista(s)
                            </span>
                          ) : (
                            <span className="badge badge-pending">
                              Buscando en bodegas...
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {solicitudesMesa.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>
                          Sin solicitudes abiertas en Mesa de Cotización WSP
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Sub-bloque: Alertas de Stock Bajo en Catálogo */}
              <div className={styles.subSectionDivider}>
                <div className={styles.subSectionHeader}>
                  <span>
                    ⚠️ Repuestos con Stock Crítico ({statsRepuestos.stockCritico} ítems con pocas unidades)
                  </span>
                  <button
                    className={styles.linkActionBtn}
                    onClick={() => navigate('/inventario')}
                  >
                    Ir a Inventario →
                  </button>
                </div>
                {itemsStockBajo.length > 0 ? (
                  <div className={styles.stockAlertGrid}>
                    {itemsStockBajo.map((item) => {
                      const disp = Math.max(
                        0,
                        (item.stock || 0) - (item.stockReservado || 0)
                      );
                      return (
                        <div
                          key={item.id || item.codigo}
                          className={styles.stockAlertChip}
                          onClick={() => navigate('/inventario')}
                        >
                          <div className={styles.stockAlertTop}>
                            <span className={styles.ticketBadge}>
                              {item.skuPublicoFrp || item.codigo}
                            </span>
                            <span className={styles.stockAlertCount}>
                              Quedan {disp} un.
                            </span>
                          </div>
                          <div className={styles.stockAlertName}>{item.nombre}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.allClearBox}>
                    ✓ Stock saludable en los SKUs activos del catálogo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ── MODO TALLER MECÁNICO & AUTOS (CONSERVADO 100% INTACTO) ── */
        <>
          <div className={styles.tallerQuickBar}>
            <div className={styles.tallerQuickText}>
              <strong>Módulo Taller Mecánico & Autos:</strong> Gestiona cotizaciones de servicio, órdenes de trabajo (OT), planes de mantenimiento y padrón de vehículos.
            </div>
            <div className={styles.tallerQuickButtons}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/cotizaciones/nueva')}
              >
                + Nueva Cotización Taller
              </button>
              <button
                className="btn btn-dark btn-sm"
                onClick={() => navigate('/ordenes/nueva')}
              >
                + Nueva Orden de Trabajo (OT)
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => navigate('/vehiculos')}
              >
                🚗 Padrón Vehículos
              </button>
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className="stat-card">
              <div className="stat-value">{vehiculos.length}</div>
              <div className="stat-label">Vehículos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{cotizaciones.length}</div>
              <div className="stat-label">Cotizaciones</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{ordenes.length}</div>
              <div className="stat-label">Órdenes de Trabajo</div>
            </div>
            <div className="stat-card">
              <div className={`stat-value ${styles.statOtAbiertas}`}>
                {otAbiertas.length}
              </div>
              <div className="stat-label">OT Abiertas</div>
            </div>
            <div className="stat-card">
              <div className={`stat-value ${styles.statIngresos}`}>
                {fmtCLP(ingresos)}
              </div>
              <div className="stat-label">Ingresos Reales (Entregado)</div>
            </div>
            <div className="stat-card dark">
              <div
                className={`stat-value ${
                  margenProm === null
                    ? styles.margenNulo
                    : margenProm >= 30
                    ? 'margin-good'
                    : margenProm >= 15
                    ? 'margin-mid'
                    : 'margin-low'
                }`}
              >
                {margenProm !== null ? `${margenProm.toFixed(1)}%` : '—'}
              </div>
              <div className={`stat-label ${styles.statMargenLabel}`}>
                Margen Promedio
              </div>
            </div>
          </div>

          <div className={styles.tablasGrid}>
            {/* Últimas cotizaciones */}
            <div className={styles.tableCard}>
              <div className={styles.tableCardHeader}>
                <div className={styles.tableCardTitle}>Últimas Cotizaciones</div>
                <button
                  className="btn btn-dark btn-sm"
                  onClick={() => navigate('/cotizaciones')}
                >
                  Ver todas →
                </button>
              </div>
              <div className={`tbl-wrap ${styles.tblScroll}`}>
                <table className={styles.tblCompacta}>
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Patente</th>
                      <th className="r">Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotizaciones.slice(0, 5).map((c) => (
                      <tr
                        key={c.id}
                        className={styles.rowClickable}
                        onClick={() => navigate('/cotizaciones')}
                      >
                        <td className="num-cell" data-label="N°">
                          {c.numero}
                        </td>
                        <td className="patente-cell" data-label="Patente">
                          {c.patente}
                        </td>
                        <td className="r price-cell" data-label="Total">
                          {fmtCLP(c.total)}
                        </td>
                        <td data-label="Estado">
                          <span
                            className={`badge ${
                              c.estado === 'Aprobada'
                                ? 'badge-sold'
                                : 'badge-pending'
                            }`}
                          >
                            {c.estado}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {cotizaciones.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>
                          Sin cotizaciones
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* OT activas */}
            <div className={styles.tableCard}>
              <div className={styles.tableCardHeader}>
                <div className={styles.tableCardTitle}>OT en Proceso</div>
                <button
                  className="btn btn-dark btn-sm"
                  onClick={() => navigate('/ordenes')}
                >
                  Ver todas →
                </button>
              </div>
              <div className={`tbl-wrap ${styles.tblScroll}`}>
                <table className={styles.tblCompacta}>
                  <thead>
                    <tr>
                      <th>N° OT</th>
                      <th>Patente</th>
                      <th>Entrega Est.</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otAbiertas.slice(0, 5).map((o) => (
                      <tr
                        key={o.id}
                        className={styles.rowClickable}
                        onClick={() => navigate('/ordenes')}
                      >
                        <td className={styles.otNumero} data-label="N° OT">
                          {o.numero}
                        </td>
                        <td className="patente-cell" data-label="Patente">
                          {o.patente}
                        </td>
                        <td className={styles.fechaCell} data-label="Entrega Est.">
                          {o.fechaEntregaEstimada || '—'}
                        </td>
                        <td data-label="Estado">
                          <span className={`badge ${badgeOT(o.estado)}`}>
                            {o.estado}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {otAbiertas.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>
                          Sin OT activas
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
