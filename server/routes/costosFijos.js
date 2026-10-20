import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// ═══════════════════════════════════════════════════════════
// COSTOS FIJOS
// ═══════════════════════════════════════════════════════════

// GET /api/costos-fijos — lista todos, ordenados por año/mes desc
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection('costos_fijos').get();
    const costos = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));
    res.json({ success: true, data: costos });
  } catch (error) {
    next(error);
  }
});

// POST /api/costos-fijos — crea un nuevo gasto fijo mensual
router.post('/', async (req, res, next) => {
  try {
    const {
      categoria, proveedor, numeroFactura,
      mes, anio, monto, descuentaIva, fecha, notas,
    } = req.body;

    if (!categoria || !mes || !anio || monto == null) {
      return res.status(400).json({ success: false, error: 'Categoría, mes, año y monto son obligatorios' });
    }

    const montoNum       = parseFloat(monto) || 0;
    const conIva          = descuentaIva !== false; // default true
    const iva              = conIva ? Math.round(montoNum * 0.19) : 0;
    const totalConIva      = montoNum + iva;
    const now              = new Date().toISOString();

    const data = {
      categoria:     String(categoria).toUpperCase(),
      proveedor:     proveedor || '',
      numeroFactura: numeroFactura || '',
      mes:            Number(mes),
      anio:           Number(anio),
      monto:          montoNum,
      descuentaIva:  conIva,
      iva,
      totalConIva,
      fecha:         fecha || '',
      notas:         notas || '',
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await db.collection('costos_fijos').add(data);
    res.json({ success: true, data: { id: docRef.id, ...data } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/costos-fijos/:id — actualiza un gasto fijo
router.put('/:id', async (req, res, next) => {
  try {
    const { categoria, proveedor, numeroFactura, mes, anio, monto, descuentaIva, fecha, notas } = req.body;
    const update = { updatedAt: new Date().toISOString() };

    if (categoria     !== undefined) update.categoria     = String(categoria).toUpperCase();
    if (proveedor      !== undefined) update.proveedor      = proveedor;
    if (numeroFactura !== undefined) update.numeroFactura = numeroFactura;
    if (mes            !== undefined) update.mes            = Number(mes);
    if (anio           !== undefined) update.anio           = Number(anio);
    if (fecha          !== undefined) update.fecha          = fecha;
    if (notas          !== undefined) update.notas          = notas;
    if (descuentaIva  !== undefined) update.descuentaIva  = descuentaIva;

    // El monto y/o el flag de IVA pueden llegar por separado; necesitamos ambos
    // para recalcular, así que si viene cualquiera de los dos, leemos el documento actual.
    if (monto !== undefined || descuentaIva !== undefined) {
      const docSnap = await db.collection('costos_fijos').doc(req.params.id).get();
      const actual   = docSnap.exists ? docSnap.data() : {};
      const montoNum = monto !== undefined ? (parseFloat(monto) || 0) : (actual.monto || 0);
      const conIva    = descuentaIva !== undefined ? (descuentaIva !== false) : (actual.descuentaIva !== false);
      update.monto        = montoNum;
      update.descuentaIva = conIva;
      update.iva           = conIva ? Math.round(montoNum * 0.19) : 0;
      update.totalConIva  = montoNum + update.iva;
    }

    await db.collection('costos_fijos').doc(req.params.id).update(update);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/costos-fijos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.collection('costos_fijos').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// CATEGORÍAS PERSONALIZADAS (Luz, Arriendo, Agua, Internet + las que agregue el usuario)
// ═══════════════════════════════════════════════════════════

// GET /api/costos-fijos/categorias
router.get('/categorias', async (req, res, next) => {
  try {
    const snap = await db.collection('categorias_costo_fijo')
      .orderBy('nombre', 'asc')
      .get();
    const categorias = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: categorias });
  } catch (error) {
    next(error);
  }
});

// POST /api/costos-fijos/categorias
router.post('/categorias', async (req, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'Nombre requerido' });
    }

    const nombreUpper = nombre.trim().toUpperCase();
    const existing = await db.collection('categorias_costo_fijo')
      .where('nombre', '==', nombreUpper)
      .get();

    if (!existing.empty) {
      return res.status(400).json({ success: false, error: 'Esta categoría ya existe' });
    }

    const now    = new Date().toISOString();
    const docRef = await db.collection('categorias_costo_fijo').add({
      nombre:    nombreUpper,
      custom:    true,
      createdAt: now,
    });

    res.json({ success: true, data: { id: docRef.id, nombre: nombreUpper } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/costos-fijos/categorias/:id
router.delete('/categorias/:id', async (req, res, next) => {
  try {
    await db.collection('categorias_costo_fijo').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;