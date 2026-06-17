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
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const CRON_FILE = path.join(__dirname, 'cron.json');

// ── PIN Zones ───────────────────────────────────────────────────
const ZONES = {
  photobooth: {
    pin: process.env.PHOTOBOOTH_PIN || '111283',
    cookie: '__session_photo'
  },
  kanban: {
    pin: process.env.KANBAN_PIN || '680283',
    cookie: '__session_kanban'
  }
};

const SESSION_SECRET = process.env.SESSION_SECRET || 'jonathan-hub-2026-static-secret';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Session Helpers ─────────────────────────────────────────────
function signSession(zone) {
  const payload = JSON.stringify({ zone, ts: Date.now() });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + hmac;
}

function verifySession(token, expectedZone) {
  if (!token) return false;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;
  const payload = Buffer.from(b64, 'base64').toString();
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(payload);
    if (!data.zone || data.zone !== expectedZone) return false;
    if (Date.now() - data.ts > SESSION_TTL) return false;
    return true;
  } catch { return false; }
}

// ── Auth Middleware Factory ──────────────────────────────────────
function createAuthMiddleware(zoneName) {
  const zone = ZONES[zoneName];
  return (req, res, next) => {
    const publicPaths = [
      `/${zoneName}/login.html`,
      `/api/verify-pin/${zoneName}`
    ];
    if (publicPaths.includes(req.path)) return next();

    const token = req.cookies && req.cookies[zone.cookie];
    if (verifySession(token, zoneName)) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect(`/${zoneName}/login.html`);
  };
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

// ── Tasks Store ─────────────────────────────────────────────────
function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load tasks:', err.message);
  }
  return [];
}

function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// ── Cron Store ──────────────────────────────────────────────────
function loadCron() {
  try {
    if (fs.existsSync(CRON_FILE)) {
      return JSON.parse(fs.readFileSync(CRON_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load cron:', err.message);
  }
  return [];
}

function saveCron(jobs) {
  fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2));
}

// ── Middleware ───────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors());

// Cookie parser
app.use((req, _res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const eqIdx = c.indexOf('=');
      if (eqIdx > 0) {
        const key = c.substring(0, eqIdx).trim();
        const val = decodeURIComponent(c.substring(eqIdx + 1).trim());
        req.cookies[key] = val;
      }
    });
  }
  next();
});

app.use(express.json());

// ── PIN Verification Endpoints (public, before auth) ────────────
app.post('/api/verify-pin/photobooth', (req, res) => {
  const { pin } = req.body;
  if (pin === ZONES.photobooth.pin) {
    const token = signSession('photobooth');
    res.cookie(ZONES.photobooth.cookie, token, {
      httpOnly: true, maxAge: SESSION_TTL,
      sameSite: 'lax', secure: true
    });
    return res.json({ success: true });
  }
  return res.json({ success: false, error: 'Incorrect PIN' });
});

app.post('/api/verify-pin/kanban', (req, res) => {
  const { pin } = req.body;
  if (pin === ZONES.kanban.pin) {
    const token = signSession('kanban');
    res.cookie(ZONES.kanban.cookie, token, {
      httpOnly: true, maxAge: SESSION_TTL,
      sameSite: 'lax', secure: true
    });
    return res.json({ success: true });
  }
  return res.json({ success: false, error: 'Incorrect PIN' });
});

// ── Portal (public) ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// ── Photobooth Zone (protected) ─────────────────────────────────
const photoAuth = createAuthMiddleware('photobooth');

// Photobooth login page is served as static (public path handled in middleware)
app.get('/photobooth/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Photobooth static files (behind auth)
app.use('/photobooth', photoAuth, express.static(path.join(__dirname, 'public')));
app.use('/photos', photoAuth, express.static(PHOTOS_DIR));

// Photobooth API routes (behind auth)
app.post('/api/upload', photoAuth, (() => {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
    filename: (req, file, cb) => {
      const guest = (req.body.guestName || 'guest').replace(/[^a-zA-Z0-9]/g, '_');
      const ts = Date.now();
      cb(null, `${guest}_${ts}.jpg`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only images allowed'), false);
    }
  });
  return upload.single('photo');
})(), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });
  const photoUrl = `/photos/${req.file.filename}`;
  console.log(`📸 New photo: ${req.file.filename} (${(req.file.size / 1024).toFixed(0)}KB)`);
  res.json({ success: true, url: photoUrl, message: 'Photo uploaded successfully! 💍' });
});

