import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { useAuth } from "../contexts/AuthContext";
import { useCitasNotificaciones } from "../hooks/useCitasNotificaciones";
import { inventarioService } from "../services/inventario";
import type { ItemInventario } from "../types";
import styles from './MainLayout.module.css';

export default function MainLayout() {
  const {
    notification,
    clearNotification,
    vehiculos,
    inventario,
    setInventario,
  } = useAppStore();
  const { user, logout } = useAuth();
  const { citasNuevas } = useCitasNotificaciones();
  const [searchValue, setSearchValue] = useState("");
  const [searchVehiculos, setSearchVehiculos] = useState<typeof vehiculos>([]);
  const [searchRepuestos, setSearchRepuestos] = useState<ItemInventario[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tallerExpanded, setTallerExpanded] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Si estamos en una ruta de taller, asegurar que la sección Taller esté desplegada
  useEffect(() => {
    const rutasTaller = ['/cotizaciones', '/ordenes', '/vehiculos', '/mantenimiento', '/calendario'];
    if (rutasTaller.some((r) => location.pathname.startsWith(r))) {
      setTallerExpanded(true);
    }
  }, [location.pathname]);

  // Cargar inventario en memoria si está vacío para alimentar el buscador global de repuestos
  useEffect(() => {
    if (inventario.length === 0) {
      inventarioService
        .getAll()
        .then((res) => {
          if (res.success && res.data) setInventario(res.data);
        })
        .catch(() => {
          // silencioso si aún no carga
        });
    }
  }, [inventario.length, setInventario]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // ─── SIDEBAR MÓVIL ───────────────────────────────────────
  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 860) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ─── BÚSQUEDA GLOBAL OMNICANAL (REPUESTOS + PATENTES) ────
  const handleSearch = (value: string) => {
    setSearchValue(value);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSearchVehiculos([]);
      setSearchRepuestos([]);
      return;
    }
    const q = trimmed.toLowerCase();

    // 1. Buscar Repuestos por SKU público, código OEM, nombre o marca/modelo compatible
    const repResults = inventario
      .filter((item) => {
        const sku = (item.skuPublicoFrp || item.codigo || "").toLowerCase();
        const oem = (item.codigoProducto || "").toLowerCase();
        const nom = (item.nombre || "").toLowerCase();
        const fab = (item.fabricante || "").toLowerCase();
        const marcas = (item.marcasCompatibles || []).join(" ").toLowerCase();
        return (
          sku.includes(q) ||
          oem.includes(q) ||
          nom.includes(q) ||
          fab.includes(q) ||
          marcas.includes(q)
        );
      })
      .slice(0, 5);

    // 2. Buscar Vehículos por patente, marca/modelo o propietario
    const vehResults = vehiculos
      .filter(
        (v) =>
          v.patente.toLowerCase().includes(q) ||
          v.make?.toLowerCase().includes(q) ||
          v.model?.toLowerCase().includes(q) ||
          v.owner?.toLowerCase().includes(q)
      )
      .slice(0, 4);

    setSearchRepuestos(repResults);
    setSearchVehiculos(vehResults);
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
    setSearchVehiculos([]);
    setSearchRepuestos([]);
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => clearNotification(), 3800);
    return () => clearTimeout(timer);
  }, [notification, clearNotification]);

  const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');
  const hayResultados = searchRepuestos.length > 0 || searchVehiculos.length > 0;

  return (
    <div className={styles.rootWrapper}>
      {/* ── SIDEBAR ─────────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
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
          {/* 1. RUBRO PRINCIPAL: REPUESTOS & OMNICANAL */}
          <div className="nav-section">
            <div className="nav-section-label">Comercio & Omnicanal</div>
            <NavLink
              to="/"
              end
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">◈</span> Centro de Mando
            </NavLink>
            <NavLink
              to="/agente-omnicanal"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🤖</span> Repuestín WhatsApp
              <span className={styles.navLivePill}>LIVE</span>
            </NavLink>
            <NavLink
              to="/mesa-wsp"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📲</span> Mesa Abastecimiento WSP
            </NavLink>
          </div>

          {/* 2. CATÁLOGO, STOCK, PROVEEDORES Y POS INTERNO */}
          <div className="nav-section">
            <div className="nav-section-label">Catálogo & Bodegas</div>
            <NavLink
              to="/inventario"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📦</span> Inventario & Web
            </NavLink>
            <NavLink
              to="/proveedores"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🏭</span> Proveedores & Ailoo
            </NavLink>
            <NavLink
              to="/proveedor"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🏪</span> Portal Proveedor
            </NavLink>
            <NavLink
              to="/pos"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">🛒</span> POS Interno / Bodega
            </NavLink>
          </div>

          {/* 3. MÓDULO TALLER & AUTOS (CONSERVADO 100% INTACTO) */}
          <div className="nav-section">
            <button
              type="button"
              className={styles.navSectionToggle}
              onClick={() => setTallerExpanded((prev) => !prev)}
            >
              <span>Módulo Taller & Autos</span>
              <span className={styles.navSectionArrow}>
                {tallerExpanded ? "▾" : "▸"}
              </span>
            </button>
            {tallerExpanded && (
              <>
                <NavLink
                  to="/vehiculos"
                  onClick={closeSidebar}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <span className="nav-icon">🚗</span> Padrón Vehículos
                </NavLink>
                <NavLink
                  to="/cotizaciones"
                  onClick={closeSidebar}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <span className="nav-icon">✦</span> Cotizaciones Taller
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
                <NavLink
                  to="/mantenimiento"
                  onClick={closeSidebar}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <span className="nav-icon">🛠</span> Planes Mantenimiento
                </NavLink>
                <NavLink
                  to="/calendario"
                  onClick={closeSidebar}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <span className="nav-icon">📅</span> Calendario Taller
                  {citasNuevas > 0 && (
                    <span className={styles.navBadge}>{citasNuevas}</span>
                  )}
                </NavLink>
              </>
            )}
          </div>

          {/* 4. ADMINISTRACIÓN & SISTEMA */}
          <div className="nav-section">
            <div className="nav-section-label">Administración</div>
            <NavLink
              to="/estadisticas"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="nav-icon">📊</span> Estadísticas
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
          </div>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-version">FácilRepuestos ERP · Omnicanal v3.5</div>
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
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
            className={styles.mobileHeaderLogo}
            onClick={() => navigate("/")}
          />

          <div className="header-search">
            <div className="search-wrap">
              <input
                className="header-search-input"
                placeholder="Buscar repuesto, SKU (FRP-...), marca/modelo o patente..."
                value={searchValue}
                maxLength={50}
                onChange={(e) => handleSearch(e.target.value)}
                autoComplete="off"
              />
              {hayResultados && (
                <div className={`search-results ${styles.omniSearchDropdown}`}>
                  {searchRepuestos.length > 0 && (
                    <div className={styles.searchGroupBlock}>
                      <div className={styles.searchGroupHeader}>
                        📦 Repuestos en Catálogo ({searchRepuestos.length})
                      </div>
                      {searchRepuestos.map((item) => {
                        const precioConIva = Math.round((item.precioVenta || 0) * 1.19);
                        return (
                          <div key={item.id || item.codigo} className="search-result-item">
                            <div
                              className={styles.searchResultInfo}
                              onClick={() => {
                                closeSearch();
                                navigate("/inventario");
                              }}
                            >
                              <div className={styles.srSkuRow}>
                                <span className={styles.srSkuBadge}>
                                  {item.skuPublicoFrp || item.codigo}
                                </span>
                                <span
                                  className={
                                    (item.stock || 0) > 0
                                      ? styles.srStockOk
                                      : styles.srStockZero
                                  }
                                >
                                  Stock: {item.stock || 0}
                                </span>
                                <span className={styles.srPriceTag}>
                                  {fmtCLP(precioConIva)} IVA inc.
                                </span>
                              </div>
                              <div className="sr-car">{item.nombre}</div>
                            </div>
                            <div className={styles.searchResultActions}>
                              <button
                                className={styles.searchQuickBtn}
                                onClick={() => {
                                  closeSearch();
                                  navigate("/pos");
                                }}
                              >
                                POS
                              </button>
                              <button
                                className={styles.searchQuickBtn}
                                onClick={() => {
                                  closeSearch();
                                  navigate("/inventario");
                                }}
                              >
                                Ficha
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {searchVehiculos.length > 0 && (
                    <div className={styles.searchGroupBlock}>
                      <div className={styles.searchGroupHeader}>
                        🚗 Vehículos & Patentes ({searchVehiculos.length})
                      </div>
                      {searchVehiculos.map((v) => (
                        <div key={v.patente} className="search-result-item">
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
              )}
            </div>

            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate("/agente-omnicanal")}
              title="Abrir monitor en vivo de Repuestín WhatsApp"
            >
              🤖 Repuestín WSP
            </button>
            <button
              className="btn btn-dark btn-sm"
              onClick={() => navigate("/mesa-wsp")}
              title="Abrir Mesa de Abastecimiento WhatsApp"
            >
              📲 Mesa WSP
            </button>
            <button
              className={`btn btn-sm ${styles.headerTallerBtn}`}
              onClick={() => navigate("/inventario")}
              title="Abrir Catálogo e Inventario Web"
            >
              📦 Catálogo
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
      {hayResultados && (
        <div
          className={styles.searchBackdrop}
          onClick={closeSearch}
        />
      )}
    </div>
  );
}
