import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { ordenesService } from "../../services/ordenes";
import { inventarioService } from "../../services/inventario";
import type { OrdenTrabajo, ItemInventario } from "../../types";
import { ingresoRealOT } from "../../types";
import styles from "./Estadisticas.module.css";

const fmtCLP = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

type Granularidad = "dia" | "semana" | "mes";
type Rango = "30" | "90" | "180" | "365" | "todo";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─── FECHAS ──────────────────────────────────────────────
// La fecha de entrega real puede haber quedado guardada en dos formatos
// distintos según cómo se haya generado (input type="date" del navegador
// = "YYYY-MM-DD", o el valor por defecto que arma el backend = "DD/MM/YYYY").
// Este parser soporta ambos.
const parseFecha = (s: string): Date | null => {
  if (!s) return null;
  if (s.includes("T")) s = s.slice(0, 10); // ISO con hora (ej: createdAt) → solo la fecha
  if (s.includes("-")) {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  if (s.includes("/")) {
    const [d, m, yRaw] = s.split("/").map(Number);
    if (!d || !m || !yRaw) return null;
    // Fechas antiguas quedaron guardadas con año de 2 dígitos (ej: "26" en vez
    // de "2026"). new Date(26, ...) en JS lo interpreta como el año 1926, no
    // 2026 — hay que expandirlo a 4 dígitos antes de construir la fecha.
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return new Date(y, m - 1, d);
  }
  return null;
};

const fmtDDMMYY = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;

const fmtDDMM = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

// Algoritmo estándar ISO-8601 para número de semana
const getSemanaISO = (date: Date): { anio: number; semana: number } => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { anio: d.getUTCFullYear(), semana };
};

const getLunesDeSemana = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

interface Periodo { key: string; label: string; orden: number; }

const getPeriodo = (fecha: Date, granularidad: Granularidad): Periodo => {
  if (granularidad === "dia") {
    const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
    return { key, label: fmtDDMMYY(fecha), orden: fecha.getTime() };
  }
  if (granularidad === "mes") {
    const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
    const orden = new Date(fecha.getFullYear(), fecha.getMonth(), 1).getTime();
    return { key, label: `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`, orden };
  }
  const { anio, semana } = getSemanaISO(fecha);
  const lunes   = getLunesDeSemana(fecha);
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const key = `${anio}-W${String(semana).padStart(2, "0")}`;
  return { key, label: `Sem ${semana} · ${fmtDDMM(lunes)}–${fmtDDMM(domingo)}`, orden: lunes.getTime() };
};

interface PeriodoStats {
  key: string;
  label: string;
  orden: number;
  cantidadOT: number;
  ventaNeta: number;
  costo: number;
  ganancia: number;
  iva: number;
  ivaCreditoRepuestos: number;
  costoIncompleto: boolean;
}

// Fecha a usar para agrupar: idealmente la entrega real, pero si por algún
// motivo no quedó guardada (bug antiguo corregido), no se descarta la OT —
// se usa la entrega estimada o, en su defecto, la fecha de creación.
const fechaParaAgrupar = (o: OrdenTrabajo): string | null =>
  o.fechaEntregaReal || o.fechaEntregaEstimada || o.createdAt || null;

