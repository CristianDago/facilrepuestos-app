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

interface RespuestaListadoSesiones {
  sesiones: SesionAgenteOmnicanal[];
  padronDemoPatentes: VehiculoDetectadoAgente[];
}

type FiltroBandeja = 'todas' | 'wsp' | 'con_carro' | 'busqueda_wsp';

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

    // Procesar **negrita** o *negrita*
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
    canal: 'whatsapp_cliente' as 'whatsapp_cliente' | 'web_cliente',
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
        setPadronDemo(res.data.padronDemoPatentes || []);
        if (seleccionarId) {
          setSesionActivaId(seleccionarId);
        } else if (!sesionActivaId && lista.length > 0) {
          // Priorizar la primera sesión real de WhatsApp si existe
          const primeraWspReal = lista.find(
            (s) => s.id.startsWith('wsp_') || s.canal === 'whatsapp_meta_cloud'
          );
          setSesionActivaId((primeraWspReal || lista[0]).id);
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

  // Filtrado de sesiones en la columna izquierda
  const sesionesFiltradas = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    return sesiones.filter((s) => {
      const esWsp =
        s.canal === 'whatsapp_cliente' ||
        s.canal === 'whatsapp_meta_cloud' ||
        s.id.startsWith('wsp_');
      const tieneCarro = (s.carritoCotizado?.length || 0) > 0;
      const tieneBusqueda = (s.solicitudesWspAbiertas?.length || 0) > 0;

      if (filtroBandeja === 'wsp' && !esWsp) return false;
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

  // Construir link de carro unificado hacia facilrepuestos.cl para los productos con stock
  const urlCarroUnificado = useMemo(() => {
    if (carritoSesionActiva.length === 0) return '';
    const primerUrl = carritoSesionActiva[0]?.urlAgregarAlCarroWoo || carritoSesionActiva[0]?.urlProductoWoo || '';
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

  // KPIs operativos reales de todas las sesiones
  const kpis = useMemo(() => {
    const totalClientes = sesiones.length;
    const clientesWspReales = sesiones.filter(
      (s) => s.id.startsWith('wsp_') || s.canal === 'whatsapp_meta_cloud'
    ).length;
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
      totalClientes,
      clientesWspReales,
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
        notify(`Conversación creada con ${res.data.clienteNombre}`, 'success');
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
      {/* ── ENCABEZADO COMERCIAL REPUESTÍN WHATSAPP ─────────────── */}
      <div className={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <img
              src="/logo-facil-repuestos.webp"
              alt="Fácil Repuestos"
              style={{ height: 32, width: 'auto', objectFit: 'contain' }}
            />
            <h1 className={styles.title} style={{ margin: 0 }}>
              🤖 Repuestín WhatsApp — Cotizador & CRM en Vivo
            </h1>
          </div>
          <p className={styles.subtitle}>
            Atención automática en <strong>+56 9 2110 9851</strong> conectada al catálogo de{' '}
            <strong>facilrepuestos.cl</strong>. Espera <strong>5 segundos</strong> desde el último mensaje para unir
            solicitudes múltiples, envía el <strong>link de cada producto</strong>, arma un{' '}
            <strong>solo carro de compra</strong> con lo disponible y deja en búsqueda lo que falte sin frenar la venta.
          </p>

          <div className={styles.rulesStrip}>
            <span className={styles.rulePill}>⏱️ Agrupación: 5s tras último mensaje</span>
            <span className={styles.rulePill}>
              📍 Retiro Enrique Olivares 224: Stock Inmediato · Portal 1h 30m · Soluparts 15:00 hrs (corte 12:00)
            </span>
            <span className={styles.rulePill}>
              🚚 Delivery Santiago: 2 hrs (L-V 09:00 a 18:00 · compras tras 16:00 al día siguiente)
            </span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={() => cargarSesiones(sesionActiva?.id, false)}
            disabled={refreshing}
          >
            {refreshing ? '↻ Actualizando...' : '↻ Actualizar'}
          </button>
          <a
            href="https://wa.me/56921109851"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{
              background: '#25D366',
              color: '#052e16',
              fontWeight: 800,
              border: 'none',
              textDecoration: 'none',
            }}
          >
            📲 WhatsApp Oficial (+56 9 2110 9851)
          </a>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={() => navigate('/mesa-wsp')}
          >
            📲 Mesa Abastecimiento WSP ({kpis.conBusquedaPendiente})
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={() => setMostrarNuevaSesion((v) => !v)}
          >
            + Nueva Conversación
          </button>
        </div>
      </div>

      {/* ── 4 INDICADORES OPERATIVOS REALES DE REPUESTÍN ────────── */}
      <div className={styles.pipelineBar}>
        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Conversaciones Activas</span>
          <span className={styles.pipelineStepTitle}>
            💬 {kpis.totalClientes} Clientes ({kpis.clientesWspReales} en WhatsApp Oficial)
          </span>
          <span className={styles.pipelineStepDesc}>
            Sincronización automática en tiempo real con el webhook de Meta Cloud API.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Identificación de Vehículos</span>
          <span className={styles.pipelineStepTitle}>
            🚗 {kpis.conVehiculo} Vehículos con Patente / Motor
          </span>
          <span className={styles.pipelineStepDesc}>
            Detecta patente chilena, marca, modelo, año y motor dentro de la conversación.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Carros Listos para Compra</span>
          <span className={styles.pipelineStepTitle}>
            🛒 {kpis.carrosCount} Carro(s) · ${kpis.montoTotalCotizado.toLocaleString('es-CL')} IVA inc.
          </span>
          <span className={styles.pipelineStepDesc}>
            Cada producto envía su link web y al confirmar se arma un solo carro en facilrepuestos.cl.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Piezas Faltantes en Búsqueda</span>
          <span className={styles.pipelineStepTitle}>
            🔎 {kpis.conBusquedaPendiente} Solicitud(es) en Mesa WSP
          </span>
          <span className={styles.pipelineStepDesc}>
            No detiene la venta de lo que está en stock: vende lo disponible y avisa cuando aparece el faltante.
          </span>
        </div>
      </div>

      {/* ── MODAL / PANEL NUEVA CONVERSACIÓN ────────────────────── */}
      {mostrarNuevaSesion && (
        <form
          onSubmit={handleCrearSesion}
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Nombre del Cliente o Taller
            </label>
            <input
              className={styles.input}
              style={{ width: '100%' }}
              placeholder="Ej: Juan Pérez / Taller San José"
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
              placeholder="Ej: RHYC28 o KDSH15"
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
            Crear Conversación
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
          {/* COLUMNA 1: BANDEJA DE CLIENTES CON BUSCADOR Y FILTROS */}
          <div className={styles.sessionsPanel}>
            <div className={styles.panelHeader}>
              <span>💬 Conversaciones ({sesionesFiltradas.length})</span>
              <span style={{ fontSize: '0.72rem', color: '#0d9488', fontWeight: 700 }}>
                ● En Vivo
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
                  🔎 Buscando ({kpis.conBusquedaPendiente})
                </button>
              </div>
            </div>

            <div className={styles.sessionListScroll}>
              {sesionesFiltradas.map((ses) => {
                const activa = sesionActiva?.id === ses.id;
                const esWsp =
                  ses.canal === 'whatsapp_cliente' ||
                  ses.canal === 'whatsapp_meta_cloud' ||
                  ses.id.startsWith('wsp_');
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
                      <span className={esWsp ? styles.canalBadgeWsp : styles.canalBadgeWeb}>
                        {esWsp ? '📲 WSP' : '🌐 WEB'}
                      </span>
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
                            🔎 {cantBusqueda} en búsqueda
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {sesionesFiltradas.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', fontSize: '0.82rem', color: '#64748b' }}>
                  No hay conversaciones que coincidan con el filtro seleccionado.
                </div>
              )}
            </div>
          </div>

          {/* COLUMNA 2: CONVERSACIÓN EN VIVO CON EL CLIENTE */}
          {sesionActiva && (
            <div className={styles.chatPanel}>
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
                      👤 {sesionActiva.clienteNombre} · {sesionActiva.clienteTelefono || 'Sin teléfono'}
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
                      📲 Abrir Chat Directo
                    </a>
                  )}
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

              {/* COMPOSER PARA SIMULAR O PROBAR EN LA CONVERSACIÓN */}
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
                    placeholder="Escribe aquí para probar a Repuestín en esta conversación (si envías varios mensajes seguidos, espera 5 segundos desde el último y los une en una sola solicitud)..."
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
                      ? '▴ Ocultar herramientas de simulación (Patente / Audio / Foto)'
                      : '▾ Herramientas de simulación opcionales (Inyectar Patente, Audio o Foto)'}
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
                      placeholder="🎙️ Simular transcripción de audio..."
                      value={transcripcionAudio}
                      onChange={(e) => setTranscripcionAudio(e.target.value)}
                    />
                    <input
                      className={styles.input}
                      placeholder="📷 URL de foto de muestra..."
                      value={fotoUrl}
                      onChange={(e) => setFotoUrl(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COLUMNA 3: FICHA COMERCIAL DEL CLIENTE, CARRO WEB Y PROMESA DE RETIRO/DELIVERY */}
          <div className={styles.tracePanel}>
            <div className={styles.panelHeader}>
              <span>📋 Ficha Comercial & Carro del Cliente</span>
              {carritoSesionActiva.length > 0 && (
                <span className={styles.actionBadgeDirecta}>
                  🛒 {carritoSesionActiva.length} PROD.
                </span>
              )}
            </div>

            {!sesionActiva ? (
              <div style={{ padding: 24, fontSize: '0.84rem', color: '#64748b' }}>
                Selecciona una conversación a la izquierda para revisar su vehículo, productos cotizados y promesa de entrega.
              </div>
            ) : (
              <div className={styles.traceBody}>
                {/* 1. VEHÍCULO IDENTIFICADO */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🚗 Vehículo del Cliente</span>
                    <span style={{ fontSize: '0.7rem', color: '#0f766e' }}>
                      {sesionActiva.vehiculoContexto?.fuente || 'Padrón Automático'}
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
                      El cliente aún no ha indicado patente ni modelo del vehículo.
                    </div>
                  )}
                </div>

                {/* 2. PROMESA DE RETIRO Y DESPACHO ACTIVA PARA ESTA SESIÓN */}
                <div
                  className={styles.traceSection}
                  style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}
                >
                  <div className={styles.traceSectionTitle} style={{ color: '#166534' }}>
                    <span>📍 Promesa de Retiro & Delivery</span>
                    <span>Hora Chile {infoLogisticaActiva.horaChile}</span>
                  </div>
                  <div style={{ fontSize: '0.79rem', color: '#14532d', marginBottom: 6 }}>
                    <strong>Retiro en Enrique Olivares 224:</strong>{' '}
                    {infoLogisticaActiva.reglaRetiroTitulo}
                    <div style={{ fontSize: '0.74rem', color: '#15803d', marginTop: 2 }}>
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
                    <strong>🚚 Delivery todo Santiago:</strong>{' '}
                    {infoLogisticaActiva.reglaDeliveryTitulo}
                    <div style={{ fontSize: '0.73rem', color: '#15803d', marginTop: 2 }}>
                      {infoLogisticaActiva.reglaDeliveryDetalle}
                    </div>
                  </div>
                </div>

                {/* 3. PRODUCTOS COTIZADOS Y CARRO CONSOLIDADO EN FACILREPUESTOS.CL */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🛒 Productos Cotizados & Carro Web</span>
                    <span>{carritoSesionActiva.length} ítem(s)</span>
                  </div>

                  {carritoSesionActiva.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Aún no hay productos cotizados en el carro de este cliente.
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
                                  🔎 Ver Producto en Web ↗
                                </a>
                                <button
                                  type="button"
                                  className={styles.miniCopyBtn}
                                  onClick={() =>
                                    copiarAlPortapapeles(c.urlProductoWoo!, 'Link del producto')
                                  }
                                >
                                  📋 Copiar Link
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Resumen del Carro Consolidado */}
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
                              🛒 Abrir Carro Web ↗
                            </a>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() =>
                                copiarAlPortapapeles(urlCarroUnificado, 'Link del carro unificado')
                              }
                            >
                              📋 Copiar Carro
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 4. BÚSQUEDAS DE REPUESTOS FALTANTES EN MESA WSP (SIN FRENAR LA VENTA) */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>🔎 Repuestos Faltantes en Búsqueda</span>
                    <span>{(sesionActiva.solicitudesWspAbiertas || []).length} activa(s)</span>
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
                          <span>Solicitud #{sol.codigoSolicitud}</span>
                          <span>En búsqueda</span>
                        </div>
                        {sol.resumenRepuesto && (
                          <div style={{ fontSize: '0.79rem', fontWeight: 700, marginTop: 3 }}>
                            Pieza buscada: {sol.resumenRepuesto}
                          </div>
                        )}
                        <div style={{ fontSize: '0.73rem', color: '#4c1d95', marginTop: 3 }}>
                          Consultado a: {sol.proveedoresContactados.join(', ')}
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          style={{ width: '100%', marginTop: 8 }}
                          onClick={() => navigate('/mesa-wsp')}
                        >
                          📲 Ver / Adjudicar en Mesa WSP →
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
