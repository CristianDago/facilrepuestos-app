// ─── VEHÍCULO ─────────────────────────────────────────────
export interface Vehiculo {
  patente: string;
  make: string;
  model: string;
  year: string;
  type: string;
  engine: string;
  owner: string;
  rut?: string;          // RUT del propietario o empresa, para facturación
  telefono: string;
  email: string;
  km?: string;          // kilometraje actual del vehículo
  createdAt?: string;
  updatedAt?: string;
}

// ─── SERVICIO ─────────────────────────────────────────────
export interface Servicio {
  descripcion: string;
  detalle?: string;      // descripción técnica detallada del servicio
  precio: number;
  cantidad: number;
  total: number;
  mecanicoId?: string;
  mecanicoNombre?: string;
}

// ─── MATERIAL EXTERNO (repuesto de proveedor, sin inventario) ──
export interface MaterialPredefinido {
  id?: string;
  nombre: string;
  unidad: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialExterno {
  materialId?: string;
  descripcion: string;
  unidad: string;
  costo?: number;    // costo real (lo que te cobró el proveedor) — usado para calcular ganancia real
  precio: number;    // precio de venta al cliente (normalmente costo × 1.3)
  cantidad: number;
  total: number;
}

// ─── COSTO INTERNO (vinculado al inventario) ──────────────
export interface CostoInterno {
  inventarioId: string;
  descripcion: string;
  proveedor: string;
  costo: number;
  precioVenta?: number;
  cantidad: number;
  total: number;
}

// ─── REPUESTO VINCULADO A OT ──────────────────────────────
export interface RepuestoOT {
  inventarioId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
}

// ─── TAREA DENTRO DE UNA OT ───────────────────────────────
export interface TareaOT {
  id: string;
  descripcion: string;
  mecanicoId: string;
  mecanicoNombre: string;
  estado: 'pendiente' | 'en_proceso' | 'completada';
  createdAt: string;
  updatedAt?: string;
}

// ─── COTIZACIÓN ───────────────────────────────────────────
export type EstadoCotizacion = "Borrador" | "Enviada" | "Aprobada" | "Rechazada";

export interface Cotizacion {
  id?: string;
  numero: string;
  patente: string;
  nombre: string;
  email: string;
  telefono: string;
  marca: string;
  modelo: string;
  anio: string;
  tipo: string;
  motor: string;
  fecha: string;
  servicios: Servicio[];
  total: number;
  totalIva?: number;
  totalConIva?: number;
  condiciones: string;
  observaciones: string;
  costos: CostoInterno[];
  totalCostos: number;
  // ─── DESCUENTO ──────────────────────────────────────────
  descuento?: number;             // monto en pesos siempre
  tipoDescuento?: 'porcentaje' | 'monto';
  descuentoPct?: number;          // % original si tipoDescuento === 'porcentaje'
  // ────────────────────────────────────────────────────────
  estado: EstadoCotizacion;
  materialesExternos?: MaterialExterno[];
  otId?: string | null;
  envios?: EnvioCotizacion[];
  createdAt?: string;
  updatedAt?: string;
}

// ─── MÉTODO DE PAGO ───────────────────────────────────────
export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta Débito', 'Tarjeta Crédito'] as const;
export type MetodoPago = typeof METODOS_PAGO[number];

// ─── ORDEN DE TRABAJO ─────────────────────────────────────
export type EstadoOT = "Recibido" | "En Proceso" | "Listo" | "Entregado";

export interface OrdenTrabajo {
  id?: string;
  numero: string;
  patente: string;
  nombre: string;
  telefono: string;
  email: string;
  marca: string;
  modelo: string;
  anio: string;
  tipo: string;
  motor: string;
  km: string;
  cotizacionId?: string | null;
  cotizacionRef?: string;
  trabajos: Servicio[];
  repuestos: RepuestoOT[];
  tareas?: TareaOT[];
  total: number;
  totalIva?: number;
  totalConIva?: number;
  observaciones: string;
  notasInternas: string;
  // ─── DESCUENTO ──────────────────────────────────────────
  descuento?: number;             // monto en pesos siempre
  tipoDescuento?: 'porcentaje' | 'monto';
  descuentoPct?: number;          // % original si tipoDescuento === 'porcentaje'
  materialesExternos?: MaterialExterno[];  // insumos externos sin inventario
  // ─── MÉTODO DE PAGO ─────────────────────────────────────
  metodoPago?: MetodoPago | string;
  pagoSinIva?: boolean;           // true = se cobró sin IVA (transferencia entre personas)
  // ────────────────────────────────────────────────────────
  estado: EstadoOT;
  puesto?: string;                // ubicación física en el taller (Elevador 1, Piso, Sitio, etc.)
  envios?: EnvioOT[];
  fechaIngreso: string;
  fechaEntregaEstimada: string;
  fechaEntregaReal: string | null;
  stockDescontado: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// El ingreso REAL de una OT entregada depende de si el pago fue con o sin IVA:
// - pagoSinIva = true  → el negocio se queda con el monto completo (no hay IVA que declarar/remitir al SII)
// - pagoSinIva = false → el 19% de IVA no es ganancia, es impuesto retenido; el ingreso real es el neto
export const ingresoRealOT = (o: OrdenTrabajo): number => {
  const neto = o.total || 0;
  if (o.pagoSinIva) return o.totalConIva ?? Math.round(neto * 1.19);
  return neto;
};

// ─── PUESTOS DEL TALLER ─────────────────────────────────────
export const PUESTOS_TALLER = [
  'Elevador 1', 'Elevador 2', 'Elevador 3', 'Elevador 4', 'Elevador 5',
  'Piso', 'Sitio',
];

// ─── EQUIVALENCIA ────────────────────────────────────────────
export interface Equivalencia {
  fabricante: string;
  codigo:     string;
}

// ─── INVENTARIO & ÁRBOL DE CATEGORÍAS (ALINEADO CON FACILREPUESTOS.CL) ───
export type CategoriaInventario = string;

export interface SubcategoriaTienda {
  nombre: string;
  hijos?: string[];
}

export interface CategoriaTienda {
  nombre: string;
  subcategorias: SubcategoriaTienda[];
}

export const ARBOL_CATEGORIAS_TIENDA: CategoriaTienda[] = [
  {
    nombre: "Motor",
    subcategorias: [
      { nombre: "Soportes de Motor" },
      {
        nombre: "Alimentación e Inyección",
        hijos: ["Inyectores", "Bombas de Combustible", "Cuerpo de Aceleración"],
      },
      {
        nombre: "Escape",
        hijos: ["Múltiples y Catalizadores", "Silenciadores", "Sensores de Oxígeno"],
      },
      {
        nombre: "Componentes Internos",
        hijos: ["Válvulas", "Empaquetaduras y Juntas", "Cigüeñal", "Pistones"],
      },
      {
        nombre: "Distribución",
        hijos: ["Kits de Distribución", "Cadenas y Tensores"],
      },
    ],
  },
  {
    nombre: "Refrigeración y Climatización",
    subcategorias: [
      { nombre: "Radiadores y Electroventiladores" },
      { nombre: "Bombas de Agua y Termostatos" },
      { nombre: "Mangueras y Depósitos" },
      {
        nombre: "Aire Acondicionado",
        hijos: ["Compresores y Condensadores", "Evaporadores y Válvulas"],
      },
    ],
  },
  {
    nombre: "Mantenimiento Rápido",
    subcategorias: [
      {
        nombre: "Filtros",
        hijos: [
          "Filtro de Aceite",
          "Filtro de Aire",
          "Filtro de Combustible",
          "Filtro de Cabina y Polen",
        ],
      },
      {
        nombre: "Lubricantes y Fluidos",
        hijos: [
          "Aceites de Motor",
          "Fluidos de Transmisión",
          "Líquido de Frenos",
          "Anticongelante y Refrigerante",
          "Aditivos",
        ],
      },
    ],
  },
  {
    nombre: "Frenos",
    subcategorias: [
      { nombre: "Pastillas y Balatas" },
      { nombre: "Discos y Tambores" },
      { nombre: "Calipers y Cilindros" },
      { nombre: "Líneas y Bombas de Freno" },
      {
        nombre: "Sensores y Cables de Freno",
        hijos: ["Sensores ABS", "Cables de Freno de Mano"],
      },
    ],
  },
  {
    nombre: "Suspensión y Dirección",
    subcategorias: [
      {
        nombre: "Suspensión",
        hijos: ["Amortiguadores", "Espirales y Resortes", "Cazoletas y Rodamientos"],
      },
      {
        nombre: "Dirección",
        hijos: [
          "Bandejas y Brazos",
          "Terminales de Dirección",
          "Cremalleras",
          "Rótulas",
        ],
      },
    ],
  },
  {
    nombre: "Transmisión y Mando",
    subcategorias: [
      {
        nombre: "Embrague y Ejes",
        hijos: ["Homocinéticas y Ejes", "Kits de Embrague"],
      },
      { nombre: "Rodamientos de Maza" },
    ],
  },
  {
    nombre: "Sistema Eléctrico e Iluminación",
    subcategorias: [
      { nombre: "Baterías y Alternadores" },
      { nombre: "Motores de Arranque" },
      {
        nombre: "Iluminación",
        hijos: ["Intermitentes", "Faros y Focos Traseros", "Ampolletas y Bulbos"],
      },
      {
        nombre: "Sensores y Switches",
        hijos: ["Sensores CKP y CMP", "Sensores de Temperatura y Presión"],
      },
      {
        nombre: "Encendido",
        hijos: ["Bujías y Cables", "Bobinas de Encendido"],
      },
    ],
  },
  {
    nombre: "Carrocería y Espejos",
    subcategorias: [
      { nombre: "Parachoques y Rejillas" },
      {
        nombre: "Componentes de Chapa",
        hijos: ["Capó y Puertas", "Tapabarros y Guardabarros"],
      },
      {
        nombre: "Espejos Retrovisores",
        hijos: ["Cristales de Espejo", "Espejos Completos"],
      },
      {
        nombre: "Accesorios de Carrocería",
        hijos: ["Manillas y Chapas", "Amortiguadores de Maleta"],
      },
      {
        nombre: "Limpiaparabrisas",
        hijos: ["Plumillas"],
      },
    ],
  },
  {
    nombre: "Correas y Piolas",
    subcategorias: [
      { nombre: "Correas de Accesorios" },
      { nombre: "Tensores y Poleas" },
      { nombre: "Piolas y Cables" },
    ],
  },
];

export const CATEGORIAS_DEFAULT = [
  "Motor",
  "Refrigeración y Climatización",
  "Mantenimiento Rápido",
  "Frenos",
  "Suspensión y Dirección",
  "Transmisión y Mando",
  "Sistema Eléctrico e Iluminación",
  "Carrocería y Espejos",
  "Correas y Piolas",
] as const;

const normCatStr = (s?: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

export function obtenerSubcategorias(categoria?: string): SubcategoriaTienda[] {
  const n = normCatStr(categoria);
  const found = ARBOL_CATEGORIAS_TIENDA.find(c => normCatStr(c.nombre) === n);
  return found ? found.subcategorias : [];
}

export function obtenerSubcategoriasDetalle(categoria?: string, subcategoria?: string): string[] {
  const subs = obtenerSubcategorias(categoria);
  const nSub = normCatStr(subcategoria);
  const found = subs.find(s => normCatStr(s.nombre) === nSub);
  return found?.hijos || [];
}

/**
 * Resuelve la jerarquía completa (Categoría Principal › Subcategoría › Subcategoría Nivel 3)
 * tanto para ítems nuevos como para ítems heredados con categorías en mayúsculas (FRENOS, FILTROS, etc.).
 */
export function resolverJerarquiaCategoria(item: {
  categoria?: string;
  subcategoria?: string;
  subcategoriaDetalle?: string;
  tipoPieza?: string;
  nombre?: string;
}): { categoria: string; subcategoria: string; subcategoriaDetalle: string } {
  const rawCat = normCatStr(item.categoria);
  const rawSub = normCatStr(item.subcategoria);
  const rawDet = normCatStr(item.subcategoriaDetalle);
  const rawTipo = normCatStr(item.tipoPieza);
  const rawTexto = `${rawTipo} ${normCatStr(item.nombre)} ${rawCat}`;

  // 1. Si ya coincide con una de las 9 categorías principales exactas
  const catDirecta = ARBOL_CATEGORIAS_TIENDA.find(c => normCatStr(c.nombre) === rawCat);
  if (catDirecta) {
    const subDirecta = catDirecta.subcategorias.find(s => normCatStr(s.nombre) === rawSub);
    if (subDirecta) {
      const detDirecta = (subDirecta.hijos || []).find(h => normCatStr(h) === rawDet || normCatStr(h) === rawTipo);
      return {
        categoria: catDirecta.nombre,
        subcategoria: subDirecta.nombre,
        subcategoriaDetalle: detDirecta || item.subcategoriaDetalle || "",
      };
    }
    // Si rawSub era en realidad un hijo de nivel 3 o coincide con tipoPieza
    for (const sub of catDirecta.subcategorias) {
      if (normCatStr(sub.nombre) === rawTipo) {
        return { categoria: catDirecta.nombre, subcategoria: sub.nombre, subcategoriaDetalle: "" };
      }
      const hijoMatch = (sub.hijos || []).find(
        h => normCatStr(h) === rawSub || normCatStr(h) === rawDet || normCatStr(h) === rawTipo
      );
      if (hijoMatch) {
        return { categoria: catDirecta.nombre, subcategoria: sub.nombre, subcategoriaDetalle: hijoMatch };
      }
    }
  }

  // 2. Buscar coincidencia directa por subcategoría o hijo en todo el árbol
  for (const cat of ARBOL_CATEGORIAS_TIENDA) {
    for (const sub of cat.subcategorias) {
      if (rawSub && normCatStr(sub.nombre) === rawSub) {
        const det = (sub.hijos || []).find(h => normCatStr(h) === rawDet || normCatStr(h) === rawTipo) || "";
        return { categoria: cat.nombre, subcategoria: sub.nombre, subcategoriaDetalle: det };
      }
      for (const h of sub.hijos || []) {
        if ((rawDet && normCatStr(h) === rawDet) || (rawSub && normCatStr(h) === rawSub)) {
          return { categoria: cat.nombre, subcategoria: sub.nombre, subcategoriaDetalle: h };
        }
      }
    }
  }

  // 3. Inferencia inteligente para ítems heredados o federados de Soluparts / Global (8.500+ SKUs)
  const nombreAntesDePara = normCatStr(String(item.nombre || "").split(/\s+para\s+/i)[0]);
  const baseTexto = `${rawTipo} ${nombreAntesDePara} ${rawCat}`;
  const has = (re: RegExp) => re.test(baseTexto) || re.test(rawTexto);

  // Desambiguaciones prioritarias
  if (has(/\b(AMORTIGUADOR\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT|CAPO|COMPUERTA)|BOMBIN\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT))\b/)) {
    return { categoria: "Carrocería y Espejos", subcategoria: "Accesorios de Carrocería", subcategoriaDetalle: "Amortiguadores de Maleta" };
  }
  if (has(/\b(ALZAVIDRIO|ELEVAVIDRIO|CREMALLERA\s+ALZAVIDRIO)\b/)) {
    return { categoria: "Carrocería y Espejos", subcategoria: "Accesorios de Carrocería", subcategoriaDetalle: "Manillas y Chapas" };
  }
  if (has(/\b(DEPOSITO|RESERVORIO|BOTELLA)\b/)) {
    return { categoria: "Refrigeración y Climatización", subcategoria: "Mangueras y Depósitos", subcategoriaDetalle: "" };
  }

