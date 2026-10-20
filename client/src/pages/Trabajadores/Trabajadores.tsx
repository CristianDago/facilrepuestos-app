import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { Usuario, Liquidacion } from '../../types';
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './Trabajadores.module.css';

const ROL_LABEL: Record<string, string> = {
  admin:          '🛠 Administrador',
  mecanico:       '🔧 Mecánico',
  administrativo: '📋 Administrativo',
};

const formatRut = (value: string): string => {
  const clean = value.replace(/[^0-9kK]/g, '');
  if (clean.length <= 1) return clean;
  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1).toUpperCase();
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
};

const EMPTY: Omit<Usuario, 'id' | 'uid' | 'createdAt' | 'updatedAt'> & { password: string } = {
  nombre: '', apellido: '', rut: '', telefono: '',
  email: '', especialidad: '', cargo: '',
  rol: 'mecanico', activo: true, password: '',
};

const fmtCLP   = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// El "periodo" se guarda como texto libre "Mes Año" (ej: "Julio 2026"), así
// que no se puede ordenar alfabéticamente — hay que convertirlo a un valor
// comparable (año × 12 + mes) para que quede en orden cronológico real.
const MESES_ORDEN = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const valorPeriodo = (periodo: string): number => {
  const partes = periodo.trim().split(' ');
  if (partes.length !== 2) return 0;
  const mesIdx = MESES_ORDEN.indexOf(partes[0].toLowerCase());
  const anio = parseInt(partes[1], 10);
  if (mesIdx === -1 || isNaN(anio)) return 0;
  return anio * 12 + mesIdx;
};
const ordenarPorPeriodo = (lista: Liquidacion[]): Liquidacion[] =>
  [...lista].sort((a, b) => valorPeriodo(b.periodo) - valorPeriodo(a.periodo)); // más reciente primero

