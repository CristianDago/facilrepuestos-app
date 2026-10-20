import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { useAuth } from "../contexts/AuthContext";
import { useCitasNotificaciones } from "../hooks/useCitasNotificaciones";
import styles from './MainLayout.module.css';

export default function MainLayout() {
  const { notification, clearNotification, vehiculos } = useAppStore();
  const { user, logout } = useAuth();
  const { citasNuevas } = useCitasNotificaciones();
  const [searchValue, setSearchValue]   = useState("");
  const [searchResults, setSearchResults] = useState<typeof vehiculos>([]);
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // ─── SIDEBAR MÓVIL ───────────────────────────────────────
  const closeSidebar = () => setSidebarOpen(false);

  // Cerrar el drawer si la ventana vuelve a tamaño desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 860) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ─── BÚSQUEDA GLOBAL ─────────────────────────────────────
  const handleSearch = (value: string) => {
    setSearchValue(value.toUpperCase());
    if (value.length < 3) {
      setSearchResults([]);
      return;
    }
    const q = value.toLowerCase();
    const results = vehiculos
      .filter(
        (v) =>
          v.patente.toLowerCase().includes(q) ||
          v.make?.toLowerCase().includes(q) ||
          v.owner?.toLowerCase().includes(q)
      )
      .slice(0, 6);
    setSearchResults(results);
  };

  const navState = (v: (typeof vehiculos)[0]) => ({
    patente: v.patente,
    make: v.make,
    model: v.model,
    year: v.year,
    type: v.type,
    engine: v.engine,
    owner: v.owner,
    telefono: v.telefono,
    email: v.email,
  });

  const closeSearch = () => {
    setSearchValue("");
    setSearchResults([]);
  };

  // Auto-cierre de notificación — solo se dispara una vez por notificación,
  // no en cada render (antes era un setTimeout suelto en el cuerpo del componente)
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => clearNotification(), 3800);
    return () => clearTimeout(timer);
  }, [notification, clearNotification]);

  return (
    <div className={styles.rootWrapper}>
      {/* ── SIDEBAR ─────────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <img
            src="https://storage.googleapis.com/media-drmotors-cl/img/949fd1e0-logo_dr_motors.webp"
            alt="Dr.Motors"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <button
            className={styles.sidebarClose}
            onClick={closeSidebar}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        <nav>
          <div className="nav-section">
            <div className="nav-section-label">Principal</div>
            <NavLink
              to="/"
              end
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">◈</span> Dashboard
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-section-label">Gestión</div>
            <NavLink
              to="/cotizaciones"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">✦</span> Cotizaciones
            </NavLink>
            <NavLink
              to="/ordenes"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🔧</span> Órdenes de Trabajo
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-section-label">Datos</div>
            <NavLink
              to="/vehiculos"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🚗</span> Vehículos
            </NavLink>
            <NavLink
              to="/inventario"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📦</span> Inventario
            </NavLink>
            <NavLink
              to="/proveedores"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🏭</span> Proveedores
            </NavLink>
            <NavLink
              to="/costos-fijos"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">💡</span> Costos Fijos
            </NavLink>
            <NavLink
              to="/mantenimiento"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🔧</span> Mantenimiento
            </NavLink>
            <NavLink
              to="/estadisticas"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📊</span> Estadísticas
            </NavLink>
          </div>
          <div className="nav-section">
            <div className="nav-section-label">Sistema</div>
            <NavLink
              to="/trabajadores"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">👥</span> Trabajadores
            </NavLink>
            <NavLink
              to="/configuracion"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">⚙</span> Configuración
            </NavLink>
            <NavLink
              to="/calendario"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📅</span> Calendario
              {citasNuevas > 0 && <span className={styles.navBadge}>{citasNuevas}</span>}
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-version">Dr. Motors v3.0 · React</div>
        </div>
      </aside>

      {/* ── BACKDROP SIDEBAR MÓVIL ─────────────────────────── */}
      {sidebarOpen && (
        <div className={styles.sidebarBackdrop} onClick={closeSidebar} />
      )}

      {/* ── MAIN ────────────────────────────────────────── */}
      <div className="main-wrapper">
        {/* ── HEADER ────────────────────────────────────── */}
        <header className="top-header">
          <button
            className={styles.menuToggle}
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
          >
            ☰
          </button>

          <div className="header-search">
            <div className="search-wrap">
              <input
                className="header-search-input"
                placeholder="Buscar patente, cliente..."
                value={searchValue}
                maxLength={20}
                onChange={(e) => handleSearch(e.target.value)}
                autoComplete="off"
              />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((v) => (
                    <div key={v.patente} className="search-result-item">
                      {/* Info del vehículo */}
                      <div
                        className={styles.searchResultInfo}
                        onClick={() => {
                          closeSearch();
                          navigate(`/vehiculos/${v.patente}`);
                        }}
                      >
                        <div className="sr-plate">{v.patente}</div>
                        <div className="sr-car">
                          {v.make} {v.model} {v.year ? `· ${v.year}` : ""}{" "}
                          {v.owner ? `· ${v.owner}` : ""}
                        </div>
                      </div>
                      {/* Acciones rápidas */}
                      <div className={styles.searchResultActions}>
                        <button
                          className={styles.searchQuickBtn}
                          onClick={() => {
                            closeSearch();
                            navigate("/cotizaciones/nueva", {
                              state: navState(v),
                            });
                          }}
                        >
                          + Cot.
                        </button>
                        <button
                          className={styles.searchQuickBtn}
                          onClick={() => {
                            closeSearch();
                            navigate("/ordenes/nueva", { state: navState(v) });
                          }}
                        >
                          + OT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate("/cotizaciones/nueva")}
            >
              + Cotización
            </button>
            <button
              className="btn btn-dark btn-sm"
              onClick={() => navigate("/ordenes/nueva")}
            >
              + OT
            </button>
          </div>
          <div className={`header-right ${styles.headerRight}`}>
            {user && (
              <span className={styles.headerUserName}>
                {user.nombre} {user.apellido}
              </span>
            )}
            <button
              className={`btn btn-sm btn-outline ${styles.logoutBtn}`}
              onClick={handleLogout}
            >
              Salir
            </button>
          </div>
        </header>

        {/* ── CONTENT ───────────────────────────────────── */}
        <main className="content">
          <Outlet />
        </main>
      </div>

      {/* ── NOTIFICACIÓN ────────────────────────────────── */}
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

      {/* ── CERRAR SEARCH AL CLICK AFUERA ───────────────── */}
      {searchResults.length > 0 && (
        <div
          className={styles.searchBackdrop}
          onClick={closeSearch}
        />
      )}
    </div>
  );
}