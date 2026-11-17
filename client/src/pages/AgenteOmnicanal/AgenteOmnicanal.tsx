import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  CandidatoInventarioCascada,
  SesionAgenteOmnicanal,
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
  const antesDeLas12 = minutosDia < 12 * 60;
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
      origen === 'global_ailoo' ||
      origen === 'mesa_whatsapp' ||
      sku.startsWith('FRP-GLB-') ||
      sku.startsWith('FRP-WSP-')
    ) {
      tienePortalProveedor = true;
    } else {
      tieneStockPropio = true;
    }
  }

  let reglaRetiroTitulo = 'Según origen del repuesto';
  let reglaRetiroDetalle =
    'Stock propio: Inmediato · Portal proveedor: 1h 30m · Soluparts: 15:00 hrs (compras antes de las 12:00 mismo día; después de las 12:00 al día siguiente a las 15:00 hrs).';

  if (tieneSoluparts) {
    reglaRetiroTitulo =
      esLunesAViernes && antesDeLas12
        ? 'Retiro HOY desde las 15:00 hrs (3:00 PM)'
        : 'Retiro desde las 15:00 hrs (3:00 PM) del día siguiente';
    reglaRetiroDetalle =
      esLunesAViernes && antesDeLas12
        ? 'Incluye repuesto Soluparts comprado antes de las 12:00 hrs → Disponible hoy a las 3:00 de la tarde en Enrique Olivares 224.'
        : 'Incluye repuesto Soluparts después de las 12:00 hrs (hasta las 12:00 del día siguiente) → Disponible desde las 3:00 de la tarde en Enrique Olivares 224.';
  } else if (tienePortalProveedor) {
    reglaRetiroTitulo = 'Retiro en 1 hora 30 minutos (1h 30m)';
    reglaRetiroDetalle =
      'Repuesto de portal proveedor asociado → Listo para retiro en 1h 30m en Enrique Olivares 224, La Florida.';
  } else if (tieneStockPropio && carrito.length > 0) {
    reglaRetiroTitulo = 'Retiro Inmediato / Automático';
    reglaRetiroDetalle =
      '100% en nuestro stock directo en tienda → Retiro inmediato en Enrique Olivares 224, La Florida.';
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
        if (seleccionarId) {
          setSesionActivaId(seleccionarId);
        } else if (!sesionActivaId && lista.length > 0) {
          setSesionActivaId(lista[0].id);
        } else if (lista.length === 0) {
          setSesionActivaId('');
        }
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
    // Auto-refresco silencioso cada 8 segundos para ver en vivo los mensajes entrantes de WhatsApp
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
                          ? 'Soluparts → Retiro 15:00 hrs (corte 12:00)'
                          : c.origen === 'stock_propio'
                            ? 'Stock Propio → Retiro Inmediato'
                            : 'Portal Proveedor → Retiro en 1h 30m';

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
