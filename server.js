const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const dns = require('dns');

// ---------- .env ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { console.warn('.env not found, using environment variables only'); }

const { chatCompletion } = require('./ai/groq');
const prompts = require('./ai/prompts');

process.on('uncaughtException', (e) => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED:', e));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const IMG_BASE = path.join(__dirname, 'public', 'img');
const IMG_DIRS = {
  profiles: path.join(IMG_BASE, 'profiles'),
  backgrounds: path.join(IMG_BASE, 'backgrounds'),
  effects: path.join(IMG_BASE, 'effects'),
};
Object.values(IMG_DIRS).forEach((d) => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MSG_LEN = 4000;
const HISTORY_LIMIT = 200;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';

// فقط ادمین اصلی (شماره ثبت‌شده در ADMIN_PHONES) دسترسی‌های حساس را دارد
function isOriginalAdmin(user) {
  if (!user || !user.isAdmin) return false;
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminPhones.includes(user.phone);
}

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
// rate-limit ساده ضد بروت‌فورس برای اندپوینت‌های احراز هویت (حافظه‌ای، هر پروسه)
const authAttempts = new Map(); // key -> [timestamps]
function authRateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (authAttempts.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { authAttempts.set(key, arr); return false; }
  arr.push(now);
  authAttempts.set(key, arr);
  return true;
}
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
// ارسال پیامک: طبق درخواست کاربر غیرفعال شد — هیچ پیامکی ارسال نمی‌شود و کد فقط روی صفحه نمایش داده می‌شود
function sendSMS(phone, text) {
  return new Promise((resolve) => {
    console.log('[SMS disabled] would send to', phone, '->', text);
    resolve({ ok: true, dev: true });
  });
}
function publicUser(u) {
  return { username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned, avatar: u.avatar || null, bio: u.bio || '', isPremium: !!u.isPremium, phone: u.phone || null, activeSkin: u.activeSkin || 'default', profileEffect: u.profileEffect || 'off', profileEffectColor: u.profileEffectColor || null, profileBg: u.profileBg || null, blocked: Array.isArray(u.blocked) ? u.blocked : [] };
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
  if (roomId.startsWith('dm:')) {
    const parts = roomId.slice(3).split('|');
    if (!parts.includes(username)) return false;
    const other = parts.find((p) => p !== username);
    const otherUser = db.users.find((u) => u.username === other);
    if (otherUser && Array.isArray(otherUser.blocked) && otherUser.blocked.includes(username)) return false;
    return true;
  }
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
app.use((req, res, next) => {
  if (req.path === '/api/swtest' && req.method === 'POST') {
    try { fs.writeFileSync(path.join(__dirname, 'swtest-result.txt'), JSON.stringify(req.body)); } catch (e) {}
    return res.json({ ok: true });
  }
  next();
});
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
  if (!authRateOk('login:' + (req.ip || '?'), 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — یک دقیقه صبر کن' });
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
  if (!authRateOk('send-code:' + phone, 5, 5 * 60 * 1000)) return res.status(429).json({ error: 'کد زیاد درخواست شده — چند دقیقه صبر کن' });
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
  if (!authRateOk('verify-code:' + phone, 10, 5 * 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — چند دقیقه صبر کن' });
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
  const existing = db.users.find((u) => u.phone === phone);
  if (existing) {
    pendingCodes.delete(phone);
    if (existing.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    const token = createSession(existing.username);
    return res.json({ token, me: publicUser(existing) });
  }
  if (displayName.length < 2) return res.status(400).json({ error: 'نام نمایشی حداقل ۲ حرف' });
  if (username) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_' });
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'این نام کاربری قبلاً گرفته شده' });
  } else {
    username = 'u' + phone.slice(1);
    while (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) username += crypto.randomInt(0, 9);
  }
  if (db.signupRequests.some((r) => r.phone === phone)) return res.status(409).json({ error: 'درخواست عضویت تو قبلاً ثبت شده و منتظر تایید ادمین است' });

  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  const isAdmin = adminPhones.includes(phone);

  if (isAdmin) {
    const user = { username, phone, displayName, salt: null, passHash: null, isAdmin: true, isPremium: true, banned: false, createdAt: Date.now(), avatar: null, bio: 'ادمین سیستم', activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null };
    db.users.push(user);
    pendingCodes.delete(phone);
    saveDB();
    pushUsers();
    const token = createSession(user.username);
    return res.json({ ok: true, token, me: publicUser(user), message: 'حساب ادمین ساخته شد ✅' });
  }

  db.signupRequests.push({ id: crypto.randomUUID(), username, phone, displayName, at: Date.now(), type: 'phone' });
  saveDB();
  for (const u of db.users.filter((x) => x.isAdmin)) notifyUser(u.username, { type: 'signup-request', username, displayName, phone });
  res.json({ pending: true, message: 'درخواست عضویت ثبت شد ✅ منتظر تایید ادمین باش' });
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

// ذخیره تم/اسکین فعال کاربر (برای جلوه‌های پروفایل دیسکوردی)
app.post('/api/skin', auth, (req, res) => {
  const skin = String((req.body || {}).skin || '').trim();
  req.user.activeSkin = skin || 'default';
  saveDB();
  res.json({ ok: true, me: publicUser(req.user) });
});

// ذخیره افکت حاله/بال پروفایل (بخش مجزا)
app.post('/api/profile-effect', auth, (req, res) => {
  const effect = String((req.body || {}).effect || 'off').trim();
  const color = (req.body || {}).color ? String(req.body.color).trim() : (req.user.profileEffectColor || null);
  req.user.profileEffect = effect;
  req.user.profileEffectColor = effect === 'off' ? null : color;
  saveDB();
  res.json({ ok: true, me: publicUser(req.user) });
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, 'av-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + (EXT_BY_MIME[cleanMime(file.mimetype)] || '')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(cleanMime(file.mimetype))),
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
app.post('/api/profile/background', auth, avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویر مجاز نیست (فقط jpg/png/webp تا ۵MB)' });
  if (req.user.profileBg && req.user.profileBg.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(req.user.profileBg)), () => {});
  }
  req.user.profileBg = '/uploads/' + req.file.filename;
  saveDB(); pushUsers();
  res.json({ ok: true, profileBg: req.user.profileBg, me: publicUser(req.user) });
});
function setProfileBgSafe(url) {
  if (typeof url !== 'string') return null;
  if (/^\/uploads\/[\w.-]+$/.test(url)) return url;
  if (/^\/img\/(profiles|backgrounds|effects)\/[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(url)) return url;
  return null;
}
app.post('/api/profile/background/url', auth, (req, res) => {
  const url = setProfileBgSafe((req.body || {}).url);
  if (!url) return res.status(400).json({ error: 'لینک تصویر معتبر نیست' });
  req.user.profileBg = url;
  saveDB(); pushUsers();
  res.json({ ok: true, profileBg: req.user.profileBg, me: publicUser(req.user) });
});
app.post('/api/profile/avatar/url', auth, (req, res) => {
  const url = setProfileBgSafe((req.body || {}).url);
  if (!url) return res.status(400).json({ error: 'لینک تصویر معتبر نیست' });
  req.user.avatar = url;
  saveDB(); pushUsers();
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

app.post('/api/admin/displayname', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const { username, displayName } = req.body || {};
  const newName = String(displayName || '').trim();
  if (newName.length < 2 || newName.length > 25) return res.status(400).json({ error: 'نام نمایشی باید ۲ تا ۲۵ کاراکتر باشد' });
  const target = db.users.find((u) => u.username === username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  target.displayName = newName;
  saveDB();
  pushUsers();
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
});

app.post('/api/block', auth, (req, res) => {
  const { username } = req.body || {};
  const target = String(username || '');
  if (!target || target === req.user.username) return res.status(400).json({ error: 'نامعتبر' });
  const targetUser = db.users.find((u) => u.username === target);
  if (!targetUser) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (!Array.isArray(req.user.blocked)) req.user.blocked = [];
  if (!req.user.blocked.includes(target)) { req.user.blocked.push(target); saveDB(); }
  res.json({ ok: true, blocked: req.user.blocked });
});

app.post('/api/unblock', auth, (req, res) => {
  const { username } = req.body || {};
  const target = String(username || '');
  if (!Array.isArray(req.user.blocked)) req.user.blocked = [];
  req.user.blocked = req.user.blocked.filter((u) => u !== target);
  saveDB();
  res.json({ ok: true, blocked: req.user.blocked });
});

app.get('/api/blocked', auth, (req, res) => {
  res.json({ blocked: Array.isArray(req.user.blocked) ? req.user.blocked : [] });
});

app.get('/api/admin/stats', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const totalUsers = db.users.length;
  const onlineUsers = [...online.keys()].length;
  const totalGroups = db.groups.length;
  const totalMessages = Object.values(db.messages).reduce((sum, arr) => sum + arr.length, 0);
  const today = new Date().toDateString();
  const msgsToday = Object.values(db.messages).reduce((sum, arr) => sum + arr.filter((m) => new Date(m.time).toDateString() === today).length, 0);
  const pendingSignups = db.signupRequests.length;
  const bannedUsers = db.users.filter((u) => u.banned).length;
  const premiumUsers = db.users.filter((u) => u.isPremium).length;
  const totalUploads = (() => { try { return require('fs').readdirSync(UPLOAD_DIR).length; } catch { return 0; } })();
  res.json({ totalUsers, onlineUsers, totalGroups, totalMessages, msgsToday, pendingSignups, bannedUsers, premiumUsers, totalUploads });
});

app.get('/api/admin/users', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ users: db.users.map(publicUser) });
});

// جستجوی کاربران بر اساس آیدی/نام (برای شروع چت و پیدا کردن افراد)
app.get('/api/users/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  const out = db.users
    .filter((u) => u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q))
    .slice(0, 25)
    .map((u) => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null, isPremium: !!u.isPremium, isAdmin: !!u.isAdmin, banned: !!u.banned, online: !!u.online }));
  res.json({ users: out });
});

