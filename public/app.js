/* VORTEX Messenger — frontend (Premium Dark Cyber rebuild). Backend contract preserved. */
const $ = (s) => document.getElementById(s);
const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';
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
const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();
function ic(n) { return '<i data-lucide="' + n + '" class="icon"></i>'; }
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
function closeDrawers() { $('nav-sidebar').classList.remove('m-open'); $('details-panel').classList.remove('open'); showScrim(false); }

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
  room: null, replyTo: null, rooms: {}, chatFilter: 'all', search: '', nav: 'chats', notifications: [],
  deletedIds: new Set(),
  fontScale: parseInt(localStorage.getItem('vx_fontsize') || '14', 10),
  profileReturnRoom: null,  // Room to return to after closing profile
  profileReturnNav: null,  // Nav view to return to after closing profile
};

/* AUTH */
const authPhone = $('auth-phone'), authCode = $('auth-code'), authName = $('auth-name'), authUname = $('auth-username');
const stepPhone = $('auth-step-phone'), stepCode = $('auth-step-code'), stepName = $('auth-step-name'), stepPass = $('auth-step-pass');
const authError = $('auth-error');
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
function finishLogin(d) { if (d.me) savePhoneProfile(authPhoneVal, d.me.username, d.me.displayName); state.token = d.token; state.me = d.me; localStorage.setItem('ft_token', d.token); enterApp(); }
async function autoCompleteRegister(phone, code) {
  const prof = phoneProfiles()[phone];
  if (!prof || !prof.username) return false;
  const r = await fetch('/api/complete-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code, displayName: prof.displayName || prof.username, username: prof.username }) });
  const d = await r.json().catch(() => ({}));
  if (d.token && d.me) { finishLogin(d); return true; }
  return false;
}
$('auth-send').onclick = async () => {
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
$('auth-pass-to-phone').onclick = () => showAuthStep('phone');
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

/* APPEARANCE */
function applyAppearance() {
  const th = localStorage.getItem('vx_theme') || 'cyber';
  if (th === 'cyber' || !th) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  document.documentElement.setAttribute('data-accent', localStorage.getItem('vx_accent') || 'blue');
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
  renderNav(); renderDock(); buildChatList(); connectWS(); applyVX();
  showImpersonateBanner();
  if (state.me.isAdmin) {
    api('/api/admin/users').then((r) => r.json()).then((d) => { if (d.users) { state.users = d.users; buildChatList(); } }).catch(() => {});
    api('/api/admin/requests').then((r) => r.json()).then((d) => { const list = (d.requests || []).filter((s) => s.status === 'pending'); state.signupCount = list.length; renderNav(); }).catch(() => {});
  }
  if (isMobile()) { $('chat-list-column').classList.remove('m-open'); $('conversation').classList.remove('chat-open'); }
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
  { id: 'ai', label: 'دستیار هوشمند', icon: 'sparkles' },
  { id: 'cloud', label: 'حافظه ابری', icon: 'cloud' },
  { id: 'tasks', label: 'وظایف', icon: 'check-square' },
  { id: 'calendar', label: 'تقویم', icon: 'calendar' },
  { id: 'users', label: 'کاربران', icon: 'users' },
  { id: 'signups', label: 'درخواست تغییر نام', icon: 'user-plus' },
  { id: 'stats', label: 'آمار', icon: 'bar-chart-2' },
  { id: 'bookmarks', label: 'نشان‌ها', icon: 'bookmark' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
];
function renderNav() {
  const sc = $('nav-scroll'); sc.innerHTML = '';
  const nav = $('nav-profile');
  const av = avatarEl(state.me, 'sm'); av.id = 'nav-av'; nav.replaceChild(av, $('nav-av'));
  $('nav-name').textContent = state.me.displayName;
  nav.onclick = () => openProfile(state.me.username);
  const adminOnly = ['users', 'signups', 'stats'];
  NAV.forEach((n) => {
    if (adminOnly.includes(n.id) && !state.me.isAdmin) return;
    const d = document.createElement('div'); d.className = 'nav-item' + (state.nav === n.id ? ' active' : '');
    d.dataset.nav = n.id; d.innerHTML = ic(n.icon) + '<span class="label">' + n.label + '</span>' + (n.id === 'ai' ? '<span class="nav-badge">AI</span>' : '') + (n.id === 'signups' && state.signupCount ? '<span class="nav-badge">' + state.signupCount + '</span>' : '');
    d.onclick = () => switchNav(n.id); sc.appendChild(d);
  });
  luc();
}
$('nav-toggle').onclick = () => { if (isMobile()) { $('nav-sidebar').classList.remove('m-open'); showScrim(false); } else $('nav-sidebar').classList.toggle('expanded'); };
function switchNav(id) {
  state.nav = id;
  if (isMobile()) $('nav-sidebar').classList.remove('m-open');
  if (id === 'chats') { setMode('chats'); if (isMobile()) { closeDrawers(); $('conversation').classList.remove('chat-open'); } }
  else { setMode('view'); renderView(id); closeDrawers(); if (isMobile()) $('conversation').classList.add('chat-open'); }
  document.querySelectorAll('.nav-item').forEach((e) => e.classList.toggle('active', e.dataset.nav === id));
}
let viewHost = null;
function setMode(mode) {
  if (!viewHost) { viewHost = document.createElement('div'); viewHost.id = 'view-host'; viewHost.className = 'view hidden'; $('conversation').appendChild(viewHost); }
  const chat = mode === 'chats';
  $('conv-empty').classList.toggle('hidden', chat ? !!state.room : true);
  $('conv-main').classList.toggle('hidden', chat ? !state.room : true);
  viewHost.classList.toggle('hidden', chat);
  if (chat) { $('chat-list-column').classList.remove('hidden'); $('details-panel').classList.remove('hidden'); }
  else { $('chat-list-column').classList.add('hidden'); $('details-panel').classList.add('hidden'); }
}

/* DOCK */
const DOCK = [
  { id: 'ai', label: 'هوشمند', sub: 'دستیار', icon: 'sparkles' },
  { id: 'cloud', label: 'ابری', sub: 'فایل‌ها', icon: 'cloud' },
  { id: 'tasks', label: 'وظایف', sub: 'مدیریت', icon: 'check-square' },
  { id: 'calendar', label: 'تقویم', sub: 'رویدادها', icon: 'calendar' },
];
function renderDock() {
  const d = $('command-dock'); d.innerHTML = '';
  DOCK.forEach((it) => { const el = document.createElement('div'); el.className = 'dock-item'; el.innerHTML = ic(it.icon) + '<span class="dt">' + it.label + '</span><span class="ds">' + it.sub + '</span>'; el.onclick = () => switchNav(it.id); d.appendChild(el); });
  const sep = document.createElement('div'); sep.className = 'dock-sep'; d.appendChild(sep);
  const plus = document.createElement('div'); plus.className = 'dock-plus'; plus.innerHTML = ic('plus'); plus.title = 'جدید'; plus.onclick = (e) => { e.stopPropagation(); openNewMenu(e.currentTarget); }; d.appendChild(plus);
  luc();
}

/* WEBSOCKET */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host); state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: state.token }));
  ws.onmessage = (ev) => { try { handleWS(JSON.parse(ev.data)); } catch (e) {} };
  ws.onclose = () => setTimeout(() => { if (state.token && $('app') && !$('app').classList.contains('hidden')) connectWS(); }, 2500);
}
function handleWS(d) {
  switch (d.type) {
    case 'ready': state.me = d.me; state.groups = d.groups || []; state.chatState = d.chatState || {}; state.readState = d.readState || {}; state.pinned = d.pinned || {}; state.dmRooms = d.dmRooms || []; for (const [rid, pv] of Object.entries(d.previews || {})) { const pr = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); pr.messages = [pv]; pr.last = pv; pr.unread = pv.unread || 0; pr.previewOnly = true; } loadReactionConfig(); renderNav(); renderDock(); buildChatList(); handleInviteFollow(); break;
    case 'users': state.users = d.users || []; scheduleChatListRefresh(); break;
    case 'profile-updated': applyProfileUpdate(d); break;
    case 'groups': state.groups = d.groups || []; scheduleChatListRefresh(); break;
    case 'room-read': if (!state.readState[d.roomId]) state.readState[d.roomId] = {}; state.readState[d.roomId][d.username] = d.time; if (d.username === state.me.username && state.rooms[d.roomId]) state.rooms[d.roomId].unread = 0; scheduleChatListRefresh(); refreshReadTicks(d.roomId); break;
    case 'history': if (d.roomId !== state.room) { cachePreview(d.roomId, d.messages); scheduleChatListRefresh(); break; } if (d.roomId) cachePreview(d.roomId, d.messages); $('messages').innerHTML = ''; state.lastDay = null; d.messages.forEach(addMessage); renderReplyCounts(d.roomId); scrollBottom(); break;
    case 'message': onNewMessage(d.message); break;
    case 'message-updated': updateMessage(d); break;
    case 'message-edited': {
      const rr = state.rooms[d.roomId]; if (rr) { const mm = rr.messages.find((x) => x.id === d.id); if (mm) { mm.content = d.content; mm.edited = true; } scheduleChatListRefresh(120); }
      const el = document.querySelector('[data-id="' + d.id + '"] .msg-body'); if (el) { const old = el.querySelector('.msg-edited'); if (old) old.remove(); }
      const em = document.querySelector('[data-id="' + d.id + '"] .msg-meta'); if (em && !em.querySelector('.msg-ed')) { const ed = document.createElement('span'); ed.className = 'msg-ed'; ed.textContent = 'ویرایش‌شده'; em.insertBefore(ed, em.firstChild); }
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
      const rr = state.rooms[d.roomId]; if (rr) { rr.messages = rr.messages.filter((m) => m.id !== d.id); rr.last = rr.messages[rr.messages.length - 1] || null; scheduleChatListRefresh(120); }
      refreshDeletedRefs(d.id);
      if (d.roomId === state.room) renderReplyCounts(d.roomId);
      break;
    }
    case 'added-to': toast('به «' + (d.name || 'گروه') + '» اضافه شدی'); buildChatList(); break;
    case 'ai-thinking': if (d.roomId === state.room) { const sub = $('conv-sub'); if (sub) sub.textContent = 'هوش مصنوعی در حال فکر کردن…'; } break;
    case 'pinned-updated': state.pinned[d.roomId] = d.ids; renderDetails(); break;
    case 'room-deleted': {
      delete state.rooms[d.roomId];
      delete state.chatState[d.roomId];
      delete state.readState[d.roomId];
      delete state.pinned[d.roomId];
      if (state.dmRooms) state.dmRooms = state.dmRooms.filter((r) => r !== d.roomId);
      if (state.room === d.roomId) {
        state.room = null;
        const m = $('messages'); if (m) m.innerHTML = '';
        const dp = $('details-panel'); if (dp) { dp.classList.add('hidden'); dp.classList.remove('open'); }
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
function cachePreview(rid, msgs) { const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.messages = msgs; r.last = msgs[msgs.length - 1] || null; r.unread = 0; r.previewOnly = false; }
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
  const f = state.chatFilter;
  if (f === 'unread') rooms = rooms.filter((r) => r.unread > 0);
  else if (f === 'private') rooms = rooms.filter((r) => !r.isGroup && !r.isBot);
  else if (f === 'groups') rooms = rooms.filter((r) => r.isGroup);
  else if (f === 'channels') rooms = rooms.filter((r) => r.isGroup && (state.groups.find((g) => 'group:' + g.id === r.rid) || {}).type === 'channel');
  else if (f === 'bots') rooms = rooms.filter((r) => r.isBot);
  const blocked = (state.me && Array.isArray(state.me.blocked)) ? state.me.blocked : [];
  rooms = rooms.filter((r) => { if (r.isGroup || r.isBot) return true; const other = r.rid.slice(3).split('|').find((p) => p !== state.me.username); return !blocked.includes(other); });
  if (state.search) { const q = state.search.toLowerCase(); rooms = rooms.filter((r) => r.title.toLowerCase().includes(q)); }
  rooms.sort((a, b) => (b.pinned - a.pinned) || (b.lastTime - a.lastTime));
  const active = rooms.filter((r) => !r.archived);
  const archived = rooms.filter((r) => r.archived);
  if (!active.length && !archived.length) { wrap.innerHTML = '<div class="empty" style="padding:30px"><div class="ic">💬</div><div>چتی یافت نشد</div></div>'; return; }
  active.forEach((r) => wrap.appendChild(chatItemEl(r)));
  if (archived.length) {
    const head = document.createElement('div'); head.className = 'arch-head'; head.innerHTML = ic('archive') + '<span>آرشیو (' + archived.length + ')</span>'; head.onclick = () => { state.archivedOpen = !state.archivedOpen; buildChatList(); };
    wrap.appendChild(head);
    if (state.archivedOpen) archived.forEach((r) => { const el = chatItemEl(r); el.classList.add('archived'); wrap.appendChild(el); });
  }
  applyIcons(wrap);
}
function chatItemEl(r) {
  const it = document.createElement('div'); it.className = 'chat-item' + (state.room === r.rid ? ' active' : ''); it.dataset.roomId = r.rid;
  let avSrc = null;
  if (r.isGroup) { const g = state.groups.find((x) => 'group:' + x.id === r.rid); if (g && g.avatar) avSrc = g.avatar; }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: r.title } : (r.isBot ? { displayName: BOT_NAME } : { displayName: r.title }), 'md');
  it.innerHTML = '<div class="ci-av">' + av.outerHTML + (r.online ? '<span class="online-dot"></span>' : '') + '</div><div class="ci-body"><div class="ci-row1"><div class="ci-name">' + esc(r.title) + (r.isBot ? ' <span style="font-size:9px;background:var(--accent);color:var(--on-primary);padding:1px 5px;border-radius:6px">AI</span>' : '') + '</div><div class="ci-time">' + (r.lastTime ? fmt(r.lastTime) : '') + '</div></div><div class="ci-row2">' + (r.pinned ? ic('pin') : '') + (r.muted ? ic('volume-x') : '') + '<div class="ci-last">' + esc(r.lastMsg) + '</div>' + (r.unread ? '<div class="ci-badge">' + r.unread + '</div>' : '') + '</div></div>';
  it.onclick = () => openRoom(r.rid); it.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, r.rid); };
  return it;
}
function computeUnread(rid, r) {
  if (!r) return 0;
  if (r.previewOnly) return r.unread || 0;
  if (!r.last) return 0; const rs = state.readState[rid] || {}; const read = rs[state.me.username] || 0; if (r.last.time <= read) return 0; return r.messages.filter((m) => m.time > read && m.from !== state.me.username).length;
}
function roomMembers(rid) { if (rid.startsWith('dm:')) return rid.slice(3).split('|'); if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members : []; } return []; }
function isReadByOther(rid, m) { const rs = state.readState[rid] || {}; return roomMembers(rid).some((u) => u !== state.me.username && (rs[u] || 0) >= m.time); }
function refreshReadTicks(rid) { if (rid !== state.room) return; const r = state.rooms[rid]; if (!r) return; document.querySelectorAll('#messages .bubble').forEach((b) => { const m = r.messages.find((x) => x.id === b.dataset.id); if (!m || m.from !== state.me.username) return; const span = b.querySelector('.msg-meta .msg-time'); if (!span) return; const tick = span.querySelector('svg'); const want = isReadByOther(rid, m); const has = !!tick; if (want && !has) { span.insertAdjacentHTML('afterbegin', ic('check-check')); applyIcons(span); } else if (!want && has) { tick.remove(); span.insertAdjacentHTML('afterbegin', ic('check')); applyIcons(span); } }); }
function previewText(m) {
  if (!m) return ''; if (m.kind === 'image') return '📷 تصویر'; if (m.kind === 'video') return '🎬 ویدیو'; if (m.kind === 'file') return '📎 فایل' + (m.name ? ': ' + m.name : ''); if (m.kind === 'audio' || m.kind === 'voice') return '🎙 پیام صوتی'; if (m.kind === 'sticker') return 'استیکر'; if (m.kind === 'poll') return '📊 نظرسنجی'; if (m.kind === 'checklist') return '✅ چک‌لیست'; return (m.content || '').slice(0, 60);
}
function msgSenderName(m) {
  if (!m) return '';
  if (m.from === state.me.username) return 'شما';
  const uid = m.from || '';
  const u = state.users.find((x) => x.username === uid);
  return m.fromName || (u && u.displayName) || uid || '';
}
$('cl-tabs').addEventListener('click', (e) => { const t = e.target.closest('.cl-tab'); if (!t) return; document.querySelectorAll('.cl-tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); state.chatFilter = t.dataset.tab; buildChatList(); });
$('cl-search-input').addEventListener('input', (e) => { state.search = e.target.value; buildChatList(); });
$('cl-new').onclick = (e) => { e.stopPropagation(); openNewMenu(); };
$('cl-menu').onclick = () => { const open = !$('nav-sidebar').classList.contains('m-open'); $('nav-sidebar').classList.toggle('m-open', open); showScrim(open); };
/* PART 2 — conversation, messages, composer, details */
function openRoom(rid) {
  closeMsgCtx();
  exitSelectMode();
  state.room = rid; state.replyTo = null;
  setReply(null);
  document.querySelectorAll('.chat-item').forEach((e) => e.classList.toggle('active', e.dataset.roomId === rid));
  if (isMobile()) { $('details-panel').classList.remove('open'); } else { $('details-panel').classList.add('hidden'); }
  renderRoomHeader(); markRead(rid); buildChatList();
  setMode('chats');
  if (isMobile()) { $('details-panel').classList.remove('open'); $('conversation').classList.add('chat-open'); showScrim(false); }
  const roomCache = state.rooms[rid] || {};
  const cachedMsgs = roomCache.messages || [];
  const canRenderCache = cachedMsgs.length && !roomCache.previewOnly;
  if (state.ws && state.ws.readyState === 1) {
    if (canRenderCache) { $('messages').innerHTML = ''; state.lastDay = null; cachedMsgs.forEach(addMessage); scrollBottom(); }
    state.ws.send(JSON.stringify({ type: 'history', roomId: rid }));
  } else {
    $('messages').innerHTML = ''; state.lastDay = null; cachedMsgs.forEach(addMessage); scrollBottom();
  }
}
function roomTitle(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.name : rid; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return BOT_NAME; const u = state.users.find((x) => x.username === other); return u ? (u.displayName || other) : (getContacts()[other] || other); }
function roomOnline(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members.length + ' عضو' : ''; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return 'آنلاین'; const u = state.users.find((x) => x.username === other); if (state.me.isAdmin) return u ? (u.online && !u.banned ? 'آنلاین' : 'آفلاین') : ''; return ''; }
function renderRoomHeader() {
  $('conv-name').textContent = roomTitle(state.room); $('conv-sub').textContent = roomOnline(state.room);
  let avSrc = null;
  if (state.room && state.room.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === state.room); if (g && g.avatar) avSrc = g.avatar; }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: roomTitle(state.room) } : { displayName: roomTitle(state.room) }, 'sm');
  av.id = 'conv-av'; const old = $('conv-av'); if (old) old.replaceWith(av);
  $('conv-name').onclick = $('conv-av').onclick = () => {
    if (!state.room) return;
    if (state.room.startsWith('dm:')) {
      const other = state.room.slice(3).split('|').find((p) => p !== state.me.username);
      if (other && other !== BOT_USERNAME) openProfile(other, state.room);
    } else { toast('پروفایل گروه از بخش اطلاعات قابل مشاهده است'); }
  };
  $('conv-name').style.cursor = 'pointer';
}
$('conv-info').onclick = () => { if (isMobile()) { const open = !$('details-panel').classList.contains('open'); $('details-panel').classList.toggle('open', open); showScrim(open); renderDetails(); } else { $('details-panel').classList.toggle('hidden'); renderDetails(); } };
$('conv-back').onclick = () => { state.room = null; buildChatList(); setMode('chats'); if (isMobile()) { $('conversation').classList.remove('chat-open'); } };
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
  const rid = m.roomId; const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.previewOnly = false; r.messages.push(m); r.last = m;
  if (rid.startsWith('dm:') && m.from !== state.me.username && !getContacts()[m.from] && m.from !== BOT_USERNAME) { const c = getContacts(); const u = state.users.find((x) => x.username === m.from); c[m.from] = u ? (u.displayName || m.from) : m.from; saveContacts(c); }
  if (rid === state.room) { addMessage(m); if (m.from === state.me.username || isNearBottom()) scrollBottom(); markRead(rid); renderReplyCounts(state.room); }
  else { r.unread = computeUnread(rid, r); beep(); pushNotification(m); }
  scheduleChatListRefresh(rid === state.room ? 120 : 250);
  const dp = $('details-panel');
  if (rid === state.room && dp && dp.style.display !== 'none' && !dp.classList.contains('hidden')) renderDetails();
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
function addMessage(m) {
  const msgs = $('messages'); const d = new Date(m.time); const ds = d.toLocaleDateString('fa-IR');
  if (ds !== state.lastDay) { state.lastDay = ds; const sep = document.createElement('div'); sep.className = 'day-sep'; sep.innerHTML = '<span>' + ds + '</span>'; msgs.appendChild(sep); }
  const mine = m.from === state.me.username;   const wrap = document.createElement('div'); wrap.className = 'msg ' + (mine ? 'mine' : ''); wrap.dataset.id = m.id;
  if (showMsgAvatar()) {
    const av = mine ? avatarEl(state.me, 'xs') : avatarEl(state.users.find((u) => u.username === m.from) || { displayName: m.from }, 'xs');
    wrap.innerHTML = '<div class="msg-av">' + av.outerHTML + '</div>';
  } else {
    wrap.classList.add('no-av');
  }
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dataset.id = m.id; bubble.dataset.from = m.from || '';
  bubble.appendChild(bodyEl(m));
  const meta = document.createElement('div'); meta.className = 'msg-meta';
  const timeHtml = '<span class="msg-time">' + (mine ? (isReadByOther(state.room, m) ? ic('check-check') : ic('check')) : '') + fmt(m.time) + '</span>';
  meta.innerHTML = (m.edited || m.editedAt) ? '<span class="msg-ed">ویرایش‌شده</span>' + timeHtml : timeHtml;
  bubble.appendChild(meta);
  applyReplyBadge(wrap, m);
  wrap.appendChild(bubble);
  const hasReactions = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions) && Object.keys(m.reactions).some((k) => (Array.isArray(m.reactions[k]) ? m.reactions[k].length > 0 : !!m.reactions[k])));
  if (hasReactions) wrap.appendChild(reactionsEl(m));
  const actions = document.createElement('div'); actions.className = 'msg-actions';
  let actionsHTML = '<button class="icon-btn" data-a="smile">' + ic('smile') + '</button><button class="icon-btn" data-a="reply">' + ic('reply') + '</button><button class="icon-btn" data-a="forward">' + ic('forward') + '</button>';
  if (m.from === state.me.username) actionsHTML += '<button class="icon-btn danger" data-a="delete">' + ic('trash-2') + '</button>';
  actionsHTML += '<button class="icon-btn" data-a="more">' + ic('more-vertical') + '</button>';
  actions.innerHTML = actionsHTML;
  actions.querySelector('[data-a="smile"]').onclick = (e) => { e.stopPropagation(); openReactionPicker(m, bubble); };
  actions.querySelector('[data-a="reply"]').onclick = (e) => { e.stopPropagation(); setReply(m); };
  actions.querySelector('[data-a="forward"]').onclick = (e) => { e.stopPropagation(); openForward(m.id); };
  if (m.from === state.me.username) actions.querySelector('[data-a="delete"]').onclick = async (e) => { e.stopPropagation(); if (await uConfirm('حذف شود؟') && state.ws) state.ws.send(JSON.stringify({ type: 'delete-message', roomId: state.room, id: m.id })); };
  actions.querySelector('[data-a="more"]').onclick = (e) => { e.stopPropagation(); const w = e.target.closest('.msg'); const anchor = w ? (w.querySelector('.bubble') || w) : null; openMsgCtx(m, anchor, { x: e.clientX, y: e.clientY }); };
  wrap.appendChild(actions);
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
  msgs.appendChild(wrap); applyIcons(wrap);
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
  if (m.kind === 'image' || m.kind === 'video') { b.appendChild(mediaEl(m)); }
  else if (m.kind === 'album') { b.appendChild(albumEl(m)); }
  else if (m.kind === 'voice') { b.appendChild(voiceEl(m)); }
  else if (m.kind === 'file' || m.kind === 'audio') { b.appendChild(fileEl(m)); }
  else if (m.kind === 'sticker') { const s = document.createElement('img'); s.className = 'sticker'; s.src = m.sticker || m.content; b.appendChild(s); }
  else if (m.kind === 'poll') { b.appendChild(pollEl(m)); }
  else if (m.kind === 'checklist') { b.appendChild(checklistEl(m)); }
  else b.textContent = m.content || '';
  return b;
}
function mediaEl(m) {
  const d = document.createElement('div'); d.className = 'media';
  const u = m.src || m.url;
  if (m.kind === 'video') {
    const v = document.createElement('video');
    v.controls = true; v.preload = 'none'; v.playsInline = true;
    attachVideoTransfer(d, v, u);
    v.onclick = () => { if (v.src) openViewer(u, 'video'); };
    d.appendChild(v);
  } else {
    const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
    attachImageTransfer(d, im, u);
    d.appendChild(im);
  }
  if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); }
  return d;
}
function albumEl(m) {
  const d = document.createElement('div'); d.className = 'album-grid';
  const urls = m.album || m.urls || (m.src ? [m.src] : m.url ? [m.url] : []);
  urls.forEach((url, i) => {
    const item = document.createElement('div'); item.className = 'album-item';
    const isVid = /\.(mp4|webm|ogg)$/i.test(url);
    if (isVid) {
      const v = document.createElement('video'); v.loading = 'lazy'; v.playsInline = true;
      attachVideoTransfer(item, v, url);
      v.onclick = () => { if (v.src) openViewer(url, 'video'); };
      item.appendChild(v);
    } else {
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = '';
      attachImageTransfer(item, im, url);
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
  const btn = document.createElement('button'); btn.className = 'file-dl'; btn.title = 'دانلود'; btn.innerHTML = ic('download');
  d.appendChild(btn);
  const startSize = (m.size ? fmtBytes(m.size) : '');
  const sizeEl = d.querySelector('.file-size');
  const stop = () => { btn.innerHTML = ic('download'); btn.onclick = start; };
  function start() {
    const ring = dlRing(30);
    btn.innerHTML = ''; btn.appendChild(ring);
    sizeEl.classList.remove('err-txt');
    sizeEl.textContent = startSize;
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
    fetchMediaStream(m.src || m.url, (p) => dlSet(ring, p), ok, fail);
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
  d.innerHTML = '<button class="voice-play" aria-label="پخش">' + ic('loader') + '</button>'
    + '<div class="voice-wave">' + waveHtml + '<span class="voice-line"></span></div>'
    + '<span class="voice-time">' + (dur ? fmtDur(dur) : '0:00') + '</span>'
    + '<button class="voice-speed" title="سرعت پخش">1x</button>'
    + '<audio src="' + esc(u) + '" preload="metadata"></audio>';

  const btn = d.querySelector('.voice-play');
  const aud = d.querySelector('audio');
  const speedBtn = d.querySelector('.voice-speed');
  const timeEl = d.querySelector('.voice-time');
  const waveEl = d.querySelector('.voice-wave');
  const barEls = Array.from(d.querySelectorAll('.voice-wave > i'));
  const speeds = [1, 1.5, 2];
  let speedIdx = 0;
  const totalDur = dur || 0;

  function fmtDur(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }

  const toggle = () => {
    if (d.classList.contains('voice-error')) {
      aud.load();
      d.classList.remove('voice-error');
      d.classList.add('voice-loading');
      btn.innerHTML = ic('loader');
      return;
    }
    if (aud.paused) {
      if (window._cva && window._cva !== aud) { window._cva.pause(); window._cva.currentTime = 0; }
      window._cva = aud;
      aud.play().catch(() => { d.classList.add('voice-error'); btn.innerHTML = ic('refresh-cw'); });
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
    btn.innerHTML = ic('play');
    if (!totalDur) timeEl.textContent = fmtDur(aud.duration);
    luc();
  };
  aud.onerror = () => {
    d.classList.remove('voice-loading');
    d.classList.add('voice-error');
    btn.innerHTML = ic('refresh-cw');
    luc();
  };
  aud.onplay = () => { d.classList.add('voice-playing'); d.classList.remove('voice-error'); btn.innerHTML = ic('pause'); paint(); luc(); };
  aud.onpause = () => { d.classList.remove('voice-playing'); btn.innerHTML = ic('play'); luc(); paint(); };
  aud.onended = () => { d.classList.remove('voice-playing'); btn.innerHTML = ic('play'); luc(); paint(); if (window._cva === aud) window._cva = null; };
  aud.ontimeupdate = paint;
  return d;
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
});
$('composer-input').addEventListener('blur', () => sendTyping(false));
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
function memCacheSet(k, v) {
  if (__memCache.size >= (LOW_END ? 20 : 80)) { const first = __memCache.keys().next().value; try { URL.revokeObjectURL(first); } catch (e) {} __memCache.delete(first); }
  __memCache.set(k, v);
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
  if (cached) { im.src = cached; im.onclick = () => openViewer(src, 'image'); return; }
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
      memCacheSet(src, burl);
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
  if (cached) { v.src = cached; return; }
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
      const nu = URL.createObjectURL(new Blob(st.chunks, { type: ct }));
      v.src = nu;
      memCacheSet(src, nu);
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
    const kind = isImg ? 'image' : isVid ? 'video' : isAud ? 'voice' : 'file';
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
const EMOJI_PIN_KEY = 'vx_emoji_pinned';
function emojiPinned() { return localStorage.getItem(EMOJI_PIN_KEY) === '1'; }
function emojiPopEl() { return $('emoji-pop'); }
function closeEmojiPop() {
  const pop = emojiPopEl(); if (!pop) return;
  pop.classList.add('hidden'); pop.classList.remove('mobile', 'docked');
}
function emojiPopOpen() { const pop = emojiPopEl(); return pop && !pop.classList.contains('hidden'); }
function insertEmoji(e) {
  const inp = $('composer-input');
  inp.value += e;
  inp.focus();
  if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.dispatchEvent(new Event('input'));
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
    + '<button type="button" class="icon-btn emoji-pin" title="پین کردن"></button>'
    + '<input id="emoji-search" class="input emoji-search-inp" placeholder="جستجوی ایموجی..." />'
    + '<button type="button" class="icon-btn emoji-close" title="بستن">' + ic('x') + '</button>'
    + '</div>'
    + '<div class="emoji-dock-body"><div class="emoji-cats" id="emoji-cats"></div><div class="emoji-grid" id="emoji-grid"></div></div>';
  const cats = pop.querySelector('#emoji-cats');
  const grid = pop.querySelector('#emoji-grid');
  const search = pop.querySelector('#emoji-search');
  pop.querySelector('.emoji-close').onclick = (e) => { e.stopPropagation(); closeEmojiPop(); };
  pop.querySelector('.emoji-pin').onclick = (e) => {
    e.stopPropagation();
    const pinned = !emojiPinned();
    localStorage.setItem(EMOJI_PIN_KEY, pinned ? '1' : '0');
    pop.classList.toggle('docked', pinned);
    updateEmojiPinBtn();
    if (pinned) toast('ایموجی‌ها پین شدند — همیشه باز');
    else toast('پین برداشته شد');
  };
  Object.keys(EMOJI_CATEGORIES).forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat.split(' ')[0];
    btn.title = cat;
    btn.onclick = () => { cats.querySelectorAll('.emoji-cat-btn').forEach((b) => b.classList.remove('active')); btn.classList.add('active'); renderEmojiGrid(grid, EMOJI_CATEGORIES[cat]); search.value = ''; };
    cats.appendChild(btn);
  });
  renderEmojiGrid(grid, EMOJI_CATEGORIES[Object.keys(EMOJI_CATEGORIES)[0]]);
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
}
function openEmojiPop() {
  const pop = emojiPopEl(); if (!pop) return;
  buildEmojiPopContent(pop);
  pop.classList.remove('hidden');
  pop.classList.toggle('mobile', isMobile());
  pop.classList.toggle('docked', emojiPinned());
}
function toggleEmojiPop(src) {
  const pop = emojiPopEl(); if (!pop) return;
  if (emojiPopOpen()) { closeEmojiPop(); return; }
  openEmojiPop();
  if (!isMobile() && !emojiPinned() && src && src.getBoundingClientRect) {
    const r = src.getBoundingClientRect();
    pop.classList.remove('docked');
    pop.style.left = ''; pop.style.top = '';
    const pw = 340, ph = 400;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
}
$('composer-emoji').onclick = (e) => { e.stopPropagation(); toggleEmojiPop($('composer-emoji')); };
document.addEventListener('click', (e) => {
  const pop = emojiPopEl();
  if (!pop || pop.classList.contains('hidden') || emojiPinned()) return;
  if (!pop.contains(e.target) && !($('composer-emoji') && $('composer-emoji').contains(e.target))) closeEmojiPop();
});
function renderEmojiGrid(grid, emojis) {
  grid.innerHTML = '';
  emojis.forEach((e) => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    s.textContent = e;
    s.onclick = () => { insertEmoji(e); };
    grid.appendChild(s);
  });
}
$('composer-attach').onclick = () => $('file-input').click();
$('file-input').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; sendFileMessage(f, f.name || 'file'); };
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
    + '<div class="voice-wave">' + Array.from({length:30}, () => '<i style="height:20%;opacity:.3"></i>').join('') + '</div>'
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
    + '<button class="voice-play" title="ارسال مجدد">' + ic('refresh-cw') + '</button>'
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

$('composer-sticker').onclick = () => { const m = { kind: 'sticker', sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f600.png' }; doSend(m); };
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
$('messages').addEventListener('click', (e) => {
  if (!isMobile() || _selectMode) return;
  if (e.target.closest('a, button, input, textarea, select, .reac, .reply-ref, .msg-actions, .emoji-pop, .react-pop, .msg-ctx, .msg-sheet, .ctx-scrim, video, audio')) return;
  const tg = e.target.closest('img');
  if (tg && !tg.classList.contains('sticker')) return;
  const msgEl = e.target.closest('.msg');
  if (!msgEl || !msgEl.dataset.id) return;
  const m = (state.rooms[state.room] || {}).messages.find((x) => x.id === msgEl.dataset.id);
  if (!m) return;
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
  sheet.innerHTML = '<div class="rs-head"><span class="rs-emoji">' + esc(emoji) + '</span><span class="rs-title">واکنش‌ها</span><button type="button" class="icon-btn" data-rs-close>' + ic('x') + '</button></div><div class="rs-list"><div class="rs-empty">در حال بارگذاری…</div></div>';
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
function markRead(rid) { if (!rid) return; if (!state.readState[rid]) state.readState[rid] = {}; state.readState[rid][state.me.username] = Date.now(); if (state.rooms[rid]) state.rooms[rid].unread = 0; scheduleChatListRefresh(120); if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'read', roomId: rid })); }

/* DETAILS PANEL */
function renderDetails() {
  const p = $('details-panel'); const rid = state.room; if (!rid) return; p.classList.remove('hidden'); p.innerHTML = '';
  const close = document.createElement('div'); close.className = 'dp-close'; close.innerHTML = ic('x'); close.onclick = () => p.classList.add('hidden'); p.appendChild(close);
  const head = document.createElement('div'); head.className = 'dp-head'; head.innerHTML = avatarEl(rid.startsWith('group:') ? { displayName: roomTitle(rid) } : { displayName: roomTitle(rid) }, 'lg').outerHTML + '<div class="dp-name">' + esc(roomTitle(rid)) + '</div><div class="dp-sub">' + esc(roomOnline(rid)) + '</div>'; p.appendChild(head);
  const flags = chatFlags(rid); const tog = (label, key, icon) => { const r = document.createElement('div'); r.className = 'dp-row'; r.innerHTML = ic(icon || 'bell') + '<span>' + label + '</span><label class="switch"><input type="checkbox" ' + (flags[key] ? 'checked' : '') + '><span class="slider"></span></label>'; r.querySelector('input').onchange = () => setFlag(rid, key, r.querySelector('input').checked); p.appendChild(r); };
  tog('پین کردن چت', 'pinned', 'pin'); tog('بی‌صدا', 'muted', 'volume-x'); tog('مخفی کردن', 'hidden', 'eye-off'); tog('قفل چت', 'locked', 'lock');
  const pins = (state.pinned[rid] || []); if (pins.length) { const sec = document.createElement('div'); sec.className = 'dp-sec'; sec.innerHTML = '<div class="dp-sec-title">' + ic('pin') + ' پیام‌های پین‌شده</div>'; pins.forEach((id) => { const msg = (state.rooms[rid] || {}).messages.find((x) => x.id === id); if (!msg) return; const it = document.createElement('div'); it.className = 'dp-pin'; it.innerHTML = '<span>' + esc(previewText(msg)) + '</span>'; it.onclick = () => { const el = document.querySelector('[data-id="' + id + '"]'); if (el) el.scrollIntoView(); }; sec.appendChild(it); }); p.appendChild(sec); }
  const act = document.createElement('div'); act.className = 'dp-sec'; act.innerHTML = '<div class="dp-sec-title">عملیات</div>';
  const mk = (label, icon, fn) => { const r = document.createElement('div'); r.className = 'dp-act'; r.innerHTML = ic(icon) + '<span>' + label + '</span>'; r.onclick = fn; return r; };
  if (rid.startsWith('dm:')) act.appendChild(mk('پاک کردن چت', 'trash-2', () => deleteChat(rid)));
  else act.appendChild(mk('پاک کردن تاریخچه', 'trash-2', async () => { if (await uConfirm('پاک شود؟')) { $('messages').innerHTML = ''; state.lastDay = null; } }));
  if (rid.startsWith('group:')) {
    const g = state.groups.find((x) => 'group:' + x.id === rid);
    if (g) {
      if (g.owner === state.me.username) act.appendChild(mk('مدیریت گروه', 'settings', () => toast('مدیریت گروه')));
      act.appendChild(mk('لینک دعوت', 'link', async () => {
        try {
          const res = await api('/api/groups/' + g.id + '/invite');
          const d = await res.json();
          if (d.ok) {
            const link = location.origin + d.link;
            navigator.clipboard.writeText(link).then(() => toast('لینک دعوت کپی شد')).catch(() => {});
            if (await uConfirm('لینک دعوت:\n' + link + '\n\nآیا می‌خواهید کپی شود؟')) {
              navigator.clipboard.writeText(link).catch(() => {});
            }
          }
        } catch (e) { toast('خطا در دریافت لینک'); }
      }));
    }
  }
  act.appendChild(mk('مشاهده پروفایل', 'user', () => { const other = rid.startsWith('dm:') ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null; if (other) openProfile(other, state.room || rid); else toast('نمایش پروفایل برای گروه در دسترس نیست'); }));
  if (rid.startsWith('dm:')) {
    const other = rid.slice(3).split('|').find((p) => p !== state.me.username);
    if (other && other !== BOT_USERNAME) {
      const isBlocked = state.me.blocked && state.me.blocked.includes(other);
      act.appendChild(mk(isBlocked ? 'آنبلاک کردن' : 'مسدود کردن', isBlocked ? 'user-check' : 'user-x', () => toggleBlock(other)));
    }
  }
  p.appendChild(act); luc();
}
async function toggleBlock(other) {
  if (!other) return;
  const isBlocked = state.me.blocked && state.me.blocked.includes(other);
  if (isBlocked) {
    const res = await api('/api/unblock', { method: 'POST', body: JSON.stringify({ username: other }) });
    const d = await res.json();
    if (d.ok) { state.me.blocked = d.blocked; toast('کاربر آنبلاک شد'); buildChatList(); renderDetails(); }
    else toast(d.error || 'خطا در آنبلاک');
  } else {
    if (!(await uConfirm('آیا می‌خواهید این کاربر را مسدود کنید؟'))) return;
    const res = await api('/api/block', { method: 'POST', body: JSON.stringify({ username: other }) });
    const d = await res.json();
    if (d.ok) { state.me.blocked = d.blocked; toast('کاربر مسدود شد'); buildChatList(); renderDetails(); }
    else toast(d.error || 'خطا در مسدودسازی');
  }
}
async function deleteChat(rid) {
  if (!rid || !rid.startsWith('dm:')) return;
  if (!(await uConfirm('چت به‌طور کامل حذف شود؟ تاریخچه برای هر دو طرف پاک می‌شود.'))) return;
  try {
    const res = await api('/api/chats/delete', { method: 'POST', body: JSON.stringify({ roomId: rid }) });
    const d = await res.json();
    if (d.ok) { toast('چت پاک شد'); }
    else toast(d.error || 'خطا در پاک‌کردن چت');
  } catch (e) { toast('خطا در پاک‌کردن چت'); }
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
      mk('پاک کردن چت', 'trash-2', () => deleteChat(rid));
    }
  }
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
  if (m.from === state.me.username) mk('ویرایش', 'edit-3', function() { uPrompt('ویرایش پیام', m.content, 'متن جدید پیام').then(function(t) { if (t && state.ws) state.ws.send(JSON.stringify({ type: 'edit-message', roomId: state.room, id: m.id, content: t })); }); });
  if (m.from === state.me.username || (state.me && state.me.isAdmin)) mk('حذف', 'trash-2', function() { uConfirm('حذف شود؟').then(function(y) { if (y && state.ws) state.ws.send(JSON.stringify({ type: 'delete-message', roomId: state.room, id: m.id })); }); });
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
  if (!(await uConfirm(ids.length + ' پیام حذف شود؟'))) return;
  ids.forEach((id) => state.ws.send(JSON.stringify({ type: 'delete-message', roomId: state.room, id })));
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
  dragAutoScroll(e.clientY);
  const band = [Math.min(_dragSel.startY, e.clientY), Math.max(_dragSel.startY, e.clientY)];
  if (_dragSelFrame) return;
  _dragSelFrame = requestAnimationFrame(() => { _dragSelFrame = null; bandSelect(band[0], band[1], _dragSel && _dragSel.cached); });
}
function dragSelUp(e) {
  const drag = _dragSel; _dragSel = null; _dragSelFrame = null;
  window.removeEventListener('pointermove', dragSelMove);
  window.removeEventListener('pointerup', dragSelUp);
  window.removeEventListener('pointercancel', dragSelUp);
  document.body.classList.remove('drag-sel');
  if (drag && drag.moved) swallowNextClick(350);
}
function dragAutoScroll(clientY) {
  const c = $('messages'); if (!c) return;
  const r = c.getBoundingClientRect();
  const edge = 44;
  if (clientY < r.top + edge) c.scrollTop -= 10;
  else if (clientY > r.bottom - edge) c.scrollTop += 10;
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
      dragAutoScroll(t.clientY);
      bandSelect(Math.min(_touchDrag.startY, t.clientY), Math.max(_touchDrag.startY, t.clientY), null);
    }
    return;
  }
  if (!_lpTimer || !_lpStart) return;
  const t = e.touches ? e.touches[0] : e;
  if (Math.abs(t.clientX - _lpStart.x) > 10 || Math.abs(t.clientY - _lpStart.y) > 10) { cancelLp(); }
}
function lpEnd() {
  _touchDrag = null;
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
async function logout(force) { if (!force && !(await uConfirm('آیا می‌خواهید از حساب خارج شوید؟'))) return; try { if (state.token) await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token } }); } catch (e) {} try { if (state.ws) state.ws.close(); } catch (e) {} localStorage.removeItem('ft_token'); location.reload(); }
$('auth-logout').onclick = logout;
function showAuth() {
  $('auth-screen').classList.remove('hidden');
  const lb = $('auth-logout');
  if (lb) lb.style.display = (localStorage.getItem('ft_token') || localStorage.getItem('ft_admin_token')) ? '' : 'none';
}