app.get('/api/photos', photoAuth, (req, res) => {
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

app.get('/api/config', photoAuth, (req, res) => {
  res.json({
    coupleNames: COUPLE_NAMES,
    weddingDate: WEDDING_DATE,
    hashtag: WEDDING_HASHTAG,
    hostIp: HOST_IP,
    httpUrl: `http://${HOST_IP}:${PORT}`,
    httpsUrl: `https://${HOST_IP}:${HTTPS_PORT}`
  });
});

app.get('/api/qrcode', photoAuth, async (req, res) => {
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

// ── Kanban Zone (protected) ─────────────────────────────────────
const kanbanAuth = createAuthMiddleware('kanban');

// Kanban login page
app.get('/kanban/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kanban', 'login.html'));
});

// Kanban static files
app.use('/kanban', kanbanAuth, express.static(path.join(__dirname, 'public', 'kanban')));

// ── Tasks CRUD API (behind kanban auth) ─────────────────────────
app.get('/api/tasks', kanbanAuth, (req, res) => {
  res.json({ tasks: loadTasks() });
});

app.post('/api/tasks', kanbanAuth, (req, res) => {
  const { title, description, color, column } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const tasks = loadTasks();
  const task = {
    id: crypto.randomUUID(),
    title,
    description: description || '',
    color: color || 'blue',
    column: column || 'todo',
    cronId: req.body.cronId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  tasks.push(task);
  saveTasks(tasks);
  res.json({ success: true, task });
});

app.put('/api/tasks/:id', kanbanAuth, (req, res) => {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  const { title, description, color, column } = req.body;
  if (title !== undefined) tasks[idx].title = title;
  if (description !== undefined) tasks[idx].description = description;
  if (color !== undefined) tasks[idx].color = color;
  if (column !== undefined) tasks[idx].column = column;
  tasks[idx].updatedAt = new Date().toISOString();

  saveTasks(tasks);
  res.json({ success: true, task: tasks[idx] });
});

app.delete('/api/tasks/:id', kanbanAuth, (req, res) => {
  let tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  tasks.splice(idx, 1);
  saveTasks(tasks);
  res.json({ success: true });
});

// ── Cron Job Proxy API (behind kanban auth) ─────────────────────
const HERMES_API = process.env.HERMES_API || 'http://localhost:3030';

async function hermesRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, HERMES_API);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.get('/api/cron', kanbanAuth, (req, res) => {
  res.json({ jobs: loadCron() });
});

app.post('/api/cron', kanbanAuth, (req, res) => {
  const { name, schedule, description, deliver } = req.body;
  if (!name || !schedule) return res.status(400).json({ error: 'Name and schedule required' });

  const jobs = loadCron();
  const job = {
    job_id: crypto.randomUUID().substring(0, 12),
    name,
    schedule,
    description: description || '',
    status: 'active',
    deliver: deliver || 'origin',
    next_run: null,
    last_run: null,
    last_status: null,
    created_at: new Date().toISOString()
  };
  jobs.push(job);
  saveCron(jobs);
  res.json({ success: true, job });
});

app.put('/api/cron/:id', kanbanAuth, (req, res) => {
  const jobs = loadCron();
  const idx = jobs.findIndex(j => j.job_id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const { name, schedule, description, deliver, status } = req.body;
  if (name !== undefined) jobs[idx].name = name;
  if (schedule !== undefined) jobs[idx].schedule = schedule;
  if (description !== undefined) jobs[idx].description = description;
  if (deliver !== undefined) jobs[idx].deliver = deliver;
  if (status !== undefined) jobs[idx].status = status;

  saveCron(jobs);
  res.json({ success: true, job: jobs[idx] });
});

app.post('/api/cron/:id/:action', kanbanAuth, (req, res) => {
  const { id, action } = req.params;
  const jobs = loadCron();
  const idx = jobs.findIndex(j => j.job_id === id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  if (action === 'pause') {
    jobs[idx].status = 'paused';
  } else if (action === 'resume') {
    jobs[idx].status = 'active';
  } else if (action === 'run') {
    jobs[idx].last_run = new Date().toISOString();
    jobs[idx].last_status = 'triggered';
  } else {
    return res.status(400).json({ error: 'Invalid action' });
  }

  saveCron(jobs);
  res.json({ success: true, job: jobs[idx] });
});

app.delete('/api/cron/:id', kanbanAuth, (req, res) => {
  let jobs = loadCron();
  const idx = jobs.findIndex(j => j.job_id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  jobs.splice(idx, 1);
  saveCron(jobs);
  res.json({ success: true });
});

// Sync endpoint — accepts full cron list from external source (e.g. Hermes agent)
app.post('/api/cron/sync', kanbanAuth, (req, res) => {
  const { jobs } = req.body;
  if (!Array.isArray(jobs)) return res.status(400).json({ error: 'jobs array required' });
  saveCron(jobs);
  res.json({ success: true, count: jobs.length });
});

// ── Ensure dirs exist ───────────────────────────────────────────
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── URL helpers ─────────────────────────────────────────────────
function getHttpUrl()  { return `http://${HOST_IP}:${PORT}`; }
function getHttpsUrl() { return `https://${HOST_IP}:${HTTPS_PORT}`; }

// ── Start servers ───────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              ⚡ JONATHAN\'S HUB — READY ⚡                 ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Detected IP:  ${HOST_IP.padEnd(44)} ║`);
  console.log(`║  HTTP:         ${getHttpUrl().padEnd(44)} ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  🏠 Portal:       ${getHttpUrl().padEnd(41)} ║`);
  console.log(`║  📸 Photobooth:   ${(getHttpUrl() + '/photobooth/').padEnd(41)} ║`);
  console.log(`║  📋 Kanban:       ${(getHttpUrl() + '/kanban/').padEnd(41)} ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  PIN Zones:                                                ║');
  console.log(`║    📸 Photobooth: ${ZONES.photobooth.pin.padEnd(41)} ║`);
  console.log(`║    📋 Kanban:     ${ZONES.kanban.pin.padEnd(41)} ║`);
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
    console.log(`║  HTTPS: ${getHttpsUrl().padEnd(52)} ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  });
} else {
  console.log('║  ⚠️  No cert.pem/key.pem — HTTPS disabled                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
}
