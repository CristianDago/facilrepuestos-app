import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  SesionAgenteOmnicanal,
  VehiculoDetectadoAgente,
  PedidoSimuladoAgente,
} from '../../types';
import styles from './ChatClienteWeb.module.css';

interface RespuestaListadoSesiones {
  sesiones: SesionAgenteOmnicanal[];
  padronDemoPatentes: VehiculoDetectadoAgente[];
}

const ESCENARIOS_REALES_LUNA = [
  {
    id: 'luna-multi-parcial',
    tag: 'Mejora Luna #1 · Pedido Múltiple (C01/C08)',
    titulo: 'Filtro de Aire + "Fujias" (Stock Parcial)',
    descripcion:
      'Corrige "fujias" → BUJIA, cotiza el filtro en stock al instante y deriva SOLO las bujías faltantes a Mesa WSP.',
    patente: '',
    texto: 'Hola! Necesito filtro de aire y juego de fujias para mi Changan A500 2019',
  },
  {
    id: 'luna-patente-typos',
    tag: 'Mejora #2 · Patente + Typos (C02/C43)',
    titulo: 'Patente LPGW76 ("Donfen" → DFM)',
    descripcion:
      'Normaliza "Donfen" → DFM, detecta patente LPGW76 (Joyear X3 2019) y cotiza pastillas gestionadas directamente por FácilRepuestos.',
    patente: 'LPGW76',
    texto: 'Hola, busco pastillas de freno delanteras para mi Donfen Joyear X3 patente LPGW76',
  },
  {
    id: 'luna-duda-calce',
    tag: 'Mejora #3 · Duda Técnica (C20/C73)',
    titulo: 'Calce Estrías + ABS ("Greatwall Vorex")',
    descripcion:
      'Normaliza "Greatwall Vorex" → GREAT WALL VOLEEX, pre-selecciona homocinética y escala validación de estrías sin exponer proveedor.',
    patente: '',
    texto: '¿Cuántas estrías trae la homocinética del Greatwall Vorex C30 2015? ¿Le sirve con ABS?',
  },
  {
    id: 'luna-antispam-espero',
    tag: 'Mejora #4 · Anti-Duplicación (C25/C36)',
    titulo: 'Cliente dice "Sigo esperando, ¿aún nada?"',
    descripcion:
      'Evita crear tickets repetidos y verifica en tiempo real si la Mesa Técnica FácilRepuestos ya confirmó el repuesto.',
    patente: '',
    texto: 'Sigo esperando, ¿tienen respuesta o aún nada?',
  },
  {
    id: 'luna-comuna-comprar',
    tag: 'Mejora #5 · Retiro La Florida / Despacho Chile',
    titulo: 'Retiro en Enrique Olivares 224 o Despacho',
    descripcion:
      'Arma el resumen final con Retiro en Enrique Olivares 224, La Florida o Despacho en Santiago y todo Chile.',
    patente: '',
    texto: 'Soy de La Florida, prefiero retiro en Enrique Olivares 224',
  },
];