// پروفایل عمومی هر کاربر (برای نمایش جلوه‌های تم در پروفایل)
app.get('/api/user/:username', auth, (req, res) => {
  const uname = String(req.params.username || '').replace('@', '');
  const target = db.users.find((u) => u.username === uname);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const pu = publicUser(target);
  delete pu.phone;
  res.json({ u: pu });
});

// ورود ادمین به حساب کاربر (impersonate) — فقط ادمین اصلی
app.post('/api/admin/impersonate', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  if (!isOriginalAdmin(req.user)) return res.status(403).json({ error: 'فقط ادمین اصلی اجازه دارد' });
  const username = String((req.body || {}).username || '').replace('@', '');
  const target = db.users.find((u) => u.username === username);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (target.banned) return res.status(400).json({ error: 'کاربر مسدود است' });
  const token = createSession(target.username);
  saveDB();
  res.json({ ok: true, token, username: target.username });
});

// ارتقای کاربر به ادمین (کل پروژه) — فقط ادمین اصلی
app.post('/api/admin/promote', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  if (!isOriginalAdmin(req.user)) return res.status(403).json({ error: 'فقط ادمین اصلی اجازه دارد' });
  const { username, scope, role } = req.body || {};
  const target = db.users.find((u) => u.username === String(username).replace('@', ''));
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (target.isAdmin && !isOriginalAdmin(target)) {
    // ادمین اصلی نمی‌تونه ادمین اصلی دیگه‌ای رو حذف کنه
  }
  if (scope && scope !== 'global') {
    const g = db.groups.find((x) => x.id === String(scope).replace('group:', ''));
    if (!g) return res.status(404).json({ error: 'گروه یافت نشد' });
    const m = memberOf(g, target.username);
    if (!m) return res.status(400).json({ error: 'کاربر عضو گروه نیست' });
    m.role = role === 'admin' ? 'admin' : 'member';
    saveDB(); broadcastGroups();
    return res.json({ ok: true, group: g.id, role: m.role });
  }
  target.isAdmin = role === 'admin';
  saveDB(); pushUsers();
  res.json({ ok: true, global: true, isAdmin: target.isAdmin });
});

