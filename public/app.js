/* VORTEX Messenger — frontend (Premium Dark Cyber rebuild). Backend contract preserved. */
const $ = (s) => document.getElementById(s);
const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';
const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();
function ic(n) { return '<i data-lucide="' + n + '" class="icon"></i>'; }
function luc() { if (window.lucide) { try { lucide.createIcons(); } catch (e) {} } }
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
  return a;
}
const IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function isMobile() { return window.innerWidth <= 1024 || IS_TOUCH; }
function showScrim(v) { const s = $('scrim'); if (s) s.classList.toggle('hidden', !v); }
function closeDrawers() { $('nav-sidebar').classList.remove('m-open'); $('details-panel').classList.remove('open'); showScrim(false); }
const state = {
  token: localStorage.getItem('ft_token') || null, me: null, ws: null,
  groups: [], users: [], chatState: {}, readState: {}, pinned: {},
  room: null, replyTo: null, rooms: {}, chatFilter: 'all', search: '', nav: 'chats', notifications: [],
  fontScale: parseInt(localStorage.getItem('vx_fontsize') || '14', 10),
};

/* AUTH */
const authPhone = $('auth-phone'), authCode = $('auth-code'), authName = $('auth-username');
const stepPhone = $('auth-step-phone'), stepCode = $('auth-step-code'), stepName = $('auth-step-name');
const authError = $('auth-error');
let authPhoneVal = '';
function showAuthStep(s) { stepPhone.classList.toggle('hidden', s !== 'phone'); stepCode.classList.toggle('hidden', s !== 'code'); stepName.classList.toggle('hidden', s !== 'name'); authError.textContent = ''; }
function authErr(m, ok) { authError.textContent = m; authError.style.color = ok ? 'var(--success)' : 'var(--danger)'; }
function finishLogin(d) { state.token = d.token; state.me = d.me; localStorage.setItem('ft_token', d.token); enterApp(); }
$('auth-send').onclick = async () => {
  const phone = authPhone.value.trim();
  try { const r = await fetch('/api/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); const d = await r.json();
    if (!r.ok) return authErr(d.error || 'خطا'); authPhoneVal = phone; $('auth-phone-label').textContent = 'کد به ' + phone + ' ارسال شد'; showAuthStep('code');
    if (d.devCode) authErr('کد ورود (ارسال پیامک غیرفعال است): ' + d.devCode, true); else if (d.note) authErr(d.note, true);
  } catch (e) { authErr(e.message); }
};
$('auth-verify').onclick = async () => {
  try { const r = await fetch('/api/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: authPhoneVal, code: authCode.value.trim() }) }); const d = await r.json();
    if (!r.ok) return authErr(d.error || 'خطا'); if (d.token) return finishLogin(d); if (d.needsName) return showAuthStep('name');
  } catch (e) { authErr(e.message); }
};
$('auth-finish').onclick = async () => {
  try { const r = await fetch('/api/complete-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: authPhoneVal, code: authCode.value.trim(), displayName: authName.value.trim(), username: authName.value.trim() }) }); const d = await r.json();
    if (!r.ok) return authErr(d.error || 'خطا'); if (d.token) return finishLogin(d); if (d.pending) { authErr(d.message || 'درخواست ثبت شد؛ منتظر تایید ادمین', true); return; }
  } catch (e) { authErr(e.message); }
};
authPhone.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-send').click(); });
authCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-verify').click(); });
authName.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-finish').click(); });

/* APPEARANCE */
function applyAppearance() {
  const th = localStorage.getItem('vx_theme') || 'cyber';
  if (th === 'cyber' || !th) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  document.documentElement.setAttribute('data-accent', localStorage.getItem('vx_accent') || 'blue');
  const fs = state.fontScale || 14;
  document.documentElement.style.fontSize = fs + 'px';
  document.documentElement.style.zoom = String(Math.max(0.8, Math.min(1.6, fs / 14)));
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
    api('/api/admin/signups').then((r) => r.json()).then((d) => { const list = (d.signups || []).filter((s) => !s.status || s.status === 'pending'); state.signupCount = list.length; renderNav(); }).catch(() => {});
  }
  if (isMobile()) { $('chat-list-column').classList.remove('m-open'); $('conversation').classList.remove('chat-open'); }
}

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
  { id: 'signups', label: 'درخواست‌ها', icon: 'user-plus' },
  { id: 'stats', label: 'آمار', icon: 'bar-chart-2' },
  { id: 'bookmarks', label: 'نشان‌ها', icon: 'bookmark' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
];
function renderNav() {
  const sc = $('nav-scroll'); sc.innerHTML = '';
  const nav = $('nav-profile');
  const av = avatarEl(state.me, 'sm'); av.id = 'nav-av'; nav.replaceChild(av, $('nav-av'));
  $('nav-name').textContent = state.me.displayName;
  nav.onclick = openProfile;
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
  const plus = document.createElement('div'); plus.className = 'dock-plus'; plus.innerHTML = ic('plus'); plus.title = 'جدید'; plus.onclick = openNewMenu; d.appendChild(plus);
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
    case 'ready': state.me = d.me; state.groups = d.groups || []; state.chatState = d.chatState || {}; state.readState = d.readState || {}; state.pinned = d.pinned || {}; renderNav(); renderDock(); buildChatList(); fetchPreviews(); break;
    case 'users': state.users = d.users || []; buildChatList(); break;
    case 'groups': state.groups = d.groups || []; buildChatList(); break;
    case 'room-read': if (!state.readState[d.roomId]) state.readState[d.roomId] = {}; state.readState[d.roomId][d.username] = d.time; if (state.rooms[d.roomId]) state.rooms[d.roomId].unread = 0; buildChatList(); refreshReadTicks(d.roomId); break;
    case 'history': if (d.roomId !== state.room) { cachePreview(d.roomId, d.messages); break; } $('messages').innerHTML = ''; state.lastDay = null; d.messages.forEach(addMessage); scrollBottom(); break;
    case 'message': onNewMessage(d.message); break;
    case 'message-updated': updateMessage(d); break;
    case 'message-edited': { const el = document.querySelector('[data-id="' + d.id + '"] .msg-body'); if (el) { el.textContent = d.content; const t = document.createElement('span'); t.className = 'msg-edited'; t.textContent = ' (ویرایش شد)'; el.appendChild(t); } break; }
    case 'message-deleted': { const el = document.querySelector('[data-id="' + d.id + '"]'); if (el) el.remove(); break; }
    case 'pinned-updated': state.pinned[d.roomId] = d.ids; renderDetails(); break;
    case 'typing': showTyping(d); break;
    case 'error': toast(d.text); break;
    case 'auth-failed': logout(); break;
    case 'kicked': toast('حساب شما مسدود شد'); logout(); break;
    case 'premium-changed': if (state.me) { state.me.isPremium = d.isPremium; renderNav(); } break;
    case 'rename-result': if (d.approved && state.me) { state.me.displayName = d.displayName; renderNav(); } break;
    case 'signup-request': state.signupCount = (state.signupCount || 0) + 1; renderNav(); toast('درخواست ثبت‌نام جدید: @' + (d.displayName || d.username)); break;
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
  return [...ids];
}
function contactsKey() { return 'vx_contacts_' + state.me.username; }
function getContacts() { try { return JSON.parse(localStorage.getItem(contactsKey()) || '{}'); } catch { return {}; } }
function saveContacts(c) { localStorage.setItem(contactsKey(), JSON.stringify(c)); }
function cachePreview(rid, msgs) { const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.messages = msgs; r.last = msgs[msgs.length - 1] || null; }
function fetchPreviews() { allRoomIds().slice(0, 60).forEach((rid, i) => setTimeout(() => { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'history', roomId: rid })); }, i * 60)); }

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
    return { rid, title, sub, lastMsg, lastTime: last ? last.time : 0, unread, online, pinned: !!flags.pinned, archived: !!flags.archived, isBot, isGroup };
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
  luc();
}
function chatItemEl(r) {
  const it = document.createElement('div'); it.className = 'chat-item' + (state.room === r.rid ? ' active' : ''); it.dataset.roomId = r.rid;
  let avSrc = null;
  if (r.isGroup) { const g = state.groups.find((x) => 'group:' + x.id === r.rid); if (g && g.avatar) avSrc = g.avatar; }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: r.title } : (r.isBot ? { displayName: BOT_NAME } : { displayName: r.title }), 'md');
  it.innerHTML = '<div class="ci-av">' + av.outerHTML + (r.online ? '<span class="online-dot"></span>' : '') + '</div><div class="ci-body"><div class="ci-row1"><div class="ci-name">' + esc(r.title) + (r.isBot ? ' <span style="font-size:9px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:6px">AI</span>' : '') + '</div><div class="ci-time">' + (r.lastTime ? fmt(r.lastTime) : '') + '</div></div><div class="ci-row2">' + (r.pinned ? ic('pin') : '') + (r.muted ? ic('volume-x') : '') + '<div class="ci-last">' + esc(r.lastMsg) + '</div>' + (r.unread ? '<div class="ci-badge">' + r.unread + '</div>' : '') + '</div></div>';
  it.onclick = () => openRoom(r.rid); it.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, r.rid); };
  return it;
}
function computeUnread(rid, r) { if (!r.last) return 0; const rs = state.readState[rid] || {}; const read = rs[state.me.username] || 0; if (r.last.time <= read) return 0; return r.messages.filter((m) => m.time > read && m.from !== state.me.username).length; }
function roomMembers(rid) { if (rid.startsWith('dm:')) return rid.slice(3).split('|'); if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members : []; } return []; }
function isReadByOther(rid, m) { const rs = state.readState[rid] || {}; return roomMembers(rid).some((u) => u !== state.me.username && (rs[u] || 0) >= m.time); }
function refreshReadTicks(rid) { if (rid !== state.room) return; const r = state.rooms[rid]; if (!r) return; document.querySelectorAll('#messages .bubble').forEach((b) => { const m = r.messages.find((x) => x.id === b.dataset.id); if (!m || m.from !== state.me.username) return; const span = b.querySelector('.msg-meta .msg-time'); if (!span) return; const tick = span.querySelector('svg'); const want = isReadByOther(rid, m); const has = !!tick; if (want && !has) span.insertAdjacentHTML('afterbegin', ic('check-check')); else if (!want && has) { tick.remove(); span.insertAdjacentHTML('afterbegin', ic('check')); } }); }
function previewText(m) {
  if (!m) return ''; if (m.kind === 'image') return '📷 تصویر'; if (m.kind === 'video') return '🎬 ویدیو'; if (m.kind === 'file') return '📎 فایل' + (m.name ? ': ' + m.name : ''); if (m.kind === 'audio' || m.kind === 'voice') return '🎙 پیام صوتی'; if (m.kind === 'sticker') return 'استیکر'; if (m.kind === 'poll') return '📊 نظرسنجی'; if (m.kind === 'checklist') return '✅ چک‌لیست'; return (m.content || '').slice(0, 60);
}
$('cl-tabs').addEventListener('click', (e) => { const t = e.target.closest('.cl-tab'); if (!t) return; document.querySelectorAll('.cl-tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); state.chatFilter = t.dataset.tab; buildChatList(); });
$('cl-search-input').addEventListener('input', (e) => { state.search = e.target.value; buildChatList(); });
$('cl-new').onclick = openNewMenu;
$('cl-menu').onclick = () => { const open = !$('nav-sidebar').classList.contains('m-open'); $('nav-sidebar').classList.toggle('m-open', open); showScrim(open); };
/* PART 2 — conversation, messages, composer, details */
function openRoom(rid) {
  state.room = rid; state.replyTo = null;
  document.querySelectorAll('.chat-item').forEach((e) => e.classList.toggle('active', e.dataset.roomId === rid));
  if (isMobile()) { $('details-panel').classList.remove('open'); } else { $('details-panel').classList.add('hidden'); }
  renderRoomHeader(); markRead(rid); buildChatList();
  setMode('chats');
  if (isMobile()) { $('details-panel').classList.remove('open'); $('conversation').classList.add('chat-open'); showScrim(false); }
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'history', roomId: rid }));
  else { $('messages').innerHTML = ''; state.lastDay = null; (state.rooms[rid] || {}).messages || []; }
}
function roomTitle(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.name : rid; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return BOT_NAME; const u = state.users.find((x) => x.username === other); return u ? (u.displayName || other) : (getContacts()[other] || other); }
function roomOnline(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members.length + ' عضو' : ''; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return 'آنلاین'; const u = state.users.find((x) => x.username === other); if (state.me.isAdmin) return u ? (u.online && !u.banned ? 'آنلاین' : 'آفلاین') : ''; return ''; }
function renderRoomHeader() {
  $('conv-name').textContent = roomTitle(state.room); $('conv-sub').textContent = roomOnline(state.room);
  let avSrc = null;
  if (state.room && state.room.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === state.room); if (g && g.avatar) avSrc = g.avatar; }
  const av = avatarEl(avSrc ? { avatar: avSrc, displayName: roomTitle(state.room) } : { displayName: roomTitle(state.room) }, 'sm');
  av.id = 'conv-av'; const old = $('conv-av'); if (old) old.replaceWith(av);
}
$('conv-info').onclick = () => { if (isMobile()) { const open = !$('details-panel').classList.contains('open'); $('details-panel').classList.toggle('open', open); showScrim(open); renderDetails(); } else { $('details-panel').classList.toggle('hidden'); renderDetails(); } };
$('conv-back').onclick = () => { state.room = null; buildChatList(); setMode('chats'); if (isMobile()) { $('conversation').classList.remove('chat-open'); } };
$('scrim').onclick = () => closeDrawers();
$('conv-search').onclick = () => { const sb = $('conv-searchbox'); const wasHidden = sb.classList.contains('hidden'); sb.classList.toggle('hidden'); if (wasHidden) { $('conv-search-input').value = ''; $('conv-search-input').focus(); searchChatMessages(''); } else { searchChatMessages(''); } };
$('conv-search-input').addEventListener('input', (e) => { searchChatMessages(e.target.value); });
$('conv-search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('conv-search-input').value = ''; searchChatMessages(''); $('conv-searchbox').classList.add('hidden'); } if (e.key === 'Enter') { e.preventDefault(); const msgs = document.querySelectorAll('#messages .wrap'); let found = null; for (const w of msgs) { if (!w.classList.contains('search-hide')) { found = w; break; } } if (found) { found.scrollIntoView({ behavior: 'smooth', block: 'center' }); found.querySelector('.bubble').style.transition = 'box-shadow 0.3s'; found.querySelector('.bubble').style.boxShadow = '0 0 0 2px var(--accent)'; setTimeout(() => { const b = found.querySelector('.bubble'); if (b) b.style.boxShadow = ''; }, 1500); } } });
function searchChatMessages(q) {
  const msgs = document.querySelectorAll('#messages .wrap');
  if (!q) { msgs.forEach((w) => { w.classList.remove('search-hide'); const body = w.querySelector('.msg-body'); if (body) body.querySelectorAll('mark.search-hl').forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); }); }); return; }
  const ql = q.toLowerCase();
  msgs.forEach((w) => {
    const id = w.dataset.id;
    const r = state.rooms[state.room];
    const m = r ? r.messages.find((x) => x.id === id) : null;
    if (!m) { w.classList.add('search-hide'); return; }
    const fromName = (m.fromName || m.from || '').toLowerCase();
    const content = (m.content || '').toLowerCase();
    const match = content.includes(ql) || fromName.includes(ql);
    w.classList.toggle('search-hide', !match);
    if (match) {
      const body = w.querySelector('.msg-body');
      if (body && m.kind !== 'image' && m.kind !== 'video' && m.kind !== 'voice' && m.kind !== 'file' && m.kind !== 'audio' && m.kind !== 'sticker' && m.kind !== 'poll' && m.kind !== 'checklist') {
        const orig = m.content || '';
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
    }
  });
}