// Agrupa una lista de OT entregadas en estadísticas por período (día/semana/mes).
// Reutilizado tanto por la tabla histórica como por el resumen del mes seleccionado.
function agruparPorPeriodo(
  items: OrdenTrabajo[],
  granularidad: Granularidad,
  inventarioMap: Map<string, ItemInventario>
): PeriodoStats[] {
  const mapa = new Map<string, PeriodoStats>();

  for (const ot of items) {
    const fecha = parseFecha(fechaParaAgrupar(ot)!);
    if (!fecha) continue;
    const { key, label, orden } = getPeriodo(fecha, granularidad);

    // Ingreso real: si se cobró sin IVA, el monto completo es ganancia
    // (no hay IVA que remitir al SII); si se cobró con IVA, el 19% no es
    // ganancia, así que el ingreso real es el neto.
    const ventaNeta = ingresoRealOT(ot);
    const iva = ot.pagoSinIva ? 0 : (ot.totalIva ?? Math.round((ot.total || 0) * 0.19));

    // precioCompra (Inventario) y el "Costo" que se ingresa a mano en materiales
    // externos se guardan CON IVA incluido — es lo que realmente se pagó al
    // proveedor. Para comparar contra la venta (que sí es neta) y para calcular
    // el crédito fiscal real, hay que separar ese monto en neto + IVA.
    let costoRepuestosBruto = 0;
    let costoIncompleto = false;
    for (const rep of ot.repuestos || []) {
      const item = inventarioMap.get(rep.inventarioId);
      if (item) costoRepuestosBruto += (item.precioCompra || 0) * rep.cantidad;
      else costoIncompleto = true;
    }
    const costoRepuestosNeto = costoRepuestosBruto / 1.19;

    // Materiales externos (sin inventario): usa el costo real que se guardó al
    // agregarlos (también con IVA incluido, mismo criterio que precioCompra).
    // Para OT antiguas que se guardaron antes de este fix y no tienen el costo
    // real, se estima dividiendo por 1.3 — el inverso exacto de la fórmula que
    // usa el formulario para calcular el precio de venta (Venta = Costo × 1,3).
    let costoMaterialesExternos = 0;
    for (const mat of ot.materialesExternos || []) {
      if (mat.costo != null) {
        costoMaterialesExternos += (mat.costo * (mat.cantidad || 1)) / 1.19;
      } else {
        const totalMat = mat.total ?? (mat.precio || 0) * (mat.cantidad || 0);
        costoMaterialesExternos += totalMat / 1.3;
      }
    }

    const costo    = costoRepuestosNeto + costoMaterialesExternos;
    const ganancia = ventaNeta - costo;
    // IVA que se puede usar como crédito fiscal: el que se pagó al comprar
    // los repuestos a los proveedores (precioCompra se guarda neto).
    const ivaCreditoRepuestos = costoRepuestosBruto - costoRepuestosNeto;

    const prev = mapa.get(key);
    if (prev) {
      prev.cantidadOT          += 1;
      prev.ventaNeta           += ventaNeta;
      prev.costo               += costo;
      prev.ganancia            += ganancia;
      prev.iva                 += iva;
      prev.ivaCreditoRepuestos += ivaCreditoRepuestos;
      prev.costoIncompleto = prev.costoIncompleto || costoIncompleto;
    } else {
      mapa.set(key, { key, label, orden, cantidadOT: 1, ventaNeta, costo, ganancia, iva, ivaCreditoRepuestos, costoIncompleto });
    }
  }

  return Array.from(mapa.values()).sort((a, b) => b.orden - a.orden);
}

const labelDeKeyMes = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};

