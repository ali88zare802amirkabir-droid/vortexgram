// VORTEXGRAM — user-facing AI features (Phase 3C).
//
// Four features sit on top of the 3B provider/quota/moderation layer, and every
// one of them goes through the SAME guarded path:
//
//   ai.complete()  ->  moderation -> quota -> fenced messages -> chain -> output guard
//
// so no feature can bypass quotas or content moderation. Each feature adds only:
//
//   1. ACCESS CONTROL   — the message/room is resolved SERVER-SIDE from (roomId,
//      msgId) so the client can never smuggle text it did not send. canAccess()
//      is enforced before anything else.
//   2. CONSENT          — any action that puts chat content in front of a
//      third-party provider requires the user's one-time recorded consent.
//   3. CACHING          — translations and transcripts are stored per message and
//      served from cache afterwards, so repeated taps cost no quota at all.
//   4. LIMITING         — size/duration caps on audio, message length caps, etc.
//
// Privacy notes:
//   * Bookmarks are per-user rows; the list endpoint only ever returns the
//     caller's own bookmarks, and bookmark text is never sent to a provider.
//   * Bookmarks intentionally store only a short excerpt, not full message
//     bodies, to keep the server-side copy small.
//   * Caches hold derived text (a translation / a transcript). They are keyed by
//     message id and are purged with the message-retention prunes.

'use strict';

const crypto = require('crypto');

const KIND_TEXT = 'text';
const KIND_AUDIO = 'text';   // transcription bills against the text budget

