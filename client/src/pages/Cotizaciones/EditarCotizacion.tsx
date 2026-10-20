import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import { cotizacionesService } from "../../services/cotizaciones";
import { vehiculosService } from "../../services/vehiculos";
import { inventarioService } from "../../services/inventario";
import { proveedoresService } from "../../services/proveedores";
import { serviciosPredefinidosService } from "../../services/serviciosPredefinidos";
import { materialesPredefinidosService } from "../../services/materialesPredefinidos";
import type { Servicio, CostoInterno, ItemInventario, Proveedor, MaterialPredefinido } from "../../types";
import type { ServicioPredefinido } from "../../services/serviciosPredefinidos";
import shared from "../../styles/shared.module.css";
import styles from "./EditarCotizacion.module.css";

const fmtCLP   = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const parseNum = (v: string) => parseInt(v.replace(/[^\d]/g, ""), 10) || 0;

const getTipoVehiculo = (tipo: string): "Auto" | "SUV" | "Camioneta" => {
  const t = (tipo || "").toLowerCase();
  if (t.includes("suv") || t.includes("jeep") || t.includes("todo terreno")) return "SUV";
  if (t.includes("camioneta") || t.includes("pickup") || t.includes("pick up")) return "Camioneta";
  return "Auto";
};

const getPrecioServicio = (svc: ServicioPredefinido, tipoVehiculo: string): number => {
  const t = getTipoVehiculo(tipoVehiculo);
  if (t === "SUV")       return svc.precioSUV       || 0;
  if (t === "Camioneta") return svc.precioCamioneta || 0;
  return svc.precioAuto || 0;
};

interface ServicioRow {
  nombre: string;
  descripcion: string;
  detalle: string;
  precio: string;
  cantidad: number;
}
interface CostoRow    { inventarioId: string; descripcion: string; proveedor: string; costo: string; precioVenta: string; cantidad: number; }

