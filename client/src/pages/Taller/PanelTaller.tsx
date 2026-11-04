import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PUESTOS_TALLER } from '../../types';
import styles from './PanelTaller.module.css';

// ─── TIPOS (forma reducida que devuelve el endpoint público) ──
interface TareaPanel {
  descripcion:    string;
  estado:         'pendiente' | 'en_proceso' | 'completada';
  mecanicoNombre: string;
}
interface TrabajoPanel { descripcion: string; }
interface OrdenPanel {
  id:           string;
  numero:       string;
  patente:      string;
  marca:        string;
  modelo:       string;
  estado:       'Recibido' | 'En Proceso' | 'Listo';
  puesto:       string | null;
  fechaIngreso: string;
  createdAt:    string;
  tareas:       TareaPanel[];
  trabajos:     TrabajoPanel[];
}
interface MecanicoPanel { nombre: string; }

const PUESTO_COLOR: Record<string, string> = {
  'Elevador 1': '#E94216',
  'Elevador 2': '#D97706',
  'Elevador 3': '#2563EB',
  'Elevador 4': '#15803D',
  'Elevador 5': '#7C3AED',
  'Piso':       '#4B5563',
  'Sitio':      '#0891B2',
};

const REFRESH_MS = 60000;

// Duración transcurrida tipo "220h 47m" desde una fecha ISO
const fmtDuracion = (iso: string): string => {
  const start = new Date(iso).getTime();
  if (!iso || isNaN(start)) return '—';
  const diffMs = Math.max(0, Date.now() - start);
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
};

// TODAS las tareas activas de una orden (en_proceso primero, luego pendientes)
const tareasActivasDeOrden = (o: OrdenPanel): TareaPanel[] => [
  ...o.tareas.filter(t => t.estado === 'en_proceso'),
  ...o.tareas.filter(t => t.estado === 'pendiente'),
];