function onNewMessage(m) {
  const rid = m.roomId; const r = state.rooms[rid] || (state.rooms[rid] = { messages: [], last: null, unread: 0 }); r.messages.push(m); r.last = m;
  if (rid === state.room) { addMessage(m); if (m.from === state.me.username || isNearBottom()) scrollBottom(); markRead(rid); }
  else { r.unread = computeUnread(rid, r); beep(); }
  buildChatList(); renderDetails();
}
function pushNotification(m) {
  if (m.from === state.me.username || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(roomTitle(m.roomId), { body: previewText(m) }); } catch (e) {}
}
function scrollBottom() { const c = $('messages'); c.scrollTop = c.scrollHeight; }
function isNearBottom() { const c = $('messages'); return !!c && (c.scrollHeight - c.scrollTop - c.clientHeight) < 90; }
$('scroll-fab').onclick = () => { scrollBottom(); };
$('messages').addEventListener('scroll', () => { const fab = $('scroll-fab'); if (!fab) return; fab.classList.toggle('hidden', isNearBottom()); });
function daySep(t) { const d = new Date(t); const s = d.toLocaleDateString('fa-IR'); return s; }
function emojiOnly(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  const emojiRegex = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+$/u;
  const segments = t.split(/\s+/);
  return segments.every((s) => emojiRegex.test(s));
}
function emojiCount(text) {
  if (!text || typeof text !== 'string') return 0;
  const matches = text.match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+/gu);
  return matches ? matches.length : 0;
}
function addMessage(m) {
  const msgs = $('messages'); const d = new Date(m.time); const ds = d.toLocaleDateString('fa-IR');
  if (ds !== state.lastDay) { state.lastDay = ds; const sep = document.createElement('div'); sep.className = 'day-sep'; sep.innerHTML = '<span>' + ds + '</span>'; msgs.appendChild(sep); }
  const mine = m.from === state.me.username; const wrap = document.createElement('div'); wrap.className = 'msg ' + (mine ? 'mine' : '');
  const av = mine ? avatarEl(state.me, 'xs') : avatarEl(state.users.find((u) => u.username === m.from) || { displayName: m.from }, 'xs');
  wrap.innerHTML = '<div class="msg-av">' + av.outerHTML + '</div>';
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dataset.id = m.id; bubble.dataset.from = m.from || '';
  if (m.replyToId) { const orig = (state.rooms[state.room] || {}).messages.find((x) => x.id === m.replyToId); if (orig) bubble.appendChild(replyRef(orig)); }
  bubble.appendChild(bodyEl(m));
  const meta = document.createElement('div'); meta.className = 'msg-meta'; meta.innerHTML = '<span class="msg-time">' + (mine ? (isReadByOther(state.room, m) ? ic('check-check') : ic('check')) : '') + fmt(m.time) + '</span>'; bubble.appendChild(meta);
  if (state.me.isPremium || true) { meta.appendChild(reactionsEl(m)); }
  wrap.appendChild(bubble);
  const actions = document.createElement('div'); actions.className = 'msg-actions';
  actions.innerHTML = '<button class="icon-btn" data-a="smile">' + ic('smile') + '</button><button class="icon-btn" data-a="reply">' + ic('reply') + '</button><button class="icon-btn" data-a="forward">' + ic('forward') + '</button><button class="icon-btn" data-a="more">' + ic('more-vertical') + '</button>';
  actions.querySelector('[data-a="smile"]').onclick = () => openReactionPicker(bubble, m.id);
  actions.querySelector('[data-a="reply"]').onclick = () => setReply(m);
  actions.querySelector('[data-a="forward"]').onclick = () => openForward(m.id);
  actions.querySelector('[data-a="more"]').onclick = (e) => openMsgMore(e, m);
  wrap.appendChild(actions);
  if ((!m.kind || m.kind === 'text') && emojiOnly(m.content)) {
    const cnt = emojiCount(m.content);
    wrap.classList.add('msg-emoji-only');
    const fs = Math.max(16, Math.min(64, 64 - cnt * 4));
    bubble.style.fontSize = fs + 'px';
  }
  msgs.appendChild(wrap); luc();
}
function replyRef(orig) { const r = document.createElement('div'); r.className = 'reply-ref'; const f = orig.from === state.me.username ? 'شما' : (roomTitle(orig.roomId || state.room)); r.innerHTML = '<span class="rr-from">' + esc(f) + '</span><span class="rr-text">' + esc(previewText(orig)) + '</span>'; return r; }
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
function albumEl(m) {
  const d = document.createElement('div'); d.className = 'album-grid';
  const urls = m.urls || (m.src ? [m.src] : []);
  urls.forEach((url, i) => {
    const item = document.createElement('div'); item.className = 'album-item';
    const isVid = /\.(mp4|webm|ogg)$/i.test(url);
    if (isVid) { const v = document.createElement('video'); v.src = url; v.loading = 'lazy'; v.controls = false; v.onclick = () => openViewer(url, 'video'); item.appendChild(v); }
    else { const im = document.createElement('img'); im.src = url; im.loading = 'lazy'; im.onclick = () => openViewer(url, 'image'); item.appendChild(im); }
    d.appendChild(item);
  });
  if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); }
  return d;
}
function mediaEl(m) { const d = document.createElement('div'); d.className = 'media'; const im = document.createElement('img'); im.src = m.src; im.loading = 'lazy'; im.onclick = () => openViewer(m.src, m.kind); d.appendChild(im); if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); } return d; }
function fileEl(m) {
  const d = document.createElement('div'); d.className = 'file-row';
  d.innerHTML = ic('file') + '<div class="file-info"><div class="file-name">' + esc(m.name || 'فایل') + '</div><div class="file-size">' + (m.size ? Math.round(m.size / 1024) + ' KB' : '') + '</div></div><button class="file-dl">' + ic('download') + '</button><div class="progress-bar hidden"><div class="progress-fill"></div></div>';
  const btn = d.querySelector('.file-dl');
  btn.onclick = async () => {
    const bar = d.querySelector('.progress-bar'); const fill = d.querySelector('.progress-fill');
    bar.classList.remove('hidden'); fill.style.width = '0%';
    try {
      const res = await fetch(m.src);
      if (!res.ok) throw new Error('Download failed');
      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body.getReader();
      const chunks = []; let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.length;
        if (total) fill.style.width = Math.round((received / total) * 100) + '%';
      }
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = m.name || 'file'; a.click();
      URL.revokeObjectURL(url);
      setTimeout(() => { bar.classList.add('hidden'); fill.style.width = '0%'; }, 1000);
    } catch (e) {
      toast('خطا در دانلود: ' + e.message);
      bar.classList.add('hidden'); fill.style.width = '0%';
    }
  };
  return d;
}
function voiceEl(m) { const d = document.createElement('div'); d.className = 'voice-row'; const dur = m.duration ? '<span class="voice-dur">' + Math.round(m.duration) + '″</span>' : ''; d.innerHTML = '<button class="voice-play" onclick="this.nextElementSibling.play()">' + ic('play') + '</button><audio src="' + m.src + '" preload="none"></audio>' + dur; return d; }
function pollEl(m) {
  const d = document.createElement('div'); d.className = 'poll'; const opts = m.poll.options; const total = m.poll.votes ? Object.values(m.poll.votes).reduce((a, x) => a + x.length, 0) : 0;
  d.innerHTML = '<div class="poll-q">' + esc(m.poll.question) + '</div>';
  opts.forEach((o) => { const vid = m.poll.votes ? Object.keys(m.poll.votes).find((k) => m.poll.votes[k] && m.poll.votes[k].includes(state.me.username)) : null; const cnt = m.poll.votes && m.poll.votes[o] ? m.poll.votes[o].length : 0; const pct = total ? Math.round((cnt / total) * 100) : 0; const row = document.createElement('div'); row.className = 'poll-opt' + (vid === o ? ' voted' : ''); row.innerHTML = '<div class="poll-fill" style="width:' + pct + '%"></div><span class="po-text">' + esc(o) + '</span><span class="po-pct">' + pct + '%</span>'; row.onclick = () => votePoll(m.id, o, m.roomId); d.appendChild(row); });
  d.innerHTML += '<div class="poll-foot">' + total + ' رأی</div>'; return d;
}
function checklistEl(m) {
  const d = document.createElement('div'); d.className = 'checklist'; const items = m.checklist.items;
  d.innerHTML = '<div class="cl-title">' + esc(m.checklist.title || 'چک‌لیست') + '</div>';
  items.forEach((it) => { const row = document.createElement('div'); row.className = 'cl-item' + (it.done ? ' done' : ''); row.innerHTML = '<span class="cl-box">' + (it.done ? ic('check') : '') + '</span><span>' + esc(it.text) + '</span>'; row.onclick = () => toggleCheck(m.id, it.id, !it.done, m.roomId); d.appendChild(row); });
  const done = items.filter((i) => i.done).length; d.innerHTML += '<div class="cl-foot">' + done + '/' + items.length + '</div>'; return d;
}
function reactionsEl(m) { const c = document.createElement('div'); c.className = 'reactions'; const rs = (m.reactions && typeof m.reactions === 'object' && !Array.isArray(m.reactions)) ? m.reactions : {}; Object.keys(rs).forEach((emoji) => { const users = Array.isArray(rs[emoji]) ? rs[emoji] : (rs[emoji] ? [rs[emoji]] : []); if (!users.length) return; const badge = document.createElement('span'); badge.className = 'reac' + (users.includes(state.me.username) ? ' me' : ''); badge.textContent = emoji + (users.length > 1 ? ' ' + users.length : ''); badge.onclick = () => toggleReaction(m.id, emoji, m.roomId); c.appendChild(badge); }); return c; }

