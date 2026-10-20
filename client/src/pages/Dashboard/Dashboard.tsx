import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { cotizacionesService } from '../../services/cotizaciones';
import { ordenesService } from '../../services/ordenes';
import { vehiculosService } from '../../services/vehiculos';
import { ingresoRealOT } from '../../types';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    cotizaciones, ordenes, vehiculos,
    setCotizaciones, setOrdenes, setVehiculos,
    setLoading, notify,
  } = useAppStore();

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cots, ords, vehs] = await Promise.all([
        cotizacionesService.getAll(),
        ordenesService.getAll(),
        vehiculosService.getAll(),
      ]);
      if (cots.success && cots.data) setCotizaciones(cots.data);
      if (ords.success && ords.data) setOrdenes(ords.data);
      if (vehs.success && vehs.data) setVehiculos(vehs.data);
    } catch (e) {
      console.error(e);
      notify('Error al cargar el dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── STATS ─────────────────────────────────────────────
  const vendidas    = cotizaciones.filter(c => c.estado === 'Aprobada');
  const entregadas  = ordenes.filter(o => o.estado === 'Entregado');
  const otAbiertas  = ordenes.filter(o => o.estado !== 'Entregado');
  const ingresos    = entregadas.reduce((s, o) => s + ingresoRealOT(o), 0);
  const conMargen   = vendidas.filter(c => (c.totalCostos || 0) > 0);
  const margenProm  = conMargen.length
    ? conMargen.reduce((s, c) => s + ((c.total - c.totalCostos) / c.total * 100), 0) / conMargen.length
    : null;

  const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

  const badgeOT = (estado: string) =>
    estado === 'Recibido'   ? 'badge-recibido'
    : estado === 'En Proceso' ? 'badge-proceso'
    : estado === 'Listo'      ? 'badge-listo'
    : 'badge-entregado';

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dashboard <span>General</span></div>
        <button className="btn btn-dark btn-sm" onClick={loadAll}>↻ Actualizar</button>
      </div>

      {/* ── STATS ────────────────────────────────────────── */}
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
              margenProm === null ? styles.margenNulo
              : margenProm >= 30 ? 'margin-good'
              : margenProm >= 15 ? 'margin-mid'
              : 'margin-low'
            }`}
          >
            {margenProm !== null ? `${margenProm.toFixed(1)}%` : '—'}
          </div>
          <div className={`stat-label ${styles.statMargenLabel}`}>Margen Promedio</div>
        </div>
      </div>

      {/* ── TABLAS ───────────────────────────────────────── */}
      <div className={styles.tablasGrid}>

        {/* Últimas cotizaciones */}
        <div className={styles.tableCard}>
          <div className={styles.tableCardHeader}>
            <div className={styles.tableCardTitle}>Últimas Cotizaciones</div>
            <button className="btn btn-dark btn-sm" onClick={() => navigate('/cotizaciones')}>
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
                {cotizaciones.slice(0, 5).map(c => (
                  <tr
                    key={c.id}
                    className={styles.rowClickable}
                    onClick={() => navigate('/cotizaciones')}
                  >
                    <td className="num-cell" data-label="N°">{c.numero}</td>
                    <td className="patente-cell" data-label="Patente">{c.patente}</td>
                    <td className="r price-cell" data-label="Total">{fmtCLP(c.total)}</td>
                    <td data-label="Estado">
                      <span className={`badge ${c.estado === 'Aprobada' ? 'badge-sold' : 'badge-pending'}`}>
                        {c.estado}
                      </span>
                    </td>
                  </tr>
                ))}
                {cotizaciones.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.emptyRow}>Sin cotizaciones</td>
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
            <button className="btn btn-dark btn-sm" onClick={() => navigate('/ordenes')}>
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
                {otAbiertas.slice(0, 5).map(o => (
                  <tr
                    key={o.id}
                    className={styles.rowClickable}
                    onClick={() => navigate('/ordenes')}
                  >
                    <td className={styles.otNumero} data-label="N° OT">{o.numero}</td>
                    <td className="patente-cell" data-label="Patente">{o.patente}</td>
                    <td className={styles.fechaCell} data-label="Entrega Est.">{o.fechaEntregaEstimada || '—'}</td>
                    <td data-label="Estado">
                      <span className={`badge ${badgeOT(o.estado)}`}>{o.estado}</span>
                    </td>
                  </tr>
                ))}
                {otAbiertas.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.emptyRow}>Sin OT activas</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}