const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ---------- .env ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch (e) { console.warn('.env not found, using environment variables only'); }

const ai = require('./ai');
const aiFeatures = require('./server/ai-features');
const prompts = require('./ai/prompts');
const bots = require('./server/bots');
const botChannels = require('./server/bot-channels');

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
// ==== Phone+OTP (ورود/ثبت‌نام با شماره موبایل) ====
// برای غیرفعال‌سازی موقت (مثل Bug Hunt): true را به جای false بگذار تا
// هر سه مسیر OTP فقط 403 برگردانند — بدون حذف هیچ کدی.
const phoneAuthDisabled = false;
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
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MAX = 60 * 24 * 60 * 60 * 1000;
const MESSAGE_DELETION_RETENTION_DAYS = (() => {
  const days = Number(process.env.MESSAGE_DELETION_RETENTION_DAYS ?? 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
})();

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/x-matroska': '.mka',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'text/plain': '.txt',
};
const MIME_BY_EXT = {};
for (const [k, v] of Object.entries(EXT_BY_MIME)) MIME_BY_EXT[v] = k;
function cleanMime(m) { return String(m || '').split(';')[0].trim(); }

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';
/* ربات در db.users نیست، پس UID ثابت و رزروشده دارد (کمتر از شمارهٔ کاربران واقعی). */
const BOT_UID = 100000;
function botPublicUser() {
  return publicUser({ username: BOT_USERNAME, uid: BOT_UID, displayName: BOT_NAME, isAdmin: false, banned: false });
}

/* ---------- حساب‌های ربات (isBot) ---------- */
/* یک ربات، سطری واقعی در db.users است با isBot:true تا بتواند مالک کانال باشد و
   در فهرست اعضا دیده شود؛ اما هرگز نباید مثل آدم وارد شود. تمام مسیرهای ورود
   (رمز، کد یک‌بارمصرف، تکمیل ثبت‌نام) isBot را رد می‌کنند — نه با پیام خطای
   عمومی، بلکه با پیام صریح تا سوءاستفاده از حساب ربات قابل تشخیص باشد. */
const BOT_LOGIN_ERROR = 'حساب ربات قابل ورود نیست';
function isBotUser(user) { return !!(user && user.isBot); }
/* نام‌هایی که هرگز نباید با ثبت‌نام عمومی گرفته شوند (ربات‌ها + نام‌های حساس) */
const RESERVED_USERNAMES = new Set(['vortex_bot', 'vortex', 'admin', 'administrator', 'root', 'system', 'support', 'official', 'api', 'bot', 'vortexgram']);
function botApiKeys() { return Array.isArray(db.botApiKeys) ? db.botApiKeys : (db.botApiKeys = []); }
/* فروشگاه idempotency در حافظه است: ۲۴ ساعت، سقف ۵۰۰۰ کلید. */
const botIdempotency = bots.createIdempotencyStore();

// فقط ادمین اصلی (شماره ثبت‌شده در ADMIN_PHONES) دسترسی‌های حساس را دارد
function isOriginalAdmin(user) {
  if (!user || !user.isAdmin) return false;
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminPhones.includes(user.phone);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbStore = require('./db');
const APP_VERSION = require('./package.json').version;
const APP_BUILD = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7);
const DEFAULT_DB = { users: [], renameRequests: [], messages: {}, groups: [], pinned: {}, scheduled: [], reports: [], messageDeletions: [], adminAudit: [], rateLimits: { authAttempts: {} } };
let db = { ...DEFAULT_DB };
function purgeExpiredMessageDeletions(now = Date.now()) {
  if (!Array.isArray(db.messageDeletions)) db.messageDeletions = [];
  const cutoff = now - MESSAGE_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = db.messageDeletions.length;
  db.messageDeletions = db.messageDeletions.filter((entry) => {
    if (!entry || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return true;
    return entry.at >= cutoff;
  });
  const removed = before - db.messageDeletions.length;
  if (removed > 0) saveDB();
  return removed;
}
function normalizeGroups() {
  if (!Array.isArray(db.groups)) db.groups = [];
  if (!db.pinned || typeof db.pinned !== 'object') db.pinned = {};
  if (!Array.isArray(db.scheduled)) db.scheduled = [];
  if (!Array.isArray(db.reports)) db.reports = [];
  if (!Array.isArray(db.adminAudit)) db.adminAudit = [];
  if (!db.rateLimits || typeof db.rateLimits !== 'object') db.rateLimits = { authAttempts: {} };
  if (!db.rateLimits.authAttempts || typeof db.rateLimits.authAttempts !== 'object') db.rateLimits.authAttempts = {};
  if (!db.userFlags || typeof db.userFlags !== 'object') db.userFlags = {};
  if (!db.uploadFlags || typeof db.uploadFlags !== 'object') db.uploadFlags = {};
  if (!db.uploadCounters || typeof db.uploadCounters !== 'object') db.uploadCounters = {};
  if (!db.aiUsage || typeof db.aiUsage !== 'object') db.aiUsage = {};
  // فاز ۳: رضایت، کش ترجمه/رونویسی، نشانک‌ها و زمان‌بندی خلاصه
  if (!db.aiConsent || typeof db.aiConsent !== 'object') db.aiConsent = {};
  if (!db.aiTranslations || typeof db.aiTranslations !== 'object') db.aiTranslations = {};
  if (!db.aiTranscripts || typeof db.aiTranscripts !== 'object') db.aiTranscripts = {};
  if (!db.aiDigestText || typeof db.aiDigestText !== 'object') db.aiDigestText = {};
  if (!db.aiDigests || typeof db.aiDigests !== 'object') db.aiDigests = {};
if (!Array.isArray(db.aiDigestSchedules)) db.aiDigestSchedules = [];
  if (!db.savedMessages || typeof db.savedMessages !== 'object') db.savedMessages = {};
  if (!Array.isArray(db.botApiKeys)) db.botApiKeys = [];
  for (const u of (db.users || [])) { if (u.danger !== true && u.danger !== false) u.danger = !!u.danger; }
  for (const g of db.groups) {
    if (!g.type) g.type = 'group';
    if (g.category && !cleanCategory(g.category)) delete g.category;
    g.members = (g.members || []).map((m) => (typeof m === 'string' ? { username: m, role: m === g.owner ? 'owner' : 'member' } : m));
    if (!g.members.some((m) => m.username === g.owner)) g.members.push({ username: g.owner, role: 'owner' });
    /* Telegram-style settings document is created lazily on first use, but
       normalize an existing one here so a hand-edited db.json can never
       leave the panel with an undefined field. */
    if (g.settings && typeof g.settings === 'object' && typeof groupSettings === 'function') {
      try { groupSettings(g); } catch (e) { /* groupSettings uses consts declared later; safe to skip on boot */ }
    }
  }
}

let saveTimer = null;
// NOTE (security): auto-commit/push of data/db.json حذف شد —
//  - کد قبلی به `exec` تعریف‌نشده (child_process هرگز require نشده) ارجاع می‌داد و در عمل
//    هرگز اجرا نمی‌شد؛ dead code بود.
//  - حتی اگر کار می‌کرد، کل تاریخچه چت + توکن‌های نشست را به تاریخچه git push می‌کرد.
// پشتیبان‌گیری manual با `git add data/db.json` همچنان توسط اپراتور ممکن است.

/* ---------- شناسه عددی یکتا برای هر کاربر (UID) ---------- */
/* موقع ساخت اکانت داده می‌شود و اکانت‌های قدیمی موقع بالا آمدن سرور
   به‌صورت خودکار می‌گیرند.
   عددها «رندوم» هستند و پشت‌سرهم نمی‌شوند: یک عدد ۶ رقمی تصادفی انتخاب
   می‌شود و تا وقتی تکراری نباشد دوباره قرعه می‌اندازیم. بازه از ۱۰۰۰۰۱
   شروع می‌شود تا ۱۰۰۰۰۰ (شناسهٔ رزروشدهٔ ربات) اشتباه نشود. */
const UID_MIN = 100001;
const UID_MAX = 999999;
function nextUid() {
  const used = new Set(db.users.map((u) => u.uid));
  for (let i = 0; i < 8000; i++) {
    const n = crypto.randomInt(UID_MIN, UID_MAX + 1);
    if (!used.has(n)) return n;
  }
  /* حالت اضطراری: اگر بازه تقریباً پر شده باشه، خطی دنبال جای خالی می‌گردیم */
  for (let n = UID_MIN; n <= UID_MAX; n++) if (!used.has(n)) return n;
  throw new Error('UID space exhausted');
}
function backfillUids() {
  let changed = false;
  for (const u of db.users) {
    if (typeof u.uid !== 'number' || !Number.isFinite(u.uid) || u.uid < UID_MIN || u.uid > UID_MAX) {
      u.uid = nextUid();
      changed = true;
    }
  }
  // یکتاسازی احتیاطی اگر دستی چیزی خراب شده یا شناسه تکراری شده باشد
  const seen = new Set();
  for (const u of db.users) {
    if (seen.has(u.uid)) { u.uid = nextUid(); changed = true; }
    seen.add(u.uid);
  }
  if (changed) saveDB();
}

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

/* ---------- سهمیهٔ هوش مصنوعی (روزانه، UTC) ----------
   شمارنده‌ها داخل همان شیء db نگه داشته می‌شوند و check/spend کاملاً
   همگام‌اند: هیچ «await» بین بررسی و کسر وجود ندارد، پس دو درخواست
   هم‌زمان نمی‌توانند هر دو «یکی مانده» ببینند و هر دو خرج کنند. */
const aiQuotas = ai.createQuotaStore({
  getState: () => db,
  setState: (patch) => { Object.assign(db, patch); },
  save: saveDB,
});
// نگه‌داشتن فقط ۳ روز از شمارنده‌ها (پاک‌سازی هنگام بالا آمدن و هر ساعت)
setInterval(() => { aiQuotas.prune(3); }, 60 * 60 * 1000).unref();

/* ---------- لایهٔ ایمنی هوش مصنوعی ---------- */
// سقف خروجی مدل (کاراکتر) — قابل تنظیم، پیش‌فرض محافظه‌کارانه
const AI_OUTPUT_MAX = Number(process.env.AI_OUTPUT_MAX_CHARS || 2000);
const AI_NOT_CONFIGURED = 'هوش مصنوعی تنظیم نشده است.';

/**
 * فراخوانی امن مدل: ممیزی ورودی، ساخت پیام‌های fenced، اجرای زنجیرهٔ
 * ارائه‌دهندگان، ممیزی خروجی و بررسی سهمیه.
 *
 * @returns {{ok:true, text}|{ok:false, status, error}}
 *   status 503 = AI تنظیم نشده، 429 = سهمیه تمام، 403 = محتوا مسدود،
 *   502 = پاسخی دریافت نشد.
 */
async function aiComplete({ username, isAdmin, kind, system, data, label, maxTokens, temperature }) {
  const qKind = kind === 'image' ? 'image' : 'text';

  // ۱) ممیزی ورودی کاربر (فارسی + انگلیسی)
  const promptCheck = ai.guardPrompt(data || '');
  if (promptCheck.blocked) return { ok: false, status: 403, error: promptCheck.error, category: promptCheck.category };

  // ۲) سهمیه — پیش از هر تماس با ارائه‌دهنده، به‌صورت همگام
  const check = aiQuotas.check(username, qKind, { isAdmin });
  if (!check.ok) return { ok: false, status: 429, error: ai.quotaError(check.reason), resetsAt: check.resetsAt };

  // ۳) ساخت پیام‌ها: دستورالعمل سیستم جدا، داده‌های غیرقابل‌اعتماد در بلوک fenced
  const messages = ai.safeMessages(system, data, { label, maxChars: Number(process.env.AI_DATA_MAX_CHARS || 4000) });

  // ۴) اجرای زنجیره (ترتیبی با failover فوری + circuit breaker)
  const result = await ai.chatCompletion(messages, {
    maxTokens,
    temperature,
    // سهمیه فقط وقتی کسر می‌شود که واقعاً پاسخی گرفته شده باشد
    onUsage: (res) => aiQuotas.spend(username, qKind, { tokens: (res && res.tokensOut) || 0 }),
  });

  // ۵) تشخیص «اصلاً پیکربندی نشده» از «همه‌ی ارائه‌دهندگان خراب‌اند»
  if (!result) {
    if (!ai.isConfigured()) return { ok: false, status: 503, error: AI_NOT_CONFIGURED };
    return { ok: false, status: 502, error: 'پاسخی از هوش مصنوعی دریافت نشد. کمی بعد دوباره تلاش کنید.' };
  }

  // ۶) ممیزی خروجی + سقف طول + حذف نشت کلید
  const out = ai.guardOutput(result.text, AI_OUTPUT_MAX);
  if (out.blocked) return { ok: false, status: 403, error: out.error, category: out.category };
  if (!out.text) return { ok: false, status: 502, error: 'پاسخی از هوش مصنوعی دریافت نشد.' };
  return { ok: true, text: out.text, provider: result.provider, model: result.model };
}

/* ═══════════════════════════════════════════════════════════════════════
   قابلیت‌های هوش مصنوعی برای کاربر (فاز ۳): خلاصهٔ امروز، ترجمهٔ زنده،
   تبدیل صدا به متن، پیام‌های ذخیره‌شده و خلاصهٔ زمان‌بندی‌شده.
   همهٔ این مسیرها از همان aiComplete() عبور می‌کنند، پس سهمیه و ممیزی
   محتوا دور زده نمی‌شود.
   ═══════════════════════════════════════════════════════════════════════ */

/** ارسال یک پیام ربات به یک اتاق (مانند sendBotToRoom، ولی با فیلدهای دلخواه) */
function aiSendToRoom(roomId, fields) {
  const msg = Object.assign({
    id: crypto.randomUUID(),
    roomId,
    from: BOT_USERNAME,
    fromName: BOT_NAME,
    kind: 'text',
    content: '',
    time: Date.now(),
    reactions: {},
    silent: false,
  }, fields || {});
  if (!msg.content) return null;
  if (!db.messages[roomId]) db.messages[roomId] = [];
  db.messages[roomId].push(msg);
  const over = db.messages[roomId].length - HISTORY_LIMIT;
  if (over > 0) db.messages[roomId].splice(0, over);
  saveDB();
  broadcast({ type: 'message', message: msg });
  return msg;
}

/**
 * دریافت فایل صوتی از مسیر داخلی /uploads/ با عبور از دروازهٔ احراز هویت.
 * یک نشست فعالِ همان کاربر استفاده می‌شود؛ مسیر بیرونی اصلاً پذیرفته نمی‌شود.
 */
async function aiFetchRoomAudio(url, username) {
  if (!/^\/uploads\/[\w.-]+$/.test(String(url || ''))) throw new Error('bad audio url');
  let token = null;
  const now = Date.now();
  for (const [t, s] of sessions) {
    if (s && s.username === username && (s.exp || 0) > now) { token = t; break; }
  }
  if (!token) throw new Error('no active session for audio fetch');
  const base = 'http://127.0.0.1:' + (process.env.PORT || 3000);
  const r = await fetch(base + url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('audio fetch failed ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf;
}

const aiFeat = aiFeatures.createAiFeatures({
  // getter, not a value: `db` is reassigned during boot and the module must
  // always read/write the live object
  getDb: () => db,
  save: saveDB,
  ai,
  aiComplete,
  aiQuotas,
  canAccess, canPost, findGroup, findMsg, memberOf, isGroupAdmin,
  BOT_USERNAME, BOT_NAME,
  sendToRoom: aiSendToRoom,
  transcribeAudio: (buf, name, opts) => ai.transcribe(buf, name, opts),
  fetchRoomAudio: aiFetchRoomAudio,
  env: process.env,
});

// زمان‌بندی خلاصهٔ خودکار: هر دقیقه بررسی می‌شود کدام خلاصه‌ها سررسید شده‌اند.
// اگر همه خراب شدند یا هیچ‌کدام تنظیم نیستند، بی‌صدا رد می‌شود.
if (ai.isConfigured()) {
  setInterval(() => {
    aiFeat.runDueDigests().catch((e) => console.error('ai digest scheduler failed:', e && e.message));
  }, 60 * 1000).unref();
}
// پاک‌سازی دوره‌ای کش ترجمه/رونویسی (۳۰ روزه)
setInterval(() => { try { aiFeat.cachePurge(); } catch (e) {} }, 6 * 60 * 60 * 1000).unref();
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
// rate-limit ساده برای مسیرهای غیرحساس (حافظه‌ای، هر پروسه)
const authAttempts = new Map(); // key -> [timestamps]
function authRateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (authAttempts.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { authAttempts.set(key, arr); return false; }
  arr.push(now);
  authAttempts.set(key, arr);
  return true;
}
// rate-limit ضد بروت‌فورس برای مسیرهای حساس احراز هویت (پشت دیتابیس، مقاوم در برابر ری‌استارت)
function getAuthRateStore() {
  if (!db.rateLimits || typeof db.rateLimits !== 'object') db.rateLimits = { authAttempts: {} };
  if (!db.rateLimits.authAttempts || typeof db.rateLimits.authAttempts !== 'object') db.rateLimits.authAttempts = {};
  return db.rateLimits.authAttempts;
}
function pruneAuthRateStore(now = Date.now()) {
  const store = getAuthRateStore();
  let changed = false;
  const entries = Object.entries(store).sort((a, b) => {
    const aLast = Array.isArray(a[1].hits) && a[1].hits.length ? a[1].hits[a[1].hits.length - 1] : 0;
    const bLast = Array.isArray(b[1].hits) && b[1].hits.length ? b[1].hits[b[1].hits.length - 1] : 0;
    return aLast - bLast;
  });
  for (const [key, record] of entries.slice(0, Math.max(0, entries.length - 2000))) {
    delete store[key];
    changed = true;
  }
  for (const [key, record] of Object.entries(store)) {
    const windowMs = Number(record && record.windowMs) || 60000;
    const hits = Array.isArray(record && record.hits) ? record.hits.filter((t) => now - t < windowMs) : [];
    if (hits.length) {
      if (hits.length !== (record.hits || []).length) {
        store[key] = { hits, windowMs };
        changed = true;
      }
    } else {
      delete store[key];
      changed = true;
    }
  }
  if (changed) saveDB();
  return changed;
}
function authRateDbOk(key, max, windowMs, now = Date.now()) {
  const store = getAuthRateStore();
  const record = store[key] && typeof store[key] === 'object' ? store[key] : { hits: [], windowMs };
  const hits = Array.isArray(record.hits) ? record.hits.filter((t) => now - t < windowMs) : [];
  if (hits.length >= max) {
    store[key] = { hits, windowMs };
    pruneAuthRateStore(now);
    return false;
  }
  hits.push(now);
  store[key] = { hits, windowMs };
  pruneAuthRateStore(now);
  saveDB();
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of authAttempts) {
    const filtered = arr.filter((t) => now - t < 60000);
    if (filtered.length) authAttempts.set(k, filtered); else authAttempts.delete(k);
  }
  for (const [k, arr] of wsConnTimes) {
    const filtered = arr.filter((t) => now - t < 10000);
    if (filtered.length) wsConnTimes.set(k, filtered); else wsConnTimes.delete(k);
  }
  for (const [k, per] of wsRateLimits) {
    let changed = false;
    for (const [key, arr] of Object.entries(per)) {
      const filtered = arr.filter((t) => now - t < 60000);
      if (filtered.length) per[key] = filtered; else { delete per[key]; changed = true; }
    }
    if (changed && !Object.keys(per).length) wsRateLimits.delete(k);
  }
}, 30000);
// بارگذاری نشست‌های ذخیره‌شده تا لاگین پس از ری‌استارت سرور باقی بماند (در start() پس از لود دیتابیس انجام می‌شود)

function normalizeSessionRecord(token, record, now = Date.now()) {
  if (!record || typeof record !== 'object' || typeof record.username !== 'string') {
    sessions.delete(token);
    return null;
  }
  const iat = Number.isFinite(record.iat) ? record.iat : now;
  const maxExp = Number.isFinite(record.maxExp) ? record.maxExp : iat + SESSION_ABSOLUTE_MAX;
  const normalized = { username: record.username, exp: Number(record.exp), iat, maxExp };
  if (typeof record.deviceId === 'string' && record.deviceId) normalized.deviceId = record.deviceId;
  sessions.set(token, normalized);
  return normalized;
}

function normalizeSessions(now = Date.now()) {
  for (const [token, record] of [...sessions.entries()]) normalizeSessionRecord(token, record, now);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function createSession(username, deviceId) {
  const token = newToken();
  const now = Date.now();
  const record = { username, exp: now + SESSION_TTL, iat: now, maxExp: now + SESSION_ABSOLUTE_MAX };
  if (deviceId) record.deviceId = deviceId;
  sessions.set(token, record);
  saveDB();
  return token;
}
function getSession(token, now = Date.now()) {
  const record = normalizeSessionRecord(token, token && sessions.get(token), now);
  if (!record || !(record.exp > now) || !(record.maxExp > now)) {
    if (token) {
      sessions.delete(token);
      saveDB();
    }
    return null;
  }
  return record.username;
}
function revokeUserSessions(username) {
  let revoked = false;
  for (const [token, record] of [...sessions.entries()]) {
    if (record && record.username === username) {
      sessions.delete(token);
      revoked = true;
    }
  }
  if (revoked) saveDB();
  return revoked;
}
/* بستن نشست‌های یک دستگاه مشخص (نشست‌های فعال). */
function revokeDeviceSessions(username, deviceId) {
  let n = 0;
  for (const [token, record] of [...sessions.entries()]) {
    if (record && record.username === username && record.deviceId === deviceId) { sessions.delete(token); n += 1; }
  }
  return n;
}
/* بستن همهٔ نشست‌ها به‌جز دستگاه فعلی. */
function revokeOtherSessions(username, keepDeviceId) {
  let n = 0;
  for (const [token, record] of [...sessions.entries()]) {
    if (record && record.username === username && record.deviceId !== keepDeviceId) { sessions.delete(token); n += 1; }
  }
  return n;
}
function auditAdmin(req, action, target, details = {}) {
  db.adminAudit = Array.isArray(db.adminAudit) ? db.adminAudit : [];
  db.adminAudit.push({
    id: crypto.randomUUID(),
    time: Date.now(),
    actor: req.user.username,
    action,
    target: String(target || ''),
    details,
    ip: clientIp(req),
    userAgent: String((req.headers && req.headers['user-agent']) || '').slice(0, 120),
  });
  if (db.adminAudit.length > 5000) db.adminAudit.splice(0, db.adminAudit.length - 5000);
  saveDB();
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
/* شناسهٔ پایدار دستگاه برای «نشست‌های فعال»: از پلتفرم/مرورگر/سیستم ساخته
   می‌شود (نه IP که عوض می‌شود) تا بتوان یک دستگاه مشخص را از راه دور بست. */
function deviceId(req) {
  const d = clientDevice(req);
  return crypto.createHash('sha1')
    .update([d.platform, d.browser, d.os, d.osVersion, d.model, d.app ? 'app:' + d.appVersion : 'web'].join('|'))
    .digest('hex').slice(0, 16);
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
  d.id = deviceId(req);
  user.devices = Array.isArray(user.devices) ? user.devices : [];
  const existing = user.devices.find((x) => x && (x.id === d.id || (x.ip === d.ip && ((x.browser && x.platform === d.platform && x.browser === d.browser) || (!x.platform && x.device === d.device)))));
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
  return { username: u.username, uid: (typeof u.uid === 'number' ? u.uid : null), displayName: u.displayName, isAdmin: !!u.isAdmin, banned: !!u.banned, avatar: u.avatar || null, bio: u.bio || '', birthday: u.birthday || '', emojiStatus: u.emojiStatus || '', isPremium: !!u.isPremium, phone: u.phone || null, activeSkin: u.activeSkin || 'default', profileEffect: u.profileEffect || 'off', profileEffectColor: u.profileEffectColor || null, profileBg: u.profileBg || null,     danger: !!u.danger,
    restricted: !!u.restricted,
    // نشان ربات: کلاینت با آن برچسب «ربات/AI» را کنار نام نشان می‌دهد
    isBot: !!u.isBot,
    blocked: Array.isArray(u.blocked) ? u.blocked : [], hasPassword: !!(u.salt && u.passHash) };
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
  normalBio: 70,
  premiumBio: 200,
};

const R2_ENABLED = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
let r2 = null;
if (R2_ENABLED) {
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}
console.log('[storage] media store:', R2_ENABLED ? 'Cloudflare R2 (direct URLs, survives restarts)' : 'local filesystem public/uploads (NOT durable on Render)');
if (!R2_ENABLED && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
  console.warn('*** WARNING: R2 not configured — uploaded images/voice/avatars will be lost on every Render deploy/restart. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (see .env.example). ***');
}
function r2Key(filename) { return 'uploads/' + filename; }
async function r2Upload(filePath, key, contentType) {
  if (!r2) return null;
  const body = fs.createReadStream(filePath);
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  // Base عمومی شیءها (r2.dev یا دامنه سفارشی)؛ بدون آن URL مستقیم نمی‌سازیم تا
  // cliente از مسیر /uploads/... (که auth و r2Proxy دارد) استفاده کند.
  const pubBase = (process.env.R2_PUBLIC_BASE || '').trim().replace(/\/+$/, '');
  return pubBase ? (pubBase + '/' + key) : null;
}
/* آیا ذخیره‌سازیِ رسانه بادوام است یا زودگذر؟
   مستقیماً از R2 استفاده می‌کنیم: URLِ مستقیمِ R2 ذخیره می‌شود تا حتی
   وقتی سرور ما در Render خاموش/دوباره‌سازی می‌شود، لینک‌ها کار کنند.
   در حالتی که R2 تنظیم نشده باشد، به `/uploads/...` (دیسک کانتینر)
   برمی‌گردیم — مناسب توسعهٔ محلی، ولی روی Render پایدار نیست. */
async function durableUpload(filePath, filename, contentType) {
  let finalUrl = '/uploads/' + filename;
  if (R2_ENABLED) {
    try {
      const r2Url = await r2Upload(filePath, r2Key(filename), contentType);
      if (r2Url) finalUrl = r2Url;
    } catch (e) {
      console.error('R2 upload failed, falling back to local:', e && e.message);
    }
  }
  return finalUrl;
}
async function r2Proxy(key, res, req) {
  if (!r2) return false;
  try {
    const rangeHeader = (req && req.headers && req.headers.range) || '';
    const cmdOpts = { Bucket: process.env.R2_BUCKET, Key: key };
    if (rangeHeader) cmdOpts.Range = rangeHeader;
    const cmd = new GetObjectCommand(cmdOpts);
    const data = await r2.send(cmd);
    res.setHeader('Content-Type', data.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
    if (data.ContentRange) res.setHeader('Content-Range', data.ContentRange);
    if (data.ContentLength != null) res.setHeader('Content-Length', data.ContentLength);
    if (rangeHeader && data.ContentRange) res.status(206);
    data.Body.pipe(res);
    return true;
  } catch (e) {
    return false;
  }
}

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
function _todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function uploadDailyCount(username) { const c = db.uploadCounters && db.uploadCounters[username]; const k = _todayKey(); return (c && c.date === k) ? (c.count || 0) : 0; }
function incUploadDaily(username) { const k = _todayKey(); db.uploadCounters = db.uploadCounters || {}; let c = db.uploadCounters[username]; if (!c || c.date !== k) c = { date: k, count: 0 }; c.count = (c.count || 0) + 1; db.uploadCounters[username] = c; saveDB(); }
function restrictedFlagsFor(username) { return (db.userFlags && db.userFlags[username]) || null; }
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
    /* privacy.messages: who can message me — enforced server-side */
    if (otherUser) {
      const priv = (otherUser.settings && otherUser.settings.privacy) || {};
      const tier = (priv.messages !== undefined) ? priv.messages : (SETTINGS_DEFAULTS.privacy.messages || 'everybody');
      const alwaysShare = Array.isArray(priv.alwaysShare) ? priv.alwaysShare : [];
      const neverShare = Array.isArray(priv.neverShare) ? priv.neverShare : [];
      if (neverShare.includes(username)) return false;
      if (alwaysShare.includes(username)) return true;
      if (tier === 'nobody') return false;
      if (tier === 'contacts' && !relatesTo(username, other)) return false;
    }
    return true;
  }
  if (roomId.startsWith('group:')) {
    const g = findGroup(roomId.slice(6));
    return !!g && !!memberOf(g, username);
  }
  return false;
}
/* ── privacy: single source of truth ──────────────────────────────────────
   Every API/WS point that exposes another user's data must go through canSee().
   A "contact" relationship is defined server-side (no client trust):
     * either side lists the other in their explicit contacts array, or
     * they already share a DM conversation.
   Tiers: everybody (default) | contacts | nobody. */
function dmRoomBetween(a, b) {
  if (!a || !b) return null;
  for (const rid of Object.keys(db.messages || {})) {
    if (!rid.startsWith('dm:')) continue;
    const parts = rid.slice(3).split('|');
    if (parts.includes(a) && parts.includes(b)) return rid;
  }
  return null;
}
function hasContact(u, name) { return !!(u && Array.isArray(u.contacts) && u.contacts.includes(name)); }
function relatesTo(a, b) {
  if (!a || !b || a === b) return false;
  const ua = db.users.find((u) => u.username === a);
  const ub = db.users.find((u) => u.username === b);
  if (hasContact(ua, b) || hasContact(ub, a)) return true;
  return !!dmRoomBetween(a, b);
}
/* key ∈ {'lastSeen','profilePhoto','bio','phone','birthday','forwardLink', ...}.
   viewerName is the requester ('' / null = anonymous → treated as a stranger). */
function canSee(viewerName, owner, key) {
  if (!owner) return false;
  if (viewerName && viewerName === owner.username) return true;
  const priv = (owner.settings && owner.settings.privacy) || {};
  const alwaysShare = Array.isArray(priv.alwaysShare) ? priv.alwaysShare : [];
  const neverShare = Array.isArray(priv.neverShare) ? priv.neverShare : [];
  if (viewerName && neverShare.includes(viewerName)) return false;
  if (viewerName && alwaysShare.includes(viewerName)) return true;
  let tier = priv[key];
  if (tier === undefined) tier = SETTINGS_DEFAULTS.privacy[key]; /* unset → documented default (e.g. phone=nobody) */
  if (tier === 'nobody') return false;
  if (tier === 'contacts') return relatesTo(viewerName, owner.username);
  return true; /* 'everybody' or unset default */
}
/* Read receipts are per-reader: a viewer may not see a reader's receipt when the
   reader turned read receipts off. Returns a filtered copy of a read-state map. */
function readReceiptsEnabled(username) {
  const u = db.users.find((x) => x.username === username);
  const p = (u && u.settings && u.settings.privacy) || {};
  return p.readReceipts !== false;
}
function filterReadStateFor(viewerName, rs) {
  const out = {};
  for (const [rid, readers] of Object.entries(rs || {})) {
    const kept = {};
    for (const [reader, time] of Object.entries(readers || {})) {
      if (reader === viewerName || readReceiptsEnabled(reader)) kept[reader] = time;
    }
    if (Object.keys(kept).length) out[rid] = kept;
  }
  return out;
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
  /* سیاست Referrer: نه کاملاً باز، نه بسته.
     ارسال نشانی کامل مسیرهای داخلی به سرویس‌های بیرونی لازم نیست و نشت
     اطلاعات می‌دهد؛ اما «no-referrer» برای سرویس‌هایی مثل کاشی نقشه خطاست:
     سیاست استفادهٔ آن‌ها معرفی کردن اپ را الزامی می‌کند و نبودِ Referer
     باعث مسدود شدن (403) می‌شود. 'strict-origin-when-cross-origin' فقط مبدأ
     را می‌فرستد: هم حریم خصوصی حفظ می‌شود، هم اپ قابل شناسایی است. */
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // 'blob:' در connect-src لازم است: کش دائمی رسانه‌ها (IndexedDB) blob URL را با
  // fetch می‌خواند و بدون آن مرورگر درخواست را به‌خاطر CSP بلاک می‌کند.
  // CSP کامل: فقط same-origin. فونت‌ها self-host شده‌اند (public/fonts) پس
  // هیچ CDN خارجی لازم نیست — و همان چیزی است که «حریم خصوصی» را واقعی می‌کند.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' blob: ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
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
    res.setHeader('Accept-Ranges', 'bytes');
    // نام هر فایل آپلودشده یک شناسه‌ی تصادفی یکتا دارد و محتوای یک URL هرگز تغییر
    // نمی‌کند؛ پس پاسخ را بلندمدت در کشِ همین مرورگر (private) نگه می‌داریم تا
    // بازدید/دانلود دوباره، فایل را از شبکه دریافت نکند. private یعنی هرگز در
    // کشِ مشترکِ بین‌کاربری (پروکسی/CDN) قرار نمی‌گیرد.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  },
});
app.use('/uploads', async (req, res) => {
  if (!currentUser(req)) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  const filename = req.path.slice(1);
  if (!filename) return res.status(404).json({ error: '???? ???' });
  const _cu = currentUser(req);
  if (db.uploadFlags && db.uploadFlags[filename] && !(_cu && _cu.isAdmin)) return res.status(403).json({ error: '?????????? ?????? ???? ?? ??? ????? ??' });
  const key = r2Key(filename);
  if (R2_ENABLED) {
    const ok = await r2Proxy(key, res, req);
    if (ok) return;
  }
  uploadsStatic(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'خطای داخلی سرور' });
    res.status(404).json({ error: 'پیدا نشد' });
  });
});