export default function EditarCotizacion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setLoading, notify } = useAppStore();

  const [patente,       setPatente]       = useState("");
  const [marca,         setMarca]         = useState("");
  const [modelo,        setModelo]        = useState("");
  const [anio,          setAnio]          = useState("");
  const [tipo,          setTipo]          = useState("");
  const [motor,         setMotor]         = useState("");
  const [nombre,        setNombre]        = useState("");
  const [telefono,      setTelefono]      = useState("");
  const [email,         setEmail]         = useState("");
  const [fecha,         setFecha]         = useState("");
  const [condiciones,   setCondiciones]   = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [numero,        setNumero]        = useState("");
  const [estadoCot,     setEstadoCot]     = useState("");

  const [servicios,       setServicios]       = useState<ServicioRow[]>([]);
  const [costos,          setCostos]          = useState<CostoRow[]>([]);
  // ─── DESCUENTO ──────────────────────────────────────────
  const [descuento,     setDescuento]     = useState(0);
  const [tipoDescuento, setTipoDescuento] = useState<'porcentaje' | 'monto'>('porcentaje');

  const [svcPredefinidos, setSvcPredefinidos] = useState<ServicioPredefinido[]>([]);
  const [svcFilters, setSvcFilters] = useState<{[k: number]: string}>({});
  const [matFilters, setMatFilters] = useState<{[k: number]: string}>({});
  const [materialesPred,   setMaterialesPred]   = useState<MaterialPredefinido[]>([]);
  const [invItems,           setInvItems]           = useState<ItemInventario[]>([]);

  const [proveedores,     setProveedores]     = useState<Proveedor[]>([]);
  const [modalCosto,      setModalCosto]      = useState(false);
  const [searchCosto,     setSearchCosto]     = useState("");
  const [selectedCosto,   setSelectedCosto]   = useState<ItemInventario | null>(null);
  const [cantCosto,       setCantCosto]       = useState(1);

  useEffect(() => { loadAll(); }, [id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [svcRes, invRes, provRes, matRes] = await Promise.all([
        serviciosPredefinidosService.getAll(),
        inventarioService.getAll(),
        proveedoresService.getAll(),
        materialesPredefinidosService.getAll(),
      ]);
      const svcData: ServicioPredefinido[] = svcRes.success && svcRes.data ? svcRes.data : [];
      if (svcRes.success  && svcRes.data)  setSvcPredefinidos(svcData);
      if (invRes.success  && invRes.data)  setInvItems(invRes.data);
      if (provRes.success && provRes.data) setProveedores(provRes.data);
      if (matRes.success  && matRes.data)  setMaterialesPred(matRes.data);

      if (!id) return;
      const res = await cotizacionesService.getById(id);
      if (!res.success || !res.data) {
        notify("Cotización no encontrada", "error");
        navigate("/cotizaciones");
        return;
      }

      const c = res.data;
      setPatente(c.patente   || "");
      setMarca(c.marca       || "");
      setModelo(c.modelo     || "");
      setAnio(c.anio         || "");
      setTipo(c.tipo         || "");
      setMotor(c.motor       || "");
      setCondiciones(c.condiciones   || "");
      setObservaciones(c.observaciones || "");
      setNumero(c.numero     || "");
      setEstadoCot(c.estado  || "");

      if (c.fecha) {
        const parts = c.fecha.split("/");
        if (parts.length === 3) {
          const year = parts[2].length === 2 ? "20" + parts[2] : parts[2];
          setFecha(`${year}-${parts[1]}-${parts[0]}`);
        }
      }

      try {
        const vRes = await vehiculosService.getByPatente(c.patente);
        if (vRes.success && vRes.data) {
          setNombre(vRes.data.owner    || c.nombre   || "");
          setTelefono(vRes.data.telefono || c.telefono || "");
          setEmail(vRes.data.email     || c.email    || "");
        } else {
          setNombre(c.nombre || ""); setTelefono(c.telefono || ""); setEmail(c.email || "");
        }
      } catch {
        setNombre(c.nombre || ""); setTelefono(c.telefono || ""); setEmail(c.email || "");
      }

      const allNombres = svcData.map(s => s.nombre);
      setServicios((c.servicios || []).map((s: Servicio) => ({
        nombre:      allNombres.includes(s.descripcion) ? s.descripcion : "",
        descripcion: allNombres.includes(s.descripcion) ? "" : s.descripcion,
        detalle:     (s as any).detalle || "",
        precio:      String(s.precio),
        cantidad:    s.cantidad,
      })));
      if (!(c.servicios || []).length) setServicios([{ nombre: "", descripcion: "", detalle: "", precio: "", cantidad: 1 }]);

      setCostos((c.costos || []).map((co: CostoInterno) => ({
        inventarioId: co.inventarioId || "",
        descripcion:  co.descripcion,
        proveedor:    co.proveedor || "",
        costo:        String(co.costo),
        precioVenta:  String(co.precioVenta || Math.round(co.costo * 1.3)),
        cantidad:     co.cantidad,
      })));
      // Cargar descuento existente si lo tenía
      if (c.descuento) {
        setDescuento(c.tipoDescuento === 'porcentaje' ? (c.descuentoPct || 0) : c.descuento);
        setTipoDescuento(c.tipoDescuento || 'porcentaje');
      }
    } catch {
      notify("Error al cargar cotización", "error");
    } finally {
      setLoading(false);
    }
  };

  const proveedorAtiendeMarca = (nombreProveedor: string): boolean => {
    if (!marca || !nombreProveedor) return false;
    const prov = proveedores.find(p => p.nombre.toLowerCase() === nombreProveedor.toLowerCase());
    if (!prov || !(prov.marcas || []).length) return false;
    return prov.marcas.some(m => m.toLowerCase() === marca.toLowerCase());
  };

  const totalManoObra         = servicios.reduce((s, r) => s + parseNum(r.precio) * r.cantidad, 0);
  const totalRepuestosCliente = costos.reduce((s, r) => s + parseNum(r.precioVenta) * r.cantidad, 0);
  const subtotal               = totalManoObra + totalRepuestosCliente;
  // El descuento se aplica SOLO sobre la Mano de Obra, nunca sobre repuestos.
  const descuentoMonto        = tipoDescuento === 'porcentaje'
    ? Math.round(totalManoObra * (descuento / 100))
    : Math.min(Math.round(descuento), totalManoObra);
  const totalGeneral          = Math.max(0, subtotal - descuentoMonto);
  const totalCostos           = costos.reduce((s, r) => s + parseNum(r.costo) * r.cantidad, 0);
  const profit                = totalGeneral - totalCostos;
  const margin                = totalGeneral > 0 && totalCostos > 0 ? (profit / totalGeneral) * 100 : null;
  const tipoLabel             = getTipoVehiculo(tipo);
  const esBloqueada           = estadoCot === "Aprobada" || estadoCot === "Rechazada";

  const addServicio    = () => setServicios([...servicios, { nombre: "", descripcion: "", detalle: "", precio: "", cantidad: 1 }]);
  const removeServicio = (i: number) => setServicios(servicios.filter((_, idx) => idx !== i));
  const updateServicioNombre = (i: number, nombre: string) => {
    const svc     = svcPredefinidos.find(s => s.nombre === nombre);
    const precio  = svc ? String(getPrecioServicio(svc, tipo)) : "";
    const detalle = svc?.detalle || "";
    setServicios(servicios.map((s, idx) => idx === i ? { ...s, nombre, precio, detalle } : s));
  };
  const updateServicio = (i: number, field: string, value: string | number) =>
    setServicios(servicios.map((s, idx) => idx === i ? { ...s, [field]: value } : s));

  // Agrega fila manual (sin inventario) a la tabla de costos
  const addMaterialExterno = () =>
    setCostos([...costos, { inventarioId: '', descripcion: '', proveedor: '', costo: '', precioVenta: '', cantidad: 1 }]);

  const agregarCosto = () => {
    if (!selectedCosto) return;
    const existe = costos.find(c => c.inventarioId === selectedCosto.id);
    if (existe) {
      setCostos(costos.map(c => c.inventarioId === selectedCosto.id
        ? { ...c, cantidad: c.cantidad + cantCosto } : c));
    } else {
      setCostos([...costos, {
        inventarioId: selectedCosto.id!,
        descripcion:  selectedCosto.nombre,
        proveedor:    selectedCosto.proveedor || "",
        costo:        String(selectedCosto.precioCompra || 0),
        precioVenta:  String(selectedCosto.precioVenta  || 0),
        cantidad:     cantCosto,
      }]);
    }
    setModalCosto(false); setSelectedCosto(null); setCantCosto(1); setSearchCosto("");
  };
  const removeCosto     = (inventarioId: string) => setCostos(costos.filter(c => c.inventarioId !== inventarioId));

  const filteredInvCostos = invItems
    .filter(i => {
      const q = searchCosto.toLowerCase();
      return !q ||
        i.nombre.toLowerCase().includes(q) ||
        (i.codigo    || "").toLowerCase().includes(q) ||
        (i.proveedor || "").toLowerCase().includes(q) ||
        (i as any).fabricante?.toLowerCase().includes(q) ||
        ((i as any).equivalencias || []).some((e: any) =>
          typeof e === 'string'
            ? e.toLowerCase().includes(q)
            : (`${e.fabricante || ''} ${e.codigo || ''}`).toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const aM = proveedorAtiendeMarca(a.proveedor || "");
      const bM = proveedorAtiendeMarca(b.proveedor || "");
      return aM && !bM ? -1 : !aM && bM ? 1 : 0;
    });

  const handleSubmit = async () => {
    if (esBloqueada) { notify("Esta cotización no puede ser modificada", "error"); return; }
    if (!nombre)     { notify("Ingresa el nombre del cliente", "error"); return; }
    const svcData: Servicio[] = servicios
      .filter(s => s.nombre)
      .map(s => ({
        descripcion: s.nombre,
        detalle:     s.detalle || undefined,
        precio:      parseNum(s.precio),
        cantidad:    s.cantidad,
        total:       parseNum(s.precio) * s.cantidad,
      }));
    if (!svcData.length) { notify("Agrega al menos un servicio", "error"); return; }

    const costData: CostoInterno[] = costos.map(c => ({
      inventarioId: c.inventarioId,
      descripcion:  c.descripcion,
      proveedor:    c.proveedor,
      costo:        parseNum(c.costo),
      precioVenta:  parseNum(c.precioVenta),
      cantidad:     c.cantidad,
      total:        parseNum(c.costo) * c.cantidad,
    }));

    const [y, m, d] = fecha.split("-");
    setLoading(true);
    try {
      await cotizacionesService.update(id!, {
        nombre, email, telefono, marca, modelo, anio, tipo, motor,
        fecha:       `${d}/${m}/${y.slice(2)}`,
        servicios:   svcData,
        total:       totalGeneral,
        totalIva:    Math.round(totalGeneral * 0.19),
        totalConIva: Math.round(totalGeneral * 1.19),
        condiciones, observaciones,
        costos:      costData,
        totalCostos,
        descuento:    descuentoMonto,
        tipoDescuento,
        descuentoPct: tipoDescuento === 'porcentaje' ? descuento : 0,
      });
      notify("Cotización actualizada ✓", "success");
      navigate("/cotizaciones");
    } catch {
      notify("Error al actualizar", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Editando <span>{numero}</span></div>
        <button className="btn btn-dark" onClick={() => navigate("/cotizaciones")}>← Volver</button>
      </div>

      {/* ── BANNERS ────────────────────────────────────────── */}
      {estadoCot === "Enviada" && (
        <div className={shared.bannerAdvertencia}>
          ⚠ Esta cotización fue <strong className={shared.bannerFuerte}>enviada al cliente</strong>.
          Los cambios reemplazarán la versión anterior. Si ya fue aprobada verbalmente,
          considera aprobarla directamente desde la lista.
        </div>
      )}
      {esBloqueada && (
        <div className={shared.bannerBloqueado}>
          🔒 Esta cotización está <strong className={shared.bannerFuerte}>{estadoCot}</strong> y no puede ser modificada.
        </div>
      )}

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
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={esBloqueada} />
            </div>
          </div>
          <div className="form-grid fg-2">
            <div className="field">
              <label>Marca</label>
              <input value={marca} onChange={e => setMarca(e.target.value)} disabled={esBloqueada}
                className={esBloqueada ? shared.inputDisabled : ""} />
            </div>
            <div className="field">
              <label>Modelo</label>
              <input value={modelo} onChange={e => setModelo(e.target.value)} disabled={esBloqueada}
                className={esBloqueada ? shared.inputDisabled : ""} />
            </div>
          </div>
          <div className={`form-grid fg-3 ${shared.formRow2}`}>
            <div className="field">
              <label>Año</label>
              <input value={anio} onChange={e => setAnio(e.target.value)} disabled={esBloqueada}
                className={esBloqueada ? shared.inputDisabled : ""} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)} disabled={esBloqueada}>
                <option value="">— Seleccionar —</option>
                <option value="AUTOMOVIL">Automóvil</option>
                <option value="SUV">SUV</option>
                <option value="CAMIONETA">Camioneta</option>
              </select>
            </div>
            <div className="field">
              <label>N° Motor</label>
              <input value={motor} onChange={e => setMotor(e.target.value)} disabled={esBloqueada}
                className={esBloqueada ? shared.inputDisabled : ""} />
            </div>
          </div>
          {tipo && (
            <div className={shared.tarifaBadge}>
              <span className={shared.tarifaLabel}>Tarifa: {tipoLabel}</span>
            </div>
          )}
        </div>

        <div className={`card ${shared.cardInner}`}>
          <div className="card-title">Datos del Cliente</div>
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
        </div>
      </div>

      {/* ── SERVICIOS ─────────────────────────────────────── */}
      <div className={shared.seccionTabla}>
        <div className={shared.seccionHeader}>
          <div className={`card-title ${styles.cardTitleFlush}`}>Servicios / Mano de Obra</div>
          {tipo && <span className={shared.preciosTarifa}>Precios para {tipoLabel}</span>}
        </div>
        <table className="svc-tbl">
          <thead>
            <tr>
              <th className={shared.colServicio}>Servicio</th>
              <th className={`r ${shared.colPrecio}`}>Precio M.O.</th>
              <th className={`r ${shared.colCantSvc}`}>Cant.</th>
              <th className={`r ${shared.colTotalSvc}`}>Total</th>
              <th className={shared.colAccion}></th>
            </tr>
          </thead>
          <tbody>
            {servicios.map((s, i) => (
              <tr key={i}>
                <td data-label="Servicio">
                  {!esBloqueada && (
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
                  )}
                  <select value={s.nombre} onChange={e => { updateServicioNombre(i, e.target.value); setSvcFilters(p => ({...p, [i]: ""})); }} disabled={esBloqueada}>
                    <option value="">— Seleccionar servicio —</option>
                    {svcPredefinidos
                      .filter(sv => !svcFilters[i] || sv.nombre.toLowerCase().includes((svcFilters[i]||"").toLowerCase()))
                      .map(sv => (
                        <option key={sv.id} value={sv.nombre}>
                          {sv.nombre}{tipo ? ` (${fmtCLP(getPrecioServicio(sv, tipo))})` : ""}
                        </option>
                      ))}
                  </select>
                  {(s.nombre || s.descripcion) && (
                    <textarea
                      value={(s as any).detalle || ""}
                      onChange={e => updateServicio(i, "detalle", e.target.value)}
                      placeholder="Descripción técnica del servicio (editable)..."
                      rows={3}
                      disabled={esBloqueada}
                      className={styles.detalleTextarea}
                    />
                  )}
                </td>
                <td data-label="Precio M.O.">
                  <input className="ri" value={s.precio}
                    onChange={e => updateServicio(i, "precio", e.target.value)}
                    placeholder="0" disabled={esBloqueada} />
                </td>
                <td data-label="Cant.">
                  <input type="number" className={`ri ${shared.inputCant}`} value={s.cantidad} min={1}
                    onChange={e => updateServicio(i, "cantidad", parseInt(e.target.value) || 1)}
                    disabled={esBloqueada} />
                </td>
                <td data-label="Total" className="r row-total">
                  <span>{fmtCLP(parseNum(s.precio) * s.cantidad)}</span>
                </td>
                <td className="r">
                  {!esBloqueada && (
                    <button className="btn-rm" onClick={() => removeServicio(i)}>
                      <svg width="13" height="13" viewBox="0 0 14 14">
                        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="svc-footer">
          {!esBloqueada && <button className="btn-ghost" onClick={addServicio}>+ Agregar Servicio</button>}
          <span className="row-total">{fmtCLP(totalManoObra)}</span>
        </div>

        {/* ── DESCUENTO (solo sobre Mano de Obra) ────────────── */}
        <div className={styles.descuentoBar}>
          <span className={styles.descuentoLabel}>Descuento (Mano de Obra)</span>
          <select
            value={tipoDescuento}
            onChange={e => { setTipoDescuento(e.target.value as 'porcentaje' | 'monto'); setDescuento(0); }}
            className={styles.descuentoTipoSelect}
            disabled={esBloqueada}
          >
            <option value="porcentaje">% Porcentaje</option>
            <option value="monto">$ Monto fijo</option>
          </select>
          <input
            type="number" min={0}
            max={tipoDescuento === 'porcentaje' ? 100 : totalManoObra}
            value={descuento || ''}
            onChange={e => setDescuento(Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0"
            className={styles.descuentoInput}
            disabled={esBloqueada}
          />
          {descuentoMonto > 0 && (
            <span className={styles.descuentoMonto}>− {fmtCLP(descuentoMonto)}</span>
          )}
        </div>
      </div>

      {/* ── REPUESTOS E INSUMOS ─────────────────────────────── */}
      <div className={shared.seccionTabla}>
        <div className={shared.seccionHeader}>
          <div className={`card-title ${styles.cardTitleFlush}`}>🔩 Repuestos e Insumos</div>
          <div className={styles.repuestosHeaderAcciones}>
            <span className={styles.costoInternoBadge}>Costo interno 🔒</span>
            {!esBloqueada && (
              <>
                <button className="btn btn-dark btn-sm" onClick={addMaterialExterno}>+ Repuesto/Insumo</button>
                <button className="btn btn-dark btn-sm" onClick={() => setModalCosto(true)}>+ Del Inventario</button>
              </>
            )}
          </div>
        </div>

        {costos.length === 0 ? (
          <div className={shared.emptyTabla}>Sin repuestos ni insumos</div>
        ) : (
          <table className="svc-tbl">
            <thead>
              <tr>
                <th className={shared.colItem}>Ítem</th>
                <th className={shared.colProveedor}>Proveedor</th>
                <th className={shared.colMarca}>Marca ✓</th>
                <th className={`r ${shared.colCosto}`}>Costo 🔒</th>
                <th className={`r ${shared.colPVenta}`}>P. Venta</th>
                <th className={`r ${shared.colCantCosto}`}>Cant.</th>
                <th className={`r ${shared.colSubtotal}`}>Subtotal</th>
                <th className={shared.colBorrar}></th>
              </tr>
            </thead>
            <tbody>
              {costos.map((c, i) => (
                <tr key={i}>
                  <td data-label="Ítem">
                    {c.inventarioId === '' ? (
                      <div className={styles.materialManualWrap}>
                        <div className={styles.filtroRow}>
                          <input
                            value={matFilters[i] || ""}
                            onChange={e => setMatFilters(p => ({...p, [i]: e.target.value}))}
                            placeholder="🔍 Buscar insumo/repuesto..."
                            className={styles.filtroInput}
                          />
                          {matFilters[i] && (
                            <button type="button" onClick={() => setMatFilters(p => ({...p, [i]: ""}))}
                              className={styles.filtroClear}>✕</button>
                          )}
                        </div>
                        <select
                          value={c.descripcion}
                          onChange={e => {
                            const val = e.target.value;
                            setMatFilters(p => ({...p, [i]: ""}));
                            if (val === '__manual__') {
                              setCostos(costos.map((x, idx) => idx === i ? {...x, descripcion: ''} : x));
                            } else {
                              setCostos(costos.map((x, idx) => idx === i ? {...x, descripcion: val} : x));
                            }
                          }}
                          disabled={esBloqueada}
                        >
                          <option value="">— Seleccionar —</option>
                          {materialesPred
                            .filter(mp => !matFilters[i] || mp.nombre.toLowerCase().includes((matFilters[i]||"").toLowerCase()))
                            .map(mp => (
                              <option key={mp.id} value={mp.nombre}>{mp.nombre} ({mp.unidad})</option>
                            ))}
                          <option value="__manual__">✏ Escribir manualmente</option>
                        </select>
                        {(c.descripcion === '' || !materialesPred.some(mp => mp.nombre === c.descripcion)) && (
                          <input
                            value={c.descripcion}
                            onChange={e => setCostos(costos.map((x, idx) => idx === i ? {...x, descripcion: e.target.value.toUpperCase()} : x))}
                            placeholder="Nombre del repuesto o insumo..."
                            disabled={esBloqueada}
                          />
                        )}
                      </div>
                    ) : c.descripcion}
                  </td>
                  <td data-label="Proveedor">{c.inventarioId === '' ? '—' : (c.proveedor || '—')}</td>
                  <td>
                    {c.inventarioId !== '' && c.proveedor && proveedorAtiendeMarca(c.proveedor)
                      ? <span className={shared.proveedorOk}>✓ {marca}</span>
                      : <span className={shared.proveedorNo}>—</span>
                    }
                  </td>
                  <td data-label="Costo 🔒" className="r hide-mobile">
                    {c.inventarioId === '' ? (
                      <input
                        className="ri"
                        value={c.costo}
                        onChange={e => {
                          const v = parseNum(e.target.value);
                          setCostos(costos.map((x, idx) => idx === i
                            ? {...x, costo: e.target.value, precioVenta: v > 0 ? String(Math.round(v * 1.3)) : ''}
                            : x));
                        }}
                        placeholder="Costo"
                        disabled={esBloqueada}
                      />
                    ) : fmtCLP(parseNum(c.costo))}
                  </td>
                  <td data-label="P. Venta" className="r">
                    {c.inventarioId === '' ? (
                      <input
                        className={`ri ${styles.precioVentaInput}`}
                        value={c.precioVenta}
                        onChange={e => setCostos(costos.map((x, idx) => idx === i ? {...x, precioVenta: e.target.value} : x))}
                        placeholder="Venta"
                        disabled={esBloqueada}
                      />
                    ) : fmtCLP(parseNum(c.precioVenta))}
                  </td>
                  <td>
                    <input type="number" className={`ri ${shared.inputCantOT}`} value={c.cantidad} min={0} step={0.1}
                      onChange={e => {
                        const cant = parseFloat(e.target.value) || 0;
                        setCostos(costos.map((x, idx) => idx === i ? {...x, cantidad: cant} : x));
                      }}
                      disabled={esBloqueada} />
                  </td>
                  <td className="r">
                    <span className="crt">{fmtCLP(parseNum(c.precioVenta) * c.cantidad)}</span>
                  </td>
                  <td className="r">
                    {!esBloqueada && (
                      <button className="btn-rm" onClick={() => {
                        if (c.inventarioId === '') {
                          setCostos(costos.filter((_, idx) => idx !== i));
                        } else {
                          removeCosto(c.inventarioId);
                        }
                      }}>
                        <svg width="13" height="13" viewBox="0 0 14 14">
                          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className={`total-bar ${shared.totalBarWrap}`}>
          <div className={shared.totalBarRow}>
            <span className="total-lbl">Mano de Obra</span>
            <span className={shared.totalBarValor}>{fmtCLP(totalManoObra)}</span>
          </div>
          {descuentoMonto > 0 && (
            <div className={`${shared.totalBarRow} ${styles.descuentoRowVerde}`}>
              <span className="total-lbl">
                Descuento {tipoDescuento === 'porcentaje' ? `(${descuento}%)` : ''}
              </span>
              <span className={shared.totalBarValor}>− {fmtCLP(descuentoMonto)}</span>
            </div>
          )}
          {totalRepuestosCliente > 0 && (
            <div className={shared.totalBarRow}>
              <span className="total-lbl">Repuestos e Insumos</span>
              <span className={shared.totalBarValor}>{fmtCLP(totalRepuestosCliente)}</span>
            </div>
          )}
          <div className={shared.totalBarRowSep}>
            <span className="total-lbl">Subtotal</span>
            <span className={shared.totalBarValor}>{fmtCLP(totalGeneral)}</span>
          </div>
          <div className={shared.totalBarRowIva}>
            <span className="total-lbl">IVA 19%</span>
            <span className={shared.totalBarValor}>{fmtCLP(Math.round(totalGeneral * 0.19))}</span>
          </div>
          <div className={shared.totalBarRowTotal}>
            <span className="total-lbl">Total</span>
            <span className="total-val">{fmtCLP(Math.round(totalGeneral * 1.19))}</span>
          </div>
        </div>

        <div className="costs-summary">
          <div className="cs-cell">
            <span className="cs-lbl">Total c/IVA</span>
            <span className={`cs-val ${shared.csValCliente}`}>
              {fmtCLP(Math.round(totalGeneral * 1.19))}
            </span>
          </div>
          <div className="cs-cell">
            <span className="cs-lbl">Costo Compra 🔒</span>
            <span className={`cs-val ${shared.csValCosto}`}>{fmtCLP(totalCostos)}</span>
          </div>
          <div className="cs-cell">
            <span className="cs-lbl">Utilidad Estimada 🔒</span>
            <span className={`cs-val ${
              margin === null ? "" : margin >= 30 ? "margin-good" : margin >= 15 ? "margin-mid" : "margin-low"
            }`}>
              {margin !== null ? `${fmtCLP(profit)} (${margin.toFixed(1)}%)` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── CONDICIONES + OBSERVACIONES ───────────────────── */}
      <div className={`card ${styles.cardConMargen}`}>
        <div className="card-title">Condiciones y Observaciones</div>
        <div className="form-grid fg-2">
          <div className="field">
            <label>Condiciones</label>
            <textarea value={condiciones} onChange={e => setCondiciones(e.target.value)}
              rows={5} className={shared.textarea} disabled={esBloqueada} />
          </div>
          <div className="field">
            <label>Observaciones</label>
            <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
              rows={5} className={shared.textarea} placeholder="Notas para el cliente..."
              disabled={esBloqueada} />
          </div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-dark" onClick={() => navigate("/cotizaciones")}>
          {esBloqueada ? "← Volver" : "Cancelar"}
        </button>
        {!esBloqueada && (
          <button className={`btn btn-primary ${shared.btnGuardar}`} onClick={handleSubmit}>
            💾 Guardar Cambios
          </button>
        )}
      </div>

      {/* ── MODAL COSTOS ──────────────────────────────────── */}
      {modalCosto && (
        <div className="overlay open">
          <div className={`modal ${shared.modalInventario}`}>
            <div className="modal-title">Agregar Repuesto desde Inventario</div>
            <div className={shared.modalInventarioInfo}>
              <span>Se muestra precio compra (interno) y precio venta (cliente)</span>
              {marca && <span className={shared.modalInventarioMarca}>Vehículo: {marca.toUpperCase()}</span>}
            </div>
            <div className={`field ${shared.modalBuscarField}`}>
              <label>Buscar</label>
              <input type="text" value={searchCosto} onChange={e => setSearchCosto(e.target.value)}
                placeholder="Nombre, código, proveedor..." autoFocus />
            </div>
            <div className={shared.modalInventarioLista}>
              {filteredInvCostos.length === 0
                ? <div className={shared.modalInventarioEmpty}>Sin resultados</div>
                : filteredInvCostos.map(item => {
                  const isSelected = selectedCosto?.id === item.id;
                  const atiende    = proveedorAtiendeMarca(item.proveedor || "");
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedCosto(isSelected ? null : item)}
                      className={`${styles.invItemCard} ${atiende ? styles.atiende : ''} ${isSelected ? styles.seleccionado : ''}`}
                    >
                      <div>
                        <div className={shared.invItemRow}>
                          <span className={shared.invItemNombre}>{item.nombre}</span>
                          {atiende && <span className={shared.invItemBadgeMarca}>✓ Proveedor atiende {marca}</span>}
                        </div>
                        <div className={shared.invItemMeta}>
                          {item.categoria}{item.proveedor ? ` · ${item.proveedor}` : ""}
                        </div>
                      </div>
                      <div className={shared.invItemPrecios}>
                        <div className={shared.invItemPrecioCompra}>🔒 Compra: {fmtCLP(item.precioCompra || 0)}</div>
                        <div className={shared.invItemPrecioVenta}>Venta: {fmtCLP(item.precioVenta || 0)}</div>
                      </div>
                    </div>
                  );
                })
              }
            </div>
            {selectedCosto && (
              <div className={shared.selectedItemWrap}>
                <div className={shared.selectedItemInfo}>
                  <div className={shared.selectedItemNombre}>{selectedCosto.nombre}</div>
                  <div className={shared.selectedItemPrecios}>
                    <span className={shared.selectedItemPrecioCompra}>
                      🔒 Compra: {fmtCLP(selectedCosto.precioCompra || 0)}
                    </span>
                    <span className={shared.selectedItemPrecioVenta}>
                      Venta cliente: {fmtCLP(selectedCosto.precioVenta || 0)}
                    </span>
                  </div>
                </div>
                <div className={`field ${shared.selectedItemCantField}`}>
                  <label>Cantidad {selectedCosto && ['LITRO','LITROS','KG','KGS','METRO','METROS'].includes((selectedCosto.unidad||'').toUpperCase()) ? `(${selectedCosto.unidad})` : ''}</label>
                  <input
                    type="number"
                    value={cantCosto}
                    min={0}
                    step={selectedCosto && ['LITRO','LITROS','KG','KGS','METRO','METROS'].includes((selectedCosto.unidad||'').toUpperCase()) ? 0.1 : 1}
                    onChange={e => setCantCosto(Math.max(0, parseFloat(e.target.value) || 0))}
                  />
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => {
                setModalCosto(false); setSelectedCosto(null); setCantCosto(1); setSearchCosto("");
              }}>
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={!selectedCosto} onClick={agregarCosto}>
                + Agregar Repuesto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}