// VORTEXGRAM — bot accounts + the n8n posting API.
//
// Design notes
// ------------
// * A bot is a real row in `db.users` with `isBot: true`. That lets a bot own and
//   administer channels (group ownership is just a username reference) without
//   inventing a parallel identity system. `isBot` is enforced everywhere a human
//   could otherwise log in (password login, OTP, complete-register).
//
// * API keys are high-entropy random tokens, so they need no slow KDF — but they
//   DO need to be un-guessable and un-verifiable if the database leaks. We store
//   `HMAC-SHA256(pepper, keyId + '.' + secret)`: a keyed hash. The pepper lives in
//   the environment (BOT_KEY_PEPPER); a database-only breach therefore does not let
//   an attacker test candidate keys offline, and the plaintext key is never at rest.
//   The raw key is shown exactly once, at creation/rotation.
//
// * Idempotency is keyed per bot so two different bots may reuse the same key
//   string, and is cached for 24h so a retried n8n execution (or an n8n crash
//   after the HTTP 200 was lost in transit) never double-posts.
//
// * Everything user-supplied is length-capped and control-character stripped
//   before it is stored. Rendering escapes happen client-side (public/sanitize.js);
//   the same rules are applied here so a malicious n8n workflow cannot persist
//   control characters or bidi overrides into other users' clients.
//
// * External images are never hotlinked: they are pulled through the SSRF-safe
//   fetcher (server/link-fetch.js), size/sniff-checked and re-hosted under /uploads,
//   exactly like the existing GIF ingest path.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { fetchPublicUrl, isPrivateIp } = require('./link-fetch');

// ---------------------------------------------------------------------------
// Limits (mirrored by the client-facing docs)
// ---------------------------------------------------------------------------
const LIMITS = {
  keyPrefixLen: 12,          // visible in listings: "vxk_ab12cd34…"
  keySecretBytes: 32,        // 256 bits of entropy
  botUsernameMax: 20,
  botNameMax: 30,
  botBioMax: 200,
  textMax: 4000,
  titleMax: 200,
  sourceUrlMax: 2048,
  pollQuestionMax: 200,
  pollOptionMax: 80,
  pollOptionMaxCount: 10,
  imageBytes: 5 * 1024 * 1024,
  idempotencyMax: 128,
  // idempotency window (ms)
  idempotencyTtl: 24 * 60 * 60 * 1000,
  // per-bot posting budget
  rateMax: 30,
  rateWindowMs: 60 * 1000,
};

const AI_LABEL = 'تولید شده با هوش مصنوعی';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};
const POLL_KINDS = new Set(['text', 'image', 'poll']);

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------
// Prefer BOT_KEY_PEPPER from the environment. If it is absent we persist a
// generated one to a file *outside* the database, so that leaking db.json alone
// still does not allow offline key verification. If neither is possible we fall
// back to a process-lifetime random pepper and warn loudly — existing keys will
// stop validating until BOT_KEY_PEPPER is configured (fail closed, not open).
let _pepper = null;
function resolvePepperPath() {
  const base = process.env.BOT_PEPPER_FILE
    || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), '.bot-pepper');
  return base;
}
function loadPepper({ warn } = {}) {
  if (_pepper) return _pepper;
  const fromEnv = String(process.env.BOT_KEY_PEPPER || '').trim();
  if (fromEnv.length >= 32) { _pepper = fromEnv; return _pepper; }

  const file = resolvePepperPath();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) { _pepper = existing; return _pepper; }
  } catch (e) { /* not created yet */ }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated + '\n', { mode: 0o600 });
    _pepper = generated;
  } catch (e) {
    // Could not persist → ephemeral pepper. Keys minted now break on restart.
    if (warn) warn('BOT_KEY_PEPPER is not set and ' + file + ' is not writable; using an ephemeral pepper. Set BOT_KEY_PEPPER in production.');
    _pepper = generated;
  }
  return _pepper;
}
// test hook: force a specific pepper
function _setPepper(p) { _pepper = p; }

// ---------------------------------------------------------------------------
// Text hygiene — the server-side half of sanitization
// ---------------------------------------------------------------------------
// Strips C0/C1 control chars, the private-use sentinels (U+E000/U+E001) that
// public/sanitize.js also treats as unsafe, and every bidi override/isolate
// (a classic spoofing vector in Persian/English mixed feeds). Keeps \n and \t.
const BIDI_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000\uE001]/g;

