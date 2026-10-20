import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { vehiculosService } from '../../services/vehiculos';
import type { Vehiculo, EstadoCotizacion, EstadoOT } from '../../types';
import styles from './PerfilVehiculo.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const COT_BADGE: Record<EstadoCotizacion, string> = {
  Borrador:  'badge-entregado',
  Enviada:   'badge-recibido',
  Aprobada:  'badge-sold',
  Rechazada: 'badge-pending',
};

const OT_BADGE: Record<EstadoOT, string> = {
  'Recibido':   'badge-recibido',
  'En Proceso': 'badge-proceso',
  'Listo':      'badge-listo',
  'Entregado':  'badge-entregado',
};

export default function PerfilVehiculo() {
  const { patente } = useParams<{ patente: string }>();
  const navigate = useNavigate();
  const { cotizaciones, ordenes, setLoading, notify } = useAppStore();
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);

  useEffect(() => {
    if (patente) loadVehiculo();
  }, [patente]);

  const loadVehiculo = async () => {
    setLoading(true);
    try {
      const res = await vehiculosService.getByPatente(patente!);
      if (res.success && res.data) {
        setVehiculo(res.data);
      } else {
        setVehiculo({ patente: patente! } as Vehiculo);
      }
    } catch {
      notify('Error al cargar perfil', 'error');
    } finally {
      setLoading(false);
    }
  };

  const navState = vehiculo ? {
    patente:  vehiculo.patente,
    make:     vehiculo.make,
    model:    vehiculo.model,
    year:     vehiculo.year,
    type:     vehiculo.type,
    engine:   vehiculo.engine,
    owner:    vehiculo.owner,
    telefono: vehiculo.telefono,
    email:    vehiculo.email,
  } : {};

  const cots = cotizaciones.filter(c => c.patente === patente);
  const ots  = ordenes.filter(o => o.patente === patente);

  const totalFacturado =
    cots.filter(c => c.estado === 'Aprobada').reduce((s, c) => s + (c.total || 0), 0) +
    ots.filter(o => o.estado === 'Entregado').reduce((s, o) => s + (o.total || 0), 0);

  if (!vehiculo) return null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Perfil <span>{patente}</span></div>
        <div className={styles.headerActions}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/cotizaciones/nueva', { state: navState })}
          >
            + Cotización
          </button>
          <button
            className="btn btn-dark btn-sm"
            onClick={() => navigate('/ordenes/nueva', { state: navState })}
          >
            + OT
          </button>
          <button className="btn btn-dark" onClick={() => navigate('/vehiculos')}>
            ← Volver
          </button>
        </div>
      </div>

      {/* ── HEADER VEHÍCULO ──────────────────────────── */}
      <div className="vehicle-profile">
        <div className="vp-header">
          <div>
            <div className="vp-plate">{patente}</div>
            <div className="vp-car">
              {vehiculo.make} {vehiculo.model}
              {vehiculo.year ? ` · ${vehiculo.year}` : ''}
            </div>
            <div className="vp-badges">
              {vehiculo.type   && <span className="vp-badge">{vehiculo.type}</span>}
              {vehiculo.engine && <span className="vp-badge">Motor: {vehiculo.engine}</span>}
              <span className="vp-badge">{cots.length} Cot.</span>
              <span className="vp-badge">{ots.length} OT</span>
            </div>
          </div>
          <div className={styles.propietarioBlock}>
            <div className={styles.propietarioLabel}>Propietario</div>
            <div className={styles.propietarioNombre}>
              {vehiculo.owner || 'No registrado'}
            </div>
            {vehiculo.telefono && (
              <div className={styles.propietarioDato}>{vehiculo.telefono}</div>
            )}
            {vehiculo.email && (
              <div className={styles.propietarioDato}>{vehiculo.email}</div>
            )}
          </div>
        </div>

        {/* ── STATS ──────────────────────────────────── */}
        <div className={styles.statsGrid}>
          <div className={`stat-card ${styles.statCardFlat}`}>
            <div className="stat-value">{cots.length}</div>
            <div className="stat-label">Cotizaciones</div>
          </div>
          <div className={`stat-card ${styles.statCardFlat}`}>
            <div className={`stat-value ${styles.statAprobadas}`}>
              {cots.filter(c => c.estado === 'Aprobada').length}
            </div>
            <div className="stat-label">Aprobadas</div>
          </div>
          <div className={`stat-card ${styles.statCardFlat}`}>
            <div className="stat-value">{ots.length}</div>
            <div className="stat-label">Órdenes de Trabajo</div>
          </div>
          <div className={`stat-card ${styles.statCardFlat}`}>
            <div className={`stat-value ${styles.statFacturado}`}>
              {fmtCLP(totalFacturado)}
            </div>
            <div className="stat-label">Total Facturado</div>
          </div>
        </div>

        {/* ── HISTORIAL ────────────────────────────────── */}
        <div className={styles.historialGrid}>

          {/* Cotizaciones */}
          <div>
            <div className="vp-section-title">Historial de Cotizaciones</div>
            <div className={`tbl-wrap ${styles.tblWrapFlat}`}>
              <table className={styles.tableMinWidth}>
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Fecha</th>
                    <th className="r">Total</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cots.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.emptyRow}>
                        Sin cotizaciones
                      </td>
                    </tr>
                  )}
                  {cots.map(c => (
                    <tr key={c.id}>
                      <td data-label="N°" className="num-cell">{c.numero}</td>
                      <td data-label="Fecha" className={styles.fechaCell}>{c.fecha}</td>
                      <td data-label="Total" className="r">{fmtCLP(c.total)}</td>
                      <td data-label="Estado">
                        <span className={`badge ${COT_BADGE[c.estado] || 'badge-entregado'}`}>
                          {c.estado}
                        </span>
                      </td>
                      <td data-label="">
                        <button
                          className="btn btn-dark btn-sm"
                          onClick={() => navigate(`/cotizaciones/${c.id}/ver`)}
                        >
                          👁
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* OT */}
          <div>
            <div className="vp-section-title">Historial de Órdenes de Trabajo</div>
            <div className={`tbl-wrap ${styles.tblWrapFlat}`}>
              <table className={styles.tableMinWidth}>
                <thead>
                  <tr>
                    <th>N° OT</th>
                    <th>Ingreso</th>
                    <th className="r">Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ots.length === 0 && (
                    <tr>
                      <td colSpan={4} className={styles.emptyRow}>
                        Sin órdenes de trabajo
                      </td>
                    </tr>
                  )}
                  {ots.map(o => (
                    <tr key={o.id}>
                      <td data-label="N° OT" className={styles.otNumero}>
                        {o.numero}
                      </td>
                      <td data-label="Ingreso" className={styles.fechaCell}>{o.fechaIngreso}</td>
                      <td data-label="Total" className="r">{fmtCLP(o.total)}</td>
                      <td data-label="Estado">
                        <span className={`badge ${OT_BADGE[o.estado] || 'badge-entregado'}`}>
                          {o.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}