// ─── Componente lista de liquidaciones ───────────────────
function LiquidacionesList({
  usuarioId,
  authHeaders,
}: {
  usuarioId: string;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [loading, setLoading]             = useState(true);
  const [deleting, setDeleting]           = useState<string | null>(null);

  useEffect(() => {
    if (!usuarioId) return;
    loadLiqs();
  }, [usuarioId]);

  const loadLiqs = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res  = await fetch(`${import.meta.env.VITE_API_URL}/api/liquidaciones/${usuarioId}`, { headers });
      const data = await res.json();
      if (data.success) setLiquidaciones(ordenarPorPeriodo(data.data));
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta liquidación?')) return;
    setDeleting(id);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/liquidaciones/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Error ${res.status} al eliminar`);
      }
      setLiquidaciones(prev => prev.filter(l => l.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar la liquidación');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div className={styles.liqLoading}>Cargando...</div>;
  if (liquidaciones.length === 0) return (
    <div className={styles.liqEmpty}>
      Sin liquidaciones registradas
    </div>
  );

  return (
    <div className={styles.liqList}>
      {liquidaciones.map(liq => (
        <div key={liq.id} className={styles.liqItem}>
          <div className={styles.liqInfo}>
            <div className={styles.liqPeriodo}>{liq.periodo}</div>
            <div className={styles.liqMeta}>
              {fmtFecha(liq.createdAt)}
              {liq.monto > 0 && ` · ${fmtCLP(liq.monto)}`}
            </div>
          </div>
          <a href={liq.url} target="_blank" rel="noopener noreferrer"
            className={`btn btn-sm btn-outline ${styles.liqVerBtn}`}>
            Ver
          </a>
          <button
            className={`btn btn-sm ${styles.liqDeleteBtn}`}
            disabled={deleting === liq.id}
            onClick={() => handleDelete(liq.id)}
          >
            {deleting === liq.id ? '...' : '✕'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Trabajadores() {
  const { getToken } = useAuth();
  const [trabajadores, setTrabajadores] = useState<Usuario[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [editMode, setEditMode]         = useState<'crear' | 'editar'>('crear');
  const [form, setForm]                 = useState({ ...EMPTY });
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [resetPwd, setResetPwd]         = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [search, setSearch]             = useState('');

  const filtered = trabajadores.filter(t => {
    const q = search.toLowerCase();
    return !q || t.nombre.toLowerCase().includes(q) ||
      (t.rut || '').toLowerCase().includes(q) ||
      (t.rol || '').toLowerCase().includes(q);
  });
  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  // ── Liquidaciones ─────────────────────────────────────────
  const [showLiqModal, setShowLiqModal] = useState(false);
  const [liqUsuarioId, setLiqUsuarioId] = useState('');
  const [liqUsuarioNombre, setLiqUsuarioNombre] = useState('');
  const [liqPeriodo, setLiqPeriodo]     = useState('');
  const [liqMonto, setLiqMonto]         = useState('');
  const [liqFile, setLiqFile]           = useState<File | null>(null);
  const [uploadingLiq, setUploadingLiq] = useState(false);
  const [liqError, setLiqError]         = useState('');
  const liqFileRef = useRef<HTMLInputElement>(null);

  // ── Contrato ───────────────────────────────────────────────
  const [showContratoModal, setShowContratoModal] = useState(false);
  const [contratoUsuario, setContratoUsuario]     = useState<Usuario | null>(null);
  const [contratoFile, setContratoFile]           = useState<File | null>(null);
  const [uploadingContrato, setUploadingContrato] = useState(false);
  const [contratoError, setContratoError]         = useState('');
  const contratoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadTrabajadores(); }, []);

  const authHeaders = async () => {
    const token = await getToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };

  const loadTrabajadores = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res  = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios`, { headers });
      const data = await res.json();
      if (data.success) setTrabajadores(data.data);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  const openCrear = () => {
    setForm({ ...EMPTY });
    setEditMode('crear');
    setError('');
    setShowModal(true);
  };

  const openEditar = (t: Usuario) => {
    setForm({
      nombre: t.nombre, apellido: t.apellido, rut: t.rut,
      telefono: t.telefono, email: t.email || '',
      especialidad: t.especialidad || '', cargo: t.cargo || '',
      rol: t.rol, activo: t.activo, password: '',
    });
    setSelectedId(t.id!);
    setEditMode('editar');
    setError('');
    setShowModal(true);
  };

  const handleRut = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9kK.\-]/g, '');
    setForm(p => ({ ...p, rut: formatRut(raw.replace(/[.\-]/g, '')) }));
  };

  const handleSave = async () => {
    if (!form.nombre || !form.apellido || !form.rut) {
      setError('Nombre, apellido y RUT son obligatorios');
      return;
    }
    if (editMode === 'crear' && !form.password) {
      setError('Debes establecer una contraseña inicial');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const headers = await authHeaders();
      let res;
      if (editMode === 'crear') {
        res = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios`, {
          method: 'POST', headers, body: JSON.stringify(form),
        });
      } else {
        const { password, ...rest } = form;
        res = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/${selectedId}`, {
          method: 'PUT', headers, body: JSON.stringify(rest),
        });
      }
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Error al guardar'); return; }
      setShowModal(false);
      loadTrabajadores();
    } catch {
      setError('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwd || !selectedId) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/${selectedId}/password`, {
        method: 'PUT', headers, body: JSON.stringify({ password: resetPwd }),
      });
      setShowResetModal(false);
      setResetPwd('');
    } catch { /* silencioso */ }
    finally { setSaving(false); }
  };

  const openLiqModal = (t: Usuario) => {
    setLiqUsuarioId(t.id!);
    setLiqUsuarioNombre(`${t.nombre} ${t.apellido}`);
    setLiqPeriodo('');
    setLiqMonto('');
    setLiqFile(null);
    setLiqError('');
    setShowLiqModal(true);
  };

  const handleUploadLiq = async () => {
    if (!liqFile || !liqPeriodo || !liqUsuarioId) return;
    setUploadingLiq(true);
    setLiqError('');
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', liqFile);
      formData.append('subfolder', liqUsuarioNombre.replace(/\s+/g, '_'));
      const uploadRes = await fetch(`${import.meta.env.VITE_API_URL}/api/drive/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error(uploadData.error || 'Error subiendo archivo');
      const headers = await authHeaders();
      await fetch(`${import.meta.env.VITE_API_URL}/api/liquidaciones`, {
        method: 'POST', headers,
        body: JSON.stringify({
          usuarioId: liqUsuarioId,
          periodo:   liqPeriodo,
          monto:     parseFloat(liqMonto) || 0,
          url:       `${import.meta.env.VITE_API_URL}/api/drive/file/${uploadData.fileId}`,
          fileName:  liqFile.name,
          fileId:    uploadData.fileId,
        }),
      });
      setShowLiqModal(false);
    } catch (err) {
      setLiqError(err instanceof Error ? err.message : 'Error subiendo archivo');
    } finally {
      setUploadingLiq(false);
    }
  };

  const openContratoModal = (t: Usuario) => {
    setContratoUsuario(t);
    setContratoFile(null);
    setContratoError('');
    setShowContratoModal(true);
  };

  const handleUploadContrato = async () => {
    if (!contratoFile || !contratoUsuario?.id) return;
    setUploadingContrato(true);
    setContratoError('');
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', contratoFile);
      // Misma carpeta por trabajador que usan la foto de perfil y las liquidaciones
      formData.append('subfolder', `${contratoUsuario.nombre} ${contratoUsuario.apellido}`.replace(/\s+/g, '_'));
      const uploadRes = await fetch(`${import.meta.env.VITE_API_URL}/api/drive/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.error || `Error ${uploadRes.status} al subir a Drive`);
      }
      const contratoUrl = `${import.meta.env.VITE_API_URL}/api/drive/file/${uploadData.fileId}`;
      const headers = await authHeaders();
      const saveRes = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/${contratoUsuario.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          ...contratoUsuario,
          contratoUrl,
          contratoFileName: contratoFile.name,
          contratoFecha: new Date().toISOString(),
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        throw new Error(saveData.error || `Error ${saveRes.status} al guardar`);
      }
      setShowContratoModal(false);
      loadTrabajadores();
    } catch (err) {
      setContratoError(err instanceof Error ? err.message : 'Error subiendo el contrato');
    } finally {
      setUploadingContrato(false);
    }
  };

  const handleToggleActivo = async (t: Usuario) => {
    const headers = await authHeaders();
    await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/${t.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...t, activo: !t.activo }),
    });
    loadTrabajadores();
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Trabajadores <span>del Taller</span></div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar nombre, RUT, rol..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openCrear}>+ Nuevo Trabajador</button>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Cargando...</div>
      ) : (
        <>
          <Pagination
            page={page} totalPages={totalPages} totalItems={filtered.length}
            pageSize={pageSize} onPage={goTo} onPageSize={changeSize}
          />
          <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>RUT</th>
                <th>Rol</th>
                <th>Especialidad / Cargo</th>
                <th>Teléfono</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {trabajadores.length === 0 ? (
                <tr><td colSpan={7} className={styles.emptyRow}>
                  Sin trabajadores registrados
                </td></tr>
              ) : paged.map(t => (
                <tr key={t.id}>
                  <td data-label="Nombre">
                    <div className={styles.cellNombre}>{t.nombre} {t.apellido}</div>
                    {t.email && <div className={styles.cellEmail}>{t.email}</div>}
                  </td>
                  <td data-label="RUT" className="hide-mobile">{t.rut}</td>
                  <td data-label="Rol">
                    <span className="badge badge-proceso">{ROL_LABEL[t.rol] || t.rol}</span>
                  </td>
                  <td data-label="Especialidad" className={styles.colorGray}>{t.especialidad || t.cargo || '—'}</td>
                  <td data-label="Teléfono" className="hide-mobile">{t.telefono || '—'}</td>
                  <td data-label="Estado">
                    <span className={`badge ${t.activo ? 'badge-listo' : 'badge-entregado'}`}>
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    <div className={styles.accionesRow}>
                      <button className="btn btn-sm btn-outline" onClick={() => openEditar(t)}>
                        Editar
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => {
                          setSelectedId(t.id!);
                          setResetPwd('');
                          setShowResetModal(true);
                        }}
                      >
                        🔑 Clave
                      </button>
                      <button className="btn btn-sm btn-outline" onClick={() => openLiqModal(t)}>
                        📄 Liquidación
                      </button>
                      <button className="btn btn-sm btn-outline" onClick={() => openContratoModal(t)}>
                        📝 Contrato
                      </button>
                      <button
                        className={`btn btn-sm ${t.activo ? 'btn-outline' : 'btn-primary'}`}
                        onClick={() => handleToggleActivo(t)}
                      >
                        {t.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* ── MODAL CREAR / EDITAR ──────────────────────────── */}
      {showModal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalTrabajador}`}>
            <div className="modal-title">
              {editMode === 'crear' ? '+ Nuevo Trabajador' : 'Editar Trabajador'}
            </div>

            {error && <div className={`login-error ${styles.errorBox}`}>{error}</div>}

            <div className="form-grid fg-2">
              <div className="field">
                <label>Nombre *</label>
                <input value={form.nombre}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value.toUpperCase() }))} />
              </div>
              <div className="field">
                <label>Apellido *</label>
                <input value={form.apellido}
                  onChange={e => setForm(p => ({ ...p, apellido: e.target.value.toUpperCase() }))} />
              </div>
              <div className="field">
                <label>RUT *</label>
                <input value={form.rut}
                  onChange={handleRut} placeholder="12.345.678-9"
                  readOnly={editMode === 'editar'} />
              </div>
              <div className="field">
                <label>Teléfono</label>
                <input value={form.telefono}
                  onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} />
              </div>
              <div className="field">
                <label>Email (opcional)</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="Para acceso como admin" />
              </div>
              <div className="field">
                <label>Rol *</label>
                <select value={form.rol}
                  onChange={e => setForm(p => ({ ...p, rol: e.target.value as 'admin' | 'mecanico' | 'administrativo' }))}>
                  <option value="mecanico">Mecánico</option>
                  <option value="administrativo">Administrativo</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div className="field">
                <label>Especialidad</label>
                <input value={form.especialidad}
                  onChange={e => setForm(p => ({ ...p, especialidad: e.target.value.toUpperCase() }))}
                  placeholder="Ej: Suspensión, Eléctrico..." />
              </div>
              <div className="field">
                <label>Cargo</label>
                <input value={form.cargo}
                  onChange={e => setForm(p => ({ ...p, cargo: e.target.value.toUpperCase() }))}
                  placeholder="Ej: Mecánico Senior" />
              </div>
              {editMode === 'crear' && (
                <div className={`field ${styles.fullWidth}`}>
                  <label>Contraseña inicial *</label>
                  <input type="password" value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="Mínimo 6 caracteres" />
                  <div className="field-hint">
                    El mecánico usará su RUT + esta contraseña para ingresar
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : editMode === 'crear' ? 'Crear Trabajador' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL RESET PASSWORD ─────────────────────────── */}
      {showResetModal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalResetPassword}`}>
            <div className="modal-title">🔑 Cambiar Contraseña</div>
            <div className="field">
              <label>Nueva contraseña</label>
              <input type="password" value={resetPwd}
                onChange={e => setResetPwd(e.target.value)} placeholder="Mínimo 6 caracteres" autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowResetModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleResetPassword} disabled={saving || !resetPwd}>
                {saving ? 'Cambiando...' : 'Cambiar Contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL LIQUIDACIÓN ────────────────────────────── */}
      {showLiqModal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalLiquidacion}`}>
            <div className="modal-title">📄 Liquidaciones</div>
            <div className="modal-sub">{liqUsuarioNombre}</div>

            {liqError && <div className={`login-error ${styles.errorBox}`}>{liqError}</div>}

            {/* Lista de liquidaciones existentes */}
            <LiquidacionesList usuarioId={liqUsuarioId} authHeaders={authHeaders} />

            <div className="modal-sep" />
            <div className={styles.uploadSectionTitle}>➕ Subir nueva liquidación</div>

            <div className={styles.uploadForm}>
              <div className="form-grid fg-2">
                <div className="field">
                  <label>Mes *</label>
                  <select
                    value={liqPeriodo.split(' ')[0] || ''}
                    onChange={e => {
                      const anio = liqPeriodo.split(' ')[1] || new Date().getFullYear().toString();
                      setLiqPeriodo(`${e.target.value} ${anio}`);
                    }}
                  >
                    <option value="">Seleccionar...</option>
                    {['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Año *</label>
                  <select
                    value={liqPeriodo.split(' ')[1] || new Date().getFullYear().toString()}
                    onChange={e => {
                      const mes = liqPeriodo.split(' ')[0] || '';
                      setLiqPeriodo(`${mes} ${e.target.value}`);
                    }}
                  >
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Monto líquido (opcional)</label>
                <input type="number" value={liqMonto}
                  onChange={e => setLiqMonto(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label>Archivo PDF *</label>
                <div onClick={() => liqFileRef.current?.click()} className={styles.fileDropzone}>
                  {liqFile
                    ? <span className={styles.fileSelected}>✓ {liqFile.name}</span>
                    : <span className={styles.colorGray}>Haz clic para seleccionar PDF</span>
                  }
                </div>
                <input ref={liqFileRef} type="file" accept=".pdf" className={styles.hiddenInput}
                  onChange={e => setLiqFile(e.target.files?.[0] || null)} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowLiqModal(false)}>Cerrar</button>
              <button className="btn btn-primary" onClick={handleUploadLiq}
                disabled={uploadingLiq || !liqFile || !liqPeriodo.includes(' ')}>
                {uploadingLiq ? 'Subiendo...' : '⬆ Subir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL CONTRATO ────────────────────────────────── */}
      {showContratoModal && contratoUsuario && (
        <div className="overlay open">
          <div className={`modal ${styles.modalLiquidacion}`}>
            <div className="modal-title">📝 Contrato</div>
            <div className="modal-sub">{contratoUsuario.nombre} {contratoUsuario.apellido}</div>

            {contratoError && <div className={`login-error ${styles.errorBox}`}>{contratoError}</div>}

            {/* Contrato vigente */}
            {contratoUsuario.contratoUrl ? (
              <div className={styles.liqItem}>
                <div className={styles.liqInfo}>
                  <div className={styles.liqPeriodo}>{contratoUsuario.contratoFileName || 'Contrato'}</div>
                  <div className={styles.liqMeta}>
                    {contratoUsuario.contratoFecha ? fmtFecha(contratoUsuario.contratoFecha) : ''}
                  </div>
                </div>
                <a href={contratoUsuario.contratoUrl} target="_blank" rel="noopener noreferrer"
                  className={`btn btn-sm btn-outline ${styles.liqVerBtn}`}>
                  Ver
                </a>
              </div>
            ) : (
              <div className={styles.liqEmpty}>Aún no hay contrato registrado</div>
            )}

            <div className="modal-sep" />
            <div className={styles.uploadSectionTitle}>
              ➕ {contratoUsuario.contratoUrl ? 'Subir nuevo contrato (reemplaza el actual)' : 'Subir contrato'}
            </div>

            <div className={styles.uploadForm}>
              <div className="field">
                <label>Archivo PDF *</label>
                <div onClick={() => contratoFileRef.current?.click()} className={styles.fileDropzone}>
                  {contratoFile
                    ? <span className={styles.fileSelected}>✓ {contratoFile.name}</span>
                    : <span className={styles.colorGray}>Haz clic para seleccionar PDF</span>
                  }
                </div>
                <input ref={contratoFileRef} type="file" accept=".pdf" className={styles.hiddenInput}
                  onChange={e => setContratoFile(e.target.files?.[0] || null)} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowContratoModal(false)}>Cerrar</button>
              <button className="btn btn-primary" onClick={handleUploadContrato}
                disabled={uploadingContrato || !contratoFile}>
                {uploadingContrato ? 'Subiendo...' : '⬆ Subir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}