// ---------- public landing (/) + messenger (/app) ----------
// صفحه‌ی عمومی: دامنه‌ی سایت -> لندینگ
// پیام‌رسان همچنان در /app در دسترس است (PWA، دعوت‌نامه و اندروید).
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/app', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// لینک دعوت گروه/کانال: اپ را باز می‌کند و اپ `vx_group_invite` را از
// مسیر می‌خواند تا پس از لاگین، به‌صورت خودکار عضو شود.
app.get('/join/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/landing', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/privacy', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => { const u = String(res.req.originalUrl || ''); if (u.indexOf('?v=') >= 0) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); else if (u.indexOf('/img/') === 0) res.setHeader('Cache-Control', 'public, max-age=86400'); else res.setHeader('Cache-Control', 'no-store'); } }));

// ---------- invite landing ----------
function invitePage(refName, ref) {
  const e = String(refName == null ? '' : refName).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const href = ref ? '/app?invite=' + encodeURIComponent(ref) : '/app';
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>دعوت به VORTEXGRAM</title><style>body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#0a0e1a;color:#e8ecf6;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}*{box-sizing:border-box}.card{background:#12182a;border:1px solid #1f2a44;border-radius:20px;padding:42px 32px;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}.mark{font-size:44px;font-weight:800}.mark b{color:#6ea8fe}h1{font-size:20px;margin:14px 0 6px}p{color:#9aa8c7;font-size:14px;line-height:1.9;margin:0 0 24px;direction:rtl}a.btn{display:inline-block;background:#6ea8fe;color:#002e5c;padding:13px 30px;border-radius:12px;font-weight:800;text-decoration:none;font-size:15px}.sub{font-size:11px;color:#5b6b8f;margin-top:18px}</style></head><body><div class="card"><div class="mark">V<b>ORTEX</b></div><h1>فقط ' + e + ' مونده!</h1><p>' + e + ' شما را به <b>VORTEXGRAM</b> دعوت کرده تا باهم چت کنید. با یک کلیک وارد شو و گفتگو رو شروع کن.</p><a class="btn" href="' + href + '">ورود به VORTEXGRAM</a><div class="sub">پیام‌رسان گیمینگ — سریع، امن و رایگان</div></div></body></html>';
}
app.get('/invite', (req, res) => {
  const ref = String(req.query.ref || '').slice(0, 50).replace('@', '').toLowerCase();
  const u = ref ? db.users.find((x) => x.username.toLowerCase() === ref) : null;
  res.send(invitePage(u ? u.displayName : 'رفیقت', u ? u.username : null));
});

// ---------- auth api ----------
app.post('/api/register', (req, res) => {
  if (!authRateDbOk('register:' + clientIp(req), 8, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const { username, password } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_ ' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر' });
  const unameLower = username.toLowerCase();
  if (db.users.some((u) => u.username.toLowerCase() === unameLower)) return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده' });
  // نام کاربری ربات‌ها رزرو است تا کسی خود را جای ربات جا بزند
  if (RESERVED_USERNAMES.has(unameLower)) return res.status(409).json({ error: 'این نام کاربری رزرو شده است' });

  const phone = normalizePhone((req.body || {}).phone || '');
  const displayName = String((req.body || {}).displayName || '').trim().slice(0, 25) || username;
  const user = { username, uid: nextUid(), displayName, isAdmin: false, banned: false, createdAt: Date.now(), activeSkin: 'default', profileEffect: 'off', profileEffectColor: null, profileBg: null, phone: phone || undefined };
  setPassword(user, String(password));
  db.users.push(user);
  saveDB();
  pushUsers();
  const token = createSession(username, deviceId(req));
  setSessionCookie(res, token);
  noteDevice(user, req);
  res.json({ ok: true, token, me: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!authRateDbOk('login:' + clientIp(req), 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — یک دقیقه صبر کن' });
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !verifyPassword(user, String(password || ''))) {
    return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است' });
  }
  if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  // ربات‌ها کلید API دارند، نه رمز عبور؛ ورود با رمز برایشان همیشه رد می‌شود
  if (isBotUser(user)) return res.status(403).json({ error: BOT_LOGIN_ERROR });
  const token = createSession(user.username, deviceId(req));
  setSessionCookie(res, token);
  noteDevice(user, req);
  res.json({ token, me: publicUser(user) });
});

// خروج از حساب: نشست Bearer و نشست کوکی، هر دو سمت سرور باطل می‌شوند (نه فقط حذف localStorage)
app.post('/api/logout', auth, (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const cookieToken = cookieSessionToken(req);
  if (token) sessions.delete(token);
  if (cookieToken) sessions.delete(cookieToken);
  saveDB();
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- phone + code (Telegram-style) ----------
function genCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

app.post('/api/send-code', async (req, res) => {
  if (phoneAuthDisabled) return res.status(403).json({ error: 'ورود با شماره موبایل موقتاً غیرفعال است — از نام کاربری و رمز عبور استفاده کن', disabled: 'phone-otp' });
  const phone = normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)' });
  if (!authRateDbOk('send-code:' + phone, 5, 5 * 60 * 1000)) return res.status(429).json({ error: 'کد زیاد درخواست شده — چند دقیقه صبر کن' });
  if (!authRateDbOk('send-code-ip:' + clientIp(req), 10, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const code = genCode();
  pendingCodes.set(phone, { code, exp: Date.now() + 2 * 60 * 1000 });
  // حالت تست بدون کد: شماره‌ی ثبت‌شده مستقیم وارد می‌شود، شماره‌ی جدید به مرحله‌ی نام می‌رود.
  if (noOtpEnabled) {
    const user = db.users.find((u) => u.phone === phone);
    if (user) {
      if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
      if (isBotUser(user)) return res.status(403).json({ error: BOT_LOGIN_ERROR });
      const token = createSession(user.username, deviceId(req));
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
  if (phoneAuthDisabled) return res.status(403).json({ error: 'ورود با شماره موبایل موقتاً غیرفعال است — از نام کاربری و رمز عبور استفاده کن', disabled: 'phone-otp' });
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  if (!authRateDbOk('verify-code:' + phone, 10, 5 * 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — چند دقیقه صبر کن' });
  if (!authRateDbOk('verify-ip:' + clientIp(req), 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const rec = pendingCodes.get(phone);
  if (!noOtpEnabled) {
    if (!rec || rec.exp < Date.now()) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
    if (rec.code !== code) return res.status(401).json({ error: 'کد اشتباه است' });
  }
  const user = db.users.find((u) => u.phone === phone);
  if (user) {
    pendingCodes.delete(phone);
    if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    if (isBotUser(user)) return res.status(403).json({ error: BOT_LOGIN_ERROR });
    const token = createSession(user.username, deviceId(req));
    setSessionCookie(res, token);
    noteDevice(user, req);
    return res.json({ token, me: publicUser(user) });
  }
  return res.json({ needsName: true });
});

app.post('/api/complete-register', (req, res) => {
  if (phoneAuthDisabled) return res.status(403).json({ error: 'ورود با شماره موبایل موقتاً غیرفعال است — از نام کاربری و رمز عبور استفاده کن', disabled: 'phone-otp' });
  if (!authRateDbOk('comp-register:' + clientIp(req), 10, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const phone = normalizePhone((req.body || {}).phone);
  const code = String((req.body || {}).code || '');
  const displayName = String((req.body || {}).displayName || '').trim();
  let username = String((req.body || {}).username || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره نامعتبر' });
  if (!authRateDbOk('comp-register-phone:' + phone, 10, 5 * 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — چند دقیقه صبر کن' });
  const rec = pendingCodes.get(phone);
  if (!noOtpEnabled) {
    if (!rec || rec.exp < Date.now() || rec.code !== code) return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده' });
  }
  const existing = db.users.find((u) => u.phone === phone);
  if (existing) {
    pendingCodes.delete(phone);
    if (existing.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    if (isBotUser(existing)) return res.status(403).json({ error: BOT_LOGIN_ERROR });
    const token = createSession(existing.username, deviceId(req));
    setSessionCookie(res, token);
    noteDevice(existing, req);
    return res.json({ token, me: publicUser(existing) });
  }
  if (displayName.length < 2) return res.status(400).json({ error: 'نام نمایشی حداقل ۲ حرف' });
if (username) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_' });
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'این نام کاربری قبلاً گرفته شده' });
    if (RESERVED_USERNAMES.has(username.toLowerCase())) return res.status(409).json({ error: 'این نام کاربری رزرو شده است' });
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
  const token = createSession(user.username, deviceId(req));
  setSessionCookie(res, token);
  noteDevice(user, req);
  return res.json({ ok: true, token, me: publicUser(user), message: isAdmin ? 'حساب ادمین ساخته شد ✅' : 'حساب ساخته شد ✅' });
});

function cookieSessionToken(req) {
  const c = (req && req.headers && req.headers.cookie) || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'ft_sess') { try { return decodeURIComponent(v.join('=')) || null; } catch { return null; } }
  }
  return null;
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const username = getSession(token);
  const user = username && db.users.find((u) => u.username === username);
  if (!user || user.banned) return res.status(401).json({ error: 'احراز هویت نامعتبر' });
  // نشست متحرک با سقف مطلق: هر فعالیت، عمر نشست را جلو می‌برد، اما هرگز از ۶۰ روز پس از صدور بیشتر نمی‌شود
  const s = token && sessions.get(token);
  if (s) {
    s.exp = Math.min(Date.now() + SESSION_TTL, Number.isFinite(s.maxExp) ? s.maxExp : Infinity);
    saveDB();
  }
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
  revokeUserSessions(req.user.username);
  saveDB();
  kickUser(req.user.username);
  auditAdmin(req, 'password-change', req.user.username, {});
  res.json({ ok: true, reauthRequired: true });
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

// Slice A — birthday. Free-form text stored as 'YYYY-MM-DD' (validated) or ''.
app.post('/api/profile/birthday', auth, (req, res) => {
  const raw = String((req.body || {}).birthday || '').trim();
  if (raw === '') { req.user.birthday = ''; saveDB(); pushUsers(); broadcastProfile(req.user.username); return res.json({ ok: true, me: publicUser(req.user) }); }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return res.status(400).json({ error: 'تاریخ تولد را به شکل YYYY-MM-DD وارد کن' });
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const now = new Date();
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return res.status(400).json({ error: 'تاریخ نامعتبر است' });
  if (y < 1900 || dt.getTime() > now.getTime()) return res.status(400).json({ error: 'تاریخ نامعتبر است' });
  req.user.birthday = raw;
  saveDB();
  pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, me: publicUser(req.user) });
});

// Slice A — emoji status (a single short emoji shown next to the name). '' clears it.
app.post('/api/profile/emoji-status', auth, (req, res) => {
  const raw = String((req.body || {}).emoji || '').trim().slice(0, 16);
  if (raw === '') { req.user.emojiStatus = ''; saveDB(); pushUsers(); broadcastProfile(req.user.username); return res.json({ ok: true, me: publicUser(req.user) }); }
  /* Keep it an emoji-ish glyph sequence: no letters/digits/control chars. */
  if (/[\p{L}\p{N}]/u.test(raw) || !/\p{Extended_Pictographic}/u.test(raw)) return res.status(400).json({ error: 'فقط ایموجی مجاز است' });
  req.user.emojiStatus = raw;
  saveDB();
  pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, me: publicUser(req.user) });
});

// ---------- profile settings (theme/accent/font/pin/devices) ----------
/* ── ساختار تنظیمات کاربر (فاز ۵E) ────────────────────────────────────────
   user.settings یک سند پراکنده است: فقط مسیرهایی که کاربر واقعاً تغییر داده
   ذخیره می‌شوند؛ پیش‌فرض‌ها در «نمای خواندن» اعمال می‌شوند و هرگز نوشته
   نمی‌شوند تا حساب دست‌نخورده بایت‌به‌بایت برگردد. هر مقدار پیش از ادغام از
   یک لیست سفید (enum/bool/accent) رد می‌شود، پس هیچ کلید یا رشتهٔ آزادی
   ذخیره نمی‌شود. */
const SETTINGS_DEFAULTS = {
  privacy: {
    lastSeen: 'everybody', profilePhoto: 'everybody', bio: 'everybody', birthday: 'contacts', phone: 'nobody',
    readReceipts: true, presence: true, addToGroups: 'everybody', calls: 'everybody',
    forwards: 'everybody', groups: 'everybody', voiceMessages: 'everybody',
    messages: 'everybody', typing: true,
    alwaysShare: [], neverShare: [],
  },
  notifications: {
    enabled: true, sound: true, preview: true, privateMessages: true, groupMessages: true,
    channelMessages: true, reactions: true, badgeCount: true, desktop: true, calls: true, inAppSound: true,
  },
  data: {
    autoDownloadPhotos: true, autoDownloadVideos: false, saveData: false,
    autoDownloadOnMobile: false, autoDownloadOnWifi: true, maxSizeMB: 20, saveToGallery: false, proxy: '',
  },
  appearance: {
    theme: 'night', accent: 'blue', accentCustom: '', bubbleRadius: 'round', bubbleStyle: 'classic',
    reduceGlass: false, aurora: true, animations: true, glass: false, density: 'comfortable',
    textScale: 'normal', font: 'default', uiRadius: 'round', wallpaper: 'none',
    wallBlur: 0, wallBright: 1, wallMotion: false, themeAuto: 'off', power: 'auto',
  },
  language: { code: 'fa', translateEnabled: false, autoTranslate: false },
  chat: {
    showTyping: true, enterToSend: true, autoEmoji: true, linkPreview: true, translateMessages: false,
    markdown: true, autoArchive: false, archiveDays: 30, folderBehavior: 'all', swipeAction: 'reply',
    listView: 'two', shareDirect: true, spacingUnits: 'normal', inAppBrowser: false, autoNight: false,
    mediaTapToNext: false, raiseToListen: true, raiseToSpeak: false, pauseMusicRecord: true,
    pauseMusicMedia: true, internalMic: false, shortcutSend: 'enter', shortcutRead: 'enter',
  },
  security: { passcode: false, autoLock: 'off', twoFactor: false, twoFactorHint: '', twoFactorRecoveryEmail: '', deleteMessages: 'off', inactiveDelete: 'off', sessionLimit: 0 },
  calls: { micInput: 'auto', speaker: 'auto', camera: 'front', noiseSuppression: true, p2p: true, ringtone: 'default', quality: 'hd' },
  premium: { customStickers: false, customReactions: false, biggerFiles: false, customNameColor: false },
  ai: { enabled: true },
};
const SETTINGS_ENUMS = {
  'privacy.lastSeen': ['everybody', 'contacts', 'nobody'],
  'privacy.profilePhoto': ['everybody', 'contacts', 'nobody'],
  'privacy.bio': ['everybody', 'contacts', 'nobody'],
  'privacy.birthday': ['everybody', 'contacts', 'nobody'],
  'privacy.phone': ['everybody', 'contacts', 'nobody'],
  'privacy.addToGroups': ['everybody', 'contacts', 'nobody'],
  'privacy.calls': ['everybody', 'contacts', 'nobody'],
  'privacy.forwards': ['everybody', 'contacts', 'nobody'],
  'privacy.groups': ['everybody', 'contacts', 'nobody'],
  'privacy.voiceMessages': ['everybody', 'contacts', 'nobody'],
  'privacy.messages': ['everybody', 'contacts', 'nobody'],
  /* Canonical themes + legacy names (normalized to canonical on write). */
  'appearance.theme': ['day', 'night', 'dark', 'cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light', 'ios', 'amoled'],
  'appearance.bubbleRadius': ['sharp', 'compact', 'round', 'pill'],
  'appearance.bubbleStyle': ['classic', 'accent', 'glass'],
  'appearance.density': ['compact', 'comfortable', 'spacious'],
  'appearance.textScale': ['small', 'normal', 'large', 'xlarge'],
  'appearance.font': ['default', 'mono', 'round', 'vazir'],
  'appearance.uiRadius': ['sharp', 'compact', 'round', 'pill'],
  'appearance.wallpaper': ['none', 'grad-ocean', 'grad-sunset', 'grad-aurora', 'grad-forest', 'pattern-dots', 'pattern-grid', 'pattern-bubbles'],
  'appearance.themeAuto': ['off', 'system', 'schedule'],
  'appearance.power': ['auto', 'full', 'saver'],
  'language.code': ['fa', 'en', 'ar', 'tr', 'ru'],
  'chat.folderBehavior': ['all', 'unread', 'groups', 'channels', 'folders'],
  'chat.swipeAction': ['reply', 'pin', 'archive', 'delete', 'read', 'none'],
  'chat.listView': ['two', 'three', 'compact'],
  'chat.spacingUnits': ['narrow', 'normal', 'wide'],
  'chat.shortcutSend': ['enter', 'ctrlEnter'],
  'chat.shortcutRead': ['enter', 'ctrlEnter', 'off'],
  'security.autoLock': ['off', '1m', '5m', '30m', '1h'],
  'security.deleteMessages': ['off', '1d', '7d', '30d', '1y'],
  'security.inactiveDelete': ['off', '1m', '3m', '6m', '12m'],
  'calls.micInput': ['auto', 'builtin', 'external'],
  'calls.speaker': ['auto', 'system', 'earpiece'],
  'calls.camera': ['front', 'back'],
  'calls.ringtone': ['default', 'silent', 'custom'],
  'calls.quality': ['sd', 'hd', 'fullhd'],
};
/* Legacy theme names are accepted from older clients but stored canonically. */
const THEME_MIGRATE = {
  cyber: 'night', midnight: 'dark', 'midnight-rose': 'dark', matrix: 'dark',
  synthwave: 'night', sunset: 'night', forest: 'night', light: 'day', ios: 'day', amoled: 'dark',
};
const SETTINGS_BOOLS = [
  'privacy.readReceipts', 'privacy.presence', 'privacy.typing',
  'notifications.enabled', 'notifications.sound', 'notifications.preview',
  'notifications.privateMessages', 'notifications.groupMessages', 'notifications.channelMessages',
  'notifications.reactions', 'notifications.badgeCount', 'notifications.desktop',
  'notifications.calls', 'notifications.inAppSound',
  'data.autoDownloadPhotos', 'data.autoDownloadVideos', 'data.saveData',
  'data.autoDownloadOnMobile', 'data.autoDownloadOnWifi', 'data.saveToGallery',
  'appearance.reduceGlass', 'appearance.aurora', 'appearance.animations',
  'appearance.glass', 'appearance.wallMotion',
  'language.translateEnabled', 'language.autoTranslate',
  'chat.showTyping', 'chat.enterToSend', 'chat.autoEmoji', 'chat.linkPreview',
  'chat.translateMessages', 'chat.markdown', 'chat.autoArchive', 'chat.shareDirect',
  'chat.inAppBrowser', 'chat.autoNight', 'chat.mediaTapToNext', 'chat.raiseToListen',
  'chat.raiseToSpeak', 'chat.pauseMusicRecord', 'chat.pauseMusicMedia', 'chat.internalMic',
  'security.passcode', 'security.twoFactor',
  'calls.noiseSuppression', 'calls.p2p',
  'premium.customStickers', 'premium.customReactions', 'premium.biggerFiles', 'premium.customNameColor',
  'ai.enabled',
];
/*عددهای تنظیمات: [کمینه، بیشینه] — نوع هم بررسی می‌شود تا رشتهٔ آزاد ذخیره نشود. */
const SETTINGS_NUMBERS = {
  'appearance.wallBlur': [0, 40],
  'appearance.wallBright': [0.3, 1.5],
  'chat.archiveDays': [1, 365],
  'data.maxSizeMB': [1, 2048],
  'security.sessionLimit': [0, 100],
};
/*فهرست‌های نام کاربری (لیست‌های استثنای حریم خصوصی). */
const SETTINGS_LISTS = ['privacy.alwaysShare', 'privacy.neverShare'];
const SETTINGS_USERNAME_LIST_RE = /^[a-z0-9_]{3,20}$/;
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj); }
function setPath(obj, path, val) {
  const parts = path.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = val;
}
function deepMergeSettings(base, patch) {
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? JSON.parse(JSON.stringify(base)) : {};
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMergeSettings(out[k], v);
    else out[k] = v;
  }
  return out;
}
/* ادغام پیش‌فرض‌ها با سند ذخیره‌شده (ذخیره‌شده برنده) — بدون تغییر پیش‌فرض‌ها. */
function settingsView(user) {
  const stored = (user && typeof user.settings === 'object' && user.settings && !Array.isArray(user.settings)) ? user.settings : {};
  return deepMergeSettings(SETTINGS_DEFAULTS, stored);
}
/* اعتبارسنجی وصلهٔ تنظیمات: فقط کلیدهای شناخته‌شده؛ در غیر این صورت لیست خطا. */
function sanitizeSettingsPatch(patch) {
  const out = {}; const errors = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { out, errors };
  for (const key of Object.keys(SETTINGS_ENUMS)) {
    const v = getPath(patch, key);
    if (v === undefined) continue;
    if (typeof v === 'string' && SETTINGS_ENUMS[key].includes(v)) setPath(out, key, v); else errors.push(key);
  }
  for (const key of SETTINGS_BOOLS) {
    const v = getPath(patch, key);
    if (v === undefined) continue;
    if (typeof v === 'boolean') setPath(out, key, v); else errors.push(key);
  }
  for (const key of Object.keys(SETTINGS_NUMBERS)) {
    const v = getPath(patch, key);
    if (v === undefined) continue;
    const [min, max] = SETTINGS_NUMBERS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) setPath(out, key, v);
    else errors.push(key);
  }
  for (const key of SETTINGS_LISTS) {
    const v = getPath(patch, key);
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length <= 100 && v.every((x) => typeof x === 'string' && SETTINGS_USERNAME_LIST_RE.test(x))) {
      setPath(out, key, v.map((x) => x.toLowerCase()));
    } else errors.push(key);
  }
  const hint = getPath(patch, 'security.twoFactorHint');
  if (hint !== undefined) {
    const s = String(hint).trim().slice(0, 100);
    setPath(out, 'security.twoFactorHint', s);
  }
  const rec = getPath(patch, 'security.twoFactorRecoveryEmail');
  if (rec !== undefined) {
    const s = String(rec).trim().slice(0, 120);
    if (s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) setPath(out, 'security.twoFactorRecoveryEmail', s);
    else errors.push('security.twoFactorRecoveryEmail');
  }
  const acv = getPath(patch, 'appearance.accentCustom');
  if (acv !== undefined) {
    const s = String(acv).trim();
    if (s === '' || /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) setPath(out, 'appearance.accentCustom', s);
    else errors.push('appearance.accentCustom');
  }
  const px = getPath(patch, 'data.proxy');
  if (px !== undefined) {
    const s = String(px).trim();
    let ok = s === '';
    if (!ok) { try { const u = new URL(s); ok = (u.protocol === 'http:' || u.protocol === 'https:'); } catch (e) { ok = false; } }
    if (ok) setPath(out, 'data.proxy', s); else errors.push('data.proxy');
  }
  const tv = getPath(out, 'appearance.theme');
  if (typeof tv === 'string' && THEME_MIGRATE[tv]) setPath(out, 'appearance.theme', THEME_MIGRATE[tv]);
  const ac = getPath(patch, 'appearance.accent');
  if (ac !== undefined) {
    const s = String(ac).trim().slice(0, 30);
    if (/^[a-zA-Z0-9#_-]+$/.test(s)) setPath(out, 'appearance.accent', s); else errors.push('appearance.accent');
  }
  return { out, errors };
}
/* محدودیت نرخ برای نوشتن تنظیمات (per-user، در حافظه). */
const settingsWrites = new Map();
function settingsRateOk(username, max = 40, windowMs = 60000) {
  const now = Date.now();
  const arr = (settingsWrites.get(username) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { settingsWrites.set(username, arr); return false; }
  arr.push(now); settingsWrites.set(username, arr); return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of settingsWrites) { const f = arr.filter((t) => now - t < 60000); if (f.length) settingsWrites.set(k, f); else settingsWrites.delete(k); }
}, 60000).unref();

/* حذف حساب‌های غیرفعال: کاربرانی که برای مدت انتخاب‌شده فعالیت نکرده‌اند */
const INACTIVE_DELETE_MS = { '1m': 30 * 86400000, '3m': 90 * 86400000, '6m': 180 * 86400000, '12m': 365 * 86400000 };
setInterval(() => {
  try {
    const now = Date.now();
    const toDelete = [];
    for (const u of db.users) {
      const inactive = (u.settings && u.settings.security && u.settings.security.inactiveDelete) || 'off';
      const ms = INACTIVE_DELETE_MS[inactive];
      if (!ms) continue;
      const lastSeen = Number(u.lastSeen || 0);
      if (lastSeen > 0 && (now - lastSeen) > ms) toDelete.push(u.username);
    }
    for (const name of toDelete) {
      db.users = db.users.filter((u) => u.username !== name);
      revokeUserSessions(name);
      try { kickUser(name); } catch (e) {}
    }
    if (toDelete.length) saveDB();
  } catch (e) {}
}, 3600000).unref();

app.get('/api/profile/settings', auth, (req, res) => {
  // `settings` = کامل (پیش‌فرض‌ها اعمال‌شده) برای رندر؛ `stored` = سند پراکندهٔ
  // واقعی روی حساب — تا کلاینت بفهمد کاربر واقعاً چه چیزی را تغییر داده (مثلاً
  // آیا ظاهر را خودش انتخاب کرده یا هنوز پیش‌فرض است).
  res.json({ ok: true, settings: settingsView(req.user), stored: (req.user.settings && typeof req.user.settings === 'object' && !Array.isArray(req.user.settings)) ? req.user.settings : {} });
});

app.post('/api/profile/settings', auth, (req, res) => {
  if (!settingsRateOk(req.user.username)) return res.status(429).json({ error: 'درخواست‌های تنظیمات زیاد است — کمی صبر کن' });
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
  let applied = null;
  if (b.settings !== undefined) {
    const { out, errors } = sanitizeSettingsPatch(b.settings);
    if (errors.length) return res.status(400).json({ error: 'مقدار تنظیمات نامعتبر: ' + [...new Set(errors)].join('، ') });
    req.user.settings = deepMergeSettings(req.user.settings || {}, out);
    applied = out;
  }
  saveDB();
  try { notifyUser(req.user.username, { type: 'settings-updated', settings: settingsView(req.user) }); } catch (e) {}
  res.json({ ok: true, me: publicUser(req.user), settings: settingsView(req.user), applied });
});

app.get('/api/profile/devices', auth, (req, res) => {
  const cur = deviceId(req);
  const d = Array.isArray(req.user.devices) ? req.user.devices : [];
  res.json({ devices: d.map((dev) => ({
    id: dev.id || null,
    current: !!(dev.id && dev.id === cur),
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

/* بستن یک دستگاه مشخص: نشست‌هایش باطل و از لیست حذف می‌شود. */
app.post('/api/profile/devices/revoke', auth, (req, res) => {
  const id = String((req.body || {}).id || '').trim();
  if (!id) return res.status(400).json({ error: 'شناسهٔ دستگاه لازم است' });
  req.user.devices = (Array.isArray(req.user.devices) ? req.user.devices : []).filter((d) => d && d.id !== id);
  const revoked = revokeDeviceSessions(req.user.username, id);
  saveDB();
  res.json({ ok: true, revoked });
});

/* بستن همهٔ نشست‌ها به‌جز دستگاه فعلی. */
app.post('/api/profile/devices/revoke-others', auth, (req, res) => {
  const cur = deviceId(req);
  req.user.devices = (Array.isArray(req.user.devices) ? req.user.devices : []).filter((d) => d && d.id === cur);
  const revoked = revokeOtherSessions(req.user.username, cur);
  saveDB();
  res.json({ ok: true, revoked });
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
app.post('/api/profile/avatar', auth, avatarUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'عکس مجاز نیست (فقط jpg/png/webp تا ۵MB)' });
  const __rf = restrictedFlagsFor(req.user.username);
  if (__rf && __rf.restricted && __rf.noAvatar !== false) { fs.unlink(req.file.path, () => {}); return res.status(403).json({ error: '?? ??? ????? ??? ????? ???' }); }
  flagSuspiciousUpload(req.user, req.file.path, req.file.filename, cleanMime(req.file.mimetype), 'profile-avatar');
  incUploadDaily(req.user.username);
  if (req.user.avatar && req.user.avatar.startsWith('/uploads/')) {
    const old = path.join(UPLOAD_DIR, path.basename(req.user.avatar));
    fs.unlink(old, () => {});
  }
  req.user.avatar = await durableUpload(req.file.path, req.file.filename, cleanMime(req.file.mimetype));
  if (R2_ENABLED) { try { fs.unlink(req.file.path, () => {}); } catch (e) {} }
  saveDB();
  pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, avatar: req.user.avatar, me: publicUser(req.user) });
});
app.post('/api/profile/background', auth, avatarUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویر مجاز نیست (فقط jpg/png/webp تا ۵MB)' });
  const __rfBg = restrictedFlagsFor(req.user.username);
  if (__rfBg && __rfBg.restricted && __rfBg.noAvatar !== false) { fs.unlink(req.file.path, () => {}); return res.status(403).json({ error: '?? ??? ????? ??? ????? ???' }); }
  flagSuspiciousUpload(req.user, req.file.path, req.file.filename, cleanMime(req.file.mimetype), 'profile-background');
  incUploadDaily(req.user.username);
  if (req.user.profileBg && req.user.profileBg.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(req.user.profileBg)), () => {});
  }
  req.user.profileBg = await durableUpload(req.file.path, req.file.filename, cleanMime(req.file.mimetype));
  if (R2_ENABLED) { try { fs.unlink(req.file.path, () => {}); } catch (e) {} }
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
  const __bf = restrictedFlagsFor(req.user.username);
  if (__bf && __bf.restricted && __bf.noAvatar !== false) return res.status(403).json({ error: '?? ??? ????? ??? ????? ???' });
  req.user.profileBg = url;
  saveDB(); pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, profileBg: req.user.profileBg, me: publicUser(req.user) });
});
app.post('/api/profile/avatar/url', auth, (req, res) => {
  const url = setProfileBgSafe((req.body || {}).url);
  if (!url) return res.status(400).json({ error: 'لینک تصویر معتبر نیست' });
  const __af = restrictedFlagsFor(req.user.username);
  if (__af && __af.restricted && __af.noAvatar !== false) return res.status(403).json({ error: '?? ??? ????? ??? ????? ???' });
  req.user.avatar = url;
  saveDB(); pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, avatar: req.user.avatar, me: publicUser(req.user) });
});

// ---------- account: username / phone / delete (Section 1) ----------
/*نام کاربری: ۳ تا ۲۰ کاراکتر، فقط حروف کوچک انگلیسی، عدد و زیرخط. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const pendingPhoneCodes = new Map();   // username -> { phone, code, exp }
const pendingDeleteCodes = new Map();  // username -> { code, exp }

function usernameStatus(raw) {
  const username = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { username, valid: false, available: false, reason: 'نام کاربری باید ۳ تا ۲۰ کاراکتر و شامل حروف کوچک انگلیسی، عدد یا _ باشد' };
  }
  const taken = db.users.some((u) => String(u.username || '').toLowerCase() === username);
  return { username, valid: true, available: !taken, reason: taken ? 'این نام کاربری قبلاً گرفته شده است' : '' };
}

function remapDmRoom(roomId, oldName, newName) {
  if (typeof roomId !== 'string' || !roomId.startsWith('dm:')) return roomId;
  return 'dm:' + roomId.slice(3).split('|').map((part) => (part === oldName ? newName : part)).join('|');
}
/*همه‌ی ارجاع‌ها به نام کاربری را جابه‌جا می‌کند تا پیام‌ها، گروه‌ها، نشست‌ها
  و وضعیت خوانده‌شدن بعد از تغییر نام کاربری از دست نروند. */
function renameUserReferences(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  for (const user of db.users) {
    if (user.username === oldName) user.username = newName;
    if (Array.isArray(user.contacts)) user.contacts = user.contacts.map((c) => (c === oldName ? newName : c));
    if (Array.isArray(user.blocked)) user.blocked = user.blocked.map((b) => (b === oldName ? newName : b));
  }
  for (const record of sessions.values()) {
    if (record && record.username === oldName) record.username = newName;
  }
  for (const group of db.groups || []) {
    if (group.owner === oldName) group.owner = newName;
    if (Array.isArray(group.members)) group.members.forEach((m) => { if (m && m.username === oldName) m.username = newName; });
  }
  const nextMessages = {};
  for (const [roomId, list] of Object.entries(db.messages || {})) {
    if (Array.isArray(list)) list.forEach((m) => { if (m && m.from === oldName) m.from = newName; });
    nextMessages[remapDmRoom(roomId, oldName, newName)] = list;
  }
  db.messages = nextMessages;
  const remapRoomMap = (src) => {
    const outMap = {};
    for (const [roomId, value] of Object.entries(src || {})) {
      if (roomId === '__proto__' || roomId === 'constructor') continue;
      outMap[remapDmRoom(roomId, oldName, newName)] = value;
    }
    return outMap;
  };
  if (db.pinned && typeof db.pinned === 'object') db.pinned = remapRoomMap(db.pinned);
  if (db.chatState && typeof db.chatState === 'object') {
    for (const uname of Object.keys(db.chatState)) {
      const perUser = db.chatState[uname];
      if (perUser && typeof perUser === 'object') db.chatState[uname] = remapRoomMap(perUser);
    }
    if (db.chatState[oldName]) { db.chatState[newName] = db.chatState[oldName]; delete db.chatState[oldName]; }
  }
  if (db.readState && typeof db.readState === 'object') {
    const nextRead = {};
    for (const [roomId, readers] of Object.entries(db.readState)) {
      const perRoom = {};
      for (const [reader, stamp] of Object.entries(readers || {})) perRoom[reader === oldName ? newName : reader] = stamp;
      nextRead[remapDmRoom(roomId, oldName, newName)] = perRoom;
    }
    db.readState = nextRead;
  }
  if (Array.isArray(db.scheduled)) {
    for (const item of db.scheduled) {
      if (!item) continue;
      if (item.from === oldName) item.from = newName;
      if (item.roomId) item.roomId = remapDmRoom(item.roomId, oldName, newName);
    }
  }
  if (Array.isArray(db.renameRequests)) {
    for (const r of db.renameRequests) if (r && r.username === oldName) r.username = newName;
  }
}

app.get('/api/profile/username-available', auth, (req, res) => {
  if (!authRateOk('username-check:' + req.user.username, 60, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const st = usernameStatus(req.query.username || req.query.u || '');
  res.json({ ok: true, username: st.username, valid: st.valid, available: st.available, reason: st.reason });
});

app.post('/api/profile/username', auth, (req, res) => {
  if (!authRateOk('username-set:' + req.user.username, 5, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const st = usernameStatus((req.body || {}).username);
  if (!st.valid) return res.status(400).json({ error: st.reason });
  if (st.username === req.user.username) return res.json({ ok: true, me: publicUser(req.user) });
  const taken = db.users.find((u) => u !== req.user && String(u.username || '').toLowerCase() === st.username);
  if (taken) return res.status(409).json({ error: 'این نام کاربری قبلاً گرفته شده است' });
  const oldName = req.user.username;
  renameUserReferences(oldName, st.username);
  saveDB();
  pushUsers();
  broadcastProfile(st.username);
  notifyUser(st.username, { type: 'username-changed', username: st.username });
  res.json({ ok: true, me: publicUser(req.user) });
});

app.post('/api/profile/phone/send-code', auth, async (req, res) => {
  if (!authRateOk('phone-code:' + req.user.username, 5, 5 * 60 * 1000)) return res.status(429).json({ error: 'کد زیاد درخواست شده — چند دقیقه صبر کن' });
  const phone = normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)' });
  if (req.user.phone === phone) return res.status(400).json({ error: 'این شماره همان شمارهٔ فعلی حساب است' });
  if (db.users.some((u) => u !== req.user && u.phone === phone)) return res.status(409).json({ error: 'این شماره قبلاً برای حساب دیگری ثبت شده است' });
  const code = genCode();
  pendingPhoneCodes.set(req.user.username, { phone, code, exp: Date.now() + 5 * 60 * 1000 });
  const sms = await sendSMS(phone, `کد تغییر شماره VORTEXGRAM: ${code}`);
  const out = { ok: true };
  if (devCodeEnabled) out.devCode = code;
  if (sms && sms.smsError) out.note = 'ارسال پیامک با خطا مواجه شد — کد در کنسول سرور چاپ شد';
  res.json(out);
});

app.post('/api/profile/phone', auth, (req, res) => {
  if (!authRateOk('phone-set:' + req.user.username, 10, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)' });
  if (db.users.some((u) => u !== req.user && u.phone === phone)) return res.status(409).json({ error: 'این شماره قبلاً برای حساب دیگری ثبت شده است' });
  const code = String(body.code || '').trim();
  const password = String(body.password || '');
  if (code) {
    const rec = pendingPhoneCodes.get(req.user.username);
    if (!rec || rec.phone !== phone || rec.exp < Date.now() || rec.code !== code) {
      return res.status(403).json({ error: 'کد تأیید نامعتبر یا منقضی شده است' });
    }
  } else if (password) {
    if (!verifyPassword(req.user, password)) return res.status(403).json({ error: 'رمز عبور اشتباه است' });
  } else {
    return res.status(403).json({ error: 'برای تغییر شماره، رمز عبور یا کد پیامکی لازم است', needCode: true });
  }
  pendingPhoneCodes.delete(req.user.username);
  req.user.phone = phone;
  saveDB();
  pushUsers();
  broadcastProfile(req.user.username);
  res.json({ ok: true, me: publicUser(req.user) });
});

app.post('/api/profile/delete-account/send-code', auth, async (req, res) => {
  if (!authRateOk('delacct-code:' + req.user.username, 3, 5 * 60 * 1000)) return res.status(429).json({ error: 'کد زیاد درخواست شده — چند دقیقه صبر کن' });
  if (!req.user.phone) return res.status(400).json({ error: 'برای این حساب شماره‌ای ثبت نشده است — با رمز عبور تأیید کن', needPassword: true });
  const code = genCode();
  pendingDeleteCodes.set(req.user.username, { code, exp: Date.now() + 5 * 60 * 1000 });
  const sms = await sendSMS(req.user.phone, `کد حذف حساب VORTEXGRAM: ${code}`);
  const out = { ok: true };
  if (devCodeEnabled) out.devCode = code;
  if (sms && sms.smsError) out.note = 'ارسال پیامک با خطا مواجه شد — کد در کنسول سرور چاپ شد';
  res.json(out);
});

app.post('/api/profile/delete-account', auth, (req, res) => {
  if (!authRateOk('delacct:' + req.user.username, 5, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const body = req.body || {};
  const password = String(body.password || '');
  const code = String(body.code || '').trim();
  if (password) {
    if (!req.user.passHash) return res.status(403).json({ error: 'برای این حساب رمز عبوری تنظیم نشده است — با کد پیامکی تأیید کن', needCode: true });
    if (!verifyPassword(req.user, password)) return res.status(403).json({ error: 'رمز عبور اشتباه است' });
  } else if (code) {
    const rec = pendingDeleteCodes.get(req.user.username);
    if (!rec || rec.exp < Date.now() || rec.code !== code) return res.status(403).json({ error: 'کد تأیید نامعتبر یا منقضی شده است' });
  } else {
    return res.status(403).json({ error: 'برای تأیید حذف، رمز عبور یا کد پیامکی لازم است', needCode: true });
  }
  const username = req.user.username;
  pendingDeleteCodes.delete(username);
  pendingPhoneCodes.delete(username);
  revokeUserSessions(username);
  db.users = db.users.filter((u) => u.username !== username);
  for (const u of db.users) {
    if (Array.isArray(u.contacts)) u.contacts = u.contacts.filter((c) => c !== username);
    if (Array.isArray(u.blocked)) u.blocked = u.blocked.filter((b) => b !== username);
  }
  const keptGroups = [];
  for (const group of db.groups || []) {
    const wasMember = (group.members || []).some((m) => m && m.username === username);
    if (!wasMember) { keptGroups.push(group); continue; }
    group.members = (group.members || []).filter((m) => m && m.username !== username);
    if (group.owner === username) {
      if (group.members.length) { group.owner = group.members[0].username; group.members[0].role = 'owner'; keptGroups.push(group); }
      continue;
    }
    keptGroups.push(group);
  }
  db.groups = keptGroups;
  if (db.chatState && db.chatState[username]) delete db.chatState[username];
  if (Array.isArray(db.scheduled)) db.scheduled = db.scheduled.filter((s) => s && s.from !== username);
  if (Array.isArray(db.renameRequests)) db.renameRequests = db.renameRequests.filter((r) => r && r.username !== username);
  try { kickUser(username); } catch (e) {}
  saveDB();
  pushUsers();
  res.json({ ok: true });
});

// ---------- security: two-step verification ---------- 
app.post('/api/security/two-factor', auth, (req, res) => {
  if (!authRateOk('2fa:' + req.user.username, 5, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  const body = req.body || {};
  const enabled = !!body.enabled;
  const password = String(body.password || '');
  const hint = String(body.hint || '').trim().slice(0, 100);
  const recoveryEmail = String(body.recoveryEmail || '').trim().slice(0, 120);
  if (enabled) {
    if (password.length < 4) return res.status(400).json({ error: 'رمز تأیید دو مرحله‌ای حداقل ۴ کاراکتر باشد' });
    if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) return res.status(400).json({ error: 'ایمیل بازیابی نامعتبر است' });
    req.user.twoFactorHash = hash(password, req.user.salt);
    req.user.twoFactorHint = hint;
    req.user.twoFactorRecoveryEmail = recoveryEmail;
  } else {
    req.user.twoFactorHash = null;
    req.user.twoFactorHint = '';
    req.user.twoFactorRecoveryEmail = '';
  }
  req.user.settings = req.user.settings || {};
  req.user.settings.security = req.user.settings.security || {};
  req.user.settings.security.twoFactor = enabled;
  req.user.settings.security.twoFactorHint = hint;
  req.user.settings.security.twoFactorRecoveryEmail = recoveryEmail;
  saveDB();
  res.json({ ok: true, enabled });
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
  if (!req.user.isAdmin) return res.status(403).json({ error: '??? ?????' });
  res.json({ users: db.users.map(publicUser) });
});

app.get('/api/admin/reports', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: '??? ?????' });
  const out = (db.reports || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0)).map((r) => ({
    ...r,
    blocked: !!(db.uploadFlags && r.filename && db.uploadFlags[r.filename]),
  }));
  res.json({ reports: out });
});

app.post('/api/admin/reports/:id/ignore', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: '??? ?????' });
  const idx = (db.reports || []).findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '???? ???? ???' });
  const row = db.reports[idx];
  if (row && row.filename && db.uploadFlags) delete db.uploadFlags[row.filename];
  db.reports.splice(idx, 1);
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/reports/:id/delete-message', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: '??? ?????' });
  const row = (db.reports || []).find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: '???? ???? ???' });
  const fn = String(row.filename || '').slice(0, 120);
  for (const rid of Object.keys(db.messages || {})) {
    if (!Array.isArray(db.messages[rid])) continue;
    const before = db.messages[rid].length;
    db.messages[rid] = db.messages[rid].filter((m) => !(fn && ((m.url && String(m.url).includes(fn)) || (m.src && String(m.src).includes(fn)) || (Array.isArray(m.album) && m.album.some((u) => String(u).includes(fn))))));
    if (db.messages[rid].length !== before) broadcast && broadcast({ type: 'message-deleted', roomId: rid, id: '', all: true });
  }
  try { if (fn) { const p = require('path').join(UPLOAD_DIR, fn); fs.unlink(p, () => {}); } } catch (e) {}
  if (fn && db.uploadFlags) delete db.uploadFlags[fn];
  db.reports = (db.reports || []).filter((r) => r.id !== row.id);
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/restrict', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: '??? ?????' });
  const { username, restricted, maxFileMB, filesPerDay, noEdit, noAvatar } = req.body || {};
  const u = db.users.find((x) => x.username === username);
  if (!u) return res.status(404).json({ error: '?? ???? ???' });
  u.restricted = !!restricted;
  db.userFlags = db.userFlags || {};
  db.userFlags[username] = {
    restricted: !!restricted,
    maxFileMB: Number(maxFileMB) || 100,
    filesPerDay: Number(filesPerDay) || 5,
    noEdit: noEdit !== false,
    noAvatar: noAvatar !== false,
    updatedAt: Date.now(),
  };
  saveDB();
  auditAdmin(req, 'restrict', username, { restricted: !!restricted, maxFileMB: Number(maxFileMB) || 100, filesPerDay: Number(filesPerDay) || 5 });
  res.json({ ok: true });
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
    .map((u) => {
      const pres = (u.settings && u.settings.privacy) || {};
      return { username: u.username, displayName: u.displayName || u.username, avatar: canSee(req.user.username, u, 'profilePhoto') ? (u.avatar || null) : null, isPremium: !!u.isPremium, isAdmin: !!u.isAdmin, online: pres.presence === false ? false : !!u.online };
    });
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
    .map((u) => {
      const canPhoto = canSee(req.user.username, u, 'profilePhoto');
      const pres = (u.settings && u.settings.privacy) || {};
      return { username: u.username, displayName: u.displayName || u.username, avatar: canPhoto ? (u.avatar || null) : null, isPremium: !!u.isPremium, isAdmin: !!u.isAdmin, online: pres.presence === false ? false : !!u.online, ...(isAdmin ? { banned: !!u.banned } : {}) };
    });
  res.json({ users: out });
});