export default function ChatClienteWeb() {
  const { notify } = useAppStore();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [sesiones, setSesiones] = useState<SesionAgenteOmnicanal[]>([]);
  const [padronPatentes, setPadronPatentes] = useState<VehiculoDetectadoAgente[]>([]);
  const [sesionActivaId, setSesionActivaId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const [textoInput, setTextoInput] = useState('');
  const [patenteInput, setPatenteInput] = useState('');
  const [modalidadSeleccionada, setModalidadSeleccionada] = useState<'retiro_bodega' | 'despacho_domicilio'>(
    'retiro_bodega'
  );
  const [comunaInput, setComunaInput] = useState('La Florida, Santiago (RM)');

  const cargarSesiones = async (seleccionarId?: string) => {
    try {
      setLoading(true);
      const res = await api.get<ApiResponse<RespuestaListadoSesiones>>('/agente-omnicanal/sesiones');
      if (res.success && res.data) {
        setSesiones(res.data.sesiones || []);
        setPadronPatentes(res.data.padronDemoPatentes || []);
        if (seleccionarId) {
          setSesionActivaId(seleccionarId);
        } else if (!sesionActivaId && res.data.sesiones.length > 0) {
          setSesionActivaId(res.data.sesiones[0].id);
        }
      }
    } catch {
      notify('Error al cargar la vista web del asistente', 'error');
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

  useEffect(() => {
    if (sesionActiva?.comunaCliente) {
      setComunaInput(sesionActiva.comunaCliente);
    }
    if (
      sesionActiva?.modalidadEntrega === 'retiro_bodega' ||
      sesionActiva?.modalidadEntrega === 'despacho_domicilio'
    ) {
      setModalidadSeleccionada(sesionActiva.modalidadEntrega);
    }
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [sesionActiva]);

  const actualizarSesionEnLista = (sesionActualizada: SesionAgenteOmnicanal) => {
    setSesiones((prev) =>
      prev.map((s) => (s.id === sesionActualizada.id ? sesionActualizada : s))
    );
  };

  const handleEnviarMensaje = async (textoCustom?: string, patenteCustom?: string) => {
    if (!sesionActiva) return;
    const textoFinal = (textoCustom !== undefined ? textoCustom : textoInput).trim();
    const patenteFinal = (patenteCustom !== undefined ? patenteCustom : patenteInput).trim();
    if (!textoFinal) return;

    try {
      setEnviando(true);
      const res = await api.post<
        ApiResponse<{
          sesion: SesionAgenteOmnicanal;
        }>
      >(`/agente-omnicanal/sesiones/${sesionActiva.id}/mensaje`, {
        texto: textoFinal,
        patente: patenteFinal,
        modoForzado: 'auto',
      });

      if (res.success && res.data?.sesion) {
        actualizarSesionEnLista(res.data.sesion);
        if (textoCustom === undefined) {
          setTextoInput('');
        }
      }
    } catch {
      notify('No se pudo procesar el mensaje en el asistente web', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleNuevaConversacionLimpiar = async () => {
    try {
      setEnviando(true);
      const res = await api.post<ApiResponse<SesionAgenteOmnicanal>>('/agente-omnicanal/sesiones', {
        canal: 'web_cliente',
        clienteNombre: `Cliente Web Sandbox #${sesiones.length + 1}`,
        clienteTelefono: 'Vista Web Directa (Sin WSP)',
        patenteInicial: '',
      });
      if (res.success && res.data) {
        setSesiones((prev) => [res.data!, ...prev]);
        setSesionActivaId(res.data.id);
        setPatenteInput('');
        setTextoInput('');
        notify('Nueva sesión de prueba web iniciada', 'success');
      }
    } catch {
      notify('Error al crear nueva sesión web', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleSimularRespuestaProveedorVivo = async () => {
    if (!sesionActiva) return;
    try {
      setEnviando(true);
      const res = await api.post<
        ApiResponse<{
          sesion: SesionAgenteOmnicanal;
        }>
      >(`/agente-omnicanal/sesiones/${sesionActiva.id}/simular-respuesta-proveedor`, {});
      if (res.success && res.data?.sesion) {
        actualizarSesionEnLista(res.data.sesion);
        notify('¡Respuesta del proveedor inyectada en vivo al chat del cliente!', 'success');
      }
    } catch {
      notify('No se pudo simular la respuesta en vivo', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleConfirmarCheckoutSandbox = async (accion: 'crear' | 'aprobar_pago' | 'crear_y_aprobar') => {
    if (!sesionActiva) return;
    try {
      setEnviando(true);
      const res = await api.post<
        ApiResponse<{
          pedido: PedidoSimuladoAgente;
          sesion: SesionAgenteOmnicanal;
        }>
      >(`/agente-omnicanal/sesiones/${sesionActiva.id}/checkout-simulado`, {
        accion,
        modalidadEntrega: modalidadSeleccionada,
        comunaEntrega: comunaInput,
        metodoPagoSimulado: 'sandbox_webpay_sin_tarjeta',
      });
      if (res.success && res.data?.sesion) {
        actualizarSesionEnLista(res.data.sesion);
        notify(
          `Pedido ${res.data.pedido.codigoPedido} procesado en Modo Sandbox (sin tarjeta real)`,
          'success'
        );
      }
    } catch {
      notify('Cotiza primero un repuesto en el chat para confirmar el pedido', 'info');
    } finally {
      setEnviando(false);
    }
  };

  const carrito = sesionActiva?.carritoCotizado || [];
  const totalCarritoIva = carrito.reduce(
    (acc, item) => acc + Number(item.precioVentaConIva || 0) * Number(item.cantidad || 1),
    0
  );
  const tieneConsultasEnMeson =
    (sesionActiva?.escalamientosAbiertos?.length || 0) > 0 ||
    (sesionActiva?.solicitudesWspAbiertas?.length || 0) > 0;

  const etiquetaAccion = (accion?: string) => {
    switch (accion) {
      case 'cotizacion_directa':
        return '⚡ Stock Directo Cotizado';
      case 'cotizacion_parcial_con_mesa_wsp':
        return '📦 Stock Parcial + 📲 Faltante a Mesa WSP';
      case 'escalamiento_experto':
        return '🔍 Validación Técnica (Etapa 1)';
      case 'mesa_whatsapp_viva':
        return '📲 Mesa WhatsApp Proveedores (Etapa 3)';
      case 'seguimiento_sin_duplicar':
        return '🛡️ Anti-Spam (Sin Duplicar Ticket)';
      case 'respuesta_proveedor_en_vivo':
        return '🔔 Respuesta Proveedor en Vivo';
      case 'checkout_simulado_creado':
      case 'checkout_simulado_pagado':
        return '🛒 Checkout Sandbox';
      default:
        return '🤖 Respuesta IA';
    }
  };

  return (
    <div className={styles.pageWrapper}>
      {/* Banner Superior */}
      <header className={styles.topBanner}>
        <div className={styles.brandHeader}>
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
            style={{ height: 42, width: 'auto', objectFit: 'contain' }}
          />
          <div>
            <h1 className={styles.brandTitle}>
              Asistente Conversacional FácilRepuestos.cl — Vista Cliente
              <span className={styles.sandboxBadge}>
                SANDBOX WEB · SIN TARJETA NI NÚMERO WSP FINAL
              </span>
            </h1>
            <p className={styles.brandSubtitle}>
              Despacho a domicilio en Santiago y todo Chile · Retiro exclusivo en Sucursal FácilRepuestos: Enrique
              Olivares 224, La Florida, Santiago de Chile (identidad y dirección de proveedores 100% blindadas).
            </p>
          </div>
        </div>

        <div className={styles.bannerActions}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate('/agente-omnicanal')}
          >
            🧠 Ver Traza Interna (/agente-omnicanal)
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate('/mesa-wsp')}
          >
            📲 Mesa WhatsApp (/mesa-wsp)
          </button>
          <button
            type="button"
            className={styles.navBtnPrimary}
            onClick={handleNuevaConversacionLimpiar}
            disabled={enviando}
          >
            ➕ Nuevo Chat de Cliente
          </button>
        </div>
      </header>

      {/* Laboratorio 1-Clic con los 5 casos reales */}
      <section className={styles.scenariosCard}>
        <div className={styles.scenariosHeader}>
          <div className={styles.scenariosTitle}>
            🧪 Escenarios de Prueba en Vivo (1-Clic) — Haz clic para probar en el chat:
          </div>
          <span className={styles.scenariosHint}>
            Incluye corrección de typos (&quot;Donfen&quot;, &quot;Greatwall Vorex&quot;, &quot;fujias&quot;), blindaje anti-bypass y retiro en Enrique Olivares 224
          </span>
        </div>
        <div className={styles.scenariosGrid}>
          {ESCENARIOS_REALES_LUNA.map((esc) => (
            <button
              key={esc.id}
              type="button"
              className={styles.scenarioBtn}
              disabled={enviando || loading}
              onClick={() => {
                if (esc.patente) setPatenteInput(esc.patente);
                handleEnviarMensaje(esc.texto, esc.patente);
              }}
            >
              <span className={styles.scenarioTag}>{esc.tag}</span>
              <span className={styles.scenarioName}>{esc.titulo}</span>
              <span className={styles.scenarioDesc}>{esc.descripcion}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Grilla Principal: Ventana de Chat del Cliente + Carrito / Checkout Sandbox */}
      <div className={styles.mainGrid}>
        {/* Columna Izquierda: Chat Conversacional del Cliente */}
        <div className={styles.chatContainer}>
          <div className={styles.chatTopBar}>
            <div className={styles.chatAgentInfo}>
              <span className={styles.onlineDot} />
              <div>
                <h2 className={styles.chatAgentName}>
                  Asistente Especialista FácilRepuestos.cl
                </h2>
                <p className={styles.chatAgentStatus}>
                  En línea · Despacho en Santiago y todo Chile · Retiro en Enrique Olivares 224, La Florida, Santiago
                </p>
              </div>
            </div>

            <div className={styles.sessionSelector}>
              <select
                className={styles.sessionSelect}
                value={sesionActiva?.id || ''}
                onChange={(e) => setSesionActivaId(e.target.value)}
                aria-label="Seleccionar sesión de cliente"
              >
                {sesiones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.clienteNombre} {s.vehiculoContexto?.patente ? `[${s.vehiculoContexto.patente}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Barra Amarilla si hay una solicitud esperando respuesta de proveedor en Mesa WSP o Escalamiento */}
          {tieneConsultasEnMeson && (
            <div className={styles.livePendingBar}>
              <div className={styles.livePendingText}>
                ⏳ Consulta activa en mesón:{' '}
                {[
                  ...(sesionActiva?.escalamientosAbiertos || []).map((e) => `Experto ${e.ticketRef}`),
                  ...(sesionActiva?.solicitudesWspAbiertas || []).map(
                    (w) => `Mesa WSP #${w.codigoSolicitud}`
                  ),
                ].join(' · ')}
              </div>
              <button
                type="button"
                className={styles.simulateReplyBtn}
                onClick={handleSimularRespuestaProveedorVivo}
                disabled={enviando}
              >
                ⚡ Simular Respuesta del Proveedor en Vivo (1-Clic)
              </button>
            </div>
          )}

          {/* Historial de Mensajes */}
          <div className={styles.messagesViewport} ref={viewportRef}>
            {(sesionActiva?.mensajes || []).map((msg) => {
              const esCliente = msg.autor === 'cliente';
              return (
                <div
                  key={msg.id}
                  className={esCliente ? styles.msgRowCliente : styles.msgRowAgente}
                >
                  <div className={esCliente ? styles.bubbleCliente : styles.bubbleAgente}>
                    {!esCliente && (
                      <div className={styles.bubbleHeader}>
                        <span>🤖 Asistente FácilRepuestos</span>
                        {msg.trazaCascada?.accionTomada && (
                          <span className={styles.actionPill}>
                            {etiquetaAccion(msg.trazaCascada.accionTomada)}
                          </span>
                        )}
                      </div>
                    )}
                    <div className={styles.bubbleText}>{msg.texto}</div>
                    <div className={styles.bubbleMeta}>
                      <span>
                        {new Date(msg.creadoEn).toLocaleTimeString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Respuestas rápidas de 1 clic para el cliente */}
          <div className={styles.quickRepliesBar}>
            <button
              type="button"
              className={styles.quickChip}
              disabled={enviando}
              onClick={() => handleEnviarMensaje('Soy de La Florida, prefiero retiro en Enrique Olivares 224')}
            >
              📍 Retiro en Enrique Olivares 224, La Florida
            </button>
            <button
              type="button"
              className={styles.quickChip}
              disabled={enviando}
              onClick={() => handleEnviarMensaje('Soy de Concepción, necesito despacho a domicilio')}
            >
              🚚 Despacho en Santiago y Todo Chile
            </button>
            <button
              type="button"
              className={styles.quickChip}
              disabled={enviando}
              onClick={() => handleEnviarMensaje('COMPRAR')}
            >
              🛒 Escribir &quot;COMPRAR&quot;
            </button>
            <button
              type="button"
              className={styles.quickChip}
              disabled={enviando}
              onClick={() => handleEnviarMensaje('Espero, ¿aún nada?')}
            >
              ⏳ &quot;Espero, ¿aún nada?&quot; (Test Anti-Spam)
            </button>
          </div>

          {/* Barra de escritura del cliente */}
          <form
            className={styles.composerArea}
            onSubmit={(e) => {
              e.preventDefault();
              handleEnviarMensaje();
            }}
          >
            <div className={styles.composerRow}>
              <input
                type="text"
                className={styles.patenteMiniInput}
                placeholder="PATENTE"
                maxLength={6}
                value={patenteInput}
                onChange={(e) => setPatenteInput(e.target.value.toUpperCase())}
                title="Patente opcional (ej. PDSS87, LPGW76, PFVG55)"
              />
              <input
                type="text"
                className={styles.messageInput}
                placeholder="Escribe como cliente (ej: Necesito kit de embriague para Chery Tiggo 2, o escribe COMPRAR)..."
                value={textoInput}
                onChange={(e) => setTextoInput(e.target.value)}
                disabled={enviando}
              />
              <button
                type="submit"
                className={styles.sendBtn}
                disabled={enviando || !textoInput.trim()}
              >
                {enviando ? 'Enviando...' : 'Enviar ➤'}
              </button>
            </div>
          </form>
        </div>

        {/* Columna Derecha: Resumen del Vehículo, Carrito Cotizado y Checkout Sandbox */}
        <aside className={styles.sideColumn}>
          {/* Tarjeta 1: Vehículo Identificado */}
          <div className={styles.sideCard}>
            <h3 className={styles.sideCardTitle}>
              <span>🚗 Tu Vehículo Identificado</span>
              {sesionActiva?.vehiculoContexto?.fuente && (
                <span style={{ fontSize: '0.7rem', color: '#0d9488', fontWeight: 700 }}>
                  {sesionActiva.vehiculoContexto.fuente}
                </span>
              )}
            </h3>

            {sesionActiva?.vehiculoContexto ? (
              <div className={styles.vehicleBox}>
                <div className={styles.plateBadge}>
                  {sesionActiva.vehiculoContexto.patente || 'SIN PPU'}
                </div>
                <div className={styles.vehicleDetails}>
                  <div className={styles.vehicleName}>
                    {sesionActiva.vehiculoContexto.marca} {sesionActiva.vehiculoContexto.modelo}{' '}
                    {sesionActiva.vehiculoContexto.anio ? `(${sesionActiva.vehiculoContexto.anio})` : ''}
                  </div>
                  <div className={styles.vehicleSub}>
                    Motor: {sesionActiva.vehiculoContexto.motor || 'Estándar'}
                    {sesionActiva.vehiculoContexto.vin
                      ? ` · VIN: ${sesionActiva.vehiculoContexto.vin}`
                      : ''}
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.emptyCartMsg}>
                Indica tu patente o modelo en el chat para identificar tu vehículo automáticamente.
              </div>
            )}

            <div className={styles.patentesQuickList}>
              {padronPatentes.slice(0, 10).map((v) => (
                <button
                  key={v.patente}
                  type="button"
                  className={styles.patenteChip}
                  onClick={() => {
                    setPatenteInput(v.patente || '');
                    handleEnviarMensaje(
                      `Hola, busco repuestos para mi ${v.marca} ${v.modelo} patente ${v.patente}`,
                      v.patente
                    );
                  }}
                >
                  {v.patente} · {v.marca} {v.modelo}
                </button>
              ))}
            </div>
          </div>

          {/* Tarjeta 2: Carrito Cotizado y Checkout Sandbox sin Tarjeta */}
          <div className={styles.sideCard}>
            <h3 className={styles.sideCardTitle}>
              <span>🛒 Tu Cotización Lista para Compra</span>
              <span style={{ fontSize: '0.75rem', color: '#047857' }}>
                {carrito.length} ítem(s)
              </span>
            </h3>

            {carrito.length === 0 ? (
              <div className={styles.emptyCartMsg}>
                Aún no hay repuestos cotizados en esta sesión. Haz una consulta en el chat o usa uno de
                los botones de arriba.
              </div>
            ) : (
              <>
                <div className={styles.cartList}>
                  {carrito.map((item) => (
                    <div key={item.skuPublicoFrp} className={styles.cartItem}>
                      <div className={styles.cartItemHeader}>
                        <span className={styles.cartItemName}>{item.nombre}</span>
                        <span className={styles.cartItemPrice}>
                          ${Number(item.precioVentaConIva).toLocaleString('es-CL')} IVA inc.
                        </span>
                      </div>
                      <div className={styles.cartItemMeta}>
                        <span className={styles.skuCode}>{item.skuPublicoFrp}</span>
                        <span>
                          Marca: <strong>{item.fabricante || 'OEM'}</strong> · Stock: {item.stock} un.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Selección de Retiro vs Despacho y Comuna */}
                <div className={styles.deliveryOptions}>
                  <div className={styles.deliveryRow}>
                    <button
                      type="button"
                      className={`${styles.deliveryBtn} ${
                        modalidadSeleccionada === 'retiro_bodega' ? styles.deliveryBtnActive : ''
                      }`}
                      onClick={() => setModalidadSeleccionada('retiro_bodega')}
                    >
                      📍 Retiro Enrique Olivares 224 ($0)
                    </button>
                    <button
                      type="button"
                      className={`${styles.deliveryBtn} ${
                        modalidadSeleccionada === 'despacho_domicilio' ? styles.deliveryBtnActive : ''
                      }`}
                      onClick={() => setModalidadSeleccionada('despacho_domicilio')}
                    >
                      🚚 Despacho Santiago y Todo Chile
                    </button>
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#0f766e', fontWeight: 600 }}>
                    {modalidadSeleccionada === 'retiro_bodega'
                      ? '📍 Retiro exclusivo en Tienda FácilRepuestos: Enrique Olivares 224, La Florida, Santiago de Chile'
                      : '🚚 Despachamos directamente en todo Santiago (RM) y a todo Chile'}
                  </div>
                  <input
                    type="text"
                    className={styles.comunaInput}
                    value={comunaInput}
                    onChange={(e) => setComunaInput(e.target.value)}
                    placeholder="Comuna o Ciudad (ej. La Florida, Santiago, Concepción...)"
                  />
                </div>

                <div className={styles.cartTotalBox}>
                  <span className={styles.cartTotalLabel}>Total con IVA (19%):</span>
                  <span className={styles.cartTotalValue}>
                    ${totalCarritoIva.toLocaleString('es-CL')}
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.checkoutSandboxBtn}
                  disabled={enviando}
                  onClick={() => handleConfirmarCheckoutSandbox('crear_y_aprobar')}
                >
                  ✅ Confirmar Pedido y Simular Pago Aprobado (Sin Tarjeta Real)
                </button>
              </>
            )}
          </div>

          {/* Tarjeta 3: Comprobante de Pedido Sandbox cuando ya compró */}
          {sesionActiva?.pedidoActivo && (
            <div className={styles.orderSuccessCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={styles.orderCodeBadge}>
                  {sesionActiva.pedidoActivo.codigoPedido}
                </span>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#047857' }}>
                  {sesionActiva.pedidoActivo.estadoPago === 'pagado_sandbox'
                    ? '✅ PAGO SANDBOX APROBADO'
                    : '⏳ PENDIENTE DE PAGO'}
                </span>
              </div>
              <ul className={styles.orderMetaList}>
                <li>
                  <strong>Total:</strong> $
                  {Number(sesionActiva.pedidoActivo.totalConIva).toLocaleString('es-CL')} IVA inc.
                </li>
                <li>
                  <strong>Modalidad:</strong> {sesionActiva.pedidoActivo.sucursalRetiro}
                </li>
                <li>
                  <strong>Comuna:</strong> {sesionActiva.pedidoActivo.comunaEntrega}
                </li>
                {sesionActiva.pedidoActivo.codigoAutorizacionSandbox && (
                  <li>
                    <strong>Autorización Sandbox:</strong>{' '}
                    <code>{sesionActiva.pedidoActivo.codigoAutorizacionSandbox}</code>
                  </li>
                )}
              </ul>
              {sesionActiva.pedidoActivo.estadoPago !== 'pagado_sandbox' && (
                <button
                  type="button"
                  className={styles.checkoutSandboxBtn}
                  onClick={() => handleConfirmarCheckoutSandbox('aprobar_pago')}
                  disabled={enviando}
                >
                  💳 Aprobar Pago Simulado Ahora
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
