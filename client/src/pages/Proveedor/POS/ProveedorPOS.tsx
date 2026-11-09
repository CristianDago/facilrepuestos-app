import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { inventarioService } from '../../../services/inventario';
import { posService, type ItemVentaPOS, type MetodoPagoPOS, type VentaPOSRegistrada } from '../../../services/pos';
import type { ItemInventario } from '../../../types';
import TicketTermicoModal from './TicketTermicoModal';
import IngresoRapidoModal from '../../Inventario/IngresoRapidoModal';
import styles from './ProveedorPOS.module.css';

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const conIva = (neto: number) => Math.round((neto || 0) * 1.19);
const TTL_MOSTRADOR_SEGUNDOS = 30 * 60; // 30 minutos (1800 segundos)
const STORAGE_KEY_MOSTRADOR = 'facilrepuestos_pos_mostrador_v1';

function formatearRelojReserva(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Reproduce un beep sutil y positivo con Web Audio API al escanear
function playBeep(tipo: 'ok' | 'error' = 'ok') {
  try {
    const AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
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
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroMarcaVehiculo, setFiltroMarcaVehiculo] = useState('');
  const [carro, setCarro] = useState<ItemVentaPOS[]>([]);

  // Reloj de reserva de 30 minutos en Mostrador / Ventana (modelo e-commerce)
  const [expiraEnIso, setExpiraEnIso] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState<number>(0);
  const [sincronizandoReserva, setSincronizandoReserva] = useState<boolean>(false);

  // Datos de venta y descuento sobre el total
  const [metodoPago, setMetodoPago] = useState<MetodoPagoPOS>('EFECTIVO');
  const [descuentoTipo, setDescuentoTipo] = useState<'PORCENTAJE' | 'MONTO'>('PORCENTAJE');
  const [descuentoValor, setDescuentoValor] = useState<number>(0);
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

  // Cantidad actualmente retenida en ESTE mostrador por cada itemId (para reflejar el stock disponible en tiempo real)
  const cantidadesEnMostradorMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of carro) {
      map.set(it.id, (map.get(it.id) || 0) + it.cantidad);
    }
    return map;
  }, [carro]);

  // Verifica si algún modal secundario está abierto
  const hayModalAbierto =
    modalPistolaCodigo !== null || ventaCompletada !== null || mostrarHistorial;

  // Función que garantiza que el cursor vuelva siempre al lector de código de barra,
  // a menos que el usuario haya hecho clic explícitamente en otro input/select/textarea.
  const enfocarEscannerSiCorresponde = useCallback(
    (forzar = false) => {
      if (hayModalAbierto) return;
      const active = document.activeElement as HTMLElement | null;
      if (!forzar && active) {
        const tag = active.tagName;
        if (
          (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || active.isContentEditable) &&
          active !== searchInputRef.current
        ) {
          return;
        }
      }
      searchInputRef.current?.focus();
    },
    [hayModalAbierto]
  );

  // Mantener el cursor SIEMPRE listo para pistolear mientras la ventana del POS esté abierta
  useEffect(() => {
    enfocarEscannerSiCorresponde(true);

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      // Si hizo clic en un botón o área vacía, devolver el foco al lector de pistola
      setTimeout(() => enfocarEscannerSiCorresponde(true), 20);
    };

    const handleGlobalKeyDownCapture = (e: KeyboardEvent) => {
      if (hayModalAbierto) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const enOtroCampo =
        active &&
        active !== searchInputRef.current &&
        (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || active.isContentEditable);

      if (enOtroCampo) return;

      // Si el usuario dispara la pistola lectora sin tener el input enfocado, redirigir al instante
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.activeElement !== searchInputRef.current
      ) {
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDownCapture, true);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDownCapture, true);
    };
  }, [enfocarEscannerSiCorresponde, hayModalAbierto]);

  // Cargar inventario al montar o tras cambios (reseteando filtros y búsqueda a 0 cuando se solicita)
  const cargarInventario = useCallback(async (resetearVistaCatalogo = false) => {
    try {
      setLoading(true);
      if (resetearVistaCatalogo) {
        setBusqueda('');
        setFiltroCategoria('');
        setFiltroMarcaVehiculo('');
      }
      const res = await inventarioService.getAll();
      setInventario(res.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar inventario';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sincronizar el estado del Mostrador / Ventana con el backend (retención real de stock por 30 min) y localStorage
  const persistirMostradorReserva = useCallback(
    async (
      nuevosItems: ItemVentaPOS[],
      opciones?: {
        renovarTiempo?: boolean;
        clienteObj?: { nombre?: string; rut?: string; patente?: string; telefono?: string };
        metodo?: MetodoPagoPOS;
        dTipo?: 'PORCENTAJE' | 'MONTO';
        dValor?: number;
      }
    ) => {
      const clienteActual = opciones?.clienteObj ?? {
        nombre: clienteNombre.trim() || undefined,
        rut: clienteRut.trim() || undefined,
        patente: clientePatente.trim() || undefined,
        telefono: clienteTelefono.trim() || undefined,
      };
      const metodoActual = opciones?.metodo ?? metodoPago;
      const dTipoActual = opciones?.dTipo ?? descuentoTipo;
      const dValorActual = opciones?.dValor ?? descuentoValor;

      if (nuevosItems.length === 0) {
        localStorage.removeItem(STORAGE_KEY_MOSTRADOR);
        setExpiraEnIso(null);
        setSegundosRestantes(0);
        try {
          setSincronizandoReserva(true);
          await posService.cancelarMostrador();
          await cargarInventario(false);
        } catch {
          // Silencioso
        } finally {
          setSincronizandoReserva(false);
        }
        return;
      }

      const nuevaExpiracion =
        opciones?.renovarTiempo === false && expiraEnIso
          ? expiraEnIso
          : new Date(Date.now() + TTL_MOSTRADOR_SEGUNDOS * 1000).toISOString();

      setExpiraEnIso(nuevaExpiracion);
      setSegundosRestantes(
        Math.max(0, Math.floor((new Date(nuevaExpiracion).getTime() - Date.now()) / 1000))
      );

      localStorage.setItem(
        STORAGE_KEY_MOSTRADOR,
        JSON.stringify({
          items: nuevosItems,
          cliente: clienteActual,
          metodoPago: metodoActual,
          descuentoTipo: dTipoActual,
          descuentoValor: dValorActual,
          expiraEn: nuevaExpiracion,
        })
      );

      try {
        setSincronizandoReserva(true);
        const res = await posService.sincronizarMostrador({
          items: nuevosItems,
          cliente: clienteActual,
          metodoPago: metodoActual,
          descuentoTipo: dTipoActual,
          descuentoValor: dValorActual,
          renovarTiempo: opciones?.renovarTiempo ?? true,
        });
        if (res.success && res.data) {
          setExpiraEnIso(res.data.expiraEn);
          setSegundosRestantes(res.data.segundosRestantes);
        }
        await cargarInventario(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al reservar stock en mostrador';
        setErrorMsg(msg);
      } finally {
        setSincronizandoReserva(false);
      }
    },
    [
      clienteNombre,
      clienteRut,
      clientePatente,
      clienteTelefono,
      metodoPago,
      descuentoTipo,
      descuentoValor,
      expiraEnIso,
      cargarInventario,
    ]
  );

  // Al iniciar: partir con la búsqueda/catálogo en 0, cargar inventario y restaurar el Mostrador si tiene reserva activa (< 30 min)
  useEffect(() => {
    let montado = true;
    const inicializarPOS = async () => {
      setBusqueda('');
      setFiltroCategoria('');
      setFiltroMarcaVehiculo('');
      await cargarInventario(true);

      try {
        const res = await posService.obtenerMostrador();
        if (!montado) return;
        if (res.success && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
          setCarro(res.data.items);
          setClienteNombre(res.data.cliente?.nombre || '');
          setClienteRut(res.data.cliente?.rut || '');
          setClientePatente(res.data.cliente?.patente || '');
          setClienteTelefono(res.data.cliente?.telefono || '');
          if (res.data.metodoPago) setMetodoPago(res.data.metodoPago);
          if (res.data.descuentoTipo) setDescuentoTipo(res.data.descuentoTipo);
          if (res.data.descuentoValor !== undefined) setDescuentoValor(Number(res.data.descuentoValor) || 0);
          setExpiraEnIso(res.data.expiraEn);
          setSegundosRestantes(res.data.segundosRestantes);
          return;
        }
      } catch {
        // Fallback a localStorage si hubo corte puntual
      }

      // Revisar localStorage si el backend no tenía sesión pero aún no vencen los 30 min locales
      const guardadoRaw = localStorage.getItem(STORAGE_KEY_MOSTRADOR);
      if (guardadoRaw) {
        try {
          const parsed = JSON.parse(guardadoRaw);
          const expMs = parsed?.expiraEn ? new Date(parsed.expiraEn).getTime() : 0;
          if (expMs > Date.now() && Array.isArray(parsed.items) && parsed.items.length > 0) {
            setCarro(parsed.items);
            setClienteNombre(parsed.cliente?.nombre || '');
            setClienteRut(parsed.cliente?.rut || '');
            setClientePatente(parsed.cliente?.patente || '');
            setClienteTelefono(parsed.cliente?.telefono || '');
            if (parsed.metodoPago) setMetodoPago(parsed.metodoPago);
            if (parsed.descuentoTipo) setDescuentoTipo(parsed.descuentoTipo);
            if (parsed.descuentoValor !== undefined) setDescuentoValor(Number(parsed.descuentoValor) || 0);
            setExpiraEnIso(parsed.expiraEn);
            setSegundosRestantes(Math.max(0, Math.floor((expMs - Date.now()) / 1000)));
          } else {
            localStorage.removeItem(STORAGE_KEY_MOSTRADOR);
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY_MOSTRADOR);
        }
      }
    };

    inicializarPOS();
    return () => {
      montado = false;
    };
  }, [cargarInventario]);

  // Reloj regresivo de 30 minutos para el Mostrador / Ventana
  useEffect(() => {
    if (!expiraEnIso || carro.length === 0) return;

    const timer = setInterval(() => {
      const rest = Math.max(0, Math.floor((new Date(expiraEnIso).getTime() - Date.now()) / 1000));
      setSegundosRestantes(rest);
      if (rest <= 0) {
        clearInterval(timer);
        // Expiraron los 30 minutos: liberar stock automáticamente y vaciar mostrador
        setCarro([]);
        setExpiraEnIso(null);
        localStorage.removeItem(STORAGE_KEY_MOSTRADOR);
        posService.cancelarMostrador().finally(() => cargarInventario(false));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiraEnIso, carro.length, cargarInventario]);

  const cargarHistorialVentas = async () => {
    try {
      setCargandoHistorial(true);
      const res = await posService.obtenerVentas();
      setHistorialVentas(res.data || []);
    } catch {
      // Silencioso
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
      const disponible = invItem
        ? Math.max(0, (invItem.stock || 0) - (invItem.stockReservado || 0))
        : it.cantidad;
      const precioNeto = Number(it.precioNeto) || 0;
      const precioConIva = conIva(precioNeto);
      const cant = Math.min(it.cantidad, Math.max(1, disponible));
      nuevosItems.push({
        id: it.id,
        nombre: it.nombre,
        codigo: it.codigo || '',
        codigoProducto: invItem?.codigoProducto || it.codigoProducto || '',
        fabricante: invItem?.fabricante || '',
        precioNeto,
        precioConIva,
        cantidad: cant,
        subtotalNeto: precioNeto * cant,
        subtotalConIva: precioConIva * cant,
        disponible,
      });
    }
    setCarro(nuevosItems);
    setClienteNombre(cot.cliente?.nombre || '');
    setClienteRut(cot.cliente?.rut || '');
    setClientePatente(cot.cliente?.patente || '');
    setClienteTelefono(cot.cliente?.telefono || '');
    setDescuentoTipo(cot.descuentoTipo === 'MONTO' ? 'MONTO' : 'PORCENTAJE');
    setDescuentoValor(Number(cot.descuentoValor) || 0);
    setMostrarHistorial(false);
    playBeep('ok');
    persistirMostradorReserva(nuevosItems, { renovarTiempo: true });
    setTimeout(() => enfocarEscannerSiCorresponde(true), 60);
  };

  // Calcula cuántas unidades quedan disponibles para agregar en bodega de un ítem
  // (`stock - stockReservado` ya descuenta lo que está retenido en el Mostrador cuando sincronizó con backend)
  const obtenerDisponibleBodega = useCallback((item: ItemInventario) => {
    return Math.max(0, (Number(item.stock) || 0) - (Number(item.stockReservado) || 0));
  }, []);

  // Agregar producto al Mostrador / Ventana y descontarlo inmediatamente del stock disponible local
  const agregarAlCarro = (item: ItemInventario, limpiarBusquedaAlAgregar = false) => {
    const disponibleRestante = obtenerDisponibleBodega(item);
    if (disponibleRestante <= 0) {
      playBeep('error');
      setErrorMsg(`El repuesto "${item.nombre || item.codigo}" no tiene más stock disponible en bodega.`);
      setTimeout(() => enfocarEscannerSiCorresponde(true), 50);
      return;
    }

    const itemId = item.id;
    if (!itemId) {
      setErrorMsg('El repuesto seleccionado no tiene un ID válido');
      return;
    }

    setErrorMsg(null);
    const precioNeto = Number(item.precioVenta || item.precioLista || item.precioCompra || 0);
    const precioConIva = conIva(precioNeto);
    const idx = carro.findIndex((p) => p.id === itemId);

    let actualizado: ItemVentaPOS[];
    if (idx >= 0) {
      const itemActual = carro[idx];
      const nuevaCant = itemActual.cantidad + 1;
      actualizado = [...carro];
      actualizado[idx] = {
        ...itemActual,
        cantidad: nuevaCant,
        subtotalNeto: nuevaCant * precioNeto,
        subtotalConIva: nuevaCant * precioConIva,
        disponible: Math.max(0, disponibleRestante - 1 + nuevaCant),
      };
    } else {
      const nuevoItem: ItemVentaPOS = {
        id: itemId,
        nombre: item.nombre || 'Repuesto',
        codigo: item.codigo || '',
        codigoProducto: item.codigoProducto || '',
        fabricante: item.fabricante || '',
        precioNeto,
        precioConIva,
        cantidad: 1,
        subtotalNeto: precioNeto,
        subtotalConIva: precioConIva,
        disponible: disponibleRestante,
      };
      actualizado = [...carro, nuevoItem];
    }

    playBeep('ok');
    setCarro(actualizado);

    // Actualizar optimísticamente `stockReservado` en memoria local para que el descuento se vea al instante
    setInventario((prev) =>
      prev.map((inv) =>
        inv.id === itemId
          ? { ...inv, stockReservado: (Number(inv.stockReservado) || 0) + 1 }
          : inv
      )
    );

    if (limpiarBusquedaAlAgregar) {
      setBusqueda('');
    }

    persistirMostradorReserva(actualizado, { renovarTiempo: true });
    setTimeout(() => enfocarEscannerSiCorresponde(true), 40);
  };

  // Ajustar cantidad en el Mostrador (+1 / -1) actualizando la retención de stock local
  const cambiarCantidad = (id: string, delta: number) => {
    const itemEnCarro = carro.find((p) => p.id === id);
    if (!itemEnCarro) return;

    const invItem = inventario.find((x) => x.id === id);
    const disponibleRestante = invItem ? obtenerDisponibleBodega(invItem) : 0;

    if (delta > 0 && disponibleRestante < delta) {
      playBeep('error');
      setErrorMsg(`No hay más unidades disponibles en bodega para "${itemEnCarro.nombre}".`);
      setTimeout(() => enfocarEscannerSiCorresponde(true), 40);
      return;
    }

    setErrorMsg(null);
    const nuevaCant = itemEnCarro.cantidad + delta;
    let actualizado: ItemVentaPOS[];

    if (nuevaCant <= 0) {
      actualizado = carro.filter((p) => p.id !== id);
    } else {
      actualizado = carro.map((p) =>
        p.id === id
          ? {
              ...p,
              cantidad: nuevaCant,
              subtotalNeto: nuevaCant * p.precioNeto,
              subtotalConIva: nuevaCant * p.precioConIva,
            }
          : p
      );
    }

    setCarro(actualizado);
    setInventario((prev) =>
      prev.map((inv) =>
        inv.id === id
          ? { ...inv, stockReservado: Math.max(0, (Number(inv.stockReservado) || 0) + delta) }
          : inv
      )
    );

    persistirMostradorReserva(actualizado, { renovarTiempo: true });
    setTimeout(() => enfocarEscannerSiCorresponde(true), 40);
  };

  const eliminarDelCarro = (id: string) => {
    const itemQuitado = carro.find((p) => p.id === id);
    const cantQuitada = itemQuitado?.cantidad || 0;
    const actualizado = carro.filter((p) => p.id !== id);
    setCarro(actualizado);

    if (cantQuitada > 0) {
      setInventario((prev) =>
        prev.map((inv) =>
          inv.id === id
            ? { ...inv, stockReservado: Math.max(0, (Number(inv.stockReservado) || 0) - cantQuitada) }
            : inv
        )
      );
    }

    persistirMostradorReserva(actualizado, { renovarTiempo: true });
    setTimeout(() => enfocarEscannerSiCorresponde(true), 40);
  };

  // Cancelar venta de mostrador y devolver el stock retenido al inventario local
  const cancelarMostradorVenta = async () => {
    setCarro([]);
    setClienteNombre('');
    setClienteRut('');
    setClientePatente('');
    setClienteTelefono('');
    setDescuentoValor(0);
    setErrorMsg(null);
    setExpiraEnIso(null);
    setSegundosRestantes(0);
    localStorage.removeItem(STORAGE_KEY_MOSTRADOR);

    try {
      setSincronizandoReserva(true);
      await posService.cancelarMostrador();
      await cargarInventario(false);
    } catch {
      // Silencioso
    } finally {
      setSincronizandoReserva(false);
      setTimeout(() => enfocarEscannerSiCorresponde(true), 40);
    }
  };

  // Categorías disponibles en el inventario actual
  const categoriasDisponibles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of inventario) {
      const cat = (it.categoria || '').trim().toUpperCase();
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inventario]);

  // Marcas de vehículo compatibles disponibles en el inventario actual
  const marcasVehiculoDisponibles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of inventario) {
      for (const m of it.marcasCompatibles || []) {
        const marca = (m || '').trim().toUpperCase();
        if (!marca) continue;
        counts.set(marca, (counts.get(marca) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inventario]);

  // ¿El usuario está buscando o filtrando activamente?
  // REGLA CLAVE: La pantalla parte en 0 siempre; NO se despliega el inventario por defecto salvo cuando alguien busque.
  const tieneBusquedaActiva = Boolean(
    busqueda.trim().length > 0 || filtroCategoria !== '' || filtroMarcaVehiculo !== ''
  );

  // Filtrado de repuestos para el catálogo visual (SOLO devuelve resultados cuando `tieneBusquedaActiva` es true)
  const repuestosFiltrados = useMemo(() => {
    if (!tieneBusquedaActiva) return [];

    const q = busqueda.toLowerCase().trim();
    return inventario
      .filter((it) => {
        if (filtroCategoria && (it.categoria || '').toUpperCase() !== filtroCategoria) {
          return false;
        }
        if (
          filtroMarcaVehiculo &&
          !(it.marcasCompatibles || []).some((m) => m.toUpperCase() === filtroMarcaVehiculo)
        ) {
          return false;
        }
        if (!q) return true;
        const nom = (it.nombre || '').toLowerCase();
        const cod = (it.codigo || '').toLowerCase();
        const codProd = (it.codigoProducto || '').toLowerCase();
        const fab = (it.fabricante || '').toLowerCase();
        const cat = (it.categoria || '').toLowerCase();
        const marcas = (it.marcasCompatibles || []).some((m) => m.toLowerCase().includes(q));
        const modelos = Object.values(it.modelosCompatibles || {})
          .flat()
          .some((mod) => String(mod).toLowerCase().includes(q));
        const equiv = (it.equivalencias || []).some((eq) => eq.codigo.toLowerCase().includes(q));
        return (
          nom.includes(q) ||
          cod.includes(q) ||
          codProd.includes(q) ||
          fab.includes(q) ||
          cat.includes(q) ||
          marcas ||
          modelos ||
          equiv
        );
      })
      .slice(0, 60);
  }, [inventario, busqueda, filtroCategoria, filtroMarcaVehiculo, tieneBusquedaActiva]);

  // Manejo de Enter de la pistola de códigos de barra
  const handleKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = busqueda.trim().toUpperCase();
      if (!code) return;

      // Buscar coincidencia exacta por código de barras/SKU, código de producto OEM o equivalencia
      const exactMatch = inventario.find(
        (it) =>
          (it.codigo && it.codigo.trim().toUpperCase() === code) ||
          (it.codigoProducto && it.codigoProducto.trim().toUpperCase() === code) ||
          (it.id && it.id.trim().toUpperCase() === code) ||
          (it.equivalencias && it.equivalencias.some((eq) => eq.codigo.trim().toUpperCase() === code))
      );

      if (exactMatch) {
        // Agrega directo al Mostrador y limpia el buscador para volver a pantalla 0 lista para el siguiente escaneo
        agregarAlCarro(exactMatch, true);
      } else {
        // Si no hay coincidencia exacta pero hay 1 solo resultado filtrado, agregarlo y volver a 0
        if (repuestosFiltrados.length === 1) {
          agregarAlCarro(repuestosFiltrados[0], true);
        } else if (repuestosFiltrados.length === 0) {
          playBeep('error');
        }
      }
    }
  };

  // Totales del carro incluyendo descuento en la compra total
  const totales = useMemo(() => {
    const subtotalNeto = carro.reduce((sum, it) => sum + it.subtotalNeto, 0);
    const subtotalConIva = Math.round(subtotalNeto * 1.19);
    const val = Math.max(0, Number(descuentoValor) || 0);

    let descuentoNeto = 0;
    let descuentoPorcentaje = 0;

    if (val > 0 && subtotalNeto > 0) {
      if (descuentoTipo === 'PORCENTAJE') {
        const pct = Math.min(100, val);
        descuentoPorcentaje = Math.round(pct * 100) / 100;
        descuentoNeto = Math.round(subtotalNeto * (pct / 100));
      } else {
        const montoBruto = Math.min(subtotalConIva, val);
        descuentoNeto = Math.min(subtotalNeto, Math.round(montoBruto / 1.19));
        descuentoPorcentaje = Math.round((descuentoNeto / subtotalNeto) * 10000) / 100;
      }
    }

    const neto = Math.max(0, subtotalNeto - descuentoNeto);
    const iva = Math.round(neto * 0.19);
    const total = neto + iva;
    const descuentoConIva = Math.max(0, subtotalConIva - total);
    const totalUnidades = carro.reduce((sum, it) => sum + it.cantidad, 0);

    return {
      subtotalNeto,
      subtotalConIva,
      descuentoNeto,
      descuentoConIva,
      descuentoPorcentaje,
      neto,
      iva,
      total,
      totalUnidades,
    };
  }, [carro, descuentoTipo, descuentoValor]);

  // Procesar venta en backend (convierte la reserva de mostrador en descuento definitivo e imprime ticket)
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
          codigoProducto: it.codigoProducto,
          precioNeto: it.precioNeto,
          cantidad: it.cantidad,
        })),
        metodoPago,
        tipoDocumento,
        descuentoTipo,
        descuentoValor: Math.max(0, Number(descuentoValor) || 0),
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
        if (tipoDocumento === 'TICKET') {
          // Al confirmar la compra con el ticket, vaciar el mostrador y limpiar la reserva de 30 min
          setCarro([]);
          setClienteNombre('');
          setClienteRut('');
          setClientePatente('');
          setClienteTelefono('');
          setDescuentoValor(0);
          setExpiraEnIso(null);
          setSegundosRestantes(0);
          localStorage.removeItem(STORAGE_KEY_MOSTRADOR);
        }
        // Recargar inventario y dejar la pantalla izquierda en 0
        await cargarInventario(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar la venta';
      setErrorMsg(msg);
      playBeep('error');
    } finally {
      setProcesandoVenta(false);
    }
  };

  // Atajos de teclado rápidos (F4 para cobrar e imprimir ticket, Escape para cerrar modal)
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
          setTimeout(() => enfocarEscannerSiCorresponde(true), 50);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carro, procesandoVenta, ventaCompletada]);

  return (
    <div className={styles.posLayout}>
      {/* ── PANEL IZQUIERDO: ESCÁNER SIEMPRE EN FOCO Y BÚSQUEDA (PARTE EN 0 POR DEFECTO) ── */}
      <div className={styles.leftPanel}>
        <div className={styles.searchHeader}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div className={styles.scannerBadge}>
              <span className={styles.scannerDot} />
              <span>Lector de Código de Barra / Pistola Activo (Foco Automático)</span>
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
            <span className={styles.searchIcon}>🔫</span>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Pistolea directamente el producto o escribe código OEM, modelo o nombre... (Enter)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={handleKeyDownSearch}
              autoFocus
            />
            {busqueda && (
              <button
                className={styles.clearSearchBtn}
                onClick={() => {
                  setBusqueda('');
                  enfocarEscannerSiCorresponde(true);
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* ── FILTROS EN LISTAS DESPLEGABLES (SIN DESPLEGAR INVENTARIO POR DEFECTO) ── */}
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label
                htmlFor="pos-select-categoria"
                style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}
              >
                📂 Categoría:
              </label>
              <select
                id="pos-select-categoria"
                value={filtroCategoria}
                onChange={(e) => {
                  setFiltroCategoria(e.target.value);
                  setTimeout(() => enfocarEscannerSiCorresponde(true), 30);
                }}
                style={{
                  padding: '0.38rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  background: filtroCategoria ? '#0f172a' : '#fff',
                  color: filtroCategoria ? '#fff' : '#0f172a',
                }}
              >
                <option value="">— Seleccionar para filtrar —</option>
                {categoriasDisponibles.map(([cat, count]) => (
                  <option key={cat} value={cat}>
                    {cat} ({count})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label
                htmlFor="pos-select-marca"
                style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}
              >
                🚗 Marca Auto:
              </label>
              <select
                id="pos-select-marca"
                value={filtroMarcaVehiculo}
                onChange={(e) => {
                  setFiltroMarcaVehiculo(e.target.value);
                  setTimeout(() => enfocarEscannerSiCorresponde(true), 30);
                }}
                style={{
                  padding: '0.38rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  background: filtroMarcaVehiculo ? '#15803d' : '#fff',
                  color: filtroMarcaVehiculo ? '#fff' : '#0f172a',
                }}
              >
                <option value="">— Seleccionar marca —</option>
                {marcasVehiculoDisponibles.map(([marca, count]) => (
                  <option key={marca} value={marca}>
                    {marca} ({count})
                  </option>
                ))}
              </select>
            </div>

            {tieneBusquedaActiva && (
              <button
                type="button"
                className={styles.btnClearFilters}
                onClick={() => {
                  setBusqueda('');
                  setFiltroCategoria('');
                  setFiltroMarcaVehiculo('');
                  enfocarEscannerSiCorresponde(true);
                }}
              >
                ✕ Volver pantalla a 0
              </button>
            )}
          </div>
        </div>

        <div className={styles.catalogContent}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              Sincronizando bodega...
            </div>
          ) : !tieneBusquedaActiva ? (
            /* ESTADO INICIAL EN 0: NO DESPLIEGA EL INVENTARIO HASTA QUE ALGUIEN PISTOLEE O BUSQUE */
            <div
              style={{
                textAlign: 'center',
                padding: '3.2rem 1.5rem',
                color: '#475569',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.65rem',
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.9rem',
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.15)',
                }}
              >
                🔫
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                Pantalla Lista en 0 · Pistolea Directamente tu Producto
              </div>
              <div style={{ fontSize: '0.86rem', color: '#64748b', maxWidth: '460px', lineHeight: 1.5 }}>
                El cursor está fijo en el lector superior. <strong>Dispara la pistola sobre el código de barras</strong>{' '}
                para enviarlo directo al <strong>Mostrador / Ventana</strong> (descontándolo del stock local por 30 min),
                o escribe en el buscador para consultar repuestos.
              </div>
            </div>
          ) : repuestosFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
              <div style={{ marginBottom: '0.85rem', fontSize: '0.95rem' }}>
                No se encontraron repuestos en bodega con <strong>"{busqueda || filtroCategoria || filtroMarcaVehiculo}"</strong>
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
                  <th>Código SKU / OEM</th>
                  <th>Descripción</th>
                  <th>Fabricante</th>
                  <th>Stock Disp.</th>
                  <th style={{ textAlign: 'right' }}>Precio (IVA inc.)</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {repuestosFiltrados.map((it) => {
                  const disponible = obtenerDisponibleBodega(it);
                  const enMostrador = cantidadesEnMostradorMap.get(it.id || '') || 0;
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
                      title="Haz clic o presiona Enter para pasar al Mostrador y reservar stock"
                    >
                      <td className={styles.tableCell}>
                        <span className={styles.itemCodeBadge}>{it.codigo || 'S/C'}</span>
                        {it.codigoProducto && (
                          <div
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              color: '#0369a1',
                              marginTop: '3px',
                              fontFamily: 'monospace',
                            }}
                          >
                            🔩 {it.codigoProducto}
                          </div>
                        )}
                      </td>
                      <td className={styles.tableCell}>
                        <span className={styles.itemTitle}>{it.nombre}</span>
                        <div
                          style={{
                            display: 'flex',
                            gap: '4px',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            marginTop: '2px',
                          }}
                        >
                          <span className={styles.itemSub}>{it.categoria}</span>
                          {(it.marcasCompatibles || []).map((m) => (
                            <span
                              key={m}
                              style={{
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                background: filtroMarcaVehiculo === m.toUpperCase() ? '#15803d' : '#dcfce7',
                                color: filtroMarcaVehiculo === m.toUpperCase() ? '#ffffff' : '#166534',
                                padding: '1px 5px',
                                borderRadius: '4px',
                              }}
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={styles.tableCell}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          {it.fabricante || '—'}
                        </span>
                      </td>
                      <td className={styles.tableCell}>
                        <span className={`${styles.stockBadge} ${stockClass}`}>{disponible} un.</span>
                        {enMostrador > 0 && (
                          <div
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              color: '#d97706',
                              marginTop: '2px',
                            }}
                          >
                            🛒 {enMostrador} en ventana
                          </div>
                        )}
                      </td>
                      <td className={styles.tableCell} style={{ textAlign: 'right' }}>
                        <strong style={{ fontSize: '0.95rem' }}>{fmtCLP(precioIva)}</strong>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Neto: {fmtCLP(precioNeto)}</div>
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

      {/* ── PANEL DERECHO: MOSTRADOR / VENTANA (PERSISTENTE 30 MIN CON RESERVA DE STOCK) ── */}
      <div className={styles.rightPanel}>
        <div className={styles.cartHeader} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className={styles.cartTitle}>
              <span>🛒 Mostrador / Ventana</span>
              {carro.length > 0 && <span className={styles.cartCountBadge}>{totales.totalUnidades} un.</span>}
            </div>
            {carro.length > 0 && (
              <button
                className={styles.btnClearCart}
                onClick={cancelarMostradorVenta}
                title="Cancelar venta y devolver unidades al stock local"
              >
                🗑 Cancelar Venta
              </button>
            )}
          </div>

          {/* BANNER DE RESERVA ACTIVA POR 30 MINUTOS (MODELO E-COMMERCE) */}
          {carro.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: segundosRestantes < 300 ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${segundosRestantes < 300 ? '#fecaca' : '#fde68a'}`,
                color: segundosRestantes < 300 ? '#b91c1c' : '#92400e',
                borderRadius: '7px',
                padding: '0.35rem 0.65rem',
                fontSize: '0.74rem',
                fontWeight: 700,
              }}
            >
              <span>
                🔒 Stock descontado de bodega local {sincronizandoReserva ? '(sincronizando...)' : ''}
              </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '0.82rem' }}>
                ⏱ Expira en {formatearRelojReserva(segundosRestantes)}
              </span>
            </div>
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
            onKeyDown={(e) => e.key === 'Enter' && enfocarEscannerSiCorresponde(true)}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="Patente (ej: ABCD12)"
            value={clientePatente}
            onChange={(e) => setClientePatente(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && enfocarEscannerSiCorresponde(true)}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="RUT Cliente"
            value={clienteRut}
            onChange={(e) => setClienteRut(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enfocarEscannerSiCorresponde(true)}
          />
          <input
            type="text"
            className={styles.inputMicro}
            placeholder="Teléfono"
            value={clienteTelefono}
            onChange={(e) => setClienteTelefono(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enfocarEscannerSiCorresponde(true)}
          />
        </div>

        {/* Lista de productos en el Mostrador / Ventana */}
        <div className={styles.cartItemsList}>
          {carro.length === 0 ? (
            <div className={styles.emptyCart}>
              <span style={{ fontSize: '2.5rem' }}>📦</span>
              <strong>Mostrador / Ventana vacía</strong>
              <span>
                Pistolea un repuesto para retenerlo en ventana por 30 minutos (se descuenta del stock local hasta
                imprimir el ticket o cancelar)
              </span>
            </div>
          ) : (
            carro.map((it) => (
              <div key={it.id} className={styles.cartItemCard}>
                <div className={styles.cartItemTop}>
                  <div>
                    <span className={styles.itemCodeBadge} style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                      {it.codigo || 'S/C'}
                    </span>
                    {it.codigoProducto && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          color: '#0369a1',
                          background: '#e0f2fe',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          marginRight: '6px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {it.codigoProducto}
                      </span>
                    )}
                    <span className={styles.cartItemName}>{it.nombre}</span>
                  </div>
                  <button
                    className={styles.btnRemoveItem}
                    onClick={() => eliminarDelCarro(it.id)}
                    title="Quitar del mostrador y devolver al stock local"
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
            <div
              style={{
                color: '#ef4444',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: '#fee2e2',
                padding: '0.5rem',
                borderRadius: '6px',
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Descuento en la compra total (visible cuando hay productos en mostrador) */}
          {carro.length > 0 && (
            <div className={styles.discountBox}>
              <div className={styles.discountHeaderRow}>
                <span className={styles.discountTitle}>🏷️ Descuento en Compra Total:</span>
                <div className={styles.discountModeToggle}>
                  <button
                    type="button"
                    className={`${styles.discountModeBtn} ${
                      descuentoTipo === 'PORCENTAJE' ? styles.discountModeBtnActive : ''
                    }`}
                    onClick={() => {
                      setDescuentoTipo('PORCENTAJE');
                      setDescuentoValor(0);
                    }}
                  >
                    % Porcentaje
                  </button>
                  <button
                    type="button"
                    className={`${styles.discountModeBtn} ${
                      descuentoTipo === 'MONTO' ? styles.discountModeBtnActive : ''
                    }`}
                    onClick={() => {
                      setDescuentoTipo('MONTO');
                      setDescuentoValor(0);
                    }}
                  >
                    $ Monto CLP
                  </button>
                </div>
              </div>

              <div className={styles.discountControlsRow}>
                {descuentoTipo === 'PORCENTAJE'
                  ? [0, 5, 10, 15, 20].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        className={`${styles.discountPresetBtn} ${
                          descuentoValor === pct ? styles.discountPresetBtnActive : ''
                        }`}
                        onClick={() => setDescuentoValor(pct)}
                      >
                        {pct === 0 ? 'Sin dcto' : `-${pct}%`}
                      </button>
                    ))
                  : [0, 1000, 2000, 5000, 10000].map((monto) => (
                      <button
                        key={monto}
                        type="button"
                        className={`${styles.discountPresetBtn} ${
                          descuentoValor === monto ? styles.discountPresetBtnActive : ''
                        }`}
                        onClick={() => setDescuentoValor(monto)}
                      >
                        {monto === 0 ? 'Sin dcto' : `-${fmtCLP(monto)}`}
                      </button>
                    ))}
                <input
                  type="number"
                  min={0}
                  max={descuentoTipo === 'PORCENTAJE' ? 100 : totales.subtotalConIva}
                  className={styles.discountInput}
                  placeholder={descuentoTipo === 'PORCENTAJE' ? '% dcto' : '$ dcto'}
                  value={descuentoValor || ''}
                  onChange={(e) => setDescuentoValor(Math.max(0, Number(e.target.value) || 0))}
                  onKeyDown={(e) => e.key === 'Enter' && enfocarEscannerSiCorresponde(true)}
                />
              </div>
            </div>
          )}

          {/* Selector de medio de pago */}
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#64748b',
                marginBottom: '4px',
                textTransform: 'uppercase',
              }}
            >
              Medio de Pago:
            </div>
            <div className={styles.paymentMethodsGrid}>
              {(['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA'] as MetodoPagoPOS[]).map((m) => (
                <button
                  key={m}
                  className={`${styles.paymentBtn} ${metodoPago === m ? styles.paymentBtnActive : ''}`}
                  onClick={() => setMetodoPago(m)}
                >
                  {m === 'EFECTIVO'
                    ? '💵 Efectivo'
                    : m === 'DEBITO'
                    ? '💳 Débito'
                    : m === 'CREDITO'
                    ? '💳 Crédito'
                    : '📲 Transf.'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.summaryRows}>
            {totales.descuentoNeto > 0 ? (
              <>
                <div className={styles.summaryRow}>
                  <span>Subtotal Original (c/IVA):</span>
                  <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>
                    {fmtCLP(totales.subtotalConIva)}
                  </span>
                </div>
                <div className={styles.discountRowHighlight}>
                  <span>Descuento aplicado ({totales.descuentoPorcentaje}%):</span>
                  <span>-{fmtCLP(totales.descuentoConIva)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Neto con Descuento:</span>
                  <strong>{fmtCLP(totales.neto)}</strong>
                </div>
              </>
            ) : (
              <div className={styles.summaryRow}>
                <span>Subtotal Neto:</span>
                <strong>{fmtCLP(totales.neto)}</strong>
              </div>
            )}
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
          onCerrar={() => {
            setVentaCompletada(null);
            setTimeout(() => enfocarEscannerSiCorresponde(true), 60);
          }}
        />
      )}

      {/* ── MODAL DE INGRESO RÁPIDO CON PISTOLA (DESDE MOSTRADOR) ── */}
      {modalPistolaCodigo !== null && (
        <IngresoRapidoModal
          codigoInicial={modalPistolaCodigo}
          modo={user?.rol === 'admin' ? 'admin' : 'proveedor'}
          onCerrar={() => {
            setModalPistolaCodigo(null);
            // Cada vez que se cierra tras actualizar código/fabricante/stock, la pantalla parte de 0 con el cursor en el lector
            cargarInventario(true);
            setTimeout(() => enfocarEscannerSiCorresponde(true), 60);
          }}
          onItemGuardado={() => {
            // Al guardar o actualizar stock/código, partir la pantalla de catálogo de 0
            cargarInventario(true);
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
          onClick={() => {
            setMostrarHistorial(false);
            setTimeout(() => enfocarEscannerSiCorresponde(true), 50);
          }}
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
                onClick={() => {
                  setMostrarHistorial(false);
                  setTimeout(() => enfocarEscannerSiCorresponde(true), 50);
                }}
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
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>
                    Ventas Completadas
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#166534' }}>
                    {historialVentas.filter((v) => v.tipoDocumento !== 'COTIZACION').length}
                  </div>
                </div>
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                  }}
                >
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
                <div
                  style={{
                    background: '#fefce8',
                    border: '1px solid #fef08a',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                  }}
                >
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