// پروفایل عمومی هر کاربر (برای نمایش جلوه‌های تم در پروفایل)
app.get('/api/user/:username', auth, (req, res) => {
  const uname = String(req.params.username || '').replace('@', '');
  if (uname === BOT_USERNAME) return res.json({ u: botPublicUser() });
  const target = db.users.find((u) => u.username === uname);
  if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const isSelfOrAdmin = req.user.username === target.username || req.user.isAdmin;
  const pu = publicUser(target);
  if (!isSelfOrAdmin) {
    delete pu.blocked;
    delete pu.hasPassword;
    /* privacy tiers enforced here, not just hidden in the client */
    if (!canSee(req.user.username, target, 'phone')) delete pu.phone;
    if (!canSee(req.user.username, target, 'profilePhoto')) pu.avatar = null;
    if (!canSee(req.user.username, target, 'bio')) pu.bio = '';
    if (!canSee(req.user.username, target, 'birthday')) pu.birthday = '';
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
  const token = createSession(target.username, deviceId(req));
  setSessionCookie(res, token);
  saveDB();
  auditAdmin(req, 'impersonate', target.username, {});
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
    auditAdmin(req, 'promote', target.username, { scope, role: m.role });
    return res.json({ ok: true, group: g.id, role: m.role });
  }
  target.isAdmin = role === 'admin';
  saveDB(); pushUsers();
  auditAdmin(req, 'promote', target.username, { scope: scope || 'global', role: target.isAdmin ? 'admin' : 'member' });
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
  if (banned) revokeUserSessions(target.username);
  saveDB();
  if (banned) kickUser(target.username);
  pushUsers();
  auditAdmin(req, 'ban', target.username, { banned: !!banned });
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
  revokeUserSessions(target.username);
  saveDB();
  kickUser(target.username);
  notifyUser(target.username, { type: 'password-reset' });
  auditAdmin(req, 'reset-password', target.username, {});
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
/* ---------- پیکربندی نقشه (برای انتخاب موقعیت روی مپ) ----------
   کاشی‌های پیش‌فرض بدون کلید و بدون CDN اضافه‌اند. اگر کلید نشان یا سرویس
   دلخواهی دارید، با متغیرهای محیطی زیر جایگزین کنید:
     VX_MAP_TILE_URL   الگوی کاشی، مثلاً نشان:  https://api.neshan.org/v1/map/{z}/{x}/{y}.png?api_key=KEY
     VX_MAP_ATTRIB     متن نگهدارندهٔ نقشه که روی نقشه نمایش داده می‌شود
     VX_TRAFFIC_URL    الگوی کاشی ترافیک (اختیاری؛ بدون تنظیم، لایهٔ ترافیک غیرفعال است)
   فقط مقادیر https و الگوی {z}/{x}/{y} پذیرفته می‌شوند. */
const MAP_ATTRIB_DEFAULT = '© OpenStreetMap';
app.get('/api/map-config', (req, res) => {
  const safeTemplate = (tpl) => {
    const s = String(tpl || '').trim();
    if (!s) return '';
    if (!/^https:\/\//i.test(s)) return '';
    if (!/\{z\}/.test(s) || !/\{x\}/.test(s) || !/\{y\}/.test(s)) return '';
    return s;
  };
  res.set('Cache-Control', 'no-store');
  res.json({
    tileUrl: safeTemplate(process.env.VX_MAP_TILE_URL),
    tileAttrib: String(process.env.VX_MAP_ATTRIB || MAP_ATTRIB_DEFAULT).slice(0, 120),
    trafficUrl: safeTemplate(process.env.VX_TRAFFIC_URL),
    maxZoom: 19,
  });
});
/* وضعیت سرویس؛ برای فهمیدن اینکه آیا ذخیره‌سازی رسانه پایدار است یا خیر.
   بدون R2، فایل‌ها روی دیسکایفا → Render هر redeploy پاک می‌شوند. */
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    version: APP_VERSION,
    build: APP_BUILD,
    mediaStorage: R2_ENABLED ? 'cloudflare-r2' : 'local-filesystem',
    durableMedia: R2_ENABLED,
    uploadsDir: UPLOAD_DIR,
  });
});
/* جست‌وجوی نام مکان از داخل سایت.
   چرا پروکسی؟ سیاست CSP برنامه connect-src را روی 'self' بسته است، پس مرورگر
   اجازهٔ اتصال مستقیم به Nominatim را نمی‌دهد. ضمناً محدودیت نرخ سرویس عمومی
   باید این‌جا و نه در مرورگر اعمال شود. */
