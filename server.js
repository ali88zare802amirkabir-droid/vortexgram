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

process.on('uncaughtException', (e) => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED:', e));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MSG_LEN = 4000;
const HISTORY_LIMIT = 200;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { users: [], renameRequests: [], messages: {}, groups: [], signupRequests: [], pinned: {}, scheduled: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { users: [], renameRequests: [], messages: {}, groups: [], signupRequests: [], pinned: {}, scheduled: [], ...raw };
  if (!Array.isArray(db.groups)) db.groups = [];
  if (!Array.isArray(db.signupRequests)) db.signupRequests = [];
  if (!db.pinned || typeof db.pinned !== 'object') db.pinned = {};
  if (!Array.isArray(db.scheduled)) db.scheduled = [];
  // مهاجرت اعضای قدیمی (رشته) به ساختار نقش‌دار
  for (const g of db.groups) {
    if (!g.type) g.type = 'group';
    g.members = (g.members || []).map((m) => (typeof m === 'string' ? { username: m, role: m === g.owner ? 'owner' : 'member' } : m));
    if (!g.members.some((m) => m.username === g.owner)) g.members.push({ username: g.owner, role: 'owner' });
  }
} catch {}

let saveTimer = null;
function flushDB() {
  clearTimeout(saveTimer);
  try { db.sessions = Object.fromEntries(sessions); fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('save failed', e.message); }
}
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDB, 250);
}
// جلوگیری از از دست رفتن داده هنگام ری‌استارت/کشته شدن پروسه
process.on('exit', flushDB);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushDB(); process.exit(0); });
}

// ---------- sessions / security ----------
const sessions = new Map();
const online = new Map();
const msgTimestamps = new Map();
const pendingCodes = new Map(); // phone -> { code, exp }
// بارگذاری نشست‌های ذخیره‌شده تا لاگین پس از ری‌استارت سرور باقی بماند
try { if (db.sessions) for (const [k, v] of Object.entries(db.sessions)) sessions.set(k, v); } catch (e) {}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function createSession(username) {
  const token = newToken();
  sessions.set(token, { username, exp: Date.now() + SESSION_TTL });
  saveDB();
  return token;
}
function getSession(token) {
  const s = token && sessions.get(token);
  if (!s || s.exp < Date.now()) return null;
  return s.username;
}
function hash(pw, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function normalizePhone(p) {
  p = String(p || '').replace(/[\s\-()]/g, '');
  p = p.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
       .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (p.startsWith('+98')) p = '0' + p.slice(3);
  else if (p.startsWith('98') && p.length === 12) p = '0' + p.slice(2);
  if (!/^09\d{9}$/.test(p)) return null;
  return p;
}
// ارسال پیامک: با کلید KAVENEGAR_KEY واقعی، وگرنه حالت توسعه (چاپ در کنسول + برگرداندن کد)
function sendSMS(phone, text) {
  return new Promise((resolve) => {
    const key = process.env.KAVENEGAR_KEY;
    if (!key) { console.log('[DEV SMS]', phone, '->', text); return resolve({ ok: true, dev: true }); }
    const body = require('querystring').stringify({ receptor: phone, message: text, sender: process.env.KAVENEGAR_SENDER || '2000660110' });
    const req = httpsMod.request({
      hostname: 'api.kavenegar.com',
      path: `/v1/${key}/sms/send.json`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => {
        let ok = r.statusCode >= 200 && r.statusCode < 300;
        try { const j = JSON.parse(b); if (j && j.return && j.return.status !== 200) ok = false; } catch (e) {}
        if (!ok) console.error('[Kavenegar] send failed', r.statusCode, b);
        resolve({ ok, dev: !ok, smsError: !ok });
      });
    });
    req.on('error', (e) => { console.error('[Kavenegar] error', e.message); resolve({ ok: false, dev: true, smsError: true }); });
    req.write(body); req.end();
  });
}
function publicUser(u) {
  return { username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned, avatar: u.avatar || null, bio: u.bio || '', isPremium: !!u.isPremium, phone: u.phone || null };
}
const LIMITS = {
  normalUploadMB: 30,
  premiumUploadMB: 100,
  normalBio: 80,
  premiumBio: 200,
};
function isDmAllowed(roomId, username) {
  if (typeof roomId !== 'string' || !roomId.startsWith('dm:')) return false;
  return roomId.slice(3).split('|').includes(username);
}
function canAccess(roomId, username) {
  if (typeof roomId !== 'string') return false;
  if (roomId.startsWith('dm:')) return roomId.slice(3).split('|').includes(username);
  if (roomId.startsWith('group:')) {
    const g = findGroup(roomId.slice(6));
    return !!g && !!memberOf(g, username);
  }
  return false;
}
function canPost(roomId, username) {
  if (typeof roomId !== 'string') return false;
  if (roomId.startsWith('group:')) {
    const g = findGroup(roomId.slice(6));
    if (!g) return false;
    if ((g.type || 'group') === 'channel') return g.owner === username || isGroupAdmin(g, username);
    return true;
  }
  return true;
}

const app = express();
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// ---------- auth api ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_ ' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'رمز حداقل ۴ کاراکتر' });
  const unameLower = username.toLowerCase();
  if (db.users.some((u) => u.username.toLowerCase() === unameLower)) return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده' });
  if (db.signupRequests.some((r) => r.username.toLowerCase() === unameLower)) return res.status(409).json({ error: 'درخواست ثبت‌نام تو منتظر تایید ادمین است' });

  // ثبت‌نام آزاد نیست — به‌صورت درخواست برای تایید ادمین ذخیره می‌شود
  const salt = crypto.randomBytes(16).toString('hex');
  db.signupRequests.push({
    id: crypto.randomUUID(),
    username,
    salt,
    passHash: hash(String(password), salt),
    at: Date.now(),
  });
  saveDB();

  // خبر به همه ادمین‌های آنلاین
  for (const u of db.users.filter((x) => x.isAdmin)) {
    notifyUser(u.username, { type: 'signup-request', username });
  }

  res.json({ ok: true, pending: true, message: 'درخواست ثبت‌نامت ثبت شد ✅ بعد از تایید ادمین می‌توانی وارد شوی' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const pending = db.signupRequests.find((r) => r.username.toLowerCase() === String(username || '').toLowerCase());
  if (pending) return res.status(403).json({ error: 'ثبت‌نامت هنوز توسط ادمین تایید نشده ⏳' });
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || user.passHash !== hash(String(password || ''), user.salt)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  }
  if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  const token = createSession(user.username);
  res.json({ token, me: publicUser(user) });
});

