import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from './ChatbotWidgetFlotante.module.css';

interface ChatbotWidgetFlotanteProps {
  /** Si es true, se muestra desplegado a pantalla completa dentro de un iframe (/widget-chat) */
  modoIframeEmbebido?: boolean;
  /** Si es true, se muestra como página limpia centrada (/repuestin, /asistente) */
  modoPaginaLimpia?: boolean;
  /** Si es true, el botón flotante inicia con el panel abierto */
  abiertoPorDefecto?: boolean;
  /** Patente pre-cargada desde el Portal Cliente */
  patenteInicial?: string;
}

interface ItemBuscadorPublico {
  id: string;
  nombre: string;
  codigo: string;
  skuPublicoFrp: string;
  fabricante: string;
  categoria: string;
  subcategoria?: string;
  subcategoriaDetalle?: string;
  precio: number;
  disponible: number;
  enStock: boolean;
  wooProductId: number | null;
  urlProductoWoo: string;
  urlAgregarAlCarroWoo: string;
}

interface RespuestaBuscadorInteligente {
  success: boolean;
  costoTokensGemini: number;
  consultaNormalizada: string;
  vehiculoDetectado: {
    patente: string;
    marca: string;
    modelo: string;
    anio?: number | null;
    motor?: string;
  } | null;
  totalCoincidencias: number;
  mostrando: number;
  carroWooCommerceSugerido: string;
  puenteWhatsapp: {
    telefonoWhatsapp: string;
    mensajePrellenado: string;
    urlWhatsapp: string;
    textoBoton: string;
  };
  data: ItemBuscadorPublico[];
}

const WHATSAPP_OFICIAL_FRP = '56927401059';

/**
 * Widget 100% WhatsApp-First + Buscador Automotriz Inteligente ($0 Tokens Gemini).
 * Se desactivó por completo el antiguo Chat Web: toda conversación con Repuestín
 * ocurre exclusivamente por WhatsApp (+56 9 2740 1059), capturando el teléfono del
 * cliente + su patente sin cobro de apertura de conversación en Meta.
 */
