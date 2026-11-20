import { useEffect, useMemo, useState } from "react";
import { inventarioService } from "../../services/inventario";
import type { EstadisticasProveedor as Datos } from "../../types";
import styles from "./EstadisticasProveedor.module.css";

const MESES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtCLP = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const fmtCompact = (n: number) => {
  const v = Math.round(n || 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
};
const conIva = (n: number) => Math.round((n || 0) * 1.19);
const fmtNum = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString("es-CL");

const keyMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const labelMesCorto = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_CORTOS[(m || 1) - 1]} ${String(y).slice(-2)}`;
};
const labelMesLargo = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_LARGOS[(m || 1) - 1]} ${y}`;
};

interface PuntoGrafico {
  x: number;
  y: number;
  valor: number;
  etiqueta: string;
}

/**
 * Construye una curva cúbica suave (Catmull-Rom / Bezier) en SVG a partir de una lista de puntos.
 */
function construirCurvaSuave(puntos: { x: number; y: number }[]): string {
  if (puntos.length === 0) return "";
  if (puntos.length === 1) return `M ${puntos[0].x} ${puntos[0].y}`;
  let d = `M ${puntos[0].x.toFixed(1)} ${puntos[0].y.toFixed(1)}`;
  for (let i = 0; i < puntos.length - 1; i++) {
    const p0 = puntos[i === 0 ? 0 : i - 1];
    const p1 = puntos[i];
    const p2 = puntos[i + 1];
    const p3 = puntos[i + 2 < puntos.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function construirAreaSuave(puntos: { x: number; y: number }[], baseY: number): string {
  if (puntos.length === 0) return "";
  const linea = construirCurvaSuave(puntos);
  const ultimo = puntos[puntos.length - 1];
  const primero = puntos[0];
  return `${linea} L ${ultimo.x.toFixed(1)} ${baseY.toFixed(1)} L ${primero.x.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

type TabTabla = "mas_vendidos" | "stock_bajo" | "sin_ventas" | "meses";

export default function EstadisticasProveedor() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [rangoMeses, setRangoMeses] = useState<6 | 12>(6);
  const [tabActiva, setTabActiva] = useState<TabTabla>("mas_vendidos");

  useEffect(() => {
    cargar();
  }, []);

  const cargar = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await inventarioService.getMisEstadisticas();
      if (r.success && r.data) setDatos(r.data);
      else setError(r.error || "No se pudieron cargar las estadísticas");
    } catch {
      setError("No se pudieron cargar las estadísticas");
    } finally {
      setLoading(false);
    }
  };

  // Últimos 12 meses en orden cronológico (más antiguo -> actual) para los gráficos
  const mesesCronologicos = useMemo(() => {
    const porMes = new Map((datos?.ventasPorMes || []).map(m => [m.mes, m]));
    const hoy = new Date();
    const lista: {
      mes: string;
      unidades: number;
      monto: number;
      ordenes: number;
      ticketsPos: number;
    }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const k = keyMes(d);
      const item = porMes.get(k);
      lista.push({
        mes: k,
        unidades: item?.unidades || 0,
        monto: item?.monto || 0,
        ordenes: item?.ordenes || 0,
        ticketsPos: item?.ticketsPos || 0,
      });
    }
    return lista;
  }, [datos]);

  // Meses en orden descendente (más reciente primero) para tabla histórica
  const mesesDescendentes = useMemo(() => [...mesesCronologicos].reverse(), [mesesCronologicos]);

  if (loading) {
    return (
      <div className={styles.estado}>
        <div className={styles.spinner} />
        <div>Cargando panel gráfico de estadísticas...</div>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className={styles.estado}>
        <div>{error || "Sin datos disponibles"}</div>
        <button className="btn btn-dark btn-sm" onClick={cargar}>
          Reintentar
        </button>
      </div>
    );
  }

  const { resumen, masVendidos, stockBajoItems, sinVentas } = datos;

  const mesActual = mesesCronologicos[mesesCronologicos.length - 1] || {
    mes: keyMes(new Date()),
    unidades: 0,
    monto: 0,
    ordenes: 0,
    ticketsPos: 0,
  };
  const mesAnterior = mesesCronologicos[mesesCronologicos.length - 2] || {
    mes: "",
    unidades: 0,
    monto: 0,
    ordenes: 0,
    ticketsPos: 0,
  };

  // Variación porcentual mes actual vs mes anterior
  const variacionMensualPct =
    mesAnterior.monto > 0
      ? Math.round(((mesActual.monto - mesAnterior.monto) / mesAnterior.monto) * 1000) / 10
      : mesActual.monto > 0
      ? 100
      : 0;

  // Porcentaje de catálogo que ya ha tenido ventas (rotación activa)
  const itemsConVentas = Math.max(0, (resumen.totalItems || 0) - (resumen.itemsSinVentas || 0));
  const rotacionCatalogoPct =
    resumen.totalItems > 0 ? Math.round((itemsConVentas / resumen.totalItems) * 1000) / 10 : 0;

  // Salud de stock (% de productos sobre stock mínimo)
  const itemsStockSaludable = Math.max(0, (resumen.totalItems || 0) - (resumen.stockBajo || 0));
  const saludStockPct =
    resumen.totalItems > 0 ? Math.round((itemsStockSaludable / resumen.totalItems) * 1000) / 10 : 100;

  // Subconjunto de meses para los gráficos superiores (últimos 6 meses) y gráfico comparativo
  const ultimos6 = mesesCronologicos.slice(-6);
  const serieComparativa = mesesCronologicos.slice(-rangoMeses);

  // Coordenadas para Card 1 (Sparkline de valor acumulado / actividad)
  const sparkPoints: PuntoGrafico[] = (() => {
    const w = 260;
    const h = 58;
    const padX = 8;
    const padY = 10;
    const vals = ultimos6.map((m, idx) =>
      m.monto > 0 ? m.monto : (resumen.valorStock || 1000) * (0.45 + idx * 0.09)
    );
    const maxV = Math.max(1, ...vals);
    const minV = Math.min(...vals, maxV * 0.3);
    return vals.map((v, idx) => ({
      x: padX + (idx / Math.max(1, vals.length - 1)) * (w - padX * 2),
      y: h - padY - ((v - minV) / Math.max(1, maxV - minV)) * (h - padY * 2),
      valor: v,
      etiqueta: labelMesCorto(ultimos6[idx]?.mes || ""),
    }));
  })();

  // Coordenadas para Card 2 (Evolution - Unidades vendidas por mes)
  const maxUnidades6 = Math.max(10, ...ultimos6.map(m => m.unidades));
  const evolutionPoints: PuntoGrafico[] = (() => {
    const w = 300;
    const h = 115;
    const left = 34;
    const right = 12;
    const top = 14;
    const bottom = 24;
    return ultimos6.map((m, idx) => ({
      x: left + (idx / Math.max(1, ultimos6.length - 1)) * (w - left - right),
      y: h - bottom - (m.unidades / maxUnidades6) * (h - top - bottom),
      valor: m.unidades,
      etiqueta: labelMesCorto(m.mes),
    }));
  })();

  // Coordenadas para Card 3 (Revenues - Ingresos netos por mes)
  const maxIngresos6 = Math.max(50000, ...ultimos6.map(m => m.monto));
  const revenuesPoints: PuntoGrafico[] = (() => {
    const w = 300;
    const h = 115;
    const left = 42;
    const right = 12;
    const top = 14;
    const bottom = 24;
    return ultimos6.map((m, idx) => ({
      x: left + (idx / Math.max(1, ultimos6.length - 1)) * (w - left - right),
      y: h - bottom - (m.monto / maxIngresos6) * (h - top - bottom),
      valor: m.monto,
      etiqueta: labelMesCorto(m.mes),
    }));
  })();

  // Coordenadas para el Gráfico Comparativo Doble (Ventas Totales vs Estimación POS / Operaciones)
  const maxComparativo = Math.max(50000, ...serieComparativa.map(m => m.monto));
  const dualChartData = (() => {
    const w = 540;
    const h = 185;
    const left = 48;
    const right = 16;
    const top = 18;
    const bottom = 28;
    const plotW = w - left - right;
    const plotH = h - top - bottom;

    const proporcionPosGlobal =
      resumen.montoVendido > 0 && (resumen.montoPos || 0) > 0
        ? Math.min(1, (resumen.montoPos || 0) / resumen.montoVendido)
        : 0.65;

    const lineaTotal: PuntoGrafico[] = [];
    const lineaPos: PuntoGrafico[] = [];

    serieComparativa.forEach((m, idx) => {
      const x = left + (idx / Math.max(1, serieComparativa.length - 1)) * plotW;
      const montoTotal = m.monto;
      const ratioMes =
        m.ordenes > 0 && m.ticketsPos
          ? Math.min(1, m.ticketsPos / m.ordenes)
          : proporcionPosGlobal;
      const montoPosMes = Math.round(montoTotal * ratioMes);

      lineaTotal.push({
        x,
        y: h - bottom - (montoTotal / maxComparativo) * plotH,
        valor: montoTotal,
        etiqueta: labelMesCorto(m.mes),
      });
      lineaPos.push({
        x,
        y: h - bottom - (montoPosMes / maxComparativo) * plotH,
        valor: montoPosMes,
        etiqueta: labelMesCorto(m.mes),
      });
    });

    return { w, h, left, right, top, bottom, lineaTotal, lineaPos };
  })();

  // Filtrado por buscador para las tablas inferiores
  const q = busqueda.trim().toLowerCase();
  const masVendidosFiltrados = masVendidos.filter(
    i => !q || i.nombre.toLowerCase().includes(q) || (i.codigo || "").toLowerCase().includes(q)
  );
  const stockBajoFiltrados = stockBajoItems.filter(
    i => !q || i.nombre.toLowerCase().includes(q) || (i.codigo || "").toLowerCase().includes(q)
  );
  const sinVentasFiltrados = sinVentas.filter(
    i => !q || i.nombre.toLowerCase().includes(q) || (i.codigo || "").toLowerCase().includes(q)
  );

  // Geometría para el Donut de Salud / Crecimiento
  const radioDonut = 44;
  const circunferencia = 2 * Math.PI * radioDonut;
  const segSalud = (saludStockPct / 100) * circunferencia;
  const segAlerta = Math.max(0, circunferencia - segSalud);

  return (
    <div className={styles.analyticsWrap}>
      {/* ── CABECERA ESTILO ANALYTICS DASHBOARD ─────────────────────────── */}
      <div className={styles.topHeaderBar}>
        <div>
          <h1 className={styles.analyticsTitle}>Analytics &amp; Estadísticas</h1>
          <p className={styles.analyticsSubtitle}>
            Rendimiento en tiempo real de tu catálogo, ventas en Mostrador POS y órdenes de taller (montos netos)
          </p>
        </div>

        <div className={styles.topHeaderControls}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder="Buscar repuesto o SKU en reportes..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
            {busqueda && (
              <button type="button" className={styles.clearBtn} onClick={() => setBusqueda("")}>
                ✕
              </button>
            )}
          </div>
          <button type="button" className={styles.refreshBtn} onClick={cargar}>
            ↻ Actualizar
          </button>
        </div>
      </div>

      {/* ── FILA 1: 3 TARJETAS GRÁFICAS (RESUMEN + EVOLUCIÓN + INGRESOS) ── */}
      <div className={styles.topCardsRow}>
        {/* Card 1: Resumen General con Sparkline */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardMutedLabel}>Resumen de Ventas (Neto)</span>
            <span className={styles.cardDots}>•••</span>
          </div>

          <div className={styles.bigMetricRow}>
            <span className={styles.bigMetricValue}>{fmtCLP(resumen.montoVendido)}</span>
            <span
              className={`${styles.metricDeltaBadge} ${
                variacionMensualPct >= 0 ? styles.deltaPositive : styles.deltaNeutral
              }`}
            >
              {variacionMensualPct >= 0 ? `+${variacionMensualPct}%` : `${variacionMensualPct}%`}
            </span>
          </div>

          <div className={styles.subMetricCode}>
            c/IVA {fmtCLP(conIva(resumen.montoVendido))} · {fmtNum(resumen.unidadesVendidas)} un. vendidas
          </div>

          <div className={styles.sparklineContainer}>
            <svg viewBox="0 0 260 58" className={styles.svgChart}>
              <defs>
                <linearGradient id="sparkBlueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={construirAreaSuave(sparkPoints, 54)} fill="url(#sparkBlueGrad)" />
              <path
                d={construirCurvaSuave(sparkPoints)}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              {sparkPoints.length > 0 && (
                <circle
                  cx={sparkPoints[sparkPoints.length - 1].x}
                  cy={sparkPoints[sparkPoints.length - 1].y}
                  r="4"
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              )}
            </svg>
          </div>
        </div>

        {/* Card 2: Evolución de Unidades Vendidas (Curva Azul) */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardTitle}>Evolución Unidades</span>
            <span className={styles.pillBadgeBlue}>
              {fmtNum(mesActual.unidades)} un. este mes
            </span>
          </div>

          <div className={styles.miniChartWrap}>
            <svg viewBox="0 0 300 115" className={styles.svgChart}>
              <defs>
                <linearGradient id="evoBlueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Líneas guía horizontales */}
              {[0, 0.5, 1].map((ratio, idx) => {
                const y = 14 + ratio * (115 - 14 - 24);
                const labelVal = Math.round(maxUnidades6 * (1 - ratio));
                return (
                  <g key={idx}>
                    <line x1="34" y1={y} x2="288" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x="28" y={y + 3} textAnchor="end" className={styles.axisText}>
                      {labelVal}
                    </text>
                  </g>
                );
              })}

              <path d={construirAreaSuave(evolutionPoints, 91)} fill="url(#evoBlueGrad)" />
              <path
                d={construirCurvaSuave(evolutionPoints)}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {evolutionPoints.map((pt, idx) => (
                <g key={idx}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={idx === evolutionPoints.length - 1 ? 4.2 : 3}
                    fill={idx === evolutionPoints.length - 1 ? "#2563eb" : "#ffffff"}
                    stroke="#2563eb"
                    strokeWidth="2"
                  >
                    <title>{`${pt.etiqueta}: ${fmtNum(pt.valor)} un.`}</title>
                  </circle>
                  <text x={pt.x} y="108" textAnchor="middle" className={styles.axisText}>
                    {pt.etiqueta.split(" ")[0]}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Card 3: Ingresos Mensuales (Curva Naranja) */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardTitle}>Ingresos Mensuales</span>
            <span className={styles.pillBadgeDark}>{fmtCLP(mesActual.monto)}</span>
          </div>

          <div className={styles.miniChartWrap}>
            <svg viewBox="0 0 300 115" className={styles.svgChart}>
              <defs>
                <linearGradient id="revOrangeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[0, 0.5, 1].map((ratio, idx) => {
                const y = 14 + ratio * (115 - 14 - 24);
                const labelVal = fmtCompact(maxIngresos6 * (1 - ratio));
                return (
                  <g key={idx}>
                    <line x1="42" y1={y} x2="288" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x="38" y={y + 3} textAnchor="end" className={styles.axisText}>
                      {labelVal}
                    </text>
                  </g>
                );
              })}

              <path d={construirAreaSuave(revenuesPoints, 91)} fill="url(#revOrangeGrad)" />
              <path
                d={construirCurvaSuave(revenuesPoints)}
                fill="none"
                stroke="#f97316"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {revenuesPoints.map((pt, idx) => (
                <g key={idx}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={idx === revenuesPoints.length - 1 ? 4.2 : 3}
                    fill={idx === revenuesPoints.length - 1 ? "#f97316" : "#ffffff"}
                    stroke="#f97316"
                    strokeWidth="2"
                  >
                    <title>{`${pt.etiqueta}: ${fmtCLP(pt.valor)}`}</title>
                  </circle>
                  <text x={pt.x} y="108" textAnchor="middle" className={styles.axisText}>
                    {pt.etiqueta.split(" ")[0]}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* ── FILA 2: MÉTRICAS 2x2 + GRÁFICO COMPARATIVO DE 2 LÍNEAS ──────── */}
      <div className={styles.middleRow}>
        {/* Bloque Izquierdo: 4 Métricas con Iconos */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardTitle}>Métricas de Inventario y POS</span>
            <span className={styles.cardDots}>•••</span>
          </div>

          <div className={styles.metricsQuadGrid}>
            <div className={styles.metricMiniCard}>
              <div className={`${styles.metricIconBox} ${styles.iconBoxBlue}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M8 12h8M8 16h5M8 8h8" />
                </svg>
              </div>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>Valor Stock Neto</span>
                <strong className={styles.metricNumber}>{fmtCLP(resumen.valorStock)}</strong>
                <span className={styles.metricHint}>{fmtNum(resumen.unidadesStock)} un. disponibles</span>
              </div>
            </div>

            <div className={styles.metricMiniCard}>
              <div className={`${styles.metricIconBox} ${styles.iconBoxOrange}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>Ventas Mostrador POS</span>
                <strong className={styles.metricNumber}>{fmtCLP(resumen.montoPos || 0)}</strong>
                <span className={styles.metricHint}>
                  {resumen.ticketsPos || 0} tickets · {fmtNum(resumen.unidadesPos || 0)} un.
                </span>
              </div>
            </div>

            <div className={styles.metricMiniCard}>
              <div className={`${styles.metricIconBox} ${styles.iconBoxBlue}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>Repuestos Activos</span>
                <strong className={styles.metricNumber}>{resumen.totalItems}</strong>
                <span className={styles.metricHint}>
                  {resumen.unidadesReservadas} reserv. ({fmtCLP(resumen.valorReservado)})
                </span>
              </div>
            </div>

            <div className={styles.metricMiniCard}>
              <div className={`${styles.metricIconBox} ${styles.iconBoxOrange}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>Rotación de Catálogo</span>
                <strong className={styles.metricNumber}>{rotacionCatalogoPct}%</strong>
                <span className={styles.metricHint}>
                  {itemsConVentas} con ventas · {resumen.stockBajo} stock bajo
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bloque Derecho: Gráfico de Doble Línea (Ventas Totales vs POS) */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardTitle}>Comparativa de Ventas Mensuales</span>
            <div className={styles.legendAndSelector}>
              <span className={styles.legendItem}>
                <span className={styles.legendDotBlue} /> Venta Total Neto
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDotOrange} /> Mostrador POS
              </span>
              <select
                className={styles.periodSelect}
                value={rangoMeses}
                onChange={e => setRangoMeses(Number(e.target.value) as 6 | 12)}
              >
                <option value={6}>Últimos 6 meses</option>
                <option value={12}>Últimos 12 meses</option>
              </select>
            </div>
          </div>

          <div className={styles.dualChartWrap}>
            <svg viewBox={`0 0 ${dualChartData.w} ${dualChartData.h}`} className={styles.svgChart}>
              <defs>
                <linearGradient id="dualBlueArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="dualOrangeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[0, 0.33, 0.66, 1].map((ratio, idx) => {
                const y =
                  dualChartData.top +
                  ratio * (dualChartData.h - dualChartData.top - dualChartData.bottom);
                const val = fmtCompact(maxComparativo * (1 - ratio));
                return (
                  <g key={idx}>
                    <line
                      x1={dualChartData.left}
                      y1={y}
                      x2={dualChartData.w - dualChartData.right}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth="1"
                    />
                    <text x={dualChartData.left - 6} y={y + 3} textAnchor="end" className={styles.axisText}>
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Áreas y curvas */}
              <path
                d={construirAreaSuave(
                  dualChartData.lineaTotal,
                  dualChartData.h - dualChartData.bottom
                )}
                fill="url(#dualBlueArea)"
              />
              <path
                d={construirAreaSuave(
                  dualChartData.lineaPos,
                  dualChartData.h - dualChartData.bottom
                )}
                fill="url(#dualOrangeArea)"
              />

              <path
                d={construirCurvaSuave(dualChartData.lineaTotal)}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d={construirCurvaSuave(dualChartData.lineaPos)}
                fill="none"
                stroke="#f97316"
                strokeWidth="2.4"
                strokeLinecap="round"
              />

              {dualChartData.lineaTotal.map((pt, idx) => {
                const ptPos = dualChartData.lineaPos[idx];
                return (
                  <g key={idx}>
                    <circle cx={pt.x} cy={pt.y} r="3.5" fill="#2563eb" stroke="#ffffff" strokeWidth="1.5">
                      <title>{`${pt.etiqueta} · Total: ${fmtCLP(pt.valor)}`}</title>
                    </circle>
                    {ptPos && (
                      <circle cx={ptPos.x} cy={ptPos.y} r="3.2" fill="#f97316" stroke="#ffffff" strokeWidth="1.5">
                        <title>{`${ptPos.etiqueta} · POS: ${fmtCLP(ptPos.valor)}`}</title>
                      </circle>
                    )}
                    <text
                      x={pt.x}
                      y={dualChartData.h - 8}
                      textAnchor="middle"
                      className={styles.axisText}
                    >
                      {pt.etiqueta.split(" ")[0]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* ── FILA 3: TABLA INTERACTIVA DE PRODUCTOS + DONUT DE SALUD ─────── */}
      <div className={styles.bottomRow}>
        {/* Tabla interactiva con pestañas */}
        <div className={styles.chartCard}>
          <div className={styles.tableHeaderBar}>
            <div className={styles.tabsGroup}>
              <button
                type="button"
                className={`${styles.tabButton} ${tabActiva === "mas_vendidos" ? styles.tabButtonActive : ""}`}
                onClick={() => setTabActiva("mas_vendidos")}
              >
                🏆 Más Vendidos ({masVendidosFiltrados.length})
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${tabActiva === "stock_bajo" ? styles.tabButtonActive : ""}`}
                onClick={() => setTabActiva("stock_bajo")}
              >
                ⚠️ Stock Bajo ({stockBajoFiltrados.length})
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${tabActiva === "sin_ventas" ? styles.tabButtonActive : ""}`}
                onClick={() => setTabActiva("sin_ventas")}
              >
                📦 Sin Ventas ({sinVentasFiltrados.length})
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${tabActiva === "meses" ? styles.tabButtonActive : ""}`}
                onClick={() => setTabActiva("meses")}
              >
                📅 Historial 12 Meses
              </button>
            </div>
          </div>

          <div className={styles.modernTableWrap}>
            {tabActiva === "mas_vendidos" && (
              <table className={styles.modernTable}>
                <thead>
                  <tr>
                    <th>Repuesto</th>
                    <th className="r">Monto Neto</th>
                    <th className="r">Participación</th>
                    <th className="r">Unidades</th>
                    <th className="r">Total c/IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {masVendidosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.vacio}>
                        Aún no hay ventas registradas para este filtro.
                      </td>
                    </tr>
                  ) : (
                    masVendidosFiltrados.map(item => {
                      const pct =
                        resumen.montoVendido > 0
                          ? Math.round((item.monto / resumen.montoVendido) * 1000) / 10
                          : 0;
                      return (
                        <tr key={item.id}>
                          <td>
                            <div className={styles.productCell}>
                              <span className={styles.rowIconBlue}>📦</span>
                              <div>
                                <div className={styles.itemNombre}>{item.nombre}</div>
                                {item.codigo && <div className={styles.itemCodigo}>{item.codigo}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="r">
                            <strong>{fmtCLP(item.monto)}</strong>
                          </td>
                          <td className="r">{pct}%</td>
                          <td className="r">{fmtNum(item.unidades)} un.</td>
                          <td className={`r ${styles.greenAmount}`}>{fmtCLP(conIva(item.monto))}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}

            {tabActiva === "stock_bajo" && (
              <table className={styles.modernTable}>
                <thead>
                  <tr>
                    <th>Repuesto a Reponer</th>
                    <th className="r">Disponible Actual</th>
                    <th className="r">Stock Mínimo</th>
                    <th className="r">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {stockBajoFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={styles.vacio}>
                        ✓ Todo tu stock está sobre el mínimo configurado.
                      </td>
                    </tr>
                  ) : (
                    stockBajoFiltrados.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className={styles.productCell}>
                            <span className={styles.rowIconOrange}>⚠️</span>
                            <div>
                              <div className={styles.itemNombre}>{item.nombre}</div>
                              {item.codigo && <div className={styles.itemCodigo}>{item.codigo}</div>}
                            </div>
                          </div>
                        </td>
                        <td className={`r ${styles.valorAlerta}`}>{fmtNum(item.disponible)} un.</td>
                        <td className="r">{fmtNum(item.stockMinimo)} un.</td>
                        <td className="r">
                          <span className={styles.alertPill}>Reponer urgente</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tabActiva === "sin_ventas" && (
              <table className={styles.modernTable}>
                <thead>
                  <tr>
                    <th>Repuesto sin Movimiento</th>
                    <th className="r">Stock en Bodega</th>
                    <th className="r">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {sinVentasFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={styles.vacio}>
                        ✓ Todos tus repuestos publicados ya registran ventas.
                      </td>
                    </tr>
                  ) : (
                    sinVentasFiltrados.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className={styles.productCell}>
                            <span className={styles.rowIconBlue}>🏷️</span>
                            <div>
                              <div className={styles.itemNombre}>{item.nombre}</div>
                              {item.codigo && <div className={styles.itemCodigo}>{item.codigo}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="r">
                          <strong>{fmtNum(item.stock)} un.</strong>
                        </td>
                        <td className="r">
                          <span className={styles.neutralPill}>Sin rotación aún</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tabActiva === "meses" && (
              <table className={styles.modernTable}>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="r">Operaciones (POS / OT)</th>
                    <th className="r">Unidades</th>
                    <th className="r">Monto Neto</th>
                    <th className="r">Monto c/IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {mesesDescendentes.map(m => (
                    <tr key={m.mes}>
                      <td>
                        <strong>{labelMesLargo(m.mes)}</strong>
                      </td>
                      <td className="r">
                        {m.ordenes ? (
                          <span>
                            {m.ordenes}
                            {m.ticketsPos ? (
                              <small className={styles.posTag}> ({m.ticketsPos} POS)</small>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="r">{m.unidades ? `${fmtNum(m.unidades)} un.` : "—"}</td>
                      <td className="r">{m.monto ? fmtCLP(m.monto) : "—"}</td>
                      <td className={`r ${styles.greenAmount}`}>
                        {m.monto ? fmtCLP(conIva(m.monto)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Tarjeta Derecha: Salud de Stock & Crecimiento (Donut Chart) */}
        <div className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <span className={styles.cardTitle}>Salud de Stock &amp; Rotación</span>
            <span className={styles.cardDots}>•••</span>
          </div>

          <div className={styles.growthCardBody}>
            <div className={styles.growthLeftInfo}>
              <span className={styles.growthCaption}>Abastecimiento Óptimo</span>
              <div className={styles.growthBigPct}>{saludStockPct}%</div>
              <span className={styles.growthSubtext}>
                {itemsStockSaludable} de {resumen.totalItems} repuestos sobre stock mínimo
              </span>

              <div className={styles.growthLegendList}>
                <div className={styles.growthLegendItem}>
                  <span className={styles.dotBlue} />
                  <span>Stock Óptimo ({itemsStockSaludable})</span>
                </div>
                <div className={styles.growthLegendItem}>
                  <span className={styles.dotOrange} />
                  <span>Stock Bajo ({resumen.stockBajo})</span>
                </div>
              </div>
            </div>

            <div className={styles.donutWrap}>
              <svg width="124" height="124" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r={radioDonut}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="10"
                />
                {segAlerta > 0 && (
                  <circle
                    cx="60"
                    cy="60"
                    r={radioDonut}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="10"
                    strokeDasharray={`${segAlerta} ${circunferencia}`}
                    strokeDashoffset={-segSalud}
                    strokeLinecap="round"
                    transform="rotate(-90 60 60)"
                  />
                )}
                <circle
                  cx="60"
                  cy="60"
                  r={radioDonut}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="10"
                  strokeDasharray={`${segSalud} ${circunferencia}`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div className={styles.donutCenterContent}>
                <span className={styles.donutArrow}>↗</span>
                <span className={styles.donutCenterLabel}>Stock OK</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