function cleanText(v, max) {
  let s = v === undefined || v === null ? '' : String(v);
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '').replace(BIDI_RE, '');
  // collapse absurd runs of newlines (feed noise) but keep paragraphing
  s = s.replace(/\n{4,}/g, '\n\n\n');
  if (max && s.length > max) s = s.slice(0, max);
  return s.trim();
}
function cleanLine(v, max) {
  // single-line field (display names, titles, labels): newlines are not allowed
  return cleanText(v, max).replace(/\n+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// URL validation — http/https only, no credentials, no weird hosts
// ---------------------------------------------------------------------------
function safePublicUrl(raw, { maxLen = LIMITS.sourceUrlMax } = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.length > maxLen) return { error: 'لینک منبع بیش از حد طولانی است' };
  // Reject control chars / bidi before parsing (can hide "https" inside "ht\u200Etp")
  if (CONTROL_RE.test(s) || BIDI_RE.test(s)) return { error: 'لینک منبع نامعتبر است' };
  CONTROL_RE.lastIndex = 0; BIDI_RE.lastIndex = 0;
  let u;
  try { u = new URL(s); } catch (e) { return { error: 'لینک منبع نامعتبر است' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: 'فقط لینک http یا https مجاز است' };
  }
  if (u.username || u.password) return { error: 'لینک منبع نباید شامل نام کاربری یا رمز باشد' };
  if (!u.hostname) return { error: 'لینک منبع نامعتبر است' };
  // literal private IP in the host is never a valid public source
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) && isPrivateIp(bare)) {
    return { error: 'لینک منبع به آدرس داخلی اشاره می‌کند' };
  }
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.local') || bare.endsWith('.internal')) {
    return { error: 'لینک منبع به آدرس داخلی اشاره می‌کند' };
  }
  u.hash = '';
  return u;
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').slice(0, 60); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
// Raw key format:  vxk_<keyId 12 hex>_<secret 64 hex>
// `keyId` is the public lookup handle; the secret is compared via a constant-time
// HMAC. Verifying the HMAC (rather than the raw secret) means even an in-process
// timing oracle does not leak the secret directly.
function generateKey() {
  const keyId = crypto.randomBytes(6).toString('hex');       // 12 hex chars
  const secret = crypto.randomBytes(LIMITS.keySecretBytes).toString('hex'); // 64 hex chars
  const raw = 'vxk_' + keyId + '_' + secret;
  return { raw, keyId, secret };
}
function hashKey(secret, keyId) {
  const pepper = loadPepper();
  return crypto.createHmac('sha256', pepper).update(keyId + '.' + secret).digest('hex');
}
function parseKey(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^vxk_[0-9a-f]{12}_[0-9a-f]{64}$/.test(s)) return null;
  const keyId = s.slice(4, 16);
  const secret = s.slice(17);
  return { raw: s, keyId, secret };
}
// Timing-safe compare of two hex digests of equal length.
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch (e) { return false; }
}

// Public shape of a key record — NEVER includes key_hash.
function publicKeyRecord(rec) {
  return {
    keyId: rec.keyId,
    prefix: rec.keyPrefix || ('vxk_' + String(rec.keyId || '').slice(0, 8)),
    status: rec.status || 'active',
    createdAt: rec.createdAt || null,
    rotatedAt: rec.rotatedAt || null,
    revokedAt: rec.revokedAt || null,
    lastUsedAt: rec.lastUsedAt || null,
    label: rec.label || null,
  };
}

// ---------------------------------------------------------------------------
// Image re-hosting (never hotlink)
// ---------------------------------------------------------------------------
function sniffImage(buf) {
  // minimal magic-byte sniffing; a declared content-type alone is not trusted
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  return null;
}

/**
 * Fetch a remote image through the SSRF-safe fetcher and re-host it locally.
 * Returns { url, mime, size } or { error }.
 *
 * Mirrors /api/gif/ingest: DNS-pinned lookup, per-hop redirect revalidation,
 * hard byte cap enforced while streaming, and magic-byte verification.
 */
