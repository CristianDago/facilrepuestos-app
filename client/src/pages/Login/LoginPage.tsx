import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type Rol } from '../../contexts/AuthContext';
import styles from './LoginPage.module.css';

type Vista = 'selector' | 'admin' | 'mecanico' | 'proveedor';

const formatRut = (value: string): string => {
  const clean = value.replace(/[^0-9kK]/g, '');
  if (clean.length <= 1) return clean;
  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1).toUpperCase();
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
};

// ─── LOGIN ADMIN ──────────────────────────────────────────
function LoginAdmin({ onBack }: { onBack: () => void }) {
  const { loginAdmin } = useAuth();
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await loginAdmin(email, password);
      // No llamar navigate aquí — LoginPage lo hace cuando user queda seteado
    } catch {
      setError('Email o contraseña incorrectos');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <button type="button" className={styles.backBtn} onClick={onBack}>← Volver</button>
      <div className={styles.formTitle}>Acceso Administración</div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.group}>
        <label className={styles.formLabel}>Email</label>
        <input
          className={styles.formInput}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="admin@drmotors.cl"
          required
          autoFocus
        />
      </div>
      <div className={styles.group}>
        <label className={styles.formLabel}>Contraseña</label>
        <input
          className={styles.formInput}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />
      </div>
      <button className={`btn btn-primary ${styles.submitBtn}`} type="submit" disabled={submitting}>
        {submitting ? 'Ingresando...' : 'Ingresar'}
      </button>
    </form>
  );
}

// ─── LOGIN MECÁNICO ───────────────────────────────────────
function LoginMecanico({ onBack }: { onBack: () => void }) {
  const { loginMecanico } = useAuth();
  const [rut, setRut]             = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRut = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRut(formatRut(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await loginMecanico(rut, password);
      // No llamar navigate aquí — LoginPage lo hace cuando user queda seteado
    } catch {
      setError('RUT o contraseña incorrectos');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <button type="button" className={styles.backBtn} onClick={onBack}>← Volver</button>
      <div className={styles.formTitle}>Acceso Mecánicos</div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.group}>
        <label className={styles.formLabel}>RUT</label>
        <input
          className={styles.formInput}
          type="text"
          value={rut}
          onChange={handleRut}
          placeholder="12.345.678-9"
          required
          autoFocus
          maxLength={12}
        />
      </div>
      <div className={styles.group}>
        <label className={styles.formLabel}>Contraseña</label>
        <input
          className={styles.formInput}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />
      </div>
      <button className={`btn btn-dark ${styles.submitBtn}`} type="submit" disabled={submitting}>
        {submitting ? 'Ingresando...' : 'Ingresar'}
      </button>
    </form>
  );
}

// ─── LOGIN PROVEEDOR ──────────────────────────────────────
function LoginProveedor({ onBack }: { onBack: () => void }) {
  const { loginProveedor } = useAuth();
  const [rut, setRut]             = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRut = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRut(formatRut(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await loginProveedor(rut, password);
      // No llamar navigate aquí — LoginPage lo hace cuando user queda seteado
    } catch {
      setError('RUT o contraseña incorrectos');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <button type="button" className={styles.backBtn} onClick={onBack}>← Volver</button>
      <div className={styles.formTitle}>Acceso Proveedores</div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.group}>
        <label className={styles.formLabel}>RUT</label>
        <input
          className={styles.formInput}
          type="text"
          value={rut}
          onChange={handleRut}
          placeholder="76.123.456-7"
          required
          autoFocus
          maxLength={12}
        />
      </div>
      <div className={styles.group}>
        <label className={styles.formLabel}>Contraseña</label>
        <input
          className={styles.formInput}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />
      </div>
      <button className={`btn btn-dark ${styles.submitBtn}`} type="submit" disabled={submitting}>
        {submitting ? 'Ingresando...' : 'Ingresar'}
      </button>
    </form>
  );
}

// ─── LOGIN PAGE ───────────────────────────────────────────
export default function LoginPage() {
  const [vista, setVista] = useState<Vista>('selector');
  const navigate          = useNavigate();
  const { user, loading } = useAuth();

  // FIX: navegar solo cuando el perfil ya está confirmado en el contexto.
  // Antes, navigate() se llamaba justo después de signInWithEmailAndPassword,
  // antes de que fetchPerfil terminara, haciendo que ProtectedRoute viera
  // user=null y redirigiera de vuelta a /login.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    const destino: Record<Rol, string> = { admin: '/', mecanico: '/mecanico', administrativo: '/mecanico', proveedor: '/proveedor' };
    navigate(destino[user.rol] ?? '/', { replace: true });
  }, [user, loading]);

  return (
    <div className={styles.container}>
      <div className={styles.card}>

        <div className={styles.logoWrap}>
          <img
            className={styles.logo}
            src="https://storage.googleapis.com/media-drmotors-cl/img/949fd1e0-logo_dr_motors.webp"
            alt="Dr. Motors"
            onError={e => (e.currentTarget.style.display = 'none')}
          />
        </div>

        {vista === 'selector' && (
          <div>
            <div className={styles.selectorTitle}>Bienvenido</div>
            <div className={styles.selectorSub}>Selecciona tu tipo de acceso</div>

            <div className={styles.options}>
              <button className={`${styles.option} ${styles.optionAdmin}`} onClick={() => setVista('admin')}>
                <span className={styles.optionIcon}>🛠</span>
                <div>
                  <span className={styles.optionTitle}>Administración</span>
                  <span className={styles.optionDesc}>Acceso completo al sistema</span>
                </div>
              </button>

              <button className={styles.option} onClick={() => setVista('mecanico')}>
                <span className={styles.optionIcon}>🔧</span>
                <div>
                  <span className={styles.optionTitle}>Mecánico</span>
                  <span className={styles.optionDesc}>Ver órdenes activas asignadas</span>
                </div>
              </button>

              <button className={styles.option} onClick={() => navigate('/cliente')}>
                <span className={styles.optionIcon}>🚗</span>
                <div>
                  <span className={styles.optionTitle}>Consulta tu Vehículo</span>
                  <span className={styles.optionDesc}>Ingresa tu patente y ve el historial</span>
                </div>
              </button>

              <button className={styles.option} onClick={() => navigate('/taller')}>
                <span className={styles.optionIcon}>🖥</span>
                <div>
                  <span className={styles.optionTitle}>Panel del Taller</span>
                  <span className={styles.optionDesc}>Vista general para pantalla del taller</span>
                </div>
              </button>

              <button className={styles.option} onClick={() => setVista('proveedor')}>
                <span className={styles.optionIcon}>📦</span>
                <div>
                  <span className={styles.optionTitle}>Proveedores</span>
                  <span className={styles.optionDesc}>Sube tus repuestos al inventario</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {vista === 'admin'    && <LoginAdmin    onBack={() => setVista('selector')} />}
        {vista === 'mecanico' && <LoginMecanico onBack={() => setVista('selector')} />}
        {vista === 'proveedor' && <LoginProveedor onBack={() => setVista('selector')} />}

        <div className={styles.cardFooter}>
          <span className={styles.version}>Dr. Motors © 2025</span>
        </div>

      </div>
    </div>
  );
}