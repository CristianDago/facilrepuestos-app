import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { inventarioService } from "../../services/inventario";
import { proveedoresService } from "../../services/proveedores";
import { tiposPiezaService } from "../../services/tiposPieza";
import { fabricantesService } from "../../services/fabricantes";
import type { Fabricante } from "../../services/fabricantes";
import type { TipoPieza } from "../../services/tiposPieza";
import { categoriasService } from "../../services/categorias";
import type { Categoria } from "../../services/categorias";
import { marcasVehiculoService } from "../../services/marcasVehiculo";
import type { MarcaVehiculo } from "../../services/marcasVehiculo";
import { woocommerceService } from "../../services/woocommerce";
import type {
  ItemInventario,
  CategoriaInventario,
  PosicionPieza,
  LadoPieza,
  Proveedor,
  Equivalencia,
} from "../../types";
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './Inventario.module.css';
import * as XLSX from 'xlsx';
import ImportarExcelModal from './ImportarExcelModal';
import IngresoRapidoModal from './IngresoRapidoModal';
import {
  getStockInfo,
  MARCAS_VEHICULOS,
  TIPOS_PIEZA_DEFAULT,
  CATEGORIAS_DEFAULT,
  ORIGENES_REPUESTO,
} from "../../types";

// ─── MODELOS POR MARCA ────────────────────────────────────
const MODELOS_POR_MARCA: { [marca: string]: string[] } = {
  'TOYOTA':        ['COROLLA','YARIS','HILUX','RAV4','FORTUNER','CAMRY','PRADO','LAND CRUISER','RUSH','TERIOS','FJ CRUISER'],
  'HYUNDAI':       ['ACCENT','ELANTRA','TUCSON','SANTA FE','CRETA','IONIQ','SONATA','IX35','GRAND I10','VENUE'],
  'KIA':           ['RIO','CERATO','SPORTAGE','SORENTO','STONIC','SELTOS','CARNIVAL','PICANTO','SOUL'],
  'CHEVROLET':     ['SPARK','SAIL','CAPTIVA','TRACKER','ONIX','TRAILBLAZER','COLORADO','AVEO','CRUZE','GROOVE'],
  'NISSAN':        ['MARCH','SENTRA','TIIDA','FRONTIER','PATHFINDER','MURANO','QASHQAI','KICKS','NAVARA','X-TRAIL','NOTE'],
  'FORD':          ['FIESTA','FOCUS','ESCAPE','EXPLORER','RANGER','F-150','ECOSPORT','MUSTANG','TERRITORY'],
  'VOLKSWAGEN':    ['GOL','POLO','GOLF','PASSAT','TIGUAN','TERAMONT','AMAROK','VIRTUS','T-CROSS','TAOS'],
  'MAZDA':         ['MAZDA2','MAZDA3','MAZDA6','CX-3','CX-5','CX-9','BT-50','CX-30'],
  'HONDA':         ['FIT','CIVIC','ACCORD','CR-V','HR-V','PILOT','WR-V','ZR-V','ODYSSEY'],
  'SUZUKI':        ['SWIFT','BALENO','VITARA','GRAND VITARA','JIMNY','S-CROSS','ERTIGA'],
  'MITSUBISHI':    ['LANCER','OUTLANDER','ASX','L200','MONTERO','ECLIPSE CROSS','GALANT'],
  'SUBARU':        ['IMPREZA','LEGACY','FORESTER','OUTBACK','XV','WRX','CROSSTREK'],
  'BMW':           ['SERIE 1','SERIE 3','SERIE 5','SERIE 7','X1','X3','X5','X6','X7','M3','M5'],
  'MERCEDES-BENZ': ['CLASE A','CLASE B','CLASE C','CLASE E','CLASE S','GLA','GLC','GLE','VITO','SPRINTER'],
  'AUDI':          ['A1','A3','A4','A5','A6','Q2','Q3','Q5','Q7','Q8','TT'],
  'RENAULT':       ['SANDERO','LOGAN','DUSTER','KOLEOS','CAPTUR','FLUENCE','MEGANE','KANGOO','STEPWAY'],
  'PEUGEOT':       ['208','308','408','508','2008','3008','5008','PARTNER','EXPERT'],
  'CITROËN':       ['C3','C4','C4 PICASSO','BERLINGO','JUMPER'],
  'FIAT':          ['PALIO','PUNTO','SIENA','DOBLO','DUCATO','TIPO','CRONOS','ARGO','TORO'],
  'JEEP':          ['RENEGADE','COMPASS','CHEROKEE','GRAND CHEROKEE','WRANGLER'],
  'LAND ROVER':    ['DEFENDER','DISCOVERY','DISCOVERY SPORT','RANGE ROVER','EVOQUE','VELAR'],
  'LEXUS':         ['IS','ES','GS','LS','UX','NX','RX','GX','LX'],
  'VOLVO':         ['S40','S60','S90','V40','V60','V90','XC40','XC60','XC90'],
  'HAVAL':         ['H1','H2','H4','H6','H9','JOLION','F7','F7X'],
  'GREAT WALL':    ['WINGLE','POER','STEED'],
  'CHERY':         ['QQ','ARRIZO 3','ARRIZO 5','ARRIZO 6','TIGGO 2','TIGGO 4','TIGGO 7','TIGGO 8'],
  'JAC':           ['J3','J4','J6','S3','S4','T6','T8'],
  'MG':            ['3','5','6','HS','ZS','RX5'],
  'BYD':           ['DOLPHIN','ATTO 3','HAN','TANG','SEAL','YUAN PLUS'],
  'GEELY':         ['MK','EMGRAND','AZKARRA','COOLRAY'],
  'RAM':           ['700','1500','2500','3500','PROMASTER'],
  'DODGE':         ['JOURNEY','DURANGO','CHARGER','CHALLENGER'],
  'ALFA ROMEO':    ['GIULIA','STELVIO','GIULIETTA','TONALE'],
  'MINI':          ['COOPER','CLUBMAN','COUNTRYMAN'],
  'INFINITI':      ['Q30','Q50','Q60','QX30','QX50','QX60','QX80'],
  'ZNA':           ['RICH','PICKUP','RHINO'],
};

const POSICIONES: PosicionPieza[] = ["DELANTERA","TRASERA","NO APLICA"];
const LADOS: LadoPieza[]         = ["DERECHO","IZQUIERDO","AMBOS","NO APLICA"];

const fmtCLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
// Todos los precios se guardan NETOS; el IVA (19%) se agrega encima solo al mostrar.
const conIva = (neto: number) => Math.round((neto || 0) * 1.19);

const emptyItem = (): Omit<ItemInventario, "id"> => ({
  nombre:             "",
  codigo:             "",
  fabricante:         "",
  origen:             "",
  descripcion:        "",
  equivalencias:      [] as Equivalencia[],
  categoria:          "FRENOS",
  proveedor:          "",
  tipoPieza:          "",
  posicion:           "NO APLICA",
  lado:               "NO APLICA",
  marcasCompatibles:  [],
  modelosCompatibles: {},
  anioDesde:          null,
  anioHasta:          null,
  precioImportacion:  0,
  precioLista:        0,
  descuentoTaller:    0,
  precioCompra:       0,
  precioVenta:        0,
  stock:              0,
  stockReservado:     0,
  stockMinimo:        2,
  unidad:             "unidad",
  imagenUrl:          "",
  ocultarEnTienda:    false,
});

// Correo/medio de contacto que se muestra a los proveedores cuando necesitan que el taller
// agregue una categoría, tipo de pieza o marca de vehículo que no existe en las listas.
const CONTACTO_TALLER = "taller@drmotors.cl";

