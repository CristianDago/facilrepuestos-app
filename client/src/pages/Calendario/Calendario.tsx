import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { calendarioService } from '../../services/calendario';
import { useCitasNotificaciones } from '../../hooks/useCitasNotificaciones';
import { marcarCitasVistas } from '../../utils/citasVistas';
import styles from './Calendario.module.css';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = () => ({
  nombre: '', correo: '', telefono: '', patente: '',
  servicio: '', descripcion: '', fecha: today(), horaInicio: '',
});

// Mismas reglas que el backend (server/routes/calendario.js) — se validan
// igual del lado del servidor, esto es solo para armar el selector.
// Lunes a viernes 9-18 hrs (sin el bloque 14-15 de almuerzo) · Sábado 10-14 · Domingo cerrado
const getSlotsPermitidos = (fecha: string): number[] => {
  if (!fecha) return [];
  const [y, m, d] = fecha.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=domingo ... 6=sábado
  if (dow === 0) return [];
  if (dow === 6) return [10, 11, 12, 13];
  return [9, 10, 11, 12, 13, 15, 16, 17];
};

const fmtHora = (h: number) => `${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00`;

const fmtEventoFecha = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // eventos "todo el día" vienen como YYYY-MM-DD
  return d.toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const POLL_MS = 60000; // 1 minuto — para reflejar cambios hechos fuera de la app (ej. en Google Calendar)

