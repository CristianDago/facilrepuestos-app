import { Router } from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '../drive-token.json');
const router      = Router();

// El mismo calendario que se usa en el embed de la app (VITE_GOOGLE_CALENDAR_URL)
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'taller@drmotors.cl';
const TIMEZONE     = 'America/Santiago';

// ─── HORARIO DE ATENCIÓN ────────────────────────────────────
// Bloques de 1 hora, se agenda por hora de inicio (09:00, 10:00, etc.)
// Lunes a viernes: 9-18 hrs, sin el bloque de almuerzo 14-15 hrs
// Sábado: 10-14 hrs · Domingo: cerrado
function getSlotsPermitidos(fecha) {
  const dow = getDiaSemana(fecha); // 0=domingo ... 6=sábado
  if (dow === 0) return [];
  if (dow === 6) return [10, 11, 12, 13];
  return [9, 10, 11, 12, 13, 15, 16, 17];
}

function getDiaSemana(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ─── Cliente OAuth (comparte el mismo token que Drive) ────
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthorizedClient() {
  const oauth2 = getOAuth2Client();
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('Google no autorizado. Ve a /auth/drive');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oauth2.setCredentials(token);
  return oauth2;
}

// Trae los eventos ya agendados para una fecha (para saber qué horas están ocupadas)
async function getEventosDelDia(calendar, fecha) {
  const timeMin = new Date(`${fecha}T00:00:00`);
  const timeMax = new Date(`${fecha}T23:59:59`);
  const result = await calendar.events.list({
    calendarId:   CALENDAR_ID,
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
  });
  return result.data.items || [];
}

// ─── GET /api/calendario/disponibilidad?fecha=YYYY-MM-DD ──
// Devuelve las horas de inicio válidas para esa fecha y cuáles ya están ocupadas
router.get('/disponibilidad', requireAuth, async (req, res, next) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ success: false, error: 'Falta la fecha' });

    const slots = getSlotsPermitidos(fecha);
    if (slots.length === 0) {
      return res.json({ success: true, data: { slots: [], ocupadas: [] } });
    }

    const auth      = getAuthorizedClient();
    const calendar  = google.calendar({ version: 'v3', auth });
    const eventos   = await getEventosDelDia(calendar, fecha);

    const ocupadas = eventos
      .map(ev => ev.start?.dateTime ? new Date(ev.start.dateTime).getHours() : null)
      .filter(h => h !== null);

    res.json({ success: true, data: { slots, ocupadas } });
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Google no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

// ─── POST /api/calendario/eventos — agendar una hora ──────
router.post('/eventos', requireAuth, async (req, res, next) => {
  try {
    const { nombre, correo, telefono, patente, servicio, descripcion, fecha, horaInicio } = req.body;

    if (!nombre || !telefono || !servicio || !fecha || !horaInicio) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, teléfono, servicio, fecha y hora son requeridos',
      });
    }

    // ── Validar día y bloque horario permitido ──────────────
    const horaNum = parseInt(horaInicio.split(':')[0], 10);
    const slots    = getSlotsPermitidos(fecha);
    if (slots.length === 0) {
      return res.status(400).json({ success: false, error: 'El taller no atiende los domingos' });
    }
    if (!slots.includes(horaNum)) {
      return res.status(400).json({
        success: false,
        error: 'Ese horario no está disponible. Revisa los bloques habilitados para ese día.',
      });
    }

    const auth     = getAuthorizedClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // ── Evitar doble reserva del mismo bloque ────────────────
    const eventosDelDia = await getEventosDelDia(calendar, fecha);
    const ocupado = eventosDelDia.some(ev => {
      const h = ev.start?.dateTime ? new Date(ev.start.dateTime).getHours() : null;
      return h === horaNum;
    });
    if (ocupado) {
      return res.status(409).json({ success: false, error: 'Ese bloque horario ya fue reservado. Elige otro.' });
    }

    const horaFin = `${String(horaNum + 1).padStart(2, '0')}:00`;

    const summary = patente
      ? `${servicio} — ${patente.toUpperCase()} (${nombre})`
      : `${servicio} — ${nombre}`;

    const descLineas = [
      `Cliente: ${nombre}`,
      correo    ? `Correo: ${correo}`       : null,
      telefono  ? `Teléfono: ${telefono}`   : null,
      patente   ? `Patente: ${patente.toUpperCase()}` : null,
      `Servicio: ${servicio}`,
      descripcion ? `\n${descripcion}` : null,
    ].filter(Boolean).join('\n');

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary,
        description: descLineas,
        start: { dateTime: `${fecha}T${horaInicio}:00`, timeZone: TIMEZONE },
        end:   { dateTime: `${fecha}T${horaFin}:00`,   timeZone: TIMEZONE },
      },
    });

    res.json({ success: true, data: { id: response.data.id, htmlLink: response.data.htmlLink } });
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Google no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

// ─── GET /api/calendario/eventos — próximas horas agendadas
router.get('/eventos', requireAuth, async (req, res, next) => {
  try {
    const auth     = getAuthorizedClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const result = await calendar.events.list({
      calendarId:   CALENDAR_ID,
      timeMin:      new Date().toISOString(),
      maxResults:   30,
      singleEvents: true,
      orderBy:      'startTime',
    });

    const eventos = (result.data.items || []).map(ev => ({
      id:          ev.id,
      titulo:      ev.summary || '(sin título)',
      descripcion: ev.description || '',
      inicio:      ev.start?.dateTime || ev.start?.date,
      fin:         ev.end?.dateTime   || ev.end?.date,
      htmlLink:    ev.htmlLink,
    }));

    res.json({ success: true, data: eventos });
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Google no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

// ─── DELETE /api/calendario/eventos/:id — cancelar una hora
router.delete('/eventos/:id', requireAuth, async (req, res, next) => {
  try {
    const auth     = getAuthorizedClient();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Google no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

export default router;