// فایل‌ها و پیام‌های رسانه‌ای ارسالی یک کاربر
app.get('/api/admin/user/:username/files', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const username = String(req.params.username || '').replace('@', '');
  const out = { images: [], audios: [], videos: [], files: [], links: [] };
  const pushKind = (m) => {
    const entry = { roomId: m.roomId, time: m.time, src: m.src, name: m.name, size: m.size, url: m.url, content: m.content, kind: m.kind };
    if (m.kind === 'image') out.images.push(entry);
    else if (m.kind === 'voice' || m.kind === 'audio') out.audios.push(entry);
    else if (m.kind === 'video') out.videos.push(entry);
    else if (m.kind === 'file') out.files.push(entry);
    if (/^https?:\/\//.test(m.content || '')) out.links.push({ roomId: m.roomId, time: m.time, url: m.content, content: m.content });
  };
  for (const [roomId, arr] of Object.entries(db.messages)) {
    if (roomId.startsWith('dm:')) {
      if (!roomId.slice(3).split('|').includes(username)) continue;
    } else if (roomId.startsWith('group:')) {
      const g = findGroup(roomId.slice(6));
      if (!g || !memberOf(g, username)) continue;
    } else continue;
    arr.forEach((m) => { if (m.from === username) pushKind(m); });
  }
  res.json(out);
});

