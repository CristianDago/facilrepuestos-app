import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, '../.local-db.json');

const SEED_DATA = {
  usuarios: {
    'dev-admin-doc': {
      uid: 'dev-user-admin',
      email: 'taller@drmotors.cl',
      nombre: 'Taller Dr. Motors',
      apellido: '(Admin Local)',
      rol: 'admin',
      activo: true,
    },
  },
  proveedores: {
    'prov-demo-001': {
      uid: 'dev-user-proveedor',
      email: 'proveedor@facilrepuestos.cl',
      rut: '76.123.456-7',
      nombre: 'Proveedor Demo',
      contacto: 'Ventas Mostrador',
      telefono: '+56 9 8765 4321',
      activo: true,
    },
  },
  categorias: {
    'cat-frenos': { nombre: 'FRENOS' },
    'cat-filtros': { nombre: 'FILTROS' },
    'cat-motor': { nombre: 'MOTOR' },
    'cat-suspension': { nombre: 'SUSPENSIÓN' },
    'cat-embrague': { nombre: 'EMBRAGUE' },
    'cat-lubricantes': { nombre: 'LUBRICANTES' },
    'cat-electrico': { nombre: 'ELÉCTRICO' },
    'cat-distribucion': { nombre: 'DISTRIBUCIÓN' },
  },
  fabricantes: {
    'fab-bosch': { nombre: 'BOSCH' },
    'fab-mann': { nombre: 'MANN-FILTER' },
    'fab-ngk': { nombre: 'NGK' },
    'fab-brembo': { nombre: 'BREMBO' },
    'fab-valeo': { nombre: 'VALEO' },
    'fab-kyb': { nombre: 'KYB' },
    'fab-trw': { nombre: 'TRW' },
    'fab-gates': { nombre: 'GATES' },
    'fab-skf': { nombre: 'SKF' },
  },
  tipos_pieza: {
    'tp-pastillas': { nombre: 'PASTILLAS DE FRENO' },
    'tp-disco': { nombre: 'DISCO DE FRENO' },
    'tp-filtro-aceite': { nombre: 'FILTRO DE ACEITE' },
    'tp-filtro-aire': { nombre: 'FILTRO DE AIRE' },
    'tp-bujias': { nombre: 'BUJÍAS' },
    'tp-amortiguador': { nombre: 'AMORTIGUADOR' },
    'tp-kit-embrague': { nombre: 'KIT DE EMBRAGUE' },
    'tp-correa': { nombre: 'CORREA DE DISTRIBUCIÓN' },
  },
  marcas_vehiculo: {
    'mv-toyota': { nombre: 'TOYOTA' },
    'mv-hyundai': { nombre: 'HYUNDAI' },
    'mv-kia': { nombre: 'KIA' },
    'mv-chevrolet': { nombre: 'CHEVROLET' },
    'mv-nissan': { nombre: 'NISSAN' },
    'mv-suzuki': { nombre: 'SUZUKI' },
    'mv-peugeot': { nombre: 'PEUGEOT' },
  },
  inventario: {
    'inv-001': {
      codigo: '0986424792',
      nombre: 'PASTILLAS DE FRENO DELANTERAS BOSCH 0986424792',
      fabricante: 'BOSCH',
      categoria: 'FRENOS',
      tipoPieza: 'PASTILLAS DE FRENO',
      posicion: 'DELANTERA',
      lado: 'AMBOS',
      marcasCompatibles: ['TOYOTA', 'HYUNDAI'],
      modelosCompatibles: { TOYOTA: ['YARIS', 'COROLLA'], HYUNDAI: ['ACCENT'] },
      equivalencias: [{ fabricante: 'TRW', codigo: 'GDB3352' }],
      precioCompra: 18500,
      precioLista: 24050,
      precioVenta: 24050,
      stock: 12,
      stockReservado: 0,
      stockMinimo: 3,
      unidad: 'JUEGO',
      proveedorId: 'prov-demo-001',
      proveedor: 'Proveedor Demo',
      ocultarEnTienda: false,
      createdAt: '2026-10-25T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
    },
    'inv-002': {
      codigo: 'W712/95',
      nombre: 'FILTRO DE ACEITE MANN-FILTER W712/95',
      fabricante: 'MANN-FILTER',
      categoria: 'FILTROS',
      tipoPieza: 'FILTRO DE ACEITE',
      posicion: 'NO APLICA',
      lado: 'NO APLICA',
      marcasCompatibles: ['VOLKSWAGEN', 'CHEVROLET'],
      modelosCompatibles: { VOLKSWAGEN: ['GOL', 'POLO'] },
      equivalencias: [{ fabricante: 'BOSCH', codigo: '0451103314' }],
      precioCompra: 6500,
      precioLista: 8450,
      precioVenta: 8450,
      stock: 25,
      stockReservado: 0,
      stockMinimo: 5,
      unidad: 'UNIDAD',
      proveedorId: 'prov-demo-001',
      proveedor: 'Proveedor Demo',
      ocultarEnTienda: false,
      createdAt: '2026-10-26T10:30:00.000Z',
      updatedAt: '2026-10-28T10:30:00.000Z',
    },
    'inv-003': {
      codigo: 'BKR6E-11',
      nombre: 'JUEGO BUJIAS NGK BKR6E-11',
      fabricante: 'NGK',
      categoria: 'MOTOR',
      tipoPieza: 'BUJÍAS',
      posicion: 'NO APLICA',
      lado: 'NO APLICA',
      marcasCompatibles: ['NISSAN', 'SUZUKI', 'MAZDA'],
      modelosCompatibles: { NISSAN: ['SENTRA', 'TIIDA'], SUZUKI: ['SWIFT'] },
      equivalencias: [],
      precioCompra: 12000,
      precioLista: 15600,
      precioVenta: 15600,
      stock: 8,
      stockReservado: 0,
      stockMinimo: 2,
      unidad: 'JUEGO',
      proveedorId: 'prov-demo-001',
      proveedor: 'Proveedor Demo',
      ocultarEnTienda: false,
      createdAt: '2026-10-27T09:15:00.000Z',
      updatedAt: '2026-10-28T09:15:00.000Z',
    },
    'inv-004': {
      codigo: '339114',
      nombre: 'AMORTIGUADOR DELANTERO KYB EXCEL-G 339114',
      fabricante: 'KYB',
      categoria: 'SUSPENSIÓN',
      tipoPieza: 'AMORTIGUADOR',
      posicion: 'DELANTERA',
      lado: 'DERECHO',
      marcasCompatibles: ['TOYOTA'],
      modelosCompatibles: { TOYOTA: ['RAV4', 'COROLLA'] },
      equivalencias: [],
      precioCompra: 45000,
      precioLista: 58500,
      precioVenta: 58500,
      stock: 2,
      stockReservado: 0,
      stockMinimo: 2,
      unidad: 'UNIDAD',
      proveedorId: 'prov-demo-001',
      proveedor: 'Proveedor Demo',
      ocultarEnTienda: false,
      createdAt: '2026-10-27T14:20:00.000Z',
      updatedAt: '2026-10-28T14:20:00.000Z',
    },
  },
  ventas_pos: {},
  ordenes_trabajo: {},
  vehiculos: {},
  cotizaciones: {},
  costos_fijos: {},
  calendario: {},
  mantenimiento: {},
  liquidaciones: {},
  servicios_predefinidos: {},
  materiales_predefinidos: {},
  nodos_ailoo: {
    'soluparts': {
      nombre: 'Soluparts',
      projectId: 'soluparts-mostrador-prod',
      datasetId: 'soluparts',
      tablaEscalamientos: 'escalamientos',
      tablaConocimiento: 'conocimiento_aprendido',
      tablaCatalogo: 'v_agente_catalogo',
      prefijoSku: 'FRP-SOL',
      margenPct: 0,
      activo: true,
      ultimaSync: '2026-10-29T22:30:00.000Z',
      updatedAt: '2026-10-29T22:30:00.000Z',
    },
    'global': {
      nombre: 'Global Repuestos',
      projectId: 'global-mostrador-prod',
      datasetId: 'global_ailoo',
      tablaEscalamientos: 'escalamientos',
      tablaConocimiento: 'conocimiento_aprendido',
      tablaCatalogo: 'v_agente_catalogo',
      prefijoSku: 'FRP-GLB',
      margenPct: 25,
      activo: true,
      ultimaSync: '2026-10-29T22:15:00.000Z',
      updatedAt: '2026-10-29T22:15:00.000Z',
    },
  },
  escalamientos_ia: {
    'esc-demo-001': {
      ticketRef: 'FRP-ESC-1001',
      sessionId: 'wsp-session-9981',
      canalOrigen: 'whatsapp',
      tipoDestino: 'proveedor_local',
      proveedorId: 'prov-demo-001',
      proveedorNombre: 'Proveedor Demo',
      nodoAilooId: null,
      datasetDestino: null,
      patente: 'JPKR42',
      marcaVehiculo: 'TOYOTA',
      modeloVehiculo: 'YARIS',
      anioVehiculo: 2018,
      motorVehiculo: '1.5 2NR-FE',
      vinVehiculo: 'MR2BW9F34J1048291',
      mensajeCliente: 'Hola, necesito las pastillas de freno delanteras para mi Yaris Sport 1.5 año 2018, ¿le sirven las Bosch 0986424792 que vi en la web o lleva otro cálipers?',
      motivoEscalamiento: 'Confirmar compatibilidad año 2018 y motor 1.5 2NR-FE para SKU 0986424792 (ficha actual sin rango de años explícito)',
      respuestaAgentePreliminar: 'Estoy validando con especialista técnico de freno para confirmar calce exacto en cálipers de tu Toyota Yaris 1.5 2018.',
      transcripcionAudio: 'Jefe, le mandé la patente JPKR42, quiero estar seguro si la pastilla Bosch le hace al Yaris 2018 antes de comprarla por la página.',
      imagenUrl: '',
      candidatoInventarioId: 'inv-001',
      candidatoCodigo: '0986424792',
      candidatoNombre: 'PASTILLAS DE FRENO DELANTERAS BOSCH 0986424792',
      estado: 'pendiente',
      prioridad: 'alta',
      creadoEn: '2026-10-29T22:40:00.000Z',
      updatedAt: '2026-10-29T22:40:00.000Z',
    },
    'esc-demo-002': {
      ticketRef: 'FRP-ESC-1002',
      sessionId: 'web-session-4412',
      canalOrigen: 'web',
      tipoDestino: 'proveedor_local',
      proveedorId: 'prov-demo-001',
      proveedorNombre: 'Proveedor Demo',
      nodoAilooId: null,
      datasetDestino: null,
      patente: 'LRTW88',
      marcaVehiculo: 'SUZUKI',
      modeloVehiculo: 'SWIFT',
      anioVehiculo: 2019,
      motorVehiculo: '1.2 K12M',
      vinVehiculo: 'MA3EUA61S00391822',
      mensajeCliente: 'Busco juego de bujías para Suzuki Swift 1.2 2019, ¿la NGK BKR6E-11 le sirve o este motor 1.2 lleva iridium?',
      motivoEscalamiento: 'Validar si motor 1.2 K12M 2019 usa BKR6E-11 convencional o requiere código alternativo',
      respuestaAgentePreliminar: 'Consultando con bodega técnica sobre especificación de bujías para motor 1.2 K12M.',
      transcripcionAudio: '',
      imagenUrl: '',
      candidatoInventarioId: 'inv-003',
      candidatoCodigo: 'BKR6E-11',
      candidatoNombre: 'JUEGO BUJIAS NGK BKR6E-11',
      estado: 'pendiente',
      prioridad: 'media',
      creadoEn: '2026-10-29T22:50:00.000Z',
      updatedAt: '2026-10-29T22:50:00.000Z',
    },
    'esc-demo-003': {
      ticketRef: 'FRP-ESC-1003',
      sessionId: 'wsp-session-7710',
      canalOrigen: 'whatsapp',
      tipoDestino: 'nodo_ailoo',
      proveedorId: 'soluparts',
      proveedorNombre: 'Soluparts (Ailoo)',
      nodoAilooId: 'soluparts',
      datasetDestino: 'soluparts_ailoo.escalamientos',
      patente: 'KTRB19',
      marcaVehiculo: 'CHEVROLET',
      modeloVehiculo: 'SAIL',
      anioVehiculo: 2017,
      motorVehiculo: '1.5 L2B',
      vinVehiculo: 'LSGHD52H8HY112094',
      mensajeCliente: 'Necesito bomba de agua y kit de embrague para Chevrolet Sail 1.5 2017 versión New Sail.',
      motivoEscalamiento: 'Desambiguar generación OLD vs NEW Sail en año de transición 2017 (motor 1.5 L2B cadena vs 1.4)',
      respuestaAgentePreliminar: 'Validando con mostrador técnico la generación exacta New Sail 1.5 2017.',
      transcripcionAudio: '',
      imagenUrl: '',
      candidatoInventarioId: null,
      candidatoCodigo: 'SOL-94821',
      candidatoNombre: 'KIT EMBRAGUE CHEVROLET NEW SAIL 1.5 2016-2021',
      estado: 'pendiente',
      prioridad: 'alta',
      creadoEn: '2026-10-29T23:00:00.000Z',
      updatedAt: '2026-10-29T23:00:00.000Z',
    },
    'esc-demo-004': {
      ticketRef: 'FRP-ESC-1004',
      sessionId: 'wsp-session-6102',
      canalOrigen: 'whatsapp',
      tipoDestino: 'nodo_ailoo',
      proveedorId: 'global',
      proveedorNombre: 'Global Repuestos (Ailoo)',
      nodoAilooId: 'global',
      datasetDestino: 'global_ailoo.escalamientos',
      patente: 'PFGH55',
      marcaVehiculo: 'CHERY',
      modeloVehiculo: 'TIGGO 2',
      anioVehiculo: 2020,
      motorVehiculo: '1.5 SQR477F',
      vinVehiculo: 'LVVDC21B9LD092811',
      mensajeCliente: '¿Tienen bandeja de suspensión delantera derecha para Chery Tiggo 2 1.5 año 2020?',
      motivoEscalamiento: 'Confirmar lado y diámetro de rótula en bandeja delantera Chery Tiggo 2 2020 en nodo global_ailoo',
      respuestaAgentePreliminar: 'Verificando en bodega Global la bandeja delantera derecha para Chery Tiggo 2 2020.',
      transcripcionAudio: '',
      imagenUrl: '',
      candidatoInventarioId: null,
      candidatoCodigo: 'GLB-55210',
      candidatoNombre: 'BANDEJA SUSPENSION DEL DER CHERY TIGGO 2 1.5 17-22',
      estado: 'respondido',
      prioridad: 'media',
      respuestaMostrador: 'Confirmado, aplica perfecto la bandeja código GLB-55210 con rótula de 16mm para todos los Chery Tiggo 2 1.5 SQR477F entre 2017 y 2022.',
      respondidoPor: 'Mostrador Global (global_ailoo)',
      respondidoEn: '2026-10-29T23:05:00.000Z',
      precioCostoProveedor: 36000,
      margenAplicadoPct: 25,
      precioVentaFrp: 45000,
      skuPublicoFrp: 'FRP-GLB-55210',
      mensajeFinalCliente: '¡Confirmado por nuestro equipo técnico! La Bandeja de Suspensión Delantera Derecha (SKU: FRP-GLB-55210) es 100% compatible con tu Chery Tiggo 2 1.5 2020 (rótula 16mm). Valor FácilRepuestos: $45.000 neto ($53.550 IVA inc.).',
      creadoEn: '2026-10-29T22:20:00.000Z',
      updatedAt: '2026-10-29T23:05:00.000Z',
    },
  },
  conocimiento_aprendido: {
    'know-001': {
      escalamientoId: 'esc-demo-004',
      origenTipo: 'nodo_ailoo',
      nodoAilooId: 'global',
      datasetOrigen: 'global_ailoo.conocimiento_aprendido',
      proveedorId: 'global',
      proveedorNombre: 'Global Repuestos (Ailoo)',
      tipoAprendizaje: 'compatibilidad',
      preguntaResumen: 'Compatibilidad bandeja delantera derecha Chery Tiggo 2 1.5 2020',
      respuestaValidada: 'La bandeja delantera derecha GLB-55210 (rótula 16mm) es compatible con Chery Tiggo 2 motor 1.5 SQR477F años 2017 al 2022 (no aplica a versión Pro 2023+ con rótula 18mm).',
      terminosClave: 'bandeja delantera derecha chery tiggo 2 1.5 sqr477f rotula 16mm',
      marcaVehiculo: 'CHERY',
      modeloVehiculo: 'TIGGO 2',
      anioDesde: 2017,
      anioHasta: 2022,
      motor: '1.5 SQR477F',
      categoriaRepuesto: 'SUSPENSIÓN',
      skuProveedor: 'GLB-55210',
      skuPublicoFrp: 'FRP-GLB-55210',
      precioCostoRef: 36000,
      precioVentaFrpRef: 45000,
      validadoPor: 'Mostrador Global (global_ailoo)',
      activo: true,
      creadoEn: '2026-10-29T23:05:00.000Z',
    },
    'know-002': {
      escalamientoId: 'esc-hist-sol-01',
      origenTipo: 'nodo_ailoo',
      nodoAilooId: 'soluparts',
      datasetOrigen: 'soluparts_ailoo.conocimiento_aprendido',
      proveedorId: 'soluparts',
      proveedorNombre: 'Soluparts (Ailoo)',
      tipoAprendizaje: 'compatibilidad',
      preguntaResumen: 'Diferencia amortiguador delantero Toyota Hilux 2.4 vs 2.8 Revo (2016-2023)',
      respuestaValidada: 'Hilux Revo 2.4 y 2.8 4x4 (2016-2023) comparten el mismo amortiguador delantero reforzado vástago grueso. No compatible con Hilux Vigo 2006-2015.',
      terminosClave: 'amortiguador delantero toyota hilux revo 2.4 2.8 4x4 2gd 1gd',
      marcaVehiculo: 'TOYOTA',
      modeloVehiculo: 'HILUX',
      anioDesde: 2016,
      anioHasta: 2023,
      motor: '2.4 2GD / 2.8 1GD',
      categoriaRepuesto: 'SUSPENSIÓN',
      skuProveedor: 'SOL-44109',
      skuPublicoFrp: 'FRP-SOL-44109',
      precioCostoRef: 42000,
      precioVentaFrpRef: 52500,
      validadoPor: 'Mostrador Soluparts (soluparts_ailoo)',
      activo: true,
      creadoEn: '2026-10-29T18:10:00.000Z',
    },
    'know-003': {
      escalamientoId: 'esc-hist-loc-01',
      origenTipo: 'proveedor_local',
      nodoAilooId: null,
      datasetOrigen: 'firestore.conocimiento_aprendido',
      proveedorId: 'prov-demo-001',
      proveedorNombre: 'Proveedor Demo',
      tipoAprendizaje: 'equivalencia',
      preguntaResumen: 'Filtro de aceite Mann W712/95 para Volkswagen Gol 1.6 MSI',
      respuestaValidada: 'El filtro Mann W712/95 (equivalente Bosch 0451103314) aplica a Volkswagen Gol y Voyage 1.6 (2013-2022) con válvula antirretorno de 1.0 bar.',
      terminosClave: 'filtro aceite mann w712/95 bosch 0451103314 vw gol voyage 1.6',
      marcaVehiculo: 'VOLKSWAGEN',
      modeloVehiculo: 'GOL',
      anioDesde: 2013,
      anioHasta: 2022,
      motor: '1.6',
      categoriaRepuesto: 'FILTROS',
      skuProveedor: 'W712/95',
      skuPublicoFrp: 'FRP-LOC-W712/95',
      precioCostoRef: 6500,
      precioVentaFrpRef: 8450,
      validadoPor: 'Proveedor Demo',
      activo: true,
      creadoEn: '2026-10-28T16:45:00.000Z',
    },
  },
};

