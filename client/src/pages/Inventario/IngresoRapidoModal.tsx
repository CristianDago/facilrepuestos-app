import React, { useState, useRef, useEffect } from 'react';
import { inventarioService } from '../../services/inventario';
import type { ItemInventario, PosicionPieza, LadoPieza } from '../../types';
import styles from './IngresoRapidoModal.module.css';

interface IngresoRapidoModalProps {
  onCerrar: () => void;
  onItemGuardado?: () => void;
  modo?: 'proveedor' | 'admin';
  codigoInicial?: string;
}

function playBeep(tipo: 'ok' | 'nuevo' | 'error' = 'ok') {
  try {
    const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (tipo === 'ok') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
    } else if (tipo === 'nuevo') {
      osc.frequency.setValueAtTime(659, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
    }

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Audio opcional ignorado si el navegador lo bloquea
  }
}

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

export default function IngresoRapidoModal({
  onCerrar,
  onItemGuardado,
  modo = 'proveedor',
  codigoInicial = '',
}: IngresoRapidoModalProps) {
  const scannerRef = useRef<HTMLInputElement>(null);

  const [codigoScan, setCodigoScan] = useState(codigoInicial);
  const [buscando, setBuscando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resultado de la búsqueda
  const [resultado, setResultado] = useState<{
    tipo: 'existente' | 'nuevo';
    item: Partial<ItemInventario>;
  } | null>(null);

  // Campos para repuesto EXISTENTE
  const [cantAgregar, setCantAgregar] = useState<number>(1);
  const [nuevoCosto, setNuevoCosto] = useState<number>(0);
  const [nuevoPrecioVenta, setNuevoPrecioVenta] = useState<number>(0);

  // Campos para repuesto NUEVO
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [fabricanteNuevo, setFabricanteNuevo] = useState('');
  const [categoriaNueva, setCategoriaNueva] = useState('FRENOS');
  const [tipoPiezaNuevo, setTipoPiezaNuevo] = useState('');
  const [marcasCompatiblesNuevas, setMarcasCompatiblesNuevas] = useState('');
  const [costoNuevo, setCostoNuevo] = useState<number>(0);
  const [precioVentaNuevo, setPrecioVentaNuevo] = useState<number>(0);
  const [stockInicial, setStockInicial] = useState<number>(1);
  const [stockMinimo, setStockMinimo] = useState<number>(2);

  // Historial de la sesión actual
  const [historialSesion, setHistorialSesion] = useState<Array<{
    nombre: string;
    codigo: string;
    cantidad: number;
    accion: 'sumado' | 'creado';
    hora: string;
  }>>([]);

  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    scannerRef.current?.focus();
    if (codigoInicial.trim()) {
      handleBuscarCodigo(codigoInicial.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ejecutar búsqueda por código de barra / OEM
  const handleBuscarCodigo = async (codigoABuscar?: string) => {
    const cod = (codigoABuscar || codigoScan).trim().toUpperCase();
    if (!cod) return;

    try {
      setBuscando(true);
      setErrorMsg(null);
      setResultado(null);

      const res = await inventarioService.lookupCodigo(cod);

      if (res.success && res.data) {
        const { origen, item } = res.data;

        if (origen === 'inventario_existente' && item.id) {
          playBeep('ok');
          setResultado({ tipo: 'existente', item });
          setCantAgregar(1);
          const costoBase = Number(item.precioCompra) || 0;
          setNuevoCosto(costoBase);
          setNuevoPrecioVenta(Number(item.precioVenta || item.precioLista) || Math.round(costoBase * 1.3));
        } else {
          // Producto nuevo sugerido
          playBeep('nuevo');
          setResultado({ tipo: 'nuevo', item });
          setNombreNuevo(item.nombre || '');
          setFabricanteNuevo(item.fabricante || '');
          setCategoriaNueva(item.categoria || 'FRENOS');
          setTipoPiezaNuevo(item.tipoPieza || '');
          setMarcasCompatiblesNuevas((item.marcasCompatibles || []).join(', '));
          setCostoNuevo(Number(item.precioCompra) || 0);
          setPrecioVentaNuevo(Number(item.precioVenta) || 0);
          setStockInicial(1);
          setStockMinimo(2);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al consultar código';
      setErrorMsg(msg);
      playBeep('error');
    } finally {
      setBuscando(false);
    }
  };

  const handleKeyDownScanner = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBuscarCodigo();
    }
  };

  // Calcular precio sugerido al cambiar costo (markup 30%)
  const handleCostoNuevoChange = (val: number) => {
    setCostoNuevo(val);
    setPrecioVentaNuevo(Math.round(val * 1.3));
  };

  // Guardar adición a producto EXISTENTE
  const handleGuardarExistente = async () => {
    if (!resultado || !resultado.item.id) return;

    try {
      setGuardando(true);
      setErrorMsg(null);

      const nuevoStockTotal = (Number(resultado.item.stock) || 0) + Number(cantAgregar);

      // Actualizar stock
      await inventarioService.actualizarStock(resultado.item.id, nuevoStockTotal);

      // Si cambió el precio o costo, actualizar
      if (
        nuevoCosto !== Number(resultado.item.precioCompra) ||
        nuevoPrecioVenta !== Number(resultado.item.precioVenta || resultado.item.precioLista)
      ) {
        await inventarioService.update(resultado.item.id, {
          precioCompra: nuevoCosto,
          precioVenta: nuevoPrecioVenta,
          precioLista: nuevoPrecioVenta,
        });
      }

      playBeep('ok');
      setHistorialSesion((prev) => [
        {
          nombre: resultado.item.nombre || 'Repuesto',
          codigo: resultado.item.codigo || '',
          cantidad: cantAgregar,
          accion: 'sumado',
          hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
        ...prev,
      ]);

      // Limpiar para siguiente escaneo
      setResultado(null);
      setCodigoScan('');
      onItemGuardado?.();
      setTimeout(() => scannerRef.current?.focus(), 50);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar producto';
      setErrorMsg(msg);
      playBeep('error');
    } finally {
      setGuardando(false);
    }
  };

  // Guardar producto NUEVO
  const handleGuardarNuevo = async () => {
    if (!resultado) return;

    try {
      setGuardando(true);
      setErrorMsg(null);

      const marcas = marcasCompatiblesNuevas
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const payload: Omit<ItemInventario, 'id'> = {
        nombre: nombreNuevo.trim().toUpperCase(),
        codigo: codigoScan.trim().toUpperCase(),
        fabricante: fabricanteNuevo.trim().toUpperCase(),
        categoria: categoriaNueva,
        tipoPieza: tipoPiezaNuevo.trim().toUpperCase(),
        posicion: (resultado.item.posicion as PosicionPieza) || 'NO APLICA',
        lado: (resultado.item.lado as LadoPieza) || 'NO APLICA',
        marcasCompatibles: marcas,
        equivalencias: [],
        precioCompra: Number(costoNuevo) || 0,
        precioLista: Number(precioVentaNuevo) || Math.round((Number(costoNuevo) || 0) * 1.3),
        precioVenta: Number(precioVentaNuevo) || Math.round((Number(costoNuevo) || 0) * 1.3),
        stock: Number(stockInicial) || 1,
        stockReservado: 0,
        stockMinimo: Number(stockMinimo) || 2,
        unidad: 'UNIDAD',
        proveedor: '',
        anioDesde: null,
        anioHasta: null,
      };

      await inventarioService.create(payload);

      playBeep('ok');
      setHistorialSesion((prev) => [
        {
          nombre: payload.nombre,
          codigo: payload.codigo,
          cantidad: payload.stock,
          accion: 'creado',
          hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
        ...prev,
      ]);

      // Limpiar para siguiente escaneo en ráfaga
      setResultado(null);
      setCodigoScan('');
      onItemGuardado?.();
      setTimeout(() => scannerRef.current?.focus(), 50);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear producto';
      setErrorMsg(msg);
      playBeep('error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.headerTitle}>
            <span>⚡ Ingreso Rápido de Mercadería (Modo Pistola)</span>
          </div>
          <button className={styles.closeBtn} onClick={onCerrar} title="Cerrar (Esc)">
            ✕
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* ── BARRA PRINCIPAL DE ESCANEO ── */}
          <div className={styles.scannerCard}>
            <div className={styles.scannerStatus}>
              <span>
                <span className={styles.liveDot} />
                Pistola lectora activa y lista
              </span>
              <span>Dispara el escáner sobre la etiqueta</span>
            </div>

            <div className={styles.scannerInputWrap}>
              <span className={styles.iconBarcode}>📷</span>
              <input
                ref={scannerRef}
                type="text"
                className={styles.scannerInput}
                placeholder="Escanear código de barra / OEM o escribir... (Enter)"
                value={codigoScan}
                onChange={(e) => setCodigoScan(e.target.value)}
                onKeyDown={handleKeyDownScanner}
                disabled={buscando || guardando}
                autoFocus
              />
              <button
                className={styles.btnLookup}
                onClick={() => handleBuscarCodigo()}
                disabled={buscando || !codigoScan.trim()}
              >
                {buscando ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div style={{ color: '#ef4444', background: '#fee2e2', padding: '0.65rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {/* ── CASO A: REPUESTO YA EXISTE EN BODEGA ── */}
          {resultado?.tipo === 'existente' && (
            <div className={styles.cardExistente}>
              <span className={styles.badgeExistente}>✓ Repuesto ya registrado en bodega</span>

              <div className={styles.itemResumen}>
                <div>
                  <div className={styles.itemNombre}>{resultado.item.nombre}</div>
                  <div className={styles.itemMeta}>
                    <span>Código: <strong>{resultado.item.codigo}</strong></span>
                    <span>Marca: <strong>{resultado.item.fabricante || '—'}</strong></span>
                    <span>Categoría: <strong>{resultado.item.categoria}</strong></span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 700 }}>STOCK ACTUAL</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#16a34a' }}>
                    {resultado.item.stock || 0} un.
                  </div>
                </div>
              </div>

              <div className={styles.inputsGrid}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>➕ Cantidad a Ingresar</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.fieldInput}
                    value={cantAgregar}
                    onChange={(e) => setCantAgregar(Math.max(1, parseInt(e.target.value) || 1))}
                    autoFocus
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Costo Compra (Neto)</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    value={nuevoCosto}
                    onChange={(e) => setNuevoCosto(Number(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Precio Venta (Neto)</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    value={nuevoPrecioVenta}
                    onChange={(e) => setNuevoPrecioVenta(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              <button
                className={styles.btnSubmitAdd}
                onClick={handleGuardarExistente}
                disabled={guardando}
              >
                {guardando ? 'Actualizando...' : `📥 Sumar +${cantAgregar} un. a Bodega (Enter)`}
              </button>
            </div>
          )}

          {/* ── CASO B: PRODUCTO NUEVO (AUTO-ENRIQUECIDO POR LA RED) ── */}
          {resultado?.tipo === 'nuevo' && (
            <div className={styles.cardNuevo}>
              <span className={styles.badgeNuevo}>
                ✨ Producto Nuevo Detectado en Catálogo Web / Patrón Automotriz
              </span>

              <div className={styles.formGrid}>
                <div className={`${styles.fieldGroup} ${styles.fullCol}`}>
                  <label className={styles.fieldLabel}>Nombre / Descripción del Repuesto</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={nombreNuevo}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Marca del Repuesto (Fabricante)</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={fabricanteNuevo}
                    placeholder="Ej: BOSCH, VALEO..."
                    onChange={(e) => setFabricanteNuevo(e.target.value)}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Categoría</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={categoriaNueva}
                    placeholder="FRENOS, FILTROS..."
                    onChange={(e) => setCategoriaNueva(e.target.value)}
                  />
                </div>

                <div className={`${styles.fieldGroup} ${styles.fullCol}`}>
                  <label className={styles.fieldLabel}>Marcas de Vehículos Compatibles (Separadas por coma)</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={marcasCompatiblesNuevas}
                    placeholder="Ej: TOYOTA, HYUNDAI, CHERY..."
                    onChange={(e) => setMarcasCompatiblesNuevas(e.target.value)}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Costo Compra (Neto)</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    placeholder="0"
                    value={costoNuevo || ''}
                    onChange={(e) => handleCostoNuevoChange(Number(e.target.value) || 0)}
                    autoFocus
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Precio Venta (Neto Sugerido +30%)</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    placeholder="0"
                    value={precioVentaNuevo || ''}
                    onChange={(e) => setPrecioVentaNuevo(Number(e.target.value) || 0)}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Cantidad Inicial que Llegó</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.fieldInput}
                    value={stockInicial}
                    onChange={(e) => setStockInicial(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Stock Mínimo (Alerta)</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.fieldInput}
                    value={stockMinimo}
                    onChange={(e) => setStockMinimo(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </div>

              <button
                className={styles.btnSubmitAdd}
                onClick={handleGuardarNuevo}
                disabled={guardando || !nombreNuevo.trim()}
              >
                {guardando ? 'Guardando...' : `✨ Guardar e Ingresar ${stockInicial} un. al Inventario (Enter)`}
              </button>
            </div>
          )}

          {/* ── HISTORIAL DE SESIÓN CONTINUA (BODEGA EN RÁFAGA) ── */}
          {historialSesion.length > 0 && (
            <div className={styles.sessionHistory}>
              <div className={styles.sessionTitle}>
                <span>Últimos repuestos ingresados en esta sesión ({historialSesion.length})</span>
                <span>Listo para el siguiente código</span>
              </div>
              {historialSesion.slice(0, 5).map((h, i) => (
                <div key={i} className={styles.sessionItemRow}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{h.nombre}</span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '6px' }}>[{h.codigo}]</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, color: h.accion === 'sumado' ? '#16a34a' : '#0284c7' }}>
                      +{h.cantidad} un.
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{h.hora}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
