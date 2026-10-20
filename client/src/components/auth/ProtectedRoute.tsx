import { Navigate } from 'react-router-dom';
import { useAuth, type Rol } from '../../contexts/AuthContext';
import styles from './ProtectedRoute.module.css';

interface Props {
  children: React.ReactNode;
  roles?: Rol[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <div className={styles.loadingBox}>
          <div className={styles.loadingIcon}>⚙</div>
          <div>Verificando sesión...</div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.rol)) return <Navigate to="/" replace />;

  return <>{children}</>;
}