  if (rawCat === "FILTROS" || has(/\b(FILTRO|PORTAFILTRO|DECANTADOR)\b/)) {
    let det = "Filtro de Aire";
    if (has(/\bACEITE\b/)) det = "Filtro de Aceite";
    else if (has(/\b(COMBUSTIBLE|BENCINA|PETROLEO|DIESEL|GASOLINA|DECANTADOR)\b/)) det = "Filtro de Combustible";
    else if (has(/\b(CABINA|POLEN|HABITACULO|AIRE\s+ACONDICIONADO)\b/)) det = "Filtro de Cabina y Polen";
    return { categoria: "Mantenimiento Rápido", subcategoria: "Filtros", subcategoriaDetalle: det };
  }
  if (rawCat === "LUBRICANTES" || has(/\b(ACEITE\s+(?:DE\s+)?(?:MOTOR|CAJA|TRANSMISION|DIFERENCIAL)|LUBRICANTE|LIQUIDO\s+(?:DE\s+)?FRENO|REFRIGERANTE|COOLANT|ANTICONGELANTE|ADITIVO|ATF|\d+W\d+|DOT\s*[345])\b/)) {
    let det = "Aceites de Motor";
    if (has(/\b(TRANSMISION|ATF|CAJA|DIFERENCIAL|75W\d+|80W\d+)\b/)) det = "Fluidos de Transmisión";
    else if (has(/\b(LIQUIDO\s+(?:DE\s+)?FRENO|DOT\s*[345])\b/)) det = "Líquido de Frenos";
    else if (has(/\b(REFRIGERANTE|COOLANT|ANTICONGELANTE|AGUA\s+VERDE|AGUA\s+ROJA)\b/)) det = "Anticongelante y Refrigerante";
    else if (has(/\b(ADITIVO|AROMATIZANTE)\b/)) det = "Aditivos";
    return { categoria: "Mantenimiento Rápido", subcategoria: "Lubricantes y Fluidos", subcategoriaDetalle: det };
  }
  if (rawCat === "FRENOS" || has(/\b(PASTILLA|BALATA|ZAPATA|DISCO\s+(?:DE\s+)?FRENO|TAMBOR|CALIPER|MORDAZA|CILINDRO\s+(?:DE\s+)?(?:FRENO|RUEDA)|BOMBA\s+(?:DE\s+)?FRENO|SERVOFRENO|FLEXIBLE\s+(?:DE\s+)?FRENO|SENSOR\s+(?:DE\s+)?ABS|CABLE\s+(?:DE\s+)?FRENO|PIOLA\s+(?:DE\s+)?FRENO)\b/)) {
    if (has(/\b(DISCO|TAMBOR)\b/) && !has(/\bEMBRAGUE\b/)) return { categoria: "Frenos", subcategoria: "Discos y Tambores", subcategoriaDetalle: "" };
    if (has(/\b(CALIPER|MORDAZA|CILINDRO)\b/)) return { categoria: "Frenos", subcategoria: "Calipers y Cilindros", subcategoriaDetalle: "" };
    if (has(/\b(LINEA|FLEXIBLE|BOMBA\s+(?:DE\s+)?FRENO|SERVOFRENO)\b/)) return { categoria: "Frenos", subcategoria: "Líneas y Bombas de Freno", subcategoriaDetalle: "" };
    if (has(/\bABS\b/)) return { categoria: "Frenos", subcategoria: "Sensores y Cables de Freno", subcategoriaDetalle: "Sensores ABS" };
    if (has(/\b(CABLE.*FRENO|PIOLA.*FRENO)\b/)) return { categoria: "Frenos", subcategoria: "Sensores y Cables de Freno", subcategoriaDetalle: "Cables de Freno de Mano" };
    return { categoria: "Frenos", subcategoria: "Pastillas y Balatas", subcategoriaDetalle: "" };
  }
  if (rawCat === "EMBRAGUE" || rawCat === "TRANSMISION" || has(/\b(EMBRAGUE|PRENSA|COLLARIN|BOMBIN\s+EMBRAGUE|BOMBA\s+EMBRAGUE|VOLANTE\s+INERCIA|HOMOCINETICA|SEMI\s*EJE|PALIER|TRIPOIDE|CARDAN|CRUCETA|RODAMIENTO\s+(?:DE\s+)?(?:MAZA|RUEDA)|MAZA)\b/)) {
    if (has(/\b(MAZA|RODAMIENTO\s+(?:DE\s+)?(?:MAZA|RUEDA))\b/)) return { categoria: "Transmisión y Mando", subcategoria: "Rodamientos de Maza", subcategoriaDetalle: "" };
    if (has(/\b(HOMOCINETICA|SEMI\s*EJE|PALIER|TRIPOIDE|CARDAN|CRUCETA)\b/)) return { categoria: "Transmisión y Mando", subcategoria: "Embrague y Ejes", subcategoriaDetalle: "Homocinéticas y Ejes" };
    return { categoria: "Transmisión y Mando", subcategoria: "Embrague y Ejes", subcategoriaDetalle: "Kits de Embrague" };
  }
  if (rawCat === "SUSPENSION" || has(/\b(AMORTIGUADOR|ESPIRAL|RESORTE|BALLESTA|CAZOLETA|BANDEJA|BRAZO\s+SUSPENSION|BIELETA|BARRA\s+ESTABILIZADORA|BUJE|MUÑON|MUNON|ROTULA|TERMINAL|AXIAL|CREMALLERA|CAJA\s+DIRECCION|BOMBA\s+DIRECCION)\b/)) {
    if (has(/\b(BANDEJA|BRAZO|BIELETA|BARRA\s+ESTABILIZADORA|BUJE|MUÑON|MUNON)\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Dirección", subcategoriaDetalle: "Bandejas y Brazos" };
    if (has(/\b(TERMINAL|AXIAL|BARRA\s+DIRECCION)\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Dirección", subcategoriaDetalle: "Terminales de Dirección" };
    if (has(/\b(CREMALLERA|CAJA\s+DIRECCION|COLUMNA\s+DIRECCION|BOMBA\s+DIRECCION)\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Dirección", subcategoriaDetalle: "Cremalleras" };
    if (has(/\bROTULA\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Dirección", subcategoriaDetalle: "Rótulas" };
    if (has(/\b(ESPIRAL|RESORTE|BALLESTA)\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Suspensión", subcategoriaDetalle: "Espirales y Resortes" };
    if (has(/\bCAZOLETA\b/)) return { categoria: "Suspensión y Dirección", subcategoria: "Suspensión", subcategoriaDetalle: "Cazoletas y Rodamientos" };
    return { categoria: "Suspensión y Dirección", subcategoria: "Suspensión", subcategoriaDetalle: "Amortiguadores" };
  }
  if (rawCat === "DISTRIBUCION" || has(/\b(KIT\s+(?:DE\s+)?DISTRIBUCION|CORREA\s+(?:DE\s+)?DISTRIBUCION|CADENA\s+(?:DE\s+)?DISTRIBUCION|GUIA\s+CADENA|TENSOR\s+(?:DE\s+)?(?:DISTRIBUCION|CADENA))\b/)) {
    if (has(/\bCADENA\b/)) return { categoria: "Motor", subcategoria: "Distribución", subcategoriaDetalle: "Cadenas y Tensores" };
    return { categoria: "Motor", subcategoria: "Distribución", subcategoriaDetalle: "Kits de Distribución" };
  }
  if (has(/\b(RADIADOR|ELECTROVENTILADOR|VENTILADOR|ASPAS|INTERCOOLER|ENFRIADOR|BOMBA\s+(?:DE\s+)?AGUA|TERMOSTATO|CAJA\s+TERMOSTATO|COMPRESOR|CONDENSADOR|EVAPORADOR|CALEFACCION|MANGUERA)\b/)) {
    if (has(/\b(COMPRESOR|CONDENSADOR)\b/)) return { categoria: "Refrigeración y Climatización", subcategoria: "Aire Acondicionado", subcategoriaDetalle: "Compresores y Condensadores" };
    if (has(/\b(EVAPORADOR|CALEFACCION)\b/)) return { categoria: "Refrigeración y Climatización", subcategoria: "Aire Acondicionado", subcategoriaDetalle: "Evaporadores y Válvulas" };
    if (has(/\b(RADIADOR|ELECTROVENTILADOR|VENTILADOR|ASPAS|INTERCOOLER|ENFRIADOR)\b/)) return { categoria: "Refrigeración y Climatización", subcategoria: "Radiadores y Electroventiladores", subcategoriaDetalle: "" };
    if (has(/\b(BOMBA\s+(?:DE\s+)?AGUA|TERMOSTATO)\b/)) return { categoria: "Refrigeración y Climatización", subcategoria: "Bombas de Agua y Termostatos", subcategoriaDetalle: "" };
    return { categoria: "Refrigeración y Climatización", subcategoria: "Mangueras y Depósitos", subcategoriaDetalle: "" };
  }
  if (rawCat === "ELECTRICO" || has(/\b(BATERIA|ALTERNADOR|ARRANQUE|PARTIDA|BUJIA|BOBINA|FOCO|FAROL|FARO|OPTICO|NEBLINERO|AMPOLLETA|INTERMITENTE|SENSOR|TELECOMANDO|BOTONERA|SWITCH|CINTA\s+AIRBAG|BULBO)\b/)) {
    if (has(/\b(SENSOR\s+(?:DE\s+)?OXIGENO|SONDA\s+LAMBDA)\b/)) return { categoria: "Motor", subcategoria: "Escape", subcategoriaDetalle: "Sensores de Oxígeno" };
    if (has(/\b(BATERIA|ALTERNADOR)\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Baterías y Alternadores", subcategoriaDetalle: "" };
    if (has(/\b(ARRANQUE|PARTIDA)\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Motores de Arranque", subcategoriaDetalle: "" };
    if (has(/\bBUJIA\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Encendido", subcategoriaDetalle: "Bujías y Cables" };
    if (has(/\bBOBINA\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Encendido", subcategoriaDetalle: "Bobinas de Encendido" };
    if (has(/\b(INTERMITENTE|DIRECCIONAL)\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Iluminación", subcategoriaDetalle: "Intermitentes" };
    if (has(/\b(FARO|FAROL|FOCO|OPTICO|NEBLINERO|REFLECTANTE)\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Iluminación", subcategoriaDetalle: "Faros y Focos Traseros" };
    if (has(/\bAMPOLLETA\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Iluminación", subcategoriaDetalle: "Ampolletas y Bulbos" };
    if (has(/\b(CKP|CMP|CIGUEÑAL|CIGUENAL|LEVA|POSICION)\b/)) return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Sensores y Switches", subcategoriaDetalle: "Sensores CKP y CMP" };
    return { categoria: "Sistema Eléctrico e Iluminación", subcategoria: "Sensores y Switches", subcategoriaDetalle: "Sensores de Temperatura y Presión" };
  }
  if (has(/\b(CORREA|TENSOR|POLEA|DAMPER|RODILLO|PIOLA)\b/)) {
    if (has(/\b(TENSOR|POLEA|DAMPER|RODILLO)\b/)) return { categoria: "Correas y Piolas", subcategoria: "Tensores y Poleas", subcategoriaDetalle: "" };
    if (has(/\b(PIOLA|CABLE)\b/)) return { categoria: "Correas y Piolas", subcategoria: "Piolas y Cables", subcategoriaDetalle: "" };
    return { categoria: "Correas y Piolas", subcategoria: "Correas de Accesorios", subcategoriaDetalle: "" };
  }
  if (rawCat === "CARROCERIA" || has(/\b(PARACHOQUE|REJILLA|MASCARA|BISEL|CROMADO|MENSULA|DEFENSA|FRONTAL|CAPO|CAPOT|PUERTA|PORTALON|TAPABARRO|GUARDABARRO|GUARDAFANGO|MOLDURA|ESPEJO|MANILLA|CHAPA|PLUMILLA|LIMPIAPARABRISAS)\b/)) {
    if (has(/\b(PLUMILLA|LIMPIAPARABRISAS)\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Limpiaparabrisas", subcategoriaDetalle: "Plumillas" };
    if (has(/\b(CRISTAL\s+(?:DE\s+)?ESPEJO|VIDRIO\s+(?:DE\s+)?ESPEJO)\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Espejos Retrovisores", subcategoriaDetalle: "Cristales de Espejo" };
    if (has(/\bESPEJO\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Espejos Retrovisores", subcategoriaDetalle: "Espejos Completos" };
    if (has(/\b(CAPO|CAPOT|PUERTA|PORTALON|BISAGRA)\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Componentes de Chapa", subcategoriaDetalle: "Capó y Puertas" };
    if (has(/\b(TAPABARRO|GUARDABARRO|GUARDAFANGO|MOLDURA)\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Componentes de Chapa", subcategoriaDetalle: "Tapabarros y Guardabarros" };
    if (has(/\b(MANILLA|CHAPA|CERRADURA)\b/)) return { categoria: "Carrocería y Espejos", subcategoria: "Accesorios de Carrocería", subcategoriaDetalle: "Manillas y Chapas" };
    return { categoria: "Carrocería y Espejos", subcategoria: "Parachoques y Rejillas", subcategoriaDetalle: "" };
  }

  // Fallback a Motor
  if (has(/\bSOPORTE\b/)) return { categoria: "Motor", subcategoria: "Soportes de Motor", subcategoriaDetalle: "" };
  if (has(/\bINYECTOR\b/)) return { categoria: "Motor", subcategoria: "Alimentación e Inyección", subcategoriaDetalle: "Inyectores" };
  if (has(/\b(BOMBA\s+(?:DE\s+)?(?:COMBUSTIBLE|BENCINA|PETROLEO|INYECTORA))\b/)) return { categoria: "Motor", subcategoria: "Alimentación e Inyección", subcategoriaDetalle: "Bombas de Combustible" };
  if (has(/\b(CUERPO\s+(?:DE\s+)?ACELERACION|ADMISION)\b/) && !has(/\bMULTIPLE\b/)) return { categoria: "Motor", subcategoria: "Alimentación e Inyección", subcategoriaDetalle: "Cuerpo de Aceleración" };
  if (has(/\b(MULTIPLE|CATALIZADOR|TURBO)\b/)) return { categoria: "Motor", subcategoria: "Escape", subcategoriaDetalle: "Múltiples y Catalizadores" };
  if (has(/\b(SILENCIADOR|ESCAPE)\b/)) return { categoria: "Motor", subcategoria: "Escape", subcategoriaDetalle: "Silenciadores" };
  if (has(/\b(OXIGENO|LAMBDA)\b/)) return { categoria: "Motor", subcategoria: "Escape", subcategoriaDetalle: "Sensores de Oxígeno" };
  if (has(/\b(VALVULA|EJE\s+LEVA|LEVA|TAQUE|TAQUIES|BALANCIN|CULATA)\b/)) return { categoria: "Motor", subcategoria: "Componentes Internos", subcategoriaDetalle: "Válvulas" };
  if (has(/\b(EMPAQUETADURA|JUNTA|RETEN|SELLO|TAPA\s+VALVULA)\b/)) return { categoria: "Motor", subcategoria: "Componentes Internos", subcategoriaDetalle: "Empaquetaduras y Juntas" };
  if (has(/\b(CIGUENAL|CIGUEÑAL|METAL\s+BIELA|METAL\s+BANCADA|METAL)\b/)) return { categoria: "Motor", subcategoria: "Componentes Internos", subcategoriaDetalle: "Cigüeñal" };
  if (has(/\b(PISTON|ANILLO|BIELA|CARTER|BOMBA\s+ACEITE|BLOCK)\b/)) return { categoria: "Motor", subcategoria: "Componentes Internos", subcategoriaDetalle: "Pistones" };

  return {
    categoria: catDirecta?.nombre || "Motor",
    subcategoria: item.subcategoria || "Componentes Internos",
    subcategoriaDetalle: item.subcategoriaDetalle || "Empaquetaduras y Juntas",
  };
}

export const ORIGENES_REPUESTO = [
  "ALEMANIA","BRASIL","CHILE","CHINA","COREA DEL SUR","ESPAÑA","ESTADOS UNIDOS",
  "FRANCIA","INDIA","ITALIA","JAPÓN","MÉXICO","TAIWÁN","TAILANDIA","TURQUÍA",
] as const;

export interface ItemInventario {
  id?: string;
  nombre: string;
  codigo: string;               // SKU / Código de barras para pistoleo de existencias (ej: 5812495152509)
  codigoProducto?: string;      // Código real del producto / Nº de Parte OEM (ej: 13420-65D00TW)
  fabricante: string;           // En pantalla se muestra como "Marca del repuesto"
  origen?: string;              // País de origen del repuesto (ej: JAPÓN, CHINA)
  descripcion?: string;         // Descripción libre del repuesto
  equivalencias: Equivalencia[]; // Códigos equivalentes estructurados {fabricante, codigo}
  categoria: CategoriaInventario;
  subcategoria?: string;        // Subcategoría nivel 2 en facilrepuestos.cl (ej: "Alimentación e Inyección", "Filtros")
  subcategoriaDetalle?: string; // Subcategoría nivel 3 en facilrepuestos.cl (ej: "Inyectores", "Filtro de Aceite")
  proveedor: string;
  proveedorId?: string;   // vínculo al proveedor dueño del ítem (portal proveedor)
  tipoPieza: string;
  posicion: PosicionPieza;
  lado: LadoPieza;
  marcasCompatibles: string[];
  modelosCompatibles?: { [marca: string]: string[] }; // modelos por marca seleccionada
  anioDesde: number | null;
  anioHasta: number | null;
  precioImportacion?: number;  // costo que paga el proveedor al importar
  precioLista?: number;        // precio catálogo del proveedor
  descuentoTaller?: number;    // % descuento que el proveedor nos hace como taller
  precioCompra: number;        // neto que pagamos nosotros (precioLista × (1 - descuentoTaller/100))
  precioVenta: number;         // precio que cobramos al cliente final
  stock: number;
  stockReservado: number;
  stockMinimo: number;
  unidad: string;
  imagenUrl?: string;         // URL de la foto a usar al publicarlo en la tienda (solo se aplica al crear el producto)
  ocultarEnTienda?: boolean; // true = no se sincroniza/publica en la tienda WooCommerce
  // ─── MULTI-AILOO & WOOCOMMERCE DELTA SYNC ────────────────
  skuPublicoFrp?: string;     // SKU público unificado (FRP-SOL-..., FRP-GLB-..., FRP-LOC-...)
  prefijoSku?: string;        // Prefijo del nodo o proveedor
  origenDatos?: 'nodo_ailoo' | 'proveedor_local' | string;
  nodoAilooId?: string | null;
  datasetOrigen?: string;
  needsWooSync?: boolean;     // true = en cola de sincronización incremental (Delta) a WooCommerce
  wooSyncMotivo?: string | null;
  lastWooSyncAt?: string | null;
  wooProductId?: number | null;
  deltaHash?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockInfo { total: number; reservado: number; disponible: number; }

// ─── ESTADÍSTICAS DEL PROVEEDOR ───────────────────────────
// Datos agregados de los repuestos de UN proveedor (nunca precios de venta del taller ni clientes)
export interface EstadisticasProveedor {
  resumen: {
    totalItems:         number;
    unidadesStock:      number;
    valorStock:         number;   // stock × su precio
    stockBajo:          number;
    unidadesReservadas: number;   // comprometidas en órdenes de trabajo activas
    valorReservado:     number;
    unidadesVendidas:   number;   // total (taller + POS mostrador)
    montoVendido:       number;   // total neto vendido
    ticketsPos?:        number;   // cantidad de tickets de mostrador POS
    unidadesPos?:       number;   // unidades vendidas por POS mostrador
    montoPos?:          number;   // monto neto vendido por POS mostrador
    ordenesTaller?:     number;   // órdenes de trabajo entregadas
    unidadesTaller?:    number;   // unidades vendidas en taller
    montoTaller?:       number;   // monto neto vendido en taller
    itemsSinVentas:     number;
  };
  ventasPorMes:   { mes: string; unidades: number; monto: number; ordenes: number; ticketsPos?: number }[];   // mes = "YYYY-MM"
  masVendidos:    { id: string; nombre: string; codigo: string; unidades: number; monto: number }[];
  stockBajoItems: { id: string; nombre: string; codigo: string; disponible: number; stockMinimo: number }[];
  sinVentas:      { id: string; nombre: string; codigo: string; stock: number }[];
}

// Evita errores de precisión de punto flotante (ej: 84.8 - 0.9 = 83.90000000000004)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const getStockInfo = (item: ItemInventario): StockInfo => {
  const total     = round2(item.stock || 0);
  const reservado = round2(item.stockReservado || 0);
  return {
    total,
    reservado,
    disponible: round2(Math.max(0, total - reservado)),
  };
};

// ─── PROVEEDOR ────────────────────────────────────────────
export type TipoIntegracionProveedor =
  | 'portal_erp_local'
  | 'cotizacion_whatsapp'
  | 'hibrido_erp_wsp'
  | 'nodo_ailoo';

export interface Proveedor {
  id?: string;
  uid?: string;          // presente si tiene acceso creado al Panel Proveedor
  nombre: string;
  rut: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  categoria: string;
  categoriasEspecialidad?: string[]; // especialidades técnicas múltiples (Frenos, Embrague, Motor, etc.)
  marcas: string[];
  marcasVehiculo?: string[];
  notas: string;
  tipoIntegracion?: TipoIntegracionProveedor;
  canalWspActivo?: boolean;          // habilitado para recibir cotizaciones automáticas por WhatsApp (Etapa 3)
  margenPct?: number;                // margen comercial por defecto de FácilRepuestos (%)
  prefijoSku?: string;               // ej: FRP-LOC, FRP-WSP, FRP-SOL, FRP-GLB
  nodoAilooId?: string | null;       // 'soluparts' | 'global' cuando es nodo enterprise Ailoo
  tiempoRespuestaPromMin?: number;   // SLA promedio de respuesta en mesón (minutos)
  createdAt?: string;
  updatedAt?: string;
}

// ─── USUARIO / TRABAJADOR ─────────────────────────────────
export interface Usuario {
  id?: string;
  uid?: string;
  nombre: string;
  apellido: string;
  rut: string;
  telefono: string;
  email: string;
  especialidad?: string;
  cargo?: string;
  rol: 'admin' | 'mecanico' | 'administrativo';
  activo: boolean;
  contratoUrl?: string;       // link al documento del contrato (uno solo, se reemplaza)
  contratoFileName?: string;
  contratoFecha?: string;     // fecha en que se subió el contrato vigente
  createdAt?: string;
  updatedAt?: string;
}

// ─── LIQUIDACIÓN DE SUELDO ─────────────────────────────────
export interface Liquidacion {
  id:        string;
  usuarioId?: string;
  periodo:   string;
  monto:     number;
  url:       string;
  fileName:  string;
  createdAt: string;
}

// ─── API RESPONSE ─────────────────────────────────────────
export interface ApiResponse<T> { success: boolean; data?: T; error?: string; }

// ─── BOOSTR RESPONSE ──────────────────────────────────────
export interface BoostrVehiculo {
  plate: string; dv: string; make: string; model: string;
  year: number; type: string; engine: string;
}

// ─── MARCAS DE VEHÍCULOS ──────────────────────────────────
export const MARCAS_VEHICULOS = [
  "ALFA ROMEO","AUDI","BMW","BYD","CHERY","CHEVROLET","CITROËN","DODGE","FIAT","FORD",
  "GEELY","GREAT WALL","HAVAL","HONDA","HYUNDAI","INFINITI","JAC","JEEP","KIA","LAND ROVER",
  "LEXUS","MAZDA","MERCEDES-BENZ","MG","MINI","MITSUBISHI","NISSAN","OPEL","PEUGEOT","RAM",
  "RENAULT","SUBARU","SUZUKI","TOYOTA","VOLKSWAGEN","VOLVO","ZNA","OTRO",
];

export const TIPOS_PIEZA_DEFAULT = [
  // 1. Motor
  "SOPORTES DE MOTOR",
  "INYECTORES",
  "BOMBAS DE COMBUSTIBLE",
  "CUERPO DE ACELERACIÓN",
  "MÚLTIPLES Y CATALIZADORES",
  "SILENCIADORES",
  "SENSORES DE OXÍGENO",
  "VÁLVULAS",
  "EMPAQUETADURAS Y JUNTAS",
  "CIGÜEÑAL",
  "PISTONES",
  "KITS DE DISTRIBUCIÓN",
  "CADENAS Y TENSORES",
  // 2. Refrigeración y Climatización
  "RADIADORES Y ELECTROVENTILADORES",
  "BOMBAS DE AGUA Y TERMOSTATOS",
  "MANGUERAS Y DEPÓSITOS",
  "COMPRESORES Y CONDENSADORES",
  "EVAPORADORES Y VÁLVULAS",
  // 3. Mantenimiento Rápido
  "FILTRO DE ACEITE",
  "FILTRO DE AIRE",
  "FILTRO DE COMBUSTIBLE",
  "FILTRO DE CABINA Y POLEN",
  "ACEITES DE MOTOR",
  "FLUIDOS DE TRANSMISIÓN",
  "LÍQUIDO DE FRENOS",
  "ANTICONGELANTE Y REFRIGERANTE",
  "ADITIVOS",
  // 4. Frenos
  "PASTILLAS Y BALATAS",
  "DISCOS Y TAMBORES",
  "CALIPERS Y CILINDROS",
  "LÍNEAS Y BOMBAS DE FRENO",
  "SENSORES ABS",
  "CABLES DE FRENO DE MANO",
  // 5. Suspensión y Dirección
  "AMORTIGUADORES",
  "ESPIRALES Y RESORTES",
  "CAZOLETAS Y RODAMIENTOS",
  "BANDEJAS Y BRAZOS",
  "TERMINALES DE DIRECCIÓN",
  "CREMALLERAS",
  "RÓTULAS",
  // 6. Transmisión y Mando
  "HOMOCINÉTICAS Y EJES",
  "KITS DE EMBRAGUE",
  "RODAMIENTOS DE MAZA",
  // 7. Sistema Eléctrico e Iluminación
  "BATERÍAS Y ALTERNADORES",
  "MOTORES DE ARRANQUE",
  "INTERMITENTES",
  "FAROS Y FOCOS TRASEROS",
  "AMPOLLETAS Y BULBOS",
  "SENSORES CKP Y CMP",
  "SENSORES DE TEMPERATURA Y PRESIÓN",
  "BUJÍAS Y CABLES",
  "BOBINAS DE ENCENDIDO",
  // 8. Carrocería y Espejos
  "PARACHOQUES Y REJillas",
  "CAPÓ Y PUERTAS",
  "TAPABARROS Y GUARDABARROS",
  "CRISTALES DE ESPEJO",
  "ESPEJOS COMPLETOS",
  "MANILLAS Y CHAPAS",
  "AMORTIGUADORES DE MALETA",
  "PLUMILLAS",
  // 9. Correas y Piolas
  "CORREAS DE ACCESORIOS",
  "TENSORES Y POLEAS",
  "PIOLAS Y CABLES",
  "OTRO",
].map(s => s.toUpperCase());

export type PosicionPieza = "DELANTERA" | "TRASERA" | "NO APLICA";
export type LadoPieza     = "DERECHO" | "IZQUIERDO" | "AMBOS" | "NO APLICA";

export interface EnvioCotizacion { fecha: string; canal: "WhatsApp" | "Email"; }
export interface EnvioOT         { fecha: string; canal: "WhatsApp" | "Email" | "Físico"; }

// ─── COSTOS FIJOS ──────────────────────────────────────────
export interface CostoFijo {
  id?: string;
  categoria: string;        // MAYÚSCULAS (LUZ, ARRIENDO, AGUA, INTERNET, u otras agregadas)
  proveedor: string;
  numeroFactura: string;
  mes: number;               // 1–12
  anio: number;
  monto: number;              // neto
  descuentaIva: boolean;       // false = no se usa como crédito fiscal (ej: incluido en arriendo)
  iva: number;                 // 19% del monto si descuentaIva=true, si no 0
  totalConIva: number;
  fecha: string;               // DD/MM/AAAA — fecha de pago/registro
  notas?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const CATEGORIAS_COSTO_FIJO_DEFAULT = ["LUZ", "ARRIENDO", "AGUA", "INTERNET"];

export const MESES_NOMBRE = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

// ─── ESCALAMIENTO IA Y CONOCIMIENTO APRENDIDO ──────────────
export interface NodoAiloo {
  id: string;
  nombre: string;
  projectId: string;
  datasetId: string;            // ej. "soluparts_ailoo" | "global_ailoo"
  tablaEscalamientos: string;   // "escalamientos"
  tablaConocimiento: string;    // "conocimiento_aprendido"
  tablaCatalogo: string;        // "v_agente_catalogo"
  prefijoSku: string;           // "FRP-SOL" | "FRP-GLB"
  margenPct: number;            // % de margen comercial FácilRepuestos sobre costo proveedor
  activo: boolean;
  ultimaSync?: string;
  ultimaSincronizacionCatalogo?: string;
  ultimoResumenCatalogo?: {
    totalLeidos: number;
    nuevos: number;
    actualizados: number;
    sinCambiosOmitidos: number;
    modoOrigen: string;
  };
  updatedAt?: string;
}

export type EstadoEscalamientoIA = 'pendiente' | 'en_revision' | 'respondido' | 'cerrado';
export type TipoAprendizajeIA = 'compatibilidad' | 'equivalencia' | 'correccion_catalogo' | 'disponibilidad_precio';

export interface EscalamientoIA {
  id: string;
  ticketRef: string;            // ej. "FRP-ESC-1001" (oculta teléfono privado del cliente)
  sessionId?: string;
  canalOrigen: 'whatsapp' | 'web' | 'pos';
  tipoDestino: 'proveedor_local' | 'nodo_ailoo';
  proveedorId: string;
  proveedorNombre: string;
  nodoAilooId?: string | null;
  datasetDestino?: string | null; // ej. "soluparts_ailoo.escalamientos" | "global_ailoo.escalamientos"
  patente?: string;
  marcaVehiculo: string;
  modeloVehiculo: string;
  anioVehiculo?: number | null;
  motorVehiculo?: string;
  vinVehiculo?: string;
  mensajeCliente: string;
  motivoEscalamiento: string;
  respuestaAgentePreliminar?: string;
  transcripcionAudio?: string;
  imagenUrl?: string;
  candidatoInventarioId?: string | null;
  candidatoCodigo?: string;
  candidatoNombre?: string;
  estado: EstadoEscalamientoIA;
  prioridad?: 'alta' | 'media' | 'baja';
  respuestaMostrador?: string;
  respondidoPor?: string;
  respondidoEn?: string;
  precioCostoProveedor?: number;
  margenAplicadoPct?: number;
  precioVentaFrp?: number;
  skuPublicoFrp?: string;
  mensajeFinalCliente?: string;
  creadoEn: string;
  updatedAt?: string;
}

export interface ReglaConocimientoAprendido {
  id: string;
  escalamientoId?: string;
  origenTipo: 'proveedor_local' | 'nodo_ailoo';
  nodoAilooId?: string | null;
  datasetOrigen?: string;       // ej. "soluparts_ailoo.conocimiento_aprendido" | "global_ailoo.conocimiento_aprendido"
  proveedorId: string;
  proveedorNombre: string;
  tipoAprendizaje: TipoAprendizajeIA;
  preguntaResumen: string;
  respuestaValidada: string;
  terminosClave: string;
  marcaVehiculo: string;
  modeloVehiculo: string;
  anioDesde: number | null;
  anioHasta: number | null;
  motor?: string;
  categoriaRepuesto?: string;
  skuProveedor?: string;
  skuPublicoFrp?: string;
  precioCostoRef?: number;
  precioVentaFrpRef?: number;
  validadoPor: string;
  activo: boolean;
  creadoEn: string;
}

// ─── ETAPA 3: MESA DE COTIZACIÓN EN VIVO POR WHATSAPP (META CLOUD API) ───
export interface ProveedorContactadoWsp {
  proveedorId: string;
  proveedorNombre: string;
  contacto: string;
  telefono: string;
  especialidadMarcas: string[];
  estadoContacto: 'enviado' | 'respondido' | 'sin_stock';
  modoEnvio: 'meta_cloud_api_live' | 'meta_cloud_api_fallback' | 'simulacion_meta_local';
  metaMessageId: string;
  mensajeEnviado: string;
  enviadoEn: string;
  respondidoEn?: string | null;
}

export interface OfertaRecibidaWsp {
  id: string;
  proveedorId: string;
  proveedorNombre: string;
  telefonoProveedor: string;
  mensajeOriginalWsp: string;
  transcripcionAudio?: string;
  fotoUrl?: string;
  tieneStock: boolean;
  fabricante: string;
  origen: string;
  disponibilidad: string;
  garantia: string;
  precioCostoNeto: number;
  margenAplicadoPct: number;
  precioVentaFrpNeto: number;
  precioVentaFrpConIva: number;
  confianzaIa: number;
  ganadora: boolean;
  recibidoEn: string;
}

export interface SolicitudCotizacionWsp {
  id: string;
  codigoSolicitud: string;
  estado: 'esperando_respuestas' | 'con_ofertas' | 'adjudicada' | 'cerrada';
  canalCliente: 'whatsapp' | 'web' | 'pos';
  clienteNombre: string;
  clienteTelefono?: string;
  patente: string;
  vin?: string;
  marcaVehiculo: string;
  modeloVehiculo: string;
  anioVehiculo?: number | null;
  motorVehiculo?: string;
  categoriaRepuesto: string;
  repuestoBuscado: string;
  codigoReferencia?: string;
  notasAdicionales?: string;
  margenPct: number;
  escalamientoOrigenId?: string | null;
  proveedoresContactados: ProveedorContactadoWsp[];
  ofertasRecibidas: OfertaRecibidaWsp[];
  ofertaGanadoraId?: string | null;
  skuPublicoGenerado?: string | null;
  inventarioCreadoId?: string | null;
  conocimientoCreadoId?: string | null;
  mensajeCotizacionCliente?: string;
  adjudicadaEn?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── ETAPA 4: CEREBRO ORQUESTADOR AGENTE OMNICANAL (WEB + WHATSAPP CLIENTES) ───
export interface VehiculoDetectadoAgente {
  patente?: string;
  marca: string;
  modelo?: string;
  anio?: number | null;
  motor?: string;
  vin?: string;
  fuente?: string;
}

export interface CandidatoInventarioCascada {
  id: string;
  codigoInterno?: string;
  skuPublicoFrp: string;
  nombre: string;
  fabricante?: string;
  origen: 'soluparts_ailoo' | 'global_ailoo' | 'portal_proveedor_local' | 'mesa_whatsapp' | 'escalamiento_experto';
  nodoAilooId?: string | null;
  proveedorId?: string | null;
  proveedorNombre: string;
  stock: number;
  cantidad?: number;
  precioCostoProveedor: number;
  margenPct: number;
  precioVentaNeto: number;
  precioVentaConIva: number;
  subConsultaResumen?: string;
}

export interface ReglaAplicadaCascada {
  id: string;
  skuPublicoFrp: string;
  nombreRepuesto: string;
  explicacionExperta: string;
  proveedorNombre: string;
  precioVentaFrp: number;
}

export interface PedidoSimuladoAgente {
  id?: string;
  codigoPedido: string;
  sesionId: string;
  canal: string;
  clienteNombre: string;
  clienteTelefono?: string;
  vehiculo?: VehiculoDetectadoAgente | null;
  items: {
    skuPublicoFrp: string;
    nombre: string;
    fabricante?: string;
    origen?: string;
    proveedorNombre?: string;
    cantidad: number;
    precioVentaNeto: number;
    precioVentaConIva: number;
  }[];
  modalidadEntrega: 'retiro_bodega' | 'despacho_domicilio' | string;
  comunaEntrega: string;
  sucursalRetiro?: string;
  metodoPagoSimulado: string;
  estadoPago: 'pendiente_simulacion' | 'pagado_sandbox' | string;
  estadoLogistico: string;
  codigoAutorizacionSandbox?: string;
  subtotalNeto: number;
  totalConIva: number;
  urlCheckoutSimulado?: string;
  pagadoEn?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrazaCascadaAgente {
  accionTomada:
    | 'cotizacion_directa'
    | 'cotizacion_parcial_con_mesa_wsp'
    | 'escalamiento_experto'
    | 'mesa_whatsapp_viva'
    | 'seguimiento_sin_duplicar'
    | 'respuesta_proveedor_en_vivo'
    | 'checkout_simulado_creado'
    | 'checkout_simulado_pagado';
  vehiculoDetectado?: VehiculoDetectadoAgente | null;
  subConsultasDetectadas?: string[];
  reglasConocimientoAplicadas: ReglaAplicadaCascada[];
  candidatosInventario: CandidatoInventarioCascada[];
  escalamientoCreado?: {
    id: string;
    ticketRef: string;
    destino: string;
    candidatoSku?: string;
    resumenRepuesto?: string;
    patente?: string;
  } | null;
  solicitudWspCreada?: {
    id: string;
    codigoSolicitud: string;
    proveedoresContactados: string[];
    resumenRepuesto?: string;
    patente?: string;
  } | null;
  pedidoSimulado?: PedidoSimuladoAgente | null;
}

export interface MensajeSesionAgente {
  id: string;
  autor: 'cliente' | 'agente_ia';
  texto: string;
  transcripcionAudio?: string;
  fotoUrl?: string;
  creadoEn: string;
  trazaCascada?: TrazaCascadaAgente;
}

export interface SesionAgenteOmnicanal {
  id: string;
  canal: 'whatsapp_cliente' | 'web_cliente';
  clienteNombre: string;
  clienteTelefono?: string;
  estado: 'activa' | 'cerrada';
  vehiculoContexto?: VehiculoDetectadoAgente | null;
  carritoCotizado?: CandidatoInventarioCascada[];
  comunaCliente?: string | null;
  modalidadEntrega?: string | null;
  pedidoActivo?: PedidoSimuladoAgente | null;
  escalamientosAbiertos?: {
    id: string;
    ticketRef: string;
    destino: string;
    candidatoSku?: string;
    resumenRepuesto?: string;
    patente?: string;
  }[];
  solicitudesWspAbiertas?: {
    id: string;
    codigoSolicitud: string;
    proveedoresContactados: string[];
    resumenRepuesto?: string;
    patente?: string;
  }[];
  mensajes: MensajeSesionAgente[];
  createdAt: string;
  updatedAt: string;
}


