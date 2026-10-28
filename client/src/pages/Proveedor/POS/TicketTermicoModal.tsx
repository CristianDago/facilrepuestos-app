import React from 'react';
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
  const handlePrint = () => {
    window.print();
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
          <button className={styles.closeBtn} onClick={onCerrar} title="Cerrar">✕</button>
        </div>

        <div className={styles.previewWrap}>
          {/* El contenedor que captura la impresora térmica */}
          <div className={`${styles.ticketContainer} ${styles.printOnlyArea}`}>
            <div className={styles.ticketHeader}>
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
              <div className={styles.totalRow}>
                <span>Subtotal Neto:</span>
                <span>{fmtCLP(venta.totalNeto)}</span>
              </div>
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