// ---------- phone + code (Telegram-style) ----------
function genCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

app.post('/api/send-code', async (req, res) => {
  const phone = normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)' });
  const code = genCode();
  pendingCodes.set(phone, { code, exp: Date.now() + 2 * 60 * 1000 });
  const sms = await sendSMS(phone, `کد ورود VORTEXGRAM: ${code}`);
  const out = { ok: true };
  if (sms.dev) out.devCode = code;
  if (sms.smsError) out.note = 'ارسال پیامک با خطا مواجه شد — کد در کنسول سرور چاپ شد';
  res.json(out);
});

app.post('/api/verify-code', (req, res) => {
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  const rec = pendingCodes.get(phone);
  if (!rec || rec.exp < Date.now()) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
  if (rec.code !== code) return res.status(401).json({ error: 'کد اشتباه است' });
  const user = db.users.find((u) => u.phone === phone);
  if (user) {
    pendingCodes.delete(phone);
    if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    const token = createSession(user.username);
    return res.json({ token, me: publicUser(user) });
  }
  return res.json({ needsName: true });
});

app.post('/api/complete-register', (req, res) => {
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  const displayName = String((req.body || {}).displayName || '').trim();
  let username = String((req.body || {}).username || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  const rec = pendingCodes.get(phone);
  if (!rec || rec.exp < Date.now() || rec.code !== code) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
  if (displayName.length < 2) return res.status(400).json({ error: 'نام نمایشی حداقل ۲ حرف' });
  if (username) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_' });
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'این نام کاربری قبلاً گرفته شده' });
  } else {
    username = 'u' + phone.slice(1);
    while (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) username += crypto.randomInt(0, 9);
  }
  const u = { username, displayName, phone, isAdmin: false, isPremium: false, createdAt: Date.now(), avatar: null, bio: '' };
  db.users.push(u);
  saveDB();
  pendingCodes.delete(phone);
  const token = createSession(username);
  res.json({ token, me: publicUser(u) });
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const username = getSession(token);
  const user = username && db.users.find((u) => u.username === username);
  if (!user || user.banned) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  req.user = user;
  next();
}

app.get('/api/me', auth, (req, res) => {
  const pending = db.renameRequests.some((r) => r.username === req.user.username && r.status === 'pending');
  res.json({ me: publicUser(req.user), renamePending: pending });
});

// ---------- profile ----------
app.post('/api/profile/bio', auth, (req, res) => {
  const bio = String((req.body || {}).bio || '').trim();
  const max = req.user.isPremium ? LIMITS.premiumBio : LIMITS.normalBio;
  if (bio.length > max) return res.status(400).json({ error: `بیو حداکثر ${max} کاراکتر` + (req.user.isPremium ? '' : ' — برای بیشتر پرمیوم شو') });
  req.user.bio = bio;
  saveDB();
  pushUsers();
  res.json({ ok: true, me: publicUser(req.user) });
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, 'av-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + (EXT_BY_MIME[file.mimetype] || '')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
app.post('/api/profile/avatar', auth, avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'عکس مجاز نیست (فقط jpg/png/webp تا ۵MB)' });
  if (req.user.avatar) {
    const old = path.join(UPLOAD_DIR, path.basename(req.user.avatar));
    fs.unlink(old, () => {});
  }
  req.user.avatar = '/uploads/' + req.file.filename;
  saveDB();
  pushUsers();
  res.json({ ok: true, avatar: req.user.avatar, me: publicUser(req.user) });
});

// ---------- premium ----------
app.post('/api/admin/premium', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const { username, isPremium } = req.body || {};
  const target = db.users.find((u) => u.username === username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  target.isPremium = !!isPremium;
  saveDB();
  pushUsers();
  notifyUser(target.username, { type: 'premium-changed', isPremium: target.isPremium });
  res.json({ ok: true, user: publicUser(target) });
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

// درخواست‌های ثبت‌نام در انتظار تایید
app.get('/api/admin/signups', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ signups: db.signupRequests.map((r) => ({ id: r.id, username: r.username, at: r.at })) });
});

app.post('/api/admin/signups/:id', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const approve = !!(req.body || {}).approve;
  const idx = db.signupRequests.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'درخواست یافت نشد' });
  const reqItem = db.signupRequests[idx];
  db.signupRequests.splice(idx, 1);
  if (approve) {
    db.users.push({
      username: reqItem.username,
      salt: reqItem.salt,
      passHash: reqItem.passHash,
      displayName: reqItem.username,
      isAdmin: false,
      banned: false,
      createdAt: Date.now(),
    });
    saveDB();
    pushUsers();
  } else {
    saveDB();
  }
  res.json({ ok: true, approved: approve, username: reqItem.username });
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

// ریست رمز عبور توسط ادمین (رمزها هش شده‌اند و قابل بازیابی نیستند، پس ادمین باید رمز جدید بسازد)
app.post('/api/admin/reset-password', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const { username, newPassword } = req.body || {};
  const target = db.users.find((u) => u.username === username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (target.isAdmin) return res.status(400).json({ error: 'رمز ادمین دیگر قابل تغییر نیست' });
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'رمز جدید حداقل ۴ کاراکتر باشد' });
  target.salt = crypto.randomBytes(16).toString('hex');
  target.passHash = hash(String(newPassword), target.salt);
  saveDB();
  kickUser(target.username);
  notifyUser(target.username, { type: 'password-reset' });
  res.json({ ok: true });
});

