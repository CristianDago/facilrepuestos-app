import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ordenesService } from '../../services/ordenes';
import { vehiculosService } from '../../services/vehiculos';
import { useAuth } from '../../contexts/AuthContext';
import type { OrdenTrabajo, TareaOT } from '../../types';
import shared from '../../styles/shared.module.css';
import styles from './VerOrden.module.css';

// ─── TAREAS PANEL ─────────────────────────────────────────
interface MecanicoOption { id: string; uid?: string; nombre: string; apellido: string; }

const API_URL = import.meta.env.VITE_API_URL;

const ESTADO_LABELS: Record<string, string> = {
  pendiente:  '⏳ Pendiente',
  en_proceso: '🔧 En proceso',
  completada: '✅ Completada',
};

function TareasPanel({ orden, onUpdate }: { orden: OrdenTrabajo; onUpdate: () => void }) {
  const { getToken, user } = useAuth();
  const [mecanicos,      setMecanicos]  = useState<MecanicoOption[]>([]);
  const [nuevaDesc,      setNuevaDesc]  = useState('');
  const [mecSeleccionado, setMec]       = useState('');
  const [saving,         setSaving]     = useState(false);
  const [updating,       setUpdating]   = useState<string | null>(null);
  const [showForm,       setShowForm]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/usuarios/mecanicos`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json();
        if (d.success) setMecanicos(d.data);
      } catch { /* sin lista de mecánicos */ }
    })();
  }, []);

  const authHeader = async () => {
    const token = await getToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };

  const agregarTarea = async () => {
    if (!nuevaDesc || !mecSeleccionado) return;
    setSaving(true);
    const mec     = mecanicos.find(m => m.id === mecSeleccionado);
    const headers = await authHeader();
    await fetch(`${API_URL}/api/ordenes/${orden.id}/tareas`, {
      method: 'POST', headers,
      body: JSON.stringify({
        descripcion:    nuevaDesc,
        mecanicoId:     mec?.uid || mecSeleccionado,
        mecanicoNombre: mec ? `${mec.nombre} ${mec.apellido}`.trim() : '',
      }),
    });
    setNuevaDesc(''); setMec(''); setShowForm(false); setSaving(false);
    onUpdate();
  };

  const eliminarTarea = async (tareaId: string) => {
    const headers = await authHeader();
    await fetch(`${API_URL}/api/ordenes/${orden.id}/tareas/${tareaId}`, {
      method: 'DELETE', headers,
    });
    onUpdate();
  };

  const cambiarEstadoTarea = async (tareaId: string, nuevoEstado: TareaOT['estado']) => {
    setUpdating(tareaId);
    const headers = await authHeader();
    await fetch(`${API_URL}/api/ordenes/${orden.id}/tareas/${tareaId}`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        estado:        nuevoEstado,
        usuarioNombre: user ? `${user.nombre} ${user.apellido}` : 'Admin',
        usuarioId:     user?.uid || '',
      }),
    });
    setUpdating(null);
    onUpdate();
  };

  const tareas      = orden.tareas || [];
  const completadas = tareas.filter(t => t.estado === 'completada').length;
  const total       = tareas.length;

  return (
    <div className={`print-hidden ${styles.tareasPanel}`}>
      {/* Header */}
      <div className={styles.tareasHeader}>
        <div className={styles.tareasHeaderLeft}>
          <div className={styles.tareasTitle}>👥 Tareas Asignadas</div>
          {total > 0 && (
            <div className={styles.tareasProgreso}>
              <div className={styles.progresoBar}>
                <div
                  className={styles.progresoFill}
                  style={{ width: `${total > 0 ? (completadas / total) * 100 : 0}%` }}
                />
              </div>
              <span className={styles.progresoLabel}>{completadas}/{total} completadas</span>
              {completadas === total && total > 0 && (
                <span className={styles.progresoListo}>✅ Todo listo</span>
              )}
            </div>
          )}
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancelar' : '+ Asignar Tarea'}
        </button>
      </div>

      {/* Formulario nueva tarea */}
      {showForm && (
        <div className={styles.tareaForm}>
          <input
            className={`form-input ${styles.tareaFormInput}`}
            placeholder="Descripción de la tarea..."
            value={nuevaDesc}
            onChange={e => setNuevaDesc(e.target.value)}
            autoFocus
          />
          <select
            className={`form-select ${styles.tareaFormSelect}`}
            value={mecSeleccionado}
            onChange={e => setMec(e.target.value)}
          >
            <option value="">Seleccionar mecánico...</option>
            {mecanicos.map(m => (
              <option key={m.id} value={m.id}>{m.nombre} {m.apellido}</option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={agregarTarea}
            disabled={saving || !nuevaDesc || !mecSeleccionado}
          >
            {saving ? '...' : 'Agregar'}
          </button>
        </div>
      )}

      {/* Lista de tareas */}
      {tareas.length === 0 ? (
        <div className={styles.tareasEmpty}>
          Sin tareas asignadas. Usa "+ Asignar Tarea" para agregar.
        </div>
      ) : (
        <div className={styles.tareasList}>
          {tareas.map(tarea => (
            <div
              key={tarea.id}
              className={`${styles.tareaCard} ${styles[tarea.estado] || ''}`}
            >
              <div className={styles.tareaRow}>
                <div className={`${styles.estadoDot} ${styles[tarea.estado] || ''}`} />
                <div className={styles.tareaInfo}>
                  <div className={styles.tareaDesc}>{tarea.descripcion}</div>
                  <div className={styles.tareaMecanico}>👤 {tarea.mecanicoNombre}</div>
                </div>
                <select
                  className={`${styles.tareaEstadoSelect} ${styles[tarea.estado] || ''}`}
                  value={tarea.estado}
                  disabled={updating === tarea.id}
                  onChange={e => cambiarEstadoTarea(tarea.id, e.target.value as TareaOT['estado'])}
                >
                  <option value="pendiente">⏳ Pendiente</option>
                  <option value="en_proceso">🔧 En proceso</option>
                  <option value="completada">✅ Completada</option>
                </select>
                <button
                  className={styles.tareaEliminar}
                  onClick={() => eliminarTarea(tarea.id)}
                  title="Eliminar tarea"
                >✕</button>
              </div>
              {(tarea as any).historial?.length > 0 && (
                <div className={styles.tareaHistorial}>
                  {((tarea as any).historial as any[]).map((h: any, hi: number) => (
                    <div key={hi} className={styles.tareaHistorialRow}>
                      <span className={styles.tareaHistorialArrow}>↳</span>
                      <span className={`${styles.historialEstado} ${styles[h.a] || ''}`}>
                        {ESTADO_LABELS[h.a] || h.a}
                      </span>
                      <span>· {h.usuarioNombre}</span>
                      <span>· {new Date(h.fecha).toLocaleString('es-CL', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {completadas === total && total > 0 && (
        <div className={styles.alertaTareasListas}>
          ✅ Todas las tareas completadas — puedes cambiar el estado de la OT a <strong>Listo</strong>
        </div>
      )}
    </div>
  );
}

// ─── VER ORDEN ────────────────────────────────────────────
const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const ESTADO_BADGE: Record<string, string> = {
  Recibido:     'badge-recibido',
  'En Proceso': 'badge-proceso',
  Listo:        'badge-listo',
  Entregado:    'badge-entregado',
};

export default function VerOrden() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [orden,    setOrden]    = useState<OrdenTrabajo | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [enviando, setEnviando] = useState<'WhatsApp' | 'Email' | 'Físico' | null>(null);

  useEffect(() => { if (id) loadOrden(); }, [id]);

  const loadOrden = async () => {
    try {
      const res = await ordenesService.getById(id!);
      if (res.success && res.data) {
        setOrden(res.data);
        try {
          const vRes = await vehiculosService.getByPatente(res.data.patente);
          if (vRes.success && vRes.data) {
            setOrden(prev => prev ? {
              ...prev,
              nombre:   vRes.data!.owner      || prev.nombre,
              telefono: vRes.data!.telefono   || prev.telefono,
              email:    (vRes.data as any).email || (prev as any).email,
              km:       vRes.data!.km         || prev.km,
            } : prev);
          }
        } catch { /* usar datos guardados */ }
      }
    } catch { console.error('Error'); }
    finally { setLoading(false); }
  };

  const registrarYEnviar = async (canal: 'WhatsApp' | 'Email' | 'Físico') => {
    if (!orden) return;
    setEnviando(canal);
    try {
      const res = await ordenesService.registrarEnvio(id!, canal);
      if (res.success && res.data) {
        setOrden(prev => prev ? { ...prev, envios: res.data!.envios } : prev);
      }
    } catch { console.error('Error registrando envío'); }
    finally { setEnviando(null); }

    if (canal === 'WhatsApp') {
      const texto = encodeURIComponent(
        `Estimado/a ${orden.nombre},\n\n` +
        `Su vehículo *${orden.patente}* está listo. ` +
        `La orden de trabajo *${orden.numero}* tiene un total de *${fmtCLP((orden as any).totalConIva || Math.round(orden.total * 1.19))}* (IVA incluido).\n\n` +
        `Fácil Repuestos · +56 9 2740 1059`
      );
      const tel     = (orden.telefono || '').replace(/[^\d]/g, '');
      const telFull = tel.startsWith('56') ? tel : tel.startsWith('9') ? `56${tel}` : tel;
      window.open(`https://wa.me/${telFull}?text=${texto}`, '_blank');
    } else if (canal === 'Email') {
      const emailCliente = (orden as any).email || '';
      const to      = encodeURIComponent(emailCliente);
      const subject = encodeURIComponent(`Orden de Trabajo ${orden.numero} - Fácil Repuestos`);
      const body    = encodeURIComponent(
        `Estimado/a ${orden.nombre},\n\n` +
        `Le informamos que su vehículo ${orden.patente} está listo.\n` +
        `Orden de trabajo ${orden.numero} · Total: ${fmtCLP((orden as any).totalConIva || Math.round(orden.total * 1.19))} (IVA incluido).\n\n` +
        `Fácil Repuestos\nTeléfono: +56 9 2740 1059\nWeb: www.facilrepuestos.cl`
      );
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`, '_blank');
    }
  };

  const handlePrint = async () => {
    if (!orden) return;
    const element = document.getElementById('cot-print-area');
    if (!element) return;

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      const canvas  = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.98);

      // PDF de alto variable — se ajusta al contenido, nunca corta
      const margin  = 10;                                          // mm
      const pdfW    = 210;                                         // A4 ancho en mm
      const imgW    = pdfW - margin * 2;
      const imgH    = (canvas.height * imgW) / canvas.width;      // alto proporcional
      const pdfH    = imgH + margin * 2;                          // alto del PDF = contenido + márgenes

      const pdf = new jsPDF({ unit: 'mm', format: [pdfW, pdfH], orientation: 'portrait' });
      pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
      pdf.save(`${orden.numero}-${orden.patente}.pdf`);
    } catch (err) {
      console.error('Error generando PDF:', err);
    }
  };

  if (loading) return <div className={styles.loading}>Cargando...</div>;
  if (!orden)  return <div className={styles.loading}>Orden no encontrada</div>;

  const totalTrabajos  = (orden.trabajos  || []).reduce((s, t) => s + (t.total || 0), 0);
  const totalRepuestos = (orden.repuestos || []).reduce((s, r) => s + (r.total || 0), 0)
    + ((orden as any).materialesExternos || []).reduce((s: number, m: any) => s + (m.total || 0), 0);
  const envios         = (orden as any).envios || [];
  const ultimoEnvio    = envios.length > 0 ? envios[envios.length - 1] : null;
  const waEnvios       = envios.filter((e: any) => e.canal === 'WhatsApp');
  const mailEnvios     = envios.filter((e: any) => e.canal === 'Email');
  const fisicoEnvios   = envios.filter((e: any) => e.canal === 'Físico');

  return (
    <div>
      {/* ── BARRA ACCIONES ─────────────────────────────────── */}
      <div className={`print-action-bar ${shared.actionBar}`}>
        <button className="btn btn-dark btn-sm" onClick={() => navigate('/ordenes')}>← Volver</button>
        <span className={shared.actionBarNumero}>{orden.numero}</span>
        <span className={`badge ${ESTADO_BADGE[orden.estado] || 'badge-entregado'}`}>{orden.estado}</span>

        {envios.length > 0 && (
          <div className={shared.actionBarEnvios}>
            <span className={shared.actionBarEnviosCnt}>
              {envios.length} envío{envios.length > 1 ? 's' : ''}
            </span>
            {waEnvios.length     > 0 && <span className={shared.actionBarWa}>💬×{waEnvios.length}</span>}
            {mailEnvios.length   > 0 && <span className={shared.actionBarMail}>✉×{mailEnvios.length}</span>}
            {fisicoEnvios.length > 0 && <span className={shared.actionBarFisico}>🤝×{fisicoEnvios.length}</span>}
            {ultimoEnvio && <span className={shared.actionBarUltimo}>· último {ultimoEnvio.fecha}</span>}
          </div>
        )}

        <div className={shared.actionBarSpacer} />

        <button
          className={`btn btn-dark btn-sm ${styles.btnWhatsapp} ${enviando === 'WhatsApp' ? styles.btnEnviando : ''}`}
          onClick={() => registrarYEnviar('WhatsApp')}
          disabled={enviando !== null}
        >
          {enviando === 'WhatsApp' ? '...' : '💬 WhatsApp'}
          {waEnvios.length > 0 && <span className={shared.actionBarBadgeEnvio}>✓×{waEnvios.length}</span>}
        </button>

        <button
          className={`btn btn-dark btn-sm ${enviando === 'Email' ? styles.btnEnviando : ''}`}
          onClick={() => registrarYEnviar('Email')}
          disabled={enviando !== null}
        >
          {enviando === 'Email' ? '...' : '✉ Email'}
          {mailEnvios.length > 0 && <span className={shared.actionBarBadgeEnvio}>✓×{mailEnvios.length}</span>}
        </button>

        <button
          className={`btn btn-dark btn-sm ${styles.btnFisico} ${enviando === 'Físico' ? styles.btnEnviando : ''}`}
          onClick={() => registrarYEnviar('Físico')}
          disabled={enviando !== null}
          title="Registrar entrega física en mano"
        >
          {enviando === 'Físico' ? '...' : '🤝 Físico'}
          {fisicoEnvios.length > 0 && <span className={shared.actionBarBadgeEnvio}>✓×{fisicoEnvios.length}</span>}
        </button>

        <button className="btn btn-primary btn-sm" onClick={handlePrint}>
          🖨 Imprimir / PDF
        </button>
      </div>

      {/* ── PANEL TAREAS ───────────────────────────────────── */}
      <TareasPanel orden={orden} onUpdate={loadOrden} />

      {/* ── DOCUMENTO ──────────────────────────────────────── */}
      <div id="cot-print-area" className={shared.docWrap}>

        <div className={shared.docTopbar}>
          <div className={shared.docTitulo}>
            ORDEN DE TRABAJO &nbsp;<strong>{orden.numero}</strong>
          </div>
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
            className={shared.docLogo}
          />
        </div>

        <div className={shared.docInfoGrid}>
          <div className={shared.docInfoCol}>
            <div className={shared.docInfoTitle}>Datos del Cliente</div>
            {([
              ['Nombre:',      orden.nombre   || '—'],
              ['Teléfono:',    orden.telefono || '—'],
              ['Marca:',       orden.marca    || '—'],
              ['Modelo:',      [orden.modelo, orden.anio].filter(Boolean).join(' ') || '—'],
              ['Patente:',     orden.patente],
              ['Kilometraje:', orden.km ? `${orden.km} km` : '—'],
              ['Ingreso:',     orden.fechaIngreso || '—'],
              ['Entrega:',     orden.fechaEntregaReal || orden.fechaEntregaEstimada || '—'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className={shared.docInfoRow}>
                <span className={shared.docInfoLabel}>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <div className={shared.docInfoColRight}>
            <div className={shared.docInfoTitle}>Datos de la Empresa</div>
            {([
              ['Nombre:',    'Fácil Repuestos'],
              ['Rut:',       '78295655-8'],
              ['Dirección:', 'Enrique Olivares #224'],
              ['Comuna:',    'La Florida'],
              ['Teléfono:',  '+56 9 2740 1059'],
              ['Web:',       'www.facilrepuestos.cl'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className={shared.docInfoRow}>
                <span className={shared.docInfoLabel}>{k}</span>
                <span className={
                  k === 'Nombre:' ? styles.empresaValorNombre
                  : k === 'Web:'  ? styles.empresaValorWeb
                  : styles.empresaValor
                }>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trabajos */}
        <div className={shared.docSectionTitle}>Servicios / Mano de Obra</div>
        <table className={shared.docTable}>
          <thead>
            <tr className={shared.docTheadRow}>
              <th className={`${styles.th} ${styles.docThServicio}`}>Servicio</th>
              <th className={`${styles.th} ${styles.docThPrecio}`}>Precio</th>
              <th className={`${styles.th} ${styles.docThCant}`}>Cant.</th>
              <th className={`${styles.th} ${styles.docThTotal}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(orden.trabajos || []).map((t, i) => (
              <tr key={i} className={shared.docTr}>
                <td className={shared.docTd}>
                  <div className={styles.itemNombre}>{t.descripcion}</div>
                  {(t as any).detalle && (
                    <div className={styles.itemDetalle}>
                      {(t as any).detalle}
                    </div>
                  )}
                </td>
                <td className={shared.docTdR}>{fmtCLP(t.precio)}</td>
                <td className={shared.docTdR}>{t.cantidad}</td>
                <td className={shared.docTdBold}>{fmtCLP(t.total)}</td>
              </tr>
            ))}
            {!(orden.trabajos || []).length && (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  Sin trabajos registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className={shared.docSubtotalBar}>
          <span className={shared.docSubtotalLbl}>Subtotal Servicios</span>
          <span className={shared.docSubtotalVal}>{fmtCLP(totalTrabajos)}</span>
        </div>

        {/* Repuestos e Insumos (unificado, igual que en Cotización) */}
        {(() => {
          const itemsUnificados = [
            ...(orden.repuestos || []).map(r => ({
              descripcion: r.nombre,
              precio:      r.precioUnitario,
              cantidad:    r.cantidad,
              total:       r.total,
            })),
            ...(((orden as any).materialesExternos || []).map((m: any) => ({
              descripcion: m.descripcion,
              precio:      m.precio,
              cantidad:    m.cantidad,
              total:       m.total,
            }))),
          ];
          if (itemsUnificados.length === 0) return null;
          return (
            <>
              <div className={shared.docSectionTitleMt}>Repuestos</div>
              <table className={shared.docTable}>
                <thead>
                  <tr className={shared.docTheadRow}>
                    <th className={`${styles.th} ${styles.docThRepuesto}`}>Repuesto</th>
                    <th className={`${styles.th} ${styles.docThPrecio}`}>Precio</th>
                    <th className={`${styles.th} ${styles.docThCantRep}`}>Cant.</th>
                    <th className={`${styles.th} ${styles.docThTotalRep}`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsUnificados.map((it, i) => (
                    <tr key={i} className={shared.docTr}>
                      <td className={shared.docTd}>{it.descripcion}</td>
                      <td className={shared.docTdR}>{fmtCLP(it.precio)}</td>
                      <td className={shared.docTdR}>{it.cantidad}</td>
                      <td className={shared.docTdBold}>{fmtCLP(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={shared.docSubtotalBar}>
                <span className={shared.docSubtotalLbl}>Subtotal Repuestos</span>
                <span className={shared.docSubtotalVal}>{fmtCLP(totalRepuestos)}</span>
              </div>
            </>
          );
        })()}

        {/* IVA + Descuento (solo si fue aplicado) */}
        {(() => {
          const descMonto = (orden as any).descuento || 0;
          const descPct   = (orden as any).descuentoPct || 0;
          const tipoDsc   = (orden as any).tipoDescuento;
          return (
            <div className={shared.docIvaBars}>
              {descMonto > 0 && (
                <div className={shared.docIvaRow}>
                  <span className={shared.docSubtotalLbl}>Subtotal (antes de descuento)</span>
                  <span className={shared.docSubtotalVal}>{fmtCLP(orden.total + descMonto)}</span>
                </div>
              )}
              {descMonto > 0 && (
                <div className={`${shared.docIvaRow} ${styles.descuentoRow}`}>
                  <span className={shared.docSubtotalLbl}>
                    Descuento {tipoDsc === 'porcentaje' && descPct > 0 ? `(${descPct}%)` : ''}
                  </span>
                  <span className={shared.docSubtotalVal}>− {fmtCLP(descMonto)}</span>
                </div>
              )}
              <div className={shared.docIvaRow}>
                <span className={shared.docSubtotalLbl}>{descMonto > 0 ? 'Subtotal Neto' : 'Subtotal'}</span>
                <span className={shared.docSubtotalVal}>{fmtCLP(orden.total)}</span>
              </div>
              <div className={shared.docIvaRow}>
                <span className={shared.docSubtotalLbl}>IVA 19%</span>
                <span className={shared.docSubtotalVal}>{fmtCLP(Math.round(orden.total * 0.19))}</span>
              </div>
            </div>
          );
        })()}

        {/* Total — neto si pagoSinIva, con IVA si no */}
        {(() => {
          const sinIva = (orden as any).pagoSinIva;
          return (
            <div className={shared.docTotalBar}>
              <span className={shared.docTotalLbl}>
                {sinIva ? 'TOTAL NETO (Sin IVA)' : 'TOTAL'}
              </span>
              <span className={shared.docTotalVal}>
                {sinIva ? fmtCLP(orden.total) : fmtCLP(Math.round(orden.total * 1.19))}
              </span>
            </div>
          );
        })()}

        {/* Método de pago + indicador sin IVA */}
        {(orden as any).metodoPago && (
          <div className={styles.pagoBar}>
            <span className={styles.pagoLabel}>
              Pago recibido
            </span>
            <span className={styles.pagoValor}>
              {(orden as any).metodoPago === 'Efectivo'      ? '💵' :
               (orden as any).metodoPago === 'Transferencia' ? '🏦' : '💳'
              }{' '}{(orden as any).metodoPago}
            </span>
            {(orden as any).pagoSinIva && (
              <span className={styles.pagoSinIvaBadge}>Sin IVA</span>
            )}
          </div>
        )}

        {/* Observaciones */}
        {orden.observaciones && (
          <div className={shared.docObs}>
            <div className={shared.docObsTitle}>Observaciones</div>
            <div className={shared.docObsText}>{orden.observaciones}</div>
          </div>
        )}

        {/* Firmas */}
        <div className={styles.firmasGrid}>
          <div className={styles.firmaLinea}>Firma Cliente</div>
          <div className={styles.firmaLinea}>Firma Taller</div>
        </div>

        {/* Footer */}
        <div className={shared.docFooter}>
          www.facilrepuestos.cl &nbsp;·&nbsp; +56 9 2740 1059 &nbsp;·&nbsp; Enrique Olivares #224, La Florida
        </div>
      </div>
    </div>
  );
}