export default function PanelTaller() {
  const [ordenes,   setOrdenes]   = useState<OrdenPanel[]>([]);
  const [mecanicos, setMecanicos] = useState<MecanicoPanel[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [now,       setNow]       = useState(new Date());

  useEffect(() => {
    loadData();
    const dataTimer  = setInterval(loadData, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, []);

  const loadData = async () => {
    try {
      const [ordRes, mecRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_URL}/api/ordenes/taller/panel`),
        fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/mecanicos/publico`),
      ]);
      const ordData = await ordRes.json();
      const mecData = await mecRes.json();
      if (ordData.success) setOrdenes(ordData.data);
      if (mecData.success) setMecanicos(mecData.data);
    } catch { /* se reintenta en el próximo ciclo */ }
    finally { setLoading(false); }
  };

  const enProceso  = ordenes.filter(o => o.estado === 'En Proceso');
  const recibidos  = ordenes.filter(o => o.estado === 'Recibido');
  const listos     = ordenes.filter(o => o.estado === 'Listo');
  const autosTaller = enProceso.length + recibidos.length;
  const tareasActivas = ordenes.reduce(
    (s, o) => s + o.tareas.filter(t => t.estado === 'pendiente' || t.estado === 'en_proceso').length,
    0
  );

  const ordenPorPuesto = (puesto: string): OrdenPanel | undefined =>
    ordenes.find(o => o.puesto === puesto && (o.estado === 'En Proceso' || o.estado === 'Listo'));

  const mecanicoTareasActivas = (nombre: string): { orden: OrdenPanel; tarea: TareaPanel }[] => {
    const activas: { orden: OrdenPanel; tarea: TareaPanel }[] = [];
    for (const o of ordenes) {
      if (o.estado === 'Listo') continue;
      for (const t of o.tareas) {
        if (t.mecanicoNombre === nombre && t.estado !== 'completada') {
          activas.push({ orden: o, tarea: t });
        }
      }
    }
    return activas;
  };

  return (
    <div className={styles.page}>
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className={styles.header}>
        <img
          className={styles.logo}
          src="/logo-facil-repuestos.webp"
          alt="Fácil Repuestos"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
        <div className={styles.clockBlock}>
          <div className={styles.clock}>
            {now.toLocaleTimeString('es-CL')}
          </div>
          <div className={styles.date}>
            {now.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            {loading && <span className={styles.loadingTag}> · Cargando…</span>}
          </div>
        </div>
      </header>

      {/* ── STATS ──────────────────────────────────────────── */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{autosTaller}</div>
          <div className={styles.statLbl}>Autos en Taller</div>
        </div>
        <div className={`${styles.statCard} ${styles.statSuccess}`}>
          <div className={styles.statNum}>{tareasActivas}</div>
          <div className={styles.statLbl}>Tareas Activas</div>
        </div>
        <div className={`${styles.statCard} ${styles.statWarning}`}>
          <div className={styles.statNum}>{recibidos.length}</div>
          <div className={styles.statLbl}>Autos Esperando</div>
        </div>
        <div className={`${styles.statCard} ${styles.statInfo}`}>
          <div className={styles.statNum}>{listos.length}</div>
          <div className={styles.statLbl}>Listos Entrega</div>
        </div>
      </div>

      {/* ── PUESTOS + VEHÍCULOS ──────────────────────────────── */}
      <div className={styles.mainGrid}>
        {/* Puestos / elevadores */}
        <div className={styles.puestosGrid}>
          {PUESTOS_TALLER.map(puesto => {
            const o    = ordenPorPuesto(puesto);
            const tareasOrden = o ? tareasActivasDeOrden(o) : [];
            const color = PUESTO_COLOR[puesto] || '#4B5563';
            return (
              <div key={puesto} className={styles.puestoCard}>
                <div className={styles.puestoHeader} style={{ background: color }}>
                  {puesto.toUpperCase()}
                </div>
                <div className={styles.puestoBody}>
                  {o ? (
                    <>
                      <div className={styles.puestoPatente}>{o.patente}</div>
                      <div className={styles.puestoAuto}>{[o.marca, o.modelo].filter(Boolean).join(' ')}</div>
                      {tareasOrden.length > 0 ? (
                        <div className={styles.puestoTareasList}>
                          {tareasOrden.map((t, i) => (
                            <div key={i} className={styles.puestoTareaItem}>
                              <div className={styles.puestoTarea}>{t.descripcion}</div>
                              {t.mecanicoNombre && (
                                <div className={styles.puestoMecanico}>{t.mecanicoNombre} · {fmtDuracion(o.createdAt)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.puestoSinTarea}>
                          {o.estado === 'Listo' ? '✓ Listo para entrega' : 'Sin tareas asignadas'}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={styles.puestoLibre}>Libre</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Vehículos en taller */}
        <div className={styles.vehiculosCard}>
          <div className={styles.vehiculosHeader}>Vehículos en Taller</div>
          <div className={styles.vehiculosList}>
            {ordenes.length === 0 && (
              <div className={styles.emptyState}>{loading ? 'Cargando…' : 'No hay vehículos en el taller'}</div>
            )}
            {ordenes.map(o => (
              <div key={o.id} className={styles.vehiculoRow}>
                <span className={styles.vehiculoBar} />
                <div className={styles.vehiculoInfo}>
                  <span className={styles.vehiculoPatente}>{o.patente}</span>
                  <span className={styles.vehiculoMarca}>{o.marca}</span>
                </div>
                <span className={`${styles.vehiculoBadge} ${
                  o.estado === 'En Proceso' ? styles.badgeTrabajo
                  : o.estado === 'Listo'     ? styles.badgeListo
                  : styles.badgeIngresado
                }`}>
                  {o.estado === 'En Proceso' ? 'Trabajo' : o.estado === 'Listo' ? 'Listo' : 'Ingresado'}
                </span>
                <span className={styles.vehiculoTiempo}>{fmtDuracion(o.createdAt || o.fechaIngreso)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── EQUIPO ─────────────────────────────────────────── */}
      <div className={styles.equipoCard}>
        <div className={styles.equipoHeader}>Equipo Fácil Repuestos</div>
        <div className={styles.equipoList}>
          {mecanicos.length === 0 && (
            <div className={styles.emptyState}>{loading ? 'Cargando…' : 'Sin mecánicos activos registrados'}</div>
          )}
          {mecanicos.map(m => {
            const activas = mecanicoTareasActivas(m.nombre);
            return (
              <div key={m.nombre} className={styles.equipoRow}>
                <span className={styles.equipoNombre}>{m.nombre}</span>
                {activas.length > 0 ? (
                  <>
                    <div className={styles.equipoTareasList}>
                      {activas.map((a, i) => (
                        <div key={i} className={styles.equipoTareaItem}>
                          <span className={styles.equipoTarea}>[{a.orden.patente}] {a.tarea.descripcion}</span>
                          <span className={styles.equipoTiempo}>{fmtDuracion(a.orden.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                    <span className={styles.equipoBadgeActivo}>
                      Activo{activas.length > 1 ? ` ×${activas.length}` : ''}
                    </span>
                  </>
                ) : (
                  <span className={styles.equipoDisponible}>Disponible</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Link to="/login" className={styles.volverLink}>← Volver al login</Link>
    </div>
  );
}