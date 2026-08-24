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
function isMobile() { return window.innerWidth <= 760; }
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
}
applyAppearance();

/* ENTER */
function enterApp() {
  $('auth-screen').classList.add('hidden'); $('app').classList.remove('hidden');
  renderNav(); renderDock(); buildChatList(); connectWS(); applyVX();
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
  { id: 'bookmarks', label: 'نشان‌ها', icon: 'bookmark' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
];
function renderNav() {
  const sc = $('nav-scroll'); sc.innerHTML = '';
  const nav = $('nav-profile');
  const av = avatarEl(state.me, 'sm'); av.id = 'nav-av'; nav.replaceChild(av, $('nav-av'));
  $('nav-name').textContent = state.me.displayName;
  nav.onclick = openProfile;
  const adminOnly = ['users', 'signups'];
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
    case 'room-read': if (!state.readState[d.roomId]) state.readState[d.roomId] = {}; state.readState[d.roomId][d.username] = d.time; if (state.rooms[d.roomId]) state.rooms[d.roomId].unread = 0; buildChatList(); break;
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
  const av = avatarEl(r.isGroup ? { displayName: r.title } : (r.isBot ? { displayName: BOT_NAME } : { displayName: r.title }), 'md');
  it.innerHTML = '<div class="ci-av">' + av.outerHTML + (r.online ? '<span class="online-dot"></span>' : '') + '</div><div class="ci-body"><div class="ci-row1"><div class="ci-name">' + esc(r.title) + (r.isBot ? ' <span style="font-size:9px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:6px">AI</span>' : '') + '</div><div class="ci-time">' + (r.lastTime ? fmt(r.lastTime) : '') + '</div></div><div class="ci-row2">' + (r.pinned ? ic('pin') : '') + (r.muted ? ic('volume-x') : '') + '<div class="ci-last">' + esc(r.lastMsg) + '</div>' + (r.unread ? '<div class="ci-badge">' + r.unread + '</div>' : '') + '</div></div>';
  it.onclick = () => openRoom(r.rid); it.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, r.rid); };
  return it;
}
function computeUnread(rid, r) { if (!r.last) return 0; const rs = state.readState[rid] || {}; const read = rs[state.me.username] || 0; if (r.last.time <= read) return 0; return (r.messages.filter((m) => m.time > read && m.from !== state.me.username).length) || 1; }
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
  renderRoomHeader(); buildChatList();
  setMode('chats');
  if (isMobile()) { $('details-panel').classList.remove('open'); $('conversation').classList.add('chat-open'); showScrim(false); }
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'history', roomId: rid }));
  else { $('messages').innerHTML = ''; state.lastDay = null; (state.rooms[rid] || {}).messages || []; }
}
function roomTitle(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.name : rid; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return BOT_NAME; const u = state.users.find((x) => x.username === other); return u ? (u.displayName || other) : (getContacts()[other] || other); }
function roomOnline(rid) { if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); return g ? g.members.length + ' عضو' : ''; } const other = rid.slice(3).split('|').find((p) => p !== state.me.username); if (other === BOT_USERNAME) return 'آنلاین'; const u = state.users.find((x) => x.username === other); if (state.me.isAdmin) return u ? (u.online && !u.banned ? 'آنلاین' : 'آفلاین') : ''; return ''; }
function renderRoomHeader() { $('conv-name').textContent = roomTitle(state.room); $('conv-sub').textContent = roomOnline(state.room); const av = avatarEl(state.room.startsWith('group:') ? { displayName: roomTitle(state.room) } : { displayName: roomTitle(state.room) }, 'sm'); av.id = 'conv-av'; const old = $('conv-av'); if (old) old.replaceWith(av); }
$('conv-info').onclick = () => { if (isMobile()) { const open = !$('details-panel').classList.contains('open'); $('details-panel').classList.toggle('open', open); showScrim(open); renderDetails(); } else { $('details-panel').classList.toggle('hidden'); renderDetails(); } };
$('conv-back').onclick = () => { state.room = null; buildChatList(); setMode('chats'); if (isMobile()) { $('conversation').classList.remove('chat-open'); } };
$('scrim').onclick = () => closeDrawers();
$('conv-search').onclick = () => { $('conv-searchbox').classList.toggle('hidden'); };

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
function daySep(t) { const d = new Date(t); const s = d.toLocaleDateString('fa-IR'); return s; }
function addMessage(m) {
  const msgs = $('messages'); const d = new Date(m.time); const ds = d.toLocaleDateString('fa-IR');
  if (ds !== state.lastDay) { state.lastDay = ds; const sep = document.createElement('div'); sep.className = 'day-sep'; sep.innerHTML = '<span>' + ds + '</span>'; msgs.appendChild(sep); }
  const mine = m.from === state.me.username; const wrap = document.createElement('div'); wrap.className = 'msg ' + (mine ? 'mine' : '');
  const av = mine ? avatarEl(state.me, 'xs') : avatarEl(state.users.find((u) => u.username === m.from) || { displayName: m.from }, 'xs');
  wrap.innerHTML = '<div class="msg-av">' + av.outerHTML + '</div>';
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dataset.id = m.id; bubble.dataset.from = m.from || '';
  if (m.replyToId) { const orig = (state.rooms[state.room] || {}).messages.find((x) => x.id === m.replyToId); if (orig) bubble.appendChild(replyRef(orig)); }
  bubble.appendChild(bodyEl(m));
  const meta = document.createElement('div'); meta.className = 'msg-meta'; meta.innerHTML = '<span class="msg-time">' + (mine ? (m.read ? ic('check-check') : ic('check')) : '') + fmt(m.time) + '</span>'; bubble.appendChild(meta);
  if (state.me.isPremium || true) { meta.appendChild(reactionsEl(m)); }
  wrap.appendChild(bubble);
  const actions = document.createElement('div'); actions.className = 'msg-actions';
  actions.innerHTML = '<button class="icon-btn" data-a="smile">' + ic('smile') + '</button><button class="icon-btn" data-a="reply">' + ic('reply') + '</button><button class="icon-btn" data-a="forward">' + ic('forward') + '</button><button class="icon-btn" data-a="more">' + ic('more-vertical') + '</button>';
  actions.querySelector('[data-a="smile"]').onclick = () => openReactionPicker(bubble, m.id);
  actions.querySelector('[data-a="reply"]').onclick = () => setReply(m);
  actions.querySelector('[data-a="forward"]').onclick = () => openForward(m.id);
  actions.querySelector('[data-a="more"]').onclick = (e) => openMsgMore(e, m);
  wrap.appendChild(actions);
  msgs.appendChild(wrap); luc();
}
function replyRef(orig) { const r = document.createElement('div'); r.className = 'reply-ref'; const f = orig.from === state.me.username ? 'شما' : (roomTitle(orig.roomId || state.room)); r.innerHTML = '<span class="rr-from">' + esc(f) + '</span><span class="rr-text">' + esc(previewText(orig)) + '</span>'; return r; }
function bodyEl(m) {
  const b = document.createElement('div'); b.className = 'msg-body';
  if (m.kind === 'image' || m.kind === 'video') { b.appendChild(mediaEl(m)); }
  else if (m.kind === 'voice') { b.appendChild(voiceEl(m)); }
  else if (m.kind === 'file' || m.kind === 'audio') { b.appendChild(fileEl(m)); }
  else if (m.kind === 'sticker') { const s = document.createElement('img'); s.className = 'sticker'; s.src = m.sticker || m.content; b.appendChild(s); }
  else if (m.kind === 'poll') { b.appendChild(pollEl(m)); }
  else if (m.kind === 'checklist') { b.appendChild(checklistEl(m)); }
  else b.textContent = m.content || '';
  return b;
}
function mediaEl(m) { const d = document.createElement('div'); d.className = 'media'; const im = document.createElement('img'); im.src = m.src; im.loading = 'lazy'; im.onclick = () => openViewer(m.src, m.kind); d.appendChild(im); if (m.content) { const c = document.createElement('div'); c.className = 'media-cap'; c.textContent = m.content; d.appendChild(c); } return d; }
function fileEl(m) { const d = document.createElement('div'); d.className = 'file-row'; d.innerHTML = ic('file') + '<div class="file-info"><div class="file-name">' + esc(m.name || 'فایل') + '</div><div class="file-size">' + (m.size ? Math.round(m.size / 1024) + ' KB' : '') + '</div></div><a class="file-dl" href="' + m.src + '" download>' + ic('download') + '</a>'; return d; }
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
$('composer-emoji').onclick = () => { $('emoji-pop').classList.toggle('hidden'); if (!$('emoji-pop').dataset.filled) { EMOJI.slice(0, 64).forEach((e) => { const s = document.createElement('span'); s.textContent = e; s.onclick = () => { $('composer-input').value += e; $('emoji-pop').classList.add('hidden'); }; $('emoji-pop').appendChild(s); }); $('emoji-pop').dataset.filled = '1'; } };
$('composer-attach').onclick = () => $('file-input').click();
$('file-input').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FormData(); rd.append('file', f); const bar = $('upload-bar'); bar.classList.remove('hidden'); const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload'); xhr.onload = () => { bar.classList.add('hidden'); const d = JSON.parse(xhr.responseText); const isImg = f.type.startsWith('image/'); const isVid = f.type.startsWith('video/'); doSend({ kind: isImg ? 'image' : isVid ? 'video' : f.type.startsWith('audio/') ? 'voice' : 'file', src: d.url, name: f.name, size: f.size, content: '' }); }; xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('upload-fill').style.width = Math.round((p.loaded / p.total) * 100) + '%'; }; xhr.send(rd); };
let recorder = null, recChunks = [], recStart = 0, recTimer = null;
$('composer-mic').onclick = async () => {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream); recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
      const dur = (Date.now() - recStart) / 1000;
      recorder = null; $('composer-mic').classList.remove('recording'); $('composer-mic').innerHTML = ic('mic');
      if (!blob.size) { toast('ضبط خالی بود'); return; }
      const fd = new FormData(); fd.append('file', blob, 'voice.' + (blob.type.includes('ogg') ? 'ogg' : 'webm'));
      const bar = $('upload-bar'); bar.classList.remove('hidden');
      const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
      xhr.onload = () => { bar.classList.add('hidden'); try { const d = JSON.parse(xhr.responseText); doSend({ kind: 'voice', src: d.url, duration: dur, content: '' }); toast('ویس ارسال شد'); } catch (e) { toast('خطا در ارسال پیام صوتی'); } };
      xhr.send(fd);
    };
    recorder.start(); recStart = Date.now(); $('composer-mic').classList.add('recording'); $('composer-mic').innerHTML = ic('square');
    let sec = 0; const badge = $('rec-badge'); if (badge) badge.classList.remove('hidden');
    recTimer = setInterval(() => { sec++; const b = $('rec-badge'); if (b) b.textContent = 'ضبط ' + sec + 's — برای ارسال دوباره بزنید'; }, 1000);
    toast('در حال ضبط — برای ارسال دوباره بزنید');
  } catch (e) { toast('دسترسی به میکروفون داده نشد — در تنظیمات مرورگر مجوز بده'); }
};
$('composer-sticker').onclick = () => { const m = { kind: 'sticker', sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/72x72/1f600.png' }; doSend(m); };
function setReply(m) { state.replyTo = m; if (m) $('reply-bar').innerHTML = '<div class="rb-text">پاسخ به: ' + esc(previewText(m)) + '</div><div class="rb-x" onclick="setReply(null)">' + ic('x') + '</div>'; $('reply-bar').classList.toggle('hidden', !m); luc(); }
$('messages').addEventListener('click', (e) => { const a = e.target.closest('.msg-action'); if (a) { /* handled inline */ } });
function openReactionPicker(bubble, id) { const pop = document.createElement('div'); pop.className = 'reac-pop'; EMOJI.slice(0, 12).forEach((em) => { const s = document.createElement('span'); s.textContent = em; s.onclick = () => { toggleReaction(id, em, state.room); pop.remove(); }; pop.appendChild(s); }); document.body.appendChild(pop); const r = bubble.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 6) + 'px'; setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 100); }
async function toggleReaction(id, em, rid) { const d = await (await api('/api/reactions', { method: 'POST', body: JSON.stringify({ messageId: id, emoji: em, roomId: rid }) })).json(); if (state.ws) state.ws.send(JSON.stringify({ type: 'message-reacted', messageId: id, roomId: rid })); }
function votePoll(id, opt, rid) { if (state.ws) state.ws.send(JSON.stringify({ type: 'vote', messageId: id, option: opt, roomId: rid })); }
function toggleCheck(id, itemId, done, rid) { if (state.ws) state.ws.send(JSON.stringify({ type: 'checklist-toggle', messageId: id, itemId: itemId, done: done, roomId: rid })); }
function updateMessage(d) { const el = document.querySelector('[data-id="' + d.id + '"]'); if (!el) return; if (d.message && d.message.reactions) { const old = el.querySelector('.reactions'); if (old) old.replaceWith(reactionsEl(d.message)); } if (d.message && d.message.poll) { const b = el.querySelector('.msg-body'); if (b) b.replaceChildren(pollEl(d.message)); } if (d.message && d.message.checklist) { const b = el.querySelector('.msg-body'); if (b) b.replaceChildren(checklistEl(d.message)); } luc(); }
function showTyping(d) { const sub = $('conv-sub'); if (d.roomId === state.room) sub.textContent = d.on ? (d.username === BOT_USERNAME ? 'در حال نوشتن…' : 'کاربر در حال نوشتن…') : roomOnline(state.room); }
function markRead(rid) { if (!rid) return; if (!state.readState[rid]) state.readState[rid] = {}; state.readState[rid][state.me.username] = Date.now(); if (state.rooms[rid]) state.rooms[rid].unread = 0; if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'read', roomId: rid })); }

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
  if (rid.startsWith('group:')) { const g = state.groups.find((x) => 'group:' + x.id === rid); if (g && g.owner === state.me.username) act.appendChild(mk('مدیریت گروه', 'settings', () => toast('مدیریت گروه'))); }
  act.appendChild(mk('مشاهده پروفایل', 'user', () => openProfile(rid)));
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
const EMOJI = ['😀','😂','🥰','😎','🤔','😢','😡','👍','👎','❤️','🔥','🎉','💯','✅','👏','🙏','😅','😴','🤩','😇','💔','⚡','🌟','🍕','☕','🌹','👀','🚀','💡','🤝','😉','🥳','😭','👌','💪','🤖','🌈','🍻','🎯','💎','📌','✨','⭐','😍','🤗','😜','🙄','😱','🤯'];
function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 660; g.gain.value = 0.04; o.start(); o.stop(c.currentTime + 0.12); } catch (e) {} }
function logout() { localStorage.removeItem('ft_token'); location.reload(); }
$('auth-logout').onclick = logout;

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
  const draw = (list) => {
    list = (list || []).filter((u) => u.username !== state.me.username);
    if (!list.length) { wrap.innerHTML = '<div class="contact-empty">هنوز مخاطبی ثبت نشده است. از دکمه + یک چت جدید شروع کن.</div>'; return; }
    let h = '<div class="contact-list">';
    list.forEach((u) => {
      const online = state.me.isAdmin ? !!u.online : false;
      h += '<div class="contact-item" data-u="' + esc(u.username) + '">' + avatarEl(u, 'md').outerHTML + '<div class="ci-body"><div class="ci-name">' + esc(u.displayName || u.username) + (online ? ' <span style="font-size:10px;color:var(--success)">●</span>' : '') + '</div><div class="ci-sub">@' + esc(u.username) + '</div></div><button class="btn sm" data-act="chat">چت</button><button class="btn sm ghost" data-act="profile">پروفایل</button>' + (state.me.isAdmin ? '<button class="btn sm danger" data-act="ban">' + ((u.banned) ? 'رفع مسدودی' : 'مسدود') + '</button>' : '') + '</div>';
    });
    h += '</div>';
    wrap.innerHTML = h;
    wrap.querySelectorAll('.contact-item').forEach((it) => {
      const u = it.dataset.u; const cur = (state.users || []).find((x) => x.username === u) || { banned: false };
      it.querySelector('[data-act="chat"]').onclick = () => openDM(u);
      it.querySelector('[data-act="profile"]').onclick = () => openProfile(u);
      const ban = it.querySelector('[data-act="ban"]'); if (ban) ban.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u, banned: !cur.banned }) }); toast('انجام شد'); renderView('contacts'); };
    });
    luc();
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
  let u = (state.users || []).find((x) => x.username === username);
  if (!u && state.me.username === username) u = state.me;
  if (!u) { api('/api/admin/users').then((r) => r.json()).then((d) => { if (d.users) { state.users = d.users; renderProfile(username); } }); return; }
  setMode('view');
  const online = !!u.online;
  const badge = (u.isPremium ? ' <span class="badge prem">پرمیوم</span>' : '') + (u.isAdmin ? ' <span class="badge adm">ادمین</span>' : '') + (u.banned ? ' <span class="badge ban">مسدود</span>' : '');
  let h = '<div class="profile-view">';
  h += '<button class="btn sm ghost" data-act="back">← بازگشت</button>';
  h += '<div class="profile-hero">' + avatarEl(u, 'xl').outerHTML + '<div class="profile-name">' + esc(u.displayName || u.username) + badge + '</div><div class="profile-uname">@' + esc(u.username) + (online ? ' <span class="onl">● آنلاین</span>' : '') + '</div>';
  if (u.bio) h += '<div class="profile-bio">' + esc(u.bio) + '</div>';
  if (u.phone && (state.me.isAdmin || u.username === state.me.username)) h += '<div class="profile-row">📱 ' + esc(u.phone) + '</div>';
  h += '</div><div class="profile-actions">';
  h += '<button class="btn primary" data-act="chat">شروع چت</button>';
  if (state.me.isAdmin && !u.isAdmin) {
    h += '<button class="btn" data-act="rename">تغییر نام</button>';
    h += '<button class="btn" data-act="premium">' + (u.isPremium ? 'حذف پرمیوم' : 'پرمیوم‌سازی') + '</button>';
    h += '<button class="btn danger" data-act="ban">' + (u.banned ? 'رفع مسدودی' : 'مسدودسازی') + '</button>';
  }
  h += '</div></div>';
  viewHost.innerHTML = h;
  viewHost.querySelector('[data-act="back"]').onclick = () => renderView('contacts');
  viewHost.querySelector('[data-act="chat"]').onclick = () => openDM(username);
  const rn = viewHost.querySelector('[data-act="rename"]'); if (rn) rn.onclick = () => renameUser(username, u.displayName, () => renderProfile(username));
  const pr = viewHost.querySelector('[data-act="premium"]'); if (pr) pr.onclick = async () => { await api('/api/admin/premium', { method: 'POST', body: JSON.stringify({ username, isPremium: !u.isPremium }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  const bn = viewHost.querySelector('[data-act="ban"]'); if (bn) bn.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username, banned: !u.banned }) }); toast('انجام شد'); const d = await (await api('/api/admin/users')).json(); if (d.users) { state.users = d.users; renderProfile(username); } };
  luc();
}
async function startGroup(isChannel) { const name = prompt('نام ' + (isChannel ? 'کانال' : 'گروه') + ':'); if (!name) return; const d = await (await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: name, type: isChannel ? 'channel' : 'group' }) })).json(); state.groups.push(d.group); if (state.ws) state.ws.send(JSON.stringify({ type: 'groups', groups: state.groups })); openRoom('group:' + d.group.id); }

