import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { inventarioService } from '../../services/inventario';
import { proveedoresService } from '../../services/proveedores';
import { woocommerceService } from '../../services/woocommerce';
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import {
  ARBOL_CATEGORIAS_TIENDA,
  resolverJerarquiaCategoria,
  type ItemInventario,
  type Proveedor,
} from '../../types';

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const conIva = (neto: number) => Math.round((neto || 0) * 1.19);

interface TiendaErpOpcion {
  id: string;
  nombre: string;
  prefijo: string;
  promesaRetiro: string;
  color: string;
  totalSkus: number;
  conStock: number;
  unidades: number;
}

function clasificarTiendaDeItem(item: ItemInventario): {
  key: string;
  nombre: string;
  prefijo: string;
  promesaRetiro: string;
  color: string;
} {
  const skuPub = String(item.skuPublicoFrp || item.codigo || '').toUpperCase();
  const origenDatos = String(item.origenDatos || '').toLowerCase();
  const prov = String(item.proveedor || '').trim();

  if (
    skuPub.startsWith('FRP-SOL') ||
    origenDatos.includes('soluparts') ||
    /solupart/i.test(prov)
  ) {
    return {
      key: 'erp_soluparts',
      nombre: 'Soluparts (ERP Ailoo)',
      prefijo: 'FRP-SOL',
      promesaRetiro: 'Retiro Enrique Olivares 224 desde 15:30 hrs (compras antes de 11:30 hrs)',
      color: '#4f46e5',
    };
  }

  if (skuPub.startsWith('FRP-WSP') || origenDatos.includes('mesa_whatsapp')) {
    return {
      key: 'mesa_wsp',
      nombre: 'Mesa Abastecimiento WSP',
      prefijo: 'FRP-WSP',
      promesaRetiro: 'Despacho según dimensión en Santiago y Chile (vigencia 4h)',
      color: '#16a34a',
    };
  }

  if (
    !prov ||
    /propio|bodega|olivares|facilrepuestos|fácilrepuestos|local/i.test(prov)
  ) {
    return {
      key: 'bodega_olivares_224',
      nombre: 'Bodega Propia Enrique Olivares 224',
      prefijo: 'FRP-OWN',
      promesaRetiro: 'Retiro Inmediato en Enrique Olivares 224',
      color: '#ea580c',
    };
  }

  const cleanKey = `tienda_${prov.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return {
    key: cleanKey,
    nombre: `Portal Tienda: ${prov}`,
    prefijo: 'FRP-LOC',
    promesaRetiro: 'Despacho según dimensión en Santiago y Chile',
    color: '#0d9488',
  };
}

export default function InventarioErpConsolidado() {
  const navigate = useNavigate();
  const { inventario, setInventario, setLoading, notify } = useAppStore();
  const [, setProveedores] = useState<Proveedor[]>([]);

  // Checkboxes de Tiendas / ERPs seleccionados (vacío = todas seleccionadas, o lista explícita)
  const [tiendasSeleccionadas, setTiendasSeleccionadas] = useState<string[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string>('');
  const [subcategoriaActiva, setSubcategoriaActiva] = useState<string>('');
  const [subcategoriaHijaActiva, setSubcategoriaHijaActiva] = useState<string>('');
  const [filtroMarcaAuto, setFiltroMarcaAuto] = useState<string>('');
  const [filtroModeloAuto, setFiltroModeloAuto] = useState<string>('');
  const [filtroRangoAnioAuto, setFiltroRangoAnioAuto] = useState<string>('');
  const [filtroEstadoWoo, setFiltroEstadoWoo] = useState<
    'todos' | 'publicados_woo' | 'con_stock' | 'stock_bajo' | 'pendientes_sync'
  >('todos');
  const [ordenInventario, setOrdenInventario] = useState<
    'recomendado_woo' | 'stock_desc' | 'precio_asc' | 'precio_desc' | 'nombre_asc'
  >('recomendado_woo');
  const [busqueda, setBusqueda] = useState('');
  const [mostrarGuiaOrden, setMostrarGuiaOrden] = useState(false);
  const [sincronizandoWoo, setSincronizandoWoo] = useState(false);
  const [sincronizandoAiloo, setSincronizandoAiloo] = useState(false);
  const [sincronizandoMarcasWoo, setSincronizandoMarcasWoo] = useState(false);

  const cargarTodo = async () => {
    setLoading(true);
    try {
      const [invRes, provRes] = await Promise.all([
        inventarioService.getAll(),
        proveedoresService.getAll().catch(() => null),
      ]);
      if (invRes.success && invRes.data) setInventario(invRes.data);
      if (provRes?.success && provRes.data) setProveedores(provRes.data);
    } catch {
      notify('Error al cargar el consolidado ERP & Tiendas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (inventario.length === 0) {
      cargarTodo();
    } else {
      proveedoresService
        .getAll()
        .then((r) => {
          if (r.success && r.data) setProveedores(r.data);
        })
        .catch(() => {});
    }
  }, []);

  // Construir el listado de Tiendas / ERPs con conteos reales para los Checkboxes
  const tiendasErpDisponibles = useMemo<TiendaErpOpcion[]>(() => {
    const mapa = new Map<string, TiendaErpOpcion>();

    // Inicializar las tiendas/ERPs base para que siempre aparezcan claras en los checkboxes
    const base: TiendaErpOpcion[] = [
      {
        id: 'bodega_olivares_224',
        nombre: '🏪 Bodega Propia Enrique Olivares 224',
        prefijo: 'FRP-OWN',
        promesaRetiro: 'Retiro Inmediato en sucursal',
        color: '#ea580c',
        totalSkus: 0,
        conStock: 0,
        unidades: 0,
      },
      {
        id: 'erp_soluparts',
        nombre: '🏭 ERP Soluparts (Ailoo)',
        prefijo: 'FRP-SOL',
        promesaRetiro: 'Retiro 15:30 hrs en Olivares 224 (compras antes de 11:30 hrs)',
        color: '#4f46e5',
        totalSkus: 0,
        conStock: 0,
        unidades: 0,
      },
    ];
    for (const b of base) mapa.set(b.id, b);

    for (const item of inventario) {
      const info = clasificarTiendaDeItem(item);
      const disp = Math.max(0, (item.stock || 0) - (item.stockReservado || 0));
      const actual = mapa.get(info.key) || {
        id: info.key,
        nombre: info.nombre,
        prefijo: info.prefijo,
        promesaRetiro: info.promesaRetiro,
        color: info.color,
        totalSkus: 0,
        conStock: 0,
        unidades: 0,
      };
      actual.totalSkus += 1;
      if (disp > 0) actual.conStock += 1;
      actual.unidades += disp;
      mapa.set(info.key, actual);
    }

    return Array.from(mapa.values()).sort((a, b) => b.totalSkus - a.totalSkus);
  }, [inventario]);

  // Si aún no se ha inicializado la selección de checkboxes, seleccionar todas por defecto
  useEffect(() => {
    if (tiendasErpDisponibles.length > 0 && tiendasSeleccionadas.length === 0) {
      setTiendasSeleccionadas(tiendasErpDisponibles.map((t) => t.id));
    }
  }, [tiendasErpDisponibles.length]);

  const toggleTiendaCheckbox = (id: string) => {
    setTiendasSeleccionadas((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const seleccionarTodasTiendas = () => {
    setTiendasSeleccionadas(tiendasErpDisponibles.map((t) => t.id));
  };

  // Paso 1: Filtrar por las Tiendas / ERPs marcadas con Checkbox
  const itemsPorTiendas = useMemo(() => {
    if (tiendasSeleccionadas.length === 0) return [];
    const setSel = new Set(tiendasSeleccionadas);
    return inventario.filter((it) => setSel.has(clasificarTiendaDeItem(it).key));
  }, [inventario, tiendasSeleccionadas]);

  // Conteos por Categoría y Subcategoría del Árbol Oficial de WooCommerce sobre las tiendas seleccionadas
  const conteosArbolWoo = useMemo(() => {
    const porCat = new Map<string, number>();
    const porSub = new Map<string, number>();
    const porHija = new Map<string, number>();

    for (const it of itemsPorTiendas) {
      const jer = resolverJerarquiaCategoria(it);
      const cat = jer.categoria || it.categoria || 'Sin Categoría';
      const sub = jer.subcategoria || it.subcategoria || '';
      const hija = jer.subcategoriaDetalle || it.subcategoriaDetalle || '';

      porCat.set(cat, (porCat.get(cat) || 0) + 1);
      if (sub) porSub.set(`${cat}::${sub}`, (porSub.get(`${cat}::${sub}`) || 0) + 1);
      if (hija) porHija.set(`${cat}::${sub}::${hija}`, (porHija.get(`${cat}::${sub}::${hija}`) || 0) + 1);
    }

    return { porCat, porSub, porHija };
  }, [itemsPorTiendas]);

  // Helper para formatear el rango de años de un ítem (desde campos o desde título)
  const obtenerRangoAniosItem = (it: ItemInventario): string => {
    let d = Number(it.anioDesde) || null;
    let h = Number(it.anioHasta) || null;
    if (d && (d < 1970 || d > 2035)) d = null;
    if (h && (h < 1970 || h > 2035)) h = null;

    if (!d && !h && it.nombre) {
      const txt = it.nombre.toUpperCase();
      const mRango = txt.match(/\b(19\d{2}|20\d{2})\s*(?:-|AL|A|\/)\s*(19\d{2}|20\d{2})\b/);
      if (mRango) {
        d = Number(mRango[1]);
        h = Number(mRango[2]);
      } else {
        const mDesde =
          txt.match(/\b(?:DESDE|AÑO)\s+(19\d{2}|20\d{2})\b/) ||
          txt.match(/\b(19\d{2}|20\d{2})\s*\+/);
        if (mDesde) d = Number(mDesde[1]);
        else {
          const mHasta = txt.match(/\bHASTA\s+(19\d{2}|20\d{2})\b/);
          if (mHasta) h = Number(mHasta[1]);
        }
      }
    }
    if (d && h) return d === h ? `${d}` : `${d} - ${h}`;
    if (d && !h) return `${d} en adelante`;
    if (!d && h) return `Hasta ${h}`;
    return '';
  };

  // Árbol de 3 Niveles de Compatibilidad Vehicular (Marca -> Modelo -> Rango Años)
  const arbolCompatibilidadAuto = useMemo(() => {
    const porMarca = new Map<string, number>();
    const porModelo = new Map<string, number>(); // `${marca}::${modelo}` -> count
    const porRango = new Map<string, number>(); // `${marca}::${modelo}::${rango}` -> count

    for (const it of itemsPorTiendas) {
      const rango = obtenerRangoAniosItem(it);
      const marcas = (it.marcasCompatibles || []).map((m) => String(m || '').trim().toUpperCase()).filter(Boolean);
      for (const m of marcas) {
        porMarca.set(m, (porMarca.get(m) || 0) + 1);
      }

      const modelosObj = it.modelosCompatibles || {};
      if (modelosObj && typeof modelosObj === 'object' && !Array.isArray(modelosObj)) {
        for (const [mRaw, mods] of Object.entries(modelosObj)) {
          const m = String(mRaw || '').trim().toUpperCase();
          if (!m || !Array.isArray(mods)) continue;
          for (const modRaw of mods) {
            let mod = String(modRaw || '').trim().toUpperCase();
            if (!mod) continue;
            if (mod.startsWith(`${m} `)) mod = mod.slice(m.length).trim();
            const keyMod = `${m}::${mod}`;
            porModelo.set(keyMod, (porModelo.get(keyMod) || 0) + 1);
            if (rango) {
              const keyRango = `${m}::${mod}::${rango}`;
              porRango.set(keyRango, (porRango.get(keyRango) || 0) + 1);
            }
          }
        }
      }
    }

    const marcasOrdenadas = Array.from(porMarca.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { marcasOrdenadas, porMarca, porModelo, porRango };
  }, [itemsPorTiendas]);

  // Marcas de vehículo disponibles
  const marcasAutoOpciones = arbolCompatibilidadAuto.marcasOrdenadas;

  const modelosDeMarcaActiva = useMemo(() => {
    if (!filtroMarcaAuto) return [];
    const pref = `${filtroMarcaAuto}::`;
    const lista: Array<[string, number]> = [];
    for (const [k, count] of arbolCompatibilidadAuto.porModelo.entries()) {
      if (k.startsWith(pref)) {
        lista.push([k.slice(pref.length), count]);
      }
    }
    return lista.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [filtroMarcaAuto, arbolCompatibilidadAuto]);

  const rangosDeModeloActivo = useMemo(() => {
    if (!filtroMarcaAuto || !filtroModeloAuto) return [];
    const pref = `${filtroMarcaAuto}::${filtroModeloAuto}::`;
    const lista: Array<[string, number]> = [];
    for (const [k, count] of arbolCompatibilidadAuto.porRango.entries()) {
      if (k.startsWith(pref)) {
        lista.push([k.slice(pref.length), count]);
      }
    }
    return lista.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [filtroMarcaAuto, filtroModeloAuto, arbolCompatibilidadAuto]);

  // Filtrado completo + Ordenamiento recomendado estilo WooCommerce
  const itemsFiltradosYOrdenados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    const lista = itemsPorTiendas.filter((it) => {
      const jer = resolverJerarquiaCategoria(it);
      const disp = Math.max(0, (it.stock || 0) - (it.stockReservado || 0));
      const min = it.stockMinimo || 2;

      if (categoriaActiva && jer.categoria !== categoriaActiva && it.categoria !== categoriaActiva) {
        return false;
      }
      if (
        subcategoriaActiva &&
        jer.subcategoria !== subcategoriaActiva &&
        it.subcategoria !== subcategoriaActiva
      ) {
        return false;
      }
      if (
        subcategoriaHijaActiva &&
        jer.subcategoriaDetalle !== subcategoriaHijaActiva &&
        it.subcategoriaDetalle !== subcategoriaHijaActiva
      ) {
        return false;
      }
      if (
        filtroMarcaAuto &&
        !(it.marcasCompatibles || []).some((m) => m.toUpperCase() === filtroMarcaAuto)
      ) {
        return false;
      }
      if (filtroModeloAuto && filtroMarcaAuto) {
        const modsMarca = (it.modelosCompatibles || {})[filtroMarcaAuto] || [];
        const matchMod = modsMarca.some((modRaw) => {
          let mClean = String(modRaw || '').trim().toUpperCase();
          if (mClean.startsWith(`${filtroMarcaAuto} `)) {
            mClean = mClean.slice(filtroMarcaAuto.length).trim();
          }
          return mClean === filtroModeloAuto;
        });
        if (!matchMod) return false;
      }
      if (filtroRangoAnioAuto) {
        const rangoIt = obtenerRangoAniosItem(it);
        if (rangoIt !== filtroRangoAnioAuto) return false;
      }

      if (filtroEstadoWoo === 'publicados_woo' && (it.ocultarEnTienda || disp <= 0)) return false;
      if (filtroEstadoWoo === 'con_stock' && disp <= 0) return false;
      if (filtroEstadoWoo === 'stock_bajo' && disp > min) return false;
      if (filtroEstadoWoo === 'pendientes_sync' && !it.needsWooSync) return false;

      if (!q) return true;
      const modelosTxt = Object.values(it.modelosCompatibles || {})
        .flat()
        .join(' ')
        .toLowerCase();
      return (
        (it.nombre || '').toLowerCase().includes(q) ||
        (it.skuPublicoFrp || '').toLowerCase().includes(q) ||
        (it.codigo || '').toLowerCase().includes(q) ||
        (it.fabricante || '').toLowerCase().includes(q) ||
        (it.proveedor || '').toLowerCase().includes(q) ||
        modelosTxt.includes(q) ||
        (it.marcasCompatibles || []).some((m) => m.toLowerCase().includes(q))
      );
    });

    // Ordenamiento recomendado para WooCommerce + Multi-ERP:
    // 1° Stock Propio Olivares 224 con stock inmediato -> 2° Soluparts con stock -> 3° Otros ERPs con stock -> 4° Con Imagen -> 5° Categoría/Nombre
    return [...lista].sort((a, b) => {
      const dispA = Math.max(0, (a.stock || 0) - (a.stockReservado || 0));
      const dispB = Math.max(0, (b.stock || 0) - (b.stockReservado || 0));

      if (ordenInventario === 'stock_desc') return dispB - dispA;
      if (ordenInventario === 'precio_asc') return (a.precioVenta || 0) - (b.precioVenta || 0);
      if (ordenInventario === 'precio_desc') return (b.precioVenta || 0) - (a.precioVenta || 0);
      if (ordenInventario === 'nombre_asc') return (a.nombre || '').localeCompare(b.nombre || '');

      // Orden Recomendado WooCommerce & Omnicanal
      const tieneStockA = dispA > 0 ? 1 : 0;
      const tieneStockB = dispB > 0 ? 1 : 0;
      if (tieneStockA !== tieneStockB) return tieneStockB - tieneStockA;

      const tieneFotoA = a.imagenUrl ? 1 : 0;
      const tieneFotoB = b.imagenUrl ? 1 : 0;
      if (tieneFotoA !== tieneFotoB) return tieneFotoB - tieneFotoA;

      const tA = clasificarTiendaDeItem(a).key;
      const tB = clasificarTiendaDeItem(b).key;
      const prio = (k: string) =>
        k === 'bodega_olivares_224' ? 4 : k === 'erp_soluparts' ? 3 : 1;
      if (prio(tA) !== prio(tB)) return prio(tB) - prio(tA);

      return (a.nombre || '').localeCompare(b.nombre || '');
    });
  }, [
    itemsPorTiendas,
    categoriaActiva,
    subcategoriaActiva,
    subcategoriaHijaActiva,
    filtroMarcaAuto,
    filtroModeloAuto,
    filtroRangoAnioAuto,
    filtroEstadoWoo,
    ordenInventario,
    busqueda,
  ]);

  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(
    itemsFiltradosYOrdenados
  );

  // Estadísticas consolidadas de las tiendas seleccionadas
  const kpisConsolidados = useMemo(() => {
    let conStock = 0;
    let publicadosWoo = 0;
    let pendientesSync = 0;
    let valorCostoNeto = 0;
    let valorVentaConIva = 0;

    for (const it of itemsPorTiendas) {
      const disp = Math.max(0, (it.stock || 0) - (it.stockReservado || 0));
      if (disp > 0) conStock++;
      if (!it.ocultarEnTienda && disp > 0) publicadosWoo++;
      if (it.needsWooSync) pendientesSync++;
      valorCostoNeto += disp * (it.precioCompra || 0);
      valorVentaConIva += disp * conIva(it.precioVenta || 0);
    }

    return {
      totalSkus: itemsPorTiendas.length,
      conStock,
      publicadosWoo,
      pendientesSync,
      valorCostoNeto,
      valorVentaConIva,
    };
  }, [itemsPorTiendas]);

  const handleSyncAiloo = async () => {
    setSincronizandoAiloo(true);
    try {
      const r = await woocommerceService.syncAilooTodos({ forzar: false });
      if (r.success) {
        notify('✓ Catálogo ERP Ailoo (Soluparts) sincronizado', 'success');
        await cargarTodo();
      }
    } catch {
      notify('Error al sincronizar ERPs Ailoo', 'error');
    } finally {
      setSincronizandoAiloo(false);
    }
  };

  const handleSyncMarcasWoo = async () => {
    setSincronizandoMarcasWoo(true);
    try {
      let totalMarcasCreadas = 0;
      let totalProductosActualizados = 0;
      let ultimoResultado: Awaited<ReturnType<typeof woocommerceService.syncMarcasCompatibilidad>>['data'] | null = null;

      // Crea la taxonomía en WordPress y aplica directamente las marcas (`brands`) a los productos en lotes rápidos
      for (let pase = 1; pase <= 12; pase++) {
        const r = await woocommerceService.syncMarcasCompatibilidad({
          encolarProductos: false,
          sincronizarLoteInmediato: true,
          maxProductosLote: 350,
          maxCreacionesTaxonomia: 240,
        });
        if (!r.success || !r.data) {
          throw new Error(r.error || 'Error al sincronizar marcas de compatibilidad');
        }
        ultimoResultado = r.data;
        totalMarcasCreadas += r.data.taxonomiaMarcasWoo.marcasNuevasCreadasEnWoo || 0;
        totalProductosActualizados += r.data.loteSincronizado?.actualizados || 0;

        const pendientesTax = r.data.taxonomiaMarcasWoo.pendientesPorCrearEnWoo || 0;
        const pendientesProd = r.data.loteSincronizado?.pendientesRestantes ?? 0;
        const huboAvance =
          (r.data.taxonomiaMarcasWoo.marcasNuevasCreadasEnWoo || 0) > 0 ||
          (r.data.loteSincronizado?.procesados || 0) > 0;

        if ((pendientesTax <= 0 && pendientesProd <= 0) || !huboAvance) {
          break;
        }
      }

      if (ultimoResultado) {
        const { resumenCatalogo, loteSincronizado } = ultimoResultado;
        const restantes = loteSincronizado?.pendientesRestantes || 0;
        const loteTxt =
          restantes > 0
            ? ` · ${totalProductosActualizados} productos actualizados ahora (${restantes} continúan aplicándose automáticamente en segundo plano)`
            : ` · Marcas aplicadas a los productos en WooCommerce (${totalProductosActualizados} actualizados en este pase)`;
        notify(
          `🚗 Marcas de Compatibilidad aplicadas en WooCommerce: ${resumenCatalogo.totalMarcasVehiculo} marcas, ${resumenCatalogo.totalModelosVehiculo} modelos y ${resumenCatalogo.totalRangosAnios} rangos de años (${totalMarcasCreadas} términos nuevos)${loteTxt}`,
          'success'
        );
        await cargarTodo();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error al sincronizar marcas y años en WooCommerce', 'error');
    } finally {
      setSincronizandoMarcasWoo(false);
    }
  };

  const handleSyncWoo = async () => {
    setSincronizandoWoo(true);
    try {
      let totalCreados = 0;
      let totalActualizados = 0;
      let pendientesRestantes = 0;

      // Procesar hasta 3 lotes de 150 productos por clic (~450 productos por clic sin timeout)
      for (let lote = 1; lote <= 3; lote++) {
        const r = await woocommerceService.sync({ soloDelta: true, maxItems: 150 });
        if (!r.success || !r.data) {
          throw new Error(r.error || 'Error en lote de sincronización WooCommerce');
        }
        totalCreados += r.data.creados || 0;
        totalActualizados += r.data.actualizados || 0;
        pendientesRestantes = r.data.pendientesRestantes || 0;
        if (pendientesRestantes <= 0 || (r.data.procesados || 0) === 0) break;
      }

      notify(
        `✓ Lote WooCommerce completado (+${totalCreados} creados, +${totalActualizados} actualizados${
          pendientesRestantes > 0 ? ` · quedan ${pendientesRestantes} pendientes en cola` : ' · cola al día'
        })`,
        'success'
      );
      await cargarTodo();
    } catch {
      notify('Error al sincronizar con WooCommerce', 'error');
    } finally {
      setSincronizandoWoo(false);
    }
  };

  const familiaSeleccionadaObj = ARBOL_CATEGORIAS_TIENDA.find(
    (c) => c.nombre === categoriaActiva
  );
  const subcategoriaSeleccionadaObj = familiaSeleccionadaObj?.subcategorias.find(
    (s) => s.nombre === subcategoriaActiva
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cabecera estilo Portal WooCommerce + Multi-ERP */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '18px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>
            🏢 Consolidado ERP & Tiendas — Portal Multi-Bodega + WooCommerce
          </div>
          <div style={{ fontSize: '0.84rem', color: '#cbd5e1', marginTop: 4 }}>
            Filtra con Checkboxes una o más tiendas/ERPs y navega el catálogo con la misma jerarquía de <strong>Categorías y Subcategorías de WordPress / WooCommerce</strong>.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }}
            onClick={() => setMostrarGuiaOrden((v) => !v)}
          >
            {mostrarGuiaOrden ? '✕ Ocultar Recomendación' : '💡 Ver Orden Recomendado de Inventario'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#4f46e5', color: '#fff', fontWeight: 700 }}
            onClick={handleSyncAiloo}
            disabled={sincronizandoAiloo}
          >
            {sincronizandoAiloo ? 'Sincronizando ERPs...' : '📦 Sync ERPs Ailoo'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#0284c7', color: '#fff', fontWeight: 700 }}
            onClick={handleSyncMarcasWoo}
            disabled={sincronizandoMarcasWoo}
            title="Crea en Productos -> Marcas de WooCommerce la jerarquía Marca de Auto -> Modelo -> Rango de Años (100% dedicado a compatibilidad)"
          >
            {sincronizandoMarcasWoo
              ? 'Sincronizando Marcas/Años...'
              : '🚗 Poblar Marcas + Modelos + Años en Woo'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#16a34a', color: '#fff', fontWeight: 700 }}
            onClick={handleSyncWoo}
            disabled={sincronizandoWoo}
          >
            {sincronizandoWoo
              ? 'Sincronizando Web...'
              : `🛒 Sync Delta WooCommerce (${kpisConsolidados.pendientesSync})`}
          </button>
        </div>
      </div>

      {/* Guía Recomendada de Ordenamiento de Inventario (Desplegable) */}
      {mostrarGuiaOrden && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 14,
            padding: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
          }}
        >
          <div style={{ background: '#fff', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
              1️⃣ Árbol Espejo de WooCommerce (3 Niveles)
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
              Todo repuesto de cualquier ERP se clasifica automáticamente en tus <strong>9 Categorías Padre → 28 Subcategorías → Subcategorías Hijas</strong> de WordPress para que nunca se creen categorías huérfanas.
            </div>
          </div>

          <div style={{ background: '#fff', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
              2️⃣ Prioridad Comercial por Velocidad de Retiro
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
              Orden recomendado: <strong>1° Bodega Enrique Olivares 224</strong> (Retiro Inmediato) → <strong>2° ERP Soluparts</strong> (Retiro desde 15:30 hrs comprando antes de 11:30 hrs) → <strong>3° Portales ERP Asociados</strong> (Despacho según dimensión).
            </div>
          </div>

          <div style={{ background: '#fff', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
              3️⃣ SKU Público Trazable sin Exponer Proveedor
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
              En WooCommerce y en Repuestín el cliente ve <code>FRP-OWN-*</code>, <code>FRP-SOL-*</code>, <code>FRP-LOC-*</code> o <code>FRP-WSP-*</code>, manteniendo oculto el proveedor mayorista pero identificando al instante el origen logístico.
            </div>
          </div>

          <div style={{ background: '#fff', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
              4️⃣ Visibilidad Automática en WordPress
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
              Productos con <strong>Stock &gt; 0 + Foto limpia</strong> quedan <code>Publicados</code> en WooCommerce; productos agotados se mantienen en el ERP interno para cotización por Mesa WSP sin ensuciar la tienda web.
            </div>
          </div>
        </div>
      )}

      {/* ── PANEL DE CHECKBOXES MULTI-TIENDA / MULTI-ERP ── */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: 16,
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
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
            ☑️ Filtrar por una o más Tiendas / ERPs ({tiendasSeleccionadas.length} de{' '}
            {tiendasErpDisponibles.length} seleccionadas)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={seleccionarTodasTiendas}
            >
              ☑️ Marcar Todas las Tiendas
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setTiendasSeleccionadas(['bodega_olivares_224'])}
            >
              🏪 Solo Enrique Olivares 224
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setTiendasSeleccionadas(['erp_soluparts'])}
            >
              🏭 Solo Soluparts
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))',
            gap: 10,
          }}
        >
          {tiendasErpDisponibles.map((tienda) => {
            const checked = tiendasSeleccionadas.includes(tienda.id);
            return (
              <label
                key={tienda.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '11px 14px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: checked ? `2px solid ${tienda.color}` : '1px solid #e2e8f0',
                  background: checked ? '#f8fafc' : '#ffffff',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTiendaCheckbox(tienda.id)}
                  style={{ marginTop: 3, width: 17, height: 17, cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                      {tienda.nombre}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: 6,
                        background: '#e2e8f0',
                        color: '#1e293b',
                      }}
                    >
                      {tienda.prefijo}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#334155', marginTop: 3 }}>
                    <strong>{tienda.totalSkus.toLocaleString('es-CL')}</strong> SKUs ·{' '}
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>
                      {tienda.conStock.toLocaleString('es-CL')} con stock
                    </span>{' '}
                    ({tienda.unidades.toLocaleString('es-CL')} un.)
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                    📍 {tienda.promesaRetiro}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* KPIs del Consolidado Filtrado */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{kpisConsolidados.totalSkus.toLocaleString('es-CL')}</div>
          <div className="stat-label">SKUs en Tiendas Seleccionadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#16a34a' }}>
            {kpisConsolidados.conStock.toLocaleString('es-CL')}
          </div>
          <div className="stat-label">Con Stock Disponible</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#2563eb' }}>
            {kpisConsolidados.publicadosWoo.toLocaleString('es-CL')}
          </div>
          <div className="stat-label">Activos en WordPress / WooCommerce</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {fmtCLP(kpisConsolidados.valorVentaConIva)}
          </div>
          <div className="stat-label">Valor Venta Catálogo (c/IVA)</div>
        </div>
      </div>

      {/* ── SELECTORES DESPLEGABLES DE CATEGORÍAS Y COMPATIBILIDAD VEHICULAR (ESPEJO WOOCOMMERCE) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 12,
        }}
      >
        {/* 1. Categorías y Subcategorías Oficiales WooCommerce */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                📂 Categorías y Subcategorías Oficiales WooCommerce (facilrepuestos.cl)
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                Selecciona Familia ↳ Subcategoría ↳ Pieza específica
              </div>
            </div>
            {(categoriaActiva || subcategoriaActiva || subcategoriaHijaActiva) && (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  setCategoriaActiva('');
                  setSubcategoriaActiva('');
                  setSubcategoriaHijaActiva('');
                }}
              >
                ✕ Limpiar categoría
              </button>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 8,
            }}
          >
            {/* Nivel 1: Familia Principal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                1. Categoría Principal
              </label>
              <select
                value={categoriaActiva}
                onChange={(e) => {
                  setCategoriaActiva(e.target.value);
                  setSubcategoriaActiva('');
                  setSubcategoriaHijaActiva('');
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: categoriaActiva ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: categoriaActiva ? '#eff6ff' : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer',
                }}
              >
                <option value="">
                  Todas las Categorías ({itemsPorTiendas.length.toLocaleString('es-CL')})
                </option>
                {ARBOL_CATEGORIAS_TIENDA.map((cat) => {
                  const count = conteosArbolWoo.porCat.get(cat.nombre) || 0;
                  return (
                    <option key={cat.nombre} value={cat.nombre}>
                      {cat.nombre} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Nivel 2: Subcategoría */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                2. Subcategoría
              </label>
              <select
                value={subcategoriaActiva}
                disabled={!familiaSeleccionadaObj}
                onChange={(e) => {
                  setSubcategoriaActiva(e.target.value);
                  setSubcategoriaHijaActiva('');
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: subcategoriaActiva ? '2px solid #0284c7' : '1px solid #cbd5e1',
                  background: !familiaSeleccionadaObj
                    ? '#f8fafc'
                    : subcategoriaActiva
                      ? '#e0f2fe'
                      : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: !familiaSeleccionadaObj ? '#94a3b8' : '#0f172a',
                  cursor: !familiaSeleccionadaObj ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="">
                  {familiaSeleccionadaObj
                    ? `Todas las subcategorías (${familiaSeleccionadaObj.subcategorias.length})`
                    : 'Elige primero una categoría'}
                </option>
                {(familiaSeleccionadaObj?.subcategorias || []).map((sub) => {
                  const count =
                    conteosArbolWoo.porSub.get(
                      `${familiaSeleccionadaObj?.nombre}::${sub.nombre}`
                    ) || 0;
                  return (
                    <option key={sub.nombre} value={sub.nombre}>
                      {sub.nombre} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Nivel 3: Subcategoría Hija / Pieza Específica */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                3. Pieza Específica
              </label>
              <select
                value={subcategoriaHijaActiva}
                disabled={
                  !subcategoriaSeleccionadaObj ||
                  (subcategoriaSeleccionadaObj.hijos || []).length === 0
                }
                onChange={(e) => setSubcategoriaHijaActiva(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: subcategoriaHijaActiva ? '2px solid #0d9488' : '1px solid #cbd5e1',
                  background:
                    !subcategoriaSeleccionadaObj ||
                    (subcategoriaSeleccionadaObj.hijos || []).length === 0
                      ? '#f8fafc'
                      : subcategoriaHijaActiva
                        ? '#ccfbf1'
                        : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color:
                    !subcategoriaSeleccionadaObj ||
                    (subcategoriaSeleccionadaObj.hijos || []).length === 0
                      ? '#94a3b8'
                      : '#0f172a',
                  cursor:
                    !subcategoriaSeleccionadaObj ||
                    (subcategoriaSeleccionadaObj.hijos || []).length === 0
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                <option value="">
                  {!subcategoriaSeleccionadaObj
                    ? 'Elige primero subcategoría'
                    : (subcategoriaSeleccionadaObj.hijos || []).length === 0
                      ? 'Sin subdivisión adicional'
                      : `Todas las piezas (${(subcategoriaSeleccionadaObj.hijos || []).length})`}
                </option>
                {(subcategoriaSeleccionadaObj?.hijos || []).map((hija: string) => {
                  const count =
                    conteosArbolWoo.porHija.get(
                      `${familiaSeleccionadaObj?.nombre}::${subcategoriaSeleccionadaObj?.nombre}::${hija}`
                    ) || 0;
                  return (
                    <option key={hija} value={hija}>
                      {hija} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {/* 2. Marcas, Modelos y Rangos de Años Compatibles (Espejo Productos -> Marcas en WooCommerce) */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                🚗 Marcas, Modelos y Años Compatibles (`Productos → Marcas` Woo)
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                Jerarquía 3 niveles: <strong>Marca</strong> ↳ <strong>Modelo</strong> ↳{' '}
                <strong>Rango de Años</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {(filtroMarcaAuto || filtroModeloAuto || filtroRangoAnioAuto) && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    setFiltroMarcaAuto('');
                    setFiltroModeloAuto('');
                    setFiltroRangoAnioAuto('');
                  }}
                >
                  ✕ Limpiar vehículo
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: '#0284c7', color: '#ffffff', fontWeight: 700 }}
                onClick={handleSyncMarcasWoo}
                disabled={sincronizandoMarcasWoo}
              >
                {sincronizandoMarcasWoo
                  ? 'Subiendo a WordPress...'
                  : '⚡ Cargar Árbol a WooCommerce'}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 8,
            }}
          >
            {/* Nivel 1: Marca Vehículo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                1. Marca Vehículo ({marcasAutoOpciones.length})
              </label>
              <select
                value={filtroMarcaAuto}
                onChange={(e) => {
                  setFiltroMarcaAuto(e.target.value);
                  setFiltroModeloAuto('');
                  setFiltroRangoAnioAuto('');
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: filtroMarcaAuto ? '2px solid #0284c7' : '1px solid #cbd5e1',
                  background: filtroMarcaAuto ? '#e0f2fe' : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer',
                }}
              >
                <option value="">Todas las Marcas ({marcasAutoOpciones.length})</option>
                {marcasAutoOpciones.map(([marca, count]) => (
                  <option key={marca} value={marca}>
                    {marca} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* Nivel 2: Modelo Compatible */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                2. Modelo Compatible
              </label>
              <select
                value={filtroModeloAuto}
                disabled={!filtroMarcaAuto || modelosDeMarcaActiva.length === 0}
                onChange={(e) => {
                  setFiltroModeloAuto(e.target.value);
                  setFiltroRangoAnioAuto('');
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: filtroModeloAuto ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background:
                    !filtroMarcaAuto || modelosDeMarcaActiva.length === 0
                      ? '#f8fafc'
                      : filtroModeloAuto
                        ? '#dbeafe'
                        : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color:
                    !filtroMarcaAuto || modelosDeMarcaActiva.length === 0
                      ? '#94a3b8'
                      : '#0f172a',
                  cursor:
                    !filtroMarcaAuto || modelosDeMarcaActiva.length === 0
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                <option value="">
                  {!filtroMarcaAuto
                    ? 'Elige primero una marca'
                    : modelosDeMarcaActiva.length === 0
                      ? 'Sin modelos detallados'
                      : `Todos los modelos ${filtroMarcaAuto} (${modelosDeMarcaActiva.length})`}
                </option>
                {modelosDeMarcaActiva.map(([mod, count]) => (
                  <option key={mod} value={mod}>
                    {filtroMarcaAuto} {mod} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* Nivel 3: Rango de Años */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                3. Rango de Años
              </label>
              <select
                value={filtroRangoAnioAuto}
                disabled={!filtroMarcaAuto || !filtroModeloAuto || rangosDeModeloActivo.length === 0}
                onChange={(e) => setFiltroRangoAnioAuto(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: filtroRangoAnioAuto ? '2px solid #0d9488' : '1px solid #cbd5e1',
                  background:
                    !filtroMarcaAuto || !filtroModeloAuto || rangosDeModeloActivo.length === 0
                      ? '#f8fafc'
                      : filtroRangoAnioAuto
                        ? '#ccfbf1'
                        : '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color:
                    !filtroMarcaAuto || !filtroModeloAuto || rangosDeModeloActivo.length === 0
                      ? '#94a3b8'
                      : '#0f172a',
                  cursor:
                    !filtroMarcaAuto || !filtroModeloAuto || rangosDeModeloActivo.length === 0
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                <option value="">
                  {!filtroMarcaAuto || !filtroModeloAuto
                    ? 'Elige primero marca y modelo'
                    : rangosDeModeloActivo.length === 0
                      ? 'Todos los años'
                      : `Todos los rangos (${rangosDeModeloActivo.length})`}
                </option>
                {rangosDeModeloActivo.map(([rango, count]) => (
                  <option key={rango} value={rango}>
                    {filtroMarcaAuto} {filtroModeloAuto} ({rango}) · {count}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Herramientas Estilo WooCommerce Products Table */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['todos', `Todos (${itemsPorTiendas.length.toLocaleString('es-CL')})`],
              ['publicados_woo', `🌐 En WooCommerce (${kpisConsolidados.publicadosWoo.toLocaleString('es-CL')})`],
              ['con_stock', `🟢 En Stock (${kpisConsolidados.conStock.toLocaleString('es-CL')})`],
              ['pendientes_sync', `🔄 Pendientes Sync (${kpisConsolidados.pendientesSync})`],
              ['stock_bajo', '⚠️ Stock Bajo / Agotados'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${filtroEstadoWoo === key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFiltroEstadoWoo(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={ordenInventario}
            onChange={(e) =>
              setOrdenInventario(e.target.value as typeof ordenInventario)
            }
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            <option value="recomendado_woo">⭐ Orden Recomendado (Olivares 224 → Soluparts → Web)</option>
            <option value="stock_desc">📦 Mayor Stock disponible primero</option>
            <option value="precio_asc">💲 Precio: Menor a Mayor</option>
            <option value="precio_desc">💲 Precio: Mayor a Menor</option>
            <option value="nombre_asc">🔤 Nombre (A - Z)</option>
          </select>

          <input
            type="text"
            placeholder="Buscar SKU, repuesto, modelo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: '0.82rem',
              minWidth: 220,
            }}
          />
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={itemsFiltradosYOrdenados.length}
        pageSize={pageSize}
        onPage={goTo}
        onPageSize={changeSize}
      />

      {/* Tabla estilo Portal WooCommerce Products */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 58 }}>Foto</th>
                <th>Nombre del Producto & Vehículo</th>
                <th>SKU Público / OEM</th>
                <th>Tienda / ERP Origen</th>
                <th>Categoría › Subcategoría (WooCommerce)</th>
                <th>Stock</th>
                <th className="r">Costo Neto</th>
                <th className="r">Precio Web (c/IVA)</th>
                <th>Estado Web</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item) => {
                const tiendaInfo = clasificarTiendaDeItem(item);
                const jer = resolverJerarquiaCategoria(item);
                const disp = Math.max(0, (item.stock || 0) - (item.stockReservado || 0));
                const precioWebIva = conIva(item.precioVenta || 0);
                const rutaCat = [
                  jer.categoria || item.categoria,
                  jer.subcategoria || item.subcategoria,
                  jer.subcategoriaDetalle || item.subcategoriaDetalle,
                ]
                  .filter(Boolean)
                  .join(' › ');

                return (
                  <tr key={item.id}>
                    <td>
                      {item.imagenUrl ? (
                        <img
                          src={item.imagenUrl}
                          alt={item.nombre}
                          style={{
                            width: 46,
                            height: 46,
                            objectFit: 'contain',
                            borderRadius: 8,
                            border: '1px solid #e2e8f0',
                            background: '#fff',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 8,
                            background: '#f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            color: '#94a3b8',
                          }}
                        >
                          Sin foto
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
                        {item.nombre}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                        🚗 {(item.marcasCompatibles || []).join(', ') || 'Multimarca'}
                        {item.fabricante ? ` · Fab: ${item.fabricante}` : ''}
                      </div>
                    </td>
                    <td>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          color: '#0369a1',
                        }}
                      >
                        {item.skuPublicoFrp || item.codigo}
                      </div>
                      {item.codigo && item.skuPublicoFrp && item.codigo !== item.skuPublicoFrp && (
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          Ref: {item.codigo}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '0.73rem',
                          fontWeight: 700,
                          background: '#f1f5f9',
                          color: tiendaInfo.color,
                          border: `1px solid ${tiendaInfo.color}33`,
                        }}
                      >
                        {tiendaInfo.nombre}
                      </span>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                        {tiendaInfo.promesaRetiro}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155' }}>
                        {rutaCat}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '0.86rem',
                          color: disp > 0 ? '#16a34a' : '#dc2626',
                        }}
                      >
                        {disp > 0 ? `${disp} en stock` : 'Agotado (0)'}
                      </span>
                    </td>
                    <td className="r" style={{ fontSize: '0.8rem', color: '#475569' }}>
                      {fmtCLP(item.precioCompra || 0)}
                    </td>
                    <td className="r">
                      <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                        {fmtCLP(precioWebIva)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                        {fmtCLP(item.precioVenta || 0)} neto
                      </div>
                    </td>
                    <td>
                      {item.wooProductId ? (
                        <a
                          href={`https://facilrepuestos.cl/?p=${item.wooProductId}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            color: '#15803d',
                            textDecoration: 'none',
                            background: '#dcfce7',
                            padding: '3px 8px',
                            borderRadius: 999,
                            display: 'inline-block',
                          }}
                        >
                          ✓ Woo #{item.wooProductId} ↗
                        </a>
                      ) : disp > 0 && !item.ocultarEnTienda ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: '#0369a1',
                            background: '#e0f2fe',
                            padding: '3px 8px',
                            borderRadius: 999,
                          }}
                        >
                          En cola Web
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: '#64748b',
                            background: '#f1f5f9',
                            padding: '3px 8px',
                            borderRadius: 999,
                          }}
                        >
                          Solo ERP
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                    No se encontraron repuestos para la combinación de Tiendas y Categorías seleccionada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => navigate('/inventario')}
        >
          Ir a Administración de Inventario & Carga de Productos →
        </button>
      </div>
    </div>
  );
}
