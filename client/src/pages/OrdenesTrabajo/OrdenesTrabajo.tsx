import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import { ordenesService } from "../../services/ordenes";
import { useAuth } from "../../contexts/AuthContext";
import type { OrdenTrabajo, EstadoOT } from "../../types";
import { PUESTOS_TALLER } from "../../types";
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './OrdenesTrabajo.module.css';

const fmtCLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const ESTADO_BADGE: Record<EstadoOT, string> = {
  Recibido:     "badge-recibido",
  "En Proceso": "badge-proceso",
  Listo:        "badge-listo",
  Entregado:    "badge-entregado",
};

const ESTADOS_FLUJO: EstadoOT[] = ["Recibido", "En Proceso", "Listo", "Entregado"];

export default function OrdenesTrabajo() {
  const navigate = useNavigate();
  const { ordenes, setOrdenes, setLoading, notify } = useAppStore();
  const { user } = useAuth();
  const [search,       setSearch]       = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [modalEstado,  setModalEstado]  = useState<OrdenTrabajo | null>(null);
  const [nuevoEstado,  setNuevoEstado]  = useState<EstadoOT>("Recibido");
  const [fechaEntrega,  setFechaEntrega]  = useState("");
  const [metodoPago,   setMetodoPago]   = useState("");
  const [pagoSinIva,   setPagoSinIva]   = useState(false);
  const [puesto,       setPuesto]       = useState("");

  useEffect(() => { loadOrdenes(); }, []);

  const loadOrdenes = async () => {
    setLoading(true);
    try {
      const res = await ordenesService.getAll();
      if (res.success && res.data) setOrdenes(res.data);
    } catch {
      notify("Error al cargar órdenes", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, numero: string) => {
    if (!confirm(`¿Eliminar la OT ${numero}?\nSe liberará el stock reservado.`)) return;
    setLoading(true);
    try {
      await ordenesService.delete(id);
      notify("OT eliminada y stock liberado", "info");
      loadOrdenes();
    } catch {
      notify("Error al eliminar", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleEstado = async () => {
    if (!modalEstado) return;
    if (nuevoEstado === "Entregado" && (modalEstado.repuestos || []).length > 0) {
      if (!confirm(`Al marcar como Entregado se descontará definitivamente el stock de ${modalEstado.repuestos.length} repuesto(s). ¿Continuar?`)) return;
    }
    setLoading(true);
    try {
      const usuarioNombre = user ? `${user.nombre} ${user.apellido}` : 'Admin';
      const usuarioId     = user?.uid || '';
      await ordenesService.actualizarEstado(
        modalEstado.id!, nuevoEstado,
        nuevoEstado === "Entregado" ? fechaEntrega : undefined,
        usuarioNombre, usuarioId,
        nuevoEstado === "Entregado" ? (metodoPago || undefined) : undefined,
        nuevoEstado === "Entregado" ? pagoSinIva : undefined,
        (nuevoEstado === "En Proceso" || nuevoEstado === "Listo") ? puesto : undefined
      );
      notify("Estado actualizado ✓", "success");
      setModalEstado(null);
      loadOrdenes();
    } catch {
      notify("Error al actualizar estado", "error");
    } finally {
      setLoading(false);
    }
  };

  const getEnvioResumen = (o: OrdenTrabajo) => {
    const envios = (o as any).envios || [];
    if (!envios.length) return null;
    const ultimo = envios[envios.length - 1];
    const wa     = envios.filter((e: any) => e.canal === 'WhatsApp').length;
    const mail   = envios.filter((e: any) => e.canal === 'Email').length;
    const fisico = envios.filter((e: any) => e.canal === 'Físico').length;
    return { total: envios.length, ultimo, wa, mail, fisico };
  };

  const filtered = ordenes.filter(o => {
    const q           = search.toLowerCase();
    const matchSearch = !q ||
      o.patente.toLowerCase().includes(q) ||
      o.numero.toLowerCase().includes(q)  ||
      o.nombre.toLowerCase().includes(q)  ||
      (o.tipo || "").toLowerCase().includes(q) ||
      (o.marca || "").toLowerCase().includes(q) ||
      (o.modelo || "").toLowerCase().includes(q);
    const matchEstado = !filtroEstado || o.estado === filtroEstado;
    return matchSearch && matchEstado;
  });

  const abiertas   = ordenes.filter(o => o.estado !== "Entregado");
  const entregadas = ordenes.filter(o => o.estado === "Entregado");
  const ingresos   = entregadas.reduce((s, o) => s + Math.round((o.total || 0) * 1.19), 0);

  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Órdenes de <span>Trabajo</span></div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar patente, N° OT, tipo de auto..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className={styles.filtroEstado}
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_FLUJO.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => navigate("/ordenes/nueva")}>
            + Nueva OT
          </button>
        </div>
      </div>

      {/* ── FLUJO VISUAL ───────────────────────────────────── */}
      <div className={`stats-grid ${styles.statsGridOT}`}>
        {ESTADOS_FLUJO.map(estado => {
          const count = ordenes.filter(o => o.estado === estado).length;
          const claseColor =
            estado === "Recibido"   ? styles.recibido
            : estado === "En Proceso" ? styles.enProceso
            : estado === "Listo"      ? styles.listo
            : styles.entregado;
          return (
            <div
              key={estado}
              className={`stat-card ${styles.flujoStatCard} ${filtroEstado === estado ? styles.activo : ''} ${filtroEstado && filtroEstado !== estado ? styles.atenuado : ''}`}
              onClick={() => setFiltroEstado(filtroEstado === estado ? "" : estado)}
            >
              <div className={`stat-value ${styles.flujoStatValue} ${claseColor}`}>
                {count}
              </div>
              <div className="stat-label">{estado}</div>
            </div>
          );
        })}
        <div className={`stat-card ${styles.ingresosCard}`}>
          <div className={`stat-value ${styles.statIngresos}`}>{fmtCLP(ingresos)}</div>
          <div className="stat-label">Ingresos Entregados</div>
        </div>
      </div>

      <Pagination
        page={page} totalPages={totalPages} totalItems={filtered.length}
        pageSize={pageSize} onPage={goTo} onPageSize={changeSize}
      />

      {/* ── TABLA ──────────────────────────────────────────── */}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>N° OT</th>
              <th>Origen</th>
              <th>Patente</th>
              <th>Cliente</th>
              <th>F. Ingreso</th>
              <th>Entrega Est.</th>
              <th>Repuestos</th>
              <th className="r">Total</th>
              <th>Estado / Envíos</th>
              <th className="hide-mobile">Pago</th>
              <th className={styles.thAcciones}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} className={styles.emptyRow}>No hay órdenes de trabajo</td></tr>
            )}
            {paged.map(o => {
              const envioInfo = getEnvioResumen(o);
              return (
                <tr key={o.id}>
                  <td data-label="N° OT" className={styles.otNumero}>{o.numero}</td>
                  <td data-label="Origen" className="hide-mobile">
                    {o.cotizacionRef
                      ? <span className="num-cell" title="Generada desde cotización">📋 {o.cotizacionRef}</span>
                      : <span className={styles.origenDirecta}>Directa</span>
                    }
                  </td>
                  <td data-label="Patente" className="patente-cell">{o.patente}</td>
                  <td data-label="Cliente">{o.nombre}</td>
                  <td data-label="F. Ingreso" className={styles.fecha}>{o.fechaIngreso || "—"}</td>
                  <td data-label="Entrega Est." className={styles.fecha}>{o.fechaEntregaEstimada || "—"}</td>
                  <td data-label="Repuestos" className="hide-mobile">
                    {(o.repuestos || []).length > 0
                      ? <span className="badge badge-recibido">{o.repuestos.length} items</span>
                      : <span className={styles.sinRepuestos}>—</span>
                    }
                  </td>
                  <td data-label="Total" className="r price-cell">
                    {(o as any).pagoSinIva
                      ? fmtCLP(o.total || 0)
                      : fmtCLP(Math.round((o.total || 0) * 1.19))
                    }
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${ESTADO_BADGE[o.estado]}`}>{o.estado}</span>
                    {o.puesto && (o.estado === "En Proceso" || o.estado === "Listo") && (
                      <div className={styles.puestoBadge}>📍 {o.puesto}</div>
                    )}
                    {o.stockDescontado && (
                      <div className={styles.stockDescontado}>✓ Stock descontado</div>
                    )}
                    {envioInfo && (
                      <div className={styles.enviosResumen}>
                        {envioInfo.wa > 0 && (
                          <span className={styles.envioWa}>💬×{envioInfo.wa}</span>
                        )}
                        {envioInfo.mail > 0 && (
                          <span className={styles.envioMail}>✉×{envioInfo.mail}</span>
                        )}
                        {envioInfo.fisico > 0 && (
                          <span className={styles.envioFisico}>🤝×{envioInfo.fisico}</span>
                        )}
                        <span className={styles.envioUltimo}>
                          Último: {envioInfo.ultimo.fecha}{' '}
                          {envioInfo.ultimo.canal === 'WhatsApp' ? '💬'
                            : envioInfo.ultimo.canal === 'Email' ? '✉' : '🤝'}
                        </span>
                      </div>
                    )}
                  </td>
                  <td data-label="Pago" className="hide-mobile">
                    {(o as any).metodoPago ? (
                      <span className={styles.pagoInfo}>
                        {(o as any).metodoPago === 'Efectivo'      ? '💵' :
                         (o as any).metodoPago === 'Transferencia' ? '🏦' : '💳'}
                        {' '}{(o as any).metodoPago}
                        <span className={`${styles.pagoIvaTag} ${(o as any).pagoSinIva ? styles.sinIva : ''}`}>
                          {(o as any).pagoSinIva ? '(Sin IVA)' : '(Con IVA)'}
                        </span>
                      </span>
                    ) : (
                      <span className={styles.pagoVacio}>—</span>
                    )}
                  </td>
                  <td data-label="Acciones" className={styles.tdAcciones}>
                    <div className={styles.accionesCol}>
                      {o.estado !== "Entregado" && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => { setModalEstado(o); setNuevoEstado(o.estado); setFechaEntrega(""); setMetodoPago(""); setPagoSinIva(false); setPuesto(o.puesto || ""); }}
                        >
                          ⟳ Estado
                        </button>
                      )}
                      {o.estado !== "Entregado" && (
                        <button
                          className="btn btn-dark btn-sm"
                          onClick={() => navigate(`/ordenes/${o.id}/editar`)}
                        >
                          ✏ Editar
                        </button>
                      )}
                      <button
                        className="btn btn-dark btn-sm"
                        onClick={() => navigate(`/ordenes/${o.id}/ver`)}
                      >
                        👁 Ver / PDF
                      </button>
                      <button
                        className={`btn btn-sm ${styles.btnEliminar}`}
                        onClick={() => handleDelete(o.id!, o.numero)}
                      >
                        ✕ Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── MODAL ESTADO ───────────────────────────────────── */}
      {modalEstado && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">Actualizar Estado</div>
            <div className="modal-sub">OT: <strong>{modalEstado.numero}</strong></div>

            <div className={styles.flujoEstados}>
              {ESTADOS_FLUJO.map((e, i) => (
                <div key={e} className={styles.flujoEstadoItem}>
                  <button
                    className={`${styles.flujoEstadoBtn} ${nuevoEstado === e ? styles.activo : ''}`}
                    onClick={() => setNuevoEstado(e)}
                  >
                    {e}
                  </button>
                  {i < ESTADOS_FLUJO.length - 1 && (
                    <span className={styles.flujoEstadoSep}>→</span>
                  )}
                </div>
              ))}
            </div>

            {nuevoEstado === "Entregado" && (
              <div className={`field ${styles.fechaEntregaField}`}>
                <label>Fecha de Entrega Real</label>
                <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} />
              </div>
            )}

            {/* Ubicación en el taller — al pasar a En Proceso o Listo */}
            {(nuevoEstado === "En Proceso" || nuevoEstado === "Listo") && (
              <div className={`field ${styles.metodoPagoField}`}>
                <label>Puesto / Ubicación en el Taller</label>
                <select value={puesto} onChange={e => setPuesto(e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {PUESTOS_TALLER.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}

            {/* Método de pago — obligatorio al entregar */}
            {nuevoEstado === "Entregado" && (
              <div className={`field ${styles.metodoPagoField}`}>
                <label>Método de Pago *</label>
                <div className={styles.metodoPagoRow}>
                  {['Efectivo', 'Transferencia', 'Tarjeta Débito', 'Tarjeta Crédito'].map(mp => (
                    <button
                      key={mp}
                      type="button"
                      onClick={() => setMetodoPago(mp)}
                      className={`${styles.metodoPagoBtn} ${metodoPago === mp ? styles.activo : ''}`}
                    >
                      {mp === 'Efectivo' ? '💵' : mp === 'Transferencia' ? '🏦' : mp === 'Tarjeta Débito' ? '💳' : '💳'} {mp}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {nuevoEstado === "Entregado" && (modalEstado.repuestos || []).length > 0 && (
              <div className={styles.bannerStockDescontar}>
                ✓ Se descontará el stock de <strong>{modalEstado.repuestos.length} repuesto(s)</strong> del inventario.
              </div>
            )}

            <div className={`modal-actions ${styles.modalActionsCol}`}>
              {/* Checkbox sin IVA — dentro de modal-actions para evitar que quede bajo el sticky bar */}
              {nuevoEstado === "Entregado" && metodoPago && (
                <div
                  onClick={() => setPagoSinIva(v => !v)}
                  className={`${styles.checkboxRow} ${pagoSinIva ? styles.marcado : ''}`}
                >
                  {/* Checkbox custom — evita interferencia de CSS del modal */}
                  <div className={`${styles.checkboxBox} ${pagoSinIva ? styles.marcado : ''}`}>
                    {pagoSinIva && (
                      <span className={styles.checkboxCheck}>✓</span>
                    )}
                  </div>
                  <span className={styles.checkboxLabel}>Pago sin IVA</span>
                  <span className={styles.checkboxHint}>
                    (transferencia entre personas naturales)
                  </span>
                </div>
              )}
              <div className={styles.modalActionsRow}>
                <button className="btn btn-dark" onClick={() => setModalEstado(null)}>Cancelar</button>
                <button
                  className="btn btn-primary"
                  onClick={handleEstado}
                  disabled={nuevoEstado === "Entregado" && !metodoPago}
                  title={nuevoEstado === "Entregado" && !metodoPago ? "Selecciona un método de pago" : ""}
                >Actualizar Estado</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}