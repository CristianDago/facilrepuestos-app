import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  BoostrVehiculo,
  OfertaRecibidaWsp,
  Proveedor,
  SolicitudCotizacionWsp,
} from '../../types';
import styles from './MesaCotizacionWsp.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

interface EstadoMesaWspResponse {
  credencialesMetaActivas: boolean;
  modoOperacionMeta: 'meta_cloud_api_live' | 'simulacion_meta_local';
  solicitudes: SolicitudCotizacionWsp[];
  proveedoresWsp: Proveedor[];
}

export default function MesaCotizacionWsp() {
  const { notify } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

  const [solicitudes, setSolicitudes] = useState<SolicitudCotizacionWsp[]>([]);
  const [proveedoresWsp, setProveedoresWsp] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros de bandeja
  const [filtroEstado, setFiltroEstado] = useState<
    'todas' | 'esperando_respuestas' | 'con_ofertas' | 'adjudicada'
  >('todas');

  // Panel de Gestión de Proveedores WhatsApp Activos
  const [mostrarGestionProveedores, setMostrarGestionProveedores] = useState(false);
  const [guardandoProveedor, setGuardandoProveedor] = useState(false);
  const [formProveedorWsp, setFormProveedorWsp] = useState({
    nombre: '',
    telefono: '+569',
    contacto: '',
    marcas: '',
    categoria: 'General',
    margenPct: 30,
  });

  // Panel de Nueva Solicitud Multidifusión WhatsApp (sin datos de prueba precargados)
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [buscandoBoostr, setBuscandoBoostr] = useState(false);
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [formSolicitud, setFormSolicitud] = useState({
    clienteNombre: '',
    clienteTelefono: '',
    patente: '',
    vin: '',
    marcaVehiculo: '',
    modeloVehiculo: '',
    anioVehiculo: '',
    motorVehiculo: '',
    categoriaRepuesto: 'General',
    repuestoBuscado: '',
    codigoReferencia: '',
    notasAdicionales: '',
    margenPct: 30,
    escalamientoOrigenId: null as string | null,
  });
  const [proveedoresSeleccionados, setProveedoresSeleccionados] = useState<string[]>([]);

  // Registro manual opcional de oferta recibida de proveedor real
  const [respondiendoSolId, setRespondiendoSolId] = useState<string | null>(null);
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);
  const [formRespuestaWsp, setFormRespuestaWsp] = useState({
    proveedorId: '',
    mensajeOriginalWsp: '',
    transcripcionAudio: '',
    fotoUrl: '',
    garantia: '6 meses',
  });

  // Opciones de Adjudicación en 1 Clic
  const [adjudicandoOfertaId, setAdjudicandoOfertaId] = useState<string | null>(null);
  const [publicarEnInventario, setPublicarEnInventario] = useState(true);
  const [guardarConocimientoIa, setGuardarConocimientoIa] = useState(true);
  const [verMensajesId, setVerMensajesId] = useState<string | null>(null);

  const cargarMesaWsp = async () => {
    try {
      setLoading(true);
      const res = await api.get<ApiResponse<EstadoMesaWspResponse>>('/mesa-wsp/solicitudes');
      if (res.success && res.data) {
        setSolicitudes(res.data.solicitudes || []);
        setProveedoresWsp(res.data.proveedoresWsp || []);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al cargar Mesa de Abastecimiento WhatsApp', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarMesaWsp();
  }, []);

  // Si venimos derivados desde otra vista (`location.state`), precargar formulario
  useEffect(() => {
    const state = location.state as Record<string, unknown> | null;
    if (state && state.desdeEscalamiento) {
      setFormSolicitud((prev) => ({
        ...prev,
        patente: String(state.patente || prev.patente),
        marcaVehiculo: String(state.marcaVehiculo || prev.marcaVehiculo).toUpperCase(),
        modeloVehiculo: String(state.modeloVehiculo || prev.modeloVehiculo).toUpperCase(),
        anioVehiculo: state.anioVehiculo ? String(state.anioVehiculo) : prev.anioVehiculo,
        motorVehiculo: String(state.motorVehiculo || prev.motorVehiculo),
        repuestoBuscado: String(state.repuestoBuscado || prev.repuestoBuscado).toUpperCase(),
        codigoReferencia: String(state.codigoReferencia || ''),
        notasAdicionales: String(state.motivoEscalamiento || prev.notasAdicionales),
        escalamientoOrigenId: state.escalamientoId ? String(state.escalamientoId) : null,
      }));
      setMostrarNueva(true);
    }
  }, [location.state]);

  // Preseleccionar automáticamente proveedores especialistas cuando cambia la marca del vehículo
  useEffect(() => {
    if (proveedoresWsp.length === 0) {
      setProveedoresSeleccionados([]);
      return;
    }
    const marca = formSolicitud.marcaVehiculo.trim().toUpperCase();
    const sugeridos = proveedoresWsp
      .filter((p) =>
        marca ? (p.marcas || []).map((m) => m.toUpperCase()).includes(marca) : true
      )
      .map((p) => p.id!)
      .filter(Boolean);

    if (sugeridos.length > 0) {
      setProveedoresSeleccionados(sugeridos);
    } else {
      setProveedoresSeleccionados(proveedoresWsp.map((p) => p.id!).filter(Boolean));
    }
  }, [formSolicitud.marcaVehiculo, proveedoresWsp]);

  const handleAgregarProveedorWsp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProveedorWsp.nombre.trim() || !formProveedorWsp.telefono.trim()) {
      notify('Ingresa el nombre del proveedor y su número de WhatsApp (+569...)', 'error');
      return;
    }
    try {
      setGuardandoProveedor(true);
      const res = await api.post<ApiResponse<Proveedor>>('/mesa-wsp/proveedores', {
        nombre: formProveedorWsp.nombre.trim(),
        telefono: formProveedorWsp.telefono.trim(),
        contacto: formProveedorWsp.contacto.trim() || 'Ventas WhatsApp',
        categoria: formProveedorWsp.categoria.trim() || 'General',
        marcas: formProveedorWsp.marcas
          .split(',')
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean),
        margenPct: Number(formProveedorWsp.margenPct) || 30,
      });
      if (res.success && res.data) {
        notify(`✓ Proveedor WhatsApp "${res.data.nombre}" agregado correctamente`, 'success');
        setFormProveedorWsp({
          nombre: '',
          telefono: '+569',
          contacto: '',
          marcas: '',
          categoria: 'General',
          margenPct: 30,
        });
        await cargarMesaWsp();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al agregar proveedor WhatsApp', 'error');
    } finally {
      setGuardandoProveedor(false);
    }
  };

  const handleEliminarProveedorWsp = async (prov: Proveedor) => {
    if (!prov.id) return;
    try {
      await api.delete(`/mesa-wsp/proveedores/${prov.id}`);
      setProveedoresWsp((prev) => prev.filter((p) => p.id !== prov.id));
      notify(`Proveedor "${prov.nombre}" eliminado`, 'info');
    } catch (err) {
      notify((err as Error).message || 'Error al eliminar proveedor', 'error');
    }
  };

  const handleEliminarSolicitud = async (id: string) => {
    try {
      await api.delete(`/mesa-wsp/solicitudes/${id}`);
      setSolicitudes((prev) => prev.filter((s) => s.id !== id));
      notify('Solicitud quitada de la Mesa de Abastecimiento', 'info');
    } catch (err) {
      notify((err as Error).message || 'Error al quitar solicitud', 'error');
    }
  };

  const handleLimpiarMesa = async () => {
    try {
      await api.post('/mesa-wsp/limpiar', {});
      setSolicitudes([]);
      notify('✓ Mesa de Abastecimiento llevada a 0', 'success');
    } catch (err) {
      notify((err as Error).message || 'Error al limpiar la mesa', 'error');
    }
  };

  const handleBuscarPatenteBoostr = async () => {
    const pat = formSolicitud.patente.trim().toUpperCase();
    if (pat.length < 5) {
      notify('Ingresa una patente válida para consultar en Boostr', 'error');
      return;
    }
    try {
      setBuscandoBoostr(true);
      const res = await api.get<ApiResponse<BoostrVehiculo>>(`/boostr/${pat}`);
      if (res.success && res.data) {
        setFormSolicitud((prev) => ({
          ...prev,
          patente: pat,
          marcaVehiculo: (res.data?.make || prev.marcaVehiculo).toUpperCase(),
          modeloVehiculo: (res.data?.model || prev.modeloVehiculo).toUpperCase(),
          anioVehiculo: res.data?.year ? String(res.data.year) : prev.anioVehiculo,
          motorVehiculo: res.data?.engine || prev.motorVehiculo,
        }));
        notify(
          `✓ Vehículo ${res.data.make} ${res.data.model} (${res.data.year}) autocompletado vía Boostr`,
          'success'
        );
      }
    } catch {
      notify('No se pudo obtener datos de Boostr, puedes completarlos manualmente', 'info');
    } finally {
      setBuscandoBoostr(false);
    }
  };

  const toggleProveedorSeleccionado = (id: string) => {
    setProveedoresSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCrearSolicitudWsp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSolicitud.repuestoBuscado.trim()) {
      notify('Indica el repuesto que deseas cotizar por WhatsApp', 'error');
      return;
    }
    if (proveedoresSeleccionados.length === 0) {
      notify('Agrega y selecciona al menos un proveedor de WhatsApp antes de enviar', 'error');
      return;
    }
    try {
      setEnviandoSolicitud(true);
      const res = await api.post<ApiResponse<SolicitudCotizacionWsp>>('/mesa-wsp/solicitudes', {
        ...formSolicitud,
        anioVehiculo: formSolicitud.anioVehiculo ? Number(formSolicitud.anioVehiculo) : null,
        margenPct: Number(formSolicitud.margenPct) || 30,
        proveedorIds: proveedoresSeleccionados,
      });

      if (res.success && res.data) {
        notify(
          `📲 Solicitud #${res.data.codigoSolicitud} enviada por WhatsApp a ${res.data.proveedoresContactados.length} proveedor(es)`,
          'success'
        );
        setFormSolicitud({
          clienteNombre: '',
          clienteTelefono: '',
          patente: '',
          vin: '',
          marcaVehiculo: '',
          modeloVehiculo: '',
          anioVehiculo: '',
          motorVehiculo: '',
          categoriaRepuesto: 'General',
          repuestoBuscado: '',
          codigoReferencia: '',
          notasAdicionales: '',
          margenPct: 30,
          escalamientoOrigenId: null,
        });
        setMostrarNueva(false);
        await cargarMesaWsp();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al enviar solicitud por WhatsApp', 'error');
    } finally {
      setEnviandoSolicitud(false);
    }
  };

  const abrirReceptorRespuesta = (sol: SolicitudCotizacionWsp) => {
    if (respondiendoSolId === sol.id) {
      setRespondiendoSolId(null);
      return;
    }
    const primerProv = sol.proveedoresContactados?.[0]?.proveedorId || '';
    setRespondiendoSolId(sol.id);
    setFormRespuestaWsp({
      proveedorId: primerProv,
      mensajeOriginalWsp: '',
      transcripcionAudio: '',
      fotoUrl: '',
      garantia: '6 meses',
    });
  };

  const handleRecibirRespuestaWsp = async (solId: string) => {
    try {
      setEnviandoRespuesta(true);
      const res = await api.post<
        ApiResponse<{ oferta: OfertaRecibidaWsp; solicitud: SolicitudCotizacionWsp }>
      >(`/mesa-wsp/solicitudes/${solId}/respuesta`, formRespuestaWsp);

      if (res.success && res.data) {
        const of = res.data.oferta;
        if (of.tieneStock && of.precioCostoNeto > 0) {
          notify(
            `✓ Oferta registrada de ${of.proveedorNombre}: ${of.fabricante} (${of.origen}) · Costo ${fmtCLP(of.precioCostoNeto)} → Venta FRP ${fmtCLP(of.precioVentaFrpNeto)} neto`,
            'success'
          );
        } else {
          notify(`ℹ Respuesta registrada (${of.proveedorNombre}: Sin stock disponible)`, 'info');
        }
        setRespondiendoSolId(null);
        await cargarMesaWsp();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al procesar respuesta WhatsApp', 'error');
    } finally {
      setEnviandoRespuesta(false);
    }
  };

  const handleAdjudicarOferta = async (sol: SolicitudCotizacionWsp, oferta: OfertaRecibidaWsp) => {
    try {
      setAdjudicandoOfertaId(oferta.id);
      const res = await api.post<
        ApiResponse<{
          solicitud: SolicitudCotizacionWsp;
          inventarioCreadoId: string | null;
          conocimientoCreadoId: string | null;
          skuPublicoFrp: string;
          mensajeCotizacionCliente: string;
        }>
      >(`/mesa-wsp/solicitudes/${sol.id}/adjudicar`, {
        ofertaId: oferta.id,
        publicarEnInventario,
        guardarConocimientoIa,
        stockInicialPublicacion: 2,
      });

      if (res.success && res.data) {
        const extras: string[] = [];
        if (res.data.inventarioCreadoId) extras.push('publicado en Catálogo + WooCommerce');
        if (res.data.conocimientoCreadoId) extras.push('guardado en Conocimiento IA');
        notify(
          `🏆 Oferta adjudicada (${res.data.skuPublicoFrp})${extras.length ? ' · ' + extras.join(' y ') : ''}`,
          'success'
        );
        await cargarMesaWsp();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al adjudicar oferta', 'error');
    } finally {
      setAdjudicandoOfertaId(null);
    }
  };

  const solicitudesFiltradas = useMemo(() => {
    return solicitudes.filter((s) => {
      if (filtroEstado !== 'todas' && s.estado !== filtroEstado) return false;
      return true;
    });
  }, [solicitudes, filtroEstado]);

  const totalEsperando = solicitudes.filter((s) => s.estado === 'esperando_respuestas').length;
  const totalConOfertas = solicitudes.filter((s) => s.estado === 'con_ofertas').length;
  const totalAdjudicadas = solicitudes.filter((s) => s.estado === 'adjudicada').length;

  return (
    <div className={styles.container}>
      {/* Cabecera limpia sin módulo de simulación */}
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>
            📲 Mesa de Abastecimiento por WhatsApp
          </h1>
          <p className={styles.subtitle}>
            Consulta automática al Top 3 de proveedores por WhatsApp desde el número exclusivo de abastecimiento{' '}
            <strong>+56 9 5096 0294</strong> (separado del número de clientes de Repuestín <strong>+56 9 2110 9851</strong>).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {solicitudes.length > 0 && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleLimpiarMesa}
              title="Llevar todas las solicitudes de la mesa a 0"
            >
              🧹 Llevar Mesa a 0
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ background: '#16a34a', borderColor: '#16a34a' }}
            onClick={() => setMostrarNueva((v) => !v)}
          >
            {mostrarNueva
              ? '✕ Cerrar Disparador WhatsApp'
              : '📲 + Nueva Consulta a Proveedores'}
          </button>
        </div>
      </div>

      {/* KPIs en 0 + Cuadro Proveedores WhatsApp Activos con botón Agregar Nuevos Proveedores */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Esperando Respuesta WSP</div>
          <div className={styles.kpiValue} style={{ color: '#d97706' }}>
            {totalEsperando}
          </div>
          <div className={styles.kpiSub}>Solicitudes enviadas a proveedores</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Con Ofertas para Adjudicar</div>
          <div className={styles.kpiValue} style={{ color: '#2563eb' }}>
            {totalConOfertas}
          </div>
          <div className={styles.kpiSub}>Precios confirmados listos</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Cotizaciones Adjudicadas</div>
          <div className={styles.kpiValue} style={{ color: '#16a34a' }}>
            {totalAdjudicadas}
          </div>
          <div className={styles.kpiSub}>Inyectadas a Inventario & Web</div>
        </div>

        <div className={styles.kpiCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div className={styles.kpiLabel}>Proveedores WhatsApp Activos</div>
              <div className={styles.kpiValue} style={{ color: '#0f172a' }}>
                {proveedoresWsp.length}
              </div>
              <div className={styles.kpiSub}>Enrutados por marca de vehículo y rubro</div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ width: '100%', fontWeight: 700 }}
              onClick={() => setMostrarGestionProveedores((v) => !v)}
            >
              {mostrarGestionProveedores
                ? '✕ Cerrar Proveedores'
                : '+ Agregar Nuevos Proveedores'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-dark"
              style={{ width: '100%', fontWeight: 700, fontSize: '0.74rem' }}
              onClick={() => navigate('/portal-proveedores-wsp')}
            >
              🏪 Abrir Portal Proveedor (Doble Clic) →
            </button>
          </div>
        </div>
      </div>

      {/* Panel Inline para Agregar y Administrar Proveedores WhatsApp Activos */}
      {mostrarGestionProveedores && (
        <div className={styles.panelCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#0f172a' }}>
              🏪 Agregar Nuevo Proveedor WhatsApp Activo
            </div>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Estos proveedores recibirán consultas automáticas o manuales desde la Mesa de Abastecimiento WSP
            </span>
          </div>

          <form onSubmit={handleAgregarProveedorWsp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Nombre del Proveedor *</label>
                <input
                  className={styles.input}
                  placeholder="Ej. Importadora Repuestos Sur"
                  value={formProveedorWsp.nombre}
                  onChange={(e) => setFormProveedorWsp((p) => ({ ...p, nombre: e.target.value }))}
                  required
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Teléfono WhatsApp *</label>
                <input
                  className={styles.input}
                  placeholder="+56987654321"
                  value={formProveedorWsp.telefono}
                  onChange={(e) => setFormProveedorWsp((p) => ({ ...p, telefono: e.target.value }))}
                  required
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Nombre Contacto / Vendedor</label>
                <input
                  className={styles.input}
                  placeholder="Ej. Mesón WhatsApp"
                  value={formProveedorWsp.contacto}
                  onChange={(e) => setFormProveedorWsp((p) => ({ ...p, contacto: e.target.value }))}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Rubro / Categoría Principal</label>
                <input
                  className={styles.input}
                  placeholder="Ej. Motor, Frenos, Suspensión, General"
                  value={formProveedorWsp.categoria}
                  onChange={(e) => setFormProveedorWsp((p) => ({ ...p, categoria: e.target.value }))}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Marcas que trabaja (separadas por coma)</label>
                <input
                  className={styles.input}
                  placeholder="Ej. HYUNDAI, KIA, TOYOTA, JAC, CHERY"
                  value={formProveedorWsp.marcas}
                  onChange={(e) => setFormProveedorWsp((p) => ({ ...p, marcas: e.target.value }))}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Margen Comercial FRP (%)</label>
                <input
                  type="number"
                  className={styles.input}
                  value={formProveedorWsp.margenPct}
                  onChange={(e) =>
                    setFormProveedorWsp((p) => ({ ...p, margenPct: Number(e.target.value) || 30 }))
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ background: '#16a34a', borderColor: '#16a34a' }}
                disabled={guardandoProveedor}
              >
                {guardandoProveedor ? 'Guardando...' : '✓ Guardar Proveedor WhatsApp'}
              </button>
            </div>
          </form>

          {/* Listado de Proveedores WhatsApp actualmente activos */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: 8 }}>
              Proveedores WhatsApp Registrados ({proveedoresWsp.length}):
            </div>
            {proveedoresWsp.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                No hay proveedores de WhatsApp registrados aún. Agrega tus proveedores reales arriba.
              </div>
            ) : (
              <div className={styles.provGrid}>
                {proveedoresWsp.map((prov) => (
                  <div key={prov.id} className={styles.provCheckCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>{prov.nombre}</strong>
                      <button
                        type="button"
                        onClick={() => handleEliminarProveedorWsp(prov)}
                        style={{
                          border: 'none',
                          background: '#fee2e2',
                          color: '#b91c1c',
                          borderRadius: 6,
                          padding: '2px 7px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        title="Eliminar proveedor"
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                      📞 {prov.telefono} · {prov.contacto || 'Ventas WhatsApp'}
                    </div>
                    {(prov.marcas || []).length > 0 && (
                      <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                        🚗 {(prov.marcas || []).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Panel para Disparar Nueva Solicitud Multidifusión por WhatsApp */}
      {mostrarNueva && (
        <form onSubmit={handleCrearSolicitudWsp} className={styles.panelCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#0f172a' }}>
              🚀 Enviar Consulta a Proveedores por WhatsApp
            </div>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Filtra automáticamente a los proveedores que trabajan la marca del vehículo
            </span>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Patente Vehículo (Boostr)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className={styles.input}
                  value={formSolicitud.patente}
                  onChange={(e) =>
                    setFormSolicitud((p) => ({ ...p, patente: e.target.value.toUpperCase() }))
                  }
                  placeholder="Ej. JPKR42"
                  style={{ fontWeight: 700 }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={handleBuscarPatenteBoostr}
                  disabled={buscandoBoostr}
                >
                  {buscandoBoostr ? '...' : '🔍 Boostr'}
                </button>
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Marca Vehículo</label>
              <input
                className={styles.input}
                value={formSolicitud.marcaVehiculo}
                placeholder="Ej. HYUNDAI"
                onChange={(e) =>
                  setFormSolicitud((p) => ({
                    ...p,
                    marcaVehiculo: e.target.value.toUpperCase(),
                  }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Modelo</label>
              <input
                className={styles.input}
                value={formSolicitud.modeloVehiculo}
                placeholder="Ej. PORTER"
                onChange={(e) =>
                  setFormSolicitud((p) => ({
                    ...p,
                    modeloVehiculo: e.target.value.toUpperCase(),
                  }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Año</label>
              <input
                className={styles.input}
                value={formSolicitud.anioVehiculo}
                placeholder="Ej. 2019"
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, anioVehiculo: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Motor / Versión</label>
              <input
                className={styles.input}
                value={formSolicitud.motorVehiculo}
                placeholder="Ej. 2.5 CRDI"
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, motorVehiculo: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Margen Comercial FRP (%)</label>
              <input
                type="number"
                className={styles.input}
                value={formSolicitud.margenPct}
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, margenPct: Number(e.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
              <label className={styles.fieldLabel}>Repuesto Buscado *</label>
              <input
                className={styles.input}
                value={formSolicitud.repuestoBuscado}
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, repuestoBuscado: e.target.value }))
                }
                placeholder="Escribe el repuesto a consultar..."
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Categoría</label>
              <input
                className={styles.input}
                value={formSolicitud.categoriaRepuesto}
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, categoriaRepuesto: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Código OEM / Referencia (Opcional)</label>
              <input
                className={styles.input}
                value={formSolicitud.codigoReferencia}
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, codigoReferencia: e.target.value }))
                }
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>
              Proveedores con WhatsApp ({proveedoresSeleccionados.length} seleccionados)
            </label>
            {proveedoresWsp.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: '#b91c1c', padding: '8px 0' }}>
                Aún no tienes proveedores de WhatsApp activos. Haz clic en <strong>"+ Agregar Nuevos Proveedores"</strong> arriba para registrarlos.
              </div>
            ) : (
              <div className={styles.provGrid}>
                {proveedoresWsp.map((prov) => {
                  const activo = proveedoresSeleccionados.includes(prov.id!);
                  const coincideMarca =
                    formSolicitud.marcaVehiculo.trim().length > 0 &&
                    (prov.marcas || [])
                      .map((m) => m.toUpperCase())
                      .includes(formSolicitud.marcaVehiculo.trim().toUpperCase());

                  return (
                    <div
                      key={prov.id}
                      onClick={() => toggleProveedorSeleccionado(prov.id!)}
                      className={`${styles.provCheckCard} ${activo ? styles.provCheckCardActive : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                          {activo ? '☑️' : '⬜'} {prov.nombre}
                        </strong>
                        {coincideMarca && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              background: '#dcfce7',
                              color: '#166534',
                              padding: '2px 7px',
                              borderRadius: 999,
                              fontWeight: 700,
                            }}
                          >
                            Match {formSolicitud.marcaVehiculo}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                        📞 {prov.telefono} · {prov.contacto || 'Ventas WhatsApp'}
                      </div>
                      {(prov.marcas || []).length > 0 && (
                        <div style={{ fontSize: '0.71rem', color: '#64748b' }}>
                          🚗 {(prov.marcas || []).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setMostrarNueva(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ background: '#16a34a', borderColor: '#16a34a' }}
              disabled={enviandoSolicitud || proveedoresSeleccionados.length === 0}
            >
              {enviandoSolicitud
                ? 'Enviando por WhatsApp...'
                : `📲 Enviar WhatsApp a ${proveedoresSeleccionados.length} Proveedor(es)`}
            </button>
          </div>
        </form>
      )}

      {/* Filtros de Bandeja + Opciones de Adjudicación Automática */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          background: '#f8fafc',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(
            [
              ['todas', `Todas (${solicitudes.length})`],
              ['con_ofertas', `💡 Con Ofertas (${totalConOfertas})`],
              ['esperando_respuestas', `⏳ Esperando WSP (${totalEsperando})`],
              ['adjudicada', `✅ Adjudicadas (${totalAdjudicadas})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${filtroEstado === key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFiltroEstado(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={publicarEnInventario}
              onChange={(e) => setPublicarEnInventario(e.target.checked)}
            />
            📦 Al adjudicar: publicar en Inventario + Cola WooCommerce
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={guardarConocimientoIa}
              onChange={(e) => setGuardarConocimientoIa(e.target.checked)}
            />
            🧠 Al adjudicar: guardar aprendizaje para Repuestín
          </label>
        </div>
      </div>

      {/* Listado de Solicitudes en Vivo */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          Cargando Mesa de Abastecimiento por WhatsApp...
        </div>
      ) : solicitudesFiltradas.length === 0 ? (
        <div
          style={{
            padding: 36,
            textAlign: 'center',
            background: '#ffffff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            color: '#64748b',
          }}
        >
          No hay solicitudes activas en la Mesa de Abastecimiento (0 pendientes).
        </div>
      ) : (
        <div className={styles.solicitudesList}>
          {solicitudesFiltradas.map((sol) => {
            const vehiculoLabel = [
              sol.marcaVehiculo,
              sol.modeloVehiculo,
              sol.anioVehiculo,
              sol.motorVehiculo,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <div key={sol.id} className={styles.solicitudCard}>
                {/* Cabecera de la Solicitud */}
                <div className={styles.solicitudHeader}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={styles.badgeCode}>#{sol.codigoSolicitud}</span>
                      {vehiculoLabel && (
                        <span className={styles.badgeVehicle}>
                          🚗 {vehiculoLabel} {sol.patente ? `(${sol.patente})` : ''}
                        </span>
                      )}
                      {sol.estado === 'esperando_respuestas' && (
                        <span className={styles.badgeStatusWait}>⏳ Esperando respuestas WhatsApp</span>
                      )}
                      {sol.estado === 'con_ofertas' && (
                        <span className={styles.badgeStatusOffers}>
                          💡 {sol.ofertasRecibidas.length} Oferta(s) recibida(s)
                        </span>
                      )}
                      {sol.estado === 'adjudicada' && (
                        <span className={styles.badgeStatusWon}>
                          🏆 Adjudicada · {sol.skuPublicoGenerado}
                        </span>
                      )}
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Margen FRP: <strong>+{sol.margenPct}%</strong>
                      </span>
                    </div>

                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                      🔧 {sol.repuestoBuscado}
                      {sol.codigoReferencia && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            color: '#0369a1',
                            fontWeight: 700,
                          }}
                        >
                          [Ref: {sol.codigoReferencia}]
                        </span>
                      )}
                    </div>

                    {sol.notasAdicionales && (
                      <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                        📌 {sol.notasAdicionales}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() =>
                        setVerMensajesId(verMensajesId === sol.id ? null : sol.id)
                      }
                    >
                      {verMensajesId === sol.id
                        ? 'Ocultar Mensajes'
                        : `📤 Mensajes (${sol.proveedoresContactados.length})`}
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ background: '#0284c7', borderColor: '#0284c7' }}
                      onClick={() => abrirReceptorRespuesta(sol)}
                    >
                      {respondiendoSolId === sol.id
                        ? '✕ Cerrar'
                        : '💬 + Ingresar Oferta Proveedor'}
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => handleEliminarSolicitud(sol.id)}
                      title="Quitar solicitud"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Chips de Proveedores Contactados por WhatsApp */}
                <div className={styles.contactadosRow}>
                  {sol.proveedoresContactados.map((c) => (
                    <span key={c.proveedorId} className={styles.contactadoChip}>
                      <span>
                        {c.estadoContacto === 'respondido'
                          ? '🟢'
                          : c.estadoContacto === 'sin_stock'
                          ? '🔴'
                          : '🟡'}
                      </span>
                      <strong>{c.proveedorNombre}</strong>
                      <span style={{ color: '#64748b' }}>({c.telefono})</span>
                    </span>
                  ))}
                </div>

                {/* Desplegable con el texto exacto enviado por Meta WhatsApp API */}
                {verMensajesId === sol.id && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                      📤 Mensajes enviados a proveedores:
                    </div>
                    {sol.proveedoresContactados.map((c) => (
                      <pre
                        key={c.proveedorId}
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          fontSize: '0.76rem',
                          background: '#ffffff',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          color: '#1e293b',
                        }}
                      >
                        {c.mensajeEnviado}
                      </pre>
                    ))}
                  </div>
                )}

                {/* Registro manual de Oferta Recibida de Proveedor */}
                {respondiendoSolId === sol.id && (
                  <div
                    style={{
                      background: '#f0f9ff',
                      border: '1px solid #7dd3fc',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <strong style={{ fontSize: '0.88rem', color: '#0369a1' }}>
                      💬 Registrar Oferta de Proveedor WhatsApp
                    </strong>

                    <div className={styles.formGrid}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Proveedor que responde</label>
                        <select
                          className={styles.select}
                          value={formRespuestaWsp.proveedorId}
                          onChange={(e) =>
                            setFormRespuestaWsp((p) => ({ ...p, proveedorId: e.target.value }))
                          }
                        >
                          {sol.proveedoresContactados.map((c) => (
                            <option key={c.proveedorId} value={c.proveedorId}>
                              {c.proveedorNombre} ({c.telefono})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
                        <label className={styles.fieldLabel}>
                          Foto del Repuesto (URL opcional)
                        </label>
                        <input
                          className={styles.input}
                          value={formRespuestaWsp.fotoUrl}
                          onChange={(e) =>
                            setFormRespuestaWsp((p) => ({ ...p, fotoUrl: e.target.value }))
                          }
                          placeholder="https://..."
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
                        <label className={styles.fieldLabel}>
                          Mensaje / Oferta del Proveedor (indica precio neto, marca y origen)
                        </label>
                        <textarea
                          className={styles.textarea}
                          placeholder="Ej: Disponible marca Valeo coreano en $145.000 neto entrega inmediata"
                          value={formRespuestaWsp.mensajeOriginalWsp}
                          onChange={(e) =>
                            setFormRespuestaWsp((p) => ({
                              ...p,
                              mensajeOriginalWsp: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => setRespondiendoSolId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={enviandoRespuesta}
                        onClick={() => handleRecibirRespuestaWsp(sol.id)}
                      >
                        {enviandoRespuesta
                          ? 'Procesando...'
                          : '✓ Guardar Oferta y Calcular Precio FRP'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Tarjetas Comparativas de Ofertas Recibidas en Vivo */}
                {sol.ofertasRecibidas.length > 0 && (
                  <div className={styles.ofertasGrid}>
                    {sol.ofertasRecibidas.map((of) => (
                      <div
                        key={of.id}
                        className={`${styles.ofertaCard} ${
                          of.ganadora ? styles.ofertaCardGanadora : ''
                        }`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                              🏪 {of.proveedorNombre}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                              📞 {of.telefonoProveedor}
                            </div>
                          </div>

                          {of.ganadora && (
                            <span className={styles.badgeStatusWon}>🏆 Oferta Ganadora</span>
                          )}
                        </div>

                        {of.mensajeOriginalWsp && (
                          <div className={styles.wspBubble}>“{of.mensajeOriginalWsp}”</div>
                        )}

                        {of.fotoUrl && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <img
                              src={of.fotoUrl}
                              alt={of.fabricante}
                              style={{
                                width: 68,
                                height: 52,
                                objectFit: 'cover',
                                borderRadius: 8,
                                border: '1px solid #cbd5e1',
                              }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#0369a1', fontWeight: 600 }}>
                              📸 Foto verificada
                            </span>
                          </div>
                        )}

                        <div className={styles.extractedGrid}>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>FABRICANTE / ORIGEN</div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                              {of.fabricante} · {of.origen}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>DISPONIBILIDAD</div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669' }}>
                              ⚡ {of.disponibilidad}
                            </div>
                          </div>
                        </div>

                        <div className={styles.priceBox}>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                              Costo Proveedor (Neto)
                            </div>
                            <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>
                              {fmtCLP(of.precioCostoNeto)}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.68rem', color: '#86efac' }}>
                              Venta FRP (+{of.margenAplicadoPct}%)
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4ade80' }}>
                              {fmtCLP(of.precioVentaFrpNeto)} neto
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>
                              c/IVA: {fmtCLP(of.precioVentaFrpConIva)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`btn btn-sm ${of.ganadora ? 'btn-outline' : 'btn-primary'}`}
                          style={
                            !of.ganadora
                              ? { background: '#16a34a', borderColor: '#16a34a', width: '100%' }
                              : { width: '100%' }
                          }
                          disabled={adjudicandoOfertaId === of.id}
                          onClick={() => handleAdjudicarOferta(sol, of)}
                        >
                          {adjudicandoOfertaId === of.id
                            ? 'Adjudicando...'
                            : of.ganadora
                            ? '↻ Volver a Adjudicar'
                            : '🏆 Adjudicar Oferta + Publicar en Catálogo'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {sol.estado === 'adjudicada' && sol.mensajeCotizacionCliente && (
                  <div className={styles.quoteResultBox}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#14532d' }}>
                        ✅ Cotización Final Generada ({sol.skuPublicoGenerado})
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => {
                          navigator.clipboard.writeText(sol.mensajeCotizacionCliente || '');
                          notify('✓ Mensaje de cotización copiado al portapapeles', 'success');
                        }}
                      >
                        📋 Copiar Mensaje Cliente
                      </button>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontSize: '0.8rem',
                        background: '#ffffff',
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid #bbf7d0',
                        color: '#0f172a',
                      }}
                    >
                      {sol.mensajeCotizacionCliente}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