/* COMPOSER */
function sendMessage() {
  const txt = $('composer-input').value.trim(); if (!txt) return; const m = { kind: 'text', content: txt, replyToId: state.replyTo ? state.replyTo.id : null };
  doSend(m); $('composer-input').value = ''; setReply(null);
}
async function doSend(m) { if (!state.ws || state.ws.readyState !== 1) { toast('اتصال برقرار نیست'); return; } state.ws.send(JSON.stringify(Object.assign({ type: 'message', roomId: state.room }, m))); }
$('composer-send').onclick = sendMessage;
$('composer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } if (e.key === 'Escape') setReply(null); });
$('composer-input').addEventListener('input', () => { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'typing', roomId: state.room, on: true })); });
function uploadFileFromBlob(blob, name) {
  const fd = new FormData(); fd.append('file', blob, name || 'paste.png');
  const bar = $('upload-bar'); bar.classList.remove('hidden'); $('upload-fill').style.width = '0%';
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('upload-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%'; };
  xhr.onload = () => { bar.classList.add('hidden'); try { const d = JSON.parse(xhr.responseText); const isImg = blob.type.startsWith('image/'); const isVid = blob.type.startsWith('video/'); doSend({ kind: isImg ? 'image' : isVid ? 'video' : 'file', src: d.url, name: name || 'paste', size: blob.size, content: '' }); } catch (e) { toast('خطا در آپلود'); } };
  xhr.send(fd);
}
document.addEventListener('paste', (e) => {
  if (!state.room) return;
  const items = (e.clipboardData || e.originalEvent && e.originalEvent.clipboardData || {}).items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === 'file') {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) uploadFileFromBlob(f, f.name || 'clipboard.png');
      return;
    }
  }
});
const convEl = $('conversation');
if (convEl) {
  convEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); convEl.classList.add('drag-over'); });
  convEl.addEventListener('dragleave', (e) => { e.preventDefault(); convEl.classList.remove('drag-over'); });
  convEl.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); convEl.classList.remove('drag-over'); if (!state.room) return; const files = e.dataTransfer.files; if (files.length) { for (const f of files) { const isImg = f.type.startsWith('image/'); const isVid = f.type.startsWith('video/'); const fd = new FormData(); fd.append('file', f); const bar = $('upload-bar'); bar.classList.remove('hidden'); $('upload-fill').style.width = '0%'; const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload'); xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('upload-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%'; }; xhr.onload = () => { bar.classList.add('hidden'); try { const d = JSON.parse(xhr.responseText); doSend({ kind: isImg ? 'image' : isVid ? 'video' : 'file', src: d.url, name: f.name, size: f.size, content: '' }); } catch (err) { toast('خطا در آپلود'); } }; xhr.send(fd); } } });
$('composer-emoji').onclick = () => { const pop = $('emoji-pop'); pop.classList.toggle('hidden'); if (pop.classList.contains('hidden')) return; if (!pop.dataset.filled) { pop.innerHTML = '<div class="emoji-picker-wrap"><div class="emoji-search-row"><input type="text" id="emoji-search" class="input" placeholder="جستجوی ایموجی..." /></div><div class="emoji-cats" id="emoji-cats"></div><div class="emoji-grid" id="emoji-grid"></div></div>'; const cats = pop.querySelector('#emoji-cats'); const grid = pop.querySelector('#emoji-grid'); const search = pop.querySelector('#emoji-search'); Object.keys(EMOJI_CATEGORIES).forEach((cat, i) => { const btn = document.createElement('button'); btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : ''); btn.textContent = cat.split(' ')[0]; btn.title = cat; btn.onclick = () => { cats.querySelectorAll('.emoji-cat-btn').forEach((b) => b.classList.remove('active')); btn.classList.add('active'); renderEmojiGrid(grid, EMOJI_CATEGORIES[cat]); search.value = ''; }; cats.appendChild(btn); }); renderEmojiGrid(grid, EMOJI_CATEGORIES[Object.keys(EMOJI_CATEGORIES)[0]]); search.addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); if (!q) { const active = cats.querySelector('.emoji-cat-btn.active'); const catName = Object.keys(EMOJI_CATEGORIES).find((c) => c.split(' ')[0] === active.textContent) || Object.keys(EMOJI_CATEGORIES)[0]; renderEmojiGrid(grid, EMOJI_CATEGORIES[catName]); return; } const matches = ALL_EMOJIS.filter((em) => em.includes(q)); renderEmojiGrid(grid, matches); }); pop.dataset.filled = '1'; } };
function renderEmojiGrid(grid, emojis) { grid.innerHTML = ''; emojis.forEach((e) => { const s = document.createElement('span'); s.className = 'emoji-item'; s.textContent = e; s.onclick = () => { $('composer-input').value += e; }; grid.appendChild(s); }); }
$('composer-attach').onclick = () => $('file-input').click();
$('file-input').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FormData(); rd.append('file', f); const bar = $('upload-bar'); bar.classList.remove('hidden'); const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload'); xhr.onload = () => { bar.classList.add('hidden'); const d = JSON.parse(xhr.responseText); const isImg = f.type.startsWith('image/'); const isVid = f.type.startsWith('video/'); doSend({ kind: isImg ? 'image' : isVid ? 'video' : f.type.startsWith('audio/') ? 'voice' : 'file', src: d.url, name: f.name, size: f.size, content: '' }); }; xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('upload-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%'; }; xhr.send(rd); };
let recorder = null, recChunks = [], recStart = 0, recStream = null, recAnalyser = null, recTimer = null, recBlob = null, recDur = 0;
function recUI() { let el = $('rec-ui'); if (!el) { el = document.createElement('div'); el.id = 'rec-ui'; el.className = 'rec-ui hidden'; document.body.appendChild(el); } return el; }
function recMeter(amp) { const f = $('rec-fill'); if (f) f.style.width = Math.max(4, Math.round(amp * 100)) + '%'; }
function recTime() { const t = $('rec-time'); if (t) t.textContent = Math.floor((Date.now() - recStart) / 1000) + 's'; }
function showRecRecording() {
  const el = recUI(); el.className = 'rec-ui'; el.innerHTML = '<div class="rec-card rec-mode"><div class="rec-dot"></div><div class="rec-state">در حال ضبط — رها کنید تا ارسال شود</div><div class="rec-meter"><div class="rec-meter-fill" id="rec-fill"></div></div><div class="rec-time" id="rec-time">0s</div></div>';
  recTime();
}
function showRecPreview(blob, dur) {
  const url = URL.createObjectURL(blob); const el = recUI(); el.className = 'rec-ui';
  el.innerHTML = '<div class="rec-card rec-prev"><div class="rec-prev-title">پیش‌نمایش ویس (' + Math.round(dur) + 's)</div><audio id="rec-audio" controls src="' + url + '"></audio><div class="rec-acts"><button class="btn ghost" id="rec-cancel">حذف</button><button class="btn primary" id="rec-send">' + ic('send') + ' ارسال</button></div></div>';
  el.querySelector('#rec-cancel').onclick = () => { el.classList.add('hidden'); recBlob = null; };
  el.querySelector('#rec-send').onclick = () => sendVoice(blob, dur);
}
async function sendVoice(blob, dur) {
  const el = recUI(); el.classList.add('hidden');
  if (!blob || !blob.size) { toast('ضبط خالی بود'); return; }
  const fd = new FormData(); fd.append('file', blob, 'voice.' + (blob.type.includes('ogg') ? 'ogg' : 'webm'));
  const bar = $('upload-bar'); bar.classList.remove('hidden'); $('upload-fill').style.width = '0%';
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('upload-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%'; };
  xhr.onload = () => { bar.classList.add('hidden'); try { const d = JSON.parse(xhr.responseText); doSend({ kind: 'voice', src: d.url, duration: dur, content: '' }); toast('ویس ارسال شد'); } catch (e) { toast('خطا در ارسال پیام صوتی'); } };
  xhr.send(fd);
}
function onRecStop() {
  if (recTimer) { clearTimeout(recTimer); recTimer = null; }
  if (recAnalyser) { try { recAnalyser.disconnect(); } catch (e) {} recAnalyser = null; }
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(recChunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
  const dur = (Date.now() - recStart) / 1000;
  recorder = null; recStream = null; $('composer-mic').classList.remove('recording');
  if (!blob.size) { recUI().classList.add('hidden'); return; }
  recBlob = blob; recDur = dur; showRecPreview(blob, dur);
}
async function startRecording() {
  if (recorder) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند'); return; }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = []; recorder = new MediaRecorder(recStream);
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = onRecStop;
    recorder.start(); recStart = Date.now(); $('composer-mic').classList.add('recording');
    showRecRecording();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ac = new AC(); const srcNode = ac.createMediaStreamSource(recStream); recAnalyser = ac.createAnalyser(); recAnalyser.fftSize = 256;
      srcNode.connect(recAnalyser); const data = new Uint8Array(recAnalyser.frequencyBinCount);
      const tick = () => { if (!recAnalyser) return; recAnalyser.getByteTimeDomainData(data); let mn = 1, mx = -1; for (const v of data) { const x = v / 128 - 1; if (x < mn) mn = x; if (x > mx) mx = x; } const amp = Math.min(1, (mx - mn) / 2 * 3.2); recMeter(amp); recTime(); recTimer = setTimeout(tick, 200); };
      tick();
    }
  } catch (e) { toast('دسترسی به میکروفون داده نشد — در تنظیمات مرورگر مجوز بده'); }
}
$('composer-mic').addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); startRecording(); });
window.addEventListener('pointerup', () => { if (recorder) recorder.stop(); });

