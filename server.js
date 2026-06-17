const express = require('express');
const https = require('https');
const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3006;
const HTTPS_PORT = process.env.HTTPS_PORT || 3007;

// ── Config ──────────────────────────────────────────────────────
const COUPLE_NAMES = 'Netrust Xmas Party';
const WEDDING_DATE = '2026';
const WEDDING_HASHTAG = '#NetrustXmasParty2026';
const PHOTOS_DIR = path.join(__dirname, 'photos');

// ── PIN Protection ──────────────────────────────────────────────
const ACCESS_PIN = process.env.ACCESS_PIN || '111283';
const SESSION_SECRET = process.env.SESSION_SECRET || 'wedding-pb-2026-static-secret';
const AUTH_COOKIE = '__session';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function signSession(pin) {
  const payload = JSON.stringify({ pin: true, ts: Date.now() });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + hmac;
}

function verifySession(token) {
  if (!token) return false;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;
  const payload = Buffer.from(b64, 'base64').toString();
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(payload);
    if (!data.pin || Date.now() - data.ts > SESSION_TTL) return false;
    return true;
  } catch { return false; }
}

function authMiddleware(req, res, next) {
  // Allow login page, login API, and static assets for login
  const publicPaths = ['/login.html', '/api/verify-pin'];
  if (publicPaths.includes(req.path)) return next();

  // Check cookie
  const token = req.cookies && req.cookies[AUTH_COOKIE];
  if (verifySession(token)) return next();

  // Not authenticated — redirect to login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login.html');
}

// ── Auto-detect host IP ─────────────────────────────────────────
function detectHostIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }
  if (candidates.length === 0) return '127.0.0.1';
  const preferred = /wi-fi|wifi|wlan|ethernet|eth0|en0|en1|eth1/i;
  const skip = /vmware|virtualbox|vbox|loopback|bluetooth|isatap|teredo|veth|docker|br-|hyper-v/i;
  for (const c of candidates) {
    if (preferred.test(c.name) && !skip.test(c.name)) return c.address;
  }
  for (const c of candidates) {
    if (!skip.test(c.name)) return c.address;
  }
  return candidates[0].address;
}

const HOST_IP = detectHostIp();

// ── Middleware ───────────────────────────────────────────────────
app.set('trust proxy', 1); // Render uses a reverse proxy
app.use(cors());

// Cookie parser (simple)
app.use((req, _res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [key, val] = c.trim().split('=');
      if (key && val) req.cookies[key] = val;
    });
  }
  next();
});

app.use(express.json());

// PIN verification endpoint (before auth middleware)
app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (pin === ACCESS_PIN) {
    const token = signSession(ACCESS_PIN);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      maxAge: SESSION_TTL,
      sameSite: 'lax',
      secure: true
    });
    return res.json({ success: true });
  }
  return res.json({ success: false, error: 'Incorrect PIN' });
});

// Auth gate for everything else
app.use(authMiddleware);

app.use('/photos', express.static(PHOTOS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── Ensure photos dir exists ────────────────────────────────────
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── Multer (file upload) ────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const guest = (req.body.guestName || 'guest').replace(/[^a-zA-Z0-9]/g, '_');
    const ts = Date.now();
    cb(null, `${guest}_${ts}.jpg`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'), false);
  }
});

// ── URL helpers ─────────────────────────────────────────────────
function getHttpUrl()  { return `http://${HOST_IP}:${PORT}`; }
function getHttpsUrl() { return `https://${HOST_IP}:${HTTPS_PORT}`; }

// ── Routes ──────────────────────────────────────────────────────

// Upload photo
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });
  const photoUrl = `/photos/${req.file.filename}`;
  console.log(`📸 New photo: ${req.file.filename} (${(req.file.size / 1024).toFixed(0)}KB)`);
  res.json({ success: true, url: photoUrl, message: 'Photo uploaded successfully! 💍' });
});

// Get all photos (for gallery + slideshow)
app.get('/api/photos', (req, res) => {
  try {
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort((a, b) => {
        const statA = fs.statSync(path.join(PHOTOS_DIR, a));
        const statB = fs.statSync(path.join(PHOTOS_DIR, b));
        return statB.mtimeMs - statA.mtimeMs;
      })
      .map(f => ({
        filename: f,
        url: `/photos/${f}`,
        uploadedAt: fs.statSync(path.join(PHOTOS_DIR, f)).mtime
      }));
    res.json({ photos: files, count: files.length });
  } catch (err) {
    res.json({ photos: [], count: 0 });
  }
});

// Wedding config + network info
app.get('/api/config', (req, res) => {
  res.json({
    coupleNames: COUPLE_NAMES,
    weddingDate: WEDDING_DATE,
    hashtag: WEDDING_HASHTAG,
    hostIp: HOST_IP,
    httpUrl: getHttpUrl(),
    httpsUrl: getHttpsUrl()
  });
});

// Generate QR code image
app.get('/api/qrcode', async (req, res) => {
  try {
    const ip = req.query.ip || HOST_IP;
    const qrUrl = `https://${ip}:${HTTPS_PORT}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 512, margin: 2,
      color: { dark: '#2c3e50', light: '#ffffff' }
    });
    res.json({ qr: qrDataUrl, url: qrUrl, detectedIp: HOST_IP });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ── Start servers ───────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            💒 WEDDING PHOTOBOOTH READY 💒                 ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Detected IP:  ${HOST_IP.padEnd(44)} ║`);
  console.log(`║  HTTP:         ${getHttpUrl().padEnd(44)} ║`);
  console.log(`║  Couple:       ${COUPLE_NAMES.padEnd(44)} ║`);
  console.log(`║  Date:         ${WEDDING_DATE.padEnd(44)} ║`);
  console.log(`║  PIN Protected: YES (set via ACCESS_PIN env)              ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  📱 Photobooth (guests):  ${getHttpsUrl().padEnd(33)} ║`);
  console.log(`║  📺 Slideshow (venue TV): ${getHttpUrl().padEnd(33)} ║`);
  console.log(`║  🖼️  Gallery (everyone):  ${getHttpUrl().padEnd(33)} ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});

// HTTPS (for camera access on phones)
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`║  HTTPS server: ${getHttpsUrl().padEnd(44)} ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  });
} else {
  console.log('║  ⚠️  No cert.pem/key.pem — HTTPS disabled                ║');
  console.log('║  Camera only works on localhost without HTTPS             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
}
