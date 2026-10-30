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
};

function loadStore() {
  try {
    if (existsSync(DB_FILE)) {
      const parsed = JSON.parse(readFileSync(DB_FILE, 'utf8'));
      return { ...SEED_DATA, ...parsed };
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
