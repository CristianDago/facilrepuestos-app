import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import { useAuth } from "../../contexts/AuthContext";
import { ordenesService } from "../../services/ordenes";
import { vehiculosService } from "../../services/vehiculos";
import { inventarioService } from "../../services/inventario";
import { serviciosPredefinidosService } from "../../services/serviciosPredefinidos";
import { mecanicosService } from "../../services/mecanicos";
import type { Servicio, EstadoOT, RepuestoOT, ItemInventario, TareaOT, OrdenTrabajo, MaterialPredefinido, MaterialExterno } from "../../types";
import { getStockInfo } from "../../types";
import type { ServicioPredefinido } from "../../services/serviciosPredefinidos";
import { materialesPredefinidosService } from "../../services/materialesPredefinidos";
import type { Mecanico } from "../../services/mecanicos";
import shared from "../../styles/shared.module.css";
import styles from "./EditarOrden.module.css";

const fmtCLP   = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const parseNum = (v: string) => parseInt(v.replace(/[^\d]/g, ""), 10) || 0;

const displayDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nowISO = () => new Date().toISOString();
const isoFromDisplay = (display: string) => {
  if (!display) return today();
  const parts = display.split("/");
  if (parts.length === 3) {
    const year = parts[2].length === 2 ? "20" + parts[2] : parts[2];
    return `${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return today();
};

const getTipoVehiculo = (tipo: string): "Auto" | "SUV" | "Camioneta" => {
  const t = (tipo || "").toLowerCase();
  if (t.includes("suv") || t.includes("jeep") || t.includes("todo terreno")) return "SUV";
  if (t.includes("camioneta") || t.includes("pickup") || t.includes("pick up") ||
      t.includes("furgon")    || t.includes("furgón") || t.includes("van")     ||
      t.includes("minibus")   || t.includes("bus")) return "Camioneta";
  return "Auto";
};

const getPrecioServicio = (svc: ServicioPredefinido, tipoVehiculo: string): number => {
  const t = getTipoVehiculo(tipoVehiculo);
  if (t === "SUV")       return svc.precioSUV       || 0;
  if (t === "Camioneta") return svc.precioCamioneta || 0;
  return svc.precioAuto || 0;
};

interface TrabajoRow {
  nombre: string; descripcion: string; detalle: string; precio: string;
  cantidad: number; mecanicoId: string; mecanicoNombre: string;
}

interface MaterialExternoRow {
  materialId: string;
  descripcion: string;
  unidad: string;
  precioBase: string;
  precio: string;
  cantidad: number;
}
interface CambioEstado {
  de: string; a: string; fecha: string; usuarioNombre: string; usuarioId: string;
}

export default function EditarOrden() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setLoading, notify, inventario, setInventario } = useAppStore();
  const { user } = useAuth();

  const [orden,          setOrden]          = useState<OrdenTrabajo | null>(null);
  const [numero,         setNumero]         = useState("");
  const [patente,        setPatente]        = useState("");
  const [marca,          setMarca]          = useState("");
  const [modelo,         setModelo]         = useState("");
  const [anio,           setAnio]           = useState("");
  const [tipo,           setTipo]           = useState("");
  const [motor,          setMotor]          = useState("");
  const [km,             setKm]             = useState("");
  const [cotizacionRef,  setCotizacionRef]  = useState("");
  const [nombre,         setNombre]         = useState("");
  const [telefono,       setTelefono]       = useState("");
  const [email,          setEmail]          = useState("");
  const [fechaIngreso,   setFechaIngreso]   = useState("");
  const [fechaEntrega,   setFechaEntrega]   = useState("");
  const [estado,         setEstado]         = useState<EstadoOT>("Recibido");
  const [estadoAnterior, setEstadoAnterior] = useState<EstadoOT>("Recibido");
  const [observaciones,  setObservaciones]  = useState("");
  const [notasInternas,  setNotasInternas]  = useState("");
  const [historialEstados, setHistorialEstados] = useState<CambioEstado[]>([]);
  const [showHistorial,  setShowHistorial]  = useState(false);

  const [trabajos,       setTrabajos]       = useState<TrabajoRow[]>([]);
  const [repuestos,         setRepuestos]         = useState<RepuestoOT[]>([]);
  const [materialesExternos, setMaterialesExternos] = useState<MaterialExternoRow[]>([]);
  const [materialesPred,     setMaterialesPred]     = useState<MaterialPredefinido[]>([]);
  const [modalRepuesto,  setModalRepuesto]  = useState(false);
  const [searchRepuesto, setSearchRepuesto] = useState("");
  const [selectedItem,   setSelectedItem]   = useState<ItemInventario | null>(null);
  const [cantRepuesto,   setCantRepuesto]   = useState(1);

  // ─── DESCUENTO ──────────────────────────────────────────
  const [descuento,     setDescuento]     = useState(0);
  const [tipoDescuento, setTipoDescuento] = useState<'porcentaje' | 'monto'>('porcentaje');

  const [svcPredefinidos, setSvcPredefinidos] = useState<ServicioPredefinido[]>([]);
  const [svcFilters, setSvcFilters] = useState<{[k: number]: string}>({});
  const [matFilters, setMatFilters] = useState<{[k: number]: string}>({});
  const [mecanicos,       setMecanicos]       = useState<Mecanico[]>([]);

  useEffect(() => { loadAll(); }, [id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [svcRes, mecRes, invRes, matRes] = await Promise.all([
        serviciosPredefinidosService.getAll(),
        mecanicosService.getAll(),
        inventarioService.getAll(),
        materialesPredefinidosService.getAll(),
      ]);
      const svcData = svcRes.success && svcRes.data ? svcRes.data : [];
      const mecData = mecRes.success && mecRes.data ? mecRes.data.filter(m => m.activo) : [];
      const invData = invRes.success && invRes.data ? invRes.data : [];
      setSvcPredefinidos(svcData); setMecanicos(mecData); setInventario(invData);
      if (matRes.success && matRes.data) setMaterialesPred(matRes.data);

      if (!id) return;
      const res = await ordenesService.getById(id);
      if (!res.success || !res.data) { notify("OT no encontrada", "error"); navigate("/ordenes"); return; }

      const o = res.data;
      setOrden(o);
      setNumero(o.numero       || ""); setPatente(o.patente || "");
      setMarca(o.marca         || ""); setModelo(o.modelo   || "");
      setAnio(o.anio           || ""); setTipo(o.tipo       || "");
      setMotor(o.motor         || ""); setKm(o.km           || "");
      setCotizacionRef(o.cotizacionRef || "");
      setFechaIngreso(isoFromDisplay(o.fechaIngreso         || ""));
      setFechaEntrega(isoFromDisplay(o.fechaEntregaEstimada || ""));
      setEstado(o.estado         || "Recibido");
      setEstadoAnterior(o.estado || "Recibido");
      setObservaciones(o.observaciones || "");
      setNotasInternas(o.notasInternas  || "");
      setRepuestos(o.repuestos          || []);
      setHistorialEstados((o as any).historialEstados || []);

      try {
        const vRes = await vehiculosService.getByPatente(o.patente);
        if (vRes.success && vRes.data) {
          setNombre(vRes.data.owner      || o.nombre   || "");
          setTelefono(vRes.data.telefono || o.telefono || "");
          setEmail(vRes.data.email       || o.email    || "");
          if (vRes.data.km) setKm(vRes.data.km); // ← km actualizado
        } else {
          setNombre(o.nombre || ""); setTelefono(o.telefono || ""); setEmail(o.email || "");
        }
      } catch {
        setNombre(o.nombre || ""); setTelefono(o.telefono || ""); setEmail(o.email || "");
      }

      const allNombres   = svcData.map((s: ServicioPredefinido) => s.nombre);
      const trabajosRows = (o.trabajos || []).map((t: Servicio) => ({
        nombre:         allNombres.includes(t.descripcion) ? t.descripcion : "",
        descripcion:    allNombres.includes(t.descripcion) ? "" : t.descripcion,
        detalle:        (t as any).detalle || "",
        precio:         String(t.precio),
        cantidad:       t.cantidad,
        mecanicoId:     t.mecanicoId     || "",
        mecanicoNombre: t.mecanicoNombre || "",
      }));
      setTrabajos(trabajosRows.length ? trabajosRows : [
        { nombre: "", descripcion: "", detalle: "", precio: "", cantidad: 1, mecanicoId: "", mecanicoNombre: "" }
      ]);
      // Cargar materiales/insumos externos guardados en la OT
      setMaterialesExternos(
        ((o as any).materialesExternos || []).map((m: any) => ({
          materialId:  m.materialId  || "",
          descripcion: m.descripcion || "",
          unidad:      m.unidad      || "UNIDAD",
          precioBase:  m.costo != null ? String(m.costo) : "",
          precio:      String(m.precio || 0),
          cantidad:    m.cantidad    || 1,
        }))
      );
      if ((o as any).descuento) {
        setDescuento((o as any).tipoDescuento === 'porcentaje' ? ((o as any).descuentoPct || 0) : (o as any).descuento);
        setTipoDescuento((o as any).tipoDescuento || 'porcentaje');
      }
    } catch {
      notify("Error al cargar datos", "error");
    } finally {
      setLoading(false);
    }
  };

  const totalTrabajos  = trabajos.reduce((s, t) => s + parseNum(t.precio) * t.cantidad, 0);
  const totalRepuestos     = repuestos.reduce((s, r) => s + r.total, 0);
  const totalMaterialesExt = materialesExternos.reduce((s, m) => s + parseNum(m.precio) * m.cantidad, 0);
  const subtotal           = totalTrabajos + totalRepuestos + totalMaterialesExt;
  // El descuento se aplica SOLO sobre la Mano de Obra, nunca sobre repuestos.
  const descuentoMonto = tipoDescuento === 'porcentaje'
    ? Math.round(totalTrabajos * (descuento / 100))
    : Math.min(Math.round(descuento), totalTrabajos);
  const totalGeneral   = Math.max(0, subtotal - descuentoMonto);
  const tipoLabel      = getTipoVehiculo(tipo);

  const addTrabajo    = () => setTrabajos([...trabajos, { nombre: "", descripcion: "", detalle: "", precio: "", cantidad: 1, mecanicoId: "", mecanicoNombre: "" }]);
  const removeTrabajo = (i: number) => setTrabajos(trabajos.filter((_, idx) => idx !== i));
  const updateTrabajoNombre = (i: number, nombre: string) => {
    const svc     = svcPredefinidos.find(s => s.nombre === nombre);
    const precio  = svc ? String(getPrecioServicio(svc, tipo)) : "";
    const detalle = svc?.detalle || "";
    setTrabajos(trabajos.map((t, idx) => idx === i ? { ...t, nombre, precio, detalle } : t));
  };
  const updateTrabajo  = (i: number, field: string, value: string | number) =>
    setTrabajos(trabajos.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  const updateMecanico = (i: number, mecanicoDocId: string) => {
    const mec = mecanicos.find(m => m.id === mecanicoDocId);
    setTrabajos(trabajos.map((t, idx) => idx === i ? {
      ...t,
      mecanicoId:     mec?.uid || mecanicoDocId,
      mecanicoNombre: mec?.nombre || "",
    } : t));
  };

  const agregarRepuesto = () => {
    if (!selectedItem) return;
    const info = getStockInfo(selectedItem);
    if (cantRepuesto > info.disponible) { notify(`Stock insuficiente. Solo hay ${info.disponible} unidades.`, "error"); return; }
    const existe = repuestos.find(r => r.inventarioId === selectedItem.id);
    if (existe) {
      setRepuestos(repuestos.map(r => r.inventarioId === selectedItem.id
        ? { ...r, cantidad: r.cantidad + cantRepuesto, total: (r.cantidad + cantRepuesto) * r.precioUnitario } : r));
    } else {
      setRepuestos([...repuestos, {
        inventarioId:   selectedItem.id!,
        nombre:         selectedItem.nombre,
        cantidad:       cantRepuesto,
        precioUnitario: selectedItem.precioVenta || 0,
        total:          cantRepuesto * (selectedItem.precioVenta || 0),
      }]);
    }
    setModalRepuesto(false); setSelectedItem(null); setCantRepuesto(1); setSearchRepuesto("");
  };
  const removeRepuesto = (inventarioId: string) =>
    setRepuestos(repuestos.filter(r => r.inventarioId !== inventarioId));

  const addMaterialExterno = () =>
    setMaterialesExternos([...materialesExternos, { materialId: "", descripcion: "", unidad: "UNIDAD", precioBase: "", precio: "", cantidad: 1 }]);
  const removeMaterialExterno = (i: number) =>
    setMaterialesExternos(materialesExternos.filter((_, idx) => idx !== i));
  const updateMatNombre = (i: number, materialId: string) => {
    const mat = materialesPred.find(m => m.id === materialId);
    setMaterialesExternos(materialesExternos.map((m, idx) => idx === i
      ? { ...m, materialId, descripcion: mat?.nombre || "", unidad: mat?.unidad || "UNIDAD", precioBase: "", precio: "" }
      : m));
  };
  const updateMat = (i: number, field: string, value: string | number) =>
    setMaterialesExternos(materialesExternos.map((m, idx) => idx === i ? { ...m, [field]: value } : m));

  const filteredInventario = inventario.filter(i => {
    const q    = searchRepuesto.toLowerCase();
    const info = getStockInfo(i);
    return info.disponible > 0 && (!q ||
      i.nombre.toLowerCase().includes(q) ||
      (i.codigo    || "").toLowerCase().includes(q) ||
      (i.categoria || "").toLowerCase().includes(q) ||
      (i as any).fabricante?.toLowerCase().includes(q) ||
      ((i as any).equivalencias || []).some((e: any) =>
        typeof e === 'string'
          ? e.toLowerCase().includes(q)
          : (`${e.fabricante || ''} ${e.codigo || ''}`).toLowerCase().includes(q))
    );
  });

  const handleSubmit = async () => {
    if (!nombre) { notify("Ingresa el nombre del cliente", "error"); return; }
    const trabajosData: Servicio[] = trabajos
      .filter(t => t.nombre)
      .map(t => ({
        descripcion:    t.nombre,
        detalle:        t.detalle || undefined,
        precio:         parseNum(t.precio),
        cantidad:       t.cantidad,
        total:          parseNum(t.precio) * t.cantidad,
        mecanicoId:     t.mecanicoId     || undefined,
        mecanicoNombre: t.mecanicoNombre || undefined,
      }));
    const matData = materialesExternos
      .filter(m => m.descripcion && parseNum(m.precio) > 0)
      .map(m => ({
        materialId:  m.materialId || undefined,
        descripcion: m.descripcion,
        unidad:      m.unidad,
        costo:       parseNum(m.precioBase) || undefined,
        precio:      parseNum(m.precio),
        cantidad:    m.cantidad,
        total:       parseNum(m.precio) * m.cantidad,
      }));
    if (!trabajosData.length) { notify("Agrega al menos un trabajo", "error"); return; }

    // ── Sincronizar tareas ──────────────────────────────
    const tareasExistentes: TareaOT[] = orden?.tareas || [];
    const tareasSincronizadas: TareaOT[] = trabajosData
      .filter(t => t.mecanicoId)
      .map(t => {
        const existing = tareasExistentes.find(ta => ta.descripcion === t.descripcion);
        if (existing) return { ...existing, mecanicoId: t.mecanicoId!, mecanicoNombre: t.mecanicoNombre || "" };
        return {
          id:             `tarea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          descripcion:    t.descripcion,
          mecanicoId:     t.mecanicoId!,
          mecanicoNombre: t.mecanicoNombre || "",
          estado:         "pendiente" as const,
          createdAt:      nowISO(),
        };
      });
    const descripcionesTrabajos = new Set(trabajosData.map(t => t.descripcion));
    const tareasManuales        = tareasExistentes.filter(ta => !descripcionesTrabajos.has(ta.descripcion));
    const tareasFinales         = [...tareasManuales, ...tareasSincronizadas];

    // ── Historial de estados ────────────────────────────
    let nuevoHistorial = [...historialEstados];
    if (estado !== estadoAnterior) {
      nuevoHistorial.push({
        de:            estadoAnterior,
        a:             estado,
        fecha:         nowISO(),
        usuarioNombre: user ? `${user.nombre} ${user.apellido}` : "Admin",
        usuarioId:     user?.uid || "",
      });
    }

    const fechaEntregaReal = estado === "Entregado"
      ? displayDate(today())
      : (orden?.fechaEntregaReal || null);

    setLoading(true);
    try {
      await ordenesService.update(id!, {
        nombre, telefono, email, marca, modelo, anio, tipo, motor, km, cotizacionRef,
        trabajos:             trabajosData,
        repuestos,
        materialesExternos:   matData,
        total:                totalGeneral,
        totalIva:             Math.round(totalGeneral * 0.19),
        totalConIva:          Math.round(totalGeneral * 1.19),
        descuento:            descuentoMonto,
        tipoDescuento,
        descuentoPct:         tipoDescuento === 'porcentaje' ? descuento : 0,
        observaciones, notasInternas, estado,
        fechaIngreso:         displayDate(fechaIngreso),
        fechaEntregaEstimada: displayDate(fechaEntrega),
        fechaEntregaReal,
        tareas:               tareasFinales,
        historialEstados:     nuevoHistorial,
      } as any);
      notify("OT actualizada ✓", "success");
      navigate("/ordenes");
    } catch { notify("Error al actualizar OT", "error"); }
    finally { setLoading(false); }
  };

  const fmtFechaHistorial = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Editando OT <span>{numero}</span></div>
        <div className={shared.headerActions}>
          {historialEstados.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowHistorial(true)}>
              📋 Historial ({historialEstados.length})
            </button>
          )}
          <button className="btn btn-dark" onClick={() => navigate("/ordenes")}>← Volver</button>
        </div>
      </div>

      {/* ── VEHÍCULO + CLIENTE ─────────────────────────────── */}
      <div className={shared.dosColumnas}>
        <div className={`card ${shared.cardInner}`}>
          <div className="card-title">Datos del Vehículo</div>
          <div className={`form-grid fg-2 ${shared.formRow1}`}>
            <div className="field">
              <label>Patente</label>
              <input value={patente} disabled className={shared.inputDisabled} />
            </div>
            <div className="field">
              <label>Kilometraje</label>
              <input value={km} onChange={e => setKm(e.target.value)} />
            </div>
          </div>
          <div className="form-grid fg-2">
            <div className="field">
              <label>Marca</label>
              <input value={marca} onChange={e => setMarca(e.target.value)} />
            </div>
            <div className="field">
              <label>Modelo</label>
              <input value={modelo} onChange={e => setModelo(e.target.value)} />
            </div>
          </div>
          <div className={`form-grid fg-3 ${shared.formRow2}`}>
            <div className="field">
              <label>Año</label>
              <input value={anio} onChange={e => setAnio(e.target.value)} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="">— Seleccionar —</option>
                <option value="AUTOMOVIL">Automóvil</option>
                <option value="STATION WAGON">Station Wagon</option>
                <option value="SUV">SUV / Todo Terreno</option>
                <option value="CAMIONETA">Camioneta</option>
                <option value="FURGON">Furgón</option>
                <option value="MINIBUS">Minibus</option>
                <option value="BUS">Bus</option>
                <option value="PICKUP">Pick-Up</option>
                <option value="VAN">Van</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <div className="field">
              <label>N° Motor</label>
              <input value={motor} onChange={e => setMotor(e.target.value)} />
            </div>
          </div>
          {tipo && (
            <div className={shared.tarifaBadge}>
              <span className={shared.tarifaLabel}>Tarifa: {tipoLabel}</span>
            </div>
          )}
          <div className={`field ${shared.formRow2}`}>
            <label>Ref. Cotización</label>
            <input value={cotizacionRef} onChange={e => setCotizacionRef(e.target.value)} />
          </div>
        </div>

        <div className={`card ${shared.cardInner}`}>
          <div className="card-title">Cliente y Fechas</div>
          <div className={shared.clienteAviso}>
            ℹ Para modificar los datos del cliente, edita el perfil del vehículo.
          </div>
          <div className="form-grid fg-2">
            <div className="field">
              <label>Nombre</label>
              <input value={nombre} disabled className={shared.inputDisabled} />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input value={telefono} disabled className={shared.inputDisabled} />
            </div>
          </div>
          <div className={`field ${shared.formRow2}`}>
            <label>Correo</label>
            <input value={email} disabled className={shared.inputDisabled} />
          </div>
          <div className={`form-grid fg-2 ${shared.formRow2}`}>
            <div className="field">
              <label>Fecha Ingreso</label>
              <input type="date" value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)} />
            </div>
            <div className="field">
              <label>Entrega Estimada</label>
              <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} />
            </div>
          </div>
          <div className={`field ${shared.formRow2}`}>
            <label>Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value as EstadoOT)}>
              <option value="Recibido">Recibido</option>
              <option value="En Proceso">En Proceso</option>
              <option value="Listo">Listo</option>
              <option value="Entregado">Entregado</option>
            </select>
            {estado === "Entregado" && (
              <div className={styles.avisoEntregaReal}>
                ✓ Se registrará fecha de entrega real: {displayDate(today())}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── TRABAJOS ──────────────────────────────────────── */}
      <div className={shared.seccionTabla}>
        <div className={shared.seccionHeader}>
          <div className={`card-title ${styles.cardTitleFlush}`}>Trabajos / Mano de Obra</div>
          {tipo && <span className={shared.preciosTarifa}>Precios para {tipoLabel}</span>}
        </div>
        <table className="svc-tbl">
          <thead>
            <tr>
              <th className={shared.colTrabajoSvc}>Servicio</th>
              <th className={shared.colMecanico}>Mecánico</th>
              <th className={`r ${shared.colPrecioOT}`}>Precio M.O.</th>
              <th className={`r ${shared.colCantOT}`}>Cant.</th>
              <th className={`r ${shared.colTotalOT}`}>Total</th>
              <th className={shared.colAccionOT}></th>
            </tr>
          </thead>
          <tbody>
            {trabajos.map((t, i) => (
              <tr key={i}>
                <td data-label="Servicio">
                  <div className={styles.filtroRow}>
                    <input
                      value={svcFilters[i] || ""}
                      onChange={e => setSvcFilters(p => ({...p, [i]: e.target.value}))}
                      placeholder="🔍 Buscar servicio..."
                      className={styles.filtroInput}
                    />
                    {svcFilters[i] && (
                      <button type="button" onClick={() => setSvcFilters(p => ({...p, [i]: ""}))}
                        className={styles.filtroClear}>✕</button>
                    )}
                  </div>
                  <select value={t.nombre} onChange={e => { updateTrabajoNombre(i, e.target.value); setSvcFilters(p => ({...p, [i]: ""})); }}>
                    <option value="">— Seleccionar —</option>
                    {svcPredefinidos
                      .filter(sv => !svcFilters[i] || sv.nombre.toLowerCase().includes((svcFilters[i]||"").toLowerCase()))
                      .map(sv => (
                        <option key={sv.id} value={sv.nombre}>
                          {sv.nombre} {tipo ? `(${fmtCLP(getPrecioServicio(sv, tipo))})` : ""}
                        </option>
                      ))}
                  </select>
                  {t.nombre && (
                    <textarea
                      value={t.detalle || ""}
                      onChange={e => updateTrabajo(i, "detalle", e.target.value)}
                      placeholder="Descripción técnica del servicio (editable)..."
                      rows={3}
                      className={styles.detalleTextarea}
                    />
                  )}
                </td>
                <td data-label="Mecánico">
                  <select
                    value={mecanicos.find(m => m.uid === t.mecanicoId)?.id || ""}
                    onChange={e => updateMecanico(i, e.target.value)}
                    className={styles.mecanicoSelect}
                  >
                    <option value="">— Sin asignar —</option>
                    {mecanicos.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}{m.especialidad ? ` · ${m.especialidad}` : ""}
                      </option>
                    ))}
                  </select>
                  {t.mecanicoNombre && (
                    <div className={styles.mecanicoAsignado}>✓ {t.mecanicoNombre}</div>
                  )}
                </td>
                <td data-label="Precio M.O.">
                  <input className="ri" value={t.precio}
                    onChange={e => updateTrabajo(i, "precio", e.target.value)} placeholder="0" />
                </td>
                <td data-label="Cant.">
                  <input type="number" className={`ri ${shared.inputCantOT}`} value={t.cantidad} min={1}
                    onChange={e => updateTrabajo(i, "cantidad", parseInt(e.target.value) || 1)} />
                </td>
                <td className="r row-total">
                  <span>{fmtCLP(parseNum(t.precio) * t.cantidad)}</span>
                </td>
                <td className="r">
                  <button className="btn-rm" onClick={() => removeTrabajo(i)}>
                    <svg width="13" height="13" viewBox="0 0 14 14">
                      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="svc-footer">
          <button className="btn-ghost" onClick={addTrabajo}>+ Agregar Trabajo</button>
          <span className="row-total">{fmtCLP(totalTrabajos)}</span>
        </div>

        {/* ── DESCUENTO (solo sobre Mano de Obra) ────────────── */}
        <div className={shared.descuentoRow}>
          <span className={shared.descuentoLabel}>Descuento (Mano de Obra)</span>
          <select
            className={shared.descuentoSelect}
            value={tipoDescuento}
            onChange={e => { setTipoDescuento(e.target.value as 'porcentaje' | 'monto'); setDescuento(0); }}
          >
            <option value="porcentaje">% Porcentaje</option>
            <option value="monto">$ Monto fijo</option>
          </select>
          <input
            className={shared.descuentoInput}
            type="number" min={0}
            max={tipoDescuento === 'porcentaje' ? 100 : totalTrabajos}
            value={descuento || ''}
            onChange={e => setDescuento(Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0"
          />
          {descuentoMonto > 0 && (
            <span className={shared.descuentoMonto}>− {fmtCLP(descuentoMonto)}</span>
          )}
        </div>
      </div>

      {/* ── REPUESTOS E INSUMOS ────────────────────────────── */}
      <div className={shared.seccionTabla}>
        <div className={shared.seccionHeader}>
          <div className={`card-title ${styles.cardTitleFlush}`}>🔩 Repuestos e Insumos</div>
          <div className={styles.repuestosHeaderAcciones}>
            <button className="btn btn-dark btn-sm" onClick={addMaterialExterno}>+ Repuesto/Insumo</button>
            <button className="btn btn-dark btn-sm" onClick={() => setModalRepuesto(true)}>+ Del Inventario</button>
          </div>
        </div>
        {repuestos.length === 0 && materialesExternos.length === 0 ? (
          <div className={shared.emptyTabla}>Sin repuestos ni insumos — opcional</div>
        ) : (
          <table className="svc-tbl">
            <thead>
              <tr>
                <th className={shared.colRepuesto}>Repuesto / Insumo</th>
                <th className={`r ${shared.colPrecioRep}`}>Costo</th>
                <th className={`r ${shared.colPrecioRep}`}>P. Venta</th>
                <th className={`r ${shared.colCantRep}`}>Cant.</th>
                <th className={`r ${shared.colTotalRep}`}>Total</th>
                <th className={shared.colAccionOT}></th>
              </tr>
            </thead>
            <tbody>
              {repuestos.map(r => (
                <tr key={r.inventarioId}>
                  <td data-label="Repuesto">{r.nombre}</td>
                  <td className="r">—</td>
                  <td data-label="P. Venta" className="r">{fmtCLP(r.precioUnitario)}</td>
                  <td data-label="Cant." className="r">
                    {(() => {
                      const item = inventario.find(it => it.id === r.inventarioId);
                      const dec  = ['LITRO','LITROS','KG','KGS','METRO','METROS'].includes((item?.unidad||'').toUpperCase());
                      return (
                        <input type="number" className={`ri ${shared.inputCantOT}`}
                          value={r.cantidad} min={0} step={dec ? 0.1 : 1}
                          onChange={e => {
                            const cant = (dec ? parseFloat : parseInt)(e.target.value) || 0;
                            setRepuestos(repuestos.map(x => x.inventarioId === r.inventarioId
                              ? { ...x, cantidad: cant, total: cant * x.precioUnitario } : x));
                          }} />
                      );
                    })()}
                  </td>
                  <td className="r row-total"><span>{fmtCLP(r.total)}</span></td>
                  <td className="r">
                    <button className="btn-rm" onClick={() => removeRepuesto(r.inventarioId)}>
                      <svg width="13" height="13" viewBox="0 0 14 14">
                        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {materialesExternos.map((m, i) => (
                <tr key={`ext-${i}`}>
                  <td data-label="Repuesto / Insumo">
                    <div className={styles.materialManualWrap}>
                      <div className={styles.filtroRow}>
                        <input value={matFilters[i] || ""}
                          onChange={e => setMatFilters(p => ({...p, [i]: e.target.value}))}
                          placeholder="🔍 Buscar insumo/repuesto..."
                          className={styles.filtroInput} />
                        {matFilters[i] && (
                          <button type="button" onClick={() => setMatFilters(p => ({...p, [i]: ""}))}
                            className={styles.filtroClear}>✕</button>
                        )}
                      </div>
                      <select value={m.materialId} onChange={e => { updateMatNombre(i, e.target.value); setMatFilters(p => ({...p, [i]: ""})); }}>
                        <option value="">— Seleccionar —</option>
                        {materialesPred
                          .filter(mp => !matFilters[i] || mp.nombre.toLowerCase().includes((matFilters[i]||"").toLowerCase()))
                          .map(mp => (
                            <option key={mp.id} value={mp.id}>{mp.nombre} ({mp.unidad})</option>
                          ))}
                        <option value="__custom__">✏ Escribir manualmente</option>
                      </select>
                      {(m.materialId === "__custom__" || !m.materialId) && (
                        <input value={m.descripcion}
                          onChange={e => updateMat(i, "descripcion", e.target.value.toUpperCase())}
                          placeholder="Nombre del repuesto o insumo..." />
                      )}
                    </div>
                  </td>
                  <td data-label="Costo" className="r">
                    <input className={`ri ${styles.costoInput}`} value={m.precioBase}
                      onChange={e => {
                        const base = e.target.value;
                        const v    = parseNum(base);
                        setMaterialesExternos(materialesExternos.map((x, idx) => idx === i
                          ? { ...x, precioBase: base, precio: v > 0 ? String(Math.round(v * 1.3)) : "" } : x));
                      }}
                      placeholder="Costo" />
                  </td>
                  <td data-label="P. Venta" className="r">
                    <input className={`ri ${styles.precioVentaInput}`} value={m.precio}
                      onChange={e => updateMat(i, "precio", e.target.value)}
                      placeholder="Venta" />
                  </td>
                  <td data-label="Cant." className="r">
                    {(() => {
                      const dec = ['LITRO','LITROS','KG','KGS','METRO','METROS'].includes((m.unidad||'').toUpperCase());
                      return (
                        <input type="number" className={`ri ${shared.inputCantOT}`}
                          value={m.cantidad} min={0} step={dec ? 0.1 : 1}
                          onChange={e => updateMat(i, "cantidad", (dec ? parseFloat : parseInt)(e.target.value) || 0)} />
                      );
                    })()}
                  </td>
                  <td className="r"><span className="row-total">{fmtCLP(parseNum(m.precio) * m.cantidad)}</span></td>
                  <td className="r">
                    <button className="btn-rm" onClick={() => removeMaterialExterno(i)}>
                      <svg width="13" height="13" viewBox="0 0 14 14">
                        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={`svc-footer ${styles.repuestoFooter}`}>
          <span className="row-total">{fmtCLP(totalRepuestos + totalMaterialesExt)}</span>
        </div>
        <div className={`total-bar ${shared.totalBarWrap}`}>
          <div className={shared.totalBarRow}>
            <span className="total-lbl">Mano de Obra</span>
            <span className={shared.totalBarValor}>{fmtCLP(totalTrabajos)}</span>
          </div>
          {descuentoMonto > 0 && (
            <div className={`${shared.totalBarRow} ${styles.descuentoRowVerde}`}>
              <span className="total-lbl">
                Descuento {tipoDescuento === 'porcentaje' ? `(${descuento}%)` : ''}
              </span>
              <span className={shared.totalBarValor}>− {fmtCLP(descuentoMonto)}</span>
            </div>
          )}
          {(totalRepuestos + totalMaterialesExt) > 0 && (
            <div className={shared.totalBarRow}>
              <span className="total-lbl">Repuestos e Insumos</span>
              <span className={shared.totalBarValor}>{fmtCLP(totalRepuestos + totalMaterialesExt)}</span>
            </div>
          )}
          <div className={shared.totalBarRow}>
            <span className="total-lbl">Subtotal</span>
            <span className={shared.totalBarValor}>{fmtCLP(totalGeneral)}</span>
          </div>
          <div className={shared.totalBarRow}>
            <span className="total-lbl">IVA 19%</span>
            <span className={shared.totalBarValor}>{fmtCLP(Math.round(totalGeneral * 0.19))}</span>
          </div>
          <div className={shared.totalBarRowTotal}>
            <span className="total-lbl">Total OT</span>
            <span className="total-val">{fmtCLP(Math.round(totalGeneral * 1.19))}</span>
          </div>
        </div>
      </div>

      {/* ── OBSERVACIONES ─────────────────────────────────── */}
      <div className={`card ${styles.cardConMargen}`}>
        <div className="card-title">Observaciones</div>
        <div className="form-grid fg-2">
          <div className="field">
            <label>Para el cliente</label>
            <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
              rows={4} className={shared.textarea} placeholder="Estado del vehículo, trabajos realizados..." />
          </div>
          <div className="field">
            <label>Notas internas (no se imprimen)</label>
            <textarea value={notasInternas} onChange={e => setNotasInternas(e.target.value)}
              rows={4} className={shared.textareaDark} placeholder="Notas técnicas internas..." />
          </div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-dark" onClick={() => navigate("/ordenes")}>Cancelar</button>
        <button className={`btn btn-primary ${shared.btnGuardar}`} onClick={handleSubmit}>
          💾 Guardar Cambios
        </button>
      </div>

      {/* ── MODAL HISTORIAL ───────────────────────────────── */}
      {showHistorial && (
        <div className="overlay open" onClick={() => setShowHistorial(false)}>
          <div className={`modal ${styles.modalHistorial}`} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📋 Historial de Estados</div>
            <div className={styles.historialLista}>
              {historialEstados.map((h, i) => (
                <div key={i} className={styles.historialItem}>
                  <div className={styles.historialInfo}>
                    <div className={styles.historialEstados}>
                      <span className={styles.historialDe}>{h.de}</span>
                      {" → "}
                      <span className={styles.historialA}>{h.a}</span>
                    </div>
                    <div className={styles.historialMeta}>
                      👤 {h.usuarioNombre} · {fmtFechaHistorial(h.fecha)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setShowHistorial(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL REPUESTOS ───────────────────────────────── */}
      {modalRepuesto && (
        <div className="overlay open">
          <div className={`modal ${shared.modalRepuesto}`}>
            <div className="modal-title">Agregar Repuesto</div>
            <div className={`field ${shared.modalBuscarField}`}>
              <label>Buscar en inventario</label>
              <input type="text" value={searchRepuesto} onChange={e => setSearchRepuesto(e.target.value)}
                placeholder="Nombre, código, categoría..." autoFocus />
            </div>
            <div className={shared.repuestoLista}>
              {filteredInventario.length === 0 ? (
                <div className={shared.repuestoEmpty}>Sin resultados o sin stock</div>
              ) : (
                filteredInventario.map(item => {
                  const info       = getStockInfo(item);
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedItem(isSelected ? null : item)}
                      className={`${shared.repuestoItem} ${isSelected ? shared.seleccionado : ''}`}
                    >
                      <div>
                        <div className={shared.repuestoItemNombre}>{item.nombre}</div>
                        <div className={shared.repuestoItemMeta}>
                          {item.categoria}{item.codigo ? ` · ${item.codigo}` : ""}
                        </div>
                      </div>
                      <div className={shared.repuestoItemPrecios}>
                        <div className={shared.repuestoItemPrecio}>{fmtCLP(item.precioVenta || 0)}</div>
                        <div className={shared.repuestoItemStock}>
                          <span className={shared.repuestoItemStockDisp}>{info.disponible} disp.</span>
                          {info.reservado > 0 && (
                            <span className={shared.repuestoItemStockReserv}>{info.reservado} reserv.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {selectedItem && (
              <div className={shared.selectedRepuestoWrap}>
                <div className={shared.selectedRepuestoInfo}>
                  <div className={shared.selectedRepuestoNombre}>{selectedItem.nombre}</div>
                  <div className={shared.selectedRepuestoDisp}>
                    Disponible: {getStockInfo(selectedItem).disponible} {selectedItem.unidad}
                  </div>
                </div>
                <div className={`field ${shared.selectedRepuestoCantField}`}>
                  <label>Cantidad</label>
                  <input
                    type="number"
                    value={cantRepuesto}
                    min={0}
                    max={getStockInfo(selectedItem).disponible}
                    step={['LITRO','LITROS','KG','KGS','METRO','METROS'].includes((selectedItem.unidad||'').toUpperCase()) ? 0.1 : 1}
                    onChange={e => setCantRepuesto(Math.max(0, parseFloat(e.target.value) || 0))}
                  />
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => {
                setModalRepuesto(false); setSelectedItem(null); setCantRepuesto(1); setSearchRepuesto("");
              }}>
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={!selectedItem} onClick={agregarRepuesto}>
                + Agregar al OT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}