/* THEME */
function cycleTheme() { const themes = ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light']; const cur = localStorage.getItem('vx_theme') || 'cyber'; const idx = (themes.indexOf(cur) + 1) % themes.length; localStorage.setItem('vx_theme', themes[idx]); applyAppearance(); toast('تم: ' + themes[idx]); }
function applyVX() { $('app').classList.add('vx'); document.documentElement.style.setProperty('--radius', localStorage.getItem('vx_radius') || '18px'); }

/* FONT SIZE (settings) */
function setFont(delta) { state.fontScale = Math.max(12, Math.min(20, state.fontScale + delta)); localStorage.setItem('vx_fontsize', state.fontScale); applyAppearance(); }

/* AI PANEL */
async function aiOnMessage(roomId) { const inp = $('ai-input'); const text = inp.value.trim(); if (!text) return; inp.value = ''; appendAIMsg('user', text); const loading = appendAIMsg('bot', 'در حال فکر کردن…'); try { const d = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'ask', roomId: roomId, text: text }) })).json(); loading.textContent = d.reply || d.error || 'پاسخی دریافت نشد'; } catch (e) { loading.textContent = 'خطا: ' + e.message; } }
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
    wrap.querySelectorAll('.ai-actions button').forEach((b) => b.onclick = async () => { const a = b.dataset.a; if (a === 'summarize' && !state.room) return toast('اول یک چت باز کن'); if (a === 'reply' && !state.room) return toast('اول یک چت باز کن'); const act = a === 'summarize' ? 'summarize' : a === 'reply' ? 'reply' : a === 'translate' ? 'translate' : 'rewrite'; const d = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: act, roomId: state.room, text: $('ai-input').value }) })).json(); appendAIMsg('bot', d.reply || d.error || ''); });
  } else if (id === 'contacts') { renderContacts(wrap); }
  else if (id === 'settings') {
    wrap.innerHTML = settingsHTML();
    wrap.querySelectorAll('[data-theme-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_theme', b.dataset.themeBtn); applyAppearance(); });
    wrap.querySelectorAll('[data-accent-btn]').forEach((b) => b.onclick = () => { localStorage.setItem('vx_accent', b.dataset.accentBtn); applyAppearance(); });
    $('set-font-dec').onclick = () => setFont(-1); $('set-font-inc').onclick = () => setFont(1);
    $('set-radius').oninput = (e) => { localStorage.setItem('vx_radius', e.target.value + 'px'); applyVX(); };
    const bg = $('set-bg'); if (bg) bg.oninput = (e) => { localStorage.setItem('vx_bg', e.target.value); applyBackground(); };
    const bgi = $('set-bgimg'); if (bgi) bgi.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { localStorage.setItem('vx_bgimg', rd.result); applyBackground(); toast('تصویر پس‌زمینه تنظیم شد'); }; rd.readAsDataURL(f); };
    const bgr = $('set-bg-reset'); if (bgr) bgr.onclick = () => { localStorage.removeItem('vx_bgimg'); applyBackground(); toast('تصویر حذف شد'); };
    ['vx_online', 'vx_lastseen', 'vx_showphone', 'vx_acceptall'].forEach((k) => { const el = $('priv-' + k); if (el) el.onchange = (e) => { localStorage.setItem(k, e.target.checked ? '1' : '0'); toast('تنظیمات حریم خصوصی ذخیره شد'); }; });
    const nb = $('set-notif'); if (nb) nb.onclick = async () => { if (!('Notification' in window)) { toast('مرورگر پشتیبانی نمی‌کند'); return; } const p = await Notification.requestPermission(); localStorage.setItem('vx_notify', p === 'granted' ? '1' : '0'); nb.textContent = p === 'granted' ? 'روشن' : 'خاموش'; toast(p === 'granted' ? 'اعلان روشن شد' : 'اعلان خاموش شد'); };
    if (state.me.isAdmin) { const adm = document.createElement('div'); adm.className = 'settings-sec'; adm.innerHTML = '<h3>' + ic('shield') + ' پنل ادمین</h3><div class="admin-tools"></div>'; wrap.appendChild(adm); const at = adm.querySelector('.admin-tools');
      const users = state.users; users.forEach((u) => { const r = document.createElement('div'); r.className = 'admin-user'; r.innerHTML = avatarEl(u, 'xs').outerHTML + '<span>' + esc(u.displayName || u.username) + ' @' + esc(u.username) + '</span>' + (u.banned ? '<span class="ban-tag">مسدود</span>' : ''); const ban = document.createElement('button'); ban.textContent = u.banned ? 'رفع مسدودی' : 'مسدود'; ban.onclick = async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u.username, banned: !u.banned }) }); u.banned = !u.banned; renderView('settings'); toast('انجام شد'); }; r.appendChild(ban); at.appendChild(r); }); }
  } else if (id === 'communities') { wrap.innerHTML = groupsHTML('group'); }
  else if (id === 'channels') { wrap.innerHTML = groupsHTML('channel'); }
  else if (id === 'cloud') { wrap.innerHTML = '<div class="placeholder">☁️ حافظه ابری — فایل‌های شما اینجا نمایش داده می‌شوند. (نمونه)</div>'; }
  else if (id === 'tasks') { renderTasks(wrap); }
  else if (id === 'calendar') { renderCalendar(wrap); }
  else if (id === 'bookmarks') { wrap.innerHTML = '<div class="placeholder">🔖 پیام‌های نشان‌شده اینجا نمایش داده می‌شوند. (نمونه)</div>'; }
  else if (id === 'users') { if (state.me.isAdmin) renderUsers(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
  else if (id === 'signups') { if (state.me.isAdmin) renderSignups(wrap); else wrap.innerHTML = '<div class="placeholder">این بخش فقط برای ادمین در دسترس است.</div>'; }
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
function applyBackground() { document.documentElement.style.setProperty('--chat-bg', localStorage.getItem('vx_bg') || ''); if (localStorage.getItem('vx_bgimg')) document.documentElement.style.setProperty('--chat-bg-img', "url('" + localStorage.getItem('vx_bgimg') + "')"); else document.documentElement.style.setProperty('--chat-bg-img', 'none'); }
function settingsHTML() {
  const accents = ['blue', 'purple', 'cyan', 'green', 'pink', 'orange', 'red']; const themes = ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light'];
  let t = '<div class="settings-sec"><h3>' + ic('palette') + ' ظاهر</h3><div class="settings-row"><span>تم</span><div class="chip-row">' + themes.map((x) => '<button class="chip" data-theme-btn="' + x + '">' + x + '</button>').join('') + '</div></div>';
  t += '<div class="settings-row"><span>رنگ</span><div class="chip-row">' + accents.map((x) => '<button class="chip" data-accent-btn="' + x + '">' + x + '</button>').join('') + '</div></div>';
  t += '<div class="settings-row"><span>اندازه فونت</span><div class="stepper"><button id="set-font-dec">−</button><span>' + (state.fontScale) + '</span><button id="set-font-inc">+</button></div></div>';
  t += '<div class="settings-row"><span>گردی گوشه‌ها</span><input type="range" id="set-radius" min="6" max="28" value="' + (parseInt(localStorage.getItem('vx_radius') || '18', 10)) + '"></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('image') + ' پس‌زمینه چت</h3><div class="settings-row"><span>رنگ پس‌زمینه</span><input type="color" id="set-bg" value="' + (localStorage.getItem('vx_bg') || '#0a0a14') + '"></div>';
  t += '<div class="settings-row"><span>تصویر پس‌زمینه</span><input type="file" id="set-bgimg" accept="image/*"></div>';
  t += '<div class="settings-row"><button class="btn sm ghost" id="set-bg-reset">حذف تصویر</button></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('user') + ' حساب</h3>';
  t += '<div class="settings-row"><span>نام نمایشی</span><b>' + esc(state.me.displayName) + '</b><button class="btn sm" onclick="promptRename()">تغییر</button></div>';
  t += '<div class="settings-row"><span>نام کاربری</span><b>@' + esc(state.me.username) + '</b></div>';
  t += '<div class="settings-row"><span>شماره</span><b>' + esc(state.me.phone || '—') + '</b></div>';
  t += '<div class="settings-row"><span>وضعیت</span><b>' + (state.me.isPremium ? 'پریمیوم' : 'رایگان') + (state.me.isAdmin ? ' • ادمین' : '') + '</b></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('bell') + ' اعلان‌ها</h3><div class="settings-row"><span>اعلان مرورگر</span><button class="btn sm" id="set-notif">' + ((localStorage.getItem('vx_notify') === '1') ? 'روشن' : 'خاموش') + '</button></div></div>';
  t += '<div class="settings-sec"><h3>' + ic('lock') + ' حریم خصوصی</h3>';
  const ptoggle = (key, label) => '<div class="settings-row"><span>' + label + '</span><label class="switch"><input type="checkbox" id="priv-' + key + '" type="checkbox" ' + (localStorage.getItem(key) !== '0' ? 'checked' : '') + '><span class="slider"></span></label></div>';
  t += ptoggle('vx_online', 'نمایش وضعیت آنلاین');
  t += ptoggle('vx_lastseen', 'نمایش آخرین بازدید');
  t += ptoggle('vx_showphone', 'نمایش شماره به دیگران');
  t += ptoggle('vx_acceptall', 'پذیرش پیام از همه');
  t += '</div>';
  t += '<div class="settings-sec"><h3>' + ic('log-out') + ' خروج</h3><button class="btn danger" onclick="logout()">' + ic('log-out') + ' خروج از حساب</button></div>';
  return t;
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
    catch (e) { $('auth-screen').classList.remove('hidden'); }
  } else { $('auth-screen').classList.remove('hidden'); }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