function loadStore() {
  try {
    if (existsSync(DB_FILE)) {
      const parsed = JSON.parse(readFileSync(DB_FILE, 'utf8'));
      const merged = { ...SEED_DATA, ...parsed };
      let needsSave = false;
      for (const col of ['nodos_ailoo', 'escalamientos_ia', 'conocimiento_aprendido']) {
        if (!parsed[col] || Object.keys(parsed[col]).length === 0) {
          merged[col] = structuredClone(SEED_DATA[col]);
          needsSave = true;
        }
      }
      if (needsSave) saveStore(merged);
      return merged;
    }
  } catch (e) {
    console.warn('[LocalDB] No se pudo leer .local-db.json, inicializando con datos semilla:', e.message);
  }
  const initial = structuredClone(SEED_DATA);
  saveStore(initial);
  return initial;
}

function saveStore(store) {
  try {
    writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.warn('[LocalDB] Error guardando .local-db.json:', e.message);
  }
}

function genId() {
  return 'loc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function createLocalDb() {
  const store = loadStore();

  const ensureCollection = (name) => {
    if (!store[name]) store[name] = {};
    return store[name];
  };

  const makeDocSnapshot = (id, data) => ({
    id,
    exists: data !== undefined,
    data: () => (data !== undefined ? structuredClone(data) : undefined),
  });

  const makeDocRef = (colName, docId) => {
    const id = docId || genId();
    return {
      id,
      _colName: colName,
      async get() {
        const col = ensureCollection(colName);
        return makeDocSnapshot(id, col[id]);
      },
      async set(data, options = {}) {
        const col = ensureCollection(colName);
        if (options.merge && col[id]) {
          col[id] = { ...col[id], ...structuredClone(data) };
        } else {
          col[id] = structuredClone(data);
        }
        saveStore(store);
      },
      async update(data) {
        const col = ensureCollection(colName);
        if (!col[id]) {
          throw new Error(`Documento ${colName}/${id} no existe`);
        }
        col[id] = { ...col[id], ...structuredClone(data) };
        saveStore(store);
      },
      async delete() {
        const col = ensureCollection(colName);
        delete col[id];
        saveStore(store);
      },
    };
  };

  const makeQuery = (colName, filters = [], sorts = [], limitCount = null) => ({
    where(field, op, value) {
      return makeQuery(colName, [...filters, { field, op, value }], sorts, limitCount);
    },
    orderBy(field, dir = 'asc') {
      return makeQuery(colName, filters, [...sorts, { field, dir }], limitCount);
    },
    limit(n) {
      return makeQuery(colName, filters, sorts, n);
    },
    select() {
      return makeQuery(colName, filters, sorts, limitCount);
    },
    async get() {
      const col = ensureCollection(colName);
      let entries = Object.entries(col).map(([id, data]) => ({ id, data }));

      for (const { field, op, value } of filters) {
        entries = entries.filter(({ data }) => {
          const v = data?.[field];
          if (op === '==') return v === value;
          if (op === '!=') return v !== value;
          if (op === 'in' && Array.isArray(value)) return value.includes(v);
          if (op === 'array-contains' && Array.isArray(v)) return v.includes(value);
          if (op === '>') return v > value;
          if (op === '>=') return v >= value;
          if (op === '<') return v < value;
          if (op === '<=') return v <= value;
          return true;
        });
      }

      if (sorts.length > 0) {
        entries.sort((a, b) => {
          for (const { field, dir } of sorts) {
            const va = a.data?.[field] ?? '';
            const vb = b.data?.[field] ?? '';
            if (va < vb) return dir === 'desc' ? 1 : -1;
            if (va > vb) return dir === 'desc' ? -1 : 1;
          }
          return 0;
        });
      }

      if (limitCount !== null) {
        entries = entries.slice(0, limitCount);
      }

      const docs = entries.map(({ id, data }) => makeDocSnapshot(id, data));
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (cb) => docs.forEach(cb),
      };
    },
  });

  return {
    __isLocalDb: true,
    collection(colName) {
      const baseQuery = makeQuery(colName);
      return {
        ...baseQuery,
        doc(docId) {
          return makeDocRef(colName, docId);
        },
        async add(data) {
          const ref = makeDocRef(colName);
          await ref.set(data);
          return ref;
        },
      };
    },
    async runTransaction(updateFunction) {
      const tx = {
        async get(refOrQuery) {
          return refOrQuery.get();
        },
        set(docRef, data, options) {
          docRef.set(data, options);
          return tx;
        },
        update(docRef, data) {
          docRef.update(data);
          return tx;
        },
        delete(docRef) {
          docRef.delete();
          return tx;
        },
      };
      return updateFunction(tx);
    },
    batch() {
      const ops = [];
      return {
        set(docRef, data, options) {
          ops.push(() => docRef.set(data, options));
        },
        update(docRef, data) {
          ops.push(() => docRef.update(data));
        },
        delete(docRef) {
          ops.push(() => docRef.delete());
        },
        async commit() {
          for (const op of ops) await op();
        },
      };
    },
  };
}