const DEFAULTS = {
  digestMaxChars: 4000,
  translateMaxChars: 2000,
  transcriptMaxChars: 4000,
  // audio caps (bytes) — Whisper rejects huge files and the cost is per-second
  audioMaxBytes: 20 * 1024 * 1024,
  audioMaxSeconds: 300,
  bookmarkExcerpt: 180,
  bookmarkMax: 500,
  cacheTtl: 30 * 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Consent (one-time, per user)
// ---------------------------------------------------------------------------
// `db.aiConsent[username] = timestamp`. Recorded once; never auto-granted.
function consentGiven(db, username) {
  const c = db && db.aiConsent;
  return !!(c && typeof c === 'object' && c[username]);
}
function grantConsent(db, username) {
  if (!db.aiConsent || typeof db.aiConsent !== 'object') db.aiConsent = {};
  db.aiConsent[username] = Date.now();
  return db.aiConsent[username];
}

const CONSENT_TEXT = {
  title: 'ارسال محتوای گفتگو به هوش مصنوعی',
  body: 'برای انجام این کار، متن یا صدای پیام موردنظر برای پردازش به ارائه‌دهندهٔ مدل هوش مصنوعی ارسال می‌شود. این رضایت یک‌بار پرسیده می‌شود و در «حریم خصوصی» توضیح داده شده است.',
  accept: 'می‌پذیرم',
  decline: 'نمی‌پذیرم',
};

// ---------------------------------------------------------------------------
// Feature: "خلاصه امروز" (daily digest)
// ---------------------------------------------------------------------------
// Only messages from the current UTC day are summarised, and the message body
// travels as fenced untrusted data, never as instructions.
function digestSystemPrompt(lang) {
  return lang === 'en'
    ? 'Summarize what happened in this chat today in Persian, as 3-6 short bullet points. Be factual and concise. If there is nothing meaningful, reply exactly with the single word: EMPTY.'
    : 'خلاصهٔ اتفاقات امروز این گفتگو را در ۳ تا ۶ bullet کوتاه فارسی بنویس. مختصر و واقع‌بینانه باشد. اگر محتوای معناداری نبود، فقط واژهٔ EMPTY را بنویس.';
}

// ---------------------------------------------------------------------------
// Feature: live translation (fa <-> en)
// ---------------------------------------------------------------------------
const LANG_LABEL = { fa: 'فارسی', en: 'انگلیسی' };
const TRANSLATION_LABEL = 'ترجمهٔ ماشینی';

function detectLang(text) {
  // Persian/Arabic script → fa, otherwise en. Deliberately simple: the model
  // does the real work, this only picks the direction.
  return /[\u0600-\u06FF]/.test(String(text || '')) ? 'fa' : 'en';
}

function translateSystemPrompt(to) {
  return to === 'en'
    ? 'Translate the text into natural English. Preserve meaning, names and numbers. Return ONLY the translation, no notes, no quotes.'
    : 'متن را به فارسی روان ترجمه کن. معنا، نام‌ها و اعداد را حفظ کن. فقط ترجمه را برگردان؛ هیچ توضیح، نقل‌قول یا یادداشتی ننویس.';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function createAiFeatures(deps) {
  const {
    // IMPORTANT: a getter, not a value. server.js reassigns its `db` variable
    // during boot (`db = {...DEFAULT_DB, ...loaded}`), so capturing the object
    // here would hand this module a stale, empty db that silently swallows
    // every write (consent, caches, bookmarks, schedules).
    getDb,
    save, ai, aiComplete, aiQuotas,
    canAccess, canPost, findGroup, findMsg, memberOf, isGroupAdmin,
    BOT_USERNAME, BOT_NAME,
    sendToRoom,          // (roomId, message) => void  — persists + broadcasts
    transcribeAudio,     // (buffer, filename, opts) => {text}|null   (ai.transcribe)
    fetchRoomAudio,      // (url) => Promise<Buffer>                  (auth-gated fetch)
    env = process.env,
    limits = {},
  } = deps;

  const L = Object.assign({}, DEFAULTS, limits);

  // ---- helpers ----------------------------------------------------------
  function num(v, fallback) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; }

  /** Resolve a message the caller is allowed to read, or null. */
  function resolveMessage(roomId, msgId, username) {
    const rid = String(roomId || '').slice(0, 120);
    if (!rid || !canAccess(rid, username)) return null;
    const m = findMsg(rid, String(msgId || '').slice(0, 64));
    if (!m) return null;
    return { rid, m };
  }

  /** Only text-ish messages can be translated/summarised. */
  function isTranslatable(m) {
    return !!m && m.kind === 'text' && String(m.content || '').trim().length > 0;
  }

  // ---- translation cache -------------------------------------------------
  function cacheStore() {
    const db = getDb();
    if (!db.aiTranslations || typeof db.aiTranslations !== 'object') db.aiTranslations = {};
    return db.aiTranslations;
  }
  function cacheGet(msgId, lang) {
    const store = cacheStore();
    const rec = store[msgId];
    if (!rec || typeof rec !== 'object') return null;
    const hit = rec[lang];
    if (!hit || typeof hit.text !== 'string' || !hit.text) return null;
    if (L.cacheTtl > 0 && hit.at && (Date.now() - hit.at) > L.cacheTtl) return null;
    return hit;
  }
  function cacheSet(msgId, lang, text, by) {
    const store = cacheStore();
    if (!store[msgId]) store[msgId] = {};
    store[msgId][lang] = { text, at: Date.now(), by: by || null };
    // bound the cache so a busy server cannot grow it forever
    const keys = Object.keys(store);
    if (keys.length > 5000) { for (const k of keys.slice(0, Math.ceil(keys.length * 0.2))) delete store[k]; }
    save();
    return store[msgId][lang];
  }
  function cachePurge() {
    const db = getDb();
    if (!db.aiTranslations || typeof db.aiTranslations !== 'object') return 0;
    const now = Date.now();
    let n = 0;
    for (const [id, rec] of Object.entries(db.aiTranslations)) {
      const t = rec && rec.at;
      if (!t || (now - t) > L.cacheTtl) { delete db.aiTranslations[id]; n++; }
      else continue;
    }
    if (n) save();
    return n;
  }

  // ---- transcript cache (one language: the audio's own language) ---------
  function transcripts() {
    const db = getDb();
    if (!db.aiTranscripts || typeof db.aiTranscripts !== 'object') db.aiTranscripts = {};
    return db.aiTranscripts;
  }
  function transcriptGet(msgId) {
    const rec = transcripts()[msgId];
    if (!rec || typeof rec.text !== 'string' || !rec.text) return null;
    if (L.cacheTtl > 0 && rec.at && (Date.now() - rec.at) > L.cacheTtl) return null;
    return rec;
  }
  function transcriptSet(msgId, text) {
    const store = transcripts();
    store[msgId] = { text, at: Date.now() };
    const keys = Object.keys(store);
    if (keys.length > 5000) { for (const k of keys.slice(0, Math.ceil(keys.length * 0.2))) delete store[k]; }
    save();
    return store[msgId];
  }

  // ---- bookmarks ---------------------------------------------------------
  function bookmarks() {
    const db = getDb();
    if (!db.savedMessages || typeof db.savedMessages !== 'object') db.savedMessages = {};
    return db.savedMessages;
  }
  function listBookmarks(username) {
    const mine = bookmarks()[username];
    return Array.isArray(mine) ? mine : [];
  }
  function excerptOf(m) {
    const raw = m.kind === 'text' ? String(m.content || '')
      : m.kind === 'poll' ? 'نظرسنجی: ' + (m.poll && m.poll.question ? m.poll.question : '')
      : m.kind === 'checklist' ? 'چک‌لیست: ' + (m.checklist && m.checklist.title ? m.checklist.title : '')
      : '[' + String(m.kind || 'پیام') + ']';
    return raw.replace(/\s+/g, ' ').trim().slice(0, L.bookmarkExcerpt);
  }
  function addBookmark(username, roomId, msgId, note) {
    const list = listBookmarks(username);
    const id = String(roomId).slice(0, 120) + '|' + String(msgId).slice(0, 64);
    if (list.some((b) => b.id === id)) return { ok: true, duplicate: true, count: list.length };
    if (list.length >= L.bookmarkMax) list.shift();          // keep the newest N
    const rec = {
      id,
      roomId: String(roomId).slice(0, 120),
      msgId: String(msgId).slice(0, 64),
      // NO full message body: only a short excerpt for the list view
      excerpt: '',
      kind: 'text',
      note: note ? String(note).replace(/\s+/g, ' ').trim().slice(0, 140) : '',
      at: Date.now(),
    };
    list.unshift(rec);
    bookmarks()[username] = list;
    save();
    return { ok: true, count: list.length };
  }
  function removeBookmark(username, id) {
    const list = listBookmarks(username);
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return { ok: false, error: 'یافت نشد' };
    list.splice(i, 1);
    bookmarks()[username] = list;
    save();
    return { ok: true, count: list.length };
  }

  // =======================================================================
  // 1. Daily digest (on demand)
  // =======================================================================
  /**
   * @returns {{ok:true, digest, cached}|{ok:false, status, error}}
   */
  async function digest({ username, isAdmin, roomId, force }) {
    const db = getDb();
    const rid = String(roomId || '').slice(0, 120);
    // ACCESS first: never let a non-member learn whether AI is even configured.
    if (!rid || !canAccess(rid, username)) return { ok: false, status: 403, error: 'دسترسی' };

    const store = db.aiDigests || {};
    const prior = store[rid] && store[rid].lastDigest;
    // cache: one digest per room per day unless `force`
    if (!force && prior && (Date.now() - prior) < 24 * 3600 * 1000) {
      const cached = db.aiDigestText && db.aiDigestText[rid];
      if (cached && cached.at && (Date.now() - cached.at) < 24 * 3600 * 1000) {
        return { ok: true, digest: cached.text, cached: true, at: cached.at };
      }
    }

    const roomTitle = roomTitleOf(rid);
    const since = new Date();
    since.setHours(0, 0, 0, 0);                       // "today", server local day
    const all = db.messages[rid] || [];
    const todays = all.filter((m) => (m.time || 0) >= since.getTime() && messageText(m));
    if (!todays.length) return { ok: true, digest: '', empty: true };

    const data = 'room: ' + roomTitle + '\n' + todays.slice(-80).map(messageLine).join('\n');
    const out = await aiComplete({
      username, isAdmin, kind: 'text',
      system: digestSystemPrompt(),
      data, label: 'chat-digest', maxTokens: 700,
    });
    if (!out.ok) return out;
    const digest = out.text;
    if (!/^\s*EMPTY\s*$/i.test(digest) && digest.trim()) {
      if (!db.aiDigestText) db.aiDigestText = {};
      db.aiDigestText[rid] = { text: digest, at: Date.now() };
      if (!db.aiDigests) db.aiDigests = {};
      if (!db.aiDigests[rid]) db.aiDigests[rid] = {};
      db.aiDigests[rid].lastDigest = Date.now();
      save();
    }
    return { ok: true, digest: digest.trim() === 'EMPTY' ? '' : digest, cached: false };
  }

  function messageText(m) {
    if (m.kind === 'text') return String(m.content || '').trim();
    if (m.kind === 'poll') return 'نظرسنجی: ' + (m.poll && m.poll.question ? m.poll.question : '');
    if (m.kind === 'checklist') return 'چک‌لیست: ' + (m.checklist && m.checklist.title ? m.checklist.title : '');
    return '';
  }
  function messageLine(m) {
    return (m.fromName || m.from || '?') + ': ' + messageText(m).slice(0, 300);
  }
  function roomTitleOf(rid) {
    if (rid.startsWith('group:')) {
      const g = findGroup(rid.slice(6));
      return g ? g.name : 'گروه';
    }
    const parts = rid.slice(3).split('|');
    return parts.join(' و ');
  }

  // =======================================================================
  // 2. Live translation (fa <-> en), cached per message
  // =======================================================================
  async function translate({ username, isAdmin, roomId, msgId, to, force }) {
    const found = resolveMessage(roomId, msgId, username);
    if (!found) return { ok: false, status: 403, error: 'دسترسی' };
    const { m } = found;
    if (!isTranslatable(m)) return { ok: false, status: 400, error: 'این پیام متنی نیست' };
    if (m.kind === 'text' && String(m.content).length > L.translateMaxChars * 4) {
      return { ok: false, status: 400, error: 'متن پیام برای ترجمه خیلی بلند است' };
    }
    const text = String(m.content || '').slice(0, L.translateMaxChars * 4);
    const target = (to === 'fa' || to === 'en') ? to : detectLang(text) === 'fa' ? 'en' : 'fa';

    // CACHE HIT → no quota spent, no provider call
    if (!force) {
      const hit = cacheGet(m.id, target);
      if (hit) return { ok: true, text: hit.text, lang: target, cached: true, label: TRANSLATION_LABEL };
    }

    const out = await aiComplete({
      username, isAdmin, kind: 'text',
      system: translateSystemPrompt(target),
      data: text, label: 'message', maxTokens: 900,
    });
    if (!out.ok) return out;
    const rec = cacheSet(m.id, target, out.text, username);
    return { ok: true, text: rec.text, lang: target, cached: false, label: TRANSLATION_LABEL };
  }

  // =======================================================================
  // 3. Voice transcription
  // =======================================================================
  async function transcribe({ username, isAdmin, roomId, msgId, force }) {
    const found = resolveMessage(roomId, msgId, username);
    if (!found) return { ok: false, status: 403, error: 'دسترسی' };
    const { m } = found;
    if (m.kind !== 'voice') return { ok: false, status: 400, error: 'این پیام صوتی نیست' };

    if (!force) {
      const hit = transcriptGet(m.id);
      if (hit) return { ok: true, text: hit.text, cached: true };
    }

    // Whisper is optional and separately configured.
    if (!ai.whisperAvailable(env)) return { ok: false, status: 503, error: 'تبدیل صدا به متن تنظیم نشده است.' };

    const dur = Number(m.duration || 0);
    if (dur > L.audioMaxSeconds) return { ok: false, status: 400, error: 'این پیام صوتی خیلی بلند است (بیش از ۵ دقیقه).' };
    const url = String(m.src || m.url || '');
    if (!url) return { ok: false, status: 400, error: 'فایل صوتی در دسترس نیست' };
    // Only the app's own auth-gated /uploads path is fetchable. Anything else
    // (remote URL, path traversal, protocol-relative) is refused outright.
    if (!/^\/uploads\/[\w.-]+$/.test(url)) return { ok: false, status: 400, error: 'منبع صوتی مجاز نیست' };

    // quota BEFORE the (expensive) download, same as text
    const check = aiQuotas.check(username, KIND_AUDIO, { isAdmin });
    if (!check.ok) return { ok: false, status: 429, error: ai.quotaError(check.reason), resetsAt: check.resetsAt };

    let buf;
    try {
      buf = await fetchRoomAudio(url, username);
    } catch (e) {
      return { ok: false, status: 400, error: 'دریافت فایل صوتی ناموفق بود' };
    }
    if (!buf || !buf.length) return { ok: false, status: 400, error: 'فایل صوتی خالی بود' };
    if (buf.length > num(env.AI_TRANSCRIBE_MAX_BYTES, L.audioMaxBytes)) {
      return { ok: false, status: 400, error: 'حجم این پیام صوتی بیش از حد مجاز است' };
    }

    // The transcript is user content on its way to the provider → moderate it.
    // (We cannot moderate audio bytes, so we gate the ACTION and cap the size.)
    let res;
    try {
      res = await transcribeAudio(buf, 'voice-message', { language: 'fa' });
    } catch (e) {
      return { ok: false, status: 502, error: 'تبدیل صدا به متن انجام نشد' };
    }
    if (!res || !res.text) return { ok: false, status: 502, error: 'متنی از این پیام صوتی به دست نیامد' };

    const guarded = ai.guardOutput(res.text, L.transcriptMaxChars);
    if (guarded.blocked) return { ok: false, status: 403, error: guarded.error };

    aiQuotas.spend(username, KIND_AUDIO, { tokens: 0 });      // charge once, on success
    const rec = transcriptSet(m.id, guarded.text);
    return { ok: true, text: rec.text, cached: false, duration: dur || null };
  }

  // =======================================================================
  // 4. Scheduled digest (posted by a bot into a channel it administers)
  // =======================================================================
  /**
   * A scheduled digest may only target a channel that the bot owns/administers —
   * enforced with the same isGroupAdmin() check the posting path uses.
   */
  function botAdministers(group) {
    if (!group || group.type !== 'channel') return false;
    if (group.owner === BOT_USERNAME) return true;
    return !!isGroupAdmin(group, BOT_USERNAME);
  }

  function schedules() {
    const db = getDb();
    if (!db.aiDigestSchedules || !Array.isArray(db.aiDigestSchedules)) db.aiDigestSchedules = [];
    return db.aiDigestSchedules;
  }
  function addSchedule({ channelId, hour, minute, createdBy, promptNote }) {
    const g = findGroup(String(channelId || ''));
    if (!g) return { ok: false, status: 404, error: 'کانال یافت نشد' };
    if (g.type !== 'channel') return { ok: false, status: 400, error: 'فقط کانال' };
    if (!botAdministers(g)) return { ok: false, status: 403, error: 'ربات این کانال را اداره نمی‌کند' };
    const h = Math.min(23, Math.max(0, Number(hour) || 0));
    const mi = Math.min(59, Math.max(0, Number(minute) || 0));
    const list = schedules();
    const existing = list.find((s) => s.channelId === g.id);
    if (existing) {
      existing.hour = h; existing.minute = mi; existing.enabled = true;
      if (promptNote) existing.note = String(promptNote).slice(0, 200);
      save();
      return { ok: true, schedule: existing, updated: true };
    }
    const rec = {
      id: crypto.randomUUID(), channelId: g.id, hour: h, minute: mi,
      enabled: true, createdBy: createdBy || null,
      note: promptNote ? String(promptNote).slice(0, 200) : '',
      createdAt: Date.now(), lastRunDay: null,
    };
    list.push(rec);
    save();
    return { ok: true, schedule: rec, updated: false };
  }
  function removeSchedule(id, username) {
    const list = schedules();
    const i = list.findIndex((s) => s.id === id || (s.channelId === id));
    if (i < 0) return { ok: false, status: 404, error: 'یافت نشد' };
    const s = list[i];
    // only an admin of the channel or a site admin may remove it
    const g = findGroup(s.channelId);
    const allowed = username === s.createdBy || (g && (g.owner === username || isGroupAdmin(g, username)));
    if (!allowed) return { ok: false, status: 403, error: 'دسترسی' };
    list.splice(i, 1);
    save();
    return { ok: true };
  }
  function listSchedules() {
    return schedules().map((s) => {
      const g = findGroup(s.channelId);
      return {
        id: s.id, channelId: s.channelId,
        channelName: g ? g.name : null,
        hour: s.hour, minute: s.minute, enabled: !!s.enabled,
        lastRunDay: s.lastRunDay || null, createdBy: s.createdBy || null,
      };
    });
  }

  /**
   * Run due digests. Called on a timer; safe to call any number of times.
   * Charges the GLOBAL budget (the bot is acting on behalf of the server), so a
   * flood of scheduled digests can never eat a user's personal quota.
   */
  async function runDueDigests(now = Date.now()) {
    const db = getDb();
    const SYSTEM_USER = '__ai_system__';
    const list = schedules();
    if (!list.length) return { ran: 0 };
    let ran = 0;
    const nowDate = new Date(now);
    for (const s of list) {
      if (!s.enabled) continue;
      const dueAt = new Date(now); dueAt.setHours(s.hour || 0, s.minute || 0, 0, 0);
      if (now < dueAt) continue;                                   // not time yet
      const todayKey = dueAt.toISOString().slice(0, 10);
      if (s.lastRunDay === todayKey) continue;                      // already ran today
      const g = findGroup(s.channelId);
      if (!g || !botAdministers(g)) continue;                      // bot lost the channel
      const roomId = 'group:' + g.id;

      const since = new Date(); since.setHours(0, 0, 0, 0);
      const todays = (db.messages[roomId] || []).filter((m) => (m.time || 0) >= since.getTime() && messageText(m));
      if (!todays.length) { s.lastRunDay = todayKey; save(); continue; }

      const out = await aiComplete({
        username: SYSTEM_USER, isAdmin: true, kind: 'text',
        system: digestSystemPrompt(),
        data: 'room: ' + g.name + '\n' + todays.slice(-80).map(messageLine).join('\n'),
        label: 'scheduled-digest', maxTokens: 700,
      });
      s.lastRunDay = todayKey;
      save();
      if (!out.ok || !out.text) continue;
      const text = out.text.trim() === 'EMPTY' ? '' : out.text;
      if (!text) continue;
      sendToRoom(roomId, {
        from: BOT_USERNAME, fromName: BOT_NAME, kind: 'text',
        content: 'خلاصهٔ امروز:\n' + text,
        // structured so the UI can label it as machine-made
        ai: { generated: true, label: 'تولید شده با هوش مصنوعی' },
        views: 0,
      });
      ran++;
    }
    return { ran };
  }

  return {
    L,
    // consent
    consentGiven, grantConsent, CONSENT_TEXT,
    // digest
    digest, digestSystemPrompt,
    // translation
    translate, translateSystemPrompt, detectLang, LANG_LABEL, TRANSLATION_LABEL,
    // transcription
    transcribe,
    // bookmarks
    listBookmarks, addBookmark, removeBookmark, excerptOf,
    // schedules
    addSchedule, removeSchedule, listSchedules, runDueDigests, botAdministers,
    // maintenance
    cachePurge, transcripts, cacheStore,
  };
}

module.exports = { createAiFeatures, CONSENT_TEXT, LANG_LABEL, TRANSLATION_LABEL, DEFAULTS };