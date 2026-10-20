import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { serviciosPredefinidosService } from "../../services/serviciosPredefinidos";
import type { ServicioPredefinido } from "../../services/serviciosPredefinidos";
import { materialesPredefinidosService } from "../../services/materialesPredefinidos";
import type { MaterialPredefinido } from "../../types";
import { useNavigate } from "react-router-dom";
import { fabricantesService } from "../../services/fabricantes";
import type { Fabricante } from "../../services/fabricantes";
import { tiposPiezaService } from "../../services/tiposPieza";
import type { TipoPieza } from "../../services/tiposPieza";
import { categoriasService } from "../../services/categorias";
import type { Categoria } from "../../services/categorias";
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { CATEGORIAS_DEFAULT, TIPOS_PIEZA_DEFAULT } from "../../types";
import styles from './Configuracion.module.css';

const fmtCLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

const emptyServicio = (): Omit<ServicioPredefinido, "id"> => ({
  nombre: "",
  precioAuto: 0,
  precioSUV: 0,
  precioCamioneta: 0,
  detalle: "",
});

export default function Configuracion() {
  const { setLoading, notify } = useAppStore();
  const navigate = useNavigate();

  // ─── FABRICANTES ──────────────────────────────────────────
  const [fabricantes, setFabricantes] = useState<Fabricante[]>([]);
  const [nuevoFab, setNuevoFab]       = useState("");
  const [searchFab, setSearchFab]     = useState("");

  // ─── CATEGORÍAS ───────────────────────────────────────────
  const [categorias, setCategorias]   = useState<Categoria[]>([]);
  const [nuevaCat, setNuevaCat]       = useState("");
  const [searchCat, setSearchCat]     = useState("");

  // ─── TIPOS DE PIEZA ───────────────────────────────────────
  const [tiposPieza, setTiposPieza]   = useState<TipoPieza[]>([]);
  const [nuevoTipo, setNuevoTipo]     = useState("");
  const [searchTip, setSearchTip]     = useState("");

  // ─── MATERIALES PREDEFINIDOS ──────────────────────────────────
  const [materiales, setMateriales]   = useState<MaterialPredefinido[]>([]);
  const [nuevoMat,   setNuevoMat]     = useState("");
  const [nuevoMatUnidad, setNuevoMatUnidad] = useState("UNIDAD");
  const [searchMat, setSearchMat]     = useState("");
  const materialesFiltrados = materiales.filter(m => m.nombre.toLowerCase().includes(searchMat.toLowerCase()));
  const { paged: pagedMat, page: pageMat, pageSize: sizeMat, totalPages: totalPagesMat, goTo: goToMat, changeSize: changeSizeMat } = usePagination(materialesFiltrados);

  // ─── SERVICIOS PREDEFINIDOS ───────────────────────────────
  const [servicios, setServicios]     = useState<ServicioPredefinido[]>([]);
  const [modalSvc, setModalSvc]       = useState(false);
  const [editingSvc, setEditingSvc]   = useState<string | null>(null);
  const [formSvc,    setFormSvc]       = useState<Omit<ServicioPredefinido, "id">>(emptyServicio());
  const [searchSvc, setSearchSvc]     = useState("");

  // Listas filtradas por búsqueda
  const serviciosFiltrados = servicios.filter(s => s.nombre.toLowerCase().includes(searchSvc.toLowerCase()));
  const categoriasCustomFiltradas  = categorias.filter(c => c.nombre.toLowerCase().includes(searchCat.toLowerCase()));
  const categoriasDefaultFiltradas = CATEGORIAS_DEFAULT.filter(n => n.toLowerCase().includes(searchCat.toLowerCase()));
  const tiposCustomFiltrados       = tiposPieza.filter(t => t.nombre.toLowerCase().includes(searchTip.toLowerCase()));
  const tiposDefaultFiltrados      = TIPOS_PIEZA_DEFAULT.filter(n => n.toLowerCase().includes(searchTip.toLowerCase()));
  const fabricantesFiltrados       = fabricantes.filter(f => f.nombre.toLowerCase().includes(searchFab.toLowerCase()));

  // Paginaciones
  const { paged: pagedSvc, page: pageSvc, pageSize: sizeSvc, totalPages: totalPagesSvc, goTo: goToSvc, changeSize: changeSizeSvc } = usePagination(serviciosFiltrados);
  const { paged: pagedFab, page: pageFab, pageSize: sizeFab, totalPages: totalPagesFab, goTo: goToFab, changeSize: changeSizeFab } = usePagination(fabricantesFiltrados);
  const { paged: pagedCat, page: pageCat, pageSize: sizeCat, totalPages: totalPagesCat, goTo: goToCat, changeSize: changeSizeCat } = usePagination(categoriasCustomFiltradas);
  const { paged: pagedTip, page: pageTip, pageSize: sizeTip, totalPages: totalPagesTip, goTo: goToTip, changeSize: changeSizeTip } = usePagination(tiposCustomFiltrados);

  useEffect(() => {
    loadServicios();
    loadFabricantes();
    loadCategorias();
    loadTiposPieza();
    loadMateriales();
  }, []);

  // ─── FABRICANTES ──────────────────────────────────────────
  const loadFabricantes = async () => {
    try {
      const res = await fabricantesService.getAll();
      if (res.success && res.data) setFabricantes(res.data);
    } catch { notify("Error al cargar fabricantes", "error"); }
  };

  const agregarFabricante = async () => {
    const nombre = nuevoFab.trim();
    if (!nombre) return;
    setLoading(true);
    try {
      await fabricantesService.create(nombre);
      notify(`Fabricante "${nombre}" agregado ✓`, "success");
      setNuevoFab("");
      loadFabricantes();
    } catch { notify("Error al guardar", "error"); }
    finally { setLoading(false); }
  };

  const eliminarFabricante = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return;
    setLoading(true);
    try {
      await fabricantesService.delete(id);
      notify("Fabricante eliminado", "info");
      loadFabricantes();
    } catch { notify("Error al eliminar", "error"); }
    finally { setLoading(false); }
  };

  // ─── CATEGORÍAS ───────────────────────────────────────────
  const loadCategorias = async () => {
    try {
      const res = await categoriasService.getAll();
      if (res.success && res.data) setCategorias(res.data);
    } catch { notify("Error al cargar categorías", "error"); }
  };

  const agregarCategoria = async () => {
    const nombre = nuevaCat.trim().toUpperCase();
    if (!nombre) return;
    setLoading(true);
    try {
      await categoriasService.create(nombre);
      notify(`Categoría "${nombre}" agregada ✓`, "success");
      setNuevaCat("");
      loadCategorias();
    } catch { notify("Error al guardar", "error"); }
    finally { setLoading(false); }
  };

  const eliminarCategoria = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la categoría "${nombre}"?`)) return;
    setLoading(true);
    try {
      await categoriasService.delete(id);
      notify(`Categoría "${nombre}" eliminada`, "info");
      loadCategorias();
    } catch { notify("Error al eliminar", "error"); }
    finally { setLoading(false); }
  };

  // ─── TIPOS DE PIEZA ───────────────────────────────────────
  const loadTiposPieza = async () => {
    try {
      const res = await tiposPiezaService.getAll();
      if (res.success && res.data) setTiposPieza(res.data);
    } catch { notify("Error al cargar tipos de pieza", "error"); }
  };

  const agregarTipo = async () => {
    const nombre = nuevoTipo.trim().toUpperCase();
    if (!nombre) return;
    setLoading(true);
    try {
      await tiposPiezaService.create(nombre);
      notify(`Tipo "${nombre}" agregado ✓`, "success");
      setNuevoTipo("");
      loadTiposPieza();
    } catch { notify("Error al guardar", "error"); }
    finally { setLoading(false); }
  };

  const eliminarTipo = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el tipo "${nombre}"?`)) return;
    setLoading(true);
    try {
      await tiposPiezaService.delete(id);
      notify(`Tipo "${nombre}" eliminado`, "info");
      loadTiposPieza();
    } catch { notify("Error al eliminar", "error"); }
    finally { setLoading(false); }
  };

  // ─── MATERIALES ──────────────────────────────────────────────
  const loadMateriales = async () => {
    try { const r = await materialesPredefinidosService.getAll(); if (r.success && r.data) setMateriales(r.data); } catch {}
  };

  const agregarMaterial = async () => {
    const nombre = nuevoMat.trim().toUpperCase();
    if (!nombre) return;
    setLoading(true);
    try {
      await materialesPredefinidosService.create({ nombre, unidad: nuevoMatUnidad });
      notify(`Material "${nombre}" agregado ✓`, "success");
      setNuevoMat(""); setNuevoMatUnidad("UNIDAD");
      loadMateriales();
    } catch { notify("Error al guardar", "error"); }
    finally { setLoading(false); }
  };

  const eliminarMaterial = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return;
    setLoading(true);
    try { await materialesPredefinidosService.delete(id); notify("Material eliminado", "info"); loadMateriales(); }
    catch { notify("Error al eliminar", "error"); }
    finally { setLoading(false); }
  };

  // ─── SERVICIOS ────────────────────────────────────────────
  const loadServicios = async () => {
    try {
      const res = await serviciosPredefinidosService.getAll();
      if (res.success && res.data) setServicios(res.data);
    } catch { notify("Error al cargar servicios", "error"); }
  };

  const openNuevoSvc = () => { setEditingSvc(null); setFormSvc(emptyServicio()); setModalSvc(true); };

  const openEditarSvc = (s: ServicioPredefinido) => {
    setEditingSvc(s.id!);
    setFormSvc({ nombre: s.nombre, precioAuto: s.precioAuto || 0, precioSUV: s.precioSUV || 0, precioCamioneta: s.precioCamioneta || 0, detalle: s.detalle || '' });
    setModalSvc(true);
  };

  const handleSaveSvc = async () => {
    if (!formSvc.nombre) { notify("Ingresa el nombre del servicio", "error"); return; }
    setLoading(true);
    try {
      if (editingSvc) { await serviciosPredefinidosService.update(editingSvc, formSvc); notify("Servicio actualizado ✓", "success"); }
      else            { await serviciosPredefinidosService.create(formSvc);             notify("Servicio agregado ✓", "success"); }
      setModalSvc(false); loadServicios();
    } catch { notify("Error al guardar", "error"); }
    finally { setLoading(false); }
  };

  const handleDeleteSvc = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el servicio "${nombre}"?`)) return;
    setLoading(true);
    try { await serviciosPredefinidosService.delete(id); notify("Servicio eliminado", "info"); loadServicios(); }
    catch { notify("Error al eliminar", "error"); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Configuración <span>Sistema</span></div>
        <button className="btn btn-outline" onClick={() => navigate("/trabajadores")}>
          👥 Gestionar Trabajadores
        </button>
      </div>

      {/* ── SERVICIOS Y TARIFAS ──────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Servicios y Tarifas</div>
        <div className={styles.sectionSubtitle}>
          {servicios.length} servicio(s) predefinido(s) · Los precios se autocargan según tipo de vehículo
        </div>

        <div className={styles.controlsRow}>
          <button className="btn btn-primary" onClick={openNuevoSvc}>+ Nuevo Servicio</button>
          <input
            type="text"
            placeholder="🔍 Buscar servicio..."
            value={searchSvc}
            onChange={e => setSearchSvc(e.target.value)}
            className={styles.searchInputSm}
          />
        </div>

        <Pagination page={pageSvc} totalPages={totalPagesSvc} totalItems={serviciosFiltrados.length} pageSize={sizeSvc} onPage={goToSvc} onPageSize={changeSizeSvc} />
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Servicio / Mano de Obra</th>
                <th className="r">Liviano</th>
                <th className="r">Mediano</th>
                <th className="r">Pesado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {serviciosFiltrados.length === 0 && (
                <tr><td colSpan={5} className={styles.emptyRow}>
                  {searchSvc ? "Sin resultados para tu búsqueda" : "No hay servicios predefinidos"}
                </td></tr>
              )}
              {pagedSvc.map(s => (
                <tr key={s.id}>
                  <td data-label="Servicio / Mano de Obra" className={styles.cellBold}>{s.nombre}</td>
                  <td data-label="Liviano"   className="r price-cell">{fmtCLP(s.precioAuto || 0)}</td>
                  <td data-label="Mediano"   className="r price-cell">{fmtCLP(s.precioSUV || 0)}</td>
                  <td data-label="Pesado"    className="r price-cell">{fmtCLP(s.precioCamioneta || 0)}</td>
                  <td data-label="Acciones">
                    <div className={styles.accionesRow}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEditarSvc(s)}>✏ Editar</button>
                      <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => handleDeleteSvc(s.id!, s.nombre)}>✕ Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL SERVICIO ───────────────────────────────── */}
      {modalSvc && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">{editingSvc ? "Editar Servicio" : "Nuevo Servicio"}</div>
            <div className={styles.infoBanner}>Los precios son de mano de obra. El costo de repuestos se agrega desde el inventario.</div>
            <div className={`field ${styles.mb1}`}>
              <label>Nombre del Servicio *</label>
              <input value={formSvc.nombre} onChange={e => setFormSvc(p => ({...p, nombre: e.target.value.toUpperCase()}))} placeholder="EJ: CAMBIO DE PASTILLAS DELANTERAS" autoFocus />
            </div>
            <div className="form-grid fg-3">
              <div className="field">
                <label>Liviano (Auto, Station Wagon)</label>
                <input type="number" value={formSvc.precioAuto} onChange={e => setFormSvc(p => ({...p, precioAuto: parseInt(e.target.value)||0}))} />
              </div>
              <div className="field">
                <label>Mediano (SUV, Pick-Up, Van)</label>
                <input type="number" value={formSvc.precioSUV} onChange={e => setFormSvc(p => ({...p, precioSUV: parseInt(e.target.value)||0}))} />
              </div>
              <div className="field">
                <label>Pesado (Camioneta, Furgón, Bus)</label>
                <input type="number" value={formSvc.precioCamioneta} onChange={e => setFormSvc(p => ({...p, precioCamioneta: parseInt(e.target.value)||0}))} />
              </div>
            </div>
            <div className={`field ${styles.mb1} ${styles.mt1}`}>
              <label>Descripción Técnica (se autocompleta en cotizaciones)</label>
              <textarea
                value={formSvc.detalle}
                onChange={e => setFormSvc(p => ({...p, detalle: e.target.value}))}
                rows={5}
                placeholder="Ej: Se realiza el vaciado térmico del lubricante usado mediante la remoción del tapón del cárter..."
                className={styles.textareaFull}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModalSvc(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveSvc}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORÍAS DE INVENTARIO ─────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Categorías de Inventario</div>
        <div className={styles.sectionSubtitle}>
          Categorías usadas para clasificar repuestos e insumos · Las predeterminadas no se pueden eliminar
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.addFabricanteRow}>
            <input
              value={nuevaCat}
              onChange={e => setNuevaCat(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && agregarCategoria()}
              placeholder="Nueva categoría (ej: CLIMATIZACIÓN, CARROCERÍA...)"
              className={styles.flexInput}
            />
            <button className="btn btn-primary" onClick={agregarCategoria} disabled={!nuevaCat.trim()}>
              + Agregar
            </button>
          </div>
          <input
            type="text"
            placeholder="🔍 Buscar categoría..."
            value={searchCat}
            onChange={e => setSearchCat(e.target.value)}
            className={styles.searchInputSm}
          />
        </div>

        <Pagination page={pageCat} totalPages={totalPagesCat} totalItems={categoriasCustomFiltradas.length} pageSize={sizeCat} onPage={goToCat} onPageSize={changeSizeCat} />
        <div className={`tbl-wrap ${styles.mb1}`}>
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Tipo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categoriasDefaultFiltradas.length === 0 && categoriasCustomFiltradas.length === 0 && (
                <tr><td colSpan={3} className={styles.emptyRow}>Sin resultados para tu búsqueda</td></tr>
              )}
              {/* Predeterminadas — no se eliminan */}
              {categoriasDefaultFiltradas.map(nombre => (
                <tr key={nombre}>
                  <td data-label="Categoría" className={styles.cellBold}>{nombre}</td>
                  <td data-label="Tipo"><span className={styles.badgeDefault}>Predeterminada</span></td>
                  <td data-label="Acciones"><span className={styles.noAction}>—</span></td>
                </tr>
              ))}
              {/* Custom */}
              {pagedCat.map(c => (
                <tr key={c.id}>
                  <td data-label="Categoría" className={styles.cellBold}>{c.nombre}</td>
                  <td data-label="Tipo"><span className={styles.badgeCustom}>Personalizada</span></td>
                  <td data-label="Acciones">
                    <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => eliminarCategoria(c.id!, c.nombre)}>
                      ✕ Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── TIPOS DE PIEZA ───────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Tipos de Pieza</div>
        <div className={styles.sectionSubtitle}>
          Tipos usados para clasificar piezas en el inventario · Los predeterminados no se pueden eliminar
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.addFabricanteRow}>
            <input
              value={nuevoTipo}
              onChange={e => setNuevoTipo(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && agregarTipo()}
              placeholder="Nuevo tipo (ej: SENSOR DE OXÍGENO, VÁLVULA EGR...)"
              className={styles.flexInput}
            />
            <button className="btn btn-primary" onClick={agregarTipo} disabled={!nuevoTipo.trim()}>
              + Agregar
            </button>
          </div>
          <input
            type="text"
            placeholder="🔍 Buscar tipo de pieza..."
            value={searchTip}
            onChange={e => setSearchTip(e.target.value)}
            className={styles.searchInputSm}
          />
        </div>

        <Pagination page={pageTip} totalPages={totalPagesTip} totalItems={tiposCustomFiltrados.length} pageSize={sizeTip} onPage={goToTip} onPageSize={changeSizeTip} />
        <div className={`tbl-wrap ${styles.mb1}`}>
          <table>
            <thead>
              <tr>
                <th>Tipo de Pieza</th>
                <th>Tipo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tiposDefaultFiltrados.length === 0 && tiposCustomFiltrados.length === 0 && (
                <tr><td colSpan={3} className={styles.emptyRow}>Sin resultados para tu búsqueda</td></tr>
              )}
              {/* Predeterminados — no se eliminan */}
              {tiposDefaultFiltrados.map(nombre => (
                <tr key={nombre}>
                  <td data-label="Tipo de Pieza" className={styles.cellBold}>{nombre}</td>
                  <td data-label="Tipo"><span className={styles.badgeDefault}>Predeterminado</span></td>
                  <td data-label="Acciones"><span className={styles.noAction}>—</span></td>
                </tr>
              ))}
              {/* Custom */}
              {pagedTip.map(t => (
                <tr key={t.id}>
                  <td data-label="Tipo de Pieza" className={styles.cellBold}>{t.nombre}</td>
                  <td data-label="Tipo"><span className={styles.badgeCustom}>Personalizado</span></td>
                  <td data-label="Acciones">
                    <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => eliminarTipo(t.id!, t.nombre)}>
                      ✕ Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MATERIALES / REPUESTOS PREDEFINIDOS ────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Materiales y Repuestos Externos</div>
        <div className={styles.sectionSubtitle}>
          Items frecuentes de proveedor (filtros, pastillas, etc.) — se usan en cotizaciones sin inventario
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.addMaterialRow}>
            <div className={`field ${styles.flexGrow2}`}>
              <label>Nombre del material</label>
              <input
                value={nuevoMat}
                onChange={e => setNuevoMat(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && agregarMaterial()}
                placeholder="Ej: PASTILLAS DE FRENO DELANTERAS"
              />
            </div>
            <div className={`field ${styles.flexGrow1}`}>
              <label>Unidad</label>
              <select value={nuevoMatUnidad} onChange={e => setNuevoMatUnidad(e.target.value)}>
                <option value="UNIDAD">UNIDAD</option>
                <option value="PAR">PAR</option>
                <option value="SET">SET</option>
                <option value="LITRO">LITRO</option>
                <option value="KG">KG</option>
                <option value="METRO">METRO</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={agregarMaterial} disabled={!nuevoMat.trim()}>
              + Agregar
            </button>
          </div>
          <input
            type="text"
            placeholder="🔍 Buscar material..."
            value={searchMat}
            onChange={e => setSearchMat(e.target.value)}
            className={styles.searchInputSm}
          />
        </div>

        <Pagination page={pageMat} totalPages={totalPagesMat} totalItems={materialesFiltrados.length} pageSize={sizeMat} onPage={goToMat} onPageSize={changeSizeMat} />
        <div className={`tbl-wrap ${styles.mb1}`}>
          <table>
            <thead>
              <tr>
                <th>Material / Repuesto</th>
                <th>Unidad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {materialesFiltrados.length === 0 && (
                <tr><td colSpan={3} className={styles.emptyRow}>
                  {searchMat ? "Sin resultados para tu búsqueda" : "No hay materiales registrados"}
                </td></tr>
              )}
              {pagedMat.map(m => (
                <tr key={m.id}>
                  <td className={styles.cellBold}>{m.nombre}</td>
                  <td>{m.unidad}</td>
                  <td>
                    <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => eliminarMaterial(m.id!, m.nombre)}>
                      ✕ Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FABRICANTES DE REPUESTOS ─────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Fabricantes de Repuestos</div>
        <div className={styles.sectionSubtitle}>Marcas de repuestos disponibles para el inventario</div>

        <div className={styles.controlsRow}>
          <div className={styles.addFabricanteRow}>
            <input
              value={nuevoFab}
              onChange={e => setNuevoFab(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && agregarFabricante()}
              placeholder="Nuevo fabricante (ej: NGK, Denso...)"
              className={styles.flexInput}
            />
            <button className="btn btn-primary" onClick={agregarFabricante} disabled={!nuevoFab.trim()}>
              + Agregar
            </button>
          </div>
          <input
            type="text"
            placeholder="🔍 Buscar fabricante..."
            value={searchFab}
            onChange={e => setSearchFab(e.target.value)}
            className={styles.searchInputSm}
          />
        </div>

        <Pagination page={pageFab} totalPages={totalPagesFab} totalItems={fabricantesFiltrados.length} pageSize={sizeFab} onPage={goToFab} onPageSize={changeSizeFab} />
        <div className={`tbl-wrap ${styles.mb1}`}>
          <table>
            <thead>
              <tr>
                <th>Fabricante</th>
                <th>Tipo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {fabricantesFiltrados.length === 0 && (
                <tr><td colSpan={3} className={styles.emptyRow}>Sin resultados para tu búsqueda</td></tr>
              )}
              {pagedFab.map((f, i) => (
                <tr key={f.id || i}>
                  <td data-label="Fabricante" className={styles.cellBold}>{f.nombre}</td>
                  <td data-label="Tipo">
                    <span className={f.default ? styles.badgeDefault : styles.badgeCustom}>
                      {f.default ? "Predeterminado" : "Personalizado"}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    {!f.default && f.id && (
                      <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => eliminarFabricante(f.id!, f.nombre)}>
                        ✕ Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}