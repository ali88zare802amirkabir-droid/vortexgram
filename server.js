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
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch (e) { console.warn('.env not found, using environment variables only'); }

const { chatCompletion } = require('./ai/groq');
const prompts = require('./ai/prompts');

process.on('uncaughtException', (e) => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED:', e));

// محیط اجرا و پروکسی
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
// کد ورود (OTP) همیشه در پاسخ برمی‌گردد تا در خود صفحه نمایش داده شود — این دمو پیامک
// واقعی ارسال نمی‌کند مگر KAVENEGAR_KEY تنظیم شود. برای مواقعی که کد نباید در پاسخ بیاید
// (نصب قفل‌شده) می‌توان VX_HIDE_CODE=1 گذاشت؛ در آن صورت کد فقط با VX_ALLOW_DEV_CODE=1
// (یا در حالت توسعه) برمی‌گردد.
const HIDE_CODE = String(process.env.VX_HIDE_CODE || '').trim() === '1';
const devCodeEnabled = !HIDE_CODE || !IS_PROD || String(process.env.VX_ALLOW_DEV_CODE || '').trim() === '1';
if (HIDE_CODE && !devCodeEnabled) {
  console.log('VX_HIDE_CODE=1 — OTP codes will only be delivered via SMS (not returned in API)');
}
// حالت تست بدون کد ورود: فقط با VX_NO_OTP=1 (در هر محیط). در این حالت شماره‌ی ثبت‌شده
// مستقیم وارد می‌شود و شماره‌ی جدید فقط نام/آیدی می‌خواهد.
const noOtpEnabled = String(process.env.VX_NO_OTP || '').trim() === '1';
if (noOtpEnabled) console.warn('VX_NO_OTP enabled — phone login without code (TEST MODE, do not use in production)');
// پشت پراکسی (مثل Render) تنها وقتی TRUST_PROXY ست شود X-Forwarded-For بکار می‌رود.
const TRUST_PROXY = String(process.env.TRUST_PROXY || '0');

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
const MAX_MSG_LEN = 4000;
const HISTORY_LIMIT = 200;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/x-matroska': '.mka',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'text/plain': '.txt',
};
const MIME_BY_EXT = {};
for (const [k, v] of Object.entries(EXT_BY_MIME)) MIME_BY_EXT[v] = k;
function cleanMime(m) { return String(m || '').split(';')[0].trim(); }

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';

// فقط ادمین اصلی (شماره ثبت‌شده در ADMIN_PHONES) دسترسی‌های حساس را دارد
function isOriginalAdmin(user) {
  if (!user || !user.isAdmin) return false;
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminPhones.includes(user.phone);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbStore = require('./db');
const DEFAULT_DB = { users: [], renameRequests: [], messages: {}, groups: [], pinned: {}, scheduled: [], reports: [], messageDeletions: [] };
let db = { ...DEFAULT_DB };
function normalizeGroups() {
  if (!Array.isArray(db.groups)) db.groups = [];
  if (!db.pinned || typeof db.pinned !== 'object') db.pinned = {};
  if (!Array.isArray(db.scheduled)) db.scheduled = [];
  if (!Array.isArray(db.reports)) db.reports = [];
  for (const g of db.groups) {
    if (!g.type) g.type = 'group';
    g.members = (g.members || []).map((m) => (typeof m === 'string' ? { username: m, role: m === g.owner ? 'owner' : 'member' } : m));
    if (!g.members.some((m) => m.username === g.owner)) g.members.push({ username: g.owner, role: 'owner' });
  }
}

let saveTimer = null;
// NOTE (security): auto-commit/push of data/db.json حذف شد —
//  - کد قبلی به `exec` تعریف‌نشده (child_process هرگز require نشده) ارجاع می‌داد و در عمل
//    هرگز اجرا نمی‌شد؛ dead code بود.
//  - حتی اگر کار می‌کرد، کل تاریخچه چت + توکن‌های نشست را به تاریخچه git push می‌کرد.
// پشتیبان‌گیری manual با `git add data/db.json` همچنان توسط اپراتور ممکن است.

function flushDB() {
  clearTimeout(saveTimer);
  try {
    db.sessions = Object.fromEntries(sessions);
    dbStore.save(db);
  } catch (e) {
    console.error('save failed', e.message);
  }
}
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDB, 250);
}
process.on('exit', flushDB);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushDB(); dbStore.close().finally(() => process.exit(0)); });
}