// ===== واکنش به پیام (reactions) =====
function findMsg(roomId, id) {
  const arr = db.messages[roomId] || [];
  return arr.find((m) => m.id === id);
}
app.post('/api/reactions', auth, (req, res) => {
  const { roomId, msgId, emoji } = req.body || {};
  if (!canAccess(String(roomId || ''), req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(String(roomId), String(msgId));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  if (!m.reactions) m.reactions = {};
  const u = req.user.username;
  const list = m.reactions[emoji] || [];
  if (list.includes(u)) m.reactions[emoji] = list.filter((x) => x !== u);
  else m.reactions[emoji] = [...list, u];
  if (!m.reactions[emoji].length) delete m.reactions[emoji];
  saveDB();
  broadcast({ type: 'message-updated', roomId, id: msgId, reactions: m.reactions });
  res.json({ ok: true, reactions: m.reactions });
});

// ===== سنجاق چندگانه =====
app.post('/api/pin', auth, (req, res) => {
  const { roomId, msgId } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  if (!db.pinned[rid]) db.pinned[rid] = [];
  const i = db.pinned[rid].indexOf(String(msgId));
  if (i >= 0) db.pinned[rid].splice(i, 1);
  else db.pinned[rid].push(String(msgId));
  saveDB();
  broadcast({ type: 'pinned-updated', roomId: rid, ids: db.pinned[rid] });
  res.json({ ok: true, ids: db.pinned[rid] });
});

// ===== رای دادن به نظرسنجی =====
app.post('/api/poll/vote', auth, (req, res) => {
  const { roomId, msgId, option } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId));
  if (!m || m.kind !== 'poll' || !m.poll) return res.status(404).json({ error: 'نظرسنجی یافت نشد' });
  m.poll.votes[req.user.username] = Number(option);
  saveDB();
  broadcast({ type: 'message-updated', roomId: rid, id: msgId, poll: m.poll });
  res.json({ ok: true, poll: m.poll });
});

// ===== تیک زدن آیتم چک‌لیست =====
app.post('/api/checklist/toggle', auth, (req, res) => {
  const { roomId, msgId, index } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId));
  if (!m || m.kind !== 'checklist' || !m.checklist) return res.status(404).json({ error: 'چک‌لیست یافت نشد' });
  const idx = Number(index);
  if (!m.checklist.items[idx]) return res.status(404).json({ error: 'آیتم یافت نشد' });
  m.checklist.items[idx].done = !m.checklist.items[idx].done;
  saveDB();
  broadcast({ type: 'message-updated', roomId: rid, id: msgId, checklist: m.checklist });
  res.json({ ok: true, checklist: m.checklist });
});

// ===== پیام زمان‌بندی‌شده =====
app.post('/api/schedule', auth, (req, res) => {
  const { roomId, kind, content, url, name, mime, at, replyTo } = req.body || {};
  const rid = String(roomId || '').slice(0, 100);
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const atTs = Number(at);
  if (!atTs || atTs < Date.now()) return res.status(400).json({ error: 'زمان نامعتبر' });
  const id = crypto.randomUUID();
  db.scheduled.push({ id, roomId: rid, from: req.user.username, kind: kind || 'text', content: String(content || '').slice(0, 4000), url: url || undefined, name: name || undefined, mime: mime || undefined, replyTo: replyTo || undefined, at: atTs });
  saveDB();
  res.json({ ok: true, id });
});