const MAP_SEARCH_HOST = 'nominatim.openstreetmap.org';
let mapSearchBusy = false;
let mapSearchLast = 0;
app.get('/api/map-search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ results: [] });
  /* سقف نرخ: یک درخواست در هر ۱۱ ثانیه برای کل سرویس (سیاست Nominatim) */
  const now = Date.now();
  if (mapSearchBusy || now - mapSearchLast < 11000) return res.json({ results: [], throttled: true });
  /* سقف نرخ کاربر */
  if (!authRateOk('mapsearch:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  mapSearchBusy = true; mapSearchLast = now;
  try {
    const url = 'https://' + MAP_SEARCH_HOST + '/search?format=jsonv2&limit=6&accept-language=fa&q=' + encodeURIComponent(q);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, {
      signal: ctl.signal,
      /* هدر Accept برای Nominatim هم لازم است تا پاسخ JSON بدهد */
      headers: { 'Accept': 'application/json', 'User-Agent': 'VortexMessenger/1.0 (self-hosted messenger)' },
    });
    clearTimeout(timer);
    if (!r.ok) return res.json({ results: [] });
    const arr = await r.json();
    const results = (Array.isArray(arr) ? arr : []).slice(0, 6).map((a) => ({
      lat: Number(a.lat), lon: Number(a.lon), label: String(a.display_name || '').slice(0, 160),
    })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
    res.set('Cache-Control', 'no-store');
    res.json({ results });
  } catch (e) {
    res.json({ results: [] });
  } finally {
    mapSearchBusy = false;
  }
});
/* ---------- ساختمان‌ها برای نمای سه‌بعدی ----------
   از Overpass (داده‌های OSM) پایهٔ ساختمان‌ها را می‌گیریم تا در نقشه به‌صورت
   حجم (extrusion) رسم شوند. اگر ارتفاع ثبت نشده باشد، از تعداد طبقات
   تخمین زده می‌شود (حدود ۳ متر برای هر طبقه) و برای ساختمان‌های بدون طبقات
   مقدار پیش‌فرض منطقی استفاده می‌شود.
   مثل جست‌وجو، پروکسی از سرور خودمان است چون CSP سایت اتصال بیرونی را می‌بندد. */
const OVERPASS_HOSTS = String(process.env.VX_OVERPASS_HOSTS || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.osm.ch/api/interpreter')
  .split(',').map((s) => s.trim()).filter((s) => /^https:\/\/[\w.-]+\/api\/interpreter$/.test(s));
let mapBuildingsCache = new Map();
/* یک بار تلاش می‌کنیم و اگر نشد بین آینه‌ها جابه‌جا می‌شویم؛ نمی‌خواهیم
   سه درخواست پشت‌سرهم به سرویس عمومی بفرستیم. */
async function overpassQuery(q) {
  let lastErr = null;
  for (const host of OVERPASS_HOSTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 22000);
    try {
      const r = await fetch(host, {
        method: 'POST', signal: ctl.signal,
        /* هدر Accept لازم است: بدون آن پراکسی Overpass با 504 جواب می‌دهد */
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'VortexMessenger/1.0 (self-hosted messenger)' },
        body: 'data=' + encodeURIComponent(q),
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = new Error(host + ' http ' + r.status); continue; }
      const data = await r.json();
      const els = Array.isArray(data.elements) ? data.elements : null;
      /* پاسخ خراب یا بدون «elements» ⇒ آینه بعدی را امتحان کن */
      if (!els) { lastErr = new Error(host + ' bad payload'); continue; }
      /* اگر آینه صفر عنصر داد، باز هم به آینه‌های بعدی امتحان می‌کنیم چون
         بعضی آینه‌ها ناحیهٔ داده‌ی ناقص دارند */
      if (!els.length) { lastErr = new Error(host + ' 0 elements'); continue; }
      return { data: data, host: host };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  /* اگر همه آینه‌ها خالی/خطا دادند، اگر آخرین خطا «۰ عنصر» بود یعنی سرویس
     بالاست ولی داده‌ای برای این ناحیه نیست (بی‌ساختممان) */
  throw lastErr || new Error('overpass unavailable');
}
app.get('/api/map-buildings', auth, async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lng);
  const zoom = Math.max(11, Math.min(18, Number(req.query.zoom) || 15));
  const numOk = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  if (!numOk(lat) || !numOk(lon) || Number(lat) < -90 || Number(lat) > 90 || Number(lon) < -180 || Number(lon) > 180) {
    return res.status(400).json({ error: 'مختصات نامعتبر' });
  }
  const LA = Number(lat), LO = Number(lon);
  /* شعاع بر اساس زوم تا حجم درخواست ثابت بماند */
  const radius = Math.max(150, Math.min(700, Math.round(320 * Math.pow(2, 15 - zoom))));
  const key = LA.toFixed(3) + ',' + LO.toFixed(3) + ',' + zoom;
  const hit = mapBuildingsCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
    res.set('Cache-Control', 'private, max-age=300');
    return res.json(hit.body);
  }
  if (!authRateOk('mapbld:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'تلاش زیاد — کمی صبر کن' });
  if (process.env.VX_DEBUG_MAP) console.log('[map-buildings]', req.user.username, LA, LO, 'zoom', zoom, 'radius', radius);
  const q = '[out:json][timeout:20];(way(around:' + radius + ',' + LA + ',' + LO + ')[building];relation(around:' + radius + ',' + LA + ',' + LO + ')[building];);out geom 2;';
  try {
    const got = await overpassQuery(q);
    if (process.env.VX_DEBUG_MAP) console.log('[map-buildings] host', got.host, 'elements', (got.data.elements || []).length);
    const data = got.data;
    const out = [];
    for (const el of (Array.isArray(data.elements) ? data.elements : []).slice(0, 400)) {
      const geom = el.geometry;
      if (!Array.isArray(geom) || geom.length < 3) continue;
      const ring = geom
        .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6]);
      if (ring.length < 3) continue;
      const t = el.tags || {};
      let h = 0;
      const rawH = t['building:height'] || t.height || t['building:levels'];
      if (rawH != null) {
        const s = String(rawH);
        const n = parseFloat(s.replace(/[^\d.]/g, ''));
        if (Number.isFinite(n) && n > 0) {
          h = /^\s*[\d.]+\s*m\b/i.test(s) ? n : n * 3.2; /* متر یا طبقات */
        }
      }
      if (!(h > 0)) h = t.building === 'yes' ? 8 : 5; /* تخمین برای ساختمان بی‌طبقه */
      out.push({ ring: ring, h: Math.min(400, Math.round(h * 10) / 10) });
    }
    const body = { buildings: out };
    mapBuildingsCache.set(key, { at: Date.now(), body: body });
    if (mapBuildingsCache.size > 200) mapBuildingsCache.clear();
    res.set('Cache-Control', 'private, max-age=300');
    res.json(body);
  } catch (e) {
    if (process.env.VX_DEBUG_MAP) console.log('[map-buildings] FAILED', e && e.message);
    /* صادقانه: «سرویس در دسترس نیست» را از «داده‌ای ثبت نشده» جدا می‌کنیم تا
       کاربر اشتباه فکر نکند نقشه خالی است یا اینکه مشکل از سمت ماست */
    const msg = String(e && e.message || '');
    const noData = /0 elements/.test(msg);
    res.set('Cache-Control', 'no-store');
    res.json(noData ? { buildings: [], unavailable: false } : { buildings: [], unavailable: true });
  }
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
      return { username: uname, displayName: (u && u.displayName) || uname, avatar: (u && canSee(req.user.username, u, 'profilePhoto')) ? (u.avatar || null) : null };
    });
  }
  res.json({ reactions: out });
});
// شمارش واکنش بدون افشای هویت — برای پست‌های کانالی که می‌خواهند فقط «محبوبیت»
// نشان دهند، نه اینکه چه کسی واکنش داده است.
app.get('/api/reactions/:msgId/counts', auth, (req, res) => {
  const rid = String((req.query || {}).roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(req.params.msgId || ''));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const counts = {};
  let total = 0;
  for (const [emojiKey, arr] of Object.entries(m.reactions || {})) {
    const n = Array.isArray(arr) ? arr.length : 0;
    if (!n) continue;
    counts[emojiKey] = n;
    total += n;
  }
  res.json({ counts, total, views: (typeof m.views === 'number' ? m.views : 0) });
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
  const { roomId, msgId, scope } = req.body || {};
  const rid = String(roomId || '');
  if (!canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const mid = String(msgId || '') || '';
  if (db.pinned[rid] && db.pinned[rid].indexOf(mid) === -1 && !(db.messages[rid] || []).some((m) => m.id === mid)) { /* allow unpin even if deleted */ }
  // channel: always global
  const isChannel = rid.startsWith('group:') && ((findGroup(rid.slice(6))||{}).type==='channel');
  const wantPersonal = scope==='personal' && !isChannel;
  if(wantPersonal){
    const st=chatStateOf(req.user.username);
    if(!st[rid]) st[rid]={}; if(!st[rid].pinned) st[rid].pinned=[];
    const arr=st[rid].pinned; const i=arr.indexOf(mid);
    if(i>=0) arr.splice(i,1); else arr.push(mid);
    saveDB();
    // only to this user
    const wsForUser = [...wss.clients].filter(c=>c.username===req.user.username);
    wsForUser.forEach(c=>{ try{ c.send(JSON.stringify({type:'pinned-updated', roomId:rid, ids:arr, personal:true})); }catch(e){} });
    return res.json({ ok: true, ids: arr, personal:true });
  }
  if (!db.pinned[rid]) db.pinned[rid] = [];
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
const { fetchPublicUrl } = require('./server/link-fetch');
app.get('/api/link-preview', auth, async (req, res) => {
  if (!authRateOk('link-preview:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const raw = String(req.query.url || '');
  let u;
  try { u = new URL(raw); } catch { return res.status(400).json({ error: 'لینک نامعتبر' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res.status(400).json({ error: 'فقط http(s)' });
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  if (![80, 443, 8080, 8443].includes(port)) return res.status(400).json({ error: 'پورت غیرمجاز' });
  let r;
  try {
    r = await fetchPublicUrl(u.href, { maxRedirects: 3, timeoutMs: 3000, headers: { 'User-Agent': 'VortexGramBot/1.0', 'Accept': 'text/html' } });
  } catch {
    return res.status(400).json({ error: 'آدرس مقصد مجاز نیست' });
  }
  try {
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
// سازگار با نسخهٔ قبل: { action, roomId, text, tone } → { result }
// اکنون از زنجیرهٔ ارائه‌دهندگان، سهمیهٔ روزانه و لایهٔ ایمنی عبور می‌کند.
app.post('/api/ai', auth, async (req, res) => {
  if (!authRateOk('ai:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  if (settingsView(req.user).ai.enabled === false) return res.status(403).json({ error: 'دستیار هوشمند در تنظیمات خاموش شده است' });
  const { action, roomId, text, tone } = req.body || {};
  const a = String(action || '');
  const rid = String(roomId || '');
  // ترتیب عمدی: بررسی دسترسی پیش از «تنظیم نشده» تا یک کاربر که عضو اتاق
  // نیست هرگز با پیام ۵۰۳ چیزی از وضعیت سرویس لو ندهد.
  if ((a === 'summarize' || a === 'reply' || a === 'ask') && !canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  if (a !== 'summarize' && a !== 'reply' && a !== 'translate' && a !== 'rewrite' && a !== 'ask') {
    return res.status(400).json({ error: 'action نامعتبر' });
  }
  if (!ai.isConfigured()) return res.status(503).json({ error: AI_NOT_CONFIGURED });
  const who = { username: req.user.username, isAdmin: req.user.isAdmin };

  const SYSTEM = {
    summarize: 'Summarize the chat in Persian in 3-5 short bullet points. Concise, no preamble.',
    reply: 'Suggest 3 short reply options in Persian, one per line, no numbering, no labels.',
    translate: 'Translate the text. If Persian translate to English, else to Persian. Return only the translation.',
    ask: 'Answer briefly in Persian using the chat context if relevant.',
  };
  function rewriteSystem(t) {
    return `Rewrite the text in Persian with a ${t} tone. Return only the rewritten text.`;
  }

  let out;
  try {
    if (a === 'summarize') {
      out = await aiComplete({ ...who, kind: 'text', system: SYSTEM.summarize, data: roomHistoryText(rid, 40), label: 'chat' });
    } else if (a === 'reply') {
      out = await aiComplete({ ...who, kind: 'text', system: SYSTEM.reply, data: roomHistoryText(rid, 40), label: 'chat' });
    } else if (a === 'translate') {
      out = await aiComplete({ ...who, kind: 'text', system: SYSTEM.translate, data: String(text || ''), label: 'text' });
    } else if (a === 'rewrite') {
      out = await aiComplete({ ...who, kind: 'text', system: rewriteSystem(String(tone || 'natural')), data: String(text || ''), label: 'text' });
    } else if (a === 'ask') {
      const data = roomHistoryText(rid, 30) + '\n\nQ: ' + String(text || '');
      out = await aiComplete({ ...who, kind: 'text', system: SYSTEM.ask, data, label: 'chat' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'خطای داخلی در پردازش هوش مصنوعی' });
  }
  if (!out.ok) return res.status(out.status).json({ error: out.error, resetsAt: out.resetsAt });
  res.json({ result: out.text });
});

/* ═══════════════════════════════════════════════════════════════════════
   API قابلیت‌های هوش مصنوعی (فاز ۳)
   ═══════════════════════════════════════════════════════════════════════ */

/** توانایی‌های AI برای غیرفعال‌سازیِ محترمانهٔ دکمه‌ها در کلاینت. */
app.get('/api/ai/config', auth, (req, res) => {
  res.json({
    enabled: ai.isConfigured(),
    whisper: ai.whisperAvailable(),
    image: ai.imageConfigured(),
    consentGiven: aiFeat.consentGiven(db, req.user.username),
    consentText: aiFeat.CONSENT_TEXT,
    limits: {
      digestMaxChars: aiFeat.L.digestMaxChars,
      translateMaxChars: aiFeat.L.translateMaxChars,
      audioMaxSeconds: aiFeat.L.audioMaxSeconds,
      audioMaxBytes: aiFeat.L.audioMaxBytes,
      bookmarkMax: aiFeat.L.bookmarkMax,
    },
    languages: aiFeat.LANG_LABEL,
  });
});

/** رضایت یک‌باره برای ارسال محتوای گفتگو به ارائه‌دهندهٔ بیرونی. */
app.post('/api/ai/consent', auth, (req, res) => {
  const give = (req.body || {}).consent !== false;
  if (!give) return res.json({ ok: true, consentGiven: false });
  aiFeat.grantConsent(db, req.user.username);
  saveDB();
  res.json({ ok: true, consentGiven: true, at: Date.now() });
});

/**
 * دروازهٔ رضایت: هر کنشی که محتوای گفتگو را به ارائه‌دهنده می‌فرستد باید
 * ابتدا رضایت کاربر ثبت‌شده را داشته باشد.
 *
 * ترتیب مهم است: هر سه مسیر AI ابتدا canAccess را بررسی می‌کنند و *بعد*
 * سراغ این دروازه می‌آیند، تا کاربری که عضو اتاق نیست با خطای ۴۲۸/۵۰۳
 * چیزی دربارهٔ وضعیت سرویس یا رضایت او لو ندهد.
 */
function aiConsentGate(req, res) {
  if (aiFeat.consentGiven(db, req.user.username)) return true;
  res.status(428).json({
    error: 'برای استفاده از این قابلیت باید رضایت ارسال محتوای گفتگو به هوش مصنوعی را بدهید.',
    consentRequired: true,
    consentText: aiFeat.CONSENT_TEXT,
  });
  return false;
}
/** دسترسی به اتاق — پیش از هر چیز دیگری در مسیرهای AI. */
function aiRoomGuard(req, res, rid) {
  const room = String(rid || '').slice(0, 120);
  if (!room || !canAccess(room, req.user.username)) { res.status(403).json({ error: 'دسترسی' }); return null; }
  return room;
}

/** خلاصهٔ امروزِ یک گفتگو یا کانال. */
app.post('/api/ai/digest', auth, async (req, res) => {
  if (!authRateOk('ai-digest:' + req.user.username, 10, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const body = req.body || {};
  // ۱) دسترسی  ۲) پیکربندی  ۳) رضایت  — این ترتیب عمدی است
  const room = aiRoomGuard(req, res, body.roomId);
  if (room === null) return;
  if (!ai.isConfigured()) return res.status(503).json({ error: AI_NOT_CONFIGURED });
  if (!aiConsentGate(req, res)) return;
  const out = await aiFeat.digest({
    username: req.user.username,
    isAdmin: req.user.isAdmin,
    roomId: room,
    force: body.force === true,
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error, resetsAt: out.resetsAt });
  res.json({ ok: true, digest: out.digest, cached: !!out.cached, empty: !!out.empty, label: 'خلاصهٔ امروز' });
});

/** ترجمهٔ زندهٔ یک پیام (fa ↔ en)، با کش به‌ازای هر پیام. */
app.post('/api/ai/translate', auth, async (req, res) => {
  if (!authRateOk('ai-translate:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const body = req.body || {};
  const room = aiRoomGuard(req, res, body.roomId);
  if (room === null) return;
  if (!ai.isConfigured()) return res.status(503).json({ error: AI_NOT_CONFIGURED });
  if (!aiConsentGate(req, res)) return;
  const out = await aiFeat.translate({
    username: req.user.username,
    isAdmin: req.user.isAdmin,
    roomId: room,
    msgId: body.msgId,
    to: body.to,
    force: body.force === true,
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error, resetsAt: out.resetsAt });
  res.json({ ok: true, text: out.text, lang: out.lang, cached: !!out.cached, label: aiFeat.TRANSLATION_LABEL });
});

/** تبدیل پیام صوتی به متن. */
app.post('/api/ai/transcribe', auth, async (req, res) => {
  if (!authRateOk('ai-transcribe:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const body = req.body || {};
  const room = aiRoomGuard(req, res, body.roomId);
  if (room === null) return;
  if (!ai.whisperAvailable()) return res.status(503).json({ error: 'تبدیل صدا به متن تنظیم نشده است.' });
  if (!aiConsentGate(req, res)) return;
  const out = await aiFeat.transcribe({
    username: req.user.username,
    isAdmin: req.user.isAdmin,
    roomId: room,
    msgId: body.msgId,
    force: body.force === true,
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error, resetsAt: out.resetsAt });
  res.json({ ok: true, text: out.text, cached: !!out.cached, label: 'متن پیام صوتی' });
});

/* ---------- پیام‌های ذخیره‌شده (نشانک) — کاملاً خصوصیِ هر کاربر ---------- */
app.get('/api/bookmarks', auth, (req, res) => {
  const list = aiFeat.listBookmarks(req.user.username);
  // فقط نشانک‌های خودِ کاربر؛ هیچ فیلد دیگری از پیام برگردانده نمی‌شود
  res.json({
    bookmarks: list.map((b) => ({ id: b.id, roomId: b.roomId, msgId: b.msgId, excerpt: b.excerpt, kind: b.kind, note: b.note, at: b.at })),
    count: list.length,
  });
});

app.post('/api/bookmarks', auth, (req, res) => {
  const { roomId, msgId, note } = req.body || {};
  const rid = String(roomId || '').slice(0, 120);
  // دسترسی: فقط پیامی که کاربر اجازهٔ خواندنش را دارد قابل ذخیره است
  if (!rid || !canAccess(rid, req.user.username)) return res.status(403).json({ error: 'دسترسی' });
  const m = findMsg(rid, String(msgId || '').slice(0, 64));
  if (!m) return res.status(404).json({ error: 'پیام یافت نشد' });
  const out = aiFeat.addBookmark(req.user.username, rid, m.id, note);
  if (!out.ok) return res.status(400).json({ error: out.error });
  // excerpt فقط برای نمایش فهرست؛ متن کامل پیام ذخیره نمی‌شود
  const saved = aiFeat.listBookmarks(req.user.username).find((b) => b.id === rid + '|' + m.id);
  if (saved) saved.excerpt = aiFeat.excerptOf(m);
  saveDB();
  res.json({ ok: true, count: out.count, duplicate: !!out.duplicate, bookmark: saved ? { id: saved.id, excerpt: saved.excerpt, at: saved.at } : null });
});

app.delete('/api/bookmarks/:id', auth, (req, res) => {
  const id = String(req.params.id || '');
  const out = aiFeat.removeBookmark(req.user.username, id);
  if (!out.ok) return res.status(out.status === 403 ? 403 : 404).json({ error: out.error || 'یافت نشد' });
  res.json({ ok: true, count: out.count });
});

/** برچسب متنی روی نشانک، برای یادداشت شخصی. */
app.post('/api/bookmarks/note', auth, (req, res) => {
  const { id, note } = req.body || {};
  const list = aiFeat.listBookmarks(req.user.username);
  const b = list.find((x) => x.id === String(id || ''));
  if (!b) return res.status(404).json({ error: 'یافت نشد' });
  b.note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  saveDB();
  res.json({ ok: true, bookmark: { id: b.id, note: b.note } });
});

/* ---------- خلاصهٔ زمان‌بندی‌شده (ربات) ---------- */
app.get('/api/ai/digest/schedules', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ schedules: aiFeat.listSchedules() });
});

app.post('/api/ai/digest/schedules', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  const body = req.body || {};
  const out = aiFeat.addSchedule({
    channelId: body.channelId,
    hour: body.hour,
    minute: body.minute,
    createdBy: req.user.username,
    promptNote: body.note,
  });
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json({ ok: true, schedule: out.schedule, updated: !!out.updated });
});

app.delete('/api/ai/digest/schedules/:id', auth, (req, res) => {
  const out = aiFeat.removeSchedule(String(req.params.id || ''), req.user.username);
  if (!out.ok) return res.status(out.status || 404).json({ error: out.error || 'یافت نشد' });
  res.json({ ok: true });
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
  // حریم خصوصی سمت سرور از طریق canSee() اعمال می‌شود (نه پنهان‌سازی در کلاینت):
  // lastSeen/profilePhoto با گراف مخاطبان سروری (پیام مستقیم مشترک یا لیست مخاطبان).
  const priv = (u.settings && u.settings.privacy) || {};
  const isSelf = req.user.username === u.username;
  const hideSeen = !canSee(req.user.username, u, 'lastSeen');
  const hidePresence = !isSelf && priv.presence === false;
  const showPhoto = canSee(req.user.username, u, 'profilePhoto');
  res.json({ username: u.username, displayName: u.displayName, avatar: showPhoto ? (u.avatar || null) : null, isPremium: !!u.isPremium, online: !hidePresence && online.has(u.username), lastSeen: hideSeen ? null : (u.lastSeen || null) });
});

// تکمیل مشخصات فرستنده در پیام‌های قدیمی که آواتار/پرمیوم ندارند
/* hiddenFor فقط لیست «فقط برای من پاک شده» است و نباید به بقیهٔ کاربران نشت کند. */
/* hiddenFor نباید هرگز به سمت کلاینت برود؛ فقط برای فیلتر داخلی سرور است */
/* ═══════════════════════════════════════════════════════════════════════
   شمارش بازدید یکتا برای پست‌های کانال (حریم خصوصی)
   ─ «تعداد بازدیدکنندهٔ یکتا» یعنی شمارنده فقط زیاد می‌شود و هرگز فهرست
     بیننده‌ها ذخیره یا منتشر نمی‌شود. برای اینکه شمارنده دوباره بالا نرود،
     یک اثر انگشت غیرقابل‌بازگشت از (کاربر + پیام) در حافظه نگه می‌داریم؛
     اگر سرور ری‌استارت شد شمارنده از صفر شروع می‌شود که بهتر از ذخیرهٔ
     هویت بیننده‌هاست. کاربر با تعداد یکسان برای همه بینندگان مواجه است.
   ═══════════════════════════════════════════════════════════════════════ */
const VIEW_FP_SALT = process.env.BOT_VIEW_SALT || 'vortexgram-view-fp-v1';
const viewSeen = new Set();      // "<fp>|<msgId>"
const viewSeenOrder = [];        // FIFO برای محدود کردن حافظه
const VIEW_SEEN_MAX = 20000;
function viewerFingerprint(username, msgId) {
  return crypto.createHash('sha256').update(VIEW_FP_SALT + '|' + username + '|' + msgId).digest('hex').slice(0, 32);
}
/** اگر این کاربر این پیام را قبلاً ندیده، شمارنده را یکی زیاد کن. */
function countUniqueView(username, msgId) {
  const fp = viewerFingerprint(username, msgId) + '|' + msgId;
  if (viewSeen.has(fp)) return false;
  viewSeen.add(fp); viewSeenOrder.push(fp);
  while (viewSeenOrder.length > VIEW_SEEN_MAX) { const old = viewSeenOrder.shift(); if (old) viewSeen.delete(old); }
  return true;
}
/** برای هر پیامِ کانال در این بازه، بازدید یکتا را ثبت می‌کند. */
function recordViews(messages, username) {
  let changed = false;
  for (const m of messages) {
    if (!m || !m.id || typeof m.views !== 'number') continue;
    if (m.from === username) continue;         // نویسنده بازدید خودش را نمی‌شمارد
    if (countUniqueView(username, m.id)) { m.views += 1; changed = true; }
  }
  if (changed) saveDB();
  return changed;
}

function enrichMsg(m, forWhom) {
  const u = db.users.find((x) => x.username === m.from);
  const { hiddenFor: _hf, ...pub } = m;
  return {
    ...pub,
    reactions: (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {},
    fromAvatar: (u && !canSee(forWhom, u, 'profilePhoto')) ? null : (m.fromAvatar || (u && u.avatar) || null),
    fromPremium: m.fromPremium || !!(u && u.isPremium),
    fromBot: !!(m.fromBot || (u && u.isBot)),
  };
}
// بهینه: map کاربران برای enrichMsg سریع
function enrichMsgBatch(messages, forWhom) {
  if (!messages.length) return [];
  const userMap = new Map();
  for (const m of messages) {
    if (m.from && !userMap.has(m.from)) userMap.set(m.from, db.users.find((x) => x.username === m.from));
  }
  return messages.map((m) => {
    const u = userMap.get(m.from);
    const { hiddenFor: _hf, ...pub } = m;
    return {
      ...pub,
      reactions: (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {},
      fromAvatar: (u && !canSee(forWhom, u, 'profilePhoto')) ? null : (m.fromAvatar || (u && u.avatar) || null),
      fromPremium: m.fromPremium || !!(u && u.isPremium),
      fromBot: !!(m.fromBot || (u && u.isBot)),
    };
  });
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
  auditAdmin(req, 'room-messages-read', roomId, { roomId, count: msgs.length });
  res.json({ roomId, messages: msgs });
});

app.get('/api/admin/audit', auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'فقط ادمین' });
  res.json({ audit: Array.isArray(db.adminAudit) ? db.adminAudit : [] });
});

// ---------- uploads ----------
// `null` در امضای زیر یعنی «بایت این جایگاه مهم نیست» (wildcard).
// برای MP4/M4A اندازه‌ی box اول (بایت ۴ام فایل) بین ضبط‌های واقعی فرق دارد
// (۰x۱۸ برای برخی، ۰x۲۰ و بزرگ‌تر برای اکثرشان) — پس باید wildcard باشد وگرنه
// ویدیو/صدای موبایل‌ها همیشه با «محتوا مطابقت ندارد» رد می‌شد.
const MAGIC_BYTES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'video/mp4': [[0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], [0x00, 0x00, 0x01, null, 0x66, 0x74, 0x79, 0x70]],
  'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
  'video/ogg': [[0x4F, 0x67, 0x67, 0x53]],
  'audio/mpeg': [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]],
  'audio/wav': [[0x52, 0x49, 0x46, 0x46]],
  'audio/ogg': [[0x4F, 0x67, 0x67, 0x53]],
  'audio/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
  'audio/x-matroska': [[0x1A, 0x45, 0xDF, 0xA3]],
  'audio/mp4': [[0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], [0x00, 0x00, 0x01, null, 0x66, 0x74, 0x79, 0x70]],
  'audio/x-m4a': [[0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], [0x00, 0x00, 0x01, null, 0x66, 0x74, 0x79, 0x70]],
  'audio/aac': [[0xFF, 0xF1], [0xFF, 0xF9]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'application/zip': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]],
  'text/plain': [],
};
function verifyMagicBytes(filePath, mimetype) {
  const sigs = MAGIC_BYTES[mimetype];
  if (!sigs) return false;
  if (sigs.length === 0) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return sigs.some((sig) => sig.every((b, i) => b === null || buf[i] === b));
  } catch { return false; }
}
function _printableRatio(buf) {
  if (!buf || !buf.length) return 0;
  let ok = 0;
  for (let i = 0; i < buf.length; i++) { const b = buf[i]; if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) ok++; }
  return ok / buf.length;
}
function findHiddenImageText(buf) {
  // PNG: tEXt/zTXt/iTXt chunks و دادهٔ افزوده پس از IEND
  if (buf && buf[0] === 0x89 && buf[1] === 0x50) {
    const iend = buf.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44]));
    if (iend > 0) {
      const tail = buf.slice(iend + 12);
      if (tail.length > 12 && _printableRatio(tail) > 0.6) return { why: 'png-trailing', sample: tail.slice(0, 80).toString('latin1') };
    }
    let i = 8;
    while (i + 12 <= buf.length) {
      const len = buf.readUInt32BE(i);
      const type = buf.slice(i + 4, i + 8).toString('latin1');
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        return { why: 'png-text-chunk', sample: buf.slice(i + 8, Math.min(i + 8 + len, i + 8 + 80)).toString('latin1') };
      }
      if (type === 'IEND') break;
      i += 12 + len;
    }
  }
  // JPEG: افزودهٔ پس از EOI یا طولانی‌متن‌های ASCII داخل بدنه
  if (buf && buf[0] === 0xff && buf[1] === 0xd8) {
    const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoi > 0 && eoi + 2 < buf.length) {
      const tail = buf.slice(eoi + 2);
      if (tail.length > 12 && _printableRatio(tail) > 0.6) return { why: 'jpeg-trailing', sample: tail.slice(0, 80).toString('latin1') };
    }
  }
  // عمومی: هر رشتهٔ printable > 48 بایت در بدنه
  let run = 0, start = 0, best = null;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) { if (run === 0) start = i; run++; if (run > 48) best = buf.slice(start, i + 1); }
    else run = 0;
  }
  if (best) return { why: 'long-printable-run', sample: best.slice(0, 80).toString('latin1') };
  return null;
}
function flagSuspiciousUpload(user, filePath, filename, mime, roomId) {
  try {
    const buf = fs.readFileSync(filePath);
    const found = findHiddenImageText(buf);
    if (!found) return false;
    const ip = String(user && user.lastLogin && user.lastLogin.ip ? user.lastLogin.ip : '') || '';
    const row = {
      id: crypto.randomUUID(), type: 'suspicious-image', time: Date.now(),
      fromUsername: user.username, fromUid: user.uid || null, fromPhone: user.phone || null,
      fromName: user.displayName || user.username, roomId: String(roomId || ''),
      ip: ip, device: String((user && user.devices && user.devices[0] && user.devices[0].ua) || ''),
      mime: mime, filename: filename, excerpt: found.sample.slice(0, 240), why: found.why,
    };
    db.reports = db.reports || []; db.reports.push(row);
    db.uploadFlags = db.uploadFlags || {};
    db.uploadFlags[filename] = { filename: filename, why: found.why, time: row.time, fromUsername: user.username, roomId: String(roomId || ''), excerpt: found.sample.slice(0, 240) };
    const u = db.users.find((x) => x.username === user.username); if (u) u.danger = true;
    saveDB();
    return true;
  } catch (e) { return false; }
}
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
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل مجاز نیست یا حجمش زیاد است' });
  const maxMB = req.user.isPremium ? LIMITS.premiumUploadMB : LIMITS.normalUploadMB;
  if (req.file.size > maxMB * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `حداکثر ${maxMB} مگابایت` + (req.user.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ') });
  }
  if (!uploadQuotaOk(req.user.username, req.file.size)) {
    fs.unlink(req.file.path, () => {});
    return res.status(429).json({ error: '??? ????? ???? - ?? ???? ???? ???? ??' });
  }
  const __rf = restrictedFlagsFor(req.user.username);
  if (__rf && __rf.restricted) {
    if (uploadDailyCount(req.user.username) >= (Number(__rf.filesPerDay) || 5)) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: '?? ??? ????? ??? ????? ??' });
    }
    const maxFile = Number(__rf.maxFileMB) || 100;
    if (req.file.size > maxFile * 1024 * 1024) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `?? ??? ???? ????? (${maxFile}MB) ?? ???? ??` });
    }
  }
  const m = cleanMime(req.file.mimetype);
  if (!verifyMagicBytes(req.file.path, m)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'محتوای فایل با نوع اعلام‌شده مطابقت ندارد' });
  }
  const kind = m.startsWith('image/') ? (m === 'image/gif' ? 'gif' : 'image') : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'file';
  if (kind === 'image' || kind === 'gif') flagSuspiciousUpload(req.user, req.file.path, req.file.filename, m, '');
  incUploadDaily(req.user.username);
  let finalUrl = '/uploads/' + req.file.filename;
  if (R2_ENABLED) {
    try {
      const r2Url = await r2Upload(req.file.path, r2Key(req.file.filename), m);
      if (r2Url) finalUrl = r2Url;
    } catch (e) {
      console.error('R2 upload failed, falling back to local:', e);
    }
    fs.unlink(req.file.path, () => {});
  }
  
  res.json({ url: finalUrl, mime: m, kind, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 80), size: req.file.size });
});

