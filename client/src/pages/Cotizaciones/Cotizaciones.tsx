import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { cotizacionesService } from '../../services/cotizaciones';
import type { Cotizacion, EstadoCotizacion } from '../../types';
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './Cotizaciones.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const ESTADO_BADGE: Record<EstadoCotizacion, string> = {
  Borrador:  'badge-entregado',
  Enviada:   'badge-recibido',
  Aprobada:  'badge-sold',
  Rechazada: 'badge-pending',
};

export default function Cotizaciones() {
  const navigate = useNavigate();
  const { cotizaciones, setCotizaciones, setLoading, notify } = useAppStore();
  const [search, setSearch]               = useState('');
  const [filtroEstado, setFiltroEstado]   = useState('');
  const [confirmAprobar, setConfirmAprobar] = useState<Cotizacion | null>(null);

  useEffect(() => { loadCotizaciones(); }, []);

  const loadCotizaciones = async () => {
    setLoading(true);
    try {
      const res = await cotizacionesService.getAll();
      if (res.success && res.data) setCotizaciones(res.data);
    } catch {
      notify('Error al cargar cotizaciones', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCambiarEstado = async (id: string, estado: EstadoCotizacion) => {
    setLoading(true);
    try {
      await cotizacionesService.cambiarEstado(id, estado);
      notify(`Estado actualizado a ${estado}`, 'success');
      loadCotizaciones();
    } catch {
      notify('Error al cambiar estado', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAprobar = async () => {
    if (!confirmAprobar) return;
    setLoading(true);
    try {
      const res = await cotizacionesService.aprobar(confirmAprobar.id!);
      if (res.success && res.data) {
        notify(`✓ OT ${res.data.otNumero} creada exitosamente`, 'success');
        setConfirmAprobar(null);
        loadCotizaciones();
      }
    } catch {
      notify('Error al aprobar cotización', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, numero: string) => {
    if (!confirm(`¿Eliminar la cotización ${numero}?\nEsta acción no se puede deshacer.`)) return;
    setLoading(true);
    try {
      await cotizacionesService.delete(id);
      notify('Cotización eliminada', 'info');
      loadCotizaciones();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error al eliminar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const marginBadge = (total: number, costos: number) => {
    if (!costos || costos <= 0) return <span className="margin-badge mg-none">—</span>;
    const m   = (total - costos) / total * 100;
    const cls = m >= 30 ? 'mg-good' : m >= 15 ? 'mg-mid' : 'mg-low';
    return <span className={`margin-badge ${cls}`}>{m.toFixed(1)}%</span>;
  };

  const getEstadoLabel = (c: Cotizacion): string => {
    const envios = c.envios || [];
    if (c.estado === 'Enviada' && envios.length > 1) return 'Reenviada';
    return c.estado;
  };

  const getEnvioResumen = (c: Cotizacion) => {
    const envios = c.envios || [];
    if (!envios.length) return null;
    const ultimo = envios[envios.length - 1];
    const wa     = envios.filter(e => e.canal === 'WhatsApp').length;
    const mail   = envios.filter(e => e.canal === 'Email').length;
    return { total: envios.length, ultimo, wa, mail };
  };

  const filtered = cotizaciones.filter(c => {
    const q           = search.toLowerCase();
    const matchSearch = !q ||
      c.patente.toLowerCase().includes(q) ||
      c.nombre.toLowerCase().includes(q)  ||
      c.numero.toLowerCase().includes(q)  ||
      (c.tipo || '').toLowerCase().includes(q) ||
      (c.marca || '').toLowerCase().includes(q) ||
      (c.modelo || '').toLowerCase().includes(q);
    const matchEstado = !filtroEstado || c.estado === filtroEstado;
    return matchSearch && matchEstado;
  });

  const aprobadas  = cotizaciones.filter(c => c.estado === 'Aprobada');
  const ingresos   = aprobadas.reduce((s, c) => s + Math.round((c.total || 0) * 1.19), 0);
  const conCostos  = aprobadas.filter(c => (c.totalCostos || 0) > 0);
  const margenProm = conCostos.length
    ? conCostos.reduce((s, c) => s + ((c.total - c.totalCostos) / c.total * 100), 0) / conCostos.length
    : null;

  const puedeEditar = (c: Cotizacion) => c.estado === 'Borrador' || c.estado === 'Enviada';
  const bloqueado   = (c: Cotizacion) => c.estado === 'Aprobada' || c.estado === 'Rechazada';

  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Cotizaciones</div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar patente, cliente, N°, tipo de auto..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className={styles.filtroEstado}
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="Borrador">Borrador</option>
            <option value="Enviada">Enviada</option>
            <option value="Aprobada">Aprobada</option>
            <option value="Rechazada">Rechazada</option>
          </select>
          <button className="btn btn-primary" onClick={() => navigate('/cotizaciones/nueva')}>
            + Nueva Cotización
          </button>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{cotizaciones.length}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statBorrador}`}>
            {cotizaciones.filter(c => c.estado === 'Borrador').length}
          </div>
          <div className="stat-label">Borrador</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statEnviadas}`}>
            {cotizaciones.filter(c => c.estado === 'Enviada').length}
          </div>
          <div className="stat-label">Enviadas</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statAprobadas}`}>{aprobadas.length}</div>
          <div className="stat-label">Aprobadas</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statIngresos}`}>{fmtCLP(ingresos)}</div>
          <div className="stat-label">Ingresos</div>
        </div>
        <div className="stat-card dark">
          <div
            className={`stat-value ${
              margenProm === null ? styles.margenNulo
              : margenProm >= 30 ? 'margin-good'
              : margenProm >= 15 ? 'margin-mid'
              : 'margin-low'
            }`}
          >
            {margenProm !== null ? `${margenProm.toFixed(1)}%` : '—'}
          </div>
          <div className={`stat-label ${styles.statMargenLabel}`}>Margen Prom.</div>
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
              <th>N° / Fecha</th>
              <th>Patente</th>
              <th>Cliente</th>
              <th>Vehículo</th>
              <th className="r">Total</th>
              <th className={styles.thInterno}>Costos 🔒</th>
              <th className={styles.thInterno}>Margen 🔒</th>
              <th>Estado / Envíos</th>
              <th className={styles.thAcciones}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className={styles.emptyRow}>No hay cotizaciones</td></tr>
            )}
            {paged.map(c => {
              const envioInfo = getEnvioResumen(c);
              return (
                <tr key={c.id}>
                  <td data-label="N° / Fecha">
                    <div className="num-cell">{c.numero}</div>
                    <div className={styles.fecha}>{c.fecha}</div>
                  </td>
                  <td data-label="Patente" className="patente-cell">{c.patente}</td>
                  <td data-label="Cliente">{c.nombre}</td>
                  <td data-label="Vehículo" className={styles.vehiculo}>{c.marca} {c.modelo}</td>
                  <td data-label="Total" className="r price-cell">
                    {fmtCLP(Math.round((c.total || 0) * 1.19))}
                  </td>
                  <td data-label="Costos" className="td-dark hide-mobile">
                    {(c.totalCostos || 0) > 0
                      ? fmtCLP(c.totalCostos)
                      : <span className={styles.sinRegistro}>Sin registro</span>
                    }
                  </td>
                  <td data-label="Margen" className="td-dark hide-mobile">
                    {marginBadge(c.total, c.totalCostos)}
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${ESTADO_BADGE[c.estado]}`}>
                      {getEstadoLabel(c)}
                    </span>
                    {c.otId && (
                      <div className={styles.otGenerada}>OT generada</div>
                    )}
                    {envioInfo && (
                      <div className={styles.enviosResumen}>
                        {envioInfo.wa > 0 && (
                          <span className={styles.envioWa}>💬 ×{envioInfo.wa}</span>
                        )}
                        {envioInfo.mail > 0 && (
                          <span className={styles.envioMail}>✉ ×{envioInfo.mail}</span>
                        )}
                        <span className={styles.envioUltimo}>
                          Último: {envioInfo.ultimo.fecha}{' '}
                          {envioInfo.ultimo.canal === 'WhatsApp' ? '💬' : '✉'}
                        </span>
                      </div>
                    )}
                  </td>
                  <td data-label="Acciones" className={styles.tdAcciones}>
                    <div className={styles.accionesCol}>
                      <button
                        className="btn btn-dark btn-sm"
                        onClick={() => navigate(`/cotizaciones/${c.id}/ver`)}
                      >
                        👁 Ver / PDF
                      </button>

                      {puedeEditar(c) && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => navigate(`/cotizaciones/${c.id}/editar`)}
                        >
                          ✏ Editar
                          {c.estado === 'Enviada' && (
                            <span className={styles.btnEditarEnviada}> ⚠</span>
                          )}
                        </button>
                      )}

                      {bloqueado(c) && (
                        <button
                          className={`btn btn-outline btn-sm ${styles.btnBloqueado}`}
                          disabled
                          title={c.estado === 'Aprobada' ? 'Ya generó una OT' : 'Cotización rechazada'}
                        >
                          🔒 {c.estado}
                        </button>
                      )}

                      {c.estado === 'Borrador' && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleCambiarEstado(c.id!, 'Enviada')}
                        >
                          → Marcar Enviada
                        </button>
                      )}

                      {(c.estado === 'Enviada' || c.estado === 'Borrador') && (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => setConfirmAprobar(c)}
                        >
                          ✓ Aprobar → OT
                        </button>
                      )}

                      {(c.estado === 'Enviada' || c.estado === 'Borrador') && (
                        <button
                          className={`btn btn-sm ${styles.btnRechazar}`}
                          onClick={() => handleCambiarEstado(c.id!, 'Rechazada')}
                        >
                          ✕ Rechazar
                        </button>
                      )}

                      {c.estado === 'Aprobada' && c.otId && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate('/ordenes')}
                        >
                          → Ver OT
                        </button>
                      )}

                      {c.estado !== 'Aprobada' && (
                        <button
                          className={`btn btn-sm ${styles.btnEliminar}`}
                          onClick={() => handleDelete(c.id!, c.numero)}
                        >
                          🗑 Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── MODAL CONFIRMAR APROBAR ─────────────────────────── */}
      {confirmAprobar && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">✓ Aprobar Cotización</div>
            <div className="modal-sub">Se creará una Orden de Trabajo a partir de:</div>
            <div className={styles.modalAprobCard}>
              <div className={styles.modalAprobNumero}>{confirmAprobar.numero}</div>
              <div className={styles.modalAprobCliente}>
                {confirmAprobar.nombre} · {confirmAprobar.patente}
              </div>
              <div className={styles.modalAprobTotal}>{fmtCLP(confirmAprobar.total)}</div>
            </div>
            <div className={styles.modalAprobAviso}>
              La cotización quedará en estado <strong>Aprobada</strong> y se generará
              automáticamente una OT con los mismos servicios.
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setConfirmAprobar(null)}>
                Cancelar
              </button>
              <button className="btn btn-success" onClick={handleAprobar}>
                ✓ Confirmar y Crear OT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}