// ===== پیش‌نمایش لینک =====
const httpsMod = require('https');
const httpMod = require('http');
const urlMod = require('url');
app.get('/api/link-preview', auth, (req, res) => {
  const raw = String(req.query.url || '');
  let u;
  try { u = new urlMod.URL(raw); } catch { return res.status(400).json({ error: 'لینک نامعتبر' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res.status(400).json({ error: 'فقط http(s)' });
  const mod = u.protocol === 'https:' ? httpsMod : httpMod;
  const reqO = mod.get(raw, { timeout: 3500, headers: { 'User-Agent': 'VortexGramBot/1.0', 'Accept': 'text/html' } }, (r) => {
    const ct = r.headers['content-type'] || '';
    if (!ct.includes('text/html')) { r.resume(); return res.json({ url: raw, domain: u.hostname }); }
    let buf = ''; let n = 0;
    r.on('data', (c) => { buf += c; n += c.length; if (n > 200000) r.destroy(); });
    r.on('end', () => {
      const title = (buf.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const desc = (buf.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]
        || (buf.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '';
      const og = (buf.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
      res.json({ url: raw, domain: u.hostname, title: title.slice(0, 200).trim(), description: desc.slice(0, 300).trim(), image: og.slice(0, 300).trim() });
    });
  });
  reqO.on('timeout', () => { reqO.destroy(); res.json({ url: raw, domain: u.hostname }); });
  reqO.on('error', () => res.json({ url: raw, domain: u.hostname }));
});

// ===== AI داخلی (دستورات و پنل) =====
app.post('/api/ai', auth, async (req, res) => {
  if (!process.env.GROQ_API_KEYS_STR) return res.status(503).json({ error: 'AI تنظیم نشده' });
  const { action, roomId, text, tone } = req.body || {};
  const a = String(action || '');
  try {
    let out = null;
    if (a === 'summarize') {
      out = await chatCompletion([{ role: 'system', content: 'Summarize the following chat in Persian in 3-5 short bullet points. Concise, no preamble.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(String(roomId || ''), 40) }]);
    } else if (a === 'reply') {
      out = await chatCompletion([{ role: 'system', content: 'Based on the recent chat, suggest 3 short reply options in Persian, one per line, no numbering, no labels.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(String(roomId || ''), 40) }]);
    } else if (a === 'translate') {
      out = await chatCompletion([{ role: 'system', content: 'Translate the text. If Persian translate to English, else to Persian. Return only the translation.' }, { role: 'user', content: String(text || '') }]);
    } else if (a === 'rewrite') {
      const t = String(tone || 'natural');
      out = await chatCompletion([{ role: 'system', content: `Rewrite the text in Persian with a ${t} tone. Return only the rewritten text.` }, { role: 'user', content: String(text || '') }]);
    } else if (a === 'ask') {
      out = await chatCompletion([{ role: 'system', content: 'Answer briefly in Persian using chat context if relevant.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(String(roomId || ''), 30) + '\n\nQ: ' + String(text || '') }]);
    } else return res.status(400).json({ error: 'action نامعتبر' });
    if (!out) return res.status(502).json({ error: 'پاسخی دریافت نشد' });
    res.json({ result: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// پردازش پیام‌های زمان‌بندی‌شده
function processScheduled() {
  if (!db.scheduled.length) return;
  const now = Date.now();
  const due = db.scheduled.filter((s) => s.at <= now);
  if (!due.length) return;
  db.scheduled = db.scheduled.filter((s) => s.at > now);
  for (const s of due) {
    const user = db.users.find((u) => u.username === s.from);
    const msg = {
      id: crypto.randomUUID(), roomId: s.roomId, from: s.from, fromName: user ? user.displayName : s.from, kind: s.kind,
      content: s.content || '', url: s.url, mime: s.mime, name: s.name, time: now,
      fromAvatar: user?.avatar || undefined, fromPremium: !!user?.isPremium, replyTo: s.replyTo, reactions: {}, silent: false,
    };
    if (!db.messages[s.roomId]) db.messages[s.roomId] = [];
    db.messages[s.roomId].push(msg);
    broadcast({ type: 'message', message: msg });
  }
  saveDB();
}
setInterval(processScheduled, 5000);

// بررسی وجود کاربر برای افزودن مخاطب با آیدی
app.get('/api/users/exists/:username', auth, (req, res) => {
  const uname = String(req.params.username || '').trim().replace(/^@/, '');
  const u = db.users.find((x) => x.username.toLowerCase() === uname.toLowerCase());
  if (!u) return res.status(404).json({ error: 'کاربری با این آیدی ثبت نشده' });
  res.json({ username: u.username, displayName: u.displayName, avatar: u.avatar || null, isPremium: !!u.isPremium, online: online.has(u.username), lastSeen: u.lastSeen || null });
});

// تکمیل مشخصات فرستنده در پیام‌های قدیمی که آواتار/پرمیوم ندارند
function enrichMsg(m) {
  const u = db.users.find((x) => x.username === m.from);
  return {
    ...m,
    fromAvatar: m.fromAvatar || (u && u.avatar) || null,
    fromPremium: m.fromPremium || !!(u && u.isPremium),
  };
}

// ادمین: اتاق‌های چت یک کاربر
app.get('/api/admin/user/:username/rooms', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const target = db.users.find((u) => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const uname = target.username;
  const rooms = [];
  for (const [roomId, arr] of Object.entries(db.messages)) {
    let title = null;
    if (roomId.startsWith('dm:')) {
      const parts = roomId.slice(3).split('|');
      if (!parts.includes(uname)) continue;
      const other = parts.find((p) => p !== uname);
      const otherUser = other && db.users.find((u) => u.username === other);
      title = '💬 ' + ((otherUser && otherUser.displayName) || other || '?');
    } else if (roomId.startsWith('group:')) {
      const g = findGroup(roomId.slice(6));
      if (!g || !memberOf(g, uname)) continue;
      title = (g.type === 'channel' ? '📢 ' : '👥 ') + g.name;
    } else continue;
    const last = arr[arr.length - 1];
    rooms.push({ roomId, title, count: arr.length, lastTime: last ? last.time : 0 });
  }
  rooms.sort((a, b) => b.lastTime - a.lastTime);
  res.json({ user: { username: uname, displayName: target.displayName }, rooms });
});

// ادمین: پیام‌های هر اتاق
app.get('/api/admin/room/messages', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const roomId = String(req.query.roomId || '').slice(0, 120);
  const msgs = (db.messages[roomId] || []).map(enrichMsg);
  res.json({ roomId, messages: msgs });
});

// ---------- uploads ----------
const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/x-matroska': '.mka',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'text/plain': '.txt',
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + (EXT_BY_MIME[file.mimetype] || '')),
  }),
  limits: { fileSize: LIMITS.premiumUploadMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT_BY_MIME[file.mimetype]),
});
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل مجاز نیست یا حجمش زیاد است' });
  const maxMB = req.user.isPremium ? LIMITS.premiumUploadMB : LIMITS.normalUploadMB;
  if (req.file.size > maxMB * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `حداکثر ${maxMB} مگابایت` + (req.user.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ') });
  }
  const m = req.file.mimetype;
  const kind = m.startsWith('image/') ? (m === 'image/gif' ? 'gif' : 'image') : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'file';
  res.json({ url: '/uploads/' + req.file.filename, mime: m, kind, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 80), size: req.file.size });
});
const MIME_BY_EXT = {};
for (const [k, v] of Object.entries(EXT_BY_MIME)) MIME_BY_EXT[v] = k;
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res, p) => {
    const ext = p.slice(p.lastIndexOf('.'));
    if (MIME_BY_EXT[ext]) res.setHeader('Content-Type', MIME_BY_EXT[ext]);
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// ---------- groups & channels ----------
function publicGroups(username) {
  // گروه‌ها خصوصی‌اند: فقط برای اعضا نمایش داده می‌شوند
  return db.groups.filter((g) => memberOf(g, username)).map((g) => {
    const me = memberOf(g, username);
    return {
      id: g.id, type: g.type || 'group', name: g.name, owner: g.owner,
      members: g.members.length,
      joined: true,
      myRole: me ? me.role : null,
    };
  });
}
function broadcastGroups() {
  for (const [, info] of online) {
    wsSend(info.ws, { type: 'groups', groups: publicGroups(info.pub.username) });
  }
}
function findGroup(id) { return db.groups.find((x) => x.id === id); }
function memberOf(g, username) { return (g.members || []).find((m) => m.username === username); }
function isGroupAdmin(g, username) {
  const m = memberOf(g, username);
  return !!m && (m.role === 'owner' || m.role === 'admin');
}

app.post('/api/groups', auth, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  const type = (req.body || {}).type === 'channel' ? 'channel' : 'group';
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'نام باید ۲ تا ۳۰ کاراکتر باشد' });
  // محدودیت ساخت برای حساب رایگان
  if (!req.user.isAdmin) {
    const owned = db.groups.filter((g) => g.owner === req.user.username).length;
    const maxOwned = req.user.isPremium ? 10 : 2;
    if (owned >= maxOwned) return res.status(403).json({ error: req.user.isPremium ? 'سقف ساخت: ۱۰ گروه/کانال' : 'حساب رایگان: حداکثر ۲ گروه/کانال — پرمیوم شو ⭐' });
  }
  const g = { id: crypto.randomBytes(6).toString('hex'), type, name, owner: req.user.username, members: [{ username: req.user.username, role: 'owner' }], createdAt: Date.now() };
  db.groups.push(g);
  saveDB();
  broadcastGroups();
  res.json({ ok: true, group: { id: g.id, name: g.name, type } });
});

app.post('/api/groups/:id/join', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username)) {
    g.members.push({ username: req.user.username, role: 'member' });
    saveDB();
    broadcastGroups();
  }
  res.json({ ok: true });
});

app.post('/api/groups/:id/leave', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner === req.user.username) return res.status(400).json({ error: 'مالک نمی‌تواند خارج شود؛ گروه را حذف کن' });
  g.members = g.members.filter((m) => m.username !== req.user.username);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

app.post('/api/groups/:id/delete', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک' });
  db.groups = db.groups.filter((x) => x.id !== g.id);
  delete db.messages['group:' + g.id];
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

app.get('/api/groups/:id/members', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username)) return res.status(403).json({ error: 'عضو نیستی' });
  res.json({
    group: { id: g.id, name: g.name, type: g.type, owner: g.owner },
    members: g.members.map((m) => ({ ...m, displayName: (db.users.find((u) => u.username === m.username) || {}).displayName || m.username, avatar: (db.users.find((u) => u.username === m.username) || {}).avatar || null })),
    allUsers: req.user.isAdmin || g.owner === req.user.username ? db.users.map((u) => ({ username: u.username, displayName: u.displayName })) : undefined,
  });
});

app.post('/api/groups/:id/members', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک می‌تواند عضو اضافه کند' });
  const uname = String((req.body || {}).username || '');
  const target = db.users.find((u) => u.username === uname);
  if (!target) return res.status(404).json({ error: 'چنین کاربری ثبت‌نشده' });
  if (memberOf(g, uname)) return res.status(409).json({ error: 'از قبل عضو است' });
  g.members.push({ username: uname, role: 'member' });
  saveDB();
  notifyUser(uname, { type: 'added-to', groupId: g.id, name: g.name, type2: g.type });
  broadcastGroups();
  res.json({ ok: true });
});

app.post('/api/groups/:id/role', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک' });
  const { username, role } = req.body || {};
  const m = memberOf(g, String(username || ''));
  if (!m) return res.status(404).json({ error: 'عضو نیست' });
  if (m.role === 'owner') return res.status(400).json({ error: 'نقش مالک تغییر نمی‌کند' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'نقش نامعتبر' });
  m.role = role;
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

app.post('/api/groups/:id/kick', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String((req.body || {}).username || '');
  const m = memberOf(g, uname);
  if (!m) return res.status(404).json({ error: 'عضو نیست' });
  if (m.role === 'owner') return res.status(400).json({ error: 'مالک حذف نمی‌شود' });
  g.members = g.members.filter((x) => x.username !== uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

// ---------- وضعیت چت‌ها: بایگانی / سنجاق ----------
function chatStateOf(username) {
  if (!db.chatState) db.chatState = {};
  if (!db.chatState[username]) db.chatState[username] = {};
  return db.chatState[username];
}
function readStateOf() {
  if (!db.readState) db.readState = {};
  return db.readState;
}

app.post('/api/chats/state', auth, (req, res) => {
  const roomId = String((req.body || {}).roomId || '').slice(0, 100);
  if (!canAccess(roomId, req.user.username)) return res.status(403).json({ error: 'دسترسی نداری' });
  const st = chatStateOf(req.user.username);
  const cur = st[roomId] || {};
  st[roomId] = {
    archived: 'archived' in (req.body || {}) ? !!req.body.archived : !!cur.archived,
    pinned: 'pinned' in (req.body || {}) ? !!req.body.pinned : !!cur.pinned,
  };
  saveDB();
  res.json({ ok: true });
});

// تیک خوانده‌شدن
app.post('/api/chats/read', auth, (req, res) => {
  const roomId = String((req.body || {}).roomId || '').slice(0, 100);
  if (!canAccess(roomId, req.user.username)) return res.status(403).json({ error: 'دسترسی نداری' });
  const rs = readStateOf();
  if (!rs[roomId]) rs[roomId] = {};
  rs[roomId][req.user.username] = Date.now();
  saveDB();
  broadcast({ type: 'room-read', roomId, username: req.user.username, time: rs[roomId][req.user.username] });
  res.json({ ok: true });
});

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
  const onlineList = [...online.values()].map((i) => i.pub);
  for (const [, info] of online) {
    if (info.pub.isAdmin) {
      // ادمین همه کاربران ثبت‌شده را می‌بیند (آنلاین و آفلاین)
      const all = db.users.map((u) => ({ ...publicUser(u), online: online.has(u.username) }));
      wsSend(info.ws, { type: 'users', users: all });
    } else {
      // لیست کاربران فقط برای ادمین است
      wsSend(info.ws, { type: 'users', users: [] });
    }
  }
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
      const uname = getSession(data.token);
      const user = uname && db.users.find((u) => u.username === uname);
      if (!user || user.banned) return wsSend(ws, { type: 'auth-failed' });
      username = user.username;
      online.set(username, { ws, pub: publicUser(user) });
      user.lastSeen = Date.now();
      const myReadState = {};
      const rsAll = readStateOf();
      for (const [rid, readers] of Object.entries(rsAll)) {
        if (canAccess(rid, username)) myReadState[rid] = readers;
      }
      wsSend(ws, {
        type: 'ready', me: publicUser(user), groups: publicGroups(username),
        chatState: chatStateOf(username), readState: myReadState, pinned: db.pinned,
      });
      pushUsers();
      broadcastGroups();
      return;
    }
    if (!username) return;

    if (data.type === 'history') {
      const roomId = String(data.roomId || '').slice(0, 100);
      if (!canAccess(roomId, username)) return;
      const msgs = (db.messages[roomId] || []).slice(-100).map(enrichMsg);
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
      if (!canAccess(roomId, username)) return;
      if (!canPost(roomId, username)) return wsSend(ws, { type: 'error', text: 'در کانال فقط مدیران می‌توانند پیام بفرستند' });
      const kind = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'file', 'poll', 'checklist', 'album'].includes(data.kind) ? data.kind : 'text';
      const maxLen = (user.isPremium || user.isAdmin) ? MAX_MSG_LEN : 700;

      // اعتبارسنجی بار پیام بر اساس نوع
      let content = '';
      let album = undefined, poll = undefined, checklist = undefined;
      if (kind === 'text' || kind === 'sticker') {
        content = String(data.content ?? '').slice(0, maxLen);
        if (!content.trim()) return;
      } else if (kind === 'album') {
        if (!Array.isArray(data.album) || data.album.length < 1) return;
        album = data.album.filter((u) => typeof u === 'string' && /^\/uploads\/[\w.-]+$/.test(u)).slice(0, 10);
        if (!album.length) return;
      } else if (kind === 'poll' || kind === 'checklist') {
        if (kind === 'poll') {
          const q = String(data.poll?.question || '').slice(0, 200).trim();
          const opts = (data.poll?.options || []).map((o) => String(o || '').slice(0, 80).trim()).filter(Boolean).slice(0, 10);
          if (!q || opts.length < 2) return;
          poll = { question: q, options: opts, quiz: !!data.poll?.quiz, correct: typeof data.poll?.correct === 'number' ? data.poll.correct : null, votes: {} };
        } else {
          const t = String(data.checklist?.title || '').slice(0, 200).trim();
          const items = (data.checklist?.items || []).map((i) => String(i || '').slice(0, 120).trim()).filter(Boolean).slice(0, 30);
          if (!t || !items.length) return;
          checklist = { title: t, items: items.map((x) => ({ text: x, done: false })) };
        }
      } else {
        if (typeof data.url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(data.url)) return;
      }

      // نقل قول (ریپلای)
      let replyTo;
      if (data.replyTo && typeof data.replyTo === 'object' && typeof data.replyTo.id === 'string') {
        replyTo = {
          id: data.replyTo.id.slice(0, 40),
          name: String(data.replyTo.name || '').slice(0, 40),
          snippet: String(data.replyTo.snippet || '').slice(0, 120),
        };
      }

      const msg = {
        id: crypto.randomUUID(), roomId, from: username, fromName: user.displayName, kind,
        content, url: data.url || undefined, mime: typeof data.mime === 'string' ? data.mime.slice(0, 60) : undefined,
        name: typeof data.name === 'string' ? data.name.slice(0, 80) : undefined, time: now,
        fromAvatar: user.avatar || undefined, fromPremium: !!user.isPremium,
        replyTo, album, poll, checklist,
        reactions: {}, silent: !!data.silent,
        fwdFrom: typeof data.fwdFrom === 'string' ? data.fwdFrom.slice(0, 40) : undefined,
      };
      if (!db.messages[roomId]) db.messages[roomId] = [];
      db.messages[roomId].push(msg);
      if (db.messages[roomId].length > HISTORY_LIMIT) db.messages[roomId] = db.messages[roomId].slice(-HISTORY_LIMIT);
      saveDB();
      broadcast({ type: 'message', message: msg });
      if (kind === 'text') maybeReminder(roomId, user, content);
      const aiText = kind === 'text' ? content : kind === 'sticker' ? `[استیکر فرستاد: ${content}]` : kind === 'poll' ? `[نظرسنجی: ${poll.question}]` : kind === 'checklist' ? `[چک‌لیست: ${checklist.title}]` : '[فایل فرستاد]';
      maybeAiReply(roomId, user, aiText);
      return;
    }

    if (data.type === 'edit-message') {
      const { roomId, id, content } = data;
      if (!canAccess(roomId, username)) return;
      const arr = db.messages[roomId] || [];
      const msg = arr.find((m) => m.id === id);
      if (!msg || msg.from !== username || msg.kind !== 'text') return;
      msg.content = String(content || '').slice(0, MAX_MSG_LEN).trim();
      if (!msg.content) return;
      msg.edited = true;
      saveDB();
      broadcast({ type: 'message-edited', roomId, id, content: msg.content });
      return;
    }

    if (data.type === 'delete-message') {
      const { roomId, id } = data;
      if (!canAccess(roomId, username)) return;
      const arr = db.messages[roomId] || [];
      const idx = arr.findIndex((m) => m.id === id);
      if (idx === -1) return;
      if (arr[idx].from !== username && !db.users.find((u) => u.username === username)?.isAdmin) return;
      arr.splice(idx, 1);
      saveDB();
      broadcast({ type: 'message-deleted', roomId, id });
      return;
    }

    // ---- call signaling relay ----
    if (['call-offer', 'call-answer', 'call-ice', 'call-end'].includes(data.type)) {
      const target = online.get(String(data.to || ''));
      if (!target) {
        if (data.type === 'call-offer') wsSend(ws, { type: 'error', text: 'کاربر آنلاین نیست' });
        return;
      }
      wsSend(target.ws, { type: data.type, from: username, fromName: db.users.find((u) => u.username === username)?.displayName, sdp: data.sdp, candidate: data.candidate });
      return;
    }

    if (data.type === 'typing') {
      const user = db.users.find((u) => u.username === username);
      broadcast({ type: 'typing', roomId: String(data.roomId || '').slice(0, 100), name: user ? user.displayName : username }, ws);
    }
  });

  ws.on('close', () => {
    if (username) {
      online.delete(username);
      const u = db.users.find((x) => x.username === username);
      if (u) { u.lastSeen = Date.now(); saveDB(); }
      pushUsers();
    }
  });
});

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
function botDmRoom(username) { return 'dm:' + [username, BOT_USERNAME].sort().join('|'); }