$('composer-sticker').onclick = () => { const m = { kind: 'sticker', sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f600.png' }; doSend(m); };
function setReply(m) { state.replyTo = m; if (m) $('reply-bar').innerHTML = '<div class="rb-text">پاسخ به: ' + esc(previewText(m)) + '</div><div class="rb-x" onclick="setReply(null)">' + ic('x') + '</div>'; $('reply-bar').classList.toggle('hidden', !m); luc(); }
$('messages').addEventListener('click', (e) => { const a = e.target.closest('.msg-action'); if (a) { /* handled inline */ } });
function openReactionPicker(bubble, id) { const pop = document.createElement('div'); pop.className = 'reac-pop'; EMOJI.slice(0, 12).forEach((em) => { const s = document.createElement('span'); s.textContent = em; s.onclick = () => { toggleReaction(id, em, state.room); pop.remove(); }; pop.appendChild(s); }); document.body.appendChild(pop); const r = bubble.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 6) + 'px'; setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 100); }
async function toggleReaction(id, em, rid) { const d = await (await api('/api/reactions', { method: 'POST', body: JSON.stringify({ messageId: id, emoji: em, roomId: rid }) })).json(); if (state.ws) state.ws.send(JSON.stringify({ type: 'message-reacted', messageId: id, roomId: rid })); }
function votePoll(id, opt, rid) { if (state.ws) state.ws.send(JSON.stringify({ type: 'vote', messageId: id, option: opt, roomId: rid })); }
function toggleCheck(id, itemId, done, rid) { if (state.ws) state.ws.send(JSON.stringify({ type: 'checklist-toggle', messageId: id, itemId: itemId, done: done, roomId: rid })); }
function updateMessage(d) { const el = document.querySelector('[data-id="' + d.id + '"]'); if (!el) return; if (d.message && d.message.reactions) { const old = el.querySelector('.reactions'); const r = reactionsEl(d.message); if (old) old.replaceWith(r); else { const body = el.querySelector('.msg-body'); if (body) body.appendChild(r); } } if (d.message && d.message.poll) { const b = el.querySelector('.msg-body'); if (b) b.replaceChildren(pollEl(d.message)); } if (d.message && d.message.checklist) { const b = el.querySelector('.msg-body'); if (b) b.replaceChildren(checklistEl(d.message)); } luc(); }
function showTyping(d) { const sub = $('conv-sub'); if (d.roomId === state.room) sub.textContent = d.on ? (d.username === BOT_USERNAME ? 'در حال نوشتن…' : 'کاربر در حال نوشتن…') : roomOnline(state.room); }
function markRead(rid) { if (!rid) return; if (!state.readState[rid]) state.readState[rid] = {}; state.readState[rid][state.me.username] = Date.now(); if (state.rooms[rid]) state.rooms[rid].unread = 0; buildChatList(); if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'read', roomId: rid })); }

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
  act.appendChild(mk('پاک کردن تاریخچه', 'trash-2', () => { if (confirm('پاک شود؟')) { $('messages').innerHTML = ''; state.lastDay = null; } }));
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
            if (confirm('لینک دعوت:\n' + link + '\n\nآیا می‌خواهید کپی شود؟')) {
              navigator.clipboard.writeText(link).catch(() => {});
            }
          }
        } catch (e) { toast('خطا در دریافت لینک'); }
      }));
    }
  }
  act.appendChild(mk('مشاهده پروفایل', 'user', () => { const other = rid.startsWith('dm:') ? rid.slice(3).split('|').find((p) => p !== state.me.username) : null; if (other) openProfile(other); else toast('نمایش پروفایل برای گروه در دسترس نیست'); }));
  if (rid.startsWith('dm:')) {
    const other = rid.slice(3).split('|').find((p) => p !== state.me.username);
    if (other && other !== BOT_USERNAME) {
      const isBlocked = state.me.blocked && state.me.blocked.includes(other);
      act.appendChild(mk(isBlocked ? 'آنبلاک کردن' : 'مسدود کردن', isBlocked ? 'user-check' : 'user-x', async () => {
        if (isBlocked) {
          const res = await api('/api/unblock', { method: 'POST', body: JSON.stringify({ username: other }) });
          const d = await res.json();
          if (d.ok) { state.me.blocked = d.blocked; toast('کاربر آنبلاک شد'); buildChatList(); renderDetails(); }
        } else {
          if (!confirm('آیا می‌خواهید این کاربر را مسدود کنید؟')) return;
          const res = await api('/api/block', { method: 'POST', body: JSON.stringify({ username: other }) });
          const d = await res.json();
          if (d.ok) { state.me.blocked = d.blocked; toast('کاربر مسدود شد'); buildChatList(); renderDetails(); }
        }
      }));
    }
  }
  p.appendChild(act); luc();
}
function setFlag(rid, key, val) { if (!state.chatState[rid]) state.chatState[rid] = {}; state.chatState[rid][key] = val; api('/api/chats/state', { method: 'POST', body: JSON.stringify({ roomId: rid, key: key, value: val }) }); buildChatList(); }

