import { useState } from "react";
import { mantenimientoService } from "../../services/mantenimiento";
import type { ResultadoMantenimiento } from "../../services/mantenimiento";
import { useAuth } from "../../contexts/AuthContext";
import styles from "./Mantenimiento.module.css";

export default function Mantenimiento() {
  const { getToken } = useAuth();
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ tarea: string; data: ResultadoMantenimiento } | null>(null);
  const [error, setError] = useState("");

  const ejecutar = async (
    tarea: string,
    fn: () => Promise<ResultadoMantenimiento>
  ) => {
    setError("");
    setResultado(null);
    setCorriendo(tarea);
    try {
      const data = await fn();
      if (data.success) {
        setResultado({ tarea, data });
      } else {
        setError(data.error || "Error desconocido");
      }
    } catch {
      setError("Error al ejecutar la tarea. Revisa la consola del navegador.");
    } finally {
      setCorriendo(null);
    }
  };

  const exportarCatalogo = async () => {
    setError("");
    setCorriendo("Exportar Catálogo WooCommerce");
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/woocommerce/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Error ${res.status} al exportar`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = "catalogo-woocommerce.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar el catálogo");
    } finally {
      setCorriendo(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Mantenimiento <span>del Sistema</span></div>
      </div>

      <div className={styles.aviso}>
        ⚠ Estas herramientas corrigen datos existentes en la base de datos. Son seguras de correr
        más de una vez (si no hay nada que corregir, no hacen nada), pero úsalas solo cuando sepas
        para qué sirve cada una.
      </div>

      <div className={styles.grid}>
        <div className="card">
          <div className="card-title">Reconciliar Stock Reservado</div>
          <p className={styles.desc}>
            Recalcula el stock reservado real de cada repuesto sumando directamente las OT activas
            (no entregadas) que lo usan, y corrige cualquier diferencia ("reservas fantasma" que
            impiden eliminar un ítem aunque en realidad no esté reservado).
          </p>
          <button
            className="btn btn-primary"
            onClick={() => ejecutar(
              "Reconciliar Stock Reservado",
              () => mantenimientoService.reconciliarStockReservado()
            )}
            disabled={corriendo !== null}
          >
            {corriendo === "Reconciliar Stock Reservado" ? "Ejecutando..." : "▶ Ejecutar"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Corregir URLs de Localhost</div>
          <p className={styles.desc}>
            Corrige links de contratos/liquidaciones que quedaron apuntando a "localhost" (subidos
            durante pruebas locales) para que apunten a producción y funcionen para cualquiera.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => ejecutar(
              "Corregir URLs de Localhost",
              () => mantenimientoService.fixLocalhostUrls()
            )}
            disabled={corriendo !== null}
          >
            {corriendo === "Corregir URLs de Localhost" ? "Ejecutando..." : "▶ Ejecutar"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Limpiar Productos Huérfanos en WooCommerce</div>
          <p className={styles.desc}>
            Busca productos en WooCommerce que el sistema haya creado (por la sincronización) pero
            cuyo repuesto ya no existe en tu Inventario, y los elimina de la tienda. Nunca toca
            productos que hayas agregado tú a mano en WooCommerce.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => ejecutar(
              "Limpiar Productos Huérfanos en WooCommerce",
              () => mantenimientoService.limpiarProductosHuerfanosWoo()
            )}
            disabled={corriendo !== null}
          >
            {corriendo === "Limpiar Productos Huérfanos en WooCommerce" ? "Ejecutando..." : "▶ Ejecutar"}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Exportar Catálogo de WooCommerce</div>
          <p className={styles.desc}>
            Descarga un CSV con todos los productos directo desde la API de WooCommerce (nombre,
            SKU, precio, categorías, imágenes, etc.) — alternativa al exportador nativo de
            WordPress si te sigue saliendo vacío.
          </p>
          <button
            className="btn btn-primary"
            onClick={exportarCatalogo}
            disabled={corriendo !== null}
          >
            {corriendo === "Exportar Catálogo WooCommerce" ? "Exportando..." : "⬇ Descargar CSV"}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>✕ {error}</div>}

      {resultado && (
        <div className={`card ${styles.resultadoCard}`}>
          <div className="card-title">Resultado — {resultado.tarea}</div>
          <div className={styles.resultadoResumen}>
            {resultado.data.corregidos === 0
              ? "✓ No había nada que corregir — todo estaba en orden."
              : `✓ Se corrigieron ${resultado.data.corregidos} registro(s).`}
          </div>
          {resultado.data.detalle?.length > 0 && (
            <div className={styles.detalleWrap}>
              <table>
                <thead>
                  <tr>
                    {Object.keys(resultado.data.detalle[0]).map(k => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultado.data.detalle.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j}>{String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}