import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import MecanicoLayout from './layouts/MecanicoLayout';

// Públicas
import LoginPage     from './pages/Login/LoginPage';
import ClientePortal from './pages/Cliente/ClientePortal';
import PanelTaller   from './pages/Taller/PanelTaller';

// Admin
import Dashboard        from './pages/Dashboard/Dashboard';
import Cotizaciones     from './pages/Cotizaciones/Cotizaciones';
import NuevaCotizacion  from './pages/Cotizaciones/NuevaCotizacion';
import EditarCotizacion from './pages/Cotizaciones/EditarCotizacion';
import VerCotizacion    from './pages/Cotizaciones/VerCotizacion';
import OrdenesTrabajo   from './pages/OrdenesTrabajo/OrdenesTrabajo';
import NuevaOrden       from './pages/OrdenesTrabajo/NuevaOrden';
import EditarOrden      from './pages/OrdenesTrabajo/EditarOrden';
import VerOrden         from './pages/OrdenesTrabajo/VerOrden';
import Vehiculos        from './pages/Vehiculos/Vehiculos';
import PerfilVehiculo   from './pages/Vehiculos/PerfilVehiculo';
import Inventario       from './pages/Inventario/Inventario';
import Proveedores      from './pages/Proveedores/Proveedores';
import CostosFijos      from './pages/CostosFijos/CostosFijos';
import Trabajadores     from './pages/Trabajadores/Trabajadores';
import Estadisticas     from './pages/Estadisticas/Estadisticas';
import Configuracion    from './pages/Configuracion/Configuracion';

// Mecánico
import MecanicoDashboard from './pages/Mecanico/MecanicoDashboard';
import MiPerfil          from './pages/Mecanico/MiPerfil';
import Calendario        from './pages/Calendario/Calendario';
import PanelProveedor    from './pages/Proveedor/PanelProveedor';
import EstadisticasProveedor from './pages/Proveedor/EstadisticasProveedor';
import ProveedorPOS         from './pages/Proveedor/POS/ProveedorPOS';
import EscalamientosIA      from './pages/Escalamientos/EscalamientosIA';
import MesaCotizacionWsp    from './pages/MesaWsp/MesaCotizacionWsp';
import AgenteOmnicanal      from './pages/AgenteOmnicanal/AgenteOmnicanal';
import Mantenimiento     from './pages/Mantenimiento/Mantenimiento';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Públicas */}
          <Route path="/login"   element={<LoginPage />} />
          <Route path="/cliente" element={<ClientePortal />} />
          <Route path="/taller"  element={<PanelTaller />} />

          {/* Mecánico (y Administrativo, misma interfaz) */}
          <Route path="/mecanico" element={
            <ProtectedRoute roles={['mecanico', 'admin', 'administrativo']}>
              <MecanicoLayout />
            </ProtectedRoute>
          }>
            <Route index          element={<MecanicoDashboard />} />
            <Route path="perfil"      element={<MiPerfil />} />
            <Route path="calendario"  element={<Calendario />} />
          </Route>

          {/* Proveedor: menú con "Punto de Venta", "Mis Repuestos", "Consultas IA" y "Estadísticas" */}
          <Route path="/proveedor" element={
            <ProtectedRoute roles={['proveedor', 'admin']}>
              <PanelProveedor />
            </ProtectedRoute>
          }>
            <Route index                element={<Inventario modo="proveedor" />} />
            <Route path="pos"           element={<ProveedorPOS />} />
            <Route path="consultas"     element={<EscalamientosIA modo="proveedor" />} />
            <Route path="estadisticas"  element={<EstadisticasProveedor />} />
          </Route>

          {/* Admin */}
          <Route path="/" element={
            <ProtectedRoute roles={['admin']}>
              <MainLayout />
            </ProtectedRoute>
          }>
            <Route index                           element={<Dashboard />} />
            <Route path="cotizaciones"             element={<Cotizaciones />} />
            <Route path="cotizaciones/nueva"       element={<NuevaCotizacion />} />
            <Route path="cotizaciones/:id/editar"  element={<EditarCotizacion />} />
            <Route path="cotizaciones/:id/ver"     element={<VerCotizacion />} />
            <Route path="ordenes"                  element={<OrdenesTrabajo />} />
            <Route path="ordenes/nueva"            element={<NuevaOrden />} />
            <Route path="ordenes/:id/editar"       element={<EditarOrden />} />
            <Route path="ordenes/:id/ver"          element={<VerOrden />} />
            <Route path="vehiculos"                element={<Vehiculos />} />
            <Route path="vehiculos/:patente"       element={<PerfilVehiculo />} />
            <Route path="inventario"               element={<Inventario />} />
            <Route path="proveedores"              element={<Proveedores />} />
            <Route path="agente-omnicanal"         element={<AgenteOmnicanal />} />
            <Route path="escalamientos-ia"         element={<EscalamientosIA modo="admin" />} />
            <Route path="mesa-wsp"                 element={<MesaCotizacionWsp />} />
            <Route path="costos-fijos"             element={<CostosFijos />} />
            <Route path="mantenimiento"            element={<Mantenimiento />} />
            <Route path="trabajadores"             element={<Trabajadores />} />
            <Route path="estadisticas"             element={<Estadisticas />} />
            <Route path="configuracion"            element={<Configuracion />} />
            <Route path="calendario"               element={<Calendario />} />
            <Route path="pos"                      element={<ProveedorPOS />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}