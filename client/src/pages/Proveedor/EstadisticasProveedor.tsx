import { useEffect, useMemo, useState } from "react";
import { inventarioService } from "../../services/inventario";
import type { EstadisticasProveedor as Datos } from "../../types";
import styles from "./EstadisticasProveedor.module.css";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtCLP = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const conIva = (n: number) => Math.round((n || 0) * 1.19);
const fmtNum = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString("es-CL");

const keyMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const labelMes = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};

export default function EstadisticasProveedor() {
  const [datos, setDatos]     = useState<Datos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => { cargar(); }, []);

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

  // Últimos 12 meses (incluye meses sin ventas, para ver la tendencia completa)
  const meses = useMemo(() => {
    const porMes = new Map((datos?.ventasPorMes || []).map(m => [m.mes, m]));
    const hoy = new Date();
    const lista: { mes: string; unidades: number; monto: number; ordenes: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const k = keyMes(d);
      lista.push(porMes.get(k) || { mes: k, unidades: 0, monto: 0, ordenes: 0 });
    }
    return lista;
  }, [datos]);

  const maxMonto  = Math.max(1, ...meses.map(m => m.monto));
  const mesActual = meses[0];

  if (loading) return <div className={styles.estado}>Cargando estadísticas...</div>;

  if (error || !datos) {
    return (
      <div className={styles.estado}>
        <div>{error || "Sin datos"}</div>
        <button className="btn btn-dark btn-sm" onClick={cargar}>Reintentar</button>
      </div>
    );
  }

  const { resumen, masVendidos, stockBajoItems, sinVentas } = datos;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Mis <span>Estadísticas</span></div>
        <button className="btn btn-dark btn-sm" onClick={cargar}>↻ Actualizar</button>
      </div>

      <div className={styles.nota}>
        Todos los montos son <strong>netos</strong> (sin IVA); el IVA 19% se agrega encima al facturar. Se calculan con el precio que tienes ingresado en cada repuesto y cuentan solo los
        repuestos de trabajos <strong>entregados</strong> al cliente. Las unidades reservadas son las que
        el taller tiene comprometidas en trabajos aún en curso.
      </div>

      {/* Resumen */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{resumen.totalItems}</div>
          <div className="stat-label">Repuestos Publicados</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(resumen.valorStock)}</div>
          <div className="stat-label">Valor de tu Stock neto ({fmtNum(resumen.unidadesStock)} un.)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(mesActual.monto)}</div>
          <div className="stat-label">Vendido este mes ({fmtNum(mesActual.unidades)} un.)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtCLP(resumen.montoVendido)}</div>
          <div className="stat-label">Vendido en total neto ({fmtNum(resumen.unidadesVendidas)} un.) · c/IVA {fmtCLP(conIva(resumen.montoVendido))}</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.valorAviso}`}>{fmtNum(resumen.unidadesReservadas)}</div>
          <div className="stat-label">Unidades Reservadas ({fmtCLP(resumen.valorReservado)})</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${resumen.stockBajo > 0 ? styles.valorAlerta : ""}`}>{resumen.stockBajo}</div>
          <div className="stat-label">Con Stock Bajo</div>
        </div>
      </div>

      {/* Ventas por mes */}
      <div className={styles.seccion}>
        <div className={styles.seccionTitulo}>Ventas por mes · últimos 12 meses</div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                <th className="r">Trabajos</th>
                <th className="r">Unidades</th>
                <th className="r">Monto neto</th>
                <th className={styles.colBarra}></th>
              </tr>
            </thead>
            <tbody>
              {meses.map(m => (
                <tr key={m.mes}>
                  <td data-label="Mes">{labelMes(m.mes)}</td>
                  <td data-label="Trabajos" className="r">{m.ordenes || "—"}</td>
                  <td data-label="Unidades" className="r">{m.unidades ? fmtNum(m.unidades) : "—"}</td>
                  <td data-label="Monto" className="r price-cell">{m.monto ? fmtCLP(m.monto) : "—"}</td>
                  <td className={`${styles.colBarra} hide-mobile`}>
                    <div className={styles.barraPista}>
                      <div className={styles.barraRelleno} style={{ width: `${(m.monto / maxMonto) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.dosColumnas}>
        {/* Más vendidos */}
        <div className={styles.seccion}>
          <div className={styles.seccionTitulo}>Más vendidos</div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Repuesto</th><th className="r">Unidades</th><th className="r">Monto</th></tr>
              </thead>
              <tbody>
                {masVendidos.length === 0 && (
                  <tr><td colSpan={3} className={styles.vacio}>Aún no hay ventas registradas.</td></tr>
                )}
                {masVendidos.map(i => (
                  <tr key={i.id}>
                    <td data-label="Repuesto">
                      <div className={styles.itemNombre}>{i.nombre}</div>
                      {i.codigo && <div className={styles.itemCodigo}>{i.codigo}</div>}
                    </td>
                    <td data-label="Unidades" className="r">{fmtNum(i.unidades)}</td>
                    <td data-label="Monto" className="r price-cell">{fmtCLP(i.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stock bajo */}
        <div className={styles.seccion}>
          <div className={styles.seccionTitulo}>Stock bajo · reponer</div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Repuesto</th><th className="r">Disponible</th><th className="r">Mínimo</th></tr>
              </thead>
              <tbody>
                {stockBajoItems.length === 0 && (
                  <tr><td colSpan={3} className={styles.vacio}>Todo tu stock está sobre el mínimo.</td></tr>
                )}
                {stockBajoItems.map(i => (
                  <tr key={i.id}>
                    <td data-label="Repuesto">
                      <div className={styles.itemNombre}>{i.nombre}</div>
                      {i.codigo && <div className={styles.itemCodigo}>{i.codigo}</div>}
                    </td>
                    <td data-label="Disponible" className={`r ${styles.valorAlerta}`}>{fmtNum(i.disponible)}</td>
                    <td data-label="Mínimo" className="r">{fmtNum(i.stockMinimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sin ventas */}
      <div className={styles.seccion}>
        <div className={styles.seccionTitulo}>
          Sin ventas todavía ({resumen.itemsSinVentas})
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Repuesto</th><th className="r">Stock</th></tr>
            </thead>
            <tbody>
              {sinVentas.length === 0 && (
                <tr><td colSpan={2} className={styles.vacio}>Todos tus repuestos ya tuvieron ventas.</td></tr>
              )}
              {sinVentas.map(i => (
                <tr key={i.id}>
                  <td data-label="Repuesto">
                    <div className={styles.itemNombre}>{i.nombre}</div>
                    {i.codigo && <div className={styles.itemCodigo}>{i.codigo}</div>}
                  </td>
                  <td data-label="Stock" className="r">{fmtNum(i.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {resumen.itemsSinVentas > sinVentas.length && (
          <div className={styles.masItems}>
            y {resumen.itemsSinVentas - sinVentas.length} repuesto(s) más sin ventas.
          </div>
        )}
      </div>
    </div>
  );
}