async function ingestRemoteImage(imageUrl, { uploadDir, durableUpload, log } = {}) {
  const parsed = safePublicUrl(imageUrl);
  if (!parsed || parsed.error) return { error: (parsed && parsed.error) || 'لینک تصویر نامعتبر است' };

  let res;
  try {
    res = await fetchPublicUrl(parsed.toString(), { maxRedirects: 2, timeoutMs: 8000 });
  } catch (e) {
    return { error: 'دریافت تصویر ناموفق بود: ' + String(e && e.message || e).slice(0, 80) };
  }
  if (!res || res.status < 200 || res.status >= 300) {
    return { error: 'دریافت تصویر ناموفق بود (کد ' + ((res && res.status) || '؟') + ')' };
  }
  // Re-validate the *final* URL: a redirect must not land on a private address.
  const finalParsed = safePublicUrl(res.finalUrl || parsed.toString());
  if (!finalParsed || finalParsed.error) return { error: finalParsed && finalParsed.error ? finalParsed.error : 'مقصد تصویر نامعتبر است' };

  const declared = String((res.headers && (res.headers['content-type'] || '')) || '').split(';')[0].trim().toLowerCase();
  if (declared && !declared.startsWith('image/')) {
    return { error: 'فقط تصویر قابل انتشار است (دریافت شد: ' + declared.slice(0, 40) + ')' };
  }
  if (declared && !IMAGE_MIMES.has(declared)) {
    return { error: 'قالب تصویر پشتیبانی نمی‌شود' };
  }

  let buf;
  try {
    buf = await readCapped(res, LIMITS.imageBytes);
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
  if (!buf || !buf.length) return { error: 'تصویر خالی بود' };
  if (buf.length > LIMITS.imageBytes) return { error: 'حجم تصویر بیش از ۵ مگابایت است' };

  const mime = sniffImage(buf);
  if (!mime || !IMAGE_MIMES.has(mime)) return { error: 'فایل دریافتی تصویر معتبری نیست' };
  if (declared && declared !== mime) return { error: 'محتوای فایل با نوع اعلامی هم‌خوانی ندارد' };

  const filename = Date.now() + '-' + crypto.randomBytes(5).toString('hex') + EXT_BY_MIME[mime];
  // durableUpload() در سرور یک مسیر فایل می‌گیرد (createReadStream)، پس ابتدا روی دیسک
  // می‌نویسیم و سپس در صورت فعال بودن R2 همان فایل را آپلود می‌کنیم.
  let filePath = null;
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, buf);
  } catch (e) {
    return { error: 'ذخیرهٔ تصویر ناموفق بود' };
  }
  try {
    if (typeof durableUpload === 'function') {
      const hosted = await durableUpload(filePath, filename, mime);
      if (hosted) return { url: hosted, mime, size: buf.length };
    }
  } catch (e) {
    if (log) log('bot image durableUpload failed: ' + String(e && e.message || e));
  }
  return { url: '/uploads/' + filename, mime, size: buf.length };
}

function readCapped(res, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; try { res.destroy(); } catch (e) {} fn(arg); };
    res.on('data', (c) => {
      size += c.length;
      if (size > cap) { finish(reject, new Error('حجم تصویر بیش از حد مجاز است')); return; }
      chunks.push(c);
    });
    res.on('end', () => finish(resolve, Buffer.concat(chunks)));
    res.on('error', (e) => finish(reject, new Error('دریافت ناقص بود: ' + String(e && e.message || e).slice(0, 60))));
    res.on('aborted', () => finish(reject, new Error('دریافت ناقص بود')));
  });
}

// ---------------------------------------------------------------------------
// Post payload validation
// ---------------------------------------------------------------------------
/**
 * Validate + normalize the POST /api/bot/post body.
 * Returns { ok:true, post } or { ok:false, status, error } with a Persian message.
 */