export default function ChatbotWidgetFlotante({
  modoIframeEmbebido = false,
  modoPaginaLimpia = false,
  abiertoPorDefecto = false,
  patenteInicial = '',
}: ChatbotWidgetFlotanteProps) {
  const [abierto, setAbierto] = useState(modoIframeEmbebido || modoPaginaLimpia || abiertoPorDefecto);
  const [consulta, setConsulta] = useState('');
  const [patente, setPatente] = useState(patenteInicial);
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaBuscadorInteligente | null>(null);

  useEffect(() => {
    if (patenteInicial && !patente) {
      setPatente(patenteInicial.toUpperCase());
    }
  }, [patenteInicial]);

  const construirUrlWhatsappDirecto = (textoExtra = '') => {
    const p = patente.trim().toUpperCase();
    const q = (textoExtra || consulta).trim();
    let msg = 'Hola Repuestín! 👋 Vengo desde facilrepuestos.cl.';
    if (q && p) {
      msg = `Hola Repuestín! 👋 Busco "${q}" para mi vehículo patente ${p}. ¿Me confirmas compatibilidad y me envías el carro de compra?`;
    } else if (q) {
      msg = `Hola Repuestín! 👋 Busco "${q}" y quiero confirmar compatibilidad con mi patente.`;
    } else if (p) {
      msg = `Hola Repuestín! 👋 Quiero cotizar un repuesto para mi vehículo patente ${p}.`;
    } else {
      msg = 'Hola Repuestín! 👋 Quiero cotizar un repuesto en FácilRepuestos.cl.';
    }
    return `https://wa.me/${WHATSAPP_OFICIAL_FRP}?text=${encodeURIComponent(msg)}`;
  };

  const ejecutarBusquedaDeterministica = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!consulta.trim() && !patente.trim()) {
      window.open(construirUrlWhatsappDirecto(), '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      setBuscando(true);
      const params = new URLSearchParams();
      if (consulta.trim()) params.set('q', consulta.trim());
      if (patente.trim()) params.set('patente', patente.trim().toUpperCase());
      params.set('limit', '6');

      const res = await api.get<RespuestaBuscadorInteligente>(
        `/public/buscador-inteligente?${params.toString()}`
      );
      if (res && res.success) {
        setResultado(res);
      }
    } catch {
      window.open(construirUrlWhatsappDirecto(), '_blank', 'noopener,noreferrer');
    } finally {
      setBuscando(false);
    }
  };

  const urlWspActiva = resultado?.puenteWhatsapp?.urlWhatsapp || construirUrlWhatsappDirecto();

  const contenidoCard = (
    <div
      className={
        modoPaginaLimpia
          ? styles.standaloneCard
          : modoIframeEmbebido
          ? styles.iframeCard
          : styles.floatingWindow
      }
    >
      {/* CABECERA OFICIAL WHATSAPP-FIRST */}
      <div className={styles.header} style={{ background: 'linear-gradient(135deg, #075e54 0%, #128c7e 100%)' }}>
        <div className={styles.headerBrand}>
          <div className={styles.avatarCircle}>📲</div>
          <div>
            <div className={styles.headerTitle}>
              Repuestín WhatsApp
              <span className={styles.onlineDot} title="Atención en línea por WhatsApp" />
            </div>
            <div className={styles.headerSubtitle}>
              FácilRepuestos.cl · Atención 100% por WhatsApp (+56 9 2740 1059)
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          {!modoIframeEmbebido && !modoPaginaLimpia && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setAbierto(false)}
              title="Minimizar"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* BARRA DE PATENTE */}
      <div className={styles.patenteBar}>
        <span className={styles.patenteLabel}>🚘 Tu Patente:</span>
        <input
          type="text"
          maxLength={6}
          placeholder="Ej: PDSS87"
          value={patente}
          onChange={(e) => setPatente(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          className={styles.patenteInput}
        />
        {resultado?.vehiculoDetectado ? (
          <span className={styles.vehiculoBadge}>
            ✓ {resultado.vehiculoDetectado.marca} {resultado.vehiculoDetectado.modelo}{' '}
            {resultado.vehiculoDetectado.anio || ''}
          </span>
        ) : (
          <span className={styles.patenteHint}>Cruza tu patente directo en WhatsApp</span>
        )}
      </div>

      {/* CUERPO: BUSCADOR RÁPIDO ($0 TOKENS) + BOTÓN DIRECTO WHATSAPP */}
      <div className={styles.messagesContainer} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 12,
            padding: '12px 14px',
            fontSize: '0.88rem',
            color: '#065f46',
          }}
        >
          <strong>💬 Atención exclusiva por WhatsApp Oficial:</strong> Busca tu repuesto aquí abajo para ver stock y carro inmediato en <strong>FácilRepuestos.cl</strong>, o abre directamente nuestro WhatsApp con tu patente lista.
        </div>

        <form onSubmit={ejecutarBusquedaDeterministica} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Ej: Pastillas de freno Changan CS15, kit embrague..."
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            className={styles.textInput}
            style={{
              flex: 1,
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          />
          <button
            type="submit"
            disabled={buscando}
            style={{
              background: '#0f172a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '0 14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {buscando ? '...' : '🔍 Buscar'}
          </button>
        </form>

        {/* RESULTADOS INSTANTÁNEOS CON LINK AL CARRO DE WOOCOMMERCE */}
        {resultado && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
              {resultado.data.length > 0
                ? `✅ ${resultado.totalCoincidencias} repuesto(s) disponible(s) en FácilRepuestos.cl:`
                : '🔎 No encontramos coincidencia exacta por texto — consúltalo directo en nuestro WhatsApp:'}
            </div>

            {resultado.data.map((item) => (
              <div
                key={item.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                  {item.nombre}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <span>
                    SKU: <code>{item.skuPublicoFrp || item.codigo}</code> · Marca: <strong>{item.fabricante || 'OEM'}</strong>
                  </span>
                  <strong style={{ color: '#047857', fontSize: '0.9rem' }}>
                    ${Number(item.precio || 0).toLocaleString('es-CL')} IVA inc.
                  </strong>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <a
                    href={item.urlAgregarAlCarroWoo}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      background: '#2563eb',
                      color: '#fff',
                      textDecoration: 'none',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                    }}
                  >
                    🛒 Agregar al Carro en FácilRepuestos.cl
                  </a>
                  <a
                    href={`https://wa.me/${WHATSAPP_OFICIAL_FRP}?text=${encodeURIComponent(
                      `Hola Repuestín! 👋 Quiero confirmar calce de ${item.nombre} (${item.skuPublicoFrp || item.codigo}) a $${Number(item.precio || 0).toLocaleString('es-CL')}${
                        patente ? ` para mi patente ${patente}` : ''
                      } y comprar.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: '#16a34a',
                      color: '#fff',
                      textDecoration: 'none',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                    }}
                  >
                    📲 Preguntar por WhatsApp
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* BOTÓN PRINCIPAL CLICK-TO-WHATSAPP */}
        <a
          href={urlWspActiva}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginTop: 'auto',
            background: '#25D366',
            color: '#fff',
            textDecoration: 'none',
            padding: '13px 16px',
            borderRadius: 10,
            fontWeight: 700,
            fontSize: '0.95rem',
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(37, 211, 102, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span>📲</span>
          <span>
            {resultado?.puenteWhatsapp?.textoBoton ||
              'Hablar con Repuestín por WhatsApp (+56 9 2740 1059)'}
          </span>
        </a>
      </div>
    </div>
  );

  if (modoPaginaLimpia) {
    return (
      <div className={styles.standalonePageWrapper}>
        {contenidoCard}
      </div>
    );
  }

  if (modoIframeEmbebido) {
    return contenidoCard;
  }

  return (
    <div className={styles.floatingRoot}>
      {abierto && contenidoCard}
      <button
        type="button"
        className={styles.launcherButton}
        style={{ background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)' }}
        onClick={() => setAbierto((v) => !v)}
        aria-label="Abrir buscador y WhatsApp de FácilRepuestos"
      >
        <span className={styles.launcherIcon}>{abierto ? '✕' : '📲'}</span>
        {!abierto && <span className={styles.launcherLabel}>WhatsApp Repuestín</span>}
      </button>
    </div>
  );
}