/* PROFILE */

/* VIEWER */
function openViewer(src, kind) { const v = document.createElement('div'); v.className = 'viewer'; const s = esc(src); v.innerHTML = (kind === 'video' ? '<video src="' + s + '" controls autoplay></video>' : '<img src="' + s + '">') + '<div class="v-close" onclick="this.parentNode.remove()">' + ic('x') + '</div>'; v.onclick = (e) => { if (e.target === v) v.remove(); }; document.body.appendChild(v); luc(); }

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

/* NEW MENU */
function openNewMenu(anchor) {
  // اگر باز است، ببند (تاگل) و جلوگیری از چند منوی روی‌هم
  const opened = document.querySelectorAll('.ctx-menu');
  if (opened.length) { opened.forEach((n) => n.remove()); return; }
  const pop = document.createElement('div'); pop.className = 'ctx-menu';
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
    if (!list.length) { listEl.innerHTML = '<div class="contact-empty">هنوز مخاطبی ثبت نشده است. از دکمه + یک چت جدید شروع کن یا بالا جستجو کن.</div>'; return; }
    let h = '<div class="contact-list">';
    list.forEach((u) => {
      const online = state.me.isAdmin ? !!u.online : false;
      h += '<div class="contact-item" data-u="' + esc(u.username) + '">' + avatarEl(u, 'md').outerHTML + '<div class="ci-body"><div class="ci-name">' + esc(u.displayName || u.username) + (online ? ' <span style="font-size:10px;color:var(--success)">●</span>' : '') + '</div><div class="ci-sub">@' + esc(u.username) + '</div></div><button class="btn sm" data-act="chat">چت</button><button class="btn sm ghost" data-act="profile">پروفایل</button>' + (state.me.isAdmin ? '<button class="btn sm danger" data-act="ban">' + ((u.banned) ? 'رفع مسدودی' : 'مسدود') + '</button>' : '') + '</div>';
    });
    h += '</div>';
    listEl.innerHTML = h;
    listEl.querySelectorAll('.contact-item').forEach((it) => {
      const u = it.dataset.u; const cur = (state.users || []).find((x) => x.username === u) || { banned: false };
      it.querySelector('[data-act="chat"]').onclick = () => openDM(u);
      it.querySelector('[data-act="profile"]').onclick = () => openProfile(u);
      const ban = it.querySelector('[data-act="ban"]'); if (ban) ban.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u, banned: !cur.banned }) }); toast('انجام شد'); renderView('contacts'); };
    });
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
  h += '<div class="au-list">';
  users.forEach((u) => {
    h += '<div class="au-row" data-u="' + esc(u.username) + '">' + avatarEl(u, 'md').outerHTML +
      '<div class="au-body"><div class="au-name">' + esc(u.displayName || u.username) + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '') + (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + '</div><div class="au-sub">@' + esc(u.username) + (u.phone ? ' • ' + esc(u.phone) : '') + ' • ' + (u.online ? 'آنلاین' : 'آفلاین') + '</div></div>' +
      '<div class="au-actions"><button class="btn sm" data-act="profile">پروفایل</button><button class="btn sm ghost" data-act="msgs">پیام‌ها</button>' +
      (u.isAdmin ? '' : '<button class="btn sm danger" data-act="ban">' + (u.banned ? 'رفع مسدودی' : 'مسدود') + '</button>') + '</div></div>';
  });
  h += '</div></div>';
  wrap.innerHTML = h;
  wrap.querySelector('#au-refresh').onclick = () => renderUsers(wrap);
  const reDraw = () => { const q = (wrap.querySelector('#au-search').value || '').toLowerCase(); wrap.querySelectorAll('.au-row').forEach((r) => { const t = r.textContent.toLowerCase(); r.style.display = t.includes(q) ? '' : 'none'; }); };
  wrap.querySelector('#au-search').oninput = reDraw;
  wrap.querySelectorAll('.au-row').forEach((row) => {
    const u = row.dataset.u; const cur = users.find((x) => x.username === u);
    row.querySelector('[data-act="profile"]').onclick = () => openProfile(u);
    row.querySelector('[data-act="msgs"]').onclick = () => viewUserMessages(u);
    const ban = row.querySelector('[data-act="ban"]'); if (ban) ban.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u, banned: !cur.banned }) }); renderUsers(wrap); };
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
  let h = '<div class="profile-view"' + sa + '>';
  h += '<button class="btn sm ghost" data-act="back">← بازگشت</button>';
  if (u.profileBg) h += '<div class="profile-bg" style="background-image:url(\'' + esc(u.profileBg) + '\')"></div>';
  h += '<div class="profile-hero">';
  h += '<div class="profile-av">' + avatarEl(u, 'xl').outerHTML + '</div>';
  h += '<div class="profile-name">' + esc(u.displayName || u.username) + badge + '</div>';
  h += '<div class="profile-uname">@' + esc(u.username) + (online ? ' <span class="onl">● آنلاین</span>' : '') + '</div></div>';
  if (u.bio) h += '<div class="profile-bio">' + esc(u.bio) + '</div>';
  if (u.phone && (state.me.isAdmin || u.username === state.me.username)) h += '<div class="profile-row">📱 ' + esc(u.phone) + '</div>';
  h += '</div><div class="profile-actions">';
  h += '<button class="btn primary" data-act="chat">شروع چت</button>';
  if (state.me.isAdmin) {
    h += '<button class="btn" data-act="rename">تغییر نام</button>';
    h += '<button class="btn" data-act="premium">' + (u.isPremium ? 'حذف پرمیوم' : 'پرمیوم‌سازی') + '</button>';
    if (u.username !== state.me.username) {
      h += '<button class="btn" data-act="impersonate">ورود به حساب کاربر</button>';
      if (u.isAdmin) h += '<button class="btn danger" data-act="demote">حذف ادمین</button>';
      else h += '<button class="btn" data-act="promote">ارتقا به ادمین</button>';
      h += '<button class="btn danger" data-act="ban">' + (u.banned ? 'رفع مسدودی' : 'مسدودسازی') + '</button>';
      h += '<button class="btn" data-act="reset-pass">تغییر رمز کاربر</button>';
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
      if (imgs.length) { h += '<div class="pf-group"><b>تصاویر (' + imgs.length + ')</b><div class="pf-grid">' + imgs.map((m) => '<a class="pf-thumb" href="' + esc(m.src || '') + '" target="_blank"><img src="' + esc(m.src || '') + '" loading="lazy"></a>').join('') + '</div></div>'; }
      if (vids.length) { h += '<div class="pf-group"><b>ویدیو (' + vids.length + ')</b><div class="pf-grid">' + vids.map((m) => '<a class="pf-thumb" href="' + esc(m.src || '') + '" target="_blank">' + ic('video') + '</a>').join('') + '</div></div>'; }
      if (auds.length) { h += '<div class="pf-group"><b>صدا (' + auds.length + ')</b>' + auds.map((m) => '<div class="pf-audio"><button onclick="this.nextElementSibling.play()">' + ic('play') + '</button><audio src="' + esc(m.src || '') + '" preload="none"></audio><span>' + esc(m.name || 'ویس') + '</span></div>').join('') + '</div>'; }
      if (fils.length) { h += '<div class="pf-group"><b>فایل‌ها (' + fils.length + ')</b>' + fils.map((m) => '<div class="pf-file"><a href="' + esc(m.src || '') + '" download>' + ic('file') + esc(m.name || 'فایل') + '</a></div>').join('') + '</div>'; }
      if (links.length) { h += '<div class="pf-group"><b>لینک‌ها (' + links.length + ')</b>' + links.map((m) => '<div class="pf-link"><a href="' + esc(m.url || '') + '" target="_blank">' + ic('link') + esc(String(m.url || '').slice(0, 60)) + '</a></div>').join('') + '</div>'; }
      sec.querySelector('.pf-body').innerHTML = h;
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
    m.innerHTML = '<div class="modal crop-modal">'
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
  m.innerHTML = '<div class="modal"><div class="modal-head"><b>انتخاب از گالری</b><button class="icon-btn" data-close>✕</button></div>' +
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
  api('/api/admin/impersonate', { method: 'POST', body: JSON.stringify({ username }) }).then((r) => r.json()).then((d) => { if (d.token) { localStorage.setItem('ft_token', d.token); location.reload(); } else toast(d.error || 'خطا'); });
}
function showImpersonateBanner() {
  if (!localStorage.getItem('ft_admin_token')) return;
  const me = (state.me && state.me.username) || '';
  let b = $('imp-banner');
  if (!b) { b = document.createElement('div'); b.id = 'imp-banner'; b.className = 'imp-banner'; document.body.appendChild(b); }
  b.innerHTML = 'شما به عنوان @' + esc(me) + ' وارد شده‌اید <button id="imp-back">بازگشت به پنل ادمین</button>';
  b.querySelector('#imp-back').onclick = () => { const t = localStorage.getItem('ft_admin_token'); if (t) { localStorage.setItem('ft_token', t); localStorage.removeItem('ft_admin_token'); location.reload(); } };
}
async function startGroup(isChannel) {
  const name = await uPrompt('نام ' + (isChannel ? 'کانال' : 'گروه') + ':');
  if (!name) return;
  const d = await (await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: name, type: isChannel ? 'channel' : 'group' }) })).json();
  if (!d.group || !d.group.id) { toast(d.error || 'ساخت گروه ناموفق بود'); return; }
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
      if (r.ok) { toast('آواتار گروه تنظیم شد'); const g = state.groups.find((x) => x.id === d.group.id); if (g) g.avatar = r.avatar; buildChatList(); }
      input.remove();
    };
    if (await uConfirm('آیا می‌خواهید آواتار برای گروه انتخاب کنید؟')) input.click(); else input.remove();
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
  setMode('view'); viewHost.classList.remove('hidden'); viewHost.innerHTML = '';
  const title = NAV.find((n) => n.id === id); const h = document.createElement('div'); h.className = 'view-head';
  h.innerHTML = '<button class="icon-btn view-back" id="view-back"><i data-lucide="chevron-right" class="icon"></i></button>' + ic((title && title.icon) || 'layout') + '<h2>' + (title ? title.label : id) + '</h2>';
  viewHost.appendChild(h);
  const back = h.querySelector('#view-back'); if (back) back.onclick = () => { if (id === 'settings' && state.settingsCat && state.settingsCat !== 'main') { state.settingsCat = 'main'; renderView('settings'); } else switchNav('chats'); };
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
  } else if (id === 'communities') { wrap.innerHTML = groupsHTML('group'); bindGroupCards(wrap); }
  else if (id === 'channels') { wrap.innerHTML = groupsHTML('channel'); bindGroupCards(wrap); }
  else if (id === 'cloud') { wrap.innerHTML = '<div class="placeholder">☁️ حافظه ابری — فایل‌های شما اینجا نمایش داده می‌شوند. (نمونه)</div>'; }
  else if (id === 'tasks') { renderTasks(wrap); }
  else if (id === 'calendar') { renderCalendar(wrap); }
  else if (id === 'bookmarks') { wrap.innerHTML = '<div class="placeholder">🔖 پیام‌های نشان‌شده اینجا نمایش داده می‌شوند. (نمونه)</div>'; }
  else if (id === 'users') { if (state.me.isAdmin) renderUsers(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'signups') { if (state.me.isAdmin) renderSignups(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'stats') { if (state.me.isAdmin) renderStats(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else { wrap.innerHTML = '<div class="placeholder">این بخش در نسخه نمایشی در دسترس است.</div>'; }
  luc();
}
function gridCard(id, name, em) { return '<div class="grid-card" data-gc="' + id + '"><div class="gc-ic">' + em + '</div><div class="gc-name">' + name + '</div></div>'; }
function groupsHTML(type) { const gs = state.groups.filter((g) => g.type === type); if (!gs.length) return '<div class="placeholder">' + (type === 'channel' ? 'کانالی' : 'کامیونیتی‌ای') + ' یافت نشد. از منوی + ایجاد کنید.</div>'; return '<div class="group-list">' + gs.map((g) => '<div class="group-card" data-gid="' + g.id + '">' + avatarEl({ displayName: g.name }, 'md').outerHTML + '<div class="gc-name">' + esc(g.name) + '</div><div class="gc-sub">' + (Array.isArray(g.members) ? g.members.length : 0) + ' عضو</div></div>').join('') + '</div>'; }
function bindGroupCards(wrap) { wrap.querySelectorAll('.group-card').forEach((c) => { c.onclick = () => { const gid = c.dataset.gid; const me = state.me.username; const isMember = (() => { const g = state.groups.find((x) => x.id === gid); return g && g.members && g.members.some((m) => m.username === me); })(); if (isMember) openRoom('group:' + gid); else toast('ابتدا به گروه بپیوندید'); }; }); }
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
function applyBackground() { document.documentElement.style.setProperty('--chat-bg', localStorage.getItem('vx_bg') || ''); if (localStorage.getItem('vx_bgimg')) document.documentElement.style.setProperty('--chat-bg-img', "url('" + localStorage.getItem('vx_bgimg') + "')"); else document.documentElement.style.removeProperty('--chat-bg-img'); }
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
  appearance: { title: ic('palette') + ' ظاهر', icon: 'palette' },
  background: { title: ic('image') + ' پس‌زمینه چت', icon: 'image' },
  account: { title: ic('user') + ' حساب', icon: 'user' },
  notifications: { title: ic('bell') + ' اعلان‌ها', icon: 'bell' },
  privacy: { title: ic('lock') + ' حریم خصوصی', icon: 'lock' },
  skins: { title: ic('paintbrush') + ' اسکین‌ها و تم‌ها', icon: 'paintbrush' },
  logout: { title: ic('log-out') + ' خروج', icon: 'log-out' }
};
function renderSettingsMain(wrap) {
  const body = document.createElement('div'); body.className = 'view-body settings-main';
  body.innerHTML = Object.entries(SETCATS).map(([k,v]) => '<div class="set-cat" data-cat="'+k+'">'+ic(v.icon)+'<span>'+v.title+'</span></div>').join('');
  wrap.appendChild(body);
  body.querySelectorAll('.set-cat').forEach((c) => {
    c.onclick = () => { state.settingsCat = c.dataset.cat; renderView('settings'); };
  });
}
function renderSettingsSub(cat, wrap) {
  Array.from(wrap.querySelectorAll('.view-body.settings-sub')).forEach((b) => b.remove());
  const body = document.createElement('div'); body.className = 'view-body settings-sub';
  if (cat === 'appearance') renderAppSub(body);
  else if (cat === 'background') renderBgSub(body);
  else if (cat === 'account') renderAccSub(body);
  else if (cat === 'notifications') renderNotifSub(body);
  else if (cat === 'privacy') renderPrivSub(body);
  else if (cat === 'skins') renderSkinsSub(body);
  else if (cat === 'effects') renderEffectsSub(body);
  else if (cat === 'logout') logout();
  wrap.appendChild(body);
}
function renderAppSub(body) {
  const themes = ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light', 'ios'];
  const accents = ['blue', 'purple', 'cyan', 'green', 'pink', 'orange', 'red', 'ios'];
  let t = '<div class="settings-sec"><h3>' + ic('palette') + ' تم</h3><div class="chip-row">' + themes.map((x) => '<button class="chip" data-theme-btn="' + x + '">' + x + '</button>').join('') + '</div></div>';
  t += '<div class="settings-sec"><h3>' + ic('droplet') + ' رنگ آکセント</h3><div class="chip-row">' + accents.map((x) => '<button class="chip" data-accent-btn="' + x + '">' + x + '</button>').join('') + '</div></div>';
  t += '<div class="settings-sec"><h3>' + ic('type') + ' اندازه فونت</h3><div class="stepper"><button id="set-font-dec">−</button><span id="fs-val">' + (state.fontScale) + '</span><button id="set-font-inc">+</button></div></div>';
  const fonts = [['default', 'پیش‌فرض'], ['messenger', 'پیام‌رسان'], ['classic', 'کلاسیک'], ['modern', 'مدرن']];
  const curFont = localStorage.getItem('vx_font') || 'default';
  t += '<div class="settings-sec"><h3>' + ic('type') + ' فونت</h3><div class="chip-row">' + fonts.map((f) => '<button class="chip' + (curFont === f[0] ? ' on' : '') + '" data-font="' + f[0] + '">' + f[1] + '</button>').join('') + '</div></div>';
  t += '<div class="settings-sec"><h3>' + ic('maximize-2') + ' گردی گوشه‌ها</h3><input type="range" id="set-radius" min="6" max="28" value="' + (parseInt(localStorage.getItem('vx_radius') || '18', 10)) + '">';
  body.innerHTML = t;
  body.querySelectorAll('[data-theme-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_theme', b.dataset.themeBtn); applyAppearance(); persistActiveSkin(); });
  body.querySelectorAll('[data-accent-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_accent', b.dataset.accentBtn); applyAppearance(); persistActiveSkin(); });
  body.querySelector('#set-font-dec').onclick = () => setFont(-1);
  body.querySelector('#set-font-inc').onclick = () => setFont(1);
  body.querySelector('#set-radius').oninput = (e) => { localStorage.setItem('vx_radius', e.target.value + 'px'); applyVX(); };
  body.querySelectorAll('[data-font]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_font', b.dataset.font); applyAppearance(); renderSettingsSub('appearance', body.parentElement); });
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
  t += '<div class="settings-row"><span>نام نمایشی</span><b>' + esc(state.me.displayName) + '</b><button class="btn sm" onclick="promptRename()">تغییر</button></div>';
  t += '<div class="settings-row"><span>نام کاربری</span><b>@' + esc(state.me.username) + '</b></div>';
  t += '<div class="settings-row"><span>شماره</span><b>' + esc(state.me.phone || '—') + '</b></div>';
  t += '<div class="settings-row"><span>بیو</span><input class="inp" id="acc-bio" maxlength="' + (state.me.isPremium ? 200 : 80) + '" placeholder="درباره خودت…" value="' + esc(state.me.bio || '') + '" style="max-width:220px"></div>';
  t += '<div class="settings-row"><span>وضعیت</span><b>' + (state.me.isPremium ? 'پریمیوم' : 'رایگان') + (state.me.isAdmin ? ' • ادمین' : '') + '</b></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('smartphone') + ' دستگاه‌های متصل</h3><div id="acc-devices" class="acc-devices">در حال بارگذاری…</div></div>';
  body.innerHTML = t;
  const bioSave = () => {
    const v = body.querySelector('#acc-bio').value.trim();
    api('/api/profile/bio', { method: 'POST', body: JSON.stringify({ bio: v }) }).then((r) => r.json()).then((d) => { if (!d.ok) { toast(d.error || 'خطا'); return; } if (d.me) state.me = d.me; toast('بیو ذخیره شد'); }).catch(() => toast('خطا'));
  };
  const bio = body.querySelector('#acc-bio'); if (bio) bio.addEventListener('change', bioSave);
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
      toast('رمز عبور ذخیره شد — از این پس با نام کاربری و رمز هم می‌توانید وارد شوید');
      if (state.me) state.me.hasPassword = true;
      renderPrivSub(body);
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
  if ($('details-panel') && !$('details-panel').classList.contains('hidden')) { $('details-panel').classList.add('hidden'); return true; }
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

