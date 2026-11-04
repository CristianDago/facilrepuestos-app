import { useState } from 'react';
import styles from './ClientePortal.module.css';

interface OTPublica {
  id:                 string;
  numero:             string;
  estado:             string;
  fechaIngreso:       string;
  fechaEntregaReal:   string | null;
  marca:              string;
  modelo:             string;
  anio:               string;
  km:                 string;
  trabajos:           { descripcion: string; cantidad: number }[];
  repuestos:          { nombre: string; cantidad: number }[];
  observaciones:      string;
}

const ESTADO_BADGE_CLASS: Record<string, string> = {
  'Recibido':   'badge-recibido',
  'En Proceso': 'badge-proceso',
  'Listo':      'badge-listo',
  'Entregado':  'badge-entregado',
};

const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export default function ClientePortal() {
  const [patente, setPatente]     = useState('');
  const [ordenes, setOrdenes]     = useState<OTPublica[]>([]);
  const [vehiculo, setVehiculo]   = useState<{ make: string; model: string; year: string } | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [buscado, setBuscado]     = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patente.trim().toUpperCase();
    if (!pat) return;
    setLoading(true);
    setError('');
    setOrdenes([]);
    setVehiculo(null);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/ordenes/cliente/${encodeURIComponent(pat)}`);
      const data = await res.json();
      if (!data.success) {
        setError('No se encontraron órdenes para esta patente.');
      } else {
        setOrdenes(data.data.ordenes || []);
        setVehiculo(data.data.vehiculo || null);
        setBuscado(pat);
        if ((data.data.ordenes || []).length === 0) {
          setError('No hay órdenes de trabajo registradas para esta patente.');
        }
      }
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cliente-portal">
      {/* ── HEADER ────────────────────────────────────────── */}
      <div className="cliente-header">
        <img
          src="/logo-facil-repuestos.webp"
          alt="Fácil Repuestos"
          className="cliente-logo"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
        <div className="cliente-header-text">
          <h1>Consulta tu Vehículo</h1>
          <p>Ingresa tu patente para ver el historial de servicios</p>
        </div>
      </div>

      {/* ── BUSCADOR ──────────────────────────────────────── */}
      <div className="cliente-search-box">
        <form onSubmit={handleSearch} className="cliente-search-form">
          <input
            className="cliente-search-input"
            type="text"
            value={patente}
            onChange={e => setPatente(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="Ej: ABCD12"
            maxLength={8}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={loading || !patente.trim()}>
            {loading ? 'Buscando...' : 'Consultar'}
          </button>
        </form>
      </div>

      {/* ── ERROR ─────────────────────────────────────────── */}
      {error && (
        <div className="cliente-error">
          <span>⚠ {error}</span>
        </div>
      )}

      {/* ── RESULTADOS ────────────────────────────────────── */}
      {ordenes.length > 0 && (
        <div className="cliente-results">
          {/* Info vehículo */}
          <div className="cliente-vehiculo-info">
            <span className="cliente-patente-badge">{buscado}</span>
            {vehiculo && (
              <span className="cliente-vehiculo-desc">
                {vehiculo.make} {vehiculo.model} {vehiculo.year}
              </span>
            )}
            <span className={styles.resultadosCount}>
              {ordenes.length} orden{ordenes.length !== 1 ? 'es' : ''} encontrada{ordenes.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Lista de OTs */}
          <div className="cliente-ot-list">
            {ordenes.map(ot => (
              <div key={ot.id} className="cliente-ot-card">
                {/* Cabecera */}
                <div className="cliente-ot-header">
                  <div>
                    <span className="cliente-ot-numero">{ot.numero}</span>
                    <span className={`badge ${ESTADO_BADGE_CLASS[ot.estado] || 'badge-entregado'} ${styles.otBadge}`}>
                      {ot.estado}
                    </span>
                  </div>
                  <div className="cliente-ot-fechas">
                    <span>Ingreso: {fmtFecha(ot.fechaIngreso)}</span>
                    {ot.fechaEntregaReal && (
                      <span>· Entrega: {fmtFecha(ot.fechaEntregaReal)}</span>
                    )}
                    {ot.km && <span>· {Number(ot.km).toLocaleString('es-CL')} km</span>}
                  </div>
                </div>

                {/* Trabajos realizados */}
                {ot.trabajos.length > 0 && (
                  <div className="cliente-ot-section">
                    <div className="cliente-ot-section-title">🔧 Servicios realizados</div>
                    <ul className="cliente-ot-items">
                      {ot.trabajos.map((t, i) => (
                        <li key={i}>{t.descripcion}{t.cantidad > 1 ? ` × ${t.cantidad}` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Repuestos */}
                {ot.repuestos.length > 0 && (
                  <div className="cliente-ot-section">
                    <div className="cliente-ot-section-title">📦 Repuestos utilizados</div>
                    <ul className="cliente-ot-items">
                      {ot.repuestos.map((r, i) => (
                        <li key={i}>{r.nombre} × {r.cantidad}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Observaciones */}
                {ot.observaciones && (
                  <div className="cliente-ot-section">
                    <div className="cliente-ot-section-title">📝 Observaciones</div>
                    <p className="cliente-ot-obs">{ot.observaciones}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="cliente-footer-note">
            ¿Tienes preguntas? Llámanos al <strong>+56 9 2740 1059</strong>
          </div>
        </div>
      )}

      {/* ── FOOTER ────────────────────────────────────────── */}
      <div className="cliente-page-footer">
        <a href="/login" className="cliente-login-link">Acceso para personal →</a>
      </div>
    </div>
  );
}