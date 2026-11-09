import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import type { ApiResponse, SesionAgenteOmnicanal, PedidoSimuladoAgente } from '../../types';
import styles from './ChatbotWidgetFlotante.module.css';

interface ChatbotWidgetFlotanteProps {
  /** Si es true, se muestra desplegado a pantalla completa dentro de un iframe (/widget-chat) */
  modoIframeEmbebido?: boolean;
  /** Si es true, se muestra como página limpia centrada para compartir por link directo (/repuestin, /asistente) */
  modoPaginaLimpia?: boolean;
  /** Si es true, el botón flotante inicia con el chat abierto */
  abiertoPorDefecto?: boolean;
  /** Patente pre-cargada desde el Portal Cliente */
  patenteInicial?: string;
}

const STORAGE_KEY_SESION_CLIENTE = 'frp_widget_cliente_sesion_id_v1';

export default function ChatbotWidgetFlotante({
  modoIframeEmbebido = false,
  modoPaginaLimpia = false,
  abiertoPorDefecto = false,
  patenteInicial = '',
}: ChatbotWidgetFlotanteProps) {
  const [abierto, setAbierto] = useState(modoIframeEmbebido || modoPaginaLimpia || abiertoPorDefecto);
  const [sesion, setSesion] = useState<SesionAgenteOmnicanal | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [texto, setTexto] = useState('');
  const [patente, setPatente] = useState(patenteInicial);
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [modalidadEntrega, setModalidadEntrega] = useState<'retiro_bodega' | 'despacho_domicilio'>('retiro_bodega');
  const [comunaInput, setComunaInput] = useState('La Florida, Santiago');
  const [noLeidos, setNoLeidos] = useState(1);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (patenteInicial && !patente) {
      setPatente(patenteInicial.toUpperCase());
    }
  }, [patenteInicial]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  // Inicializar o recuperar la sesión exclusiva de este cliente en el navegador
  const asegurarSesionCliente = async (): Promise<SesionAgenteOmnicanal | null> => {
    if (sesion) return sesion;
    try {
      setCargandoSesion(true);
      const savedId = localStorage.getItem(STORAGE_KEY_SESION_CLIENTE);
      if (savedId) {
        const resList = await api.get<ApiResponse<{ sesiones: SesionAgenteOmnicanal[] }>>('/agente-omnicanal/sesiones');
        const encontrada = (resList.data?.sesiones || []).find((s) => s.id === savedId);
        if (encontrada) {
          setSesion(encontrada);
          scrollToBottom();
          return encontrada;
        }
      }

      const resNueva = await api.post<ApiResponse<SesionAgenteOmnicanal>>('/agente-omnicanal/sesiones', {
        canal: 'web_cliente',
        clienteNombre: 'Cliente Portal Web',
        clienteTelefono: 'Chat Web Directo',
        patenteInicial: patente.trim().toUpperCase(),
      });

      if (resNueva.success && resNueva.data) {
        localStorage.setItem(STORAGE_KEY_SESION_CLIENTE, resNueva.data.id);
        setSesion(resNueva.data);
        scrollToBottom();
        return resNueva.data;
      }
      return null;
    } catch {
      return null;
    } finally {
      setCargandoSesion(false);
    }
  };

  useEffect(() => {
    if (abierto) {
      setNoLeidos(0);
      asegurarSesionCliente();
    }
  }, [abierto]);

  const enviarConsulta = async (textoCustom?: string) => {
    const mensajeFinal = (textoCustom !== undefined ? textoCustom : texto).trim();
    if (!mensajeFinal || enviando) return;

    try {
      setEnviando(true);
      const sesionActual = await asegurarSesionCliente();
      if (!sesionActual) return;

      if (textoCustom === undefined) {
        setTexto('');
      }

      const res = await api.post<ApiResponse<{ sesion: SesionAgenteOmnicanal }>>(
        `/agente-omnicanal/sesiones/${sesionActual.id}/mensaje`,
        {
          texto: mensajeFinal,
          patente: patente.trim().toUpperCase(),
          modoForzado: 'auto',
        }
      );

      if (res.success && res.data?.sesion) {
        setSesion(res.data.sesion);
        scrollToBottom();
      }
    } catch {
      // Silencioso o reintento
    } finally {
      setEnviando(false);
    }
  };

  const reiniciarConversacion = async () => {
    try {
      setEnviando(true);
      localStorage.removeItem(STORAGE_KEY_SESION_CLIENTE);
      const resNueva = await api.post<ApiResponse<SesionAgenteOmnicanal>>('/agente-omnicanal/sesiones', {
        canal: 'web_cliente',
        clienteNombre: 'Cliente Portal Web',
        clienteTelefono: 'Chat Web Directo',
        patenteInicial: '',
      });
      if (resNueva.success && resNueva.data) {
        localStorage.setItem(STORAGE_KEY_SESION_CLIENTE, resNueva.data.id);
        setSesion(resNueva.data);
        setPatente('');
        setTexto('');
        setMostrarCarrito(false);
        scrollToBottom();
      }
    } finally {
      setEnviando(false);
    }
  };

  const confirmarPedidoCliente = async () => {
    if (!sesion) return;
    try {
      setEnviando(true);
      const res = await api.post<
        ApiResponse<{
          pedido: PedidoSimuladoAgente;
          sesion: SesionAgenteOmnicanal;
        }>
      >(`/agente-omnicanal/sesiones/${sesion.id}/checkout-simulado`, {
        accion: 'crear_y_aprobar',
        modalidadEntrega,
        comunaEntrega: comunaInput,
        metodoPagoSimulado: 'reserva_web_cliente',
      });
      if (res.success && res.data?.sesion) {
        setSesion(res.data.sesion);
        setMostrarCarrito(false);
        scrollToBottom();
      }
    } finally {
      setEnviando(false);
    }
  };

  const carrito = sesion?.carritoCotizado || [];
  const totalCarritoIva = carrito.reduce(
    (acc, item) => acc + Number(item.precioVentaConIva || 0) * Number(item.cantidad || 1),
    0
  );

  const renderVentanaChat = () => (
    <div
      className={
        modoPaginaLimpia
          ? styles.chatWindowCleanPage
          : modoIframeEmbebido
          ? styles.chatWindowIframe
          : styles.chatWindow
      }
    >
      {/* Cabecera Corporativa FácilRepuestos */}
      <div className={styles.header}>
        <div className={styles.headerBrand}>
          <div className={styles.avatarWrap}>
            <img src="/ico-facil-repuestos.webp" alt="Repuestín IA" className={styles.avatarImg} />
            <span className={styles.onlineBadge} />
          </div>
          <div>
            <div className={styles.headerTitle}>Repuestín · FácilRepuestos.cl</div>
            <div className={styles.headerSubtitle}>
              Especialista en Repuestos · Cotiza por Patente, OEM o Modelo
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          {carrito.length > 0 && (
            <button
              type="button"
              className={styles.cartHeaderBtn}
              onClick={() => setMostrarCarrito(!mostrarCarrito)}
              title="Ver repuestos cotizados"
            >
              🛒 {carrito.length}
            </button>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={reiniciarConversacion}
            title="Nueva conversación"
            disabled={enviando}
          >
            ↻
          </button>
          {!modoIframeEmbebido && !modoPaginaLimpia && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setAbierto(false)}
              title="Minimizar chat"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Cinta de Vehículo + Patente Rápida */}
      <div className={styles.vehicleStrip}>
        <div className={styles.patenteInputBox}>
          <span className={styles.patenteLabel}>🚗 PATENTE:</span>
          <input
            type="text"
            className={styles.patenteInput}
            placeholder="Ej: LPGW76"
            maxLength={6}
            value={patente}
            onChange={(e) => setPatente(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </div>
        {sesion?.vehiculoContexto ? (
          <div className={styles.vehicleDetectedPill}>
            ✅ {sesion.vehiculoContexto.marca} {sesion.vehiculoContexto.modelo}{' '}
            {sesion.vehiculoContexto.anio || ''}
          </div>
        ) : (
          <div className={styles.vehicleHint}>
            📍 Retiro Enrique Olivares 224 o Despacho Chile
          </div>
        )}
      </div>

      {/* Panel desplegable del Carrito Cotizado */}
      {mostrarCarrito && carrito.length > 0 && (
        <div className={styles.cartDrawer}>
          <div className={styles.cartDrawerHeader}>
            <strong>🛒 Tu Cotización ({carrito.length} repuesto{carrito.length > 1 ? 's' : ''})</strong>
            <button
              type="button"
              className={styles.closeCartBtn}
              onClick={() => setMostrarCarrito(false)}
            >
              Volver al chat
            </button>
          </div>
          <div className={styles.cartItemsList}>
            {carrito.map((it) => (
              <div key={it.skuPublicoFrp} className={styles.cartItemCard}>
                <div className={styles.cartItemTop}>
                  <span>{it.nombre}</span>
                  <strong>${Number(it.precioVentaConIva).toLocaleString('es-CL')}</strong>
                </div>
                <div className={styles.cartItemSub}>
                  SKU: {it.skuPublicoFrp} · Marca: {it.fabricante || 'OEM'} · Stock: {it.stock} un.
                </div>
              </div>
            ))}
          </div>
          <div className={styles.cartDeliveryBox}>
            <div className={styles.deliveryToggleRow}>
              <button
                type="button"
                className={
                  modalidadEntrega === 'retiro_bodega'
                    ? styles.deliveryBtnActive
                    : styles.deliveryBtn
                }
                onClick={() => setModalidadEntrega('retiro_bodega')}
              >
                📍 Retiro La Florida ($0)
              </button>
              <button
                type="button"
                className={
                  modalidadEntrega === 'despacho_domicilio'
                    ? styles.deliveryBtnActive
                    : styles.deliveryBtn
                }
                onClick={() => setModalidadEntrega('despacho_domicilio')}
              >
                🚚 Despacho a Domicilio
              </button>
            </div>
            <input
              type="text"
              className={styles.comunaField}
              value={comunaInput}
              onChange={(e) => setComunaInput(e.target.value)}
              placeholder="Indica tu comuna o ciudad..."
            />
            <div className={styles.cartTotalRow}>
              <span>Total IVA incluido:</span>
              <strong>${totalCarritoIva.toLocaleString('es-CL')}</strong>
            </div>
            <button
              type="button"
              className={styles.confirmOrderBtn}
              onClick={confirmarPedidoCliente}
              disabled={enviando}
            >
              ✅ Confirmar Pedido Ahora
            </button>
          </div>
        </div>
      )}

      {/* Cuerpo de Mensajes */}
      <div className={styles.messagesBody}>
        {cargandoSesion && !sesion ? (
          <div className={styles.loadingState}>Conectando con el especialista FácilRepuestos...</div>
        ) : (
          (sesion?.mensajes || []).map((m) => {
            const esCliente = m.autor === 'cliente';
            return (
              <div
                key={m.id}
                className={esCliente ? styles.rowCliente : styles.rowAgente}
              >
                <div className={esCliente ? styles.bubbleCliente : styles.bubbleAgente}>
                  <div className={styles.msgText}>{m.texto}</div>
                  <div className={styles.msgTime}>
                    {new Date(m.creadoEn).toLocaleTimeString('es-CL', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {enviando && (
          <div className={styles.rowAgente}>
            <div className={styles.typingBubble}>
              Buscando en catálogo y bodegas asociadas...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sugerencias rápidas para el cliente */}
      <div className={styles.quickChipsRow}>
        <button
          type="button"
          className={styles.quickChip}
          disabled={enviando}
          onClick={() => enviarConsulta('Hola, busco pastillas de freno delanteras')}
        >
          🛑 Pastillas de freno
        </button>
        <button
          type="button"
          className={styles.quickChip}
          disabled={enviando}
          onClick={() => enviarConsulta('Necesito kit de embrague completo')}
        >
          ⚙️ Kit de embrague
        </button>
        <button
          type="button"
          className={styles.quickChip}
          disabled={enviando}
          onClick={() => enviarConsulta('Prefiero retiro en Enrique Olivares 224, La Florida')}
        >
          📍 Retiro en Tienda
        </button>
        {carrito.length > 0 && (
          <button
            type="button"
            className={styles.quickChipBuy}
            disabled={enviando}
            onClick={() => setMostrarCarrito(true)}
          >
            🛒 Ver Cotización (${totalCarritoIva.toLocaleString('es-CL')})
          </button>
        )}
      </div>

      {/* Input de escritura */}
      <form
        className={styles.inputBar}
        onSubmit={(e) => {
          e.preventDefault();
          enviarConsulta();
        }}
      >
        <input
          type="text"
          className={styles.textInput}
          placeholder="Escribe tu repuesto, código OEM o modelo..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={enviando}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={enviando || !texto.trim()}
        >
          ➤
        </button>
      </form>
    </div>
  );

  if (modoPaginaLimpia) {
    return (
      <div className={styles.cleanPageBackdrop}>
        {renderVentanaChat()}
      </div>
    );
  }

  if (modoIframeEmbebido) {
    return renderVentanaChat();
  }

  return (
    <div className={styles.floatingRoot}>
      {abierto && renderVentanaChat()}

      {/* Botón Burbuja Flotante en la esquina inferior derecha */}
      <button
        type="button"
        className={styles.launcherBtn}
        onClick={() => setAbierto(!abierto)}
        aria-label="Abrir chat de repuestos FácilRepuestos"
      >
        <span className={styles.launcherIcon}>{abierto ? '✕' : '💬'}</span>
        <span className={styles.launcherText}>
          {abierto ? 'Cerrar Chat' : '¿Buscas un repuesto? Cotiza aquí'}
        </span>
        {!abierto && noLeidos > 0 && (
          <span className={styles.unreadBadge}>{noLeidos}</span>
        )}
      </button>
    </div>
  );
}