/* CHAT CONTEXT MENU */
function openChatMenu(e, rid) {
  const pop = document.createElement('div'); pop.className = 'ctx-menu'; pop.style.left = e.clientX + 'px'; pop.style.top = e.clientY + 'px';
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'ctx-item'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = () => { fn(); pop.remove(); }; pop.appendChild(r); };
  mk('باز کردن', 'message-square', () => openRoom(rid));   mk('پین', 'pin', () => setFlag(rid, 'pinned', true)); mk('بی‌صدا', 'volume-x', () => setFlag(rid, 'muted', true)); mk('مخفی', 'eye-off', () => setFlag(rid, 'hidden', true)); mk('آرشیو', 'archive', () => setFlag(rid, 'archived', !chatFlags(rid).archived));
  document.body.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
}
function openMsgMore(e, m) {
  const pop = document.createElement('div'); pop.className = 'ctx-menu'; pop.style.left = e.clientX + 'px'; pop.style.top = e.clientY + 'px';
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'ctx-item'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = () => { fn(); pop.remove(); }; pop.appendChild(r); };
  mk('واکنش', 'smile', () => openReactionPicker(document.querySelector('[data-id="' + m.id + '"] .bubble'), m.id));
  mk('پاسخ', 'reply', () => setReply(m));
  mk('فوروارد', 'forward', () => openForward(m.id));
  mk('رونوشت', 'clipboard', () => { navigator.clipboard.writeText(m.content || ''); toast('کپی شد'); });
  if (m.from === state.me.username) mk('ویرایش', 'edit-3', () => { const t = prompt('ویرایش پیام', m.content); if (t && state.ws) state.ws.send(JSON.stringify({ type: 'edit', messageId: m.id, roomId: m.roomId, content: t })); });
  if (m.from === state.me.username) mk('حذف', 'trash-2', () => { if (confirm('حذف شود؟') && state.ws) state.ws.send(JSON.stringify({ type: 'delete', messageId: m.id, roomId: m.roomId })); });
  mk('پین', 'pin', () => { if (state.ws) state.ws.send(JSON.stringify({ type: 'pin', messageId: m.id, roomId: m.roomId })); });
  document.body.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
}
function openForward(id) {
  const m = (state.rooms[state.room] || {}).messages.find((x) => x.id === id); if (!m) return;
  const pop = document.createElement('div'); pop.className = 'ctx-menu'; pop.style.left = '50%'; pop.style.top = '120px'; pop.style.transform = 'translateX(50%)'; pop.style.minWidth = '240px';
  pop.innerHTML = '<div class="ctx-item" style="font-weight:700">ارسال به…</div>';
  allRoomIds().forEach((rid) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.innerHTML = '<span>' + esc(roomTitle(rid)) + '</span>'; it.onclick = () => { pop.remove(); if (state.ws) state.ws.send(JSON.stringify({ type: 'forward', messageId: id, roomId: rid })); toast('فوروارد شد'); }; pop.appendChild(it); });
  document.body.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
}
/* PART 3 — views, palette, new menu, profile, misc, init */
const EMOJI_CATEGORIES = {
  '😀 چهره‌ها': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋 اشاره': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','🫷','🫸','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪'],
  '❤️ قلب': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
  '🐾 حیوانات': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'],
  '🍕 غذا': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥖','🍞','🥨','🥯','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
  '⚽ ورزش': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥍','🏑','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','🎯','🪃','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎮','🕹️','🎰','🎲'],
  '🚗 وسایل نقلیه': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🛞','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸'],
  '物件': ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','🩻','🩼','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🫧','🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸','🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','🪧','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📖','📗','📘','📙','📚','HeaderValue','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✏️','✒️','🖌️','🖍️','📝','💼','📁','📂','🗂️'],
  '✳️ نمادها': ['🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','💠','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','Inline code','💯','❗','❓','❕','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤']
};
const ALL_EMOJIS = Object.values(EMOJI_CATEGORIES).flat();
function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 660; g.gain.value = 0.04; o.start(); o.stop(c.currentTime + 0.12); } catch (e) {} }
function logout() { localStorage.removeItem('ft_token'); location.reload(); }
$('auth-logout').onclick = logout;
function showAuth() {
  $('auth-screen').classList.remove('hidden');
  const lb = $('auth-logout');
  if (lb) lb.style.display = (localStorage.getItem('ft_token') || localStorage.getItem('ft_admin_token')) ? '' : 'none';
}

