import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type { ApiResponse } from '../../types';

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

export interface OperacionUnificadaCanal {
  id: string;
  canal: 'web_directo' | 'repuestin_wsp' | 'pos_olivares';
  canalLabel: string;
  codigo: string;
  fecha: string;
  cliente: string;
  contacto: string;
  detalle: string;
  modalidad: string;
  estado: string;
  totalNeto: number;
  totalConIva: number;
}

export interface ResumenCanalesVentaResponse {
  actualizadoEn: string;
  wooConfigurado: boolean;
  enConjunto: {
    totalVentasConIva: number;
    totalVentasNeto: number;
    totalOperaciones: number;
    totalUnidades: number;
    ticketPromedioConIva: number;
    participacionPct: {
      webDirecto: number;
      repuestinWsp: number;
      posOlivares: number;
    };
  };
  canales: {
    webDirecto: {
      id: string;
      nombre: string;
      subtitulo: string;
      totalVentasConIva: number;
      totalVentasNeto: number;
      totalPedidos: number;
      pedidosPagados: number;
      unidadesVendidas: number;
      ticketPromedioConIva: number;
      participacionPct: number;
    };
    repuestinWsp: {
      id: string;
      nombre: string;
      subtitulo: string;
      totalVentasConIva: number;
      totalVentasNeto: number;
      totalPedidos: number;
      conversacionesActivas24h: number;
      carritosCotizadosActivos: number;
      unidadesVendidas: number;
      ticketPromedioConIva: number;
      participacionPct: number;
    };
    posOlivares: {
      id: string;
      nombre: string;
      subtitulo: string;
      totalVentasConIva: number;
      totalVentasNeto: number;
      totalTickets: number;
      cotizacionesMeson: number;
      unidadesVendidas: number;
      ticketPromedioConIva: number;
      participacionPct: number;
      mediosPago: {
        EFECTIVO: number;
        TARJETA: number;
        TRANSFERENCIA: number;
      };
    };
  };
  operacionesUnificadas: OperacionUnificadaCanal[];
}

interface VentasCanalesProps {
  canalInicial?: 'todos' | 'web_directo' | 'repuestin_wsp' | 'pos_olivares';
}