// درخواست‌های ثبت‌نام در انتظار تایید
app.get('/api/admin/signups', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ signups: db.signupRequests.map((r) => ({ id: r.id, username: r.username, displayName: r.displayName || r.username, phone: r.phone || null, at: r.at })) });
});

app.post('/api/admin/signups/:id', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const approve = !!(req.body || {}).approve;
  const idx = db.signupRequests.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'درخواست یافت نشد' });
  const reqItem = db.signupRequests[idx];
  db.signupRequests.splice(idx, 1);
  if (approve) {
    if (reqItem.phone) {
      db.users.push({ username: reqItem.username, displayName: reqItem.displayName, phone: reqItem.phone, isAdmin: false, isPremium: false, createdAt: Date.now(), avatar: null, bio: '', activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null });
    } else {
      db.users.push({ username: reqItem.username, salt: reqItem.salt, passHash: reqItem.passHash, displayName: reqItem.username, isAdmin: false, banned: false, createdAt: Date.now(), activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null });
    }
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
  const { roomId, msgId } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const emoji = String((req.body || {}).emoji || '').slice(0, 8);
  if (!emoji || ['__proto__', 'constructor', 'prototype'].includes(emoji)) return res.status(400).json({ error: 'واکنش نامعتبر' });
  if (!m.reactions || typeof m.reactions !== 'object' || Array.isArray(m.reactions)) m.reactions = {};
  const u = req.user.username;
  for (const [emojiKey, users] of Object.entries(m.reactions)) {
    m.reactions[emojiKey] = users.filter((x) => x !== u);
    if (!m.reactions[emojiKey].length) delete m.reactions[emojiKey];
  }
  m.reactions[emoji] = [u];
  saveDB();
  broadcast({ type: 'message-updated', roomId: rid, id: msgId, message: { reactions: m.reactions } });
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
  const opt = Number(option);
  if (!Number.isInteger(opt) || opt < 0 || opt >= (m.poll.options || []).length) return res.status(400).json({ error: 'گزینه نامعتبر' });
  m.poll.votes[req.user.username] = opt;
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
  const k = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'file'].includes(kind) ? kind : 'text';
  const vUrl = typeof url === 'string' && /^\/uploads\/[\w.-]+$/.test(url) ? url : undefined;
  const id = crypto.randomUUID();
  db.scheduled.push({ id, roomId: rid, from: req.user.username, kind: k, content: String(content || '').slice(0, 4000), url: vUrl, name: typeof name === 'string' ? name.slice(0, 80) : undefined, mime: typeof mime === 'string' ? mime.slice(0, 60) : undefined, replyTo: replyTo && typeof replyTo === 'object' && typeof replyTo.id === 'string' ? { id: replyTo.id.slice(0, 40), name: String(replyTo.name || '').slice(0, 40), snippet: String(replyTo.snippet || '').slice(0, 120) } : undefined, at: atTs });
  saveDB();
  res.json({ ok: true, id });
});

