import { useEffect, useMemo, useState } from "react";
import { costosFijosService, categoriasCostoFijoService } from "../../services/costosFijos";
import type { CategoriaCostoFijo } from "../../services/costosFijos";
import { liquidacionesService } from "../../services/liquidaciones";
import { usuariosService } from "../../services/usuarios";
import { ordenesService } from "../../services/ordenes";
import { inventarioService } from "../../services/inventario";
import type { CostoFijo, Liquidacion, Usuario, OrdenTrabajo, ItemInventario } from "../../types";
import { CATEGORIAS_COSTO_FIJO_DEFAULT, MESES_NOMBRE } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import Pagination from "../../components/ui/Pagination";
import { usePagination } from "../../hooks/usePagination";
import styles from "./CostosFijos.module.css";

const fmtCLP = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");

const displayDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const isoFromDisplay = (display: string) => {
  if (!display) return "";
  const parts = display.split("/");
  if (parts.length === 3) {
    const year = parts[2].length === 2 ? "20" + parts[2] : parts[2];
    return `${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return "";
};
const todayIso = () => new Date().toISOString().slice(0, 10);

// Mismo formato de "periodo" que usa el módulo de Liquidaciones (Trabajadores.tsx): "Julio 2026"
const MESES_CAP = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─── Fechas de OT (mismo criterio y mismo fix de año de 2 dígitos que Estadísticas) ───
const fechaParaAgruparOT = (o: OrdenTrabajo): string | null =>
  o.fechaEntregaReal || o.fechaEntregaEstimada || o.createdAt || null;

const parseFechaOT = (s: string | null): Date | null => {
  if (!s) return null;
  let str = s;
  if (str.includes("T")) str = str.slice(0, 10);
  if (str.includes("-")) {
    const [y, m, d] = str.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  if (str.includes("/")) {
    const [d, m, yRaw] = str.split("/").map(Number);
    if (!d || !m || !yRaw) return null;
    const y = yRaw < 100 ? 2000 + yRaw : yRaw; // "26" → 2026, no 1926
    return new Date(y, m - 1, d);
  }
  return null;
};

const emptyForm = () => {
  const hoy = new Date();
  return {
    categoria: "",
    proveedor: "",
    numeroFactura: "",
    mes: hoy.getMonth() + 1,
    anio: hoy.getFullYear(),
    monto: "" as number | string,
    descuentaIva: true,
    fecha: displayDate(todayIso()),
    notas: "",
  };
};

export default function CostosFijos() {
  const { notify, setLoading, ordenes, setOrdenes, inventario, setInventario } = useAppStore();
  const [costos, setCostos] = useState<CostoFijo[]>([]);
  const [categoriasList, setCategoriasList] = useState<CategoriaCostoFijo[]>([]);
  const [categoriaCustom, setCategoriaCustom] = useState("");
  const [guardandoCategoria, setGuardandoCategoria] = useState(false);
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  const [search, setSearch] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMes, setFiltroMes] = useState("");
  const [filtroAnio, setFiltroAnio] = useState("");

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const hoyD = new Date();
  const mesActualKey = `${hoyD.getFullYear()}-${String(hoyD.getMonth() + 1).padStart(2, "0")}`;
  const [mesSeleccionado, setMesSeleccionado] = useState(mesActualKey);
  const [anioSel, mesSel] = mesSeleccionado.split("-").map(Number);

  useEffect(() => { loadCostos(); loadCategorias(); loadLiquidaciones(); loadUsuarios(); loadOrdenes(); loadInventarioGlobal(); }, []);

  const loadOrdenes = async () => {
    try { const r = await ordenesService.getAll(); if (r.success && r.data) setOrdenes(r.data); } catch {}
  };

  const loadInventarioGlobal = async () => {
    try { const r = await inventarioService.getAll(); if (r.success && r.data) setInventario(r.data); } catch {}
  };

  const loadCostos = async () => {
    setLoading(true);
    try {
      const r = await costosFijosService.getAll();
      if (r.success && r.data) setCostos(r.data);
    } catch {
      notify("Error al cargar costos fijos", "error");
    } finally {
      setLoading(false);
    }
  };

  const loadCategorias = async () => {
    try {
      const r = await categoriasCostoFijoService.getAll();
      if (r.success && r.data) setCategoriasList(r.data);
    } catch {}
  };

  const loadLiquidaciones = async () => {
    try {
      const r = await liquidacionesService.getAll();
      if (r.success && r.data) setLiquidaciones(r.data);
    } catch {}
  };

  const loadUsuarios = async () => {
    try {
      const r = await usuariosService.getAll();
      if (r.success && r.data) setUsuarios(r.data);
    } catch {}
  };

  const allCategorias = [
    ...CATEGORIAS_COSTO_FIJO_DEFAULT,
    ...categoriasList.map(c => c.nombre).filter(n => !CATEGORIAS_COSTO_FIJO_DEFAULT.includes(n)),
  ];

  const agregarCategoria = async () => {
    const nombre = categoriaCustom.trim().toUpperCase();
    if (!nombre) return;
    if (allCategorias.includes(nombre)) { notify("Esta categoría ya existe", "error"); return; }
    setGuardandoCategoria(true);
    try {
      const r = await categoriasCostoFijoService.create(nombre);
      if (r.success) {
        notify(`Categoría "${nombre}" agregada ✓`, "success");
        setCategoriaCustom("");
        await loadCategorias();
        setForm(p => ({ ...p, categoria: nombre }));
      }
    } catch {
      notify("Error al guardar categoría", "error");
    } finally {
      setGuardandoCategoria(false);
    }
  };

  const openNuevo = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModal(true);
  };

  const openEditar = (c: CostoFijo) => {
    setEditingId(c.id!);
    setForm({
      categoria: c.categoria || "",
      proveedor: c.proveedor || "",
      numeroFactura: c.numeroFactura || "",
      mes: c.mes,
      anio: c.anio,
      monto: c.monto,
      descuentaIva: c.descuentaIva !== false,
      fecha: c.fecha || displayDate(todayIso()),
      notas: c.notas || "",
    });
    setModal(true);
  };

  const setField = (field: keyof ReturnType<typeof emptyForm>, value: string | number | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.categoria) { notify("Selecciona una categoría", "error"); return; }
    if (!form.monto || Number(form.monto) <= 0) { notify("Ingresa el monto neto", "error"); return; }

    setLoading(true);
    try {
      const data = {
        categoria: form.categoria,
        proveedor: form.proveedor.toUpperCase(),
        numeroFactura: form.numeroFactura.toUpperCase(),
        mes: Number(form.mes),
        anio: Number(form.anio),
        monto: parseFloat(String(form.monto)) || 0,
        descuentaIva: form.descuentaIva,
        fecha: form.fecha,
        notas: form.notas,
      };
      if (editingId) {
        await costosFijosService.update(editingId, data);
        notify("Costo fijo actualizado ✓", "success");
      } else {
        await costosFijosService.create(data);
        notify("Costo fijo agregado ✓", "success");
      }
      setModal(false);
      loadCostos();
    } catch {
      notify("Error al guardar", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, categoria: string, mes: number, anio: number) => {
    if (!confirm(`¿Eliminar el gasto "${categoria}" de ${MESES_NOMBRE[mes - 1]} ${anio}?`)) return;
    setLoading(true);
    try {
      await costosFijosService.delete(id);
      notify("Costo fijo eliminado", "info");
      loadCostos();
    } catch {
      notify("Error al eliminar", "error");
    } finally {
      setLoading(false);
    }
  };

  const inventarioMap = useMemo(() => {
    const m = new Map<string, ItemInventario>();
    inventario.forEach(i => { if (i.id) m.set(i.id, i); });
    return m;
  }, [inventario]);

  const entregadasOT = useMemo(
    () => ordenes.filter((o: OrdenTrabajo) => o.estado === "Entregado" && !!fechaParaAgruparOT(o)),
    [ordenes]
  );

  // Costo de repuestos + materiales de las OT entregadas, agrupado por mes.
  // Mismo criterio que usa Estadísticas: precio de compra del repuesto, y 70%
  // del precio de materiales externos (el 30% restante es el margen que se
  // les agrega al ingresarlos).
  const costoRepuestosPorMes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const ot of entregadasOT) {
      const fecha = parseFechaOT(fechaParaAgruparOT(ot));
      if (!fecha) continue;
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;

      // precioCompra y el "Costo" de materiales externos se ingresan CON IVA
      // incluido (lo que realmente se pagó al proveedor); hay que descomponerlos
      // a neto — igual criterio que usa Estadísticas.
      let costo = 0;
      for (const rep of ot.repuestos || []) {
        const item = inventarioMap.get(rep.inventarioId);
        if (item) costo += ((item.precioCompra || 0) * rep.cantidad) / 1.19;
      }
      for (const mat of ot.materialesExternos || []) {
        if (mat.costo != null) {
          costo += (mat.costo * (mat.cantidad || 1)) / 1.19;
        } else {
          const totalMat = mat.total ?? (mat.precio || 0) * (mat.cantidad || 0);
          costo += totalMat / 1.3;
        }
      }
      mapa.set(key, (mapa.get(key) || 0) + costo);
    }
    return mapa;
  }, [entregadasOT, inventarioMap]);

  const costoRepuestosMes = costoRepuestosPorMes.get(mesSeleccionado) || 0;
  const costoRepuestosAnio = useMemo(() => {
    let total = 0;
    costoRepuestosPorMes.forEach((v, k) => { if (k.startsWith(String(anioSel))) total += v; });
    return total;
  }, [costoRepuestosPorMes, anioSel]);

  const mesesDisponibles = useMemo(() => {
    const claves = new Set<string>([mesActualKey]);
    costos.forEach(c => claves.add(`${c.anio}-${String(c.mes).padStart(2, "0")}`));
    costoRepuestosPorMes.forEach((_, k) => claves.add(k));
    return Array.from(claves).sort().reverse().map(key => {
      const [y, m] = key.split("-").map(Number);
      return { key, label: `${MESES_CAP[m - 1]} ${y}` };
    });
  }, [costos, costoRepuestosPorMes, mesActualKey]);

  const filtered = costos.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (c.proveedor || "").toLowerCase().includes(q) ||
      (c.numeroFactura || "").toLowerCase().includes(q) ||
      (c.categoria || "").toLowerCase().includes(q);
    const matchCategoria = !filtroCategoria || c.categoria === filtroCategoria;
    const matchMes = !filtroMes || c.mes === Number(filtroMes);
    const matchAnio = !filtroAnio || c.anio === Number(filtroAnio);
    return matchSearch && matchCategoria && matchMes && matchAnio;
  });
  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  const totalMesActual = costos
    .filter(c => c.mes === mesSel && c.anio === anioSel)
    .reduce((s, c) => s + (c.totalConIva || 0), 0);
  const totalAnioActual = costos
    .filter(c => c.anio === anioSel)
    .reduce((s, c) => s + (c.totalConIva || 0), 0);
  const anios = [...new Set(costos.map(c => c.anio))].sort((a, b) => b - a);

  // ── Sueldos (desde el módulo Liquidaciones de Trabajadores) ──
  const periodoActual = `${MESES_CAP[mesSel - 1]} ${anioSel}`;
  const liqDelMes = liquidaciones.filter(l => l.periodo === periodoActual);
  const totalSueldosMes = liqDelMes.reduce((s, l) => s + (l.monto || 0), 0);
  const totalSueldosAnio = liquidaciones
    .filter(l => l.periodo.endsWith(String(anioSel)))
    .reduce((s, l) => s + (l.monto || 0), 0);
  const nombreUsuario = (uid?: string) => {
    const u = usuarios.find(u => u.id === uid || u.uid === uid);
    return u ? `${u.nombre} ${u.apellido}` : "—";
  };
  const gastoOperacionalMes  = totalMesActual + totalSueldosMes + costoRepuestosMes;
  const gastoOperacionalAnio = totalAnioActual + totalSueldosAnio + costoRepuestosAnio;
  const totalIvaCreditoMes = costos
    .filter(c => c.mes === mesSel && c.anio === anioSel && c.descuentaIva !== false)
    .reduce((s, c) => s + (c.iva || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Costos <span>Fijos</span> · {periodoActual}</div>
        <div className={styles.toolbarRight}>
          <select
            className={styles.mesSelect}
            value={mesSeleccionado}
            onChange={e => setMesSeleccionado(e.target.value)}
          >
            {mesesDisponibles.map(m => (
              <option key={m.key} value={m.key}>
                {m.label}{m.key === mesActualKey ? " (actual)" : ""}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar proveedor, N° factura..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openNuevo}>+ Nuevo Gasto</button>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(totalMesActual)}</div>
          <div className="stat-label">Costos Fijos {periodoActual}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(totalSueldosMes)}</div>
          <div className="stat-label">Sueldos {periodoActual}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(costoRepuestosMes)}</div>
          <div className="stat-label">Repuestos y Materiales (OT del mes)</div>
        </div>
        <div className={`stat-card ${styles.statCardDestacada}`}>
          <div className="stat-value">{fmtCLP(gastoOperacionalMes)}</div>
          <div className="stat-label">Gasto Operacional Total del Mes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(gastoOperacionalAnio)}</div>
          <div className="stat-label">Gasto Operacional Total del Año {anioSel}</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statIva}`}>{fmtCLP(totalIvaCreditoMes)}</div>
          <div className="stat-label">IVA Crédito Fiscal del Mes</div>
        </div>
      </div>

      <div className={styles.infoNote}>
        ℹ El "Gasto Operacional Total" suma: costos fijos del mes + sueldos del mes + costo neto de
        repuestos y materiales de las OT <strong>Entregadas</strong> ese mes (el precio de compra se
        ingresa con IVA incluido, aquí se descompone a neto; en OT antiguas sin costo real guardado se
        estima como el precio cobrado ÷ 1,3, el inverso de la fórmula de venta).
      </div>

      {/* ── SUELDOS DEL MES (solo lectura, gestionar en Trabajadores) ── */}
      {liqDelMes.length > 0 && (
        <div className={`card ${styles.sueldosCard}`}>
          <div className="card-title">Sueldos — {periodoActual}</div>
          <div className={styles.sueldosList}>
            {liqDelMes.map(l => (
              <div key={l.id} className={styles.sueldoRow}>
                <span className={styles.sueldoNombre}>{nombreUsuario(l.usuarioId)}</span>
                <span className={styles.sueldoMonto}>{fmtCLP(l.monto)}</span>
              </div>
            ))}
          </div>
          <div className={styles.sueldosFooterNota}>
            Se gestionan (suben/eliminan) desde <strong>Trabajadores → Liquidaciones</strong> de cada persona.
          </div>
        </div>
      )}

      {/* ── FILTROS ────────────────────────────────────── */}
      <div className={styles.filtrosRow}>
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {allCategorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {MESES_NOMBRE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)}>
          <option value="">Todos los años</option>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* ── TABLA ──────────────────────────────────────── */}
      <Pagination
        page={page} totalPages={totalPages} totalItems={filtered.length}
        pageSize={pageSize} onPage={goTo} onPageSize={changeSize}
      />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Mes / Año</th>
              <th>Proveedor</th>
              <th>N° Factura</th>
              <th className="r">Monto Neto</th>
              <th className="r">IVA</th>
              <th className="r">Total</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className={styles.emptyRow}>No hay costos fijos registrados</td></tr>
            )}
            {paged.map(c => (
              <tr key={c.id}>
                <td data-label="Categoría"><span className="badge badge-entregado">{c.categoria}</span></td>
                <td data-label="Mes / Año">{MESES_NOMBRE[c.mes - 1]} {c.anio}</td>
                <td data-label="Proveedor" className="hide-mobile">{c.proveedor || "—"}</td>
                <td data-label="N° Factura" className="num-cell">{c.numeroFactura || "—"}</td>
                <td data-label="Monto Neto" className="r price-cell">{fmtCLP(c.monto)}</td>
                <td data-label="IVA" className="r hide-mobile">
                  {c.descuentaIva !== false ? fmtCLP(c.iva) : (
                    <span className={styles.sinIvaBadge} title="No descuenta IVA (crédito fiscal)">No aplica</span>
                  )}
                </td>
                <td data-label="Total" className="r price-cell">{fmtCLP(c.totalConIva)}</td>
                <td data-label="Fecha" className={styles.fecha}>{c.fecha || "—"}</td>
                <td data-label="Acciones">
                  <div className={styles.accionesCol}>
                    <button className="btn btn-outline btn-sm" onClick={() => openEditar(c)}>✏ Editar</button>
                    <button className={`btn btn-sm ${styles.btnDanger}`} onClick={() => handleDelete(c.id!, c.categoria, c.mes, c.anio)}>✕ Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MODAL ──────────────────────────────────────── */}
      {modal && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">{editingId ? "Editar Costo Fijo" : "Nuevo Costo Fijo"}</div>

            <div className="form-grid fg-2">
              <div className="field">
                <label>Categoría *</label>
                <select value={form.categoria} onChange={e => setField("categoria", e.target.value)}>
                  <option value="">— Seleccionar —</option>
                  {allCategorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Proveedor</label>
                <input value={form.proveedor} onChange={e => setField("proveedor", e.target.value.toUpperCase())}
                  placeholder="Ej: ENEL, AGUAS ANDINAS..." />
              </div>
              <div className="field">
                <label>N° Factura / Boleta</label>
                <input value={form.numeroFactura} onChange={e => setField("numeroFactura", e.target.value.toUpperCase())} />
              </div>
              <div className="field">
                <label>Fecha</label>
                <input type="date" value={isoFromDisplay(form.fecha)} onChange={e => setField("fecha", displayDate(e.target.value))} />
              </div>
              <div className="field">
                <label>Mes *</label>
                <select value={form.mes} onChange={e => setField("mes", Number(e.target.value))}>
                  {MESES_NOMBRE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Año *</label>
                <input type="number" value={form.anio} onChange={e => setField("anio", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Monto Neto *</label>
                <input type="number" value={form.monto} onChange={e => setField("monto", e.target.value)}
                  placeholder="0" />
              </div>
              <div className="field">
                <label>Total {form.descuentaIva ? "con IVA (19%)" : "(no descuenta IVA)"}</label>
                <input value={fmtCLP((parseFloat(String(form.monto)) || 0) * (form.descuentaIva ? 1.19 : 1))} disabled />
              </div>
            </div>

            <div className={styles.ivaToggleRow} onClick={() => setField("descuentaIva", !form.descuentaIva)}>
              <input type="checkbox" checked={form.descuentaIva} onChange={e => setField("descuentaIva", e.target.checked)} />
              <div>
                <div className={styles.ivaToggleLabel}>Descuenta IVA (crédito fiscal)</div>
                <div className={styles.ivaToggleHint}>
                  Desactívalo para gastos donde no corresponde crédito fiscal (ej: luz incluida en el arriendo).
                </div>
              </div>
            </div>

            {/* Agregar categoría personalizada */}
            <div className="modal-sep" />
            <div className={styles.customAddRow}>
              <input
                type="text"
                value={categoriaCustom}
                onChange={e => setCategoriaCustom(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && agregarCategoria()}
                placeholder="+ Nueva categoría (ej: SEGURO, CONTADOR...)"
                className={styles.flexInput}
              />
              <button className="btn btn-dark btn-sm" onClick={agregarCategoria}
                disabled={guardandoCategoria || !categoriaCustom.trim()}>
                {guardandoCategoria ? "..." : "+ Agregar"}
              </button>
            </div>

            <div className="field">
              <label>Notas</label>
              <textarea value={form.notas} onChange={e => setField("notas", e.target.value)}
                rows={2} placeholder="Observaciones..." />
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}