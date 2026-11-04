import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cotizacionesService } from '../../services/cotizaciones';
import { vehiculosService } from '../../services/vehiculos';
import type { Cotizacion } from '../../types';
import shared from '../../styles/shared.module.css';
import styles from './VerCotizacion.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const ESTADO_BADGE: Record<string, string> = {
  Borrador:  'badge-entregado',
  Enviada:   'badge-recibido',
  Aprobada:  'badge-sold',
  Rechazada: 'badge-pending',
};

export default function VerCotizacion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cot,      setCot]      = useState<Cotizacion | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [enviando, setEnviando] = useState<'WhatsApp' | 'Email' | null>(null);

  useEffect(() => { if (id) loadCotizacion(); }, [id]);

  const loadCotizacion = async () => {
    try {
      const res = await cotizacionesService.getById(id!);
      if (res.success && res.data) {
        setCot(res.data);
        try {
          const vRes = await vehiculosService.getByPatente(res.data.patente);
          if (vRes.success && vRes.data) {
            setCot(prev => prev ? {
              ...prev,
              nombre:   vRes.data!.owner    || prev.nombre,
              telefono: vRes.data!.telefono || prev.telefono,
              email:    vRes.data!.email    || prev.email,
            } : prev);
          }
        } catch { /* usar datos guardados */ }
      }
    } catch { console.error('Error'); }
    finally { setLoading(false); }
  };

  const registrarYEnviar = async (canal: 'WhatsApp' | 'Email') => {
    if (!cot) return;
    setEnviando(canal);
    try {
      const res = await cotizacionesService.registrarEnvio(id!, canal);
      if (res.success && res.data) {
        setCot(prev => prev ? {
          ...prev,
          envios: res.data!.envios,
          estado: prev.estado === 'Borrador' ? 'Enviada' : prev.estado,
        } : prev);
      }
    } catch { console.error('Error registrando envío'); }
    finally { setEnviando(null); }

    if (canal === 'WhatsApp') {
      const texto = encodeURIComponent(
        `Estimado/a ${cot.nombre},\n\n` +
        `Adjuntamos la cotización *${cot.numero}* por un total de *${fmtCLP((cot as any).totalConIva || Math.round(cot.total * 1.19))}* (IVA incluido).\n\n` +
        `Quedamos atentos a su respuesta.\n\nFácil Repuestos · +56 9 2740 1059`
      );
      const tel     = (cot.telefono || '').replace(/[^\d]/g, '');
      const telFull = tel.startsWith('56') ? tel : tel.startsWith('9') ? `56${tel}` : tel;
      window.open(`https://wa.me/${telFull}?text=${texto}`, '_blank');
    } else {
      const to      = encodeURIComponent(cot.email || '');
      const subject = encodeURIComponent(`Cotización ${cot.numero} - Fácil Repuestos`);
      const body    = encodeURIComponent(
        `Estimado/a ${cot.nombre},\n\n` +
        `Adjuntamos la cotización ${cot.numero} por un total de ${fmtCLP((cot as any).totalConIva || Math.round(cot.total * 1.19))} (IVA incluido).\n\n` +
        `Quedamos atentos a su respuesta.\n\nFácil Repuestos\nTeléfono: +56 9 2740 1059\nWeb: www.facilrepuestos.cl`
      );
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`, '_blank');
    }
  };

  const handlePrint = async () => {
    if (!cot) return;
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
      pdf.save(`${cot.numero}-${cot.patente}.pdf`);
    } catch (err) {
      console.error('Error generando PDF:', err);
    }
  };

  if (loading) return <div className={styles.loading}>Cargando...</div>;
  if (!cot)    return <div className={styles.loading}>Cotización no encontrada</div>;

  const condLines         = (cot.condiciones || '').split('\n').filter(l => l.trim());
  const totalManoObra     = (cot.servicios || []).reduce((s, r) => s + (r.total || 0), 0);
  const totalRepuestos    = (cot.costos    || []).reduce((s, c) => s + ((c.precioVenta || 0) * c.cantidad), 0);
  const repuestosVisibles = (cot.costos    || []).filter(c => (c.precioVenta || 0) > 0);
  const envios            = cot.envios || [];
  const ultimoEnvio       = envios.length > 0 ? envios[envios.length - 1] : null;
  const whatsappEnvios    = envios.filter(e => e.canal === 'WhatsApp');
  const emailEnvios       = envios.filter(e => e.canal === 'Email');

  return (
    <div>
      {/* ── BARRA ACCIONES ─────────────────────────────────── */}
      <div className={`print-action-bar ${shared.actionBar}`}>
        <button className="btn btn-dark btn-sm" onClick={() => navigate('/cotizaciones')}>← Volver</button>
        <span className={shared.actionBarNumero}>{cot.numero}</span>
        <span className={`badge ${ESTADO_BADGE[cot.estado] || 'badge-entregado'}`}>
          {envios.length > 1 ? 'Reenviada' : cot.estado}
        </span>

        {envios.length > 0 && (
          <div className={shared.actionBarEnvios}>
            <span className={shared.actionBarEnviosCnt}>
              {envios.length} envío{envios.length > 1 ? 's' : ''}
            </span>
            {whatsappEnvios.length > 0 && (
              <span className={shared.actionBarWa}>💬×{whatsappEnvios.length}</span>
            )}
            {emailEnvios.length > 0 && (
              <span className={shared.actionBarMail}>✉×{emailEnvios.length}</span>
            )}
            {ultimoEnvio && (
              <span className={shared.actionBarUltimo}>· último {ultimoEnvio.fecha}</span>
            )}
          </div>
        )}

        <div className={shared.actionBarSpacer} />

        <button
          className={`btn btn-dark btn-sm ${styles.btnWhatsapp} ${enviando === 'WhatsApp' ? styles.btnEnviando : ''}`}
          onClick={() => registrarYEnviar('WhatsApp')}
          disabled={enviando !== null}
        >
          {enviando === 'WhatsApp' ? '...' : '💬 WhatsApp'}
          {whatsappEnvios.length > 0 && (
            <span className={shared.actionBarBadgeEnvio}>✓×{whatsappEnvios.length}</span>
          )}
        </button>

        <button
          className={`btn btn-dark btn-sm ${enviando === 'Email' ? styles.btnEnviando : ''}`}
          onClick={() => registrarYEnviar('Email')}
          disabled={enviando !== null}
        >
          {enviando === 'Email' ? '...' : '✉ Email'}
          {emailEnvios.length > 0 && (
            <span className={shared.actionBarBadgeEnvio}>✓×{emailEnvios.length}</span>
          )}
        </button>

        <button className="btn btn-primary btn-sm" onClick={handlePrint}>
          ⬇ Descargar PDF
        </button>
      </div>

      {/* ── DOCUMENTO ──────────────────────────────────────── */}
      <div id="cot-print-area" className={shared.docWrap}>

        {/* Header corporativo */}
        <div className={shared.docTopbar}>
          <div className={shared.docTitulo}>
            COTIZACIÓN &nbsp;<strong>{cot.numero}</strong>
          </div>
          <img
            src="/logo-facil-repuestos.webp"
            alt="Fácil Repuestos"
            className={shared.docLogo}
          />
        </div>

        {/* Info grid */}
        <div className={shared.docInfoGrid}>
          <div className={shared.docInfoCol}>
            <div className={shared.docInfoTitle}>Datos del Cliente</div>
            {([
              ['Nombre:',   cot.nombre   || '—'],
              ['Correo:',   cot.email    || '—'],
              ['Teléfono:', cot.telefono || '—'],
              ['Marca:',    cot.marca    || '—'],
              ['Modelo:',   [cot.modelo, cot.anio].filter(Boolean).join(' ') || '—'],
              ['Patente:',  cot.patente],
              ['Fecha:',    cot.fecha],
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

        {/* Servicios */}
        <div className={shared.docSectionTitle}>Servicios / Mano de Obra</div>
        <table className={shared.docTable}>
          <thead>
            <tr className={shared.docTheadRow}>
              <th className={`${styles.th} ${styles.docThDesc}`}>Descripción</th>
              <th className={`${styles.th} ${styles.docThPrecio}`}>Precio</th>
              <th className={`${styles.th} ${styles.docThCant}`}>Cant.</th>
              <th className={`${styles.th} ${styles.docThTotal}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(cot.servicios || []).map((s, i) => (
              <tr key={i} className={shared.docTr}>
                <td className={shared.docTd}>
                  <div className={styles.itemNombre}>{s.descripcion}</div>
                  {(s as any).detalle && (
                    <div className={styles.itemDetalle}>
                      {(s as any).detalle}
                    </div>
                  )}
                </td>
                <td className={shared.docTdR}>{fmtCLP(s.precio)}</td>
                <td className={shared.docTdR}>{s.cantidad}</td>
                <td className={shared.docTdBold}>{fmtCLP(s.total)}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 6 - (cot.servicios || []).length) }).map((_, i) => (
              <tr key={`e-${i}`} className={shared.docTrVacio}>
                <td className={shared.docTd}></td><td></td><td></td><td></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={shared.docSubtotalBar}>
          <span className={shared.docSubtotalLbl}>Subtotal Servicios</span>
          <span className={shared.docSubtotalVal}>{fmtCLP(totalManoObra)}</span>
        </div>

        {/* Repuestos */}
        {repuestosVisibles.length > 0 && (
          <>
            <div className={shared.docSectionTitleMt}>Repuestos</div>
            <table className={shared.docTable}>
              <thead>
                <tr className={shared.docTheadRow}>
                  <th className={`${styles.th} ${styles.docThDesc}`}>Repuesto</th>
                  <th className={`${styles.th} ${styles.docThPrecio}`}>Precio</th>
                  <th className={`${styles.th} ${styles.docThCant}`}>Cant.</th>
                  <th className={`${styles.th} ${styles.docThTotal}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {repuestosVisibles.map((c, i) => (
                  <tr key={i} className={shared.docTr}>
                    <td className={shared.docTd}>{c.descripcion}</td>
                    <td className={shared.docTdR}>{fmtCLP(c.precioVenta || 0)}</td>
                    <td className={shared.docTdR}>{c.cantidad}</td>
                    <td className={shared.docTdBold}>{fmtCLP((c.precioVenta || 0) * c.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={shared.docSubtotalBar}>
              <span className={shared.docSubtotalLbl}>Subtotal Repuestos</span>
              <span className={shared.docSubtotalVal}>{fmtCLP(totalRepuestos)}</span>
            </div>
          </>
        )}

        {/* IVA + Descuento (solo si fue aplicado) */}
        {(() => {
          const descMonto = (cot as any).descuento || 0;
          const descPct   = (cot as any).descuentoPct || 0;
          const tipoDsc   = (cot as any).tipoDescuento;
          return (
            <div className={shared.docIvaBars}>
              {descMonto > 0 && (
                <div className={shared.docIvaRow}>
                  <span className={shared.docSubtotalLbl}>Subtotal (antes de descuento)</span>
                  <span className={shared.docSubtotalVal}>{fmtCLP(cot.total + descMonto)}</span>
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
                <span className={shared.docSubtotalLbl}>Subtotal</span>
                <span className={shared.docSubtotalVal}>{fmtCLP(cot.total)}</span>
              </div>
              <div className={shared.docIvaRow}>
                <span className={shared.docSubtotalLbl}>IVA 19%</span>
                <span className={shared.docSubtotalVal}>{fmtCLP(Math.round(cot.total * 0.19))}</span>
              </div>
            </div>
          );
        })()}

        {/* Total */}
        <div className={shared.docTotalBar}>
          <span className={shared.docTotalLbl}>TOTAL</span>
          <span className={shared.docTotalVal}>{fmtCLP(Math.round(cot.total * 1.19))}</span>
        </div>

        {/* Observaciones */}
        {cot.observaciones && (
          <div className={shared.docObs}>
            <div className={shared.docObsTitle}>Observaciones</div>
            <div className={shared.docObsText}>{cot.observaciones}</div>
          </div>
        )}

        {/* Condiciones */}
        {condLines.length > 0 && (
          <div className={shared.docCondiciones}>
            {condLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}

        {/* Footer */}
        <div className={shared.docFooter}>
          www.facilrepuestos.cl &nbsp;·&nbsp; +56 9 2740 1059 &nbsp;·&nbsp; Enrique Olivares #224, La Florida
        </div>
      </div>
    </div>
  );
}