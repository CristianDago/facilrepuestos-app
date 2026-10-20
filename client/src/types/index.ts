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

// ─── INVENTARIO ───────────────────────────────────────────
// Categorías predefinidas + posibilidad de agregar custom desde Firestore
export type CategoriaInventario = string;
export const CATEGORIAS_DEFAULT = [
  "FRENOS","FILTROS","LUBRICANTES","SUSPENSIÓN",
  "ELÉCTRICO","DISTRIBUCIÓN","NEUMÁTICOS","EMBRAGUE","OTROS",
] as const;

export const ORIGENES_REPUESTO = [
  "ALEMANIA","BRASIL","CHILE","CHINA","COREA DEL SUR","ESPAÑA","ESTADOS UNIDOS",
  "FRANCIA","INDIA","ITALIA","JAPÓN","MÉXICO","TAIWÁN","TAILANDIA","TURQUÍA",
] as const;

export interface ItemInventario {
  id?: string;
  nombre: string;
  codigo: string;
  fabricante: string;           // En pantalla se muestra como "Marca del repuesto"
  origen?: string;              // País de origen del repuesto (ej: JAPÓN, CHINA)
  descripcion?: string;         // Descripción libre del repuesto
  equivalencias: Equivalencia[]; // Códigos equivalentes estructurados {fabricante, codigo}
  categoria: CategoriaInventario;
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
    unidadesVendidas:   number;   // en órdenes de trabajo entregadas
    montoVendido:       number;   // a su precio actual
    itemsSinVentas:     number;
  };
  ventasPorMes:   { mes: string; unidades: number; monto: number; ordenes: number }[];   // mes = "YYYY-MM"
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
  marcas: string[];
  notas: string;
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
  "PASTILLAS DE FRENO","DISCO DE FRENO","CAZOLETA","BANDEJA","AMORTIGUADOR","RESORTE",
  "CORREA DE DISTRIBUCIÓN","TENSOR DE DISTRIBUCIÓN","BOMBA DE AGUA","FILTRO DE ACEITE",
  "FILTRO DE AIRE","FILTRO DE COMBUSTIBLE","FILTRO DE HABITÁCULO","BUJÍA","BOBINA",
  "SENSOR","RADIADOR","TERMOSTATO","EMBRAGUE","KIT DE DISTRIBUCIÓN","ACEITE DE MOTOR",
  "LÍQUIDO DE FRENOS","REFRIGERANTE","BATERÍA","ALTERNADOR","MOTOR DE ARRANQUE",
  "RODAMIENTO","TERMINAL DE DIRECCIÓN","BARRA ESTABILIZADORA","BRAZO DE CONTROL","OTRO",
];

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