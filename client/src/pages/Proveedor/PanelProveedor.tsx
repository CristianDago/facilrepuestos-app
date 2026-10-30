import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAppStore } from "../../store/useAppStore";
import styles from "./PanelProveedor.module.css";

// Estructura del portal del proveedor: cabecera + menú + contenido.
//   /proveedor              → Mis Repuestos (inventario propio, mismo formulario que el taller)
//   /proveedor/estadisticas → Estadísticas de sus repuestos
export default function PanelProveedor() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { notification, clearNotification } = useAppStore();

  // Auto-cierre de la notificación (las pantallas hijas avisan con useAppStore().notify)
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => clearNotification(), 3800);
    return () => clearTimeout(timer);
  }, [notification, clearNotification]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const claseLink = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <img
            className={styles.logo}
            src="https://storage.googleapis.com/media-drmotors-cl/img/949fd1e0-logo_dr_motors.webp"
            alt="Dr. Motors"
            onError={e => (e.currentTarget.style.display = "none")}
          />
          <div>
            <div className={styles.headerTitle}>Panel Proveedor</div>
            <div className={styles.headerSub}>{user?.nombre}</div>
          </div>
        </div>
        <button className="btn btn-dark btn-sm" onClick={handleLogout}>Salir</button>
      </div>

      <nav className={styles.nav}>
        <NavLink to="/proveedor/pos" className={claseLink}>🛒 Punto de Venta (POS)</NavLink>
        <NavLink to="/proveedor" end className={claseLink}>📦 Mis Repuestos</NavLink>
        <NavLink to="/proveedor/consultas" className={claseLink}>🧠 Consultas IA (Mostrador)</NavLink>
        <NavLink to="/proveedor/estadisticas" className={claseLink}>📊 Estadísticas</NavLink>
      </nav>

      <div className={styles.content}>
        <Outlet />
      </div>

      {notification && (
        <div className={`notif ${notification.type} show`}>
          {notification.type === "success"
            ? "✓ "
            : notification.type === "error"
            ? "✕ "
            : "ℹ "}
          {notification.message}
        </div>
      )}
    </div>
  );
}