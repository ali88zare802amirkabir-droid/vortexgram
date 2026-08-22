const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

// ---------- .env ----------
for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { chatCompletion } = require('./ai/groq');
const prompts = require('./ai/prompts');

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MSG_LEN = 4000;
const HISTORY_LIMIT = 200;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { users: [], renameRequests: [], messages: {} };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { users: [], renameRequests: [], messages: {}, ...raw };
} catch {}

let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('save failed', e); }
  }, 250);
}

const sessions = new Map();
const online = new Map();
const msgTimestamps = new Map();

function hash(pw, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function publicUser(u) {
  return { username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned };
}
function roomKey(a, b) {
  return 'dm:' + [a, b].sort().join('|');
}

// ---------- AI chat (پورت از ربات clan) ----------
const RUDE_WORDS = [
  "بی\u200cادب", "عوضی", "احمق", "حماق", "گمشو", "برو گمشو", "خجالت",
  "بی\u200cناموس", "پست", "نکبت", "کثافت", "تو حیوانی", "میکشمت",
  "دهنتو ببند", "خفه شو", "خفه", "بسته", "کره خر",
  "الاغ", "گاو", "سگ", "نفهم", "بی\u200cسواد", "بی\u200cشعور",
  "حرومزاده", "ناموس",
];
const aiState = {
  history: new Map(),
  enabled: new Map(),
  aggression: new Map(),
  lastReply: new Map(),
};
const AI_MIN_INTERVAL = 5000;
const AI_MAX_HISTORY = 20;

function isRude(text) {
  const lower = (text || '').toLowerCase();
  return RUDE_WORDS.some((w) => lower.includes(w));
}
function storeHistory(roomId, senderName, text) {
  if (!text || !text.trim()) return;
  if (!aiState.history.has(roomId)) aiState.history.set(roomId, []);
  const arr = aiState.history.get(roomId);
  arr.push(`${senderName}: ${text.slice(0, 100)}`);
  if (arr.length > AI_MAX_HISTORY) aiState.history.set(roomId, arr.slice(-AI_MAX_HISTORY));
}
async function maybeAiReply(roomId, user, rawText) {
  try {
    if (!process.env.GROQ_API_KEYS_STR) return;
    const isDmWithBot = roomId === `dm:${[user.username, BOT_USERNAME].sort().join('|')}`;
    const enabled = aiState.enabled.get(roomId) !== false;
    const text = (rawText || '').trim();

    let triggered = isDmWithBot;
    if (!triggered && enabled) {
      triggered =
        text.includes('ربات') ||
        /vortex/i.test(text) ||
        isRude(text);
    }
    if (!triggered) { storeHistory(roomId, user.displayName, text); return; }

    // دستورات ادمین
    if (text === 'خاموش' && user.isAdmin && !isDmWithBot) {
      aiState.enabled.set(roomId, false);
      broadcast({ type: 'message', message: botMsg(roomId, 'خاموش شدم 🔇') });
      return;
    }
    if (text === 'روشن' && user.isAdmin) {
      aiState.enabled.set(roomId, true);
      broadcast({ type: 'message', message: botMsg(roomId, 'روشن شدم ✅') });
      return;
    }
    if ((text === 'تندتر' || text === 'آروم\u200cتر' || text === 'اروم تر') && !isDmWithBot) {
      const cur = aiState.aggression.get(roomId) ?? 1;
      const next = text.includes('تند') ? Math.min(2, cur + 1) : Math.max(0, cur - 1);
      aiState.aggression.set(roomId, next);
      const levels = ['آروم\u200cتر 😌', 'عادی 😊', 'تند 🔥'];
      broadcast({ type: 'message', message: botMsg(roomId, `سطح تندی: ${levels[next]}`) });
      return;
    }

    const now = Date.now();
    if (now - (aiState.lastReply.get(roomId) || 0) < AI_MIN_INTERVAL) { storeHistory(roomId, user.displayName, text); return; }

    const clean = text.replace(new RegExp(`@?${BOT_USERNAME}`, 'gi'), '').replace(/ربات/g, '').replace(/[:،]/g, '').trim() || text;
    storeHistory(roomId, user.displayName, text);
    const history = (aiState.history.get(roomId) || []).slice(0, -1);
    const msgs = prompts.buildMessages(clean, history, user.username, isRude(text), !!user.isAdmin, aiState.aggression.get(roomId) ?? 1);

    broadcast({ type: 'ai-thinking', roomId });
    const reply = await chatCompletion(msgs);
    aiState.lastReply.set(roomId, Date.now());
    if (!reply) return;
    broadcast({ type: 'message', message: botMsg(roomId, reply) });
  } catch (e) {
    console.error('AI reply failed:', e.message);
  }
}
function botMsg(roomId, content) {
  return {
    id: crypto.randomUUID(), roomId, from: BOT_USERNAME, fromName: BOT_NAME,
    kind: 'text', content, time: Date.now(),
  };
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- auth api ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_ ' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'رمز حداقل ۴ کاراکتر' });
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده' });
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    username,
    salt,
    passHash: hash(String(password), salt),
    displayName: username,
    isAdmin: db.users.length === 0,
    banned: false,
    createdAt: Date.now(),
  };
  db.users.push(user);
  saveDB();
  const token = newToken();
  sessions.set(token, user.username);
  res.json({ token, me: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || user.passHash !== hash(String(password || ''), user.salt)) return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  const token = newToken();
  sessions.set(token, user.username);
  res.json({ token, me: publicUser(user) });
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const username = token && sessions.get(token);
  const user = username && db.users.find((u) => u.username === username);
  if (!user || user.banned) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  req.user = user;
  next();
}

app.get('/api/me', auth, (req, res) => {
  const pending = db.renameRequests.some((r) => r.username === req.user.username && r.status === 'pending');
  res.json({ me: publicUser(req.user), renamePending: pending });
});

app.post('/api/rename', auth, (req, res) => {
  const newName = String((req.body || {}).displayName || '').trim();
  if (newName.length < 2 || newName.length > 25) return res.status(400).json({ error: 'نام نمایشی باید ۲ تا ۲۵ کاراکتر باشد' });
  if (req.user.isAdmin) {
    req.user.displayName = newName;
    saveDB();
    pushUsers();
    return res.json({ ok: true, applied: true, me: publicUser(req.user) });
  }
  if (db.renameRequests.some((r) => r.username === req.user.username && r.status === 'pending')) return res.status(409).json({ error: 'درخواست قبلی هنوز در انتظار تایید است' });
  db.renameRequests.push({ id: crypto.randomUUID(), username: req.user.username, oldName: req.user.displayName, newName, status: 'pending', at: Date.now() });
  saveDB();
  res.json({ ok: true, applied: false });
});

app.get('/api/admin/requests', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ requests: db.renameRequests.filter((r) => r.status === 'pending') });
});