// ---------- GIF picker: fetch a remote GIF into /uploads ----------
// GIFهای «پرطرفدار» روی media.giphy.com میزبانی می‌شوند، ولی پیام‌رسان (خط ۲۱۳۱)
// فقط `/uploads/...` را می‌پذیرد؛ پس ارسال URL خارجی بی‌صدا دور ریخته می‌شد.
// به‌جای شل‌کردن آن قاعده (که مسیر SSRF و لینک‌های خصوصی را باز می‌کند)، خودِ سرور
// فایل را از میزبان‌های مجاز می‌گیرد، صحتش را با magic-bytes می‌سنجد و محلی ذخیره
// می‌کند. نتیجه یک URL `/uploads/...` است که برای همه‌ی گیرندگان کار می‌کند.
const GIF_REMOTE_HOSTS = new Set([
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com',
  'media3.giphy.com', 'media4.giphy.com', 'i.giphy.com', 'giphy.com',
  'media.tenor.com', 'c.tenor.com', 'tenor.com',
]);
const GIF_REMOTE_MAX_BYTES = 8 * 1024 * 1024;
app.post('/api/gif/ingest', auth, (req, res) => {
  if (!authRateOk('gif-ingest:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const raw = String(req.body && req.body.url || '');
  let u;
  try { u = new URL(raw); } catch { return res.status(400).json({ error: 'آدرس نامعتبر' }); }
  if (u.protocol !== 'https:') return res.status(400).json({ error: 'فقط https' });
  if (!GIF_REMOTE_HOSTS.has(u.hostname.toLowerCase())) return res.status(400).json({ error: 'میزبان مجاز نیست' });
  const port = Number(u.port) || 443;
  if (port !== 443) return res.status(400).json({ error: 'پورت غیرمجاز' });

  (async () => {
    let r;
    try {
      r = await fetchPublicUrl(u.href, { maxRedirects: 2, timeoutMs: 6000, headers: { 'User-Agent': 'VortexGramBot/1.0', 'Accept': 'image/gif,image/*' } });
    } catch { return res.status(502).json({ error: 'دریافت GIF ناموفق بود' }); }
    if (r.statusCode !== 200) { r.resume(); return res.status(502).json({ error: 'دریافت GIF ناموفق بود' }); }
    // بعد از ریدایرکت هم باید روی همان میزبان‌های مجاز مانده باشیم (ضد SSRF)
    try {
      const fin = new URL(r.finalUrl || r.headers.location || u.href);
      if (fin.protocol !== 'https:' || !GIF_REMOTE_HOSTS.has(fin.hostname.toLowerCase())) { r.resume(); return res.status(400).json({ error: 'مقصد ریدایرکت مجاز نیست' }); }
    } catch { r.resume(); return res.status(400).json({ error: 'ریدایرکت نامعتبر' }); }

    const chunks = [];
    let size = 0;
    r.on('data', (c) => {
      size += c.length;
      if (size > GIF_REMOTE_MAX_BYTES) { r.destroy(); return; }
      chunks.push(c);
    });
    r.on('error', () => {});
    r.on('end', async () => {
      if (size > GIF_REMOTE_MAX_BYTES || !chunks.length) return res.status(502).json({ error: 'GIF خالی یا بیش از حد بزرگ است' });
      const buf = Buffer.concat(chunks);
      if (!(buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)) return res.status(400).json({ error: 'فایل دریافتی GIF نیست' });
      const filename = Date.now() + '-' + crypto.randomBytes(5).toString('hex') + '.gif';
      const dest = path.join(UPLOAD_DIR, filename);
      try { fs.writeFileSync(dest, buf); } catch { return res.status(500).json({ error: 'ذخیره ناموفق بود' }); }
      let finalUrl = '/uploads/' + filename;
      if (R2_ENABLED) {
        try {
          const r2Url = await r2Upload(dest, r2Key(filename), 'image/gif');
          if (r2Url) finalUrl = r2Url;
        } catch (e) {
          console.error('R2 gif ingest failed, falling back to local:', e);
        }
        fs.unlink(dest, () => {});
      }
      if (!uploadQuotaOk(req.user.username, buf.length)) { fs.unlink(dest, () => {}); return res.status(429).json({ error: 'سقف آپلود رسید — یک ساعت دیگر تلاش کن' }); }
      res.json({ url: finalUrl, mime: 'image/gif', kind: 'gif', name: 'gif', size: buf.length });
    });
  })();
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
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400'),
}));

// ---------- groups & channels ----------
const GROUP_CATEGORIES = ['tech', 'finance', 'sports', 'culture', 'fun', 'learn', 'media', 'games', 'study', 'other'];
function cleanCategory(v) {
  const c = String(v || '').trim().toLowerCase();
  return GROUP_CATEGORIES.includes(c) ? c : null;
}
// دسته‌بندی قطعی از فیلد ذخیره‌شده؛ در غیر این صورت حدس از روی نام/آیدی/توضیح، وگرنه «سایر»
function categorizeChannel(g) {
  const explicit = g && cleanCategory(g.category);
  if (explicit) return explicit;
  const hay = String(((g && g.username) || '') + ' ' + ((g && g.name) || '') + ' ' + ((g && g.description) || '')).toLowerCase();
  const has = (...words) => words.some((w) => hay.includes(w));
  if (has('tech', 'ai', 'هوش مصنوعی', 'تکنولوژی', 'فناوری', 'برنامه')) return 'tech';
  if (has('forex', 'dollar', 'دلار', 'ارز', 'طلا', 'gold', 'بورس', 'crypto', 'کریپتو', 'بیت', 'finance', 'مالی')) return 'finance';
  if (has('football', 'فوتبال', 'ورزش', 'sport', 'perspolis', 'esteghlal')) return 'sports';
  if (has('hafez', 'حافظ', 'فال', 'ادبیات', 'شعر', 'کتاب', 'فرهنگ')) return 'culture';
  if (has('joke', 'جوک', 'طنز', 'چالش', 'meme', 'میم', 'fun', 'سرگرمی')) return 'fun';
  if (has('english', 'انگلیسی', 'زبان', 'learn', 'آموزش', 'یادگیری')) return 'learn';
  if (has('movie', 'film', 'فیلم', 'سریال', 'سینما', 'media', 'رسانه')) return 'media';
  if (has('game', 'بازی', 'گیم', 'gaming')) return 'games';
  if (has('konkur', 'کنکور', 'درس', 'مطالعه', 'study', 'تحصیلی')) return 'study';
  return 'other';
}
function publicGroups(username) {
  // گروه‌ها خصوصی‌اند: فقط برای اعضا نمایش داده می‌شوند
  return db.groups.filter((g) => memberOf(g, username)).map((g) => {
    const me = memberOf(g, username);
    return {
      id: g.id, type: g.type || 'group', name: g.name, owner: g.owner,
      members: (g.members || []).map((m) => ({ username: m.username, role: m.role })),
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
  if (type === 'channel') {
    const rawU = String((req.body || {}).username || '').trim().replace(/^@/, '').toLowerCase();
    if (rawU) {
      if (!/^[a-z0-9_]{3,20}$/.test(rawU)) return res.status(400).json({ error: 'ایدی کانال ۳-۲۰ حرف/عدد/_' });
      if (db.groups.some((x) => x.username === rawU)) return res.status(409).json({ error: 'این ایدی قبلا گرفته شده' });
      g.username = rawU;
    }
    const vis = String((req.body || {}).visibility || 'private');
    if (!['public', 'private'].includes(vis)) return res.status(400).json({ error: 'نوع نامعتبر' });
    g.visibility = vis;
  }
  const desc = String((req.body || {}).description || '').trim().slice(0, 200);
  if (desc) g.description = desc;
  const catBody = (req.body || {}).category;
  if (catBody !== undefined && catBody !== null && catBody !== '') {
    const cat = cleanCategory(catBody);
    if (!cat) return res.status(400).json({ error: 'دسته‌بندی نامعتبر' });
    g.category = cat;
  }
  db.groups.push(g);
  saveDB();
  broadcastGroups();
  res.json({ ok: true, group: { id: g.id, name: g.name, type, username: g.username || null, visibility: g.visibility || null, description: g.description || null, category: g.category || null } });
});

app.post('/api/groups/:id/join', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username)) {
    const s = groupSettings(g);
    if (s.joinByRequest && g.owner !== req.user.username) {
      if (!s.joinRequests.some((r) => r.username === req.user.username)) s.joinRequests.push({ username: req.user.username, at: Date.now() });
      saveDB();
      return res.json({ ok: true, pending: true });
    }
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
    members: g.members.map((m) => {
      const mu = db.users.find((u) => u.username === m.username);
      return { ...m, displayName: (mu && mu.displayName) || m.username, avatar: (mu && canSee(req.user.username, mu, 'profilePhoto')) ? (mu.avatar || null) : null };
    }),
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
  /* حریم خصوصی: «چه کسانی می‌توانند من را به گروه اضافه کنند» سمت سرور اعمال می‌شود */
  if (!canSee(req.user.username, target, 'addToGroups')) return res.status(403).json({ error: 'حریم خصوصی این کاربر اجازهٔ افزودن به گروه/کانال را نمی‌دهد' });
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

app.post('/api/groups/:id/avatar', auth, avatarUpload.single('avatar'), async (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (g.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'فقط مالک' });
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد' });
  const __rfG = restrictedFlagsFor(req.user.username);
  if (__rfG && __rfG.restricted && __rfG.noAvatar !== false) { fs.unlink(req.file.path, () => {}); return res.status(403).json({ error: '?? ??? ????? ??? ????? ???' }); }
  flagSuspiciousUpload(req.user, req.file.path, req.file.filename, cleanMime(req.file.mimetype), 'group:' + (g.id || req.params.id));
  incUploadDaily(req.user.username);
  g.avatar = await durableUpload(req.file.path, req.file.filename, cleanMime(req.file.mimetype));
  if (R2_ENABLED) { try { fs.unlink(req.file.path, () => {}); } catch (e) {} }
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

// ---------- جستجوی گروه/کانال ----------
// فقط گروه/کانالی قابل پیدا شدن است که ایدی عمومی (username) داشته باشد
// (برای کانال باید visibility=public هم باشد)؛ بقیه فقط با لینک دعوت وارد می‌شوند.
app.get('/api/groups/search', auth, (req, res) => {
  if (!authRateOk('gsearch:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'کمی آرام‌تر' });
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ groups: [] });
  const isAdmin = !!req.user.isAdmin;
  const out = db.groups
    .filter((g) => {
      if (isAdmin) return true;
      if (memberOf(g, req.user.username)) return false;
      if (!g.username) return false;
      if ((g.type || 'group') === 'channel' && g.visibility !== 'public') return false;
      return true;
    })
    .filter((g) => (g.username || '').includes(q) || g.name.toLowerCase().includes(q) || (g.id || '').toLowerCase() === q)
    .slice(0, 15)
    .map((g) => ({ id: g.id, name: g.name, type: g.type || 'group', username: g.username || null, description: g.description || null, category: categorizeChannel(g), members: (g.members || []).length, avatar: g.avatar || null }));
  res.json({ groups: out });
});

// ---------- پیشنهاد کانال‌های عمومی (اکسپلور) ----------
// فقط کانال‌های عمومیِ دارای آیدی که کاربر هنوز عضو آن‌ها نیست؛ مرتب بر اساس تعداد اعضا
app.get('/api/groups/explore', auth, (req, res) => {
  if (!authRateOk('gexplore:' + req.user.username, 30, 60 * 1000)) return res.status(429).json({ error: 'کمی آرام‌تر' });
  const out = db.groups
    .filter((g) => (g.type || 'group') === 'channel' && g.visibility === 'public' && g.username && !memberOf(g, req.user.username))
    .map((g) => ({ id: g.id, name: g.name, type: 'channel', username: g.username, description: g.description || null, category: categorizeChannel(g), members: (g.members || []).length, avatar: g.avatar || null }))
    .sort((a, b) => b.members - a.members)
    .slice(0, 12);
  res.json({ groups: out });
});

// channel/group edit: rename, username, visibility
app.patch('/api/groups/:id', auth, (req, res)=>{
  const g=findGroup(req.params.id);
  if(!g) return res.status(404).json({error:'یافت نشد'});
  if(g.owner!==req.user.username && !req.user.isAdmin) return res.status(403).json({error:'فقط مالک'});
  const {name, username, visibility, description, avatar, category} = req.body||{};
  if(typeof name==='string'){
    const n=name.trim();
    if(n.length<2||n.length>30) return res.status(400).json({error:'نام ۲ تا ۳۰ کاراکتر'});
    g.name=n;
  }
  const cat = category === undefined || category === null || category === '' ? undefined : cleanCategory(category);
  if (category !== undefined && category !== null && category !== '' && !cat) return res.status(400).json({error:'دسته‌بندی نامعتبر'});
  if (cat) g.category = cat;
  if(typeof description==='string'){
    const ds=description.trim();
    g.description = ds ? ds.slice(0,200) : undefined;
  }
  if(typeof avatar==='string'){ g.avatar = null; }
  if(typeof username==='string'){
    let u=username.trim().replace(/^@/,'').toLowerCase();
    if(u){
      if(!/^[a-z0-9_]{3,20}$/.test(u)) return res.status(400).json({error:'ایدی ۳-۲۰ حرف/عدد/_'});
      if(db.groups.some(x=>x.username===u && x.id!==g.id)) return res.status(409).json({error:'ایدی قبلا گرفته شده'});
      g.username=u;
    } else g.username=null;
  }
  if(typeof visibility==='string'){
    if(!['public','private'].includes(visibility)) return res.status(400).json({error:'نوع نامعتبر'});
    g.visibility=visibility;
  }
  saveDB(); broadcastGroups();
  res.json({ok:true, group:g});
});

/* ═══════════════════════════════════════════════════════════════════════
   Group / Channel settings (Telegram-style info + settings panel)
   ─ A single normalized `g.settings` document per group keeps the schema
     stable while the UI grows. Every write goes through a whitelist so a
     client can never inject arbitrary keys into the persisted DB.
   ─ Permission checks live here, never in the UI alone.
   ═══════════════════════════════════════════════════════════════════════ */

const GS_PERM_KEYS = ['sendMessages', 'sendPhotos', 'sendVideos', 'sendStickers', 'sendMusic', 'sendFiles', 'sendVoice', 'sendVideoMessages', 'sendPolls', 'embedLinks', 'addMembers', 'pinMessages', 'changeInfo'];
const GS_BOOL_KEYS = ['protectedContent', 'joinByRequest', 'signMessages', 'showAdminNames', 'silentSendDefault', 'historyVisible'];
const GS_ADMIN_RIGHTS = ['changeInfo', 'deleteMessages', 'banUsers', 'inviteUsers', 'pinMessages', 'manageCalls', 'anonymous', 'addAdmins', 'postMessages', 'editMessages', 'deleteOthers'];
const GS_REACTION_SET = ['👍', '❤️', '🔥', '🎉', '😁', '🤔', '👎', '😢', '💯', '🙏', '👏', '🥰', '🤩', '😍', '😮', '🤯', '😡', '🤝'];

function groupSettings(g) {
  if (!g.settings || typeof g.settings !== 'object') g.settings = {};
  const s = g.settings;
  if (!s.permissions || typeof s.permissions !== 'object') s.permissions = {};
  for (const k of GS_PERM_KEYS) if (typeof s.permissions[k] !== 'boolean') s.permissions[k] = true;
  for (const k of GS_BOOL_KEYS) if (typeof s[k] !== 'boolean') s[k] = k === 'showAdminNames';
  if (typeof s.slowMode !== 'number' || s.slowMode < 0 || !isFinite(s.slowMode)) s.slowMode = 0;
  if (s.discussionGroupId === undefined) s.discussionGroupId = null;
  if (!s.reactions || typeof s.reactions !== 'object') s.reactions = { mode: 'all', set: GS_REACTION_SET.slice(0, 8) };
  if (!['all', 'some', 'none'].includes(s.reactions.mode)) s.reactions.mode = 'all';
  if (!Array.isArray(s.reactions.set)) s.reactions.set = GS_REACTION_SET.slice(0, 8);
  if (!s.exceptions || typeof s.exceptions !== 'object') s.exceptions = {};
  if (!s.admins || typeof s.admins !== 'object') s.admins = {};
  if (!Array.isArray(s.inviteLinks)) s.inviteLinks = [];
  if (!Array.isArray(s.joinRequests)) s.joinRequests = [];
  if (!Array.isArray(s.banned)) s.banned = [];
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}
function groupAdminOf(g, username) {
  if (!username) return false;
  if (g.owner === username) return true;
  const m = memberOf(g, username);
  return !!(m && m.role === 'admin');
}
function groupOwnerOrSiteAdmin(g, user) { return !!user && (user.isAdmin || g.owner === user.username); }
function gsLogPush(g, actor, action, target, extra) {
  const s = groupSettings(g);
  s.log.unshift({ id: crypto.randomBytes(5).toString('hex'), actor: actor || null, action, target: target || null, extra: extra || null, at: Date.now() });
  if (s.log.length > 300) s.log.length = 300;
}
function gsBase(req) { return (req.protocol || 'https') + '://' + (req.get('host') || 'vortexgram.onrender.com'); }
function gsInviteLink(req, g) {
  if (!g.inviteToken) { g.inviteToken = crypto.randomBytes(8).toString('hex'); saveDB(); }
  return gsBase(req) + '/join/' + g.inviteToken;
}
function gsMemberPayload(g, viewer) {
  const out = [];
  for (const m of (g.members || [])) {
    const u = db.users.find((x) => x.username === m.username);
    const s = groupSettings(g);
    const rights = (s.admins[m.username] && s.admins[m.username].rights) || {};
    const ex = s.exceptions[m.username] || null;
    out.push({
      username: m.username,
      displayName: (u && u.displayName) || m.username,
      avatar: (u && canSee(viewer, u, 'profilePhoto')) ? (u.avatar || null) : null,
      online: online.has(m.username),
      role: m.role === 'owner' ? 'owner' : (m.role === 'admin' ? 'admin' : 'member'),
      title: (s.admins[m.username] && s.admins[m.username].title) || null,
      rights,
      restriction: ex,
    });
  }
  return out;
}

/* ── info + settings (read) ── */
app.get('/api/groups/:id/settings', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username) && !req.user.isAdmin) return res.status(403).json({ error: 'عضو نیستی' });
  const s = groupSettings(g);
  const isStaff = groupAdminOf(g, req.user.username) || req.user.isAdmin;
  res.json({
    ok: true,
    info: {
      id: g.id, type: g.type || 'group', name: g.name,
      username: g.username || null,
      visibility: g.visibility || (g.username ? 'public' : 'private'),
      description: g.description || '', avatar: g.avatar || null,
      owner: g.owner, createdAt: g.createdAt || null,
      memberCount: (g.members || []).length,
      onlineCount: (g.members || []).filter((m) => online.has(m.username)).length,
      myRole: g.owner === req.user.username ? 'owner' : ((memberOf(g, req.user.username) || {}).role || null),
      inviteLink: gsInviteLink(req, g),
      staffCount: (g.members || []).filter((m) => m.role === 'admin' || m.role === 'owner').length,
    },
    settings: {
      permissions: s.permissions,
      slowMode: s.slowMode,
      protectedContent: s.protectedContent,
      joinByRequest: s.joinByRequest,
      signMessages: s.signMessages,
      showAdminNames: s.showAdminNames,
      silentSendDefault: s.silentSendDefault,
      historyVisible: s.historyVisible,
      discussionGroupId: s.discussionGroupId,
      reactions: s.reactions,
      exceptions: isStaff ? s.exceptions : {},
    },
    isStaff,
  });
});

/* ── settings (write) ── */
app.patch('/api/groups/:id/settings', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  const body = req.body || {};
  if (body.permissions && typeof body.permissions === 'object') {
    for (const k of GS_PERM_KEYS) {
      if (typeof body.permissions[k] === 'boolean') s.permissions[k] = body.permissions[k];
    }
  }
  for (const k of GS_BOOL_KEYS) {
    if (typeof body[k] === 'boolean') s[k] = body[k];
  }
  if (typeof body.slowMode === 'number') {
    const allowed = [0, 10, 30, 60, 300, 900, 3600];
    s.slowMode = allowed.includes(body.slowMode) ? body.slowMode : Math.max(0, Math.min(3600, Math.floor(body.slowMode)));
  }
  if (typeof body.discussionGroupId === 'string' || body.discussionGroupId === null) {
    const did = body.discussionGroupId;
    if (did) {
      const dg = findGroup(did);
      if (!dg) return res.status(404).json({ error: 'گروه گفتگو یافت نشد' });
      if (dg.id === g.id) return res.status(400).json({ error: 'گروه گفتگو نمی‌تواند خودش باشد' });
      s.discussionGroupId = did;
    } else s.discussionGroupId = null;
  }
  if (body.reactions && typeof body.reactions === 'object') {
    const mode = body.reactions.mode;
    if (!['all', 'some', 'none'].includes(mode)) return res.status(400).json({ error: 'حالت واکنش نامعتبر' });
    const set = Array.isArray(body.reactions.set) ? body.reactions.set.filter((e) => GS_REACTION_SET.includes(e)).slice(0, 20) : s.reactions.set;
    s.reactions = { mode, set };
  }
  gsLogPush(g, req.user.username, 'change-info', null, 'تنظیمات');
  saveDB();
  broadcastGroups();
  res.json({ ok: true, settings: { permissions: s.permissions, slowMode: s.slowMode, protectedContent: s.protectedContent, joinByRequest: s.joinByRequest, signMessages: s.signMessages, showAdminNames: s.showAdminNames, silentSendDefault: s.silentSendDefault, historyVisible: s.historyVisible, discussionGroupId: s.discussionGroupId, reactions: s.reactions } });
});

