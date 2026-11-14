import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  SesionAgenteOmnicanal,
  TrazaCascadaAgente,
  VehiculoDetectadoAgente,
} from '../../types';
import styles from './AgenteOmnicanal.module.css';

interface RespuestaListadoSesiones {
  sesiones: SesionAgenteOmnicanal[];
  padronDemoPatentes: VehiculoDetectadoAgente[];
}

export default function AgenteOmnicanal() {
  const { notify } = useAppStore();
  const navigate = useNavigate();

  const [sesiones, setSesiones] = useState<SesionAgenteOmnicanal[]>([]);
  const [padronDemo, setPadronDemo] = useState<VehiculoDetectadoAgente[]>([]);
  const [sesionActivaId, setSesionActivaId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [enviandoMensaje, setEnviandoMensaje] = useState(false);

  // Composer del mensaje de cliente
  const [textoMensaje, setTextoMensaje] = useState('');
  const [transcripcionAudio, setTranscripcionAudio] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [patenteInput, setPatenteInput] = useState('');
  const [modoForzado, setModoForzado] = useState<
    'auto' | 'forzar_escalamiento' | 'forzar_mesa_wsp'
  >('auto');
  const [mostrarAdjuntos, setMostrarAdjuntos] = useState(false);

  // Modal nueva conversación
  const [mostrarNuevaSesion, setMostrarNuevaSesion] = useState(false);
  const [formNuevaSesion, setFormNuevaSesion] = useState({
    canal: 'whatsapp_cliente' as 'whatsapp_cliente' | 'web_cliente',
    clienteNombre: 'Taller Mecánico Los Leones',
    clienteTelefono: '+56976543210',
    patenteInicial: 'LRTB19',
  });

  const cargarSesiones = async (seleccionarId?: string) => {
    try {
      setLoading(true);
      const res = await api.get<ApiResponse<RespuestaListadoSesiones>>(
        '/agente-omnicanal/sesiones'
      );
      if (res.success && res.data) {
        setSesiones(res.data.sesiones || []);
        setPadronDemo(res.data.padronDemoPatentes || []);
        if (seleccionarId) {
          setSesionActivaId(seleccionarId);
        } else if (!sesionActivaId && res.data.sesiones.length > 0) {
          setSesionActivaId(res.data.sesiones[0].id);
        }
      }
    } catch (err) {
      notify((err as Error).message || 'Error al cargar sesiones del Agente Omnicanal', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarSesiones();
  }, []);

  const sesionActiva = useMemo(
    () => sesiones.find((s) => s.id === sesionActivaId) || sesiones[0] || null,
    [sesiones, sesionActivaId]
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

  const handleCrearSesion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<ApiResponse<SesionAgenteOmnicanal>>(
        '/agente-omnicanal/sesiones',
        formNuevaSesion
      );
      if (res.success && res.data) {
        notify(` Conversación iniciada con ${res.data.clienteNombre}`, 'success');
        setMostrarNuevaSesion(false);
        await cargarSesiones(res.data.id);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al crear sesión', 'error');
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
      modoForzado,
    };

    if (!payload.texto.trim() && !(payload.transcripcionAudio || '').trim()) {
      notify('Escribe un mensaje del cliente o selecciona un escenario de prueba', 'error');
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
        const traza = res.data.trazaCascada;
        setSesiones((prev) =>
          prev.map((s) => (s.id === sesionActiva.id ? res.data!.sesion : s))
        );
        if (!payloadOverride) {
          setTextoMensaje('');
          setTranscripcionAudio('');
          setFotoUrl('');
          setPatenteInput('');
          setModoForzado('auto');
        }

        if (traza.accionTomada === 'cotizacion_directa') {
          notify(
            `⚡ Cotización inmediata generada (${traza.candidatosInventario.length} SKU(s) encontrados en catálogo unificado)`,
            'success'
          );
        } else if (traza.accionTomada === 'escalamiento_experto' && traza.escalamientoCreado) {
          notify(
            `🧠 Duda técnica detectada → Ticket ${traza.escalamientoCreado.ticketRef} creado en ${traza.escalamientoCreado.destino}`,
            'info'
          );
        } else if (traza.accionTomada === 'mesa_whatsapp_viva' && traza.solicitudWspCreada) {
          notify(
            `📲 Sin stock en catálogo → Solicitud #${traza.solicitudWspCreada.codigoSolicitud} despachada por WhatsApp a ${traza.solicitudWspCreada.proveedoresContactados.length} proveedor(es)`,
            'success'
          );
        }
      }
    } catch (err) {
      notify((err as Error).message || 'Error al ejecutar cascada del Agente Omnicanal', 'error');
    } finally {
      setEnviandoMensaje(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* ENCABEZADO */}
      <div className={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <img
              src="/logo-facil-repuestos.webp"
              alt="Fácil Repuestos"
              style={{ height: 34, width: 'auto', objectFit: 'contain' }}
            />
            <h1 className={styles.title} style={{ margin: 0 }}>
              🤖 Cerebro Orquestador — Agente Vendedor Omnicanal (Etapa 4)
            </h1>
          </div>
          <p className={styles.subtitle}>
            Atiende clientes finales exclusivamente por <strong>WhatsApp Oficial (+56 9 2740 1059)</strong> conectado al buscador inteligente de{' '}
            <strong>FácilRepuestos.cl</strong>. Resuelve la <strong>Patente</strong> automáticamente, guarda el{' '}
            <strong>CRM (Teléfono + Patente + Vehículo)</strong>, arma el <strong>Carro de Compra en WordPress</strong>, y si detecta duda técnica o falta de stock,
            dispara en automático el <strong>Escalamiento Experto (Etapa 1)</strong> o la{' '}
            <strong>Mesa de Cotización WhatsApp (Etapa 3)</strong>.
          </p>
        </div>

        <div className={styles.headerActions}>
          <a
            href="https://wa.me/56927401059?text=Hola%20Repuest%C3%ADn!%20Quiero%20cotizar%20un%20repuesto%20en%20F%C3%A1cilRepuestos.cl"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ background: '#25D366', color: '#052e16', fontWeight: 800, border: 'none', textDecoration: 'none' }}
          >
            📲 Abrir WhatsApp Oficial (+56 9 2740 1059)
          </a>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: '#64748b' }}
            onClick={() => setMostrarNuevaSesion((v) => !v)}
          >
            + Nueva Conversación Cliente
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: '#64748b' }}
            onClick={() => navigate('/escalamientos-ia')}
          >
            🧠 Ir a Escalamientos IA
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: '#64748b' }}
            onClick={() => navigate('/mesa-wsp')}
          >
            📲 Ir a Mesa WhatsApp
          </button>
        </div>
      </div>

      {/* BARRA DE ARQUITECTURA EN CASCADA */}
      <div className={styles.pipelineBar}>
        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Paso 1 · Identificación</span>
          <span className={styles.pipelineStepTitle}>🚗 Patente / VIN + Audio / Foto</span>
          <span className={styles.pipelineStepDesc}>
            Extrae patente chilena (`JPKR42`, `LRTB19`, `KJWP88`) y obtiene Marca, Modelo, Año y Motor.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Paso 2 · Memoria + Catálogo</span>
          <span className={styles.pipelineStepTitle}>📦 Multi-Ailoo + Locales en Firebase</span>
          <span className={styles.pipelineStepDesc}>
            Cruza `conocimiento_aprendido_ia` + `inventario` (`FRP-SOL-*`, `FRP-GLB-*`, `FRP-LOC-*`, `FRP-WSP-*`).
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Paso 3A · Duda de Calce</span>
          <span className={styles.pipelineStepTitle}>🧠 Escala a Nodo Experto (Etapa 1)</span>
          <span className={styles.pipelineStepDesc}>
            Si preguntan medidas/bimasa/muestra, crea ticket en `soluparts_ailoo` o `global_ailoo`.
          </span>
        </div>

        <div className={styles.pipelineStep}>
          <span className={styles.pipelineStepLabel}>Paso 3B · Sin Stock en Bodegas</span>
          <span className={styles.pipelineStepTitle}>📲 Dispara Mesa WhatsApp (Etapa 3)</span>
          <span className={styles.pipelineStepDesc}>
            Si ningún nodo tiene stock, cotiza en vivo por WhatsApp a proveedores especialistas por marca.
          </span>
        </div>
      </div>

      {/* MODAL / PANEL NUEVA CONVERSACIÓN */}
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
          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Canal de Entrada
            </label>
            <select
              className={styles.input}
              value={formNuevaSesion.canal}
              onChange={(e) =>
                setFormNuevaSesion((p) => ({
                  ...p,
                  canal: e.target.value as 'whatsapp_cliente' | 'web_cliente',
                }))
              }
            >
              <option value="whatsapp_cliente">📲 WhatsApp Meta Cliente</option>
              <option value="web_cliente">🌐 Chat Web FácilRepuestos.cl</option>
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: 4 }}>
              Nombre Cliente / Taller
            </label>
            <input
              className={styles.input}
              style={{ width: '100%' }}
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
            <select
              className={styles.input}
              value={formNuevaSesion.patenteInicial}
              onChange={(e) =>
                setFormNuevaSesion((p) => ({ ...p, patenteInicial: e.target.value }))
              }
            >
              <option value="">-- Sin patente inicial --</option>
              {padronDemo.map((v) => (
                <option key={v.patente} value={v.patente}>
                  {v.patente} — {v.marca} {v.modelo} ({v.anio})
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary btn-sm">
            Iniciar Conversación
          </button>
        </form>
      )}

      {/* ESCENARIOS DE PRUEBA EN 1 CLIC */}
      <div className={styles.scenariosBar}>
        <span className={styles.scenariosLabel}>
          🧪 Probar Cascada en 1 Clic sobre la conversación activa:
        </span>
        <div className={styles.scenariosBtns}>
          <button
            type="button"
            className={styles.scenarioBtn}
            disabled={enviandoMensaje}
            onClick={() =>
              enviarConsultaCascada({
                texto:
                  'Hola! Necesito pastillas de freno delanteras para mi Toyota Hilux patente LRTB19, ¿tienen disponibles y a qué precio?',
                modoForzado: 'auto',
              })
            }
          >
            ⚡ 1. Cotización Directa (Patente LRTB19 → Hilux en Global Ailoo)
          </button>

          <button
            type="button"
            className={styles.scenarioBtn}
            disabled={enviandoMensaje}
            onClick={() =>
              enviarConsultaCascada({
                texto:
                  'Amigo para la Hyundai Porter patente JPKR42 necesito el kit de embrague, ¿le sirve el de 240mm o lleva volante bimasa en caja sexta?',
                transcripcionAudio:
                  'Audio 0:09s — "Maestro la Porter es 2018 motor 2.5 D4CB caja de 6 velocidades, confírmeme si calza el disco de 240mm antes de comprarlo."',
                modoForzado: 'auto',
              })
            }
          >
            🧠 2. Duda Técnica → Auto-Escalar a Soluparts (Etapa 1)
          </button>

          <button
            type="button"
            className={styles.scenarioBtn}
            disabled={enviandoMensaje}
            onClick={() =>
              enviarConsultaCascada({
                texto:
                  'Busco culata completa armada con válvulas para furgón Peugeot Partner 1.6 HDI patente KJWP88 urgente para hoy',
                modoForzado: 'auto',
              })
            }
          >
            📲 3. Sin Stock → Auto-Disparar Mesa WhatsApp (Etapa 3)
          </button>
        </div>
      </div>

      {/* GRID PRINCIPAL DE 3 COLUMNAS */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
          Cargando Cerebro Orquestador Omnicanal...
        </div>
      ) : (
        <div className={styles.workspaceGrid}>
          {/* COLUMNA 1: SESIONES DE CLIENTES */}
          <div className={styles.sessionsPanel}>
            <div className={styles.panelHeader}>
              <span>💬 Clientes en Línea ({sesiones.length})</span>
            </div>
            {sesiones.map((ses) => {
              const activa = sesionActiva?.id === ses.id;
              return (
                <div
                  key={ses.id}
                  className={`${styles.sessionItem} ${
                    activa ? styles.sessionItemActive : ''
                  }`}
                  onClick={() => setSesionActivaId(ses.id)}
                >
                  <div className={styles.sessionTop}>
                    <span className={styles.sessionName}>{ses.clienteNombre}</span>
                    <span
                      className={
                        ses.canal === 'whatsapp_cliente'
                          ? styles.canalBadgeWsp
                          : styles.canalBadgeWeb
                      }
                    >
                      {ses.canal === 'whatsapp_cliente' ? '📲 WSP' : '🌐 WEB'}
                    </span>
                  </div>
                  {ses.vehiculoContexto ? (
                    <div className={styles.sessionVehicle}>
                      🚗 {ses.vehiculoContexto.patente ? `[${ses.vehiculoContexto.patente}] ` : ''}
                      {ses.vehiculoContexto.marca} {ses.vehiculoContexto.modelo}{' '}
                      {ses.vehiculoContexto.anio || ''}
                    </div>
                  ) : (
                    <div className={styles.sessionVehicle}>Sin vehículo identificado aún</div>
                  )}
                </div>
              );
            })}
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
                  <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                    {sesionActiva.vehiculoContexto
                      ? `${sesionActiva.vehiculoContexto.marca} ${
                          sesionActiva.vehiculoContexto.modelo || ''
                        } ${sesionActiva.vehiculoContexto.anio || ''}`
                      : 'Vehículo pendiente de patente'}
                  </span>
                  {sesionActiva.vehiculoContexto?.motor && (
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      · ⚙️ Motor {sesionActiva.vehiculoContexto.motor}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>
                  {sesionActiva.clienteTelefono || 'Chat Web'}
                </span>
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
                          : '🤖 Agente FácilRepuestos IA'}
                      </span>
                      <span>
                        {new Date(msg.creadoEn).toLocaleTimeString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className={styles.msgText}>{msg.texto}</p>

                    {msg.transcripcionAudio && (
                      <div
                        style={{
                          marginTop: 7,
                          paddingTop: 6,
                          borderTop: '1px dashed rgba(0,0,0,0.15)',
                          fontSize: '0.78rem',
                        }}
                      >
                        🎙️ <strong>Audio transcrito (Gemini Flash):</strong> "{msg.transcripcionAudio}"
                      </div>
                    )}

                    {msg.fotoUrl && (
                      <div style={{ marginTop: 8 }}>
                        <img
                          src={msg.fotoUrl}
                          alt="Muestra cliente"
                          style={{
                            maxHeight: 110,
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* COMPOSER */}
              <div className={styles.composerArea}>
                <div className={styles.composerTopRow}>
                  <select
                    className={styles.input}
                    value={patenteInput}
                    onChange={(e) => setPatenteInput(e.target.value)}
                  >
                    <option value="">🚗 Inyectar Patente Rápida (Opcional)</option>
                    {padronDemo.map((v) => (
                      <option key={v.patente} value={v.patente}>
                        {v.patente} — {v.marca} {v.modelo} {v.anio} ({v.motor})
                      </option>
                    ))}
                  </select>

                  <select
                    className={styles.input}
                    value={modoForzado}
                    onChange={(e) =>
                      setModoForzado(
                        e.target.value as 'auto' | 'forzar_escalamiento' | 'forzar_mesa_wsp'
                      )
                    }
                  >
                    <option value="auto">🤖 Decisión de Cascada: Automática</option>
                    <option value="forzar_escalamiento">
                      🧠 Forzar Escalamiento Experto (Etapa 1)
                    </option>
                    <option value="forzar_mesa_wsp">
                      📲 Forzar Mesa WhatsApp en Vivo (Etapa 3)
                    </option>
                  </select>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setMostrarAdjuntos((v) => !v)}
                  >
                    {mostrarAdjuntos ? 'Ocultar Audio/Foto' : '🎙️📷 Simular Audio o Foto Muestra'}
                  </button>
                </div>

                {mostrarAdjuntos && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      className={styles.input}
                      placeholder="🎙️ Transcripción de nota de voz del cliente..."
                      value={transcripcionAudio}
                      onChange={(e) => setTranscripcionAudio(e.target.value)}
                    />
                    <input
                      className={styles.input}
                      placeholder="📷 URL de foto de repuesto / muestra..."
                      value={fotoUrl}
                      onChange={(e) => setFotoUrl(e.target.value)}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    className={styles.textarea}
                    style={{ flex: 1 }}
                    placeholder="Escribe como cliente final (ej. 'Hola, necesito bomba de agua para mi Hyundai Porter patente JPKR42')..."
                    value={textoMensaje}
                    onChange={(e) => setTextoMensaje(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={enviandoMensaje}
                    onClick={() => enviarConsultaCascada()}
                  >
                    {enviandoMensaje ? 'Procesando Cascada...' : 'Enviar Mensaje →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* COLUMNA 3: RADIOGRAFÍA DE LA CASCADA Y MÁRGENES OCULTOS */}
          <div className={styles.tracePanel}>
            <div className={styles.panelHeader}>
              <span>🔬 Radiografía de Cascada & Márgenes</span>
              {ultimaTraza && (
                <span
                  className={
                    ultimaTraza.accionTomada === 'cotizacion_directa'
                      ? styles.actionBadgeDirecta
                      : ultimaTraza.accionTomada === 'escalamiento_experto'
                        ? styles.actionBadgeEscalar
                        : styles.actionBadgeWsp
                  }
                >
                  {ultimaTraza.accionTomada === 'cotizacion_directa'
                    ? '⚡ COTIZACIÓN DIRECTA'
                    : ultimaTraza.accionTomada === 'escalamiento_experto'
                      ? '🧠 ESCALADO ETAPA 1'
                      : '📲 MESA WSP ETAPA 3'}
                </span>
              )}
            </div>

            {!ultimaTraza ? (
              <div style={{ padding: 24, fontSize: '0.84rem', color: '#64748b' }}>
                Envía un mensaje o ejecuta un escenario de prueba para inspeccionar la decisión del
                agente.
              </div>
            ) : (
              <div className={styles.traceBody}>
                {/* 1. VEHÍCULO */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>1️⃣ Vehículo Resuelto</span>
                    <span style={{ fontSize: '0.7rem', color: '#0f766e' }}>
                      {ultimaTraza.vehiculoDetectado?.fuente || 'contexto'}
                    </span>
                  </div>
                  {ultimaTraza.vehiculoDetectado ? (
                    <div style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700 }}>
                      {ultimaTraza.vehiculoDetectado.patente && (
                        <code style={{ marginRight: 6 }}>
                          [{ultimaTraza.vehiculoDetectado.patente}]
                        </code>
                      )}
                      {ultimaTraza.vehiculoDetectado.marca}{' '}
                      {ultimaTraza.vehiculoDetectado.modelo || ''}{' '}
                      {ultimaTraza.vehiculoDetectado.anio || ''}
                      {ultimaTraza.vehiculoDetectado.motor && (
                        <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: 2 }}>
                          Motor: {ultimaTraza.vehiculoDetectado.motor}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      No se especificó patente ni modelo.
                    </div>
                  )}
                </div>

                {/* 2. MEMORIA TÉCNICA APRENDIDA */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>2️⃣ Conocimiento Aprendido IA</span>
                    <span>{ultimaTraza.reglasConocimientoAplicadas.length} regla(s)</span>
                  </div>
                  {ultimaTraza.reglasConocimientoAplicadas.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Sin reglas previas específicas para esta combinación.
                    </div>
                  ) : (
                    ultimaTraza.reglasConocimientoAplicadas.map((r) => (
                      <div key={r.id} className={styles.candCard}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {r.nombreRepuesto} (<code>{r.skuPublicoFrp}</code>)
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: 3 }}>
                          {r.explicacionExperta}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 3. CANDIDATOS MULTI-PROVEEDOR Y MÁRGENES OCULTOS */}
                <div className={styles.traceSection}>
                  <div className={styles.traceSectionTitle}>
                    <span>3️⃣ Catálogo Multi-Proveedor</span>
                    <span>{ultimaTraza.candidatosInventario.length} match(es)</span>
                  </div>
                  {ultimaTraza.candidatosInventario.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 600 }}>
                      ⚠️ 0 unidades en Soluparts, Global y Bodega Local.
                    </div>
                  ) : (
                    ultimaTraza.candidatosInventario.map((c) => (
                      <div key={c.id} className={styles.candCard}>
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
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, margin: '3px 0' }}>
                          {c.nombre}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          Origen: <strong>{c.proveedorNombre}</strong>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            paddingTop: 5,
                            borderTop: '1px dashed #cbd5e1',
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '0.75rem',
                          }}
                        >
                          <span>
                            Costo Oculto: ${c.precioCostoProveedor.toLocaleString('es-CL')} (+
                            {c.margenPct}%)
                          </span>
                          <strong style={{ color: '#0f766e' }}>
                            Público: ${c.precioVentaConIva.toLocaleString('es-CL')} IVA inc.
                          </strong>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 4. ACCIÓN DISPARADA EN ETAPA 1 O ETAPA 3 */}
                {ultimaTraza.escalamientoCreado && (
                  <div
                    className={styles.traceSection}
                    style={{ background: '#fffbeb', borderColor: '#fde68a' }}
                  >
                    <div className={styles.traceSectionTitle} style={{ color: '#92400e' }}>
                      <span>🧠 Ticket Etapa 1 Creado</span>
                      <code>{ultimaTraza.escalamientoCreado.ticketRef}</code>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#78350f', marginBottom: 8 }}>
                      Enrutado automáticamente a{' '}
                      <strong>{ultimaTraza.escalamientoCreado.destino}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      onClick={() => navigate('/escalamientos-ia')}
                    >
                      Ver Ticket en Bandeja de Escalamientos IA →
                    </button>
                  </div>
                )}

                {ultimaTraza.solicitudWspCreada && (
                  <div
                    className={styles.traceSection}
                    style={{ background: '#f5f3ff', borderColor: '#ddd6fe' }}
                  >
                    <div className={styles.traceSectionTitle} style={{ color: '#5b21b6' }}>
                      <span>📲 Solicitud Etapa 3 Creada</span>
                      <code>#{ultimaTraza.solicitudWspCreada.codigoSolicitud}</code>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#4c1d95', marginBottom: 8 }}>
                      WhatsApp despachado a:{' '}
                      <strong>
                        {ultimaTraza.solicitudWspCreada.proveedoresContactados.join(', ')}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      onClick={() => navigate('/mesa-wsp')}
                    >
                      Abrir Solicitud en Mesa WhatsApp en Vivo →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
