import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { ItemInventario, Equivalencia } from "../../types";
import { inventarioService } from "../../services/inventario";
import { useAppStore } from "../../store/useAppStore";
import styles from "./ImportarExcelModal.module.css";

// ─── COLUMNAS DE LA PLANTILLA ──────────────────────────────
const COLUMNAS = [
  "codigo",
  "nombre",
  "fabricante",
  "origen",
  "descripcion",
  "categoria",
  "tipoPieza",
  "posicion",
  "lado",
  "marcas",
  "modelos",
  "anioDesde",
  "anioHasta",
  "precioImportacion",
  "precioLista",
  "descuentoTaller",
  "precioCompra",
  "precioVenta",
  "stock",
  "stockMinimo",
  "unidad",
  "imagenUrl",
  "proveedor",
  "eq_fabricante",
  "eq_codigo",
] as const;

const EJEMPLO = {
  codigo:             "W712/40",
  nombre:             "",
  fabricante:         "BOSCH",
  origen:             "ALEMANIA",
  descripcion:        "FILTRO DE ACEITE PARA MOTOR BENCINERO",
  categoria:          "FILTROS",
  tipoPieza:          "FILTRO DE ACEITE",
  posicion:           "NO APLICA",
  lado:               "NO APLICA",
  marcas:             "TOYOTA,KIA,HYUNDAI",
  modelos:            "TOYOTA:COROLLA,YARIS;KIA:RIO,CERATO",
  anioDesde:          2015,
  anioHasta:          2023,
  precioImportacion:  3000,
  precioLista:        6000,
  descuentoTaller:    25,
  precioCompra:       4500,
  precioVenta:        8000,
  stock:              10,
  stockMinimo:        2,
  unidad:             "UNIDAD",
  imagenUrl:          "https://storage.googleapis.com/media-drmotors-cl/img/386fa8f5-filtro-hk-aceite.webp",
  proveedor:          "REPUESTERA CENTRAL",
  eq_fabricante:      "MANN,CHAMPION",
  eq_codigo:          "W610/82,C115",
};

// ─── FILA PARSEADA ─────────────────────────────────────────
interface FilaExcel {
  codigo:        string;
  nombre:        string;
  fabricante:    string;
  origen:        string;
  descripcion:   string;
  categoria:     string;
  tipoPieza:     string;
  posicion:      string;
  lado:          string;
  marcas:        string;
  modelos:       string;
  anioDesde:     number | null;
  anioHasta:          number | null;
  precioImportacion:  number;
  precioLista:        number;
  descuentoTaller:    number;
  precioCompra:       number;
  precioVenta:        number;
  stock:         number;
  stockMinimo:   number;
  unidad:        string;
  imagenUrl:     string;
  proveedor:     string;
  eq_fabricante: string;
  eq_codigo:     string;
  // Estado calculado
  estado: "nuevo" | "duplicado" | "error";
  error?: string;
  itemExistente?: ItemInventario;
}

// ─── HELPERS ───────────────────────────────────────────────
const parseMarcas = (val: string): string[] =>
  val ? val.split(",").map(m => m.trim().toUpperCase()).filter(Boolean) : [];

const parseModelos = (val: string): { [marca: string]: string[] } => {
  if (!val) return {};
  const result: { [marca: string]: string[] } = {};
  val.split(";").forEach(grupo => {
    const [marca, modelos] = grupo.split(":");
    if (marca && modelos) {
      result[marca.trim().toUpperCase()] = modelos.split(",").map(m => m.trim().toUpperCase()).filter(Boolean);
    }
  });
  return result;
};

const parseEquivalencias = (fabricantes: string, codigos: string): Equivalencia[] => {
  if (!fabricantes && !codigos) return [];
  const fabs = fabricantes.split(",").map(f => f.trim().toUpperCase()).filter(Boolean);
  const cods = codigos.split(",").map(c => c.trim().toUpperCase()).filter(Boolean);
  const len  = Math.max(fabs.length, cods.length);
  const result: Equivalencia[] = [];
  for (let i = 0; i < len; i++) {
    if (fabs[i] && cods[i]) result.push({ fabricante: fabs[i], codigo: cods[i] });
  }
  return result;
};