/* ── admins ── */
app.get('/api/groups/:id/admins', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username) && !req.user.isAdmin) return res.status(403).json({ error: 'عضو نیستی' });
  const s = groupSettings(g);
  const out = (g.members || []).filter((m) => m.role === 'admin' || m.role === 'owner').map((m) => {
    const u = db.users.find((x) => x.username === m.username);
    const meta = s.admins[m.username] || {};
    return {
      username: m.username,
      displayName: (u && u.displayName) || m.username,
      avatar: (u && canSee(req.user.username, u, 'profilePhoto')) ? (u.avatar || null) : null,
      role: m.role === 'owner' ? 'owner' : 'admin',
      title: meta.title || null,
      rights: meta.rights || {},
      appointedBy: meta.appointedBy || (m.role === 'owner' ? null : g.owner),
      appointedAt: meta.appointedAt || null,
    };
  });
  res.json({ ok: true, admins: out });
});

app.post('/api/groups/:id/admins/:username', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String(req.params.username || '');
  const m = memberOf(g, uname);
  if (!m) return res.status(404).json({ error: 'عضو نیست' });
  if (m.role === 'owner') return res.status(400).json({ error: 'مالک قابل ویرایش نیست' });
  const s = groupSettings(g);
  if (m.role !== 'admin') { m.role = 'admin'; }
  const meta = s.admins[uname] || {};
  const rights = {};
  const bodyRights = (req.body && req.body.rights) || {};
  for (const k of GS_ADMIN_RIGHTS) {
    rights[k] = typeof bodyRights[k] === 'boolean' ? bodyRights[k] : (typeof meta.rights?.[k] === 'boolean' ? meta.rights[k] : false);
  }
  meta.rights = rights;
  let title = (req.body && req.body.title);
  if (typeof title === 'string') {
    title = title.trim().slice(0, 16);
    meta.title = title || null;
  }
  meta.appointedBy = meta.appointedBy || req.user.username;
  meta.appointedAt = meta.appointedAt || Date.now();
  s.admins[uname] = meta;
  gsLogPush(g, req.user.username, 'promote', uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

app.delete('/api/groups/:id/admins/:username', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String(req.params.username || '');
  const m = memberOf(g, uname);
  if (!m) return res.status(404).json({ error: 'عضو نیست' });
  if (m.role === 'owner') return res.status(400).json({ error: 'مالک حذف نمی‌شود' });
  m.role = 'member';
  const s = groupSettings(g);
  delete s.admins[uname];
  gsLogPush(g, req.user.username, 'demote', uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

/* ── per-user restrictions / exceptions ── */
app.post('/api/groups/:id/restrict/:username', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String(req.params.username || '');
  if (uname === g.owner) return res.status(400).json({ error: 'مالک قابل محدودسازی نیست' });
  const m = memberOf(g, uname);
  if (!m) return res.status(404).json({ error: 'عضو نیست' });
  const s = groupSettings(g);
  const body = req.body || {};
  if (body.clear) { delete s.exceptions[uname]; }
  else {
    const perms = {};
    const bp = body.permissions || {};
    for (const k of GS_PERM_KEYS) if (typeof bp[k] === 'boolean') perms[k] = bp[k];
    let until = body.until === undefined ? null : body.until;
    if (until !== null) {
      if (typeof until !== 'number' || !isFinite(until) || until <= Date.now()) until = null;
    }
    s.exceptions[uname] = { permissions: perms, until };
  }
  gsLogPush(g, req.user.username, body.clear ? 'unrestrict' : 'restrict', uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true, exception: s.exceptions[uname] || null });
});

/* ── invite links ── */
app.get('/api/groups/:id/invite-links', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username) && !req.user.isAdmin) return res.status(403).json({ error: 'عضو نیستی' });
  const s = groupSettings(g);
  const base = gsBase(req);
  res.json({
    ok: true,
    primary: { link: gsInviteLink(req, g) },
    links: s.inviteLinks.map((l) => ({ ...l, link: base + '/join/' + l.token, invite: base + '/invite/' + l.token })),
  });
});