// Nombre automático del repuesto: tipo de pieza + código (como se hacía hasta ahora)
const autoNombre = (tipo?: string, codigo?: string) =>
  [tipo, codigo].map(s => (s || "").trim().toUpperCase()).filter(Boolean).join(" ");

interface InventarioProps {
  /** "taller" = administrador (todo el inventario) · "proveedor" = solo su propio inventario */
  modo?: "taller" | "proveedor";
}

export default function Inventario({ modo = "taller" }: InventarioProps) {
  const esProveedor = modo === "proveedor";
  const { inventario, setInventario, setLoading, notify } = useAppStore();
  const [search, setSearch]       = useState("");
  const [filtrocat, setFiltrocat] = useState("");
  const [vista, setVista]         = useState<"grid" | "tabla">("grid");
  const [modal, setModal]         = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<Omit<ItemInventario, "id">>(emptyItem());

  const [modalExcel, setModalExcel] = useState(false);
  const [modalPistola, setModalPistola] = useState(false);

  const [categoriasList, setCategoriasList]         = useState<Categoria[]>([]);
  const [categoriaCustom, setCategoriaCustom]       = useState("");
  const [guardandoCategoria, setGuardandoCategoria] = useState(false);

  const [proveedoresList, setProveedoresList]         = useState<Proveedor[]>([]);
  const [tiposPieza, setTiposPieza]                   = useState<TipoPieza[]>([]);
  const [tipoCustom, setTipoCustom]                   = useState("");
  const [guardandoTipo, setGuardandoTipo]             = useState(false);
  const [fabricantesList, setFabricantesList]         = useState<Fabricante[]>([]);
  const [fabricanteCustom, setFabricanteCustom]       = useState("");
  const [guardandoFabricante, setGuardandoFabricante] = useState(false);

  const [eqFabricanteNuevo, setEqFabricanteNuevo] = useState("");
  const [eqPanel, setEqPanel]                     = useState<string[]>([]);
  const [eqExpandidos, setEqExpandidos]           = useState<{ [fab: string]: boolean }>({});
  const [eqInputs, setEqInputs]                   = useState<{ [fab: string]: string }>({});

  const [marcaCustom, setMarcaCustom]             = useState("");
  const [marcasExtra, setMarcasExtra]             = useState<string[]>([]);
  const [marcasPersistidas, setMarcasPersistidas] = useState<MarcaVehiculo[]>([]);
  const [guardandoMarca, setGuardandoMarca]       = useState(false);
  const [sincronizando, setSincronizando]         = useState(false);
  const [modeloInputs, setModeloInputs]           = useState<{ [marca: string]: string }>({});
  const [marcasExpandidas, setMarcasExpandidas]   = useState<{ [marca: string]: boolean }>({});

  useEffect(() => {
    loadInventario(); if (!esProveedor) loadProveedores(); loadTiposPieza(); loadFabricantes(); loadCategorias(); loadMarcas();
  }, []);

  const loadInventario  = async () => { setLoading(true); try { const r = await inventarioService.getAll(); if (r.success && r.data) setInventario(r.data); } catch { notify("Error al cargar inventario","error"); } finally { setLoading(false); } };
  const loadProveedores = async () => { try { const r = await proveedoresService.getAll(); if (r.success && r.data) setProveedoresList(r.data); } catch {} };
  const loadTiposPieza  = async () => { try { const r = await tiposPiezaService.getAll(); if (r.success && r.data) setTiposPieza(r.data); } catch {} };
  const loadFabricantes = async () => { try { const r = await fabricantesService.getAll(); if (r.success && r.data) setFabricantesList(r.data); } catch {} };
  const loadCategorias  = async () => { try { const r = await categoriasService.getAll(); if (r.success && r.data) setCategoriasList(r.data); } catch {} };
  const loadMarcas      = async () => { try { const r = await marcasVehiculoService.getAll(); if (r.success && r.data) setMarcasPersistidas(r.data); } catch {} };

  const handleSyncWoo = async () => {
    setSincronizando(true);
    try {
      const r = await woocommerceService.sync();
      if (r.success && r.data) {
        const ocultadosTxt = r.data.ocultados ? `, ${r.data.ocultados} ocultados` : "";
        notify(`Sincronizado ✓ — ${r.data.creados} nuevos, ${r.data.actualizados} actualizados${ocultadosTxt}`, "success");
      } else {
        notify(r.error || "Error al sincronizar con WooCommerce", "error");
      }
    } catch {
      notify("Error al sincronizar con WooCommerce", "error");
    } finally {
      setSincronizando(false);
    }
  };

  // Lista completa: fijas del sistema + las que se han ido agregando y guardando
  const allMarcasVehiculo = [
    ...MARCAS_VEHICULOS.filter(m => m !== "OTRO"),
    ...marcasPersistidas.map(m => m.nombre).filter(n => !MARCAS_VEHICULOS.includes(n)),
  ];

  const agregarCategoria = async () => {
    const nombre = categoriaCustom.trim().toUpperCase();
    if (!nombre) return;
    const allCats = [...CATEGORIAS_DEFAULT, ...categoriasList.map(c => c.nombre)];
    if (allCats.includes(nombre)) { notify("Esta categoría ya existe","error"); return; }
    setGuardandoCategoria(true);
    try {
      const r = await categoriasService.create(nombre);
      if (r.success) { notify(`Categoría "${nombre}" agregada ✓`,"success"); setCategoriaCustom(""); await loadCategorias(); setForm(p => ({...p, categoria: nombre})); }
    } catch { notify("Error al guardar categoría","error"); }
    finally { setGuardandoCategoria(false); }
  };

  const eliminarCategoria = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la categoría "${nombre}"?`)) return;
    try { await categoriasService.delete(id); notify(`Categoría "${nombre}" eliminada`,"info"); loadCategorias(); }
    catch { notify("Error al eliminar","error"); }
  };

  const eliminarTipo = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el tipo "${nombre}"?`)) return;
    try { await tiposPiezaService.delete(id); notify(`Tipo "${nombre}" eliminado`,"info"); loadTiposPieza(); }
    catch { notify("Error al eliminar","error"); }
  };

  const agregarFabricante = async () => {
    const nombre = fabricanteCustom.trim();
    if (!nombre) return;
    if (fabricantesList.some(f => f.nombre.toLowerCase() === nombre.toLowerCase())) { notify("Esta marca ya existe","error"); return; }
    setGuardandoFabricante(true);
    try { const r = await fabricantesService.create(nombre); if (r.success) { notify(`Marca "${nombre}" agregada ✓`,"success"); setFabricanteCustom(""); loadFabricantes(); } }
    catch { notify("Error al guardar la marca","error"); }
    finally { setGuardandoFabricante(false); }
  };

  const allCategorias = [
    ...CATEGORIAS_DEFAULT.map(n => ({ nombre: n, custom: false, id: undefined })),
    ...categoriasList.map(c => ({ nombre: c.nombre, custom: true, id: c.id })),
  ];
  const allTipos = [...TIPOS_PIEZA_DEFAULT.filter(t => t.toUpperCase() !== "OTRO"), ...tiposPieza.map(t => t.nombre), "OTRO"];

  const agregarTipoCustom = async () => {
    const nombre = tipoCustom.trim();
    if (!nombre || allTipos.includes(nombre)) { notify("Ese tipo ya existe","error"); return; }
    setGuardandoTipo(true);
    try { const r = await tiposPiezaService.create(nombre); if (r.success) { notify(`Tipo "${nombre}" agregado ✓`,"success"); setTipoCustom(""); await loadTiposPieza(); setForm(p => ({...p, tipoPieza: nombre})); } }
    catch { notify("Error al guardar tipo","error"); }
    finally { setGuardandoTipo(false); }
  };

  const openNuevo = () => {
    setEditingId(null); setForm(emptyItem()); setMarcasExtra([]); setMarcaCustom("");
    setTipoCustom(""); setModeloInputs({}); setMarcasExpandidas({}); setEqPanel([]);
    setEqExpandidos({}); setEqInputs({}); setEqFabricanteNuevo(""); setModal(true);
  };

  const openEditar = (item: ItemInventario) => {
    setEditingId(item.id!);
    const marcasConocidas = (item.marcasCompatibles || []).filter(m => allMarcasVehiculo.includes(m));
    const extra           = (item.marcasCompatibles || []).filter(m => !allMarcasVehiculo.includes(m));
    setForm({
      nombre:             item.nombre            || "",
      codigo:             item.codigo            || "",
      fabricante:         item.fabricante        || "",
      origen:             item.origen            || "",
      descripcion:        item.descripcion       || "",
      equivalencias:      (item.equivalencias || []) as Equivalencia[],
      categoria:          item.categoria         || "FRENOS",
      proveedor:          item.proveedor         || "",
      tipoPieza:          item.tipoPieza         || "",
      posicion:           item.posicion          || "NO APLICA",
      lado:               item.lado              || "NO APLICA",
      marcasCompatibles:  marcasConocidas,
      modelosCompatibles: item.modelosCompatibles || {},
      anioDesde:          item.anioDesde         || null,
      anioHasta:          item.anioHasta         || null,
      precioImportacion:  item.precioImportacion  || 0,
      precioLista:        item.precioLista         || 0,
      descuentoTaller:    item.descuentoTaller     || 0,
      precioCompra:       item.precioCompra        || 0,
      precioVenta:        item.precioVenta         || 0,
      stock:              item.stock             || 0,
      stockReservado:     item.stockReservado    || 0,
      stockMinimo:        item.stockMinimo       || 0,
      unidad:             item.unidad            || "unidad",
      imagenUrl:          item.imagenUrl         || "",
      ocultarEnTienda:    item.ocultarEnTienda   || false,
    });
    const fabsExistentes = [...new Set((item.equivalencias || []).map((e: Equivalencia) => e.fabricante))];
    setEqPanel(fabsExistentes);
    const expandidosIniciales: { [fab: string]: boolean } = {};
    fabsExistentes.forEach(f => { expandidosIniciales[f] = true; });
    setEqExpandidos(expandidosIniciales);
    setEqInputs({}); setEqFabricanteNuevo("");
    setMarcasExtra(extra); setMarcaCustom(""); setTipoCustom("");
    setModeloInputs({}); setMarcasExpandidas({}); setModal(true);
  };

  const toggleMarca = (marca: string) => {
    const current  = form.marcasCompatibles || [];
    const selected = current.includes(marca);
    setForm(prev => ({
      ...prev,
      marcasCompatibles: selected ? current.filter(m => m !== marca) : [...current, marca],
      modelosCompatibles: selected
        ? Object.fromEntries(Object.entries(prev.modelosCompatibles || {}).filter(([k]) => k !== marca))
        : prev.modelosCompatibles,
    }));
    if (!selected) setMarcasExpandidas(prev => ({ ...prev, [marca]: true }));
  };

  const agregarModelo = (marca: string) => {
    const modelo = (modeloInputs[marca] || "").trim().toUpperCase();
    if (!modelo) return;
    const actuales = (form.modelosCompatibles || {})[marca] || [];
    if (actuales.includes(modelo)) return;
    setForm(prev => ({ ...prev, modelosCompatibles: { ...prev.modelosCompatibles, [marca]: [...actuales, modelo] } }));
    setModeloInputs(prev => ({ ...prev, [marca]: "" }));
  };

  const quitarModelo = (marca: string, modelo: string) => {
    const actuales = (form.modelosCompatibles || {})[marca] || [];
    setForm(prev => ({ ...prev, modelosCompatibles: { ...prev.modelosCompatibles, [marca]: actuales.filter(m => m !== modelo) } }));
  };

  const agregarFabricanteEq = (fab: string) => {
    if (!fab || eqPanel.includes(fab)) return;
    setEqPanel(prev => [...prev, fab]);
    setEqExpandidos(prev => ({ ...prev, [fab]: true }));
    setEqFabricanteNuevo("");
  };

  const quitarFabricanteEq = (fab: string) => {
    setEqPanel(prev => prev.filter(f => f !== fab));
    setForm(prev => ({ ...prev, equivalencias: (prev.equivalencias || []).filter(e => e.fabricante !== fab) }));
  };

  const agregarCodigoEq = (fab: string) => {
    const codigo = (eqInputs[fab] || "").trim().toUpperCase();
    if (!codigo) return;
    const ya = (form.equivalencias || []).some(e => e.fabricante === fab && e.codigo === codigo);
    if (!ya) setField("equivalencias", [...(form.equivalencias || []), { fabricante: fab, codigo }]);
    setEqInputs(prev => ({ ...prev, [fab]: "" }));
  };

  const quitarCodigoEq = (fab: string, codigo: string) => {
    setForm(prev => ({ ...prev, equivalencias: (prev.equivalencias || []).filter(e => !(e.fabricante === fab && e.codigo === codigo)) }));
  };

  const agregarMarcaCustom = async () => {
    const m = marcaCustom.trim().toUpperCase();
    if (!m || allMarcasVehiculo.includes(m) || marcasExtra.includes(m) || (form.marcasCompatibles || []).includes(m)) { notify("Esa marca ya está","error"); return; }
    setGuardandoMarca(true);
    try {
      const r = await marcasVehiculoService.create(m);
      if (r.success) {
        notify(`Marca "${m}" agregada ✓`, "success");
        setMarcaCustom("");
        await loadMarcas();
        setForm(prev => ({ ...prev, marcasCompatibles: [...(prev.marcasCompatibles || []), m] }));
      } else {
        notify(r.error || "Error al guardar la marca", "error");
      }
    } catch {
      notify("Error al guardar la marca", "error");
    } finally {
      setGuardandoMarca(false);
    }
  };

  const handleSave = async () => {
    // Si no se escribió nombre, se genera automáticamente con el tipo de pieza y el código
    const nombreFinal = (form.nombre || "").trim().toUpperCase() || autoNombre(form.tipoPieza, form.codigo);
    if (!nombreFinal) { notify("Ingresa un nombre, o elige un tipo de pieza e ingresa el código para generarlo","error"); return; }
    setLoading(true);
    try {
      const data = { ...form, nombre: nombreFinal, marcasCompatibles: [...(form.marcasCompatibles || []), ...marcasExtra] };
      if (editingId) { await inventarioService.update(editingId, data); notify("Repuesto actualizado ✓","success"); }
      else           { await inventarioService.create(data);            notify("Repuesto agregado ✓","success"); }
      setModal(false); loadInventario();
    } catch { notify("Error al guardar","error"); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return;
    setLoading(true);
    try {
      const r = await inventarioService.delete(id);
      if (r.woocommerce?.eliminado) {
        notify("Repuesto eliminado (también de la tienda WooCommerce) ✓", "info");
      } else if (r.woocommerce?.motivo === "No sincronizado" || r.woocommerce?.motivo === "No existía en WooCommerce") {
        notify("Repuesto eliminado", "info");
      } else if (r.woocommerce) {
        notify(`Repuesto eliminado, pero no se pudo quitar de WooCommerce: ${r.woocommerce.motivo}`, "error");
      } else {
        notify("Repuesto eliminado", "info");
      }
      loadInventario();
    }
    catch (e: any) { notify(e?.message || "Error al eliminar","error"); }
    finally { setLoading(false); }
  };

  const handleAjusteStock = async (item: ItemInventario) => {
    const info = getStockInfo(item);
    const val  = prompt(`Stock de "${item.nombre}"\nTotal: ${info.total} | Reservado: ${info.reservado} | Disponible: ${info.disponible}\n\nIngresa el nuevo stock total:`);
    if (val === null || val === "") return;
    const newStock = parseInt(val);
    if (isNaN(newStock) || newStock < 0) { notify("Valor inválido","error"); return; }
    setLoading(true);
    try { await inventarioService.actualizarStock(item.id!, newStock); notify("Stock actualizado ✓","success"); loadInventario(); }
    catch (e: any) { notify(e?.message || "Error al actualizar stock","error"); }
    finally { setLoading(false); }
  };

  const setField = (field: keyof typeof form, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // Cambia código o tipo de pieza. El nombre se regenera solo mientras esté vacío o
  // siga siendo el automático; si el administrador lo escribió a mano, no se toca.
  const cambiarCodigoOTipo = (campo: "codigo" | "tipoPieza", valor: string) =>
    setForm(prev => {
      const antes   = autoNombre(prev.tipoPieza, prev.codigo);
      const next    = { ...prev, [campo]: valor };
      const despues = autoNombre(next.tipoPieza, next.codigo);
      const nombreEsAuto = !prev.nombre || prev.nombre === antes;
      return { ...next, nombre: nombreEsAuto ? despues : prev.nombre };
    });

  const lowStock   = inventario.filter(i => getStockInfo(i).disponible <= (i.stockMinimo || 0));
  const reservados = inventario.filter(i => (i.stockReservado || 0) > 0);
  const totalValue = inventario.reduce((s, i) => s + (i.precioCompra || 0) * (i.stock || 0), 0);
  const cats       = [...new Set(inventario.map(i => i.categoria).filter(Boolean))].length;

  const filtered = inventario.filter(i => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || i.nombre.toLowerCase().includes(q)
      || (i.codigo || "").toLowerCase().includes(q)
      || (i.fabricante || "").toLowerCase().includes(q)
      || (i.origen || "").toLowerCase().includes(q)
      || (i.descripcion || "").toLowerCase().includes(q)
      || (i.equivalencias || []).some((e: Equivalencia) => (`${e.fabricante} ${e.codigo}`).toLowerCase().includes(q))
      || (i.proveedor || "").toLowerCase().includes(q)
      || (i.tipoPieza || "").toLowerCase().includes(q)
      || (i.marcasCompatibles || []).some(m => m.toLowerCase().includes(q));
    const matchCat = !filtrocat || i.categoria === filtrocat;
    return matchSearch && matchCat;
  });
  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  const resumenModelos = (item: ItemInventario) => {
    const mc = item.modelosCompatibles || {};
    return Object.entries(mc)
      .filter(([, modelos]) => modelos.length > 0)
      .map(([marca, modelos]) => `${marca}: ${modelos.slice(0, 2).join(', ')}${modelos.length > 2 ? ` +${modelos.length - 2}` : ''}`)
      .slice(0, 2)
      .join(' · ');
  };

  const AvisoContacto = ({ que }: { que: string }) => (
    <div className={styles.avisoContacto}>
      ⚠ ¿No encuentras {que}? No puedes crearlo tú: contacta al taller ({CONTACTO_TALLER}) para que lo agregue.
    </div>
  );

  const StockBar = ({ item }: { item: ItemInventario }) => {
    const info          = getStockInfo(item);
    const pctReservado  = info.total > 0 ? (info.reservado  / info.total) * 100 : 0;
    const pctDisponible = info.total > 0 ? (info.disponible / info.total) * 100 : 0;
    const isLow         = info.disponible <= (item.stockMinimo || 0);
    return (
      <div>
        <div className={styles.stockBarRow}>
          <div>
            <div className={`inv-stock ${isLow ? "low" : ""}`}>{info.disponible}</div>
            <div className="inv-stock-lbl">disponible</div>
          </div>
          {info.reservado > 0 && (
            <div className={styles.stockBarCol}>
              <div className={styles.stockReservadoNum}>{info.reservado}</div>
              <div className={`inv-stock-lbl ${styles.colorWarning}`}>reservado</div>
            </div>
          )}
          <div className={styles.stockBarCol}>
            <div className={styles.stockTotalNum}>{info.total}</div>
            <div className="inv-stock-lbl">total</div>
          </div>
        </div>
        {info.total > 0 && (
          <div className={styles.stockBarTrack}>
            <div className={`${styles.stockBarFillDisponible} ${isLow ? styles.bajo : ''}`} style={{ width: `${pctDisponible}%` }} />
            <div className={styles.stockBarFillReservado} style={{ width: `${pctReservado}%` }} />
          </div>
        )}
        {isLow && <div className={styles.stockLowWarning}>⚠ Stock bajo · Mín: {item.stockMinimo}</div>}
      </div>
    );
  };

  const exportarExcel = () => {
    const filas = filtered.map(item => ({
      codigo:            item.codigo             || "",
      nombre:            item.nombre             || "",
      fabricante:        item.fabricante         || "",
      categoria:         item.categoria          || "",
      tipoPieza:         item.tipoPieza          || "",
      posicion:          item.posicion           || "",
      lado:              item.lado               || "",
      marcas:            (item.marcasCompatibles || []).join(","),
      modelos:           Object.entries(item.modelosCompatibles || {}).filter(([, v]) => v.length > 0).map(([m, v]) => `${m}:${v.join(",")}`).join(";"),
      anioDesde:         item.anioDesde          ?? "",
      anioHasta:         item.anioHasta          ?? "",
      precioImportacion: item.precioImportacion  || 0,
      precioLista:       item.precioLista         || 0,
      descuentoTaller:   item.descuentoTaller    || 0,
      precioCompra:      item.precioCompra       || 0,
      precioVenta:       item.precioVenta         || 0,
      stock:             item.stock              || 0,
      stockReservado:    item.stockReservado     || 0,
      stockMinimo:       item.stockMinimo        || 0,
      unidad:            item.unidad             || "",
      imagenUrl:         item.imagenUrl          || "",
      proveedor:         item.proveedor          || "",
      eq_fabricante:     (item.equivalencias || []).map((e: Equivalencia) => e.fabricante).join(","),
      eq_codigo:         (item.equivalencias || []).map((e: Equivalencia) => e.codigo).join(","),
      origen:            item.origen             || "",
      descripcion:       item.descripcion        || "",
    }));
    // El proveedor no exporta datos internos del taller (precio de venta, costo de importación)
    const filasExport = filas.map(f => {
      if (!esProveedor) return f;
      const copia: Record<string, unknown> = { ...f };
      delete copia.precioVenta;
      delete copia.precioImportacion;
      delete copia.proveedor;
      return copia;
    });
    const ws = XLSX.utils.json_to_sheet(filasExport);
    const ANCHOS: Record<string, number> = {
      codigo: 14, nombre: 30, fabricante: 14, categoria: 14, tipoPieza: 22, posicion: 12, lado: 12,
      marcas: 30, modelos: 40, anioDesde: 10, anioHasta: 10, precioImportacion: 16, precioLista: 14,
      descuentoTaller: 14, precioCompra: 14, precioVenta: 12, stock: 8, stockReservado: 10,
      stockMinimo: 10, unidad: 8, imagenUrl: 40, proveedor: 20, eq_fabricante: 30, eq_codigo: 30,
      origen: 16, descripcion: 50,
    };
    ws["!cols"] = Object.keys(filasExport[0] || {}).map(k => ({ wch: ANCHOS[k] ?? 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, `${esProveedor ? "mis_repuestos" : "inventario_drmotors"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const todasMarcasSeleccionadas = [...(form.marcasCompatibles || []), ...marcasExtra];

  return (
    <div>
      {/* ── HEADER: TÍTULO + FILA 1 (búsqueda/filtro/vista) ── */}
      <div className={styles.pageHeaderWrap}>
        <div className="page-header">
          <div className="page-title">{esProveedor ? <>Mis <span>Repuestos</span></> : <>Inventario <span>Bodega</span></>}</div>
          <div className={styles.toolbarFila1}>
            <input
              type="text"
              placeholder="Buscar repuesto, marca..."
              className={styles.searchInput}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className={styles.filtroCategoria}
              value={filtrocat}
              onChange={e => setFiltrocat(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {allCategorias.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <div className={styles.vistaToggle}>
              <button
                className={`btn btn-sm ${styles.vistaBtn} ${vista === "grid" ? styles.vistaBtnActive : ""}`}
                onClick={() => setVista("grid")}
              >⊞ Grid</button>
              <button
                className={`btn btn-sm ${styles.vistaBtn} ${vista === "tabla" ? styles.vistaBtnActive : ""}`}
                onClick={() => setVista("tabla")}
              >☰ Tabla</button>
            </div>
          </div>
        </div>
        {/* FILA 2: acciones */}
        <div className={styles.toolbarFila2}>
          <button
            className="btn btn-dark"
            style={{ background: '#0284c7', borderColor: '#0284c7', color: '#ffffff', fontWeight: 700 }}
            onClick={() => setModalPistola(true)}
            title="Escanear códigos con pistola e ingresar a bodega con búsqueda web automática"
          >
            ⚡ Ingreso con Pistola (QR/EAN)
          </button>
          <button className="btn btn-dark" onClick={() => setModalExcel(true)}>⬆ Importar Excel</button>
          <button className="btn btn-dark" onClick={exportarExcel} disabled={filtered.length === 0}>⬇ Exportar Excel</button>
          {!esProveedor && (
            <button className="btn btn-dark" onClick={handleSyncWoo} disabled={sincronizando}>
              {sincronizando ? "Sincronizando..." : "🛒 Sincronizar con WooCommerce"}
            </button>
          )}
          <button className="btn btn-primary" onClick={openNuevo}>+ Agregar Repuesto</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{inventario.length}</div><div className="stat-label">Total Items</div></div>
        <div className="stat-card"><div className={`stat-value ${styles.colorDanger}`}>{lowStock.length}</div><div className="stat-label">Stock Bajo</div></div>
        <div className="stat-card"><div className={`stat-value ${styles.colorWarning}`}>{reservados.length}</div><div className="stat-label">Con Reservas</div></div>
        <div className="stat-card"><div className={`stat-value ${styles.statValorInventario}`}>{fmtCLP(totalValue)}</div><div className="stat-label">Valor Inventario (neto)</div></div>
        <div className="stat-card"><div className="stat-value">{cats}</div><div className="stat-label">Categorías</div></div>
      </div>

      <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPage={goTo} onPageSize={changeSize} />

      {/* Vista Grid */}
      {vista === "grid" && (filtered.length === 0
        ? <div className={styles.emptyState}><div className={styles.emptyStateIcon}>📦</div><div>No hay repuestos en inventario</div></div>
        : <div className="inv-grid">
            {paged.map(item => {
              const margen     = item.precioCompra && item.precioVenta
                ? (((item.precioVenta - item.precioCompra) / item.precioVenta) * 100).toFixed(0) : null;
              const modResumen = resumenModelos(item);
              return (
                <div className="inv-card" key={item.id}>
                  <div className="inv-card-cat">{item.categoria}</div>
                  <div className="inv-card-name">{item.nombre}</div>
                  {item.ocultarEnTienda && (
                    <div className={styles.badgeOcultoTienda}>🚫 No se vende online</div>
                  )}
                  {item.fabricante && <div className={styles.cardFabricante}>🏭 {item.fabricante}</div>}
                  {(item.equivalencias || []).length > 0 && (
                    <div className={styles.cardEquivalencias}>
                      ≡ {(item.equivalencias || []).slice(0, 3).map((e: Equivalencia) => `${e.fabricante} ${e.codigo}`).join(" · ")}
                      {(item.equivalencias || []).length > 3 ? ` +${(item.equivalencias || []).length - 3}` : ""}
                    </div>
                  )}
                  <div className={styles.cardBadgesRow}>
                    {item.tipoPieza && <span className={styles.badgeTipo}>{item.tipoPieza}</span>}
                    {item.posicion && item.posicion !== "NO APLICA" && <span className={styles.badgePosicion}>{item.posicion}</span>}
                    {item.lado     && item.lado     !== "NO APLICA" && <span className={styles.badgeLado}>{item.lado}</span>}
                  </div>
                  {(item.marcasCompatibles || []).length > 0 && (
                    <div className={styles.cardBadgesRow}>
                      {(item.marcasCompatibles || []).slice(0,3).map(m => <span key={m} className={styles.badgeMarca}>{m}</span>)}
                      {(item.marcasCompatibles || []).length > 3 && <span className={styles.badgeMore}>+{(item.marcasCompatibles||[]).length - 3}</span>}
                    </div>
                  )}
                  {modResumen && <div className={styles.cardModelos}>🚗 {modResumen}</div>}
                  {(item.anioDesde || item.anioHasta) && <div className={styles.cardAnios}>Años: {item.anioDesde||"?"} — {item.anioHasta||"actual"}</div>}
                  {item.codigo    && <div className={styles.cardCodigo}>Código: {item.codigo}</div>}
                  {!esProveedor && item.proveedor && <div className={styles.cardProveedor}>📦 {item.proveedor}</div>}
                  <StockBar item={item} />
                  <div className="inv-prices">
                    <div className="inv-price-item"><span className="inv-price-lbl">{esProveedor ? "Precio neto" : "Compra neto"}</span><span className={`inv-price-val ${styles.colorGray}`}>{fmtCLP(item.precioCompra||0)}</span><span className={styles.ivaLinea}>c/IVA {fmtCLP(conIva(item.precioCompra||0))}</span></div>
                    {!esProveedor && <div className="inv-price-item"><span className="inv-price-lbl">Venta neto</span><span className={`inv-price-val ${styles.priceVenta}`}>{fmtCLP(item.precioVenta||0)}</span><span className={styles.ivaLinea}>c/IVA {fmtCLP(conIva(item.precioVenta||0))}</span></div>}
                    {!esProveedor && margen && <div className="inv-price-item"><span className="inv-price-lbl">Margen</span><span className={`inv-price-val ${styles.colorSuccess}`}>{margen}%</span></div>}
                  </div>
                  <div className={styles.cardActions}>
                    <button className="btn btn-dark btn-sm"    onClick={() => openEditar(item)}>✏ Editar</button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleAjusteStock(item)}>± Stock</button>
                    <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => handleDelete(item.id!, item.nombre)}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
      )}

      {/* Vista Tabla */}
      {vista === "tabla" && (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Tipo Pieza</th><th>Pos. / Lado</th>
                <th>Marcas / Modelos</th><th>Años</th>
                {!esProveedor && <th>Proveedor</th>}<th className="r">Disponible</th>
                <th className={`r ${styles.thReservado}`}>Reservado</th>
                <th className="r">{esProveedor ? "Precio" : "P. Venta"}</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={esProveedor ? 9 : 10} className={styles.emptyTableRow}>No hay repuestos</td></tr>}
              {paged.map(item => {
                const info       = getStockInfo(item);
                const isLow      = info.disponible <= (item.stockMinimo || 0);
                const modResumen = resumenModelos(item);
                return (
                  <tr key={item.id}>
                    <td data-label="Nombre">
                      <div className={styles.itemNombre}>{item.nombre}</div>
                      {item.codigo && <div className={styles.itemCodigo}>{item.codigo}</div>}
                      {isLow && <div className={styles.itemStockBajo}>⚠ Stock bajo</div>}
                      {item.ocultarEnTienda && (
                        <div className={styles.badgeOcultoTienda}>🚫 No se vende online</div>
                      )}
                    </td>
                    <td data-label="Tipo Pieza">
                      {item.tipoPieza ? <span className="badge badge-entregado">{item.tipoPieza}</span> : <span className={styles.dash}>—</span>}
                    </td>
                    <td data-label="Pos. / Lado" className={styles.cellPosLado}>
                      <div>{item.posicion !== "NO APLICA" ? item.posicion : "—"}</div>
                      <div className={styles.colorGray}>{item.lado !== "NO APLICA" ? item.lado : ""}</div>
                    </td>
                    <td data-label="Marcas / Modelos">
                      <div className={styles.tableMarcasRow}>
                        {(item.marcasCompatibles || []).slice(0,3).map(m => <span key={m} className={styles.badgeMarcaTable}>{m}</span>)}
                        {(item.marcasCompatibles || []).length > 3 && <span className={styles.badgeMore}>+{(item.marcasCompatibles||[]).length - 3}</span>}
                        {!(item.marcasCompatibles || []).length && <span className={styles.dash}>—</span>}
                      </div>
                      {modResumen && <div className={styles.tableModelos}>🚗 {modResumen}</div>}
                    </td>
                    <td data-label="Años" className={styles.cellAnios}>
                      {item.anioDesde || item.anioHasta ? `${item.anioDesde||"?"} — ${item.anioHasta||"actual"}` : "—"}
                    </td>
                    {!esProveedor && <td data-label="Proveedor" className="hide-mobile">{item.proveedor||"—"}</td>}
                    <td data-label="Disponible" className="r"><span className={styles.dispNum}>{info.disponible}</span></td>
                    <td data-label="Reservado" className="r td-dark hide-mobile">
                      {info.reservado > 0 ? <span className={styles.reservNum}>{info.reservado}</span> : <span className={styles.dashDark}>—</span>}
                    </td>
                    <td data-label={esProveedor ? "Precio" : "P. Venta"} className="r price-cell">{fmtCLP((esProveedor ? item.precioCompra : item.precioVenta)||0)}<div className={styles.ivaLinea}>c/IVA {fmtCLP(conIva((esProveedor ? item.precioCompra : item.precioVenta)||0))}</div></td>
                    <td data-label="Acciones">
                      <div className={styles.tableActionsCol}>
                        <button className="btn btn-dark btn-sm"    onClick={() => openEditar(item)}>✏ Editar</button>
                        <button className="btn btn-outline btn-sm" onClick={() => handleAjusteStock(item)}>± Stock</button>
                        <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => handleDelete(item.id!, item.nombre)}>✕ Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MODAL ─────────────────────────────────────────── */}
      {modal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalInventarioForm}`}>
            <div className="modal-title">{editingId ? "Editar Repuesto" : "Nuevo Repuesto"}</div>

            {/* DATOS BÁSICOS */}
            <div className="form-grid fg-2">
              <div className={`field ${styles.fullWidth}`}>
                <label>Nombre del repuesto</label>
                <input
                  value={form.nombre}
                  onChange={e => setField("nombre", e.target.value.toUpperCase())}
                  placeholder={autoNombre(form.tipoPieza, form.codigo) || "Ej: PASTILLAS DE FRENO DELANTERAS"}
                />
                <div className={styles.hintText}>Opcional: si lo dejas vacío se genera con el tipo de pieza y el código.</div>
              </div>
              <div className="field">
                <label>Código / Referencia</label>
                <input value={form.codigo} onChange={e => cambiarCodigoOTipo("codigo", e.target.value.toUpperCase())} placeholder="UJ1680" />
              </div>
              <div className="field">
                <label>Marca del Repuesto</label>
                <select value={form.fabricante} onChange={e => setField("fabricante", e.target.value)}>
                  <option value="">— Seleccionar —</option>
                  {fabricantesList.map((f,i) => <option key={f.id||i} value={f.nombre.toUpperCase()}>{f.nombre.toUpperCase()}</option>)}
                </select>
                <div className={styles.addRow}>
                  <input value={fabricanteCustom} onChange={e => setFabricanteCustom(e.target.value.toUpperCase())} onKeyDown={e => e.key==="Enter" && agregarFabricante()} placeholder="+ Nueva marca..." className={styles.addInput} />
                  <button type="button" className="btn btn-dark btn-sm" onClick={agregarFabricante} disabled={guardandoFabricante||!fabricanteCustom.trim()}>{guardandoFabricante?"...":"+"}</button>
                </div>
              </div>
              <div className="field">
                <label>Origen</label>
                <input
                  list="origenes-repuesto"
                  value={form.origen || ""}
                  onChange={e => setField("origen", e.target.value.toUpperCase())}
                  placeholder="Ej: JAPÓN, CHINA, ALEMANIA"
                />
                <datalist id="origenes-repuesto">
                  {ORIGENES_REPUESTO.map(o => <option key={o} value={o} />)}
                </datalist>
              </div>
              <div className="field">
                <label>Categoría *</label>
                <select value={form.categoria} onChange={e => setField("categoria", e.target.value)}>
                  {allCategorias.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                </select>
                {esProveedor && <AvisoContacto que="tu categoría" />}
                {!esProveedor && <div className={styles.addRow}>
                  <input value={categoriaCustom} onChange={e => setCategoriaCustom(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && agregarCategoria()} placeholder="+ Nueva categoría..." className={styles.addInput} />
                  <button type="button" className="btn btn-dark btn-sm" onClick={agregarCategoria} disabled={guardandoCategoria || !categoriaCustom.trim()}>{guardandoCategoria ? "..." : "+"}</button>
                </div>}
                {!esProveedor && categoriasList.length > 0 && (
                  <div className={`${styles.chipsRow} ${styles.chipsRowMt}`}>
                    {categoriasList.map(c => (
                      <span key={c.id} className={styles.chipEquivalencia}>
                        {c.nombre}
                        <button type="button" onClick={() => eliminarCategoria(c.id!, c.nombre)} className={styles.chipRemove} title="Eliminar categoría">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* DESCRIPCIÓN */}
              <div className={`field ${styles.fullWidth}`}>
                <label>Descripción</label>
                <textarea
                  className={styles.textareaDescripcion}
                  value={form.descripcion || ""}
                  onChange={e => setField("descripcion", e.target.value.toUpperCase())}
                  placeholder="Detalles del repuesto: medidas, material, aplicación, observaciones..."
                />
              </div>

              {/* EQUIVALENCIAS */}
              <div className={`field ${styles.fullWidth}`}>
                <label>Códigos Equivalentes por Marca</label>
                <div className={styles.hintText}>Agrega una marca y sus códigos equivalentes</div>
                <div className={styles.eqAddRow}>
                  <select value={eqFabricanteNuevo} onChange={e => setEqFabricanteNuevo(e.target.value)} className={styles.eqFabricanteSelect}>
                    <option value="">— Seleccionar marca —</option>
                    {fabricantesList.filter(f => !eqPanel.includes(f.nombre.toUpperCase())).map((f, i) => (
                      <option key={f.id || i} value={f.nombre.toUpperCase()}>{f.nombre.toUpperCase()}</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-dark btn-sm" disabled={!eqFabricanteNuevo} onClick={() => agregarFabricanteEq(eqFabricanteNuevo)}>+ Agregar marca</button>
                </div>
                {eqPanel.length > 0 && (
                  <div className={styles.expPanelWrap}>
                    {eqPanel.map(fab => {
                      const codigosFab = (form.equivalencias || []).filter(e => e.fabricante === fab).map(e => e.codigo);
                      const expandido  = eqExpandidos[fab] ?? true;
                      return (
                        <div key={fab} className={styles.expCard}>
                          <div className={styles.expCardHeader}
                            onClick={() => setEqExpandidos(prev => ({ ...prev, [fab]: !expandido }))}>
                            <div className={styles.expCardHeaderLeft}>
                              <span className={styles.expCardTitle}>{fab}</span>
                              {codigosFab.length > 0
                                ? <span className={styles.expCardCount}>{codigosFab.length} código(s)</span>
                                : <span className={styles.expCardEmpty}>sin códigos aún</span>}
                            </div>
                            <div className={styles.expCardHeaderRight}>
                              <span className={styles.expCardArrow}>{expandido ? '▲' : '▼'}</span>
                              <span onClick={e => { e.stopPropagation(); quitarFabricanteEq(fab); }} className={styles.expCardRemove} title="Quitar marca">✕</span>
                            </div>
                          </div>
                          {expandido && (
                            <div className={styles.expCardBody}>
                              {codigosFab.length > 0 && (
                                <div className={styles.expChipsRow}>
                                  {codigosFab.map(cod => (
                                    <span key={cod} className={styles.expChip}>
                                      {cod}
                                      <span onClick={() => quitarCodigoEq(fab, cod)} className={styles.expChipRemove}>×</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className={styles.expAddRow}>
                                <input value={eqInputs[fab] || ""} onChange={e => setEqInputs(prev => ({ ...prev, [fab]: e.target.value.toUpperCase() }))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); agregarCodigoEq(fab); } }} placeholder={`Código ${fab} (ej: W610/82)`} className={styles.expAddInput} />
                                <button type="button" className="btn btn-dark btn-sm" onClick={() => agregarCodigoEq(fab)} disabled={!(eqInputs[fab]||"").trim()}>+ Código</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!esProveedor && (
                <div className={`field ${styles.fullWidth}`}>
                  <label>Proveedor</label>
                  <select value={form.proveedor} onChange={e => setField("proveedor", e.target.value)}>
                    <option value="">— Sin proveedor —</option>
                    {proveedoresList.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="modal-sep" />

            {/* CLASIFICACIÓN */}
            <div className={styles.sectionTitle}><span className={styles.sectionTitleBar} />Clasificación de la Pieza</div>
            <div className={`field ${styles.mb08}`}>
              <label>Tipo de Pieza</label>
              <select value={form.tipoPieza} onChange={e => cambiarCodigoOTipo("tipoPieza", e.target.value)}>
                <option value="">— Seleccionar tipo —</option>
                {allTipos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {esProveedor && <AvisoContacto que="tu tipo de pieza" />}
            {!esProveedor && <div className={styles.customAddRow}>
              <input type="text" value={tipoCustom} onChange={e => setTipoCustom(e.target.value.toUpperCase())} onKeyDown={e => e.key==="Enter" && agregarTipoCustom()} placeholder="Agregar tipo no listado..." className={styles.flexInput} />
              <button className="btn btn-dark btn-sm" onClick={agregarTipoCustom} disabled={!tipoCustom.trim()||guardandoTipo}>{guardandoTipo?"...":"+ Agregar"}</button>
            </div>}
            <div className={`form-grid fg-2 ${styles.mb1}`}>
              <div className="field">
                <label>Posición</label>
                <select value={form.posicion} onChange={e => setField("posicion", e.target.value as PosicionPieza)}>
                  {POSICIONES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Lado</label>
                <select value={form.lado} onChange={e => setField("lado", e.target.value as LadoPieza)}>
                  {LADOS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="modal-sep" />

            {/* COMPATIBILIDAD */}
            <div className={styles.sectionTitle}><span className={styles.sectionTitleBar} />Compatibilidad de Vehículos</div>
            <div className={styles.subLabel}>Marcas Compatibles</div>
            <div className={styles.marcasGrid}>
              {allMarcasVehiculo.map(m => {
                const selected = (form.marcasCompatibles||[]).includes(m);
                return (
                  <button key={m} onClick={() => toggleMarca(m)} className={`${styles.marcaToggle} ${selected ? styles.marcaToggleActive : ""}`}>
                    {selected ? "✓ " : ""}{m}
                  </button>
                );
              })}
            </div>
            {marcasExtra.length > 0 && (
              <div className={styles.marcasExtraRow}>
                {marcasExtra.map(m => (
                  <span key={m} className={styles.chipMarcaExtra}>{m}
                    <span className={styles.chipRemoveExtra} onClick={() => setMarcasExtra(marcasExtra.filter(x => x !== m))}>✕</span>
                  </span>
                ))}
              </div>
            )}
            {esProveedor && <AvisoContacto que="la marca de vehículo" />}
            {!esProveedor && <div className={styles.customAddRow}>
              <input type="text" value={marcaCustom} onChange={e => setMarcaCustom(e.target.value.toUpperCase())} onKeyDown={e => e.key==="Enter" && agregarMarcaCustom()} placeholder="Agregar marca no listada..." className={styles.flexInput} />
              <button className="btn btn-dark btn-sm" onClick={agregarMarcaCustom} disabled={!marcaCustom.trim() || guardandoMarca}>{guardandoMarca ? "Guardando..." : "+ Agregar"}</button>
            </div>}

            {/* MODELOS POR MARCA */}
            {todasMarcasSeleccionadas.length > 0 && (
              <div className={styles.modelosSectionWrap}>
                <div className={styles.subLabel}>Modelos Compatibles <span className={styles.modelosOptionalLabel}>(opcional)</span></div>
                {todasMarcasSeleccionadas.map(marca => {
                  const modelosMarca = (form.modelosCompatibles || {})[marca] || [];
                  const sugerencias  = MODELOS_POR_MARCA[marca] || [];
                  const expandida    = marcasExpandidas[marca] ?? false;
                  return (
                    <div key={marca} className={`${styles.expCard} ${styles.expCardMb}`}>
                      <div onClick={() => setMarcasExpandidas(prev => ({ ...prev, [marca]: !expandida }))} className={styles.expCardHeader}>
                        <div className={styles.expCardHeaderLeft}>
                          <span className={styles.expCardTitle}>{marca}</span>
                          {modelosMarca.length > 0
                            ? <span className={styles.expCardCount}>{modelosMarca.length} modelo(s)</span>
                            : <span className={styles.expCardEmpty}>todos los modelos</span>}
                        </div>
                        <span className={styles.expCardArrow}>{expandida ? '▲' : '▼'}</span>
                      </div>
                      {expandida && (
                        <div className={styles.expCardBody}>
                          {modelosMarca.length > 0 && (
                            <div className={styles.expChipsRow}>
                              {modelosMarca.map(mod => (
                                <span key={mod} className={styles.expChip}>
                                  {mod}
                                  <span onClick={() => quitarModelo(marca, mod)} className={styles.expChipRemove}>×</span>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className={styles.expAddRow}>
                            <div className={styles.expAddInputWrap}>
                              <input list={`modelos-${marca}`} value={modeloInputs[marca] || ""} onChange={e => setModeloInputs(prev => ({ ...prev, [marca]: e.target.value.toUpperCase() }))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); agregarModelo(marca); } }} placeholder={sugerencias.length > 0 ? `Ej: ${sugerencias[0]}` : "Escribe el modelo..."} className={styles.expAddInput} />
                              <datalist id={`modelos-${marca}`}>
                                {sugerencias.filter(s => !modelosMarca.includes(s)).map(s => <option key={s} value={s} />)}
                              </datalist>
                            </div>
                            <button type="button" className="btn btn-dark btn-sm" onClick={() => agregarModelo(marca)} disabled={!(modeloInputs[marca]||"").trim()}>+ Agregar</button>
                          </div>
                          {sugerencias.length > 0 && (
                            <div className={styles.sugerenciasRow}>
                              {sugerencias.filter(s => !modelosMarca.includes(s)).slice(0, 8).map(s => (
                                <button key={s} type="button"
                                  onClick={() => { const actuales = (form.modelosCompatibles||{})[marca]||[]; if (!actuales.includes(s)) setForm(prev => ({...prev, modelosCompatibles: {...prev.modelosCompatibles, [marca]: [...actuales, s]}})); }}
                                  className={styles.sugerenciaBtn}>
                                  + {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Años */}
            <div className={`form-grid fg-2 ${styles.mb1} ${styles.aniosGridMt}`}>
              <div className="field"><label>Año Desde</label><input type="number" value={form.anioDesde||""} onChange={e => setField("anioDesde", e.target.value ? parseInt(e.target.value) : null)} placeholder="Ej: 2015" /></div>
              <div className="field"><label>Año Hasta</label><input type="number" value={form.anioHasta||""} onChange={e => setField("anioHasta", e.target.value ? parseInt(e.target.value) : null)} placeholder="Ej: 2022" /></div>
            </div>

            {/* Resumen compatibilidad */}
            {todasMarcasSeleccionadas.length > 0 && (
              <div className={styles.resumenBox}>
                <strong className={styles.resumenStrong}>{todasMarcasSeleccionadas.length} marca(s):</strong>{" "}
                {todasMarcasSeleccionadas.join(", ")}
                {(form.anioDesde || form.anioHasta) && <span className={styles.resumenAnios}> · Años: {form.anioDesde||"?"} — {form.anioHasta||"actual"}</span>}
                {Object.entries(form.modelosCompatibles||{}).filter(([,v])=>v.length>0).length > 0 && (
                  <div className={styles.resumenModelosDetail}>
                    {Object.entries(form.modelosCompatibles||{}).filter(([,v])=>v.length>0).map(([marca,modelos]) => (
                      <span key={marca} className={styles.resumenModelosMarca}><strong>{marca}:</strong> {modelos.join(', ')}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="modal-sep" />

            {/* PRECIOS Y STOCK */}
            <div className={styles.sectionTitle}><span className={styles.sectionTitleBar} />Precios y Stock</div>
            <div className="form-grid fg-2">
              {!esProveedor && (
                <div className="field">
                  <label>Precio Importación (costo proveedor)</label>
                  <input type="number" min={0} value={form.precioImportacion || ""} onChange={e => setField("precioImportacion", parseInt(e.target.value) || 0)} placeholder="0" />
                </div>
              )}
              <div className="field">
                <label>{esProveedor ? "Precio Lista neto (tu catálogo)" : "Precio Lista neto (catálogo proveedor)"}</label>
                <input type="number" min={0} value={form.precioLista || ""}
                  onChange={e => {
                    const lista = parseInt(e.target.value) || 0;
                    const dto   = form.descuentoTaller || 0;
                    const neto  = Math.round(lista * (1 - dto / 100));
                    setForm(prev => ({ ...prev, precioLista: lista, precioCompra: neto, precioVenta: Math.round(neto * 1.3) }));
                  }}
                  placeholder="0"
                />
                <div className={styles.hintText}>Neto · con IVA: {fmtCLP(conIva(form.precioLista || 0))}</div>
              </div>
              <div className="field">
                <label>{esProveedor ? "Descuento para el Taller %" : "Descuento Taller %"}</label>
                <input type="number" min={0} max={100} value={form.descuentoTaller || ""}
                  onChange={e => {
                    const dto   = parseFloat(e.target.value) || 0;
                    const lista = form.precioLista || 0;
                    const neto  = Math.round(lista * (1 - dto / 100));
                    setForm(prev => ({ ...prev, descuentoTaller: dto, precioCompra: neto, precioVenta: Math.round(neto * 1.3) }));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label>{esProveedor ? "Precio neto para el Taller (calculado)" : "Precio Compra Neto (calculado)"}</label>
                <input type="number" min={0} value={form.precioCompra || ""}
                  onChange={e => setForm(prev => ({ ...prev, precioCompra: parseInt(e.target.value) || 0, precioVenta: Math.round((parseInt(e.target.value) || 0) * 1.3) }))}
                  placeholder="0"
                  className={styles.precioCompraCalculado}
                />
                <div className={styles.hintText}>Neto · con IVA: {fmtCLP(conIva(form.precioCompra))}</div>
              </div>
              {!esProveedor && (
                <div className="field">
                  <label>Precio Venta neto (cliente)</label>
                  <input type="number" min={0} value={form.precioVenta || ""} onChange={e => setField("precioVenta", parseInt(e.target.value) || 0)} placeholder="0" />
                  <div className={styles.hintText}>Neto · con IVA: {fmtCLP(conIva(form.precioVenta))}</div>
                </div>
              )}
              <div className="field">
                <label>Stock Actual *</label>
                <input type="number" value={form.stock} min={0} onChange={e => setField("stock", parseInt(e.target.value)||0)} />
              </div>
              <div className="field">
                <label>Stock Mínimo (alerta)</label>
                <input type="number" value={form.stockMinimo} min={0} onChange={e => setField("stockMinimo", parseInt(e.target.value)||0)} />
              </div>
              <div className="field">
                <label>Unidad</label>
                <select value={form.unidad} onChange={e => setField("unidad", e.target.value.toUpperCase())}>
                  <option value="UNIDAD">UNIDAD</option>
                  <option value="PAR">PAR</option>
                  <option value="SET">SET</option>
                  <option value="LITRO">LITRO</option>
                  <option value="KG">KG</option>
                  <option value="METRO">METRO</option>
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: ".9rem" }}>
              <label>Imagen (URL) — se usa solo al publicar el producto por primera vez</label>
              <input
                type="text"
                value={form.imagenUrl || ""}
                onChange={e => setField("imagenUrl", e.target.value)}
                placeholder="https://storage.googleapis.com/media-drmotors-cl/img/..."
              />
            </div>

            {!esProveedor && <div
              className={styles.ocultarTiendaRow}
              onClick={() => setField("ocultarEnTienda", !form.ocultarEnTienda)}
            >
              <input
                type="checkbox"
                checked={!!form.ocultarEnTienda}
                onChange={e => setField("ocultarEnTienda", e.target.checked)}
              />
              <div>
                <div className={styles.ocultarTiendaLabel}>No vender online</div>
                <div className={styles.ocultarTiendaHint}>
                  Sigue disponible para cotizaciones y OT, pero nunca se publica ni se sincroniza con la tienda WooCommerce.
                </div>
              </div>
            </div>}

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR EXCEL */}
      {modalExcel && (
        <ImportarExcelModal
          inventarioActual={inventario}
          onClose={() => setModalExcel(false)}
          onSuccess={() => { setModalExcel(false); loadInventario(); }}
        />
      )}

      {/* MODAL INGRESO RÁPIDO CON PISTOLA */}
      {modalPistola && (
        <IngresoRapidoModal
          onCerrar={() => setModalPistola(false)}
          onItemGuardado={() => loadInventario()}
          modo="admin"
        />
      )}
    </div>
  );
}