import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAppStore } from "../../store/useAppStore";
import styles from "./PanelProveedor.module.css";

type AccentColor = "orange" | "blue" | "green" | "purple";

// Estructura moderna del portal del proveedor:
// Header superior + Menú lateral izquierdo colapsable + Área de trabajo fluida.
//   /proveedor/pos          → Punto de Venta (POS)
//   /proveedor              → Mis Repuestos (Inventario propio)
//   /proveedor/consultas    → Consultas IA (Mostrador)
//   /proveedor/estadisticas → Estadísticas y Reportes
export default function PanelProveedor() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notification, clearNotification } = useAppStore();

  const [sidebarColapsado, setSidebarColapsado] = useState<boolean>(() => {
    return localStorage.getItem("frp_prov_sidebar_collapsed") === "true";
  });
  const [modoOscuro, setModoOscuro] = useState<boolean>(() => {
    return localStorage.getItem("frp_prov_dark_mode") === "true";
  });
  const [accentColor, setAccentColor] = useState<AccentColor>(() => {
    return (localStorage.getItem("frp_prov_accent") as AccentColor) || "orange";
  });
  const [mostrarAyuda, setMostrarAyuda] = useState(false);
  const [mostrarMenuTema, setMostrarMenuTema] = useState(false);

  // Auto-cierre de la notificación (las pantallas hijas avisan con useAppStore().notify)
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => clearNotification(), 3800);
    return () => clearTimeout(timer);
  }, [notification, clearNotification]);

  const toggleSidebar = () => {
    setSidebarColapsado(prev => {
      const next = !prev;
      localStorage.setItem("frp_prov_sidebar_collapsed", String(next));
      return next;
    });
  };

  const toggleModoOscuro = () => {
    setModoOscuro(prev => {
      const next = !prev;
      localStorage.setItem("frp_prov_dark_mode", String(next));
      return next;
    });
  };

  const cambiarAccent = (color: AccentColor) => {
    setAccentColor(color);
    localStorage.setItem("frp_prov_accent", color);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const inicialesUsuario = (user?.nombre || "Proveedor")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() || "")
    .join("");

  const claseSidebarLink = ({ isActive }: { isActive: boolean }) =>
    `${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ""}`;

  return (
    <div
      className={`${styles.wrap} ${modoOscuro ? styles.darkTheme : ""} ${styles[`accent_${accentColor}`]}`}
    >
      {/* ── HEADER SUPERIOR ─────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.brandBlock} onClick={() => navigate("/proveedor/pos")}>
            <img
              className={styles.logo}
              src="/logo-facil-repuestos.webp"
              alt="Fácil Repuestos"
              onError={e => (e.currentTarget.style.display = "none")}
            />
          </div>

          <div className={styles.headerDivider} />

          <div className={styles.titleBlock}>
            <div className={styles.headerTitle}>PANEL PROVEEDOR</div>
            <div className={styles.headerSub}>{user?.nombre || "PROVEEDOR ASOCIADO"}</div>
          </div>

          {/* Iconos rápidos de vista en cabecera */}
          <div className={styles.headerQuickIcons}>
            <button
              type="button"
              className={`${styles.headerQuickBtn} ${location.pathname.includes("/pos") ? styles.headerQuickBtnActive : ""}`}
              onClick={() => navigate("/proveedor/pos")}
              title="Punto de Venta (POS)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button
              type="button"
              className={`${styles.headerQuickBtn} ${location.pathname === "/proveedor" ? styles.headerQuickBtnActive : ""}`}
              onClick={() => navigate("/proveedor")}
              title="Mis Repuestos (Inventario)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </button>
            <button
              type="button"
              className={`${styles.headerQuickBtn} ${location.pathname.includes("/estadisticas") ? styles.headerQuickBtnActive : ""}`}
              onClick={() => navigate("/proveedor/estadisticas")}
              title="Estadísticas y Reportes"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </button>
          </div>
        </div>

        {/* Acciones derechas: Tema, Notificaciones, Ayuda, Perfil y Salir */}
        <div className={styles.headerRight}>
          <div className={styles.themeDropdownWrap}>
            <button
              type="button"
              className={styles.iconCircleBtn}
              onClick={() => setMostrarMenuTema(prev => !prev)}
              title="Personalizar tema y modo oscuro"
            >
              {modoOscuro ? "🌙" : "☀️"}
            </button>
            {mostrarMenuTema && (
              <div className={styles.themePopover} onMouseLeave={() => setMostrarMenuTema(false)}>
                <div className={styles.themePopoverTitle}>Apariencia del Panel</div>
                <button
                  type="button"
                  className={styles.themeModeToggleBtn}
                  onClick={toggleModoOscuro}
                >
                  <span>{modoOscuro ? "🌙 Modo Oscuro activo" : "☀️ Tema Claro activo"}</span>
                  <span className={styles.themeSwitchPill}>{modoOscuro ? "Claro" : "Oscuro"}</span>
                </button>
                <div className={styles.themePopoverSub}>Color de acento</div>
                <div className={styles.accentDotsRow}>
                  <button
                    type="button"
                    className={`${styles.accentDot} ${styles.dotOrange} ${accentColor === "orange" ? styles.accentDotSelected : ""}`}
                    onClick={() => cambiarAccent("orange")}
                    title="Naranja FácilRepuestos"
                  />
                  <button
                    type="button"
                    className={`${styles.accentDot} ${styles.dotBlue} ${accentColor === "blue" ? styles.accentDotSelected : ""}`}
                    onClick={() => cambiarAccent("blue")}
                    title="Azul Corporativo"
                  />
                  <button
                    type="button"
                    className={`${styles.accentDot} ${styles.dotGreen} ${accentColor === "green" ? styles.accentDotSelected : ""}`}
                    onClick={() => cambiarAccent("green")}
                    title="Verde Esmeralda"
                  />
                  <button
                    type="button"
                    className={`${styles.accentDot} ${styles.dotPurple} ${accentColor === "purple" ? styles.accentDotSelected : ""}`}
                    onClick={() => cambiarAccent("purple")}
                    title="Violeta Moderno"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.iconCircleBtn}
            onClick={() => navigate("/proveedor/consultas")}
            title="Consultas IA de Mostrador"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className={styles.notifDot} />
          </button>

          <button
            type="button"
            className={styles.iconCircleBtn}
            onClick={() => setMostrarAyuda(prev => !prev)}
            title="Atajos de teclado y ayuda rápida"
          >
            ?
          </button>

          <div className={styles.userProfilePill}>
            <div className={styles.userAvatar}>{inicialesUsuario || "PR"}</div>
            <span className={styles.userShortName}>{user?.nombre?.split(" ")[0] || "Proveedor"}</span>
          </div>

          {user?.rol === "admin" && (
            <button
              type="button"
              className={styles.btnVolverAdmin}
              onClick={() => navigate("/")}
            >
              ← Panel Admin
            </button>
          )}

          <button type="button" className={styles.btnSalir} onClick={handleLogout}>
            Salir
          </button>
        </div>
      </header>

      {/* ── CUERPO PRINCIPAL: SIDEBAR LATERAL IZQUIERDO + CONTENIDO ── */}
      <div className={styles.bodyLayout}>
        <aside className={`${styles.sidebar} ${sidebarColapsado ? styles.sidebarCollapsed : ""}`}>
          <div className={styles.sidebarSectionLabel}>
            {sidebarColapsado ? "•••" : "MENÚ PROVEEDOR"}
          </div>

          <nav className={styles.sidebarNav}>
            <NavLink to="/proveedor/pos" className={claseSidebarLink} title="Punto de Venta (POS)">
              <span className={styles.sidebarIcon}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </span>
              {!sidebarColapsado && <span className={styles.sidebarText}>Punto de Venta (POS)</span>}
            </NavLink>

            <NavLink to="/proveedor" end className={claseSidebarLink} title="Mis Repuestos">
              <span className={styles.sidebarIcon}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </span>
              {!sidebarColapsado && <span className={styles.sidebarText}>Mis Repuestos</span>}
            </NavLink>

            <NavLink to="/proveedor/consultas" className={claseSidebarLink} title="Consultas IA (Mostrador)">
              <span className={styles.sidebarIcon}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              {!sidebarColapsado && <span className={styles.sidebarText}>Consultas IA (Mostrador)</span>}
            </NavLink>

            <NavLink to="/proveedor/estadisticas" className={claseSidebarLink} title="Estadísticas">
              <span className={styles.sidebarIcon}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              {!sidebarColapsado && <span className={styles.sidebarText}>Estadísticas</span>}
            </NavLink>
          </nav>

          <div className={styles.sidebarFooter}>
            <button
              type="button"
              className={styles.collapseBtn}
              onClick={toggleSidebar}
              title={sidebarColapsado ? "Expandir menú lateral" : "Contraer menú lateral"}
            >
              <span>{sidebarColapsado ? "›" : "‹"}</span>
              {!sidebarColapsado && <span className={styles.collapseBtnText}>Contraer menú</span>}
            </button>
          </div>
        </aside>

        {/* Área de trabajo principal */}
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      {/* Modal rápido de Ayuda y Atajos */}
      {mostrarAyuda && (
        <div className={styles.helpModalOverlay} onClick={() => setMostrarAyuda(false)}>
          <div className={styles.helpModalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.helpModalHeader}>
              <strong>⚡ Atajos Rápidos del Panel Proveedor</strong>
              <button type="button" onClick={() => setMostrarAyuda(false)}>✕</button>
            </div>
            <div className={styles.helpModalBody}>
              <div className={styles.helpShortcutRow}>
                <kbd>Pistola / Enter</kbd>
                <span>Agrega el repuesto escaneado directo al Mostrador / Ventana con retención por 30 min.</span>
              </div>
              <div className={styles.helpShortcutRow}>
                <kbd>F4</kbd>
                <span>Cobra la venta actual en el POS e imprime el ticket térmico inmediatamente.</span>
              </div>
              <div className={styles.helpShortcutRow}>
                <kbd>Esc</kbd>
                <span>Cierra ventanas emergentes y devuelve el foco automático al lector de códigos.</span>
              </div>
            </div>
          </div>
        </div>
      )}

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