/* PROFILE */
function openProfile(rid) {
  const p = $('details-panel'); p.classList.remove('hidden'); p.innerHTML = ''; const close = document.createElement('div'); close.className = 'dp-close'; close.innerHTML = ic('x'); close.onclick = () => p.classList.add('hidden'); p.appendChild(close);
  const u = state.me; const head = document.createElement('div'); head.className = 'dp-head'; head.innerHTML = avatarEl(u, 'lg').outerHTML + '<div class="dp-name">' + esc(u.displayName) + '</div><div class="dp-sub">@' + esc(u.username) + (u.isAdmin ? ' • ادمین' : '') + (u.isPremium ? ' • پریمیوم' : '') + '</div>'; p.appendChild(head);
  const sec = document.createElement('div'); sec.className = 'dp-sec'; sec.innerHTML = '<div class="dp-sec-title">پروفایل</div>';
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'dp-act'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = fn; return r; };
  sec.appendChild(mk('تغییر نام نمایشی', 'user', () => { const n = prompt('نام جدید', u.displayName); if (n) { api('/api/profile/rename', { method: 'POST', body: JSON.stringify({ displayName: n }) }).then(() => { state.me.displayName = n; renderNav(); }); } }));
  sec.appendChild(mk('مدیریت حساب', 'settings', () => switchNav('settings')));
  if (u.isAdmin) sec.appendChild(mk('پنل ادمین', 'shield', () => switchNav('settings')));
  p.appendChild(sec); luc();
}

/* VIEWER */
function openViewer(src, kind) { const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = (kind === 'video' ? '<video src="' + src + '" controls autoplay></video>' : '<img src="' + src + '">') + '<div class="v-close" onclick="this.parentNode.remove()">' + ic('x') + '</div>'; v.onclick = (e) => { if (e.target === v) v.remove(); }; document.body.appendChild(v); luc(); }

