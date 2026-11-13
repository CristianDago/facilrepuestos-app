import React, { useState, useRef, useEffect } from 'react';
import { inventarioService } from '../../services/inventario';
import {
  CATEGORIAS_DEFAULT,
  ORIGENES_REPUESTO,
  obtenerSubcategorias,
  obtenerSubcategoriasDetalle,
  resolverJerarquiaCategoria,
} from '../../types';
import type { ItemInventario, PosicionPieza, LadoPieza, Equivalencia } from '../../types';
import styles from './IngresoRapidoModal.module.css';

interface IngresoRapidoModalProps {
  onCerrar: () => void;
  onItemGuardado?: () => void;
  modo?: 'proveedor' | 'admin';
  codigoInicial?: string;
}

function playBeep(tipo: 'ok' | 'nuevo' | 'error' = 'ok') {
  try {
    const AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
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

export default function IngresoRapidoModal({
  onCerrar,
  onItemGuardado,
  codigoInicial = '',
}: IngresoRapidoModalProps) {
  const scannerRef = useRef<HTMLInputElement>(null);
  const codigoProductoRef = useRef<HTMLInputElement>(null);
  const fileEtiquetaRef = useRef<HTMLInputElement>(null);

  // 1. Código de barras / SKU Pistoleo (para sumar/restar existencias en bodega y POS)
  const [codigoScan, setCodigoScan] = useState(codigoInicial);
  const [buscando, setBuscando] = useState(false);
  const [analizandoOem, setAnalizandoOem] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMetadataMsg, setInfoMetadataMsg] = useState<string | null>(null);

  // Resultado de la búsqueda
  const [resultado, setResultado] = useState<{
    tipo: 'existente' | 'nuevo';
    item: Partial<ItemInventario> & {
      codigoOemRaiz?: string;
      esCodigoBarrasNumerico?: boolean;
      motoresCompatibles?: string[];
    };
  } | null>(null);

  // Campos para repuesto EXISTENTE
  const [cantAgregar, setCantAgregar] = useState<number>(1);
  const [nuevoCosto, setNuevoCosto] = useState<number>(0);
  const [nuevoPrecioVenta, setNuevoPrecioVenta] = useState<number>(0);
  const [codigoProductoExistente, setCodigoProductoExistente] = useState<string>('');

  // Campos para repuesto NUEVO (Separación SKU Pistola vs Código de Producto OEM + Metadata)
  const [codigoProductoNuevo, setCodigoProductoNuevo] = useState('');
  const [codigoOemRaizDetectado, setCodigoOemRaizDetectado] = useState('');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [fabricanteNuevo, setFabricanteNuevo] = useState('');
  const [origenNuevo, setOrigenNuevo] = useState('');
  const [categoriaNueva, setCategoriaNueva] = useState('Frenos');
  const [subcategoriaNueva, setSubcategoriaNueva] = useState('Pastillas y Balatas');
  const [subcategoriaDetalleNueva, setSubcategoriaDetalleNueva] = useState('');
  const [tipoPiezaNuevo, setTipoPiezaNuevo] = useState('');
  const [marcasCompatiblesNuevas, setMarcasCompatiblesNuevas] = useState('');
  const [modelosCompatiblesMap, setModelosCompatiblesMap] = useState<{ [marca: string]: string[] }>({});
  const [nuevoModeloInput, setNuevoModeloInput] = useState('');
  const [marcaParaNuevoModelo, setMarcaParaNuevoModelo] = useState('');
  const [anioDesdeNuevo, setAnioDesdeNuevo] = useState<number | null>(null);
  const [anioHastaNuevo, setAnioHastaNuevo] = useState<number | null>(null);
  const [equivalenciasNuevas, setEquivalenciasNuevas] = useState<Equivalencia[]>([]);
  const [descripcionTecnicaNueva, setDescripcionTecnicaNueva] = useState('');
  const [costoNuevo, setCostoNuevo] = useState<number>(0);
  const [precioVentaNuevo, setPrecioVentaNuevo] = useState<number>(0);
  const [stockInicial, setStockInicial] = useState<number>(1);
  const [stockMinimo, setStockMinimo] = useState<number>(2);

  // Historial de la sesión actual
  const [historialSesion, setHistorialSesion] = useState<
    Array<{
      nombre: string;
      codigo: string;
      codigoProducto?: string;
      cantidad: number;
      accion: 'sumado' | 'creado';
      hora: string;
    }>
  >([]);

  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    scannerRef.current?.focus();
    if (codigoInicial.trim()) {
      handleBuscarCodigo(codigoInicial.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica los metadatos técnicos devueltos por el motor OEM al formulario
  const aplicarMetadataAlFormulario = (data: {
    codigoBarras?: string;
    codigoProducto?: string;
    codigoOemRaiz?: string;
    nombre?: string;
    fabricante?: string;
    origen?: string;
    categoria?: string;
    tipoPieza?: string;
    marcasCompatibles?: string[];
    modelosCompatibles?: { [marca: string]: string[] };
    anioDesde?: number | null;
    anioHasta?: number | null;
    equivalencias?: Equivalencia[];
    descripcion?: string;
  }) => {
    if (data.codigoBarras && !codigoScan.trim()) {
      setCodigoScan(data.codigoBarras);
    }
    if (data.codigoProducto) {
      setCodigoProductoNuevo(data.codigoProducto);
    }
    if (data.codigoOemRaiz !== undefined) {
      setCodigoOemRaizDetectado(data.codigoOemRaiz || '');
    }
    if (data.nombre) {
      setNombreNuevo(data.nombre);
    }
    if (data.fabricante) {
      setFabricanteNuevo(data.fabricante);
    }
    if (data.origen) {
      setOrigenNuevo(data.origen);
    }
    if (data.categoria || data.tipoPieza || data.nombre) {
      const jer = resolverJerarquiaCategoria({
        categoria: data.categoria,
        tipoPieza: data.tipoPieza,
        nombre: data.nombre,
      });
      if (jer.categoria) setCategoriaNueva(jer.categoria);
      if (jer.subcategoria) setSubcategoriaNueva(jer.subcategoria);
      setSubcategoriaDetalleNueva(jer.subcategoriaDetalle || '');
    }
    if (data.tipoPieza) {
      setTipoPiezaNuevo(data.tipoPieza);
    }
    if (Array.isArray(data.marcasCompatibles) && data.marcasCompatibles.length > 0) {
      setMarcasCompatiblesNuevas(data.marcasCompatibles.join(', '));
      setMarcaParaNuevoModelo(data.marcasCompatibles[0]);
    }
    if (data.modelosCompatibles && Object.keys(data.modelosCompatibles).length > 0) {
      setModelosCompatiblesMap(data.modelosCompatibles);
    }
    if (data.anioDesde !== undefined) setAnioDesdeNuevo(data.anioDesde);
    if (data.anioHasta !== undefined) setAnioHastaNuevo(data.anioHasta);
    if (Array.isArray(data.equivalencias) && data.equivalencias.length > 0) {
      setEquivalenciasNuevas(data.equivalencias);
    }
    if (data.descripcion) {
      setDescripcionTecnicaNueva(data.descripcion);
    }
  };

  // Ejecutar búsqueda por código de barra / SKU / OEM
  const handleBuscarCodigo = async (codigoABuscar?: string) => {
    const cod = (codigoABuscar || codigoScan).trim().toUpperCase();
    if (!cod) return;

    try {
      setBuscando(true);
      setErrorMsg(null);
      setInfoMetadataMsg(null);
      setResultado(null);

      const res = await inventarioService.lookupCodigo(cod);

      if (res.success && res.data) {
        const { origen, item } = res.data;

        if (origen === 'inventario_existente' && item.id) {
          playBeep('ok');
          setResultado({ tipo: 'existente', item });
          setCantAgregar(1);
          setCodigoProductoExistente(item.codigoProducto || '');
          const costoBase = Number(item.precioCompra) || 0;
          setNuevoCosto(costoBase);
          setNuevoPrecioVenta(Number(item.precioVenta || item.precioLista) || Math.round(costoBase * 1.3));
        } else {
          // Producto nuevo: diferenciar si el código pistoleado es un EAN numérico de caja o si ya trajo un Código de Producto OEM
          playBeep('nuevo');
          setResultado({ tipo: 'nuevo', item });
          setCodigoProductoNuevo(item.codigoProducto || '');
          setCodigoOemRaizDetectado(item.codigoOemRaiz || '');
          setNombreNuevo(item.nombre || '');
          setFabricanteNuevo(item.fabricante || '');
          setOrigenNuevo(item.origen || '');
          const jer = resolverJerarquiaCategoria({
            categoria: item.categoria,
            subcategoria: item.subcategoria,
            subcategoriaDetalle: item.subcategoriaDetalle,
            tipoPieza: item.tipoPieza,
            nombre: item.nombre,
          });
          setCategoriaNueva(jer.categoria || 'Frenos');
          setSubcategoriaNueva(jer.subcategoria || 'Pastillas y Balatas');
          setSubcategoriaDetalleNueva(jer.subcategoriaDetalle || '');
          setTipoPiezaNuevo(item.tipoPieza || (jer.subcategoriaDetalle || jer.subcategoria || '').toUpperCase());
          const marcasArr = item.marcasCompatibles || [];
          setMarcasCompatiblesNuevas(marcasArr.join(', '));
          setMarcaParaNuevoModelo(marcasArr[0] || 'SUZUKI');
          setModelosCompatiblesMap(item.modelosCompatibles || {});
          setAnioDesdeNuevo(item.anioDesde ?? null);
          setAnioHastaNuevo(item.anioHasta ?? null);
          setEquivalenciasNuevas(item.equivalencias || []);
          setDescripcionTecnicaNueva(item.descripcion || '');
          setCostoNuevo(Number(item.precioCompra) || 0);
          setPrecioVentaNuevo(Number(item.precioVenta) || 0);
          setStockInicial(1);
          setStockMinimo(2);

          if (item.codigoProducto) {
            const totalModelos = Object.values(item.modelosCompatibles || {}).flat().length;
            setInfoMetadataMsg(
              `✅ Código de Producto "${item.codigoProducto}" identificado (Raíz OEM: ${item.codigoOemRaiz || item.codigoProducto}) · ${totalModelos} modelo(s) de vehículos compatibles cargados automáticamente.`
            );
          } else {
            setInfoMetadataMsg(
              `💡 Pistoleaste un SKU / Código de Barras de bodega (${cod}). Ingresa abajo el "Código de Producto / Nº Parte OEM" de la etiqueta (ej: 13420-65D00TW) o sácale foto a la caja para extraer todos los modelos de auto compatibles.`
            );
            setTimeout(() => codigoProductoRef.current?.focus(), 80);
          }
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

  // Analizar el Código de Producto (OEM) + Descripción de Etiqueta para extraer marcas, modelos compatibles y cruces
  const handleAnalizarCodigoProducto = async (imagenBase64?: string) => {
    const codProd = codigoProductoNuevo.trim().toUpperCase();
    const nomEtiq = nombreNuevo.trim().toUpperCase();
    if (!codProd && !nomEtiq && !imagenBase64) {
      setErrorMsg('Ingresa el Código de Producto (ej: 13420-65D00TW), el texto de la etiqueta o sube una foto de la caja.');
      return;
    }

    try {
      setAnalizandoOem(true);
      setErrorMsg(null);
      const res = await inventarioService.analizarCodigoProducto({
        codigoProducto: codProd,
        codigoBarras: codigoScan.trim().toUpperCase(),
        nombreEtiqueta: nomEtiq,
        imagenDataUrl: imagenBase64,
      });

      if (res.success && res.data) {
        const d = res.data;
        if (!resultado) {
          setResultado({
            tipo: 'nuevo',
            item: {
              codigo: d.codigoBarras || codigoScan,
              codigoProducto: d.codigoProducto,
            },
          });
        }
        aplicarMetadataAlFormulario(d);
        const totalModelos = Object.values(d.modelosCompatibles || {}).flat().length;
        setInfoMetadataMsg(
          `🧠 Metadata OEM extraída desde "${d.codigoProducto || nomEtiq}"${d.origen ? ` · Origen: ${d.origen}` : ''} · ${d.marcasCompatibles.join(', ')} (${totalModelos} modelos compatibles detectados).`
        );
        playBeep('ok');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al analizar código de producto';
      setErrorMsg(msg);
    } finally {
      setAnalizandoOem(false);
    }
  };

  // Subir o sacar foto a la etiqueta de la caja desde el modal de pistola
  const handleSubirFotoEtiqueta = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl) {
        handleAnalizarCodigoProducto(dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleKeyDownScanner = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBuscarCodigo();
    }
  };

  // Agregar o quitar un modelo compatible en el diccionario `modelosCompatiblesMap`
  const handleAgregarModeloCompatible = () => {
    const modelo = nuevoModeloInput.trim().toUpperCase();
    if (!modelo) return;
    const marcasLista = marcasCompatiblesNuevas
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const marcaTarget = (marcaParaNuevoModelo || marcasLista[0] || 'SUZUKI').toUpperCase();

    if (!marcasLista.includes(marcaTarget)) {
      setMarcasCompatiblesNuevas([...marcasLista, marcaTarget].join(', '));
    }

    setModelosCompatiblesMap((prev) => {
      const actuales = prev[marcaTarget] || [];
      if (actuales.includes(modelo)) return prev;
      return {
        ...prev,
        [marcaTarget]: [...actuales, modelo],
      };
    });
    setNuevoModeloInput('');
  };

  const handleQuitarModeloCompatible = (marca: string, modelo: string) => {
    setModelosCompatiblesMap((prev) => {
      const actuales = (prev[marca] || []).filter((m) => m !== modelo);
      const copia = { ...prev };
      if (actuales.length > 0) {
        copia[marca] = actuales;
      } else {
        delete copia[marca];
      }
      return copia;
    });
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

      // Si cambió el precio, costo o se agregó el Código de Producto OEM, actualizar ficha
      const huboCambioFicha =
        nuevoCosto !== Number(resultado.item.precioCompra) ||
        nuevoPrecioVenta !== Number(resultado.item.precioVenta || resultado.item.precioLista) ||
        codigoProductoExistente.trim().toUpperCase() !== String(resultado.item.codigoProducto || '').toUpperCase();

      if (huboCambioFicha) {
        await inventarioService.update(resultado.item.id, {
          precioCompra: nuevoCosto,
          precioVenta: nuevoPrecioVenta,
          precioLista: nuevoPrecioVenta,
          codigoProducto: codigoProductoExistente.trim().toUpperCase(),
        });
      }

      playBeep('ok');
      setHistorialSesion((prev) => [
        {
          nombre: resultado.item.nombre || 'Repuesto',
          codigo: resultado.item.codigo || '',
          codigoProducto: codigoProductoExistente.trim().toUpperCase() || resultado.item.codigoProducto,
          cantidad: cantAgregar,
          accion: 'sumado',
          hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
        ...prev,
      ]);

      // Limpiar para siguiente escaneo
      setResultado(null);
      setCodigoScan('');
      setInfoMetadataMsg(null);
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

  // Guardar producto NUEVO con separación SKU Pistola (`codigo`) + Código de Producto OEM (`codigoProducto`) + Metadata Multi-Modelo
  const handleGuardarNuevo = async () => {
    if (!resultado) return;

    try {
      setGuardando(true);
      setErrorMsg(null);

      const marcas = marcasCompatiblesNuevas
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const codBarrasFinal = codigoScan.trim().toUpperCase() || codigoProductoNuevo.trim().toUpperCase();
      const codProdFinal = codigoProductoNuevo.trim().toUpperCase();

      // Asegurar que el Código de Producto y su raíz OEM queden también en equivalencias para búsqueda cruzada
      const eqList = [...equivalenciasNuevas];
      if (codProdFinal && !eqList.some((e) => e.codigo === codProdFinal)) {
        eqList.push({ fabricante: fabricanteNuevo.trim().toUpperCase() || 'OEM', codigo: codProdFinal });
      }
      if (codigoOemRaizDetectado && !eqList.some((e) => e.codigo === codigoOemRaizDetectado)) {
        eqList.push({ fabricante: `OEM ${marcas[0] || 'ORIGINAL'}`, codigo: codigoOemRaizDetectado });
      }

      const tipoPiezaFinal =
        tipoPiezaNuevo.trim().toUpperCase() ||
        (subcategoriaDetalleNueva || subcategoriaNueva || 'REPUESTO').toUpperCase();

      const payload: Omit<ItemInventario, 'id'> = {
        nombre: nombreNuevo.trim().toUpperCase(),
        codigo: codBarrasFinal,
        codigoProducto: codProdFinal,
        fabricante: fabricanteNuevo.trim().toUpperCase(),
        origen: origenNuevo.trim().toUpperCase(),
        descripcion: descripcionTecnicaNueva.trim(),
        categoria: categoriaNueva,
        subcategoria: subcategoriaNueva,
        subcategoriaDetalle: subcategoriaDetalleNueva,
        tipoPieza: tipoPiezaFinal,
        posicion: (resultado.item.posicion as PosicionPieza) || 'NO APLICA',
        lado: (resultado.item.lado as LadoPieza) || 'NO APLICA',
        marcasCompatibles: marcas,
        modelosCompatibles: modelosCompatiblesMap,
        equivalencias: eqList,
        precioCompra: Number(costoNuevo) || 0,
        precioLista: Number(precioVentaNuevo) || Math.round((Number(costoNuevo) || 0) * 1.3),
        precioVenta: Number(precioVentaNuevo) || Math.round((Number(costoNuevo) || 0) * 1.3),
        stock: Number(stockInicial) || 1,
        stockReservado: 0,
        stockMinimo: Number(stockMinimo) || 2,
        unidad: 'UNIDAD',
        proveedor: '',
        anioDesde: anioDesdeNuevo,
        anioHasta: anioHastaNuevo,
      };

      await inventarioService.create(payload);

      playBeep('ok');
      setHistorialSesion((prev) => [
        {
          nombre: payload.nombre,
          codigo: payload.codigo,
          codigoProducto: payload.codigoProducto,
          cantidad: payload.stock,
          accion: 'creado',
          hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
        ...prev,
      ]);

      // Limpiar para siguiente escaneo en ráfaga
      setResultado(null);
      setCodigoScan('');
      setCodigoProductoNuevo('');
      setInfoMetadataMsg(null);
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

  const listaMarcasActuales = marcasCompatiblesNuevas
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '720px' }}>
        <div className={styles.modalHeader}>
          <div className={styles.headerTitle}>
            <span>⚡ Ingreso Rápido (Pistola SKU Stock + Código Producto OEM)</span>
          </div>
          <button className={styles.closeBtn} onClick={onCerrar} title="Cerrar (Esc)">
            ✕
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* ── BARRA PRINCIPAL DE ESCANEO (PASO 1: PISTOLEO SKU / CÓDIGO DE BARRAS) ── */}
          <div className={styles.scannerCard}>
            <div className={styles.scannerStatus}>
              <span>
                <span className={styles.liveDot} />
                1️⃣ SKU / Código de Barras (Para sumar y descontar existencias con pistola)
              </span>
              <span>Pistolea el código de barras de la caja</span>
            </div>

            <div className={styles.scannerInputWrap}>
              <span className={styles.iconBarcode}>🔫</span>
              <input
                ref={scannerRef}
                type="text"
                className={styles.scannerInput}
                placeholder="Ej: 5812495152509 (Código de barras para control de stock)..."
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
              <input
                ref={fileEtiquetaRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={handleSubirFotoEtiqueta}
              />
              <button
                type="button"
                onClick={() => fileEtiquetaRef.current?.click()}
                disabled={analizandoOem}
                title="Sácale una foto a la etiqueta de la caja (ej: 13420-65D00TW) para extraer ambos códigos y los modelos compatibles"
                style={{
                  background: '#0f766e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 0.85rem',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {analizandoOem ? 'Leyendo...' : '📸 Foto Etiqueta'}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              style={{
                color: '#ef4444',
                background: '#fee2e2',
                padding: '0.65rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {infoMetadataMsg && (
            <div
              style={{
                color: '#0369a1',
                background: '#e0f2fe',
                border: '1px solid #7dd3fc',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {infoMetadataMsg}
            </div>
          )}

          {/* ── CASO A: REPUESTO YA EXISTE EN BODEGA ── */}
          {resultado?.tipo === 'existente' && (
            <div className={styles.cardExistente}>
              <span className={styles.badgeExistente}>✓ Repuesto ya registrado en bodega (Suma de Stock)</span>

              <div className={styles.itemResumen}>
                <div>
                  <div className={styles.itemNombre}>{resultado.item.nombre}</div>
                  <div className={styles.itemMeta}>
                    <span>
                      🔫 SKU Barra: <strong>{resultado.item.codigo}</strong>
                    </span>
                    {resultado.item.codigoProducto && (
                      <span>
                        🔩 Cód. Producto (OEM): <strong>{resultado.item.codigoProducto}</strong>
                      </span>
                    )}
                    <span>
                      Marca: <strong>{resultado.item.fabricante || '—'}</strong>
                    </span>
                    <span>
                      Categoría: <strong>{resultado.item.categoria}</strong>
                    </span>
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
                  <label className={styles.fieldLabel}>🔩 Código Producto / OEM</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    placeholder="Ej: 13420-65D00TW"
                    value={codigoProductoExistente}
                    onChange={(e) => setCodigoProductoExistente(e.target.value.toUpperCase())}
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

              <button className={styles.btnSubmitAdd} onClick={handleGuardarExistente} disabled={guardando}>
                {guardando ? 'Actualizando...' : `📥 Sumar +${cantAgregar} un. a Bodega (Enter)`}
              </button>
            </div>
          )}

          {/* ── CASO B: PRODUCTO NUEVO (CON INTELIGENCIA POR CÓDIGO DE PRODUCTO OEM + MULTI-MODELO) ── */}
          {resultado?.tipo === 'nuevo' && (
            <div className={styles.cardNuevo}>
              <span className={styles.badgeNuevo}>
                ✨ Paso 2: Identificación Técnica por Código de Producto (OEM) y Modelos Compatibles
              </span>

              {/* BLOQUE DESTACADO: CÓDIGO DE PRODUCTO OEM (EJ: 13420-65D00TW) */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1.5px solid #0284c7',
                  borderRadius: '10px',
                  padding: '0.85rem',
                  marginBottom: '0.9rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.4rem',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: '#0369a1',
                      textTransform: 'uppercase',
                    }}
                  >
                    🔩 2️⃣ Código del Producto / Nº de Parte OEM (Impreso arriba en la etiqueta)
                  </label>
                  {codigoOemRaizDetectado && (
                    <span
                      style={{
                        fontSize: '0.73rem',
                        background: '#dbeafe',
                        color: '#1e40af',
                        padding: '2px 8px',
                        borderRadius: '99px',
                        fontWeight: 700,
                      }}
                    >
                      Raíz OEM: {codigoOemRaizDetectado}
                      {origenNuevo ? ` · Procedencia: ${origenNuevo}` : ''}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={codigoProductoRef}
                    type="text"
                    className={styles.fieldInput}
                    style={{ flex: 1, fontWeight: 800, fontFamily: 'monospace', fontSize: '0.98rem' }}
                    placeholder="Ej: 13420-65D00TW (Presiona Enter para autocompletar modelos y datos)"
                    value={codigoProductoNuevo}
                    onChange={(e) => setCodigoProductoNuevo(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAnalizarCodigoProducto();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAnalizarCodigoProducto()}
                    disabled={analizandoOem}
                    style={{
                      background: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0 1rem',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {analizandoOem ? 'Analizando...' : '🧠 Extraer Metadata OEM'}
                  </button>
                </div>
                <div style={{ fontSize: '0.73rem', color: '#475569', marginTop: '0.35rem' }}>
                  El <strong>SKU de Barra ({codigoScan || '—'})</strong> controla el stock con la pistola; el{' '}
                  <strong>Código de Producto ({codigoProductoNuevo || 'ej: 13420-65D00TW'})</strong> identifica la pieza real y todos los modelos de auto a los que les sirve.
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={`${styles.fieldGroup} ${styles.fullCol}`}>
                  <label className={styles.fieldLabel}>
                    Nombre / Descripción en Etiqueta (ej: SENSOR TPS VIT AERIO Y OTROS)
                  </label>
                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    <input
                      type="text"
                      className={styles.fieldInput}
                      style={{ flex: 1 }}
                      placeholder="Ej: SENSOR TPS VIT AERIO Y OTROS"
                      value={nombreNuevo}
                      onChange={(e) => setNombreNuevo(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAnalizarCodigoProducto();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleAnalizarCodigoProducto()}
                      title="Interpretar abreviaturas del nombre (ej: VIT -> VITARA, GRAND VITARA; AERIO -> AERIO)"
                      style={{
                        background: '#e2e8f0',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: '7px',
                        padding: '0 0.75rem',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Detectar Modelos
                    </button>
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Marca del Repuesto (Fabricante / Caja)</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={fabricanteNuevo}
                    placeholder="Ej: NET MOTORS, BOSCH, DENSO..."
                    onChange={(e) => setFabricanteNuevo(e.target.value.toUpperCase())}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Procedencia / Origen (Sufijo TW, JP, KR...)</label>
                  <input
                    list="pistola-origenes-list"
                    type="text"
                    className={styles.fieldInput}
                    value={origenNuevo}
                    placeholder="Ej: TAIWÁN, JAPÓN, COREA DEL SUR..."
                    onChange={(e) => setOrigenNuevo(e.target.value.toUpperCase())}
                  />
                  <datalist id="pistola-origenes-list">
                    {ORIGENES_REPUESTO.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>1️⃣ Categoría Principal (Tienda)</label>
                  <select
                    className={styles.fieldInput}
                    value={categoriaNueva}
                    onChange={(e) => {
                      const nuevaCat = e.target.value;
                      const subs = obtenerSubcategorias(nuevaCat);
                      const primeraSub = subs[0]?.nombre || '';
                      const primeraDet = subs[0]?.hijos?.[0] || '';
                      setCategoriaNueva(nuevaCat);
                      setSubcategoriaNueva(primeraSub);
                      setSubcategoriaDetalleNueva(primeraDet);
                      setTipoPiezaNuevo((primeraDet || primeraSub || '').toUpperCase());
                    }}
                  >
                    {CATEGORIAS_DEFAULT.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>2️⃣ Subcategoría</label>
                  <select
                    className={styles.fieldInput}
                    value={subcategoriaNueva}
                    onChange={(e) => {
                      const nuevaSub = e.target.value;
                      const dets = obtenerSubcategoriasDetalle(categoriaNueva, nuevaSub);
                      const primeraDet = dets[0] || '';
                      setSubcategoriaNueva(nuevaSub);
                      setSubcategoriaDetalleNueva(primeraDet);
                      setTipoPiezaNuevo((primeraDet || nuevaSub || '').toUpperCase());
                    }}
                  >
                    {obtenerSubcategorias(categoriaNueva).map((sub) => (
                      <option key={sub.nombre} value={sub.nombre}>
                        {sub.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {obtenerSubcategoriasDetalle(categoriaNueva, subcategoriaNueva).length > 0 && (
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>3️⃣ Subcategoría Específica</label>
                    <select
                      className={styles.fieldInput}
                      value={subcategoriaDetalleNueva}
                      onChange={(e) => {
                        const det = e.target.value;
                        setSubcategoriaDetalleNueva(det);
                        if (det) setTipoPiezaNuevo(det.toUpperCase());
                      }}
                    >
                      {obtenerSubcategoriasDetalle(categoriaNueva, subcategoriaNueva).map((det) => (
                        <option key={det} value={det}>
                          {det}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Tipo de Pieza</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={tipoPiezaNuevo}
                    placeholder="Ej: SENSOR, PASTILLAS Y BALATAS..."
                    onChange={(e) => setTipoPiezaNuevo(e.target.value.toUpperCase())}
                  />
                </div>

                <div className={`${styles.fieldGroup} ${styles.fullCol}`}>
                  <label className={styles.fieldLabel}>
                    Marcas de Vehículos Compatibles (Separadas por coma)
                  </label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={marcasCompatiblesNuevas}
                    placeholder="Ej: SUZUKI, CHEVROLET..."
                    onChange={(e) => setMarcasCompatiblesNuevas(e.target.value.toUpperCase())}
                  />
                </div>

                {/* METADATA MULTI-MODELO COMPATIBLE (CRÍTICO PARA EL BUSCADOR Y AGENTE IA) */}
                <div className={`${styles.fieldGroup} ${styles.fullCol}`}>
                  <label className={styles.fieldLabel}>
                    🚗 Modelos de Autos Compatibles (Metadata Multi-Modelo por Código de Producto)
                  </label>
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '0.65rem',
                    }}
                  >
                    {Object.keys(modelosCompatiblesMap).length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.45rem' }}>
                        Aún no hay modelos específicos asignados. Ingresa arriba el Código de Producto (ej:{' '}
                        <code>13420-65D00TW</code>) o agrega un modelo manualmente:
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.55rem' }}>
                        {Object.entries(modelosCompatiblesMap).map(([marca, modelos]) => (
                          <div
                            key={marca}
                            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}
                          >
                            <span
                              style={{
                                fontSize: '0.73rem',
                                fontWeight: 800,
                                background: '#0f172a',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: '5px',
                              }}
                            >
                              {marca}:
                            </span>
                            {modelos.map((mod) => (
                              <span
                                key={mod}
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  background: '#dcfce7',
                                  color: '#166534',
                                  border: '1px solid #86efac',
                                  padding: '2px 8px',
                                  borderRadius: '99px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {mod}
                                <button
                                  type="button"
                                  onClick={() => handleQuitarModeloCompatible(marca, mod)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#15803d',
                                    cursor: 'pointer',
                                    fontWeight: 900,
                                    padding: 0,
                                    lineHeight: 1,
                                  }}
                                  title="Quitar modelo"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        className={styles.fieldInput}
                        style={{ width: '130px', padding: '0.35rem 0.55rem', fontSize: '0.8rem' }}
                        placeholder="Marca (SUZUKI)"
                        value={marcaParaNuevoModelo || listaMarcasActuales[0] || ''}
                        onChange={(e) => setMarcaParaNuevoModelo(e.target.value.toUpperCase())}
                      />
                      <input
                        type="text"
                        className={styles.fieldInput}
                        style={{ flex: 1, padding: '0.35rem 0.55rem', fontSize: '0.8rem' }}
                        placeholder="Agregar otro modelo compatible (ej: GRAND VITARA, AERIO, JIMNY)..."
                        value={nuevoModeloInput}
                        onChange={(e) => setNuevoModeloInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAgregarModeloCompatible();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleAgregarModeloCompatible}
                        style={{
                          background: '#1e293b',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '0 0.75rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        + Modelo
                      </button>
                    </div>

                    {/* Mostrar equivalencias OEM y años detectados */}
                    {(equivalenciasNuevas.length > 0 || anioDesdeNuevo || anioHastaNuevo) && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          paddingTop: '0.45rem',
                          borderTop: '1px dashed #cbd5e1',
                          fontSize: '0.74rem',
                          color: '#334155',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.6rem',
                        }}
                      >
                        {(anioDesdeNuevo || anioHastaNuevo) && (
                          <span>
                            📅 <strong>Años:</strong> {anioDesdeNuevo || '?'} – {anioHastaNuevo || 'Actual'}
                          </span>
                        )}
                        {equivalenciasNuevas.length > 0 && (
                          <span>
                            🔗 <strong>Cruces OEM:</strong>{' '}
                            {equivalenciasNuevas.map((e) => `${e.fabricante}: ${e.codigo}`).join(' · ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Costo Compra (Neto)</label>
                  <input
                    type="number"
                    className={styles.fieldInput}
                    placeholder="0"
                    value={costoNuevo || ''}
                    onChange={(e) => handleCostoNuevoChange(Number(e.target.value) || 0)}
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
                    <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '6px' }}>
                      [SKU: {h.codigo}
                      {h.codigoProducto ? ` · OEM: ${h.codigoProducto}` : ''}]
                    </span>
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
