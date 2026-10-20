import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { Liquidacion } from '../../types';
import styles from './MiPerfil.module.css';

interface PerfilData {
  nombre:       string;
  apellido:     string;
  rut:          string;
  telefono:     string;
  especialidad: string;
  cargo:        string;
  fotoUrl:      string;
  email:        string;
  rol?:         'admin' | 'mecanico' | 'administrativo';
  contratoUrl?:      string;
  contratoFileName?: string;
  contratoFecha?:    string;
}

const fmtCLP   = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

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

export default function MiPerfil() {
  const { user, getToken }   = useAuth();
  const [perfil, setPerfil]  = useState<PerfilData | null>(null);
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [docId, setDocId]       = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  const authHeaders = async () => {
    const token = await getToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();

      // Obtener perfil propio
      const meRes  = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/me`, { headers });
      const meData = await meRes.json();
      if (meData.success) setPerfil(meData.data);

      // Obtener docId por uid
      const byUidRes  = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/by-uid/${user?.uid}`, { headers });
      const byUidData = await byUidRes.json();
      if (byUidData.success) {
        const id = byUidData.data.id;
        setDocId(id);
        const liqRes  = await fetch(`${import.meta.env.VITE_API_URL}/api/liquidaciones/${id}`, { headers });
        const liqData = await liqRes.json();
        if (liqData.success) setLiquidaciones(ordenarPorPeriodo(liqData.data));
      }
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docId || !perfil) return;
    setUploading(true);
    setUploadError('');
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      // Misma carpeta que usan las liquidaciones de este trabajador
      // (una carpeta por persona con foto + liquidaciones juntas)
      formData.append('subfolder', `${perfil.nombre} ${perfil.apellido}`.replace(/\s+/g, '_'));
      const uploadRes = await fetch(`${import.meta.env.VITE_API_URL}/api/drive/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.error || `Error ${uploadRes.status} al subir a Drive`);
      }
      const headers = await authHeaders();
      const fotoUrl = `${import.meta.env.VITE_API_URL}/api/drive/file/${uploadData.fileId}`;
      const saveRes  = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/${docId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ ...perfil, fotoUrl }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        throw new Error(saveData.error || `Error ${saveRes.status} al guardar el perfil`);
      }
      setPerfil(p => p ? { ...p, fotoUrl: `${fotoUrl}?t=${Date.now()}` } : p);
    } catch (err) {
      console.error('Error subiendo foto:', err);
      setUploadError(err instanceof Error ? err.message : 'Error subiendo la foto');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className={styles.loading}>Cargando...</div>;
  if (!perfil) return <div className={styles.loading}>Error al cargar perfil</div>;

  const totalLiq = liquidaciones.reduce((s, l) => s + (l.monto || 0), 0);

  return (
    <div className={styles.pageWrap}>
      <div className={`page-title ${styles.titleSpacing}`}>
        Mi <span>Perfil</span>
      </div>

      {/* ── TARJETA PERSONAL ──────────────────────────────── */}
      <div className={styles.profileCard}>
        {/* Foto */}
        <div className={styles.photoWrap}>
          <div className={styles.photoCircle}>
            {perfil.fotoUrl
              ? (
                <img
                  src={perfil.fotoUrl}
                  alt="Foto"
                  className={styles.photoImg}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              )
              : <span className={styles.photoPlaceholder}>👤</span>
            }
          </div>
          <button
            onClick={() => fotoRef.current?.click()}
            disabled={uploading}
            title="Cambiar foto"
            className={styles.photoEditBtn}
          >
            {uploading ? '⏳' : '📷'}
          </button>
          <input ref={fotoRef} type="file" accept="image/*" className={styles.hiddenInput} onChange={handleFotoChange} />
          {uploadError && <div className={styles.uploadError}>{uploadError}</div>}
        </div>

        {/* Datos */}
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>
            {perfil.nombre} {perfil.apellido}
          </div>
          <div className={styles.profileRole}>
            {perfil.especialidad || perfil.cargo || (perfil.rol === 'administrativo' ? 'Administrativo' : 'Mecánico')}
          </div>
          <div className={styles.infoGrid}>
            {[
              { label: 'RUT',          value: perfil.rut          || '—' },
              { label: 'Teléfono',     value: perfil.telefono     || '—' },
              { label: 'Email',        value: perfil.email        || '—' },
              { label: 'Especialidad', value: perfil.especialidad || '—' },
            ].map(f => (
              <div key={f.label}>
                <div className={styles.infoLabel}>{f.label}</div>
                <div className={styles.infoValue}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MI CONTRATO ────────────────────────────────────── */}
      <div className={styles.liquidacionesCard}>
        <div className={styles.liqHeader}>
          <div className={styles.liqTitle}>
            📝 Mi Contrato
          </div>
          {perfil.contratoFecha && (
            <div className={styles.liqSummary}>
              Actualizado el {fmtFecha(perfil.contratoFecha)}
            </div>
          )}
        </div>

        {perfil.contratoUrl ? (
          <div className={styles.timelineWrap}>
            <div className={styles.timelineList}>
              <div className={styles.timelineItem}>
                <div className={styles.timelineDot}>📝</div>
                <div className={styles.timelineCard}>
                  <div>
                    <div className={styles.timelinePeriodo}>{perfil.contratoFileName || 'Contrato'}</div>
                  </div>
                  <div className={styles.timelineRight}>
                    <a href={perfil.contratoUrl} target="_blank" rel="noopener noreferrer"
                      className={`btn btn-sm btn-outline ${styles.timelineDescargarBtn}`}>
                      ⬇ Ver
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.liqEmpty}>
            Aún no tienes un contrato registrado. Consulta con administración.
          </div>
        )}
      </div>

      {/* ── LIQUIDACIONES TIMELINE ────────────────────────── */}
      <div className={styles.liquidacionesCard}>
        <div className={styles.liqHeader}>
          <div className={styles.liqTitle}>
            📄 Mis Liquidaciones
          </div>
          <div className={styles.liqSummary}>
            {liquidaciones.length} liquidación{liquidaciones.length !== 1 ? 'es' : ''}
            {totalLiq > 0 && ` · Total: ${fmtCLP(totalLiq)}`}
          </div>
        </div>

        {liquidaciones.length === 0 ? (
          <div className={styles.liqEmpty}>
            Aún no tienes liquidaciones registradas
          </div>
        ) : (
          <div className={styles.timelineWrap}>
            <div className={styles.timelineLine} />
            <div className={styles.timelineList}>
              {liquidaciones.map((liq, i) => (
                <div key={liq.id} className={styles.timelineItem}>
                  <div className={`${styles.timelineDot} ${i === 0 ? styles.reciente : ''}`}>📄</div>
                  <div className={styles.timelineCard}>
                    <div>
                      <div className={styles.timelinePeriodo}>{liq.periodo}</div>
                      <div className={styles.timelineFecha}>{fmtFecha(liq.createdAt)}</div>
                    </div>
                    <div className={styles.timelineRight}>
                      {liq.monto > 0 && (
                        <span className={styles.timelineMonto}>
                          {fmtCLP(liq.monto)}
                        </span>
                      )}
                      <a href={liq.url} target="_blank" rel="noopener noreferrer"
                        className={`btn btn-sm btn-outline ${styles.timelineDescargarBtn}`}>
                        ⬇ Descargar
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}