function sendBotToRoom(roomId, content) {
  const msg = { id: crypto.randomUUID(), roomId, from: BOT_USERNAME, fromName: BOT_NAME, kind: 'text', content: String(content).slice(0, 4000), time: Date.now(), reactions: {}, silent: false };
  if (!db.messages[roomId]) db.messages[roomId] = [];
  db.messages[roomId].push(msg);
  saveDB();
  broadcast({ type: 'message', message: msg });
  return msg;
}

function roomHistoryText(roomId, n = 40) {
  return (db.messages[roomId] || []).slice(-n).map((m) => {
    let c = m.kind === 'text' ? m.content : m.kind === 'poll' ? '[نظرسنجی] ' + (m.poll?.question || '') : m.kind === 'checklist' ? '[چک‌لیست] ' + (m.checklist?.title || '') : '[' + m.kind + ']';
    return `${m.fromName || m.from}: ${c}`;
  }).join('\n');
}

function toEnDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function detectDateTime(text) {
  const t = toEnDigits(text);
  let dayOffset = null;
  if (/پس\s*فردا|پس‌فردا/.test(t)) dayOffset = 2;
  else if (/فردا/.test(t)) dayOffset = 1;
  else if (/امروز/.test(t)) dayOffset = 0;
  if (dayOffset === null) return null;
  let h = 9, mi = 0;
  const tm = t.match(/ساعت\s*(\d{1,2})(?::(\d{2}))?/);
  if (tm) { h = Math.min(23, parseInt(tm[1], 10) || 9); mi = tm[2] ? Math.min(59, parseInt(tm[2], 10)) : 0; }
  else {
    const tm2 = t.match(/(\d{1,2})(?::(\d{2}))?\s*(صبح|ظهر|عصر|شب)/);
    if (tm2) {
      h = parseInt(tm2[1], 10) || 9; mi = tm2[2] ? parseInt(tm2[2], 10) : 0;
      const p = tm2[3];
      if ((p === 'عصر' || p === 'شب') && h < 12) h += 12;
      if (p === 'ظهر') { h = 12; mi = 0; }
    }
  }
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, mi, 0, 0);
  if (d.getTime() <= Date.now()) return null;
  return d;
}

