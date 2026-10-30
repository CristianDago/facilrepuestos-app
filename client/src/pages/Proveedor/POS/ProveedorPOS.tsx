import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { inventarioService } from '../../../services/inventario';
import { posService, type ItemVentaPOS, type MetodoPagoPOS, type VentaPOSRegistrada } from '../../../services/pos';
import type { ItemInventario } from '../../../types';
import TicketTermicoModal from './TicketTermicoModal';
import IngresoRapidoModal from '../../Inventario/IngresoRapidoModal';
import styles from './ProveedorPOS.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const conIva = (neto: number) => Math.round((neto || 0) * 1.19);

// Reproduce un beep sutil y positivo con Web Audio API al escanear
function playBeep(tipo: 'ok' | 'error' = 'ok') {
  try {
    const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = tipo === 'ok' ? 'sine' : 'square';
    osc.frequency.setValueAtTime(tipo === 'ok' ? 880 : 220, ctx.currentTime);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Si el navegador bloquea audio antes de interacción, se ignora silenciosamente
  }
}

export default function ProveedorPOS() {
  const { user } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [inventario, setInventario] = useState<ItemInventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [carro, setCarro] = useState<ItemVentaPOS[]>([]);

  // Datos de venta
  const [metodoPago, setMetodoPago] = useState<MetodoPagoPOS>('EFECTIVO');
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteRut, setClienteRut] = useState('');
  const [clientePatente, setClientePatente] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');

  // Estado de procesamiento y modal
  const [procesandoVenta, setProcesandoVenta] = useState(false);
  const [ventaCompletada, setVentaCompletada] = useState<VentaPOSRegistrada | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Historial POS y modal de ingreso rápido con pistola
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [historialVentas, setHistorialVentas] = useState<VentaPOSRegistrada[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [modalPistolaCodigo, setModalPistolaCodigo] = useState<string | null>(null);

  const cargarHistorialVentas = async () => {
    try {
      setCargandoHistorial(true);
      const res = await posService.obtenerVentas();
      setHistorialVentas(res.data || []);
    } catch {
      // Silencioso en caso de fallo de red puntual
    } finally {
      setCargandoHistorial(false);
    }
  };

  const abrirHistorial = () => {
    setMostrarHistorial(true);
    cargarHistorialVentas();
  };

  const cargarCotizacionAlCarro = (cot: VentaPOSRegistrada) => {
    const nuevosItems: ItemVentaPOS[] = [];
    for (const it of cot.items) {
      const invItem = inventario.find((x) => x.id === it.id);
      const disponible = invItem ? Math.max(0, (invItem.stock || 0) - (invItem.stockReservado || 0)) : it.cantidad;
      const precioNeto = Number(it.precioNeto) || 0;
      const precioConIva = conIva(precioNeto);
      nuevosItems.push({
        id: it.id,
        nombre: it.nombre,
        codigo: it.codigo || '',
        fabricante: invItem?.fabricante || '',
        precioNeto,
        precioConIva,
        cantidad: Math.min(it.cantidad, Math.max(1, disponible)),
        subtotalNeto: precioNeto * Math.min(it.cantidad, Math.max(1, disponible)),
        subtotalConIva: precioConIva * Math.min(it.cantidad, Math.max(1, disponible)),
        disponible,
      });
    }
    setCarro(nuevosItems);
    setClienteNombre(cot.cliente?.nombre || '');
    setClienteRut(cot.cliente?.rut || '');
    setClientePatente(cot.cliente?.patente || '');
    setClienteTelefono(cot.cliente?.telefono || '');
    setMostrarHistorial(false);
    playBeep('ok');
  };

  // Cargar inventario al montar
  const cargarInventario = async () => {
    try {
      setLoading(true);
      const res = await inventarioService.getAll();
      setInventario(res.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar inventario';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarInventario();
    // Enfocar buscador al entrar
    searchInputRef.current?.focus();
  }, []);

  // Agregar producto al carro
  const agregarAlCarro = (item: ItemInventario) => {
    const disponible = Math.max(0, (item.stock || 0) - (item.stockReservado || 0));
    if (disponible <= 0) {
      playBeep('error');
      alert(`El repuesto "${item.nombre || item.codigo}" no tiene stock disponible`);
      return;
    }

    const itemId = item.id;
    if (!itemId) {
      alert('El repuesto seleccionado no tiene un ID válido');
      return;
    }

    setCarro((prev) => {
      const idx = prev.findIndex((p) => p.id === itemId);
      const precioNeto = Number(item.precioVenta || item.precioLista || item.precioCompra || 0);
      const precioConIva = conIva(precioNeto);

      if (idx >= 0) {
        const itemActual = prev[idx];
        if (itemActual.cantidad + 1 > disponible) {
          playBeep('error');
          alert(`No puedes agregar más unidades. Stock disponible: ${disponible}`);
          return prev;
        }

        const nuevaCant = itemActual.cantidad + 1;
        const actualizado = [...prev];
        actualizado[idx] = {
          ...itemActual,
          cantidad: nuevaCant,
          subtotalNeto: nuevaCant * precioNeto,
          subtotalConIva: nuevaCant * precioConIva,
        };
        playBeep('ok');
        return actualizado;
      } else {
        playBeep('ok');
        const nuevoItem: ItemVentaPOS = {
          id: itemId,
          nombre: item.nombre || 'Repuesto',
          codigo: item.codigo || '',
          fabricante: item.fabricante || '',
          precioNeto,
          precioConIva,
          cantidad: 1,
          subtotalNeto: precioNeto,
          subtotalConIva: precioConIva,
          disponible,
        };
        return [...prev, nuevoItem];
      }
    });

    // Mantener siempre el foco en el buscador de la pistola
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  // Ajustar cantidad en el carro
  const cambiarCantidad = (id: string, delta: number) => {
    setCarro((prev) =>
      prev
        .map((p) => {
          if (p.id !== id) return p;
          const nuevaCant = p.cantidad + delta;
          if (nuevaCant <= 0) return null;
          if (nuevaCant > p.disponible) {
            alert(`Stock máximo alcanzado (${p.disponible} un.)`);
            return p;
          }
          return {
            ...p,
            cantidad: nuevaCant,
            subtotalNeto: nuevaCant * p.precioNeto,
            subtotalConIva: nuevaCant * p.precioConIva,
          };
        })
        .filter(Boolean) as ItemVentaPOS[]
    );
  };

  const eliminarDelCarro = (id: string) => {
    setCarro((prev) => prev.filter((p) => p.id !== id));
  };

  const limpiarCarro = () => {
    setCarro([]);
    setClienteNombre('');
    setClienteRut('');
    setClientePatente('');
    setClienteTelefono('');
    setErrorMsg(null);
    searchInputRef.current?.focus();
  };

  // Manejo de Enter de la pistola de códigos de barra
  const handleKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = busqueda.trim().toUpperCase();
      if (!code) return;

      // Buscar coincidencia exacta por código interno, código de barra o equivalencia
      const exactMatch = inventario.find(
        (it) =>
          (it.codigo && it.codigo.trim().toUpperCase() === code) ||
          (it.id && it.id.trim().toUpperCase() === code) ||
          (it.equivalencias && it.equivalencias.some((eq) => eq.codigo.trim().toUpperCase() === code))
      );

      if (exactMatch) {
        agregarAlCarro(exactMatch);
        setBusqueda('');
      } else {
        // Si no hay coincidencia exacta pero hay 1 solo resultado filtrado, agregarlo
        if (repuestosFiltrados.length === 1) {
          agregarAlCarro(repuestosFiltrados[0]);
          setBusqueda('');
        } else if (repuestosFiltrados.length === 0) {
          playBeep('error');
        }
      }
    }
  };

  // Atajos de teclado rápidos (F4 para cobrar, Escape para limpiar)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        if (carro.length > 0 && !procesandoVenta) {
          ejecutarVenta('TICKET');
        }
      } else if (e.key === 'Escape') {
        if (ventaCompletada) {
          setVentaCompletada(null);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [carro, procesandoVenta, ventaCompletada]);

  // Filtrado de repuestos para el catálogo visual
  const repuestosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return inventario.slice(0, 40);
    const q = busqueda.toLowerCase().trim();
    return inventario
      .filter((it) => {
        const nom = (it.nombre || '').toLowerCase();
        const cod = (it.codigo || '').toLowerCase();
        const fab = (it.fabricante || '').toLowerCase();
        const cat = (it.categoria || '').toLowerCase();
        const equiv = (it.equivalencias || []).some((eq) => eq.codigo.toLowerCase().includes(q));
        return nom.includes(q) || cod.includes(q) || fab.includes(q) || cat.includes(q) || equiv;
      })
      .slice(0, 40);
  }, [inventario, busqueda]);

  // Totales del carro
  const totales = useMemo(() => {
    const neto = carro.reduce((sum, it) => sum + it.subtotalNeto, 0);
    const iva = Math.round(neto * 0.19);
    const total = neto + iva;
    const totalUnidades = carro.reduce((sum, it) => sum + it.cantidad, 0);
    return { neto, iva, total, totalUnidades };
  }, [carro]);

  // Procesar venta en backend y desplegar ticket térmico
  const ejecutarVenta = async (tipoDocumento: 'TICKET' | 'COTIZACION') => {
    if (carro.length === 0) return;

    try {
      setProcesandoVenta(true);
      setErrorMsg(null);

      const payload = {
        items: carro.map((it) => ({
          id: it.id,
          nombre: it.nombre,
          codigo: it.codigo,
          precioNeto: it.precioNeto,
          cantidad: it.cantidad,
        })),
        metodoPago,
        tipoDocumento,
        cliente: {
          nombre: clienteNombre.trim() || undefined,
          rut: clienteRut.trim() || undefined,
          patente: clientePatente.trim() || undefined,
          telefono: clienteTelefono.trim() || undefined,
        },
      };

      const res = await posService.registrarVenta(payload);

      if (res.success && res.data) {
        setVentaCompletada(res.data);
        limpiarCarro();
        // Recargar inventario para ver el stock actualizado al instante
        cargarInventario();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar la venta';
      setErrorMsg(msg);
      playBeep('error');
    } finally {
      setProcesandoVenta(false);
    }
  };

  return (
    <div className={styles.posLayout}>
      {/* ── PANEL IZQUIERDO: BÚSQUEDA Y LISTA DE REPUESTOS ── */}
      <div className={styles.leftPanel}>
        <div className={styles.searchHeader}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div className={styles.scannerBadge}>
              <span className={styles.scannerDot} />
              <span>Lector de Código de Barra / Pistola Activo</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm btn-dark"
                style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff', fontWeight: 700 }}
                onClick={() => setModalPistolaCodigo('')}
                title="Escanear mercadería nueva o sumar stock a bodega"
              >
                ⚡ Ingreso Pistola Bodega
              </button>
              <button
                type="button"
                className="btn btn-sm btn-dark"
                onClick={abrirHistorial}
                title="Ver ventas del día, cotizaciones y reimprimir tickets"
              >
                🧾 Historial / Tickets
              </button>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                <strong>[Enter]</strong> agregar | <strong>[F4]</strong> cobrar
              </span>
            </div>
          </div>

          <div className={styles.searchBarWrap}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Escanear con pistola o escribir código OEM, nombre o marca... (Enter)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={handleKeyDownSearch}
            />
            {busqueda && (
              <button className={styles.clearSearchBtn} onClick={() => setBusqueda('')}>
                ✕
              </button>
            )}
          </div>
        </div>

        <div className={styles.catalogContent}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              Cargando catálogo de repuestos...
            </div>
          ) : repuestosFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
              <div style={{ marginBottom: '0.85rem', fontSize: '0.95rem' }}>
                No se encontraron repuestos en bodega con <strong>"{busqueda}"</strong>
              </div>
              {busqueda.trim() && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: '#0284c7', borderColor: '#0284c7' }}
                  onClick={() => setModalPistolaCodigo(busqueda.trim().toUpperCase())}
                >
                  ✨ ¿Mercadería nueva? Buscar e Ingresar "{busqueda.trim().toUpperCase()}" con Pistola
                </button>
              )}
            </div>
          ) : (
            <table className={styles.tableWrap}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Fabricante</th>
                  <th>Stock</th>
                  <th style={{ textAlign: 'right' }}>Precio (IVA inc.)</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {repuestosFiltrados.map((it) => {
                  const disponible = Math.max(0, (it.stock || 0) - (it.stockReservado || 0));
                  const precioNeto = Number(it.precioVenta || it.precioLista || it.precioCompra || 0);
                  const precioIva = conIva(precioNeto);

                  const stockClass =
                    disponible > 3
                      ? styles.stockOk
                      : disponible > 0
                      ? styles.stockLow
                      : styles.stockZero;

                  return (
                    <tr
                      key={it.id}
                      className={styles.tableRow}
                      onClick={() => agregarAlCarro(it)}
                      title="Haz clic o presiona Enter para agregar"
                    >
                      <td className={styles.tableCell}>
                        <span className={styles.itemCodeBadge}>{it.codigo || 'S/C'}</span>
                      </td>
                      <td className={styles.tableCell}>
                        <span className={styles.itemTitle}>{it.nombre}</span>
                        <span className={styles.itemSub}>{it.categoria}</span>
                      </td>
                      <td className={styles.tableCell}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          {it.fabricante || '—'}
                        </span>
                      </td>
                      <td className={styles.tableCell}>
                        <span className={`${styles.stockBadge} ${stockClass}`}>
                          {disponible} un.
                        </span>
                      </td>
                      <td className={styles.tableCell} style={{ textAlign: 'right' }}>
                        <strong style={{ fontSize: '0.95rem' }}>{fmtCLP(precioIva)}</strong>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          Neto: {fmtCLP(precioNeto)}
                        </div>
                      </td>
                      <td className={styles.tableCell} style={{ textAlign: 'center' }}>
                        <button
                          className={styles.btnMiniAdd}
                          onClick={(e) => {
                            e.stopPropagation();
                            agregarAlCarro(it);
                          }}
                        >
                          +
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── PANEL DERECHO: CARRO DE VENTA DE MOSTRADOR ── */}
      <div className={styles.rightPanel}>
        <div className={styles.cartHeader}>
          <div className={styles.cartTitle}>
            <span>🛒 Mostrador / Venta</span>
            {carro.length > 0 && (
              <span className={styles.cartCountBadge}>{totales.totalUnidades} un.</span>
            )}
          </div>
          {carro.length > 0 && (
            <button className={styles.btnClearCart} onClick={limpiarCarro} title="Limpiar venta (Esc)">
              Limpiar
            </button>
          )}
        </div>

        {/* Formulario rápido de cliente */}
        <div className={styles.clientQuickForm}>
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="Cliente (Opcional)"
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="Patente (ej: ABCD12)"
            value={clientePatente}
            onChange={(e) => setClientePatente(e.target.value.toUpperCase())}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="RUT Cliente"
            value={clienteRut}
            onChange={(e) => setClienteRut(e.target.value)}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="Teléfono"
            value={clienteTelefono}
            onChange={(e) => setClienteTelefono(e.target.value)}
          />
        </div>

        {/* Lista de productos en el carro */}
        <div className={styles.cartItemsList}>
          {carro.length === 0 ? (
            <div className={styles.emptyCart}>
              <span style={{ fontSize: '2.5rem' }}>📦</span>
              <strong>Carro vacío</strong>
              <span>Escanea un repuesto con la pistola para comenzar la venta</span>
            </div>
          ) : (
            carro.map((it) => (
              <div key={it.id} className={styles.cartItemCard}>
                <div className={styles.cartItemTop}>
                  <div>
                    <span className={styles.itemCodeBadge} style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                      {it.codigo || 'S/C'}
                    </span>
                    <span className={styles.cartItemName}>{it.nombre}</span>
                  </div>
                  <button
                    className={styles.btnRemoveItem}
                    onClick={() => eliminarDelCarro(it.id)}
                    title="Quitar"
                  >
                    ✕
                  </button>
                </div>

                <div className={styles.cartItemBottom}>
                  <div className={styles.quantityControls}>
                    <button className={styles.btnQty} onClick={() => cambiarCantidad(it.id, -1)}>
                      -
                    </button>
                    <span className={styles.qtyValue}>{it.cantidad}</span>
                    <button className={styles.btnQty} onClick={() => cambiarCantidad(it.id, 1)}>
                      +
                    </button>
                  </div>

                  <div className={styles.cartItemPrices}>
                    <div className={styles.cartItemSubtotal}>{fmtCLP(it.subtotalConIva)}</div>
                    <div className={styles.cartItemUnit}>
                      {it.cantidad} x {fmtCLP(it.precioConIva)} (IVA inc.)
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totales y opciones de cobro */}
        <div className={styles.checkoutFooter}>
          {errorMsg && (
            <div style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 600, background: '#fee2e2', padding: '0.5rem', borderRadius: '6px' }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Selector de medio de pago */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '4px', textTransform: 'uppercase' }}>
              Medio de Pago:
            </div>
            <div className={styles.paymentMethodsGrid}>
              {(['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA'] as MetodoPagoPOS[]).map((m) => (
                <button
                  key={m}
                  className={`${styles.paymentBtn} ${metodoPago === m ? styles.paymentBtnActive : ''}`}
                  onClick={() => setMetodoPago(m)}
                >
                  {m === 'EFECTIVO' ? '💵 Efectivo' : m === 'DEBITO' ? '💳 Débito' : m === 'CREDITO' ? '💳 Crédito' : '📲 Transf.'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.summaryRows}>
            <div className={styles.summaryRow}>
              <span>Subtotal Neto:</span>
              <strong>{fmtCLP(totales.neto)}</strong>
            </div>
            <div className={styles.summaryRow}>
              <span>IVA (19%):</span>
              <span>{fmtCLP(totales.iva)}</span>
            </div>
            <div className={styles.totalGrandeRow}>
              <span>TOTAL:</span>
              <span>{fmtCLP(totales.total)}</span>
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              className={styles.btnCobrar}
              disabled={carro.length === 0 || procesandoVenta}
              onClick={() => ejecutarVenta('TICKET')}
            >
              {procesandoVenta ? 'Procesando...' : '⚡ Cobrar e Imprimir Ticket (F4)'}
            </button>
            <button
              className={styles.btnCotizar}
              disabled={carro.length === 0 || procesandoVenta}
              onClick={() => ejecutarVenta('COTIZACION')}
            >
              📄 Generar Comprobante de Cotización
            </button>
          </div>
        </div>
      </div>

      {/* ── MODAL DE IMPRESIÓN TÉRMICA ── */}
      {ventaCompletada && (
        <TicketTermicoModal
          venta={ventaCompletada}
          nombreLocal={user?.nombre ? `REPUESTOS ${user.nombre.toUpperCase()}` : 'FACIL REPUESTOS CHILE'}
          onCerrar={() => setVentaCompletada(null)}
        />
      )}

      {/* ── MODAL DE INGRESO RÁPIDO CON PISTOLA (DESDE MOSTRADOR) ── */}
      {modalPistolaCodigo !== null && (
        <IngresoRapidoModal
          codigoInicial={modalPistolaCodigo}
          modo={user?.rol === 'admin' ? 'admin' : 'proveedor'}
          onCerrar={() => {
            setModalPistolaCodigo(null);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
          onItemGuardado={() => {
            cargarInventario();
          }}
        />
      )}

      {/* ── MODAL DE HISTORIAL DE VENTAS Y COTIZACIONES POS ── */}
      {mostrarHistorial && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '1rem',
          }}
          onClick={() => setMostrarHistorial(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '860px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                background: '#0f172a',
                color: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>
                🧾 Historial de Mostrador (Ventas y Cotizaciones Recientes)
              </div>
              <button
                onClick={() => setMostrarHistorial(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {/* Resumen rápido */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>
                    Ventas Completadas
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#166534' }}>
                    {historialVentas.filter((v) => v.tipoDocumento !== 'COTIZACION').length}
                  </div>
                </div>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>
                    Total Recaudado (IVA inc.)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#1e40af' }}>
                    {fmtCLP(
                      historialVentas
                        .filter((v) => v.tipoDocumento !== 'COTIZACION')
                        .reduce((acc, v) => acc + (Number(v.total) || 0), 0)
                    )}
                  </div>
                </div>
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a16207', textTransform: 'uppercase' }}>
                    Cotizaciones Emitidas
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#854d0e' }}>
                    {historialVentas.filter((v) => v.tipoDocumento === 'COTIZACION').length}
                  </div>
                </div>
              </div>

              {cargandoHistorial ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  Cargando historial de ventas...
                </div>
              ) : historialVentas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                  Aún no hay ventas ni cotizaciones registradas en mostrador.
                </div>
              ) : (
                <table className={styles.tableWrap}>
                  <thead>
                    <tr>
                      <th>N° Ticket</th>
                      <th>Tipo</th>
                      <th>Fecha / Hora</th>
                      <th>Cliente / Patente</th>
                      <th>Pago</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialVentas.map((v) => {
                      const esCot = v.tipoDocumento === 'COTIZACION';
                      return (
                        <tr key={v.id} className={styles.tableRow} style={{ cursor: 'default' }}>
                          <td className={styles.tableCell}>
                            <span className={styles.itemCodeBadge}>{v.numeroTicket}</span>
                          </td>
                          <td className={styles.tableCell}>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: '999px',
                                background: esCot ? '#fef9c3' : '#dcfce7',
                                color: esCot ? '#854d0e' : '#166534',
                              }}
                            >
                              {esCot ? 'COTIZACIÓN' : 'VENTA'}
                            </span>
                          </td>
                          <td className={styles.tableCell} style={{ fontSize: '0.8rem', color: '#475569' }}>
                            {new Date(v.fecha).toLocaleString('es-CL')}
                          </td>
                          <td className={styles.tableCell} style={{ fontSize: '0.82rem' }}>
                            <strong>{v.cliente?.nombre || 'Cliente Mostrador'}</strong>
                            {v.cliente?.patente && (
                              <span style={{ marginLeft: '6px', color: '#0284c7', fontWeight: 700 }}>
                                [{v.cliente.patente}]
                              </span>
                            )}
                          </td>
                          <td className={styles.tableCell} style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                            {v.metodoPago}
                          </td>
                          <td className={styles.tableCell} style={{ textAlign: 'right', fontWeight: 800 }}>
                            {fmtCLP(v.total)}
                          </td>
                          <td className={styles.tableCell} style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                              {esCot && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => cargarCotizacionAlCarro(v)}
                                  title="Cargar productos de esta cotización al carro para cobrar"
                                >
                                  🛒 Pasar a Venta
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm btn-dark"
                                onClick={() => {
                                  setMostrarHistorial(false);
                                  setVentaCompletada(v);
                                }}
                              >
                                🖨️ Ticket
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
