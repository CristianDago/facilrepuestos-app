import { Router }   from 'express';
import { google }   from 'googleapis';
import multer        from 'multer';
import { Readable } from 'stream';
import fs            from 'fs';
import path          from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireStaff } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '../drive-token.json');
const router     = Router();
const upload     = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Siembra el token desde la variable de entorno (Secret Manager) ──
// En Cloud Run el disco es efímero: si el contenedor se reinicia o se crea
// una instancia nueva, el archivo local se pierde. Si existe la variable de
// entorno DRIVE_TOKEN_JSON (inyectada como secreto), la escribimos a disco
// al arrancar para no perder la autorización ya hecha.
function seedTokenFromEnv() {
  if (!fs.existsSync(TOKEN_PATH) && process.env.DRIVE_TOKEN_JSON) {
    try {
      fs.writeFileSync(TOKEN_PATH, process.env.DRIVE_TOKEN_JSON);
      console.log('✓ Token de Drive restaurado desde DRIVE_TOKEN_JSON');
    } catch (err) {
      console.error('No se pudo escribir el token de Drive desde el entorno:', err.message);
    }
  }
}
seedTokenFromEnv();

// ─── OAuth2 Client ────────────────────────────────────────
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthorizedClient() {
  const oauth2 = getOAuth2Client();
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('Drive no autorizado. Ve a /auth/drive');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oauth2.setCredentials(token);
  return oauth2;
}

// ─── GET /auth/drive — inicia autorización (solo admin) ──
router.get('/drive', async (req, res) => {
  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  });
  res.redirect(url);
});

// ─── GET /auth/callback — recibe el token ────────────────
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Código no recibido');
  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    // Si SHOW_DRIVE_TOKEN_ONCE=true, muestra el JSON del token en pantalla una
    // sola vez para poder copiarlo y guardarlo en Secret Manager. Se usa solo
    // la primera vez que se autoriza; después se saca esta variable de entorno.
    const mostrarToken = process.env.SHOW_DRIVE_TOKEN_ONCE === 'true';
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:3rem">
        <h2>✅ Google Drive autorizado correctamente</h2>
        <p>Ya puedes cerrar esta ventana y usar el sistema.</p>
        ${mostrarToken ? `
          <p style="max-width:700px;margin:2rem auto;text-align:left;background:#eee;padding:1rem;word-break:break-all;font-size:0.8rem;color:#000">
            ${JSON.stringify(tokens)}
          </p>
          <p style="color:#a00">Copia este texto y guárdalo ahora — no se volverá a mostrar.</p>
        ` : ''}
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Error obteniendo token: ' + err.message);
  }
});

// ─── GET /auth/drive/status — verificar si está autorizado
router.get('/drive/status', async (req, res) => {
  const autorizado = fs.existsSync(TOKEN_PATH);
  res.json({ success: true, autorizado });
});

// ─── POST /api/drive/upload — subir archivo a Drive ──────
router.post('/upload', requireAuth, requireStaff, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });

    const auth    = getAuthorizedClient();
    const drive   = google.drive({ version: 'v3', auth });
    const folder  = process.env.GOOGLE_DRIVE_FOLDER_ID;

    // Subfolder por usuario
    const subfolderName = req.body.subfolder || 'general';

    // Buscar o crear subcarpeta
    let subfolderId = folder;
    const folderSearch = await drive.files.list({
      q: `name='${subfolderName}' and '${folder}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });

    if (folderSearch.data.files.length > 0) {
      subfolderId = folderSearch.data.files[0].id;
    } else {
      const newFolder = await drive.files.create({
        requestBody: {
          name: subfolderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [folder],
        },
        fields: 'id',
      });
      subfolderId = newFolder.data.id;
    }

    // Subir archivo
    const stream   = Readable.from(req.file.buffer);
    const response = await drive.files.create({
      requestBody: {
        name:    req.file.originalname,
        parents: [subfolderId],
      },
      media: {
        mimeType: req.file.mimetype,
        body:     stream,
      },
      fields: 'id, name, webViewLink, webContentLink',
    });

    // Hacer el archivo visible con link
    await drive.permissions.create({
      fileId:      response.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${proto}://${req.get('host')}`;

    res.json({
      success:  true,
      fileId:   response.data.id,
      fileName: response.data.name,
      url:      `${baseUrl}/api/drive/file/${response.data.id}`,
    });
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Drive no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

// ─── GET /api/drive/file/:fileId — sirve el archivo directamente ─────
router.get('/file/:fileId', async (req, res, next) => {
  try {
    const auth  = getAuthorizedClient();
    const drive = google.drive({ version: 'v3', auth });

    const meta = await drive.files.get({
      fileId: req.params.fileId,
      fields: 'mimeType',
    });

    const file = await drive.files.get(
      { fileId: req.params.fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    file.data.pipe(res);
  } catch (err) {
    if (err.message?.includes('no autorizado')) {
      return res.status(401).json({ success: false, error: 'Drive no autorizado. Ve a /auth/drive' });
    }
    next(err);
  }
});

export default router;