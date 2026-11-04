import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCitasNotificaciones } from '../hooks/useCitasNotificaciones';
import styles from './MecanicoLayout.module.css';

export default function MecanicoLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { citasNuevas } = useCitasNotificaciones();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const closeMenu = () => setMenuOpen(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;

  return (
    <div className={styles.rootWrapper}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos" className={styles.logo}
            onError={e => (e.currentTarget.style.display = 'none')}
          />
          {/* Nav tabs — escritorio */}
          <nav className={styles.nav}>
            <NavLink to="/mecanico" end className={navLinkClass}>🔧 Órdenes</NavLink>
            <NavLink to="/mecanico/calendario" className={navLinkClass}>
              📅 Calendario
              {citasNuevas > 0 && <span className={styles.navBadge}>{citasNuevas}</span>}
            </NavLink>
            <NavLink to="/mecanico/perfil" className={navLinkClass}>👤 Mi Perfil</NavLink>
          </nav>
        </div>

        <div className={styles.headerRight}>
          <span className={styles.userName}>
            {user?.nombre} {user?.apellido}
          </span>
          <button className="btn btn-sm btn-outline" onClick={handleLogout}>Salir</button>

          {/* Botón hamburguesa — solo mobile */}
          <button
            className={styles.hamburgerBtn}
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Abrir menú"
          >
            {menuOpen ? '✕' : '☰'}
            {!menuOpen && citasNuevas > 0 && <span className={styles.hamburgerBadge}>{citasNuevas}</span>}
          </button>
        </div>
      </header>

      {/* Menú desplegable — solo mobile */}
      {menuOpen && (
        <>
          <div className={styles.mobileBackdrop} onClick={closeMenu} />
          <nav className={styles.mobileMenu}>
            <NavLink to="/mecanico" end className={navLinkClass} onClick={closeMenu}>🔧 Órdenes</NavLink>
            <NavLink to="/mecanico/calendario" className={navLinkClass} onClick={closeMenu}>
              📅 Calendario
              {citasNuevas > 0 && <span className={styles.navBadge}>{citasNuevas}</span>}
            </NavLink>
            <NavLink to="/mecanico/perfil" className={navLinkClass} onClick={closeMenu}>👤 Mi Perfil</NavLink>
            <button
              className={`btn btn-sm btn-outline ${styles.mobileLogoutBtn}`}
              onClick={() => { closeMenu(); handleLogout(); }}
            >
              Salir
            </button>
          </nav>
        </>
      )}

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}