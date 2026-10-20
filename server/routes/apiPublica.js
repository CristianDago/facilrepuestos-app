import { Router } from 'express';
import { db } from '../config/firebase.js';

const router = Router();

// Middleware: exige el header X-API-Key con la clave configurada en el servidor.
// Esta API es independiente del login de Firebase que usa el resto del sistema —
// pensada para ser consumida server-to-server (ej: PHP en WordPress).
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const expected = process.env.WORDPRESS_API_KEY;

  if (!expected) {
    return res.status(500).json({ success: false, error: 'API pública no configurada en el servidor' });
  }
  if (!key || key !== expected) {
    return res.status(401).json({ success: false, error: 'API Key inválida o ausente' });
  }
  next();
}

// Evita errores de precisión de punto flotante (ej: 84.8 - 0.9 = 83.90000000000004)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Solo campos públicos — nunca precioCompra, proveedor, proveedorId, stockReservado, stockMinimo
function sanitizarItem(doc) {
  const d = doc.data();
  const disponible = round2(Math.max(0, (d.stock || 0) - (d.stockReservado || 0)));
  return {
    id: doc.id,
    nombre: d.nombre,
    codigo: d.codigo || '',
    fabricante: d.fabricante || '',
    equivalencias: d.equivalencias || [],
    categoria: d.categoria,
    tipoPieza: d.tipoPieza || '',
    posicion: d.posicion || 'NO APLICA',
    lado: d.lado || 'NO APLICA',
    marcasCompatibles: d.marcasCompatibles || [],
    anioDesde: d.anioDesde || null,
    anioHasta: d.anioHasta || null,
    precio: d.precioVenta || 0,
    unidad: d.unidad || 'unidad',
    disponible,
    enStock: disponible > 0,
  };
}

// GET /api/public/inventario
// Query params opcionales: ?categoria=FRENOS  ?search=pastilla  ?soloDisponibles=true
router.get('/inventario', requireApiKey, async (req, res, next) => {
  try {
    const { categoria, search, soloDisponibles } = req.query;

    const snap = await db.collection('inventario').get();
    let items = snap.docs.map(sanitizarItem);

    if (categoria) {
      items = items.filter(i => i.categoria?.toUpperCase() === String(categoria).toUpperCase());
    }
    if (search) {
      const q = String(search).toLowerCase();
      items = items.filter(i =>
        i.nombre?.toLowerCase().includes(q) ||
        i.codigo?.toLowerCase().includes(q) ||
        i.fabricante?.toLowerCase().includes(q)
      );
    }
    if (soloDisponibles === 'true') {
      items = items.filter(i => i.enStock);
    }

    res.json({ success: true, total: items.length, data: items });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/inventario/:id — detalle de un ítem puntual
router.get('/inventario/:id', requireApiKey, async (req, res, next) => {
  try {
    const doc = await db.collection('inventario').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    res.json({ success: true, data: sanitizarItem(doc) });
  } catch (error) {
    next(error);
  }
});

export default router;