app.post('/api/groups/:id/invite-links', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : '';
  let expiresAt = null;
  if (typeof body.expiresAt === 'number' && body.expiresAt > Date.now()) expiresAt = body.expiresAt;
  let maxUses = 0;
  if (typeof body.maxUses === 'number' && body.maxUses > 0) maxUses = Math.min(100000, Math.floor(body.maxUses));
  const link = {
    token: crypto.randomBytes(8).toString('hex'),
    name: name || null,
    expiresAt,
    maxUses,
    uses: 0,
    approve: !!body.approve,
    createdAt: Date.now(),
    createdBy: req.user.username,
    revoked: false,
  };
  s.inviteLinks.unshift(link);
  gsLogPush(g, req.user.username, 'invite-create', null, link.token);
  saveDB();
  const base = gsBase(req);
  res.json({ ok: true, link: { ...link, link: base + '/join/' + link.token, invite: base + '/invite/' + link.token } });
});

app.delete('/api/groups/:id/invite-links/:token', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  const l = s.inviteLinks.find((x) => x.token === req.params.token);
  if (!l) return res.status(404).json({ error: 'لینک یافت نشد' });
  l.revoked = true; l.revokedAt = Date.now();
  gsLogPush(g, req.user.username, 'invite-revoke', null, l.token);
  saveDB();
  res.json({ ok: true });
});

/* ── join requests ── */
app.get('/api/groups/:id/join-requests', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  const base = gsBase(req);
  res.json({
    ok: true,
    requests: s.joinRequests.map((r) => {
      const u = db.users.find((x) => x.username === r.username);
      return { username: r.username, displayName: (u && u.displayName) || r.username, avatar: (u && u.avatar) || null, at: r.at, link: r.token ? base + '/join/' + r.token : null };
    }),
  });
});

app.post('/api/groups/:id/join-requests/:username', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String(req.params.username || '');
  const action = (req.body || {}).action;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'عملیات نامعتبر' });
  const s = groupSettings(g);
  s.joinRequests = s.joinRequests.filter((r) => r.username !== uname);
  if (action === 'approve' && !memberOf(g, uname)) g.members.push({ username: uname, role: 'member' });
  gsLogPush(g, req.user.username, action === 'approve' ? 'join-approve' : 'join-reject', uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

/* ── banned (blocked) users ── */
app.get('/api/groups/:id/banned', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  res.json({ ok: true, banned: s.banned.map((b) => { const u = db.users.find((x) => x.username === b.username); return { ...b, displayName: (u && u.displayName) || b.username, avatar: (u && u.avatar) || null }; }) });
});

app.post('/api/groups/:id/banned/:username', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String(req.params.username || '');
  const s = groupSettings(g);
  if ((req.body || {}).unban) {
    s.banned = s.banned.filter((b) => b.username !== uname);
    gsLogPush(g, req.user.username, 'unban', uname);
  } else {
    if (!s.banned.some((b) => b.username === uname)) s.banned.push({ username: uname, at: Date.now(), by: req.user.username });
    g.members = g.members.filter((m) => m.username !== uname || m.role === 'owner');
    gsLogPush(g, req.user.username, 'ban', uname);
  }
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

/* ── admin log ── */
app.get('/api/groups/:id/log', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const s = groupSettings(g);
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 60));
  res.json({ ok: true, log: s.log.slice(0, limit) });
});

/* ── aggregated media for the info tabs ── */
app.get('/api/groups/:id/media', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!memberOf(g, req.user.username) && !req.user.isAdmin) return res.status(403).json({ error: 'عضو نیستی' });
  const all = (db.messages['group:' + g.id] || []);
  const kind = String(req.query.kind || 'media');
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 60));
  const deletes = new Set(db.deletedMsgs || []);
  const items = [];
  for (let i = all.length - 1; i >= 0 && items.length < limit; i--) {
    const m = all[i];
    if (!m || deletes.has(m.id)) continue;
    const k = String(m.kind || 'text');
    let ok = false;
    if (kind === 'media') ok = ['image', 'video', 'gif', 'sticker'].includes(k);
    else if (kind === 'files') ok = ['file', 'document'].includes(k);
    else if (kind === 'links') ok = !!m.link || /https?:\/\//i.test(String(m.content || ''));
    else if (kind === 'music') ok = ['audio', 'music'].includes(k);
    else if (kind === 'voice') ok = ['voice', 'video_message'].includes(k);
    else if (kind === 'gif') ok = k === 'gif';
    if (!ok) continue;
    items.push({ id: m.id, kind: k, src: m.src || m.url || null, name: m.name || null, size: m.size || null, content: m.content || '', time: m.time || null, from: m.from || null, fromName: m.fromName || m.from || null, link: m.link || null });
  }
  res.json({ ok: true, kind, items });
});

/* ── ownership transfer ── */
app.post('/api/groups/:id/transfer', auth, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'یافت نشد' });
  if (!groupOwnerOrSiteAdmin(g, req.user)) return res.status(403).json({ error: 'فقط مالک' });
  const uname = String((req.body || {}).username || '');
  if (!memberOf(g, uname)) return res.status(404).json({ error: 'عضو نیست' });
  if (uname === g.owner) return res.status(400).json({ error: 'همین کاربر مالک است' });
  const s = groupSettings(g);
  const oldOwner = g.owner;
  g.owner = uname;
  const om = memberOf(g, oldOwner); if (om) om.role = 'admin';
  const nm = memberOf(g, uname); if (nm) nm.role = 'owner';
  s.admins[oldOwner] = Object.assign({}, s.admins[oldOwner], { rights: s.admins[oldOwner]?.rights || {} });
  delete s.admins[uname];
  gsLogPush(g, req.user.username, 'transfer', uname);
  saveDB();
  broadcastGroups();
  res.json({ ok: true });
});

/* ── username availability (for the Type page) ── */
app.get('/api/groups/username-available', auth, (req, res) => {
  const raw = String(req.query.u || '').trim().replace(/^@/, '').toLowerCase();
  if (!raw) return res.json({ ok: true, available: false, reason: 'خالی' });
  if (!/^[a-z0-9_]{3,20}$/.test(raw)) return res.json({ ok: true, available: false, reason: 'format' });
  if (/^[0-9]/.test(raw)) return res.json({ ok: true, available: false, reason: 'format' });
  const taken = db.groups.some((x) => x.username === raw) || db.users.some((x) => x.username === raw);
  res.json({ ok: true, available: !taken, reason: taken ? 'taken' : null });
});

/* ═══════════════════════════════════════════════════════════════════════
   حساب‌های ربات و API انتشار (n8n)
   ─ ربات یک سطر واقعی در db.users با isBot:true است؛ مالک کانال می‌شود و
     عضویت/حضورش مثل بقیه کار می‌کند، اما ورود انسانی برایش قفل است.
   ─ کلید API فقط به‌صورت HMAC ذخیره می‌شود و متن خام فقط یک‌بار هنگام
     ساخت/چرخش نمایش داده می‌شود.
   ─ پست‌های دارای منبع خارجی، فیلد ساختاریافتهٔ source می‌گیرند و پست‌های
     تولیدشده با هوش مصنوعی برچسب ثابت می‌گیرند؛ هیچ‌کدام داخل متن پیام
     الحاق نمی‌شوند.
   ═══════════════════════════════════════════════════════════════════════ */

// ---------- middleware: احراز هویت با کلید ربات ----------
// کلید در هدر Authorization: Bearer می‌آید. فقط هش HMAC ذخیره‌شده مقایسه می‌شود
// (مقایسهٔ زمان-ثابت)، پس متن خلاص هرگز از حافظه خارج نمی‌شود.
function botAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const raw = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!raw) return res.status(401).json({ error: 'کلید ربات ارسال نشده است (هدر Authorization: Bearer)' });
  if (!raw.startsWith('vxk_')) {
    // نشت کلید نشست کاربر به‌جای کلید ربات
    return res.status(401).json({ error: 'قالب کلید ربات نامعتبر است' });
  }
  const parsed = bots.parseKey(raw);
  if (!parsed) return res.status(401).json({ error: 'کلید ربات نامعتبر است' });
  const rec = botApiKeys().find((k) => k.keyId === parsed.keyId);
  if (!rec) return res.status(401).json({ error: 'کلید ربات نامعتبر است' });
  if (rec.status !== 'active') return res.status(401).json({ error: 'این کلید ربات باطل شده است' });
  if (!bots.safeEqualHex(rec.keyHash, bots.hashKey(parsed.secret, parsed.keyId))) {
    return res.status(401).json({ error: 'کلید ربات نامعتبر است' });
  }
  const user = db.users.find((u) => u.username === rec.botUsername);
  if (!user) return res.status(401).json({ error: 'حساب ربات یافت نشد' });
  if (!user.isBot) return res.status(403).json({ error: 'این حساب ربات نیست' });
  if (user.banned) return res.status(403).json({ error: 'حساب ربات مسدود شده است' });
  rec.lastUsedAt = Date.now();
  req.bot = user;
  req.botKey = rec;
  next();
}