// ---------- sessions / security ----------
const sessions = new Map();
const online = new Map();
const msgTimestamps = new Map();
const wsRateLimits = new Map(); // username -> { key: [timestamps] } برای درخواست‌های WS
function wsRateOk(username, key, max, windowMs) {
  const now = Date.now();
  const per = wsRateLimits.get(username) || {};
  const arr = (per[key] || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { per[key] = arr; wsRateLimits.set(username, per); return false; }
  arr.push(now);
  per[key] = arr;
  wsRateLimits.set(username, per);
  return true;
}
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
// بارگذاری نشست‌های ذخیره‌شده تا لاگین پس از ری‌استارت سرور باقی بماند (در start() پس از لود دیتابیس انجام می‌شود)

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
// IP واقعی کلاینت: فقط وقتی پشت پراکسی قابل اعتماد (TRUST_PROXY) باشیم X-Forwarded-For
// بکار می‌رود؛ در غیر این صورت از آدرس سوکت استفاده می‌شود تا کلاینت نتواند با
// هدر جعلی rate-limit / دستگاه را دور بزند.
function clientIp(req) {
  if (TRUST_PROXY !== '0' && req && req.headers && req.headers['x-forwarded-for']) {
    const parts = String(req.headers['x-forwarded-for']).split(',');
    return String(parts[parts.length - 1] || '').trim().replace(/^::ffff:/, '').slice(0, 60) || '?';
  }
  const ip = (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '?';
  return String(ip).replace(/^::ffff:/, '').slice(0, 60) || '?';
}
// دستگاه متصل کاربر را تشخیص و در db.users.devices ثبت می‌کند
// (ip / پلتفرم / مدل / مرورگر / آخرین بازدید / نسخه اپ)
function clientDevice(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || 'Unknown').slice(0, 300);
  const ip = clientIp(req);
  const appM = ua.match(/(?:VortexGram|VORTEX|Vortex)[/\s]([0-9][0-9.]*)/i);
  const isApp = !!appM;
  let platform = 'web', category = 'وب', os = '', osVersion = '', model = '', isTablet = false;

  const iosM = ua.match(/iPhone|iPad|iPod/);
  if (iosM) {
    isTablet = /iPad/.test(ua);
    platform = isTablet ? 'tablet' : 'ios';
    category = isTablet ? 'تبلت' : 'موبایل';
    os = 'iOS';
    const ov = ua.match(/OS (\d+[_\d]*)/);
    osVersion = ov ? ov[1].replace(/_/g, '.') : '';
    const ph = ua.match(/\(([^;]+); CPU/);
    model = ph ? ph[1].trim().replace(/_\d+$/, '') : (isTablet ? 'iPad' : 'iPhone');
  }
  const anM = ua.match(/Android (\d{1,2}(?:\.\d+)*)/);
  if (anM) {
    isTablet = /Tablet|SM-T|Pixel Tablet|KF[A-Z]|Nexus 10/i.test(ua);
    platform = isTablet ? 'tablet' : 'android';
    category = isTablet ? 'تبلت' : 'موبایل';
    os = 'Android';
    osVersion = anM[1];
    const mv = ua.match(/Android[^;]+;\s*([^;)]+)/);
    model = mv ? mv[1].trim().replace(/Build\/.*$/, '').trim() : '';
  }
  const winM = ua.match(/Windows NT (\d{1,2}(?:\.\d+)*)/);
  if (winM && !iosM && !anM) {
    platform = 'windows'; category = 'دسکتاپ'; os = 'Windows';
    osVersion = ({ '6.1': '7', '6.2': '8', '6.3': '8.1', '10.0': '10/11' }[winM[1]]) || winM[1];
  }
  if (/Macintosh|Mac OS X|Mac_PowerPC/.test(ua) && !iosM) {
    platform = 'macos'; category = 'دسکتاپ'; os = 'macOS';
    const mv = ua.match(/Mac OS X (\d+[_\d]*)/);
    osVersion = mv ? mv[1].replace(/_/g, '.') : '';
  }
  if (/(?:Linux|x86_64|X11;)/.test(ua) && !iosM && !anM && !winM && !(/Macintosh/.test(ua))) {
    platform = 'linux'; category = 'دسکتاپ'; os = 'Linux'; osVersion = '';
  }
  if (platform === 'web' && /Desktop|Windows|Macintosh|X11|Linux/.test(ua)) category = 'دسکتاپ';
  if (isApp) { platform = 'app'; category = 'دسکتاپ'; }

  let browser = 'مرورگر';
  if (ua.match(/Edg\//)) browser = 'Microsoft Edge';
  else if (ua.match(/(OPR|Opera)\//)) browser = 'Opera';
  else if (ua.match(/CriOS\//)) browser = 'Chrome (iOS)';
  else if (ua.match(/FxiOS\//)) browser = 'Firefox (iOS)';
  else if (ua.match(/Firefox\//)) browser = 'Firefox';
  else if (ua.match(/Chrome\//) || ua.match(/Chromium\//)) browser = 'Chrome';
  else if (ua.match(/Safari\//)) browser = 'Safari';
  if (isApp) browser = 'اپلیکیشن VORTEX';

  const device = isApp
    ? (appM[1] ? 'اپلیکیشن VORTEX ' + appM[1] : 'اپلیکیشن VORTEX')
    : browser + ' — ' + category;
  return { ip, region: '', platform, category, browser, os, osVersion, model, app: isApp, appVersion: isApp ? appM[1] : '', device };
}
// توکن از هدر Authorization یا کوکی نشست خوانده می‌شود (برای سرو فایل‌های خصوصی).
function requestToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7) || null;
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'ft_sess') { try { return decodeURIComponent(v.join('=')); } catch { return null; } }
  }
  return null;
}
function currentUser(req) {
  const uname = getSession(requestToken(req));
  const user = uname && db.users.find((u) => u.username === uname);
  return (user && !user.banned) ? user : null;
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'ft_sess=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(SESSION_TTL / 1000) + secure);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ft_sess=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}
function noteDevice(user, req) {
  if (!user) return;
  const d = clientDevice(req);
  const now = Date.now();
  user.devices = Array.isArray(user.devices) ? user.devices : [];
  const existing = user.devices.find((x) => x && x.ip === d.ip && ((x.browser && x.platform === d.platform && x.browser === d.browser) || (!x.platform && x.device === d.device)));
  if (existing) { Object.assign(existing, d); existing.lastLogin = now; }
  else { user.devices.push(Object.assign({}, d, { lastLogin: now })); }
  if (user.devices.length > 12) user.devices = user.devices.slice(-12);
  user.lastLogin = now;
  saveDB();
}
function hash(pw, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
// امنیت: هش رمز از SHA-256 (سریع/قابل بروت‌فورس) به scrypt ارتقا یافت — بدون شکستن
// سازگاری: هش‌های قدیمی SHA-256 همچنان در verifyPassword پشتیبانی می‌شوند و هر بار
// که رمز جدید ساخته/تغییر کند، از scrypt استفاده می‌شود.
function setPassword(user, plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plain), salt, 32, { N: 16384, r: 8, p: 1 });
  user.salt = salt;
  user.passHash = 'scrypt$' + derived.toString('base64');
  return user.passHash;
}
function verifyPassword(user, plain) {
  if (!user || !user.salt) return false;
  const p = String(plain);
  if (typeof user.passHash === 'string' && user.passHash.startsWith('scrypt$')) {
    try {
      const derived = crypto.scryptSync(p, user.salt, 32, { N: 16384, r: 8, p: 1 });
      const expected = Buffer.from(user.passHash.slice('scrypt$'.length), 'base64');
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch { return false; }
  }
  return user.passHash !== null && user.passHash === hash(p, user.salt);
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
// ارسال پیامک: اگر KAVENEGAR_KEY تنظیم شده باشد از API واقعی استفاده می‌شود
// وگرنه کد فقط در کنسول سرور چاپ می‌شود (حالت توسعه).
async function sendSMS(phone, text) {
  const key = String(process.env.KAVENEGAR_KEY || '').trim();
  const sender = String(process.env.KAVENEGAR_SENDER || '').trim();
  console.log('[SMS] sending to', phone);
  if (!key) { console.log('[SMS] no KAVENEGAR_KEY — dev mode, code:', text); return { ok: true, dev: true }; }
  try {
    const params = new URLSearchParams({ receptor: phone, message: text });
    if (sender) params.set('sender', sender);
    const r = await fetch('https://api.kavenegar.com/v1/' + encodeURIComponent(key) + '/sms/send.json', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json();
    if (r.ok && body.return && body.return.status === 200) { console.log('[SMS] sent OK'); return { ok: true, dev: false }; }
    const errMsg = (body.return && body.return.message) || JSON.stringify(body);
    console.error('[SMS] Kavenegar error:', errMsg);
    return { ok: false, dev: false, smsError: errMsg };
  } catch (e) {
    console.error('[SMS] fetch failed:', e.message);
    return { ok: false, dev: false, smsError: e.message };
  }
}
function publicUser(u) {
  return { username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned, avatar: u.avatar || null, bio: u.bio || '', isPremium: !!u.isPremium, phone: u.phone || null, activeSkin: u.activeSkin || 'default', profileEffect: u.profileEffect || 'off', profileEffectColor: u.profileEffectColor || null, profileBg: u.profileBg || null, blocked: Array.isArray(u.blocked) ? u.blocked : [], hasPassword: !!(u.salt && u.passHash) };
}
// نمای عمومیِ امن برای پخش همگانی: بدون شماره، بدون لیست مسدودشده و بدون flag رمز
function publicSafe(u) {
  const pub = publicUser(u);
  delete pub.phone;
  delete pub.blocked;
  delete pub.hasPassword;
  return pub;
}
const LIMITS = {
  normalUploadMB: 30,
  premiumUploadMB: 100,
  normalBio: 80,
  premiumBio: 200,
};
// سقف نرخ و حجم آپلود در یک بازه یک‌ساعته (خنثی‌سازی مصرف بی‌محدود دیسک)
const uploadUsage = new Map(); // username -> { winStart, count, bytes }
function uploadQuotaOk(username, bytes) {
  const now = Date.now();
  let rec = uploadUsage.get(username);
  if (!rec || now - rec.winStart > 3600 * 1000) { rec = { winStart: now, count: 0, bytes: 0 }; uploadUsage.set(username, rec); }
  if (rec.count >= 60) return false;
  if (rec.bytes + bytes > 400 * 1024 * 1024) return false;
  rec.count += 1; rec.bytes += bytes;
  return true;
}
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
// گفتگوی مجاز بین دو کاربر برای تماس: هر دو موجود/غیرمسدود باشند، یکدیگر را
// بلاک نکرده باشند و یک گفتگوی مشترک (DM موجود یا گروه مشترک) داشته باشند.
// از تماسِ اسپم به غریبه‌ها و جاسوسیِ وضعیت آنلاین جلوگیری می‌کند.
function canInteract(aName, bName) {
  if (!aName || !bName || aName === bName) return false;
  const a = db.users.find((u) => u.username === aName);
  const b = db.users.find((u) => u.username === bName);
  if (!a || !b || a.banned || b.banned) return false;
  if ((Array.isArray(a.blocked) && a.blocked.includes(bName)) || (Array.isArray(b.blocked) && b.blocked.includes(aName))) return false;
  if (db.messages['dm:' + [aName, bName].sort().join('|')]) return true;
  return db.groups.some((g) => memberOf(g, aName) && memberOf(g, bName));
}

const app = express();
if (TRUST_PROXY !== '0') app.set('trust proxy', TRUST_PROXY === '1' ? 1 : TRUST_PROXY);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

// فایل‌های خصوصی (پیوست/آواتار/پس‌زمینه) فقط با نشست معتبر سرو می‌شوند.
// این میدلور قبل از استاتیک ریشه ثبت شده و تمام مسیر /uploads/* را می‌بلعد؛
// بدون auth → 401 و هرگز fallback به استاتیک ریشه نمی‌شود.
const uploadsStatic = express.static(UPLOAD_DIR, {
  setHeaders: (res, p) => {
    const ext = p.slice(p.lastIndexOf('.'));
    if (MIME_BY_EXT[ext]) res.setHeader('Content-Type', MIME_BY_EXT[ext]);
    res.setHeader('Cache-Control', 'no-store');
  },
});
app.use('/uploads', (req, res) => {
  if (!currentUser(req)) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  uploadsStatic(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'خطای داخلی سرور' });
    res.status(404).json({ error: 'پیدا نشد' });
  });
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// ---------- invite landing ----------
function invitePage(refName, ref) {
  const e = String(refName == null ? '' : refName).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const href = ref ? '/?invite=' + encodeURIComponent(ref) : '/';
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>دعوت به VORTEXGRAM</title><style>body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#0a0e1a;color:#e8ecf6;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}*{box-sizing:border-box}.card{background:#12182a;border:1px solid #1f2a44;border-radius:20px;padding:42px 32px;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}.mark{font-size:44px;font-weight:800}.mark b{color:#6ea8fe}h1{font-size:20px;margin:14px 0 6px}p{color:#9aa8c7;font-size:14px;line-height:1.9;margin:0 0 24px;direction:rtl}a.btn{display:inline-block;background:#6ea8fe;color:#002e5c;padding:13px 30px;border-radius:12px;font-weight:800;text-decoration:none;font-size:15px}.sub{font-size:11px;color:#5b6b8f;margin-top:18px}</style></head><body><div class="card"><div class="mark">V<b>ORTEX</b></div><h1>فقط ' + e + ' مونده!</h1><p>' + e + ' شما را به <b>VORTEXGRAM</b> دعوت کرده تا باهم چت کنید. با یک کلیک وارد شو و گفتگو رو شروع کن.</p><a class="btn" href="' + href + '">ورود به VORTEXGRAM</a><div class="sub">پیام‌رسان گیمینگ — سریع، امن و رایگان</div></div></body></html>';
}
app.get('/invite', (req, res) => {
  const ref = String(req.query.ref || '').slice(0, 50).replace('@', '').toLowerCase();
  const u = ref ? db.users.find((x) => x.username.toLowerCase() === ref) : null;
  res.send(invitePage(u ? u.displayName : 'رفیقت', u ? u.username : null));
});

// ---------- auth api ----------
app.post('/api/register', (req, res) => {
  if (!authRateOk('register:' + clientIp(req), 8, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const { username, password } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_ ' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر' });
  const unameLower = username.toLowerCase();
  if (db.users.some((u) => u.username.toLowerCase() === unameLower)) return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده' });

  const phone = normalizePhone((req.body || {}).phone || '');
  const displayName = String((req.body || {}).displayName || '').trim().slice(0, 25) || username;
  const user = { username, displayName, isAdmin: false, banned: false, createdAt: Date.now(), activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null, phone: phone || undefined };
  setPassword(user, String(password));
  db.users.push(user);
  saveDB();
  pushUsers();
  const token = createSession(username);
  setSessionCookie(res, token);
  noteDevice(user, req);
  res.json({ ok: true, token, me: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!authRateOk('login:' + clientIp(req), 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — یک دقیقه صبر کن' });
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !verifyPassword(user, String(password || ''))) {
    return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  }
  if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  const token = createSession(user.username);
  setSessionCookie(res, token);
  noteDevice(user, req);
  res.json({ token, me: publicUser(user) });
});

// خروج از حساب: توکن نشست در سمت سرور باطل می‌شود (نه فقط حذف localStorage)
app.post('/api/logout', auth, (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) sessions.delete(token);
  saveDB();
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- phone + code (Telegram-style) ----------
function genCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

app.post('/api/send-code', async (req, res) => {
  const phone = normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)' });
  if (!authRateOk('send-code:' + phone, 5, 5 * 60 * 1000)) return res.status(429).json({ error: 'کد زیاد درخواست شده — چند دقیقه صبر کن' });
  if (!authRateOk('send-code-ip:' + clientIp(req), 10, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const code = genCode();
  pendingCodes.set(phone, { code, exp: Date.now() + 2 * 60 * 1000 });
  // حالت تست بدون کد: شماره‌ی ثبت‌شده مستقیم وارد می‌شود، شماره‌ی جدید به مرحله‌ی نام می‌رود.
  if (noOtpEnabled) {
    const user = db.users.find((u) => u.phone === phone);
    if (user) {
      if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
      const token = createSession(user.username);
      setSessionCookie(res, token);
      noteDevice(user, req);
      return res.json({ ok: true, token, me: publicUser(user) });
    }
    return res.json({ ok: true, needsName: true });
  }
  const sms = await sendSMS(phone, `کد ورود VORTEXGRAM: ${code}`);
  const out = { ok: true };
  // کد همیشه در همین صفحه نمایش داده می‌شود (ارسال پیامک لازم نیست).
  // فقط با VX_HIDE_CODE=1 و بدون VX_ALLOW_DEV_CODE از پاسخ حذف می‌شود.
  if (devCodeEnabled) out.devCode = code;
  if (sms.smsError) out.note = 'ارسال پیامک با خطا مواجه شد — کد در کنسول سرور چاپ شد';
  res.json(out);
});

app.post('/api/verify-code', (req, res) => {
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  if (!authRateOk('verify-code:' + phone, 10, 5 * 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — چند دقیقه صبر کن' });
  if (!authRateOk('verify-ip:' + clientIp(req), 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const rec = pendingCodes.get(phone);
  if (!noOtpEnabled) {
    if (!rec || rec.exp < Date.now()) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
    if (rec.code !== code) return res.status(401).json({ error: 'کد اشتباه است' });
  }
  const user = db.users.find((u) => u.phone === phone);
  if (user) {
    pendingCodes.delete(phone);
    if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    const token = createSession(user.username);
    setSessionCookie(res, token);
    noteDevice(user, req);
    return res.json({ token, me: publicUser(user) });
  }
  return res.json({ needsName: true });
});

app.post('/api/complete-register', (req, res) => {
  if (!authRateOk('comp-register:' + clientIp(req), 10, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  const displayName = String((req.body || {}).displayName || '').trim();
  let username = String((req.body || {}).username || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  const rec = pendingCodes.get(phone);
  if (!noOtpEnabled) {
    if (!rec || rec.exp < Date.now() || rec.code !== code) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
  }
  const existing = db.users.find((u) => u.phone === phone);
  if (existing) {
    pendingCodes.delete(phone);
    if (existing.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    const token = createSession(existing.username);
    setSessionCookie(res, token);
    noteDevice(existing, req);
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

  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  const isAdmin = adminPhones.includes(phone);

  const user = { username, phone, displayName, salt: null, passHash: null, isAdmin, isPremium: isAdmin, banned: false, createdAt: Date.now(), avatar: null, bio: isAdmin ? 'ادمین سیستم' : '', activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null };
  db.users.push(user);
  pendingCodes.delete(phone);
  saveDB();
  pushUsers();
  const token = createSession(user.username);
  setSessionCookie(res, token);
  noteDevice(user, req);
  return res.json({ ok: true, token, me: publicUser(user), message: isAdmin ? 'حساب ادمین ساخته شد ✅' : 'حساب ساخته شد ✅' });
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const username = getSession(token);
  const user = username && db.users.find((u) => u.username === username);
  if (!user || user.banned) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  setSessionCookie(res, token);
  req.user = user;
  next();
}

app.get('/api/me', auth, (req, res) => {
  const pending = db.renameRequests.some((r) => r.username === req.user.username && r.status === 'pending');
  res.json({ me: publicUser(req.user), renamePending: pending });
});

// ---------- password ----------
// کاربر از داخل اپ رمز عبور می‌سازد یا تغییر می‌دهد (اگر حساب پیامکی ساخته شده باشد salt/passHash خالی است)
app.post('/api/password-change', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'رمز جدید حداقل ۶ کاراکتر باشد' });
  if (req.user.passHash) {
    if (!currentPassword || !verifyPassword(req.user, String(currentPassword || ''))) return res.status(403).json({ error: 'رمز فعلی اشتباه است' });
  }
  setPassword(req.user, String(newPassword));
  saveDB();
  res.json({ ok: true });
});

// ---------- profile ----------
app.post('/api/profile/bio', auth, (req, res) => {
  const bio = String((req.body || {}).bio || '').trim();
  const max = req.user.isPremium ? LIMITS.premiumBio : LIMITS.normalBio;
  if (bio.length > max) return res.status(400).json({ error: `بیو حداکثر ${max} کاراکتر` + (req.user.isPremium ? '' : ' — برای بیشتر پرمیوم شو') });
  req.user.bio = bio;
  saveDB();
  pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, me: publicUser(req.user) });
});

// ---------- profile settings (theme/accent/font/pin/devices) ----------
app.post('/api/profile/settings', auth, (req, res) => {
  const b = req.body || {};
  if (typeof b.theme === 'string') req.user.theme = b.theme.trim().slice(0, 20);
  if (typeof b.accent === 'string') {
    const ac = b.accent.trim().slice(0, 30);
    if (/^[a-zA-Z0-9#_-]+$/.test(ac)) req.user.accent = ac;
  }
  if (typeof b.fontKey === 'string') {
    const fk = b.fontKey.trim().slice(0, 30);
    if (/^[a-zA-Z0-9_-]*$/.test(fk)) req.user.fontKey = fk;
  }
  if (b.fontScale !== undefined) {
    const fs = Number(b.fontScale);
    if (Number.isFinite(fs)) req.user.fontScale = Math.max(11, Math.min(30, fs));
  }
  if (typeof b.pinHash === 'string') req.user.pinHash = b.pinHash.trim().slice(0, 100);
  saveDB();
  res.json({ ok: true, me: publicUser(req.user) });
});

app.get('/api/profile/devices', auth, (req, res) => {
  const d = req.user.devices || [];
  res.json({ devices: d.map((dev) => ({
    ip: dev.ip,
    region: dev.region || '',
    platform: dev.platform || 'web',
    category: dev.category || 'وب',
    browser: dev.browser || '',
    os: dev.os || '',
    osVersion: dev.osVersion || '',
    model: dev.model || '',
    device: dev.device || (dev.category || 'مرورگر'),
    app: !!dev.app,
    appVersion: dev.appVersion || '',
    lastLogin: dev.lastLogin
  })) });
});

// ذخیره تم/اسکین فعال کاربر (برای جلوه‌های پروفایل دیسکوردی)
app.post('/api/skin', auth, (req, res) => {
  const skin = String((req.body || {}).skin || '').trim().slice(0, 30);
  req.user.activeSkin = skin || 'default';
  saveDB();
  res.json({ ok: true, me: publicUser(req.user) });
});

// ذخیره افکت حاله/بال پروفایل (بخش مجزا)
app.post('/api/profile-effect', auth, (req, res) => {
  const effect = String((req.body || {}).effect || 'off').trim().slice(0, 30) || 'off';
  const rawColor = (req.body || {}).color ? String(req.body.color).trim().slice(0, 20) : (req.user.profileEffectColor || null);
  const color = rawColor && /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : null;
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
  broadcastProfile(req.user.username);
  res.json({ ok: true, avatar: req.user.avatar, me: publicUser(req.user) });
});
app.post('/api/profile/background', auth, avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویر مجاز نیست (فقط jpg/png/webp تا ۵MB)' });
  if (req.user.profileBg && req.user.profileBg.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(req.user.profileBg)), () => {});
  }
  req.user.profileBg = '/uploads/' + req.file.filename;
  saveDB(); pushUsers();
  broadcastProfile(req.user.username);
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
  broadcastProfile(req.user.username);
  res.json({ ok: true, profileBg: req.user.profileBg, me: publicUser(req.user) });
});
app.post('/api/profile/avatar/url', auth, (req, res) => {
  const url = setProfileBgSafe((req.body || {}).url);
  if (!url) return res.status(400).json({ error: 'لینک تصویر معتبر نیست' });
  req.user.avatar = url;
  saveDB(); pushUsers();
  broadcastProfile(req.user.username);
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
  broadcastProfile(target.username);
  res.json({ ok: true, user: publicUser(target) });
});

app.post('/api/rename', auth, (req, res) => {
  const newName = String((req.body || {}).displayName || '').trim();
  if (newName.length < 2 || newName.length > 25) return res.status(400).json({ error: 'نام نمایشی باید ۲ تا ۲۵ کاراکتر باشد' });
  if (req.user.isAdmin) {
    req.user.displayName = newName;
    saveDB();
    pushUsers();
    broadcastProfile(req.user.username);
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
  if (approve) broadcastProfile(item.username);
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
  const bannedUsers = db.users.filter((u) => u.banned).length;
  const premiumUsers = db.users.filter((u) => u.isPremium).length;
  const totalUploads = (() => { try { return require('fs').readdirSync(UPLOAD_DIR).length; } catch { return 0; } })();
  res.json({ totalUsers, onlineUsers, totalGroups, totalMessages, msgsToday, bannedUsers, premiumUsers, totalUploads });
});

app.get('/api/admin/users', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ users: db.users.map(publicUser) });
});

// جستجوی کاربران بر اساس آیدی/نام (برای شروع چت و پیدا کردن افراد)
// جستجوی مخاطبین با شماره تلفن (همگام‌سازی مخاطبین گوشی)
app.post('/api/contacts/match', auth, (req, res) => {
  if (!authRateOk('contacts-match:' + req.user.username, 12, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
  if (!phones.length) return res.json({ users: [] });
  const wanted = new Set(phones.map((p) => normalizePhone(p)).filter(Boolean));
  if (!wanted.size) return res.json({ users: [] });
  const out = db.users
    .filter((u) => u.username !== req.user.username && u.phone && wanted.has(normalizePhone(u.phone)) && !u.banned)
    .slice(0, 200)
    .map((u) => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null, isPremium: !!u.isPremium, isAdmin: !!u.isAdmin, online: !!u.online }));
  res.json({ users: out });
});

app.get('/api/users/search', auth, (req, res) => {
  if (!authRateOk('search:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  // ادمین وضعیت banned را می‌بیند؛ بقیه کاربران، کاربرانِ مسدود اصلاً در نتایج نمی‌آیند
  const isAdmin = !!req.user.isAdmin;
  const out = db.users
    .filter((u) => (isAdmin || !u.banned) && (u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)))
    .slice(0, 25)
    .map((u) => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null, isPremium: !!u.isPremium, isAdmin: !!u.isAdmin, online: !!u.online, ...(isAdmin ? { banned: !!u.banned } : {}) }));
  res.json({ users: out });
});

// پروفایل عمومی هر کاربر (برای نمایش جلوه‌های تم در پروفایل)
app.get('/api/user/:username', auth, (req, res) => {
  const uname = String(req.params.username || '').replace('@', '');
  const target = db.users.find((u) => u.username === uname);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const isSelfOrAdmin = req.user.username === target.username || req.user.isAdmin;
  const pu = publicUser(target);
  if (!isSelfOrAdmin) {
    delete pu.phone;
    delete pu.blocked;
    delete pu.hasPassword;
  }
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
  setSessionCookie(res, token);
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
  if ((!scope || scope === 'global') && isOriginalAdmin(target)) return res.status(400).json({ error: 'ادمین اصلی در حالت global قابل تغییر نیست' });
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
  if (target.isAdmin && !isOriginalAdmin(req.user)) return res.status(403).json({ error: 'برای تغییر رمز ادمین‌ها فقط ادمین اصلی اجازه دارد' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'رمز جدید حداقل ۶ کاراکتر باشد' });
  setPassword(target, String(newPassword));
  saveDB();
  kickUser(target.username);
  notifyUser(target.username, { type: 'password-reset' });
  res.json({ ok: true });
});

// ===== واکنش به پیام (reactions) =====
const REACTIONS = ['👍', '❤️', '😂', '🥰', '😡', '👎', '🔥'];
const REACTIONS_SET = new Set(REACTIONS);
function findMsg(roomId, id) {
  const arr = db.messages[roomId] || [];
  return arr.find((m) => m.id === id);
}
app.get('/api/react-config', (req, res) => {
  res.json({ reactions: REACTIONS });
});
// قانون تک‌واکنش: هر کاربر فقط یک واکنش روی هر پیام می‌تواند داشته باشد.
// این منطق single-thread است؛ هیچ دو درخواستی همزمان mutating نمی‌شوند (atomic).
app.post('/api/reactions', auth, (req, res) => {
  if (!authRateOk('react:' + req.user.username, 120, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const { roomId, msgId } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const emoji = String((req.body || {}).emoji || '');
  if (!REACTIONS_SET.has(emoji)) return res.status(400).json({ error: 'واکنش نامعتبر' });
  if (!m.reactions || typeof m.reactions !== 'object' || Array.isArray(m.reactions)) m.reactions = {};
  const u = req.user.username;
  // ۱) کاربر را از همه واکنش‌ها حذف کن و واکنش قبلی او را بیاب
  let previous = null;
  for (const [emojiKey, arr] of Object.entries(m.reactions)) {
    const users = Array.isArray(arr) ? arr.filter((x) => x !== u) : [];
    if (users.length) m.reactions[emojiKey] = users;
    else delete m.reactions[emojiKey];
    if (Array.isArray(arr) && arr.includes(u) && previous === null) previous = emojiKey;
  }
  // ۲) اگر واکنش یکسان بود → حذف (toggle off)؛ در غیر این صورت اضافه/جایگزین کن
  if (previous !== emoji) {
    const list = Array.isArray(m.reactions[emoji]) ? m.reactions[emoji] : [];
    if (!list.includes(u)) m.reactions[emoji] = [...list, u];
  }
  saveDB();
  broadcast({ type: 'message-updated', roomId: rid, id: m.id, message: { reactions: m.reactions } });
  res.json({ ok: true, reactions: m.reactions });
});
// لیست کاربران هر واکنش (برای نمایش «چه کسی واکنش داد») — lazy در کلاینت
app.get('/api/reactions/:msgId', auth, (req, res) => {
  const rid = String((req.query || {}).roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(req.params.msgId || ''));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const out = {};
  for (const [emojiKey, arr] of Object.entries(m.reactions || {})) {
    const list = Array.isArray(arr) ? arr : [];
    if (!list.length) continue;
    out[emojiKey] = list.map((uname) => {
      const u = db.users.find((x) => x.username === uname);
      return { username: uname, displayName: (u && u.displayName) || uname, avatar: (u && u.avatar) || null };
    });
  }
  res.json({ reactions: out });
});

// ===== گزارش پیام =====
app.post('/api/report', auth, (req, res) => {
  if (!authRateOk('report:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const { roomId, msgId, reason } = req.body || {};
  const rid = String(roomId || '').slice(0, 100);
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId || ''));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const row = {
    id: crypto.randomUUID(), roomId: rid, msgId: String(m.id),
    from: String(req.user.username), reason: String(reason || '').slice(0, 240),
    time: Date.now(),
  };
  db.reports = db.reports || [];
  db.reports.push(row);
  saveDB();
  res.json({ ok: true });
});

// ===== فوروارد گروهی پیام =====
// همه‌چیز سمت سرور بررسی می‌شود: دسترسی به مبدأ، دسترسی به مقصد، و تعلقِ هر
// شناسه به اتاق مبدأ. شناسه‌های دلخواه کلاینت قبول نمی‌شوند.
const FORWARD_LIMIT = parseInt(process.env.FORWARD_LIMIT || '50', 10) || 50;
function buildForwardCopy(src, destRoomId, fromUser) {
  const copy = {
    id: crypto.randomUUID(), roomId: destRoomId, from: fromUser.username, fromName: fromUser.displayName,
    kind: src.kind || 'text', time: Date.now(), reactions: {}, silent: false,
    fromAvatar: fromUser.avatar || undefined, fromPremium: !!fromUser.isPremium,
  };
  if (src.content != null) copy.content = String(src.content).slice(0, MAX_MSG_LEN);
  if (String(src.sticker || '')) copy.sticker = String(src.sticker).slice(0, 300);
  if (typeof src.url === 'string') copy.url = src.url;
  if (typeof src.src === 'string') copy.src = src.src;
  if (typeof src.mime === 'string') copy.mime = src.mime.slice(0, 60);
  if (typeof src.name === 'string') copy.name = src.name.slice(0, 80);
  if (typeof src.size === 'number' && src.size > 0) copy.size = src.size;
  if (typeof src.duration === 'number' && src.duration > 0) copy.duration = Math.min(3600, src.duration);
  if (Array.isArray(src.wave)) copy.wave = src.wave.map((v) => Number(v)).filter((v) => Number.isFinite(v)).map((v) => Math.max(0, Math.min(1, v))).slice(0, 100);
  if (Array.isArray(src.album)) copy.album = src.album.slice(0, 10);
  if (src.poll && typeof src.poll === 'object') copy.poll = JSON.parse(JSON.stringify(src.poll));
  if (src.checklist && typeof src.checklist === 'object') copy.checklist = JSON.parse(JSON.stringify(src.checklist));
  copy.fwdFrom = String(src.fwdFrom || src.from || fromUser.username).slice(0, 40);
  // ارجاع ریپلای: به پیامِ اتاقِ مبدأ اشاره می‌کند، در مقصد معتبر نیست؛
  // فقط نام و متن بریده‌شده نگه داشته می‌شود (بدون id تا jump به مکانِ غلط نرود).
  if (src.replyTo && typeof src.replyTo === 'object') {
    copy.replyTo = { id: '', name: String(src.replyTo.name || '').slice(0, 40), snippet: String(src.replyTo.snippet || '').slice(0, 120) };
  }
  return copy;
}
app.post('/api/forward', auth, (req, res) => {
  if (!authRateOk('forward:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'فوروارد زیاد — کمی صبر کن' });
  const body = req.body || {};
  const src = String(body.sourceRoomId || '').slice(0, 100);
  const dst = String(body.destinationRoomId || '').slice(0, 100);
  if (!src || !dst) return res.status(400).json({ error: 'اتاق مبدأ و مقصد الزامی است' });
  if (!canAccess(src, req.user.username)) return res.status(403).json({ error: 'دسترسی به اتاق مبدأ ندارید' });
  if (!canAccess(dst, req.user.username)) return res.status(403).json({ error: 'دسترسی به اتاق مقصد ندارید' });
  if (!canPost(dst, req.user.username)) return res.status(403).json({ error: 'در این اتاق اجازه‌ی ارسال ندارید' });
  if (!Array.isArray(body.messageIds)) return res.status(400).json({ error: 'messageIds باید آرایه باشد' });
  if (!body.messageIds.length) return res.status(400).json({ error: 'هیچ پیامی انتخاب نشده' });
  if (body.messageIds.length > FORWARD_LIMIT) return res.status(400).json({ error: 'حداکثر ' + FORWARD_LIMIT + ' پیام در یک فوروارد' });
  // حذف تکراری‌ها (اولین رخدادِ هر شناسه)
  const ids = [];
  const seen = new Set();
  for (const raw of body.messageIds) {
    const id = String(raw || '').slice(0, 60);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return res.status(400).json({ error: 'شناسه‌های پیام نامعتبر است' });
  const srcArr = db.messages[src] || [];
  const byId = new Map(srcArr.map((m) => [m.id, m]));
  const found = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) return res.status(404).json({ error: 'یکی از پیام‌ها در اتاق مبدأ یافت نشد' });
    found.push(m);
  }
  // ترتیب زمانیِ اصلی (همیشه، و نه ترتیبِ کلیک کاربر) را حفظ می‌کند.
  const ordered = found
    .map((m, i) => ({ m, i }))
    .sort((a, b) => ((a.m.time || 0) - (b.m.time || 0)) || (a.i - b.i))
    .map((x) => x.m);
  if (!db.messages[dst]) db.messages[dst] = [];
  const created = ordered.map((m) => buildForwardCopy(m, dst, req.user));
  db.messages[dst].push(...created);
  if (db.messages[dst].length > HISTORY_LIMIT) db.messages[dst] = db.messages[dst].slice(-HISTORY_LIMIT);
  saveDB();
  // هر پیام با همان رویدادِ realtime موجود پخش می‌شود (بدون کانال دوم)
  for (const m of created) broadcast({ type: 'message', message: m });
  res.json({ ok: true, count: created.length, ids: created.map((m) => m.id) });
});

// ===== سنجاق چندگانه =====
app.post('/api/pin', auth, (req, res) => {
  if (!authRateOk('pin:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const { roomId, msgId } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  if (!db.pinned[rid]) db.pinned[rid] = [];
  const mid = String(msgId || '') || '';
  // سنجاق فقط برای پیام‌های موجود در همان اتاق پذیرفته می‌شود (unpin پیامِ حذف‌شده مجاز است)
  if (db.pinned[rid].indexOf(mid) === -1 && !(db.messages[rid] || []).some((m) => m.id === mid)) return res.status(404).json({ error: 'پیام یافت نشد' });
  const i = db.pinned[rid].indexOf(mid);
  if (i >= 0) db.pinned[rid].splice(i, 1);
  else db.pinned[rid].push(mid);
  saveDB();
  broadcast({ type: 'pinned-updated', roomId: rid, ids: db.pinned[rid] });
  res.json({ ok: true, ids: db.pinned[rid] });
});

// ===== رای دادن به نظرسنجی =====
app.post('/api/poll/vote', auth, (req, res) => {
  if (!authRateOk('poll:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
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
  if (!authRateOk('check:' + req.user.username, 60, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
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
  if (!canPost(rid, req.user.username)) return res.status(403).json({ error: 'در این اتاق اجازه ارسال ندارید' });
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
  if (!authRateOk('link-preview:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
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
  if (!authRateOk('ai:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
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
    // امنیت: در زمانِ ارسال دوباره بررسی می‌شود — کاربر حذف/مسدود شده یا دسترسی/حق
    // ارسالش را از دست داده باشد، پیام تحویل داده نمی‌شود.
    const user = db.users.find((u) => u.username === s.from);
    if (!user || user.banned) continue;
    if (!canAccess(s.roomId, user.username)) continue;
    if (!canPost(s.roomId, user.username)) continue;
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
    reactions: (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {},
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
app.post('/api/upload', auth, (req, res, next) => {
  if (!authRateOk('upload-rate:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'آپلود زیاد — کمی صبر کن' });
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل مجاز نیست یا حجمش زیاد است' });
  const maxMB = req.user.isPremium ? LIMITS.premiumUploadMB : LIMITS.normalUploadMB;
  if (req.file.size > maxMB * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `حداکثر ${maxMB} مگابایت` + (req.user.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ') });
  }
  if (!uploadQuotaOk(req.user.username, req.file.size)) {
    fs.unlink(req.file.path, () => {});
    return res.status(429).json({ error: 'سقف آپلود رسید — یک ساعت دیگر تلاش کن' });
  }
  const m = cleanMime(req.file.mimetype);
  const kind = m.startsWith('image/') ? (m === 'image/gif' ? 'gif' : 'image') : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'file';
  res.json({ url: '/uploads/' + req.file.filename, mime: m, kind, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 80), size: req.file.size });
});

// فایل‌های خصوصی (`/uploads/*`) دیگر استاتیکِ باز نیستند؛ سرو آن توسط
// «uploads gate»ِ ثبت‌شده قبل از استاتیک ریشه انجام می‌شود (بالای فایل).

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
  if (!authRateOk('group-create:' + req.user.username, 10, 60 * 1000)) return res.status(429).json({ error: 'ساخت زیاد — کمی صبر کن' });
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
function previewsFor(username) {
  const out = {};
  const rsAll = readStateOf();
  for (const [rid, arr] of Object.entries(db.messages || {})) {
    if (!rid || !canAccess(rid, username)) continue;
    const last = arr[arr.length - 1];
    if (!last) continue;
    const read = (rsAll[rid] || {})[username] || 0;
    let unread = 0;
    for (const m of arr) { if (m.from !== username && m.time > read) unread++; }
    out[rid] = {
      id: last.id, from: last.from, fromName: last.fromName, kind: last.kind,
      content: last.content, name: last.name, time: last.time, unread,
    };
  }
  return out;
}

app.post('/api/chats/state', auth, (req, res) => {
  const roomId = String((req.body || {}).roomId || '').slice(0, 100);
  if (!canAccess(roomId, req.user.username)) return res.status(403).json({ error: 'دسترسی نداری' });
  const st = chatStateOf(req.user.username);
  const cur = st[roomId] || {};
  const body = req.body || {};
  if (body.key && 'value' in body) {
    const key = String(body.key).slice(0, 60);
    if (key && /^[a-zA-Z0-9._-]+$/.test(key)) cur[key] = !!body.value;
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

// پاک کردن کامل یک چت خصوصی (تاریخچه + سنجاق + وضعیت خواندن + تنظیمات چت)
app.post('/api/chats/delete', auth, (req, res) => {
  const roomId = String((req.body || {}).roomId || '').slice(0, 100);
  if (!canAccess(roomId, req.user.username)) return res.status(403).json({ error: 'دسترسی نداری' });
  if (!roomId.startsWith('dm:')) return res.status(400).json({ error: 'فقط چت خصوصی قابل پاک‌شدن است' });
  delete db.messages[roomId];
  delete db.pinned[roomId];
  const rs = readStateOf();
  delete rs[roomId];
  if (db.chatState && typeof db.chatState === 'object') {
    for (const uname of Object.keys(db.chatState)) if (db.chatState[uname] && typeof db.chatState[uname] === 'object') delete db.chatState[uname][roomId];
  }
  saveDB();
  broadcast({ type: 'room-deleted', roomId });
  res.json({ ok: true });
});

// ---------- websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
wss.maxPayload = 512 * 1024; // جلوگیری از پیام‌های غول‌پیکر (پیش‌فرض ws ~100MB است)

// سخت‌گیری در برقراری اتصال WS: مبدأ (Origin) باید مجاز باشد و هر IP سقف تعداد
// اتصال/نرخ اتصال دارد (خنثی‌سازی مسدودسازی/سواریِ اینفریود).
const wsConnTimes = new Map(); // ip -> [timestamps]
const wsConnCount = new Map(); // ip -> تعداد اتصال باز
const extraOrigins = new Set(String(process.env.VX_ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean));
const MAX_WS_CONNS_PER_IP = 12;
const MAX_USER_SOCKETS = 5;

function originAllowed(req) {
  const origin = req && req.headers && (req.headers.origin || req.headers['sec-websocket-origin']);
  if (!origin) return true; // کلاینت‌های native (Capacitor) Origin نمی‌فرستند
  let host = null;
  try { host = new URL(origin).host; } catch { return false; }
  const allowed = new Set([req.headers.host].filter(Boolean).concat([...extraOrigins]));
  return allowed.has(host);
}
function wsIpAllowed(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = (wsConnTimes.get(ip) || []).filter((t) => now - t < 10000);
  if (arr.length >= 8) { wsConnTimes.set(ip, arr); return false; }
  arr.push(now);
  wsConnTimes.set(ip, arr);
  if ((wsConnCount.get(ip) || 0) >= MAX_WS_CONNS_PER_IP) return false;
  return true;
}

const onUpgrade = (req, socket, head) => {
  if (!originAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  if (!wsIpAllowed(req)) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
  const ip = clientIp(req);
  wsConnCount.set(ip, (wsConnCount.get(ip) || 0) + 1);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.__ip = ip;
    wss.emit('connection', ws, req);
  });
};
server.on('upgrade', onUpgrade);

function wsSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcastRoomOf(obj) {
  if (obj && typeof obj === 'object') {
    if (typeof obj.roomId === 'string') return obj.roomId;
    if (obj.message && typeof obj.message === 'object' && typeof obj.message.roomId === 'string') return obj.message.roomId;
  }
  return null;
}
function broadcast(obj, exceptWs) {
  // حریم خصوصی: فقط کلاینت‌هایی که به اتاق دسترسی دارند باید رویداد را دریافت کنند
  const roomId = broadcastRoomOf(obj);
  for (const [, info] of online) {
    if (info.ws === exceptWs) continue;
    if (roomId !== null && !canAccess(roomId, info.pub.username)) continue;
    wsSend(info.ws, obj);
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
// پخش به‌روزرسانی پروفایل (عکس، نام، بیو) به همه‌ی کاربران آنلاین — بدون نیاز به رفرش.
// فقط داده‌ی امنِ ‌publicSafe ارسال می‌شود (شماره/لیست مسدودی/flag رمز لو نرفته).
function broadcastProfile(username) {
  const user = db.users.find((u) => u.username === username);
  if (!user) return;
  const obj = { type: 'profile-updated', username, user: publicSafe(user) };
  for (const [, info] of online) wsSend(info.ws, obj);
}
function kickUser(username) {
  const info = online.get(username);
  if (info) { wsSend(info.ws, { type: 'kicked' }); info.ws.close(); }
}
function notifyUser(username, obj) {
  const info = online.get(username);
  if (info) wsSend(info.ws, obj);
}

wss.on('connection', (ws, req) => {
  let username = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'auth') {
      const uname = getSession(data.token);
      const user = uname && db.users.find((u) => u.username === uname);
      if (!user || user.banned) return wsSend(ws, { type: 'auth-failed' });
      // سقف تعداد سوکت همزمان برای هر کاربر؛ و جایگزینی سوکت قبلیِ همان کاربر
      const liveSockets = [...online.values()].filter((i) => i.pub.username === uname).length;
      if (liveSockets >= MAX_USER_SOCKETS) return wsSend(ws, { type: 'auth-failed' });
      username = user.username;
      const prev = online.get(username);
      if (prev && prev.ws !== ws) { try { prev.ws.close(); } catch (e) {} }
      online.set(username, { ws, pub: publicUser(user) });
      user.lastSeen = Date.now();
      noteDevice(user, req);
      const myReadState = {};
      const rsAll = readStateOf();
      for (const [rid, readers] of Object.entries(rsAll)) {
        if (canAccess(rid, username)) myReadState[rid] = readers;
      }
      const myPinned = {};
      for (const [rid, ids] of Object.entries(db.pinned || {})) {
        if (canAccess(rid, username)) myPinned[rid] = ids;
      }
      wsSend(ws, {
        type: 'ready', me: publicUser(user), groups: publicGroups(username),
        chatState: chatStateOf(username), readState: myReadState, pinned: myPinned,
        previews: previewsFor(username),
        dmRooms: Object.keys(db.messages).filter((rid) => rid.startsWith('dm:') && rid.slice(3).split('|').includes(username)).slice(0, 200),
      });
      pushUsers();
      broadcastGroups();
      return;
    }
    if (!username) return;

    if (data.type === 'history') {
      if (!wsRateOk(username, 'history', 30, 60 * 1000)) return;
      const roomId = String(data.roomId || '').slice(0, 100);
      if (!canAccess(roomId, username)) return;
      const msgs = (db.messages[roomId] || []).slice(-100).map(enrichMsg);
      wsSend(ws, { type: 'history', roomId, messages: msgs });
      return;
    }

    if (data.type === 'read') {
      if (!wsRateOk(username, 'read', 120, 60 * 1000)) return;
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
        const parts = roomId.slice(3).split('|');
        const other = parts.find((p) => p !== username);
        if (!other || other === username) return wsSend(ws, { type: 'error', text: 'اتاق نامعتبر' });
        if (other !== BOT_USERNAME && !db.users.some((u) => u.username === other)) return wsSend(ws, { type: 'error', text: 'کاربر مقابل یافت نشد' });
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

      // نقل قول (ریپلای) — ارجاع فقط به پیامی از همین گفتگو پذیرفته می‌شود (جلوگیری از reply فراتشکلی)
      let replyTo;
      if (data.replyTo && typeof data.replyTo === 'object' && typeof data.replyTo.id === 'string') {
        const targetId = data.replyTo.id.slice(0, 40);
        const targetArr = db.messages[roomId] || [];
        const targetExists = targetArr.some((x) => x.id === targetId);
        if (targetExists) {
          replyTo = {
            id: targetId,
            name: String(data.replyTo.name || '').slice(0, 40),
            snippet: String(data.replyTo.snippet || '').slice(0, 120),
          };
        }
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
      msg.editedAt = Date.now();
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
      // آرشیو دائمی پیام حذف‌شده (هر چیزی که پاک می‌شود برای آینده ضبط می‌گردد)
      db.messageDeletions = db.messageDeletions || [];
      db.messageDeletions.push({ id: 'del-' + crypto.randomUUID(), roomId, msg: arr[idx], deletedBy: username, at: Date.now() });
      arr.splice(idx, 1);
      saveDB();
      broadcast({ type: 'message-deleted', roomId, id });
      return;
    }

    // ---- call signaling relay ----
    // حریم خصوصی: سیگنال تماس فقط بین کاربرانی که گفتگوی/گروه مشترک دارند و
    // هیچ‌کدام طرف مقابل را مسدود نکرده است relay می‌شود.
    if (['call-offer', 'call-answer', 'call-ice', 'call-end'].includes(data.type)) {
      const targetName = String(data.to || '');
      if (!canInteract(username, targetName)) {
        if (data.type === 'call-offer') wsSend(ws, { type: 'error', text: 'کاربر آنلاین نیست' });
        return;
      }
      const target = online.get(targetName);
      if (!target) {
        if (data.type === 'call-offer') wsSend(ws, { type: 'error', text: 'کاربر آنلاین نیست' });
        return;
      }
      wsSend(target.ws, { type: data.type, from: username, fromName: db.users.find((u) => u.username === username)?.displayName, sdp: data.sdp, candidate: data.candidate });
      return;
    }

    if (data.type === 'typing') {
      const typRoom = String(data.roomId || '').slice(0, 100);
      if (!canAccess(typRoom, username)) return;
      const user = db.users.find((u) => u.username === username);
      broadcast({ type: 'typing', roomId: typRoom, username, name: user ? user.displayName : username, on: data.on !== false }, ws);
    }
  });

  ws.on('close', () => {
    if (ws.__ip) wsConnCount.set(ws.__ip, Math.max(0, (wsConnCount.get(ws.__ip) || 1) - 1));
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

// ---------- 404 / error به‌صورت JSON ----------
// جلوگیری از لو رفتن stack-trace (پیش‌فرض Express) و پاسخِ HTML به مصرف‌کننده‌ی API
app.use('/api', (req, res) => res.status(404).json({ error: 'پیدا نشد' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || (err.type === 'entity.too.large' ? 413 : (err.name === 'MulterError' ? 400 : 500));
  if (status >= 500) console.error('Unhandled error:', err.message);
  res.status(status).json({ error: status >= 500 ? 'خطای داخلی سرور' : (err.message || 'درخواست نامعتبر') });
});

async function start() {
  try {
    const loaded = await dbStore.load();
    if (loaded) {
      db = { ...DEFAULT_DB, ...loaded };
      normalizeGroups();
      try { if (db.sessions) for (const [k, v] of Object.entries(db.sessions)) sessions.set(k, v); } catch (e) {}
    }
  } catch (e) {
    console.error('DB load failed:', e.message);
  }
  server.listen(PORT, () => console.log(`vortexgram on http://localhost:${PORT}`));
  if (Number(process.env.PORT) !== 3000 && process.env.VX_MIRROR === '1') {
    const server2 = http.createServer(app);
    server2.listen(3000, () => console.log('vortexgram mirrored on http://localhost:3000'));
  }
}
start();