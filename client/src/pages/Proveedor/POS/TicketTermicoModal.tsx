import { useRef, useState } from 'react';
import type { VentaPOSRegistrada } from '../../../services/pos';
import styles from './TicketTermicoModal.module.css';

interface TicketTermicoModalProps {
  venta: VentaPOSRegistrada;
  nombreLocal?: string;
  direccionLocal?: string;
  onCerrar: () => void;
}

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

export default function TicketTermicoModal({
  venta,
  nombreLocal = 'FACIL REPUESTOS',
  direccionLocal = 'Santiago, Chile',
  onCerrar,
}: TicketTermicoModalProps) {
  const ticketRef = useRef<HTMLDivElement>(null);
  const [anchoPapel, setAnchoPapel] = useState<'80mm' | '58mm'>('80mm');

  /**
   * Imprime el ticket en un iframe aislado con dimensiones exactas para
   * impresoras térmicas Xprinter XP-80 (80mm rollo = 72mm área imprimible) o 58mm (48mm área imprimible).
   * Esto evita que el contenedor modal/overlay de React oculte o desplace el ticket en la vista previa de Chrome.
   */
  const handlePrint = () => {
    const ticketHtml = ticketRef.current?.innerHTML;
    if (!ticketHtml) {
      window.print();
      return;
    }

    const pageWidth = anchoPapel === '80mm' ? '72mm' : '48mm';
    const contentWidth = anchoPapel === '80mm' ? '68mm' : '46mm';
    const baseFontSize = anchoPapel === '80mm' ? '12px' : '10px';

    // Remover iframe previo si existe
    const prevIframe = document.getElementById('xp80-thermal-print-frame');
    if (prevIframe) {
      prevIframe.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'xp80-thermal-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Ticket ${venta.numeroTicket}</title>
  <style>
    @page {
      size: ${pageWidth} auto;
      margin: 0mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${pageWidth};
      background: #ffffff !important;
      color: #000000 !important;
      font-family: 'Courier New', Courier, monospace;
      font-size: ${baseFontSize};
      line-height: 1.3;
      font-weight: 600;
    }
    .xp80-ticket-root {
      width: ${contentWidth};
      max-width: ${contentWidth};
      margin: 0 auto;
      padding: 2mm 1mm 6mm 1mm;
      color: #000000;
      background: #ffffff;
    }
    img {
      max-height: 36px;
      width: auto;
      display: block;
      margin: 0 auto 4px auto;
      filter: grayscale(100%) contrast(180%);
    }
    /* Mapear clases equivalentes del módulo CSS para que dentro del iframe luzcan idénticas */
    [class*="ticketHeader"] {
      text-align: center;
      margin-bottom: 8px;
    }
    [class*="localNombre"] {
      font-size: 15px;
      font-weight: 900;
      text-transform: uppercase;
      margin-bottom: 2px;
      color: #000;
    }
    [class*="localSub"] {
      font-size: 11px;
      color: #000;
    }
    [class*="dividerDouble"] {
      border-top: 2px solid #000;
      margin: 7px 0;
    }
    [class*="divider"]:not([class*="dividerDouble"]) {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    [class*="ticketMeta"] {
      font-size: 11px;
      margin-bottom: 6px;
    }
    [class*="metaRow"] {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      margin-bottom: 2px;
    }
    [class*="tableHeader"] {
      display: flex;
      justify-content: space-between;
      font-weight: 900;
      font-size: 11px;
      padding-bottom: 3px;
      border-bottom: 1px dashed #000;
      margin-bottom: 5px;
    }
    [class*="itemRow"] {
      margin-bottom: 6px;
    }
    [class*="itemDesc"] {
      font-weight: 800;
      font-size: 11.5px;
      word-break: break-word;
      color: #000;
    }
    [class*="itemSub"] {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #000;
      margin-top: 1px;
    }
    [class*="totalesSection"] {
      margin-top: 6px;
    }
    [class*="totalRow"] {
      display: flex;
      justify-content: space-between;
      font-size: 11.5px;
      margin-bottom: 2px;
      color: #000;
    }
    [class*="totalGrande"] {
      font-size: 15px;
      font-weight: 900;
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1.5px solid #000;
      color: #000;
    }
    [class*="ticketFooter"] {
      text-align: center;
      font-size: 10.5px;
      margin-top: 10px;
      padding-bottom: 4mm;
      color: #000;
    }
    [class*="ticketAgradecimiento"] {
      font-weight: 900;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="xp80-ticket-root">${ticketHtml}</div>
</body>
</html>`);
    doc.close();

    // Esperar a que cargue el logo antes de lanzar el diálogo de impresión
    const triggerPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Error al imprimir en iframe térmico:', err);
        window.print();
      }
    };

    const imgs = doc.querySelectorAll('img');
    if (imgs.length === 0) {
      setTimeout(triggerPrint, 80);
    } else {
      let loaded = 0;
      let printed = false;
      const done = () => {
        if (printed) return;
        printed = true;
        setTimeout(triggerPrint, 60);
      };
      imgs.forEach((img) => {
        if (img.complete) {
          loaded++;
          if (loaded === imgs.length) done();
        } else {
          img.onload = () => {
            loaded++;
            if (loaded === imgs.length) done();
          };
          img.onerror = () => {
            loaded++;
            if (loaded === imgs.length) done();
          };
        }
      });
      setTimeout(done, 400);
    }
  };

  const fechaFormateada = new Date(venta.fecha).toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const esCotizacion = venta.tipoDocumento === 'COTIZACION';

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <span>{esCotizacion ? '📋 Cotización Generada' : '🧾 Venta Realizada'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '6px', padding: '2px', fontSize: '0.72rem' }}>
              <button
                type="button"
                onClick={() => setAnchoPapel('80mm')}
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '3px 7px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: anchoPapel === '80mm' ? '#0284c7' : 'transparent',
                  color: anchoPapel === '80mm' ? '#fff' : '#475569',
                }}
                title="Rollo térmico 80mm (Xprinter XP-80 / 72mm imprimible)"
              >
                80mm (XP-80)
              </button>
              <button
                type="button"
                onClick={() => setAnchoPapel('58mm')}
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '3px 7px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: anchoPapel === '58mm' ? '#0284c7' : 'transparent',
                  color: anchoPapel === '58mm' ? '#fff' : '#475569',
                }}
                title="Rollo térmico 58mm (48mm imprimible)"
              >
                58mm
              </button>
            </div>
            <button className={styles.closeBtn} onClick={onCerrar} title="Cerrar">✕</button>
          </div>
        </div>

        <div className={styles.previewWrap}>
          {/* El contenedor que captura la impresora térmica */}
          <div ref={ticketRef} className={`${styles.ticketContainer} ${styles.printOnlyArea}`}>
            <div className={styles.ticketHeader}>
              <img
                src="/ico-facil-repuestos.webp"
                alt="Fácil Repuestos"
                style={{ height: '38px', objectFit: 'contain', margin: '0 auto 4px', display: 'block' }}
              />
              <div className={styles.localNombre}>{nombreLocal}</div>
              <div className={styles.localSub}>{direccionLocal}</div>
              <div className={styles.dividerDouble} />
              <div style={{ fontWeight: 800, fontSize: '13px', textTransform: 'uppercase' }}>
                {esCotizacion ? 'COMPROBANTE DE COTIZACIÓN' : 'TICKET DE VENTA'}
              </div>
            </div>

            <div className={styles.ticketMeta}>
              <div className={styles.metaRow}>
                <span>N° Ticket:</span>
                <strong>{venta.numeroTicket}</strong>
              </div>
              <div className={styles.metaRow}>
                <span>Fecha:</span>
                <span>{fechaFormateada}</span>
              </div>
              <div className={styles.metaRow}>
                <span>Atendido por:</span>
                <span>{venta.vendedorNombre}</span>
              </div>

              {venta.cliente?.nombre && (
                <div className={styles.metaRow}>
                  <span>Cliente:</span>
                  <span>{venta.cliente.nombre}</span>
                </div>
              )}
              {venta.cliente?.patente && (
                <div className={styles.metaRow}>
                  <span>Patente:</span>
                  <strong>{venta.cliente.patente.toUpperCase()}</strong>
                </div>
              )}
              {venta.cliente?.rut && (
                <div className={styles.metaRow}>
                  <span>RUT:</span>
                  <span>{venta.cliente.rut}</span>
                </div>
              )}
              {venta.cliente?.telefono && (
                <div className={styles.metaRow}>
                  <span>Tel:</span>
                  <span>{venta.cliente.telefono}</span>
                </div>
              )}
            </div>

            <div className={styles.divider} />

            <div className={styles.tableHeader}>
              <span>DETALLE</span>
              <span>TOTAL</span>
            </div>

            {venta.items.map((it, idx) => {
              const cant = it.cantidad || 1;
              const precioConIva = Math.round((it.precioNeto || 0) * 1.19);
              const subtotal = cant * precioConIva;
              return (
                <div key={idx} className={styles.itemRow}>
                  <div className={styles.itemDesc}>
                    {it.codigo ? `[${it.codigo}] ` : ''}{it.nombre}
                  </div>
                  <div className={styles.itemSub}>
                    <span>{cant} un x {fmtCLP(precioConIva)}</span>
                    <strong>{fmtCLP(subtotal)}</strong>
                  </div>
                </div>
              );
            })}

            <div className={styles.divider} />

            <div className={styles.totalesSection}>
              {venta.descuentoNeto && venta.descuentoNeto > 0 ? (
                <>
                  <div className={styles.totalRow}>
                    <span>Subtotal Neto:</span>
                    <span>{fmtCLP(venta.subtotalNeto || venta.totalNeto + venta.descuentoNeto)}</span>
                  </div>
                  <div className={styles.totalRow} style={{ fontWeight: 700 }}>
                    <span>
                      Descuento{venta.descuentoPorcentaje ? ` (${venta.descuentoPorcentaje}%)` : ''}:
                    </span>
                    <span>-{fmtCLP(venta.descuentoNeto)}</span>
                  </div>
                  <div className={styles.totalRow}>
                    <span>Neto c/Descuento:</span>
                    <span>{fmtCLP(venta.totalNeto)}</span>
                  </div>
                </>
              ) : (
                <div className={styles.totalRow}>
                  <span>Subtotal Neto:</span>
                  <span>{fmtCLP(venta.totalNeto)}</span>
                </div>
              )}
              <div className={styles.totalRow}>
                <span>IVA (19%):</span>
                <span>{fmtCLP(venta.totalIva)}</span>
              </div>
              <div className={styles.totalGrande}>
                <span>TOTAL A PAGAR:</span>
                <span>{fmtCLP(venta.total)}</span>
              </div>
              <div className={styles.totalRow} style={{ marginTop: '4px' }}>
                <span>Medio de Pago:</span>
                <strong>{venta.metodoPago}</strong>
              </div>
            </div>

            <div className={styles.dividerDouble} />

            <div className={styles.ticketFooter}>
              <div className={styles.ticketAgradecimiento}>
                {esCotizacion ? 'Cotización válida por 5 días' : '¡Gracias por su compra!'}
              </div>
              <div>Conserve este comprobante para cambios o garantías</div>
              <div style={{ marginTop: '4px', fontSize: '10px' }}>Sistema Fácil Repuestos</div>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnPrint} onClick={handlePrint}>
            🖨️ Imprimir Ticket Térmico
          </button>
          <button className={styles.btnCerrar} onClick={onCerrar}>
            Nueva Venta
          </button>
        </div>
      </div>
    </div>
  );
}
