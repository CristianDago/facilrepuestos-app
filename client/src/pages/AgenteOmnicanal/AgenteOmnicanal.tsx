import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  CandidatoInventarioCascada,
  SesionAgenteOmnicanal,
  SolicitudCotizacionWsp,
  TrazaCascadaAgente,
  VehiculoDetectadoAgente,
} from '../../types';
import styles from './AgenteOmnicanal.module.css';

interface EstadisticasHistoricas {
  totalHistoricasWsp: number;
  cerradasOPasadas24h: number;
  activasEnBandeja: number;
}

interface RespuestaListadoSesiones {
  sesiones: SesionAgenteOmnicanal[];
  estadisticasHistoricas?: EstadisticasHistoricas;
  padronDemoPatentes: VehiculoDetectadoAgente[];
}

type FiltroBandeja = 'todas' | 'con_carro' | 'busqueda_wsp';

/**
 * Calcula en el frontend la promesa de retiro y despacho para mostrarla en la ficha
 * comercial de la conversación activa según las reglas oficiales de FácilRepuestos.
 */
function calcularResumenLogisticoSesion(carrito: CandidatoInventarioCascada[] = []) {
  const ahora = new Date();
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(ahora);
  const map: Record<string, string> = {};
  for (const p of partes) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hora = Number(map.hour || 0) % 24;
  const minuto = Number(map.minute || 0);
  const minutosDia = hora * 60 + minuto;
  const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

  const diaStr = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'long',
  })
    .format(ahora)
    .toLowerCase();
  const esLunesAViernes = ['lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes'].includes(
    diaStr
  );
  const antesDeLas1130 = minutosDia < 11 * 60 + 30;
  const enVentanaDeliveryHoy = esLunesAViernes && minutosDia >= 9 * 60 && minutosDia < 16 * 60;

  let tieneSoluparts = false;
  let tienePortalProveedor = false;
  let tieneStockPropio = false;

  for (const it of carrito) {
    const sku = String(it.skuPublicoFrp || it.codigoInterno || '').toUpperCase();
    const origen = String(it.origen || '').toLowerCase();
    const prov = String(it.proveedorNombre || '').toLowerCase();

    if (origen === 'soluparts_ailoo' || sku.startsWith('FRP-SOL-') || prov.includes('solupart')) {
      tieneSoluparts = true;
    } else if (
      origen === 'portal_proveedor_local' ||
      origen === 'mesa_whatsapp' ||
      sku.startsWith('FRP-LOC-') ||
      sku.startsWith('FRP-WSP-')
    ) {
      tienePortalProveedor = true;
    } else {
      tieneStockPropio = true;
    }
  }

  let reglaRetiroTitulo = 'Según origen del repuesto';
  let reglaRetiroDetalle =
    'Stock propio: Retiro y pago inmediato · Soluparts (portal web): compras antes de 11:30 hrs retiro el mismo día desde 15:30 hrs (después de 11:30 hrs retiro al día siguiente desde 15:30 hrs) · Otros: Despacho según dimensión.';

  if (tieneSoluparts) {
    reglaRetiroTitulo =
      esLunesAViernes && antesDeLas1130
        ? 'Retiro HOY desde las 15:30 hrs (3:30 PM) comprando antes de las 11:30 hrs'
        : 'Retiro desde las 15:30 hrs (3:30 PM) del día siguiente';
    reglaRetiroDetalle =
      esLunesAViernes && antesDeLas1130
        ? 'Comprando en nuestro portal antes de las 11:30 hrs → Disponible hoy a partir de las 15:30 hrs (3:30 PM) en Enrique Olivares 224 (o despacho según dimensión).'
        : 'Compras posteriores a las 11:30 hrs pasan al corte de antes de las 12:00 del día siguiente → Retiro desde las 15:30 hrs (3:30 PM) en Enrique Olivares 224 (o despacho según dimensión).';
  } else if (tienePortalProveedor) {
    reglaRetiroTitulo = 'Despacho según dimensión en Santiago y Chile';
    reglaRetiroDetalle =
      'Repuesto de proveedor externo / Mesa WSP → Se calcula y entrega cotización de despacho según dimensión comprando en facilrepuestos.cl.';
  } else if (tieneStockPropio && carrito.length > 0) {
    reglaRetiroTitulo = 'Retiro y Pago Inmediato en Tienda';
    reglaRetiroDetalle =
      '100% en nuestro stock directo en tienda → Retiro y pago inmediato en Enrique Olivares 224, La Florida.';
  }

  const reglaDeliveryTitulo = enVentanaDeliveryHoy
    ? 'Delivery Santiago en 2 horas (Activo ahora)'
    : 'Despacho al día hábil siguiente (Compras después de las 16:00 hrs)';

  const reglaDeliveryDetalle = enVentanaDeliveryHoy
    ? `Hora Chile ${horaStr} hrs (dentro de ventana 09:00 a 16:00 L-V) → Entrega en 2 horas en todo Santiago.`
    : `Hora Chile ${horaStr} hrs → El delivery de 2 horas opera de Lunes a Viernes de 09:00 a 18:00 hrs; compras después de las 16:00 hrs salen al día siguiente.`;

  return {
    horaChile: horaStr,
    reglaRetiroTitulo,
    reglaRetiroDetalle,
    reglaDeliveryTitulo,
    reglaDeliveryDetalle,
  };
}

/**
 * Renderiza el texto del mensaje convirtiendo **negritas** y URLs en elementos legibles y clickeables.
 */