export default function Calendario() {
  const { notify, citasProximas } = useAppStore();
  const { refrescar } = useCitasNotificaciones();
  const embedUrl = import.meta.env.VITE_GOOGLE_CALENDAR_URL as string | undefined;

  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState(emptyForm());
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const [ocupadas, setOcupadas]         = useState<number[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [loadingList, setLoadingList] = useState(true);

  // El embed de Google cachea su contenido del lado del navegador y no se
  // actualiza solo — se fuerza una recarga cada cierto tiempo cambiándole
  // la URL (un parámetro extra), para que el navegador la pida de nuevo.
  const [iframeTick, setIframeTick] = useState(0);

  // El sondeo cada 60s de /api/calendario/eventos ya lo hace una sola vez
  // useCitasNotificaciones (compartido con el globo del sidebar) — acá solo
  // se pide un refresco inmediato al entrar, para no esperar el próximo ciclo.
  useEffect(() => {
    (async () => { await refrescar(); setLoadingList(false); })();
  }, []);
  // Cada vez que la lista compartida cambia (por el sondeo, o por una acción
  // propia), se marcan como vistas para limpiar el globo de notificaciones.
  useEffect(() => { marcarCitasVistas(citasProximas.map(ev => ev.id)); }, [citasProximas]);
  useEffect(() => { if (modal) loadDisponibilidad(form.fecha); }, [form.fecha, modal]);
  useEffect(() => {
    const timer = setInterval(() => setIframeTick(t => t + 1), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const loadDisponibilidad = async (fecha: string) => {
    if (!fecha || getSlotsPermitidos(fecha).length === 0) { setOcupadas([]); return; }
    setLoadingSlots(true);
    try {
      const res = await calendarioService.getDisponibilidad(fecha);
      if (res.success && res.data) {
        setOcupadas(res.data.ocupadas);
        // Si la hora ya elegida quedó ocupada u ocupada por otra reserva, se limpia
        setForm(p => (p.horaInicio && res.data!.ocupadas.includes(parseInt(p.horaInicio, 10))) ? { ...p, horaInicio: '' } : p);
      }
    } catch { /* se deja sin marcar ocupadas si falla */ }
    finally { setLoadingSlots(false); }
  };

  const openModal = () => { setForm(emptyForm()); setError(''); setOcupadas([]); setModal(true); };

  const slotsDelDia = getSlotsPermitidos(form.fecha);

  const handleGuardar = async () => {
    if (!form.nombre || !form.telefono || !form.servicio || !form.fecha || !form.horaInicio) {
      setError('Completa nombre, teléfono, servicio, fecha y hora');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await calendarioService.crearEvento({
        nombre:      form.nombre,
        correo:      form.correo || undefined,
        telefono:    form.telefono,
        patente:     form.patente || undefined,
        servicio:    form.servicio,
        descripcion: form.descripcion || undefined,
        fecha:       form.fecha,
        horaInicio:  form.horaInicio,
      });
      if (!res.success) throw new Error(res.error || 'Error al agendar');
      notify('Hora agendada ✓', 'success');
      setModal(false);
      refrescar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agendar la hora');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (id: string, titulo: string) => {
    if (!confirm(`¿Cancelar "${titulo}"?`)) return;
    try {
      await calendarioService.eliminarEvento(id);
      notify('Hora cancelada', 'info');
      refrescar();
    } catch {
      notify('Error al cancelar la hora', 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Calendario <span>del Taller</span></div>
        <button className="btn btn-primary" onClick={openModal}>+ Agendar Hora</button>
      </div>

      <div className={styles.layout}>
        {/* Calendario embebido */}
        <div className={styles.calendarCol}>
          {embedUrl ? (
            <iframe
              src={`${embedUrl}&_r=${iframeTick}`}
              className={styles.iframe}
              frameBorder={0}
              scrolling="no"
              title="Calendario del Taller"
            />
          ) : (
            <div className={styles.sinConfigurar}>
              <div className={styles.sinConfigurarIcon}>📅</div>
              <div className={styles.sinConfigurarTitulo}>El calendario todavía no está configurado</div>
              <div className={styles.sinConfigurarHint}>
                Agrega la variable <code>VITE_GOOGLE_CALENDAR_URL</code> en el archivo <code>.env</code> del
                cliente, con el link de "Insertar código" que da Google Calendar al integrar el calendario.
              </div>
            </div>
          )}
          <div className={styles.iframeHint}>
            ℹ La vista del calendario se actualiza sola cada 1 minuto (agendar, cancelar, o cambios hechos afuera).
            Atención: Lun–Vie 9:00–18:00 (sin 14:00–15:00) · Sáb 10:00–14:00 · Dom cerrado.
          </div>
        </div>

        {/* Próximas horas agendadas desde la app */}
        <div className={styles.proximosCard}>
          <div className={styles.proximosHeader}>Próximas Horas</div>
          <div className={styles.proximosList}>
            {loadingList && <div className={styles.emptyState}>Cargando…</div>}
            {!loadingList && citasProximas.length === 0 && (
              <div className={styles.emptyState}>Sin horas agendadas próximamente</div>
            )}
            {citasProximas.map(ev => (
              <div key={ev.id} className={styles.proximoItem}>
                <div className={styles.proximoInfo}>
                  <div className={styles.proximoTitulo}>{ev.titulo}</div>
                  <div className={styles.proximoFecha}>{fmtEventoFecha(ev.inicio)}</div>
                </div>
                <button
                  className={styles.proximoEliminar}
                  onClick={() => handleEliminar(ev.id, ev.titulo)}
                  title="Cancelar hora"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MODAL AGENDAR HORA ────────────────────────────── */}
      {modal && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">+ Agendar Hora</div>

            {error && <div className={`login-error ${styles.errorBox}`}>{error}</div>}

            <div className="form-grid fg-2">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Nombre del cliente"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Teléfono *</label>
                <input
                  value={form.telefono}
                  onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                  placeholder="9 XXXX XXXX"
                />
              </div>
            </div>

            <div className={`form-grid fg-2 ${styles.mt1}`}>
              <div className="field">
                <label>Correo (opcional)</label>
                <input
                  type="email"
                  value={form.correo}
                  onChange={e => setForm(p => ({ ...p, correo: e.target.value }))}
                  placeholder="correo@mail.com"
                />
              </div>
              <div className="field">
                <label>Patente (opcional)</label>
                <input
                  className="patente-input"
                  value={form.patente}
                  onChange={e => setForm(p => ({ ...p, patente: e.target.value.toUpperCase() }))}
                  placeholder="ABCD12"
                  maxLength={8}
                />
              </div>
            </div>

            <div className={`field ${styles.mt1}`}>
              <label>Servicio *</label>
              <input
                value={form.servicio}
                onChange={e => setForm(p => ({ ...p, servicio: e.target.value }))}
                placeholder="Ej: Revisión de frenos, Mantención general..."
              />
            </div>

            <div className={`form-grid fg-2 ${styles.mt1}`}>
              <div className="field">
                <label>Fecha *</label>
                <input
                  type="date"
                  value={form.fecha}
                  min={today()}
                  onChange={e => setForm(p => ({ ...p, fecha: e.target.value, horaInicio: '' }))}
                />
              </div>
              <div className="field">
                <label>Hora *</label>
                <select
                  value={form.horaInicio}
                  onChange={e => setForm(p => ({ ...p, horaInicio: e.target.value }))}
                  disabled={loadingSlots || slotsDelDia.length === 0}
                >
                  <option value="">
                    {loadingSlots ? 'Consultando disponibilidad…' : slotsDelDia.length === 0 ? 'Cerrado ese día' : '— Seleccionar —'}
                  </option>
                  {slotsDelDia.map(h => (
                    <option key={h} value={`${String(h).padStart(2, '0')}:00`} disabled={ocupadas.includes(h)}>
                      {fmtHora(h)}{ocupadas.includes(h) ? ' · Ocupado' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={`field ${styles.mt1}`}>
              <label>Descripción (opcional)</label>
              <textarea
                value={form.descripcion}
                onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                rows={3}
                placeholder="Detalles adicionales..."
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardar} disabled={saving}>
                {saving ? 'Agendando...' : '💾 Agendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}