function validatePost(body) {
  const b = body && typeof body === 'object' ? body : {};

  const channelId = cleanLine(b.channelId, 64);
  if (!channelId) return { ok: false, status: 400, error: 'channelId الزامی است' };

  const kind = cleanLine(b.kind, 12) || 'text';
  if (!POLL_KINDS.has(kind)) {
    return { ok: false, status: 400, error: 'نوع پیام معتبر نیست (مجاز: text، image، poll)' };
  }

  const content = cleanText(b.content, LIMITS.textMax);
  const sourceUrlRaw = b.sourceUrl;
  const idempotencyKey = cleanLine(b.idempotencyKey, LIMITS.idempotencyMax) || null;

  let source = null;
  if (sourceUrlRaw !== undefined && sourceUrlRaw !== null && String(sourceUrlRaw).trim() !== '') {
    const u = safePublicUrl(sourceUrlRaw);
    if (!u || u.error) return { ok: false, status: 400, error: (u && u.error) || 'لینک منبع نامعتبر است' };
    source = {
      url: u.toString(),
      site: hostOf(u),
      title: cleanLine(b.sourceTitle, LIMITS.titleMax) || null,
      provider: cleanLine(b.sourceProvider, 40) || null,
    };
  }

  // AI label: explicit flag, or inferred from a source + the caller's own signal.
  const aiGenerated = b.aiGenerated === true || b.aiGenerated === 'true';
  const post = {
    channelId,
    kind,
    content,
    source,
    aiGenerated,
    idempotencyKey,
    imageUrl: null,
    poll: null,
  };

  if (kind === 'poll') {
    const question = cleanText(b.question !== undefined ? b.question : b.content, LIMITS.pollQuestionMax);
    if (!question) return { ok: false, status: 400, error: 'پرسش نظرسنجی الزامی است' };
    const rawOptions = Array.isArray(b.options) ? b.options : [];
    const options = [];
    for (const o of rawOptions) {
      const v = cleanLine(o, LIMITS.pollOptionMax);
      if (v) options.push(v);
      if (options.length >= LIMITS.pollOptionMaxCount) break;
    }
    if (options.length < 2) return { ok: false, status: 400, error: 'نظرسنجی حداقل به دو گزینه نیاز دارد' };
    post.poll = { question, options, votes: {}, multi: false };
    // A poll's question is its content, exactly like the WS poll path.
    post.content = '';
  } else {
    if (!content) return { ok: false, status: 400, error: 'متن پیام خالی است' };
  }

  if (kind === 'image') {
    const raw = b.imageUrl;
    if (!raw || !String(raw).trim()) return { ok: false, status: 400, error: 'برای پیام تصویری imageUrl الزامی است' };
    const u = safePublicUrl(raw);
    if (!u || u.error) return { ok: false, status: 400, error: (u && u.error) || 'لینک تصویر نامعتبر است' };
    post.imageUrl = u.toString();
    // An image post may carry a caption; both are allowed.
    if (!post.content) post.content = '';
  }

  return { ok: true, post };
}

// ---------------------------------------------------------------------------
// Idempotency store
// ---------------------------------------------------------------------------
/**
 * In-memory, bounded, 24h TTL. Keyed per bot so identical keys from different
 * bots never collide. A Map with insertion-order eviction is enough here: the
 * ceiling is (bots × outstanding keys) and n8n retries a handful of times.
 */
function createIdempotencyStore({ ttl = LIMITS.idempotencyTtl, max = 5000 } = {}) {
  const map = new Map();
  function prune(now) {
    for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
    if (map.size > max) {
      const excess = map.size - max;
      let i = 0;
      for (const k of map.keys()) { if (i++ >= excess) break; map.delete(k); }
    }
  }
  return {
    get(bot, key) {
      if (!key) return null;
      const now = Date.now();
      prune(now);
      const rec = map.get(bot + ' ' + key);
      if (!rec) return null;
      return rec.result; // { messageId, ... }
    },
    set(bot, key, result) {
      if (!key) return;
      const now = Date.now();
      prune(now);
      map.set(bot + ' ' + key, { result, expiresAt: now + ttl });
    },
    size() { return map.size; },
  };
}

// ---------------------------------------------------------------------------
// Structured source + AI label attachment (applied to a message object)
// ---------------------------------------------------------------------------
// Both live as STRUCTURED FIELDS on the message, never interpolated into
// `content`, so the client can render a link/label distinctly and so a moderator
// can tell machine-generated text from a human's.
function attachProvenance(msg, post) {
  if (!msg) return msg;
  if (post.source) {
    msg.source = {
      url: post.source.url,
      site: post.source.site || null,
      title: post.source.title || null,
      provider: post.source.provider || null,
    };
  }
  if (post.aiGenerated) {
    msg.ai = { generated: true, label: AI_LABEL };
  }
  // Channel posts carry an aggregate, identity-free view counter.
  if (post.countViews) msg.views = 0;
  return msg;
}

module.exports = {
  LIMITS,
  AI_LABEL,
  POLL_KINDS,
  generateKey,
  hashKey,
  parseKey,
  safeEqualHex,
  publicKeyRecord,
  cleanText,
  cleanLine,
  safePublicUrl,
  hostOf,
  ingestRemoteImage,
  validatePost,
  createIdempotencyStore,
  attachProvenance,
  loadPepper,
  _setPepper,
  resolvePepperPath,
  sniffImage,
};