import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
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

  const [solicitudes, setSolicitudes] = useState<SolicitudCotizacionWsp[]>([]);
  const [proveedoresWsp, setProveedoresWsp] = useState<Proveedor[]>([]);
  const [modoMeta, setModoMeta] = useState<'meta_cloud_api_live' | 'simulacion_meta_local'>(
    'simulacion_meta_local'
  );
  const [loading, setLoading] = useState(true);

  // Filtros de bandeja
  const [filtroEstado, setFiltroEstado] = useState<
    'todas' | 'esperando_respuestas' | 'con_ofertas' | 'adjudicada'
  >('todas');

  // Panel de Nueva Solicitud Multidifusión WhatsApp
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [buscandoBoostr, setBuscandoBoostr] = useState(false);
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [formSolicitud, setFormSolicitud] = useState({
    clienteNombre: 'Cliente WhatsApp / Mostrador',
    clienteTelefono: '+56994120088',
    patente: 'JPKR42',
    vin: '',
    marcaVehiculo: 'HYUNDAI',
    modeloVehiculo: 'PORTER',
    anioVehiculo: '2018',
    motorVehiculo: '2.5 D4CB CRDI',
    categoriaRepuesto: 'Embrague',
    repuestoBuscado: 'BOMBA DE INYECCIÓN ALTA PRESIÓN HYUNDAI PORTER 2.5 CRDI',
    codigoReferencia: '33100-4A410',
    notasAdicionales: 'No figura en catálogo Ailoo Soluparts ni Global. Cliente espera confirmación hoy.',
    margenPct: 30,
    escalamientoOrigenId: null as string | null,
  });
  const [proveedoresSeleccionados, setProveedoresSeleccionados] = useState<string[]>([]);

  // Panel Simulador / Receptor de respuesta entrante de Proveedor por WhatsApp
  const [respondiendoSolId, setRespondiendoSolId] = useState<string | null>(null);
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);
  const [formRespuestaWsp, setFormRespuestaWsp] = useState({
    proveedorId: '',
    mensajeOriginalWsp:
      'Hola jefe sí lo tengo acá en mesón, marca Bosch original coreano nuevo en $185.000 neto entrega inmediata, te adjunto foto.',
    transcripcionAudio:
      'Audio 0:09s — "Amigo sí me queda una unidad Bosch coreana en mesón a 185 neto retiro inmediato."',
    fotoUrl:
      'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=640&q=80',
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
        setSolicitudes(res.data.solicitudes);
        setProveedoresWsp(res.data.proveedoresWsp);
        setModoMeta(res.data.modoOperacionMeta);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al cargar Mesa de Cotización WhatsApp', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarMesaWsp();
  }, []);

  // Si venimos derivados desde un Escalamiento IA (`location.state`), precargar formulario
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
    if (proveedoresWsp.length === 0) return;
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
      setProveedoresSeleccionados(proveedoresWsp.slice(0, 2).map((p) => p.id!));
    }
  }, [formSolicitud.marcaVehiculo, proveedoresWsp]);

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
        notify(`✓ Vehículo ${res.data.make} ${res.data.model} (${res.data.year}) autocompletado vía Boostr`, 'success');
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
      notify('Selecciona al menos un proveedor especialista con WhatsApp', 'error');
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
          `📲 Solicitud #${res.data.codigoSolicitud} enviada por WhatsApp a ${res.data.proveedoresContactados.length} proveedor(es) especialista(s)`,
          'success'
        );
        setMostrarNueva(false);
        await cargarMesaWsp();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al enviar solicitud por WhatsApp', 'error');
    } finally {
      setEnviandoSolicitud(false);
    }
  };

  const abrirSimuladorRespuesta = (sol: SolicitudCotizacionWsp) => {
    if (respondiendoSolId === sol.id) {
      setRespondiendoSolId(null);
      return;
    }
    const primerProv = sol.proveedoresContactados?.[0]?.proveedorId || '';
    setRespondiendoSolId(sol.id);
    setFormRespuestaWsp({
      proveedorId: primerProv,
      mensajeOriginalWsp: `Hola jefe sí tenemos disponible ${sol.repuestoBuscado.toLowerCase()} marca Valeo coreano original en $145.000 neto entrega inmediata en mesón, te mando foto.`,
      transcripcionAudio:
        'Audio 0:08s — "Sí mano, tengo el Valeo coreano nuevo acá en mesón a 145 mil más IVA, pasa a retirarlo cuando quieras."',
      fotoUrl:
        'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=640&q=80',
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
            `🤖 IA extrajo oferta de ${of.proveedorNombre}: ${of.fabricante} (${of.origen}) · Costo ${fmtCLP(of.precioCostoNeto)} → Venta FRP ${fmtCLP(of.precioVentaFrpNeto)} neto`,
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
        if (res.data.inventarioCreadoId) extras.push('publicado en Firebase + Cola Delta WooCommerce');
        if (res.data.conocimientoCreadoId) extras.push('guardado en Conocimiento Aprendido IA');
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
      {/* Cabecera */}
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>
            📲 Mesa de Cotización en Vivo por WhatsApp (Etapa 3 · Meta Cloud API)
          </h1>
          <p className={styles.subtitle}>
            Cuando un repuesto no está en los nodos Ailoo (`Soluparts` / `Global`) ni en el Portal de Proveedores Locales, FácilRepuestos consulta en vivo por WhatsApp a proveedores reales según la marca del vehículo, extrae precios/fotos/audios con IA y genera la cotización con margen aplicado en 1 clic.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              padding: '6px 11px',
              borderRadius: 999,
              background: modoMeta === 'meta_cloud_api_live' ? '#dcfce7' : '#e0f2fe',
              color: modoMeta === 'meta_cloud_api_live' ? '#166534' : '#0369a1',
              border: '1px solid #bae6fd',
            }}
          >
            {modoMeta === 'meta_cloud_api_live'
              ? '🟢 Meta WhatsApp Cloud API Activo'
              : '🧪 Modo Simulación Interactiva Meta WhatsApp'}
          </span>

          <button
            className="btn btn-primary"
            style={{ background: '#16a34a', borderColor: '#16a34a' }}
            onClick={() => setMostrarNueva((v) => !v)}
          >
            {mostrarNueva
              ? '✕ Cerrar Disparador WhatsApp'
              : '📲 + Cotizar Repuesto en Vivo por WhatsApp'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Esperando Respuesta WSP</div>
          <div className={styles.kpiValue} style={{ color: '#d97706' }}>
            {totalEsperando}
          </div>
          <div className={styles.kpiSub}>Solicitudes enviadas a mesones externos</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Con Ofertas para Adjudicar</div>
          <div className={styles.kpiValue} style={{ color: '#2563eb' }}>
            {totalConOfertas}
          </div>
          <div className={styles.kpiSub}>Precios y fotos extraídos por IA listos</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Cotizaciones Adjudicadas</div>
          <div className={styles.kpiValue} style={{ color: '#16a34a' }}>
            {totalAdjudicadas}
          </div>
          <div className={styles.kpiSub}>Inyectadas a Firebase + WooCommerce + IA</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Proveedores WhatsApp Activos</div>
          <div className={styles.kpiValue} style={{ color: '#0f172a' }}>
            {proveedoresWsp.length}
          </div>
          <div className={styles.kpiSub}>Enrutados por marca de vehículo y rubro</div>
        </div>
      </div>

      {/* Panel para Disparar Nueva Solicitud Multidifusión por WhatsApp */}
      {mostrarNueva && (
        <form onSubmit={handleCrearSolicitudWsp} className={styles.panelCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#0f172a' }}>
              🚀 Disparar Consulta Multidifusión a Proveedores por WhatsApp (Meta API)
            </div>
            <span style={{ fontSize: '0.78rem', color: '#475569' }}>
              Filtra automáticamente a los proveedores que trabajan la marca del vehículo
            </span>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Patente Vehículo (Boostr)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className={styles.input}
                  style={{ flex: 1, textTransform: 'uppercase', fontWeight: 700 }}
                  value={formSolicitud.patente}
                  onChange={(e) =>
                    setFormSolicitud((p) => ({ ...p, patente: e.target.value.toUpperCase() }))
                  }
                  placeholder="Ej. JPKR42"
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={buscandoBoostr}
                  onClick={handleBuscarPatenteBoostr}
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
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, marcaVehiculo: e.target.value.toUpperCase() }))
                }
                placeholder="HYUNDAI, TOYOTA, PEUGEOT..."
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Modelo</label>
              <input
                className={styles.input}
                value={formSolicitud.modeloVehiculo}
                onChange={(e) =>
                  setFormSolicitud((p) => ({ ...p, modeloVehiculo: e.target.value.toUpperCase() }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Año</label>
              <input
                type="number"
                className={styles.input}
                value={formSolicitud.anioVehiculo}
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
                placeholder="Ej. KIT EMBRAGUE + VOLANTE BIMASA HYUNDAI PORTER 2.5"
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
              Proveedores Especialistas con WhatsApp ({proveedoresSeleccionados.length} seleccionados para marca{' '}
              <strong>{formSolicitud.marcaVehiculo || 'TODAS'}</strong>)
            </label>
            <div className={styles.provGrid}>
              {proveedoresWsp.map((prov) => {
                const activo = proveedoresSeleccionados.includes(prov.id!);
                const coincideMarca = (prov.marcas || [])
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
                      📞 {prov.telefono} · {prov.contacto || 'Mesón WhatsApp'}
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
              disabled={enviandoSolicitud}
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
            📦 Al adjudicar: publicar en Firebase `inventario` + Cola WooCommerce (Etapa 2)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={guardarConocimientoIa}
              onChange={(e) => setGuardarConocimientoIa(e.target.checked)}
            />
            🧠 Al adjudicar: enseñar al Agente IA (Etapa 1)
          </label>
        </div>
      </div>

      {/* Listado de Solicitudes en Vivo */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          Cargando Mesa de Cotización en Vivo por WhatsApp...
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
                      <span className={styles.badgeVehicle}>
                        🚗 {vehiculoLabel} {sol.patente ? `(${sol.patente})` : ''}
                      </span>
                      {sol.estado === 'esperando_respuestas' && (
                        <span className={styles.badgeStatusWait}>⏳ Esperando respuestas WhatsApp</span>
                      )}
                      {sol.estado === 'con_ofertas' && (
                        <span className={styles.badgeStatusOffers}>
                          💡 {sol.ofertasRecibidas.length} Oferta(s) recibida(s) en vivo
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

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() =>
                        setVerMensajesId(verMensajesId === sol.id ? null : sol.id)
                      }
                    >
                      {verMensajesId === sol.id
                        ? 'Ocultar Mensajes Enviados'
                        : `📤 Ver WhatsApp Enviados (${sol.proveedoresContactados.length})`}
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ background: '#0284c7', borderColor: '#0284c7' }}
                      onClick={() => abrirSimuladorRespuesta(sol)}
                    >
                      {respondiendoSolId === sol.id
                        ? '✕ Cerrar Receptor WSP'
                        : '💬 + Simular / Ingresar Respuesta Proveedor WSP'}
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
                      📤 Mensajes salientes despachados vía Meta WhatsApp API:
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

                {/* Simulador / Receptor de Respuesta en Vivo de Proveedor por WhatsApp */}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <strong style={{ fontSize: '0.88rem', color: '#0369a1' }}>
                        🤖 Receptor WhatsApp + Extractor IA en Vivo (Detecta precio neto/IVA, marca, origen y disponibilidad)
                      </strong>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() =>
                            setFormRespuestaWsp((p) => ({
                              ...p,
                              mensajeOriginalWsp:
                                'Hola jefe sí me queda en mesón marca AISIN japonés nuevo en $138.000 neto entrega inmediata, te mando foto.',
                              transcripcionAudio:
                                'Audio 0:07s — "Amigo el Aisin japonés original lo tengo acá en mesón a 138 mil más IVA retiro inmediato."',
                            }))
                          }
                        >
                          ⚡ Plantilla Japón ($138.000 neto)
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() =>
                            setFormRespuestaWsp((p) => ({
                              ...p,
                              mensajeOriginalWsp:
                                'Hola! Tenemos alternativo coreano marca Sangsin en 75 mil más IVA para despacho hoy mismo.',
                              transcripcionAudio: '',
                            }))
                          }
                        >
                          ⚡ Plantilla Corea ("75 mil + IVA")
                        </button>
                      </div>
                    </div>

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
                          Foto del Repuesto enviada por WhatsApp (URL)
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
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>
                          Mensaje de Texto libre recibido por WhatsApp
                        </label>
                        <textarea
                          className={styles.textarea}
                          value={formRespuestaWsp.mensajeOriginalWsp}
                          onChange={(e) =>
                            setFormRespuestaWsp((p) => ({
                              ...p,
                              mensajeOriginalWsp: e.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>
                          Transcripción de Audio de WhatsApp (Opcional)
                        </label>
                        <textarea
                          className={styles.textarea}
                          value={formRespuestaWsp.transcripcionAudio}
                          onChange={(e) =>
                            setFormRespuestaWsp((p) => ({
                              ...p,
                              transcripcionAudio: e.target.value,
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
                          ? 'Extrayendo con IA...'
                          : '🤖 Procesar Respuesta WhatsApp y Calcular Precio FRP'}
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
                              📞 {of.telefonoProveedor} · Confianza IA: {Math.round((of.confianzaIa || 0.9) * 100)}%
                            </div>
                          </div>

                          {of.ganadora && (
                            <span className={styles.badgeStatusWon}>🏆 Oferta Ganadora</span>
                          )}
                        </div>

                        {/* Burbuja de mensaje original de WhatsApp */}
                        {of.mensajeOriginalWsp && (
                          <div className={styles.wspBubble}>“{of.mensajeOriginalWsp}”</div>
                        )}

                        {/* Transcripción de nota de voz */}
                        {of.transcripcionAudio && (
                          <div className={styles.audioBubble}>🎙️ {of.transcripcionAudio}</div>
                        )}

                        {/* Foto real adjunta por el proveedor */}
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
                              📸 Foto de mesón verificada
                            </span>
                          </div>
                        )}

                        {/* Ficha estructurada extraída por IA */}
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

                        {/* Bloque de Costo Proveedor vs Precio Venta FácilRepuestos */}
                        <div className={styles.priceBox}>
                          <div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                              Costo Mesón (Neto)
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
                            ? 'Adjudicando y sincronizando...'
                            : of.ganadora
                            ? '↻ Volver a Adjudicar / Actualizar Ficha'
                            : '🏆 Adjudicar Oferta + Publicar en Catálogo + Enviar a Cliente'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Resumen de Cotización Ganadora Lista para el Cliente Final */}
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
                        ✅ Cotización Final Generada para el Cliente ({sol.skuPublicoGenerado})
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {sol.inventarioCreadoId && (
                          <span
                            style={{
                              fontSize: '0.73rem',
                              background: '#dcfce7',
                              color: '#166534',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                          >
                            📦 En Firebase `inventario` (`needsWooSync: true`)
                          </span>
                        )}
                        {sol.conocimientoCreadoId && (
                          <span
                            style={{
                              fontSize: '0.73rem',
                              background: '#dbeafe',
                              color: '#1e40af',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                          >
                            🧠 Aprendido por el Agente IA
                          </span>
                        )}
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