const filaToItem = (fila: FilaExcel): Omit<ItemInventario, "id"> => {
  const marcasCompatibles  = parseMarcas(fila.marcas);
  const modelosCompatibles = parseModelos(fila.modelos);
  // Nombre: el que venga en el Excel; si está vacío, se genera con tipo de pieza + código
  const nombre = fila.nombre?.trim()
    ? fila.nombre.trim().toUpperCase()
    : fila.tipoPieza && fila.codigo
      ? `${fila.tipoPieza.toUpperCase()} ${fila.codigo.toUpperCase()}`
      : fila.codigo.toUpperCase();
  return {
    nombre,
    codigo:             fila.codigo.toUpperCase(),
    fabricante:         fila.fabricante.toUpperCase(),
    ...(fila.origen      ? { origen:      fila.origen.toUpperCase() }      : {}),
    ...(fila.descripcion ? { descripcion: fila.descripcion.toUpperCase() } : {}),
    categoria:          fila.categoria.toUpperCase() as any,
    tipoPieza:          fila.tipoPieza.toUpperCase(),
    posicion:           (fila.posicion.toUpperCase() || "NO APLICA") as any,
    lado:               (fila.lado.toUpperCase() || "NO APLICA") as any,
    marcasCompatibles,
    modelosCompatibles,
    equivalencias:      parseEquivalencias(fila.eq_fabricante, fila.eq_codigo) as any,
    anioDesde:          fila.anioDesde || null,
    anioHasta:          fila.anioHasta || null,
    precioImportacion:  fila.precioImportacion || 0,
    precioLista:        fila.precioLista        || 0,
    descuentoTaller:    fila.descuentoTaller    || 0,
    precioCompra:       fila.precioCompra       || 0,
    precioVenta:        fila.precioVenta        || 0,
    stock:              fila.stock              || 0,
    stockReservado:     0,
    stockMinimo:        fila.stockMinimo        || 2,
    unidad:             (fila.unidad            || "UNIDAD").toUpperCase(),
    imagenUrl:          fila.imagenUrl          || "",
    proveedor:          fila.proveedor.toUpperCase() || "",
  };
};

// ─── PROPS ─────────────────────────────────────────────────
interface Props {
  inventarioActual: ItemInventario[];
  onClose:          () => void;
  onSuccess:        () => void;
}