function formatWhen(date) {
  const dayDiff = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const label = dayDiff === 0 ? 'امروز' : dayDiff === 1 ? 'فردا' : dayDiff === 2 ? 'پس‌فردا' : date.toLocaleDateString('fa-IR');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${label} ساعت ${hh}:${mm}`;
}

function scheduleReminder(username, date, body) {
  const clean = body
    .replace(/یادآوری|یاداوری|ریميند|remind|یاد بده|یاداور|فراموش نکن|یادم باشه|یادم باشد|یادم باش/gi, '')
    .replace(/فردا|پس‌فردا|پس فردا|امروز/g, '')
    .replace(/ساعت\s*\d{1,2}(?::\d{2})?/g, '')
    .replace(/\s+/g, ' ').trim() || body;
  db.scheduled.push({ id: crypto.randomUUID(), roomId: botDmRoom(username), from: BOT_USERNAME, kind: 'text', content: 'یادآوری: ' + clean.slice(0, 4000), at: date.getTime() });
  saveDB();
}

function maybeReminder(roomId, user, text) {
  const dt = detectDateTime(text);
  if (!dt) return;
  const wants = /یادآوری|یاداوری|ریميند|remind|یاد بده|یاداور|فراموش نکن|یادم باشه|یادم باشد|یادم باش/.test(text);
  if (wants) {
    scheduleReminder(user.username, dt, text);
    sendBotToRoom(botDmRoom(user.username), `یادآوری ثبت شد برای ${formatWhen(dt)}: ${text.slice(0, 200)}`);
  } else {
    notifyUser(user.username, { type: 'ai-suggestion', at: dt.getTime(), when: formatWhen(dt), text: text.slice(0, 200) });
  }
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch {
    try { const i = s.indexOf('{'); const j = s.lastIndexOf('}'); return i >= 0 && j > i ? JSON.parse(s.slice(i, j + 1)) : null; } catch { return null; }
  }
}

async function handleAiCommand(roomId, user, rawText) {
  try {
    if (!process.env.GROQ_API_KEYS_STR) return;
    const m = rawText.match(/^@(?:ai|vortex_bot)\s*[:]?\s*([\s\S]+)$/i);
    if (!m) { sendBotToRoom(roomId, 'دستور نامشخص. مثلاً: @ai خلاصه / @ai ترجمه سلام / @ai بازنویسی متن'); return; }
    const cmd = m[1].trim();
    const hist = roomHistoryText(roomId, 40);
    notifyUser(user.username, { type: 'ai-thinking', roomId });
    let out = null;
    if (/^(خلاصه|summary)/i.test(cmd)) {
      out = await chatCompletion([{ role: 'system', content: 'You are VORTEXGRAM AI. Summarize the following chat in Persian in 3-5 short bullet points. Be concise, no preamble.' }, { role: 'user', content: 'Chat:\n' + hist }]);
      out = out ? ('خلاصه گفتگو:\n' + out) : null;
    } else if (/^(ترجمه|translate)/i.test(cmd)) {
      const rest = cmd.replace(/^(ترجمه|translate)\s*[:]?/i, '').trim();
      out = await chatCompletion([{ role: 'system', content: 'Translate the text. If Persian translate to English, else to Persian. Return only the translation.' }, { role: 'user', content: rest }]);
    } else if (/^(بازنویسی|rewrite)/i.test(cmd)) {
      const rest = cmd.replace(/^(بازنویسی|rewrite)\s*[:]?/i, '').trim();
      let tone = 'natural'; if (/رسمی/.test(rest)) tone = 'formal'; else if (/طنز|خنده‌دار/.test(rest)) tone = 'funny'; else if (/دوستانه/.test(rest)) tone = 'friendly';
      out = await chatCompletion([{ role: 'system', content: `Rewrite the text in Persian with a ${tone} tone. Return only the rewritten text.` }, { role: 'user', content: rest }]);
    } else if (/^(پاسخ|reply)/i.test(cmd)) {
      out = await chatCompletion([{ role: 'system', content: 'Based on the recent chat, suggest 3 short reply options in Persian, one per line, no numbering, no labels.' }, { role: 'user', content: 'Chat:\n' + hist }]);
    } else if (/^(چک‌لیست|checklist)/i.test(cmd)) {
      const rest = cmd.replace(/^(چک‌لیست|checklist)\s*[:]?/i, '').trim();
      const j = await chatCompletion([{ role: 'system', content: 'Convert the request into JSON: {"title":"...","items":["...","..."]}. Return only valid JSON.' }, { role: 'user', content: rest }]);
      const parsed = safeJson(j);
      if (parsed && parsed.title && Array.isArray(parsed.items) && parsed.items.length) {
        const checklist = { title: String(parsed.title).slice(0, 200), items: parsed.items.slice(0, 30).map((x) => ({ text: String(x).slice(0, 120), done: false })) };
        sendBotToRoom(roomId, 'چک‌لیست پیشنهادی:');
        const msg = { id: crypto.randomUUID(), roomId, from: BOT_USERNAME, fromName: BOT_NAME, kind: 'checklist', checklist, time: Date.now(), reactions: {}, silent: false };
        if (!db.messages[roomId]) db.messages[roomId] = [];
        db.messages[roomId].push(msg); saveDB(); broadcast({ type: 'message', message: msg });
        return;
      }
      out = 'ساخت چک‌لیست ممکن نشد.';
    } else if (/^(نظرسنجی|poll)/i.test(cmd)) {
      const rest = cmd.replace(/^(نظرسنجی|poll)\s*[:]?/i, '').trim();
      const j = await chatCompletion([{ role: 'system', content: 'Convert the request into JSON: {"question":"...","options":["...","..."]}. Return only valid JSON.' }, { role: 'user', content: rest }]);
      const parsed = safeJson(j);
      if (parsed && parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
        const poll = { question: String(parsed.question).slice(0, 200), options: parsed.options.slice(0, 10).map((o) => String(o).slice(0, 80)), quiz: false, correct: null, votes: {} };
        sendBotToRoom(roomId, 'نظرسنجی پیشنهادی:');
        const msg = { id: crypto.randomUUID(), roomId, from: BOT_USERNAME, fromName: BOT_NAME, kind: 'poll', poll, time: Date.now(), reactions: {}, silent: false };
        if (!db.messages[roomId]) db.messages[roomId] = [];
        db.messages[roomId].push(msg); saveDB(); broadcast({ type: 'message', message: msg });
        return;
      }
      out = 'ساخت نظرسنجی ممکن نشد.';
    } else if (/^(یادآوری|remind|ریميند)/i.test(cmd)) {
      const dt = detectDateTime(cmd);
      if (dt) { scheduleReminder(user.username, dt, cmd); out = 'یادآوری تنظیم شد برای ' + formatWhen(dt); }
      else out = 'زمان را متوجه نشدم. مثلاً: @ai یادآوری فردا ساعت ۱۷ جلسه';
    } else {
      out = await chatCompletion([{ role: 'system', content: 'You are VORTEXGRAM AI assistant. Answer the request briefly in Persian, using the chat context if relevant.' }, { role: 'user', content: 'Recent chat:\n' + hist + '\n\nUser: ' + cmd }]);
    }
    if (out) sendBotToRoom(roomId, out);
  } catch (e) { console.error('ai cmd failed:', e.message); }
}

async function maybeAiReply(roomId, user, rawText) {
  try {
    if (!process.env.GROQ_API_KEYS_STR) return;
    if (/^@(?:ai|vortex_bot)\s/i.test(rawText || '')) { handleAiCommand(roomId, user, rawText); return; }
    // ربات فقط در چت خصوصیِ خودش پاسخ می‌دهد — نه در گروه‌ها و کانال‌ها
    if (roomId !== 'dm:' + [user.username, BOT_USERNAME].sort().join('|')) return;
    const text = (rawText || '').trim();

    if ((text === 'تندتر' || text === 'آروم\u200cتر' || text === 'اروم تر')) {
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

    notifyUser(user.username, { type: 'ai-thinking', roomId });
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

server.listen(PORT, () => console.log(`vortexgram on http://localhost:${PORT}`));