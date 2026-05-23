'use strict';
// ============================================================
// AI Commerce OS — Backend Server v2.1
// ============================================================
const path = require('path');
const fs   = require('fs');

// Load .env FIRST before anything else
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3001;
const DIST = path.join(__dirname, '..', 'dist');

// ── Ensure data dir ──────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4173',
];
if (process.env.PRODUCTION_URL) allowedOrigins.push(process.env.PRODUCTION_URL);

app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins - handle via helmet/other security
    callback(null, true);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/', rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many requests, try again later' } }));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/customers',     require('./routes/customers'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/delivery',      require('./routes/delivery'));
app.use('/api/broadcast',     require('./routes/broadcast'));
app.use('/api/webhooks',      require('./routes/webhooks'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/media',         require('./routes/media'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/ai',            require('./routes/ai'));

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'ok', version: '2.1.0', name: 'AI Commerce OS',
  time: new Date().toISOString(), uptime: Math.round(process.uptime()) + 's',
  ai: {
    openai: !!(process.env.OPENAI_API_KEY),
    gemini: !!(process.env.GEMINI_API_KEY),
  },
}));

// ── Serve uploaded media ─────────────────────────────────────
const UPLOADS = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ── Serve frontend build ─────────────────────────────────────
app.use(express.static(DIST));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
  const indexFile = path.join(DIST, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(503).send([
      '<h2>Frontend not built yet</h2>',
      '<p>Run <code>npm run build</code> in the project root, then restart the server.</p>',
    ].join(''));
  }
});

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  const hasKey = !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  const url = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : `http://localhost:${PORT}`;
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      AI Commerce OS  — v3.2 Ready       ║');
  console.log(`║  🌐  ${url}`);
  console.log(`║  🤖  AI: ${hasKey ? '✅ API key set' : '⚠️  Local AI (no key)'}     ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`[ENV] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  console.log(`[ENV] PORT=${PORT}`);
  ensureAdmin();
});

// ── WebSocket ────────────────────────────────────────────────
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server, path: '/ws' });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams((req.url||'').split('?')[1]);
  const userId = params.get('userId') || 'anon';
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
  ws.send(JSON.stringify({ event: 'connected', userId }));
  ws.on('close', () => {
    clients.get(userId)?.delete(ws);
    if (!clients.get(userId)?.size) clients.delete(userId);
  });
  ws.on('error', () => {});
});

app.set('broadcast', (userId, event) => {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify(event);
  sockets.forEach(ws => { try { if (ws.readyState === 1) ws.send(msg); } catch {} });
});

// ── Auto-create admin ─────────────────────────────────────────
function ensureAdmin() {
  const { db } = require('./database');
  const email = process.env.ADMIN_EMAIL;
  const pass  = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return;
  if (db.getUserByEmail(email)) return;
  const bcrypt = require('bcryptjs');
  db.createUser({ name: process.env.ADMIN_NAME || 'Admin', email, password: bcrypt.hashSync(pass, 10), role: 'admin' });
  const { defaultSettings } = require('./defaults');
  db.saveSettings(db.getUserByEmail(email).id, { ...defaultSettings, brand: { ...defaultSettings.brand, email } });
  console.log(`[Admin] Created: ${email}`);
}

// ── Morning Report Cron ─────────────────────────
function startMorningReportCron() {
  const { db } = require('./database');
  function scheduleNext() {
    const now = new Date();
    const next = new Date();
    next.setDate(next.getDate() + (now.getHours() >= 8 ? 1 : 0));
    next.setHours(8, 0, 0, 0);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      try {
        const users = db.listUsers();
        users.forEach(user => {
          const orders = db.getOrders(user.id);
          const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
          const ydOrders = orders.filter(o=>o.status!=='cancelled'&&o.createdAt?.startsWith(yesterday));
          const ydRev = ydOrders.reduce((s,o)=>s+o.total,0);
          const pending = orders.filter(o=>o.status==='pending').length;
          const conversations = db.getConversations(user.id);
          const unread = conversations.filter(c=>c.unread>0).length;
          const products = db.getProducts(user.id);
          const lowStock = products.filter(p=>p.stock>0&&p.stock<=5).length;
          const msg = [
            '🌅 ملخص صباح اليوم:',
            `💰 إيراد الأمس: ${ydRev.toLocaleString()} ${db.getSettings(user.id)?.brand?.currency||'MAD'}`,
            `🛒 طلبات معلقة: ${pending}`,
            `💬 رسائل غير مقروءة: ${unread}`,
            lowStock > 0 ? `⚠️ مخزون منخفض: ${lowStock} منتج` : '✅ المخزون جيد',
          ].join("\n");
          db.addNotification({ userId: user.id, type: 'info', message: msg });
          db.addLog({ userId: user.id, user: 'System', action: 'Morning report generated', details: '', type: 'info', severity: 'info' });
        });
      } catch(e) { console.error('[MorningReport]', e.message); }
      scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log('[MorningReport] Cron scheduled for 08:00 daily');
}
startMorningReportCron();

module.exports = app;