// ===== پیش‌نمایش لینک =====
const httpsMod = require('https');
const httpMod = require('http');
const urlMod = require('url');
function isPrivateIp(ip) {
  if (typeof ip !== 'string' || !ip) return true;
  if (ip.includes(':')) return true; // IPv6 always blocked
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true; // loopback, private class A, multicast
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private class B
  if (a === 192 && b === 168) return true; // private class C
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 203 && b === 0 && p[2] === 113) return true; // documentation
  if (a === 240) return true; // reserved
  return false;
}
function fetchWithRedirects(url, opts, maxRedirects = 3) {
  const mod = url.startsWith('https:') ? httpsMod : httpMod;
  return new Promise((resolve, reject) => {
    const reqO = mod.get(url, opts, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && maxRedirects > 0) {
        r.resume();
        try {
          const next = new urlMod.URL(r.headers.location, url);
          if (next.protocol !== 'http:' && next.protocol !== 'https:') return reject(new Error('bad redirect protocol'));
          const port = Number(next.port) || (next.protocol === 'https:' ? 443 : 80);
          if (![80, 443, 8080, 8443].includes(port)) return reject(new Error('bad redirect port'));
          return resolve(fetchWithRedirects(next.href, opts, maxRedirects - 1));
        } catch { return reject(new Error('bad redirect url')); }
      }
      resolve(r);
    });
    reqO.on('timeout', () => { reqO.destroy(); reject(new Error('timeout')); });
    reqO.on('error', reject);
  });
}
app.get('/api/link-preview', auth, async (req, res) => {
  const raw = String(req.query.url || '');
  let u;
  try { u = new urlMod.URL(raw); } catch { return res.status(400).json({ error: 'لینک نامعتبر' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res.status(400).json({ error: 'فقط http(s)' });
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  if (![80, 443, 8080, 8443].includes(port)) return res.status(400).json({ error: 'پورت غیرمجاز' });
  try {
    const addrs = await dns.promises.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((i) => isPrivateIp(i.address))) return res.status(400).json({ error: 'آدرس مقصد مجاز نیست' });
  } catch { return res.status(400).json({ error: 'دامنه یافت نشد' }); }
  try {
    const r = await fetchWithRedirects(u.href, { timeout: 3000, headers: { 'User-Agent': 'VortexGramBot/1.0', 'Accept': 'text/html' } }, 3);
    const ct = r.headers['content-type'] || '';
    if (!ct.includes('text/html')) { r.resume(); return res.json({ url: raw, domain: u.hostname }); }
    let buf = ''; let n = 0;
    r.on('data', (c) => { buf += c; n += c.length; if (n > 100000) r.destroy(); });
    r.on('end', () => {
      const title = (buf.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const desc = (buf.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]
        || (buf.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '';
      const og = (buf.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
      res.json({ url: raw, domain: u.hostname, title: title.slice(0, 200).trim(), description: desc.slice(0, 300).trim(), image: og.slice(0, 300).trim() });
    });
  } catch {
    res.json({ url: raw, domain: u.hostname });
  }
});

// ===== AI داخلی (دستورات و پنل) =====
app.post('/api/ai', auth, async (req, res) => {
  if (!process.env.GROQ_API_KEYS_STR) return res.status(503).json({ error: 'AI تنظیم نشده' });
  const { action, roomId, text, tone } = req.body || {};
  const a = String(action || '');
  const rid = String(roomId || '');
  if ((a === 'summarize' || a === 'reply' || a === 'ask') && !canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  try {
    let out = null;
    if (a === 'summarize') {
      out = await chatCompletion([{ role: 'system', content: 'Summarize the following chat in Persian in 3-5 short bullet points. Concise, no preamble.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(rid, 40) }]);
    } else if (a === 'reply') {
      out = await chatCompletion([{ role: 'system', content: 'Based on the recent chat, suggest 3 short reply options in Persian, one per line, no numbering, no labels.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(rid, 40) }]);
    } else if (a === 'translate') {
      out = await chatCompletion([{ role: 'system', content: 'Translate the text. If Persian translate to English, else to Persian. Return only the translation.' }, { role: 'user', content: String(text || '') }]);
    } else if (a === 'rewrite') {
      const t = String(tone || 'natural');
      out = await chatCompletion([{ role: 'system', content: `Rewrite the text in Persian with a ${t} tone. Return only the rewritten text.` }, { role: 'user', content: String(text || '') }]);
    } else if (a === 'ask') {
      out = await chatCompletion([{ role: 'system', content: 'Answer briefly in Persian using chat context if relevant.' }, { role: 'user', content: 'Chat:\n' + roomHistoryText(rid, 30) + '\n\nQ: ' + String(text || '') }]);
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
function cleanMime(m) { return String(m || '').split(';')[0].trim(); }
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + (EXT_BY_MIME[cleanMime(file.mimetype)] || '')),
  }),
  limits: { fileSize: LIMITS.premiumUploadMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[cleanMime(file.mimetype)]) return cb(null, false);
    cb(null, true);
  },
});
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل مجاز نیست یا حجمش زیاد است' });
  const maxMB = req.user.isPremium ? LIMITS.premiumUploadMB : LIMITS.normalUploadMB;
  if (req.file.size > maxMB * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `حداکثر ${maxMB} مگابایت` + (req.user.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ') });
  }
  const m = cleanMime(req.file.mimetype);
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

// ---------- image gallery (public/img) ----------
const IMG_SUBDIRS = { profiles: 'profiles', backgrounds: 'backgrounds', effects: 'effects' };
app.get('/api/images', auth, (req, res) => {
  const key = IMG_SUBDIRS[String(req.query.dir || 'backgrounds')] || 'backgrounds';
  const folder = IMG_DIRS[key];
  let files = [];
  try { files = fs.readdirSync(folder).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).map((f) => '/img/' + key + '/' + encodeURIComponent(f)); } catch (e) {}
  res.json({ images: files });
});
app.use('/img', express.static(IMG_BASE, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
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
  if (!req.user.isAdmin) {
    const owned = db.groups.filter((g) => g.owner === req.user.username).length;
    const maxOwned = req.user.isPremium ? 10 : 2;
    if (owned >= maxOwned) return res.status(403).json({ error: req.user.isPremium ? 'سقف ساخت: ۱۰ گروه/کانال' : 'حساب رایگان: حداکثر ۲ گروه/کانال — پرمیوم شو ⭐' });
  }
  const g = { id: crypto.randomBytes(6).toString('hex'), type, name, owner: req.user.username, members: [{ username: req.user.username, role: 'owner' }], createdAt: Date.now(), avatar: null };
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

app.post('/api/groups/:id/avatar', auth, avatarUpload.single('avatar'), (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک' });
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد' });
  g.avatar = '/uploads/' + req.file.filename;
  saveDB();
  broadcastGroups();
  res.json({ ok: true, avatar: g.avatar });
});

app.get('/api/groups/:id/invite', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username)) return res.status(403).json({ error: 'عضو نیستی' });
  if (!g.inviteToken) { g.inviteToken = crypto.randomBytes(8).toString('hex'); saveDB(); }
  res.json({ ok: true, token: g.inviteToken, link: '/join/' + g.inviteToken });
});

app.post('/api/groups/join/:token', auth, (req, res) => {
  const g = db.groups.find((x) => x.inviteToken === req.params.token);
  if (!g) return res.status(404).json({ error: 'لینک دعوت نامعتبر یا منقضی' });
  if (memberOf(g, req.user.username)) return res.status(409).json({ error: 'از قبل عضو هستی' });
  g.members.push({ username: req.user.username, role: 'member' });
  saveDB();
  broadcastGroups();
  res.json({ ok: true, group: { id: g.id, name: g.name, type: g.type } });
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
  const body = req.body || {};
  if (body.key && 'value' in body) {
    cur[body.key] = !!body.value;
  } else {
    if ('archived' in body) cur.archived = !!body.archived;
    if ('pinned' in body) cur.pinned = !!body.pinned;
  }
  st[roomId] = cur;
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
const wss = new WebSocketServer({ noServer: true });
const onUpgrade = (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
};
server.on('upgrade', onUpgrade);

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

    if (data.type === 'read') {
      const roomId = String(data.roomId || '').slice(0, 100);
      if (!canAccess(roomId, username)) return;
      const rs = readStateOf();
      if (!rs[roomId]) rs[roomId] = {};
      rs[roomId][username] = Date.now();
      saveDB();
      broadcast({ type: 'room-read', roomId, username, time: rs[roomId][username] });
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
      if (roomId.startsWith('dm:')) {
        const other = roomId.slice(3).split('|').find((p) => p !== username);
        const otherUser = db.users.find((u) => u.username === other);
        if (otherUser && Array.isArray(otherUser.blocked) && otherUser.blocked.includes(username)) return wsSend(ws, { type: 'error', text: 'شما توسط این کاربر مسدود شده‌اید' });
        if (user.blocked && Array.isArray(user.blocked) && user.blocked.includes(other)) return wsSend(ws, { type: 'error', text: 'شما این کاربر را مسدود کرده‌اید' });
      }
      if (!canPost(roomId, username)) return wsSend(ws, { type: 'error', text: 'در کانال فقط مدیران می‌توانند پیام بفرستند' });
      const kind = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'voice', 'file', 'poll', 'checklist', 'album'].includes(data.kind) ? data.kind : 'text';
      const maxLen = (user.isPremium || user.isAdmin) ? MAX_MSG_LEN : 700;

      // اعتبارسنجی بار پیام بر اساس نوع
      let content = '';
      let album = undefined, poll = undefined, checklist = undefined;
      if (kind === 'text') {
        content = String(data.content ?? '').slice(0, maxLen);
        if (!content.trim()) return;
      } else if (kind === 'sticker') {
        const stk = typeof data.sticker === 'string' ? data.sticker.trim().slice(0, 300) : '';
        if (!stk || !/^(https?:\/\/[\w.-]+\.\w{2,}|\/uploads\/[\w.-]+)/.test(stk)) return;
        content = stk;
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
        const mUrl = typeof data.url === 'string' ? data.url : typeof data.src === 'string' ? data.src : '';
        if (!/^\/uploads\/[\w.-]+$/.test(mUrl)) return;
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

      const mediaUrl = (kind === 'image' || kind === 'gif' || kind === 'video' || kind === 'audio' || kind === 'voice' || kind === 'file') ? (typeof data.url === 'string' ? data.url : typeof data.src === 'string' ? data.src : '') : '';
      const msg = {
        id: crypto.randomUUID(), roomId, from: username, fromName: user.displayName, kind,
        content, url: mediaUrl || undefined, src: mediaUrl || undefined, mime: typeof data.mime === 'string' ? data.mime.slice(0, 60) : undefined,
        name: typeof data.name === 'string' ? data.name.slice(0, 80) : undefined, size: typeof data.size === 'number' && data.size > 0 ? data.size : undefined, duration: typeof data.duration === 'number' && data.duration > 0 ? Math.min(3600, data.duration) : undefined, time: now,
        wave: Array.isArray(data.wave) ? data.wave.map((v) => Number(v)).filter((v) => Number.isFinite(v)).map((v) => Math.max(0, Math.min(1, v))).slice(0, 100) : undefined,
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
      const stored = online.get(username);
      if (stored && stored.ws === ws) {
        online.delete(username);
      }
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
if (Number(process.env.PORT) !== 3000 && process.env.VX_MIRROR === '1') server2.listen(3000, () => console.log('vortexgram mirrored on http://localhost:3000'));