// ═══════════════════════════════════════════════════════════
export default function ImportarExcelModal({ inventarioActual, onClose, onSuccess }: Props) {
  const { notify } = useAppStore();
  const fileRef    = useRef<HTMLInputElement>(null);

  const [filas,       setFilas]       = useState<FilaExcel[]>([]);
  const [filename,    setFilename]    = useState("");
  const [uploading,   setUploading]   = useState(false);
  // Para duplicados: "saltar" o "actualizar"
  const [accionDuplicados, setAccionDuplicados] = useState<"saltar" | "actualizar">("saltar");

  // ─── DESCARGAR PLANTILLA ─────────────────────────────────
  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new();

    // Hoja de datos
    const datos = [[...COLUMNAS], Object.values(EJEMPLO)];
    const ws = XLSX.utils.aoa_to_sheet(datos);

    // Anchos de columna (por nombre de columna, para que no se descuadren al agregar campos)
    const ANCHOS: Record<string, number> = {
      codigo: 14, nombre: 30, fabricante: 14, origen: 16, descripcion: 40, categoria: 14, tipoPieza: 22,
      posicion: 12, lado: 12, marcas: 30, modelos: 40, anioDesde: 10, anioHasta: 10,
      precioImportacion: 16, precioLista: 14, descuentoTaller: 14, precioCompra: 14, precioVenta: 12,
      stock: 8, stockMinimo: 10, unidad: 8, imagenUrl: 40, proveedor: 20, eq_fabricante: 22, eq_codigo: 22,
    };
    ws["!cols"] = COLUMNAS.map(c => ({ wch: ANCHOS[c] ?? 14 }));

    XLSX.utils.book_append_sheet(wb, ws, "Inventario");

    // Hoja de instrucciones
    const instrucciones = [
      ["INSTRUCCIONES DE LLENADO"],
      [],
      ["CAMPO",          "DESCRIPCIÓN",                                         "EJEMPLO"],
      ["codigo",         "Código único del repuesto (requerido)",               "W712/40"],
      ["nombre",         "Nombre del repuesto (opcional). Si lo dejas vacío se genera con tipoPieza + codigo", "FILTRO DE ACEITE W712/40"],
      ["fabricante",     "Marca del repuesto",                                  "BOSCH"],
      ["origen",         "País de origen del repuesto (opcional)",              "ALEMANIA"],
      ["descripcion",    "Descripción del repuesto (opcional)",                 "FILTRO DE ACEITE PARA MOTOR BENCINERO"],
      ["categoria",      "FRENOS, FILTROS, LUBRICANTES, SUSPENSIÓN, ELÉCTRICO, DISTRIBUCIÓN, NEUMÁTICOS, EMBRAGUE, OTROS", "FILTROS"],
      ["tipoPieza",      "Tipo de pieza según clasificación",                   "FILTRO DE ACEITE"],
      ["posicion",       "DELANTERA, TRASERA o NO APLICA",                      "NO APLICA"],
      ["lado",           "DERECHO, IZQUIERDO, AMBOS o NO APLICA",               "NO APLICA"],
      ["marcas",         "Marcas compatibles separadas por coma",               "TOYOTA,KIA,HYUNDAI"],
      ["modelos",        "MARCA:MODELO1,MODELO2;MARCA2:MODELO1  (separar marcas con ;)", "TOYOTA:COROLLA,YARIS;KIA:RIO"],
      ["anioDesde",      "Año inicio compatibilidad (número)",                  "2015"],
      ["anioHasta",      "Año fin compatibilidad (número)",                     "2023"],
      ["precioImportacion", "Precio que paga el proveedor al importar (referencia)", "3000"],
      ["precioLista",    "Precio catálogo del proveedor (antes del descuento)", "6000"],
      ["descuentoTaller","Porcentaje de descuento que el proveedor nos hace",   "25"],
      ["precioCompra",   "Precio neto compra calculado (precioLista × (1 - dto/100)). Si se deja en 0 se calcula automáticamente", "4500"],
      ["precioVenta",    "Precio neto de venta al cliente final (sin IVA, en pesos). Si se deja en 0 se sugiere precioCompra × 1.3", "8000"],
      ["stock",          "Cantidad en bodega",                                   "10"],
      ["stockMinimo",    "Stock mínimo para alerta",                             "2"],
      ["unidad",         "unidad, par, set, litro, kg, metro",                  "unidad"],
      ["proveedor",      "Nombre del proveedor",                                "REPUESTERA CENTRAL"],
      ["eq_fabricante",  "Fabricantes de equivalencias separados por coma (en el mismo orden que eq_codigo)", "MANN,CHAMPION"],
      ["eq_codigo",      "Códigos equivalentes separados por coma (en el mismo orden que eq_fabricante)",          "W610/82,C115"],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
    wsInstr["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucciones");

    XLSX.writeFile(wb, "plantilla_inventario_drmotors.xlsx");
  };

  // ─── PARSEAR ARCHIVO ─────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb   = XLSX.read(evt.target?.result, { type: "binary" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

        if (!raw.length) { notify("El archivo está vacío", "error"); return; }

        // Verificar que tenga la columna requerida
        if (!raw[0].hasOwnProperty("codigo")) {
          notify("El archivo no tiene la columna 'codigo'. Usa la plantilla descargable.", "error");
          return;
        }

        // Mapear filas y detectar duplicados
        const codigosExistentes = new Map(
          inventarioActual.filter(i => i.codigo).map(i => [i.codigo.toUpperCase(), i])
        );

        const filasParsed: FilaExcel[] = raw.map((row: any) => {
          const codigo = String(row.codigo || "").trim().toUpperCase();
          if (!codigo) {
            return {
              ...row, codigo, estado: "error" as const, error: "Código vacío",
              nombre: "", fabricante: "", origen: "", descripcion: "", categoria: "", tipoPieza: "", posicion: "NO APLICA",
              lado: "NO APLICA", marcas: "", modelos: "", anioDesde: null, anioHasta: null,
              precioImportacion: 0, precioLista: 0, descuentoTaller: 0,
              precioCompra: 0, precioVenta: 0, stock: 0, stockMinimo: 2,
              unidad: "UNIDAD", imagenUrl: "", proveedor: "", eq_fabricante: "", eq_codigo: "",
            } as FilaExcel;
          }
          const existente = codigosExistentes.get(codigo);
            // Calcular precioCompra neto si viene lista + descuento pero no compra
            const lista  = parseFloat(row.precioLista)      || 0;
            const dto    = parseFloat(row.descuentoTaller)  || 0;
            const compra = row.precioCompra
              ? parseFloat(row.precioCompra) || 0
              : Math.round(lista * (1 - dto / 100));
          return {
            codigo,
            nombre:             String(row.nombre             || "").trim().toUpperCase(),
            fabricante:         String(row.fabricante         || "").trim().toUpperCase(),
            origen:             String(row.origen             || "").trim().toUpperCase(),
            descripcion:        String(row.descripcion        || "").trim().toUpperCase(),
            categoria:          String(row.categoria          || "").trim().toUpperCase(),
            tipoPieza:          String(row.tipoPieza          || "").trim().toUpperCase(),
            posicion:           String(row.posicion           || "NO APLICA").trim().toUpperCase(),
            lado:               String(row.lado               || "NO APLICA").trim().toUpperCase(),
            marcas:             String(row.marcas             || "").trim().toUpperCase(),
            modelos:            String(row.modelos            || "").trim().toUpperCase(),
            anioDesde:          row.anioDesde  ? parseInt(row.anioDesde)  : null,
            anioHasta:          row.anioHasta  ? parseInt(row.anioHasta)  : null,
            precioImportacion:  parseFloat(row.precioImportacion) || 0,
            precioLista:        lista,
            descuentoTaller:    dto,
            precioCompra:       compra,
            precioVenta:        parseFloat(row.precioVenta)   || Math.round(compra * 1.3),
            stock:              parseInt(row.stock)           || 0,
            stockMinimo:        parseInt(row.stockMinimo)     || 2,
            unidad:             String(row.unidad             || "UNIDAD").trim().toUpperCase(),
            imagenUrl:          String(row.imagenUrl          || "").trim(),
            proveedor:          String(row.proveedor          || "").trim().toUpperCase(),
            eq_fabricante:      String(row.eq_fabricante      || "").trim().toUpperCase(),
            eq_codigo:          String(row.eq_codigo          || "").trim().toUpperCase(),
            estado:             existente ? "duplicado" : "nuevo",
            itemExistente:      existente,
          } as unknown as FilaExcel;
        });

        setFilas(filasParsed);
      } catch {
        notify("Error al leer el archivo. Verifica que sea un Excel válido.", "error");
      }
    };
    reader.readAsBinaryString(file);
  };

  // ─── SUBIR ───────────────────────────────────────────────
  const handleSubir = async () => {
    const filasValidas = filas.filter(f => f.estado !== "error");
    if (!filasValidas.length) { notify("No hay filas válidas para importar", "error"); return; }

    setUploading(true);
    let creados = 0, actualizados = 0, saltados = 0, errores = 0;

    for (const fila of filasValidas) {
      try {
        const data = filaToItem(fila);
        // Si el Excel no trae nombre, al actualizar se conserva el que ya tenía el repuesto
        if (fila.estado === "duplicado" && !fila.nombre?.trim() && fila.itemExistente?.nombre) {
          data.nombre = fila.itemExistente.nombre;
        }
        if (fila.estado === "nuevo") {
          await inventarioService.create(data);
          creados++;
        } else if (fila.estado === "duplicado") {
          if (accionDuplicados === "actualizar" && fila.itemExistente?.id) {
            await inventarioService.update(fila.itemExistente.id, data);
            actualizados++;
          } else {
            saltados++;
          }
        }
      } catch {
        errores++;
      }
    }

    setUploading(false);
    const partes = [];
    if (creados)     partes.push(`${creados} creado(s)`);
    if (actualizados) partes.push(`${actualizados} actualizado(s)`);
    if (saltados)    partes.push(`${saltados} saltado(s)`);
    if (errores)     partes.push(`${errores} con error`);
    notify(`Importación completa: ${partes.join(", ")}`, errores ? "error" : "success");
    onSuccess();
  };

  // ─── ESTADÍSTICAS ─────────────────────────────────────────
  const nuevas      = filas.filter(f => f.estado === "nuevo").length;
  const duplicadas  = filas.filter(f => f.estado === "duplicado").length;
  const erroresCnt  = filas.filter(f => f.estado === "error").length;

  // ─── RENDER ──────────────────────────────────────────────
  return (
    <div className="overlay open">
      <div className={`modal ${styles.modal}`}>
        <div className="modal-title">Importar desde Excel</div>
        <div className="modal-sub">
          Carga masiva de repuestos al inventario · Usa la plantilla para el formato correcto
        </div>

        {/* Botón plantilla */}
        <button
          className={`btn btn-dark btn-sm ${styles.btnPlantilla}`}
          onClick={descargarPlantilla}
        >
          ⬇ Descargar Plantilla Excel
        </button>

        {/* Selector de archivo */}
        <div
          onClick={() => fileRef.current?.click()}
          className={styles.dropZone}
        >
          <div className={styles.dropZoneIcon}>📂</div>
          <div className={styles.dropZoneText}>
            {filename ? filename : "Haz clic para seleccionar el archivo Excel"}
          </div>
          {!filename && <div className={styles.dropZoneHint}>.xlsx · .xls</div>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className={styles.fileInputHidden} onChange={handleFile} />
        </div>

        {/* Resumen + acción duplicados */}
        {filas.length > 0 && (
          <>
            {/* Badges resumen */}
            <div className={styles.badgesRow}>
              <span className={`${styles.badgeBase} ${styles.badgeNuevos}`}>
                ✓ {nuevas} Nuevos
              </span>
              {duplicadas > 0 && (
                <span className={`${styles.badgeBase} ${styles.badgeDuplicados}`}>
                  ⚠ {duplicadas} Duplicados
                </span>
              )}
              {erroresCnt > 0 && (
                <span className={`${styles.badgeBase} ${styles.badgeErrores}`}>
                  ✕ {erroresCnt} Con error
                </span>
              )}
              <span className={`${styles.badgeBase} ${styles.badgeTotal}`}>
                Total: {filas.length} filas
              </span>
            </div>

            {/* Acción duplicados */}
            {duplicadas > 0 && (
              <div className={styles.duplicadosBox}>
                <div className={styles.duplicadosTitulo}>
                  ⚠ Se detectaron {duplicadas} código(s) ya existente(s) — ¿Qué hacer?
                </div>
                <div className={styles.duplicadosBtnRow}>
                  <button
                    type="button"
                    onClick={() => setAccionDuplicados("saltar")}
                    className={`${styles.duplicadosBtn} ${accionDuplicados === "saltar" ? styles.activoSaltar : ''}`}
                  >
                    Saltar duplicados
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccionDuplicados("actualizar")}
                    className={`${styles.duplicadosBtn} ${accionDuplicados === "actualizar" ? styles.activoActualizar : ''}`}
                  >
                    Actualizar existentes
                  </button>
                </div>
              </div>
            )}

            {/* Preview tabla */}
            <div className={styles.previewWrap}>
              <table className={styles.previewTable}>
                <thead>
                  <tr className={styles.previewTheadRow}>
                    <th className={styles.previewTh}>Estado</th>
                    <th className={styles.previewTh}>Código</th>
                    <th className={styles.previewTh}>Marca</th>
                    <th className={styles.previewTh}>Tipo</th>
                    <th className={`${styles.previewTh} ${styles.previewThR}`}>Venta</th>
                    <th className={`${styles.previewTh} ${styles.previewThR}`}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((fila, i) => (
                    <tr key={i} className={`${styles.previewRow} ${fila.estado === "error" ? styles.error : fila.estado === "duplicado" ? styles.duplicado : ''}`}>
                      <td className={styles.previewTd}>
                        {fila.estado === "nuevo"      && <span className={styles.estadoNuevo}>✓ NUEVO</span>}
                        {fila.estado === "duplicado"  && <span className={styles.estadoDuplicado}>⚠ DUPLICADO</span>}
                        {fila.estado === "error"      && <span className={styles.estadoError}>✕ {fila.error}</span>}
                      </td>
                      <td className={styles.previewTdCodigo}>{fila.codigo}</td>
                      <td className={styles.previewTd}>{fila.fabricante}</td>
                      <td className={styles.previewTdGray}>{fila.tipoPieza}</td>
                      <td className={styles.previewTdPrecio}>
                        ${fila.precioVenta.toLocaleString("es-CL")}
                      </td>
                      <td className={styles.previewTdR}>{fila.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Acciones */}
        <div className="modal-actions">
          <button className="btn btn-dark" onClick={onClose} disabled={uploading}>Cancelar</button>
          {filas.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={handleSubir}
              disabled={uploading || filas.every(f => f.estado === "error")}
            >
              {uploading
                ? "Importando..."
                : `⬆ Importar ${nuevas + (accionDuplicados === "actualizar" ? duplicadas : 0)} producto(s)`
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}