export default function Estadisticas() {
  const { ordenes, setOrdenes, inventario, setInventario, setLoading, notify } = useAppStore();
  const [granularidad, setGranularidad] = useState<Granularidad>("mes");
  const [rango, setRango] = useState<Rango>("todo");

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ordRes, invRes] = await Promise.all([
        ordenesService.getAll(),
        inventarioService.getAll(),
      ]);
      if (ordRes.success && ordRes.data) setOrdenes(ordRes.data);
      if (invRes.success && invRes.data) setInventario(invRes.data);
    } catch {
      notify("Error al cargar estadísticas", "error");
    } finally {
      setLoading(false);
    }
  };

  const inventarioMap = useMemo(() => {
    const m = new Map<string, ItemInventario>();
    inventario.forEach(i => { if (i.id) m.set(i.id, i); });
    return m;
  }, [inventario]);

  // Fecha a usar para agrupar: idealmente la entrega real, pero si por algún
  // motivo no quedó guardada (bug antiguo corregido), no se descarta la OT —
  // se usa la entrega estimada o, en su defecto, la fecha de creación.
  const entregadas = useMemo(
    () => ordenes.filter((o: OrdenTrabajo) => o.estado === "Entregado" && !!fechaParaAgrupar(o)),
    [ordenes]
  );

  const entregadasEnRango = useMemo(() => {
    if (rango === "todo") return entregadas;
    const dias = parseInt(rango, 10);
    const limite = new Date();
    limite.setHours(0, 0, 0, 0);
    limite.setDate(limite.getDate() - dias);
    return entregadas.filter(o => {
      const f = parseFecha(fechaParaAgrupar(o)!);
      return f !== null && f >= limite;
    });
  }, [entregadas, rango]);

  // Tabla histórica: respeta los filtros de rango/granularidad que elija el usuario
  const statsPorPeriodo = useMemo(
    () => agruparPorPeriodo(entregadasEnRango, granularidad, inventarioMap),
    [entregadasEnRango, granularidad, inventarioMap]
  );

  // Resumen de arriba: SIEMPRE agrupado por mes y sobre TODO el historial
  // (independiente de los filtros de la tabla), para poder mostrar cualquier
  // mes que el usuario quiera mirar — por defecto, el mes actual.
  const statsPorMes = useMemo(
    () => agruparPorPeriodo(entregadas, "mes", inventarioMap),
    [entregadas, inventarioMap]
  );

  const hoy = new Date();
  const mesActualKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const [mesSeleccionado, setMesSeleccionado] = useState(mesActualKey);

  const statsDelMes: PeriodoStats = statsPorMes.find(p => p.key === mesSeleccionado) ?? {
    key: mesSeleccionado, label: labelDeKeyMes(mesSeleccionado), orden: 0,
    cantidadOT: 0, ventaNeta: 0, costo: 0, ganancia: 0, iva: 0, ivaCreditoRepuestos: 0, costoIncompleto: false,
  };

  const mesesDisponibles = useMemo(() => {
    const claves = new Set(statsPorMes.map(p => p.key));
    claves.add(mesActualKey);
    return Array.from(claves).sort().reverse().map(key => ({ key, label: labelDeKeyMes(key) }));
  }, [statsPorMes, mesActualKey]);

  const totales = useMemo(() => statsPorPeriodo.reduce((acc, p) => ({
    ventaNeta:  acc.ventaNeta  + p.ventaNeta,
    costo:      acc.costo      + p.costo,
    ganancia:   acc.ganancia   + p.ganancia,
    iva:        acc.iva        + p.iva,
    ivaCreditoRepuestos: acc.ivaCreditoRepuestos + p.ivaCreditoRepuestos,
    cantidadOT: acc.cantidadOT + p.cantidadOT,
  }), { ventaNeta: 0, costo: 0, ganancia: 0, iva: 0, ivaCreditoRepuestos: 0, cantidadOT: 0 }), [statsPorPeriodo]);

  const margenPromedio = totales.ventaNeta > 0 ? (totales.ganancia / totales.ventaNeta) * 100 : null;
  const margenDelMes   = statsDelMes.ventaNeta > 0 ? (statsDelMes.ganancia / statsDelMes.ventaNeta) * 100 : null;

  const margenClass = (margen: number | null) =>
    margen === null ? "mg-none" : margen >= 30 ? "mg-good" : margen >= 15 ? "mg-mid" : "mg-low";

  // Para texto sobre fondo oscuro (stat-cards), distinto de los badges de la tabla
  const margenStatClass = (margen: number | null) =>
    margen === null ? styles.margenNulo : margen >= 30 ? "margin-good" : margen >= 15 ? "margin-mid" : "margin-low";

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Estadísticas <span>· {statsDelMes.label}</span></div>
        <div className={styles.headerActions}>
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
          <button className="btn btn-dark btn-sm" onClick={loadAll}>↻ Actualizar</button>
        </div>
      </div>

      {/* ── STAT CARDS: solo el mes seleccionado (por defecto, el actual) ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{statsDelMes.cantidadOT}</div>
          <div className="stat-label">OT Entregadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(statsDelMes.ventaNeta)}</div>
          <div className="stat-label">Venta Neta</div>
        </div>
        <div className="stat-card dark">
          <div className={`stat-value ${styles.costoValue}`}>{fmtCLP(statsDelMes.costo)}</div>
          <div className="stat-label">Costo</div>
        </div>
        <div className="stat-card dark">
          <div className={`stat-value ${margenStatClass(margenDelMes)}`}>
            {fmtCLP(statsDelMes.ganancia)}
          </div>
          <div className="stat-label">Ganancia</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.ivaValue}`}>{fmtCLP(statsDelMes.iva)}</div>
          <div className="stat-label">IVA a Pagar (ventas)</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.creditoValue}`}>{fmtCLP(statsDelMes.ivaCreditoRepuestos)}</div>
          <div className="stat-label">Crédito Fiscal (Repuestos)</div>
        </div>
        <div className="stat-card dark">
          <div className={`stat-value ${styles.ivaValue}`}>{fmtCLP(Math.max(0, statsDelMes.iva - statsDelMes.ivaCreditoRepuestos))}</div>
          <div className="stat-label">IVA Neto a Pagar</div>
        </div>
        <div className="stat-card dark">
          <div className={`stat-value ${margenStatClass(margenDelMes)}`}>
            {margenDelMes !== null ? `${margenDelMes.toFixed(1)}%` : "—"}
          </div>
          <div className="stat-label">Margen del Mes</div>
        </div>
      </div>

      <div className={styles.tablaHistoricaTitulo}>Historial completo (usa los filtros de abajo para explorar otros períodos)</div>

      {/* ── CONTROLES ──────────────────────────────────────── */}
      <div className={styles.controlsBar}>
        <div className={styles.granTabs}>
          <button className={`${styles.granTab} ${granularidad === "dia"    ? styles.granTabActive : ""}`} onClick={() => setGranularidad("dia")}>Día</button>
          <button className={`${styles.granTab} ${granularidad === "semana" ? styles.granTabActive : ""}`} onClick={() => setGranularidad("semana")}>Semana</button>
          <button className={`${styles.granTab} ${granularidad === "mes"    ? styles.granTabActive : ""}`} onClick={() => setGranularidad("mes")}>Mes</button>
        </div>
        <div className={`field ${styles.rangoSelectWrap}`}>
          <select value={rango} onChange={e => setRango(e.target.value as Rango)}>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="180">Últimos 180 días</option>
            <option value="365">Últimos 12 meses</option>
            <option value="todo">Todo el historial</option>
          </select>
        </div>
      </div>

      {/* ── NOTA METODOLÓGICA ──────────────────────────────── */}
      <div className={styles.infoNote}>
        <span>ℹ Calculado sobre OT <strong>Entregadas</strong>, agrupadas por fecha de entrega real
        (o de respaldo si esta no quedó registrada). <strong>Venta Neta</strong> = ingreso real: si el
        pago fue sin IVA se cuenta el monto completo (no hay impuesto que remitir); si fue con IVA se
        cuenta solo el neto. Costo de repuestos de inventario y materiales externos = precio de compra
        real (con IVA incluido, tal como se ingresa), descompuesto a neto para comparar contra la venta
        (o, en OT antiguas sin costo real guardado, precio cobrado ÷ 1,3 como estimación —el inverso
        de la fórmula de venta). La mano de
        obra se cuenta 100% como ganancia. <strong>Crédito Fiscal (Repuestos)</strong> es
        el IVA ya pagado a los proveedores al comprar los repuestos, que se descuenta del IVA a pagar.</span>
      </div>

      {/* ── TABLA ───────────────────────────────────────────── */}
      {statsPorPeriodo.length === 0 ? (
        <div className="card">
          <div className={styles.emptyState}>No hay OT entregadas en el rango seleccionado.</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="r">OT</th>
                <th className="r">Venta Neta</th>
                <th className="r">Costo</th>
                <th className="r">Ganancia</th>
                <th className="r">Margen</th>
                <th className="r">IVA a Pagar</th>
                <th className="r">Créd. Fiscal</th>
              </tr>
            </thead>
            <tbody>
              {statsPorPeriodo.map(p => {
                const margen = p.ventaNeta > 0 ? (p.ganancia / p.ventaNeta) * 100 : null;
                return (
                  <tr key={p.key}>
                    <td data-label="Periodo">
                      {p.label}
                      {p.costoIncompleto && (
                        <span className={styles.warnBadge} title="Uno o más repuestos ya no existen en inventario; su costo no se pudo calcular y se asumió $0.">⚠</span>
                      )}
                    </td>
                    <td data-label="OT" className="r">{p.cantidadOT}</td>
                    <td data-label="Venta Neta" className="r price-cell">{fmtCLP(p.ventaNeta)}</td>
                    <td data-label="Costo" className="r">{fmtCLP(p.costo)}</td>
                    <td data-label="Ganancia" className="r">
                      <span className={`margin-badge ${margenClass(margen)}`}>{fmtCLP(p.ganancia)}</span>
                    </td>
                    <td data-label="Margen" className="r">
                      <span className={`margin-badge ${margenClass(margen)}`}>{margen !== null ? `${margen.toFixed(1)}%` : "—"}</span>
                    </td>
                    <td data-label="IVA a Pagar" className="r">{fmtCLP(p.iva)}</td>
                    <td data-label="Créd. Fiscal" className="r hide-mobile">{fmtCLP(p.ivaCreditoRepuestos)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <td><strong>Total</strong></td>
                <td className="r"><strong>{totales.cantidadOT}</strong></td>
                <td className="r"><strong>{fmtCLP(totales.ventaNeta)}</strong></td>
                <td className="r"><strong>{fmtCLP(totales.costo)}</strong></td>
                <td className="r"><strong>{fmtCLP(totales.ganancia)}</strong></td>
                <td className="r"><strong>{margenPromedio !== null ? `${margenPromedio.toFixed(1)}%` : "—"}</strong></td>
                <td className="r"><strong>{fmtCLP(totales.iva)}</strong></td>
                <td className="r hide-mobile"><strong>{fmtCLP(totales.ivaCreditoRepuestos)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}