function renderizarTextoMensaje(texto: string) {
  const limpio = String(texto || '').replace(/`([^`]+)`/g, '$1');
  const partesUrl = limpio.split(/(https?:\/\/[^\s)]+)/g);

  return partesUrl.map((fragmento, idx) => {
    if (/^https?:\/\//i.test(fragmento)) {
      return (
        <a
          key={idx}
          href={fragmento}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#0284c7',
            fontWeight: 700,
            textDecoration: 'underline',
            wordBreak: 'break-all',
          }}
        >
          {fragmento}
        </a>
      );
    }

    const trozosNegrita = fragmento.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={idx}>
        {trozosNegrita.map((t, j) => {
          if (t.startsWith('**') && t.endsWith('**') && t.length > 4) {
            return <strong key={j}>{t.slice(2, -2)}</strong>;
          }
          return t;
        })}
      </span>
    );
  });
}

export default function AgenteOmnicanal() {
  const { notify } = useAppStore();
  const navigate = useNavigate();

  const [sesiones, setSesiones] = useState<SesionAgenteOmnicanal[]>([]);
  const [estadisticasHistoricas, setEstadisticasHistoricas] = useState<EstadisticasHistoricas>({
    totalHistoricasWsp: 0,
    cerradasOPasadas24h: 0,
    activasEnBandeja: 0,
  });
  const [padronDemo, setPadronDemo] = useState<VehiculoDetectadoAgente[]>([]);
  const [sesionActivaId, setSesionActivaId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enviandoMensaje, setEnviandoMensaje] = useState(false);

  // Buscador y filtros de la bandeja de clientes
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [filtroBandeja, setFiltroBandeja] = useState<FiltroBandeja>('todas');

  // Composer del mensaje
  const [textoMensaje, setTextoMensaje] = useState('');
  const [transcripcionAudio, setTranscripcionAudio] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [patenteInput, setPatenteInput] = useState('');
  const [mostrarOpcionesPrueba, setMostrarOpcionesPrueba] = useState(false);

  // Buffer de 5 segundos desde el último mensaje para agrupar múltiples envíos seguidos
  const [mensajesEnBuffer, setMensajesEnBuffer] = useState<string[]>([]);
  const [segundosRestantesBuffer, setSegundosRestantesBuffer] = useState<number>(0);
  const timerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferTextosRef = useRef<string[]>([]);

  // Modal nueva conversación manual
  const [mostrarNuevaSesion, setMostrarNuevaSesion] = useState(false);
  const [formNuevaSesion, setFormNuevaSesion] = useState({
    canal: 'whatsapp_cliente' as const,
    clienteNombre: '',
    clienteTelefono: '+569',
    patenteInicial: '',
  });

  // Panel de Configuración de los 6 Agentes IA (Gemini 4 Neon + Contexto en Vivo) y Prueba Directa (+56951387986)
  const [mostrarConfigAgentes, setMostrarConfigAgentes] = useState(false);
  const [guardandoConfigAgentes, setGuardandoConfigAgentes] = useState(false);
  const [enviandoPruebaPersonal, setEnviandoPruebaPersonal] = useState(false);
  const [telefonoPruebaPersonal, setTelefonoPruebaPersonal] = useState('+56951387986');
  const [phoneNumberIdMesaInput, setPhoneNumberIdMesaInput] = useState('1438078979396084');

  // Panel Google Cloud CX · Quality AI & Conversational Insights
  const [mostrarPanelCx, setMostrarPanelCx] = useState(false);
  const [cargandoCx, setCargandoCx] = useState(false);
  const [auditandoSesionIaId, setAuditandoSesionIaId] = useState<string | null>(null);
  const [aplicandoMejoraId, setAplicandoMejoraId] = useState<string | null>(null);
  const [reglasEditablesCx, setReglasEditablesCx] = useState<Record<string, string>>({});
  const [dashboardCx, setDashboardCx] = useState<{
    resumenKpis: {
      totalSesionesAuditadas: number;
      scorePromedioCx: number;
      totalOptimas: number;
      totalConAtencion: number;
      totalCriticasConFriccion: number;
      tasaEntregaLinkTiendaPct: number;
    };
    saludPorAgente: Array<{
      agenteId: string;
      nombre: string;
      alertasActivas: number;
      estadoSalud: 'optimo' | 'atencion' | 'critico';
    }>;
    auditorias: Array<{
      sesionId: string;
      clienteNombre: string;
      clienteTelefono: string;
      vehiculoResumen: string;
      totalTurnosCliente: number;
      totalTurnosAgente: number;
      ultimoMensajeCliente: string;
      tieneLinkEntregado: boolean;
      itemsEnCarrito: number;
      scoreCx: number;
      semaforoCx: 'optimo' | 'atencion' | 'critico';
      sentimientoCliente: string;
      etapaEmbudo: string;
      problemasDetectados: Array<{
        codigo: string;
        severidad: string;
        descripcion: string;
      }>;
      agenteResponsableId: string;
      agenteResponsableNombre: string;
      diagnosticoEjecutivo: string;
      auditadoConGemini?: boolean;
      mejoraSugerida: {
        titulo: string;
        agenteDestinoId: string;
        agenteDestinoNombre: string;
        reglaNuevaParaInyectar: string;
      } | null;
      updatedAt: string;
    }>;
  } | null>(null);
  const [configAgentes, setConfigAgentes] = useState<{
    modeloGlobalPreferido: string;
    ttlHorasProductoTemporal: number;
    topProveedoresMesaWsp: number;
    modelosDisponibles: Array<{ id: string; nombre: string }>;
    agentes: Record<
      string,
      {
        id: string;
        nombre: string;
        modelo: string;
        rol: string;
        instrucciones: string;
        contextoExtra: string;
        activo: boolean;
      }
    >;
  } | null>(null);

  const cargarDashboardCx = async () => {
    try {
      setCargandoCx(true);
      const r = await api.get<ApiResponse<typeof dashboardCx>>('/agente-omnicanal/cx-insights');
      if (r.success && r.data) {
        setDashboardCx(r.data);
        const mapReglas: Record<string, string> = {};
        for (const aud of r.data.auditorias || []) {
          if (aud.mejoraSugerida?.reglaNuevaParaInyectar) {
            mapReglas[aud.sesionId] = aud.mejoraSugerida.reglaNuevaParaInyectar;
          }
        }
        setReglasEditablesCx((prev) => ({ ...mapReglas, ...prev }));
      }
    } catch {
      // silencioso
    } finally {
      setCargandoCx(false);
    }
  };

  const handleAuditarSesionConGeminiCx = async (sesionId: string) => {
    try {
      setAuditandoSesionIaId(sesionId);
      const r = await api.post<
        ApiResponse<NonNullable<typeof dashboardCx>['auditorias'][number]>
      >(`/agente-omnicanal/cx-insights/auditar-ia/${sesionId}`, {});
      if (r.success && r.data) {
        const nuevaAud = r.data;
        setDashboardCx((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            auditorias: prev.auditorias.map((a) => (a.sesionId === sesionId ? nuevaAud : a)),
          };
        });
        if (nuevaAud.mejoraSugerida?.reglaNuevaParaInyectar) {
          setReglasEditablesCx((prev) => ({
            ...prev,
            [sesionId]: nuevaAud.mejoraSugerida!.reglaNuevaParaInyectar,
          }));
        }
        notify(`🔬 Auditoría profunda Gemini Quality AI completada (${nuevaAud.scoreCx}% CX)`, 'success');
      }
    } catch (err) {
      notify((err as Error).message || 'Error al auditar sesión con Gemini CX', 'error');
    } finally {
      setAuditandoSesionIaId(null);
    }
  };

  const handleAplicarMejoraCxAAgente = async (
    sesionId: string,
    agenteDestinoId: string,
    tituloMejora: string
  ) => {
    const regla = (reglasEditablesCx[sesionId] || '').trim();
    if (!regla) {
      notify('Escribe o revisa la regla correctiva antes de inyectarla al agente', 'error');
      return;
    }
    try {
      setAplicandoMejoraId(sesionId);
      const r = await api.post<
        ApiResponse<{
          agenteActualizado: { nombre: string };
          configuracionCompleta: typeof configAgentes;
        }>
      >('/agente-omnicanal/cx-insights/aplicar-mejora', {
        sesionId,
        agenteDestinoId,
        reglaNuevaParaInyectar: regla,
        tituloMejora,
      });
      if (r.success && r.data) {
        if (r.data.configuracionCompleta) {
          setConfigAgentes(r.data.configuracionCompleta);
        }
        notify(
          `✨ Mejora inyectada en caliente en "${r.data.agenteActualizado?.nombre || agenteDestinoId}"`,
          'success'
        );
      }
    } catch (err) {
      notify((err as Error).message || 'Error al aplicar mejora al agente', 'error');
    } finally {
      setAplicandoMejoraId(null);
    }
  };

  const cargarConfigAgentes = async () => {
    try {
      const [resAgentes, resMesa] = await Promise.all([
        api.get<ApiResponse<typeof configAgentes>>('/mesa-wsp/agentes-config').catch(() => null),
        api.get<ApiResponse<{ phoneNumberIdMesaB2b?: string }>>('/mesa-wsp/solicitudes').catch(() => null),
      ]);
      if (resAgentes?.success && resAgentes.data) {
        setConfigAgentes(resAgentes.data);
      }
      if (resMesa?.success && resMesa.data?.phoneNumberIdMesaB2b) {
        setPhoneNumberIdMesaInput(resMesa.data.phoneNumberIdMesaB2b);
      }
    } catch {
      // silencioso
    }
  };

  const handleGuardarConfigAgentes = async () => {
    if (!configAgentes) return;
    try {
      setGuardandoConfigAgentes(true);
      const r = await api.put<ApiResponse<typeof configAgentes>>('/mesa-wsp/agentes-config', configAgentes);
      if (r.success && r.data) {
        setConfigAgentes(r.data);
        notify('✓ Cerebros, modelo (Gemini 4 Neon) y contexto de los 6 agentes actualizados en vivo', 'success');
      }
    } catch (err) {
      notify((err as Error).message || 'Error al guardar configuración de agentes', 'error');
    } finally {
      setGuardandoConfigAgentes(false);
    }
  };

  const handleGuardarPhoneIdMesa = async () => {
    try {
      const r = await api.post<
        ApiResponse<{ phoneNumberIdMesaB2b: string; numerosRegistradosEnMetaWaba: Array<{ id: string; display_phone_number: string }> }>
      >('/mesa-wsp/config-numero-mesa', {
        phoneNumberIdMesaB2b: phoneNumberIdMesaInput,
        numeroMesaB2b: '56950960294',
      });
      if (r.success && r.data) {
        if (r.data.phoneNumberIdMesaB2b) {
          setPhoneNumberIdMesaInput(r.data.phoneNumberIdMesaB2b);
          notify(`✓ Phone Number ID de +56 9 5096 0294 vinculado (${r.data.phoneNumberIdMesaB2b})`, 'success');
        } else {
          notify(
            `ℹ Aún no figura +56 9 5096 0294 en el WABA de Meta. Agrégalo en developers.facebook.com -> WhatsApp o pega su Phone Number ID aquí.`,
            'info'
          );
        }
      }
    } catch (err) {
      notify((err as Error).message || 'Error al verificar número en Meta', 'error');
    }
  };

  const handleEnviarPruebaAMiNumero = async () => {
    try {
      setEnviandoPruebaPersonal(true);
      const r = await api.post<
        ApiResponse<
          SolicitudCotizacionWsp & {
            resultadoEnvioMeta?: { enviadoReal?: boolean; modoEnvio?: string; errorMeta?: string };
          }
        >
      >('/mesa-wsp/probar-envio', {
        telefonoPrueba: telefonoPruebaPersonal,
      });
      if (r.success && r.data) {
        const resMeta = r.data.resultadoEnvioMeta;
        if (resMeta?.enviadoReal) {
          notify(
            `📲 Solicitud #${r.data.codigoSolicitud} enviada por WhatsApp real a ${telefonoPruebaPersonal}. ¡Respóndele desde tu celular para probar la subida temporal de 4h a WordPress!`,
            'success'
          );
        } else {
          notify(
            `⚠️ Solicitud #${r.data.codigoSolicitud} creada (${resMeta?.errorMeta || 'Recuerda enviar primero un "Hola" desde tu celular al número de WhatsApp para abrir la ventana de 24h de Meta'}).`,
            'info'
          );
        }
      }
    } catch (err) {
      notify((err as Error).message || 'Error al enviar prueba de cotización', 'error');
    } finally {
      setEnviandoPruebaPersonal(false);
    }
  };

  const cargarSesiones = async (seleccionarId?: string, silencioso = false) => {
    try {
      if (!silencioso) setLoading(true);
      else setRefreshing(true);

      const res = await api.get<ApiResponse<RespuestaListadoSesiones>>(
        '/agente-omnicanal/sesiones'
      );
      if (res.success && res.data) {
        const lista = res.data.sesiones || [];
        setSesiones(lista);
        if (res.data.estadisticasHistoricas) {
          setEstadisticasHistoricas(res.data.estadisticasHistoricas);
        }
        setPadronDemo(res.data.padronDemoPatentes || []);
        setSesionActivaId((prevId) => {
          if (seleccionarId) return seleccionarId;
          if (lista.length === 0) return '';
          // Si ya hay una conversación seleccionada que existe en la lista, NUNCA cambiarla en el auto-refresco
          if (prevId && lista.some((s) => s.id === prevId)) {
            return prevId;
          }
          return lista[0].id;
        });
      }
    } catch (err) {
      if (!silencioso) {
        notify((err as Error).message || 'Error al cargar conversaciones de Repuestín', 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void cargarSesiones();
    void cargarConfigAgentes();
    void cargarDashboardCx();
    // Auto-refresco silencioso cada 8 segundos para ver en vivo los mensajes entrantes de WhatsApp
    // (usa actualización funcional de sesionActivaId para no resetear jamás el chat que estás leyendo)
    const interval = setInterval(() => {
      void cargarSesiones(undefined, true);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Quitar una conversación de la lista activa con el botón ✕ (pasa a estadística)
  const handleArchivarSesion = async (e: React.MouseEvent, idSesion: string) => {
    e.stopPropagation();
    try {
      setSesiones((prev) => prev.filter((s) => s.id !== idSesion));
      if (sesionActivaId === idSesion) {
        const restantes = sesiones.filter((s) => s.id !== idSesion);
        setSesionActivaId(restantes[0]?.id || '');
      }
      await api.post(`/agente-omnicanal/sesiones/${idSesion}/archivar`, {});
      setEstadisticasHistoricas((prev) => ({
        ...prev,
        cerradasOPasadas24h: prev.cerradasOPasadas24h + 1,
        activasEnBandeja: Math.max(0, prev.activasEnBandeja - 1),
      }));
    } catch {
      notify('No se pudo quitar la conversación', 'error');
    }
  };

  // Limpiar toda la bandeja activa de una vez
  const handleLimpiarBandeja = async () => {
    try {
      setRefreshing(true);
      await api.post('/agente-omnicanal/sesiones/limpiar-historicos', {});
      setSesiones([]);
      setSesionActivaId('');
      notify('Bandeja limpiada (conversaciones pasadas a estadística)', 'success');
      await cargarSesiones(undefined, true);
    } catch {
      notify('Error al limpiar la bandeja', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Filtrado de sesiones en la columna izquierda (solo WhatsApp y < 24h)
  const sesionesFiltradas = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    return sesiones.filter((s) => {
      const tieneCarro = (s.carritoCotizado?.length || 0) > 0;
      const tieneBusqueda = (s.solicitudesWspAbiertas?.length || 0) > 0;

      if (filtroBandeja === 'con_carro' && !tieneCarro) return false;
      if (filtroBandeja === 'busqueda_wsp' && !tieneBusqueda) return false;

      if (!q) return true;
      const nombre = (s.clienteNombre || '').toLowerCase();
      const tel = (s.clienteTelefono || '').toLowerCase();
      const pat = (s.vehiculoContexto?.patente || '').toLowerCase();
      const veh = `${s.vehiculoContexto?.marca || ''} ${s.vehiculoContexto?.modelo || ''}`.toLowerCase();
      const skus = (s.carritoCotizado || [])
        .map((c) => `${c.skuPublicoFrp} ${c.nombre}`)
        .join(' ')
        .toLowerCase();
      return (
        nombre.includes(q) ||
        tel.includes(q) ||
        pat.includes(q) ||
        veh.includes(q) ||
        skus.includes(q)
      );
    });
  }, [sesiones, busquedaCliente, filtroBandeja]);

  const sesionActiva = useMemo(
    () =>
      sesiones.find((s) => s.id === sesionActivaId) ||
      sesionesFiltradas[0] ||
      sesiones[0] ||
      null,
    [sesiones, sesionActivaId, sesionesFiltradas]
  );

  const ultimaTraza: TrazaCascadaAgente | null = useMemo(() => {
    if (!sesionActiva?.mensajes) return null;
    for (let i = sesionActiva.mensajes.length - 1; i >= 0; i--) {
      if (sesionActiva.mensajes[i].trazaCascada) {
        return sesionActiva.mensajes[i].trazaCascada || null;
      }
    }
    return null;
  }, [sesionActiva]);

  // Carrito efectivo de la sesión activa
  const carritoSesionActiva: CandidatoInventarioCascada[] = useMemo(() => {
    if (sesionActiva?.carritoCotizado && sesionActiva.carritoCotizado.length > 0) {
      return sesionActiva.carritoCotizado;
    }
    return ultimaTraza?.candidatosInventario || [];
  }, [sesionActiva, ultimaTraza]);

  const totalCarritoActivo = useMemo(
    () =>
      carritoSesionActiva.reduce(
        (acc, it) => acc + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1),
        0
      ),
    [carritoSesionActiva]
  );

  const urlCarroUnificado = useMemo(() => {
    if (carritoSesionActiva.length === 0) return '';
    const primerUrl =
      carritoSesionActiva[0]?.urlAgregarAlCarroWoo || carritoSesionActiva[0]?.urlProductoWoo || '';
    if (carritoSesionActiva.length === 1 && primerUrl) {
      return primerUrl;
    }
    const skus = carritoSesionActiva.map((c) => c.skuPublicoFrp).filter(Boolean);
    return `https://facilrepuestos.cl/?s=${encodeURIComponent(skus.join(' '))}&post_type=product`;
  }, [carritoSesionActiva]);

  const infoLogisticaActiva = useMemo(
    () => calcularResumenLogisticoSesion(carritoSesionActiva),
    [carritoSesionActiva]
  );

  // KPIs operativos reales
  const kpis = useMemo(() => {
    const totalActivas = sesiones.length;
    const conVehiculo = sesiones.filter((s) => Boolean(s.vehiculoContexto?.marca)).length;
    const sesionesConCarro = sesiones.filter((s) => (s.carritoCotizado?.length || 0) > 0);
    const montoTotalCotizado = sesionesConCarro.reduce(
      (acc, s) =>
        acc +
        (s.carritoCotizado || []).reduce(
          (sum, it) => sum + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1),
          0
        ),
      0
    );
    const conBusquedaPendiente = sesiones.filter(
      (s) => (s.solicitudesWspAbiertas?.length || 0) > 0
    ).length;

    return {
      totalActivas,
      conVehiculo,
      carrosCount: sesionesConCarro.length,
      montoTotalCotizado,
      conBusquedaPendiente,
    };
  }, [sesiones]);

  const handleCrearSesion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNuevaSesion.clienteNombre.trim()) {
      notify('Ingresa el nombre del cliente', 'error');
      return;
    }
    try {
      const res = await api.post<ApiResponse<SesionAgenteOmnicanal>>(
        '/agente-omnicanal/sesiones',
        formNuevaSesion
      );
      if (res.success && res.data) {
        notify(`Conversación WhatsApp iniciada con ${res.data.clienteNombre}`, 'success');
        setMostrarNuevaSesion(false);
        setFormNuevaSesion({
          canal: 'whatsapp_cliente',
          clienteNombre: '',
          clienteTelefono: '+569',
          patenteInicial: '',
        });
        await cargarSesiones(res.data.id);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al crear conversación', 'error');
    }
  };

  const enviarConsultaCascada = async (payloadOverride?: {
    texto: string;
    transcripcionAudio?: string;
    fotoUrl?: string;
    patente?: string;
    modoForzado?: 'auto' | 'forzar_escalamiento' | 'forzar_mesa_wsp';
  }) => {
    if (!sesionActiva) return;
    const payload = payloadOverride || {
      texto: textoMensaje,
      transcripcionAudio,
      fotoUrl,
      patente: patenteInput,
      modoForzado: 'auto' as const,
    };

    if (!payload.texto.trim() && !(payload.transcripcionAudio || '').trim()) {
      notify('Escribe un mensaje para enviar a la conversación', 'error');
      return;
    }

    // Agrupar mensajes manuales durante 5 segundos desde el último envío
    if (!payloadOverride) {
      const nuevoTexto = payload.texto.trim();
      bufferTextosRef.current = [...bufferTextosRef.current, nuevoTexto];
      setMensajesEnBuffer([...bufferTextosRef.current]);
      setTextoMensaje('');

      if (timerDebounceRef.current) clearTimeout(timerDebounceRef.current);
      if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);

      setSegundosRestantesBuffer(5);
      intervalCountdownRef.current = setInterval(() => {
        setSegundosRestantesBuffer((prev) => (prev > 1 ? prev - 1 : 0));
      }, 1000);

      const snapshotAudio = transcripcionAudio;
      const snapshotFoto = fotoUrl;
      const snapshotPatente = patenteInput;

      timerDebounceRef.current = setTimeout(() => {
        if (intervalCountdownRef.current) clearInterval(intervalCountdownRef.current);
        const textoCombinado = bufferTextosRef.current.join('\n');
        bufferTextosRef.current = [];
        setMensajesEnBuffer([]);
        setSegundosRestantesBuffer(0);
        void enviarConsultaCascada({
          texto: textoCombinado,
          transcripcionAudio: snapshotAudio,
          fotoUrl: snapshotFoto,
          patente: snapshotPatente,
          modoForzado: 'auto',
        });
      }, 5000);
      return;
    }

    try {
      setEnviandoMensaje(true);
      const res = await api.post<
        ApiResponse<{
          sesion: SesionAgenteOmnicanal;
          trazaCascada: TrazaCascadaAgente;
        }>
      >(`/agente-omnicanal/sesiones/${sesionActiva.id}/mensaje`, payload);

      if (res.success && res.data) {
        setSesiones((prev) =>
          prev.map((s) => (s.id === sesionActiva.id ? res.data!.sesion : s))
        );
        setTranscripcionAudio('');
        setFotoUrl('');
        setPatenteInput('');
      }
    } catch (err) {
      notify((err as Error).message || 'Error al procesar mensaje con Repuestín', 'error');
    } finally {
      setEnviandoMensaje(false);
    }
  };

  const copiarAlPortapapeles = (texto: string, etiqueta: string) => {
    navigator.clipboard
      .writeText(texto)
      .then(() => notify(`${etiqueta} copiado al portapapeles`, 'success'))
      .catch(() => notify('No se pudo copiar el enlace', 'error'));
  };

  return (
    <div className={styles.page}>
      {/* ── ENCABEZADO SUPERIOR COMPACTO Y SIMPLE ─────────────── */}
      <div className={styles.headerCompact}>
        <div className={styles.headerCompactLeft}>
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
            style={{ height: 28, width: 'auto', objectFit: 'contain' }}
          />
          <div>
            <h1 className={styles.titleCompact}>
              🤖 Repuestín WhatsApp (+56 9 2110 9851)
            </h1>
            <span className={styles.subtitleCompact}>
              Espera 5s activa · Conversaciones se archivan en 24h a estadística
            </span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{
              background: mostrarPanelCx ? '#0284c7' : 'rgba(14, 165, 233, 0.25)',
              color: '#fff',
              borderColor: '#38bdf8',
              fontWeight: 800,
            }}
            onClick={() => {
              setMostrarPanelCx((v) => !v);
              void cargarDashboardCx();
            }}
          >
            {mostrarPanelCx
              ? '✕ Cerrar Google Cloud CX'
              : `📊 Google Cloud CX · Quality AI${
                  dashboardCx?.resumenKpis
                    ? ` (${dashboardCx.resumenKpis.scorePromedioCx}%)`
                    : ''
                }`}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{
              background: mostrarConfigAgentes ? '#4f46e5' : 'rgba(99, 102, 241, 0.28)',
              color: '#fff',
              borderColor: '#818cf8',
              fontWeight: 800,
            }}
            onClick={() => {
              setMostrarConfigAgentes((v) => !v);
              if (!configAgentes) void cargarConfigAgentes();
            }}
          >
            {mostrarConfigAgentes
              ? '✕ Cerrar Cerebros IA'
              : '🧠 Configurar 6 Agentes IA & Probar'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              borderColor: 'rgba(255,255,255,0.28)',
            }}
            onClick={() => cargarSesiones(sesionActiva?.id, false)}
            disabled={refreshing}
          >
            {refreshing ? '↻ Actualizando...' : '↻ Actualizar'}
          </button>
          {sesiones.length > 0 && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.28)',
              }}
              onClick={handleLimpiarBandeja}
            >
              🧹 Limpiar Bandeja
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              borderColor: 'rgba(255,255,255,0.28)',
            }}
            onClick={() => navigate('/mesa-wsp')}
          >
            📲 Proveedores Internos ({kpis.conBusquedaPendiente})
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{
              background: '#25D366',
              color: '#052e16',
              fontWeight: 800,
              border: 'none',
            }}
            onClick={() => setMostrarNuevaSesion((v) => !v)}
          >
            + Nueva Conversación WSP
          </button>
        </div>
      </div>

      {/* ── PANEL GOOGLE CLOUD CX · QUALITY AI & CONVERSATIONAL INSIGHTS ── */}
      {mostrarPanelCx && (
        <div
          style={{
            background: '#ffffff',
            border: '2px solid #0284c7',
            borderRadius: 14,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#0f172a' }}>
                📊 Google Cloud CX · Quality AI & Conversational Insights (facilrepuestos-prod)
              </div>
              <div style={{ fontSize: '0.81rem', color: '#475569' }}>
                Audita automáticamente la experiencia del cliente en cada conversación, detecta en qué subagente ocurrió fricción y permite inyectar mejoras en 1 clic.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={cargandoCx}
              onClick={cargarDashboardCx}
            >
              {cargandoCx ? 'Auditando conversaciones...' : '↻ Re-Auditar Bandeja Activa'}
            </button>
          </div>

          {dashboardCx && (
            <>
              {/* KPIs de Calidad CX */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#64748b' }}>
                    SCORE PROMEDIO CX
                  </div>
                  <div
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 800,
                      color:
                        dashboardCx.resumenKpis.scorePromedioCx >= 80
                          ? '#16a34a'
                          : dashboardCx.resumenKpis.scorePromedioCx >= 60
                          ? '#d97706'
                          : '#dc2626',
                    }}
                  >
                    {dashboardCx.resumenKpis.scorePromedioCx}%
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#475569' }}>
                    Sobre {dashboardCx.resumenKpis.totalSesionesAuditadas} conversación(es)
                  </div>
                </div>

                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#166534' }}>
                    🟢 CONVERSACIONES FLUIDAS
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#15803d' }}>
                    {dashboardCx.resumenKpis.totalOptimas}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#166534' }}>
                    Intención entendida a la primera
                  </div>
                </div>

                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#92400e' }}>
                    🟡 CON OBSERVACIÓN / DUDA
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#d97706' }}>
                    {dashboardCx.resumenKpis.totalConAtencion}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#92400e' }}>
                    Respuestas extensas o en espera
                  </div>
                </div>

                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#991b1b' }}>
                    🔴 CON FRICCIÓN DETECTADA
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#dc2626' }}>
                    {dashboardCx.resumenKpis.totalCriticasConFriccion}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#991b1b' }}>
                    Con regla correctiva lista para aplicar
                  </div>
                </div>

                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#1e40af' }}>
                    🛒 ENTREGA DE LINK WEB
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#2563eb' }}>
                    {dashboardCx.resumenKpis.tasaEntregaLinkTiendaPct}%
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#1e40af' }}>
                    Conversaciones con link facilrepuestos.cl
                  </div>
                </div>
              </div>

              {/* Semáforo de Salud por Subagente */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  background: '#f8fafc',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                }}
              >
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#334155', marginRight: 4 }}>
                  Salud por Agente:
                </span>
                {dashboardCx.saludPorAgente.map((ag) => (
                  <span
                    key={ag.agenteId}
                    style={{
                      fontSize: '0.73rem',
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 999,
                      background:
                        ag.alertasActivas === 0
                          ? '#dcfce7'
                          : ag.alertasActivas <= 2
                          ? '#fef3c7'
                          : '#fee2e2',
                      color:
                        ag.alertasActivas === 0
                          ? '#166534'
                          : ag.alertasActivas <= 2
                          ? '#92400e'
                          : '#991b1b',
                    }}
                  >
                    {ag.alertasActivas === 0 ? '🟢' : ag.alertasActivas <= 2 ? '🟡' : '🔴'}{' '}
                    {ag.nombre.split('·')[0].trim()} ({ag.alertasActivas} alerta{ag.alertasActivas === 1 ? '' : 's'})
                  </span>
                ))}
              </div>

              {/* Lista de Conversaciones Auditadas y Recomendaciones de Mejora en 1 Clic */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 460, overflowY: 'auto' }}>
                {dashboardCx.auditorias.map((aud) => {
                  const esCritico = aud.semaforoCx === 'critico';
                  const esAtencion = aud.semaforoCx === 'atencion';
                  return (
                    <div
                      key={aud.sesionId}
                      style={{
                        background: esCritico ? '#fff1f2' : esAtencion ? '#fffbeb' : '#f8fafc',
                        border: `1px solid ${
                          esCritico ? '#fda4af' : esAtencion ? '#fde68a' : '#cbd5e1'
                        }`,
                        borderRadius: 10,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: '0.76rem',
                              fontWeight: 800,
                              padding: '3px 9px',
                              borderRadius: 999,
                              background: esCritico
                                ? '#dc2626'
                                : esAtencion
                                ? '#d97706'
                                : '#16a34a',
                              color: '#fff',
                            }}
                          >
                            {esCritico ? '🔴' : esAtencion ? '🟡' : '🟢'} {aud.scoreCx}% CX
                          </span>
                          <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                            {aud.clienteNombre} ({aud.clienteTelefono})
                          </strong>
                          <span style={{ fontSize: '0.78rem', color: '#475569' }}>
                            🚗 {aud.vehiculoResumen} · {aud.etapaEmbudo}
                          </span>
                          <span
                            style={{
                              fontSize: '0.73rem',
                              background: '#e2e8f0',
                              color: '#1e293b',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                          >
                            Sentimiento: {aud.sentimientoCliente}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '0.74rem' }}
                            onClick={() => {
                              setSesionActivaId(aud.sesionId);
                              setMostrarPanelCx(false);
                            }}
                          >
                            👁️ Ver Chat
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '0.74rem', borderColor: '#0284c7', color: '#0369a1' }}
                            disabled={auditandoSesionIaId === aud.sesionId}
                            onClick={() => handleAuditarSesionConGeminiCx(aud.sesionId)}
                          >
                            {auditandoSesionIaId === aud.sesionId
                              ? 'Auditando con Gemini...'
                              : '🔬 Evaluar con Gemini Quality AI'}
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: '#1e293b', lineHeight: 1.45 }}>
                        <strong>Diagnóstico Quality AI ({aud.agenteResponsableNombre}):</strong>{' '}
                        {aud.diagnosticoEjecutivo}
                      </div>

                      {aud.mejoraSugerida && (
                        <div
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: 8,
                            padding: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0369a1' }}>
                              💡 Mejora Sugerida para {aud.mejoraSugerida.agenteDestinoNombre}:{' '}
                              {aud.mejoraSugerida.titulo}
                            </span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ background: '#0284c7', borderColor: '#0284c7', fontSize: '0.75rem' }}
                              disabled={aplicandoMejoraId === aud.sesionId}
                              onClick={() =>
                                handleAplicarMejoraCxAAgente(
                                  aud.sesionId,
                                  aud.mejoraSugerida!.agenteDestinoId,
                                  aud.mejoraSugerida!.titulo
                                )
                              }
                            >
                              {aplicandoMejoraId === aud.sesionId
                                ? 'Inyectando en Agente...'
                                : '✨ Aplicar Mejora al Agente en 1 Clic'}
                            </button>
                          </div>
                          <textarea
                            className={styles.textarea}
                            rows={2}
                            style={{ fontSize: '0.77rem' }}
                            value={
                              reglasEditablesCx[aud.sesionId] ??
                              aud.mejoraSugerida.reglaNuevaParaInyectar
                            }
                            onChange={(e) =>
                              setReglasEditablesCx((prev) => ({
                                ...prev,
                                [aud.sesionId]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PANEL EN VIVO: CONFIGURAR LOS 6 AGENTES IA (GEMINI 4 NEON) + PROBAR COTIZACIÓN ── */}
      {mostrarConfigAgentes && (
        <div
          style={{
            background: '#ffffff',
            border: '2px solid #6366f1',
            borderRadius: 14,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Bloque 1: Prueba rápida a +56951387986 y vinculación Meta de +56950960294 */}
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, color: '#14532d', fontSize: '0.93rem' }}>
              🧪 1. Probar Envío de Solicitud de Cotización a tu WhatsApp Personal y Verificar Línea +56 9 5096 0294 en Meta
            </div>
            <div style={{ fontSize: '0.81rem', color: '#166534' }}>
              • Envía una solicitud natural de prueba a tu número personal (ej: <em>"Estimado, Necesito radiador para Jac S3 2019 1.6 patente LKWP42, compárteme por favor las opciones que tengas con stock disponible y precio."</em>). Si le respondes sin IVA, sin marca/origen o sin tiempo de retiro, el agente cotizador te repreguntará automáticamente.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className={styles.input}
                style={{ maxWidth: 200 }}
                value={telefonoPruebaPersonal}
                onChange={(e) => setTelefonoPruebaPersonal(e.target.value)}
                placeholder="+56951387986"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: '#16a34a', borderColor: '#16a34a' }}
                disabled={enviandoPruebaPersonal}
                onClick={handleEnviarPruebaAMiNumero}
              >
                {enviandoPruebaPersonal
                  ? 'Enviando por Meta...'
                  : `📲 Enviar Cotización de Prueba a ${telefonoPruebaPersonal}`}
              </button>

              <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: 8 }}>
                Phone Number ID de +56950960294:
              </span>
              <input
                className={styles.input}
                style={{ maxWidth: 200 }}
                value={phoneNumberIdMesaInput}
                onChange={(e) => setPhoneNumberIdMesaInput(e.target.value)}
                placeholder="Ej: 1492165227305531"
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleGuardarPhoneIdMesa}
              >
                🔄 Vincular / Auto-Detectar en Meta
              </button>
            </div>
          </div>

          {/* Bloque 2: Configuración en Caliente de los 6 Subagentes + Orquestador */}
          {configAgentes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.96rem' }}>
                    🧠 2. Cerebros, Modelo IA (Gemini 4 Neon) y Contexto en Vivo de los 6 Agentes de Repuestín
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                    Cualquier regla, instrucción o contexto nuevo que escribas aquí se aplica al instante en WhatsApp sin entrar a Cloud Run.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                    Modelo Global:
                  </label>
                  <select
                    className={styles.input}
                    value={configAgentes.modeloGlobalPreferido}
                    onChange={(e) =>
                      setConfigAgentes((prev) =>
                        prev ? { ...prev, modeloGlobalPreferido: e.target.value } : prev
                      )
                    }
                  >
                    {(configAgentes.modelosDisponibles || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>

                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                    Vigencia Producto Temporal (Horas):
                  </label>
                  <input
                    type="number"
                    className={styles.input}
                    style={{ width: 70 }}
                    value={configAgentes.ttlHorasProductoTemporal}
                    onChange={(e) =>
                      setConfigAgentes((prev) =>
                        prev ? { ...prev, ttlHorasProductoTemporal: Number(e.target.value) || 4 } : prev
                      )
                    }
                  />

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={guardandoConfigAgentes}
                    onClick={handleGuardarConfigAgentes}
                  >
                    {guardandoConfigAgentes ? 'Guardando...' : '💾 Guardar Cambios en Vivo'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
                  gap: 14,
                }}
              >
                {Object.values(configAgentes.agentes || {}).map((ag) => (
                  <div
                    key={ag.id}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{ag.nombre}</strong>
                      <select
                        className={styles.input}
                        style={{ fontSize: '0.75rem', padding: '3px 6px' }}
                        value={ag.modelo}
                        onChange={(e) =>
                          setConfigAgentes((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  agentes: {
                                    ...prev.agentes,
                                    [ag.id]: { ...ag, modelo: e.target.value },
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        {(configAgentes.modelosDisponibles || []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ fontSize: '0.79rem', color: '#475569' }}>{ag.rol}</div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e293b' }}>
                      📋 Base de Conocimiento e Instrucciones Operativas Completas del Agente:
                    </label>
                    <textarea
                      className={styles.textarea}
                      style={{
                        minHeight: 190,
                        fontSize: '0.78rem',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        lineHeight: 1.45,
                      }}
                      value={ag.instrucciones}
                      onChange={(e) =>
                        setConfigAgentes((prev) =>
                          prev
                            ? {
                                ...prev,
                                agentes: {
                                  ...prev.agentes,
                                  [ag.id]: { ...ag, instrucciones: e.target.value },
                                },
                              }
                            : prev
                        )
                      }
                    />
                    <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e293b' }}>
                      🗂️ Tablas de Datos / Tarifario / Diccionario y Contexto Adicional (Editable en Vivo):
                    </label>
                    <textarea
                      className={styles.textarea}
                      style={{
                        minHeight: 145,
                        fontSize: '0.78rem',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        lineHeight: 1.45,
                      }}
                      placeholder="Ej: Tarifario, diccionarios, reglas de nuevos proveedores..."
                      value={ag.contextoExtra}
                      onChange={(e) =>
                        setConfigAgentes((prev) =>
                          prev
                            ? {
                                ...prev,
                                agentes: {
                                  ...prev.agentes,
                                  [ag.id]: { ...ag, contextoExtra: e.target.value },
                                },
                              }
                            : prev
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4 INDICADORES OPERATIVOS REALES DE REPUESTÍN ────────── */}
      <div className={styles.pipelineBar}>
        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Conversaciones Activas (&lt; 24h)</span>
          <span className={styles.pipelineStepTitle}>
            📲 {kpis.totalActivas} en Bandeja WhatsApp
          </span>
          <span className={styles.pipelineStepDesc}>
            Estadística histórica acumulada: {estadisticasHistoricas.totalHistoricasWsp} atención(es)
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Vehículos Identificados</span>
          <span className={styles.pipelineStepTitle}>
            🚗 {kpis.conVehiculo} con Patente / Motor
          </span>
          <span className={styles.pipelineStepDesc}>
            Patente, marca, modelo y motor resueltos automáticamente.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Carros Cotizados</span>
          <span className={styles.pipelineStepTitle}>
            🛒 {kpis.carrosCount} Carro(s) · ${kpis.montoTotalCotizado.toLocaleString('es-CL')}
          </span>
          <span className={styles.pipelineStepDesc}>
            Links de productos enviados y carro unificado listo para compra.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Validando con Proveedores</span>
          <span className={styles.pipelineStepTitle}>
            🔎 {kpis.conBusquedaPendiente} Pendiente(s)
          </span>
          <span className={styles.pipelineStepDesc}>
            Repuestos sin stock inmediato en validación con proveedores internos.
          </span>
        </div>
      </div>

      {/* ── MODAL / PANEL NUEVA CONVERSACIÓN WHATSAPP ───────────── */}
      {mostrarNuevaSesion && (
        <form
          onSubmit={handleCrearSesion}
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 12,
            padding: 14,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Nombre del Cliente WhatsApp
            </label>
            <input
              className={styles.input}
              style={{ width: '100%' }}
              placeholder="Ej: Juan Pérez"
              value={formNuevaSesion.clienteNombre}
              onChange={(e) =>
                setFormNuevaSesion((p) => ({ ...p, clienteNombre: e.target.value }))
              }
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Teléfono WhatsApp
            </label>
            <input
              className={styles.input}
              placeholder="+569..."
              value={formNuevaSesion.clienteTelefono}
              onChange={(e) =>
                setFormNuevaSesion((p) => ({ ...p, clienteTelefono: e.target.value }))
              }
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Patente Inicial (Opcional)
            </label>
            <input
              className={styles.input}
              placeholder="Ej: RHYC28"
              value={formNuevaSesion.patenteInicial}
              onChange={(e) =>
                setFormNuevaSesion((p) => ({
                  ...p,
                  patenteInicial: e.target.value.toUpperCase(),
                }))
              }
            />
          </div>

          <button type="submit" className="btn btn-primary btn-sm">
            Iniciar Chat WSP
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setMostrarNuevaSesion(false)}
          >
            Cancelar
          </button>
        </form>
      )}

      {/* ── GRID PRINCIPAL DE 3 COLUMNAS ────────────────────────── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
          Cargando conversaciones de Repuestín WhatsApp...
        </div>
      ) : (
        <div className={styles.workspaceGrid}>
          {/* COLUMNA 1: BANDEJA DE CLIENTES WHATSAPP CON BOTÓN ✕ */}
          <div className={styles.sessionsPanel}>
            <div className={styles.panelHeader}>
              <span>📲 WhatsApp Activos ({sesionesFiltradas.length})</span>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                Auto-limpieza 24h
              </span>
            </div>

            <div className={styles.sessionFiltersBox}>
              <input
                className={styles.sessionSearchInput}
                placeholder="Buscar por nombre, patente o +569..."
                value={busquedaCliente}
                onChange={(e) => setBusquedaCliente(e.target.value)}
              />
              <div className={styles.filterPillsRow}>
                <button
                  type="button"
                  className={`${styles.filterPill} ${
                    filtroBandeja === 'todas' ? styles.filterPillActive : ''
                  }`}
                  onClick={() => setFiltroBandeja('todas')}
                >
                  Todas ({sesiones.length})
                </button>
                <button
                  type="button"
                  className={`${styles.filterPill} ${
                    filtroBandeja === 'con_carro' ? styles.filterPillActive : ''
                  }`}
                  onClick={() => setFiltroBandeja('con_carro')}
                >
                  🛒 Con Carro ({kpis.carrosCount})
                </button>
                <button
                  type="button"
                  className={`${styles.filterPill} ${
                    filtroBandeja === 'busqueda_wsp' ? styles.filterPillActive : ''
                  }`}
                  onClick={() => setFiltroBandeja('busqueda_wsp')}
                >
                  🔎 Validando ({kpis.conBusquedaPendiente})
                </button>
              </div>
            </div>

            <div className={styles.sessionListScroll}>
              {sesionesFiltradas.map((ses) => {
                const activa = sesionActiva?.id === ses.id;
                const cantCarro = ses.carritoCotizado?.length || 0;
                const montoCarro = (ses.carritoCotizado || []).reduce(
                  (acc, it) => acc + Number(it.precioVentaConIva || 0) * Number(it.cantidad || 1),
                  0
                );
                const cantBusqueda = ses.solicitudesWspAbiertas?.length || 0;
                const ultimoMsg =
                  ses.mensajes && ses.mensajes.length > 0
                    ? ses.mensajes[ses.mensajes.length - 1]
                    : null;

                return (
                  <div
                    key={ses.id}
                    className={`${styles.sessionItem} ${activa ? styles.sessionItemActive : ''}`}
                    onClick={() => setSesionActivaId(ses.id)}
                  >
                    <div className={styles.sessionTop}>
                      <span className={styles.sessionName}>{ses.clienteNombre}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={styles.canalBadgeWsp}>📲 WSP</span>
                        <button
                          type="button"
                          className={styles.closeSessionBtn}
                          title="Quitar de la lista activa (pasa a estadística)"
                          onClick={(e) => handleArchivarSesion(e, ses.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {ses.clienteTelefono && (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 3 }}>
                        {ses.clienteTelefono}
                        {ultimoMsg?.creadoEn && (
                          <span style={{ float: 'right' }}>
                            {new Date(ultimoMsg.creadoEn).toLocaleTimeString('es-CL', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    )}

                    {ses.vehiculoContexto ? (
                      <div className={styles.sessionVehicle}>
                        🚗 {ses.vehiculoContexto.patente ? `[${ses.vehiculoContexto.patente}] ` : ''}
                        {ses.vehiculoContexto.marca} {ses.vehiculoContexto.modelo}{' '}
                        {ses.vehiculoContexto.anio || ''}
                      </div>
                    ) : (
                      <div className={styles.sessionVehicle} style={{ color: '#94a3b8' }}>
                        Esperando patente o modelo...
                      </div>
                    )}

                    {(cantCarro > 0 || cantBusqueda > 0) && (
                      <div className={styles.sessionBadgesRow}>
                        {cantCarro > 0 && (
                          <span className={styles.miniBadgeCart}>
                            🛒 {cantCarro} prod. · ${montoCarro.toLocaleString('es-CL')}
                          </span>
                        )}
                        {cantBusqueda > 0 && (
                          <span className={styles.miniBadgeSearch}>
                            🔎 Validando proveedor
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {sesionesFiltradas.length === 0 && (
                <div style={{ padding: 28, textAlign: 'center', fontSize: '0.82rem', color: '#64748b' }}>
                  No hay conversaciones activas en las últimas 24 horas.
                  <div style={{ fontSize: '0.75rem', marginTop: 6, color: '#94a3b8' }}>
                    Cuando un cliente escriba al WhatsApp <strong>+56 9 2110 9851</strong> o inicies una conversación con el botón superior, aparecerá aquí automáticamente.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* COLUMNA 2: CONVERSACIÓN EN VIVO CON EL CLIENTE */}
          <div className={styles.chatPanel}>
            {!sesionActiva ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 40,
                  textAlign: 'center',
                  color: '#64748b',
                }}
              >
                <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>📲</div>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem', marginBottom: 6 }}>
                  Bandeja de Repuestín WhatsApp Limpia
                </div>
                <div style={{ maxWidth: 420, fontSize: '0.84rem', lineHeight: 1.5, marginBottom: 16 }}>
                  Escribe desde tu celular al WhatsApp Oficial <strong>+56 9 2110 9851</strong> o presiona{' '}
                  <strong>"+ Nueva Conversación WSP"</strong> para probar una consulta.
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setMostrarNuevaSesion(true)}
                >
                  + Iniciar Conversación de Prueba
                </button>
              </div>
            ) : (
              <>
                <div className={styles.vehiculoBanner}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {sesionActiva.vehiculoContexto?.patente && (
                      <span className={styles.patentePlate}>
                        {sesionActiva.vehiculoContexto.patente}
                      </span>
                    )}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>
                        {sesionActiva.vehiculoContexto
                          ? `${sesionActiva.vehiculoContexto.marca} ${
                              sesionActiva.vehiculoContexto.modelo || ''
                            } ${sesionActiva.vehiculoContexto.anio || ''}`
                          : sesionActiva.clienteNombre}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        👤 {sesionActiva.clienteNombre} · {sesionActiva.clienteTelefono || 'WhatsApp'}
                        {sesionActiva.vehiculoContexto?.motor
                          ? ` · ⚙️ Motor ${sesionActiva.vehiculoContexto.motor}`
                          : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {sesionActiva.clienteTelefono && (
                      <a
                        href={`https://wa.me/${sesionActiva.clienteTelefono.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm"
                        style={{
                          background: 'rgba(37, 211, 102, 0.18)',
                          color: '#4ade80',
                          border: '1px solid rgba(74, 222, 128, 0.4)',
                          fontSize: '0.74rem',
                          textDecoration: 'none',
                        }}
                      >
                        📲 Abrir en WhatsApp
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(255,255,255,0.1)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(255,255,255,0.2)',
                        fontSize: '0.74rem',
                      }}
                      onClick={(e) => handleArchivarSesion(e, sesionActiva.id)}
                    >
                      ✕ Quitar de bandeja
                    </button>
                  </div>
                </div>

                <div className={styles.messagesArea}>
                  {(sesionActiva.mensajes || []).map((msg) => (
                    <div
                      key={msg.id}
                      className={
                        msg.autor === 'cliente' ? styles.msgRowCliente : styles.msgRowAgente
                      }
                    >
                      <div className={styles.msgSender}>
                        <span>
                          {msg.autor === 'cliente'
                            ? `👤 ${sesionActiva.clienteNombre}`
                            : '🤖 Repuestín · facilrepuestos.cl'}
                        </span>
                        <span>
                          {new Date(msg.creadoEn).toLocaleTimeString('es-CL', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className={styles.msgText}>{renderizarTextoMensaje(msg.texto)}</div>

                      {msg.transcripcionAudio && (
                        <div
                          style={{
                            marginTop: 7,
                            paddingTop: 6,
                            borderTop: '1px dashed rgba(0,0,0,0.15)',
                            fontSize: '0.78rem',
                          }}
                        >
                          🎙️ <strong>Audio transcrito:</strong> "{msg.transcripcionAudio}"
                        </div>
                      )}

                      {msg.fotoUrl && (
                        <div style={{ marginTop: 8 }}>
                          <img
                            src={msg.fotoUrl}
                            alt="Foto enviada por cliente"
                            style={{
                              maxHeight: 120,
                              borderRadius: 8,
                              border: '1px solid #cbd5e1',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* COMPOSER CON ESPERA DE 5 SEGUNDOS */}
                <div className={styles.composerArea}>
                  {mensajesEnBuffer.length > 0 && (
                    <div
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #93c5fd',
                        borderRadius: 8,
                        padding: '8px 12px',
                        fontSize: '0.8rem',
                        color: '#1e3a8a',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span>
                        ⏳ <strong>Esperando 5s desde el último mensaje ({mensajesEnBuffer.length} acumulado(s)):</strong>{' '}
                        "{mensajesEnBuffer.join(' · ')}" — Se procesarán juntos en{' '}
                        <strong>{segundosRestantesBuffer}s</strong>.
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <textarea
                      className={styles.textarea}
                      style={{ flex: 1 }}
                      placeholder="Escribe un mensaje (si envías varios seguidos, Repuestín espera 5 segundos desde el último y los une en una sola solicitud)..."
                      value={textoMensaje}
                      onChange={(e) => setTextoMensaje(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void enviarConsultaCascada();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={enviandoMensaje}
                      onClick={() => enviarConsultaCascada()}
                    >
                      {enviandoMensaje
                        ? 'Procesando...'
                        : mensajesEnBuffer.length > 0
                          ? `Sumar (${segundosRestantesBuffer}s) →`
                          : 'Enviar →'}
                    </button>
                  </div>

                  <div className={styles.composerTopRow}>
                    <button
                      type="button"
                      className={styles.subtleToggleBtn}
                      onClick={() => setMostrarOpcionesPrueba((v) => !v)}
                    >
                      {mostrarOpcionesPrueba
                        ? '▴ Ocultar opciones adicionales'
                        : '▾ Opciones adicionales (Patente / Audio / Foto)'}
                    </button>
                  </div>

                  {mostrarOpcionesPrueba && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <select
                        className={styles.input}
                        value={patenteInput}
                        onChange={(e) => setPatenteInput(e.target.value)}
                      >
                        <option value="">🚗 Patente rápida (Opcional)</option>
                        {padronDemo.map((v) => (
                          <option key={v.patente} value={v.patente}>
                            {v.patente} — {v.marca} {v.modelo} {v.anio}
                          </option>
                        ))}
                      </select>
                      <input
                        className={styles.input}
                        placeholder="🎙️ Transcripción de audio..."
                        value={transcripcionAudio}
                        onChange={(e) => setTranscripcionAudio(e.target.value)}
                      />
                      <input
                        className={styles.input}
                        placeholder="📷 URL de foto..."
                        value={fotoUrl}
                        onChange={(e) => setFotoUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* COLUMNA 3: FICHA COMERCIAL DEL CLIENTE, CARRO WEB Y PROMESA DE RETIRO/DELIVERY */}
          <div className={styles.tracePanel}>
            <div className={styles.panelHeader}>
              <span>📋 Ficha Comercial & Carro</span>
              {carritoSesionActiva.length > 0 && (
                <span className={styles.actionBadgeDirecta}>
                  🛒 {carritoSesionActiva.length} PROD.
                </span>
              )}
            </div>

            {!sesionActiva ? (
              <div style={{ padding: 24, fontSize: '0.82rem', color: '#64748b' }}>
                Selecciona una conversación activa para ver su vehículo, promesa de retiro/delivery y productos cotizados.
              </div>
            ) : (
              <div className={styles.traceBody}>
                {/* 1. VEHÍCULO IDENTIFICADO */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🚗 Vehículo del Cliente</span>
                    <span style={{ fontSize: '0.7rem', color: '#0f766e' }}>
                      {sesionActiva.vehiculoContexto?.fuente || 'Padrón'}
                    </span>
                  </div>
                  {sesionActiva.vehiculoContexto ? (
                    <div style={{ fontSize: '0.83rem', color: '#0f172a', fontWeight: 700 }}>
                      {sesionActiva.vehiculoContexto.patente && (
                        <code
                          style={{
                            marginRight: 6,
                            background: '#fef08a',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid #ca8a04',
                          }}
                        >
                          {sesionActiva.vehiculoContexto.patente}
                        </code>
                      )}
                      {sesionActiva.vehiculoContexto.marca}{' '}
                      {sesionActiva.vehiculoContexto.modelo || ''}{' '}
                      {sesionActiva.vehiculoContexto.anio || ''}
                      {sesionActiva.vehiculoContexto.motor && (
                        <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: 4 }}>
                          ⚙️ Motor: <strong>{sesionActiva.vehiculoContexto.motor}</strong>
                          {sesionActiva.vehiculoContexto.vin
                            ? ` · VIN: ${sesionActiva.vehiculoContexto.vin}`
                            : ''}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.79rem', color: '#64748b' }}>
                      Aún sin patente ni modelo identificado.
                    </div>
                  )}
                </div>

                {/* 2. PROMESA DE RETIRO Y DESPACHO ACTIVA PARA ESTA SESIÓN */}
                <div
                  className={styles.traceSection}
                  style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}
                >
                  <div className={styles.traceSectionTitle} style={{ color: '#166534' }}>
                    <span>📍 Retiro & Delivery</span>
                    <span>{infoLogisticaActiva.horaChile} hrs</span>
                  </div>
                  <div style={{ fontSize: '0.79rem', color: '#14532d', marginBottom: 6 }}>
                    <strong>Retiro Enrique Olivares 224:</strong>{' '}
                    {infoLogisticaActiva.reglaRetiroTitulo}
                    <div style={{ fontSize: '0.73rem', color: '#15803d', marginTop: 2 }}>
                      {infoLogisticaActiva.reglaRetiroDetalle}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: '#14532d',
                      paddingTop: 6,
                      borderTop: '1px dashed #86efac',
                    }}
                  >
                    <strong>🚚 Delivery Santiago:</strong>{' '}
                    {infoLogisticaActiva.reglaDeliveryTitulo}
                    <div style={{ fontSize: '0.73rem', color: '#15803d', marginTop: 2 }}>
                      {infoLogisticaActiva.reglaDeliveryDetalle}
                    </div>
                  </div>
                </div>

                {/* 3. PRODUCTOS COTIZADOS Y CARRO CONSOLIDADO */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🛒 Productos Cotizados</span>
                    <span>{carritoSesionActiva.length} ítem(s)</span>
                  </div>

                  {carritoSesionActiva.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Sin productos cotizados aún en esta conversación.
                    </div>
                  ) : (
                    <>
                      {carritoSesionActiva.map((c) => {
                        const esSol =
                          c.origen === 'soluparts_ailoo' ||
                          String(c.skuPublicoFrp || '').startsWith('FRP-SOL-');
                        const etiquetaRetiroItem = esSol
                          ? 'Soluparts → Retiro desde 15:30 hrs (compras antes de 11:30 hrs)'
                          : c.origen === 'stock_propio'
                            ? 'Stock Propio → Retiro y Pago Inmediato'
                            : 'Despacho según dimensión en Santiago y Chile';

                        return (
                          <div key={c.id || c.skuPublicoFrp} className={styles.candCard}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontWeight: 800,
                                color: '#0f172a',
                              }}
                            >
                              <span>{c.skuPublicoFrp}</span>
                              <span style={{ color: '#047857' }}>Stock: {c.stock} un.</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, margin: '3px 0' }}>
                              {c.nombre}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#475569' }}>
                              Bodega interna: <strong>{c.proveedorNombre}</strong>
                            </div>
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: '#0369a1',
                                fontWeight: 700,
                                marginTop: 2,
                              }}
                            >
                              ⏱️ {etiquetaRetiroItem}
                            </div>
                            <div
                              style={{
                                marginTop: 6,
                                paddingTop: 5,
                                borderTop: '1px dashed #cbd5e1',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '0.75rem',
                              }}
                            >
                              <span style={{ color: '#64748b' }}>
                                Costo: ${Number(c.precioCostoProveedor || 0).toLocaleString('es-CL')}
                              </span>
                              <strong style={{ color: '#0f766e', fontSize: '0.82rem' }}>
                                ${Number(c.precioVentaConIva || 0).toLocaleString('es-CL')} IVA inc.
                              </strong>
                            </div>
                            {c.urlProductoWoo && (
                              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                                <a
                                  href={c.urlProductoWoo}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.miniActionLink}
                                >
                                  🔎 Ver en Web ↗
                                </a>
                                <button
                                  type="button"
                                  className={styles.miniCopyBtn}
                                  onClick={() =>
                                    copiarAlPortapapeles(c.urlProductoWoo!, 'Link del producto')
                                  }
                                >
                                  📋 Copiar
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div
                        style={{
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 8,
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontWeight: 800,
                            fontSize: '0.84rem',
                            color: '#1e3a8a',
                            marginBottom: 6,
                          }}
                        >
                          <span>Total Carro Disponible:</span>
                          <span>${totalCarritoActivo.toLocaleString('es-CL')} IVA inc.</span>
                        </div>
                        {urlCarroUnificado && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <a
                              href={urlCarroUnificado}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-primary btn-sm"
                              style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                            >
                              🛒 Abrir Carro ↗
                            </a>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() =>
                                copiarAlPortapapeles(urlCarroUnificado, 'Link del carro unificado')
                              }
                            >
                              📋 Copiar
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 4. REPUESTOS EN VALIDACIÓN CON PROVEEDORES INTERNOS */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🔎 Validando con Proveedores</span>
                    <span>{(sesionActiva.solicitudesWspAbiertas || []).length}</span>
                  </div>
                  {(sesionActiva.solicitudesWspAbiertas || []).length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Sin piezas pendientes de búsqueda para este cliente.
                    </div>
                  ) : (
                    (sesionActiva.solicitudesWspAbiertas || []).map((sol) => (
                      <div
                        key={sol.id || sol.codigoSolicitud}
                        className={styles.candCard}
                        style={{ background: '#f5f3ff', borderColor: '#ddd6fe' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontWeight: 800,
                            color: '#5b21b6',
                          }}
                        >
                          <span>#{sol.codigoSolicitud}</span>
                          <span>Validando</span>
                        </div>
                        {sol.resumenRepuesto && (
                          <div style={{ fontSize: '0.79rem', fontWeight: 700, marginTop: 3 }}>
                            {sol.resumenRepuesto}
                          </div>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          style={{ width: '100%', marginTop: 8 }}
                          onClick={() => navigate('/mesa-wsp')}
                        >
                          📲 Ver Proveedores Internos →
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