// ---------- ساخت/نمایش/چرخش/ابطال کلید ----------
function mintBotKey(botUsername, label) {
  const { raw, keyId, secret } = bots.generateKey();
  const rec = {
    keyId,
    botUsername,
    keyHash: bots.hashKey(secret, keyId),
    keyPrefix: raw.slice(0, 16),
    status: 'active',
    createdAt: Date.now(),
    label: bots.cleanLine(label, 60) || null,
  };
  botApiKeys().push(rec);
  return { raw, rec };
}

// ---------- API مدیریت ربات‌ها (فقط ادمین) ----------
function requireAdmin(req, res) {
  if (!req.user || !req.user.isAdmin) { res.status(403).json({ error: 'فقط ادمین' }); return false; }
  return true;
}

app.get('/api/admin/bots', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  const out = db.users.filter((u) => u.isBot).map((u) => ({
    username: u.username,
    displayName: u.displayName,
    bio: u.bio || '',
    avatar: u.avatar || null,
    createdAt: u.createdAt || null,
    banned: !!u.banned,
    channels: db.groups.filter((g) => g.owner === u.username).map((g) => ({ id: g.id, name: g.name, username: g.username || null, type: g.type, category: g.category || null })),
    keys: botApiKeys().filter((k) => k.botUsername === u.username).map(bots.publicKeyRecord),
  }));
  res.json({ bots: out });
});

app.post('/api/admin/bots', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!authRateOk('admin-bot-create:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  const body = req.body || {};
  const username = bots.cleanLine(body.username, bots.LIMITS.botUsernameMax || 20).toLowerCase();
  const displayName = bots.cleanLine(body.displayName, 30);
  const bio = bots.cleanLine(body.bio, 200);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'نام کاربری ربات: ۳ تا ۲۰ حرف انگلیسی کوچک/عدد/_' });
  if (!displayName || displayName.length < 2) return res.status(400).json({ error: 'نام نمایشی حداقل ۲ حرف' });
  if (db.users.some((u) => u.username.toLowerCase() === username)) return res.status(409).json({ error: 'این نام کاربری قبلا ثبت شده' });

  // ربات عمداً بدون phone/salt/passHash ساخته می‌شود: نه رمز دارد، نه شماره،
  // پس هیچ مسیر ورودی (رمز یا کد یک‌بارمصرف) نتیجه‌ای برایش ندارد.
  const bot = {
    username,
    uid: nextUid(),
    displayName,
    isAdmin: false,
    isBot: true,
    banned: false,
    createdAt: Date.now(),
    avatar: null,
    bio: bio || 'حساب ربات',
    activeSkin: 'default',
    profileEffect: 'off',
    profileEffectColor: null,
    profileBg: null,
  };
  db.users.push(bot);
  const { raw, rec } = mintBotKey(username, body.keyLabel);
  saveDB();
  pushUsers();
  // کلید خام فقط همین‌جا یک‌بار برگردانده می‌شود؛ در پایگاه‌داده نیست و قابل بازیابی نیست
  auditAdmin(req, 'bot-create', username, { displayName, keyPrefix: rec.keyPrefix });
  res.status(201).json({
    ok: true,
    bot: publicUser(bot),
    // ← تنها زمان نمایش متن خام کلید
    apiKey: raw,
    keyPrefix: rec.keyPrefix,
    warning: 'این کلید فقط همین یک‌بار نمایش داده می‌شود. آن را ذخیره کنید.',
  });
});

app.post('/api/admin/bots/:username/rotate-key', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = String(req.params.username || '').toLowerCase();
  const bot = db.users.find((u) => u.username === username && u.isBot);
  if (!bot) return res.status(404).json({ error: 'ربات یافت نشد' });
  if (!authRateOk('admin-bot-rotate:' + req.user.username, 20, 60 * 1000)) return res.status(429).json({ error: 'درخواست زیاد — کمی صبر کن' });
  // کلید قبلی باطل می‌شود (چرخش کامل) تا کلید لو رفته بی‌اثر شود
  const now = Date.now();
  for (const k of botApiKeys()) {
    if (k.botUsername === username && k.status === 'active') { k.status = 'revoked'; k.revokedAt = now; }
  }
  const { raw, rec } = mintBotKey(username, (req.body || {}).keyLabel);
  saveDB();
  auditAdmin(req, 'bot-key-rotate', username, { keyPrefix: rec.keyPrefix });
  res.json({ ok: true, apiKey: raw, keyPrefix: rec.keyPrefix, warning: 'کلید قبلی باطل شد. کلید جدید فقط همین یک‌بار نمایش داده می‌شود.' });
});

app.post('/api/admin/bots/:username/revoke-keys', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = String(req.params.username || '').toLowerCase();
  const bot = db.users.find((u) => u.username === username && u.isBot);
  if (!bot) return res.status(404).json({ error: 'ربات یافت نشد' });
  const now = Date.now();
  let n = 0;
  for (const k of botApiKeys()) {
    if (k.botUsername === username && k.status === 'active') { k.status = 'revoked'; k.revokedAt = now; n++; }
  }
  saveDB();
  auditAdmin(req, 'bot-key-revoke', username, { revoked: n });
  res.json({ ok: true, revoked: n });
});

// ---------- ساخت idempotent کانال‌های محتوایی با ربات اختصاصی ----------
// هر کانال یک ربات مخصوص خودش دارد. اجرای دوباره هیچ کانال/کلید جدیدی نمی‌سازد
// (idempotent) و برای ربات‌های موجود کلید تازه صادر نمی‌کند تا ورک‌فلوی n8n نشکند.
app.post('/api/admin/bots/seed-channels', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  const out = botChannels.ensureSeedChannels({
    db,
    uid: nextUid,
    mintKey: (botUsername, label) => mintBotKey(botUsername, label),
    save: saveDB,
    pushUsers,
  });
  broadcastGroups();
  auditAdmin(req, 'bot-channels-seed', 'seed', {
    channels: out.channels.length,
    createdChannels: out.createdChannels,
    updatedChannels: out.updatedChannels,
    createdBots: out.createdBots.map((b) => b.username),
  });
  res.json({
    ok: true,
    createdChannels: out.createdChannels,
    updatedChannels: out.updatedChannels,
    createdBotCount: out.createdBots.length,
    channels: out.channels,
    // کلیدها فقط برای ربات‌های همین‌بار-ساخته‌شده برگردانده می‌شوند (یک‌بار)
    newBotKeys: out.createdBots,
  });
});

// ---------- API انتشار پست: POST /api/bot/post ----------
app.post('/api/bot/post', botAuth, async (req, res) => {
  const bot = req.bot;
  // سهمیهٔ هر ربات (مستقل از کاربران عادی)
  if (!authRateOk('bot-post:' + bot.username, bots.LIMITS.rateMax, bots.LIMITS.rateWindowMs)) {
    return res.status(429).json({ error: 'سقف ارسال این ربات تکمیل شد — کمی بعد دوباره تلاش کنید' });
  }

  const v = bots.validatePost(req.body);
  if (!v.ok) return res.status(v.status).json({ error: v.error });
  const post = v.post;

  const channelId = String(post.channelId);
  const g = findGroup(channelId);
  if (!g) return res.status(404).json({ error: 'کانال یافت نشد' });
  if (g.type !== 'channel') return res.status(400).json({ error: 'انتشار فقط در کانال مجاز است' });
  // ربات باید مالک یا مدیر کانال باشد — دقیقاً مثل canPost
  if (g.owner !== bot.username && !isGroupAdmin(g, bot.username)) {
    return res.status(403).json({ error: 'این ربات مالک یا مدیر این کانال نیست' });
  }
  const roomId = 'group:' + g.id;

  // idempotency: تکرار درخواست (مثلاً اجرای دوبارهٔ ورک‌فلو n8n) پست تکراری نمی‌سازد
  if (post.idempotencyKey) {
    const prior = botIdempotency.get(bot.username, post.idempotencyKey);
    if (prior) return res.status(200).json({ ok: true, duplicate: true, ...prior });
  }

  // تصویر: هرگز hotlink نمی‌شود؛ از فیلتر ضد-SSRF عبور می‌کند و روی سرور میزبانی می‌شود
  let url = null, mime = null, size = null;
  if (post.kind === 'image') {
    const ing = await bots.ingestRemoteImage(post.imageUrl, {
      uploadDir: UPLOAD_DIR,
      durableUpload: (buf, filename, ct) => durableUpload(buf, filename, ct),
    });
    if (ing.error) return res.status(400).json({ error: ing.error });
    url = ing.url; mime = ing.mime; size = ing.size;
  }

  const now = Date.now();
  const msg = {
    id: crypto.randomUUID(),
    roomId,
    from: bot.username,
    fromName: bot.displayName,
    fromAvatar: bot.avatar || null,
    fromPremium: false,
    fromBot: true,
    kind: post.kind,
    content: post.content,
    reactions: {},
    silent: false,
    time: now,
  };
  if (post.kind === 'image') {
    msg.url = url; msg.src = url; msg.mime = mime; msg.size = size;
    msg.name = 'image';
  }
  if (post.kind === 'poll') { msg.poll = post.poll; msg.content = ''; }
  bots.attachProvenance(msg, { ...post, countViews: true });

  if (!db.messages[roomId]) db.messages[roomId] = [];
  db.messages[roomId].push(msg);
  if (db.messages[roomId].length > HISTORY_LIMIT) db.messages[roomId].splice(0, db.messages[roomId].length - HISTORY_LIMIT);
  saveDB();
  broadcast({ type: 'message', message: msg });

  const result = { messageId: msg.id, roomId, time: msg.time };
  if (post.idempotencyKey) botIdempotency.set(bot.username, post.idempotencyKey, result);
  res.status(201).json({ ok: true, ...result });
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
  if (readReceiptsEnabled(req.user.username)) broadcast({ type: 'room-read', roomId, username: req.user.username, time: rs[roomId][req.user.username] });
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
  const base = publicSafe(user);
  for (const [viewer, info] of online) {
    /* per-viewer gating: a stranger must not receive a locked avatar/bio just
       because an update was broadcast to everyone. */
    const showPhoto = canSee(viewer, user, 'profilePhoto');
    const showBio = canSee(viewer, user, 'bio');
    const showBday = canSee(viewer, user, 'birthday');
    const obj = (showPhoto && showBio && showBday) ? { type: 'profile-updated', username, user: base }
      : { type: 'profile-updated', username, user: { ...base, avatar: showPhoto ? base.avatar : null, bio: showBio ? base.bio : '', birthday: showBday ? base.birthday : '' } };
    wsSend(info.ws, obj);
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

wss.on('connection', (ws, req) => {
  let username = null;
  /* Heartbeat: Render and most proxies silently kill idle WebSockets, which made
     messages only show up after a reconnect/refresh. Mark liveness + reply to pongs. */
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

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
        if (!canAccess(rid, username)) continue;
        const visible = filterReadStateFor(username, { [rid]: readers })[rid];
        if (visible) myReadState[rid] = visible;
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

    /* Keepalive from the client; answering lets the browser detect a half-open
       socket and reconnect quickly instead of waiting for a proxy timeout. */
    if (data.type === 'ping') { return wsSend(ws, { type: 'pong', t: data.t }); }

    if (data.type === 'history') {
      if (!wsRateOk(username, 'history', 40, 60 * 1000)) return;
      const roomId = String(data.roomId || '').slice(0, 100);
      if (!canAccess(roomId, username)) return;
      const all = db.messages[roomId] || [];
      let msgs;
      const after = Number(data.after);
      const incremental = Number.isFinite(after) && after > 0;
      if (incremental) msgs = all.filter((m) => m.time > after);
      else msgs = all;
      /* پیام‌هایی که کاربر «فقط برای خودش» پاک کرده از تاریخچه‌ی او حذف می‌شود */
      msgs = msgs.filter((m) => !(Array.isArray(m.hiddenFor) && m.hiddenFor.includes(username)));
      // const _delTimers = { '1d': 86400000, '7d': 604800000, '30d': 2592000000, '1y': 31536000000 };
       msgs = msgs.filter((m) => {
         if (!m || !m.from || !m.time) return true;
         const sender = db.users.find((u) => u.username === m.from);
         const del = (sender && sender.settings && sender.settings.security && sender.settings.security.deleteMessages) || 'off';
         if (del === 'off' || !_delTimers[del]) return true;
         return (Date.now() - Number(m.time)) < _delTimers[del];
       });
       // بازدید پست‌های کانال شمرده می‌شود (فقط شمارنده؛ نه اینکه چه کسی دیده)
      const visible = msgs.slice(-100);
      recordViews(visible, username);
      wsSend(ws, { type: 'history', roomId, messages: enrichMsgBatch(visible, username), incremental: incremental || undefined });
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
      if (readReceiptsEnabled(username)) broadcast({ type: 'room-read', roomId, username, time: rs[roomId][username] });
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
      const kind = ['text', 'sticker', 'image', 'gif', 'video', 'audio', 'voice', 'file', 'poll', 'checklist', 'album', 'location'].includes(data.kind) ? data.kind : 'text';
      const _uf = (db.userFlags && db.userFlags[username]) || {};
      if (_uf.restricted && ['image', 'gif', 'video', 'audio', 'voice', 'file', 'location', 'album'].includes(kind)) return;
      const maxLen = (user.isPremium || user.isAdmin) ? MAX_MSG_LEN : 700;

      // اعتبارسنجی بار پیام بر اساس نوع
      let content = '';
      let album = undefined, poll = undefined, checklist = undefined, geo = undefined;
      if (kind === 'text') {
        content = String(data.content ?? '').slice(0, maxLen);
        if (!content.trim()) return;
      } else if (kind === 'location') {
        /* موقعیت مکانی: فقط عددِ واقعی در بازهٔ جغرافیایی پذیرفته می‌شود.
           Number(null) و Number('') هر دو 0 می‌شوند، پس اول خودِ نوع بررسی می‌شود
           تا مختصات خالی/نامعتبر به مرکز زمین تبدیل نشود. */
        const rawLat = data.lat, rawLng = data.lng;
        const numOk = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
        if (!numOk(rawLat) || !numOk(rawLng)) return;
        const lat = Number(rawLat), lng = Number(rawLng);
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
        const label = String(data.label ?? '').trim().slice(0, 160);
        geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: label || null };
        content = label || ('📍 ' + geo.lat + ', ' + geo.lng);
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
        replyTo, album, poll, checklist, geo,
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
      const _uFlags = (db.userFlags && db.userFlags[username]) || {};
      if (_uFlags.restricted) return;
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
      /* forEveryone=false یعنی «فقط برای من پاک شود»: پیام برای بقیه می‌ماند و
         فقط از تاریخچه‌ی همین کاربر فیلتر می‌شود. پیش‌فرض مثل قبل برای همه است. */
      if (data.forEveryone === false) {
        const m = arr[idx];
        m.hiddenFor = Array.isArray(m.hiddenFor) ? m.hiddenFor : [];
        if (!m.hiddenFor.includes(username)) m.hiddenFor.push(username);
        saveDB();
        const info = online.get(username);
        if (info) wsSend(info.ws, { type: 'message-deleted', roomId, id });
        return;
      }
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
      /* حریم خصوصی تماس: طرف مقابل می‌تواند دریافت تماس را محدود کند */
      if (data.type === 'call-offer') {
        const calleeUser = db.users.find((u) => u.username === targetName);
        if (calleeUser && !canSee(username, calleeUser, 'calls')) return wsSend(ws, { type: 'error', text: 'این کاربر دریافت تماس را محدود کرده است' });
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
      const priv = (user && user.settings && user.settings.privacy) || {};
      if (priv.typing === false) return; /* typing indicator disabled server-side */
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

/* Protocol-level heartbeat keeps idle sockets (and any intermediary) alive; a
   socket that misses a full ping cycle is dropped so the client reconnects and
   resyncs instead of sitting on a dead connection. */
const wsHeartbeat = setInterval(() => {
  for (const [, info] of online) {
    const ws = info.ws;
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);
if (wsHeartbeat.unref) wsHeartbeat.unref();

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
    if (!ai.isConfigured()) return;
    const m = rawText.match(/^@(?:ai|vortex_bot)\s*[:]?\s*([\s\S]+)$/i);
    if (!m) { sendBotToRoom(roomId, 'دستور نامشخص. مثلاً: @ai خلاصه / @ai ترجمه سلام / @ai بازنویسی متن'); return; }
    const cmd = m[1].trim();
    const hist = roomHistoryText(roomId, 40);
    notifyUser(user.username, { type: 'ai-thinking', roomId });
    const who = { username: user.username, isAdmin: !!user.isAdmin };
    let out = null;
    if (/^(خلاصه|summary)/i.test(cmd)) {
      const r = await aiComplete({ ...who, kind: 'text', system: 'You are VORTEXGRAM AI. Summarize the chat in Persian in 3-5 short bullet points. Be concise, no preamble.', data: hist, label: 'chat' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      out = 'خلاصه گفتگو:\n' + r.text;
    } else if (/^(ترجمه|translate)/i.test(cmd)) {
      const rest = cmd.replace(/^(ترجمه|translate)\s*[:]?/i, '').trim();
      const r = await aiComplete({ ...who, kind: 'text', system: 'Translate the text. If Persian translate to English, else to Persian. Return only the translation.', data: rest, label: 'text' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      out = r.text;
    } else if (/^(بازنویسی|rewrite)/i.test(cmd)) {
      const rest = cmd.replace(/^(بازنویسی|rewrite)\s*[:]?/i, '').trim();
      let tone = 'natural'; if (/رسمی/.test(rest)) tone = 'formal'; else if (/طنز|خنده‌دار/.test(rest)) tone = 'funny'; else if (/دوستانه/.test(rest)) tone = 'friendly';
      const r = await aiComplete({ ...who, kind: 'text', system: `Rewrite the text in Persian with a ${tone} tone. Return only the rewritten text.`, data: rest, label: 'text' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      out = r.text;
    } else if (/^(پاسخ|reply)/i.test(cmd)) {
      const r = await aiComplete({ ...who, kind: 'text', system: 'Suggest 3 short reply options in Persian, one per line, no numbering, no labels.', data: hist, label: 'chat' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      out = r.text;
    } else if (/^(چک‌لیست|checklist)/i.test(cmd)) {
      const rest = cmd.replace(/^(چک‌لیست|checklist)\s*[:]?/i, '').trim();
      const r = await aiComplete({ ...who, kind: 'text', system: 'Convert the request into JSON: {"title":"...","items":["...","..."]}. Return only valid JSON.', data: rest, label: 'text' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      const parsed = safeJson(r.text);
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
      const r = await aiComplete({ ...who, kind: 'text', system: 'Convert the request into JSON: {"question":"...","options":["...","..."]}. Return only valid JSON.', data: rest, label: 'text' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      const parsed = safeJson(r.text);
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
      const r = await aiComplete({ ...who, kind: 'text', system: 'You are VORTEXGRAM AI assistant. Answer the request briefly in Persian, using the chat context if relevant.', data: hist + '\n\nUser: ' + cmd, label: 'chat' });
      if (!r.ok) { sendBotToRoom(roomId, r.error); return; }
      out = r.text;
    }
    if (out) sendBotToRoom(roomId, out);
  } catch (e) { console.error('ai cmd failed:', e && e.message); }
}

async function maybeAiReply(roomId, user, rawText) {
  try {
    if (!ai.isConfigured()) return;
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
    const system = prompts.promptFor({ isRude: isRude(text), isAdmin: !!user.isAdmin, aggression: aiState.aggression.get(roomId) ?? 1 });

    // Privacy: this content only leaves the server because the user just typed
    // into the bot's own DM — an explicit AI action. No background scraping.
    const r = await aiComplete({
      username: user.username,
      isAdmin: !!user.isAdmin,
      kind: 'text',
      system,
      data: 'recent chat:\n' + history.slice(-10).join('\n') + '\n\ncurrent message from @' + user.username + ':\n' + clean,
      label: 'dm-chat',
    });
    aiState.lastReply.set(roomId, Date.now());
    if (!r.ok) {
      // 503/502 are silent (AI simply unavailable); refusals/quota are shown.
      if (r.status === 403 || r.status === 429) broadcast({ type: 'message', message: botMsg(roomId, r.error) });
      return;
    }
    broadcast({ type: 'message', message: botMsg(roomId, r.text) });
  } catch (e) {
    console.error('AI reply failed:', e && e.message);
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
      purgeExpiredMessageDeletions();
      backfillUids();
      try { if (db.sessions) for (const [k, v] of Object.entries(db.sessions)) sessions.set(k, v); } catch (e) {}
      normalizeSessions();
    }
  } catch (e) {
    console.error('DB load failed:', e.message);
  }
  server.listen(PORT, () => console.log(`vortexgram on http://localhost:${PORT}`));
  const deletionRetentionTimer = setInterval(purgeExpiredMessageDeletions, 60 * 60 * 1000);
  if (deletionRetentionTimer.unref) deletionRetentionTimer.unref();
  if (Number(process.env.PORT) !== 3000 && process.env.VX_MIRROR === '1') {
    const server2 = http.createServer(app);
    server2.listen(3000, () => console.log('vortexgram mirrored on http://localhost:3000'));
  }
}
start();