/* Capacitor / Android integration */
const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isCapacitor) {
  document.addEventListener('backbutton', (e) => {
    e.preventDefault();
    if (!$('auth-screen').classList.contains('hidden')) { return; }
    const p = $('details-panel');
    if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
    if (state.nav !== 'chats') { switchNav('chats'); return; }
    if (state.room) { state.room = null; $('conversation').classList.remove('chat-open'); $('chat-list-column').classList.add('m-open'); return; }
  }, false);
  try {
    const Plugins = window.Capacitor.Plugins;
    if (Plugins && Plugins.StatusBar) {
      Plugins.StatusBar.setStyle({ style: 'DARK' });
      Plugins.StatusBar.setBackgroundColor({ color: '#031427' });
    }
  } catch (e) {}
}

(async function init() {
  bindCtxReposition();
  initMultiSelect();
  if (state.token) {
    try { const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + state.token } }); if (r.ok) { const d = await r.json(); if (d.me) { state.me = d.me; enterApp(); } else logout(true); } else logout(true); }
    catch (e) { showAuth(); }
  } else { showAuth(); }
  const requestNotifOnce = () => { if ('Notification' in window && Notification.permission === 'default') { Notification.requestPermission(); window.removeEventListener('click', requestNotifOnce, true); } };
  window.addEventListener('click', requestNotifOnce, true);
})();
