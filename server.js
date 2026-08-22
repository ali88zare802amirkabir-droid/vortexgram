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

let db = { users: [], renameRequests: [], messages: {}, groups: [], signupRequests: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { users: [], renameRequests: [], messages: {}, groups: [], signupRequests: [], ...raw };
  if (!Array.isArray(db.groups)) db.groups = [];
  if (!Array.isArray(db.signupRequests)) db.signupRequests = [];
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
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('save failed', e.message); }
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
const loginFails = new Map();

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function createSession(username) {
  const token = newToken();
  sessions.set(token, { username, exp: Date.now() + SESSION_TTL });
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
function publicUser(u) {
  return { username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned, avatar: u.avatar || null, bio: u.bio || '', isPremium: !!u.isPremium };
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
  const ip = req.socket.remoteAddress || '?';
  const rec = loginFails.get(ip) || { count: 0, resetAt: 0 };
  if (rec.count >= 5 && Date.now() < rec.resetAt) {
    return res.status(429).json({ error: 'تلاش‌های زیاد؛ ۱۰ دقیقه دیگر امتحان کن' });
  }
  const { username, password } = req.body || {};
  const pending = db.signupRequests.find((r) => r.username.toLowerCase() === String(username || '').toLowerCase());
  if (pending) return res.status(403).json({ error: 'ثبت‌نامت هنوز توسط ادمین تایید نشده ⏳' });
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || user.passHash !== hash(String(password || ''), user.salt)) {
    rec.count++;
    rec.resetAt = Date.now() + 10 * 60 * 1000;
    loginFails.set(ip, rec);
    return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  }
  if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  loginFails.delete(ip);
  const token = createSession(user.username);
  res.json({ token, me: publicUser(user) });
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

// بررسی وجود کاربر برای افزودن مخاطب با آیدی
app.get('/api/users/exists/:username', auth, (req, res) => {
  const uname = String(req.params.username || '').trim().replace(/^@/, '');
  const u = db.users.find((x) => x.username.toLowerCase() === uname.toLowerCase());
  if (!u) return res.status(404).json({ error: 'کاربری با این آیدی ثبت نشده' });
  res.json({ username: u.username, displayName: u.displayName, avatar: u.avatar || null, isPremium: !!u.isPremium, online: online.has(u.username) });
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
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- groups & channels ----------
function publicGroups(username) {
  return db.groups.map((g) => {
    const me = g.members.find((m) => m.username === username);
    return {
      id: g.id, type: g.type || 'group', name: g.name, owner: g.owner,
      members: g.members.length,
      joined: !!me,
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
      wsSend(ws, { type: 'ready', me: publicUser(user), groups: publicGroups(username) });
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
      const kind = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'file'].includes(data.kind) ? data.kind : 'text';
      const maxLen = (user.isPremium || user.isAdmin) ? MAX_MSG_LEN : 700;
      let content = String(data.content ?? '').slice(0, maxLen);
      if (kind !== 'text' && kind !== 'sticker') {
        if (typeof data.url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(data.url)) return;
      }
      if ((kind === 'text' || kind === 'sticker') && !content.trim()) return;

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
        replyTo,
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
    if (username) { online.delete(username); pushUsers(); }
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
async function maybeAiReply(roomId, user, rawText) {
  try {
    if (!process.env.GROQ_API_KEYS_STR) return;
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