app.post('/api/admin/requests/:id', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const approve = !!(req.body || {}).approve;
  const item = db.renameRequests.find((r) => r.id === req.params.id && r.status === 'pending');
  if (!item) return res.status(404).json({ error: 'درخواست یافت نشد' });
  item.status = approve ? 'approved' : 'rejected';
  if (approve) {
    const target = db.users.find((u) => u.username === item.username);
    if (target) target.displayName = item.newName;
  }
  saveDB();
  pushUsers();
  notifyUser(item.username, { type: 'rename-result', approved: approve, displayName: approve ? item.newName : undefined });
  res.json({ ok: true });
});

app.get('/api/admin/users', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ users: db.users.map(publicUser) });
});

app.post('/api/admin/ban', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const { username, banned } = req.body || {};
  const target = db.users.find((u) => u.username === username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (target.isAdmin) return res.status(400).json({ error: 'ادمین قابل مسدودسازی نیست' });
  target.banned = !!banned;
  saveDB();
  if (banned) kickUser(target.username);
  pushUsers();
  res.json({ ok: true });
});

// ---------- uploads ----------
const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'text/plain': '.txt',
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + (EXT_BY_MIME[file.mimetype] || '')),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT_BY_MIME[file.mimetype]),
});
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل مجاز نیست یا حجمش زیاد است (حداکثر ۳۰MB)' });
  const m = req.file.mimetype;
  const kind = m.startsWith('image/') ? (m === 'image/gif' ? 'gif' : 'image') : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'file';
  res.json({ url: '/uploads/' + req.file.filename, mime: m, kind, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 80), size: req.file.size });
});
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function wsSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj, exceptWs) {
  for (const [, info] of online) {
    if (info.ws !== exceptWs) wsSend(info.ws, obj);
  }
}
function pushUsers() {
  const list = [...online.values()].map((i) => i.pub);
  broadcast({ type: 'users', users: list });
}
function kickUser(username) {
  const info = online.get(username);
  if (info) { wsSend(info.ws, { type: 'kicked' }); info.ws.close(); }
}
function notifyUser(username, obj) {
  const info = online.get(username);
  if (info) wsSend(info.ws, obj);
}

wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'auth') {
      const uname = sessions.get(data.token);
      const user = uname && db.users.find((u) => u.username === uname);
      if (!user || user.banned) return wsSend(ws, { type: 'auth-failed' });
      username = user.username;
      online.set(username, { ws, pub: publicUser(user) });
      wsSend(ws, { type: 'ready', me: publicUser(user) });
      pushUsers();
      return;
    }
    if (!username) return;

    if (data.type === 'history') {
      const roomId = String(data.roomId || '').slice(0, 100);
      if (roomId.startsWith('dm:')) {
        const parts = roomId.slice(3).split('|');
        if (!parts.includes(username)) return;
      }
      const msgs = (db.messages[roomId] || []).slice(-100);
      wsSend(ws, { type: 'history', roomId, messages: msgs });
      return;
    }

    if (data.type === 'message') {
      const now = Date.now();
      const arr = (msgTimestamps.get(username) || []).filter((t) => now - t < 10000);
      if (arr.length >= 30) return wsSend(ws, { type: 'error', text: 'کمی آرام‌تر! تعداد پیام‌ها زیاد است.' });
      arr.push(now);
      msgTimestamps.set(username, arr);

      const user = db.users.find((u) => u.username === username);
      if (!user || user.banned) return;
      const roomId = String(data.roomId || '').slice(0, 100);
      if (!roomId) return;
      if (roomId.startsWith('dm:')) {
        const parts = roomId.slice(3).split('|');
        if (!parts.includes(username)) return;
      }
      const kind = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'file'].includes(data.kind) ? data.kind : 'text';
      let content = String(data.content ?? '').slice(0, MAX_MSG_LEN);
      if (kind !== 'text' && kind !== 'sticker') {
        if (typeof data.url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(data.url)) return;
      }
      if ((kind === 'text' || kind === 'sticker') && !content.trim()) return;

      const msg = {
        id: crypto.randomUUID(), roomId, from: username, fromName: user.displayName, kind,
        content, url: data.url || undefined, mime: typeof data.mime === 'string' ? data.mime.slice(0, 60) : undefined,
        name: typeof data.name === 'string' ? data.name.slice(0, 80) : undefined, time: now,
      };
      if (!db.messages[roomId]) db.messages[roomId] = [];
      db.messages[roomId].push(msg);
      if (db.messages[roomId].length > HISTORY_LIMIT) db.messages[roomId] = db.messages[roomId].slice(-HISTORY_LIMIT);
      saveDB();
      broadcast({ type: 'message', message: msg });
      const aiText = kind === 'text' ? content : kind === 'sticker' ? `[استیکر فرستاد: ${content}]` : '[فایل فرستاد]';
      maybeAiReply(roomId, user, aiText);
      return;
    }

    if (data.type === 'typing') {
      const user = db.users.find((u) => u.username === username);
      broadcast({ type: 'typing', roomId: String(data.roomId || '').slice(0, 100), name: user ? user.displayName : username }, ws);
    }
  });

  ws.on('close', () => {
    if (username) { online.delete(username); pushUsers(); }
  });
});

server.listen(PORT, () => console.log(`fake-telegram on http://localhost:${PORT}`));