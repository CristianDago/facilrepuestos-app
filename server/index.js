import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

import vehiculosRouter            from './routes/vehiculos.js';
import cotizacionesRouter         from './routes/cotizaciones.js';
import ordenesRouter              from './routes/ordenes.js';
import inventarioRouter           from './routes/inventario.js';
import boostrRouter               from './routes/boostr.js';
import proveedoresRouter          from './routes/proveedores.js';
import tiposPiezaRouter           from './routes/tiposPieza.js';
import fabricantesRouter          from './routes/fabricantes.js';
import mecanicosRouter            from './routes/mecanicos.js';
import serviciosPredefinidosRouter from './routes/serviciosPredefinidos.js';
import usuariosRouter             from './routes/usuarios.js';
import liquidacionesRouter        from './routes/liquidaciones.js';
import categoriasRouter           from './routes/categorias.js';
import costosFijosRouter          from './routes/costosFijos.js';
import marcasVehiculoRouter       from './routes/marcasVehiculo.js';
import materialesPredefinidosRouter from './routes/materialesPredefinidos.js';
import driveRouter                from './routes/drive.js';
import calendarioRouter           from './routes/calendario.js';
import apiPublicaRouter           from './routes/apiPublica.js';
import woocommerceRouter          from './routes/woocommerce.js';
import mantenimientoRouter        from './routes/mantenimiento.js';
import posRouter                  from './routes/pos.js';
import escalamientosRouter        from './routes/escalamientos.js';
import mesaWspRouter              from './routes/mesaWsp.js';
import agenteOmnicanalRouter      from './routes/agenteOmnicanal.js';

import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth, requireStaff, requireAdmin, chain } from './middleware/auth.js';

const app  = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3001',
  'http://localhost:8080',
  'https://facilrepuestos-prod.web.app',
  'https://facilrepuestos-prod.firebaseapp.com',
  'https://sistema.facilrepuestos.cl',
  'https://facilrepuestos.cl',
  'https://www.facilrepuestos.cl',
  'https://asistente.facilrepuestos.cl',
];

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      /\.run\.app$/.test(origin) ||
      /\.web\.app$/.test(origin) ||
      /\.facilrepuestos\.cl$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// ─── CONTROL DE ACCESO ────────────────────────────────────────────────
// Toda la API es CERRADA. Excepciones públicas (sin login), solo estas:
//   · GET /api/ordenes/cliente/:patente  → "Consulta tu vehículo" (sin precios ni datos personales)
//   · GET /api/ordenes/taller/panel      → pantalla del taller (sin precios ni contacto)
//   · GET /api/usuarios/mecanicos/publico → nombres para esa pantalla
//   · /api/public/* (X-API-Key) y /api/woocommerce/* (clave/firma propia)
// Reglas:
//   staff       = personal del taller (admin / mecánico / administrativo)
//   soloAdmin   = solo administrador
//   Un proveedor solo accede a su portal: inventario propio (ver inventario.js)
//   y a los catálogos de lectura (categorías, tipos de pieza, fabricantes, marcas).
//   Un proveedor NO puede crear categorías, tipos de pieza ni marcas de vehículo; sí puede
//   agregar marcas de repuesto (fabricantes).
const staff     = chain(requireAuth, requireStaff);
const soloAdmin = chain(requireAuth, requireAdmin);
const lecturaAuth_escrituraStaff = (req, res, next) =>
  (req.method === 'GET' ? requireAuth : staff)(req, res, next);
// Fabricantes (marca del repuesto): cualquier usuario con sesión puede leer y AGREGAR una marca;
// editar o borrar queda reservado al personal del taller.
const lecturaAuth_altaAuth_resto_staff = (req, res, next) =>
  (req.method === 'GET' || req.method === 'POST' ? requireAuth : staff)(req, res, next);
const lecturaStaff_escrituraAdmin = (req, res, next) =>
  (req.method === 'GET' ? staff : soloAdmin)(req, res, next);

const esRutaPublicaOrdenes = (req) =>
  req.method === 'GET' &&
  (req.path === '/taller/panel' || /^\/cliente\/[^/]+\/?$/.test(req.path));

app.use('/api/vehiculos',              staff, vehiculosRouter);
app.use('/api/cotizaciones',           staff, cotizacionesRouter);
app.use('/api/ordenes',                (req, res, next) => esRutaPublicaOrdenes(req) ? next() : staff(req, res, next), ordenesRouter);
app.use('/api/inventario',             inventarioRouter);            // control propio por rol (proveedor / lector)
app.use('/api/boostr',                 staff, boostrRouter);
app.use('/api/proveedores',            lecturaStaff_escrituraAdmin, proveedoresRouter);
app.use('/api/tipos-pieza',            lecturaAuth_escrituraStaff, tiposPiezaRouter);
app.use('/api/fabricantes',            lecturaAuth_altaAuth_resto_staff, fabricantesRouter);
app.use('/api/mecanicos',              lecturaStaff_escrituraAdmin, mecanicosRouter);
app.use('/api/servicios-predefinidos', lecturaStaff_escrituraAdmin, serviciosPredefinidosRouter);
app.use('/api/usuarios',               usuariosRouter);              // control propio por ruta
app.use('/api/liquidaciones',          liquidacionesRouter);         // control propio por ruta
app.use('/api/categorias',             lecturaAuth_escrituraStaff, categoriasRouter);
app.use('/api/costos-fijos',           soloAdmin, costosFijosRouter);
app.use('/api/marcas-vehiculo',        lecturaAuth_escrituraStaff, marcasVehiculoRouter);
app.use('/api/materiales-predefinidos', lecturaStaff_escrituraAdmin, materialesPredefinidosRouter);
app.use('/api/drive',                  driveRouter);                 // upload exige staff (drive.js)
app.use('/auth',                       driveRouter);
app.use('/api/calendario',             staff, calendarioRouter);

// API pública para WordPress (drmotors.cl) — protegida por X-API-Key, no por login.
// CORS propio y más permisivo porque solo expone datos ya pensados para ser públicos.
app.use('/api/public', cors({
  origin: ['https://drmotors.cl', 'https://www.drmotors.cl'],
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}), apiPublicaRouter);

app.use('/api/woocommerce', woocommerceRouter);
app.use('/api/mantenimiento', mantenimientoRouter);
app.use('/api/pos',           posRouter);
app.use('/api/escalamientos', escalamientosRouter);
app.use('/api/mesa-wsp',      mesaWspRouter);
app.use('/api/agente-omnicanal', agenteOmnicanalRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── SERVICIO WEB CLOUD RUN (FRONTEND ESTÁTICO EMBEBIDO PARA EL AGENTE CLIENTES) ───
const publicCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '../client/dist'),
];
const staticDir = publicCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (staticDir) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api\/|\/auth\/).*/, (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(PORT, () => console.log(`✓ Servidor corriendo en http://localhost:${PORT}`));