/* NEW MENU */
function openNewMenu() {
  const pop = document.createElement('div'); pop.className = 'ctx-menu'; const btn = $('cl-new').getBoundingClientRect(); pop.style.left = btn.left + 'px'; pop.style.top = (btn.bottom + 6) + 'px';
  const mk = (t, icn, fn) => { const r = document.createElement('div'); r.className = 'ctx-item'; r.innerHTML = ic(icn) + '<span>' + t + '</span>'; r.onclick = () => { fn(); pop.remove(); }; pop.appendChild(r); };
  mk('چت خصوصی جدید', 'user-plus', startDM); mk('گروه جدید', 'users', () => startGroup()); mk('کانال جدید', 'megaphone', () => startGroup(true));
  document.body.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
}
function startDM() { const who = prompt('نام کاربری مقابل (مثلاً ali):'); if (!who) return; const other = who.replace('@', ''); const rid = 'dm:' + [state.me.username, other].sort().join('|'); if (state.me.isAdmin || getContacts()[other] || other === BOT_USERNAME) { openRoom(rid); } else { const c = getContacts(); c[other] = other; saveContacts(c); openRoom(rid); } }
function openDM(other) {
  if (other === state.me.username) return;
  const rid = 'dm:' + [state.me.username, other].sort().join('|');
  if (!state.me.isAdmin && !getContacts()[other] && other !== BOT_USERNAME) { const c = getContacts(); c[other] = (state.users.find((u) => u.username === other) || {}).displayName || other; saveContacts(c); }
  switchNav('chats'); openRoom(rid);
}
function renderContacts(wrap) {
  wrap.innerHTML = '<div class="contact-search"><input id="ct-search" class="inp" placeholder="جستجوی آیدی یا نام کاربر…"><div id="ct-results" class="ct-results"></div></div><div id="ct-list"></div>';
  const listEl = wrap.querySelector('#ct-list');
  const resultsEl = wrap.querySelector('#ct-results');
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
  const d = await (await api('/api/admin/signups')).json().catch(() => ({ signups: [] }));
  const list = (d.signups || []).filter((s) => !s.status || s.status === 'pending');
  state.signupCount = list.length; renderNav();
  if (!list.length) { wrap.innerHTML = '<div class="placeholder">درخواست ثبت‌نام جدیدی نیست.</div>'; return; }
  let h = '<div class="signup-list">';
  list.forEach((s) => {
    h += '<div class="signup-row" data-id="' + esc(s.id) + '"><div class="su-body"><div class="su-name">' + esc(s.displayName || s.username) + '</div><div class="su-sub">@' + esc(s.username) + (s.phone ? ' • ' + esc(s.phone) : '') + '</div></div><div class="su-actions"><button class="btn sm primary" data-act="approve">تایید</button><button class="btn sm danger" data-act="reject">رد</button></div></div>';
  });
  h += '</div>';
  wrap.innerHTML = h;
  wrap.querySelectorAll('.signup-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-act="approve"]').onclick = async () => { await api('/api/admin/signups/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ approve: true }) }); toast('تایید شد'); renderSignups(wrap); };
    row.querySelector('[data-act="reject"]').onclick = async () => { await api('/api/admin/signups/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ approve: false }) }); toast('رد شد'); renderSignups(wrap); };
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
      { label: 'درخواست‌های منتظر', value: d.pendingSignups, icon: 'user-plus' },
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
function openProfile(username) { renderProfile(username); }
function renderProfile(username) {
  if (isMobile()) closeDrawers();
  let u = (state.me.username === username) ? state.me : (state.users || []).find((x) => x.username === username);
  if (!u) { api('/api/user/' + encodeURIComponent(username)).then((r) => r.json()).then((d) => { if (d.u) { state.users = state.users || []; if (!state.users.find((x) => x.username === d.u.username)) state.users.push(d.u); renderProfile(username); } else { setMode('view'); viewHost.innerHTML = '<div class="placeholder">پروفایل یافت نشد.</div>'; } }).catch(() => { setMode('view'); viewHost.innerHTML = '<div class="placeholder">خطا در بارگذاری پروفایل.</div>'; }); return; }
  setMode('view');
  const online = !!u.online;
  const skin = SKINS.find((s) => s.id === (u.activeSkin || 'default'));
  const effId = (u.profileEffect && u.profileEffect !== 'off') ? u.profileEffect : '';
  const eff = effId ? EFFECTS[effId] : null;
  const premium = !!eff;
  const mood = eff ? eff.family : '';
  const colHex = (u.profileEffectColor) || (eff ? eff.color : '#3b82f6');
  const sa = premium ? ' style="--accent:' + colHex + ';--accent-2:' + shade(colHex, -22) + ';--accent-glow:' + glow(colHex) + '"' : '';
  const badge = (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '');
  let h = '<div class="profile-view' + (premium ? ' pv-premium mood-' + mood : '') + '"' + sa + '>';
  h += '<button class="btn sm ghost" data-act="back">← بازگشت</button>';
  if (u.profileBg) h += '<div class="profile-bg" style="background-image:url(\'' + u.profileBg + '\')"></div>';
  h += '<div class="profile-hero">';
  if (premium) h += '<div class="profile-banner"></div>';
  h += '<div class="profile-av' + (premium ? ' ringed' : '') + '">' + avatarEl(u, 'xl').outerHTML + '</div>';
  h += '<div class="profile-name">' + esc(u.displayName || u.username) + badge + (premium ? ' <span class="profile-skin-badge">' + esc(eff.name) + '</span>' : '') + '</div>';
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
    }
  }
  if (u.username === state.me.username) {
    h += '<div class="profile-edit">';
    h += '<button class="btn sm ghost" data-act="av-up">تغییر عکس</button>';
    h += '<button class="btn sm ghost" data-act="bg-up">پس‌زمینه</button>';
    h += '<button class="btn sm ghost" data-act="bg-gallery">گالری پینترست</button>';
    h += '</div>';
    h += '<input type="file" id="prof-file" accept="image/*" style="display:none">';
  }
  h += '</div></div>';
  viewHost.innerHTML = h;
  if (premium && mood) {
    const av = viewHost.querySelector('.profile-av');
    if (av) {
      let pts = '';
      for (let i = 0; i < 16; i++) { const l = (Math.random() * 100).toFixed(0); const dur = (2.2 + Math.random() * 3.4).toFixed(2); const dl = (Math.random() * 4).toFixed(2); const sz = (4 + Math.random() * 7).toFixed(0); pts += '<i class="pt" style="left:' + l + '%;width:' + sz + 'px;height:' + sz + 'px;animation-duration:' + dur + 's;animation-delay:-' + dl + 's"></i>'; }
      const aura = document.createElement('div'); aura.className = 'profile-aura';
      aura.innerHTML = '<span class="wing left"></span><span class="wing right"></span>' + pts;
      av.appendChild(aura);
    }
  }
  viewHost.querySelector('[data-act="back"]').onclick = () => renderView('contacts');
  viewHost.querySelector('[data-act="chat"]').onclick = () => openDM(username);
  const rn = viewHost.querySelector('[data-act="rename"]'); if (rn) rn.onclick = () => renameUser(username, u.displayName, () => renderProfile(username));
  const pr = viewHost.querySelector('[data-act="premium"]'); if (pr) pr.onclick = async () => { await api('/api/admin/premium', { method: 'POST', body: JSON.stringify({ username, isPremium: !u.isPremium }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const bn = viewHost.querySelector('[data-act="ban"]'); if (bn) bn.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username, banned: !u.banned }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const imp = viewHost.querySelector('[data-act="impersonate"]'); if (imp) imp.onclick = () => enterAsUser(username);
  const pm = viewHost.querySelector('[data-act="promote"]'); if (pm) pm.onclick = async () => { await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ username, scope: 'global', role: 'admin' }) }); toast('کاربر به ادمین ارتقا یافت'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const dm = viewHost.querySelector('[data-act="demote"]'); if (dm) dm.onclick = async () => { if (!confirm('ادمین بودن @' + username + ' حذف شود؟')) return; await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ username, scope: 'global', role: 'member' }) }); toast('از ادمینی حذف شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  if (state.me.isAdmin) {
    const sec = document.createElement('div'); sec.className = 'profile-files';
    sec.innerHTML = '<h3>' + ic('paperclip') + ' فایل‌های ارسالی</h3><div class="pf-body ph-loading">در حال بارگذاری…</div>';
    viewHost.querySelector('.profile-view').appendChild(sec);
    api('/api/admin/user/' + encodeURIComponent(username) + '/files').then((r) => r.json()).then((d) => {
      const imgs = d.images || [], auds = d.audios || [], vids = d.videos || [], fils = d.files || [], links = d.links || [];
      const total = imgs.length + auds.length + vids.length + fils.length + links.length;
      if (!total) { sec.querySelector('.pf-body').innerHTML = '<div class="placeholder">فایلی ارسال نشده است.</div>'; return; }
      let h = '';
      if (imgs.length) { h += '<div class="pf-group"><b>تصاویر (' + imgs.length + ')</b><div class="pf-grid">' + imgs.map((m) => '<a class="pf-thumb" href="' + m.src + '" target="_blank"><img src="' + m.src + '" loading="lazy"></a>').join('') + '</div></div>'; }
      if (vids.length) { h += '<div class="pf-group"><b>ویدیو (' + vids.length + ')</b><div class="pf-grid">' + vids.map((m) => '<a class="pf-thumb" href="' + m.src + '" target="_blank">' + ic('video') + '</a>').join('') + '</div></div>'; }
      if (auds.length) { h += '<div class="pf-group"><b>صدا (' + auds.length + ')</b>' + auds.map((m) => '<div class="pf-audio"><button onclick="this.nextElementSibling.play()">' + ic('play') + '</button><audio src="' + m.src + '" preload="none"></audio><span>' + (m.name || 'ویس') + '</span></div>').join('') + '</div>'; }
      if (fils.length) { h += '<div class="pf-group"><b>فایل‌ها (' + fils.length + ')</b>' + fils.map((m) => '<div class="pf-file"><a href="' + m.src + '" download>' + ic('file') + (m.name || 'فایل') + '</a></div>').join('') + '</div>'; }
      if (links.length) { h += '<div class="pf-group"><b>لینک‌ها (' + links.length + ')</b>' + links.map((m) => '<div class="pf-link"><a href="' + m.url + '" target="_blank">' + ic('link') + esc(m.url.slice(0, 60)) + '</a></div>').join('') + '</div>'; }
      sec.querySelector('.pf-body').innerHTML = h;
    }).catch(() => { sec.querySelector('.pf-body').innerHTML = '<div class="placeholder">خطا در بارگذاری.</div>'; });
  }
  const pf = viewHost.querySelector('#prof-file');
  if (pf) {
    pf.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      const target = pf.dataset.target;
      toast('در حال آپلود…');
      fetch('/api/profile/' + (target === 'bg' ? 'background' : 'avatar'), { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd })
        .then((r) => r.json()).then((d) => { if (d.me) state.me = d.me; toast(target === 'bg' ? 'پس‌زمینه تنظیم شد' : 'عکس پروفایل تغییر کرد'); renderProfile(username); })
        .catch(() => toast('خطا در آپلود'));
    };
  }
  const avUp = viewHost.querySelector('[data-act="av-up"]'); if (avUp) avUp.onclick = () => { if (pf) { pf.dataset.target = 'avatar'; pf.click(); } };
  const bgUp = viewHost.querySelector('[data-act="bg-up"]'); if (bgUp) bgUp.onclick = () => { if (pf) { pf.dataset.target = 'bg'; pf.click(); } };
  const bgGal = viewHost.querySelector('[data-act="bg-gallery"]'); if (bgGal) bgGal.onclick = () => openGallery('backgrounds', (url) => {
    api('/api/profile/background/url', { method: 'POST', body: JSON.stringify({ url }) }).then((r) => r.json()).then((d) => { if (d.me) state.me = d.me; toast('پس‌زمینه از گالری تنظیم شد'); renderProfile(username); }).catch(() => toast('خطا در تنظیم پس‌زمینه'));
  });
  luc();
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
function enterAsUser(username) {
  if (!confirm('وارد حساب @' + username + ' می‌شوید؟ پس از ورود می‌توانید با دکمه بازگشت به پنل ادمین برگردید.')) return;
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
  const name = prompt('نام ' + (isChannel ? 'کانال' : 'گروه') + ':');
  if (!name) return;
  const d = await (await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: name, type: isChannel ? 'channel' : 'group' }) })).json();
  state.groups.push(d.group);
  if (state.ws) state.ws.send(JSON.stringify({ type: 'groups', groups: state.groups }));
  openRoom('group:' + d.group.id);
  setTimeout(() => {
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
    if (confirm('آیا می‌خواهید آواتار برای گروه انتخاب کنید؟')) input.click(); else input.remove();
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
  const back = h.querySelector('#view-back'); if (back) back.onclick = () => switchNav('chats');
  const wrap = document.createElement('div'); wrap.className = 'view-body'; viewHost.appendChild(wrap);
  if (id === 'ai') {
    wrap.innerHTML = '<div class="ai-card"><div class="ai-conv" id="ai-conv"></div><div class="ai-input-row"><input id="ai-input" placeholder="از دستیار بپرس…" /><button id="ai-send">' + ic('send') + '</button></div><div class="ai-actions"><button data-a="summarize">' + ic('file-text') + ' خلاصه چت</button><button data-a="reply">' + ic('corner-down-left') + ' پیشنهاد پاسخ</button><button data-a="translate">' + ic('languages') + ' ترجمه</button><button data-a="rewrite">' + ic('edit-3') + ' بازنویسی</button></div></div>';
    $('ai-send').onclick = () => aiOnMessage(state.room); $('ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') aiOnMessage(state.room); });
    wrap.querySelectorAll('.ai-actions button').forEach((b) => b.onclick = async () => { const a = b.dataset.a; if (a === 'summarize' && !state.room) return toast('اول یک چت باز کن'); if (a === 'reply' && !state.room) return toast('اول یک چت باز کن'); const act = a === 'summarize' ? 'summarize' : a === 'reply' ? 'reply' : a === 'translate' ? 'translate' : 'rewrite'; const d = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: act, roomId: state.room, text: $('ai-input').value }) })).json(); appendAIMsg('bot', d.result || d.error || ''); });
  } else if (id === 'contacts') { renderContacts(wrap); }
  else if (id === 'settings') {
    const cat = state.settingsCat || 'main';
    const backBtn = wrap.querySelector ? null : null;
    const h = document.createElement('div'); h.className = 'view-head';
    if (cat !== 'main') {
      h.innerHTML = '<button class="icon-btn view-back" id="view-back">' + ic('chevron-right') + '</button>' + ic('settings') + '<h2>تنظیمات</h2>';
      wrap.innerHTML = ''; wrap.appendChild(h);
      renderSettingsSub(cat, wrap);
      h.querySelector('#view-back').onclick = () => { state.settingsCat = 'main'; renderView('settings'); };
    } else {
      h.innerHTML = '<button class="icon-btn view-back" id="view-back">' + ic('chevron-right') + '</button>' + ic('settings') + '<h2>تنظیمات</h2>';
      wrap.innerHTML = ''; wrap.appendChild(h);
      renderSettingsMain(wrap);
      h.querySelector('#view-back').onclick = () => switchNav('chats');
    }
    luc();
  } else if (id === 'communities') { wrap.innerHTML = groupsHTML('group'); }
  else if (id === 'channels') { wrap.innerHTML = groupsHTML('channel'); }
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
function groupsHTML(type) { const gs = state.groups.filter((g) => g.type === type); let h = '<div class="group-list">'; gs.forEach((g) => { h += '<div class="group-card" data-gid="' + g.id + '">' + avatarEl({ displayName: g.name }, 'md').outerHTML + '<div class="gc-name">' + esc(g.name) + '</div><div class="gc-sub">' + g.members.length + ' عضو</div></div>'; }); h += '</div>'; if (!gs.length) h = '<div class="placeholder">' + (type === 'channel' ? 'کانالی' : 'کامیونیتی‌ای') + ' یافت نشد. از منوی + ایجاد کنید.</div>'; return h; }
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
  effects: { title: ic('sparkles') + ' حاله و بال', icon: 'sparkles' },
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
  const accents = ['blue', 'purple', 'cyan', 'green', 'pink', 'orange', 'red'];
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
  t += '<div class="settings-row"><span>وضعیت</span><b>' + (state.me.isPremium ? 'پریمیوم' : 'رایگان') + (state.me.isAdmin ? ' • ادمین' : '') + '</b></div></div>';
  body.innerHTML = t;
}
function renderNotifSub(body) {
  let t = '<div class="settings-sec"><h3>' + ic('bell') + ' اعلان‌ها</h3><div class="settings-row"><span>اعلان مرورگر</span><button class="btn sm" id="set-notif">' + ((localStorage.getItem('vx_notify') === '1') ? 'روشن' : 'خاموش') + '</button></div></div>';
  body.innerHTML = t;
  const nb = body.querySelector('#set-notif'); if (nb) nb.onclick = async () => { if (!('Notification' in window)) { toast('مرورگر پشتیبانی نمی‌کند'); return; } const p = await Notification.requestPermission(); localStorage.setItem('vx_notify', p === 'granted' ? '1' : '0'); nb.textContent = p === 'granted' ? 'روشن' : 'خاموش'; toast(p === 'granted' ? 'اعلان روشن شد' : 'اعلان خاموش شد'); };
}
function renderPrivSub(body) {
  const ptoggle = (key, label) => '<div class="settings-row"><span>' + label + '</span><label class="switch"><input type="checkbox" id="priv-' + key + '" ' + (localStorage.getItem(key) !== '0' ? 'checked' : '') + '><span class="slider"></span></label></div>';
  let t = '<div class="settings-sec"><h3>' + ic('lock') + ' حریم خصوصی</h3>';
  t += ptoggle('vx_online', 'نمایش وضعیت آنلاین');
  t += ptoggle('vx_lastseen', 'نمایش آخرین بازدید');
  t += ptoggle('vx_showphone', 'نمایش شماره به دیگران');
  t += ptoggle('vx_acceptall', 'پذیرش پیام از همه');
  t += '</div>';
  body.innerHTML = t;
  ['vx_online', 'vx_lastseen', 'vx_showphone', 'vx_acceptall'].forEach((k) => { const el = body.querySelector('#priv-' + k); if (el) el.onchange = (e) => { localStorage.setItem(k, e.target.checked ? '1' : '0'); toast('تنظیمات حریم خصوصی ذخیره شد'); }; });
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
];
const EFFECTS = {};
EFFECT_FAMILIES.forEach((f) => {
  f.colors.forEach((ck) => {
    const id = f.id + '-' + ck;
    EFFECTS[id] = {
      id, family: f.id, name: f.name, desc: f.desc,
      accent: ck, color: EFFECT_PALETTES[ck],
      colors: f.colors.map((c) => ({ key: c, hex: EFFECT_PALETTES[c] })),
    };
  });
});
function hexToRgb(h) { h = (h || '#3b82f6').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex, p) { const [r, g, b] = hexToRgb(hex); const f = (c) => Math.max(0, Math.min(255, Math.round(c + (p / 100) * 255))); return '#' + [f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join(''); }
function glow(hex, a) { const [r, g, b] = hexToRgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? .35 : a) + ')'; }
function renderSkinsSub(body) {
  if (!state.me.isPremium && !state.me.isAdmin) { body.innerHTML = '<div class="settings-sec"><h3>' + ic('lock') + ' فقط پرمیوم</h3><div class="placeholder">این بخش فقط برای کاربران پرمیوم در دسترس است. برای خرید پرمیوم با ادمین تماس بگیرید.</div></div>'; return; }
  // کاربر پرمیوم همه اسکین‌ها را دارد
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
  if (!state.me.isPremium && !state.me.isAdmin) { body.innerHTML = '<div class="settings-sec"><h3>' + ic('lock') + ' فقط پرمیوم</h3><div class="placeholder">بخش افکت‌های حاله و بال فقط برای کاربران پرمیوم است. برای فعال‌سازی با ادمین تماس بگیرید.</div></div>'; return; }
  const cur = state.me.profileEffect || 'off';
  const curFam = cur !== 'off' ? cur.split('-')[0] : '';
  const curCol = cur !== 'off' ? cur.split('-')[1] : '';
  let t = '<div class="settings-sec"><h3>' + ic('sparkles') + ' حاله و بال پروفایل</h3>';
  t += '<div class="eff-note">روی هر افکت بزن تا پالت رنگ‌هایش باز شود؛ رنگ دلخواهت رو انتخاب کن.</div>';
  t += '<div class="eff-grid">';
  t += '<div class="eff-card off' + (cur === 'off' ? ' active' : '') + '" data-off="1"><div class="eff-preview off"></div><div class="skin-info"><b>خاموش</b><span>بدون افکت</span></div></div>';
  EFFECT_FAMILIES.forEach((f) => {
    const open = curFam === f.id;
    const c0 = EFFECT_PALETTES[f.colors[0]];
    const c1 = EFFECT_PALETTES[f.colors[1] || f.colors[0]];
    t += '<div class="eff-card fam' + (open ? ' active' : '') + '" data-fam="' + f.id + '">';
    t += '<div class="eff-preview" style="background:linear-gradient(135deg,' + c0 + ',' + c1 + ')"></div>';
    t += '<div class="skin-info"><b>' + esc(f.name) + '</b><span>' + esc(f.desc) + '</span></div>';
    t += '<div class="eff-colors' + (open ? ' open' : '') + '">';
    f.colors.forEach((ck) => {
      const on = open && curCol === ck;
      t += '<button class="eff-swatch' + (on ? ' on' : '') + '" data-eff="' + f.id + '-' + ck + '" data-color="' + EFFECT_PALETTES[ck] + '" style="background:' + EFFECT_PALETTES[ck] + '" title="' + ck + '"></button>';
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
  renderSettingsSub('effects', document.querySelector('.view-body.settings-sub') ? document.querySelector('.view-body.settings-sub').parentElement : null);
}

/* INIT */
function closeAllOverlays() {
  if ($('emoji-pop') && !$('emoji-pop').classList.contains('hidden')) { $('emoji-pop').classList.add('hidden'); return true; }
  if ($('details-panel') && !$('details-panel').classList.contains('hidden')) { $('details-panel').classList.add('hidden'); return true; }
  return false;
}
window.addEventListener('keydown', (e) => {
  const inField = ['INPUT', 'TEXTAREA'].includes((document.activeElement && document.activeElement.tagName) || '');
  if (e.key === 'Escape') { if (closeAllOverlays()) { e.preventDefault(); e.stopPropagation(); } }
}, true);
document.addEventListener('click', (e) => { const dp = document.querySelector('.ctx-menu'); });
(async function init() {
  if (state.token) {
    try { const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + state.token } }); if (r.ok) { const d = await r.json(); if (d.me) { state.me = d.me; enterApp(); } else logout(); } else logout(); }
    catch (e) { showAuth(); }
  } else { showAuth(); }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
