import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { OrdenTrabajo, TareaOT } from '../../types';
import styles from './MecanicoDashboard.module.css';

const ESTADO_CLASS: Record<string, string> = {
  'Recibido':   'recibido',
  'En Proceso': 'enProceso',
  'Listo':      'listo',
};

const TAREA_ESTADO_LABEL: Record<string, string> = {
  pendiente:  '⏳ Pendiente',
  en_proceso: '🔧 En proceso',
  completada: '✅ Completada',
};

const fmtFecha = (fecha: string) => {
  if (!fecha) return '—';
  if (fecha.includes('/')) {
    const [d, m] = fecha.split('/');
    return `${d}/${m}`;
  }
  return new Date(fecha).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
};

export default function MecanicoDashboard() {
  const { user, getToken } = useAuth();
  const [ordenes, setOrdenes]   = useState<OrdenTrabajo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'ordenes_trabajo'),
      where('estado', 'in', ['Recibido', 'En Proceso']),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrdenTrabajo));
      setOrdenes(data);
      setLoading(false);
    }, (err) => {
      console.error('Error escuchando órdenes:', err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const actualizarTarea = async (
    ordenId: string,
    tareaId: string,
    nuevoEstado: TareaOT['estado']
  ) => {
    setUpdating(tareaId);
    try {
      const token = await getToken();
      await fetch(`${import.meta.env.VITE_API_URL}/api/ordenes/${ordenId}/tareas/${tareaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          estado: nuevoEstado,
          usuarioNombre: user ? `${user.nombre} ${user.apellido}` : 'Mecánico',
          usuarioId: user?.uid || '',
        }),
      });
    } catch (err) {
      console.error('Error actualizando tarea:', err);
    } finally {
      setUpdating(null);
    }
  };

  const getMisTareas = (orden: OrdenTrabajo): TareaOT[] =>
    (orden.tareas || []).filter(t => t.mecanicoId === user?.uid);

  const todasLasTareas = ordenes.flatMap(o => getMisTareas(o));
  const pendientes  = todasLasTareas.filter(t => t.estado === 'pendiente').length;
  const enProceso   = todasLasTareas.filter(t => t.estado === 'en_proceso').length;
  const completadas = todasLasTareas.filter(t => t.estado === 'completada').length;

  if (loading) {
    return <div className={styles.loading}>Cargando órdenes...</div>;
  }

  return (
    <div>
      {/* ── HEADER NEGRO ───────────────────────────────────── */}
      <div className={styles.dashHeader}>
        <div className={styles.welcomeBlock}>
          <div className={styles.welcomeLabel}>Bienvenido</div>
          <div className={styles.welcomeName}>
            {user?.nombre} {user?.apellido}
          </div>
          <div className={styles.welcomeSub}>
            {ordenes.length} orden{ordenes.length !== 1 ? 'es' : ''} activa{ordenes.length !== 1 ? 's' : ''} · En tiempo real
          </div>
        </div>

        <div className={styles.statsStrip}>
          <div className={styles.statBox}>
            <span className={`${styles.statNum} ${styles.colorPendiente}`}>{pendientes}</span>
            <span className={`${styles.statLbl} ${styles.lblPendiente}`}>Pendiente{pendientes !== 1 ? 's' : ''}</span>
          </div>
          <div className={styles.statBox}>
            <span className={`${styles.statNum} ${styles.colorEnProceso}`}>{enProceso}</span>
            <span className={`${styles.statLbl} ${styles.lblEnProceso}`}>En Proceso</span>
          </div>
          <div className={styles.statBox}>
            <span className={`${styles.statNum} ${styles.colorCompletada}`}>{completadas}</span>
            <span className={`${styles.statLbl} ${styles.lblCompletada}`}>Listas</span>
          </div>
        </div>
      </div>

      {/* ── ÓRDENES ────────────────────────────────────────── */}
      {ordenes.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🎉</div>
          <div className={styles.emptyText}>Sin órdenes activas</div>
        </div>
      ) : (
        <div className={styles.ordenesList}>
          {ordenes.map(orden => {
            const allTareas  = orden.tareas || [];
            const misTareas  = getMisTareas(orden);
            const completadasOT = allTareas.filter(t => t.estado === 'completada').length;
            const pctProgreso   = allTareas.length > 0
              ? Math.round((completadasOT / allTareas.length) * 100)
              : 0;

            return (
              <div key={orden.id} className={styles.otCard}>
                {/* Topbar negro */}
                <div className={styles.otCardTopbar}>
                  <div className={styles.otNumeroBadgeRow}>
                    <span className={styles.otNumero}>{orden.numero}</span>
                    <span
                      className={`${styles.otEstadoBadge} ${styles[ESTADO_CLASS[orden.estado]] || ''}`}
                    >
                      {orden.estado}
                    </span>
                    {orden.puesto && (
                      <span className={styles.otPuestoBadge}>📍 {orden.puesto}</span>
                    )}
                  </div>
                  <span className={styles.otMeta}>
                    Ingreso: {fmtFecha(orden.fechaIngreso)}
                    {orden.km ? ` · ${Number(orden.km).toLocaleString('es-CL')} km` : ''}
                  </span>
                </div>

                {/* Cuerpo */}
                <div className={styles.otCardBody}>
                  {/* Vehículo */}
                  <div className={styles.otVehiculo}>
                    <span className={styles.otPlate}>{orden.patente}</span>
                    <span className={styles.otVehiculoDesc}>
                      {orden.marca} {orden.modelo} {orden.anio}
                    </span>
                    {orden.km && (
                      <span className={styles.otKm}>{Number(orden.km).toLocaleString('es-CL')} km</span>
                    )}
                  </div>

                  {/* Progreso tareas */}
                  {allTareas.length > 0 && (
                    <div className={styles.progresoWrap}>
                      <div className={styles.progresoHeader}>
                        <span className={styles.progresoLabel}>Progreso Tareas</span>
                        <span className={styles.progresoCount}>{completadasOT}/{allTareas.length} · {pctProgreso}%</span>
                      </div>
                      <div className={styles.progresoTrack}>
                        <div
                          className={`${styles.progresoFill} ${pctProgreso !== 100 ? styles.incompleto : ''}`}
                          style={{ width: `${pctProgreso}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Tareas */}
                  {allTareas.length > 0 && (
                    <div className={styles.tareasSection}>
                      <div className={styles.tareasSectionTitle}>
                        Tareas ({allTareas.length})
                      </div>
                      {allTareas.map(tarea => {
                        const esMia = tarea.mecanicoId === user?.uid;
                        return (
                          <div
                            key={tarea.id}
                            className={`${styles.tareaItem} ${esMia ? styles.tareaItemMia : styles.tareaItemOtro}`}
                          >
                            <div className={styles.tareaInfo}>
                              <span className={styles.tareaDesc}>{tarea.descripcion}</span>
                              <span className={styles.tareaMecanico}>
                                {esMia ? '👤 Yo' : `👤 ${tarea.mecanicoNombre}`}
                              </span>
                            </div>
                            {esMia ? (
                              <select
                                className={styles.tareaSelect}
                                value={tarea.estado}
                                disabled={updating === tarea.id}
                                onChange={e =>
                                  actualizarTarea(orden.id!, tarea.id, e.target.value as TareaOT['estado'])
                                }
                              >
                                <option value="pendiente">⏳ Pendiente</option>
                                <option value="en_proceso">🔧 En proceso</option>
                                <option value="completada">✅ Completada</option>
                              </select>
                            ) : (
                              <span className={styles.tareaEstadoLabel}>
                                {TAREA_ESTADO_LABEL[tarea.estado] || tarea.estado}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Servicios generales */}
                  {orden.trabajos?.length > 0 && (
                    <div className={styles.serviciosSection}>
                      <div className={styles.serviciosSectionTitle}>Servicios de la OT</div>
                      {orden.trabajos.map((t, i) => (
                        <div key={i} className={styles.servicioItem}>
                          <span>{t.descripcion}</span>
                          {t.mecanicoNombre && (
                            <span className={styles.servicioMecanico}>— {t.mecanicoNombre}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notas internas */}
                  {orden.notasInternas && (
                    <div className={styles.notasBox}>
                      📋 {orden.notasInternas}
                    </div>
                  )}

                  {misTareas.length === 0 && allTareas.length === 0 && (
                    <div className={styles.sinTareasMsg}>Sin tareas asignadas en esta OT</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}