export default function VentasCanalesOmnicanal({
  canalInicial = 'web_directo',
}: VentasCanalesProps) {
  const navigate = useNavigate();
  const { notify } = useAppStore();
  const [data, setData] = useState<ResumenCanalesVentaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [canalActivo, setCanalActivo] = useState<
    'todos' | 'web_directo' | 'repuestin_wsp' | 'pos_olivares'
  >(canalInicial);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    setCanalActivo(canalInicial);
  }, [canalInicial]);

  const cargarDatos = async () => {
    try {
      setLoading(true);
      const res = await api.get<ApiResponse<ResumenCanalesVentaResponse>>(
        '/woocommerce/canales-venta'
      );
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al cargar estadísticas de canales de venta', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const opsFiltradas = (data?.operacionesUnificadas || []).filter((op) => {
    if (canalActivo !== 'todos' && op.canal !== canalActivo) return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      op.codigo.toLowerCase().includes(q) ||
      op.cliente.toLowerCase().includes(q) ||
      op.detalle.toLowerCase().includes(q) ||
      op.contacto.toLowerCase().includes(q)
    );
  });

  const web = data?.canales.webDirecto;
  const wsp = data?.canales.repuestinWsp;
  const pos = data?.canales.posOlivares;
  const conj = data?.enConjunto;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabecera */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>
            {canalActivo === 'web_directo'
              ? '🌐 Estadísticas Ventas Web WordPress (Directo en facilrepuestos.cl)'
              : canalActivo === 'pos_olivares'
              ? '🏪 Estadísticas Ventas POS — Sucursal Enrique Olivares 224'
              : canalActivo === 'repuestin_wsp'
              ? '🤖 Estadísticas Ventas Repuestín WhatsApp (+56 9 2110 9851)'
              : '📊 Consolidado de los 3 Canales de Venta (Web Directo + Repuestín WSP + POS Olivares 224)'}
          </div>
          <div style={{ fontSize: '0.86rem', color: '#cbd5e1', marginTop: 4 }}>
            {canalActivo === 'web_directo'
              ? 'Compras realizadas directamente en WordPress / WooCommerce que NO pasaron por Repuestín WhatsApp.'
              : canalActivo === 'pos_olivares'
              ? 'Ventas de mesón y bodega registradas en Enrique Olivares 224, La Florida.'
              : 'Relación en vivo por separado y en conjunto de tus 3 canales de venta.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={cargarDatos}
            disabled={loading}
          >
            {loading ? '↻ Actualizando...' : '↻ Actualizar'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => navigate('/pos')}
          >
            🛒 Abrir Caja POS Olivares 224
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#16a34a', color: '#fff', fontWeight: 700 }}
            onClick={() => navigate('/agente-omnicanal')}
          >
            🤖 Ir a Repuestín WSP
          </button>
        </div>
      </div>

      {/* Bloque Consolidado En Conjunto */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
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
            <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
              Consolidado Total (Los 3 Canales en Conjunto)
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 900, color: '#0f172a' }}>
              {fmtCLP(conj?.totalVentasConIva || 0)}{' '}
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#64748b' }}>
                IVA inc. ({fmtCLP(conj?.totalVentasNeto || 0)} neto)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 700 }}>
                TOTAL OPERACIONES
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                {conj?.totalOperaciones || 0} ventas
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 700 }}>
                UNIDADES VENDIDAS
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                {conj?.totalUnidades || 0} repuestos
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 700 }}>
                TICKET PROMEDIO GLOBAL
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0284c7' }}>
                {fmtCLP(conj?.ticketPromedioConIva || 0)}
              </div>
            </div>
          </div>
        </div>

        {/* Barra de relación proporcional entre los 3 canales */}
        <div
          style={{
            height: 12,
            borderRadius: 999,
            background: '#f1f5f9',
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            style={{
              width: `${conj?.participacionPct.webDirecto || 0}%`,
              background: '#2563eb',
              transition: 'width 0.3s',
            }}
            title={`Web WordPress Directo: ${conj?.participacionPct.webDirecto || 0}%`}
          />
          <div
            style={{
              width: `${conj?.participacionPct.repuestinWsp || 0}%`,
              background: '#16a34a',
              transition: 'width 0.3s',
            }}
            title={`Repuestín WhatsApp: ${conj?.participacionPct.repuestinWsp || 0}%`}
          />
          <div
            style={{
              width: `${conj?.participacionPct.posOlivares || 0}%`,
              background: '#ea580c',
              transition: 'width 0.3s',
            }}
            title={`POS Enrique Olivares 224: ${conj?.participacionPct.posOlivares || 0}%`}
          />
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '0.78rem', color: '#475569' }}>
          <span>
            <strong style={{ color: '#2563eb' }}>● Web Directo WordPress:</strong>{' '}
            {conj?.participacionPct.webDirecto || 0}% ({web?.totalPedidos || 0} compras)
          </span>
          <span>
            <strong style={{ color: '#16a34a' }}>● Repuestín WhatsApp:</strong>{' '}
            {conj?.participacionPct.repuestinWsp || 0}% ({wsp?.totalPedidos || 0} pedidos)
          </span>
          <span>
            <strong style={{ color: '#ea580c' }}>● POS Enrique Olivares 224:</strong>{' '}
            {conj?.participacionPct.posOlivares || 0}% ({pos?.totalTickets || 0} tickets)
          </span>
        </div>
      </div>

      {/* Las 3 Tarjetas de los Canales por Separado */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: 14,
        }}
      >
        {/* Canal 1: WordPress Directo */}
        <div
          onClick={() => setCanalActivo('web_directo')}
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 18,
            cursor: 'pointer',
            border:
              canalActivo === 'web_directo'
                ? '2px solid #2563eb'
                : '1px solid #e2e8f0',
            boxShadow:
              canalActivo === 'web_directo'
                ? '0 6px 20px rgba(37,99,235,0.12)'
                : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 800,
                background: '#dbeafe',
                color: '#1d4ed8',
                padding: '3px 9px',
                borderRadius: 999,
              }}
            >
              CANAL 1 · WEB DIRECTO WORDPRESS
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2563eb' }}>
              {web?.participacionPct || 0}% del total
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginTop: 10 }}>
            {fmtCLP(web?.totalVentasConIva || 0)}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
            Compras directas en <strong>facilrepuestos.cl</strong> (sin pasar por Repuestín)
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid #f1f5f9',
              fontSize: '0.78rem',
              color: '#334155',
            }}
          >
            <span>
              <strong>{web?.totalPedidos || 0}</strong> pedidos web
            </span>
            <span>
              <strong>{web?.unidadesVendidas || 0}</strong> un.
            </span>
            <span>Ticket: {fmtCLP(web?.ticketPromedioConIva || 0)}</span>
          </div>
        </div>

        {/* Canal 2: Repuestín WhatsApp */}
        <div
          onClick={() => setCanalActivo('repuestin_wsp')}
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 18,
            cursor: 'pointer',
            border:
              canalActivo === 'repuestin_wsp'
                ? '2px solid #16a34a'
                : '1px solid #e2e8f0',
            boxShadow:
              canalActivo === 'repuestin_wsp'
                ? '0 6px 20px rgba(22,163,74,0.12)'
                : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 800,
                background: '#dcfce7',
                color: '#15803d',
                padding: '3px 9px',
                borderRadius: 999,
              }}
            >
              CANAL 2 · REPUESTÍN WHATSAPP
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a' }}>
              {wsp?.participacionPct || 0}% del total
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginTop: 10 }}>
            {fmtCLP(wsp?.totalVentasConIva || 0)}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
            Ventas y carros generados por <strong>Repuestín (+56 9 2110 9851)</strong>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid #f1f5f9',
              fontSize: '0.78rem',
              color: '#334155',
            }}
          >
            <span>
              <strong>{wsp?.totalPedidos || 0}</strong> órdenes WSP
            </span>
            <span>
              <strong>{wsp?.conversacionesActivas24h || 0}</strong> chats activos
            </span>
            <span>Ticket: {fmtCLP(wsp?.ticketPromedioConIva || 0)}</span>
          </div>
        </div>

        {/* Canal 3: POS Enrique Olivares 224 */}
        <div
          onClick={() => setCanalActivo('pos_olivares')}
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 18,
            cursor: 'pointer',
            border:
              canalActivo === 'pos_olivares'
                ? '2px solid #ea580c'
                : '1px solid #e2e8f0',
            boxShadow:
              canalActivo === 'pos_olivares'
                ? '0 6px 20px rgba(234,88,12,0.12)'
                : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 800,
                background: '#ffedd5',
                color: '#c2410c',
                padding: '3px 9px',
                borderRadius: 999,
              }}
            >
              CANAL 3 · POS ENRIQUE OLIVARES 224
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#ea580c' }}>
              {pos?.participacionPct || 0}% del total
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginTop: 10 }}>
            {fmtCLP(pos?.totalVentasConIva || 0)}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
            Ventas de mesón y retiro en <strong>Enrique Olivares 224, La Florida</strong>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid #f1f5f9',
              fontSize: '0.78rem',
              color: '#334155',
            }}
          >
            <span>
              <strong>{pos?.totalTickets || 0}</strong> tickets POS
            </span>
            <span>
              <strong>{pos?.unidadesVendidas || 0}</strong> un.
            </span>
            <span>Ticket: {fmtCLP(pos?.ticketPromedioConIva || 0)}</span>
          </div>
        </div>
      </div>

      {/* Selector de pestaña + Buscador + Tabla de Operaciones */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['todos', `📊 Los 3 Canales en Conjunto (${data?.operacionesUnificadas.length || 0})`],
                ['web_directo', `🌐 1. Web WordPress Directo (${web?.totalPedidos || 0})`],
                ['repuestin_wsp', `🤖 2. Repuestín WhatsApp (${wsp?.totalPedidos || 0})`],
                ['pos_olivares', `🏪 3. POS Enrique Olivares 224 (${pos?.totalTickets || 0})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${canalActivo === key ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setCanalActivo(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Buscar por pedido, cliente, repuesto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: '0.84rem',
              minWidth: 240,
            }}
          />
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Canal de Venta</th>
                <th>N° / Código</th>
                <th>Fecha</th>
                <th>Cliente / Contacto</th>
                <th>Repuestos</th>
                <th>Modalidad / Sucursal</th>
                <th className="r">Total (IVA inc.)</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {opsFiltradas.map((op) => (
                <tr key={op.id}>
                  <td>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background:
                          op.canal === 'web_directo'
                            ? '#dbeafe'
                            : op.canal === 'repuestin_wsp'
                            ? '#dcfce7'
                            : '#ffedd5',
                        color:
                          op.canal === 'web_directo'
                            ? '#1d4ed8'
                            : op.canal === 'repuestin_wsp'
                            ? '#15803d'
                            : '#c2410c',
                      }}
                    >
                      {op.canalLabel}
                    </span>
                  </td>
                  <td style={{ fontWeight: 800, fontFamily: 'monospace' }}>{op.codigo}</td>
                  <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    {op.fecha ? new Date(op.fecha).toLocaleString('es-CL') : '—'}
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem' }}>{op.cliente}</div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{op.contacto}</div>
                  </td>
                  <td style={{ fontSize: '0.8rem', maxWidth: 280 }}>{op.detalle}</td>
                  <td style={{ fontSize: '0.78rem', color: '#334155' }}>{op.modalidad}</td>
                  <td className="r" style={{ fontWeight: 800, color: '#0f172a' }}>
                    {fmtCLP(op.totalConIva)}
                  </td>
                  <td>
                    <span className="badge badge-sold">{op.estado}</span>
                  </td>
                </tr>
              ))}
              {opsFiltradas.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#64748b' }}>
                    {loading
                      ? 'Cargando operaciones de los canales de venta...'
                      : 'Sin ventas registradas todavía en el filtro seleccionado.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
