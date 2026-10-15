/* VORTEX Messenger — frontend (Premium Dark Cyber rebuild). Backend contract preserved. */
const $ = (s) => document.getElementById(s);
const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';
const BOT_UID = 100000;
let REACTIONS = ['👍', '❤️', '😂', '🥰', '😡', '👎', '🔥'];
const REACTION_LABELS = { '👍': 'thumbs up', '❤️': 'heart', '😂': 'laughing face', '🥰': 'smiling face with hearts', '😡': 'angry face', '👎': 'thumbs down', '🔥': 'fire' };
/* Reply gesture tuning — swipe-right on a message to reply. */
const REPLY_THRESHOLD = 56;        /* px of swipe past which the reply fires on release */
const REPLY_GRAB_TOLERANCE = 12;   /* px before the gesture is claimed as horizontal */
const REPLY_STICKY_RATIO = 1.6;      /* dx must stay > dy * ratio to keep the horizontal claim */
const REPLY_MAX_OFFSET = 90;       /* clamp of the visual drag distance */
function loadReactionConfig() {
  fetch('/api/react-config').then((r) => r.json()).then((d) => {
    if (d && Array.isArray(d.reactions) && d.reactions.length) {
      REACTIONS.splice(0, REACTIONS.length, ...d.reactions);
    }
  }).catch(() => {});
}
const esc = (s) => VXSanitize.escText(s);

/* ═══════════════════════════════════════════════════════════════════
   توانایی‌های هوش مصنوعی (فاز ۳)
   الگوی همان loadReactionConfig است: یک متغیر سطح ماژول که در جا
   مقدار واقعی سرور را می‌گیرد و همهٔ مصرف‌کننده‌ها تنبلانه می‌خوانند.
   بدون ارائه‌دهنده، enabled=false می‌شود و دکمه‌ها محترمانه غیرفعال
   می‌مانند: نه پنهان می‌شوند و نه خطا می‌دهند.
   ═══════════════════════════════════════════════════════════════════ */
const AI_CAP = {
  enabled: false, whisper: false, image: false,
  consentGiven: false, consentText: null,
  limits: {}, languages: {}, loaded: false,
};
function loadAiConfig() {
  return fetch('/api/ai/config', { headers: { Authorization: 'Bearer ' + (state.token || '') }, credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return null;
      AI_CAP.enabled = !!d.enabled;
      AI_CAP.whisper = !!d.whisper;
      AI_CAP.image = !!d.image;
      AI_CAP.consentGiven = !!d.consentGiven;
      AI_CAP.consentText = d.consentText || null;
      AI_CAP.limits = d.limits || {};
      AI_CAP.languages = d.languages || {};
      AI_CAP.loaded = true;
      applyAiAvailability();
      return d;
    })
    .catch(() => { AI_CAP.loaded = true; applyAiAvailability(); return null; });
}
function applyAiAvailability() {
  const navAi = document.querySelector('.nav-item[data-nav="ai"]');
  if (navAi) navAi.classList.toggle('ai-disabled', !AI_CAP.enabled);
  const convAi = $('conv-ai');
  if (convAi) {
    convAi.disabled = !AI_CAP.enabled;
    convAi.title = AI_CAP.enabled ? 'خلاصهٔ امروز' : 'هوش مصنوعی تنظیم نشده است';
    convAi.setAttribute('aria-label', AI_CAP.enabled ? 'خلاصهٔ امروز' : 'هوش مصنوعی تنظیم نشده است');
  }
}

/* ── رضایت یک‌باره ────────────────────────────────────────────────
   هر کنش AI که محتوای گفتگو را به ارائه‌دهندهٔ بیرونی می‌فرستد، اول
   این بنر فارسی را یک‌بار نشان می‌دهد. متنش از سرور می‌آید تا با
   صفحهٔ حریم خصوصی هم‌خوان بماند. */
function aiConsentPrompt() {
  const t = AI_CAP.consentText || {};
  return new Promise((resolve) => {
    const pop = document.createElement('div');
    pop.className = 'u-pop ai-consent-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', t.title || 'رضایت هوش مصنوعی');
    pop.innerHTML =
      '<div class="u-pop-box">' +
      '<div class="u-pop-title">' + esc(t.title || 'ارسال محتوای گفتگو به هوش مصنوعی') + '</div>' +
      '<div class="u-pop-text">' + esc(t.body || 'متن پیام برای پردازش به ارائه‌دهندهٔ مدل ارسال می‌شود.') + '</div>' +
      '<div class="u-pop-actions">' +
      '<button class="btn sm ghost" data-k="0">' + esc(t.decline || 'نمی‌پذیرم') + '</button>' +
      '<button class="btn sm" data-k="1">' + esc(t.accept || 'می‌پذیرم') + '</button>' +
      '</div></div>';
    const done = (val) => { pop.remove(); resolve(val); };
    pop.querySelector('[data-k="0"]').onclick = () => done(false);
    pop.querySelector('[data-k="1"]').onclick = async () => {
      try {
        await api('/api/ai/consent', { method: 'POST', body: JSON.stringify({ consent: true }) });
        AI_CAP.consentGiven = true;
      } catch (e) { /* سرور نپذیرفت — به‌عنوان نپذیرفته‌شده رفتار می‌کنیم */ }
      done(true);
    };
    document.body.appendChild(pop);
    const b = pop.querySelector('[data-k="1"]');
    if (b) b.focus();
  });
}

/**
 * POST کمکی برای endpointهای AI فاز ۳.
 * اگر سرور ۴۲۸ (نیاز به رضایت) برگرداند، یک‌بار رضایت می‌گیرد و درخواست را تکرار می‌کند.
 * @returns {{ok:boolean, status:number, data:object}}
 */
async function aiPost(path, body, { retryConsent = true } = {}) {
  let r = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  let d = await r.json().catch(() => ({}));
  if (r.status === 428 && d && d.consentRequired && retryConsent) {
    const ok = await aiConsentPrompt();
    if (!ok) return { ok: false, status: 428, data: { error: 'رضایت داده نشد', cancelled: true } };
    r = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    d = await r.json().catch(() => ({}));
  }
  return { ok: r.ok, status: r.status, data: d || {} };
}

/* ── ۱) خلاصهٔ امروز ─────────────────────────────────────────────── */
const AI_DIGEST_CACHE = {};        // roomId -> {text, at}  (کش مرورگر: بدون خرج سهمیه)
function aiDigestSheet() {
  closeMsgCtx(); closeCtxMenus();
  const roomId = state.room;
  const rid = roomId || '';
  const pop = document.createElement('div');
  pop.className = 'ai-sheet';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.setAttribute('aria-label', 'خلاصهٔ امروز');
  pop.innerHTML =
    '<div class="ai-sheet-box">' +
    '<div class="ai-sheet-head"><span class="ai-sheet-title">' + esc(roomTitle(rid)) + '</span>' +
    '<button class="icon-btn ai-sheet-x" aria-label="بستن">' + ic('x') + '</button></div>' +
    '<div class="ai-sheet-body" id="ai-digest-body">' +
    '<div class="skeleton ai-sk-line"></div><div class="skeleton ai-sk-line"></div><div class="skeleton ai-sk-line short"></div>' +
    '</div>' +
    '<div class="ai-sheet-foot">' +
    '<span class="ai-prov-note">با ارائه‌دهندهٔ هوش مصنوعی تولید می‌شود</span>' +
    '<button class="btn sm ghost" id="ai-digest-refresh">به‌روزرسانی</button>' +
    '</div></div>';
  document.body.appendChild(pop);
  applyIcons(pop);
  const close = () => { pop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  pop.querySelector('.ai-sheet-x').onclick = close;
  pop.querySelector('#ai-digest-refresh').onclick = () => { aiDigestSheetRun(rid, true, pop); };
  pop.addEventListener('click', (e) => { if (e.target === pop) close(); });

  const cached = AI_DIGEST_CACHE[rid];
  if (cached && (Date.now() - cached.at) < 12 * 3600 * 1000) aiDigestRender(pop, cached.text, true);
  else aiDigestSheetRun(rid, false, pop);
  return pop;
}
function aiDigestRender(pop, text, cached) {
  const body = pop.querySelector('#ai-digest-body');
  if (!body) return;
  if (!text) {
    body.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'ai-empty';
    e.innerHTML = ic('file-text') + '<p>امروز پیام قابل‌خلاصه‌ای در این گفتگو نبود.</p>';
    body.appendChild(e);
    applyIcons(body);
    return;
  }
  // خروجی مدل فقط با textContent رندر می‌شود، نه innerHTML: پس یک پاسخ
  // مدلِ خصمانه نمی‌تواند تگ یا اسکریپت تزریق کند.
  const wrap = document.createElement('div');
  wrap.className = 'ai-digest-text';
  String(text).split('\n').forEach((line) => {
    if (!line.trim()) return;
    const p = document.createElement('p');
    p.textContent = line.replace(/^[-*•]\s*/, '');
    wrap.appendChild(p);
  });
  const tag = document.createElement('div');
  tag.className = 'ai-digest-tag';
  tag.textContent = 'خلاصهٔ ماشینی' + (cached ? ' — از کش' : '');
  wrap.appendChild(tag);
  body.innerHTML = '';
  body.appendChild(wrap);
}
async function aiDigestSheetRun(roomId, force, pop) {
  const body = pop && pop.querySelector('#ai-digest-body');
  if (!AI_CAP.enabled) { toast('هوش مصنوعی تنظیم نشده است.'); if (pop) pop.remove(); return; }
  if (body) body.innerHTML = '<div class="skeleton ai-sk-line"></div><div class="skeleton ai-sk-line"></div><div class="skeleton ai-sk-line short"></div>';
  const { ok, status, data } = await aiPost('/api/ai/digest', { roomId, force: !!force });
  if (!pop || !pop.isConnected) return;
  if (!ok) {
    if (data.cancelled) { pop.remove(); return; }
    if (body) {
      body.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'ai-error';
      e.textContent = data.error || 'خطا در ساخت خلاصه';
      body.appendChild(e);
    }
    if (status === 429) toast(data.error || 'سهمیه امروز تمام شد.');
    return;
  }
  AI_DIGEST_CACHE[roomId] = { text: data.digest || '', at: Date.now() };
  aiDigestRender(pop, data.digest || '', !!data.cached);
}

/* ── ۲) ترجمهٔ زندهٔ یک پیام (fa ↔ en) ────────────────────────────────
   ترجمه همیشه «زیر» پیام اصلی نمایش داده می‌شود و هرگز جای متن اصلی را
   نمی‌گیرد. نتیجه به‌ازای هر پیام کش می‌شود (سهمیه خرج نمی‌شود). */
function translationsKey() { return 'vx_translations_' + (state.me ? state.me.username : 'anon'); }
function loadTranslations() {
  try { const raw = localStorage.getItem(translationsKey()); state.translations = raw ? JSON.parse(raw) : {}; }
  catch (e) { state.translations = {}; }
}
function saveTranslations() {
  try {
    const keep = {}; const now = Date.now();
    for (const [id, v] of Object.entries(state.translations || {})) {
      if (v && v.at && (now - v.at) < 30 * 24 * 3600 * 1000) keep[id] = v;
    }
    state.translations = keep;
    localStorage.setItem(translationsKey(), JSON.stringify(keep));
  } catch (e) {}
}
function aiTranslationEl(msgId) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-translation';
  wrap.dataset.for = msgId;
  const cached = state.translations && state.translations[msgId];
  if (cached) { aiTranslationFill(wrap, cached.text, cached.lang, true); return wrap; }
  const head = document.createElement('div');
  head.className = 'msg-translation-head';
  head.innerHTML = ic('languages') + '<span>در حال ترجمه…</span>';
  wrap.appendChild(head);
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'skeleton ai-sk-line' }));
  applyIcons(wrap);
  return wrap;
}
function aiTranslationFill(wrap, text, lang, cached) {
  wrap.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'msg-translation-head';
  const langName = (lang && AI_CAP.languages[lang]) ? ' — ' + AI_CAP.languages[lang] : '';
  head.innerHTML = ic('languages') + '<span>' + esc('ترجمهٔ ماشینی' + langName) + '</span>'
    + (cached ? '<span class="ai-cached">از کش</span>' : '');
  wrap.appendChild(head);
  const p = document.createElement('div');
  p.className = 'msg-translation-text';
  p.textContent = text;                    // textContent: نه innerHTML
  wrap.appendChild(p);
  applyIcons(head);
}
async function aiTranslateMessage(msg, bubble) {
  if (!AI_CAP.enabled) { toast('هوش مصنوعی تنظیم نشده است.'); return; }
  const { ok, status, data } = await aiPost('/api/ai/translate', { roomId: msg.roomId || state.room, msgId: msg.id });
  if (data.cancelled) return;
  if (!ok) { toast(data.error || 'ترجمه انجام نشد'); if (status === 429) haptic(20); return; }
  state.translations = state.translations || {};
  state.translations[msg.id] = { text: data.text, lang: data.lang, at: Date.now() };
  saveTranslations();
  if (bubble) {
    let el = bubble.querySelector('.msg-translation');
    if (!el) { el = aiTranslationEl(msg.id); bubble.appendChild(el); }
    aiTranslationFill(el, data.text, data.lang, !!data.cached);
  } else {
    toast(String(data.text).slice(0, 140));
  }
}

/* ── ۳) تبدیل پیام صوتی به متن ─────────────────────────────────────── */
function transcriptsKey() { return 'vx_transcripts_' + (state.me ? state.me.username : 'anon'); }
function loadTranscripts() {
  try { const raw = localStorage.getItem(transcriptsKey()); state.transcripts = raw ? JSON.parse(raw) : {}; }
  catch (e) { state.transcripts = {}; }
}
function saveTranscripts() {
  try {
    const keep = {}; const now = Date.now();
    for (const [id, v] of Object.entries(state.transcripts || {})) {
      if (v && v.at && (now - v.at) < 30 * 24 * 3600 * 1000) keep[id] = v;
    }
    state.transcripts = keep;
    localStorage.setItem(transcriptsKey(), JSON.stringify(keep));
  } catch (e) {}
}
function aiTranscriptEl(msgId) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-transcript';
  wrap.dataset.for = msgId;
  const cached = state.transcripts && state.transcripts[msgId];
  if (cached) { aiTranscriptFill(wrap, cached.text, true); return wrap; }
  const head = document.createElement('div');
  head.className = 'msg-translation-head';
  head.innerHTML = ic('mic') + '<span>در حال تبدیل صدا به متن…</span>';
  wrap.appendChild(head);
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'skeleton ai-sk-line' }));
  applyIcons(wrap);
  return wrap;
}
function aiTranscriptFill(wrap, text, cached) {
  wrap.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'msg-translation-head';
  head.innerHTML = ic('mic') + '<span>' + esc('متن پیام صوتی' + (cached ? ' — از کش' : '')) + '</span>';
  wrap.appendChild(head);
  const p = document.createElement('div');
  p.className = 'msg-translation-text';
  p.textContent = text;
  wrap.appendChild(p);
  applyIcons(head);
}
async function aiTranscribeMessage(msg, bubble) {
  if (!AI_CAP.enabled || !AI_CAP.whisper) { toast('تبدیل صدا به متن تنظیم نشده است.'); return; }
  const { ok, status, data } = await aiPost('/api/ai/transcribe', { roomId: msg.roomId || state.room, msgId: msg.id });
  if (data.cancelled) return;
  if (!ok) { toast(data.error || 'تبدیل صدا به متن انجام نشد'); if (status === 429) haptic(20); return; }
  state.transcripts = state.transcripts || {};
  state.transcripts[msg.id] = { text: data.text, at: Date.now() };
  saveTranscripts();
  if (bubble) {
    let el = bubble.querySelector('.msg-transcript');
    if (!el) { el = aiTranscriptEl(msg.id); bubble.appendChild(el); }
    aiTranscriptFill(el, data.text, !!data.cached);
  } else {
    toast(String(data.text).slice(0, 140));
  }
}

/* ── ۴) پیام‌های ذخیره‌شده (نشانک) ───────────────────────────────────
   کاملاً خصوصی: فقط کاربر خودش می‌بیند و هیچ متنی به AI ارسال نمی‌شود. */
const BOOKMARK_IDLE = new Set();
async function aiBookmarkToggle(msg) {
  const rid = msg.roomId || state.room;
  const key = rid + '|' + msg.id;
  const has = BOOKMARK_IDLE.has(key);
  haptic(12);
  try {
    if (has) {
      const r = await api('/api/bookmarks/' + encodeURIComponent(key), { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || 'حذف نشانک ناموفق بود'); return; }
      BOOKMARK_IDLE.delete(key);
      toast('از پیام‌های ذخیره‌شده حذف شد');
    } else {
      const r = await api('/api/bookmarks', { method: 'POST', body: JSON.stringify({ roomId: rid, msgId: msg.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || 'ذخیره ناموفق بود'); return; }
      BOOKMARK_IDLE.add(key);
      toast('در پیام‌های ذخیره‌شده ذخیره شد');
    }
    markMessageSaved(msg);
  } catch (e) { toast('خطا در ارتباط با سرور'); }
}
function markMessageSaved(msg) {
  const id = (window.CSS && CSS.escape) ? CSS.escape(msg.id) : msg.id;
  const el = document.querySelector('.msg[data-id="' + id + '"]');
  if (!el) return;
  const b = el.querySelector('.bubble');
  if (!b) return;
  const badge = b.querySelector('.msg-saved');
  const isSaved = BOOKMARK_IDLE.has((msg.roomId || state.room) + '|' + msg.id);
  if (isSaved && !badge) {
    const s = document.createElement('span');
    s.className = 'msg-saved';
    s.title = 'در پیام‌های ذخیره‌شده';
    s.innerHTML = ic('bookmark');
    b.appendChild(s);
    applyIcons(s);
  } else if (!isSaved && badge) {
    badge.remove();
  }
}
/** پرش به پیام ذخیره‌شده: اتاق باز می‌شود و پیام برجسته و اسکرول می‌خورد. */
async function jumpToBookmark(b) {
  closeMsgCtx(); closeAllOverlays();
  const rid = String(b.roomId || '');
  if (!rid) return;
  try { openRoom(rid); } catch (e) { toast('این گفتگو دیگر در دسترس نیست'); return; }
  const mid = String(b.msgId || '');
  const escId = (window.CSS && CSS.escape) ? CSS.escape(mid) : mid;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const el = document.querySelector('.msg[data-id="' + escId + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('msg-flash');
      setTimeout(() => el.classList.remove('msg-flash'), 2200);
      return;
    }
  }
  toast('این پیام دیگر در تاریخچه نیست');
}
function renderBookmarksInto(wrap) {
  wrap.innerHTML = '<div class="bm-list" id="bm-list"></div>';
  loadBookmarksInto(wrap.querySelector('#bm-list'));
}
async function loadBookmarksInto(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  const sk = document.createDocumentFragment();
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'bm-row bm-skel';
    d.appendChild(Object.assign(document.createElement('div'), { className: 'skeleton ai-sk-line' }));
    sk.appendChild(d);
  }
  listEl.appendChild(sk);
  try {
    const r = await api('/api/bookmarks');
    const d = await r.json().catch(() => ({}));
    const items = Array.isArray(d.bookmarks) ? d.bookmarks : [];
    listEl.innerHTML = '';
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'ai-empty';
      e.innerHTML = ic('bookmark') + '<p>هنوز پیامی ذخیره نکرده‌اید.</p><small>روی هر پیام، گزینهٔ «ذخیرهٔ پیام» را بزنید.</small>';
      listEl.appendChild(e);
      applyIcons(listEl);
      return;
    }
    for (const b of items) listEl.appendChild(bookmarkRow(b));
    applyIcons(listEl);
  } catch (e) {
    listEl.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'ai-error';
    err.textContent = 'بارگذاری پیام‌های ذخیره‌شده ناموفق بود';
    listEl.appendChild(err);
  }
}
function bookmarkRow(b) {
  const row = document.createElement('div');
  row.className = 'bm-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  const when = b.at ? new Date(b.at).toLocaleString('fa-IR') : '';
  const main = document.createElement('div');
  main.className = 'bm-row-main';
  const ex = document.createElement('div');
  ex.className = 'bm-excerpt';
  ex.textContent = b.excerpt || '…';
  const sub = document.createElement('div');
  sub.className = 'bm-sub';
  sub.textContent = (b.note ? b.note + ' · ' : '') + when;
  main.appendChild(ex); main.appendChild(sub);
  const del = document.createElement('button');
  del.className = 'icon-btn bm-del';
  del.setAttribute('aria-label', 'حذف از پیام‌های ذخیره‌شده');
  del.innerHTML = ic('trash-2');
  row.appendChild(main); row.appendChild(del);
  row.onclick = (e) => { if (e.target.closest('.bm-del')) return; jumpToBookmark(b); };
  row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToBookmark(b); } };
  del.onclick = async (e) => {
    e.stopPropagation();
    try {
      const r = await api('/api/bookmarks/' + encodeURIComponent(b.id), { method: 'DELETE' });
      if (!r.ok) { toast('حذف ناموفق بود'); return; }
      row.remove();
      BOOKMARK_IDLE.delete(b.id);
      toast('حذف شد');
    } catch (err) { toast('خطا در ارتباط با سرور'); }
  };
  return row;
}
const escAttr = (s) => VXSanitize.escAttr(s);
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();
function ic(n) { return '<i data-lucide="' + VXSanitize.sanitizeIconName(n) + '" class="icon"></i>'; }
function luc() { if (window.lucide) { try { lucide.createIcons(); } catch (e) {} } }
function applyIcons(scope) { if (window.lucide && scope) { try { lucide.createIcons(scope); } catch (e) {} } }
let _chatListTimer = null;
function scheduleChatListRefresh(delay) {
  clearTimeout(_chatListTimer);
  _chatListTimer = setTimeout(buildChatList, delay || 250);
}
function fmt(t) {
  if (!t) return ''; const d = new Date(t); const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'دیروز ' + hh + ':' + mm;
  return d.toLocaleDateString('fa-IR') + ' ' + hh + ':' + mm;
}
function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  return fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? opts.body : undefined });
}
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; $('toast').appendChild(t); setTimeout(() => t.remove(), 2600); }
function avatarEl(u, size) {
  const a = document.createElement('div'); a.className = 'av ' + (size || 'sm');
  if (u && u.avatar) { const i = document.createElement('img'); i.src = u.avatar; a.appendChild(i); }
  else a.textContent = initial(u && (u.displayName || u.displayName) ? u.displayName : (u && (u.username || u.displayName) ? (u.displayName || u.username) : '?'));
  const key = String(a.textContent || '').trim() || '?';
  let g = 0; for (let i = 0; i < key.length; i++) { g = ((g * 31) + key.charCodeAt(i)) >>> 0; }
  a.classList.add('hg-' + (g % 8));
  if (u && (u.danger || u.restricted)) { const mf = document.createElement('span'); mf.className = 'av-flag' + (u.restricted && !u.danger ? ' av-rest' : ''); mf.textContent = u.danger ? '!' : '⛔'; a.appendChild(mf); }
  return a;
}
const IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function isMobile() { return window.innerWidth <= 1024 || IS_TOUCH; }
function detectLowEnd() {
  let s = 0;
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) s++;
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) s++;
  if (navigator.connection && navigator.connection.effectiveType) {
    if (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === 'slow-2g') s += 2;
  }
  if (window.innerWidth <= 420) s++;
  return s >= 2;
}
const LOW_END = detectLowEnd();
if (LOW_END && document.documentElement) document.documentElement.setAttribute('data-lowend', '1');
function showScrim(v) { const s = $('scrim'); if (s) s.classList.toggle('hidden', !v); }
function closeDrawers() { $('nav-sidebar').classList.remove('m-open'); showScrim(false); }

/* MOBILE KEYBOARD — جلوگیری از بالا پریدن چت هنگام باز شدن کیبورد */
(function () {
  const appEl = document.getElementById('app');
  if (!appEl || !window.visualViewport) return;
  let kbOpen = false;
  function inputFocused() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
  }
  function onVv() {
    const vv = window.visualViewport;
    const diff = window.innerHeight - vv.height;
    if (diff > 60) {
      kbOpen = true;
      const hpx = Math.round(vv.height) + 'px';
      appEl.style.height = hpx;
      appEl.style.maxHeight = hpx;
      document.documentElement.style.height = hpx;
      const c = document.getElementById('composer');
      if (c && inputFocused()) c.scrollIntoView({ block: 'nearest' });
    } else if (kbOpen) {
      kbOpen = false;
      appEl.style.height = '';
      appEl.style.maxHeight = '';
      document.documentElement.style.height = '';
    }
  }
  window.visualViewport.addEventListener('resize', onVv);
  window.visualViewport.addEventListener('scroll', onVv);
})();
const state = {
  token: localStorage.getItem('ft_token') || null, me: null, ws: null,
  groups: [], users: [], chatState: {}, readState: {}, pinned: {},
  room: null, replyTo: null, rooms: {}, chatFilter: 'all', search: '', nav: 'chats', notifications: [], groupSearch: [], userSearch: [],
  deletedIds: new Set(), renderedRooms: new Set(), uidCache: {},
  fontScale: parseInt(localStorage.getItem('vx_fontsize') || '14', 10),
  profileReturnRoom: null,
  profileReturnNav: null,
};
const MSG_RENDER_LIMIT = 100;

/* surface any leaked error visibly instead of a silently dead UI */
window.addEventListener('error', function (ev) {
  try { console.error('UNCAUGHT:', ev.error || ev.message); } catch (e) {}
});
window.addEventListener('unhandledrejection', function (ev) {
  try { console.error('UNHANDLED PROMISE:', ev.reason); } catch (e) {}
});

/* AUTH */
const authPhone = $('auth-phone'), authCode = $('auth-code'), authName = $('auth-name'), authUname = $('auth-username');
const stepPhone = $('auth-step-phone'), stepCode = $('auth-step-code'), stepName = $('auth-step-name'), stepPass = $('auth-step-pass');
const authError = $('auth-error');
// Phone+OTP فعال است. برای غیرفعال‌سازی موقت (مثل Bug Hunt): true بگذار (هم‌گام با server.js).
const AUTH_PHONE_OFF = false;
let authPhoneVal = '', authBusy = false;
function showAuthStep(s) { stepPhone.classList.toggle('hidden', s !== 'phone'); stepCode.classList.toggle('hidden', s !== 'code'); stepName.classList.toggle('hidden', s !== 'name'); if (stepPass) stepPass.classList.toggle('hidden', s !== 'pass'); authError.textContent = ''; }
function authErr(m, ok) { authError.textContent = m; authError.style.color = ok ? 'var(--success)' : 'var(--danger)'; }
function authBusyState(busy) { authBusy = busy; $('auth-send').disabled = busy; $('auth-verify').disabled = busy; $('auth-finish').disabled = busy; const pl = $('auth-pass-login'); if (pl) pl.disabled = busy; if (busy) { $('auth-send').textContent = 'در حال ارسال…'; } else { $('auth-send').textContent = 'دریافت کد'; } }
function normalizePhoneDisplay(p) { return p.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s\-()]/g, ''); }
// ذخیرهٔ هویت هر شماره روی دستگاه — تا دفعهٔ بعد دیگر نام/آیدی نپرسد
function phoneProfiles() { try { return JSON.parse(localStorage.getItem('vx_phone_accounts') || '{}'); } catch { return {}; } }
function savePhoneProfile(phone, username, displayName) {
  if (!phone) return;
  const m = phoneProfiles(); m[phone] = { username, displayName };
  try { localStorage.setItem('vx_phone_accounts', JSON.stringify(m)); } catch (e) {}
}
// کش نشست: snapshot «من» + توکن در localStorage — تا با هر باز شدن اپ، یک‌راست برویم
// داخل پیام‌رسان و نشست در پس‌زمینه راستی‌آزمایی شود (بدون فلش صفحهٔ شماره).
function cacheMeNow() { try { localStorage.setItem('ft_me', JSON.stringify(state.me)); localStorage.setItem('ft_me_ts', String(Date.now())); } catch (e) {} }
function cachedMe() { try { const r = localStorage.getItem('ft_me'); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function finishLogin(d) { if (d.me) savePhoneProfile(authPhoneVal, d.me.username, d.me.displayName); state.token = d.token; state.me = d.me; localStorage.setItem('ft_token', d.token); cacheMeNow(); enterApp(); }
async function autoCompleteRegister(phone, code) {
  const prof = phoneProfiles()[phone];
  if (!prof || !prof.username) return false;
  const r = await fetch('/api/complete-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code, displayName: prof.displayName || prof.username, username: prof.username }) });
  const d = await r.json().catch(() => ({}));
  if (d.token && d.me) { finishLogin(d); return true; }
  return false;
}
$('auth-send').onclick = async () => {
  if (AUTH_PHONE_OFF) { showAuthStep('pass'); return authErr('ورود با شماره موبایل (OTP) موقتاً غیرفعال است'); }
  if (authBusy) return;
  const raw = authPhone.value.trim();
  const phone = normalizePhoneDisplay(raw);
  if (!/^09\d{9}$/.test(phone)) return authErr('شماره موبایل معتبر نیست (باید با ۰۹ شروع شود و ۱۱ رقم باشد)');
  authBusyState(true);
  try { const r = await fetch('/api/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); const d = await r.json();
    if (!r.ok) { authErr(d.error || 'خطا'); authBusyState(false); return; } authPhoneVal = phone;
    // حالت تست بدون کد: اگر حساب موجود باشد مستقیم وارد می‌شویم؛ وگرنه فقط نام/آیدی می‌خواهیم
    if (d.token && d.me) { authBusyState(false); return finishLogin(d); }
    if (d.needsName) {
      authName.value = phoneProfiles()[authPhoneVal] ? (phoneProfiles()[authPhoneVal].displayName || '') : '';
      authUname.value = phoneProfiles()[authPhoneVal] ? (phoneProfiles()[authPhoneVal].username || '') : '';
      $('auth-phone-label').textContent = phone;
      authBusyState(false);
      return showAuthStep('name');
    }
    $('auth-phone-label').textContent = 'شماره ' + phone + ' — کد ورود در همین صفحه آمده است:';
    showAuthStep('code'); authBusyState(false);
    const shown = $('auth-shown-code');
    if (d.devCode) { shown.textContent = d.devCode; shown.classList.remove('hidden'); authCode.value = d.devCode; }
    else { shown.classList.add('hidden'); authCode.value = '';
      if (d.note) authErr(d.note, true); else authErr('کد به صورت پیامک به این شماره ارسال شد؛ اگر پیامک در دسترس نیست روی سرور VX_HIDE_CODE را بردار.', true); }
  } catch (e) { authErr('خطا در برقراری ارتباط با سرور — مطمئن شو سرور روشن است', true); authBusyState(false); }
};
$('auth-verify').onclick = async () => {
  if (AUTH_PHONE_OFF) { showAuthStep('pass'); return authErr('ورود با شماره موبایل (OTP) موقتاً غیرفعال است'); }
  if (authBusy) return;
  const code = authCode.value.trim();
  if (!/^\d{6}$/.test(code)) return authErr('کد باید ۶ رقمی باشد');
  authBusyState(true);
  try {
    const r = await fetch('/api/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: authPhoneVal, code }) });
    const d = await r.json();
    if (!r.ok) { authBusyState(false); return authErr(d.error || 'خطا'); }
    if (d.token) { authBusyState(false); return finishLogin(d); }
    if (d.needsName) {
      // اگر این شماره قبلاً در همین دستگاه ثبت شده بود، بدون پرسیدن دوباره وارد می‌شویم
      const auto = await autoCompleteRegister(authPhoneVal, code);
      authBusyState(false);
      if (auto) return;
      authName.value = phoneProfiles()[authPhoneVal] ? (phoneProfiles()[authPhoneVal].displayName || '') : '';
      authUname.value = phoneProfiles()[authPhoneVal] ? (phoneProfiles()[authPhoneVal].username || '') : '';
      return showAuthStep('name');
    }
    authBusyState(false);
  } catch (e) { authBusyState(false); authErr('خطا در برقراری ارتباط با سرور — دوباره تلاش کن', true); }
};
$('auth-finish').onclick = async () => {
  if (AUTH_PHONE_OFF) { showAuthStep('pass'); return authErr('ورود با شماره موبایل (OTP) موقتاً غیرفعال است'); }
  if (authBusy) return;
  const displayName = authName.value.trim();
  if (displayName.length < 2) return authErr('نام نمایشی حداقل ۲ حرف باشد');
  authBusyState(true);
  try { const uname = authUname.value.trim().replace(/^@/, ''); const r = await fetch('/api/complete-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: authPhoneVal, code: authCode.value.trim(), displayName, username: (uname || '') }) }); const d = await r.json();
    authBusyState(false);
    if (!r.ok) return authErr(d.error || 'خطا'); if (d.token && d.me) { savePhoneProfile(authPhoneVal, d.me.username, d.me.displayName); return finishLogin(d); } if (d.pending) { authErr(d.message || 'درخواست ثبت شد؛ منتظر تایید ادمین', true); return; }
  } catch (e) { authErr(e.message); authBusyState(false); }
};
$('auth-to-pass').onclick = () => showAuthStep('pass');
$('auth-pass-to-phone').onclick = () => { if (AUTH_PHONE_OFF) authErr('ورود با شماره موبایل (OTP) موقتاً غیرفعال است — از نام کاربری و رمز عبور استفاده کن'); else showAuthStep('phone'); };
$('auth-pass-login').onclick = async () => {
  if (authBusy) return;
  const username = $('auth-pass-username').value.trim();
  const password = $('auth-pass-password').value;
  if (!username) return authErr('نام کاربری را وارد کنید');
  if (!password) return authErr('رمز عبور را وارد کنید');
  authBusyState(true);
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const d = await r.json();
    authBusyState(false);
    if (!r.ok) { authErr(d.error || 'خطا'); return; }
    authPhoneVal = '';
    return finishLogin(d);
  } catch (e) { authBusyState(false); authErr(e.message); }
};
authPhone.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-send').click(); });
authCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-verify').click(); });
authName.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-finish').click(); });
const authPU = $('auth-pass-username'), authPP = $('auth-pass-password');
if (authPU) authPU.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-pass-login').click(); });
if (authPP) authPP.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-pass-login').click(); });

// Bug Hunt: Phone+OTP بسته — پنل شماره به‌صورت غیرفعال/هشدار نمایش داده می‌شود و پیش‌فرض ورود رمز عبور است.
if (AUTH_PHONE_OFF) {
  const offNote = $('auth-phone-off');
  if (offNote) offNote.classList.remove('hidden');
  $('auth-phone').disabled = true;
  $('auth-send').disabled = true;
  const ptp = $('auth-pass-to-phone');
  if (ptp) ptp.textContent = 'ورود با شماره موبایل (غیرفعال)';
  showAuthStep('pass');
}

/* APPEARANCE */
function applyAppearance() {
  const D = window.VXDesign;
  if (D) {
    /* VXDesign is the single writer for theme, accent (incl. custom accent
       variables), aurora, bubble radius and the reduce-glass fallback. */
    D.setTheme(localStorage.getItem('vx_theme') || 'cyber');
    D.setAccent(localStorage.getItem('vx_accent') || 'blue', localStorage.getItem('vx_accent_custom') || '');
  } else {
    const th = localStorage.getItem('vx_theme') || 'cyber';
    if (th === 'cyber' || !th) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
    document.documentElement.setAttribute('data-accent', localStorage.getItem('vx_accent') || 'blue');
  }
  const fs = state.fontScale || 14;
  document.documentElement.style.fontSize = fs + 'px';
  applyBackground();
  const fontKey = localStorage.getItem('vx_font') || 'default';
  const FONT_MAP = { default: '', messenger: '"Vazirmatn","Segoe UI",Tahoma,sans-serif', classic: 'Tahoma,"Segoe UI",sans-serif', modern: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' };
  document.body.style.fontFamily = FONT_MAP[fontKey] || '';
}
applyAppearance();

/* ENTER */
function enterApp() {
  $('auth-screen').classList.add('hidden'); $('app').classList.remove('hidden');
  /* لینک مستقیم مثل /app?room=dm:ali|sara&uid=100005 ⇒ همان چت باز شود */
  const deep = urlRoom();
  if (deep) state._deepRoom = deep;
  syncUrl(deep, { replace: true });
  wireDesignControls(); renderDesignControls();
  state.userFolders = null; // reload per-account folders now that state.me is known
  renderFolderBar();
  renderNav(); renderDock(); buildChatList(); hydrateRooms().then(() => buildChatList()); connectWS(); applyVX();
  showImpersonateBanner();
  if (isMobile()) { $('chat-list-column').classList.remove('m-open'); $('conversation').classList.remove('chat-open'); }
  if (state.me.isAdmin) {
    api('/api/admin/users').then((r) => r.json()).then((d) => { if (d.users) { state.users = d.users; buildChatList(); } }).catch(() => {});
    api('/api/admin/requests').then((r) => r.json()).then((d) => { const list = (d.requests || []).filter((s) => s.status === 'pending'); state.signupCount = list.length; renderNav(); }).catch(() => {});
  }
  if (pinIsSet()) pinShow('login');
}

/* ═══════════ PIN LOCK ═══════════ */
const PIN_LS = 'vx_pin';
const PIN_LEN = 6;
let _pinBuf = '';
let _pinMode = 'login';
let _pinErrTimer = null;
function pinIsSet() { return !!localStorage.getItem(PIN_LS); }
async function pinHash(pin) {
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return pin;
}
async function pinVerify(pin) {
  const h = await pinHash(pin);
  const stored = localStorage.getItem(PIN_LS);
  return h === stored;
}
function pinClearErr() {
  const err = document.getElementById('pin-err'); if (err) err.textContent = '';
  document.querySelectorAll('.pin-dots span.err').forEach((s) => s.classList.remove('err'));
}
function pinUpdateDots() {
  const dots = document.querySelectorAll('#pin-screen .pin-dots span');
  dots.forEach((d, i) => { d.classList.toggle('on', i < _pinBuf.length); });
}
function pinCreateScreen() {
  if ($('pin-screen')) return;
  const pin = document.createElement('div'); pin.id = 'pin-screen'; pin.className = 'hidden';
  pin.innerHTML = '<div class="pin-backdrop"></div>' +
    '<div class="pin-card">' +
    '<div class="pin-title" id="pin-title">یک PIN وارد کنید</div>' +
    '<div class="pin-sub">برای ورود به VORTEX</div>' +
    '<div class="pin-dots"></div>' +
    '<div class="pin-err" id="pin-err"></div>' +
    '<div class="pin-keypad"></div>' +
    '<div class="pin-forgot" id="pin-forgot">فراموشی PIN؟</div>' +
    '</div>';
  document.body.appendChild(pin);
  const pad = pin.querySelector('.pin-keypad');
  const layout = ['1','2','3','4','5','6','7','8','9','—','0','←'];
  layout.forEach((n) => {
    const b = document.createElement('button'); b.className = 'pin-key';
    if (n === '—') { b.className += ' empty'; }
    else if (n === '←') { b.innerHTML = ic('delete'); b.className += ' back'; }
    else b.textContent = n;
    if (n !== '—') {
      b.onclick = () => {
        if (n === '←') pinBackspace(); else pinInput(n);
      };
    }
    pad.appendChild(b);
  });
  pin.querySelector('.pin-backdrop').onclick = () => { /* don't close by click */ };
  $('pin-forgot').onclick = () => { pinHide(); $('auth-screen').classList.remove('hidden'); $('app').classList.add('hidden'); };
  for (let i = 0; i < PIN_LEN; i++) { const s = document.createElement('span'); pin.querySelector('.pin-dots').appendChild(s); }
}
function pinShow(mode) {
  pinCreateScreen();
  _pinMode = mode; _pinBuf = ''; pinClearErr(); pinUpdateDots();
  const title = $('pin-title');
  if (mode === 'set') { title.textContent = 'تنظیم PIN'; $('pin-sub').textContent = 'یک PIN ۶ رقمی انتخاب کنید'; }
  else if (mode === 'change') { title.textContent = 'تغییر PIN'; $('pin-sub').textContent = 'PIN جدید را وارد کنید'; }
  else { title.textContent = 'PIN وارد کنید'; $('pin-sub').textContent = 'برای ورود به VORTEX'; }
  $('pin-screen').classList.remove('hidden');
}
function pinHide() { const s = $('pin-screen'); if (s) s.classList.add('hidden'); }
function pinInput(digit) {
  if (_pinBuf.length >= PIN_LEN) return;
  _pinBuf += digit; pinUpdateDots(); pinClearErr();
  if (_pinBuf.length === PIN_LEN) {
    if (_pinMode === 'login') pinLogin();
    else pinSet();
  }
}
function pinBackspace() {
  if (!_pinBuf.length) return;
  _pinBuf = _pinBuf.slice(0, -1); pinUpdateDots(); pinClearErr();
}
async function pinLogin() {
  const ok = await pinVerify(_pinBuf);
  if (ok) { _pinBuf = ''; pinUpdateDots(); pinHide(); }
  else { pinShakeErr('PIN اشتباه است'); }
}
async function pinSet() {
  const h = await pinHash(_pinBuf);
  localStorage.setItem(PIN_LS, h);
  try { api('/api/profile/settings', { method: 'POST', body: JSON.stringify({ pinHash: h }) }); } catch (e) {}
  _pinBuf = ''; pinUpdateDots(); pinHide(); toast('PIN ذخیره شد');
}
function pinShakeErr(msg) {
  const err = $('pin-err'); if (err) err.textContent = msg;
  document.querySelectorAll('#pin-screen .pin-dots span').forEach((s) => s.classList.add('err'));
  clearTimeout(_pinErrTimer);
  _pinErrTimer = setTimeout(pinClearErr, 1200);
}
pinCreateScreen(); // ready before any login

/* NAV */
const NAV = [
  { id: 'chats', label: 'چت‌ها', icon: 'message-square' },
  { id: 'contacts', label: 'مخاطبین', icon: 'contact' },
  { id: 'communities', label: 'کامیونیتی‌ها', icon: 'users' },
  { id: 'channels', label: 'کانال‌ها', icon: 'megaphone' },
  { id: 'discover', label: 'کشف', icon: 'compass' },
  { id: 'ai', label: 'دستیار هوشمند', icon: 'sparkles' },
  { id: 'cloud', label: 'حافظه ابری', icon: 'cloud' },
  { id: 'tasks', label: 'وظایف', icon: 'check-square' },
  { id: 'calendar', label: 'تقویم', icon: 'calendar' },
  { id: 'users', label: 'کاربران', icon: 'users' },
  { id: 'signups', label: 'درخواست تغییر نام', icon: 'user-plus' },
  { id: 'stats', label: 'آمار', icon: 'bar-chart-2' },
  { id: 'audit', label: 'حسابرسی ادمین', icon: 'shield' },
  { id: 'reports', label: 'گزارش‌ها', icon: 'alert-triangle' },
  { id: 'bookmarks', label: 'نشان‌ها', icon: 'bookmark' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
];
function renderNav() {
  const sc = $('nav-scroll'); sc.innerHTML = '';
  const nav = $('nav-profile');
  const av = avatarEl(state.me, 'sm'); av.id = 'nav-av'; nav.replaceChild(av, $('nav-av'));
  $('nav-name').textContent = state.me.displayName;
  nav.onclick = () => openProfile(state.me.username);
  const adminOnly = ['users', 'signups', 'stats', 'reports', 'audit'];
  NAV.forEach((n) => {
    if (adminOnly.includes(n.id) && !state.me.isAdmin) return;
    const d = document.createElement('div'); d.className = 'nav-item' + (state.nav === n.id ? ' active' : '');
    d.dataset.nav = n.id; d.innerHTML = ic(n.icon) + '<span class="label">' + n.label + '</span>' + (n.id === 'ai' ? '<span class="nav-badge">AI</span>' : '') + (n.id === 'signups' && state.signupCount ? '<span class="nav-badge">' + state.signupCount + '</span>' : '');
    d.onclick = () => switchNav(n.id); sc.appendChild(d);
  });
  luc();
}
$('nav-toggle').onclick = () => { if (isMobile()) { $('nav-sidebar').classList.remove('m-open'); showScrim(false); } else $('nav-sidebar').classList.toggle('expanded'); };
$('nav-pencil').onclick = (e) => { e.stopPropagation(); openPencilMenu(e.currentTarget); };
function openPencilMenu(anchor) {
  const menu = $('pencil-menu'); if (!menu) return;
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  menu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  let left = r.right + 8, top = r.top;
  if (left + 230 > window.innerWidth - 8) left = Math.max(8, r.left - 230 - 8);
  if (top + 120 > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 128);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  luc();
}
document.addEventListener('click', (e) => {
  const menu = $('pencil-menu');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !e.target.closest('#nav-pencil')) menu.classList.add('hidden');
});
const pmMenu = $('pencil-menu'); if (pmMenu) pmMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.pencil-menu-item');
  if (item && item.dataset.type) {
    $('pencil-menu').classList.add('hidden');
    if (item.dataset.type === 'group') startGroup();
    else if (item.dataset.type === 'channel') startGroup(true);
    return;
  }
  if (e.target.closest('.pencil-menu-close') || e.target === $('pencil-menu')) $('pencil-menu').classList.add('hidden');
});
function switchNav(id) {
  state.nav = id;
  /* leaving settings always re-opens it at the category list, never a stale sub-page */
  if (id !== 'settings') state.settingsCat = 'main';
  if (isMobile()) $('nav-sidebar').classList.remove('m-open');
  if (id === 'chats') { setMode('chats'); if (isMobile()) { closeDrawers(); $('conversation').classList.remove('chat-open'); } }
  else { setMode('view'); renderView(id); closeDrawers(); if (isMobile()) { $('conversation').classList.add('chat-open'); } }
  /* نشانی صفحه با زبانهٔ فعال هماهنگ شود (برای دکمهٔ برگشت مرورگر) */
  syncUrl(id === 'chats' ? state.room : null, { view: id === 'chats' ? null : id });
  document.querySelectorAll('.nav-item').forEach((e) => e.classList.toggle('active', e.dataset.nav === id));
  /* Phase 4: morph the floating pill highlight to the matching tab */
  if (pillEl) requestAnimationFrame(() => syncPillIndicator(true));
  if (pillBtns.chats) syncPillBadge(totalUnread());
}
let viewHost = null;
function setMode(mode) {
  if (!viewHost) { viewHost = document.createElement('div'); viewHost.id = 'view-host'; viewHost.className = 'view hidden'; $('conversation').appendChild(viewHost); }
  const chat = mode === 'chats';
  if (chat) { viewHost.dataset.view = ''; viewHost.innerHTML = ''; }
  $('conv-empty').classList.toggle('hidden', chat ? !!state.room : true);
  $('conv-main').classList.toggle('hidden', chat ? !state.room : true);
  viewHost.classList.toggle('hidden', chat);
  if (chat) { $('chat-list-column').classList.remove('hidden'); }
  else {
    $('chat-list-column').classList.add('hidden');
    /* on phones #conversation is translated off-screen until .chat-open — any
       view screen (settings, profile, contacts…) must reveal it too */
    if (isMobile()) $('conversation').classList.add('chat-open');
  }
  /* desktop/tablet grid: collapse the 320px chat-list track while a full view
     is on screen so it never reserves an empty band next to settings/profile */
  $('app').classList.toggle('app-view', !chat);
}

/* ── Phase 4: floating glass pill (replaces the old bottom dock) ──
   Four primary destinations: Chats / Contacts / Settings / Profile. Everything
   else (communities, channels, discover, AI, tasks, calendar, bookmarks) stays
   reachable from the sidebar drawer, so nothing is lost by promoting these four.

   The active highlight is a single element that translates between tabs rather
   than four separately-animated backgrounds: one composited transform instead of
   four, which is what keeps this smooth on a weak phone. */
const PILL_TABS = [
  { id: 'chats', label: 'چت‌ها', icon: 'message-square' },
  { id: 'contacts', label: 'مخاطبان', icon: 'contact' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
  { id: 'profile', label: 'پروفایل', icon: 'user' },
];
let pillEl = null, pillIndEl = null, pillBtns = {};

function buildPill() {
  if (pillEl) return pillEl;
  pillEl = document.createElement('nav');
  pillEl.className = 'vx-pill';
  pillEl.setAttribute('role', 'tablist');
  pillEl.setAttribute('aria-label', 'ناوبری اصلی');

  pillIndEl = document.createElement('div');
  pillIndEl.className = 'vx-pill-ind';
  pillEl.appendChild(pillIndEl);

  for (const t of PILL_TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vx-pill-btn';
    b.dataset.pill = t.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-label', t.label);
    if (t.id === 'profile') {
      b.innerHTML = '<span class="vx-pill-av" aria-hidden="true">؟</span><span class="lb">' + esc(t.label) + '</span>';
    } else {
      b.innerHTML = ic(t.icon) + '<span class="lb">' + esc(t.label) + '</span>';
    }
    b.onclick = () => {
      if (t.id === 'profile') { try { openProfile(state.me.username); } catch (e) { switchNav('settings'); } return; }
      switchNav(t.id);
    };
    // Keyboard: Left/Right (RTL-aware) to move between tabs, Home/End to jump.
    b.onkeydown = (e) => movePillFocus(e, b);
    pillBtns[t.id] = b;
    const badge = document.createElement('span');
    badge.className = 'vx-pill-badge';
    badge.hidden = true;
    b.appendChild(badge);
    pillEl.appendChild(b);
  }
  document.body.appendChild(pillEl);
  requestAnimationFrame(() => syncPillIndicator(false));
  return pillEl;
}

function movePillFocus(e, from) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (keys.indexOf(e.key) < 0) return;
  e.preventDefault();
  const list = PILL_TABS.map((t) => pillBtns[t.id]).filter(Boolean);
  const i = list.indexOf(from);
  let n = i;
  // ARIA: "next tab" is ArrowRight in ltr and ArrowLeft in rtl.
  const rtl = (pillEl && getComputedStyle(pillEl).direction === 'rtl');
  const next = rtl ? 'ArrowLeft' : 'ArrowRight';
  if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = list.length - 1;
  else n = (i + (e.key === next ? 1 : -1) + list.length) % list.length;
  const target = list[n];
  if (target) { target.focus(); }
}

/** Position the morphing highlight under the active tab. */
function syncPillIndicator(animate = true) {
  if (!pillEl || !pillIndEl) return;
  if (!animate) pillIndEl.style.transition = 'none';
  for (const t of PILL_TABS) {
    const b = pillBtns[t.id];
    if (!b) continue;
    const active = pillActiveId() === t.id;
    b.setAttribute('aria-selected', active ? 'true' : 'false');
    b.tabIndex = active ? 0 : -1;
  }
  const activeBtn = pillBtns[pillActiveId()] || pillBtns[PILL_TABS[0].id];
  if (activeBtn) {
    // Measure with rects (not offsetLeft): offsetLeft is direction-dependent and
    // the pill lays out right-to-left under fa, so rects are the only value that
    // is correct in both writing modes.
    const pr = pillEl.getBoundingClientRect();
    const br = activeBtn.getBoundingClientRect();
    if (pr.width > 0 && br.width > 0) {
      const border = parseFloat(getComputedStyle(pillEl).borderLeftWidth) || 0;
      pillIndEl.style.width = br.width + 'px';
      pillIndEl.style.transform = 'translateX(' + Math.round(br.left - pr.left - border) + 'px)';
    }
  }
  if (!animate) {
    // force a reflow so the transition we just disabled does not linger
    void pillIndEl.offsetWidth;
    pillIndEl.style.transition = '';
  }
}
function pillActiveId() {
  // Profile is a page/modal, not a nav section. Any secondary nav
  // (discover, ai, tasks…) keeps Chats lit because that is the home family.
  return PILL_TABS.some((t) => t.id === state.nav) ? state.nav : 'chats';
}

/** Total unread across every room, for the pill's Chats badge. */
function totalUnread() {
  let n = 0;
  try {
    for (const rid in state.rooms) {
      const r = state.rooms[rid];
      if (!r || r.archived) continue;
      n += computeUnread(rid, r) || 0;
    }
  } catch (e) { return 0; }
  return n;
}

/** Unread badge on the Chats tab. */
function syncPillBadge(total) {
  const b = pillBtns.chats;
  if (!b) return;
  const badge = b.querySelector('.vx-pill-badge');
  if (!badge) return;
  const n = Math.max(0, Number(total) || 0);
  badge.hidden = n <= 0;
  badge.textContent = n > 99 ? '۹۹+' : String(n);
}

function renderDock() {
  buildPill();
  // Profile avatar in the pill
  const av = pillBtns.profile && pillBtns.profile.querySelector('.vx-pill-av');
  if (av) {
    const u = state.me || {};
    av.textContent = '';
    if (u.avatar) { const img = document.createElement('img'); img.src = u.avatar; img.alt = ''; av.appendChild(img); }
    else av.textContent = initial(u.displayName || u.username || '?');
  }
  syncPillIndicator(false);
  syncPillBadge(totalUnread());
}

/* ── Phase 4: design controls (glass + power saving) ──
   The sidebar footer exposes the two switches that belong to the shell itself.
   They read/write VXDesign, which owns detection and persistence. Later slices
   surface the same state on the Power-saving page; these stay as the quick path. */
const POWER_MODES = [
  { id: 'auto', label: 'خودکار', hint: 'بر اساس توان دستگاه تعیین می‌شود' },
  { id: 'saver', label: 'ذخیره باتری', hint: 'بلور و جلوه‌های سنگین خاموش می‌شوند' },
  { id: 'full', label: 'کامل', hint: 'همه جلوه‌ها و بلور فعال' },
];
function renderDesignControls() {
  const g = $('nav-glass'), p = $('nav-power');
  if (!g || !p) return;
  const D = window.VXDesign;
  if (!D) { g.disabled = true; p.disabled = true; return; }
  const glass = !!D.glass;
  g.setAttribute('aria-pressed', glass ? 'true' : 'false');
  g.classList.toggle('is-off', !glass);
  g.setAttribute('aria-label', 'بلور شیشه‌ای ' + (glass ? 'روشن است؛ برای خاموش کردن' : 'خاموش است؛ برای روشن کردن') + ' کلیک کنید');

  const mode = D.power;
  const cur = POWER_MODES.find((m) => m.id === mode) || POWER_MODES[0];
  const lbl = p.querySelector('.label');
  if (lbl) lbl.textContent = cur.label;
  p.dataset.mode = mode;
  p.classList.toggle('is-on', mode === 'saver');
  p.setAttribute('aria-label', 'حالت مصرف انرژی: ' + cur.label + ' — ' + cur.hint + '؛ برای تغییر کلیک کنید');
}
let _designWired = false;
function wireDesignControls() {
  if (_designWired) return;
  _designWired = true;
  const g = $('nav-glass'), p = $('nav-power');
  if (g) g.onclick = () => { const D = window.VXDesign; if (D) { D.toggleGlass(); renderDesignControls(); toast(D.glass ? 'بلور روشن شد' : 'بلور خاموش شد'); } };
  if (p) p.onclick = () => {
    const D = window.VXDesign; if (!D) return;
    // auto → saver → full → auto : the common choice (saver) comes first
    const order = POWER_MODES.map((m) => m.id);
    const next = order[(order.indexOf(D.power) + 1) % order.length];
    D.setPower(next);
    renderDesignControls();
    const cur = POWER_MODES.find((m) => m.id === next) || POWER_MODES[0];
    toast('حالت انرژی: ' + cur.label);
  };
  window.addEventListener('vx-design', renderDesignControls);
}

/* WEBSOCKET */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host); state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: state.token }));
  ws.onmessage = (ev) => { try { handleWS(JSON.parse(ev.data)); } catch (e) { try { console.error('WS:', e && e.stack ? e.stack : e); } catch (e2) {} } };
  ws.onclose = () => setTimeout(() => { if (state.token && $('app') && !$('app').classList.contains('hidden')) connectWS(); }, 2500);
}
function handleWS(d) {
  switch (d.type) {
    case 'ready': state.me = d.me; state.groups = d.groups || []; state.chatState = d.chatState || {}; state.readState = d.readState || {}; state.pinned = d.pinned || {}; state.dmRooms = d.dmRooms || []; for (const [rid, pv] of Object.entries(d.previews || {})) { const pr = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); if (pr.messages.length && !pr.previewOnly) { if (pv && (!pr.last || pv.time > pr.last.time)) { const idx = pr.messages.findIndex((m) => m.id === pv.id); if (idx >= 0) pr.messages[idx] = pv; else { pr.messages.push(pv); pr.lastSync = Date.now(); } pr.last = pv; } pr.unread = pv && (pv.unread !== undefined) ? pv.unread : pr.unread; } else { pr.messages = pv ? [pv] : []; pr.last = pv || null; pr.unread = pv ? (pv.unread || 0) : 0; pr.previewOnly = true; } } loadReactionConfig(); loadAiConfig(); loadTranslations(); loadTranscripts(); renderNav(); renderDock(); buildChatList(); scheduleRoomsPersist(); handleInviteFollow(); handleGroupInvite();
      /* چتِ لینک مستقیم فقط وقتی باز می‌شود که WebSocket آماده و احرازهویت شده باشد */
      if (state._deepRoom) { const deep = state._deepRoom; state._deepRoom = null; try { openRoom(deep, { fromHistory: true }); } catch (e) {} }
      break;
    case 'users': state.users = d.users || []; scheduleChatListRefresh(); break;
    case 'profile-updated': applyProfileUpdate(d); break;
    case 'groups': state.groups = d.groups || []; scheduleChatListRefresh(); break;
    case 'room-read': if (!state.readState[d.roomId]) state.readState[d.roomId] = {}; state.readState[d.roomId][d.username] = d.time; if (d.username === state.me.username && state.rooms[d.roomId]) state.rooms[d.roomId].unread = 0; scheduleChatListRefresh(); scheduleRoomsPersist(); refreshReadTicks(d.roomId); break;
    case 'history': {
      const hrid = d.roomId;
      if (d.incremental && state.rooms[hrid] && state.rooms[hrid].messages && state.rooms[hrid].messages.length && !state.rooms[hrid].previewOnly) {
        mergeHistory(state.rooms[hrid], d.messages || []);
        if (hrid !== state.room) { scheduleChatListRefresh(); scheduleRoomsPersist(); break; }
        if (!state.renderedRooms.has(hrid)) { $('messages').innerHTML = ''; state.lastDay = null; renderMessagesBatch((state.rooms[hrid].messages || []).slice(-MSG_RENDER_LIMIT)); renderReplyCounts(hrid); state.renderedRooms.add(hrid); }
        scheduleRoomsPersist();
        break;
      }
      if (hrid !== state.room) { cachePreview(hrid, d.messages); scheduleChatListRefresh(); break; }
      if (hrid) cachePreview(hrid, d.messages);
      if (!state.renderedRooms.has(hrid)) { $('messages').innerHTML = ''; state.lastDay = null; renderMessagesBatch((d.messages || []).slice(-MSG_RENDER_LIMIT)); renderReplyCounts(hrid); state.renderedRooms.add(hrid); }
      scheduleRoomsPersist();
      break;
    }
    case 'message': onNewMessage(d.message); scheduleRoomsPersist(); break;
    case 'message-updated': updateMessage(d); scheduleRoomsPersist(); break;
    case 'message-edited': {
      const rr = state.rooms[d.roomId]; if (rr) { const mm = rr.messages.find((x) => x.id === d.id); if (mm) { mm.content = d.content; mm.edited = true; } scheduleChatListRefresh(120); }
      const el = document.querySelector('[data-id="' + d.id + '"] .msg-body');
      if (el && typeof d.content === 'string') {
        el.innerHTML = formatText(d.content);
        const t = document.createElement('span'); t.className = 'msg-edited'; t.textContent = ' (ویرایش شد)'; el.appendChild(t);
      }
      const em = document.querySelector('[data-id="' + d.id + '"] .msg-meta'); if (em && !em.querySelector('.msg-ed')) { const ed = document.createElement('span'); ed.className = 'msg-ed'; ed.textContent = 'ویرایش‌شده'; em.insertBefore(ed, em.firstChild); }
      scheduleRoomsPersist();
      break;
    }
    case 'message-deleted': {
      state.deletedIds.add(d.id);
      if (_selectedMsgs.delete(d.id)) {
        renderSelectState();
        if (_selectedMsgs.size === 0) exitSelectMode();
        else renderSelectBar();
      }
      const el = document.querySelector('[data-id="' + d.id + '"]'); if (el) el.remove();
      const rr = state.rooms[d.roomId]; if (rr) { rr.messages = rr.messages.filter((m) => m.id !== d.id); rr.last = rr.messages[rr.messages.length - 1] || null; scheduleChatListRefresh(120); scheduleRoomsPersist(); }
      refreshDeletedRefs(d.id);
      if (d.roomId === state.room) renderReplyCounts(d.roomId);
      break;
    }
    case 'added-to': toast('به «' + (d.name || 'گروه') + '» اضافه شدی'); buildChatList(); break;
    case 'ai-thinking': if (d.roomId === state.room) { const sub = $('conv-sub'); if (sub) sub.textContent = 'هوش مصنوعی در حال فکر کردن…'; } break;
    case 'pinned-updated': state.pinned[d.roomId] = d.ids; break;
    case 'room-deleted': {
      delete state.rooms[d.roomId];
      delete state.chatState[d.roomId];
      delete state.readState[d.roomId];
      delete state.pinned[d.roomId];
      if (state.dmRooms) state.dmRooms = state.dmRooms.filter((r) => r !== d.roomId);
      if (state.room === d.roomId) {
        state.room = null;
        const m = $('messages'); if (m) m.innerHTML = '';
        showScrim(false);
      }
      buildChatList();
      break;
    }
    case 'typing': showTyping(d); break;
    case 'error': toast(d.text); break;
    case 'auth-failed': logout(true); break;
    case 'kicked': toast('حساب شما مسدود شد'); logout(true); break;
    case 'premium-changed': if (state.me) { state.me.isPremium = d.isPremium; renderNav(); } break;
    case 'rename-result': if (state.me) { if (d.approved) { state.me.displayName = d.displayName; toast('نام نمایشی شما تایید شد'); } else toast('درخواست تغییر نام شما رد شد'); renderNav(); } break;
  }
}

/* ROOMS */
function dmRoom(u) { return 'dm:' + [state.me.username, u.username].sort().join('|'); }
function chatFlags(rid) { return state.chatState[rid] || {}; }
function allRoomIds() {
  const ids = new Set();
  state.groups.forEach((g) => ids.add('group:' + g.id));
  ids.add('dm:' + [state.me.username, BOT_USERNAME].sort().join('|'));
  if (state.me.isAdmin) state.users.filter((u) => u.username !== state.me.username).forEach((u) => ids.add(dmRoom(u)));
  else Object.keys(getContacts()).forEach((u) => ids.add(dmRoom({ username: u })));
  Object.keys(state.rooms).forEach((rid) => { if (state.rooms[rid] && state.rooms[rid].messages && state.rooms[rid].messages.length > 0) ids.add(rid); });
  (state.dmRooms || []).forEach((rid) => ids.add(rid));
  return [...ids];
}
function contactsKey() { return 'vx_contacts_' + state.me.username; }
function getContacts() { try { return JSON.parse(localStorage.getItem(contactsKey()) || '{}'); } catch { return {}; } }
function saveContacts(c) { localStorage.setItem(contactsKey(), JSON.stringify(c)); }
function applyProfileUpdate(d) {
  if (!d || !d.username || !state.me) return;
  const p = d.user || {};
  if (d.username === state.me.username) {
    state.me = Object.assign({}, state.me, p);
    renderNav();
    const tv = document.getElementById('nav-name'); if (tv) tv.textContent = state.me.displayName;
  } else {
    if (typeof p.uid === 'number') state.uidCache[d.username] = p.uid;
    const idx = state.users.findIndex((u) => u.username === d.username);
    if (idx >= 0) state.users[idx] = Object.assign({}, state.users[idx], p);
  }
  if (p.displayName || p.avatar) {
    const c = getContacts();
    if (c[d.username] !== undefined && p.displayName) { c[d.username] = p.displayName; saveContacts(c); }
  }
  scheduleChatListRefresh(0);
  if (state.room) {
    const other = state.room.startsWith('dm:') ? state.room.slice(3).split('|').find((x) => x !== state.me.username) : null;
    if (other === d.username) renderRoomHeader();
  }
  const vh = document.querySelector('#view-host .profile-view');
  if (vh && vh.dataset && vh.dataset.uid === d.username) renderProfile(d.username);
}
function handleInviteFollow() {
  const inviter = localStorage.getItem('vx_inviter');
  if (!inviter || !state.me || inviter === state.me.username) return;
  localStorage.removeItem('vx_inviter');
  const c = getContacts(); c[inviter] = inviter; saveContacts(c);
  const cur = state.users.find((u) => u.username === inviter); if (cur && !(cur.displayName)) { cur.displayName = inviter; }
  toast('با @' + inviter + ' از لینک دعوت آشنا شدی');
  const rid = 'dm:' + [state.me.username, inviter].sort().join('|');
  setTimeout(() => openRoom(rid), 400);
}
function handleGroupInvite() {
  const token = localStorage.getItem('vx_group_invite');
  if (!token || !state.me) return;
  localStorage.removeItem('vx_group_invite');
  api('/api/groups/join/' + encodeURIComponent(token), { method: 'POST' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { toast((d.error || 'لینک دعوت نامعتبر')); return; }
    toast('به «' + (d.group && d.group.name || 'گروه') + '» پیوستی');
    buildChatList();
    if (d.group && d.group.id) setTimeout(() => openRoom('group:' + d.group.id), 500);
  }).catch(() => toast('خطا در پیوستن به گروه'));
}
function cachePreview(rid, msgs) { const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.messages = msgs; r.last = msgs[msgs.length - 1] || null; r.unread = 0; r.previewOnly = false; r.lastSync = Date.now(); }
function fetchPreviews() { allRoomIds().forEach((rid, i) => setTimeout(() => { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'history', roomId: rid })); }, i * 60)); }

/* CHAT LIST */
function buildChatList() {
  const wrap = $('cl-items'); wrap.innerHTML = '';
  let rooms = allRoomIds().map((rid) => {
    const r = state.rooms[rid] || { messages: [], last: null, unread: 0 }; const last = r.last;
    let title = rid, sub = '', isGroup = rid.startsWith('group:'), isBot = false, online = false;
    if (isGroup) { const g = state.groups.find((x) => 'group:' + x.id === rid); title = g ? g.name : rid; sub = (g ? g.members.length : 0) + ' عضو'; }
    else { const other = rid.slice(3).split('|').find((p) => p !== state.me.username); isBot = other === BOT_USERNAME; const u = state.users.find((x) => x.username === other) || { username: other, displayName: getContacts()[other] || other }; title = isBot ? BOT_NAME : (u.displayName || other); if (state.me.isAdmin) { const fu = state.users.find((x) => x.username === other); online = fu ? !!fu.online && !fu.banned : false; } if (isBot) online = true; }
    const flags = chatFlags(rid); const unread = computeUnread(rid, r);
    const lastMsg = last ? (last.from === state.me.username ? 'شما: ' : '') + previewText(last) : 'چت را شروع کنید';
    return { rid, title, sub, lastMsg, lastTime: last ? last.time : 0, unread, online, pinned: !!flags.pinned, archived: !!flags.archived, muted: !!flags.muted, isBot, isGroup };
  });
  const f = state.chatFilter || 'all';
  rooms = rooms.filter((r) => roomMatchesFolder(r.rid, r, f));
  const blocked = (state.me && Array.isArray(state.me.blocked)) ? state.me.blocked : [];
  rooms = rooms.filter((r) => { if (r.isGroup || r.isBot) return true; const other = r.rid.slice(3).split('|').find((p) => p !== state.me.username); return !blocked.includes(other); });
  if (state.search) { const q = state.search.toLowerCase(); rooms = rooms.filter((r) => r.title.toLowerCase().includes(q)); }
  rooms.sort((a, b) => (b.pinned - a.pinned) || (b.lastTime - a.lastTime));
  const active = rooms.filter((r) => !r.archived);
  const archived = rooms.filter((r) => r.archived);
  const searchHits = !!(state.search && (state.userSearch.length || state.groupSearch.length));
  if (state.search && state.userSearch.length) {
    const head = document.createElement('div'); head.className = 'arch-head static'; head.innerHTML = ic('contact') + '<span>مخاطبین یافت‌شده (' + state.userSearch.length + ')</span>';
    wrap.appendChild(head);
    state.userSearch.forEach((u) => wrap.appendChild(searchUserItemEl(u)));
  }
  if (state.search && state.groupSearch.length) {
    const head = document.createElement('div'); head.className = 'arch-head'; head.innerHTML = ic('search') + '<span>گروه‌ها و کانال‌های یافت‌شده (' + state.groupSearch.length + ')</span>';
    wrap.appendChild(head);
    state.groupSearch.forEach((g) => wrap.appendChild(groupSearchItemEl(g)));
  }
  if (!active.length && !archived.length && !searchHits) {
    if (state.search || (state.chatFilter && state.chatFilter !== 'all')) {
      const isCustom = String(state.chatFilter).indexOf('f:') === 0;
      const inCustom = isCustom && (userFolders().find((x) => 'f:' + x.id === state.chatFilter) || {});
      wrap.innerHTML = '<div class="empty-state"><div class="es-ic">🔍</div><div class="es-title">چتی یافت نشد</div><div class="es-sub">'
        + (state.search
          ? 'برای «' + esc(state.search) + '» چیزی پیدا نشد'
          : (inCustom && inCustom.name
            ? 'هنوز چتی در پوشهٔ «' + esc(inCustom.name) + '» نیست'
            : 'در این دسته چتی وجود ندارد'))
        + '</div></div>';
      applyIcons(wrap);
      syncPillBadge(totalUnread());
      updateFolderCounts();
      return;
    }
    wrap.innerHTML = '<div class="empty-state"><div class="es-ic">💬</div><div class="es-title">چتی یافت نشد</div><div class="es-sub">یک گفتگو را شروع کنید یا از کانال‌های عمومی زیر بپیوندید</div></div><div class="explore-row" id="explore-row"><div class="skeleton" style="flex:0 0 148px;height:120px"></div><div class="skeleton" style="flex:0 0 148px;height:120px"></div><div class="skeleton" style="flex:0 0 148px;height:120px"></div></div>';
    loadExploreRow(wrap.querySelector('#explore-row'));
    applyIcons(wrap);
    syncPillBadge(totalUnread());
    updateFolderCounts();
    return;
  }
  if (archived.length) {
    const head = document.createElement('div'); head.className = 'arch-head'; head.innerHTML = ic('archive') + '<span>آرشیو (' + archived.length + ')</span>'; head.onclick = () => { state.archivedOpen = !state.archivedOpen; buildChatList(); };
    wrap.appendChild(head);
    if (state.archivedOpen) archived.forEach((r) => { const el = chatItemEl(r); el.classList.add('archived'); wrap.appendChild(el); });
  }
  active.forEach((r) => wrap.appendChild(chatItemEl(r)));
  applyIcons(wrap);
  syncPillBadge(totalUnread());
  updateFolderCounts();
}
const GROUP_CAT_LABELS = { tech: 'تکنولوژی', finance: 'مالی و ارز', sports: 'ورزشی', culture: 'فرهنگ و ادب', fun: 'سرگرمی', learn: 'آموزش', media: 'فیلم و رسانه', games: 'بازی', study: 'تحصیلی', other: 'سایر' };
function exploreCardEl(g) {
  const card = document.createElement('div');
  card.className = 'explore-card';
  const av = avatarEl(g.avatar ? { avatar: g.avatar, displayName: g.name } : { displayName: g.name }, 'md');
  card.innerHTML = '<div class="ex-av"></div><div class="ex-name">' + esc(g.name) + '</div><div class="ex-sub">' + (g.members || 0) + ' عضو' + (g.username ? ' • @' + esc(g.username) : '') + '</div>';
  card.querySelector('.ex-av').appendChild(av);
  const join = document.createElement('button');
  join.className = 'btn sm';
  join.textContent = 'عضویت';
  join.setAttribute('aria-label', 'عضویت در ' + (g.name || 'کانال'));
  join.onclick = async () => {
    join.disabled = true;
    try {
      const r = await (await api('/api/groups/' + g.id + '/join', { method: 'POST' })).json().catch(() => ({}));
      if (r && r.ok) { toast('عضویت انجام شد'); buildChatList(); setTimeout(() => openRoom('group:' + g.id), 300); }
      else { toast((r && r.error) || 'خطا در عضویت'); join.disabled = false; }
    } catch (e) { toast('خطا در عضویت'); join.disabled = false; }
  };
  card.appendChild(join);
  return card;
}
async function loadExploreRow(row) {
  if (!row) return;
  try {
    const d = await (await api('/api/groups/explore')).json().catch(() => ({}));
    const list = (d && d.groups) || [];
    row.innerHTML = '';
    if (!list.length) { row.remove(); return; }
    list.forEach((g) => row.appendChild(exploreCardEl(g)));
  } catch (e) { if (row.isConnected) row.remove(); }
}
function chatItemEl(r) {
  const it = document.createElement('div');
  const unread = (r.unread || 0) > 0;
  it.className = 'chat-item swipe' + (state.room === r.rid ? ' active' : '') + (unread ? ' unread' : '');
  it.dataset.roomId = r.rid;

  let avSrc = null, kindIcon = null;
  if (r.isGroup) {
    const g = state.groups.find((x) => 'group:' + x.id === r.rid);
    if (g && g.avatar) avSrc = g.avatar;
    kindIcon = (g && g.type === 'channel') ? 'megaphone' : 'users';
  } else if (r.isBot) {
    kindIcon = 'bot';
  }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: r.title } : (r.isBot ? { displayName: BOT_NAME } : { displayName: r.title }), 'md');

  const tag = r.isBot ? ' <span class="ci-tag bot">BOT</span>' : '';
  const time = r.lastTime ? fmt(r.lastTime) : '';
  const flags = (r.pinned ? '<span class="ci-flag pin" title="سنجاق‌شده">' + ic('pin') + '</span>' : '')
    + (r.muted ? '<span class="ci-flag mute" title="بی‌صدا">' + ic('volume-x') + '</span>' : '');

  const surf = document.createElement('div');
  surf.className = 'ci-surface';
  // role lives on the sliding surface, not the row: the swipe action buttons are
  // siblings of it, so no interactive control ever nests inside a button.
  surf.setAttribute('role', 'button');
  surf.tabIndex = 0;
  surf.setAttribute('aria-label', r.title + (unread ? '، ' + r.unread + ' پیام خوانده‌نشده' : ''));
  surf.innerHTML =
    '<div class="ci-av">' + av.outerHTML
    + (r.online ? '<span class="online-dot"></span>' : '')
    + (kindIcon ? '<span class="ci-type" aria-hidden="true">' + ic(kindIcon) + '</span>' : '')
    + '</div>'
    + '<div class="ci-body">'
    + '<div class="ci-row1"><div class="ci-name">' + esc(r.title) + tag + '</div><div class="ci-time">' + esc(time) + '</div></div>'
    + '<div class="ci-row2">' + flags
    + '<div class="ci-last">' + esc(r.lastMsg) + '</div>'
    + (unread ? '<div class="ci-badge' + (r.muted ? ' muted' : '') + '">' + (r.unread > 99 ? '۹۹+' : r.unread) + '</div>' : '')
    + '</div></div>';

  // swipe layers: drag toward the writing-mode start to expose the end actions
  const start = document.createElement('div');
  start.className = 'ci-actions start';
  start.innerHTML = '<button class="ci-act read" type="button">' + ic('check-check') + '<span>خوانده شد</span></button>';
  const end = document.createElement('div');
  end.className = 'ci-actions end';
  end.innerHTML = '<button class="ci-act mute" type="button">' + ic(r.muted ? 'volume-2' : 'volume-x') + '<span>' + (r.muted ? 'صدا' : 'بی‌صدا') + '</span></button>'
    + '<button class="ci-act archive" type="button">' + ic(r.archived ? 'archive-restore' : 'archive') + '<span>' + (r.archived ? 'خروج از آرشیو' : 'آرشیو') + '</span></button>';

  it.appendChild(start);
  it.appendChild(end);
  it.appendChild(surf);

  start.querySelector('.ci-act').onclick = (e) => {
    e.stopPropagation(); closeChatSwipe();
    try { markRead(r.rid); buildChatList(); toast('علامت‌گذاری به‌عنوان خوانده‌شده'); } catch (e2) {}
  };
  end.querySelector('.ci-act.mute').onclick = (e) => {
    e.stopPropagation(); const was = r.muted; closeChatSwipe();
    setFlag(r.rid, 'muted', !was); toast(was ? 'صدای چت روشن شد' : 'چت بی‌صدا شد');
  };
  end.querySelector('.ci-act.archive').onclick = (e) => {
    e.stopPropagation(); const was = r.archived; closeChatSwipe();
    setFlag(r.rid, 'archived', !was); toast(was ? 'از آرشیو خارج شد' : 'به آرشیو رفت');
  };

  let suppressClick = false;
  const activate = () => {
    if (suppressClick) return;
    if (openChatSwipeRow === it) { closeChatSwipe(); return; }
    openRoom(r.rid);
  };
  surf.onclick = activate;
  surf.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); activate(); }
    else if (e.key === 'Escape' && openChatSwipeRow === it) closeChatSwipe();
  };
  it.oncontextmenu = (e) => { e.preventDefault(); closeChatSwipe(); openChatMenu(e, r.rid); };

  bindChatSwipe(it, surf, () => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); });
  return it;
}

/* ── swipe behaviour ──
   One rule works in both writing modes: dragging toward the mode's *start*
   exposes the actions parked at the *end* (mute/archive), the reverse exposes
   the start actions (mark read). Past 80px the layer opens so its buttons can
   be tapped; a shorter drag snaps back. */
var openChatSwipeRow = null;
function closeChatSwipe() {
  if (!openChatSwipeRow) return;
  const surf = openChatSwipeRow.querySelector('.ci-surface');
  if (surf) surf.style.transform = '';
  openChatSwipeRow.classList.remove('open');
  openChatSwipeRow = null;
}
function chatSwipeOutside(e) {
  if (!openChatSwipeRow) return;
  if (openChatSwipeRow.contains(e.target)) {
    document.addEventListener('pointerdown', chatSwipeOutside, { once: true, capture: true });
    return;
  }
  closeChatSwipe();
}
function bindChatSwipe(row, surf, onDragged) {
  const startEl = row.querySelector('.ci-actions.start');
  const endEl = row.querySelector('.ci-actions.end');
  let sx = 0, sy = 0, mx = 0, rtl = false, active = false, decided = false;
  const THRESH = 80, MAX = 210;

  surf.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (openChatSwipeRow && openChatSwipeRow !== row) closeChatSwipe();
    sx = e.clientX; sy = e.clientY; mx = 0;
    active = true; decided = false;
    rtl = (getComputedStyle(row).direction === 'rtl');
  });

  surf.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; return; } // vertical scroll wins
      decided = true;
      row.classList.add('swiping');
      surf.style.transition = 'none';
      try { surf.setPointerCapture(e.pointerId); } catch (err) {}
    }
    const towardStart = rtl ? dx : -dx;
    const endW = endEl.offsetWidth, startW = startEl.offsetWidth;
    let x = dx;
    if (towardStart > 0) {
      // revealing the END layer — never pull past its own width
      x = rtl ? Math.min(x, endW) : Math.max(x, -endW);
    } else {
      x = rtl ? Math.max(x, -startW) : Math.min(x, startW);
    }
    mx = Math.max(-MAX, Math.min(MAX, x));
    surf.style.transform = 'translateX(' + mx + 'px)';
    endEl.style.visibility = towardStart > 0 ? 'visible' : 'hidden';
    startEl.style.visibility = towardStart < 0 ? 'visible' : 'hidden';
  });

  const finish = () => {
    if (!active) return;
    active = false;
    if (!decided) { return; }
    surf.style.transition = '';
    row.classList.remove('swiping');
    endEl.style.visibility = '';
    startEl.style.visibility = '';
    const towardStart = rtl ? mx : -mx;
    const endW = endEl.offsetWidth, startW = startEl.offsetWidth;
    if (Math.abs(towardStart) >= THRESH) {
      surf.style.transform = towardStart > 0
        ? 'translateX(' + (rtl ? endW : -endW) + 'px)'
        : 'translateX(' + (rtl ? -startW : startW) + 'px)';
      row.classList.add('open');
      openChatSwipeRow = row;
      setTimeout(() => document.addEventListener('pointerdown', chatSwipeOutside, { once: true, capture: true }), 0);
    } else {
      surf.style.transform = '';
      if (openChatSwipeRow === row) openChatSwipeRow = null;
    }
    onDragged();
    mx = 0;
  };
  surf.addEventListener('pointerup', finish);
  surf.addEventListener('pointercancel', finish);
  surf.addEventListener('lostpointercapture', finish);
}
function searchUserItemEl(u) {
  const it = document.createElement('div'); it.className = 'chat-item'; it.dataset.uname = u.username;
  const surf = document.createElement('div');
  surf.className = 'ci-surface';
  surf.setAttribute('role', 'button');
  surf.tabIndex = 0;
  surf.setAttribute('aria-label', (u.displayName || u.username) + '، نام کاربری @' + u.username);
  surf.innerHTML = '<div class="ci-av">' + avatarEl(u, 'md').outerHTML + '</div><div class="ci-body"><div class="ci-row1"><div class="ci-name">' + esc(u.displayName || u.username) + '</div></div><div class="ci-row2"><div class="ci-last" dir="ltr">@' + esc(u.username) + '</div></div></div>';
  const go = () => openDM(u.username);
  surf.onclick = go;
  surf.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); go(); } };
  it.appendChild(surf);
  return it;
}
function groupSearchItemEl(g) {
  const isJoined = state.groups.some((x) => x.id === g.id);
  const it = document.createElement('div'); it.className = 'chat-item'; it.dataset.gid = g.id;
  const av = avatarEl(g.avatar ? { avatar: g.avatar, displayName: g.name } : { displayName: g.name }, 'md');
  const kind = (g.type === 'channel' ? 'کانال' : 'گروه');
  const sub = kind + ' • ' + (g.members || 0) + ' عضو' + (g.description ? ' • ' + esc(String(g.description).slice(0, 40)) : '');
  const surf = document.createElement('div');
  surf.className = 'ci-surface';
  surf.innerHTML = '<div class="ci-av">' + av.outerHTML + '<span class="ci-type" aria-hidden="true">' + ic(g.type === 'channel' ? 'megaphone' : 'users') + '</span></div><div class="ci-body"><div class="ci-row1"><div class="ci-name">' + esc(g.name) + (g.username ? ' <span style="font-size:10px;opacity:.7" dir="ltr">@' + esc(g.username) + '</span>' : '') + '</div></div><div class="ci-row2"><div class="ci-last">' + sub + '</div></div></div>';
  const join = document.createElement('button');
  join.className = 'btn sm';
  join.style.cssText = 'margin-inline:8px;flex:0 0 auto';
  join.textContent = isJoined ? 'ورود' : 'عضویت';
  join.setAttribute('aria-label', (isJoined ? 'ورود به ' : 'عضویت در ') + g.name);
  const openIt = (e) => {
    if (e) e.stopPropagation();
    if (isJoined) { openRoom('group:' + g.id); return; }
    api('/api/groups/' + g.id + '/join', { method: 'POST' }).then((r) => r.json().catch(() => ({}))).then((d) => {
      if (!d.ok) { toast((d && d.error) || 'خطا در عضویت'); return; }
      toast('عضویت انجام شد');
      setTimeout(() => openRoom('group:' + g.id), 300);
    }).catch(() => toast('خطا در عضویت'));
  };
  join.onclick = openIt;
  surf.setAttribute('role', 'button');
  surf.tabIndex = 0;
  surf.setAttribute('aria-label', g.name + '، ' + kind + '، ' + (g.members || 0) + ' عضو');
  surf.onclick = () => openIt();
  surf.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openIt(); } };
  it.appendChild(surf);
  it.appendChild(join);
  return it;
}
function computeUnread(rid, r) {
  if (!r) return 0;
  if (r.previewOnly) return r.unread || 0;
  if (!r.last) return 0; const rs = state.readState[rid] || {}; const read = rs[state.me.username] || 0; if (r.last.time <= read) return 0; return r.messages.filter((m) => m.time > read && m.from !== state.me.username).length;
}
function roomMembers(rid) { if (rid.startsWith('dm:')) return rid.slice(3).split('|'); if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g && Array.isArray(g.members) ? g.members : []; } return []; }
function isReadByOther(rid, m) { const rs = state.readState[rid] || {}; return roomMembers(rid).some((u) => u !== state.me.username && (rs[u] || 0) >= m.time); }
function refreshReadTicks(rid) { if (rid !== state.room) return; const r = state.rooms[rid]; if (!r) return; document.querySelectorAll('#messages .bubble').forEach((b) => { const m = r.messages.find((x) => x.id === b.dataset.id); if (!m || m.from !== state.me.username) return; const span = b.querySelector('.msg-meta .msg-time'); if (!span) return; const tick = span.querySelector('svg'); const want = isReadByOther(rid, m); const has = !!tick; if (want && !has) { span.insertAdjacentHTML('afterbegin', ic('check-check')); applyIcons(span); } else if (!want && has) { tick.remove(); span.insertAdjacentHTML('afterbegin', ic('check')); applyIcons(span); } }); }
function previewText(m) {
  if (!m) return '';
  if (m.kind === 'image') return '📷 تصویر';
  if (m.kind === 'gif') return '🎞 GIF';
  if (m.kind === 'album') { const n = Array.isArray(m.album) ? m.album.length : 0; return '🖼 کلاژ' + (n ? ' (' + n + ')' : ''); }
  if (m.kind === 'video') return '🎬 ویدیو';
  if (m.kind === 'file') return '📎 فایل' + (m.name ? ': ' + m.name : '');
  if (m.kind === 'audio' || m.kind === 'voice') return '🎙 پیام صوتی';
  if (m.kind === 'sticker') return 'استیکر';
  if (m.kind === 'poll') return '📊 نظرسنجی';
  if (m.kind === 'checklist') return '✅ چک‌لیست';
  if (m.kind === 'location') return '📍 ' + ((m.geo && m.geo.label) || (m.content || 'موقعیت')).slice(0, 50);
  return (m.content || '').slice(0, 60);
}
function msgSenderName(m) {
  if (!m) return '';
  if (m.from === state.me.username) return 'شما';
  const uid = m.from || '';
  const u = state.users.find((x) => x.username === uid);
  return m.fromName || (u && u.displayName) || uid || '';
}
/* ── Phase 4 slice B: folders ──
   Six built-in smart folders plus user folders. User folders are stored
   per-account in localStorage for now; slice D moves them to the server so they
   follow the account across devices. */
const SMART_FOLDERS = [
  { id: 'all', label: 'همه' },
  { id: 'unread', label: 'خوانده‌نشده' },
  { id: 'private', label: 'خصوصی' },
  { id: 'groups', label: 'گروه‌ها' },
  { id: 'channels', label: 'کانال‌ها' },
  { id: 'bots', label: 'ربات‌ها' },
];
function folderLSKey() { return 'vxFolders:' + ((state.me && state.me.username) || 'anon'); }
function userFolders() {
  if (!state.userFolders) {
    let v = [];
    try { const raw = localStorage.getItem(folderLSKey()); v = raw ? JSON.parse(raw) : []; } catch (e) { v = []; }
    state.userFolders = Array.isArray(v) ? v.filter((f) => f && f.id && f.name) : [];
  }
  return state.userFolders;
}
function saveUserFolders(list) {
  state.userFolders = list;
  try { localStorage.setItem(folderLSKey(), JSON.stringify(list)); } catch (e) {}
}
function groupTypeOf(rid) {
  const g = state.groups.find((x) => 'group:' + x.id === rid);
  return g ? (g.type || 'group') : 'group';
}
function roomDisplayTitle(rid) {
  if (rid.startsWith('group:')) {
    const g = state.groups.find((x) => 'group:' + x.id === rid);
    return g ? g.name : rid;
  }
  const other = rid.slice(3).split('|').find((p) => p !== (state.me && state.me.username));
  if (!other) return rid;
  if (other === BOT_USERNAME) return BOT_NAME;
  const u = (state.users || []).find((x) => x.username === other);
  if (u && u.displayName) return u.displayName;
  const c = getContacts();
  if (c[other]) return c[other];
  if (state.me && state.me.username === other) return state.me.displayName || other;
  return other;
}
/** Does this room belong to the given folder? Shared by the list and the counters. */
function roomMatchesFolder(rid, r, fid) {
  if (!fid || fid === 'all') return true;
  if (fid === 'unread') return computeUnread(rid, r) > 0;
  const isGroup = rid.startsWith('group:');
  let other = null, isBot = false;
  if (!isGroup) {
    other = rid.slice(3).split('|').find((p) => p !== (state.me && state.me.username));
    isBot = other === BOT_USERNAME;
  }
  if (fid === 'private') return !isGroup && !isBot;
  if (fid === 'groups') return isGroup && groupTypeOf(rid) !== 'channel';
  if (fid === 'channels') return isGroup && groupTypeOf(rid) === 'channel';
  if (fid === 'bots') return isBot;
  if (fid.indexOf('f:') === 0) {
    const f = userFolders().find((x) => 'f:' + x.id === fid);
    return !!(f && Array.isArray(f.chats) && f.chats.indexOf(rid) >= 0);
  }
  return true;
}
function folderUnread(fid) {
  let n = 0;
  try {
    for (const rid in state.rooms) {
      const r = state.rooms[rid];
      if (!r || r.archived) continue;
      if (!roomMatchesFolder(rid, r, fid)) continue;
      n += (fid === 'unread' ? (computeUnread(rid, r) > 0 ? 1 : 0) : (computeUnread(rid, r) || 0));
    }
  } catch (e) { return 0; }
  return n;
}
function selectFolder(fid) {
  state.chatFilter = fid;
  renderFolderBar();
  buildChatList();
}
/** Refresh only the unread counts — avoids re-rendering (and stealing focus). */
function updateFolderCounts() {
  const bar = $('cl-tabs');
  if (!bar) return;
  bar.querySelectorAll('.vx-folder').forEach((b) => {
    const n = folderUnread(b.dataset.folder);
    const cnt = b.querySelector('.cnt');
    if (!cnt) return;
    cnt.hidden = !n;
    cnt.textContent = n > 99 ? '۹۹+' : String(n || '');
    const label = b.firstChild ? (b.firstChild.textContent || '').trim() : '';
    b.setAttribute('aria-label', label + (n ? '، ' + n + ' خوانده‌نشده' : ''));
  });
}
function renderFolderBar() {
  const bar = $('cl-tabs');
  if (!bar) return;
  // selection rebuilds every node — remember which folder had focus so keyboard
  // navigation doesn't drop the user back onto <body> after each arrow press
  const prev = document.activeElement;
  const keepFocus = (prev && prev.classList && prev.classList.contains('vx-folder') && prev.dataset)
    ? prev.dataset.folder : null;
  const cur = state.chatFilter || 'all';
  const all = SMART_FOLDERS.concat(userFolders().map((f) => ({ id: 'f:' + f.id, label: f.name, custom: true })));
  bar.innerHTML = '';
  for (const f of all) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vx-folder' + (f.custom ? ' custom' : '');
    b.dataset.folder = f.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', cur === f.id ? 'true' : 'false');
    b.tabIndex = cur === f.id ? 0 : -1;
    const n = folderUnread(f.id);
    b.innerHTML = esc(f.label) + '<span class="cnt"' + (n ? '' : ' hidden') + '>' + (n > 99 ? '۹۹+' : (n || '')) + '</span>';
    b.setAttribute('aria-label', f.label + (n ? '، ' + n + ' خوانده‌نشده' : ''));
    let suppressClick = false;
    if (f.custom) {
      b.oncontextmenu = (e) => { e.preventDefault(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 400); openFolderManager(f.id); };
      let lp = null;
      b.addEventListener('pointerdown', () => {
        lp = setTimeout(() => { lp = null; suppressClick = true; openFolderManager(f.id); }, 550);
      });
      const cancelLp = () => { if (lp) { clearTimeout(lp); lp = null; } };
      b.addEventListener('pointerup', cancelLp);
      b.addEventListener('pointerleave', cancelLp);
      b.addEventListener('pointercancel', cancelLp);
    }
    b.onclick = () => { if (suppressClick) return; selectFolder(f.id); };
    b.onkeydown = (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (keys.indexOf(e.key) < 0) return;
      e.preventDefault();
      const list = Array.prototype.slice.call(bar.querySelectorAll('.vx-folder'));
      const i = list.indexOf(b);
      const rtl = getComputedStyle(bar).direction === 'rtl';
      const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      let n2 = i;
      if (e.key === 'Home') n2 = 0;
      else if (e.key === 'End') n2 = list.length - 1;
      else n2 = (i + (e.key === nextKey ? 1 : -1) + list.length) % list.length;
      const t = list[n2];
      if (t) { t.focus(); t.click(); }
    };
    bar.appendChild(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'vx-folder-add';
  add.setAttribute('aria-label', 'ساخت پوشه تازه');
  add.setAttribute('title', 'پوشه تازه');
  add.innerHTML = ic('plus');
  add.onclick = () => openFolderManager(null);
  bar.appendChild(add);
  applyIcons(bar);
  if (keepFocus) {
    const again = bar.querySelector('.vx-folder[data-folder="' + keepFocus + '"]');
    if (again) { try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); } }
  }
}

/** Create or edit a user folder: name + the chats it contains. */
function openFolderManager(folderId) {
  closeChatSwipe();
  const existing = folderId ? userFolders().find((f) => 'f:' + f.id === folderId) : null;
  const rooms = allRoomIds().slice().sort((a, b) => (roomDisplayTitle(a) || '').localeCompare(roomDisplayTitle(b) || ''));
  const chosen = new Set(existing && Array.isArray(existing.chats) ? existing.chats : []);
  const rows = rooms.map((rid) => {
    const checked = chosen.has(rid) ? ' checked' : '';
    return '<label class="u-pop-check"><input type="checkbox" data-rid="' + escAttr(rid) + '"' + checked + '><span>' + esc(roomDisplayTitle(rid)) + '</span></label>';
  }).join('');
  const others = userFolders().filter((f) => f.id !== (existing && existing.id));
  const pop = document.createElement('div');
  pop.className = 'u-pop';
  pop.innerHTML = '<div class="u-pop-box vx-folder-box">'
    + '<div class="u-pop-title">' + (existing ? 'ویرایش پوشه' : 'پوشه تازه') + '</div>'
    + (others.length ? '<div class="vx-folder-strip">' + others.map((f) => '<button type="button" class="chip" data-edit="' + escAttr(f.id) + '">' + esc(f.name) + '</button>').join('') + '</div>' : '')
    + '<input class="inp" data-k="name" placeholder="نام پوشه" value="' + escAttr(existing ? existing.name : '') + '" maxlength="24">'
    + '<div class="u-pop-checks" data-k="chats" tabindex="-1">' + rows + '</div>'
    + '<div class="u-pop-actions">'
    + (existing ? '<button class="btn sm danger" data-k="del">حذف</button>' : '')
    + '<button class="btn sm ghost" data-k="0">انصراف</button>'
    + '<button class="btn sm" data-k="1">ذخیره</button>'
    + '</div></div>';
  const close = () => pop.remove();
  pop.addEventListener('click', (e) => { if (e.target === pop) close(); });
  pop.querySelector('[data-k="0"]').onclick = close;
  const del = pop.querySelector('[data-k="del"]');
  if (del) del.onclick = () => {
    saveUserFolders(userFolders().filter((f) => f.id !== existing.id));
    if (state.chatFilter === 'f:' + existing.id) state.chatFilter = 'all';
    close(); renderFolderBar(); buildChatList(); toast('پوشه حذف شد');
  };
  pop.querySelectorAll('[data-edit]').forEach((btn) => btn.onclick = () => { close(); openFolderManager('f:' + btn.dataset.edit); });
  const inp = pop.querySelector('[data-k="name"]');
  const save = () => {
    const name = (inp.value || '').trim();
    if (!name) { toast('نام پوشه را بنویس'); inp.focus(); return; }
    const picked = Array.prototype.slice.call(pop.querySelectorAll('[data-k="chats"] input:checked')).map((c) => c.dataset.rid);
    const list = userFolders().slice();
    if (existing) {
      const i = list.findIndex((f) => f.id === existing.id);
      if (i >= 0) list[i] = { id: existing.id, name: name, chats: picked };
      else list.push({ id: existing.id, name: name, chats: picked });
    } else {
      list.push({ id: 'u' + Date.now().toString(36), name: name, chats: picked });
    }
    saveUserFolders(list);
    close(); renderFolderBar(); buildChatList(); toast('پوشه ذخیره شد');
  };
  pop.querySelector('[data-k="1"]').onclick = save;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.appendChild(pop);
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
}
$('cl-search-input').addEventListener('input', (e) => { state.search = e.target.value; syncSearchClear(); scheduleGroupSearch(state.search); buildChatList(); });
function syncSearchClear() {
  const x = $('cl-search-x'); if (x) x.hidden = !$('cl-search-input').value;
}
function clearChatSearch() {
  const i = $('cl-search-input'); i.value = ''; state.search = ''; state.groupSearch = []; state.userSearch = [];
  syncSearchClear(); scheduleGroupSearch(''); buildChatList(); i.focus();
}
if ($('cl-search-x')) $('cl-search-x').onclick = clearChatSearch;
let _gsTimer = null;
function scheduleGroupSearch(q) {
  clearTimeout(_gsTimer);
  const s = String(q || '').trim();
  if (s.length < 1) { state.groupSearch = []; state.userSearch = []; return; }
  _gsTimer = setTimeout(() => {
    api('/api/groups/search?q=' + encodeURIComponent(s)).then((r) => r.json()).then((d) => { if ((d || {}).groups) { state.groupSearch = d.groups; buildChatList(); } }).catch(() => { if (state.groupSearch.length) { state.groupSearch = []; buildChatList(); } });
    /* people too: the chat-list search should find contacts, not only chats */
    api('/api/users/search?q=' + encodeURIComponent(s)).then((r) => r.json()).then((d) => {
      const list = ((d || {}).users || []).filter((u) => u && u.username && u.username !== (state.me && state.me.username));
      state.userSearch = list;
      buildChatList();
    }).catch(() => {});
  }, 280);
}
$('cl-new').onclick = (e) => { e.stopPropagation(); openNewMenu(e.currentTarget); };
$('cl-menu').onclick = () => { const open = !$('nav-sidebar').classList.contains('m-open'); $('nav-sidebar').classList.toggle('m-open', open); showScrim(open); };
/* PART 2 — conversation, messages, composer, details */
function openRoom(rid, opts) {
  closeMsgCtx();
  exitSelectMode();
  closeEmojiPop();
  closeAttachPop();
  attachSelection = [];
  /* تب پنل ایموجی عمداً ریست نمی‌شود؛ آخرین تب انتخابی کاربر حفظ می‌شود. */
  state.room = rid; state.replyTo = null;
  setReply(null);
  document.querySelectorAll('.chat-item').forEach((e) => e.classList.toggle('active', e.dataset.roomId === rid));
  renderRoomHeader();
  setMode('chats');
  /* نشانی صفحه = چت باز + شناسهٔ عددی طرف مقابل (در نوار آدرس مرورگر دیده می‌شود) */
  syncUrl(rid, { replace: !!(opts && opts.fromHistory) });
  if (isMobile()) { $('conversation').classList.add('chat-open'); showScrim(false); if (!(opts && opts.fromHistory) && isCapacitor) _vxStack.push({ vx: 1, nav: 'chats', room: rid, view: null }); }
  /* «سین» بعد از باز شدن واقعی پنل گفت‌وگو ثبت می‌شود (نه قبل از آن) */
  markRead(rid);
  const roomCache = state.rooms[rid] || {};
  const cachedMsgs = roomCache.messages || [];
  const canRenderCache = cachedMsgs.length && !roomCache.previewOnly;
  const cacheFresh = canRenderCache && (Date.now() - (roomCache.lastSync || 0)) < 45000;
  const hasPreview = roomCache.previewOnly && cachedMsgs.length;
  if (state.ws && state.ws.readyState === 1) {
    if (canRenderCache) {
      $('messages').innerHTML = ''; state.lastDay = null; renderMessagesBatch(cachedMsgs.slice(-MSG_RENDER_LIMIT)); state.renderedRooms.add(rid);
    } else if (hasPreview) {
      $('messages').innerHTML = ''; state.lastDay = null; renderMessagesBatch(cachedMsgs.slice(-MSG_RENDER_LIMIT));
      // رومِ only-preview را «رندرنشده» نگه می‌داریم تا وقتی پاسخ history می‌رسد
      // لیست کامل پیام‌ها جایگزین پیش‌نمایش شود (نه فقط یک پیام).
    }
    if (!cacheFresh) {
      const lastT = canRenderCache ? (cachedMsgs[cachedMsgs.length - 1] && cachedMsgs[cachedMsgs.length - 1].time) : 0;
      state.ws.send(JSON.stringify(lastT ? { type: 'history', roomId: rid, after: lastT } : { type: 'history', roomId: rid }));
    }
  } else {
    $('messages').innerHTML = ''; state.lastDay = null; renderMessagesBatch(cachedMsgs.slice(-MSG_RENDER_LIMIT)); state.renderedRooms.add(rid);
  }
}
function roomTitle(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.name : rid; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return BOT_NAME; const u = state.users.find((x) => x.username === other); return u ? (u.displayName || other) : (getContacts()[other] || other); }
function roomOnline(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members.length + ' عضو' : ''; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return 'آنلاین'; const u = state.users.find((x) => x.username === other); if (state.me.isAdmin) return u ? (u.online && !u.banned ? 'آنلاین' : 'آفلاین') : ''; return ''; }
/* ---------- UID طرف مقابل ----------
   ربات UID رزروشده دارد و هرگز fetch نمی‌شود.
   لیست کاربران فقط برای ادمین پر می‌شود، پس برای بقیهٔ کاربران UID را
   یک‌بار از /api/user می‌گیریم و کش می‌کنیم تا در هدر چت نمایش داده شود. */
function knownUid(username) {
  const u = (state.users || []).find((x) => x.username === username);
  if (u && typeof u.uid === 'number') return u.uid;
  if (state.me && state.me.username === username && typeof state.me.uid === 'number') return state.me.uid;
  return state.uidCache[username] || null;
}
function fetchUid(username) {
  if (!username || username === BOT_USERNAME || knownUid(username)) return;
  if (state.uidCache[username] === 0) return;
  api('/api/user/' + encodeURIComponent(username)).then((r) => r.json()).then((d) => {
    if (!d || !d.u) return;
    state.uidCache[username] = d.u.uid;
    const i = (state.users || []).findIndex((x) => x.username === username);
    if (i !== -1) state.users[i] = { ...state.users[i], uid: d.u.uid };
    if (state.room && state.room.startsWith('dm:') && state.room.slice(3).split('|').indexOf(username) !== -1) {
      renderRoomHeader();
      /* UID تازه باید در نشانی صفحه بنشیند. چون room از قبل در URL هست،
         شرط urlRoom مانع کار می‌شد؛ باید فقط حین بازگردانی از history ساکت بمانیم. */
      syncUrl(state.room, { replace: true });
    }
  }).catch(() => {});
}
function roomUid(rid) {
  if (!rid || !rid.startsWith('dm:')) return null;
  const other = rid.slice(3).split('|').find((p) => p !== state.me.username);
  if (!other) return null;
  if (other === BOT_USERNAME) return BOT_UID;
  const uid = knownUid(other);
  if (!uid) fetchUid(other);
  return uid;
}
function renderRoomHeader() {
  roomUid(state.room); /* فقط برای کامل شدن نشانی صفحه (uid در URL می‌ماند) */
  const on = roomOnline(state.room);
  $('conv-name').textContent = roomTitle(state.room);
  /* شناسهٔ عددی عمداً روی صفحه نمایش داده نمی‌شود؛ فقط در نشانی مرورگر است */
  $('conv-sub').textContent = on || '';
  let avSrc = null;
  if (state.room && state.room.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === state.room); if (g && g.avatar) avSrc = g.avatar; }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: roomTitle(state.room) } : { displayName: roomTitle(state.room) }, 'sm');
  av.id = 'conv-av'; const old = $('conv-av'); if (old) old.replaceWith(av);
  $('conv-name').onclick = $('conv-av').onclick = () => { if (!state.room) return; openRoomInfo(state.room); };
  $('conv-name').style.cursor = 'pointer';
}
$('conv-info').onclick = () => { if (!state.room) return; openRoomInfo(state.room); };
/* فاز ۳: خلاصهٔ امروز — اگر ارائه‌دهنده‌ای نباشد، دکمه غیرفعال می‌ماند. */
if ($('conv-ai')) $('conv-ai').onclick = () => {
  if (!AI_CAP.enabled) { toast('هوش مصنوعی تنظیم نشده است.'); return; }
  if (!state.room) { toast('اول یک گفتگو را باز کنید'); return; }
  aiDigestSheet();
};
/* دکمهٔ برگشت داخل چت (گوشهٔ بالای صفحهٔ چت): همیشه برمی‌گردد به صفحهٔ اصلی
   لیست چت‌ها (/app) — نه به چت قبلی در history مرورگر. */
$('conv-back').onclick = () => {
  state._restoringNav = true;
  try {
    const vw = (viewHost && !viewHost.classList.contains('hidden')) ? viewHost.dataset.view : null;
    state.room = null;
    state.nav = 'chats';
    if (viewHost && !viewHost.classList.contains('hidden')) { viewHost.innerHTML = ''; viewHost.dataset.view = ''; }
    setMode('chats');
    $('conversation').classList.remove('chat-open');
    $('chat-list-column').classList.add('m-open');
    showScrim(false); closeDrawers();
    buildChatList();
    document.querySelectorAll('.nav-item').forEach((e) => e.classList.toggle('active', e.dataset.nav === 'chats'));
    /* نشانی صفحه هم به /app برگردد تا رفرش، همان لیست چت را باز کند */
    try { history.replaceState({ vx: 1, nav: 'chats', room: null, view: vw || null }, '', location.pathname); } catch (e) {}
  } finally { state._restoringNav = false; }
};
$('scrim').onclick = () => closeDrawers();
$('conv-search').onclick = () => { const sb = $('conv-searchbox'); const wasHidden = sb.classList.contains('hidden'); sb.classList.toggle('hidden'); if (wasHidden) { $('conv-search-input').value = ''; $('conv-search-input').focus(); searchChatMessages(''); } else { searchChatMessages(''); } };
$('conv-search-input').addEventListener('input', (e) => { searchChatMessages(e.target.value); });
$('conv-search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('conv-search-input').value = ''; searchChatMessages(''); $('conv-searchbox').classList.add('hidden'); } if (e.key === 'Enter') { e.preventDefault(); const msgs = document.querySelectorAll('#messages .msg'); let found = null; for (const w of msgs) { if (!w.classList.contains('search-hide')) { found = w; break; } } if (found) { found.scrollIntoView({ behavior: 'smooth', block: 'center' }); found.querySelector('.bubble').style.transition = 'box-shadow 0.3s'; found.querySelector('.bubble').style.boxShadow = '0 0 0 2px var(--accent)'; setTimeout(() => { const b = found.querySelector('.bubble'); if (b) b.style.boxShadow = ''; }, 1500); } } });
function searchChatMessages(q) {
  const msgs = document.querySelectorAll('#messages .msg');
  if (!q) { msgs.forEach((w) => { w.classList.remove('search-hide'); w.style.boxShadow = ''; const body = w.querySelector('.msg-body'); if (body) body.querySelectorAll('mark.search-hl').forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); }); }); return; }
  const ql = q.toLowerCase();
  msgs.forEach((w) => {
    const id = w.dataset.id;
    const r = state.rooms[state.room];
    const m = r ? r.messages.find((x) => x.id === id) : null;
    const bubble = w.querySelector('.bubble');
    const body = w.querySelector('.msg-body');
    const domText = (bubble ? bubble.textContent : (w.textContent || '')).toLowerCase();
    const fromName = (m ? (m.fromName || m.from || '') : '').toLowerCase();
    const match = domText.includes(ql) || fromName.includes(ql);
    w.classList.toggle('search-hide', !match);
    if (match && body && (!m || (m.kind !== 'image' && m.kind !== 'video' && m.kind !== 'voice' && m.kind !== 'file' && m.kind !== 'audio' && m.kind !== 'sticker' && m.kind !== 'poll' && m.kind !== 'checklist'))) {
      const orig = body.textContent || '';
      const idx = orig.toLowerCase().indexOf(ql);
      if (idx >= 0) {
        body.textContent = '';
        body.appendChild(document.createTextNode(orig.slice(0, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hl';
        mark.textContent = orig.slice(idx, idx + q.length);
        body.appendChild(mark);
        body.appendChild(document.createTextNode(orig.slice(idx + q.length)));
      }
    }
  });
}

function onNewMessage(m) {
  const rid = m.roomId; const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.previewOnly = false; r.messages.push(m); if (r.messages.length > HISTORY_CAP) r.messages = r.messages.slice(-HISTORY_CAP); r.last = m; r.lastSync = Date.now();
  if (rid.startsWith('dm:') && m.from !== state.me.username && !getContacts()[m.from] && m.from !== BOT_USERNAME) { const c = getContacts(); const u = state.users.find((x) => x.username === m.from); c[m.from] = u ? (u.displayName || m.from) : m.from; saveContacts(c); }
  if (rid === state.room) { addMessage(m); if (m.from === state.me.username || isNearBottom()) scrollBottom(); markRead(rid); renderReplyCounts(state.room); }
  else { r.unread = computeUnread(rid, r); beep(); pushNotification(m); }
  scheduleChatListRefresh(rid === state.room ? 120 : 250);
}
function pushNotification(m) {
  if (m.from === state.me.username || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(roomTitle(m.roomId), { body: previewText(m) }); } catch (e) {}
}
function scrollBottom() { const c = $('messages'); c.scrollTop = c.scrollHeight; }
function jumpToMsg(id) { const el = document.querySelector('#messages .msg[data-id="' + id + '"]'); if (!el) { toast('پیام هدف در این گفتگو بارگذاری نشده'); return; } el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const b = el.querySelector('.bubble'); if (b) { b.style.transition = 'box-shadow 0.3s'; b.style.boxShadow = '0 0 0 2.5px var(--accent)'; setTimeout(() => { b.style.boxShadow = ''; }, 1800); } }
function isNearBottom() { const c = $('messages'); return !!c && (c.scrollHeight - c.scrollTop - c.clientHeight) < 90; }
$('scroll-fab').onclick = () => { scrollBottom(); };
$('messages').addEventListener('scroll', () => { const fab = $('scroll-fab'); if (!fab) return; fab.classList.toggle('hidden', isNearBottom()); });
function daySep(t) { const d = new Date(t); const s = d.toLocaleDateString('fa-IR'); return s; }
// یافتن همهٔ ایموجی‌های متن به صورت خوشه‌های تک‌دیداری (grapheme cluster)
function emojiRuns(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const hasSeg = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
  if (hasSeg) {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const s of seg.segment(text)) {
      const g = s.segment;
      if (/^[\p{Extended_Pictographic}\p{Emoji_Presentation}][\uFE0F\u200D\p{Extended_Pictographic}\p{Emoji_Presentation}]*$/u.test(g)) out.push(g);
    }
    return out;
  }
  const re = /[\p{Extended_Pictographic}]/gu;
  return (text.match(re) || []);
}
function emojiOnly(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  const tokens = t.split(/\s+/);
  if (tokens.some((s) => !s)) return false;
  return tokens.every((s) => /^[\p{Extended_Pictographic}\p{Emoji_Presentation}][\uFE0F\u200D\p{Extended_Pictographic}\p{Emoji_Presentation}]*$/u.test(s));
}
function emojiCount(text) {
  return emojiRuns(text).length;
}
// آیا کنار پیام آواتار نمایش داده شود؟ فقط در گروه‌ها (نه چت خصوصی، نه کانال)
function showMsgAvatar() {
  if (!state.room || !state.room.startsWith('group:')) return false;
  const g = state.groups.find((x) => 'group:' + x.id === state.room);
  return !g || (g.type || 'group') !== 'channel';
}
/* نوار اعتبار پست: برچسب «ربات»، برچسب «تولید شده با هوش مصنوعی» و لینک منبع.
   داده‌ها ساختاریافته‌اند (m.ai / m.source) و هرگز داخل متن پیام نیستند، پس
   اینجا جداگانه و با escaping کامل رندر می‌شوند. */
function provenanceEl(m) {
  const isBot = !!(m.fromBot || (m.ai && m.ai.generated) ||
    ((state.users.find((u) => u.username === m.from) || {}).isBot) ||
    m.from === BOT_USERNAME);
  const ai = (m.ai && m.ai.generated) ? (m.ai.label || 'تولید شده با هوش مصنوعی') : '';
  const src = (m.source && typeof m.source === 'object') ? m.source : null;
  if (!isBot && !ai && !src) return null;

  const row = document.createElement('div'); row.className = 'msg-prov';
  let html = '';
  if (isBot) html += '<span class="prov-bot" title="این پیام را یک ربات فرستاده">' + ic('robot') + 'ربات</span>';
  if (ai) html += '<span class="prov-ai">' + ic('sparkles') + esc(ai) + '</span>';
  if (src && src.url) {
    // sanitizeLinkHref فقط http/https را قبول می‌کند و
    // نام کاربری/رمز و کاراکترهای کنترلی را رد می‌کند.
    const href = VXSanitize.sanitizeLinkHref(src.url);
    if (href) {
      const site = src.site || (() => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
      html += '<a class="prov-src" href="' + escAttr(href) + '" target="_blank" rel="noopener noreferrer" rel="noopener noreferrer nofollow ugc">'
        + ic('link') + '<span>' + esc(src.title ? src.title + ' — ' + site : ('منبع: ' + site)) + '</span></a>';
    }
  }
  row.innerHTML = html;
  return row.childNodes.length ? row : null;
}
function renderMessagesBatch(messages) {
  if (!messages.length) return;
  const msgs = $('messages');
  const frag = document.createDocumentFragment();
  const rmap = replyCountMap(messages);
  
  for (const m of messages) {
    try {
    const d = new Date(m.time); const ds = d.toLocaleDateString('fa-IR');
    if (ds !== state.lastDay) {
      state.lastDay = ds;
      const sep = document.createElement('div'); sep.className = 'day-sep';
      sep.innerHTML = '<span>' + ds + '</span>';
      frag.appendChild(sep);
    }
    const mine = m.from === state.me.username;
    const wrap = document.createElement('div'); wrap.className = 'msg ' + (mine ? 'mine' : ''); wrap.dataset.id = m.id;
    if (showMsgAvatar()) {
      const av = mine ? avatarEl(state.me, 'xs') : avatarEl(state.users.find((u) => u.username === m.from) || { displayName: m.from }, 'xs');
      wrap.innerHTML = '<div class="msg-av">' + av.outerHTML + '</div>';
    } else {
      wrap.classList.add('no-av');
    }
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dataset.id = m.id; bubble.dataset.from = m.from || '';
    // پست‌های رباتی: برچسب «ربات»، برچسب هوش مصنوعی، لینک منبع و شمار بازدید
    const prov = provenanceEl(m);
    if (prov) bubble.appendChild(prov);
    // inline reply quote (quoted message preview)
    if (m.replyTo && m.replyTo.id) {
      bubble.appendChild(replyRef(m.replyTo));
    } else if (m.replyToId) {
      const orig = (state.rooms[state.room] || {}).messages.find((x) => x.id === m.replyToId);
      if (orig) bubble.appendChild(replyRef(orig));
    }
    bubble.appendChild(bodyEl(m));
    // ── فاز ۳: ترجمه/رونویسی همیشه «زیر» پیام اصلی می‌نشیند ──
    if (state.transcripts && state.transcripts[m.id]) bubble.appendChild(aiTranscriptEl(m.id));
    if (state.translations && state.translations[m.id]) bubble.appendChild(aiTranslationEl(m.id));
    if (BOOKMARK_IDLE.has((m.roomId || state.room) + '|' + m.id)) {
      const savedBadge = document.createElement('span');
      savedBadge.className = 'msg-saved';
      savedBadge.title = 'در پیام‌های ذخیره‌شده';
      savedBadge.innerHTML = ic('bookmark');
      bubble.appendChild(savedBadge);
      applyIcons(savedBadge);
    }
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    const timeHtml = '<span class="msg-time">' + (mine ? (isReadByOther(state.room, m) ? ic('check-check') : ic('check')) : '') + fmt(m.time) + '</span>';
    let extraMeta = '';
    // شمار بازدید یکتا — فقط عدد، نه هویت بیننده
    if (typeof m.views === 'number' && m.views > 0) extraMeta += '<span class="msg-views" title="تعداد بازدیدکننده">' + ic('gauge') + ' ' + m.views.toLocaleString('fa-IR') + '</span>';
    meta.innerHTML = extraMeta + ((m.edited || m.editedAt) ? '<span class="msg-ed">ویرایش‌شده</span>' + timeHtml : timeHtml);
    bubble.appendChild(meta);
    applyReplyBadge(wrap, m, rmap);
    wrap.appendChild(bubble);
    const hasReactions = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions) && Object.keys(m.reactions).some((k) => (Array.isArray(m.reactions[k]) ? m.reactions[k].length > 0 : !!m.reactions[k])));
    if (hasReactions) wrap.appendChild(reactionsEl(m));
    const actions = document.createElement('div'); actions.className = 'msg-actions';
    let actionsHTML = '<button class="icon-btn" data-a="smile" aria-label="واکنش">' + ic('smile') + '</button><button class="icon-btn" data-a="reply" aria-label="پاسخ">' + ic('reply') + '</button><button class="icon-btn" data-a="forward" aria-label="فوروارد">' + ic('forward') + '</button>';
    if (m.from === state.me.username) actionsHTML += '<button class="icon-btn danger" data-a="delete" aria-label="حذف پیام">' + ic('trash-2') + '</button>';
    actionsHTML += '<button class="icon-btn" data-a="more" aria-label="گزینه‌های بیشتر">' + ic('more-vertical') + '</button>';
    actions.innerHTML = actionsHTML;
    actions.querySelector('[data-a="smile"]').onclick = (e) => { e.stopPropagation(); openReactionPicker(m, bubble); };
    actions.querySelector('[data-a="reply"]').onclick = (e) => { e.stopPropagation(); setReply(m); };
    actions.querySelector('[data-a="forward"]').onclick = (e) => { e.stopPropagation(); openForward(m.id); };
    if (m.from === state.me.username) actions.querySelector('[data-a="delete"]').onclick = async (e) => { e.stopPropagation(); const d = await askDeleteScope(); if (d) sendDeleteMsg(m.id, d.forEveryone); };
    actions.querySelector('[data-a="more"]').onclick = (e) => { e.stopPropagation(); const w = e.target.closest('.msg'); const anchor = w ? (w.querySelector('.bubble') || w) : null; openMsgCtx(m, anchor, { x: e.clientX, y: e.clientY }); };
    wrap.appendChild(actions);
    // new mini reply + reaction rail (desktop)
    const miniReply=document.createElement('button'); miniReply.className='msg-mini-reply'; miniReply.innerHTML=ic('reply'); miniReply.title='پاسخ'; miniReply.setAttribute('aria-label','پاسخ به پیام'); miniReply.onclick=(e)=>{ e.stopPropagation(); setReply(m); }; wrap.appendChild(miniReply);
    const rail=document.createElement('div'); rail.className='msg-react-rail';
    const mainEm=document.createElement('button'); mainEm.className='rr-main'; mainEm.textContent='😊'; mainEm.title='واکنش'; mainEm.setAttribute('aria-label','واکنش سریع'); rail.appendChild(mainEm);
    const pop=document.createElement('div'); pop.className='rr-pop';
    const more=document.createElement('button'); more.className='rr-more'; more.innerHTML=ic('more-horizontal'); more.title='همه ایموجی‌ها'; more.onclick=(e)=>{ e.stopPropagation(); openReactionPicker(m,bubble); }; pop.appendChild(more);
    REACTIONS.forEach(em=>{ const b=document.createElement('button'); b.className='rr-emoji'; b.textContent=em; b.onclick=(e)=>{ e.stopPropagation(); toggleReaction(m.id,em,m.roomId||state.room,m); }; pop.appendChild(b); });
    rail.appendChild(pop); wrap.appendChild(rail);
    if (m.kind === 'sticker') {
      wrap.classList.add('msg-sticker', 'emoji-enter');
      setTimeout(() => wrap.classList.remove('emoji-enter'), 500);
    } else if ((!m.kind || m.kind === 'text') && emojiOnly(m.content) && emojiCount(m.content) < 5) {
      const cnt = emojiCount(m.content);
      wrap.classList.add('msg-emoji-only', 'emoji-enter');
      const fs = cnt <= 1 ? 64 : cnt === 2 ? 46 : cnt === 3 ? 38 : 32;
      bubble.style.fontSize = fs + 'px';
      setTimeout(() => wrap.classList.remove('emoji-enter'), 500);
    }
    frag.appendChild(wrap);
    } catch (err) {
      try { console.error('msg render fail', m && m.id, err); } catch (e) {}
      const fb = document.createElement('div');
      fb.className = 'msg ' + ((m && m.from === state.me.username) ? 'mine' : '') + ' no-av';
      if (m && m.id) fb.dataset.id = m.id;
      const fbub = document.createElement('div'); fbub.className = 'bubble'; fbub.dataset.id = m && m.id; fbub.dataset.from = m && m.from;
      fbub.textContent = (m && (m.content || m.name)) || '⚠️';
      fb.appendChild(fbub);
      frag.appendChild(fb);
    }
  }
  
  msgs.appendChild(frag);
  applyIcons(msgs);
  scrollBottom();
}
function addMessage(m) {
  if (!m) return;
  renderMessagesBatch([m]);
}
function replyCountMap(arr) {
  const map = {};
  for (const x of arr) {
    const t = (x && x.replyTo && x.replyTo.id) || (x && x.replyToId);
    if (t) map[t] = (map[t] || 0) + 1;
  }
  return map;
}
function applyReplyBadge(wrap, m, map) {
  const id = m ? m.id : (wrap && wrap.dataset.id);
  if (!id || !wrap) return;
  const meta = wrap.querySelector('.msg-meta');
  if (!meta) return;
  const arr = (state.rooms[state.room] || {}).messages || [];
  const n = (map || replyCountMap(arr))[id] || 0;
  let rc = meta.querySelector('.msg-rc');
  if (!n) { if (rc) rc.remove(); return; }
  if (!rc) { rc = document.createElement('span'); rc.className = 'msg-rc'; rc.title = 'پاسخ‌ها'; rc.setAttribute('role', 'button'); meta.appendChild(rc); }
  rc.innerHTML = ic('corner-up-right') + '<b>' + n.toLocaleString('fa-IR') + '</b>';
  rc.onclick = (ev) => { ev.stopPropagation();
    const first = arr.find((x) => ((x.replyTo && x.replyTo.id) || x.replyToId) === id);
    if (first) jumpToMsg(first.id);
  };
  applyIcons(rc);
}
function renderReplyCounts(rid) {
  if (rid !== state.room) return;
  const map = replyCountMap((state.rooms[rid] || {}).messages || []);
  document.querySelectorAll('#messages .msg[data-id]').forEach((el) => {
    applyReplyBadge(el, null, map);
  });
}
function refreshDeletedRefs(id) {
  document.querySelectorAll('.reply-ref[data-target="' + id + '"]').forEach((r) => {
    r.classList.add('deleted');
    const tx = r.querySelector('.rr-text'); if (tx) tx.textContent = 'پیام حذف شده';
    const ic = r.querySelector('.rr-ico'); if (ic) ic.replaceWith(Object.assign(document.createElement('i'), { className: 'rr-ico' }));
    r.onclick = null; r.setAttribute('aria-label', 'پیام حذف شده');
  });
  if (state.replyTo && state.replyTo.id === id) {
    const bar = $('reply-bar');
    if (bar && !bar.classList.contains('hidden')) {
      const tx = bar.querySelector('.rp-txt'); if (tx) tx.textContent = 'پیام حذف شده';
    }
  }
}
function replyRef(rt) {
  const r = document.createElement('div'); r.className = 'reply-ref';
  let from = '', txt = '', targetId = '';
  if (rt && typeof rt.snippet === 'string') {
    from = rt.name === state.me.username ? 'شما' : ((state.users.find((u) => u.username === rt.name) || {}).displayName || rt.name || '');
    txt = rt.snippet; targetId = rt.id || '';
  } else if (rt) {
    from = rt.from === state.me.username ? 'شما' : (rt.fromName || roomTitle(rt.roomId || state.room));
    txt = previewText(rt); targetId = rt.id || '';
  }
  if (!txt) txt = 'پیام';
  const deleted = !!targetId && state.deletedIds && state.deletedIds.has(targetId);
  if (deleted) { from = ''; txt = 'پیام حذف شده'; }
  if (targetId) r.setAttribute('data-target', targetId);
  r.innerHTML = (deleted ? '<span class="rr-from rr-del"><i data-lucide="trash-2" class="rr-ico"></i>پیام حذف شده</span>' : '<span class="rr-from"><i data-lucide="corner-up-right" class="rr-ico"></i>' + esc(from) + '</span><span class="rr-text">' + esc(txt) + '</span>');
  if (!deleted && targetId) {
    r.setAttribute('role', 'button'); r.title = 'پرش به پیام'; r.setAttribute('aria-label', 'پرش به پیام');
    r.onclick = (ev) => { ev.stopPropagation(); if (targetId) jumpToMsg(targetId); };
  }
  if (deleted) r.classList.add('deleted');
  applyIcons(r);
  return r;
}
function bodyEl(m) {
  const b = document.createElement('div'); b.className = 'msg-body';
  if (m.kind === 'image' || m.kind === 'video' || m.kind === 'gif') { b.appendChild(mediaEl(m)); }
  else if (m.kind === 'album') { b.appendChild(albumEl(m)); }
  else if (m.kind === 'voice') { b.appendChild(voiceEl(m)); }
  else if (m.kind === 'file' || m.kind === 'audio') { b.appendChild(fileEl(m)); }
  else if (m.kind === 'sticker') { const s = document.createElement('img'); s.className = 'sticker'; s.src = m.sticker || m.content; b.appendChild(s); }
  else if (m.kind === 'poll') { b.appendChild(pollEl(m)); }
  else if (m.kind === 'checklist') { b.appendChild(checklistEl(m)); }
  else if (m.kind === 'location') { b.appendChild(window.VXMapLocationCard ? window.VXMapLocationCard(m) : document.createTextNode(m.content || '📍')); }
  else { b.innerHTML = formatText(m.content || ''); }
  if (m.edited || m.editedAt) { const t = document.createElement('span'); t.className = 'msg-edited'; t.textContent = ' (ویرایش شد)'; b.appendChild(t); }
  return b;
}
/* MARKDOWN TEXT FORMATTING (inline: bold, italic, code, strikethrough, links, mentions) */
function formatText(t) {
  return VXSanitize.formatText(t);
}
function mediaEl(m) {
  const d = document.createElement('div'); d.className = 'media';
  const u = m.src || m.url;
  if (!u) {
    /* اگر URLی نرسید، هیچ درخواستی برای «undefined» زده نشود و به‌جای حباب
       خالی، پیام قابل فهم نشان داده شود. */
    d.classList.add('media-missing');
    d.textContent = m.name ? 'فایل در دسترس نیست' : 'رسانه در دسترس نیست';
    if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); }
    return d;
  }
  if (m.kind === 'video') {
    const v = document.createElement('video');
    v.controls = true; v.preload = 'none'; v.playsInline = true;
    attachVideoTransfer(d, v, u);
    v.onclick = () => { if (v.src) openViewer(u, 'video'); };
    d.appendChild(v);
  } else if (m.kind === 'gif') {
    /* GIF باید بی‌درنگ خودش را نشان بدهد؛ attachImageTransfer دانلودِ دستی
       می‌خواهد و تا وقتی کاربر روی دکمه نزند src اصلاً ست نمی‌شود، یعنی پیامِ
       ارسال‌شده مثل خالی به نظر می‌رسید. اینجا دانلود خودکار است، ولی مثل بقیه
       با هدر احراز هویده انجام می‌شود و اگر شکست خورد مستقیم از سرور می‌خواند. */
    const im = document.createElement('img');
    im.loading = 'lazy'; im.decoding = 'async'; im.alt = '';
    attachGifInline(d, im, u);
    warmMedia(u);
    d.appendChild(im);
  } else {
    const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
    attachImageTransfer(d, im, u);
    warmMedia(u);
    d.appendChild(im);
  }
  if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); }
  return d;
}
/* ---------- پخش GIF: پشت‌سرهم یا فقط یک‌بار ---------- */
/* با <img> نمی‌شود جلوی حلقه را گرفت، پس مدت کل GIF را از روی frame delayها
   می‌خوانیم و بعد از یک پخش کامل، آخرین فریم را روی canvas ثابت می‌کنیم. */
function gifLoopEnabled() { return localStorage.getItem('vx_gif_loop') !== '0'; }
/* مجموع delay فریم‌ها بر حسب میلی‌ثانیه؛ اگر GIF نبود یا خراب بود 0. */
function gifTotalDuration(ab) {
  try {
    const b = new Uint8Array(ab);
    if (b.length < 14 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
    let p = 13;
    if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1)); /* جدول رنگ سراسری */
    let total = 0, frames = 0;
    while (p < b.length) {
      const blk = b[p];
      if (blk === 0x3B) break;                              /* پایان فایل */
      if (blk === 0x21) {                                   /* extension */
        if (b[p + 1] === 0xF9 && p + 6 <= b.length) total += (b[p + 4] | (b[p + 5] << 8)) * 10;
        let q = p + 2;
        while (q < b.length && b[q]) q += b[q] + 1;
        p = q + 1;
        continue;
      }
      if (blk === 0x2C) {                                   /* image descriptor */
        frames++;
        const flags = b[p + 9];
        let q = p + 11;                                     /* LZW min code size */
        if (flags & 0x80) q += 3 * (1 << ((flags & 7) + 1));
        while (q < b.length && b[q]) q += b[q] + 1;
        p = q + 1;
        continue;
      }
      p++;
    }
    return frames ? total : 0;
  } catch (e) { return 0; }
}
/* بعد از ms، فریم فعلی (آخرین فریم) روی canvas قفل می‌شود */
function freezeGifOnce(im, ms, blobUrl, src) {
  if (!(ms > 0)) return;
  setTimeout(() => {
    if (!im.isConnected) return;
    const w = im.naturalWidth, h = im.naturalHeight;
    if (!w || !h) return;
    try {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(im, 0, 0, w, h);
      cv.className = im.className;
      cv.style.cssText = im.style.cssText;
      cv.setAttribute('role', 'img');
      cv.dataset.gifSrc = src || '';
      cv.onclick = () => openViewer(blobUrl || cv.dataset.gifSrc, 'image', src);
      im.replaceWith(cv);
    } catch (e) {}
  }, ms + 80);
}
/* اگر تنظیم «یک‌بار» است، مدت GIF را می‌خوانیم و freezes می‌کنیم.
   منبع اول: همان blob که قبلاً کش شده (بدون شبکه)، بعد: IndexedDB،
   و برای GIFهای استاتیک خودمان (/img/gifs/) یک fetch ساده. */
function applyGifPlayback(im, src, blob) {
  if (gifLoopEnabled() || !im) return;
  const run = (ab) => { if (!ab) return; const d = gifTotalDuration(ab); if (d > 0) freezeGifOnce(im, d, im.src, src); };
  if (blob) { blob.arrayBuffer().then(run).catch(() => {}); return; }
  if (!src) return;
  if (src.startsWith('/img/')) { fetch(src).then((r) => (r.ok ? r.arrayBuffer() : null)).then(run).catch(() => {}); return; }
  vxIdbGet(src).then((b) => { if (b) run(b.arrayBuffer()); }).catch(() => {});
}

/* نمایش درجای GIF: برخلاف تصویر معمولی، بدون کلیک کاربر دانلود می‌شود. */
function attachGifInline(holder, im, src) {
  const cached = __memCache.get(src);
  if (cached) { im.src = cached; applyGifPlayback(im, src, null); im.onclick = () => openViewer(cached, 'image', src); im.classList.add('loaded'); return; }
  const ov = document.createElement('div'); ov.className = 'dl-overlay';
  const ring = dlRing(holder.closest('.album-item') ? 46 : 64);
  holder.appendChild(ov);
  let done = false;
  const finish = (blobUrl, blob) => {
    done = true;
    im.src = blobUrl;
    im.onclick = () => openViewer(blobUrl, 'image', src);
    im.classList.add('loaded');
    holder.classList.remove('dl-loading');
    ov.remove();
    applyGifPlayback(im, src, blob || null);
  };
  vxIdbGet(src).then((b) => { if (b && !done) finish(URL.createObjectURL(b), b); });
  fetchMediaStream(src, (p) => dlSet(ring, p), (blb) => {
    if (done) return;
    const u = URL.createObjectURL(blb);
    memCacheSet(src, u, blb);
    finish(u, blb);
  }, () => {
    /* اگر دانلود احراز‌هویده شکست خورد، کوکی نشست را امتحان می‌کنیم */
    if (done) return;
    done = true;
    im.src = src;
    im.onclick = () => openViewer(src, 'image', src);
    im.addEventListener('load', () => { im.classList.add('loaded'); holder.classList.remove('dl-loading'); ov.remove(); });
    im.addEventListener('error', () => { ov.remove(); dlErr(ring); });
  });
}

function albumEl(m) {
  const d = document.createElement('div'); d.className = 'album-grid';
  const urls = m.album || m.urls || (m.src ? [m.src] : m.url ? [m.url] : []);
  d.dataset.n = String(Math.min(10, urls.length));
  /* یک آیتم ⇒ مثل یک رسانهٔ معمولی نمایش داده می‌شود، نه شبکهٔ ۱×۱ */
  if (urls.length === 1) return mediaEl({ kind: 'image', src: urls[0], content: m.content });
  urls.forEach((url) => {
    const item = document.createElement('div'); item.className = 'album-item';
    const isVid = /\.(mp4|webm|ogv|ogg)$/i.test(url);
    const isGif = /\.gif$/i.test(url);
    if (isVid) {
      const v = document.createElement('video'); v.loading = 'lazy'; v.playsInline = true; v.muted = true;
      attachVideoTransfer(item, v, url);
      v.onclick = () => { if (v.src) openViewer(url, 'video'); };
      item.appendChild(v);
    } else if (isGif) {
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
      attachGifInline(item, im, url);
      im.onclick = () => { if (im.src) openViewer(im.src, 'image', url); };
      item.appendChild(im);
    } else {
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
      attachImageTransfer(item, im, url);
      warmMedia(url);
      im.onclick = () => { if (im.src) openViewer(im.src, 'image', url); };
      item.appendChild(im);
    }
    d.appendChild(item);
  });
  if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); }
  return d;
}
function fileEl(m) {
  const d = document.createElement('div'); d.className = 'file-row';
  d.innerHTML = '<span class="file-ic">' + ic('file') + '</span><div class="file-info"><div class="file-name">' + esc(m.name || 'فایل') + '</div><div class="file-size">' + (m.size ? fmtBytes(m.size) : '') + '</div></div>';
  const btn = document.createElement('button'); btn.className = 'file-dl'; btn.title = 'دانلود'; btn.setAttribute('aria-label', 'دانلود فایل'); btn.innerHTML = ic('download');
  d.appendChild(btn);
  const startSize = (m.size ? fmtBytes(m.size) : '');
  const sizeEl = d.querySelector('.file-size');
  const stop = () => { btn.innerHTML = ic('download'); btn.onclick = start; };
  function start() {
    const ring = dlRing(30);
    btn.innerHTML = ''; btn.appendChild(ring);
    sizeEl.classList.remove('err-txt');
    sizeEl.textContent = startSize;
    const src = m.src || m.url || '';
    const ok = (blb) => {
      dlSet(ring, 100);
      const url = URL.createObjectURL(blb);
      const a = document.createElement('a'); a.href = url; a.download = m.name || 'file';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 2000);
      setTimeout(stop, 900);
    };
    const fail = () => {
      dlErr(ring);
      sizeEl.classList.add('err-txt'); sizeEl.textContent = 'خطا — دوباره تلاش';
      btn.innerHTML = ic('refresh-cw');
      btn.onclick = () => { sizeEl.classList.remove('err-txt'); sizeEl.textContent = startSize; start(); };
    };
    // فایلی که قبلا دانلود شده در کشِ IndexedDB نگه داشته می‌شود (مثل عکس/ویدیو)؛
    // دفعه‌ی بعد بدون دانلود مجدد از همین کش داده می‌شود. ایدرز فایل یکتاست و عوض نمی‌شود.
    vxIdbGet(src).then((blb) => {
      if (blb) return ok(blb);
      fetchMediaStream(src, (p) => dlSet(ring, p), (blb) => {
        try { const bu = URL.createObjectURL(blb); memCacheSet(src, bu, blb); } catch (e) {}
        ok(blb);
      }, fail);
    });
  }
  btn.onclick = start;
  return d;
}
function voiceEl(m) {
  const d = document.createElement('div');
  d.className = 'voice-cap voice-loading';
  const u = m.src || m.url;
  const dur = m.duration ? Math.round(m.duration) : 0;
  const n = 46;
  const waveArr = (Array.isArray(m.wave) && m.wave.length > 2) ? m.wave.slice(0, n) : null;
  const bars = [];
  for (let i = 0; i < n; i++) {
    let h;
    if (waveArr) {
      h = (typeof waveArr[i] === 'number' && isFinite(waveArr[i])) ? waveArr[i] : 0.3;
    } else {
      h = 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + String(u || m.id || i).length));
      h *= 0.55 + 0.45 * Math.sin(Math.PI * (i / (n - 1)));
    }
    bars.push(Math.max(0.1, Math.min(1, h)));
  }
  const waveHtml = bars.map((h) => '<i style="height:' + Math.round(h * 100) + '%"></i>').join('');
  d.innerHTML = '<button class="voice-play" aria-label="در حال بارگذاری" title="در حال بارگذاری">' + ic('loader') + '</button>'
    + '<div class="voice-wave">' + waveHtml + '<span class="voice-line"></span></div>'
    + '<span class="voice-time">' + (dur ? fmtDur(dur) : '0:00') + '</span>'
    + '<button class="voice-speed" title="سرعت پخش" aria-label="سرعت پخش">1x</button>'
    + '<audio preload="metadata"></audio>';

  const btn = d.querySelector('.voice-play');
  const aud = d.querySelector('audio');
  const setVoiceBtn = (icon, label) => { btn.innerHTML = ic(icon); btn.setAttribute('aria-label', label); btn.title = label; };
  const speedBtn = d.querySelector('.voice-speed');
  const timeEl = d.querySelector('.voice-time');
  const waveEl = d.querySelector('.voice-wave');
  const barEls = Array.from(d.querySelectorAll('.voice-wave > i'));
  const speeds = [1, 1.5, 2];
  let speedIdx = 0;
  const totalDur = dur || 0;
  let audioLoaded = false;

  function fmtDur(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }

  function loadAudio() {
    if (audioLoaded) return;
    audioLoaded = true;
    setVoiceBtn('loader', 'در حال بارگذاری');
    d.classList.add('voice-loading');
    d.classList.remove('voice-error');
    fetch(u, { credentials: 'include' }).then(async (res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      aud.src = url;
    }).catch((e) => {
      d.classList.remove('voice-loading');
      d.classList.add('voice-error');
      setVoiceBtn('refresh-cw', 'تلاش دوباره');
      console.error('Voice load failed:', e);
    });
  }

  const toggle = () => {
    if (d.classList.contains('voice-error')) {
      loadAudio();
      return;
    }
    if (aud.paused) {
      if (window._cva && window._cva !== aud) { window._cva.pause(); window._cva.currentTime = 0; }
      window._cva = aud;
      loadAudio();
      aud.play().catch(() => { d.classList.add('voice-error'); d.classList.remove('voice-loading'); setVoiceBtn('refresh-cw', 'تلاش دوباره'); });
    } else {
      aud.pause();
    }
  };
  btn.onclick = (e) => { e.stopPropagation(); toggle(); };
  btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };

  speedBtn.onclick = (e) => {
    e.stopPropagation();
    speedIdx = (speedIdx + 1) % speeds.length;
    aud.playbackRate = speeds[speedIdx];
    speedBtn.textContent = speeds[speedIdx] + 'x';
  };

  function paint() {
    const t = totalDur || aud.duration || 0;
    const cur = aud.currentTime || 0;
    const frac = t > 0 ? Math.min(1, Math.max(0, cur / t)) : 0;
    d.style.setProperty('--prog', (frac * 100) + '%');
    for (let i = 0; i < n; i++) {
      const pos = (i + 0.5) / n;
      barEls[i].classList.toggle('done', frac > pos);
    }
    timeEl.textContent = aud.paused ? fmtDur(t) : fmtDur(cur);
  }

  function seekFromEvent(e) {
    const rect = waveEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = totalDur || aud.duration || 0;
    if (t > 0) { aud.currentTime = x * t; paint(); }
  }

  let seeking = false;
  waveEl.addEventListener('pointerdown', (e) => {
    if (d.classList.contains('voice-loading') || d.classList.contains('voice-error')) return;
    e.preventDefault(); e.stopPropagation();
    seeking = true;
    waveEl.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  waveEl.addEventListener('pointermove', (e) => { if (seeking) seekFromEvent(e); });
  waveEl.addEventListener('pointerup', () => { seeking = false; });
  waveEl.addEventListener('pointercancel', () => { seeking = false; });

  aud.onloadedmetadata = () => {
    d.classList.remove('voice-loading');
    setVoiceBtn('play', 'پخش');
    if (!totalDur) timeEl.textContent = fmtDur(aud.duration);
    luc();
  };
  aud.onerror = () => {
    d.classList.remove('voice-loading');
    d.classList.add('voice-error');
    setVoiceBtn('refresh-cw', 'تلاش دوباره');
    luc();
  };
  aud.onplay = () => { d.classList.add('voice-playing'); d.classList.remove('voice-error'); setVoiceBtn('pause', 'توقف'); paint(); luc(); showNowPlaying(aud, (m&&m.name)||'ویس', totalDur); };
  function showNowPlaying(aud, name, duration) {
    const bars = [document.getElementById('now-playing'), document.getElementById('now-playing-main')];
    const t = name || 'ویس';
    bars.forEach(bar => { if (bar) { bar.classList.remove('hidden'); const sub=bar.querySelector('.np-sub'); if(sub) sub.textContent = t; const title=bar.querySelector('.np-title'); if(title) title.textContent='در حال پخش'; } });
    window._npAudio = aud;
    window._npName = t;
    window._npDur = duration || aud.duration || 0;
    window._npStart = Date.now();
    window._npUpdate = () => {
      const cur = (Date.now() - window._npStart) / 1000;
      const tt = window._npDur || aud.duration || 0;
      bars.forEach(bar => {
        if (!bar) return;
        const fill=bar.querySelector('#np-fill');
        const prog=bar.querySelector('.np-prog');
        if (fill) fill.style.width = (tt > 0 ? Math.round((aud.currentTime || cur) / tt * 100) : 0) + '%';
        const ttFmt = Math.floor(tt), curFmt = Math.floor(aud.currentTime || cur);
        const tf = (t, v) => { const mm = Math.floor(t); return String(Math.floor(mm/60)) + ':' + String(v%60 || 0).padStart(2,'0'); }
        const sub=bar.querySelector('.np-sub');
        if (sub) sub.textContent = t + ' • ' + tf(curFmt, curFmt) + ' / ' + tf(ttFmt, ttFmt);
      });
      if (!aud.paused) requestAnimationFrame(window._npUpdate);
    };
    window._npUpdate();
  }
  aud.onpause = () => { d.classList.remove('voice-playing'); setVoiceBtn('play', 'پخش'); luc(); paint(); hideNowPlaying(); };
  aud.onended = () => { d.classList.remove('voice-playing'); setVoiceBtn('play', 'پخش'); luc(); paint(); if (window._cva === aud) window._cva = null; hideNowPlaying(); };
  function hideNowPlaying() {
    if (window._npAudio !== aud) return;
    const bars = [document.getElementById('now-playing'), document.getElementById('now-playing-main')];
    bars.forEach(bar => { if (bar) bar.classList.add('hidden'); });
    window._npAudio = null; window._npName = null; window._npDur = null; window._npStart = null; window._npUpdate = null;
  }
  aud.ontimeupdate = paint;
  return d;
}
if(!window._npBound){ window._npBound=true;
  document.addEventListener('click',(e)=>{
    const bar=e.target.closest('#np-toggle') || e.target.closest('#np-toggle-main');
    if(bar){
      const id=bar.id;
      if(window._npAudio){ if(window._npAudio.paused) window._npAudio.play(); else window._npAudio.pause(); }
      if(id==='np-toggle-main'){ const ic2=window._npAudio&&!window._npAudio.paused?'pause':'play'; bar.innerHTML=ic(ic2); luc(); }
      return;
    }
    const closeBtn=e.target.closest('#np-close') || e.target.closest('#np-close-main');
    if(closeBtn){ if(window._npAudio) window._npAudio.pause(); const bars=[document.getElementById('now-playing'), document.getElementById('now-playing-main')]; bars.forEach(b=>{ if(b) b.classList.add('hidden'); }); window._npAudio=null; }
  });
}
function pollEl(m) {
  const d = document.createElement('div'); d.className = 'poll'; const opts = m.poll.options;
  const votes = m.poll.votes || {};
  const total = Object.keys(votes).length;
  d.innerHTML = '<div class="poll-q">' + esc(m.poll.question) + '</div>';
  opts.forEach((o, idx) => {
    const myVote = votes[state.me.username];
    const voted = myVote === idx;
    const cnt = Object.values(votes).filter((v) => v === idx).length;
    const pct = total ? Math.round((cnt / total) * 100) : 0;
    const row = document.createElement('div'); row.className = 'poll-opt' + (voted ? ' voted' : '');
    row.innerHTML = '<div class="poll-fill" style="width:' + pct + '%"></div><span class="po-text">' + esc(o) + '</span><span class="po-pct">' + pct + '%</span>';
    row.onclick = () => votePoll(m.id, idx, m.roomId); d.appendChild(row);
  });
  d.innerHTML += '<div class="poll-foot">' + total + ' رأی</div>'; return d;
}
function checklistEl(m) {
  const d = document.createElement('div'); d.className = 'checklist'; const items = m.checklist.items;
  d.innerHTML = '<div class="cl-title">' + esc(m.checklist.title || 'چک‌لیست') + '</div>';
  items.forEach((it, idx) => { const row = document.createElement('div'); row.className = 'cl-item' + (it.done ? ' done' : ''); row.innerHTML = '<span class="cl-box">' + (it.done ? ic('check') : '') + '</span><span>' + esc(it.text) + '</span>'; row.onclick = () => toggleCheck(m.id, idx, !it.done, m.roomId); d.appendChild(row); });
  const done = items.filter((i) => i.done).length; d.innerHTML += '<div class="cl-foot">' + done + '/' + items.length + '</div>'; return d;
}
const _burstAt = new Map(); // msgId|emoji -> timestamp (جلوگیری از افکت تکراری)
function reactionBurst(msgId, emoji) {
  _burstAt.set(msgId + '|' + emoji, Date.now());
  const wrap = document.querySelector('.msg[data-id="' + msgId + '"]');
  if (!wrap) return;
  const b = document.createElement('span');
  b.className = 'reac-burst';
  b.textContent = emoji;
  b.style.setProperty('--dx', (Math.round(Math.random() * 44) - 22) + 'px');
  wrap.appendChild(b);
  setTimeout(() => b.remove(), 1100);
}
function reactionsEl(m) {
  const c = document.createElement('div'); c.className = 'reactions';
  if (!m) return c;
  const rs = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {};
  Object.keys(rs).forEach((emoji) => {
    const users = Array.isArray(rs[emoji]) ? rs[emoji] : (rs[emoji] ? [rs[emoji]] : []);
    if (!users.length) return;
    const mine = users.includes((state.me || {}).username);
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'reac' + (mine ? ' me' : '');
    badge.dataset.em = emoji;
    badge.setAttribute('aria-label', (mine ? 'Remove your ' : 'Show who reacted with ') + (REACTION_LABELS[emoji] || emoji));
    badge.title = REACTION_LABELS[emoji] || emoji;
    badge.innerHTML = '<span class="reac-em">' + esc(emoji) + '</span><span class="reac-count">' + esc(String(users.length)) + '</span>';
    badge.onclick = (e) => { e.stopPropagation(); badge.classList.add('tap'); setTimeout(() => badge.classList.remove('tap'), 320); toggleReaction(m.id, emoji, m.roomId || state.room, m); };
    badge.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showReactionsSheet(m, emoji); };
    let lp = null;
    badge.addEventListener('touchstart', () => { lp = setTimeout(() => { showReactionsSheet(m, emoji); }, 500); }, { passive: true });
    badge.addEventListener('touchend', () => clearTimeout(lp), { passive: true });
    badge.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
    c.appendChild(badge);
  });
  return c;
}

/* COMPOSER */
function sendMessage() {
  const txt = $('composer-input').value.trim(); if (!txt) return;
  const rt = state.replyTo; const m = { kind: 'text', content: txt };
  if (rt) m.replyTo = { id: rt.id, name: rt.from || '', snippet: previewText(rt) };
  doSend(m); $('composer-input').value = ''; setReply(null);
}
async function doSend(m) { if (!state.ws || state.ws.readyState !== 1) { toast('اتصال برقرار نیست'); return; } state.ws.send(JSON.stringify(Object.assign({ type: 'message', roomId: state.room }, m))); }
$('composer-send').onclick = sendMessage;
$('composer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } if (e.key === 'Escape') setReply(null); });
let lastTypingSentAt = 0;
function sendTyping(on) {
  if (state.ws && state.ws.readyState === 1 && state.room) state.ws.send(JSON.stringify({ type: 'typing', roomId: state.room, on }));
}
$('composer-input').addEventListener('input', () => {
  const now = Date.now();
  if (now - lastTypingSentAt > 2000) { lastTypingSentAt = now; sendTyping(true); }
  handleMentionAutocomplete();
});
$('composer-input').addEventListener('blur', () => sendTyping(false));

/* MENTION AUTOCOMPLETE */
let mentionState = { active: false, query: '', startPos: 0, selectedIdx: -1, users: [] };
async function handleMentionAutocomplete() {
  const inp = $('composer-input');
  const pop = $('mention-pop');
  const text = inp.value;
  const pos = inp.selectionStart;
  // find last @ before cursor
  const before = text.slice(0, pos);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1 || atIdx < before.lastIndexOf('\n')) { hideMentionPop(); return; }
  const afterAt = before.slice(atIdx + 1);
  if (/\s/.test(afterAt)) { hideMentionPop(); return; }
  const query = afterAt.toLowerCase();
  mentionState.active = true;
  mentionState.query = query;
  mentionState.startPos = atIdx;
  mentionState.selectedIdx = -1;
  // fetch users if query changed significantly
  if (!mentionState.users.length || query.length === 1) {
    try {
      const r = await api('/api/users/search?q=' + encodeURIComponent(query));
      const d = await r.json();
      mentionState.users = d.users || [];
    } catch (e) { mentionState.users = []; }
  }
  // filter locally
  const filtered = mentionState.users.filter(u => u.username.toLowerCase().includes(query) || (u.displayName || '').toLowerCase().includes(query));
  if (!filtered.length) { hideMentionPop(); return; }
  renderMentionPop(filtered);
  // position pop near cursor
  const coords = getCursorCoordinates(inp, atIdx);
  pop.style.left = coords.left + 'px';
  pop.style.top = coords.top + 'px';
  pop.classList.remove('hidden');
}
function renderMentionPop(users) {
  const pop = $('mention-pop');
  pop.innerHTML = users.slice(0, 10).map((u, i) => `
    <div class="mention-item" data-idx="${i}" data-user="${esc(u.username)}">
      ${avatarEl(u, 'xs').outerHTML}
      <div class="mention-name">${esc(u.displayName || u.username)}</div>
      <div class="mention-sub">@${esc(u.username)}</div>
    </div>
  `).join('');
  pop.querySelectorAll('.mention-item').forEach(el => {
    el.onclick = () => insertMention(el.dataset.user);
    el.onmouseenter = () => { pop.querySelectorAll('.mention-item').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); mentionState.selectedIdx = parseInt(el.dataset.idx); };
  });
}
function hideMentionPop() {
  mentionState.active = false;
  mentionState.query = '';
  mentionState.startPos = 0;
  mentionState.selectedIdx = -1;
  $('mention-pop').classList.add('hidden');
}
function insertMention(username) {
  const inp = $('composer-input');
  const text = inp.value;
  const before = text.slice(0, mentionState.startPos);
  const after = text.slice(inp.selectionStart);
  inp.value = before + '@' + username + ' ' + after;
  inp.focus();
  inp.setSelectionRange(before.length + username.length + 2, before.length + username.length + 2);
  hideMentionPop();
  inp.dispatchEvent(new Event('input'));
}
function getCursorCoordinates(textarea, offset) {
  // create a mirror div to measure cursor position
  const mirror = document.createElement('div');
  const style = getComputedStyle(textarea);
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap',
    font: style.font, fontSize: style.fontSize, lineHeight: style.lineHeight,
    padding: style.padding, border: style.border, boxSizing: style.boxSizing,
    width: textarea.clientWidth + 'px', letterSpacing: style.letterSpacing
  });
  mirror.textContent = textarea.value.slice(0, offset);
  document.body.appendChild(mirror);
  const rect = mirror.getBoundingClientRect();
  const taRect = textarea.getBoundingClientRect();
  mirror.remove();
  return { left: rect.left - taRect.left + textarea.scrollLeft, top: rect.top - taRect.top + textarea.scrollTop + parseInt(style.lineHeight) };
}
// keydown handler for mention pop
document.addEventListener('keydown', (e) => {
  const pop = $('mention-pop');
  if (pop.classList.contains('hidden')) return;
  const items = pop.querySelectorAll('.mention-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); mentionState.selectedIdx = Math.min(mentionState.selectedIdx + 1, items.length - 1); updateMentionSelection(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mentionState.selectedIdx = Math.max(mentionState.selectedIdx - 1, 0); updateMentionSelection(items); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (mentionState.selectedIdx >= 0) insertMention(items[mentionState.selectedIdx].dataset.user); }
  else if (e.key === 'Escape') { hideMentionPop(); }
});
function updateMentionSelection(items) {
  items.forEach((el, i) => el.classList.toggle('sel', i === mentionState.selectedIdx));
  if (items[mentionState.selectedIdx]) items[mentionState.selectedIdx].scrollIntoView({ block: 'nearest' });
}
function prepImage(f, done) {
  const t = String(f && f.type || '');
  if (!/^image\/(jpe?g|png|webp)$/i.test(t)) return done(f);
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight, MAX = 1920;
      if (f.size <= 900 * 1024 && w <= MAX && h <= MAX) return done(f);
      const s = Math.min(1, MAX / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      const wantPng = t === 'image/png' && f.size <= 2 * 1024 * 1024;
      cv.toBlob((b) => done(b || f), wantPng ? 'image/png' : 'image/jpeg', 0.85);
    };
    img.onerror = () => done(f);
    img.src = fr.result;
  };
  fr.onerror = () => done(f);
  fr.readAsDataURL(f);
}
function uploadFileFromBlob(blob, name) { sendFileMessage(blob, name || 'paste.png'); }
document.addEventListener('paste', (e) => {
  if (!state.room) return;
  const items = (e.clipboardData || e.originalEvent && e.originalEvent.clipboardData || {}).items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === 'file') {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) sendFileMessage(f, f.name || 'paste.png');
      return;
    }
  }
});
const convEl = $('conversation');
if (convEl) {
  convEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); convEl.classList.add('drag-over'); });
  convEl.addEventListener('dragleave', (e) => { e.preventDefault(); convEl.classList.remove('drag-over'); });
  convEl.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); convEl.classList.remove('drag-over'); if (!state.room) return; const files = e.dataTransfer.files; if (files.length) { for (const f of files) sendFileMessage(f, f.name || 'file'); } });
}

/* ====== MEDIA TRANSFER — حلقه‌ی پیشرفت آپلود/دانلود داخل خود چت (مثل تلگرام) ====== */
const __memCache = new Map();          // url -> blob URL (برای عدم دانلود دوباره در همان نشست)
function memCacheSet(k, v, blob) {
  if (__memCache.size >= (LOW_END ? 20 : 80)) { const first = __memCache.keys().next().value; try { URL.revokeObjectURL(first); } catch (e) {} __memCache.delete(first); }
  __memCache.set(k, v);
  try { vxIdbPut(k, blob || v); } catch (e) {}
}
// IndexedDB persistent cache for media blobs (survives browser restart)
const VX_IDB='vx-media', VX_STORE='blobs';
function vxIdb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(VX_IDB,1); r.onupgradeneeded=()=>{ try{ r.result.createObjectStore(VX_STORE);}catch(e){} }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function vxIdbPut(url, blobOrUrl){
  try{
    const blob = (blobOrUrl && blobOrUrl instanceof Blob) ? blobOrUrl : await (await fetch(blobOrUrl)).blob();
    const db = await vxIdb(); const tx=db.transaction(VX_STORE,'readwrite'); tx.objectStore(VX_STORE).put(blob, url);
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  }catch(e){}
}
async function vxIdbGet(url){
  try{ const db=await vxIdb(); return await new Promise((res,rej)=>{ const tx=db.transaction(VX_STORE,'readonly'); const rq=tx.objectStore(VX_STORE).get(url); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null); }); }catch(e){ return null; }
}
// دانلود و ذخیره‌ی مستقیم از آپلود (برای پیش‌بارگذاری عکس‌ها در پس‌زمینه)
async function vxIdbPutFromUrl(url){
  try{
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return;
    const blob = await res.blob();
    const db = await vxIdb(); const tx = db.transaction(VX_STORE, 'readwrite'); tx.objectStore(VX_STORE).put(blob, url);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; tx.onabort = r; });
  }catch(e){}
}

/* ====== My GIFs & Video Editor IndexedDB ====== */
const MY_GIFS_IDB = 'vx-my-gifs', MY_GIFS_STORE = 'gifs';
const VIDEO_EDITOR_IDB = 'vx-video-editor', VE_STORE = 'projects';

function myGifsIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(MY_GIFS_IDB, 1);
    r.onupgradeneeded = () => {
      try { r.result.createObjectStore(MY_GIFS_STORE, { keyPath: 'id' }); } catch (e) {}
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function myGifsPut(gif) {
  try {
    const db = await myGifsIdb();
    const tx = db.transaction(MY_GIFS_STORE, 'readwrite');
    tx.objectStore(MY_GIFS_STORE).put(gif);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; tx.onabort = r; });
    return true;
  } catch (e) { return false; }
}

async function myGifsGetAll() {
  try {
    const db = await myGifsIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(MY_GIFS_STORE, 'readonly');
      const rq = tx.objectStore(MY_GIFS_STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    });
  } catch (e) { return []; }
}

async function myGifsDelete(id) {
  try {
    const db = await myGifsIdb();
    const tx = db.transaction(MY_GIFS_STORE, 'readwrite');
    tx.objectStore(MY_GIFS_STORE).delete(id);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; tx.onabort = r; });
    return true;
  } catch (e) { return false; }
}

function videoEditorIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(VIDEO_EDITOR_IDB, 1);
    r.onupgradeneeded = () => {
      try { r.result.createObjectStore(VE_STORE, { keyPath: 'id' }); } catch (e) {}
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function vePut(project) {
  try {
    const db = await videoEditorIdb();
    const tx = db.transaction(VE_STORE, 'readwrite');
    tx.objectStore(VE_STORE).put(project);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; tx.onabort = r; });
    return true;
  } catch (e) { return false; }
}

async function veGet(id) {
  try {
    const db = await videoEditorIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(VE_STORE, 'readonly');
      const rq = tx.objectStore(VE_STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}

async function veGetAll() {
  try {
    const db = await videoEditorIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(VE_STORE, 'readonly');
      const rq = tx.objectStore(VE_STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    });
  } catch (e) { return []; }
}

async function veDelete(id) {
  try {
    const db = await videoEditorIdb();
    const tx = db.transaction(VE_STORE, 'readwrite');
    tx.objectStore(VE_STORE).delete(id);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; tx.onabort = r; });
    return true;
  } catch (e) { return false; }
}

/* ====== کش دائمی پیام‌ها/روم‌ها (IndexedDB) — بدون مصرف مجدد اینترنت در نشست‌های بعدی ====== */
const HISTORY_CAP = 200;
const ROOMS_IDB = 'vx-rooms', ROOMS_STORE = 'rooms';
function roomsIdb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(ROOMS_IDB,1); r.onupgradeneeded=()=>{ try{ r.result.createObjectStore(ROOMS_STORE);}catch(e){} }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
let _roomsPersistTimer = null, _roomsLastWrite = 0;
function scheduleRoomsPersist(delay){
  if (!state.me || !state.me.username) return;
  clearTimeout(_roomsPersistTimer);
  _roomsPersistTimer = setTimeout(persistRooms, delay || 400);
}
async function persistRooms(){
  clearTimeout(_roomsPersistTimer);
  if (!state.me || !state.me.username) return;
  const now = Date.now();
  if (now - _roomsLastWrite < 250) { scheduleRoomsPersist(500); return; }
  _roomsLastWrite = now;
  try{
    const db = await roomsIdb(); const tx = db.transaction(ROOMS_STORE, 'readwrite'); const st = tx.objectStore(ROOMS_STORE);
    const owner = state.me.username;
    let wrote = false;
    for (const rid of Object.keys(state.rooms)) {
      const r = state.rooms[rid]; if (!r || !r.messages || !r.messages.length) continue;
      st.put({ owner, rid, messages: r.messages.slice(-HISTORY_CAP), last: r.last, unread: r.unread, previewOnly: r.previewOnly, lastSync: r.lastSync }, owner + '\u0000' + rid);
      wrote = true;
    }
    if (wrote) await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  }catch(e){}
}
async function hydrateRooms(){
  try{
    const db = await roomsIdb(); const out = {};
    const all = await new Promise((res,rej)=>{ const tx=db.transaction(ROOMS_STORE,'readonly'); const rq=tx.objectStore(ROOMS_STORE).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>res([]); });
    const owner = state.me.username;
    for (const rec of all) {
      if (!rec || rec.owner !== owner || !rec.rid || !rec.messages) continue;
      out[rec.rid] = { messages: rec.messages.slice(-HISTORY_CAP), last: rec.last || null, unread: rec.unread || 0, previewOnly: !!rec.previewOnly, lastSync: rec.lastSync || 0 };
      if (out[rec.rid].messages.length) out[rec.rid].previewOnly = false;
    }
    // روم‌هایی که پیش از این داخل حافظه «کامل» هستند (غیر پیش‌نمایش) تازه‌ترین‌اند و اولویت دارند؛
    // پیش‌نمایش تکیِ WS هرگز جای کش کامل را نمی‌گیرد.
    const inMem = state.rooms || {};
    for (const rid in inMem) { const r = inMem[rid]; if (r && r.messages && r.messages.length && !r.previewOnly) out[rid] = r; }
    state.rooms = out;
  }catch(e){}
}
async function clearRoomsCache(){
  try{ const db = await roomsIdb(); const tx = db.transaction(ROOMS_STORE, 'readwrite'); tx.objectStore(ROOMS_STORE).clear(); }catch(e){}
}
function mergeHistory(r, inc){
  if (!r || !inc) return;
  if (!r.messages || !Array.isArray(r.messages)) r.messages = [];
  const byId = {};
  for (const m of r.messages) if (m && m.id) byId[m.id] = m;
  for (const m of inc) if (m && m.id) byId[m.id] = m;
  const merged = Object.values(byId).sort((a, b) => (a.time || 0) - (b.time || 0));
  r.messages = merged.slice(-HISTORY_CAP);
  r.last = r.messages[r.messages.length - 1] || null;
  r.previewOnly = false;
  r.lastSync = Date.now();
}
/* پیش‌بارگذاری عکس‌های چت در پس‌زمینه: بار اول دانلود → در IDB می‌ماند → دفعات بعد بدون اینترنت، آنی */
let _warmTail = Promise.resolve();
const _warmSeen = new Set();
function warmMedia(src){
  if (!src || typeof src !== 'string' || src.indexOf('/uploads/') !== 0) return;
  if (_warmSeen.has(src)) return; _warmSeen.add(src);
  _warmTail = _warmTail.then(async () => {
    try { if (await vxIdbGet(src)) return; await vxIdbPutFromUrl(src); } catch(e){}
  });
}
const DL_C = 100.53;                    // محیط حلقه (2πr برای r=16 در viewBox 36)

function dlRing(size) {
  const r = document.createElement('div');
  r.className = 'dl-ring' + ((size || 64) <= 40 ? ' sm' : '');
  r.style.setProperty('--r-sz', (size || 64) + 'px');
  r.setAttribute('role', 'progressbar');
  r.setAttribute('aria-valuemin', '0'); r.setAttribute('aria-valuemax', '100'); r.setAttribute('aria-valuenow', '0');
  const d = 'M18 2a16 16 0 1 1 0 32 16 16 0 0 1 0-32';
  r.innerHTML = '<svg viewBox="0 0 36 36" class="dl-svg"><path class="dl-bg" d="' + d + '" stroke-width="3.4"/><path class="dl-fg" d="' + d + '" stroke-width="3.4"/></svg>'
    + '<div class="dl-num">0%</div>'
    + '<button class="dl-x" aria-label="لغو">' + ic('x') + '</button>'
    + '<button class="dl-refill" aria-label="تلاش دوباره">' + ic('refresh-cw') + '</button>';
  r._fg = r.querySelector('.dl-fg'); r._num = r.querySelector('.dl-num');
  r._x = r.querySelector('.dl-x'); r._refill = r.querySelector('.dl-refill');
  return r;
}
function dlSet(r, pct) {
  if (!r) return; pct = Math.max(0, Math.min(100, pct));
  if (r._fg) r._fg.style.strokeDashoffset = (DL_C * (1 - pct / 100)).toFixed(2);
  if (r._num) r._num.textContent = (pct >= 100 ? '' : Math.round(pct) + '%');
  r.setAttribute('aria-valuenow', Math.round(pct));
}
function dlErr(r) { if (r) r.classList.add('err'); }
function dlOk(r) { if (r) r.classList.remove('err'); }
let _dlIO = null;
function dlIO() {
  if (_dlIO) return _dlIO;
  try {
    _dlIO = new IntersectionObserver((es) => {
      for (const en of es) {
        const el = en.target;
        if (en.isIntersecting && el._dlStart) { const fn = el._dlStart; el._dlStart = null; _dlIO.unobserve(el); fn(); }
      }
    }, { rootMargin: (LOW_END ? 200 : 500) + 'px' });
    return _dlIO;
  } catch (e) { return null; }
}
function dlLazy(el, fn) {
  if (el._dlStart) return;
  el._dlStart = fn;
  const io = dlIO();
  if (io) io.observe(el); else fn();
}
function fmtBytes(n) {
  if (!n) return '';
  const x = n / 1024;
  if (x < 1024) return Math.round(x) + ' KB';
  return (x / 1024).toFixed(1) + ' MB';
}
function fetchMediaStream(url, onPct, onDone, onErr) {
  const ctl = new AbortController();
  fetch(url, { signal: ctl.signal }).then(async (res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const ctype = res.headers.get('Content-Type') || '';
    const reader = res.body.getReader();
    const chunks = []; let rcvd = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); rcvd += value.length;
      if (onPct && total) onPct(Math.round(rcvd / total * 100));
    }
    onDone && onDone(new Blob(chunks, { type: ctype }), rcvd, total);
  }).catch((e) => { if (e && e.name !== 'AbortError') onErr && onErr(e); });
  return ctl;
}

// دانلود دستی عکس: دکمه «دانلود» → حلقه → نمایش؛ لغو → دکمه دوباره (بدون دانلود خودکار)
function attachImageTransfer(holder, im, src) {
  const cached = __memCache.get(src);
  if (cached) { im.src = cached; im.onclick = () => openViewer(cached, 'image', src); return; }
  // try IDB persistent cache
  vxIdbGet(src).then(b=>{
    if(b){ const u=URL.createObjectURL(b); memCacheSet(src,u,b); im.src=u; holder.classList.remove('dl-loading'); const ov2=holder.querySelector('.dl-overlay'); if(ov2) ov2.remove(); im.onclick=()=>openViewer(u,'image',src); im.classList.add('loaded'); }
  });
  holder.classList.add('dl-loading');
  const ov = document.createElement('div'); ov.className = 'dl-overlay';
  const ring = dlRing(holder.closest('.album-item') ? 46 : 64);
  holder.appendChild(ov);
  let ctl = null, started = false;
  const showManual = () => {
    ov.innerHTML = '<button class="dl-manual" aria-label="دانلود">' + ic('download') + '</button>';
    applyIcons(ov);
  };
  showManual();
  const begin = () => {
    if (started && ctl && !ctl.signal.aborted && !ring.classList.contains('err')) return;
    started = true;
    dlOk(ring);
    ov.innerHTML = '';
    ov.appendChild(ring);
    ctl = fetchMediaStream(src, (p) => dlSet(ring, p), (blb) => {
      const burl = URL.createObjectURL(blb);
      memCacheSet(src, burl, blb);
      im.src = burl;
      holder.classList.remove('dl-loading');
      ov.remove();
      im.onclick = () => openViewer(src, 'image');
      im.classList.add('loaded');
    }, () => dlErr(ring));
    ring._x.onclick = (e) => {
      e.stopPropagation();
      try { if (ctl) ctl.abort(); } catch (e2) {}
      started = false;
      showManual();
    };
  };
  ov.onclick = (e) => { e.stopPropagation(); if (!started || ring.classList.contains('err')) begin(); };
  ring._refill.onclick = (e) => { e.stopPropagation(); begin(); };
}

// دانلود دستی فیلم: دکمه «دانلود» → حلقه → پخش؛ بدون دانلود خودکار
function attachVideoTransfer(holder, v, src) {
  const cached = __memCache.get(src);
  if (cached) { v.src = cached; v.onclick=()=>openViewer(cached,'video',src); return; }
  vxIdbGet(src).then(b=>{ if(b){ const u=URL.createObjectURL(b); memCacheSet(src,u,b); v.src=u; holder.classList.remove('dl-loading'); const ov2=holder.querySelector('.dl-overlay'); if(ov2) ov2.remove(); v.onclick=()=>openViewer(u,'video',src); } });
  holder.classList.add('dl-loading');
  const ov = document.createElement('div'); ov.className = 'dl-overlay';
  const ring = dlRing(holder.closest('.album-item') ? 46 : 64);
  const hint = document.createElement('div'); hint.className = 'dl-playhint';
  hint.innerHTML = ic('play') + '<span>پخش همزمان با دانلود</span>';
  holder.appendChild(ov);
  const st = { chunks: [], rcvd: 0, total: 0, done: false, playing: false, lastSwap: 0, ctl: null, wantPlay: false, started: false };
  const swap = () => {
    const old = v.src;
    const nu = URL.createObjectURL(new Blob(st.chunks));
    v.src = nu;
    if (old && old.startsWith('blob:')) { try { URL.revokeObjectURL(old); } catch (e) {} }
    if (st.wantPlay) { st.wantPlay = false; try { v.play().catch(() => {}); } catch (e) {} }
  };
  v.addEventListener('play', () => { st.playing = true; });
  const pauseH = () => { st.playing = false; if (!st.done && st.chunks.length) swap(); };
  v.addEventListener('pause', pauseH);
  v.addEventListener('seeked', () => { if (v.paused && !st.done && st.chunks.length) swap(); });
  v.addEventListener('error', () => { if (!st.done && st.chunks.length) swap(); });
  const showManual = () => {
    ov.innerHTML = '<button class="dl-manual" aria-label="دانلود">' + ic('download') + '</button>';
    applyIcons(ov);
  };
  showManual();
  const begin = () => {
    if (st.started && st.ctl && !st.ctl.signal.aborted && !ring.classList.contains('err')) return;
    st.started = true;
    dlOk(ring);
    ov.innerHTML = '';
    ov.appendChild(ring);
    ov.appendChild(hint);
    st.ctl = new AbortController();
    fetch(src, { signal: st.ctl.signal }).then(async (res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      st.total = Number(res.headers.get('Content-Length')) || 0;
      const ct = res.headers.get('Content-Type') || '';
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        st.chunks.push(value); st.rcvd += value.length;
        if (st.total) dlSet(ring, st.rcvd / st.total * 100);
        if (!LOW_END) {
          const now = Date.now();
          if (now - st.lastSwap > 600 && !st.playing) { swap(); st.lastSwap = now; }
        }
      }
      st.done = true;
      const finalBlob = new Blob(st.chunks, { type: ct });
      const nu = URL.createObjectURL(finalBlob);
      v.src = nu;
      memCacheSet(src, nu, finalBlob);
      holder.classList.remove('dl-loading');
      ov.remove();
      if (st.playing) { try { v.play().catch(() => {}); } catch (e) {} }
    }).catch((e) => { if (e && e.name !== 'AbortError') dlErr(ring); });
    ring._x.onclick = (e) => {
      e.stopPropagation();
      try { if (st.ctl) st.ctl.abort(); } catch (e2) {}
      st.wantPlay = false;
      st.chunks = []; st.rcvd = 0; st.total = 0; st.done = false; st.started = false;
      showManual();
    };
  };
  ov.onclick = (e) => {
    e.stopPropagation();
    if (ring.classList.contains('err')) { begin(); return; }
    if (st.done) return;
    if (!st.started) { st.wantPlay = true; begin(); return; }
    if (!st.playing) {
      if (!st.chunks.length) { st.wantPlay = true; begin(); }
      else { st.wantPlay = true; swap(); }
    } else { try { v.pause(); } catch (e2) {} }
  };
  ring._refill.onclick = (e) => { e.stopPropagation(); begin(); };
}

/* آپلود: بابل موقت با حلقه، سپس وقتی کامل شد message واقعی ارسال می‌شود */
function addUploadBubble(kind, blob, name) {
  const msgs = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg mine'; wrap.dataset.tempId = 'u' + Date.now() + '-' + Math.floor(Math.random() * 9999);
  const av = showMsgAvatar() ? '<div class="msg-av">' + avatarEl(state.me, 'xs').outerHTML + '</div>' : '';
  const prevUrl = URL.createObjectURL(blob);
  let inner;
  if (kind === 'image') inner = '<div class="media dl-loading"><img src="' + prevUrl + '" alt=""></div>';
  else if (kind === 'video') inner = '<div class="media dl-loading"><video muted playsinline></video></div>';
  else inner = '<div class="file-row"><span class="file-ic">' + ic('file') + '</span><div class="file-info"><div class="file-name">' + esc(name || 'فایل') + '</div><div class="file-size">در حال ارسال…</div></div></div>';
  wrap.innerHTML = av + '<div class="bubble">' + inner + '<div class="msg-meta"><span class="msg-time">در حال ارسال…</span></div></div>';
  msgs.appendChild(wrap);
  scrollBottom();
  const metaT = wrap.querySelector('.msg-meta .msg-time');
  const sizeEl = wrap.querySelector('.file-size');
  const ring = (kind === 'image' || kind === 'video') ? dlRing(64) : dlRing(30);
  const mediaBox = wrap.querySelector('.media');
  if (mediaBox) { const o = document.createElement('div'); o.className = 'dl-overlay'; o.appendChild(ring); mediaBox.appendChild(o); }
  else { const btn = document.createElement('span'); btn.className = 'file-dl'; btn.style.display = 'grid'; btn.appendChild(ring); wrap.querySelector('.file-row').appendChild(btn); }
  wrap._ring = ring; wrap._meta = metaT; wrap._sizeEl = sizeEl; wrap._prev = prevUrl;
  applyIcons(wrap);
  return wrap;
}
function uploadPct(wrap, pct) {
  dlSet(wrap._ring, Math.round(pct));
  if (wrap._meta) wrap._meta.innerHTML = '<span style="color:var(--primary)">' + ic('loader') + '</span> ' + Math.round(pct) + '%';
}
function uploadFail(wrap) {
  dlErr(wrap._ring);
  if (wrap._ring._refill) wrap._ring._refill.style.display = 'none';
  if (wrap._ring._x) { wrap._ring._x.style.display = 'grid'; wrap._ring._x.onclick = (e) => { e.stopPropagation(); dropUploadBubble(wrap, false); }; }
  if (wrap._meta) wrap._meta.innerHTML = '<span style="color:var(--danger)">' + ic('alert-triangle') + ' ناموفق — تلاش دوباره</span>';
  if (wrap._sizeEl) wrap._sizeEl.textContent = 'خطا در ارسال';
}
function dropUploadBubble(wrap, keepBlobUrl) {
  if (wrap._prev && !keepBlobUrl) { try { URL.revokeObjectURL(wrap._prev); } catch (e) {} }
  wrap.remove();
}
function sendFileMessage(blob, name) {
  if (!blob || !blob.size) { toast('فایل خالی است'); return; }
  name = name || 'file';
  prepImage(blob, (up) => {
    const t = String(up.type || '');
    const isImg = t.startsWith('image/');
    const isVid = t.startsWith('video/');
    const isAud = t.startsWith('audio/');
    const kind = isImg ? (t === 'image/gif' ? 'gif' : 'image') : isVid ? 'video' : isAud ? 'voice' : 'file';
    const upName = up === blob ? name : name.replace(/\.[^.]+$/, '') + '.jpg';
    const wrap = addUploadBubble(kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'file', up, upName);
    const fd = new FormData(); fd.append('file', up, upName);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
    if (state.token) xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
    xhr.upload.onprogress = (p) => { if (p.lengthComputable) uploadPct(wrap, p.loaded / p.total * 100); };
    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (!d.url) { uploadFail(wrap); toast(d.error || 'خطا در آپلود'); return; }
        memCacheSet(d.url, wrap._prev);     // بابل بعدی که از سرور برمی‌گردد همین بلاب را می‌گیرد
        dropUploadBubble(wrap, true);
        doSend({ kind, src: d.url, name, size: up.size, content: '' });
      } catch (e) { uploadFail(wrap); toast('خطا در آپلود'); }
    };
    xhr.onerror = () => { uploadFail(wrap); toast('خطای شبکه در آپلود'); };
    xhr.onabort = () => { toast('ارسال لغو شد'); };
    wrap._ring._x.onclick = (e) => { e.stopPropagation(); try { xhr.abort(); } catch (e2) {} dropUploadBubble(wrap, false); };
    xhr.send(fd);
  });
}
/* EMOJI PICKER — پیکر ایموجی شناور (PC قابل پین) و برگهٔ موبایل */
const STICKER_SET = [
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f600.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f601.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f602.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f603.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f604.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f605.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f606.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f609.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f60a.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f60b.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f60d.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f60e.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f612.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f614.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f616.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f618.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f61a.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f61c.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f61d.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f61e.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f620.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f621.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f622.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f623.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f625.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f628.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f629.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f62a.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f62b.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f62d.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f630.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f631.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f632.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f633.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f634.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f635.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f636.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f637.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f641.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f642.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f643.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f644.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f645.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f646.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f647.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f648.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f649.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64a.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64b.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64c.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64d.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64e.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f64f.png',
];
/* GIFهای «پرطرفدار» عمداً محلی‌اند (public/img/gifs/) و نه لینک Giphy:
   لینک‌های خارجی در خیلی از شبکه‌ها و فیلترها در دسترس نیستند و آن‌وقت
   پنل خالی می‌ماند و ارسال همیشه شکست می‌خورد. با سرو از همان مبدأ، بدون
   CORS، بدون SSRF و بدون وابستگی به اینترنت. */
const GIF_SET = [
  '/img/gifs/heart-beat.gif',
  '/img/gifs/spin-ring.gif',
  '/img/gifs/bounce-ball.gif',
  '/img/gifs/confetti.gif',
  '/img/gifs/ripple.gif',
  '/img/gifs/sparkle.gif',
  '/img/gifs/typing.gif',
  '/img/gifs/firework.gif',
  '/img/gifs/smiley.gif',
  '/img/gifs/wave-line.gif',
];
const EMOJI_PANEL_TABS = [
  { id: 'emoji', label: 'Emoji' },
  { id: 'sticker', label: 'Stickers' },
  { id: 'gif', label: 'GIFs' },
];
/* آخرین تبی که کاربر در آن بود نگه داشته می‌شود؛ دفعه‌ی بعد پنل روی همان تب
   باز می‌شود (مثلاً اگر روی GIFs بود، دوباره همان‌جا باز شود). */
const EMOJI_TAB_KEY = 'vx_emoji_tab';
function emojiTabLoad() {
  try {
    const v = localStorage.getItem(EMOJI_TAB_KEY);
    return EMOJI_PANEL_TABS.some((t) => t.id === v) ? v : 'emoji';
  } catch (e) { return 'emoji'; }
}
function emojiTabSave(id) { try { localStorage.setItem(EMOJI_TAB_KEY, id); } catch (e) {} }
let emojiPanelTab = emojiTabLoad();
function setEmojiPanelTab(id) {
  if (!EMOJI_PANEL_TABS.some((t) => t.id === id)) return;
  emojiPanelTab = id;
  emojiTabSave(id);
}
const EMOJI_PIN_KEY = 'vx_emoji_pinned';
function emojiPinned() { return localStorage.getItem(EMOJI_PIN_KEY) === '1'; }
function emojiPopEl() { return $('emoji-pop'); }
function closeEmojiPop() {
  const pop = emojiPopEl(); if (!pop) return;
  pop.classList.add('hidden'); pop.classList.remove('mobile', 'docked');
  if (isMobile()) {
    var ta = $('composer-input');
    if (ta) ta.removeAttribute('readonly');
  }
}
function emojiPopOpen() { const pop = emojiPopEl(); return pop && !pop.classList.contains('hidden'); }
function insertEmoji(e) {
  const inp = $('composer-input'); if (!inp) return;
  inp.value += e;
  if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.dispatchEvent(new Event('input'));
  if (!isMobile()) inp.focus();
}
function updateEmojiPinBtn() {
  const b = emojiPopEl() && emojiPopEl().querySelector('.emoji-pin');
  if (!b) return;
  const pinned = emojiPinned();
  b.classList.toggle('active', pinned);
  b.title = pinned ? 'برداشتن از حالت پین' : 'پین کردن (همیشه باز بماند)';
  b.innerHTML = ic(pinned ? 'pin' : 'pin-off');
  applyIcons(b);
}
function buildEmojiPopContent(pop) {
  if (pop.dataset.filled) { updateEmojiPinBtn(); return; }
  pop.innerHTML = '<div class="emoji-dock-head">'
    + '<button type="button" class="icon-btn emoji-pin" title="پین کردن" aria-label="پین کردن پنل ایموجی"></button>'
    + '<input id="emoji-search" class="input emoji-search-inp" placeholder="جستجوی ایموجی..." />'
    + '<button type="button" class="icon-btn emoji-close" title="بستن" aria-label="بستن پنل ایموجی">' + ic('x') + '</button>'
    + '</div>'
    + '<div class="emoji-dock-body">'
    + '<div class="emoji-tabs" id="emoji-tabs"></div>'
    + '<div class="emoji-cats" id="emoji-cats"></div>'
    + '<div class="emoji-grid" id="emoji-grid"></div>'
    + '</div>';
  const tabs = pop.querySelector('#emoji-tabs');
  const cats = pop.querySelector('#emoji-cats');
  const grid = pop.querySelector('#emoji-grid');
  const search = pop.querySelector('#emoji-search');
  pop.querySelector('.emoji-close').onclick = (e) => { e.stopPropagation(); closeEmojiPop(); };
  pop.querySelector('.emoji-pin').onclick = (e) => {
    e.stopPropagation();
    const pinned = !emojiPinned();
    localStorage.setItem(EMOJI_PIN_KEY, pinned ? '1' : '0');
    updateEmojiPinBtn();
    if (pinned) toast('ایموجی‌ها پین شدند — همیشه باز');
    else toast('پین برداشته شد');
  };
  EMOJI_PANEL_TABS.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-cat-btn' + (t.id === emojiPanelTab ? ' active' : '');
    btn.textContent = t.label;
    btn.onclick = () => { setEmojiPanelTab(t.id); renderEmojiPanelTab(pop); };
    tabs.appendChild(btn);
  });
  Object.keys(EMOJI_CATEGORIES).forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat.split(' ')[0];
    btn.title = cat;
    btn.onclick = () => { cats.querySelectorAll('.emoji-cat-btn').forEach((b) => b.classList.remove('active')); btn.classList.add('active'); renderEmojiGrid(grid, EMOJI_CATEGORIES[cat]); search.value = ''; };
    cats.appendChild(btn);
  });
  search.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      const activeCat = cats.querySelector('.emoji-cat-btn.active');
      const catName = (() => { for (const c of Object.keys(EMOJI_CATEGORIES)) { if (c.split(' ')[0] === activeCat.textContent) return c; } return Object.keys(EMOJI_CATEGORIES)[0]; })();
      renderEmojiGrid(grid, EMOJI_CATEGORIES[catName]);
      return;
    }
    renderEmojiGrid(grid, ALL_EMOJIS.filter((em) => em.toLowerCase().includes(q)));
  });
  pop.dataset.filled = '1';
  updateEmojiPinBtn();
  attachEmojiGridInput(grid);
  renderEmojiPanelTab(pop);
}
function renderEmojiPanelTab(pop) {
  const tabs = pop.querySelector('#emoji-tabs');
  if (tabs) tabs.querySelectorAll('.emoji-cat-btn').forEach((b, i) => b.classList.toggle('active', EMOJI_PANEL_TABS[i].id === emojiPanelTab));
  const cats = pop.querySelector('#emoji-cats');
  const grid = pop.querySelector('#emoji-grid');
  const search = pop.querySelector('#emoji-search');
  if (emojiPanelTab === 'emoji') {
    if (cats) cats.style.display = '';
    if (search) search.style.display = '';
    renderEmojiGrid(grid, EMOJI_CATEGORIES[Object.keys(EMOJI_CATEGORIES)[0]]);
  } else if (emojiPanelTab === 'sticker') {
    if (cats) cats.style.display = 'none';
    if (search) search.style.display = 'none';
    renderStickerGrid(grid);
  } else {
    if (cats) cats.style.display = 'none';
    if (search) search.style.display = 'none';
    renderGifGrid(grid);
  }
}
function renderStickerGrid(grid) {
  grid.innerHTML = '';
  STICKER_SET.forEach((url) => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    s.appendChild(img);
    grid.appendChild(s);
  });
}
async function renderGifGrid(grid) {
  grid.innerHTML = '';
  // اول «پرطرفدار» را هم��انی می‌کشیم تا به انتظار IndexedDB وابسته نباشد؛ اگر
  // IndexedDB کند/مسدود باشد، پنل نباید خالی بماند.
  const t2 = document.createElement('div');
  t2.className = 'gif-grid-title';
  t2.textContent = 'پرطرفدار';
  grid.appendChild(t2);
  GIF_SET.forEach((url) => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('load', () => applyGifPlayback(img, url, null));
    img.addEventListener('error', () => s.remove());
    s.appendChild(img);
    grid.appendChild(s);
  });
  let mine = [];
  try { mine = (await myGifsGetAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); } catch (e) {}
  if (!mine.length) return;
  const title = document.createElement('div');
  title.className = 'gif-grid-title';
  title.textContent = 'GIFهای من (' + mine.length + ')';
  grid.insertBefore(title, grid.firstChild);
  const nodes = [];
  for (const g of mine) {
    const s = document.createElement('span');
    s.className = 'emoji-item my-gif';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(g.blob);
    img.alt = g.name || '';
    img.dataset.gid = g.id;
    img.addEventListener('load', () => applyGifPlayback(img, '', g.blob));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'my-gif-del';
    del.title = 'حذف';
    del.innerHTML = ic('trash-2');
    del.setAttribute('aria-label', 'حذف GIF');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!(await uConfirm('این GIF حذف شود؟'))) return;
      await myGifsDelete(g.id);
      renderGifGrid(grid);
    };
    s.appendChild(img);
    s.appendChild(del);
    nodes.push(s);
  }
  for (const n of nodes) grid.insertBefore(n, grid.firstChild);
}
let _emojiPtr = null;
function attachEmojiGridInput(grid) {
  const itFrom = (t) => t && t.closest ? t.closest('.emoji-item') : null;
  const activate = (it) => {
    const img = it.querySelector('img');
    if (img) {
      if (emojiPanelTab === 'sticker') doSend({ kind: 'sticker', sticker: img.src });
      else if (emojiPanelTab === 'gif' && img.dataset.gid) { sendMyGif(img.dataset.gid).then(() => closeEmojiPop()); return; }
      else if (emojiPanelTab === 'gif') { sendRemoteGif(img.src); closeEmojiPop(); return; }
      else doSend({ kind: 'gif', src: img.src });
      closeEmojiPop();
    } else {
      insertEmoji(it.textContent);
    }
  };
  grid.addEventListener('pointerdown', (e) => {
    const it = itFrom(e.target);
    _emojiPtr = it ? { it, x: e.clientX, y: e.clientY } : null;
  }, { passive: true });
  grid.addEventListener('pointerup', (e) => {
    const it = itFrom(e.target);
    const p = _emojiPtr; _emojiPtr = null;
    if (!it || !p || p.it !== it) return;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 10) return;
    e.preventDefault();
    activate(it);
  }, { passive: false });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const it = itFrom(e.target);
    if (!it) return;
    e.preventDefault();
    activate(it);
  });
}
/* ATTACHMENT PICKER — پنل یکپارچه ارسال فایل */
const ATTACH_MAX_FILES = 10;
const ATTACH_MAX_SIZE = 50 * 1024 * 1024;
const ATTACH_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ATTACH_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ATTACH_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'];
const ATTACH_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'application/zip'];
const ATTACH_DOC_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip'];
let attachSelection = [];
function attachPopEl() { return $('attach-pop'); }
function attachPopOpen() { const pop = attachPopEl(); return pop && !pop.classList.contains('hidden'); }
function closeAttachPop() {
  const pop = attachPopEl(); if (!pop) return;
  pop.classList.add('hidden');
  attachSelection = [];
  if (isMobile()) { var ta = $('composer-input'); if (ta) ta.removeAttribute('readonly'); }
}
function openAttachPop() {
  const pop = attachPopEl(); if (!pop) return;
  buildAttachPopContent(pop);
  pop.classList.remove('hidden');
  pop.classList.toggle('mobile', isMobile());
  if (isMobile()) { var ta = $('composer-input'); if (ta) ta.setAttribute('readonly', 'readonly'); }
}
function toggleAttachPop() {
  const pop = attachPopEl(); if (!pop) return;
  if (attachPopOpen()) { closeAttachPop(); return; }
  openAttachPop();
}
function buildAttachPopContent(pop) {
  if (pop.dataset.filled) return;
  pop.innerHTML = '<div class="emoji-dock-head">'
    + '<button type="button" class="icon-btn emoji-close" title="بستن" aria-label="بستن پنل پیوست">' + ic('x') + '</button>'
    + '</div>'
    + '<div class="emoji-dock-body">'
    + '<div class="attach-options">'
    + '<button class="attach-option" data-type="gallery"><i data-lucide="image" class="icon"></i><span>گالری</span></button>'
    + '<button class="attach-option" data-type="file"><i data-lucide="file" class="icon"></i><span>فایل</span></button>'
    + '<button class="attach-option" data-type="location"><i data-lucide="map-pin" class="icon"></i><span>موقعیت</span></button>'
    + '<button class="attach-option" data-type="contact"><i data-lucide="contact" class="icon"></i><span>مخاطب</span></button>'
    + '<button class="attach-option" data-type="music"><i data-lucide="music" class="icon"></i><span>موسیقی</span></button>'
    + '</div>'
    + '<div class="attach-preview hidden" id="attach-preview"></div>'
    + '</div>';
  pop.querySelector('.emoji-close').onclick = (e) => { e.stopPropagation(); closeAttachPop(); };
  pop.querySelectorAll('.attach-option').forEach((btn) => {
    btn.onclick = () => handleAttachOption(btn.dataset.type);
  });
  applyIcons(pop);
  pop.dataset.filled = '1';
}
function handleAttachOption(type) {
  if (type === 'location') { handleLocationShare(); return; }
  if (type === 'contact') { handleContactShare(); return; }
  const inp = $(type + '-input');
  if (inp) { inp.value = ''; inp.click(); }
}
function validateAttachFile(f, type) {
  if (f.size > ATTACH_MAX_SIZE) return 'فایل «' + (f.name || '') + '» بیش از حد بزرگ است (حداکثر ۵۰ مگابایت)';
  const mime = (f.type || '').toLowerCase();
  const ext = ((f.name || '').toLowerCase().match(/\.[^.]+$/) || [''])[0];
  if (type === 'gallery') {
    if (!ATTACH_IMAGE_TYPES.includes(mime) && !ATTACH_VIDEO_TYPES.includes(mime)) return 'نوع فایل مجاز نیست: ' + (f.name || '');
  } else if (type === 'file') {
    if (!ATTACH_DOC_TYPES.includes(mime) && !ATTACH_DOC_EXTS.includes(ext)) return 'نوع فایل مجاز نیست: ' + (f.name || '');
  } else if (type === 'music') {
    if (!ATTACH_AUDIO_TYPES.includes(mime)) return 'نوع فایل مجاز نیست: ' + (f.name || '');
  }
  return null;
}
function handleAttachFiles(files, type) {
  if (!files || !files.length) return;
  const valid = [];
  for (const f of files) {
    const err = validateAttachFile(f, type);
    if (err) { toast(err); continue; }
    valid.push(f);
  }
  if (!valid.length) return;
  if (attachSelection.length + valid.length > ATTACH_MAX_FILES) { toast('حداکثر ' + ATTACH_MAX_FILES + ' فایل می‌توانید انتخاب کنید'); return; }
  valid.forEach((f) => {
    attachSelection.push({ id: 'f' + Date.now() + Math.random().toString(36).slice(2, 7), file: f, type: type, status: 'selected', progress: 0, error: null });
  });
  renderAttachPreview();
  /* انتخاب یک عکس یا ویدیو ⇒ بلافاصله منوی ادیت مخصوص خودش باز شود.
     بستهٔ پیوست باز می‌ماند و فایل خودکار هم ارسال نمی‌شود تا کاربر
     اول فرصت ویرایش داشته باشد. */
  if (valid.length === 1 && attachSelection.length === 1) {
    const f = valid[0];
    const mime = String(f.type || '').toLowerCase();
    if (ATTACH_VIDEO_TYPES.includes(mime)) openVideoTools(f, { onSendRaw: (orig) => { closeAttachPop(); sendFileMessage(orig, orig.name || 'video'); } });
    else if (ATTACH_IMAGE_TYPES.includes(mime) && mime !== 'image/gif') {
      openPhotoActionMenu(f, {
        onRaw: (orig) => { closeAttachPop(); sendFileMessage(orig, orig.name || 'image'); },
      });
    }
  }
}

/* ---------- منوی اقدامات عکس ---------- */
function openPhotoActionMenu(file, opts = {}) {
  const pop = veOpenModal('ابزارهای عکس');
  pop.classList.add('ve-wide');
  const body = pop.querySelector('.ve-body');
  const foot = pop.querySelector('.ve-foot');
  const url = URL.createObjectURL(file);
  const prev = document.createElement('img');
  prev.className = 've-preview';
  prev.style.objectFit = 'contain';
  prev.src = url;
  prev.alt = '';
  const grid = document.createElement('div');
  grid.className = 'vt-grid';
  grid.innerHTML = [
    { id: 'draw', icon: 'paintbrush', label: 'نقاشی و سانسور', hint: 'قلم‌ها، رنگ‌ها، سانسور شفاف' },
    { id: 'crop', icon: 'crop', label: 'برش عکس', hint: 'برش از کناره‌ها' },
  ].map((t) => '<button type="button" class="vt-card" data-t="' + t.id + '">'
    + '<i data-lucide="' + t.icon + '" class="icon"></i><b>' + t.label + '</b><small>' + t.hint + '</small></button>').join('');
  body.appendChild(prev);
  body.appendChild(grid);
  const raw = document.createElement('button');
  raw.type = 'button'; raw.className = 'btn primary';
  raw.innerHTML = ic('send') + ' ارسال بدون تغییر';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.textContent = 'انصراف';
  foot.appendChild(raw); foot.appendChild(cancel);
  applyIcons(pop);
  let closed = false;
  /* انصراف فقط پنجره را می‌بندد؛ بستهٔ پیوست باید باز بماند تا کاربر مجبور
     نشود دوباره فایل را انتخاب کند. */
  function close() { if (closed) return; closed = true; URL.revokeObjectURL(url); pop.remove(); }
  cancel.onclick = close;
  raw.onclick = () => { close(); if (opts.onRaw) opts.onRaw(file); };
  pop.addEventListener('mousedown', (e) => { if (e.target === pop) close(); });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.vt-card');
    if (!b) return;
    const tool = b.dataset.t;
    close();
    openPhotoEditor(file, (blob, name) => {
      if (blob === file) { if (opts.onRaw) opts.onRaw(file); return; }
      if (opts.onEdited) opts.onEdited(blob, name);
      else sendFileMessage(blob, name);
    }, { startInCrop: tool === 'crop' });
  });
}

function renderAttachPreview() {
  const pop = attachPopEl(); if (!pop) return;
  const preview = pop.querySelector('#attach-preview');
  if (!preview) return;
  if (!attachSelection.length) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
  preview.classList.remove('hidden');
  let h = '<div class="attach-preview-grid">';
  attachSelection.forEach((item) => {
    const mime = String(item.file.type || '').toLowerCase();
    h += '<div class="attach-preview-item" data-id="' + item.id + '">';
    if (mime.startsWith('image/')) {
      h += '<img src="' + URL.createObjectURL(item.file) + '" alt="">';
    } else if (mime.startsWith('video/')) {
      h += '<video src="' + URL.createObjectURL(item.file) + ' muted playsinline preload="metadata"></video>';
    } else {
      h += '<div class="file-info"><i data-lucide="file" class="icon"></i><div>' + (item.file.name || '').replace(/</g, '&lt;') + '</div><div>' + fmtBytes(item.file.size) + '</div></div>';
    }
    h += '<button class="remove" data-id="' + item.id + '" aria-label="حذف">' + ic('x') + '</button>';
    h += '</div>';
  });
  h += '</div>';
  const n = attachSelection.length;
  const allMedia = attachSelection.every((it) => /^image\//.test(it.file.type) || /^video\//.test(it.file.type));
  if (n > 1 && allMedia) {
    h += '<div class="attach-preview-actions"><button class="btn sm" id="attach-collage">ارسال به‌صورت کلاژ (' + n + ')</button></div>';
  }
  h += '<div class="attach-preview-actions"><button class="btn sm primary" id="attach-send">ارسال (' + n + ')</button></div>';
  preview.innerHTML = h;
  applyIcons(preview);
  preview.querySelectorAll('.remove').forEach((b) => {
    b.onclick = () => { attachSelection = attachSelection.filter((x) => x.id !== b.dataset.id); renderAttachPreview(); };
  });
  const sendBtn = preview.querySelector('#attach-send');
  if (sendBtn) sendBtn.onclick = sendAttachSelection;
  const colBtn = preview.querySelector('#attach-collage');
  if (colBtn) colBtn.onclick = sendAttachCollage;
}

/* آپلود یک فایل و برگرداندن URL سرور (بدون ساخت پیام) */
function uploadOne(file, name) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, name || file.name || 'file');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    if (state.token) xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (!d.url) return reject(new Error(d.error || 'خطا در آپلود'));
        /* سرور فقط /uploads/... را می‌پذیرد؛ اگر R2 آدرس کامل داد،
           به شکل نسبیِ همان مسیر تبدیل می‌شود (خودِ /uploads پروکسی می‌کند). */
        let u = String(d.url);
        const selfAbs = location.origin + '/uploads/';
        if (u.startsWith(selfAbs)) u = u.slice(location.origin.length);
        resolve({ url: u, size: d.size || file.size, raw: d.url });
      } catch (e) { reject(new Error('پاسخ نامعتبر از سرور')); }
    };
    xhr.onerror = () => reject(new Error('خطای شبکه'));
    xhr.onabort = () => reject(new Error('لغو شد'));
    xhr.send(fd);
  });
}

/* چند عکس/ویدیو ⇒ یک پیام کلاژ (album) به‌جای چند پیام جدا */
async function sendAttachCollage() {
  const items = attachSelection.slice();
  if (!items.length) return;
  const wrap = addUploadBubble('file', new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38])], { type: 'image/gif' }), 'کلاژ');
  if (wrap._ring) dlSet(wrap._ring, 8);
  let doneN = 0;
  try {
    const urls = [];
    /* ترتیبی تا محدودیت نرخ سرور (۳۰ آپلود در دقیقه) دور نخوریم */
    for (const it of items) {
      const r = await uploadOne(it.file, it.file.name);
      urls.push(r.url);
      doneN++;
      if (wrap._ring) dlSet(wrap._ring, Math.round(doneN / items.length * 92));
    }
    if (!urls.length) throw new Error('آپلود نشد');
    dropUploadBubble(wrap);
    doSend({ kind: 'album', album: urls.slice(0, 10), content: '' });
    closeAttachPop();
  } catch (e) {
    dropUploadBubble(wrap);
    toast('ارسال کلاژ ناموفق بود — ' + ((e && e.message) || 'خطا'));
  }
}

function sendAttachSelection() {
  if (!attachSelection.length) return;
  const items = attachSelection.slice();
  closeAttachPop();
  items.forEach((item) => { sendFileMessage(item.file, item.file.name || 'file'); });
}
function handleLocationShare() {
  /* انتخاب موقعیت روی نقشه (پنجرهٔ نقشه) به‌جای فرستادن مختصات خام */
  if (window.VXMapOpenPicker) {
    window.VXMapOpenPicker({
      onPick: function (p) {
        doSend({ kind: 'location', lat: p.lat, lng: p.lon, label: p.label || '' });
        closeAttachPop();
      },
    });
    closeAttachPop();
    return;
  }
  /* اگر به هر دلیلی نقشه در دسترس نبود ⇒ موقعیت فعلی خودم */
  if (!navigator.geolocation) { toast('موقعیت‌یابی در این مرورگر پشتیبانی نمی‌شود'); return; }
  toast('در حال دریافت موقعیت...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      doSend({ kind: 'location', lat: Number(lat), lng: Number(lng), label: 'موقعیت من' });
      closeAttachPop();
    },
    (err) => {
      if (err.code === 1) toast('دسترسی به موقعیت رد شد');
      else if (err.code === 2) toast('موقعیت در دسترس نیست');
      else toast('خطا در دریافت موقعیت');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
function handleContactShare() {
  const contacts = getContacts();
  const keys = Object.keys(contacts);
  if (!keys.length) { toast('مخاطبی یافت نشد'); return; }
  const pop = attachPopEl(); if (!pop) return;
  const preview = pop.querySelector('#attach-preview');
  if (!preview) return;
  preview.classList.remove('hidden');
  let h = '<div class="attach-preview-grid">';
  keys.slice(0, 20).forEach((k) => {
    const c = contacts[k];
    h += '<div class="attach-preview-item" data-contact="' + k.replace(/"/g, '&quot;') + '">';
    h += '<div class="file-info"><i data-lucide="contact" class="icon"></i><div>' + (c.name || k).replace(/</g, '&lt;') + '</div><div>' + (c.phone || '').replace(/</g, '&lt;') + '</div></div>';
    h += '</div>';
  });
  h += '</div>';
  preview.innerHTML = h;
  applyIcons(preview);
  preview.querySelectorAll('.attach-preview-item').forEach((el) => {
    el.onclick = () => {
      const c = contacts[el.dataset.contact];
      doSend({ kind: 'text', content: '👤 ' + (c.name || el.dataset.contact) + (c.phone ? '\n📞 ' + c.phone : '') });
      closeAttachPop();
    };
  });
}
function openEmojiPop() {
  const pop = emojiPopEl(); if (!pop) return;
  buildEmojiPopContent(pop);
  pop.classList.remove('hidden');
  pop.classList.toggle('mobile', isMobile());
  if (isMobile()) {
    var ta = $('composer-input');
    if (ta) ta.setAttribute('readonly', 'readonly');
  }
  renderEmojiPanelTab(pop);
}
function toggleEmojiPop() {
  const pop = emojiPopEl(); if (!pop) return;
  if (emojiPopOpen()) { closeEmojiPop(); return; }
  openEmojiPop();
}
$('composer-emoji').onclick = (e) => { e.stopPropagation(); e.preventDefault(); toggleEmojiPop(); };
document.addEventListener('click', (e) => {
  const pop = emojiPopEl();
  if (!pop || pop.classList.contains('hidden') || emojiPinned()) return;
  if (!pop.contains(e.target) && !($('composer-emoji') && $('composer-emoji').contains(e.target))) closeEmojiPop();
});
document.addEventListener('click', (e) => {
  const pop = attachPopEl();
  if (!pop || pop.classList.contains('hidden')) return;
  /* اگر منوی ادیت (ویدیو/عکس) یا هر پنجرهٔ شناور دیگری باز است، بستهٔ پیوست
     نباید خودکار بسته شود؛ کاربر باید اول ادیت را تمام کند. */
  if (document.querySelector('.ve-pop, .modal-ov')) return;
  if (!pop.contains(e.target) && !($('composer-attach') && $('composer-attach').contains(e.target))) closeAttachPop();
});
(function () {
  const gi = document.createElement('input');
  gi.type = 'file'; gi.id = 'gallery-input'; gi.className = 'hidden';
  gi.accept = 'image/*,video/*'; gi.multiple = true;
  gi.onchange = (e) => { handleAttachFiles(e.target.files, 'gallery'); };
  document.body.appendChild(gi);
  const mi = document.createElement('input');
  mi.type = 'file'; mi.id = 'music-input'; mi.className = 'hidden';
  mi.accept = 'audio/*'; mi.multiple = true;
  mi.onchange = (e) => { handleAttachFiles(e.target.files, 'music'); };
  document.body.appendChild(mi);
})();
function renderEmojiGrid(grid, emojis) {
  grid.innerHTML = '';
  emojis.forEach((e) => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    s.textContent = e;
    s.setAttribute('role', 'button');
    s.setAttribute('tabindex', '0');
    grid.appendChild(s);
  });
}
$('composer-attach').onclick = (e) => { e.stopPropagation(); e.preventDefault(); toggleAttachPop(); };
$('file-input').onchange = (e) => { handleAttachFiles(e.target.files, 'file'); };
/* ====== VOICE RECORDING — inline composer system ====== */
const VO = { state: 'idle', recorder: null, stream: null, analyser: null, ac: null, timer: null, waveTimer: null, chunks: [], wave: [], waveEl: null, start: 0, startXY: [0, 0], cancel: false, locked: false, paused: false, pauseTime: 0, blob: null, dur: 0, finWave: null, abort: false, maxDur: 300, warnAt: 270 };
function getMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const t of types) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
  return 'audio/webm';
}
function haptic(ms) { try { navigator.vibrate(ms || 30); } catch (e) {} }
function recFmt(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }
function downsampleWave(arr, n) {
  n = n || 46; if (!arr || !arr.length) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * arr.length / n);
    const to = Math.max(from + 1, Math.floor((i + 1) * arr.length / n));
    let peak = 0;
    for (let j = from; j < to; j++) { const v = arr[j]; if (v > peak) peak = v; }
    out.push(Math.max(0.1, Math.min(1, peak)));
  }
  return out;
}

function composerEl() { return $('composer'); }
function setComposerMode(mode) {
  const c = composerEl();
  if (!c) return;
  c.classList.remove('rec-mode', 'locked-mode', 'rec-canceling');
  const ri = $('rec-inline');
  if (mode === 'recording' || mode === 'locked') {
    c.classList.add(mode === 'locked' ? 'locked-mode' : 'rec-mode');
    if (ri) { ri.classList.remove('hidden'); ri.style.display = ''; }
  } else {
    if (ri) { ri.classList.add('hidden'); ri.style.display = ''; }
  }
}

function drawRecWave(amp) {
  VO.wave.push(Math.max(0, Math.min(1, amp || 0)));
  if (VO.wave.length > 40) VO.wave.shift();
  VO.waveEl = $('rec-inline-wave');
  if (!VO.waveEl) return;
  VO.waveEl.innerHTML = VO.wave.map((h) => '<i style="height:' + Math.max(4, Math.round(h * 100)) + '%"></i>').join('');
}

function startRecTimer() {
  function tick() {
    if (VO.state === 'idle') return;
    if (!VO.paused) {
      const elapsed = (Date.now() - VO.start) / 1000;
      const t = $('rec-inline-time');
      if (t) t.textContent = recFmt(elapsed);
      if (elapsed >= VO.maxDur) { haptic(200); recStop(); return; }
      if (elapsed >= VO.warnAt && Math.floor(elapsed) % 10 === 0) haptic(50);
    }
    VO.timer = setTimeout(tick, 200);
  }
  tick();
}
function stopRecTimer() { if (VO.timer) { clearTimeout(VO.timer); VO.timer = null; } }

function cleanupRec() {
  stopRecTimer();
  if (VO.waveTimer) { cancelAnimationFrame(VO.waveTimer); VO.waveTimer = null; }
  if (VO.analyser) { try { VO.analyser.disconnect(); } catch (e) {} VO.analyser = null; }
  if (VO.ac) { try { VO.ac.close(); } catch (e) {} VO.ac = null; }
  if (VO.stream) { VO.stream.getTracks().forEach((t) => t.stop()); VO.stream = null; }
  if (VO.recorder) { try { VO.recorder.ondataavailable = null; VO.recorder.onstop = null; } catch (e) {} VO.recorder = null; }
  VO.chunks = []; VO.wave = []; VO.waveEl = null; VO.cancel = false; VO.locked = false; VO.paused = false; VO.pauseTime = 0; VO.abort = false;
  VO.state = 'idle';
  $('composer-mic').classList.remove('recording');
  setComposerMode('idle');
  const wv = $('rec-inline-wave'); if (wv) wv.innerHTML = '';
  const tm = $('rec-inline-time'); if (tm) tm.textContent = '0:00';
  const ps = $('rec-inline-pause'); if (ps) { ps.classList.add('hidden'); ps.classList.remove('paused'); }
}
function showRecRecording() {
  setComposerMode('recording');
  luc();
}
function showRecLocked() {
  VO.state = 'locked';
  setComposerMode('locked');
  const ps = $('rec-inline-pause'); if (ps) { ps.classList.remove('hidden'); ps.classList.remove('paused'); }
  luc();
}
function recPause() {
  if (VO.state !== 'locked') return;
  if (!VO.paused) {
    VO.recorder.pause();
    VO.paused = true;
    VO.pauseTime = Date.now();
    haptic(30);
    const ps = $('rec-inline-pause'); if (ps) ps.classList.add('paused');
  } else {
    VO.recorder.resume();
    VO.paused = false;
    VO.start += (Date.now() - VO.pauseTime);
    haptic(30);
    const ps = $('rec-inline-pause'); if (ps) ps.classList.remove('paused');
  }
}
function recStop() {
  if (VO.recorder && VO.recorder.state !== 'inactive') { try { VO.recorder.stop(); } catch (e) {} }
  else cleanupRec();
}
function onRecStop() {
  const canceled = VO.cancel;
  const wave = VO.wave.slice();
  const recType = VO.recorder ? String(VO.recorder.mimeType || getMime()).split(';')[0].trim() : getMime().split(';')[0].trim();
  const blob = new Blob(VO.chunks, { type: recType });
  const dur = (Date.now() - VO.start) / 1000;
  cleanupRec();
  if (!blob.size || canceled) { if (canceled) toast('ضبط لغو شد'); return; }
  if (dur < 0.5) { toast('ضبط خیلی کوتاه بود'); return; }
  sendVoice(blob, dur, downsampleWave(wave, 46));
}

async function sendVoice(blob, dur, w) {
  if (!blob || !blob.size) { toast('ضبط خالی بود'); return; }
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  const placeholder = addVoicePlaceholder();
  const fd = new FormData(); fd.append('file', blob, 'voice.' + ext);
  const bar = $('upload-bar'); bar.classList.remove('hidden'); $('upload-fill').style.width = '0%';
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  if (state.token) xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
  xhr.upload.onprogress = (p) => { if (p.lengthComputable) { const pct = Math.round((p.loaded / p.total) * 100); $('upload-fill').style.width = pct + '%'; updateVoiceProgress(placeholder, pct); } };
  xhr.onload = () => {
    bar.classList.add('hidden'); $('upload-fill').style.width = '0%';
    try {
      const d = JSON.parse(xhr.responseText);
      if (!d.url) { showVoiceFailed(placeholder, blob, dur, w); toast(d.error || 'ارسال ویس نشد'); return; }
      removeVoicePlaceholder(placeholder);
      doSend({ kind: 'voice', src: d.url, duration: dur, wave: (Array.isArray(w) && w.length) ? w : undefined, content: '' });
    } catch (e) { showVoiceFailed(placeholder, blob, dur, w); toast('خطا در ارسال پیام صوتی'); }
  };
  xhr.onerror = () => { bar.classList.add('hidden'); $('upload-fill').style.width = '0%'; showVoiceFailed(placeholder, blob, dur, w); };
  xhr.send(fd);
}
function addVoicePlaceholder() {
  const msgs = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg mine voice-sending';
  wrap.dataset.tempId = 'v' + Date.now();
  wrap.innerHTML = (showMsgAvatar() ? '<div class="msg-av">' + avatarEl(state.me, 'xs').outerHTML + '</div>' : '')
    + '<div class="bubble"><div class="msg-body"><div class="voice-cap voice-loading">'
    + '<div class="voice-play" style="pointer-events:none">' + ic('loader') + '</div>'
    + '<div class="voice-wave sending-wave">' + Array.from({length:30}, (_,i) => '<i style="animation-delay:' + (i * 50) + 'ms;height:20%"></i>').join('') + '</div>'
    + '<span class="voice-time">...</span>'
    + '</div></div>'
    + '<div class="msg-meta"><span class="msg-time">' + ic('loader') + ' در حال ارسال...</span></div></div>';
  msgs.appendChild(wrap);
  scrollBottom();
  return wrap;
}
function removeVoicePlaceholder(el) { if (el && el.parentNode) el.remove(); }
function updateVoiceProgress(el, pct) {
  if (!el) return;
  const meta = el.querySelector('.msg-meta .msg-time');
  if (meta) meta.innerHTML = ic('loader') + ' ' + pct + '%...';
}
function showVoiceFailed(el, blob, dur, w) {
  removeVoicePlaceholder(el);
  const msgs = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg mine voice-failed';
  wrap.innerHTML = (showMsgAvatar() ? '<div class="msg-av">' + avatarEl(state.me, 'xs').outerHTML + '</div>' : '')
    + '<div class="bubble"><div class="msg-body"><div class="voice-cap voice-error">'
    + '<button class="voice-play" title="ارسال مجدد" aria-label="ارسال مجدد پیام صوتی">' + ic('refresh-cw') + '</button>'
    + '<span class="voice-time">خطا</span></div></div>'
    + '<div class="msg-meta"><span class="msg-time" style="color:var(--danger)">ارسال ناموفق</span></div></div>';
  msgs.appendChild(wrap);
  scrollBottom();
  wrap.querySelector('.voice-play').onclick = () => { wrap.remove(); sendVoice(blob, dur, w); };
  luc();
}

async function startRecording() {
  if (VO.state !== 'idle') return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند'); return; }
  try {
    VO.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { toast('دسترسی به میکروفون داده نشد'); return; }
  if (VO.abort) { VO.stream.getTracks().forEach((t) => t.stop()); VO.stream = null; VO.abort = false; return; }
  VO.state = 'recording';
  VO.chunks = []; VO.wave = []; VO.waveEl = null; VO.finWave = null; VO.cancel = false; VO.locked = false; VO.paused = false;
  VO.recorder = new MediaRecorder(VO.stream, { mimeType: getMime() });
  VO.recorder.ondataavailable = (e) => { if (e.data.size) VO.chunks.push(e.data); };
  VO.recorder.onstop = onRecStop;
  VO.recorder.start();
  VO.start = Date.now();
  $('composer-mic').classList.add('recording');
  showRecRecording();
  startRecTimer();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    VO.ac = new AC();
    const srcNode = VO.ac.createMediaStreamSource(VO.stream);
    VO.analyser = VO.ac.createAnalyser();
    VO.analyser.fftSize = 256;
    srcNode.connect(VO.analyser);
    const data = new Uint8Array(VO.analyser.frequencyBinCount);
    const waveTick = () => {
      if (!VO.analyser) return;
      VO.analyser.getByteTimeDomainData(data);
      let mn = 1, mx = -1;
      for (const v of data) { const x = v / 128 - 1; if (x < mn) mn = x; if (x > mx) mx = x; }
      const amp = Math.min(1, (mx - mn) / 2 * 3.2);
      drawRecWave(amp);
      VO.waveTimer = requestAnimationFrame(waveTick);
    };
    waveTick();
  }
}
function recInit() {
  let pressed = false;
  $('composer-mic').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pressed = true;
    VO.startXY = [e.clientX, e.clientY];
    VO.cancel = false;
    VO.abort = false;
    startRecording();
  });
  $('rec-inline-del').addEventListener('click', () => { VO.cancel = true; recStop(); });
  $('rec-inline-send').addEventListener('click', () => { if (VO.state !== 'idle') recStop(); });
  $('rec-inline-pause').addEventListener('click', () => recPause());
  window.addEventListener('pointermove', (e) => {
    if (VO.state !== 'recording' || !pressed) return;
    const dx = e.clientX - VO.startXY[0], dy = e.clientY - VO.startXY[1];
    const canceling = dx < -60;
    const locking = dy < -60 && !canceling;
    if (canceling !== VO.cancel) {
      VO.cancel = canceling;
      const c = composerEl();
      if (c) c.classList.toggle('rec-canceling', canceling);
    }
    if (locking && !VO.locked) {
      VO.locked = true;
      pressed = false;
      haptic(60);
      showRecLocked();
    }
  });
  window.addEventListener('pointerup', () => {
    if (VO.state === 'recording' && pressed && !VO.locked) {
      recStop();
    } else if (VO.state === 'idle' && pressed) {
      VO.abort = true;
    }
    pressed = false;
    const c = composerEl(); if (c) c.classList.remove('rec-canceling');
  });
  window.addEventListener('pointercancel', () => {
    if (VO.state === 'recording') { VO.cancel = true; recStop(); }
    pressed = false;
    const c = composerEl(); if (c) c.classList.remove('rec-canceling');
  });
}
recInit();

  $('composer-sticker').onclick = () => { setEmojiPanelTab('sticker'); toggleEmojiPop(); };
function cancelReply() {
  const bar = $('reply-bar');
  if (!bar) return;
  if (bar.classList.contains('hidden')) { state.replyTo = null; return; }
  bar.classList.add('closing');
  setTimeout(() => { bar.classList.remove('closing'); setReply(null); }, 170);
}
function setReply(m) {
  state.replyTo = m;
  const bar = $('reply-bar'); if (!bar) return;
  bar.classList.remove('closing');
  bar.innerHTML = '';
  if (!m) { bar.classList.add('hidden'); return; }
  const sender = msgSenderName(m);
  const label = previewText(m) || 'پیام';
  const s = document.createElement('div'); s.className = 'rp-ico'; s.innerHTML = ic('reply');
  const b = document.createElement('div'); b.className = 'rp-body';
  const nm = document.createElement('div'); nm.className = 'rp-name'; nm.textContent = sender;
  const tx = document.createElement('div'); tx.className = 'rp-txt'; tx.textContent = label;
  b.appendChild(nm); b.appendChild(tx);
  const x = document.createElement('button'); x.type = 'button'; x.className = 'rp-x icon-btn';
  x.title = 'لغو پاسخ'; x.setAttribute('aria-label', 'لغو پاسخ'); x.innerHTML = ic('x');
  x.onclick = (ev) => { ev.stopPropagation(); cancelReply(); };
  bar.appendChild(s); bar.appendChild(b); bar.appendChild(x);
  bar.classList.remove('hidden');
  applyIcons(bar);
  const inp = $('composer-input'); if (inp) inp.focus();
}
$('messages').addEventListener('click', (e) => { const a = e.target.closest('.msg-action'); if (a) { /* handled inline */ } });
/* Mobile: تپ روی پیام → باز کردن منوی پیام (بخش‌های تعاملی/چندرسانه‌ای رفتار خودشان را دارند) */
let _tapPtr = null;
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#messages .msg')) _tapPtr = { x: e.clientX, y: e.clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('pointercancel', () => { _tapPtr = null; }, { passive: true });
/* نگه‌داشتن انگشت روی عکس در چت ⇒ منوی پیام (پاسخ/فوروارد/ویرایش/دانلود) */
let _imgLp = null;
$('messages').addEventListener('pointerdown', (e) => {
  const tg = e.target.closest('img');
  if (!tg || tg.classList.contains('sticker')) return;
  const msgEl = e.target.closest('.msg');
  if (!msgEl || !msgEl.dataset.id) return;
  const m = (state.rooms[state.room] || {}).messages.find((x) => x.id === msgEl.dataset.id);
  if (!m) return;
  const startX = e.clientX, startY = e.clientY;
  _imgLp = { m: m, msgEl: msgEl, done: false };
  const timer = setTimeout(() => {
    if (!_imgLp) return;
    _imgLp.done = true;
    _imgLp = null;
    window.__vxImgLp = true;
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
    openMsgCtx(m, msgEl.querySelector('.bubble') || msgEl, { x: startX, y: startY });
  }, 420);
  const cancel = () => { clearTimeout(timer); if (_imgLp && _imgLp.m === m) _imgLp = null; };
  const mv = (ev) => {
    if (!_imgLp) return;
    if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) { cancel(); document.removeEventListener('pointermove', mv); }
  };
  document.addEventListener('pointermove', mv, { passive: true });
  document.addEventListener('pointerup', function up() { cancel(); document.removeEventListener('pointerup', up); }, { once: true });
  document.addEventListener('pointercancel', function pc() { cancel(); document.removeEventListener('pointercancel', pc); }, { once: true });
}, { passive: true });
/* اگر نگه‌داشتن انگشت منو را باز کرد، کلیک بعدی روی عکس نباید نمایش‌گر را باز کند */
document.addEventListener('click', (e) => {
  if (window.__vxImgLp) { window.__vxImgLp = false; e.preventDefault(); e.stopPropagation(); }
}, true);
$('messages').addEventListener('click', (e) => {
  if (!isMobile() || _selectMode) return;
  if (e.target.closest('a, button, input, textarea, select, .reac, .reply-ref, .msg-actions, .emoji-pop, .react-pop, .msg-ctx, .msg-sheet, .ctx-scrim, video, audio')) return;
  const tg = e.target.closest('img');
  if (tg && !tg.classList.contains('sticker')) return;
  const msgEl = e.target.closest('.msg');
  if (!msgEl || !msgEl.dataset.id) return;
  const m = (state.rooms[state.room] || {}).messages.find((x) => x.id === msgEl.dataset.id);
  if (!m) return;
  const fxUntil = Number(window.__emojiFxSuppressCtxUntil || 0);
  if (fxUntil && Date.now() < fxUntil && window.VXEmojiFx && window.VXEmojiFx.isSingleEmojiMessage(m)) return;
  const tp = _tapPtr; _tapPtr = null;
  if (tp && (Date.now() - tp.t) < 850 && (Math.abs(e.clientX - tp.x) > 10 || Math.abs(e.clientY - tp.y) > 10)) return;
  e.preventDefault(); e.stopPropagation();
  openMsgCtx(m, msgEl.querySelector('.bubble') || msgEl, { x: e.clientX, y: e.clientY });
});
document.addEventListener('touchstart', lpStart, { passive: true });
document.addEventListener('touchmove', lpMove, { passive: false });
document.addEventListener('touchend', lpEnd, { passive: true });
document.addEventListener('touchcancel', lpEnd, { passive: true });
const _reactSeq = new Map();
function closeReactionPicker() { const p = document.querySelector('.react-pop'); if (p) { if (p._esc) document.removeEventListener('keydown', p._esc); p.remove(); } }
function openReactionPicker(m, anchor) {
  closeReactionPicker();
  const pop = document.createElement('div');
  pop.className = 'react-pop';
  pop.setAttribute('role', 'toolbar');
  pop.setAttribute('aria-label', 'Reactions');
  const rs = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {};
  let mine = '';
  for (const ek in rs) { if ((Array.isArray(rs[ek]) ? rs[ek] : []).includes((state.me || {}).username)) { mine = ek; break; } }
  REACTIONS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rp-btn' + (em === mine ? ' me' : '');
    b.textContent = em;
    const label = REACTION_LABELS[em] || em;
    b.setAttribute('aria-label', 'React with ' + label);
    b.setAttribute('title', label);
    b.onclick = (e) => { e.stopPropagation(); toggleReaction(m.id, em, m.roomId || state.room, m); closeReactionPicker(); };
    pop.appendChild(b);
  });
  pop._esc = (e) => { if (e.key === 'Escape') closeReactionPicker(); };
  document.addEventListener('keydown', pop._esc);
  document.body.appendChild(pop);
  if (isMobile()) {
    pop.classList.add('mobile');
  } else if (anchor) {
    const r = anchor.getBoundingClientRect();
    const mw = pop.offsetWidth || 260, mh = pop.offsetHeight || 46;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    pop.style.top = Math.max(8, top) + 'px';
  }
  setTimeout(() => { const f = pop.querySelector('.rp-btn'); if (f) f.focus(); }, 30);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!pop.contains(e.target)) { document.removeEventListener('click', h); closeReactionPicker(); } }), 50);
}
function applyReactionLocalMap(oldMap, emoji, me) {
  const map = {};
  for (const [ek, arr] of Object.entries(oldMap || {})) {
    const cleaned = (Array.isArray(arr) ? arr : []).filter((x) => x !== me);
    if (cleaned.length) map[ek] = cleaned;
  }
  let prev = null;
  for (const [ek, arr] of Object.entries(oldMap || {})) {
    if ((Array.isArray(arr) ? arr : []).includes(me)) { prev = ek; break; }
  }
  if (prev !== emoji) map[emoji] = [...(map[emoji] || []), me];
  return map;
}
// آیا واکنش «افزوده» می‌شود یا «برداشته»؟
function reactionWillAdd(id, roomId, emoji, me) {
  const arrRoom = state.rooms[roomId];
  const t = (arrRoom ? arrRoom.messages.find((x) => x.id === id) : null) || { reactions: {} };
  const oldMap = (t.reactions && typeof t.reactions === 'object' && !Array.isArray(t.reactions)) ? t.reactions : {};
  const users = (Array.isArray(oldMap[emoji]) ? oldMap[emoji] : oldMap[emoji] ? [oldMap[emoji]] : []);
  return !users.includes(me);
}
async function toggleReaction(id, em, rid, m) {
  const roomId = rid || (m && m.roomId) || state.room;
  const target = m || ((state.rooms[roomId] || {}).messages || []).find((x) => x.id === id) || { id, roomId };
  const me = (state.me || {}).username;
  const oldMap = (target.reactions && typeof target.reactions === 'object' && !Array.isArray(target.reactions)) ? target.reactions : {};
  const seq = (_reactSeq.get(id) || 0) + 1;
  _reactSeq.set(id, seq);
  const optimistic = applyReactionLocalMap(oldMap, em, me);
  target.reactions = optimistic;
  syncMessageReactions(id, roomId, optimistic);
  // افکت فقط هنگام افزودن واکنش نمایش داده می‌شود؛ هنگام برداشتن نه
  if (reactionWillAdd(id, roomId, em, me)) reactionBurst(id, em);
  try {
    const resp = await api('/api/reactions', { method: 'POST', body: JSON.stringify({ msgId: id, emoji: em, roomId }) });
    const d = await resp.json().catch(() => ({}));
    if (seq !== _reactSeq.get(id)) return;
    if (d.reactions) {
      const stored = ((state.rooms[roomId] || {}).messages || []).find((x) => x.id === id);
      if (stored) stored.reactions = d.reactions;
      updateMessage({ id, roomId, message: { reactions: d.reactions } });
    } else if (resp.status >= 400) {
      throw new Error(d.error || 'react failed');
    }
  } catch (e) {
    if (seq !== _reactSeq.get(id)) return;
    target.reactions = oldMap;
    const stored = ((state.rooms[roomId] || {}).messages || []).find((x) => x.id === id);
    if (stored) stored.reactions = oldMap;
    updateMessage({ id, roomId, message: { reactions: oldMap } });
    toast('واکنش ثبت نشد');
  }
}
function syncMessageReactions(id, roomId, map) {
  const arr = state.rooms[roomId];
  if (arr) { const m2 = arr.messages.find((x) => x.id === id); if (m2) m2.reactions = map; }
  updateMessage({ id, roomId, message: { reactions: map } });
}
let _reactsSheetEl = null;
function closeReactionsSheet() {
  if (_reactsSheetEl) {
    if (_reactsSheetEl.esc) document.removeEventListener('keydown', _reactsSheetEl.esc);
    _reactsSheetEl.ov.remove(); _reactsSheetEl.sheet.remove();
    _reactsSheetEl = null;
  }
}
function showReactionsSheet(m, emoji) {
  if (!m || !emoji) return;
  closeReactionsSheet();
  const ov = document.createElement('div'); ov.className = 'reacts-overlay';
  const sheet = document.createElement('div'); sheet.className = 'reacts-sheet';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Reactions');
  sheet.innerHTML = '<div class="rs-head"><span class="rs-emoji">' + esc(emoji) + '</span><span class="rs-title">واکنش‌ها</span><button type="button" class="icon-btn" data-rs-close aria-label="بستن لیست واکنش‌ها">' + ic('x') + '</button></div><div class="rs-list"><div class="rs-empty">در حال بارگذاری…</div></div>';
  applyIcons(sheet);
  sheet.querySelector('[data-rs-close]').onclick = closeReactionsSheet;
  ov.onclick = closeReactionsSheet;
  const escFn = (e) => { if (e.key === 'Escape') closeReactionsSheet(); };
  document.addEventListener('keydown', escFn);
  document.body.appendChild(ov); document.body.appendChild(sheet);
  _reactsSheetEl = { ov, sheet, esc: escFn };
  const listEl = sheet.querySelector('.rs-list');
  const roomId = m.roomId || state.room;
  api('/api/reactions/' + encodeURIComponent(m.id) + '?roomId=' + encodeURIComponent(roomId))
    .then((r) => r.json())
    .then((d) => {
      const users = (d.reactions && d.reactions[emoji]) ? d.reactions[emoji] : [];
      if (!users.length) { listEl.innerHTML = '<div class="rs-empty">هنوز واکنشی نیست</div>'; return; }
      listEl.innerHTML = '';
      users.forEach((u) => {
        const row = document.createElement('div'); row.className = 'rs-user';
        const av = avatarEl({ displayName: u.displayName || u.username, avatar: u.avatar || null }, 'xs');
        row.innerHTML = '<div class="rs-av">' + av.outerHTML + '</div><div class="rs-name">' + esc(u.displayName || u.username) + '</div><div class="rs-un">@' + esc(u.username) + '</div>';
        listEl.appendChild(row);
      });
    })
    .catch(() => { listEl.innerHTML = '<div class="rs-empty">خطا در دریافت لیست</div>'; });
}
async function votePoll(id, opt, rid) { await api('/api/poll/vote', { method: 'POST', body: JSON.stringify({ msgId: id, option: opt, roomId: rid }) }); }
async function toggleCheck(id, idx, done, rid) { await api('/api/checklist/toggle', { method: 'POST', body: JSON.stringify({ msgId: id, index: idx, roomId: rid }) }); }
function updateMessage(d) {
  const prevFocusEl = document.activeElement;
  if (d.message && d.message.reactions && d.roomId) {
    const arr = state.rooms[d.roomId];
    if (arr) { const m2 = arr.messages.find((x) => x.id === d.id); if (m2) m2.reactions = d.message.reactions; }
  }
  const el = document.querySelector('[data-id="' + d.id + '"]');
  if (el && d.message && d.message.reactions && typeof d.message.reactions === 'object') {
    const old = el.querySelector(':scope > .reactions');
    const oldBadges = old ? Array.from(old.querySelectorAll('.reac')) : [];
    const oldKeys = oldBadges.map((x) => x.dataset.em);
    const r = reactionsEl({ id: d.id, roomId: d.roomId, reactions: d.message.reactions });
    const newKeys = Array.from(r.querySelectorAll('.reac')).map((x) => x.dataset.em);
    const now = Date.now();
    r.querySelectorAll('.reac').forEach((b) => {
      if (!oldKeys.includes(b.dataset.em)) {
        b.classList.add('new');
        if (now - (_burstAt.get(d.id + '|' + b.dataset.em) || 0) > 1500) reactionBurst(d.id, b.dataset.em);
      }
      const ob = oldBadges.find((x) => x.dataset.em === b.dataset.em);
      if (ob) {
        const oc = ob.querySelector('.reac-count'), nc = b.querySelector('.reac-count');
        if (oc && nc && oc.textContent !== nc.textContent) { b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 400); }
      }
    });
    if (newKeys.length === 0) {
      if (old) { oldBadges.forEach((b) => b.classList.add('leaving')); setTimeout(() => old.remove(), 160); }
    } else if (old) {
      oldBadges.forEach((b) => { if (!newKeys.includes(b.dataset.em)) { b.classList.add('leaving'); setTimeout(() => b.remove(), 160); } });
      old.replaceWith(r);
    } else {
      const bubble = el.querySelector('.bubble');
      if (bubble) bubble.after(r);
    }
  }
  if ((d.message && d.message.poll) || d.poll) {
    const p = (d.message && d.message.poll) || d.poll;
    const arr = d.roomId && state.rooms[d.roomId];
    if (arr) { const m2 = arr.messages.find((x) => x.id === d.id); if (m2) m2.poll = p; }
    const b = el && el.querySelector('.msg-body'); if (b) b.replaceChildren(pollEl({ id: d.id, roomId: d.roomId, poll: p }));
  }
  if ((d.message && d.message.checklist) || d.checklist) {
    const c = (d.message && d.message.checklist) || d.checklist;
    const arr = d.roomId && state.rooms[d.roomId];
    if (arr) { const m2 = arr.messages.find((x) => x.id === d.id); if (m2) m2.checklist = c; }
    const b = el && el.querySelector('.msg-body'); if (b) b.replaceChildren(checklistEl({ id: d.id, roomId: d.roomId, checklist: c }));
  }
  luc();
  if (prevFocusEl && document.body.contains(prevFocusEl)) prevFocusEl.focus();
}
let typingClearTimer = null;
function showTyping(d) {
  const sub = $('conv-sub');
  if (!sub || d.roomId !== state.room) return;
  clearTimeout(typingClearTimer);
  if (d.on) {
    sub.textContent = (d.username === BOT_USERNAME) ? 'در حال نوشتن…' : 'کاربر در حال نوشتن…';
    typingClearTimer = setTimeout(() => { const s2 = $('conv-sub'); if (s2 && s2.textContent && state.room === d.roomId) s2.textContent = roomOnline(state.room); }, 4000);
  } else {
    sub.textContent = roomOnline(state.room);
  }
}
/* ---------- «سین» فقط وقتی چت واقعاً دیده می‌شود ----------
   آنلاین بودن به‌تنهایی کافی نیست: اگر برنامه در پس‌زمینه باشد، یا صفحه
   پنهان باشد، یا گفت‌وگو روی موبایل باز نشده باشد، نباید سین بخورد.
   فقط وقتی پیام واقعاً روی صفحه است وضعیت خوانده‌شده اعلام می‌شود. */
function chatActuallyVisible(rid) {
  if (!rid || rid !== state.room) return false;
  if (document.visibilityState && document.visibilityState !== 'visible') return false;
  /* روی موبایل باید پنل گفت‌وگو واقعاً باز باشد */
  const conv = $('conversation');
  if (isMobile() && conv && !conv.classList.contains('chat-open')) return false;
  if ($('auth-screen') && !$('auth-screen').classList.contains('hidden')) return false;
  if (_pinScreenOpen && _pinScreenOpen()) return false;
  /* اگر یک لایهٔ تمام‌صفحه (نقشه/ادیتور/نمایش‌گر) روی گفت‌وگو باز است، کاربر
     در حال دیدن پیام‌ها نیست ⇒ سین نباید بخورد */
  if (vxFullOverlay && vxFullOverlay()) return false;
  return true;
}
function markRead(rid) {
  if (!chatActuallyVisible(rid)) return;
  if (!state.readState[rid]) state.readState[rid] = {};
  const now = Date.now();
  const prev = state.readState[rid][state.me.username] || 0;
  if (now - prev < 1500) return;                 /* جلوگیری از اسپم شدن پیام‌های read */
  state.readState[rid][state.me.username] = now;
  if (state.rooms[rid]) state.rooms[rid].unread = 0;
  scheduleChatListRefresh(120);
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'read', roomId: rid }));
}
/* وقتی کاربر به برنامه/تب برگشت و همان چت باز است، تازه سین می‌خورد */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.room) setTimeout(() => markRead(state.room), 350);
});


let _roomInfoRid = null;
function roomInfoCtx(rid) {
  const isG = !!rid && rid.startsWith('group:');
  const g = isG ? state.groups.find((x) => 'group:' + x.id === rid) : null;
  const isCh = isG && !!g && (g.type || 'group') === 'channel';
  const kindLbl = isCh ? 'کانال' : 'گروه';
  const other = isG ? null : rid.slice(3).split('|').find((p) => p !== state.me.username);
  const u = (!isG && other) ? state.users.find((x) => x.username === other) : null;
  return { isG, g, isCh, kindLbl, other, u };
}
function togRow(key, label, icon, flags) {
  return '<div class="dp-row">' + ic(icon) + '<span>' + label + '</span><label class="switch"><input type="checkbox" data-flag="' + key + '" ' + (flags[key] ? 'checked' : '') + '><span class="slider"></span></label></div>';
}
function roomInfoBodyHTML(rid) {
  const c = roomInfoCtx(rid);
  const flags = chatFlags(rid) || {};
  let h = '<div class="dp-head">';
  if (c.isG) h += avatarEl(c.g && c.g.avatar ? { avatar: c.g.avatar, displayName: roomTitle(rid) } : { displayName: roomTitle(rid) }, 'lg').outerHTML;
  else h += avatarEl(c.u || { displayName: roomTitle(rid) }, 'lg').outerHTML;
  h += '<div class="dp-name">' + esc(roomTitle(rid)) + '</div>';
  h += '<div class="dp-sub">' + esc(roomOnline(rid)) + '</div></div>';

  h += '<div class="dp-sec"><div class="dp-sec-title">' + ic('info') + ' اطلاعات</div>';
  if (c.isG) {
    const chLbl = c.isCh ? 'کانال' : 'گروه';
    let adm = '';
    if (c.g && c.g.owner === state.me.username) adm = ' · ادمین';
    else if (c.g && Array.isArray(c.g.members) && c.g.members.some((x) => x && (x.username === state.me.username || x === state.me.username))) adm = ' · عضو';
    h += '<div class="dp-row">' + ic(c.isCh ? 'megaphone' : 'users') + '<span>نوع</span><b style="margin-inline-start:auto">' + chLbl + adm + '</b></div>';
    h += '<div class="dp-row">' + ic('users') + '<span>' + (c.isCh ? 'دنبالکنندهها' : 'اعضا') + '</span><b style="margin-inline-start:auto">' + (c.g ? c.g.members.length + ' نفر' : '—') + '</b></div>';
    if (c.g && c.g.username) h += '<div class="dp-row">' + ic('hash') + '<span>شناسه</span><b style="margin-inline-start:auto">@' + esc(c.g.username) + '</b></div>';
    if (c.g && c.g.description) h += '<div class="dp-row" style="align-items:flex-start">' + ic('info') + '<span style="white-space:normal">' + esc(c.g.description) + '</span></div>';
  } else if (c.other) {
    h += '<div class="dp-row">' + ic('hash') + '<span>نام کاربری</span><b style="margin-inline-start:auto">@' + esc(c.other) + '</b></div>';
    if (c.u) {
      const onl = !!c.u.online;
      const badge = (c.u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + (c.u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (c.u.banned ? ' <span class="badge ban">مسدود</span>' : '');
      h += '<div class="dp-row">' + ic('wifi') + '<span>وضعیت</span><b style="margin-inline-start:auto">' + (onl ? 'آنلاین' : 'آفلاین') + '</b></div>';
      if (c.u.bio) h += '<div class="dp-row" style="align-items:flex-start">' + ic('info') + '<span style="white-space:normal">' + esc(c.u.bio) + '</span></div>';
      if (c.u.phone && (state.me.isAdmin || c.u.username === state.me.username)) h += '<div class="dp-row">' + ic('phone') + '<span>شماره</span><b style="margin-inline-start:auto" dir="ltr">' + esc(c.u.phone) + '</b></div>';
      if (badge) h += '<div class="dp-row">' + ic('star') + '<span>نشانها</span><span style="margin-inline-start:auto">' + badge + '</span></div>';
    } else {
      h += '<div class="dp-row">' + ic('user') + '<span>' + (c.other === BOT_USERNAME ? BOT_NAME : 'کاربر') + '</span></div>';
    }
  } else {
    h += '<div class="dp-row">' + ic('message-square') + '<span>گفتگو</span></div>';
  }
  h += '</div>';

  h += '<div class="dp-sec"><div class="dp-sec-title">' + ic('settings') + ' تنظیمات چت</div>';
  h += togRow('pinned', 'پین کردن چت', 'pin', flags);
  h += togRow('muted', 'بیصدا', 'volume-x', flags);
  h += togRow('hidden', 'مخفی کردن', 'eye-off', flags);
  h += togRow('locked', 'قفل چت', 'lock', flags);
  h += '</div>';

  const pins = (state.pinned[rid] || []);
  if (pins.length) {
    h += '<div class="dp-sec"><div class="dp-sec-title">' + ic('pin') + ' پیامهای پینشده</div>';
    pins.forEach((id) => {
      const msg = (state.rooms[rid] || {}).messages.find((x) => x.id === id);
      if (!msg) return;
      h += '<div class="dp-pin" data-pin="' + esc(id) + '">' + esc(previewText(msg)) + '</div>';
    });
    h += '</div>';
  }

  h += '<div class="dp-sec"><div class="dp-sec-title">' + ic('zap') + ' عملیات</div>';
  if (!c.isG) {
    if (c.other && c.other !== BOT_USERNAME) {
      h += '<div class="dp-act" data-act="profile">' + ic('user') + '<span>مشاهده پروفایل کامل</span></div>';
      const isBlocked = state.me.blocked && state.me.blocked.includes(c.other);
      h += '<div class="dp-act" data-act="block">' + ic(isBlocked ? 'user-check' : 'user-x') + '<span>' + (isBlocked ? 'آنبلاک کردن' : 'مسدود کردن') + '</span></div>';
    }
    h += '<div class="dp-act" data-act="start-chat">' + ic('message-square') + '<span>شروع چت جدید</span></div>';
    h += '<div class="dp-act danger" data-act="delete">' + ic('trash-2') + '<span>پاک کردن چت</span></div>';
  } else if (c.g) {
    if (c.g.owner === state.me.username) h += '<div class="dp-act" data-act="manage">' + ic('settings') + '<span>مدیریت ' + c.kindLbl + '</span></div>';
    h += '<div class="dp-act" data-act="invite">' + ic('link') + '<span>لینک دعوت</span></div>';
    h += '<div class="dp-act danger" data-act="clear">' + ic('trash-2') + '<span>پاک کردن تاریخچه</span></div>';
  }
  h += '</div>';
  return h;
}
function roomInfoWire(rid, root) {
  root.querySelectorAll('input[data-flag]').forEach((inp) => {
    inp.onchange = () => { setFlag(rid, inp.dataset.flag, inp.checked); toast('اعمال شد'); };
  });
  root.querySelectorAll('.dp-pin[data-pin]').forEach((el) => {
    el.onclick = () => {
      closeRoomInfo();
      const msgEl = document.querySelector('[data-id="' + el.dataset.pin + '"]');
      if (msgEl) { msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
  });
  const openProfileF = root.querySelector('[data-act="profile"]');
  if (openProfileF) openProfileF.onclick = () => { closeRoomInfo(); const other = rid.startsWith('dm:') ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null; if (other) openProfile(other, rid); };
  const startChat = root.querySelector('[data-act="start-chat"]');
  if (startChat) startChat.onclick = () => { closeRoomInfo(); openDM(rid.startsWith('dm:') ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null); };
  const block = root.querySelector('[data-act="block"]');
  if (block) block.onclick = () => { const other = rid.startsWith('dm:') ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null; toggleBlock(other).then(() => { if (_roomInfoOpen()) refreshRoomInfo(); }); };
  const del = root.querySelector('[data-act="delete"]');
  if (del) del.onclick = () => { closeRoomInfo(false); deleteChat(rid); };
  const mg = root.querySelector('[data-act="manage"]');
  if (mg) mg.onclick = () => { const ctx = roomInfoCtx(rid); if (ctx.g) { closeRoomInfo(); manageGroup(ctx.g); } };
  const inv = root.querySelector('[data-act="invite"]');
  if (inv) inv.onclick = () => {
    const ctx = roomInfoCtx(rid);
    if (!ctx.g) return;
    api('/api/groups/' + ctx.g.id + '/invite').then((r) => r.json()).then((d) => {
      if (!d.ok) { toast(d.error || 'خطا در دریافت لینک'); return; }
      const link = location.origin + d.link;
      navigator.clipboard.writeText(link).then(() => toast('لینک دعوت کپی شد')).catch(() => {});
      uConfirm('لینک دعوت:\n' + link + '\n\nکپی شود؟').then((ok) => { if (ok) navigator.clipboard.writeText(link).catch(() => {}); });
    }).catch(() => toast('خطا در دریافت لینک'));
  };
  const clr = root.querySelector('[data-act="clear"]');
  if (clr) clr.onclick = async () => { if (await uConfirm('تاریخچه پاک شود؟')) { $('messages').innerHTML = ''; state.lastDay = null; toast('تاریخچه پاک شد'); } };
  luc();
}
function closeRoomInfo(returnBack) {
  const bd = document.querySelector('.ri-backdrop'); if (bd) bd.remove();
  if (viewHost && !viewHost.classList.contains('hidden') && viewHost.querySelector('.roominfo-view')) {
    if (returnBack === false) {
      state.profileReturnRoom = null; state.profileReturnNav = null;
      viewHost.innerHTML = '';
      setMode('chats');
    } else {
      profileGoBack();
    }
  }
}
function _roomInfoOpen() { return !!document.querySelector('.ri-backdrop') || (viewHost && !viewHost.classList.contains('hidden') && viewHost.querySelector('.roominfo-view')); }
function refreshRoomInfo() { if (_roomInfoOpen() && _roomInfoRid) { if (document.querySelector('.ri-backdrop')) renderRoomInfoModal(_roomInfoRid, true); else renderRoomInfoPage(_roomInfoRid, true); } }
function openRoomInfo(rid) {
  if (!rid) return;
  _roomInfoRid = rid;
  if (isMobile()) renderRoomInfoPage(rid); else renderRoomInfoModal(rid);
  vxPush({ vx: 1, nav: state.nav || 'chats', room: state.room || null, view: null, overlay: 1 });
}
function renderRoomInfoModal(rid, silent) {
  _roomInfoRid = rid;
  const old = document.querySelector('.ri-backdrop'); if (old) old.remove();
  const bd = document.createElement('div'); bd.className = 'ri-backdrop';
  const card = document.createElement('div'); card.className = 'ri-card';
  const x = document.createElement('button'); x.className = 'ri-close'; x.setAttribute('aria-label', 'بستن'); x.innerHTML = ic('x');
  x.onclick = () => bd.remove();
  card.appendChild(x);
  const body = document.createElement('div'); body.className = 'ri-body'; body.innerHTML = roomInfoBodyHTML(rid);
  card.appendChild(body);
  bd.appendChild(card);
  bd.onclick = (e) => { if (e.target === bd) bd.remove(); };
  document.body.appendChild(bd);
  roomInfoWire(rid, body);
  return bd;
}
function renderRoomInfoPage(rid, silent) {
  _roomInfoRid = rid;
  state.profileReturnRoom = rid;
  state.profileReturnNav = 'chats';
  setMode('view');
  viewHost.classList.remove('hidden');
  viewHost.innerHTML = '<div class="roominfo-view"><div class="roominfo-head"><button class="btn sm ghost" data-act="back">' + ic('chevron-right') + ' بازگشت</button></div><div class="roominfo-body"></div></div>';
  const body = viewHost.querySelector('.roominfo-body');
  body.innerHTML = roomInfoBodyHTML(rid);
  viewHost.querySelector('[data-act="back"]').onclick = () => profileGoBack();
  roomInfoWire(rid, body);
}
async function toggleBlock(other) {
  if (!other) return;
  const isBlocked = state.me.blocked && state.me.blocked.includes(other);
  if (isBlocked) {
    const res = await api('/api/unblock', { method: 'POST', body: JSON.stringify({ username: other }) });
    const d = await res.json();
    if (d.ok) { state.me.blocked = d.blocked; toast('کاربر آنبلاک شد'); buildChatList(); }
    else toast(d.error || 'خطا در آنبلاک');
  } else {
    if (!(await uConfirm('آیا می‌خواهید این کاربر را مسدود کنید؟'))) return;
    const res = await api('/api/block', { method: 'POST', body: JSON.stringify({ username: other }) });
    const d = await res.json();
    if (d.ok) { state.me.blocked = d.blocked; toast('کاربر مسدود شد'); buildChatList(); }
    else toast(d.error || 'خطا در مسدودسازی');
  }
}
async function deleteChat(rid) {
  if (!rid) return;
  const isDm = rid.startsWith('dm:');
  const other = isDm ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null;
  const isGroup = rid.startsWith('group:');
  const opts = [
    { key: 'del', label: 'حذف کامل چت (تاریخچه پاک شود)', checked: true },
  ];
  if (isDm && other && other !== BOT_USERNAME) {
    const isBlocked = state.me.blocked && state.me.blocked.includes(other);
    opts.push({ key: 'block', label: isBlocked ? 'همچنین آنبلاک کن' : 'همچنین مسدود کن', checked: false });
  }
  if (isGroup) {
    opts.push({ key: 'leave', label: 'همچنین از گروه خارج شوم', checked: false });
  }
  const choices = await uConfirmCb(isGroup ? 'حذف گروه؟' : 'حذف چت؟', opts);
  if (!choices) return;
  if (choices.del) {
    if (isDm) {
      try {
        const res = await api('/api/chats/delete', { method: 'POST', body: JSON.stringify({ roomId: rid }) });
        const d = await res.json();
        if (d.ok) { toast('چت پاک شد'); if (state.room === rid) { state.room = null; buildChatList(); setMode('chats'); } else buildChatList(); }
        else toast(d.error || 'خطا در پاک‌کردن چت');
      } catch (e) { toast('خطا در پاک‌کردن چت'); }
    } else if (isGroup) {
      const gid = rid.slice(6);
      try {
        const res = await api('/api/groups/' + gid + '/leave', { method: 'POST' });
        const d = await res.json();
        if (d.ok) { toast('از گروه خارج شدید'); state.room = null; buildChatList(); setMode('chats'); }
        else toast(d.error || 'خطا در خروج از گروه');
      } catch (e) { toast('خطا در خروج از گروه'); }
    }
  }
  if (choices.block && isDm && other) {
    const res = await api('/api/block', { method: 'POST', body: JSON.stringify({ username: other }) });
    const d = await res.json();
    if (d.ok) { state.me.blocked = d.blocked; toast('کاربر مسدود شد'); buildChatList(); }
  }
  if (choices.leave && isGroup && !choices.del) {
    const gid = rid.slice(6);
    try {
      const res = await api('/api/groups/' + gid + '/leave', { method: 'POST' });
      const d = await res.json();
      if (d.ok) { toast('از گروه خارج شدید'); state.room = null; buildChatList(); setMode('chats'); }
      else toast(d.error || 'خطا در خروج از گروه');
    } catch (e) { toast('خطا در خروج از گروه'); }
  }
}
function setFlag(rid, key, val) { if (!state.chatState[rid]) state.chatState[rid] = {}; state.chatState[rid][key] = val; api('/api/chats/state', { method: 'POST', body: JSON.stringify({ roomId: rid, key: key, value: val }) }); buildChatList(); }

/* CHAT CONTEXT MENU */
function closeCtxMenus() { document.querySelectorAll('.ctx-menu, .msg-sheet, .sheet-scrim, .msg-ctx, .ctx-scrim').forEach((m) => m.remove()); }
function openChatMenu(e, rid) {
  closeCtxMenus();
  const pop = document.createElement('div'); pop.className = 'ctx-menu'; pop.style.left = e.clientX + 'px'; pop.style.top = e.clientY + 'px';
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'ctx-item'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = () => { fn(); pop.remove(); }; pop.appendChild(r); };
  mk('باز کردن', 'message-square', () => openRoom(rid));   mk('پین', 'pin', () => setFlag(rid, 'pinned', !chatFlags(rid).pinned)); mk('بی‌صدا', 'volume-x', () => setFlag(rid, 'muted', true)); mk('مخفی', 'eye-off', () => setFlag(rid, 'hidden', true)); mk('آرشیو', 'archive', () => setFlag(rid, 'archived', !chatFlags(rid).archived));
  if (rid.startsWith('dm:')) {
    const other = rid.slice(3).split('|').find((p) => p !== state.me.username);
    if (other && other !== BOT_USERNAME) {
      const isBlocked = state.me.blocked && state.me.blocked.includes(other);
      mk(isBlocked ? 'آنبلاک کردن' : 'مسدود کردن', isBlocked ? 'user-check' : 'user-x', () => toggleBlock(other));
    }
  }
  mk('پاک کردن چت', 'trash-2', () => deleteChat(rid));
  document.body.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
}
/* ===================== MESSAGE CONTEXT MENU ===================== */
let _ctxEl = null, _ctxMsg = null, _ctxMsgEl = null;
function closeMsgCtx() {
  if (_ctxEl) { _ctxEl.remove(); _ctxEl = null; }
  if (_ctxMsgEl && _ctxMsgEl.classList) _ctxMsgEl.classList.remove('menu-open-target');
  _ctxMsgEl = null;
  _ctxMsg = null;
  var sc = document.querySelector('.ctx-scrim'); if (sc) sc.remove();
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('کپی شد')).catch(() => fallbackCopy(t));
  } else fallbackCopy(t);
}
function fallbackCopy(t) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) toast('کپی شد'); else toast('کپی ممکن نشد');
  } catch (e) { toast('کپی ممکن نشد'); }
}
async function reportMsg(m) {
  try {
    const r = await api('/api/report', { method: 'POST', body: JSON.stringify({ roomId: state.room, msgId: m.id }) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) toast('گزارش ارسال شد');
    else toast(d.error || 'گزارش ثبت نشد');
  } catch (e) { toast('ارسال گزارش ممکن نشد'); }
}
function openMsgCtx(m, anchor, pos) {
  closeMsgCtx();
  closeCtxMenus();
  _ctxMsg = m;
  _ctxMsgEl = (anchor && anchor.nodeType) ? anchor.closest('.msg') || anchor : null;
  if (_ctxMsgEl && _ctxMsgEl.classList) _ctxMsgEl.classList.add('menu-open-target');
  var isM = isMobile();
  var el = document.createElement('div');
  el.className = 'msg-ctx' + (isM ? ' mobile' : '');
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'عملیات پیام');
  el.setAttribute('tabindex', '-1');

  var reacBar = document.createElement('div'); reacBar.className = 'ctx-reactions';
  reacBar.setAttribute('role', 'toolbar'); reacBar.setAttribute('aria-label', 'واکنش‌های سریع');
  var reacHead = document.createElement('div'); reacHead.className = 'ctx-title'; reacHead.textContent = 'واکنش‌ها';
  el.appendChild(reacHead);
  var rs = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {};
  var myReac = '';
  for (var ek in rs) { var us = Array.isArray(rs[ek]) ? rs[ek] : []; if (us.includes(state.me.username)) { myReac = ek; break; } }
  REACTIONS.forEach(function(em) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'ctx-reac' + (em === myReac ? ' active' : '');
    b.textContent = em;
    b.setAttribute('aria-label', 'واکنش با ' + (REACTION_LABELS[em] || em));
    b.setAttribute('title', (em === myReac ? 'حذف واکنش ' : 'واکنش ') + (REACTION_LABELS[em] || em));
    b.addEventListener('pointerdown', function() { b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap'); });
    b.addEventListener('animationend', function() { b.classList.remove('tap'); });
    b.onclick = function(ev) { ev.stopPropagation(); toggleReaction(m.id, em, state.room, m); closeMsgCtx(); };
    reacBar.appendChild(b);
  });
  el.appendChild(reacBar);

  var sep = document.createElement('div'); sep.className = 'ctx-sep'; el.appendChild(sep);

  var acts = document.createElement('div'); acts.className = 'ctx-actions';
  var mk = function(label, icon, fn, show) {
    if (show === false) return;
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'ctx-item'; b.setAttribute('role', 'menuitem');
    b.innerHTML = ic(icon) + '<span>' + label + '</span>';
    b.onclick = function(ev) { ev.stopPropagation(); closeMsgCtx(); fn(); };
    acts.appendChild(b);
  };
  mk('پاسخ', 'reply', function() { setReply(m); });
  mk('پین', 'pin', function() {
    api('/api/pin', { method: 'POST', body: JSON.stringify({ roomId: state.room, msgId: m.id }) }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) toast(d.error);
      else if (d.ids && d.ids.length) toast('پیام سنجاق شد');
      else toast('سنجاق برداشته شد');
    }).catch(function() {});
  });
  mk('رونوشت', 'clipboard', function() { copyText(m.content || ''); });
  mk('فوروارد', 'forward', function() { openForward(m.id); });
  /* ── فاز ۳: ذخیره (نشانک) — همیشه در دسترس و خصوصیِ کاربر ── */
  var bmKey = (m.roomId || state.room) + '|' + m.id;
  mk(BOOKMARK_IDLE.has(bmKey) ? 'حذف از ذخیره‌شده‌ها' : 'ذخیرهٔ پیام', 'bookmark', function() { aiBookmarkToggle(m); });
  /* ── فاز ۳: ترجمهٔ زنده و تبدیل صدا به متن ──
     حباب باید همین‌جا گرفته شود، چون هنگام اجرای هندلر closeMsgCtx() اجرا
     شده و _ctxMsgEl دیگر null است. */
  var ctxBubble = _ctxMsgEl ? (_ctxMsgEl.querySelector('.bubble') || _ctxMsgEl) : null;
  if (m.kind === 'text' && AI_CAP.enabled) {
    mk('ترجمهٔ ماشینی', 'languages', function() { aiTranslateMessage(m, ctxBubble); });
  }
  if (m.kind === 'voice' && AI_CAP.whisper) {
    mk('تبدیل به متن', 'mic', function() { aiTranscribeMessage(m, ctxBubble); });
  }
  /* عکس‌ها: دانلود و نقاشی/ویرایش با همان ادیتور */
  if (m.kind === 'image' && (m.src || m.url)) {
    mk('دانلود عکس', 'download', function() { downloadMedia(m.src || m.url, (m.name || 'image.jpg')); });
    mk('ویرایش و نقاشی', 'paintbrush', function() { editReceivedImage(m.src || m.url, m.name || 'image.jpg'); });
  }
  if (m.kind === 'video') {
    mk('تبدیل به GIF', 'image', function() { openGifConverter(m.src || m.url || ''); }, !!m.src || !!m.url);
    mk('ویرایش ویدیو', 'edit-3', function() { openVideoEditor(m.src || m.url || ''); }, !!m.src || !!m.url);
  }
  /* گیرنده هم بتواند GIF فرستاده‌شده را در «GIFهای من» خودش ذخیره کند و بعداً بفرستد */
  if (m.kind === 'gif' && (m.src || m.url)) {
    mk('ذخیره در GIFهای من', 'bookmark', function() { saveReceivedGif(m.src || m.url); }, true);
  }
  /* موقعیت مکانی: باز کردن در نشان/گوگل‌مپ و شروع مسیریابی */
  if (m.kind === 'location' && m.geo && window.VXMapOpenApps) {
    const g = m.geo;
    mk('باز کردن در نقشه', 'map-pin', function() { window.VXMapOpenApps(g.lat, g.lon, g.label || ''); }, true);
    mk('شروع مسیریابی', 'navigation', function() { window.VXMapOpenApps(g.lat, g.lon, g.label || ''); }, true);
    mk('رونوشت مختصات', 'clipboard', function() { copyText(g.lat + ', ' + g.lon); }, true);
  }
  if (m.from === state.me.username) mk('ویرایش', 'edit-3', function() { uPrompt('ویرایش پیام', m.content, 'متن جدید پیام').then(function(t) { if (t && state.ws) state.ws.send(JSON.stringify({ type: 'edit-message', roomId: state.room, id: m.id, content: t })); }); });
  if (m.from === state.me.username || (state.me && state.me.isAdmin)) mk('حذف', 'trash-2', function() { askDeleteScope().then(function(d) { if (d) sendDeleteMsg(m.id, d.forEveryone); }); });
  mk('گزارش', 'shield', function() { reportMsg(m); });
  mk('انتخاب', 'check-square', function() { toggleSelectMsg(m.id); });
  el.appendChild(acts);

  el._anchor = (anchor && anchor.nodeType) ? anchor : null;
  document.body.appendChild(el);
  positionMsgCtx(el, el._anchor, pos);
  applyIcons(el);
  _ctxEl = el;
  setTimeout(function() { var f = el.querySelector('.ctx-reac, .ctx-item'); if (f) f.focus(); }, 30);
}
function positionMsgCtx(el, anchorEl, pt) {
  var pad = 8, vw = window.innerWidth, vh = window.innerHeight;
  el.style.maxWidth = Math.max(180, vw - pad * 2) + 'px';
  el.style.maxHeight = (vh - pad * 2) + 'px';
  var mw = el.offsetWidth || 210, mh = el.offsetHeight || 320;
  var top, left;
  if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
    /* میان لمس قرار می‌گیرد: ترجیحاً بالای انگشت، در صورت نبود جا پایین آن */
    var gap = 6;
    top = (pt.y - mh - gap >= pad) ? pt.y - mh - gap : Math.max(pad, pt.y + gap);
    top = Math.min(top, vh - mh - pad);
    left = Math.max(pad, Math.min(pt.x - Math.round(mw / 2), vw - mw - pad));
  } else {
    var r = anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect() : null;
    if (!r || (r.width === 0 && r.height === 0)) {
      top = Math.max(pad, vh - mh - pad); left = pad;
    } else {
      top = r.bottom + pad;                       /* باز شدن زیر پیام ترجیح داده می‌شود */
      if (top + mh + pad > vh) top = r.top - mh - pad; /* اگر جا نبود، بالای پیام */
      top = Math.max(pad, Math.min(top, vh - mh - pad));
      left = Math.max(pad, Math.min(r.left, vw - mw - pad));
      if (r.left < pad || r.right > vw - pad) {       /* نزدیک لبه → به سمت داخل جابه‌جا شو */
        var innerRight = vw - pad - mw;
        var innerLeft = pad;
        if (r.right - mw - pad >= innerLeft) left = Math.min(r.right - mw - pad, innerRight);
        else left = innerLeft;
      }
    }
  }
  el.style.top = top + 'px'; el.style.left = left + 'px';
}
function bindCtxReposition() {
  const msgs = $('messages');
  if (msgs) msgs.addEventListener('scroll', () => { if (_ctxEl && _ctxEl.classList.contains('msg-ctx') && _ctxEl._anchor) requestAnimationFrame(() => { if (_ctxEl && _ctxEl._anchor && _ctxEl._anchor.isConnected) positionMsgCtx(_ctxEl, _ctxEl._anchor); }); }, { passive: true });
  window.addEventListener('resize', () => { if (_ctxEl && _ctxEl.classList.contains('msg-ctx') && _ctxEl._anchor && _ctxEl._anchor.isConnected) positionMsgCtx(_ctxEl, _ctxEl._anchor); });
}
function swallowNextClick(ms) {
  const until = Date.now() + (ms || 300);
  const h = (e) => {
    window.removeEventListener('click', h, true);
    if (Date.now() < until) { e.stopPropagation(); e.preventDefault(); }
  };
  window.addEventListener('click', h, true);
}
/* ===================== MULTI-SELECT ===================== */
var _selectMode = false, _selectedMsgs = new Set(), _dragSel = null, _touchDrag = null, _dragSelFrame = null;
var _selAutoY = null, _selAutoRAF = null, _selBandTop = 0, _selBandBottom = 0;

function selectedMsgsSorted() {
  const room = state.rooms[state.room] || { messages: [] };
  return room.messages.filter((m) => _selectedMsgs.has(m.id)).slice().sort((a, b) => (a.time || 0) - (b.time || 0));
}
function allSelectedDeletable() {
  if (!_selectedMsgs.size) return false;
  const msgs = (state.rooms[state.room] || { messages: [] }).messages.filter((m) => _selectedMsgs.has(m.id));
  return msgs.length > 0 && msgs.every((m) => m.from === state.me.username || (state.me && state.me.isAdmin));
}
function enterSelectMode(ids) {
  _selectMode = true;
  (ids || []).forEach((id) => _selectedMsgs.add(id));
  renderSelectState();
  renderSelectBar();
  const sb = $('conv-searchbox'); if (sb && !sb.classList.contains('hidden')) sb.classList.add('hidden');
}
function toggleSelectMsg(id) {
  if (!_selectMode) { enterSelectMode([id]); return; }
  if (_selectedMsgs.has(id)) _selectedMsgs.delete(id); else _selectedMsgs.add(id);
  renderSelectState();
  if (_selectedMsgs.size === 0) exitSelectMode();
  else renderSelectBar();
}
function renderSelectState() {
  document.querySelectorAll('#messages .msg[data-id]').forEach((el) => {
    el.classList.toggle('msg-selected', _selectedMsgs.has(el.dataset.id));
  });
}
function renderSelectBar() {
  const bar = $('sel-toolbar'); if (!bar) return;
  bar.classList.remove('hidden');
  const count = $('sel-count'); if (count) count.textContent = _selectedMsgs.size + ' پیام انتخاب شده';
  const del = $('sel-delete'); if (del) del.hidden = !allSelectedDeletable();
  const head = document.querySelector('.conv-head'); if (head) head.classList.add('sel-active');
}
function exitSelectMode() {
  _selectMode = false;
  _selectedMsgs.clear();
  _dragSel = null; _touchDrag = null; _dragSelFrame = null;
  stopSelAutoScroll();
  document.body.classList.remove('drag-sel');
  renderSelectState();
  const bar = $('sel-toolbar'); if (bar) bar.classList.add('hidden');
  const head = document.querySelector('.conv-head'); if (head) head.classList.remove('sel-active');
}
$('sel-close').onclick = (e) => { e.stopPropagation(); exitSelectMode(); };
$('sel-forward').onclick = (e) => {
  e.stopPropagation();
  if (!_selectedMsgs.size || !state.room) return;
  openForward(selectedMsgsSorted().map((m) => m.id));
};
$('sel-delete').onclick = async (e) => {
  e.stopPropagation();
  const ids = selectedMsgsSorted().map((m) => m.id);
  if (!ids.length) return;
  if (!(state.ws && state.ws.readyState === 1)) { toast('اتصال برقرار نیست'); return; }
  const scope = await askDeleteScope(ids.length + ' پیام حذف شود؟');
  if (!scope) return;
  ids.forEach((id) => sendDeleteMsg(id, scope.forEveryone));
  exitSelectMode();
};

/* tap-to-toggle in selection mode (capture: صدای کلیک داخل پیام قبل از handler بچه‌ها) */
$('messages').addEventListener('click', (e) => {
  if (!_selectMode) return;
  if (e.target.closest('#sel-toolbar, .msg-actions, .reac, .reply-ref, a, button, input, textarea, select, .ctx-menu, .msg-ctx, .msg-sheet, .ctx-scrim, .emoji-pop')) return;
  const msgEl = e.target.closest('.msg'); if (!msgEl || !msgEl.dataset.id) return;
  e.preventDefault(); e.stopPropagation();
  toggleSelectMsg(msgEl.dataset.id);
}, true);

/* drag-to-select (desktop: pointer events با آستانهٔ حرکت) */
function dragSelDown(e) {
  if (!_selectMode) return;
  if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  if (e.button !== 0) return;
  if (e.target.closest('button, a, input, textarea, select, .reac, .reply-ref, .msg-actions')) return;
  const msgEl = e.target.closest('.msg'); if (!msgEl || !msgEl.dataset.id) return;
  _dragSel = { startY: e.clientY, startX: e.clientX, moved: false, cached: null };
  window.addEventListener('pointermove', dragSelMove, { passive: false });
  window.addEventListener('pointerup', dragSelUp, { once: true });
  window.addEventListener('pointercancel', dragSelUp, { once: true });
}
function dragSelMove(e) {
  if (!_dragSel) return;
  const dy = e.clientY - _dragSel.startY;
  if (!_dragSel.moved && Math.abs(dy) > 6) {
    _dragSel.moved = true;
    document.body.classList.add('drag-sel');
    _dragSel.cached = Array.from($('messages').querySelectorAll('.msg'));
  }
  if (!_dragSel.moved) return;
  e.preventDefault();
  _selBandTop = Math.min(_dragSel.startY, e.clientY);
  _selBandBottom = Math.max(_dragSel.startY, e.clientY);
  dragAutoScroll(e.clientY);
  if (_dragSelFrame) return;
  _dragSelFrame = requestAnimationFrame(() => { _dragSelFrame = null; bandSelect(_selBandTop, _selBandBottom, _dragSel && _dragSel.cached); });
}
function dragSelUp(e) {
  const drag = _dragSel; _dragSel = null; _dragSelFrame = null;
  stopSelAutoScroll();
  window.removeEventListener('pointermove', dragSelMove);
  window.removeEventListener('pointerup', dragSelUp);
  window.removeEventListener('pointercancel', dragSelUp);
  document.body.classList.remove('drag-sel');
  if (drag && drag.moved) swallowNextClick(350);
}
function dragAutoScroll(clientY) {
  _selAutoY = clientY;
  const c = $('messages'); if (!c) return;
  const r = c.getBoundingClientRect();
  const edge = 56;
  let dy = 0;
  if (clientY < r.top + edge) dy = -Math.ceil((r.top + edge - clientY) / 3);
  else if (clientY > r.bottom - edge) dy = Math.ceil((clientY - (r.bottom - edge)) / 3);
  if (dy) c.scrollTop += Math.max(-18, Math.min(18, dy));
  if (_selAutoRAF == null) _selAutoRAF = requestAnimationFrame(selAutoTick);
}
function selAutoTick() {
  _selAutoRAF = null;
  if (_selAutoY == null) return;
  const c = $('messages'); if (!c) return;
  const r = c.getBoundingClientRect();
  const edge = 56;
  let dy = 0;
  if (_selAutoY < r.top + edge) dy = -Math.ceil((r.top + edge - _selAutoY) / 3);
  else if (_selAutoY > r.bottom - edge) dy = Math.ceil((_selAutoY - (r.bottom - edge)) / 3);
  if (dy) {
    c.scrollTop += Math.max(-18, Math.min(18, dy));
    bandSelect(_selBandTop, _selBandBottom, null);
  }
  _selAutoRAF = requestAnimationFrame(selAutoTick);
}
function stopSelAutoScroll() {
  _selAutoY = null;
  if (_selAutoRAF) cancelAnimationFrame(_selAutoRAF);
  _selAutoRAF = null;
}
function bandSelect(top, bottom, cachedArr) {
  const holder = _dragSel || _touchDrag;
  let els = cachedArr;
  if (holder && holder.cached) els = holder.cached;
  if (!els) els = $('messages') ? $('messages').querySelectorAll('.msg') : [];
  if (holder && !holder.cached) holder.cached = els;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom < top || r.top > bottom) continue;
    if (el.dataset.id && !_selectedMsgs.has(el.dataset.id)) _selectedMsgs.add(el.dataset.id);
  }
  renderSelectState(); renderSelectBar();
}
function initMultiSelect() {
  const msgs = $('messages');
  if (msgs) msgs.addEventListener('pointerdown', dragSelDown);
}
/* ===================== LONG-PRESS (MOBILE) ===================== */
let _lpTimer = null, _lpEl = null, _lpStart = null;
function lpStart(e) {
  if (e.target.closest('.msg-ctx, .msg-sheet, .ctx-scrim, .msg-actions, .reply-ref, .composer, .emoji-pop, input, textarea, button, a')) return;
  const msg = e.target.closest('.msg');
  if (!msg) return;
  _lpEl = msg;
  const t = e.touches ? e.touches[0] : e;
  _lpStart = { x: t.clientX, y: t.clientY };
  clearTimeout(_lpTimer);
  _lpTimer = setTimeout(() => {
    _lpTimer = null;
    const msgId = msg.dataset.id;
    const p = _lpStart; _lpStart = null;
    if (msgId) {
      if (!_selectMode) enterSelectMode([msgId]);
      _touchDrag = { startY: p ? p.y : 0, startX: p ? p.x : 0, cached: null };
    }
    swallowNextClick(350);
  }, 450);
}
function lpMove(e) {
  if (_touchDrag) {
    const t = e.touches ? e.touches[0] : e;
    const dy = t.clientY - _touchDrag.startY;
    if (Math.abs(dy) > 8) {
      if (Math.abs(dy) > 24) { try { e.preventDefault(); } catch (err) {} }
      _selBandTop = Math.min(_touchDrag.startY, t.clientY);
      _selBandBottom = Math.max(_touchDrag.startY, t.clientY);
      dragAutoScroll(t.clientY);
      bandSelect(_selBandTop, _selBandBottom, null);
    }
    return;
  }
  if (!_lpTimer || !_lpStart) return;
  const t = e.touches ? e.touches[0] : e;
  if (Math.abs(t.clientX - _lpStart.x) > 10 || Math.abs(t.clientY - _lpStart.y) > 10) { cancelLp(); }
}
function lpEnd() {
  _touchDrag = null;
  stopSelAutoScroll();
  clearTimeout(_lpTimer); _lpTimer = null; _lpStart = null;
}
function cancelLp() { clearTimeout(_lpTimer); _lpTimer = null; _lpStart = null; }
$('messages').addEventListener('scroll', cancelLp, { passive: true });
function openForward(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds.filter(Boolean) : (idOrIds ? [String(idOrIds)] : []);
  if (!state.room || !ids.length) return;
  const isMulti = ids.length > 1;
  const m = isMulti ? null : (state.rooms[state.room] || {}).messages.find((x) => x.id === ids[0]);
  if (isMulti ? false : !m) return;
  const isM = isMobile();
  const pop = document.createElement('div');
  let scrim = null;
  if (isM) {
    pop.className = 'msg-sheet'; pop.style.left = ''; pop.style.top = ''; pop.style.transform = '';
    scrim = document.createElement('div'); scrim.className = 'ctx-scrim'; scrim.setAttribute('aria-hidden', 'true');
    scrim.onclick = () => { pop.remove(); scrim.remove(); };
    document.body.appendChild(scrim);
  } else {
    pop.className = 'ctx-menu'; pop.style.left = '50%'; pop.style.top = '120px'; pop.style.transform = 'translateX(50%)'; pop.style.minWidth = '240px';
  }
  pop.innerHTML = '<div class="ctx-title">ارسال به…</div>';
  const closeFwd = () => { pop.remove(); if (scrim) scrim.remove(); };
  allRoomIds().forEach((rid) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.innerHTML = '<span>' + esc(roomTitle(rid)) + '</span>'; it.onclick = async () => {
    const target = rid;
    closeFwd();
    if (isMulti) {
      try {
        const resp = await api('/api/forward', { method: 'POST', body: JSON.stringify({ sourceRoomId: state.room, messageIds: ids, destinationRoomId: target }) });
        const d = await resp.json().catch(() => ({}));
        if (d && d.ok) { toast(d.count + ' پیام فوروارد شد'); if (_selectMode) exitSelectMode(); }
        else toast((d && d.error) || 'فوروارد ناموفق بود');
      } catch (err) { toast('فوروارد ناموفق بود'); }
    } else { await doForward(m, target); toast('فوروارد شد'); }
  }; pop.appendChild(it); });
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!pop.contains(e.target)) { document.removeEventListener('click', h); closeFwd(); } }), 50);
}
async function doForward(m, toRoomId) {
  const user = state.users.find((u) => u.username === m.from) || { displayName: m.fromName || m.from };
  const fwdFrom = m.fwdFrom || user.username;
  let kind = m.kind, content = '', src = m.src || m.url, name = m.name, mime = m.mime, duration = m.duration, wave = m.wave, album = m.album, poll = m.poll, checklist = m.checklist;
  if (kind === 'text') content = m.content || '';
  else if (kind === 'sticker') { content = m.content || m.sticker || ''; src = undefined; }
  else if (kind === 'gif') { content = ''; src = m.src || m.url; }
  else if (kind === 'poll' || kind === 'checklist' || kind === 'album') { src = undefined; }
  else { content = m.content || ''; }
  const fwd = { kind, content, src, name, mime, duration, wave, album, poll, checklist, replyTo: m.replyTo ? { id: m.replyTo.id, name: m.replyTo.name, snippet: m.replyTo.snippet } : undefined, fwdFrom };
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'message', roomId: toRoomId, ...fwd }));
}
/* ===================== REPLY GESTURE — swipe-right to reply ===================== */
let _rg = null, _rgT = null;
const REPLY_IGNORE = '.msg-actions, .reply-ref, .reac, .ctx-menu, .msg-ctx, .msg-sheet, .ctx-scrim, .emoji-pop, .composer, input, textarea, button, a, select, .react-pop';
function replyGrab(e, isTouch) {
  if (_rg || _rgT || _ctxEl) return;
  if (!state.room) return;
  if (!isTouch && e.button !== 0) return;
  if (e.target.closest(REPLY_IGNORE)) return;
  const wrap = e.target.closest('#messages .msg');
  if (!wrap || !wrap.dataset.id) return;
  const msg = ((state.rooms[state.room] || {}).messages || []).find((x) => x.id === wrap.dataset.id);
  if (!msg) return;
  const t = isTouch ? (e.touches && e.touches[0]) : null;
  const g = { wrap, msg, id: wrap.dataset.id, sx: t ? t.clientX : e.clientX, sy: t ? t.clientY : e.clientY, fx: 0, engaged: false, consumed: false };
  if (isTouch) _rgT = g; else _rg = g;
}
function replyDragStart(e) {
  if (e.pointerType === 'touch') return;   /* touch → مسیر اختصاصی replyTouch* */
  replyGrab(e, false);
}
function replyTouchStart(e) {
  replyGrab(e, true);
}
function replyDragMove(e) {
  const g = _rg; if (!g) return;
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (!g.engaged) {
    if (dx > -REPLY_GRAB_TOLERANCE) return;               /* only left-swipe */
    if (Math.abs(dy) * REPLY_STICKY_RATIO > Math.abs(dx)) return; /* vertical scroll wins; stay passive */
    g.engaged = true;
    g.wrap.classList.add('replying-grab');
    try { g.wrap.setPointerCapture(e.pointerId); } catch (err) {}
  }
  const fx = Math.max(-REPLY_MAX_OFFSET, Math.min(0, dx));
  g.fx = fx;
  g.wrap.style.transform = 'translateX(' + fx + 'px)';
  g.wrap.classList.toggle('drag-past', Math.abs(fx) >= REPLY_THRESHOLD);
  if (e.cancelable) e.preventDefault();                  /* stop text-selection / native image drag */
}
function replyTouchMove(e) {
  const g = _rgT; if (!g) return;
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - g.sx, dy = t.clientY - g.sy;
  if (!g.engaged) {
    if (dx > -REPLY_GRAB_TOLERANCE) return;               /* only left-swipe */
    if (Math.abs(dy) * REPLY_STICKY_RATIO > Math.abs(dx)) return; /* vertical scroll wins; stay passive */
    if (_selectMode) { exitSelectMode(); _touchDrag = null; }     /* سوایپ بر سلکتِ لانگ‌پرس غلبه کند */
    if (_lpTimer) cancelLp();                           /* swipe را به‌جای لانگ‌پرس انتخاب فعال کن */
    g.engaged = true;
    g.wrap.classList.add('replying-grab');
  }
  const fx = Math.max(-REPLY_MAX_OFFSET, Math.min(0, dx));
  g.fx = fx;
  g.wrap.style.transform = 'translateX(' + fx + 'px)';
  g.wrap.classList.toggle('drag-past', Math.abs(fx) >= REPLY_THRESHOLD);
  if (e.cancelable) e.preventDefault();                  /* stop native pan / text-select / image drag */
}
function replyDragCleanup(g, animateBack) {
  const wrap = g.wrap;
  wrap.classList.remove('replying-grab');
  wrap.classList.remove('drag-past');
  wrap.style.willChange = '';
  if (animateBack && g.engaged && wrap.isConnected) {
    wrap.style.transition = 'transform .26s var(--ease)';
    wrap.style.transform = '';
    setTimeout(() => { if (wrap.isConnected) wrap.style.transition = ''; }, 290);
  } else {
    wrap.style.transform = '';
  }
}
function finishReply(g) {
  const wrap = g.wrap;
  const hit = g.engaged && Math.abs(g.fx) >= REPLY_THRESHOLD;
  if (hit && wrap.isConnected) {
    wrap.classList.remove('replying-grab');
    wrap.classList.remove('drag-past');
    wrap.style.willChange = '';
    wrap.style.transition = 'transform .2s var(--ease)';
    wrap.style.transform = 'translateX(' + Math.max(g.fx - 8, -REPLY_MAX_OFFSET - 8) + 'px)';
    void wrap.offsetWidth;
    wrap.style.transform = '';
    wrap.classList.add('replying-flash');
    setTimeout(() => { wrap.classList.remove('replying-flash'); if (wrap.isConnected) wrap.style.transition = ''; }, 640);
    setReply(g.msg);
    try { $('composer-input').focus(); } catch (err) {}
  } else {
    replyDragCleanup(g, true);
  }
  if (g.engaged) swallowWrapClick(wrap);
}
function replyDragEnd() {
  const g = _rg; if (!g) return; _rg = null;
  finishReply(g);
}
function replyDragCancel() {
  const g = _rg; if (!g) return; _rg = null;
  replyDragCleanup(g, true);
}
function replyTouchEnd() {
  const g = _rgT; if (!g) return; _rgT = null;
  finishReply(g);
}
function replyTouchCancel() {
  const g = _rgT; if (!g) return; _rgT = null;
  replyDragCleanup(g, true);
}
function swallowWrapClick(wrap) {
  const until = Date.now() + 350;
  const h = (ev) => {
    window.removeEventListener('click', h, true);
    if (Date.now() > until) return;
    if (ev.target && wrap.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); }
  };
  window.addEventListener('click', h, true);
}
document.addEventListener('pointerdown', replyDragStart, { passive: true });
window.addEventListener('pointermove', replyDragMove, { passive: false });
window.addEventListener('pointerup', replyDragEnd, { passive: true });
window.addEventListener('pointercancel', replyDragCancel, { passive: true });
window.addEventListener('lostpointercapture', replyDragCancel, { passive: true });
document.addEventListener('touchstart', replyTouchStart, { passive: true });
document.addEventListener('touchmove', replyTouchMove, { passive: false });
document.addEventListener('touchend', replyTouchEnd, { passive: true });
document.addEventListener('touchcancel', replyTouchCancel, { passive: true });
/* PART 3 — views, palette, new menu, profile, misc, init */
const EMOJI_CATEGORIES = {
  '😀 چهره‌ها': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋 اشاره': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','🫷','🫸','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪'],
  '❤️ قلب': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
  '🐾 حیوانات': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'],
  '🍕 غذا': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥖','🍞','🥨','🥯','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
  '⚽ ورزش': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥍','🏑','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','🎯','🪃','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎮','🕹️','🎰','🎲'],
  '🚗 وسایل نقلیه': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🛞','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸'],
  '物件': ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','🩻','🩼','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🫧','🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸','🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','🪧','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📖','📗','📘','📙','📚','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✏️','✒️','🖌️','🖍️','📝','💼','📁','📂','🗂️'],
  '✳️ نمادها': ['🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','💠','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','✅','💯','❗','❓','❕','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤']
};
const ALL_EMOJIS = [...new Set(Object.values(EMOJI_CATEGORIES).flat())];
let _beepCtx = null;
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_beepCtx) _beepCtx = new AC();
    if (_beepCtx.state === 'suspended') _beepCtx.resume();
    const o = _beepCtx.createOscillator(); const g = _beepCtx.createGain();
    o.connect(g); g.connect(_beepCtx.destination);
    o.frequency.value = 660; g.gain.value = 0.04;
    o.start(); o.stop(_beepCtx.currentTime + 0.12);
  } catch (e) {}
}
async function logout(force) { if (!force && !(await uConfirm('آیا می‌خواهید از حساب خارج شوید؟'))) return; try { if (state.token) await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token } }); } catch (e) {} try { if (state.ws) state.ws.close(); } catch (e) {} closeAttachPop(); attachSelection = []; clearRoomsCache(); localStorage.removeItem('ft_token'); localStorage.removeItem('ft_me'); localStorage.removeItem('ft_me_ts'); location.reload(); }
$('auth-logout').onclick = logout;
function showAuth() {
  $('auth-screen').classList.remove('hidden');
  const sp = $('boot-splash'); if (sp) sp.classList.add('hidden');
  const box = $('auth-box'); if (box) box.classList.remove('hidden');
  const lb = $('auth-logout');
  if (lb) lb.style.display = (localStorage.getItem('ft_token') || localStorage.getItem('ft_admin_token')) ? '' : 'none';
}

/* PROFILE */

/* ---------- دانلود امن یک رسانهٔ دریافتی ---------- */
async function downloadMedia(url, name) {
  if (!url) return toast('فایلی برای دانلود نیست');
  const nm = (name && name.indexOf('.') > 0 ? name : 'image.jpg');
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const b = await r.blob();
    const obj = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = obj; a.download = nm;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(obj); } catch (e) {} }, 2000);
    toast('دانلود شد');
  } catch (e) {
    /* اگر گرفتن فایل ممکن نبود (مثلاً لینک بیرونی) همان لینک باز شود */
    const a = document.createElement('a');
    a.href = url; a.download = nm; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}
/* ---------- نقاشی/ویرایش روی عکسی که از دیگری گرفته‌ایم ----------
   فایل اول دانلود می‌شود، بعد همان ویرایشگر عکس باز می‌شود و نتیجه
   به‌صورت پیام تازه فرستاده می‌شود (پیام اصلی دست‌نخورده می‌ماند). */
async function editReceivedImage(url, name) {
  if (!url) return toast('تصویری برای ویرایش نیست');
  toast('در حال آماده‌سازی تصویر…');
  let file;
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const b = await r.blob();
    file = new File([b], (name || 'image.jpg').replace(/[\\/:*?"<>|]+/g, '_'), { type: b.type || 'image/jpeg' });
  } catch (e) { return toast('دریافت تصویر ممکن نشد'); }
  openPhotoEditor(file, (blob, nm) => {
    if (blob === file) return;
    sendFileMessage(blob, nm);
  });
}

/* ═══════════════ پخش‌کنندهٔ اختصاصی ویدیو ═══════════════
   رفتارها:
     • نگه‌داشتن انگشت روی نیمهٔ چپ/راست ویدیو ⇒ رفتن به عقب/جلو
     • در همان حالت، کشیدن انگشت به بالا/پایین ⇒ کم/زیاد شدن سرعت جست‌وجو
     • نوار پیشرفت، زمان، سرعت پخش، صدا، تصویر‌در‌تصویر، چرخش،
       تمام‌صفحه، دانلود، ویرایش و تبدیل به GIF                        */
const VXP_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
function vxpMediaItems() { try { const r = state.rooms[state.room]; if (!r || !r.messages) return []; const items = []; for (const m of r.messages) { if (m && (m.kind === 'image' || m.kind === 'gif' || m.kind === 'video')) { const url = m.url || m.src; if (url) items.push({ kind: m.kind === 'video' ? 'video' : 'image', url: url, time: m.time || 0 }); } } items.sort((a, b) => (a.time || 0) - (b.time || 0)); return items; } catch (e) { return []; } }
function vxpMediaIndex(url) { const items = vxpMediaItems(); if (!url) return -1; let i = items.findIndex((it) => it.url === url); if (i < 0) { try { const u = new URL(url, location.href).pathname; i = items.findIndex((it) => { try { return new URL(it.url, location.href).pathname === u; } catch (e) { return false; } }); } catch (e) {} } return i; }
function vxpOpenMedia(it) { if (!it) return; if (it.kind === 'video') openVideoPlayer(it.url, it.url); else openViewer(it.url, 'image', it.url); }
function vxpGo(curEl, currentUrl, step) { const items = vxpMediaItems(); const i = vxpMediaIndex(currentUrl); if (i < 0) return; const j = i + step; if (j < 0 || j >= items.length) return; if (curEl && curEl._vxClose) curEl._vxClose(); vxpOpenMedia(items[j]); }
function vxpFmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
function openVideoPlayer(src, origUrl) {
  const real = origUrl || src;
  let name = 'video.mp4';
  try { const p = decodeURIComponent(new URL(real, location.href).pathname.split('/').pop() || ''); if (p) name = p; } catch (e) {}
  const v = document.createElement('div');
  v.className = 'viewer vxp';
  v.innerHTML =
    '<div class="vxp-stage">'
    +   '<video playsinline preload="metadata"></video>'
    +   '<div class="vxp-top">'
    +     '<button type="button" class="vxp-ib" data-a="close" title="بستن" aria-label="بستن">' + ic('x') + '</button>'
    +     '<span class="vxp-name" title="' + esc(name) + '"></span>'
    +     '<button type="button" class="vxp-ib" data-a="rot" title="چرخش ۹۰ درجه" aria-label="چرخش">' + ic('rotate-cw') + '</button>'
    +   '</div>'
    +   '<div class="vxp-hud" hidden>'
    +     '<div class="vxp-hud-dir"></div>'
    +     '<div class="vxp-hud-rate"></div>'
    +     '<div class="vxp-hud-time"></div>'
    +   '</div>'
    +   '<button type="button" class="vxp-big" data-a="pp" title="پخش/توقف" aria-label="پخش یا توقف">' + ic('play') + '</button>'
    +   '<div class="vxp-hint">نگه‌داشتن سمت راست: افزایش سرعت • کشیدن بالا/پایین: تنظیم سرعت • سمت چپ: عقب‌بردن</div>'
    + '</div>'
    + '<div class="vxp-bar">'
    +   '<div class="vxp-line">'
    +     '<button type="button" class="vxp-ib" data-a="pp2" title="پخش/توقف" aria-label="پخش یا توقف">' + ic('play') + '</button>'
    +     '<span class="vxp-cur">0:00</span>'
    +     '<div class="vxp-prog" role="slider" tabindex="0" aria-label="نوار پیشرفت"><div class="vxp-buf"></div><div class="vxp-fill"><i></i></div></div>'
    +     '<span class="vxp-dur">0:00</span>'
    +   '</div>'
    +   '<div class="vxp-acts">'
    +     '<button type="button" class="vxp-ib" data-a="b10" title="۱۰ ثانیه عقب" aria-label="ده ثانیه عقب">' + ic('rewind') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="f10" title="۱۰ ثانیه جلو" aria-label="ده ثانیه جلو">' + ic('fast-forward') + '</button>'
    +     '<button type="button" class="vxp-ib vxp-rate" data-a="rate" title="سرعت پخش">1x</button>'
    +     '<button type="button" class="vxp-ib" data-a="mute" title="صدا" aria-label="صدا">' + ic('volume-2') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="pip" title="تصویر در تصویر" aria-label="تصویر در تصویر">' + ic('picture-in-picture-2') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="fs" title="تمام‌صفحه" aria-label="تمام‌صفحه">' + ic('maximize') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="dl" title="دانلود" aria-label="دانلود">' + ic('download') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="edit" title="ویرایش ویدیو" aria-label="ویرایش ویدیو">' + ic('edit-3') + '</button>'
    +     '<button type="button" class="vxp-ib" data-a="gif" title="تبدیل به GIF" aria-label="تبدیل به GIF">' + ic('image') + '</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(v);
  v.querySelector('.vxp-name').textContent = name;
  const vd = v.querySelector('video');
  vd.src = src;
  applyIcons(v);
  vxOverlayOpen();

  const $ = (s) => v.querySelector(s);
  const stage = $('.vxp-stage'), hud = $('.vxp-hud'), hudDir = $('.vxp-hud-dir');
  const hudRate = $('.vxp-hud-rate'), hudTime = $('.vxp-hud-time');
  const fill = $('.vxp-fill'), knob = fill.querySelector('i'), buf = $('.vxp-buf');
  const prog = $('.vxp-prog'), curEl = $('.vxp-cur'), durEl = $('.vxp-dur');
  const btnPP = $('[data-a="pp"]'), btnPP2 = $('[data-a="pp2"]'), btnMute = $('[data-a="mute"]');
  const btnFs = $('[data-a="fs"]'), rateBtn = $('.vxp-rate');
  let hintTimer = setTimeout(() => { const h = $('.vxp-hint'); if (h) h.remove(); }, 4200);

  const dur = () => (isFinite(vd.duration) ? vd.duration : 0);
  function setFill() {
    const d = dur();
    const p = d ? Math.max(0, Math.min(1, vd.currentTime / d)) : 0;
    fill.style.width = (p * 100) + '%';
    knob.style.insetInlineStart = (p * 100) + '%';
    curEl.textContent = vxpFmt(vd.currentTime);
    durEl.textContent = vxpFmt(d);
  }
  function paintPP() {
    const icn = vd.paused ? 'play' : 'pause';
    btnPP.innerHTML = ic(icn); btnPP2.innerHTML = ic(icn);
    applyIcons(btnPP); applyIcons(btnPP2);
  }
  function setRate(r) {
    vd.playbackRate = r;
    rateBtn.textContent = (r % 1 === 0 ? r : r.toFixed(2).replace(/0$/, '')) + 'x';
  }
  function toggle() { if (vd.paused) { vd.play().catch(() => {}); } else { vd.pause(); } }
  function seekTo(t) { try { vd.currentTime = Math.max(0, Math.min(dur() || 0, t)); } catch (e) {} setFill(); }
  vd.addEventListener('timeupdate', setFill);
  vd.addEventListener('progress', () => {
    try { if (vd.buffered.length) buf.style.width = (vd.buffered.end(vd.buffered.length - 1) / (dur() || 1) * 100) + '%'; } catch (e) {}
  });
  vd.addEventListener('loadedmetadata', setFill);
  vd.addEventListener('play', paintPP);
  vd.addEventListener('pause', paintPP);
  vd.addEventListener('volumechange', () => { btnMute.innerHTML = ic(vd.muted || vd.volume === 0 ? 'volume-x' : 'volume-2'); applyIcons(btnMute); });
  vd.addEventListener('error', () => { toast('پخش این ویدیو ممکن نیست'); });

  btnPP.onclick = toggle; btnPP2.onclick = toggle;
  $('[data-a="b10"]').onclick = () => seekTo(vd.currentTime - 10);
  $('[data-a="f10"]').onclick = () => seekTo(vd.currentTime + 10);
  btnMute.onclick = () => { vd.muted = !vd.muted; if (!vd.muted && vd.volume === 0) vd.volume = 1; };
  $('[data-a="pip"]').onclick = () => {
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else if (vd.requestPictureInPicture) vd.requestPictureInPicture().catch(() => toast('تصویر در تصویر در این مرورگر ممکن نیست'));
      else toast('تصویر در تصویر پشتیبانی نمی‌شود');
    } catch (e) { toast('تصویر در تصویر پشتیبانی نمی‌شود'); }
  };
  $('[data-a="rot"]').onclick = () => {
    const deg = (((v.dataset.deg | 0) + 90) % 360);
    v.dataset.deg = deg;
    vd.style.transform = 'rotate(' + deg + 'deg)';
    v.classList.toggle('vxp-rot90', deg === 90 || deg === 270);
  };
  const fsIcon = () => { const full = document.fullscreenElement === v || document.fullscreenElement === vd; btnFs.innerHTML = ic(full ? 'minimize' : 'maximize'); applyIcons(btnFs); };
  btnFs.onclick = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen().catch(() => toast('تمام‌صفحه ممکن نیست'));
      else if (vd.webkitEnterFullscreen) vd.webkitEnterFullscreen();
    } catch (e) { toast('تمام‌صفحه ممکن نیست'); }
  };
  document.addEventListener('fullscreenchange', fsIcon);
  $('[data-a="dl"]').onclick = () => { const a = document.createElement('a'); a.href = real; a.download = name; a.click(); };
  $('[data-a="edit"]').onclick = () => { close(); openVideoEditor(real); };
  $('[data-a="gif"]').onclick = () => { close(); openGifConverter(real); };

  /* ---------- منوی سرعت ---------- */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  rateBtn.onclick = (e) => {
    e.stopPropagation();
    if (pop) { closePop(); return; }
    pop = document.createElement('div');
    pop.className = 'vxp-pop';
    VXP_RATES.forEach((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vxp-pop-item' + (vd.playbackRate === r ? ' active' : '');
      b.innerHTML = ic(r < 1 ? 'rewind' : r > 1 ? 'fast-forward' : 'play') + '<span>' + r + 'x</span>';
      b.onclick = () => { setRate(r); closePop(); };
      pop.appendChild(b);
    });
    v.appendChild(pop);
    const r = rateBtn.getBoundingClientRect();
    pop.style.bottom = (v.clientHeight - r.top + 8) + 'px';
    pop.style.insetInlineStart = '8px';
    const ph = pop.offsetHeight;
    if (r.top - ph - 8 < 8) { pop.style.bottom = ''; pop.style.top = (r.bottom + 8) + 'px'; }
  };

  /* ---------- نوار پیشرفت: کلیک و کشیدن ---------- */
  const progSeek = (e) => {
    const r = prog.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (dur()) seekTo(p * dur());
  };
  let dragging = false;
  prog.addEventListener('pointerdown', (e) => { dragging = true; prog.setPointerCapture(e.pointerId); progSeek(e); });
  prog.addEventListener('pointermove', (e) => { if (dragging) progSeek(e); });
  const endDrag = () => { dragging = false; };
  prog.addEventListener('pointerup', endDrag);
  prog.addEventListener('pointercancel', endDrag);

  /* ---------- نگه‌داشتن چپ/راست = جست‌وجو؛ بالا/پایین = سرعت ---------- */
  const HOLD_MS = 180;
  let hold = null, scrub = null, scrubRaf = 0, wasPlaying = false, tapMoved = false;
  const zoneOf = (x) => (x < stage.getBoundingClientRect().width / 2 ? -1 : 1);
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, .vxp-prog, .vxp-pop')) return;
    closePop();
    const dir = zoneOf(e.clientX);
    tapMoved = false;
    hold = setTimeout(() => {
      hold = null;
      startScrub(dir, e.clientY);
    }, HOLD_MS);
    const move = (ev) => {
      if (scrub) { updateScrub(ev.clientY); return; }
      const dxm = ev.clientX - e.clientX, dym = ev.clientY - e.clientY;
      if (hold && (Math.abs(dxm) > 8 || Math.abs(dym) > 8)) { clearTimeout(hold); hold = null; }
      if (!scrub && Math.abs(dxm) > 70 && Math.abs(dym) < 40) { tapMoved = true; vxpGo(v, real, dxm < 0 ? 1 : -1); }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (hold) { clearTimeout(hold); hold = null; if (!tapMoved) toggle(); }
      if (scrub) endScrub();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  function startScrub(dir, y0) {
    wasPlaying = !vd.paused;
    if (dir > 0) {
      scrub = { dir: dir, y0: y0, rate: 2, from: vd.currentTime, t: 0, mode: 'boost', prevRate: vd.playbackRate };
      if (vd.paused) { vd.play().catch(() => {}); }
      v.classList.add('vxp-scrub');
      hud.hidden = false;
      hudRate.textContent = '2x';
      paintHud();
      try { vd.playbackRate = 2; } catch (e) {}
      return;
    }
    scrub = { dir: dir, y0: y0, rate: 1, from: vd.currentTime, t: 0, mode: 'seek' };
    vd.pause();
    v.classList.add('vxp-scrub');
    hud.hidden = false;
    hudRate.textContent = '1x';
    paintHud();
    const step = (now) => {
      if (!scrub) return;
      const dt = Math.min(0.05, (now - (scrub.last || now)) / 1000);
      scrub.last = now;
      scrub.t += dir * scrub.rate * dt;
      seekTo(scrub.from + scrub.t);
      paintHud();
      scrubRaf = requestAnimationFrame(step);
    };
    scrubRaf = requestAnimationFrame(step);
  }
  function updateScrub(y) {
    if (!scrub) return;
    const dy = scrub.y0 - y;
    if (scrub.mode === 'boost') {
      const idx = Math.max(-6, Math.min(10, Math.round(dy / 26)));
      let r = 2 * Math.pow(1.6, idx);
      r = Math.max(0.5, Math.min(8, r));
      scrub.rate = r;
      try { vd.playbackRate = r; } catch (e) {}
      paintHud();
      return;
    }
    const steps = Math.round(dy / 26);
    const idx = Math.max(-4, Math.min(8, steps));
    scrub.rate = Math.pow(1.6, idx);
    paintHud();
  }
  function paintHud() {
    if (!scrub) return;
    const back = scrub.t < 0;
    hudDir.innerHTML = ic(scrub.dir < 0 ? 'rewind' : 'fast-forward')
      + '<span>' + (scrub.dir < 0 ? 'عقب' : 'جلو') + '</span>'
      + (scrub.rate >= 1.001 ? ic('chevrons-up') : ic('chevrons-down'));
    hudRate.textContent = (scrub.rate >= 10 ? scrub.rate.toFixed(0) : scrub.rate.toFixed(1)) + 'x';
    const d = dur();
    hudTime.textContent = vxpFmt(Math.max(0, Math.min(d || 0, scrub.from + scrub.t))) + ' / ' + vxpFmt(d);
    hud.classList.toggle('back', back);
  }
  function endScrub() {
    if (scrubRaf) cancelAnimationFrame(scrubRaf);
    const s = scrub;
    scrubRaf = 0; scrub = null;
    v.classList.remove('vxp-scrub');
    hud.hidden = true;
    if (s && s.mode === 'boost') {
      try { vd.playbackRate = s.prevRate; } catch (e) {}
      if (s.wasPlaying) { vd.play().catch(() => {}); } else { try { vd.pause(); } catch (e) {} }
      return;
    }
    if (wasPlaying) vd.play().catch(() => {});
  }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- کیبورد ---------- */
  const onKey = (e) => {
    if (!document.body.contains(v)) { document.removeEventListener('keydown', onKey); return; }
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { toggle(); e.preventDefault(); }
    else if (k === 'ArrowRight') { seekTo(vd.currentTime + 5); e.preventDefault(); }
    else if (k === 'ArrowLeft') { seekTo(vd.currentTime - 5); e.preventDefault(); }
    else if (k === 'ArrowUp') { vd.muted = false; vd.volume = Math.min(1, vd.volume + 0.1); e.preventDefault(); }
    else if (k === 'ArrowDown') { vd.volume = Math.max(0, vd.volume - 0.1); if (vd.volume === 0) vd.muted = true; e.preventDefault(); }
    else if (k === 'm' || k === 'M') { vd.muted = !vd.muted; }
    else if (k === 'f' || k === 'F') { btnFs.click(); }
    else if (k === 'j' || k === 'J') { seekTo(vd.currentTime - 10); }
    else if (k === 'l' || k === 'L') { seekTo(vd.currentTime + 10); }
  };
  document.addEventListener('keydown', onKey);

  /* ---------- بستن ---------- */
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(hintTimer);
    if (scrubRaf) cancelAnimationFrame(scrubRaf);
    closePop();
    try { vd.pause(); } catch (e) {}
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', fsIcon);
    if (document.fullscreenElement === v) { try { document.exitFullscreen(); } catch (e) {} }
    v.remove();
    vxOverlayClose();
  }
  v._vxClose = close;
  $('[data-a="close"]').onclick = close;
  v.onclick = (e) => { if (e.target === v || e.target === stage) toggle(); };
  setRate(1);
  setFill();
  paintPP();
  vd.play().catch(() => {});
  return v;
}

/* VIEWER — custom, swipe up/down to dismiss, uses cached blob if available */
function openViewer(src, kind, origUrl) {
  if (kind === 'video') return openVideoPlayer(src, origUrl);
  const v = document.createElement('div'); v.className = 'viewer';
  const useSrc = src;
  const escSrc = esc(useSrc);
  v.innerHTML = '<img src="' + escSrc + '" draggable="false"><div class="v-close">' + ic('x') + '</div>';
  document.body.appendChild(v); luc();
  applyIcons(v);
  vxOverlayOpen();
  let closed = false;
  const closeImg = () => { if (closed) return; closed = true; cleanup(); v.remove(); vxOverlayClose(); };
  v._vxClose = closeImg;
  v.querySelector('.v-close').onclick = closeImg;
  // swipe up/down to dismiss, left/right to navigate media
  let sy = 0, sx = 0, dy = 0, dx = 0, dragging = false;
  const el = v.querySelector('img');
  const onDown = (e) => { dragging = true; sx = (e.touches ? e.touches[0].clientX : e.clientX); sy = (e.touches ? e.touches[0].clientY : e.clientY); v.style.transition = 'none'; };
  const onMove = (e) => { if (!dragging) return; const x = (e.touches ? e.touches[0].clientX : e.clientX); const y = (e.touches ? e.touches[0].clientY : e.clientY); dy = y - sy; dx = x - sx; if (el) { if (Math.abs(dx) > Math.abs(dy)) el.style.transform = 'translateX(' + dx + 'px)'; else el.style.transform = 'translateY(' + dy + 'px) scale(' + (1 - Math.min(0.2, Math.abs(dy) / 600)) + ')'; v.style.background = 'rgba(0,0,0,' + (0.9 - Math.min(0.5, Math.abs(dy) / 400)) + ')'; } };
  const onUp = () => { if (!dragging) return; dragging = false; v.style.transition = ''; if (Math.abs(dy) > 90) closeImg(); else if (Math.abs(dx) > 80 && Math.abs(dy) < 50) { const step = dx < 0 ? 1 : -1; vxpGo(v, origUrl || useSrc, step); } else { if (el) el.style.transform = ''; v.style.background = ''; } dy = 0; dx = 0; };
  v.addEventListener('touchstart', onDown, { passive: true }); v.addEventListener('touchmove', onMove, { passive: true }); v.addEventListener('touchend', onUp);
  v.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  // cleanup on remove
  const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.removeEventListener('keydown', escH); };
  // esc close
  const escH = (e) => { if (e.key === 'Escape') closeImg(); };
  document.addEventListener('keydown', escH);
  return v;
}

/* IN-APP DIALOGS (موبایل: بدون prompt/confirm مرورگر که روی iOS باز نمی‌شود) */
function uPrompt(title, initial, placeholder) {
  return new Promise((resolve) => {
    const pop = document.createElement('div'); pop.className = 'u-pop';
    pop.innerHTML = '<div class="u-pop-box"><div class="u-pop-title">' + esc(title) + '</div><input class="inp" data-k="inp" value="' + esc(initial || '') + '" placeholder="' + esc(placeholder || '') + '"><div class="u-pop-actions"><button class="btn sm ghost" data-k="0">انصراف</button><button class="btn sm" data-k="1">تأیید</button></div></div>';
    const inp = pop.querySelector('[data-k="inp"]');
    pop.querySelector('[data-k="0"]').onclick = () => { pop.remove(); resolve(null); };
    pop.querySelector('[data-k="1"]').onclick = () => { const v = inp.value; pop.remove(); resolve(v); };
    document.body.appendChild(pop);
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pop.querySelector('[data-k="1"]').click(); if (e.key === 'Escape') pop.querySelector('[data-k="0"]').click(); });
  });
}
function uConfirm(message) {
  return new Promise((resolve) => {
    const pop = document.createElement('div'); pop.className = 'u-pop';
    pop.innerHTML = '<div class="u-pop-box"><div class="u-pop-title">' + esc(message) + '</div><div class="u-pop-actions"><button class="btn sm ghost" data-k="0">انصراف</button><button class="btn sm" data-k="1">تأیید</button></div></div>';
    pop.querySelector('[data-k="0"]').onclick = () => { pop.remove(); resolve(false); };
    pop.querySelector('[data-k="1"]').onclick = () => { pop.remove(); resolve(true); };
    document.body.appendChild(pop);
  });
}
function uConfirmCb(title, options) {
  return new Promise((resolve) => {
    const pop = document.createElement('div'); pop.className = 'u-pop';
    let rows = '';
    for (const o of options) rows += '<label class="u-pop-check"><input type="checkbox" data-k="' + esc(o.key) + '"' + (o.checked ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
    pop.innerHTML = '<div class="u-pop-box"><div class="u-pop-title">' + esc(title) + '</div><div class="u-pop-checks">' + rows + '</div><div class="u-pop-actions"><button class="btn sm ghost" data-k="0">انصراف</button><button class="btn sm danger" data-k="1">تأیید</button></div></div>';
    pop.querySelector('[data-k="0"]').onclick = () => { pop.remove(); resolve(null); };
    pop.querySelector('[data-k="1"]').onclick = () => {
      const out = {};
      for (const o of options) out[o.key] = !!pop.querySelector('[data-k="' + o.key + '"]').checked;
      pop.remove(); resolve(out);
    };
    document.body.appendChild(pop);
  });
}

/* ---------- حذف پیام: برای همه یا فقط برای من ---------- */
/* اگر تیک «برای طرف مقابل هم حذف شود» زده شود پیام از سرور پاک می‌شود،
   وگرنه فقط همین‌جا مخفی می‌ماند (سرور آن را از تاریخچه‌ی من فیلتر می‌کند). */
function deleteScopeLabel() {
  const rid = state.room || '';
  if (rid.startsWith('dm:')) {
    const other = rid.slice(3).split('|').find((p) => p !== state.me.username);
    if (!other || other === BOT_USERNAME || other === state.me.username) return null;
    const u = (state.users || []).find((x) => x.username === other);
    return 'برای ' + ((u && (u.displayName || u.username)) || other) + ' هم حذف شود';
  }
  if (rid.startsWith('group:')) return 'برای همه حذف شود';
  return null;
}
async function askDeleteScope(title) {
  const label = deleteScopeLabel();
  if (!label) {
    if (!(await uConfirm(title || 'حذف شود؟'))) return null;
    return { forEveryone: true };
  }
  const r = await uConfirmCb(title || 'حذف پیام؟', [{ key: 'all', label, checked: true }]);
  if (!r) return null;
  return { forEveryone: !!r.all };
}
function sendDeleteMsg(id, forEveryone) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'delete-message', roomId: state.room, id, forEveryone: forEveryone !== false }));
}
/* NEW MENU */
function openNewMenu(anchor) {
  // اگر باز است، ببند (تاگل) و جلوگیری از چند منوی روی‌هم
  const opened = document.querySelectorAll('.ctx-menu');
  if (opened.length) { opened.forEach((n) => n.remove()); return; }
  const pop = document.createElement('div'); pop.className = 'ctx-menu anchored';
  const src = anchor || $('cl-new');
  if (src && typeof src.getBoundingClientRect === 'function') {
    const btn = src.getBoundingClientRect();
    const mw = 210, mh = 170;
    let left = btn.left, top = btn.bottom + 6;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    if (top + mh > window.innerHeight - 8) top = Math.max(8, btn.top - mh - 6);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';
  } else {
    pop.style.left = '50%'; pop.style.top = '50%'; pop.style.transform = 'translate(-50%,-50%)';
  }
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'ctx-item'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = () => { fn(); pop.remove(); }; pop.appendChild(r); };
  mk('چت خصوصی جدید', 'user-plus', startDM); mk('گروه جدید', 'users', () => startGroup()); mk('کانال جدید', 'megaphone', () => startGroup(true));
  pop.addEventListener('click', (e) => e.stopPropagation());
  const close = (e) => { if (e && !pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close); } };
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', close), 0);
}
async function startDM() { const who = await uPrompt('نام کاربری مقابل (مثلاً ali):'); if (!who) return; let other = (who + '').replace('@', '').trim(); if (!other) return; if (other.toLowerCase() === state.me.username.toLowerCase()) { toast('با خودت نمیتونی چت کنی!'); return; } if (other !== BOT_USERNAME && !state.me.isAdmin && !getContacts()[other]) { try { const r = await api('/api/users/exists/' + encodeURIComponent(other)); if (r.status === 404) { toast('چنین کاربری ثبت نشده'); return; } if (r.ok) { const j = await r.json(); other = j.username || other; } } catch (e) { } } const rid = 'dm:' + [state.me.username, other].sort().join('|'); if (state.me.isAdmin || getContacts()[other] || other === BOT_USERNAME) { openRoom(rid); } else { const c = getContacts(); const cu = (state.users || []).find((u) => u.username === other); c[other] = (cu && cu.displayName) || other; saveContacts(c); openRoom(rid); } }
function openDM(other) {
  if (other === state.me.username) return;
  const rid = 'dm:' + [state.me.username, other].sort().join('|');
  if (!state.me.isAdmin && !getContacts()[other] && other !== BOT_USERNAME) { const c = getContacts(); c[other] = (state.users.find((u) => u.username === other) || {}).displayName || other; saveContacts(c); }
  switchNav('chats'); openRoom(rid);
}
function renderContacts(wrap) {
  wrap.innerHTML = '<div class="ct-toolbar"><button class="btn sm" id="ct-sync"><i data-lucide="smartphone" class="icon"></i>' + ic('smartphone') + ' همگام‌سازی مخاطبین گوشی</button><button class="btn sm ghost" id="ct-invite">' + ic('share') + ' دعوت با لینک</button></div><div class="contact-search"><input id="ct-search" class="inp" placeholder="جستجوی آیدی یا نام کاربر…"><div id="ct-results" class="ct-results"></div></div><div id="ct-list"></div>';
  const listEl = wrap.querySelector('#ct-list');
  const resultsEl = wrap.querySelector('#ct-results');
  wrap.querySelector('#ct-sync').onclick = syncPhoneContacts;
  wrap.querySelector('#ct-invite').onclick = showInviteLink;
  const draw = (list) => {
    list = (list || []).filter((u) => u.username !== state.me.username);
    if (!list.length) {
      listEl.innerHTML = '<div class="vx-empty">' + ic('contact') + '<div class="t">هنوز مخاطبی ثبت نشده</div><div class="s">از دکمهٔ «چت جدید» گفتگو بسازید یا از جستجوی بالا آیدی کاربر را پیدا کنید.</div></div>';
      applyIcons(listEl);
      return;
    }
    const canSeeOnline = !!state.me.isAdmin;
    const isOn = (u) => canSeeOnline && !!u.online && !u.banned;
    const on = list.filter(isOn);
    const rest = list.filter((u) => !isOn(u));
    const rowHTML = (u) => {
      const online = isOn(u);
      const av = avatarEl(u, 'md').outerHTML;
      return '<div class="contact-item" data-u="' + esc(u.username) + '"' + (online ? ' data-online="1"' : '')
        + ' role="listitem" tabindex="0">'
        + '<span class="ci-av">' + av + (online ? '<span class="ci-on" aria-label="آنلاین" title="آنلاین"></span>' : '') + '</span>'
        + '<div class="ci-body"><div class="ci-name">' + esc(u.displayName || u.username) + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '') + '</div>'
        + '<div class="ci-sub" dir="ltr">@' + esc(u.username) + '</div></div>'
        + '<button class="btn sm" data-act="chat" aria-label="چت با ' + escAttr(u.displayName || u.username) + '">چت</button>'
        + '<button class="btn sm ghost" data-act="profile" aria-label="پروفایل ' + escAttr(u.displayName || u.username) + '">پروفایل</button>'
        + (state.me.isAdmin ? '<button class="btn sm danger" data-act="ban">' + ((u.banned) ? 'رفع مسدودی' : 'مسدود') + '</button>' : '')
        + '</div>';
    };
    let h = '<div class="contact-list" role="list">';
    if (on.length) {
      h += '<div class="vx-sec-title">' + ic('user-check') + '<span>آنلاین</span><span class="n">' + on.length + '</span></div>';
      h += on.map(rowHTML).join('');
      h += '<div class="vx-sec-title">' + ic('contact') + '<span>سایر مخاطبین</span><span class="n">' + rest.length + '</span></div>';
      h += rest.map(rowHTML).join('');
    } else {
      h += '<div class="vx-sec-title">' + ic('contact') + '<span>مخاطبین</span><span class="n">' + list.length + '</span></div>';
      h += list.map(rowHTML).join('');
    }
    h += '</div>';
    listEl.innerHTML = h;
    listEl.querySelectorAll('.contact-item').forEach((it) => {
      const u = it.dataset.u; const cur = (state.users || []).find((x) => x.username === u) || { banned: false };
      it.querySelector('[data-act="chat"]').onclick = (e) => { e.stopPropagation(); openDM(u); };
      it.querySelector('[data-act="profile"]').onclick = (e) => { e.stopPropagation(); openProfile(u); };
      const ban = it.querySelector('[data-act="ban"]');
      if (ban) ban.onclick = async (e) => { e.stopPropagation(); await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u, banned: !cur.banned }) }); toast('انجام شد'); renderView('contacts'); };
      it.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openDM(u); } };
      it.onclick = (e) => { if (e.target.closest('button')) return; openDM(u); };
    });
    applyIcons(listEl);
    luc();
  };
  let timer;
  wrap.querySelector('#ct-search').oninput = (e) => {
    const q = e.target.value.trim();
    clearTimeout(timer);
    if (!q) { resultsEl.innerHTML = ''; return; }
    timer = setTimeout(() => {
      api('/api/users/search?q=' + encodeURIComponent(q)).then((r) => r.json()).then((d) => {
        const us = d.users || [];
        if (!us.length) { resultsEl.innerHTML = '<div class="placeholder">کاربری با این آیدی یافت نشد.</div>'; return; }
        resultsEl.innerHTML = us.map((u) => '<div class="au-row" data-u="' + esc(u.username) + '">' + avatarEl(u, 'md').outerHTML + '<div class="au-body"><div class="au-name">' + esc(u.displayName || u.username) + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '') + (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + '</div><div class="au-sub">@' + esc(u.username) + (u.online ? ' • آنلاین' : '') + '</div></div><div class="au-actions"><button class="btn sm" data-act="chat">چت</button><button class="btn sm ghost" data-act="profile">پروفایل</button></div></div>').join('');
        resultsEl.querySelectorAll('.au-row').forEach((row) => {
          const u = row.dataset.u;
          row.querySelector('[data-act="chat"]').onclick = () => openDM(u);
          row.querySelector('[data-act="profile"]').onclick = () => openProfile(u);
        });
      }).catch(() => {});
    }, 250);
  };
  let list = state.me.isAdmin ? (state.users || []) : Object.keys(getContacts()).map((u) => ({ username: u, displayName: getContacts()[u] || u }));
  if (state.me.isAdmin && (!state.users || !state.users.length)) {
    api('/api/admin/users').then((r) => r.json()).then((d) => { if (d.users) { state.users = d.users; draw(state.users); } }).catch(() => {});
  }
  draw(list);
}
async function syncPhoneContacts() {
  const pickPhones = async () => {
    if (navigator.contacts && navigator.contacts.select) {
      try { const props = await navigator.contacts.select(['name', 'tel'], { multiple: true }); return props.flatMap((c) => c.tel || []); } catch (e) { if (e && e.name === 'NotAllowedError') { toast('دسترسی به مخاطبین رد شد'); return null; } }
    }
    return uPrompt('شماره‌های تلفن مخاطبین را بفرست (با کاما جدا کن)', '', '۰۹۱۲۳۴۵۶۷۸۹، ۰۹۳۵۴۳۲۱۰۹۸');
  };
  const raw = await pickPhones();
  if (!raw) return;
  const phones = (Array.isArray(raw) ? raw : String(raw).split(/[،,;]+/)).map((p) => String(p).trim()).filter(Boolean);
  if (!phones.length) return;
  const uniq = [...new Set(phones)];
  toast('در حال جستجوی مخاطبین…');
  api('/api/contacts/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phones: uniq }) })
    .then((r) => r.json())
    .then((d) => {
      const us = d.users || [];
      if (!us.length) { toast('هیچ‌کدام از مخاطبین شما در وی‌ورتگرام نیستند'); return; }
      const c = getContacts();
      us.forEach((u) => { if (!c[u.username]) c[u.username] = u.displayName || u.username; });
      saveContacts(c);
      state.users = state.users || [];
      us.forEach((u) => { if (!state.users.some((x) => x.username === u.username)) state.users.push(u); });
      toast(us.length + ' مخاطب از دفتر تلفن شما پیدا شد');
      renderView('contacts');
    })
    .catch(() => { toast('خطا در همگام‌سازی مخاطبین'); });
}
function showInviteLink() {
  const base = location.origin;
  const code = (state.me && state.me.username) ? encodeURIComponent(state.me.username) : '';
  const url = base + '/invite?ref=' + code;
  const m = document.createElement('div'); m.className = 'skin-preview-modal' + (isMobile() ? ' mobile' : '');
  m.innerHTML = '<div class="spm-backdrop"></div><div class="spm-card"><div class="spm-head"><b>' + ic('share') + ' دعوت دوستان</b></div><div class="spm-desc">این لینک را برای دوستانت بفرست — اگر هنوز وی‌ورتگرام ندارند، با این لینک ثبت‌نام می‌کنند و مستقیم با تو چت می‌شوند.</div><input class="inp" id="invite-url" readonly value="' + esc(url) + '" style="width:100%;text-align:center;direction:ltr"><div class="spm-actions"><button class="btn sm ghost" id="invite-copy">' + ic('copy') + ' کپی لینک</button><button class="btn sm primary" id="invite-close">بستن</button></div></div>';
  document.body.appendChild(m);
  m.querySelector('.spm-backdrop').onclick = () => m.remove();
  m.querySelector('#invite-close').onclick = () => m.remove();
  m.querySelector('#invite-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('لینک دعوت کپی شد'); } catch (e) { toast(url); } };
}
async function renderUsers(wrap) {
  wrap.innerHTML = '<div class="ph-loading">در حال بارگذاری کاربران…</div>';
  const d = await (await api('/api/admin/users')).json().catch(() => ({ users: [] }));
  const users = d.users || [];
  let h = '<div class="admin-users">';
  h += '<div class="au-tools"><input id="au-search" class="inp" placeholder="جستجوی کاربر…" style="flex:1"><button class="btn sm" id="au-refresh">بازخوانی</button></div>';
  h += '<div class="au-tabs"><button class="btn sm glass au-tab-btn active" data-tab="all">همه</button><button class="btn sm glass au-tab-btn" data-tab="danger">متخلف</button><button class="btn sm glass au-tab-btn" data-tab="restricted">محدود</button></div>';
  h += '<div class="au-list">';
  users.forEach((u) => {
    const cat = (u.danger ? 'danger' : '') + (u.restricted ? ' restricted' : '');
    h += '<div class="au-row" data-u="' + esc(u.username) + '" data-cat="' + (cat || 'normal') + '">' + avatarEl(u, 'md').outerHTML +
      '<div class="au-body"><div class="au-name">' + esc(u.displayName || u.username) + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '') + (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + (u.danger ? ' <span class="badge ban">⚠ خطرناک</span>' : '') + (u.restricted ? ' <span class="badge ban">⛔ محدود</span>' : '') + '</div><div class="au-sub">@' + esc(u.username) + (u.phone ? ' • ' + esc(u.phone) : '') + ' • ' + (u.online ? 'آنلاین' : 'آفلاین') + '</div></div>' +
      '<div class="au-actions"><button class="btn sm" data-act="profile">پروفایل</button><button class="btn sm ghost" data-act="msgs">پیام‌ها</button>' +
      (u.isAdmin ? '' : '<button class="btn sm danger" data-act="ban">' + (u.banned ? 'رفع مسدودی' : 'مسدود') + '</button>') +
      (u.isAdmin ? '' : '<button class="btn sm glass" data-act="limit">' + (u.restricted ? 'رفع محدودیت' : 'محدود') + '</button>') + '</div></div>';
  });
  h += '</div></div>';
  wrap.innerHTML = h;
  wrap.querySelector('#au-refresh').onclick = () => renderUsers(wrap);
  let activeTab = 'all';
  const reDraw = () => { const q = (wrap.querySelector('#au-search').value || '').toLowerCase(); wrap.querySelectorAll('.au-row').forEach((r) => { const t = r.textContent.toLowerCase(); const c = (r.dataset.cat || 'normal'); let showTab = activeTab === 'all' ? true : c.split(' ').includes(activeTab); r.style.display = (showTab && t.includes(q)) ? '' : 'none'; }); };
  wrap.querySelector('#au-search').oninput = reDraw;
  wrap.querySelectorAll('.au-tab-btn').forEach((tb) => tb.onclick = () => { activeTab = tb.dataset.tab; wrap.querySelectorAll('.au-tab-btn').forEach((x) => x.classList.toggle('active', x === tb)); reDraw(); });
  wrap.querySelectorAll('.au-row').forEach((row) => {
    const u = row.dataset.u; const cur = users.find((x) => x.username === u);
    row.querySelector('[data-act="profile"]').onclick = () => openProfile(u);
    row.querySelector('[data-act="msgs"]').onclick = () => viewUserMessages(u);
    const ban = row.querySelector('[data-act="ban"]'); if (ban) ban.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u, banned: !cur.banned }) }); renderUsers(wrap); };
    const lim2 = row.querySelector('[data-act="limit"]'); if (lim2) lim2.onclick = async () => { if (cur.restricted) { await api('/api/admin/restrict', { method: 'POST', body: JSON.stringify({ username: u, restricted: false }) }); } else { await api('/api/admin/restrict', { method: 'POST', body: JSON.stringify({ username: u, restricted: true, maxFileMB: 100, filesPerDay: 5 }) }); } renderUsers(wrap); };
  });
  luc();
}
async function viewUserMessages(username) {
  const modal = document.createElement('div'); modal.className = 'modal-ov';
  modal.innerHTML = '<div class="modal wide"><h3 class="modal-title">پیام‌های @' + esc(username) + '</h3><div class="modal-body" id="um-body"><div class="ph-loading">در حال بارگذاری…</div></div><div class="modal-actions"><button class="btn ghost" id="um-close">بستن</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('#um-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  const body = modal.querySelector('#um-body');
  try {
    const rd = await (await api('/api/admin/user/' + encodeURIComponent(username) + '/rooms')).json();
    const rooms = rd.rooms || [];
    let all = [];
    for (const room of rooms) {
      const md = await (await api('/api/admin/room/messages?roomId=' + encodeURIComponent(room.roomId))).json();
      (md.messages || []).forEach((m) => { all.push(Object.assign({ _room: room.title || room.roomId }, m)); });
    }
    all.sort((a, b) => (a.time || 0) - (b.time || 0));
    if (!all.length) { body.innerHTML = '<div class="placeholder">پیامی یافت نشد.</div>'; return; }
    let h = '<div class="um-list">';
    all.forEach((m) => { h += '<div class="um-row"><span class="um-room">' + esc(m._room) + '</span><span class="um-time">' + new Date(m.time || Date.now()).toLocaleString('fa-IR') + '</span><span class="um-text">' + esc(previewText(m)) + '</span></div>'; });
    h += '</div>';
    body.innerHTML = h;
  } catch (e) { body.innerHTML = '<div class="placeholder">خطا در بارگذاری.</div>'; }
}
async function renderSignups(wrap) {
  wrap.innerHTML = '<div class="ph-loading">در حال بارگذاری درخواست‌ها…</div>';
  const d = await (await api('/api/admin/requests')).json().catch(() => ({ requests: [] }));
  const list = (d.requests || []).filter((s) => s.status === 'pending');
  state.signupCount = list.length; renderNav();
  if (!list.length) { wrap.innerHTML = '<div class="placeholder">درخواست تغییر نام جدیدی نیست.</div>'; return; }
  let h = '<div class="signup-list">';
  list.forEach((s) => {
    h += '<div class="signup-row" data-id="' + esc(s.id) + '"><div class="su-body"><div class="su-name">' + esc(s.newName || s.username) + '</div><div class="su-sub">@' + esc(s.username) + ' • نام فعلی: ' + esc(s.oldName || '—') + '</div></div><div class="su-actions"><button class="btn sm primary" data-act="approve">تایید</button><button class="btn sm danger" data-act="reject">رد</button></div></div>';
  });
  h += '</div>';
  wrap.innerHTML = h;
  wrap.querySelectorAll('.signup-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-act="approve"]').onclick = async () => { await api('/api/admin/requests/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ approve: true }) }); toast('نام تغییر کرد'); renderSignups(wrap); };
    row.querySelector('[data-act="reject"]').onclick = async () => { await api('/api/admin/requests/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ approve: false }) }); toast('درخواست رد شد'); renderSignups(wrap); };
  });
  luc();
}
async function renderReports(wrap) {
  wrap.innerHTML = '<div class="ph-loading">در حال بارگذاری گزارشات…</div>';
  const d = await (await api('/api/admin/reports')).json().catch(() => ({ reports: [] }));
  const list = d.reports || [];
  let h = '<div class="admin-users">';
  if (!list.length) h += '<div class="placeholder">گزارشی وجود ندارد.</div>';
  list.forEach((r, i) => {
    const who = r.fromName || r.fromUsername || '';
    h += '<div class="report-card' + (r.type === 'suspicious-image' ? ' danger' : '') + '">'
      + '<div class="report-head">' + (r.type === 'suspicious-image' ? 'گزارش خیلی مهم' : 'گزارش') + '</div>'
      + (r.filename ? '<img class="report-img" src="/uploads/' + esc(r.filename) + '">' : '')
      + '<div><b>کاربر:</b> ' + esc(who) + ' (@' + esc(r.fromUsername || '') + ')</div>'
      + '<div><b>شناسه عددی:</b> ' + esc(String(r.fromUid || '')) + ' <b>تلفن:</b> ' + esc(r.fromPhone || '') + '</div>'
      + '<div><b>IP:</b> ' + esc(r.ip || '') + ' <b>دستگاه:</b> ' + esc(r.device || '') + '</div>'
      + '<div><b>تاریخ:</b> ' + esc(new Date(r.time || Date.now()).toLocaleString('fa-IR')) + '</div>'
      + '<div><b>چت/گروه:</b> ' + esc(r.roomId || '') + '</div>'
      + '<div><b>متن/اطلاعات مشکوک:</b><pre>' + esc(r.excerpt || r.reason || '') + '</pre></div>'
      + '<div class="report-actions">'
      + '<button class="btn sm glass danger" data-act="del">حذف</button>'
      + '<button class="btn sm glass" data-act="ign">نادیده گرفتن</button>'
      + '</div></div>';
  });
  h += '</div>';
  wrap.innerHTML = h;
  wrap.querySelectorAll('.report-img').forEach((img) => img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  wrap.querySelectorAll('[data-act="del"]').forEach((b, i) => b.onclick = async () => { if (!(await uConfirm('حذف شود؟'))) return; await api('/api/admin/reports/' + encodeURIComponent(list[i].id) + '/delete-message', { method: 'POST' }); renderReports(wrap); });
  wrap.querySelectorAll('[data-act="ign"]').forEach((b, i) => b.onclick = async () => { await api('/api/admin/reports/' + encodeURIComponent(list[i].id) + '/ignore', { method: 'POST' }); renderReports(wrap); });
}
async function renderAudit(wrap) {
  wrap.innerHTML = '<div class="ph-loading">در حال بارگذاری حسابرسی…</div>';
  try {
    const d = await (await api('/api/admin/audit')).json().catch(() => ({ audit: [] }));
    const labels = { impersonate: 'ورود به حساب', promote: 'ارتقا/تنزل', ban: 'مسدودسازی', 'reset-password': 'ریست رمز', restrict: 'محدودسازی', 'room-messages-read': 'خواندن پیام‌های اتاق' };
    const rows = [...(d.audit || [])].reverse();
    if (!rows.length) { wrap.innerHTML = '<div class="placeholder">رویداد حسابرسی ثبت نشده است.</div>'; return; }
    let h = '<div class="admin-users"><div class="au-list">';
    rows.forEach((entry) => {
      h += '<div class="au-row"><div class="au-body"><div class="au-name">' + esc(labels[entry.action] || entry.action) + '</div>'
        + '<div class="au-sub">کنشگر: ' + esc(entry.actor || '') + ' • هدف: ' + esc(entry.target || '') + ' • ' + esc(new Date(entry.time || Date.now()).toLocaleString('fa-IR')) + '</div>'
        + '<div class="au-sub">' + esc(JSON.stringify(entry.details || {})) + '</div></div></div>';
    });
    h += '</div></div>';
    wrap.innerHTML = h;
  } catch (e) { wrap.innerHTML = '<div class="placeholder">خطا در بارگذاری حسابرسی.</div>'; }
  luc();
}
async function renderStats(wrap) {
  wrap.innerHTML = '<div class="ph-loading">در حال بارگذاری آمار…</div>';
  try {
    const d = await (await api('/api/admin/stats')).json();
    const stats = [
      { label: 'کل کاربران', value: d.totalUsers, icon: 'users' },
      { label: 'آنلاین', value: d.onlineUsers, icon: 'wifi' },
      { label: 'گروه‌ها و کانال‌ها', value: d.totalGroups, icon: 'users' },
      { label: 'کل پیام‌ها', value: d.totalMessages, icon: 'message-square' },
      { label: 'پیام‌های امروز', value: d.msgsToday, icon: 'calendar' },
      
      { label: 'کاربران مسدود', value: d.bannedUsers, icon: 'user-x' },
      { label: 'پریمیوم', value: d.premiumUsers, icon: 'crown' },
      { label: 'فایل‌های آپلود', value: d.totalUploads, icon: 'upload' },
    ];
    let h = '<div class="stats-grid">';
    stats.forEach((s) => { h += '<div class="stat-card"><div class="stat-ic">' + ic(s.icon) + '</div><div class="stat-val">' + (s.value || 0) + '</div><div class="stat-lbl">' + s.label + '</div></div>'; });
    h += '</div>';
    wrap.innerHTML = h;
  } catch (e) { wrap.innerHTML = '<div class="placeholder">خطا در بارگذاری آمار.</div>'; }
  luc();
}
function renameModal(current, onOk) {
  const ov = document.createElement('div'); ov.className = 'modal-ov';
  ov.innerHTML = '<div class="modal"><h3 class="modal-title">تغییر نام نمایشی</h3><input id="rm-input" class="inp" maxlength="25" value="' + esc(current || '') + '" /><div class="modal-actions"><button class="btn ghost" id="rm-cancel">انصراف</button><button class="btn primary" id="rm-ok">تأیید</button></div></div>';
  document.body.appendChild(ov);
  const input = ov.querySelector('#rm-input');
  setTimeout(() => input.focus(), 40);
  const close = () => ov.remove();
  ov.querySelector('#rm-cancel').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  const ok = async () => { const v = input.value.trim(); if (v.length < 2) { toast('نام باید حداقل ۲ کاراکتر باشد'); return; } await onOk(v); close(); };
  ov.querySelector('#rm-ok').onclick = ok;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') close(); });
}
function promptRename() {
  renameModal(state.me.displayName || '', async (v) => {
    const r = await api('/api/rename', { method: 'POST', body: JSON.stringify({ displayName: v }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && (d.applied || d.ok)) { if (d.me) Object.assign(state.me, d.me); else state.me.displayName = v; renderNav(); renderDock(); buildChatList(); if (state.nav === 'settings') renderView('settings'); toast('نام نمایشی تغییر کرد'); }
    else if (r.ok && d.applied === false) toast('درخواست تغییر نام ثبت شد؛ منتظر تایید ادمین باشید');
    else toast(d.error || 'خطا در تغییر نام');
  });
}
function renameUser(username, current, cb) {
  renameModal(current || '', async (v) => {
    const r = await api('/api/admin/displayname', { method: 'POST', body: JSON.stringify({ username, displayName: v }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast('نام کاربر تغییر کرد'); const du = await (await api('/api/admin/users')).json().catch(() => ({})); if (du.users) state.users = du.users; if (cb) cb(v); } else toast(d.error || 'خطا');
  });
}
function openProfile(username, explicitReturnRoom) {
  if (explicitReturnRoom !== undefined) {
    state.profileReturnRoom = explicitReturnRoom || null;
    state.profileReturnNav = explicitReturnRoom ? 'chats' : (state.nav || 'contacts');
  } else {
    const inChatsMode = viewHost ? viewHost.classList.contains('hidden') : state.nav === 'chats';
    if (inChatsMode && state.room) {
      state.profileReturnRoom = state.room;
      state.profileReturnNav = 'chats';
    } else {
      state.profileReturnRoom = null;
      state.profileReturnNav = state.nav || 'contacts';
    }
  }
  renderProfile(username);
}
function profileGoBack() {
  const retRoom = state.profileReturnRoom;
  const retNav = state.profileReturnNav;
  state.profileReturnRoom = null;
  state.profileReturnNav = null;
  if (retRoom) { openRoom(retRoom); return; }
  if (retNav && retNav !== 'chats') { renderView(retNav); return; }
  if (state.room) { openRoom(state.room); return; }
  switchNav('chats');
}
function renderProfile(username) {
  if (isMobile()) closeDrawers();
  if (isMobile()) vxPush({ vx: 1, nav: state.nav || 'chats', room: state.room || null, view: 'profile:' + username, overlay: 1 });
  let u = (state.me.username === username) ? state.me : (state.users || []).find((x) => x.username === username);
  if (!u) { api('/api/user/' + encodeURIComponent(username)).then((r) => r.json()).then((d) => { if (d.u) { state.users = state.users || []; if (!state.users.find((x) => x.username === d.u.username)) state.users.push(d.u); renderProfile(username); } else { setMode('view'); viewHost.innerHTML = '<div class="placeholder">پروفایل یافت نشد.</div>'; } }).catch(() => { setMode('view'); viewHost.innerHTML = '<div class="placeholder">خطا در بارگذاری پروفایل.</div>'; }); return; }
  setMode('view');
  const online = !!u.online;
  const skin = SKINS.find((s) => s.id === (u.activeSkin || 'default'));
  const effId = ''; // Effects disabled — backup in _effects-backup.css
  const eff = null;
  const premium = false;
  const mood = '';
  const colHex = '#3b82f6';
  const isCanvasEffect = false;
  const sa = ' data-uid="' + esc(username) + '"';
  const badge = (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '');
  let h = '<div class="profile-view"' + sa + ' role="region" aria-labelledby="profile-title">';
  if (u.profileBg) h += '<div class="profile-bg" style="background-image:url(\'' + esc(u.profileBg) + '\')" aria-hidden="true"></div>';
  h += '<div class="profile-top"><button class="btn sm ghost" data-act="back" aria-label="بازگشت">' + ic('chevron-right') + ' بازگشت</button></div>';
  h += '<div class="profile-hero">';
  h += '<div class="profile-av">' + avatarEl(u, 'xl').outerHTML + '</div>';
  h += '<h2 class="profile-name" id="profile-title">' + esc(u.displayName || u.username) + badge + '</h2>';
  h += '<div class="profile-uname">@' + esc(u.username) + (online ? ' <span class="onl">● آنلاین</span>' : '') + '</div></div>';
  if (u.bio) h += '<div class="profile-bio">' + esc(u.bio) + '</div>';
  if (u.phone && (state.me.isAdmin || u.username === state.me.username)) h += '<div class="profile-row">📱 ' + esc(u.phone) + '</div>';
  h += '<div class="profile-actions">';
  h += '<button class="btn primary" data-act="chat">شروع چت</button>';
  if (state.me.isAdmin) {
    h += '<button class="btn" data-act="rename">تغییر نام</button>';
    h += '<button class="btn" data-act="premium">' + (u.isPremium ? 'حذف پرمیوم' : 'پرمیوم‌سازی') + '</button>';
    if (u.username !== state.me.username) {
      h += '<button class="btn" data-act="impersonate">ورود به حساب کاربر</button>';
      if (u.isAdmin) h += '<button class="btn danger" data-act="demote">حذف ادمین</button>';
      else h += '<button class="btn" data-act="promote">ارتقا به ادمین</button>';
      h += '<button class="btn danger" data-act="ban">' + (u.banned ? 'رفع مسدودی' : 'مسدودسازی') + '</button>';
      h += '<button class="btn danger" data-act="reset-pass">تغییر رمز کاربر</button>';
    }
  }
  if (u.username === state.me.username) {
    h += '<div class="profile-edit">';
    h += '<button class="btn sm ghost" data-act="av-up">تغییر عکس</button>';
    h += '<button class="btn sm ghost" data-act="bg-up">پس‌زمینه</button>';
    h += '<button class="btn sm ghost" data-act="bg-gallery">گالری پینترست</button>';
    h += '<button class="btn sm ghost" data-act="pin-toggle">' + (pinIsSet() ? 'غیرفعال کردن PIN' : 'قفل PIN') + '</button>';
    h += '</div>';
    h += '<input type="file" id="prof-file" accept="image/*" style="display:none" data-target="avatar">';
  }
  h += '</div></div>';
  viewHost.innerHTML = h;
  /* hand focus to the screen we just mounted so keyboard/SR users are not dropped */
  const pv = viewHost.querySelector('.profile-view');
  if (pv) { pv.tabIndex = -1; try { pv.focus({ preventScroll: true }); } catch (e) {} }
  viewHost.querySelector('[data-act="back"]').onclick = () => profileGoBack();
  viewHost.querySelector('[data-act="chat"]').onclick = () => openDM(username);
  const rn = viewHost.querySelector('[data-act="rename"]'); if (rn) rn.onclick = () => renameUser(username, u.displayName, () => renderProfile(username));
  const pr = viewHost.querySelector('[data-act="premium"]'); if (pr) pr.onclick = async () => { await api('/api/admin/premium', { method: 'POST', body: JSON.stringify({ username, isPremium: !u.isPremium }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const bn = viewHost.querySelector('[data-act="ban"]'); if (bn) bn.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username, banned: !u.banned }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const imp = viewHost.querySelector('[data-act="impersonate"]'); if (imp) imp.onclick = () => enterAsUser(username);
  const pm = viewHost.querySelector('[data-act="promote"]'); if (pm) pm.onclick = async () => { await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ username, scope: 'global', role: 'admin' }) }); toast('کاربر به ادمین ارتقا یافت'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const dm = viewHost.querySelector('[data-act="demote"]'); if (dm) dm.onclick = async () => { if (!(await uConfirm('ادمین بودن @' + username + ' حذف شود؟'))) return; await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ username, scope: 'global', role: 'member' }) }); toast('از ادمینی حذف شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const rp = viewHost.querySelector('[data-act="reset-pass"]'); if (rp) rp.onclick = async () => {
    const np = await uPrompt('رمز جدید برای @' + username + ' (حداقل ۴ کاراکتر):', '', 'رمز جدید');
    if (!np) return;
    const r = await api('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ username, newPassword: np }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast(d.error || 'خطا');
    toast('رمز @' + username + ' بازنشانی شد 👌');
  };
  if (state.me.isAdmin) {
    const sec = document.createElement('div'); sec.className = 'profile-files';
    sec.innerHTML = '<h3>' + ic('paperclip') + ' فایل‌های ارسالی</h3><div class="pf-body ph-loading">در حال بارگذاری…</div>';
    viewHost.querySelector('.profile-view').appendChild(sec);
    api('/api/admin/user/' + encodeURIComponent(username) + '/files').then((r) => r.json()).then((d) => {
      const imgs = d.images || [], auds = d.audios || [], vids = d.videos || [], fils = d.files || [], links = d.links || [];
      const total = imgs.length + auds.length + vids.length + fils.length + links.length;
      if (!total) { sec.querySelector('.pf-body').innerHTML = '<div class="placeholder">فایلی ارسال نشده است.</div>'; return; }
      let h = '';
      if (imgs.length) { h += '<div class="pf-group"><b>تصاویر (' + imgs.length + ')</b><div class="pf-grid">' + imgs.map((m) => '<a class="pf-thumb" href="' + esc(m.src || '') + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(m.src || '') + '" loading="lazy"></a>').join('') + '</div></div>'; }
      if (vids.length) { h += '<div class="pf-group"><b>ویدیو (' + vids.length + ')</b><div class="pf-grid">' + vids.map((m) => '<a class="pf-thumb" href="' + esc(m.src || '') + '" target="_blank" rel="noopener noreferrer">' + ic('video') + '</a>').join('') + '</div></div>'; }
      if (auds.length) { h += '<div class="pf-group"><b>صدا (' + auds.length + ')</b>' + auds.map((m) => '<div class="pf-audio"><button type="button" aria-label="پخش ' + escAttr(m.name || 'پیام صوتی') + '">' + ic('play') + '</button><audio src="' + esc(m.src || '') + '" preload="none"></audio><span>' + esc(m.name || 'ویس') + '</span></div>').join('') + '</div>'; }
      if (fils.length) { h += '<div class="pf-group"><b>فایل‌ها (' + fils.length + ')</b>' + fils.map((m) => '<div class="pf-file"><a href="' + esc(m.src || '') + '" download>' + ic('file') + esc(m.name || 'فایل') + '</a></div>').join('') + '</div>'; }
      if (links.length) { h += '<div class="pf-group"><b>لینک‌ها (' + links.length + ')</b>' + links.map((m) => '<div class="pf-link"><a href="' + esc(m.url || '') + '" target="_blank" rel="noopener noreferrer">' + ic('link') + esc(String(m.url || '').slice(0, 60)) + '</a></div>').join('') + '</div>'; }
      sec.querySelector('.pf-body').innerHTML = h;
      /* inline onclick is blocked by script-src 'self' — wire playback in JS */
      sec.querySelectorAll('.pf-audio button').forEach((b) => {
        b.onclick = () => { const a = b.nextElementSibling; if (!a || typeof a.play !== 'function') return; if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); } else a.pause(); };
      });
    }).catch(() => { sec.querySelector('.pf-body').innerHTML = '<div class="placeholder">خطا در بارگذاری.</div>'; });
  }
  const pf = viewHost.querySelector('#prof-file');
  if (pf) {
    pf.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const target = pf.dataset.target;
      pf.value = '';
      if (target === 'avatar') {
        openAvatarCrop(f, (blob, name) => uploadProfileFile(blob, name, 'avatar', () => renderProfile(username)));
      } else {
        uploadProfileFile(f, f.name, 'background', () => renderProfile(username));
      }
    };
  }
  const avUp = viewHost.querySelector('[data-act="av-up"]'); if (avUp) avUp.onclick = () => { if (pf) { pf.dataset.target = 'avatar'; pf.click(); } };
  const bgUp = viewHost.querySelector('[data-act="bg-up"]'); if (bgUp) bgUp.onclick = () => { if (pf) { pf.dataset.target = 'bg'; pf.click(); } };
  const bgGal = viewHost.querySelector('[data-act="bg-gallery"]'); if (bgGal) bgGal.onclick = () => openGallery('backgrounds', (url) => {
    api('/api/profile/background/url', { method: 'POST', body: JSON.stringify({ url }) }).then((r) => r.json()).then((d) => { if (d.me) state.me = d.me; toast('پس‌زمینه از گالری تنظیم شد'); renderProfile(username); }).catch(() => toast('خطا در تنظیم پس‌زمینه'));
  });
  const pinT = viewHost.querySelector('[data-act="pin-toggle"]'); if (pinT) pinT.onclick = () => {
    if (pinIsSet()) { localStorage.removeItem(PIN_LS); toast('PIN غیرفعال شد'); }
    else { pinShow('set'); }
  };
  luc();
}
function uploadProfileFile(blob, name, target, onDone) {
  const fd = new FormData(); fd.append('file', blob, name || 'avatar.png');
  toast('در حال آپلود…');
  fetch('/api/profile/' + (target === 'bg' ? 'background' : 'avatar'), { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd })
    .then((r) => r.json()).then((d) => { if (d.me) state.me = d.me; toast(target === 'bg' ? 'پس‌زمینه تنظیم شد' : 'عکس پروفایل تغییر کرد'); if (onDone) onDone(d); })
    .catch(() => toast('خطا در آپلود'));
}
// ویرایش عکس پروفایل: کاربر قسمت موردنظر را جابه‌جا/زوم می‌کند و فقط همان قسمت آپلود می‌شود
function openAvatarCrop(file, onDone) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    const SIZE = 512, VIEW = 260;
    let zoom = 1, ox = 0, oy = 0;
    const minZoom = (img.naturalWidth > 0 && img.naturalHeight > 0)
      ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
    const m = document.createElement('div'); m.className = 'modal-ov';
    m.innerHTML = '<div class="modal crop-modal"><div class="modal-head"><b>برش تصویر</b><button class="icon-btn" data-close aria-label="بستن برش تصویر">✕</button></div>'
      + '<h3 class="modal-title">' + ic('crop') + ' تنظیم عکس پروفایل</h3>'
      + '<div class="crop-stage" id="crop-stage"><div class="crop-img" id="crop-img"></div><div class="crop-grid"></div></div>'
      + '<div class="crop-controls"><span class="crop-ico">' + ic('zoom-out') + '</span><input type="range" id="crop-zoom" min="0" max="100" value="0" aria-label="بزرگ‌نمایی"><span class="crop-ico">' + ic('zoom-in') + '</span></div>'
      + '<div class="crop-tip">تصویر را بکشید و با اسلایدر بزرگ‌نمایی کنید — دقیقاً همین قسمت برای بقیه قابل مشاهده است</div>'
      + '<div class="modal-actions"><button class="btn ghost" id="crop-cancel">' + ic('x') + ' انصراف</button><button class="btn primary" id="crop-ok">' + ic('check') + ' تایید و آپلود</button></div></div>';
    document.body.appendChild(m);
    applyIcons(m);
    const stage = m.querySelector('#crop-stage');
    const imgEl = m.querySelector('#crop-img');
    imgEl.style.backgroundImage = 'url(' + url + ')';
    function apply() {
      const dispW = img.naturalWidth * zoom, dispH = img.naturalHeight * zoom;
      const maxX = Math.max(0, dispW - VIEW), maxY = Math.max(0, dispH - VIEW);
      if (ox < 0) ox = 0; if (ox > maxX) ox = maxX;
      if (oy < 0) oy = 0; if (oy > maxY) oy = maxY;
      imgEl.style.backgroundSize = dispW + 'px ' + dispH + 'px';
      imgEl.style.backgroundPosition = (-ox) + 'px ' + (-oy) + 'px';
    }
    let dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
    const start = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      dragging = true; sx = t.clientX; sy = t.clientY; sox = ox; soy = oy;
      if (ev.cancelable) ev.preventDefault();
    };
    const move = (ev) => {
      if (!dragging) return;
      const t = ev.touches ? ev.touches[0] : ev;
      ox = sox + (t.clientX - sx); oy = soy + (t.clientY - sy);
      apply();
      if (ev.cancelable) ev.preventDefault();
    };
    const end = () => { dragging = false; };
    stage.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    stage.addEventListener('touchstart', start, { passive: false });
    stage.addEventListener('touchmove', move, { passive: false });
    stage.addEventListener('touchend', end, { passive: true });
    const zoomInput = m.querySelector('#crop-zoom');
    zoomInput.addEventListener('input', () => { zoom = minZoom + (zoomInput.value / 100) * 4; apply(); });
    zoom = minZoom; apply();
    m.querySelector('#crop-cancel').onclick = cleanup;
    m.querySelector('#crop-ok').onclick = () => {
      const cv = document.createElement('canvas'); cv.width = SIZE; cv.height = SIZE;
      const ctx = cv.getContext('2d');
      const srcX = ox / zoom, srcY = oy / zoom, srcW = VIEW / zoom, srcH = VIEW / zoom;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, SIZE, SIZE);
      cv.toBlob((b) => { cleanup(); if (b) onDone(b, 'avatar.png'); else toast('خطا در آماده‌سازی تصویر'); }, 'image/png', 0.92);
    };
    function cleanup() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      const esc = m._esc; if (esc) document.removeEventListener('keydown', esc);
      URL.revokeObjectURL(url);
      m.remove();
    }
    m._esc = (e) => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', m._esc);
    m.onclick = (e) => { if (e.target === m) cleanup(); };
  };
  img.onerror = () => { toast('خطا در خواندن تصویر'); URL.revokeObjectURL(url); };
  img.src = url;
}
function openGallery(dir, cb) {
  if (document.getElementById('gallery-modal')) return;
  const m = document.createElement('div'); m.id = 'gallery-modal'; m.className = 'modal-overlay';
  m.innerHTML = '<div class="modal"><div class="modal-head"><b>انتخاب از گالری</b><button class="icon-btn" data-close aria-label="بستن گالری">✕</button></div>' +
    '<div class="gallery-grid" id="gallery-grid"><div class="placeholder">در حال بارگذاری…</div></div>' +
    '<div class="modal-foot">تصویرهایی که از پینترست دانلود کردی رو توی پوشهٔ <code>public/img/' + dir + '</code> بریز تا اینجا نمایش داده شوند.</div></div>';
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('[data-close]').onclick = close;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.classList.contains('modal')) close(); });
  api('/api/images?dir=' + dir).then((r) => r.json()).then((d) => {
    const g = m.querySelector('#gallery-grid');
    if (!d.images || !d.images.length) { g.innerHTML = '<div class="placeholder">هنوز تصویری نیست. فایل‌ها رو در <code>public/img/' + dir + '</code> قرار بده.</div>'; return; }
    g.innerHTML = d.images.map((u) => '<button class="gallery-item" data-url="' + u + '"><img src="' + u + '" loading="lazy"></button>').join('');
    g.querySelectorAll('.gallery-item').forEach((b) => b.onclick = () => { close(); cb(b.dataset.url); });
  }).catch(() => { m.querySelector('#gallery-grid').innerHTML = '<div class="placeholder">خطا در بارگذاری گالری.</div>'; });
}
async function enterAsUser(username) {
  if (!(await uConfirm('وارد حساب @' + username + ' می‌شوید؟ پس از ورود می‌توانید با دکمه بازگشت به پنل ادمین برگردید.'))) return;
  localStorage.setItem('ft_admin_token', state.token);
  api('/api/admin/impersonate', { method: 'POST', body: JSON.stringify({ username }) }).then((r) => r.json()).then((d) => { if (d.token) { localStorage.setItem('ft_token', d.token); localStorage.removeItem('ft_me'); localStorage.removeItem('ft_me_ts'); location.reload(); } else toast(d.error || 'خطا'); });
}
function showImpersonateBanner() {
  if (!localStorage.getItem('ft_admin_token')) return;
  const me = (state.me && state.me.username) || '';
  let b = $('imp-banner');
  if (!b) { b = document.createElement('div'); b.id = 'imp-banner'; b.className = 'imp-banner'; document.body.appendChild(b); }
  b.innerHTML = 'شما به عنوان @' + esc(me) + ' وارد شده‌اید <button id="imp-back">بازگشت به پنل ادمین</button>';
  b.querySelector('#imp-back').onclick = () => { const t = localStorage.getItem('ft_admin_token'); if (t) { localStorage.setItem('ft_token', t); localStorage.removeItem('ft_admin_token'); localStorage.removeItem('ft_me'); localStorage.removeItem('ft_me_ts'); location.reload(); } };
}
async function startGroup(isChannel) {
  const name = await uPrompt('نام ' + (isChannel ? 'کانال' : 'گروه') + ':');
  if (!name) return;
  const body = { name: name, type: isChannel ? 'channel' : 'group' };
  if (isChannel) {
    const uid = await uPrompt('آیدی کانال (۳-۲۰ حرف/عدد/_، مثل my_channel):');
    if (uid === null) return;
    if (uid.trim()) body.username = uid.trim().replace(/^@/, '').toLowerCase();
    const vis = await uPrompt('نوع کانال:\n1 = عمومی (همه ببینند/جستجو کنند)\n2 = خصوصی (فقط با لینک)');
    if (vis === null) return;
    body.visibility = String(vis).trim() === '1' ? 'public' : 'private';
    const desc = await uPrompt('توضیح کانال (اختیاری):');
    if (desc === null) return;
    if (desc.trim()) body.description = desc.trim().slice(0, 200);
    const cats = ['tech', 'finance', 'sports', 'culture', 'fun', 'learn', 'media', 'games', 'study', 'other'];
    const cat = await uPrompt('دسته کانال (اختیاری):\n' + cats.map((c, i) => (i + 1) + ' = ' + GROUP_CAT_LABELS[c]).join('\n'));
    if (cat === null) return;
    const catIdx = parseInt(String(cat).trim(), 10);
    if (catIdx >= 1 && catIdx <= cats.length) body.category = cats[catIdx - 1];
  }
  const d = await (await api('/api/groups', { method: 'POST', body: JSON.stringify(body) })).json();
  if (!d.group || !d.group.id) { toast(d.error || 'ساخت گروه ناموفق بود'); return; }
  d.group.avatar = null;
  state.groups.push(d.group);
  if (state.ws) state.ws.send(JSON.stringify({ type: 'groups', groups: state.groups }));
  openRoom('group:' + d.group.id);
  setTimeout(async () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('avatar', f);
      const res = await fetch('/api/groups/' + d.group.id + '/avatar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + state.token }, body: fd });
      const r = await res.json();
      if (r.ok) { toast('آواتار ' + (isChannel ? 'کانال' : 'گروه') + ' تنظیم شد'); const g = state.groups.find((x) => x.id === d.group.id); if (g) g.avatar = r.avatar; buildChatList(); }
      input.remove();
    };
    if (await uConfirm('آیا می‌خواهید آواتار برای ' + (isChannel ? 'کانال' : 'گروه') + ' انتخاب کنید؟')) input.click(); else input.remove();
  }, 500);
}

/* THEME */
function cycleTheme() { const themes = ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light', 'ios']; const cur = localStorage.getItem('vx_theme') || 'cyber'; const idx = (themes.indexOf(cur) + 1) % themes.length; localStorage.setItem('vx_theme', themes[idx]); applyAppearance(); toast('تم: ' + themes[idx]); }
function applyVX() { $('app').classList.add('vx'); document.documentElement.style.setProperty('--radius', localStorage.getItem('vx_radius') || '18px'); }

/* FONT SIZE (settings) */
function setFont(delta) { state.fontScale = Math.max(12, Math.min(20, state.fontScale + delta)); localStorage.setItem('vx_fontsize', state.fontScale); applyAppearance(); }

/* AI PANEL */
async function aiOnMessage(roomId) { const inp = $('ai-input'); const text = inp.value.trim(); if (!text) return; inp.value = ''; appendAIMsg('user', text); const loading = appendAIMsg('bot', 'در حال فکر کردن…'); try { const d = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'ask', roomId: roomId, text: text }) })).json(); loading.textContent = d.result || d.error || 'پاسخی دریافت نشد'; } catch (e) { loading.textContent = 'خطا: ' + e.message; } }
function appendAIMsg(role, text) { const box = $('ai-conv'); const el = document.createElement('div'); el.className = 'ai-msg ' + role; el.textContent = text; box.appendChild(el); box.scrollTop = box.scrollHeight; return el; }

/* VIEW ROUTER */
function renderView(id) {
  setMode('view'); viewHost.classList.remove('hidden'); viewHost.innerHTML = ''; viewHost.dataset.view = id;
  const title = NAV.find((n) => n.id === id);
  let icon = (title && title.icon) || 'layout';
  let label = title ? title.label : id;
  const subCat = (id === 'settings' && state.settingsCat && state.settingsCat !== 'main') ? state.settingsCat : null;
  if (subCat && SETCATS[subCat]) { icon = SETCATS[subCat].icon; label = '<span class="crumb">تنظیمات</span>' + SETCATS[subCat].title; }
  const h = document.createElement('div'); h.className = 'view-head';
  h.innerHTML = '<button class="icon-btn view-back" id="view-back" aria-label="' + (subCat ? 'بازگشت به تنظیمات' : 'بازگشت') + '"><i data-lucide="chevron-right" class="icon"></i></button>' + ic(icon) + '<h2>' + label + '</h2>';
  viewHost.appendChild(h);
  const back = h.querySelector('#view-back'); if (back) back.onclick = () => { if (subCat) { state.settingsCat = 'main'; renderView('settings'); } else switchNav('chats'); };
  const wrap = document.createElement('div'); wrap.className = 'view-body'; viewHost.appendChild(wrap);
  if (id === 'ai') {
    wrap.innerHTML = '<div class="ai-card"><div class="ai-conv" id="ai-conv"></div><div class="ai-input-row"><input id="ai-input" placeholder="از دستیار بپرس…" /><button id="ai-send">' + ic('send') + '</button></div><div class="ai-actions"><button data-a="summarize">' + ic('file-text') + ' خلاصه چت</button><button data-a="reply">' + ic('corner-down-left') + ' پیشنهاد پاسخ</button><button data-a="translate">' + ic('languages') + ' ترجمه</button><button data-a="rewrite">' + ic('edit-3') + ' بازنویسی</button></div></div>';
    $('ai-send').onclick = () => aiOnMessage(state.room); $('ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') aiOnMessage(state.room); });
    wrap.querySelectorAll('.ai-actions button').forEach((b) => b.onclick = async () => { const a = b.dataset.a; if (a === 'summarize' && !state.room) return toast('اول یک چت باز کن'); if (a === 'reply' && !state.room) return toast('اول یک چت باز کن'); const act = a === 'summarize' ? 'summarize' : a === 'reply' ? 'reply' : a === 'translate' ? 'translate' : 'rewrite'; const d = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: act, roomId: state.room, text: $('ai-input').value }) })).json(); appendAIMsg('bot', d.result || d.error || ''); });
  } else if (id === 'contacts') { renderContacts(wrap); }
  else if (id === 'settings') {
    const cat = state.settingsCat || 'main';
    if (cat !== 'main') {
      renderSettingsSub(cat, wrap);
    } else {
      renderSettingsMain(wrap);
    }
  }   else if (id === 'communities') { wrap.innerHTML = groupsHTML('group'); bindGroupCards(wrap); }
  else if (id === 'channels') { wrap.innerHTML = groupsHTML('channel'); bindGroupCards(wrap); }
  else if (id === 'discover') { renderDiscover(wrap); }
  else if (id === 'cloud') { wrap.innerHTML = '<div class="placeholder">☁️ حافظه ابری — فایل‌های شما اینجا نمایش داده می‌شوند. (نمونه)</div>'; }
  else if (id === 'tasks') { renderTasks(wrap); }
  else if (id === 'calendar') { renderCalendar(wrap); }
  else if (id === 'bookmarks') { renderBookmarksInto(wrap); }
  else if (id === 'users') { if (state.me.isAdmin) renderUsers(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'signups') { if (state.me.isAdmin) renderSignups(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'reports') { if (state.me.isAdmin) renderReports(wrap); else wrap.innerHTML = '<div class="placeholder">دسترسی ندارید.</div>'; }
  else if (id === 'stats') { if (state.me.isAdmin) renderStats(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'audit') { if (state.me.isAdmin) renderAudit(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else { wrap.innerHTML = '<div class="placeholder">این بخش در نسخه نمایشی در دسترس است.</div>'; }
  luc();
}
function gridCard(id, name, em) { return '<div class="grid-card" data-gc="' + id + '"><div class="gc-ic">' + em + '</div><div class="gc-name">' + name + '</div></div>'; }
async function renderDiscover(wrap) {
  wrap.innerHTML = '<div class="disc-sec"><div class="skeleton" style="height:120px"></div></div><div class="disc-sec"><div class="skeleton" style="height:120px"></div></div>';
  try {
    const d = await (await api('/api/groups/explore')).json().catch(() => ({}));
    const list = (d && d.groups) || [];
    if (!list.length) { wrap.innerHTML = '<div class="empty-state"><div class="es-ic">🧭</div><div class="es-title">کانال عمومی‌ای برای کشف نیست</div><div class="es-sub">بعداً دوباره سر بزنید</div></div>'; return; }
    const order = ['tech', 'finance', 'sports', 'culture', 'fun', 'learn', 'media', 'games', 'study', 'other'];
    const byCat = {};
    list.forEach((g) => { const c = (g.category && GROUP_CAT_LABELS[g.category]) ? g.category : 'other'; (byCat[c] = byCat[c] || []).push(g); });
    wrap.innerHTML = '';
    order.filter((c) => byCat[c] && byCat[c].length).forEach((c) => {
      const sec = document.createElement('div');
      sec.className = 'disc-sec';
      const head = document.createElement('div');
      head.className = 'disc-sec-t';
      head.textContent = GROUP_CAT_LABELS[c];
      const grid = document.createElement('div');
      grid.className = 'disc-grid';
      byCat[c].forEach((g) => grid.appendChild(exploreCardEl(g)));
      sec.appendChild(head); sec.appendChild(grid); wrap.appendChild(sec);
    });
  } catch (e) { wrap.innerHTML = '<div class="empty-state"><div class="es-ic">⚠️</div><div class="es-title">خطا در بارگذاری</div></div>'; }
}
function groupsHTML(type) { const gs = state.groups.filter((g) => g.type === type); if (!gs.length) return '<div class="placeholder">' + (type === 'channel' ? 'کانالی' : 'کامیونیتی‌ای') + ' یافت نشد. از منوی + ایجاد کنید.</div>'; return '<div class="group-list">' + gs.map((g) => '<div class="group-card" data-gid="' + g.id + '">' + avatarEl({ displayName: g.name }, 'md').outerHTML + '<div class="gc-name">' + esc(g.name) + '</div><div class="gc-sub">' + (Array.isArray(g.members) ? g.members.length : 0) + ' عضو</div></div>').join('') + '</div>'; }
function bindGroupCards(wrap) { wrap.querySelectorAll('.group-card').forEach((c) => { c.onclick = () => { const gid = c.dataset.gid; const me = state.me.username; const isMember = (() => { const g = state.groups.find((x) => x.id === gid); return g && g.members && g.members.some((m) => m.username === me); })(); if (isMember) openRoom('group:' + gid); else toast('ابتدا به گروه بپیوندید'); }; }); }

function manageGroup(g) {
  if (!g) return;
  const isCh = (g.type || 'group') === 'channel';
  const kindLbl = isCh ? 'کانال' : 'گروه';
  const pop = document.createElement('div'); pop.className = 'u-pop';
  pop.innerHTML =
    '<div class="u-pop-box mg-pop" style="width:min(420px,92vw)">' +
      '<div class="u-pop-title">مدیریت ' + kindLbl + '</div>' +
      '<div class="mg-row"><label>نام</label><input class="inp" data-k="name" value="' + esc(g.name || '') + '" maxlength="30" /></div>' +
      (isCh ? '<div class="mg-row"><label>آیدی (شناسه)</label><input class="inp" data-k="uname" value="' + esc(g.username || '') + '" placeholder="بدون @ — ۳ تا ۲۰ حرف/عدد/_" maxlength="20" dir="ltr" /></div>' : '') +
      (isCh ? '<div class="mg-row"><label>نوع کانال</label><div class="mg-seg">' +
        '<button class="btn sm" data-k="vis-pub" data-v="public">عمومی</button>' +
        '<button class="btn sm" data-k="vis-prv" data-v="private">خصوصی</button></div></div>' : '') +
      '<div class="mg-row"><label>توضیح</label><input class="inp" data-k="desc" value="' + esc(g.description || '') + '" maxlength="200" /></div>' +
      '<div class="mg-row mg-avatar"><label>عکس پروفایل</label><div class="mg-av-row"><span class="mg-av" data-k="avprev"></span>' +
        '<button class="btn sm" data-k="avpick">انتخاب عکس</button>' +
        '<button class="btn sm ghost" data-k="avclr">حذف</button></div></div>' +
      '<div class="u-pop-actions"><button class="btn sm ghost" data-k="0">انصراف</button><button class="btn sm" data-k="1">ذخیره</button></div>' +
    '</div>';
  document.body.appendChild(pop);
  const avPrev = pop.querySelector('[data-k="avprev"]');
  avPrev.className = 'av md mg-av';
  if (g.avatar) { const i = document.createElement('img'); i.src = g.avatar; avPrev.appendChild(i); } else avPrev.textContent = initial(g.name);
  let picked = null;
  pop.querySelector('[data-k="avpick"]').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      picked = f;
      const url = URL.createObjectURL(f);
      avPrev.innerHTML = '';
      const i = document.createElement('img'); i.src = url; avPrev.appendChild(i);
    };
    inp.click();
  };
  pop.querySelector('[data-k="avclr"]').onclick = () => { picked = 'clear'; avPrev.innerHTML = ''; avPrev.textContent = initial(g.name); };
  const visState = g.visibility || 'private';
  const paintVis = () => {
    pop.querySelectorAll('[data-k^="vis-"]').forEach((b) => {
      const on = b.dataset.v === visState;
      b.classList.toggle('primary', on);
      b.classList.toggle('ghost', !on);
    });
  };
  pop.querySelector('[data-k="vis-pub"]').onclick = () => { visState = 'public'; paintVis(); };
  pop.querySelector('[data-k="vis-prv"]').onclick = () => { visState = 'private'; paintVis(); };
  paintVis();
  pop.querySelector('[data-k="0"]').onclick = () => pop.remove();
  pop.querySelector('[data-k="1"]').onclick = async () => {
    const name = pop.querySelector('[data-k="name"]').value.trim();
    const uname = isCh ? pop.querySelector('[data-k="uname"]').value.trim().replace(/^@/, '').toLowerCase() : null;
    const desc = pop.querySelector('[data-k="desc"]').value.trim();
    if (!name) { toast('نام الزامی است'); return; }
    const body = { name };
    if (isCh) {
      body.username = uname || undefined;
      body.visibility = visState;
      body.description = desc || undefined;
      if (picked === 'clear') body.avatar = '';
    }
    const btn = pop.querySelector('[data-k="1"]'); btn.disabled = true; btn.textContent = '…';
    try {
      const res = await api('/api/groups/' + g.id, { method: 'PATCH', body: JSON.stringify(body) });
      const d = await res.json();
      if (!d.ok) { toast(d.error || 'ذخیره ناموفق'); btn.disabled = false; btn.textContent = 'ذخیره'; return; }
      Object.assign(g, d.group || {});
      if (picked && picked !== 'clear') {
        const fd = new FormData(); fd.append('avatar', picked);
        const ares = await fetch('/api/groups/' + g.id + '/avatar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + state.token }, body: fd });
        const ar = await ares.json();
        if (ar.ok) g.avatar = ar.avatar;
      }
      pop.remove();
      toast(kindLbl + ' ذخیره شد');
       renderRoomHeader(); buildChatList();
       if (state.ws) state.ws.send(JSON.stringify({ type: 'groups', groups: state.groups }));
    } catch (e) { toast('خطا: ' + e.message); btn.disabled = false; btn.textContent = 'ذخیره'; }
  };
  luc();
}
function getTasks() { try { return JSON.parse(localStorage.getItem('vx_tasks') || '[]'); } catch (e) { return []; } }
function setTasks(t) { localStorage.setItem('vx_tasks', JSON.stringify(t)); }
function renderTasks(wrap) {
  const tasks = getTasks();
  let h = '<div class="tasks-view"><div class="task-add"><input id="task-input" class="inp" placeholder="افزودن وظیفه جدید…" style="flex:1"><button class="btn sm primary" id="task-add">افزودن</button></div>';
  h += '<div class="task-list">';
  if (!tasks.length) h += '<div class="placeholder">وظیفه‌ای ندارید.</div>';
  tasks.forEach((t) => { h += '<div class="task-item' + (t.done ? ' done' : '') + '" data-id="' + t.id + '"><span class="cl-box" data-act="toggle">' + (t.done ? ic('check') : '') + '</span><span class="task-text">' + esc(t.text) + '</span><span class="task-x" data-act="del">' + ic('x') + '</span></div>'; });
  h += '</div></div>';
  wrap.innerHTML = h;
  const add = () => { const inp = wrap.querySelector('#task-input'); const v = inp.value.trim(); if (!v) return; const tasks = getTasks(); tasks.push({ id: 't' + Date.now(), text: v, done: false }); setTasks(tasks); renderTasks(wrap); };
  wrap.querySelector('#task-add').onclick = add;
  wrap.querySelector('#task-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  wrap.querySelectorAll('.task-item').forEach((it) => {
    const id = it.dataset.id;
    it.querySelector('[data-act="toggle"]').onclick = () => { const ts = getTasks(); const t = ts.find((x) => x.id === id); if (t) t.done = !t.done; setTasks(ts); renderTasks(wrap); };
    it.querySelector('[data-act="del"]').onclick = () => { setTasks(getTasks().filter((x) => x.id !== id)); renderTasks(wrap); };
  });
  luc();
}
function renderCalendar(wrap) {
  const now = new Date();
  const month = now.toLocaleDateString('fa-IR', { month: 'long', year: 'numeric' });
  let h = '<div class="cal"><div class="cal-head">' + month + '</div><div class="cal-grid">';
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let i = 1; i <= days; i++) h += '<div class="cal-day' + (i === now.getDate() ? ' today' : '') + '">' + i + '</div>';
  h += '</div></div>';
  const tasks = getTasks().filter((t) => !t.done);
  h += '<div class="cal-tasks"><h4>وظایف باقی‌مانده (' + tasks.length + ')</h4>';
  if (!tasks.length) h += '<div class="placeholder">وظیفه باز ندارید.</div>';
  tasks.forEach((t) => { h += '<div class="task-item" data-id="' + t.id + '"><span class="cl-box"></span><span class="task-text">' + esc(t.text) + '</span></div>'; });
  h += '</div>';
  wrap.innerHTML = h; luc();
}
function applyBackground() { document.documentElement.style.setProperty('--chat-bg', localStorage.getItem('vx_bg') || ''); if (localStorage.getItem('vx_bgimg')) document.documentElement.style.setProperty('--chat-bg-img', "url('" + localStorage.getItem('vx_bgimg') + "')"); else document.documentElement.style.removeProperty('--chat-bg-img'); if (window.VXDesign && window.VXDesign.syncWallpaper) window.VXDesign.syncWallpaper(); }
function persistActiveSkin() {
  const th = localStorage.getItem('vx_theme') || 'cyber';
  const ac = localStorage.getItem('vx_accent') || 'blue';
  const s = SKINS.find((x) => x.theme === th && x.accent === ac);
  const id = s ? s.id : 'default';
  localStorage.setItem('vx_skin', id);
  if (state.me) state.me.activeSkin = id;
  api('/api/skin', { method: 'POST', body: JSON.stringify({ skin: id }) }).catch(() => {});
}
const SETCATS = {
  account:       { title: 'حساب کاربری',     icon: 'user',        desc: 'نام، بیو، شناسه و دستگاه‌ها',     grp: 'حساب' },
  appearance:    { title: 'نمایش و تم',       icon: 'palette',     desc: 'تم، رنگ، فونت و گردی گوشه‌ها',      grp: 'ظاهر' },
  background:    { title: 'پس‌زمینه',         icon: 'image',       desc: 'رنگ یا تصویر پس‌زمینه گفتگو',        grp: 'ظاهر' },
  skins:         { title: 'اسکین‌ها و تم‌ها', icon: 'paintbrush',  desc: 'پوسته‌های آماده پیام‌رسان',          grp: 'ظاهر' },
  notifications: { title: 'اعلان‌ها',         icon: 'bell',        desc: 'اعلان دسکتاپ و هشدار صوتی',          grp: 'پیام‌رسانی' },
  privacy:       { title: 'حریم خصوصی',       icon: 'lock',        desc: 'دید آنلاین، شماره و رمز عبور',       grp: 'پیام‌رسانی' },
  storage:       { title: 'ذخیره‌سازی',       icon: 'hard-drive',  desc: 'حافظه رسانه‌ها و پاک‌سازی',           grp: 'پیام‌رسانی' },
  logout:        { title: 'خروج از حساب',     icon: 'log-out',     desc: 'خروج از این دستگاه',                 grp: 'نشست', action: 'logout' }
};
const SETGRP_ORDER = ['حساب', 'ظاهر', 'پیام‌رسانی', 'نشست'];

function setCatRow(k) {
  const v = SETCATS[k]; if (!v) return '';
  const danger = v.action === 'logout';
  return '<button type="button" class="set-cat' + (danger ? ' danger' : '') + '" data-cat="' + k + '"'
    + (v.action ? ' data-action="' + v.action + '"' : '')
    + ' aria-label="' + escAttr(v.title) + (v.desc ? '، ' + escAttr(v.desc) : '') + '">'
    + '<span class="set-cat-ic" aria-hidden="true">' + ic(v.icon) + '</span>'
    + '<span class="set-cat-txt"><b>' + v.title + '</b><small>' + v.desc + '</small></span>'
    + (danger ? '' : '<i data-lucide="chevron-left" class="icon set-cat-go" aria-hidden="true"></i>')
    + '</button>';
}
function renderSettingsMain(wrap) {
  const me = state.me || {};
  const body = document.createElement('div');
  body.className = 'settings-main';
  let h = '<button type="button" class="set-account" data-act="my-profile" aria-label="پروفایل من">'
    + '<span class="set-account-av" aria-hidden="true">' + avatarEl(me, 'md').outerHTML + '</span>'
    + '<span class="set-cat-txt"><b>' + esc(me.displayName || me.username || '') + '</b><small dir="ltr">@' + esc(me.username || '') + '</small></span>'
    + '<i data-lucide="chevron-left" class="icon set-cat-go" aria-hidden="true"></i></button>';
  SETGRP_ORDER.forEach((g) => {
    const keys = Object.keys(SETCATS).filter((k) => SETCATS[k].grp === g);
    if (!keys.length) return;
    h += '<div class="set-grp"><span>' + g + '</span></div><div class="set-rows">' + keys.map(setCatRow).join('') + '</div>';
  });
  body.innerHTML = h;
  wrap.appendChild(body);
  const mine = body.querySelector('[data-act="my-profile"]');
  if (mine) mine.onclick = () => openProfile(state.me.username);
  body.querySelectorAll('.set-cat').forEach((c) => {
    c.onclick = () => {
      if (c.dataset.action === 'logout') { logout(); return; }
      state.settingsCat = c.dataset.cat;
      renderView('settings');
    };
  });
  applyIcons(body);
}
function renderSettingsSub(cat, wrap) {
  Array.from(wrap.querySelectorAll('.settings-sub')).forEach((b) => b.remove());
  const body = document.createElement('div'); body.className = 'settings-sub';
  if (cat === 'appearance') renderAppSub(body);
  else if (cat === 'background') renderBgSub(body);
  else if (cat === 'account') renderAccSub(body);
  else if (cat === 'notifications') renderNotifSub(body);
  else if (cat === 'privacy') renderPrivSub(body);
  else if (cat === 'storage') renderStorageSub(body);
  else if (cat === 'skins') renderSkinsSub(body);
  else if (cat === 'effects') renderEffectsSub(body);
  else if (cat === 'logout') logout();
  wrap.appendChild(body);
  applyIcons(body);
}
/* Phase 5A — a compact chip-row renderer for the appearance page. Every chip is
   a real <button> with aria-pressed, wired in JS (inline handlers never fire
   under our CSP). */
function setChipRow(attr, list, active, labelFn) {
  return '<div class="chip-row">' + list.map((x) => {
    const on = x === active;
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-' + attr + '="' + escAttr(String(x)) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(labelFn ? labelFn(x) : String(x)) + '</button>';
  }).join('') + '</div>';
}
function renderAppSub(body) {
  const D = window.VXDesign;
  const themes = D ? D.themes : ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light', 'ios', 'amoled'];
  const accents = D ? D.accents : ['blue', 'purple', 'cyan', 'green', 'pink', 'orange', 'red', 'ios'];
  const THEME_LABEL = { cyber: 'سایبر', midnight: 'نیمه‌شب', 'midnight-rose': 'رز شبانه', matrix: 'ماتریکس', synthwave: 'سینث‌ویو', sunset: 'غروب', forest: 'جنگل', light: 'روشن', ios: 'آی‌اواس', amoled: 'مشکی AMOLED' };
  const ACCENT_LABEL = { blue: 'آبی', purple: 'بنفش', cyan: 'فیروزه‌ای', green: 'سبز', pink: 'صورتی', orange: 'نارنجی', red: 'قرمز', ios: 'آبی iOS', indigo: 'نیلی', teal: 'سبزآبی', amber: 'کهربایی', rose: 'گل‌بهی', violet: 'بنفش روشن', sky: 'آسمانی', lime: 'لیمویی' };
  const RADIUS_LABEL = { sharp: 'تیز', compact: 'کم', round: 'گرد', pill: 'قرصی' };
  const AUTO_LABEL = { off: 'خاموش', system: 'هماهنگ با سیستم', schedule: 'زمان‌بندی' };
  const curTheme = localStorage.getItem('vx_theme') || 'cyber';
  const curAccent = localStorage.getItem('vx_accent') || 'blue';
  const curRadius = D ? D.bubbleRadius : 'round';
  const curAurora = D ? D.aurora : true;
  const curReduce = D ? D.reduceGlass : false;
  const curAuto = D ? D.themeAuto : 'off';

  let t = '<div class="settings-sec"><h3>' + ic('palette') + ' تم</h3>' + setChipRow('theme-btn', themes, curTheme, (x) => THEME_LABEL[x] || x) + '</div>';
  t += '<div class="settings-sec"><h3>' + ic('droplet') + ' رنگ اکسنت</h3>' + setChipRow('accent-btn', accents, curAccent, (x) => ACCENT_LABEL[x] || x);
  t += '<div class="set-custom-accent"><label for="set-accent-custom">رنگ سفارشی</label><input type="color" id="set-accent-custom" value="' + escAttr(localStorage.getItem('vx_accent_custom') || '#6ea8fe') + '" aria-label="انتخاب رنگ اکسنت سفارشی"></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('moon') + ' حالت شب خودکار</h3>' + setChipRow('themeauto', ['off', 'system', 'schedule'], curAuto, (x) => AUTO_LABEL[x] || x) + '</div>';
  t += '<div class="settings-sec"><h3>' + ic('sparkles') + ' پس‌زمینه متحرک</h3>' + setChipRow('aurora', ['on', 'off'], curAurora ? 'on' : 'off', (x) => (x === 'on' ? 'روشن' : 'خاموش')) + '</div>';
  t += '<div class="settings-sec"><h3>' + ic('maximize-2') + ' گردی حباب پیام</h3>' + setChipRow('radius', ['sharp', 'compact', 'round', 'pill'], curRadius, (x) => RADIUS_LABEL[x] || x) + '</div>';
  t += '<div class="settings-sec"><h3>' + ic('layers') + ' کیفیت شیشه</h3>' + setChipRow('glassmode', ['full', 'reduce'], curReduce ? 'reduce' : 'full', (x) => (x === 'full' ? 'کامل (بلور)' : 'سبک (بدون بلور)')) + '<p class="settings-hint">حالت سبک برای دستگاه‌های ضعیف: بدون بلور، با رنگ‌های نیمه‌شفاف.</p></div>';
  t += '<div class="settings-sec"><h3>' + ic('type') + ' اندازه فونت</h3><div class="stepper"><button type="button" id="set-font-dec" aria-label="کوچک‌تر">−</button><span id="fs-val" aria-live="polite">' + (state.fontScale) + '</span><button type="button" id="set-font-inc" aria-label="بزرگ‌تر">+</button></div></div>';
  const fonts = [['default', 'پیش‌فرض'], ['messenger', 'پیام‌رسان'], ['classic', 'کلاسیک'], ['modern', 'مدرن']];
  const curFont = localStorage.getItem('vx_font') || 'default';
  t += '<div class="settings-sec"><h3>' + ic('type') + ' فونت</h3>' + setChipRow('font', fonts.map((f) => f[0]), curFont, (k) => (fonts.find((f) => f[0] === k) || [])[1]) + '</div>';
  t += '<div class="settings-sec"><h3>' + ic('maximize-2') + ' گردی گوشه‌ها</h3><input type="range" id="set-radius" min="6" max="28" value="' + (parseInt(localStorage.getItem('vx_radius') || '18', 10)) + '" aria-label="گردی گوشه‌ها"></div>';
  body.innerHTML = t;

  body.querySelectorAll('[data-theme-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_theme', b.dataset.themeBtn); applyAppearance(); persistActiveSkin(); renderAppSub(body); });
  body.querySelectorAll('[data-accent-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_accent', b.dataset.accentBtn); applyAppearance(); persistActiveSkin(); renderAppSub(body); });
  const cus = body.querySelector('#set-accent-custom');
  if (cus) cus.oninput = (e) => { const D2 = window.VXDesign; if (D2) D2.setAccent('custom', e.target.value); persistActiveSkin(); body.querySelectorAll('[data-accent-btn]').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); };
  body.querySelectorAll('[data-themeauto]').forEach((b) => b.onclick = () => { const D2 = window.VXDesign; if (D2) D2.setThemeAuto(b.dataset.themeauto); renderAppSub(body); });
  body.querySelectorAll('[data-aurora]').forEach((b) => b.onclick = () => { const D2 = window.VXDesign; if (D2) D2.setAurora(b.dataset.aurora === 'on'); renderAppSub(body); });
  body.querySelectorAll('[data-radius]').forEach((b) => b.onclick = () => { const D2 = window.VXDesign; if (D2) D2.setBubbleRadius(b.dataset.radius); renderAppSub(body); });
  body.querySelectorAll('[data-glassmode]').forEach((b) => b.onclick = () => { const D2 = window.VXDesign; if (D2) D2.setReduceGlass(b.dataset.glassmode === 'reduce'); renderAppSub(body); });
  body.querySelector('#set-font-dec').onclick = () => setFont(-1);
  body.querySelector('#set-font-inc').onclick = () => setFont(1);
  body.querySelector('#set-radius').oninput = (e) => { localStorage.setItem('vx_radius', e.target.value + 'px'); applyVX(); };
  body.querySelectorAll('[data-font]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_font', b.dataset.font); applyAppearance(); renderAppSub(body); });
  applyIcons(body);
}
function renderBgSub(body) {
  let t = '<div class="settings-sec"><h3>' + ic('palette') + ' رنگ پس‌زمینه</h3><input type="color" id="set-bg" value="' + (localStorage.getItem('vx_bg') || '#0a0a14') + '"></div>';
  t += '<div class="settings-sec"><h3>' + ic('image') + ' تصویر پس‌زمینه</h3><input type="file" id="set-bgimg" accept="image/*">';
  t += '<button class="btn sm ghost" id="set-bg-reset">حذف تصویر</button></div>';
  body.innerHTML = t;
  const bg = body.querySelector('#set-bg'); if (bg) bg.oninput = (e) => { localStorage.setItem('vx_bg', e.target.value); applyBackground(); };
  const bgi = body.querySelector('#set-bgimg'); if (bgi) bgi.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { localStorage.setItem('vx_bgimg', rd.result); applyBackground(); toast('تصویر پس‌زمینه تنظیم شد'); }; rd.readAsDataURL(f); };
  const bgr = body.querySelector('#set-bg-reset'); if (bgr) bgr.onclick = () => { localStorage.removeItem('vx_bgimg'); applyBackground(); toast('تصویر حذف شد'); };
}
function renderAccSub(body) {
  let t = '<div class="settings-sec"><h3>' + ic('user') + ' اطلاعات حساب</h3>';
  t += '<div class="settings-row"><span>نام نمایشی</span><b>' + esc(state.me.displayName) + '</b><button class="btn sm" data-act="rename-display">تغییر</button></div>';
  t += '<div class="settings-row"><span>نام کاربری</span><b>@' + esc(state.me.username) + '</b></div>';
  t += '<div class="settings-row"><span>شناسه کاربری (UID)</span><b data-uid="' + esc(state.me.username) + '">' + (state.me.uid ? esc(state.me.uid) : '…') + '</b></div>';
  t += '<div class="settings-row"><span>شماره</span><b>' + esc(state.me.phone || '—') + '</b></div>';
  t += '<div class="settings-row"><span>بیو</span><input class="inp" id="acc-bio" aria-label="بیوی شما" maxlength="' + (state.me.isPremium ? 200 : 80) + '" placeholder="درباره خودت…" value="' + esc(state.me.bio || '') + '" style="max-width:220px"></div>';
  t += '<div class="settings-row"><span>وضعیت</span><b>' + (state.me.isPremium ? 'پریمیوم' : 'رایگان') + (state.me.isAdmin ? ' • ادمین' : '') + '</b></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('smartphone') + ' دستگاه‌های متصل</h3><div id="acc-devices" class="acc-devices">در حال بارگذاری…</div></div>';
  body.innerHTML = t;
  /* CSP is script-src 'self' — inline onclick never fires, so wire it here */
  const rnBtn = body.querySelector('[data-act="rename-display"]');
  if (rnBtn) rnBtn.onclick = () => promptRename();
  const bioSave = () => {
    const v = body.querySelector('#acc-bio').value.trim();
    api('/api/profile/bio', { method: 'POST', body: JSON.stringify({ bio: v }) }).then((r) => r.json()).then((d) => { if (!d.ok) { toast(d.error || 'خطا'); return; } if (d.me) state.me = d.me; toast('بیو ذخیره شد'); }).catch(() => toast('خطا'));
  };
  const bio = body.querySelector('#acc-bio'); if (bio) bio.addEventListener('change', bioSave);
  /* اگر نسخهٔ قدیمی سرور هنوز uid را برنگرداند، یک‌بار از /api/me می‌خوانیم */
  if (typeof state.me.uid !== 'number') {
    const cell = body.querySelector('[data-uid]');
    api('/api/user/' + encodeURIComponent(state.me.username)).then((r) => r.json()).then((d) => {
      if (d && d.u && typeof d.u.uid === 'number' && cell) cell.textContent = d.u.uid;
    }).catch(() => {});
  }
  api('/api/profile/devices').then((r) => r.json()).then((d) => {
    const box = body.querySelector('#acc-devices');
    if (!box) return;
    const devs = Array.isArray(d.devices) ? d.devices : [];
    if (!devs.length) { box.innerHTML = '<div class="placeholder">هنوز دستگاهی ثبت نشده است.</div>'; return; }
    const devIcon = (p) => { if (p === 'web') return 'globe'; if (p === 'tablet' || p === 'ios' || p === 'android') return 'smartphone'; return 'cpu'; };
    const rows = devs.map((x) => {
      const title = x.device || 'مرورگر';
      const det = [];
      if (x.os) det.push(x.os + (x.osVersion ? ' ' + x.osVersion : ''));
      if (x.model) det.push(x.model);
      const spec = det.join(' • ');
      const seen = 'آخرین بازدید: ' + (x.lastLogin ? fmt(x.lastLogin) : '—');
      const meta = spec + (spec && x.ip && x.ip !== '?' ? '<br>' : '') + seen + (x.ip && x.ip !== '?' ? ' • IP: ' + esc(x.ip) : '');
      return '<div class="dev-row"><span class="dev-ic">' + ic(devIcon(x.platform)) + '</span><span class="dev-info"><b>' + esc(title) + (x.app ? ' <i class="dev-tag">' + esc(x.appVersion || 'اپ') + '</i>' : '') + '</b><small>' + meta + '</small></span></div>';
    }).join('');
    box.innerHTML = '<div class="settings-row"><span>تعداد دستگاه</span><b>' + devs.length + '</b></div>' + rows;
    box.querySelectorAll('.dev-row').forEach((el) => applyIcons(el));
  }).catch(() => { const box = body.querySelector('#acc-devices'); if (box) box.innerHTML = '<div class="placeholder">خطا در بارگذاری.</div>'; });
  luc();
}
function renderNotifSub(body) {
  let t = '<div class="settings-sec"><h3>' + ic('bell') + ' اعلان‌ها</h3><div class="settings-row"><span>اعلان مرورگر</span><button class="btn sm" id="set-notif">' + ((localStorage.getItem('vx_notify') === '1') ? 'روشن' : 'خاموش') + '</button></div></div>';
  body.innerHTML = t;
  const nb = body.querySelector('#set-notif'); if (nb) nb.onclick = async () => { if (!('Notification' in window)) { toast('مرورگر پشتیبانی نمی‌کند'); return; } const p = await Notification.requestPermission(); localStorage.setItem('vx_notify', p === 'granted' ? '1' : '0'); nb.textContent = p === 'granted' ? 'روشن' : 'خاموش'; toast(p === 'granted' ? 'اعلان روشن شد' : 'اعلان خاموش شد'); };
}
function fmtBytes(n) { if (!n) return '۰ بایت'; if (n < 1024) return n + ' بایت'; if (n < 1048576) return (n / 1024).toFixed(1) + ' کیلوبایت'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' مگابایت'; return (n / 1073741824).toFixed(2) + ' گیگابایت'; }
async function vxMediaUsage() {
  try {
    const db = await vxIdb();
    return await new Promise((res) => {
      const tx = db.transaction(VX_STORE, 'readonly'); const st = tx.objectStore(VX_STORE); let n = 0, bytes = 0;
      const rq = st.openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { n++; bytes += (c.value && c.value.size) || 0; c.continue(); } else res({ n, bytes }); };
      rq.onerror = () => res({ n: 0, bytes: 0 });
    });
  } catch (e) { return { n: 0, bytes: 0 }; }
}
async function vxRoomsCount() {
  try {
    const db = await roomsIdb();
    return await new Promise((res) => { const rq = db.transaction(ROOMS_STORE, 'readonly').objectStore(ROOMS_STORE).count(); rq.onsuccess = () => res(rq.result || 0); rq.onerror = () => res(0); });
  } catch (e) { return 0; }
}
const _waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function clearMediaCache() {
  const u = await vxMediaUsage();
  if (!u.n) { toast('حافظه پنهان رسانه خالی است'); return; }
  const total = fmtBytes(u.bytes);
  if (!(await uConfirm(u.n + ' فایل رسانه (' + total + ') پاک شود؟ پیام‌ها و گفتگوها دست‌نخورده می‌مانند.'))) return;

  const rand = (a, b) => a + Math.random() * (b - a);
  let chips = '', pts = '';
  for (let i = 0; i < 8; i++) chips += '<span class="cm-chip" style="--a:' + Math.round(i * 45 + rand(-8, 8)) + 'deg;--d:' + (i * 0.09 + rand(0, 0.12)).toFixed(2) + 's"></span>';
  for (let i = 0; i < 10; i++) pts += '<span class="cm-pt" style="--x:' + rand(18, 82).toFixed(1) + '%;--y:' + rand(30, 70).toFixed(1) + '%;--tx:' + Math.round(rand(-48, 48)) + 'px;--ty:' + Math.round(rand(-72, -28)) + 'px;--dt:' + rand(1.8, 3.2).toFixed(2) + 's;--dd:' + rand(0, 1.8).toFixed(2) + 's"></span>';
  const ov = document.createElement('div'); ov.className = 'cm-overlay';
  ov.innerHTML = '<div class="cm-stage">' + pts + '<span class="cm-beam"></span>' +
    '<div class="cm-orbit"><div class="cm-core">' + ic('trash-2') + '</div>' + chips + '</div>' +
    '<div class="cm-count"><b>0</b> فایل پاک شد</div>' +
    '<div class="cm-cap">در حال پاک‌سازی حافظه پنهان…</div>' +
    '<div class="cm-bar"><i></i></div>' +
    '<div class="cm-note">پیام‌ها، پروفایل‌ها، گروه‌ها و کانال‌ها دست‌نخورده می‌مانند</div>' +
    '<div class="cm-burst"><span></span><span></span><span></span></div>' +
    '</div>';
  document.body.appendChild(ov);
  const bar = ov.querySelector('.cm-bar i');
  const bEl = ov.querySelector('.cm-count b');
  const capEl = ov.querySelector('.cm-cap');
  let cleared = 0, shown = 0, pumpId = null;
  const setTarget = () => {
    shown = Math.min(cleared, shown + Math.max(1, Math.ceil((cleared - shown) / 4)));
    bEl.textContent = shown;
    bar.style.width = (u.n ? Math.round(shown / u.n * 100) : 0) + '%';
  };
  const pump = () => { if (shown < cleared) { setTarget(); pumpId = requestAnimationFrame(pump); } else pumpId = null; };
  const t0 = performance.now();
  try {
    const db = await vxIdb();
    await new Promise((res, rej) => {
      const tx = db.transaction(VX_STORE, 'readwrite');
      const cur = tx.objectStore(VX_STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return res(); c.delete(); cleared++; if (!pumpId) pumpId = requestAnimationFrame(pump); c.continue(); };
      cur.onerror = () => rej(cur.error);
    });
  } catch (e) {
    ov.remove(); toast('خطا در پاک‌سازی حافظه پنهان'); return;
  }
  bEl.textContent = u.n; bar.style.width = '100%'; capEl.textContent = 'همه پاک شد ✓';
  await _waitMs(Math.max(0, 1200 - (performance.now() - t0)));
  const core = ov.querySelector('.cm-core'); if (core) core.innerHTML = ic('check');
  ov.classList.add('cm-done');
  await _waitMs(760);
  ov.classList.add('cm-out');
  await _waitMs(420);
  ov.remove();
  toast('حافظه پنهان رسانه پاک شد (' + total + ')');
  const pv = document.querySelector('.view-body.settings-sub'); if (pv && pv.parentElement) renderSettingsSub('storage', pv.parentElement);
}
function renderStorageSub(body) {
  let t = '<div class="settings-sec"><h3>' + ic('image') + ' نمایش GIF</h3>';
  t += '<div class="settings-row"><span>پخش پشت‌سرهم GIFها</span><label class="switch"><input type="checkbox" id="st-gif-loop"' + (gifLoopEnabled() ? ' checked' : '') + '><span class="slider"></span></label></div>';
  t += '<p class="hint" style="margin:10px 0 12px;text-align:right;">اگر خاموش باشد، هر GIF فقط یک‌بار پخش می‌شود و روی آخرین فریم می‌ایستد.</p></div>';
  t += '<div class="settings-sec"><h3>' + ic('hard-drive') + ' حافظه پنهان دستگاه</h3>';
  t += '<div class="settings-row"><span>عکس‌ها، فیلم‌ها و فایل‌ها</span><b id="st-media">در حال بررسی…</b></div>';
  t += '<div class="settings-row"><span>پیام‌ها و چت‌های کش‌شده</span><b id="st-rooms">در حال بررسی…</b></div>';
  t += '<p class="hint" style="margin:10px 0 12px;text-align:right;">این عمل فقط فایل‌های رسانه را از همین دستگاه حذف می‌کند تا فضا آزاد شود؛ پیام‌ها، پروفایل کاربران، گروه‌ها و کانال‌ها دست‌نخورده می‌مانند. فایل‌های حذف‌شده در صورت دیدن دوباره، دوباره دانلود می‌شوند.</p>';
  t += '<button class="btn danger" id="st-clear" style="width:100%;justify-content:center;">' + ic('trash-2') + ' پاک کردن حافظه پنهان رسانه</button>';
  t += '</div>';
  body.innerHTML = t;
  const gl = body.querySelector('#st-gif-loop');
  if (gl) gl.onchange = () => {
    localStorage.setItem('vx_gif_loop', gl.checked ? '1' : '0');
    toast(gl.checked ? 'GIFها پشت‌سرهم پخش می‌شوند' : 'هر GIF فقط یک‌بار پخش می‌شود');
  };
  vxMediaUsage().then((u) => { const el = $('st-media'); if (el) el.textContent = u.n ? (u.n + ' فایل — ' + fmtBytes(u.bytes)) : 'خالی است'; });
  vxRoomsCount().then((n) => { const el = $('st-rooms'); if (el) el.textContent = n ? (n + ' گفتگو-') : 'خالی است'; });
  const cb = body.querySelector('#st-clear'); if (cb) cb.onclick = clearMediaCache;
}
function renderPrivSub(body) {
  const ptoggle = (key, label) => '<div class="settings-row"><span>' + label + '</span><label class="switch"><input type="checkbox" id="priv-' + key + '" ' + (localStorage.getItem(key) !== '0' ? 'checked' : '') + '><span class="slider"></span></label></div>';
  const hasPw = !!(state.me && state.me.hasPassword);
  let t = '<div class="settings-sec"><h3>' + ic('lock') + ' حریم خصوصی</h3>';
  t += ptoggle('vx_online', 'نمایش وضعیت آنلاین');
  t += ptoggle('vx_lastseen', 'نمایش آخرین بازدید');
  t += ptoggle('vx_showphone', 'نمایش شماره به دیگران');
  t += ptoggle('vx_acceptall', 'پذیرش پیام از همه');
  t += '</div>';
  t += '<div class="settings-sec"><h3>' + ic('key') + ' رمز عبور</h3>';
  t += '<div class="settings-row"><span>وضعیت رمز</span><b>' + (hasPw ? 'فعال' : 'غیرفعال — حساب با پیامک ساخته شده') + '</b></div>';
  t += '<div class="settings-row' + (hasPw ? '' : ' hidden') + '"><span>رمز فعلی</span><input type="password" id="pw-current" class="inp" autocomplete="current-password" placeholder="••••••" style="max-width:150px"></div>';
  t += '<div class="settings-row"><span>رمز جدید</span><input type="password" id="pw-new" class="inp" placeholder="حداقل ۴ کاراکتر" autocomplete="new-password" style="max-width:150px"></div>';
  t += '<div class="settings-row"><span>تکرار رمز جدید</span><input type="password" id="pw-new2" class="inp" placeholder="تکرار" style="max-width:150px"></div>';
  t += '<button class="btn sm primary" id="pw-save">' + (hasPw ? 'تغییر رمز عبور' : 'ساخت رمز عبور') + '</button>';
  t += '<div class="pw-note">بعد از ساخت رمز می‌توانید از صفحه ورود با «رمز عبور» وارد شوید.</div>';
  t += '</div>';
  body.innerHTML = t;
  ['vx_online', 'vx_lastseen', 'vx_showphone', 'vx_acceptall'].forEach((k) => { const el = body.querySelector('#priv-' + k); if (el) el.onchange = (e) => { localStorage.setItem(k, e.target.checked ? '1' : '0'); toast('تنظیمات حریم خصوصی ذخیره شد'); }; });
  const save = body.querySelector('#pw-save');
  if (save) save.onclick = async () => {
    const cur = hasPw ? (body.querySelector('#pw-current') ? body.querySelector('#pw-current').value : '') : '';
    const n1 = body.querySelector('#pw-new').value;
    const n2 = body.querySelector('#pw-new2').value;
    if (!n1 || n1.length < 4) return toast('رمز جدید حداقل ۴ کاراکتر باشد');
    if (n1 !== n2) return toast('تکرار رمز جدید مطابقت ندارد');
    try {
      const r = await api('/api/password-change', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: n1 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast(d.error || 'خطا');
      toast('رمز عبور ذخیره شد — لطفاً دوباره وارد شوید');
      logout(true);
    } catch (e) { toast('خطا: ' + e.message); }
  };
}
const SKINS = [
  { id: 'default', name: 'پیش‌فرض', price: 0, theme: 'cyber', accent: 'blue', mood: 'happy', desc: 'تم پیش‌فرض ورتیکس' },
  { id: 'dark-rose', name: 'میدنايت رز', price: 50000, theme: 'midnight-rose', accent: 'pink', mood: 'sad', desc: 'تم تاریک با آکسنت صورتی' },
  { id: 'matrix', name: 'متریکس', price: 120000, theme: 'matrix', accent: 'green', mood: 'scary', desc: 'سبزهای کلاسیک متریکس' },
  { id: 'synth', name: 'سنتویو', price: 250000, theme: 'synthwave', accent: 'purple', mood: 'happy', desc: 'نئونی رنگارنگ ۸۰‌ها' },
  { id: 'sunset', name: 'سنست', price: 400000, theme: 'sunset', accent: 'orange', mood: 'happy', desc: 'گرماهای غروب آفتاب' },
  { id: 'forest', name: 'جنگل', price: 600000, theme: 'forest', accent: 'green', mood: 'calm', desc: 'سبزهای طبیعی و آرام‌بخش' },
  { id: 'light', name: 'نور', price: 800000, theme: 'light', accent: 'blue', mood: 'calm', desc: 'تم روشن و مینیمال' },
  { id: 'ios', name: 'آی‌او‌اس', price: 0, theme: 'ios', accent: 'ios', mood: 'calm', desc: 'ظاهر مینیمال و تمیز آی‌او‌اس با شیشه‌مات' },
  { id: 'premium-black', name: 'ولولت', price: 1000000, theme: 'midnight', accent: 'cyan', mood: 'scary', desc: 'فاخرترین تم — طلایی و سیاهی' }
];
const EFFECT_PALETTES = {
  red: '#ff3b5c', pink: '#ff5bd1', purple: '#a855f7', blue: '#3b82f6',
  cyan: '#22d3ee', green: '#22c55e', lime: '#a3e635', orange: '#fb923c',
  gold: '#f5c518', white: '#e8ecff', ice: '#8fd9ff', violet: '#7c3aed',
};
const EFFECT_FAMILIES = [
  { id: 'scary',  name: 'ترسناک',   desc: 'حاله و بال‌های تاریک با اخگرهای بالارونده', colors: ['red', 'purple', 'orange'] },
  { id: 'happy',  name: 'شاد',      desc: 'بال‌های پرجنب‌وجوش و ذرات رنگی جست‌وخیز', colors: ['pink', 'cyan', 'lime', 'gold'] },
  { id: 'sad',    name: 'غم‌انگیز', desc: 'حاله آبی ملایم با باران آرام', colors: ['blue', 'cyan', 'ice'] },
  { id: 'calm',   name: 'آرام',     desc: 'حاله نرم و ذرات شناور', colors: ['green', 'blue', 'white'] },
  { id: 'neon',   name: 'نئون',     desc: 'درخشش نئونی دیجیتال', colors: ['cyan', 'pink', 'green', 'purple'] },
  { id: 'fire',   name: 'آتش',      desc: 'شعله‌های گداخته و اخگر', colors: ['orange', 'red', 'gold'] },
  { id: 'ice',    name: 'یخ',       desc: 'بلورهای سرد و درخشش یخی', colors: ['ice', 'cyan', 'blue'] },
  { id: 'gold',   name: 'طلایی',    desc: 'جلال طلایی و حلقه براق', colors: ['gold', 'orange', 'white'] },
  { id: 'galaxy', name: 'کهکشان',   desc: 'ستاره‌های کیهانی و مه رنگی', colors: ['purple', 'blue', 'pink'] },
  { id: 'love',   name: 'عشق',      desc: 'قلب‌های صورتی و حاله گرم', colors: ['pink', 'red', 'gold'] },
  { id: 'nature', name: 'طبیعت',    desc: 'برگ‌های سبز و نسیم', colors: ['green', 'lime', 'cyan'] },
  { id: 'cyber',  name: 'سایبر',    desc: 'مدارهای دیجیتال و نور', colors: ['cyan', 'green', 'violet'] },
  { id: 'mystic', name: 'مرموز',    desc: 'جادوی بنفش و ذرات درخشان', colors: ['purple', 'pink', 'blue'] },
  { id: 'royal',  name: 'سلطنتی',   desc: 'بنفش شاهانه و زر', colors: ['purple', 'gold', 'red'] },
  { id: 'sunset', name: 'غروب',     desc: 'گرمای غروب و پرتوهای نارنجی', colors: ['orange', 'red', 'gold', 'pink'] },
  { id: 'aurora', name: 'شفق',      desc: 'شفق قطبی سبز و بنفش', colors: ['green', 'cyan', 'violet'] },
  { id: 'orbit',  name: 'مداری',    desc: 'ذرات در حال چرخش دور آواتار', colors: ['cyan', 'purple', 'gold', 'pink'] },
  { id: 'rings',  name: 'حلقه‌ها',  desc: 'امواج حلقوی از مرکز', colors: ['blue', 'cyan', 'pink', 'green'] },
  { id: 'flame',  name: 'شعله',     desc: 'شعله‌های رنگین از پایین', colors: ['orange', 'red', 'gold', 'pink'] },
  { id: 'sparkle',name: 'درخشش',    desc: 'ستاره‌های چشمک‌زن', colors: ['gold', 'cyan', 'pink', 'white'] },
  { id: 'pulse',  name: 'نبض',      desc: 'موج‌های نورانی از مرکز', colors: ['cyan', 'pink', 'green', 'purple'] },
  // Canvas-based premium effects
  { id: 'canvas-inferno',   name: 'اینفرنو',      desc: 'آتش واقعی + دود + جرقه + درخشش', colors: ['orange', 'red', 'gold'], canvas: true },
  { id: 'canvas-lightning', name: 'برق',           desc: 'الکتریسیته واقعی + فلاش نوری', colors: ['cyan', 'blue', 'white'], canvas: true },
  { id: 'canvas-frost',     name: 'یخ‌زدگی',       desc: 'بلورهای یخ + بخار سرد', colors: ['ice', 'cyan', 'blue'], canvas: true },
  { id: 'canvas-ghost',     name: 'روح',           desc: 'سایه نیمه‌شفاف از پشت آواتار', colors: ['purple', 'cyan', 'white'], canvas: true },
  { id: 'canvas-butterfly', name: 'پروانه',        desc: 'پروانه‌های رنگین دور آواتار', colors: ['pink', 'purple', 'cyan'], canvas: true },
  { id: 'canvas-petals',    name: 'گلبرگ',         desc: 'گلبرگ‌های شناور در باد', colors: ['pink', 'red', 'white'], canvas: true },
  { id: 'canvas-spider',    name: 'عنکبوت',        desc: 'عنکبوت روی قاب پروفایل', colors: ['red', 'purple', 'orange'], canvas: true },
  { id: 'canvas-void',      name: 'خلأ',           desc: 'ذرات فضایی + گرداب انرژی', colors: ['purple', 'blue', 'pink'], canvas: true },
  { id: 'canvas-smoke',     name: 'دود',           desc: 'دود حجیم از پایین', colors: ['gray', 'blue', 'cyan'], canvas: true },
  { id: 'canvas-hellstorm', name: 'جهنم',          desc: 'آتش + برق + دود با هم', colors: ['red', 'orange', 'gold'], canvas: true },
  { id: 'canvas-shadow-beast', name: 'سایه هیولا', desc: 'موجود تاریک از اعماق', colors: ['red', 'purple', 'black'], canvas: true },
];
const EFFECTS = {};
EFFECT_FAMILIES.forEach((f) => {
  f.colors.forEach((ck) => {
    const id = f.canvas ? (f.id + '-' + ck) : (f.id + '-' + ck);
    EFFECTS[id] = {
      id, family: f.canvas ? f.id : f.id, name: f.name, desc: f.desc,
      accent: ck, color: EFFECT_PALETTES[ck], canvas: !!f.canvas,
      colors: f.colors.map((c) => ({ key: c, hex: EFFECT_PALETTES[c] })),
    };
  });
});
function hexToRgb(h) { h = (h || '#3b82f6').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex, p) { const [r, g, b] = hexToRgb(hex); const f = (c) => Math.max(0, Math.min(255, Math.round(c + (p / 100) * 255))); return '#' + [f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join(''); }
function glow(hex, a) { const [r, g, b] = hexToRgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? .35 : a) + ')'; }
function renderSkinsSub(body) {
  // همه کاربران می‌توانند تم استفاده کنند
  const allIds = SKINS.map((s) => s.id);
  localStorage.setItem('vx_owned_skins', JSON.stringify(allIds));
  const owned = allIds;
  let t = '<div class="settings-sec"><h3>' + ic('paintbrush') + ' فروشگاه اسکین</h3><div class="skins-grid">';
  SKINS.forEach((s) => {
    const isOwned = owned.includes(s.id);
    const isActive = localStorage.getItem('vx_theme') === s.theme && localStorage.getItem('vx_accent') === s.accent;
    const prevBg = s.theme === 'midnight-rose' ? '#120e18' : s.theme === 'matrix' ? '#03080a' : s.theme === 'synthwave' ? '#130a1f' : s.theme === 'sunset' ? '#160c0c' : s.theme === 'forest' ? '#0a1611' : s.theme === 'light' ? '#e4eaf6' : s.theme === 'ios' ? '#f2f2f7' : s.theme === 'midnight' ? '#070b16' : '#0a0e1a';
    t += '<div class="skin-card' + (isActive ? ' active' : '') + (isOwned ? ' owned' : '') + '" data-id="'+s.id+'">';
    t += '<div class="skin-preview" style="background:'+prevBg+';border:2px solid '+(s.accent==='ios'?'#0a84ff':'var(--'+s.accent+', #888)')+'"></div>';
    t += '<div class="skin-info"><b>'+esc(s.name)+'</b><span>'+esc(s.desc)+'</span>';
    if (s.price > 0) t += '<span class="skin-price">' + s.price.toLocaleString('fa-IR') + ' تومان</span>';
    else t += '<span class="skin-price free">رایگان</span>';
    t += '</div>';
    t += '<button class="btn sm skin-act" data-id="'+s.id+'">' + (isActive ? 'فعال' : 'اعمال') + '</button>';
    t += '</div>';
  });
  t += '</div></div>';
  body.innerHTML = t;
  body.querySelectorAll('.skin-card').forEach((b) => {
    b.onclick = () => { const s = SKINS.find((x) => x.id === b.dataset.id); if (s) openSkinPreview(s); };
  });
}
function openSkinPreview(s) {
  if (document.getElementById('skin-preview-modal')) return;
  const prevTheme = localStorage.getItem('vx_theme');
  const prevAccent = localStorage.getItem('vx_accent');
  localStorage.setItem('vx_theme', s.theme); localStorage.setItem('vx_accent', s.accent); applyAppearance();
  const moodLabel = { scary: 'ترسناک', happy: 'شاد', sad: 'غم‌انگیز', calm: 'آرام' }[s.mood] || s.mood;
  const m = document.createElement('div'); m.id = 'skin-preview-modal'; m.className = 'skin-preview-modal';
  m.innerHTML =
    '<div class="spm-backdrop"></div>' +
    '<div class="spm-card">' +
      '<div class="spm-head"><b>' + esc(s.name) + '</b>' + (s.price > 0 ? '<span class="skin-price">' + s.price.toLocaleString('fa-IR') + ' تومان</span>' : '<span class="skin-price free">رایگان</span>') + '</div>' +
      '<div class="spm-desc">' + esc(s.desc) + '</div>' +
      '<div class="spm-opts">' +
        '<div class="spm-opt"><span class="spm-dot" style="background:var(--accent)"></span>رنگ آکسنت: ' + s.accent + '</div>' +
        '<div class="spm-opt">حاله: ' + moodLabel + '</div>' +
        '<div class="spm-opt">بنر و حلقه و بال متحرک فعال</div>' +
      '</div>' +
      '<div class="spm-hint">پیش‌نمایش زندهٔ تم در پس‌زمینه نمایش داده شد — همهٔ گزینه‌ها قابل مشاهده است.</div>' +
      '<div class="spm-actions">' +
        '<button class="btn sm ghost" id="spm-cancel">بازگشت</button>' +
        '<button class="btn sm primary" id="spm-apply">' + (localStorage.getItem('vx_theme') === s.theme && localStorage.getItem('vx_accent') === s.accent ? 'فعال' : 'اعمال') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  const close = (apply) => {
    if (!apply) { localStorage.setItem('vx_theme', prevTheme); localStorage.setItem('vx_accent', prevAccent); applyAppearance(); }
    else { persistActiveSkin(); toast(s.name + ' اعمال شد'); }
    m.remove();
    if (state.me) { const pv = document.querySelector('.view-body.settings-sub'); if (pv) renderSettingsSub('skins', pv.parentElement); }
  };
  m.querySelector('.spm-backdrop').onclick = () => close(false);
  m.querySelector('#spm-cancel').onclick = () => close(false);
  m.querySelector('#spm-apply').onclick = () => close(true);
}
function renderEffectsSub(body) {
  const cur = state.me.profileEffect || 'off';
  // Parse current effect — handle canvas- prefix
  let curFam = '', curCol = '';
  if (cur !== 'off') {
    if (cur.startsWith('canvas-')) {
      curFam = cur; // canvas effects use full ID as family
    } else {
      curFam = cur.split('-')[0];
      curCol = cur.split('-')[1] || '';
    }
  }
  let t = '<div class="settings-sec"><h3>' + ic('sparkles') + ' حاله و بال پروفایل</h3>';
  t += '<div class="eff-note">روی هر افکت بزن تا پالت رنگ‌هایش باز شود؛ رنگ دلخواهت رو انتخاب کن.</div>';
  t += '<div class="eff-grid">';
  t += '<div class="eff-card off' + (cur === 'off' ? ' active' : '') + '" data-off="1"><div class="eff-preview off"></div><div class="skin-info"><b>خاموش</b><span>بدون افکت</span></div></div>';
  EFFECT_FAMILIES.forEach((f) => {
    const isCanvas = f.canvas;
    const open = isCanvas ? (cur === f.id + '-' + (curCol || f.colors[0])) : (curFam === f.id);
    const c0 = EFFECT_PALETTES[f.colors[0]];
    const c1 = EFFECT_PALETTES[f.colors[1] || f.colors[0]];
    const canvasBadge = isCanvas ? ' <span class="badge" style="background:var(--info-muted);color:var(--info);font-size:9px">CANVAS</span>' : '';
    t += '<div class="eff-card fam' + (open ? ' active' : '') + '" data-fam="' + f.id + '"' + (isCanvas ? ' data-canvas="1"' : '') + '">';
    t += '<div class="eff-preview" style="background:linear-gradient(135deg,' + c0 + ',' + c1 + ')"></div>';
    t += '<div class="skin-info"><b>' + esc(f.name) + canvasBadge + '</b><span>' + esc(f.desc) + '</span></div>';
    t += '<div class="eff-colors' + (open ? ' open' : '') + '">';
    f.colors.forEach((ck) => {
      const effId = isCanvas ? (f.id + '-' + ck) : (f.id + '-' + ck);
      const on = isCanvas ? (cur === effId) : (open && curCol === ck);
      t += '<button class="eff-swatch' + (on ? ' on' : '') + '" data-eff="' + effId + '" data-color="' + EFFECT_PALETTES[ck] + '" style="background:' + EFFECT_PALETTES[ck] + '" title="' + ck + '"></button>';
    });
    t += '</div></div>';
  });
  t += '</div></div>';
  body.innerHTML = t;
  body.querySelector('[data-off]').onclick = () => applyEffect('off', null);
  body.querySelectorAll('.eff-card.fam').forEach((c) => {
    c.addEventListener('click', (e) => {
      if (e.target.classList.contains('eff-swatch')) return;
      const wasOpen = c.classList.contains('active');
      body.querySelectorAll('.eff-card.fam').forEach((x) => { x.classList.remove('active'); x.querySelector('.eff-colors').classList.remove('open'); });
      if (!wasOpen) { c.classList.add('active'); c.querySelector('.eff-colors').classList.add('open'); }
    });
  });
  body.querySelectorAll('.eff-swatch').forEach((s) => {
    s.onclick = (e) => { e.stopPropagation(); applyEffect(s.dataset.eff, s.dataset.color); };
  });
}
function applyEffect(eff, color) {
  state.me.profileEffect = eff;
  if (color) state.me.profileEffectColor = color;
  localStorage.setItem('vx_profile_effect', eff);
  if (color) localStorage.setItem('vx_profile_effect_color', color);
  api('/api/profile-effect', { method: 'POST', body: JSON.stringify({ effect: eff, color: color || null }) })
    .then((r) => r.json()).then((d) => { if (d.me) state.me = d.me; }).catch(() => {});
  toast(eff === 'off' ? 'افکت خاموش شد' : (EFFECTS[eff] ? EFFECTS[eff].name : 'افکت') + ' اعمال شد');
  const effWrap = document.querySelector('.view-body.settings-sub');
  if (effWrap && effWrap.parentElement) { renderSettingsSub('effects', effWrap.parentElement); }
}

/* INIT */
function closeAllOverlays() {
  if (document.querySelector('.msg-sheet, .msg-ctx, .ctx-scrim')) { closeMsgCtx(); closeCtxMenus(); return true; }
  if ($('emoji-pop') && !$('emoji-pop').classList.contains('hidden')) { $('emoji-pop').classList.add('hidden'); return true; }
  return false;
}
window.addEventListener('keydown', (e) => {
  if (_selectMode) {
    if (e.key === 'Escape') { exitSelectMode(); e.preventDefault(); e.stopPropagation(); return; }
  }
  const inField = ['INPUT', 'TEXTAREA'].includes((document.activeElement && document.activeElement.tagName) || '');
  if (e.key === 'Escape') { if (closeAllOverlays()) { e.preventDefault(); e.stopPropagation(); } }
  if (_ctxEl && !inField) {
    var items = _ctxEl.querySelectorAll('.ctx-reac, .ctx-item');
    var cur = document.activeElement;
    var idx = Array.prototype.indexOf.call(items, cur);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cur.click(); }
  }
}, true);
document.addEventListener('contextmenu', (e) => {
  const chatItem = e.target.closest('.chat-item');
  const msgWrap = e.target.closest('.msg');
  if (chatItem) { e.preventDefault(); }
  else if (msgWrap) {
    e.preventDefault();
    if (_selectMode) { e.stopPropagation(); return; }
    var msgId = msgWrap.dataset.id;
    var m = (state.rooms[state.room] || {}).messages.find(x => x.id === msgId);
    if (m) openMsgCtx(m, msgWrap.querySelector('.bubble') || msgWrap, { x: e.clientX, y: e.clientY });
  }
  else { closeMsgCtx(); closeCtxMenus(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.ctx-menu, .reac-pop, .msg-ctx, .msg-sheet, .ctx-scrim, .sheet-scrim')) { closeMsgCtx(); closeCtxMenus(); } });

/* ═══════════ BACK BUTTON / in-app navigation (Android & mobile browsers) ═══════════ */
const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
let _pinScreen = false;
function _pinScreenOpen() { return !!$('pin-screen') && !$('pin-screen').classList.contains('hidden'); }
/* ---------- نشانی صفحه (URL) ----------
   هر چت یک نشانی واقعی و قابل رفرش/اشتراک دارد:
     /app?room=dm%3Aali%7Csara&uid=100005
   «uid» شناسهٔ عددی طرف مقابل است تا در نوار آدرس مرورگر هم قابل بررسی باشد،
   و «room» باعث می‌شود دکمهٔ برگشت مرورگر دقیقاً به چت قبلی برگردد. */
function urlRoom() {
  try { return new URLSearchParams(location.search).get('room') || null; } catch (e) { return null; }
}
function syncUrl(rid, opts) {
  opts = opts || {};
  if (state._restoringNav) return;          /* در حال بازگردانی: URL از قبل درست است */
  try {
    const sp = new URLSearchParams();
    if (rid) sp.set('room', rid);
    const uid = rid ? roomUid(rid) : 0;
    if (uid) sp.set('uid', String(uid));
    if (opts.view) sp.set('view', opts.view);
    const q = sp.toString();
    const url = location.pathname + (q ? '?' + q : '');
    const st = { vx: 1, nav: opts.view || 'chats', room: rid || null, view: opts.view || null };
    if (opts.replace) history.replaceState(st, '', url);
    else history.pushState(st, '', url);
  } catch (e) {}
}
/* تازه‌سازی اجباری یک چت: کش را نامعتبر می‌کنیم تا سرور تاریخچهٔ کامل بفرستد */
function invalidateRoom(rid) {
  const r = state.rooms[rid];
  if (r) r.lastSync = 0;
}
/* بازگرداندن وضعیت از روی URL بعد از دکمهٔ برگشت/فوروارد مرورگر.
   برمی‌گردد به چت قبلی و همان چت از سرور دوباره بارگذاری می‌شود. */
function restoreFromUrl(rid) {
  const cur = state.room || null;
  state._restoringNav = true;
  try {
    /* لایهٔ اطلاعات چت با جابه‌جایی بین صفحه‌ها نباید باز بماند */
    const ri = document.querySelector('.ri-backdrop'); if (ri) ri.remove();
    if (rid) {
      /* هر بار که از تاریخچه به چتی می‌رسیم، کش آن چت نامعتبر می‌شود تا
         سرور تاریخچهٔ کامل را دوباره بفرستد (رفتار «برگشت + بروزرسانی») */
      invalidateRoom(rid);
      openRoom(rid, { fromHistory: true });
      return true;
    }
    if (!cur) return false;
    /* بدون room در URL ⇒ برگشت به لیست چت (/app) */
    state.room = null; state.nav = 'chats';
    if (viewHost && !viewHost.classList.contains('hidden')) { viewHost.innerHTML = ''; viewHost.dataset.view = ''; }
    setMode('chats');
    $('conversation').classList.remove('chat-open');
    $('chat-list-column').classList.add('m-open');
    showScrim(false); closeDrawers();
    buildChatList();
    document.querySelectorAll('.nav-item').forEach((e) => e.classList.toggle('active', e.dataset.nav === 'chats'));
    return true;
  } finally { state._restoringNav = false; }
}
/* یک entry در history برای نگه داشتن برنامه و رهگیری دکمه برگشت.
   در مرورگر، خودِ URL entry می‌سازد؛ در Capacitor در حافظه نگه می‌داریم. */
const _vxStack = [];
function vxPush(snap) {
  if (state._restoringNav) return;
  const s = snap || navSnapshot();
  if (isCapacitor) { _vxStack.push(s); return; }
  try {
    if (s.overlay) history.pushState({ vx: 1, overlay: 1, room: s.room || null, nav: s.nav || 'chats' }, '', location.href);
    else syncUrl(s.room || null, { view: s.view || null });
  } catch (e) {}
}
/* ---------- لایه‌های تمام‌صفحه (نمایش‌گر تصویر/ویدیو و ادیتورها) ----------
   هر لایه یک entry در history می‌گیرد تا دکمهٔ برگشت (مرورگر یا اندروید)
   اول همان لایه را ببندد و بعد به چت/صفحهٔ قبلی برگردد. */
function vxOverlayOpen() {
  if (state._restoringNav) return;
  if (isCapacitor) { _vxStack.push({ vx: 1, overlay: 1, room: state.room || null, nav: state.nav || 'chats' }); return; }
  try { history.pushState({ vx: 1, overlay: 1, room: state.room || null, nav: state.nav || 'chats' }, '', location.href); } catch (e) {}
}
function vxOverlayClose() {
  /* entry لایه را با وضعیت واقعی صفحه جایگزین می‌کنیم تا یک Back اضافه لازم نشود */
  try {
    if (isCapacitor) { if (_vxStack.length) _vxStack.pop(); return; }
    const vw = (viewHost && !viewHost.classList.contains('hidden')) ? viewHost.dataset.view : null;
    history.replaceState({ vx: 1, nav: state.nav || 'chats', room: state.room || null, view: vw || null }, '', location.href);
  } catch (e) {}
}
/* لایهٔ روییِ تمام‌صفحه که باید با دکمهٔ برگشت بسته شود */
function vxFullOverlay() {
  for (const k of VX_FULL_OVERLAYS) {
    const el = document.querySelector(k.sel);
    if (!el) continue;
    /* عنصر پنهان (hidden) باز نیست ⇒ نباید برگشت را مصرف کند */
    if (el.classList && el.classList.contains('hidden')) continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    return el;
  }
  return null;
}
function vxCloseFullOverlay() {
  const ov = vxFullOverlay();
  if (!ov) return false;
  const kind = VX_FULL_OVERLAYS.find((k) => ov.matches(k.sel));
  /* اگر تابع بستنِ خودمان را دارد صدایش می‌زنیم (history هم درست می‌شود) */
  if (kind && kind.close && typeof ov[kind.close] === 'function') { try { ov[kind.close](); } catch (e) { ov.remove(); } }
  else if (typeof ov._vxClose === 'function') { try { ov._vxClose(); } catch (e) { ov.remove(); } }
  else ov.remove();
  /* بستن لایه یعنی کاربر دوباره دارد پیام‌ها را می‌بیند ⇒ سین ثبت شود */
  setTimeout(function () { if (typeof markRead === 'function') markRead(state.room); }, 250);
  return true;
}
/* کلاس‌های پوشش‌های تمام‌صفحه که دکمهٔ برگشت باید ببندد (نام کلاس + نام تابع بستن)
   فقط لایه‌هایی که واقعاً در DOM ساخته می‌شوند؛ عناصر دائمیِ hidden
   (مثل #attach-pop) نباید اینجا باشند وگرنه هر بارِ برگشت را می‌بلعند. */
const VX_FULL_OVERLAYS = [
  { sel: '.vxmp', close: 'close' },              /* انتخاب موقعیت روی نقشه */
  { sel: '.vxmap-sheet-wrap', close: 'close' },  /* باز کردن موقعیت در اپ نقشه */
  { sel: '.viewer', close: '_vxClose' },        /* نمایش‌گر تصویر/ویدیو */
  { sel: '.modal-ov', close: '_vxClose' },      /* ادیتور عکس و … */
  { sel: '.ve-pop', close: '_vxClose' },         /* ادیتور ویدیو و مبدل GIF */
  { sel: '.modal-overlay', close: '_vxClose' },  /* مودال‌های عمومی */
];
/* وضعیت فعلی صفحه برای ذخیره در history: کدام nav، کدام room و کدام صفحه */
function navSnapshot() {
  const v = viewHost && !viewHost.classList.contains('hidden') ? viewHost.dataset.view : null;
  return { vx: 1, nav: state.nav || 'chats', room: state.room || null, view: v || null };
}
/* بازگرداندن صفحه‌ای که کاربر قبل از این یکی باز کرده بود (چت قبلی، لیست چت یا /app) */
const _NAV_IDS = ['ai', 'cloud', 'tasks', 'calendar', 'contacts', 'settings', 'admin', 'profile'];
function restoreNav(s) {
  if (!s || s.vx !== 1) return false;
  /* لایه‌های رویی (اطلاعات چت، پروفایل، منوها) سطحبندی بستن خودشان را دارند */
  if (s.overlay) return false;
  const nav = s.nav || 'chats';
  const isChat = nav === 'chats';
  const isKnownView = !isChat && _NAV_IDS.indexOf(s.view || nav) !== -1;
  if (!isChat && !isKnownView) return false; /* entry ناشناخته → به vxBack بسپار */
  const cur = navSnapshot();
  if (cur.nav === nav && (cur.room || null) === (s.room || null) && (cur.view || null) === (s.view || null)) return true;
  state._restoringNav = true;
  try {
    if (isChat && s.room) { openRoom(s.room, { fromHistory: true }); return true; }
    if (isKnownView) {
      if (viewHost && !viewHost.classList.contains('hidden')) { viewHost.innerHTML = ''; viewHost.dataset.view = ''; }
      switchNav(nav);
      return true;
    }
    /* برگشت به لیست چت / صفحهٔ اصلی */
    if (viewHost && !viewHost.classList.contains('hidden')) { viewHost.innerHTML = ''; viewHost.dataset.view = ''; setMode('chats'); }
    state.room = null;
    state.nav = 'chats';
    $('conversation').classList.remove('chat-open');
    $('chat-list-column').classList.add('m-open');
    showScrim(false);
    buildChatList();
    document.querySelectorAll('.nav-item').forEach((e) => e.classList.toggle('active', e.dataset.nav === 'chats'));
    return true;
  } finally { state._restoringNav = false; }
}
/* فقط لایه‌های رویی (منوی کناری، اطلاعات چت، پروفایل/صفحه‌های داخلی) را می‌بندد.
   به چت دست نمی‌زند؛ بازگرداندن چت با restoreFromUrl انجام می‌شود. */
function closeTopOverlay() {
  /* اول نمایش‌گر تصویر/ویدیو و ادیتورها (لایهٔ تمام‌صفحه) */
  if (vxCloseFullOverlay()) return true;
  const ri = document.querySelector('.ri-backdrop');
  if (ri) {
    ri.remove();
    if (viewHost && !viewHost.classList.contains('hidden') && viewHost.querySelector('.roominfo-view')) { viewHost.innerHTML = ''; setMode('chats'); }
    return true;
  }
  const ns = $('nav-sidebar');
  if (isMobile() && ns && ns.classList.contains('m-open')) { ns.classList.remove('m-open'); showScrim(false); return true; }
  if (viewHost && !viewHost.classList.contains('hidden')) {
    const back = viewHost.querySelector('[data-act="back"], #view-back');
    if (back) { back.click(); return true; }
    viewHost.innerHTML = ''; viewHost.dataset.view = '';
    setMode(state.room ? 'chats' : 'chats');
    return true;
  }
  return false;
}
/* سطحبندی بازگشت: سیستم، منوی موبایل، پروفایل/اطلاعات، چت، nav، ریشه */
function vxBack(allowExit) {
  if ($('auth-screen') && !$('auth-screen').classList.contains('hidden')) return false;
  if (_pinScreenOpen() && $('app').classList.contains('hidden')) return true;
  if (vxCloseFullOverlay()) return true;      /* نمایش‌گر تصویر/ویدیو و ادیتورها */
  const ri = document.querySelector('.ri-backdrop');
  if (ri) { ri.remove();
    if (viewHost && !viewHost.classList.contains('hidden') && viewHost.querySelector('.roominfo-view')) { viewHost.innerHTML = ''; setMode('chats'); } return true; }
  const ns = $('nav-sidebar');
  if (isMobile() && ns && ns.classList.contains('m-open')) { ns.classList.remove('m-open'); showScrim(false); return true; }
  if (viewHost && !viewHost.classList.contains('hidden')) {
    const back = viewHost.querySelector('[data-act="back"], #view-back');
    if (back) { back.click(); return true; }
    return true;
  }
  if (isMobile() && $('conversation').classList.contains('chat-open')) {
    if (state.room) { state.room = null; $('conversation').classList.remove('chat-open'); $('chat-list-column').classList.add('m-open'); buildChatList(); }
    return true;
  }
  if (state.nav !== 'chats') { switchNav('chats'); return true; }
  return allowExit === true; /* روی ریشه هستیم؛ فقط با اجازهی صریح خروج */
}
if (isCapacitor) {
  document.addEventListener('backbutton', (e) => {
    e.preventDefault();
    /* اول به صفحهٔ قبلی برمی‌گردیم (چت/صفحهٔ قبلی)، بعد منطق سطحبندی قدیمی */
    if (_vxStack.length) { const s = _vxStack.pop(); state._restoringNav = true; try { restoreNav(s); } finally { state._restoringNav = false; } return; }
    vxBack(false); /* در ریشه: بدون عمل (خروج با دکمهی خود اپ) */
  }, false);
  try {
    const Plugins = window.Capacitor.Plugins;
    if (Plugins && Plugins.StatusBar) {
      Plugins.StatusBar.setStyle({ style: 'DARK' });
      Plugins.StatusBar.setBackgroundColor({ color: '#031427' });
    }
  } catch (e) {}
} else {
  /* مرورگر (PWA): دکمهٔ برگشت مرورگر = popstate.
     نشانی صفحه مرجع است: به چت قبلی برمی‌گردیم و همان چت از سرور تازه می‌شود،
     و اگر صفحهٔ قبلی /app (لیست چت) بود، به لیست چت برمی‌گردیم. */
/* رویداد popstate فقط وقتی لایه‌ای را می‌بندد می‌تواند دوباره سین ثبت کند */
window.addEventListener('popstate', (e) => {
  if ($('auth-screen') && !$('auth-screen').classList.contains('hidden')) return;
  if (_pinScreenOpen()) return;
  if (vxCloseFullOverlay()) { setTimeout(() => markRead(state.room), 300); return; }
  const rid = urlRoom();
  const sp = new URLSearchParams(location.search);
  /* روی لیست چت: فقط لایهٔ رویی (منو/اطلاعات چت) بسته شود، نه خود چت */
  if (!rid && !sp.get('view')) { if (closeTopOverlay()) return; }
  if (restoreFromUrl(rid)) return;
  if (restoreNav(e.state)) return;
  if (closeTopOverlay()) return;
  /* چیزی برای بازگرداندن نیست ⇒ اجازهٔ رفتن به صفحهٔ قبلی مرورگر */
}, true);
}

// راستی‌آزمایی نشست در پس‌زمینه: اگر نشست واقعاً مرده (۴۰۱) خروج؛ اگر شبکه در دسترس نبود
// با کش ادامه می‌دهیم تا اپ حتی آفلاین هم باز شود.
async function refreshMeSession() {
  if (!state.token) return;
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + state.token } });
    if (r.ok) {
      const d = await r.json();
      if (!d.me) { logout(true); return; }
      if (JSON.stringify(d.me) !== JSON.stringify(state.me)) { state.me = d.me; cacheMeNow(); renderNav(); buildChatList(); }
      else cacheMeNow();
    } else if (r.status === 401) { logout(true); }
  } catch (e) { console.warn('آفلاین: /api/me در دسترس نیست — ادامه با کش محلی', e); }
}

/* ═══════════════════════════════════════════════════════════════
   VIDEO EDITOR + VIDEO→GIF ENGINE (GIF89a encoder, خانگی، بدون وابستگی)
   ═══════════════════════════════════════════════════════════════ */
const VE_FILTERS = {
  none:    { label: 'بدون فیلتر', css: 'none' },
  grayscale:{ label: 'سیاه‌سفید', css: 'grayscale(1)' },
  sepia:   { label: 'سپیا',       css: 'sepia(.85)' },
  invert:  { label: 'نگاتیو',     css: 'invert(1)' },
  vivid:   { label: 'زنده',       css: 'saturate(1.6) contrast(1.15)' },
  cool:    { label: 'سرد',        css: 'hue-rotate(-25deg) saturate(1.15)' },
  warm:    { label: 'گرم',        css: 'sepia(.35) hue-rotate(-12deg) saturate(1.3)' },
  vintage: { label: 'قدیمی',      css: 'sepia(.6) contrast(.95) brightness(1.05)' },
  neon:    { label: 'نئون',       css: 'saturate(2.2) hue-rotate(90deg) contrast(1.2)' },
};
const VE_FPS_PRESETS = [4, 6, 8, 10, 12, 15, 20];
const VE_W_PRESETS = [160, 240, 320, 480, 640];
const VE_MAX_SECONDS = 10; // محدودیت طول خروجی GIF برای جلوگیری از فایل‌های غول‌آسا

/* ---------- کمکی: فاصله ← زمان قابل خواندن ---------- */
function veFmtTime(s) {
  s = Math.max(0, Number(s) || 0);
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + String(ss).padStart(2, '0');
}

/* ---------- بارگذاری متادیتا ویدیو ---------- */
function veCreateVideo(src) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  v.src = src;
  return v;
}
function veLoadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = veCreateVideo(src);
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('video-load'));
  });
}

/* ---------- seek مطمئن (در چند مرورگر) ---------- */
function veSeekTo(v, t) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); clearTimeout(timer); resolve(); } };
    const timer = setTimeout(fin, 350);
    v.addEventListener('seeked', fin);
    try { v.currentTime = t; } catch (e) { fin(); }
  });
}

/* ---------- برش (crop) ---------- */
/* opts.crop = {l,t,r,b} به‌صورت نسبی از ابعاد ویدیوی مبدأ (۰ تا ۱).
   برای «برش از کناره‌ها» استفاده می‌شود؛ اگر داده نشود یعنی بدون برش. */
function veCropRect(opts, srcW, srcH) {
  const c = (opts && opts.crop) || null;
  if (!c) return null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  let l = num(c.l, 0), t = num(c.t, 0), r = num(c.r, 1), b = num(c.b, 1);
  l = Math.max(0, Math.min(1, l));
  t = Math.max(0, Math.min(1, t));
  r = Math.max(0, Math.min(1, r));
  b = Math.max(0, Math.min(1, b));
  if (r - l < 0.05 || b - t < 0.05) return null;
  if (l === 0 && t === 0 && r === 1 && b === 1) return null;
  return { x: l * srcW, y: t * srcH, w: (r - l) * srcW, h: (b - t) * srcH };
}

/* ابعاد خروجی بر پایه‌ی ناحیه‌ی برش‌خورده محاسبه می‌شود تا نسبت تصویر
   درست بماند (برش از کناره‌ها نباید تصویر را بکشد). */
function veOutSize(opts, srcW, srcH, width, minW, maxW) {
  const cr = veCropRect(opts, srcW, srcH);
  const cw = cr ? cr.w : srcW, ch = cr ? cr.h : srcH;
  const w = Math.max(minW, Math.min(Number(width) || 320, maxW));
  const h = Math.max(2, Math.round((ch * (w / Math.max(1, cw))) / 2) * 2);
  return { width: w, height: h, crop: cr };
}

/* ---------- استخراج فریم‌ها (با فیلتر و متن هم‌راستا با ادیتور) ---------- */
async function veExtractFrames(videoSrc, opts = {}, onProgress, shouldCancel) {
  const v = await veLoadVideo(videoSrc);
  const dur = v.duration || 0;
  const start = Math.max(0, Math.min(Number(opts.start) || 0, dur));
  const end = Math.min(Number(opts.end) || dur, dur);
  const fps = Math.max(1, Math.min(Number(opts.fps) || 10, 24));
  const srcW = v.videoWidth || 320, srcH = v.videoHeight || 320;
  const out = veOutSize(opts, srcW, srcH, opts.width, 64, 720);
  const width = out.width, height = out.height, crop = out.crop;
  const total = Math.max(1, Math.round((end - start) * fps));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const filterCss = (VE_FILTERS[opts.filter] || VE_FILTERS.none).css;

  v.currentTime = start;
  const frames = [];
  for (let i = 0; i < total; i++) {
    if (shouldCancel && shouldCancel()) return null;
    if (onProgress) onProgress(i / total, i, total);
    const t = Math.min(start + i / fps, Math.max(start, end - 0.001));
    await veSeekTo(v, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = filterCss;
    if (crop) ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
    else ctx.drawImage(v, 0, 0, width, height);
    ctx.filter = 'none';
    if (opts.text) {
      const fs = Math.max(12, Math.min(72, Number(opts.textSize) || 28));
      ctx.font = 'bold ' + fs + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const lines = String(opts.text).split('\n').map((l) => l.trim()).filter(Boolean);
      const lh = fs * 1.25;
      const startY = opts.textPos === 'top' ? 12 : height - lh * lines.length - 14;
      ctx.lineWidth = Math.max(4, fs / 4);
      ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round';
      lines.forEach((line, li) => {
        if (!line) return;
        const y = startY + li * lh;
        ctx.strokeText(line, width / 2, y);
        ctx.fillStyle = opts.textColor || '#ffffff';
        ctx.fillText(line, width / 2, y);
      });
    }
    let img = null;
    try { img = ctx.getImageData(0, 0, width, height); } catch (e) { img = null; }
    if (!img) { if (onProgress) onProgress(1, i, total); throw new Error('canvas-tainted'); }
    frames.push({ pixels: img.data, width, height, delayMs: (end - start) / total * 1000 });
  }
  return { frames, width, height, v };
}

/* ---------- [GIF] پالت با Median Cut ---------- */
function veColorRange(colors) {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (c[0] < minR) minR = c[0]; if (c[0] > maxR) maxR = c[0];
    if (c[1] < minG) minG = c[1]; if (c[1] > maxG) maxG = c[1];
    if (c[2] < minB) minB = c[2]; if (c[2] > maxB) maxB = c[2];
  }
  return Math.max(maxR - minR, maxG - minG, maxB - minB);
}
function veMedianCut(colors, maxColors) {
  if (!colors.length) return [[0, 0, 0]];
  if (colors.length <= maxColors) {
    const uniq = [];
    const seen = new Set();
    for (const c of colors) {
      const k = (c[0] << 16) | (c[1] << 8) | c[2];
      if (!seen.has(k)) { seen.add(k); uniq.push([c[0], c[1], c[2]]); }
    }
    if (uniq.length <= maxColors) return uniq;
    colors = uniq;
  }
  let boxes = [colors];
  while (boxes.length < maxColors) {
    let li = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const r = veColorRange(boxes[i]);
      if (r > best) { best = r; li = i; }
    }
    if (li < 0 || boxes[li].length < 2) break;
    const box = boxes[li];
    const rng = veColorRange(box);
    let chan = 0;
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const c of box) {
      if (c[0] < minR) minR = c[0]; if (c[0] > maxR) maxR = c[0];
      if (c[1] < minG) minG = c[1]; if (c[1] > maxG) maxG = c[1];
      if (c[2] < minB) minB = c[2]; if (c[2] > maxB) maxB = c[2];
    }
    chan = (maxR - minR >= rng - 1 && (maxR - minR) >= (maxG - minG) && (maxR - minR) >= (maxB - minB)) ? 0
      : ((maxG - minG) >= (maxB - minB) ? 1 : 2);
    box.sort((a, b) => a[chan] - b[chan]);
    const mid = box.length >> 1;
    if (mid === 0 || mid >= box.length) break;
    const a = box.slice(0, mid), b = box.slice(mid);
    if (!a.length || !b.length) break;
    boxes.splice(li, 1, a, b);
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const c of box) { r += c[0]; g += c[1]; b += c[2]; }
    const n = box.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}
function veBuildPalette(frames) {
  const samples = [];
  let n = 0, total = 0;
  for (const fr of frames) total += fr.pixels.length / 4;
  const step = Math.max(1, Math.floor(total / 40000));
  for (const fr of frames) {
    const d = fr.pixels;
    for (let i = 0; i < d.length; i += 16) {
      if ((n++ % step) === 0) samples.push([d[i], d[i + 1], d[i + 2]]);
    }
  }
  return veMedianCut(samples, 256);
}
/* نقشه‌ی رنگی ۳۲×۳۲×۳۲ برای تبدیل O(1) پیکسل → ایندکس پالت */
function veMakePalIndex(palette) {
  const cube = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    const rr = (r << 3) + 4;
    for (let g = 0; g < 32; g++) {
      const gg = (g << 3) + 4;
      const base = (r * 32 + g) * 32;
      for (let b = 0; b < 32; b++) {
        const bb = (b << 3) + 4;
        let best = 0, bd = Infinity;
        for (let i = 0; i < palette.length; i++) {
          const dr = palette[i][0] - rr, dg = palette[i][1] - gg, db = palette[i][2] - bb;
          const d2 = dr * dr + dg * dg + db * db;
          if (d2 < bd) { bd = d2; best = i; }
        }
        cube[base + b] = best;
      }
    }
  }
  return cube;
}
function veQuantize(rgba, cube) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o++) {
    const r = (rgba[i] >> 3) & 31, g = (rgba[i + 1] >> 3) & 31, b = (rgba[i + 2] >> 3) & 31;
    out[o] = cube[(r * 32 + g) * 32 + b];
  }
  return out;
}

/* ---------- [GIF] فشرده‌سازی LZW + ساخت فایل GIF89a ---------- */
function veLzwEncode(data, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out = [];
  let dict = new Map();
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  let bitBuf = 0, bitCnt = 0;
  const emit = (code, nBits) => {
    bitBuf |= code << bitCnt;
    bitCnt += nBits;
    while (bitCnt >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>>= 8; bitCnt -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
    for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
  };
  reset();
  emit(clearCode, codeSize);
  if (data.length) {
    let cur = String.fromCharCode(data[0]);
    for (let i = 1; i < data.length; i++) {
      const k = data[i];
      const c = String.fromCharCode(k);
      const wkc = cur + c;
      if (dict.has(wkc)) {
        cur = wkc;
      } else {
        emit(dict.get(cur), codeSize);
        if (nextCode < 4096) {
          if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
          dict.set(wkc, nextCode++);
        } else {
          emit(clearCode, codeSize);
          reset();
        }
        cur = c;
      }
    }
    if (cur.length) emit(dict.get(cur), codeSize);
  }
  emit(eoiCode, codeSize);
  if (bitCnt > 0) out.push(bitBuf & 0xff);
  return out;
}
function veBuildGif(frames, width, height, palette, minCodeSize) {
  const bytes = [];
  const pu = (b) => bytes.push(b & 0xff);
  const pu16 = (n) => { pu(n & 0xff); pu((n >> 8) & 0xff); };
  const tableSize = 1 << minCodeSize;
  while (palette.length < tableSize) palette.push([0, 0, 0]);
  for (const c of 'GIF89a') pu(c.charCodeAt(0));
  pu16(width); pu16(height);
  const gctFlags = 0x80 | (0x70) | (minCodeSize - 1);
  pu(gctFlags);
  pu(0); pu(0);
  for (const [r, g, b] of palette) { pu(r); pu(g); pu(b); }
  for (const fr of frames) {
    const centi = Math.max(2, Math.round(fr.delayMs / 10));
    pu(0x21); pu(0xF9); pu(0x04); pu(0x04);
    pu(centi & 0xff); pu((centi >> 8) & 0xff); pu(0); pu(0);
    pu(0x2C); pu16(0); pu16(0); pu16(width); pu16(height); pu(0);
    const idx = veQuantize(fr.pixels, veBuildPaletteCube(palette, minCodeSize));
    const lzw = veLzwEncode(idx, minCodeSize);
    pu(minCodeSize);
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.slice(i, i + 255);
      pu(chunk.length);
      for (const b of chunk) pu(b);
    }
    pu(0);
  }
  pu(0x3B);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
let _vePalCubeCache = { palette: null, cube: null };
function veBuildPaletteCube(palette, minCodeSize) {
  if (_vePalCubeCache.palette === palette) return _vePalCubeCache.cube;
  const cube = veMakePalIndex(palette);
  _vePalCubeCache = { palette, cube };
  return cube;
}

/* ---------- تبدیل اصلی ویدیو → GIF ---------- */
async function videoToGif(videoSrc, opts, onProgress, shouldCancel) {
  const got = await veExtractFrames(videoSrc, opts, onProgress, shouldCancel);
  if (!got) return null;
  if (onProgress) onProgress(0.5, 0, 1);
  const palette = veBuildPalette(got.frames);
  const minCodeSize = Math.max(2, Math.min(8, Math.ceil(Math.log2(palette.length))));
  _vePalCubeCache = { palette: null, cube: null };
  const blob = veBuildGif(got.frames, got.width, got.height, palette, minCodeSize);
  got.v.removeAttribute('src');
  if (onProgress) onProgress(1, got.frames.length, got.frames.length);
  return blob;
}

/* ---------- خروجی ویدیو (WebM) با همین تنظیمات ادیتور ---------- */
async function videoToWebM(videoSrc, opts, onProgress, shouldCancel) {
  if (!window.MediaRecorder) throw new Error('media-recorder');
  const mb = new Promise((resolve, reject) => {
    veLoadVideo(videoSrc).then((v) => {
      const dur = v.duration || 0;
      const start = Math.max(0, Math.min(Number(opts.start) || 0, dur));
      const end = Math.min(Number(opts.end) || dur, dur);
      const srcW = v.videoWidth || 640, srcH = v.videoHeight || 640;
      const out = veOutSize(opts, srcW, srcH, opts.width, 64, 960);
      const width = out.width, height = out.height, crop = out.crop;
      /* بیت‌ریت پایین‌تر = حجم کمتر (ابزار «کاهش حجم»). */
      const bitrate = Math.max(120_000, Math.min(Number(opts.bitrate) || 3_000_000, 8_000_000));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const filterCss = (VE_FILTERS[opts.filter] || VE_FILTERS.none).css;
      const stream = canvas.captureStream(30);
      let rec = null;
      try { rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bitrate }); }
      catch (e1) { try { rec = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: bitrate }); } catch (e2) { reject(new Error('media-recorder')); return; } }
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      rec.onerror = () => reject(new Error('recorder-error'));
      rec.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }));
      let raf = 0, cancelled = false;
      const draw = () => {
        if (cancelled) return;
        if (v.currentTime >= end || (v.ended && !isFinite(end))) {
          try { rec.stop(); } catch (e) {}
          return;
        }
        if (onProgress) onProgress(Math.min(1, (v.currentTime - start) / Math.max(0.001, end - start)));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.filter = filterCss;
        if (crop) ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
        else ctx.drawImage(v, 0, 0, width, height);
        ctx.filter = 'none';
        if (opts.text) {
          const fs = Math.max(12, Math.min(72, Number(opts.textSize) || 28));
          ctx.font = 'bold ' + fs + 'px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          const lines = String(opts.text).split('\n').map((l) => l.trim()).filter(Boolean);
          const lh = fs * 1.25;
          const startY = opts.textPos === 'top' ? 12 : height - lh * lines.length - 14;
          ctx.lineWidth = Math.max(4, fs / 4);
          ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round';
          lines.forEach((line, li) => {
            if (!line) return;
            const y = startY + li * lh;
            ctx.strokeText(line, width / 2, y);
            ctx.fillStyle = opts.textColor || '#ffffff';
            ctx.fillText(line, width / 2, y);
          });
        }
        raf = requestAnimationFrame(draw);
      };
      v.currentTime = start;
      v.play().catch(() => {});
      const onSeeked = () => { raf = requestAnimationFrame(draw); };
      v.addEventListener('seeked', onSeeked);
      rec.start(250);
      setTimeout(onSeeked, 250);
      const canceller = () => { cancelled = true; cancelAnimationFrame(raf); try { rec.stop(); } catch (e) {} resolve(new Blob(parts, { type: 'video/webm' })); };
      if (shouldCancel) {
        const origCancel = shouldCancel;
        shouldCancel = () => { const r = origCancel(); if (r) canceller(); return r; };
      }
      const cw = () => { if (shouldCancel && shouldCancel()) return; };
      const ci = setInterval(cw, 150);
      rec.addEventListener('stop', () => { clearInterval(ci); v.pause(); v.removeAttribute('src'); }, { once: true });
    }).catch(reject);
  });
  return mb;
}

/* ---------- ذخیره در GIFهای من (IndexedDB) ---------- */
async function saveToMyGifs(blob, name) {
  if (!blob || !blob.size) return null;
  const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const rec = { id, name: name || 'GIF ' + new Date().toLocaleString('fa'), blob, size: blob.size, createdAt: Date.now() };
  await myGifsPut(rec);
  return rec;
}
async function myGifsGet(id) {
  try {
    const db = await myGifsIdb();
    return await new Promise((res) => {
      const tx = db.transaction(MY_GIFS_STORE, 'readonly');
      const rq = tx.objectStore(MY_GIFS_STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}

/* ---------- UI مشترک ادیتور/مبدل ---------- */
function veOpenModal(title) {
  const pop = document.createElement('div');
  pop.className = 've-pop';
  pop.innerHTML = '<div class="ve-box">'
    + '<div class="ve-head"><button type="button" class="icon-btn" data-a="close" aria-label="بستن ویرایشگر">' + ic('x') + '</button><b>' + esc(title) + '</b></div>'
    + '<div class="ve-body"></div>'
    + '<div class="ve-foot"></div>'
    + '</div>';
  document.body.appendChild(pop);
  applyIcons(pop);
  /* دکمهٔ برگشت گوشی/مرورگر هم این پنجره را می‌بندد */
  const kill = () => { pop.remove(); vxOverlayClose(); };
  pop._vxClose = kill;
  pop.querySelector('[data-a="close"]').onclick = kill;
  pop.addEventListener('mousedown', (e) => { if (e.target === pop) kill(); });
  vxOverlayOpen();
  return pop;
}
function veRange2(min, max, val, label) {
  const w = document.createElement('div');
  w.className = 've-row';
  w.innerHTML = '<label>' + label + '<span class="ve-val"></span></label>'
    + '<input type="range" min="' + min + '" max="' + max + '" step="0.05" value="' + val + '">';
  return w;
}
function veSelect(options, val, label) {
  const w = document.createElement('div');
  w.className = 've-row ve-select-row';
  let optsHtml = '';
  for (const o of options) optsHtml += '<option value="' + o.val + '"' + (o.val === val ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  w.innerHTML = '<label>' + label + '</label><select>' + optsHtml + '</select>';
  return w;
}
function veFilterChips(active, onChange) {
  const w = document.createElement('div');
  w.className = 've-row ve-chips';
  w.innerHTML = '<span class="ve-chip-label">فیلتر</span>';
  Object.keys(VE_FILTERS).forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 've-chip' + (k === active ? ' active' : '');
    b.textContent = VE_FILTERS[k].label;
    b.onclick = () => { onChange(k); };
    w.appendChild(b);
  });
  return w;
}

/* ---------- مبدل GIF (دکمه‌ی تبدیل به GIF در نمایش‌گر ویدیو) ---------- */
function openGifConverter(videoSrc) {
  const pop = veOpenModal('تبدیل به GIF');
  const body = pop.querySelector('.ve-body');
  const foot = pop.querySelector('.ve-foot');
  const preview = document.createElement('video');
  preview.muted = true; preview.playsInline = true; preview.controls = true;
  preview.src = videoSrc;
  preview.className = 've-preview';
  const timeEl = document.createElement('div'); timeEl.className = 've-timebar-label';
  let meta = null, start = 0, end = 0;
  preview.onloadedmetadata = () => {
    meta = { dur: preview.duration };
    start = 0; end = Math.min(preview.duration, VE_MAX_SECONDS);
    endEl.max = preview.duration;
    startEl.min = 0; endEl.min = 0;
    startEl.max = preview.duration;
    syncRanges();
  };
  const startEl = document.createElement('input');
  startEl.type = 'range'; startEl.min = 0; startEl.step = 0.05; startEl.value = start;
  const endEl = document.createElement('input');
  endEl.type = 'range'; endEl.min = 0; endEl.step = 0.05; endEl.value = end;
  const syncPreview = () => { try { preview.currentTime = Number((meta && ((end + start) / 2)) || 0); } catch (e) {} };
  const syncRanges = () => { if (!meta) return; timeEl.textContent = veFmtTime(start) + ' — ' + veFmtTime(end) + '  (' + (end - start).toFixed(1) + 'ث)'; };
  const onStart = () => { start = Number(startEl.value); if (start >= end - 0.1) { start = Math.max(0, end - 0.1); startEl.value = start; } syncRanges(); syncPreview(); };
  const onEnd = () => { end = Number(endEl.value); if (end <= start + 0.1) { end = Math.min(meta ? meta.dur : end, start + 0.1); endEl.value = end; } syncRanges(); syncPreview(); };
  startEl.addEventListener('input', onStart);
  endEl.addEventListener('input', onEnd);
  const startRow = veRange2(0, 1, 0, 'شروع'); startRow.replaceChild(startEl, startRow.querySelector('input'));
  const endRow = veRange2(0, 1, 1, 'پایان'); endRow.replaceChild(endEl, endRow.querySelector('input'));
  const fpsSel = veSelect(VE_FPS_PRESETS.map((v) => ({ val: v, label: v + ' فریم/ثانیه' })), 10, 'سرعت فریم');
  const wSel = veSelect(VE_W_PRESETS.map((v) => ({ val: v, label: v + 'px' })), 320, 'عرض خروجی');
  const cssSel = document.createElement('span'); cssSel.className = 've-css-hint';
  cssSel.textContent = 'پیش‌نمایش زنده تا چند لحظه پس از ویرایش به‌روز می‌شود';
  const status = document.createElement('div'); status.className = 've-status';
  const bar = document.createElement('div'); bar.className = 've-bar';
  bar.innerHTML = '<div class="ve-bar-fill"></div>';

  body.appendChild(preview);
  body.appendChild(timeEl);
  body.appendChild(startRow);
  body.appendChild(endRow);
  body.appendChild(fpsSel);
  body.appendChild(wSel);
  body.appendChild(cssSel);

  const convertBtn = document.createElement('button');
  convertBtn.className = 'btn primary';
  convertBtn.textContent = 'تبدیل به GIF';
  foot.appendChild(convertBtn);
  foot.appendChild(status);
  foot.appendChild(bar);
  status.classList.add('hidden');

  convertBtn.onclick = (async () => {
    const dur = meta ? meta.dur : preview.duration;
    end = Math.min(end, dur);
    const opts = {
      start: start, end: end,
      fps: Number(fpsSel.querySelector('select').value),
      width: Number(wSel.querySelector('select').value),
      filter: 'none', text: '',
    };
    if ((end - start) * opts.fps > 320) { toast('طول GIF به‌دلیل محدودیت، کوتاه شد'); }
    convertBtn.disabled = true;
    status.classList.remove('hidden');
    let cancelled = false;
    status.innerHTML = 'در حال تبدیل… <span class="ve-cancel">لغو</span>';
    const cancelBtn = status.querySelector('.ve-cancel');
    cancelBtn.onclick = () => { cancelled = true; };
    try {
      const blob = await videoToGif(videoSrc, opts, (p) => {
        bar.querySelector('.ve-bar-fill').style.width = Math.round(p * 100) + '%';
      }, () => cancelled);
      if (cancelled || !blob) { toast('لغو شد'); status.classList.add('hidden'); convertBtn.disabled = false; return; }
      const gifRec = await saveToMyGifs(blob, 'GIF ' + new Date().toLocaleString('fa'));
      if (!gifRec) { toast('خطا در ذخیره'); convertBtn.disabled = false; return; }
      const doneRow = document.createElement('div');
      doneRow.className = 've-done';
      doneRow.innerHTML = '<img src="' + URL.createObjectURL(blob) + '" alt="">'
        + '<div class="ve-done-actions">'
        + '<button type="button" class="btn sm" data-a="send">ارسال در همین چت</button>'
        + '<button type="button" class="btn sm ghost" data-a="saved">در GIFهای من ذخیره شد ✓</button>'
        + '</div>';
      body.appendChild(doneRow);
      doneRow.querySelector('[data-a="send"]').onclick = () => {
        const f = new File([blob], (gifRec.name || 'gif') + '.gif', { type: 'image/gif' });
        sendFileMessage(f, f.name);
        toast('در حال ارسال…');
        pop.remove();
      };
      doneRow.querySelector('[data-a="saved"]').onclick = () => { doneRow.remove(); };
      status.classList.add('hidden');
      bar.querySelector('.ve-bar-fill').style.width = '100%';
      convertBtn.disabled = false;
      if (typeof renderGifGrid === 'function') { const g = $('emoji-grid'); if (g && emojiPanelTab === 'gif') renderGifGrid(g); }
    } catch (e) {
      console.error('GIF conversion error', e);
      status.classList.add('hidden');
      toast('خطا در ساخت GIF — ' + (e.message === 'canvas-tainted' ? 'ویدیو قابل‌پردازش نیست' : 'امتحان دوباره'));
      convertBtn.disabled = false;
    }
  });
}

/* ---------- ادیتور ویدیو (برش + متن + فیلتر + خروجی GIF/WebM) ---------- */
function openVideoEditor(videoSrc) {
  const pop = veOpenModal('ویرایش ویدیو');
  const body = pop.querySelector('.ve-body');
  const foot = pop.querySelector('.ve-foot');

  const preview = document.createElement('video');
  preview.muted = true; preview.playsInline = true; preview.controls = true;
  preview.src = videoSrc;
  preview.className = 've-preview';
  const timeEl = document.createElement('div'); timeEl.className = 've-timebar-label';
  let meta = null, start = 0, end = 0;
  preview.onloadedmetadata = () => {
    meta = { dur: preview.duration };
    start = 0; end = preview.duration;
    endEl.max = preview.duration;
    startEl.max = preview.duration;
    syncRanges();
  };
  const startEl = document.createElement('input');
  startEl.type = 'range'; startEl.min = 0; startEl.step = 0.05; startEl.value = start;
  const endEl = document.createElement('input');
  endEl.type = 'range'; endEl.min = 0; endEl.step = 0.05; endEl.value = end;
  const syncRanges = () => { if (!meta) return; timeEl.textContent = veFmtTime(start) + ' — ' + veFmtTime(end) + '  (' + (end - start).toFixed(1) + 'ث)'; };
  const onStart = () => { start = Number(startEl.value); if (start >= end - 0.1) { start = Math.max(0, end - 0.1); startEl.value = start; } syncRanges(); try { preview.currentTime = start; } catch (e) {} };
  const onEnd = () => { end = Number(endEl.value); if (end <= start + 0.1) { end = Math.min(meta ? meta.dur : end, start + 0.1); endEl.value = end; } syncRanges(); };
  startEl.addEventListener('input', onStart);
  endEl.addEventListener('input', onEnd);
  const startRow = veRange2(0, 1, 0, 'شروع'); startRow.replaceChild(startEl, startRow.querySelector('input'));
  const endRow = veRange2(0, 1, 1, 'پایان'); endRow.replaceChild(endEl, endRow.querySelector('input'));

  const textRow = document.createElement('div');
  textRow.className = 've-row ve-text-row';
  textRow.innerHTML = '<label>متن روی ویدیو</label><input type="text" maxlength="120" data-a="text" placeholder="مثلاً: دورهمی شب جمعه"><div class="ve-text-ops"><input type="color" data-a="color" value="#ffffff"><input type="number" data-a="size" min="12" max="72" value="28" title="سایز متن"></div>';
  let activeFilter = 'none';
  const chipsWrap = veFilterChips(activeFilter, (k) => {
    activeFilter = k;
    chipsWrap.querySelectorAll('.ve-chip').forEach((b) => {
      const lbl = b.textContent;
      const found = Object.keys(VE_FILTERS).find((kk) => VE_FILTERS[kk].label === lbl);
      b.classList.toggle('active', found === k);
    });
  });
  const fpsSel = veSelect(VE_FPS_PRESETS.map((v) => ({ val: v, label: v + ' فریم/ثانیه' })), 10, 'سرعت فریم');
  const wSel = veSelect([640, 480, 320, 240, 160].map((v) => ({ val: v, label: v + 'px' })), 480, 'عرض ویدیو');

  const status = document.createElement('div'); status.className = 've-status';
  const bar = document.createElement('div'); bar.className = 've-bar';
  bar.innerHTML = '<div class="ve-bar-fill"></div>';

  body.appendChild(preview);
  body.appendChild(timeEl);
  body.appendChild(startRow);
  body.appendChild(endRow);
  body.appendChild(textRow);
  body.appendChild(chipsWrap);
  body.appendChild(fpsSel);
  body.appendChild(wSel);
  foot.appendChild(status);
  foot.appendChild(bar);
  status.classList.add('hidden');

  const gifBtn = document.createElement('button');
  gifBtn.className = 'btn primary';
  gifBtn.textContent = 'خروجی GIF';
  const wmBtn = document.createElement('button');
  wmBtn.className = 'btn';
  wmBtn.textContent = 'خروجی ویدیو (WebM)';
  const dlBtn2 = document.createElement('button');
  dlBtn2.className = 'btn ghost';
  dlBtn2.textContent = 'گرفتن عکس (PNG)';
  foot.appendChild(gifBtn);
  foot.appendChild(wmBtn);
  foot.appendChild(dlBtn2);

  const readOpts = (width) => ({
    start: start, end: Math.min(end, meta ? meta.dur : end),
    fps: Number(fpsSel.querySelector('select').value),
    width: width,
    filter: activeFilter || 'none',
    text: (textRow.querySelector('[data-a="text"]').value || '').trim(),
    textColor: textRow.querySelector('[data-a="color"]').value || '#ffffff',
    textSize: Number(textRow.querySelector('[data-a="size"]').value) || 28,
    textPos: 'bottom',
  });

  const runBusy = (busy) => {
    gifBtn.disabled = busy; wmBtn.disabled = busy; dlBtn2.disabled = busy;
    if (busy) { status.classList.remove('hidden'); bar.querySelector('.ve-bar-fill').style.width = '0%'; }
    else status.classList.add('hidden');
  };

  gifBtn.onclick = async () => {
    runBusy(true);
    status.innerHTML = 'در حال ساخت GIF…';
    try {
      const blob = await videoToGif(videoSrc, readOpts(320), (p) => { bar.querySelector('.ve-bar-fill').style.width = Math.round(p * 100) + '%'; });
      if (!blob) { toast('لغو شد'); runBusy(false); return; }
      const g = await saveToMyGifs(blob, 'GIF ' + new Date().toLocaleString('fa'));
      const d = document.createElement('div'); d.className = 've-done';
      d.innerHTML = '<img src="' + URL.createObjectURL(blob) + '" alt=""><div><button type="button" class="btn sm" data-a="send">ارسال در چت</button></div>';
      d.querySelector('[data-a="send"]').onclick = () => { const f = new File([blob], (g && g.name || 'gif') + '.gif', { type: 'image/gif' }); sendFileMessage(f, f.name); toast('در حال ارسال…'); pop.remove(); };
      runBusy(false);
      status.classList.add('hidden');
      body.appendChild(d);
      if (typeof renderGifGrid === 'function') { const gg = $('emoji-grid'); if (gg && emojiPanelTab === 'gif') renderGifGrid(gg); }
    } catch (e) { console.error(e); runBusy(false); toast('خطا در خروجی GIF'); }
  };

  wmBtn.onclick = async () => {
    runBusy(true);
    status.innerHTML = 'در حال ضبط ویدیو…';
    try {
      const blob = await videoToWebM(videoSrc, readOpts(640), (p) => { bar.querySelector('.ve-bar-fill').style.width = Math.round(p * 100) + '%'; });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'video-' + Date.now() + '.webm'; a.click();
      const d = document.createElement('div'); d.className = 've-done';
      d.innerHTML = '<video src="' + URL.createObjectURL(blob) + '" controls muted playsinline></video><div><button type="button" class="btn sm" data-a="send">ارسال در چت</button></div>';
      d.querySelector('[data-a="send"]').onclick = () => { const f = new File([blob], 'video-' + Date.now() + '.webm', { type: 'video/webm' }); sendFileMessage(f, f.name); toast('در حال ارسال…'); pop.remove(); };
      runBusy(false);
      body.appendChild(d);
    } catch (e) { console.error(e); runBusy(false); toast('ویدیو در این مرورگر قابل ضبط نیست'); }
  };

  dlBtn2.onclick = async () => {
    runBusy(true);
    status.innerHTML = 'در حال گرفتن عکس…';
    try {
      const got = await veExtractFrames(videoSrc, Object.assign(readOpts(480), { fps: 1, end: Math.min(end, start + 0.1) }), null, null);
      if (!got || !got.frames.length) { toast('خطا'); runBusy(false); return; }
      const fr = got.frames[0];
      const c = document.createElement('canvas'); c.width = fr.width; c.height = fr.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(fr.pixels), fr.width, fr.height), 0, 0);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'snapshot-' + Date.now() + '.png'; a.click();
      runBusy(false);
      toast('عکس گرفته شد');
    } catch (e) { console.error(e); runBusy(false); toast('خطا در عکس'); }
  };
}

/* ---------- میان‌بر: ارسال مستقیم یک GIF ذخیره‌شده ---------- */
async function sendMyGif(gid) {
  const rec = await myGifsGet(gid);
  if (!rec) { toast('GIF یافت نشد'); return; }
  const f = new File([rec.blob], (rec.name || 'gif') + '.gif', { type: 'image/gif' });
  sendFileMessage(f, f.name);
}

/* ---------- ذخیرهٔ GIF دریافتی در «GIFهای من» ---------- */
/* گیرنده باید بتواند GIF طرف مقابل را هم برای خودش نگه دارد. اول از کش
   حافظه/IndexedDB استفاده می‌شود و اگر نبود با هدر احراز هویت دانلود می‌شود
   (چون /uploads با GET خالی ۴۰۱ می‌دهد). */
async function saveReceivedGif(url) {
  if (!url) return;
  toast('در حال ذخیره…');
  let blob = null;
  const mem = __memCache.get(url);
  if (mem) blob = await vxIdbGet(url);
  if (!blob) {
    try {
      const r = await fetch(url, { headers: state.token ? { Authorization: 'Bearer ' + state.token } : {} });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      blob = await r.blob();
    } catch (e) {
      toast('ذخیره نشد — ' + ((e && e.message) || 'خطا'));
      return;
    }
  }
  if (!blob || !blob.size) { toast('ذخیره نشد'); return; }
  const rec = await saveToMyGifs(blob, 'GIF ' + new Date().toLocaleString('fa'));
  if (!rec) { toast('ذخیره نشد'); return; }
  try { const g = $('emoji-grid'); if (g && emojiPanelTab === 'gif') renderGifGrid(g); } catch (e) {}
  toast('در GIFهای من ذخیره شد ✓');
}
/* GIFهای «پرطرفدار» روی media.giphy.com میزبانی می‌شوند ولی سرور فقط
   /uploads/... را می‌پذیرد؛ پس ارسال لینک خارجی بی‌صدا دور ریخته می‌شد و هیچ GIFی
   از پنل ایموجی فرستاده نمی‌شد. اول سرور فایل را می‌گیرد (به CORS وابسته نیست)،
   و اگر نتوانست — سرور اینترنت ندارد یا لینک گم شده — مرورگر خودش می‌گیرد و از
   مسیر معمولی /api/upload می‌فرستد. اگر هر دو شکست خوردند، متن خطای واقعی
   نشان داده می‌شود تا بشود علتش را دید. */
async function sendRemoteGif(url) {
  /* addUploadBubble حتماً Blob واقعی می‌خواهد (URL.createObjectURL با null خطا
     می‌دهد)؛ برای نمایش «در حال دریافت» یک GIF جای‌خالی کوچک می‌سازیم. */
  const placeholder = new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38])], { type: 'image/gif' });
  const wrap = addUploadBubble('file', placeholder, 'GIF');
  if (wrap._ring) dlSet(wrap._ring, 15);
  /* GIFهای «پرطرفدار» محلی‌اند (همان مبدأ) → نیازی به واسطه‌ی سرور نیست،
     مستقیم می‌گیریم و از مسیر معمولی آپلود می‌فرستیم. */
  const local = /^\/(img|uploads)\//.test(url) || url.startsWith(location.origin);
  let serverErr = '';
  try {
    let up;
    if (local) {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('مرورگر ' + res.status);
      const blob = await res.blob();
      if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('حجم نامناسب');
      up = new File([blob], 'gif.gif', { type: 'image/gif' });
    } else {
      const r = await fetch('/api/gif/ingest', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, state.token ? { Authorization: 'Bearer ' + state.token } : {}),
        body: JSON.stringify({ url: url }),
      });
      let d = null;
      try { d = await r.json(); } catch (e) {}
      if (!r.ok || !d || !d.url) {
        serverErr = 'سرور ' + r.status + ': ' + ((d && d.error) || 'پاسخ نامعتبر');
        throw new Error(serverErr);
      }
      dropUploadBubble(wrap);
      doSend({ kind: 'gif', src: d.url, name: 'gif', size: d.size, content: '' });
      return;
    }
    dropUploadBubble(wrap);
    sendFileMessage(up, up.name);
  } catch (e) {
    serverErr = (e && e.message) || String(e);
    if (wrap._ring) dlSet(wrap._ring, 45);
    /* اگر سرور هم در دسترس نبود (مثلاً بدون اینترنت یا فیلتر)، مرورگر خودش
       لینک خارجی را می‌گیرد و آپلود می‌کند. */
    if (!local) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('مرورگر ' + res.status);
        const blob = await res.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('حجم نامناسب');
        if (blob.type && blob.type.indexOf('gif') < 0) throw new Error('نوع ' + blob.type);
        dropUploadBubble(wrap);
        sendFileMessage(new File([blob], 'gif.gif', { type: 'image/gif' }), 'gif.gif');
        return;
      } catch (e2) {
        serverErr += ' | ' + ((e2 && e2.message) || String(e2));
      }
    }
    dropUploadBubble(wrap);
    console.error('sendRemoteGif failed for ' + url + ' -> ' + serverErr);
    toast('ارسال GIF ناموفق بود — ' + serverErr);
  }
}

(async function init() {
  try {
    bindCtxReposition();
    initMultiSelect();
    if (state.token) {
      const cached = cachedMe();
      if (cached) {
        /* یک‌راست داخل پیام‌رسان — بدون انتظار شبکه/بدون فلش صفحهٔ شماره */
        state.me = cached; enterApp();
        refreshMeSession();
      } else {
        /* توکن داریم ولی snapshot نداریم (اولین ورود لاگین قدیمی) — اسپلش تا تأیید */
        try { const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + state.token } }); if (r.ok) { const d = await r.json(); if (d.me) { state.me = d.me; cacheMeNow(); enterApp(); } else logout(true); } else logout(true); }
        catch (e) { console.error('init: /api/me failed', e); showAuth(); }
      }
    } else { showAuth(); }
    const requestNotifOnce = () => { if ('Notification' in window && Notification.permission === 'default') { Notification.requestPermission(); window.removeEventListener('click', requestNotifOnce, true); } };
    window.addEventListener('click', requestNotifOnce, true);
  } catch (e) {
    console.error('init crashed:', e);
    try { showAuth(); } catch (e2) { alert('VORTEX: خطا هنگام راه‌اندازی — ' + e.message); }
  }
})();
