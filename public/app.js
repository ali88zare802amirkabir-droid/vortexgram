const $ = (id) => document.getElementById(id);

window.onerror = (msg, src, line) => {
  let t = $('err-overlay');
  if (!t) { t = document.createElement('div'); t.id = 'err-overlay'; document.body.appendChild(t); }
  t.textContent = '⚠ ' + msg + ' (@line ' + line + ')';
  clearTimeout(t._h);
  t._h = setTimeout(() => t.remove(), 8000);
};

const state = {
  token: localStorage.getItem('ft_token') || null,
  me: null,
  room: null,
  roomTitle: '',
  users: [],
  groups: [],
  ws: null,
  typingTimer: null,
  typingHide: null,
  lastDay: null,
  call: null,
  chatState: {},
  readState: {},
  pinned: {},
  showArchive: false,
  peerStatus: '',
  rec: null,
  outbox: [],
};

function chatFlags(roomId) { return state.chatState[roomId] || {}; }

// ===== SVG icon system (no emoji) =====
const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  attach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  smiley: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  sticker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 2h6l-1 7 3 3v2H7v-2l3-3z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  outbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 8 12 10 15 14 15 16 12 22 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  checkDouble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 7 9 16 5 12"/><polyline points="22 7 13 16 12.5 15.5"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20l-2-9-5 4-3-7-3 7-5-4z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  channel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l15-7v16l-15-7z" transform="translate(3 0)"/><path d="M3 11l15-7v16l-15-7z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  forward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
};
function svg(name) { return `<span class="icon">${ICONS[name] || ''}</span>`; }
function applyIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const n = el.getAttribute('data-icon');
    if (ICONS[n]) el.innerHTML = '<span class="icon">' + ICONS[n] + '</span>';
  });
}

function peerReadTime(roomId) {
  const readers = state.readState[roomId] || {};
  let t = 0;
  for (const [u, time] of Object.entries(readers)) if (u !== state.me.username && time > t) t = time;
  return t;
}
async function setChatState(roomId, patch) {
  state.chatState[roomId] = { ...chatFlags(roomId), ...patch };
  renderGroups(); renderUsers();
  try {
    await api('/api/chats/state', { method: 'POST', body: JSON.stringify({ roomId, ...patch }) });
  } catch (e) {}
}
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 30) return 'همین الان';
  if (s < 60) return `${s} ثانیه پیش`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ساعت پیش`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} روز پیش`;
  return new Date(ts).toLocaleDateString('fa-IR');
}

const BOT_USERNAME = 'vortex_bot';
const BOT_NAME = 'Vortex AI';

const EMOJI = {
  'چهره‌ها': ['😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😴','😭','😡','🥳','😱','🤡','💀','👀','🙏','👍','👎','👏','💪','🤝','✌️'],
  'قلب‌ها': ['❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💕','💞','💓','💗','💖','💘','💝'],
  'گیمینگ': ['🎮','🕹️','👾','🎲','🎯','🏆','🥇','⚔️','🛡️','🚀','💥','⚡','🔥','💎','👑','🃏'],
};

const STICKERS = {
  'پک خنده': ['😂','🤣','😆','😅','😹','🤪','😜','🫠'],
  'پک عاشقی': ['😍','🥰','😘','😻','💖','💘','💝','💐'],
  'پک گیمر': ['🎮','👾','🏆','⚔️','🥷','🤖','🛸','🐉'],
  'پک واکنشی': ['😱','😭','😡','🤯','🥶','🔥','💀','👻'],
};

/* ================= AUTH ================= */
let authMode = 'login';
$('tab-login').onclick = () => setAuthMode('login');
$('tab-register').onclick = () => setAuthMode('register');

function setAuthMode(m) {
  authMode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'ورود به آرنا' : 'ساخت حساب';
}

$('auth-submit').onclick = async () => {
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  $('auth-error').textContent = '';
  try {
    const r = await fetch(`/api/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطا');
    if (authMode === 'register' && data.pending) {
      $('auth-error').style.color = '#34d399';
      $('auth-error').textContent = data.message;
      setAuthMode('login');
      return;
    }
    $('auth-error').style.color = '';
    state.token = data.token;
    state.me = data.me;
    localStorage.setItem('ft_token', data.token);
    enterApp();
  } catch (e) {
    $('auth-error').textContent = e.message;
  }
};
$('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-submit').click(); });

async function tryResume() {
  if (!state.token) return false;
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + state.token } });
    if (!r.ok) throw 0;
    const data = await r.json();
    state.me = data.me;
    return true;
  } catch {
    state.token = null;
    localStorage.removeItem('ft_token');
    return false;
  }
}

function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  applyIcons();
  $('admin-btn').classList.toggle('hidden', !state.me.isAdmin);
  applyTierLimits();
  renderMyAvatar();
  connectWS();
}

function applyTierLimits() {
  const maxLen = (state.me.isPremium || state.me.isAdmin) ? 4000 : 700;
  $('msg-input').maxLength = maxLen;
}

function logout() {
  localStorage.removeItem('ft_token');
  location.reload();
}

/* ================= WEBSOCKET ================= */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onopen = () => { state.ws.send(JSON.stringify({ type: 'auth', token: state.token })); flushOutbox(); };

  state.ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    switch (d.type) {
      case 'ready':
        if (d.groups) { state.groups = d.groups; renderGroups(); }
        if (d.chatState) state.chatState = d.chatState;
        if (d.readState) state.readState = d.readState;
        if (d.pinned) state.pinned = d.pinned;
        updateArchiveCount();
        break;
      case 'users': state.users = d.users; renderUsers(); showEmptyHint(); break;
      case 'groups': state.groups = d.groups; renderGroups(); updateComposerLock(); break;
      case 'room-read':
        if (!state.readState[d.roomId]) state.readState[d.roomId] = {};
        state.readState[d.roomId][d.username] = d.time;
        if (state.room === d.roomId) updateTicks();
        break;
      case 'added-to':
        alert(`شما به ${d.type2 === 'channel' ? 'کانال' : 'گروه'} «${d.name}» اضافه شدید`);
        break;
      case 'message-edited': {
        const el = document.querySelector(`[data-id="${d.id}"] .msg-body`);
        if (el) { el.textContent = d.content; el.parentElement.querySelector('.edited-tag')?.remove(); const t = document.createElement('span'); t.className = 'edited-tag'; t.textContent = '(ویرایش شد)'; el.parentElement.appendChild(t); }
        break;
      }
      case 'message-deleted': document.querySelector(`[data-id="${d.id}"]`)?.remove(); break;
      case 'call-offer':
        if (state.call) { state.ws.send(JSON.stringify({ type: 'call-end', to: d.from })); break; }
        state.call = { peer: d.from, fromName: d.fromName, offer: d.sdp };
        $('incoming-name').textContent = d.fromName || d.from;
        $('incoming-modal').classList.remove('hidden');
        break;
      case 'call-answer':
        if (state.call?.pc && d.sdp) {
          state.call.pc.setRemoteDescription(new RTCSessionDescription(d.sdp)).catch(() => {});
        }
        break;
      case 'call-ice':
        if (state.call?.pc && d.candidate) {
          state.call.pc.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(() => {});
        }
        break;
      case 'call-end':
        cleanupCall();
        if (!$('incoming-modal').classList.contains('hidden')) $('incoming-modal').classList.add('hidden');
        break;
      case 'history':
        if (state.historyReqs && state.historyReqs[d.roomId]) {
          const _res = state.historyReqs[d.roomId]; delete state.historyReqs[d.roomId]; _res(d.messages);
        }
        if (d.roomId !== state.room) break;
        $('messages').innerHTML = '';
        state.lastDay = null;
        d.messages.forEach(addMessage);
        scrollBottom();
        renderPinBar();
        break;
      case 'message':
      addMessage(d.message);
      if (d.message && d.message.roomId === state.room) markRead(state.room);
      if (d.message && d.message.from !== state.me.username && localStorage.getItem('vx_sound') === '1') beep();
      break;
      case 'message-updated': updateMessage(d); break;
      case 'pinned-updated':
        state.pinned[d.roomId] = d.ids;
        renderPinBar();
        break;
      case 'typing': showTyping(d); break;
      case 'ai-thinking': break;
      case 'ai-suggestion': showAiSuggestion(d); break;
      case 'rename-result':
        if (d.approved && state.me) { state.me.displayName = d.displayName; renderMyAvatar(); }
        alert(d.approved ? 'درخواست تغییر نام تایید شد' : 'درخواست تغییر نام رد شد');
        break;
      case 'premium-changed':
        if (state.me) {
          state.me.isPremium = d.isPremium;
          renderMyAvatar();
          applyTierLimits();
          alert(d.isPremium ? 'حساب شما پرمیوم شد' : 'عضویت پرمیوم شما لغو شد');
        }
        break;
      case 'kicked': alert('حساب شما توسط ادمین مسدود شد'); logout(); break;
      case 'signup-request':
        alert(`📨 درخواست ثبت‌نام جدید: @${d.username}`);
        if (!$('admin-modal').classList.contains('hidden')) loadAdmin();
        break;
      case 'error': alert(d.text); break;
      case 'auth-failed': logout(); break;
    }
  };

  state.ws.onclose = () => setTimeout(() => { if (state.token) connectWS(); }, 2500);
}

/* ================= ROOMS & USERS ================= */
function dmRoom(u) { return 'dm:' + [state.me.username, u.username].sort().join('|'); }

function contactsKey() { return 'vx_contacts_' + state.me.username; }
function getContacts() {
  try { return JSON.parse(localStorage.getItem(contactsKey()) || '{}'); } catch { return {}; }
}
function saveContacts(c) { localStorage.setItem(contactsKey(), JSON.stringify(c)); }

function contactLi(username, displayName) {
  const roomId = dmRoom({ username });
  const li = document.createElement('li');
  li.dataset.roomId = roomId;
   li.innerHTML = `${chatFlags(roomId).pinned ? '<span class="pin">' + svg('pin') + '</span>' : ''}<span class="presence"></span>
    <span class="avatar sm" data-av>${esc(initial(displayName))}</span>
    <span class="grow">${esc(displayName)} <small>@${esc(username)}</small></span>`;
  li.onclick = () => openUserProfile(username);
  li.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, roomId); };
  return li;
}

function renderUsers() {
  const ul = $('user-list');
  ul.innerHTML = '';

  const botRoom = 'dm:' + [state.me.username, BOT_USERNAME].sort().join('|');
  const items = [{ username: BOT_USERNAME, displayName: BOT_NAME, isPremium: false, online: true, roomId: botRoom }];

  if (state.me.isAdmin) {
    state.users.filter((u) => u.username !== state.me.username).forEach((u) => {
      items.push({ username: u.username, displayName: u.displayName, isPremium: u.isPremium, online: u.online && !u.banned, roomId: dmRoom(u) });
    });
  } else {
    const contacts = getContacts();
    Object.entries(contacts).forEach(([username, displayName]) => {
      items.push({ username, displayName, isPremium: false, online: false, roomId: dmRoom({ username }) });
    });
  }

  items
    .filter((it) => !!chatFlags(it.roomId).archived === state.showArchive)
    .sort((a, b) => (chatFlags(b.roomId).pinned ? 1 : 0) - (chatFlags(a.roomId).pinned ? 1 : 0))
    .forEach((it) => {
      const li = document.createElement('li');
      li.dataset.roomId = it.roomId;
      li.innerHTML = `${chatFlags(it.roomId).pinned ? '<span class="pin">' + svg('pin') + '</span>' : ''}<span class="presence ${it.online ? 'on' : ''}"></span>
        <span class="avatar sm" data-av>${esc(initial(it.displayName))}</span>
        <span class="grow">${esc(it.displayName)}${it.isPremium ? premiumBadge() : ''} <small>@${esc(it.username)}${it.online ? '' : ''}</small></span>
        ${it.username === BOT_USERNAME ? '<span class="badge-admin">AI</span>' : ''}
        ${it.username !== BOT_USERNAME && state.me.isAdmin && it.online === false ? '<small>آفلاین</small>' : ''}`;
      if (it.avatar) setAvatar(li.querySelector('[data-av]'), { avatar: it.avatar, isPremium: it.isPremium });
      li.onclick = () => openUserProfile(it.username);
      li.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, it.roomId); };
      ul.appendChild(li);
    });

  if (!ul.children.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = state.showArchive ? 'چت بایگانی‌شده‌ای نیست' : (state.me.isAdmin ? 'کاربری آنلاین نیست' : 'مخاطبی نداری — با @آیدی اضافه کن');
    ul.appendChild(li);
  }
}

$('contact-add-btn').onclick = async () => {
  let uname = $('contact-input').value.trim().replace(/^@/, '');
  $('contact-input').value = '';
  if (!uname) return;
  if (uname === state.me.username) { alert('خودت هستی!'); return; }
  try {
    const r = await api('/api/users/exists/' + encodeURIComponent(uname));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    const c = getContacts();
    c[data.username] = data.displayName;
    saveContacts(c);
    renderUsers();
  } catch (e) { alert(e.message); }
};
$('contact-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('contact-add-btn').click(); });

/* ---- mobile sidebar toggle ---- */
function closeSidebar() {
  $('sidebar').classList.remove('open');
  const bd = $('sb-backdrop'); if (bd) bd.classList.add('hidden');
}
$('menu-btn').onclick = () => {
  const open = $('sidebar').classList.toggle('open');
  const bd = $('sb-backdrop'); if (bd) bd.classList.toggle('hidden', !open);
};
$('sb-backdrop') && ($('sb-backdrop').onclick = closeSidebar);
document.addEventListener('click', (e) => {
  const sb = $('sidebar');
  if (sb.classList.contains('open') && !sb.contains(e.target) && e.target.id !== 'menu-btn' && !$('menu-btn').contains(e.target)) {
    closeSidebar();
  }
});
$('reply-cancel').onclick = clearReply;

/* ---- theme (appearance) ---- */
function applyTheme(t) {
  if (t && t !== 'midnight') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('.theme-opt').forEach((b) => b.classList.toggle('active', b.dataset.theme === (t || 'midnight')));
}
applyTheme(localStorage.getItem('vx_theme') || 'midnight');
document.querySelectorAll('.theme-opt').forEach((b) => {
  b.onclick = () => { const t = b.dataset.theme; localStorage.setItem('vx_theme', t); applyTheme(t); };
});

/* ---- notification sound ---- */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 680; g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { try { o.stop(); ctx.close(); } catch (e) {} }, 130);
  } catch (e) {}
}
const soundToggle = $('sound-toggle');
if (soundToggle) {
  soundToggle.checked = localStorage.getItem('vx_sound') === '1';
  soundToggle.onchange = (e) => localStorage.setItem('vx_sound', e.target.checked ? '1' : '0');
}

/* ---- in-chat search ---- */
function doSearch(q) {
  q = (q || '').trim().toLowerCase();
  const msgs = document.querySelectorAll('#messages .msg');
  let hits = 0;
  msgs.forEach((el) => {
    const text = (el.textContent || '').toLowerCase();
    if (!q) { el.classList.remove('hit', 'dim-search'); return; }
    if (text.includes(q)) { el.classList.add('hit'); el.classList.remove('dim-search'); hits++; }
    else { el.classList.add('dim-search'); el.classList.remove('hit'); }
  });
  const sc = $('search-count');
  if (sc) sc.textContent = q ? (hits + ' مورد') : '';
}
const searchBtn = $('search-btn');
if (searchBtn) {
  searchBtn.onclick = () => {
    const bar = $('search-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) $('search-input').focus();
  };
}
const searchClose = $('search-close');
if (searchClose) searchClose.onclick = () => { $('search-bar').classList.add('hidden'); $('search-input').value = ''; doSearch(''); };
const searchInput = $('search-input');
if (searchInput) searchInput.oninput = (e) => doSearch(e.target.value);

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function renderMyAvatar() {
  setAvatar($('my-avatar'), state.me);
}

/* avatar helper: img if exists else letter */
function setAvatar(el, user, size) {
  if (!el) return;
  el.classList.toggle('has-img', !!user?.avatar);
  el.classList.toggle('premium', !!user?.isPremium);
  el.innerHTML = user?.avatar
    ? `<img src="${esc(user.avatar)}" alt="" />`
    : esc(initial(user?.displayName || user?.username || '?'));
}

function premiumBadge() { return ' <span class="badge-premium">PREMIUM</span>'; }

function msgPreview(m) {
  if (m.kind === 'text') return m.content;
  if (m.kind === 'sticker') return '[استیکر]';
  if (m.kind === 'image' || m.kind === 'gif') return '[عکس]';
  if (m.kind === 'video') return '[ویدیو]';
  if (m.kind === 'audio') return '[صدا]';
  return '[فایل]';
}

function setReplyTo(m) {
  state.replyTo = { id: m.id, name: m.fromName || m.from, snippet: String(msgPreview(m)).slice(0, 120) };
  $('reply-preview').innerHTML = `<b>پاسخ به ${esc(state.replyTo.name)}</b> — ${esc(state.replyTo.snippet)}`;
  $('reply-bar').classList.remove('hidden');
  if (!$('msg-input').disabled) $('msg-input').focus();
}

function clearReply() {
  state.replyTo = null;
  $('reply-bar').classList.add('hidden');
}

function openRoom(roomId, title) {
  if (state.room && state.room !== roomId) saveDraft();
  state.room = roomId;
  if (window.matchMedia('(max-width: 760px)').matches) closeSidebar();
  state.roomTitle = title;
  $('chat-title').textContent = title;
  $('messages').innerHTML = '';
  $('empty-hint')?.remove();
  state.lastDay = null;
  clearReply();
  const isSaved = roomId.startsWith('saved:');
  document.querySelector('.composer').style.display = '';
  $('call-btn').classList.toggle('hidden', !(roomId.startsWith('dm:') && !roomId.includes(BOT_USERNAME)));
  const g = currentGroup();
  $('group-settings-btn').classList.toggle('hidden', !(g && g.joined));
  $('ai-summary-btn').classList.toggle('hidden', isSaved);
  const ca = $('chat-avatar');
  if (!isSaved && roomId.startsWith('dm:') && !roomId.includes(BOT_USERNAME)) {
    const peer = roomId.slice(3).split('|').find((p) => p !== state.me.username);
    const pu = state.users.find((x) => x.username === peer);
    setAvatar(ca, { avatar: pu && pu.avatar, isPremium: pu && pu.isPremium });
    ca.classList.remove('hidden');
    ca.onclick = () => openUserProfile(peer);
    const ct = $('chat-title');
    if (ct) ct.style.cursor = 'pointer', ct.onclick = () => openUserProfile(peer);
  } else {
    ca.classList.add('hidden');
  }
  updateComposerLock();
  if (isSaved) {
    renderSaved();
    state.peerStatus = '';
    refreshTitle();
    return;
  }
  state.ws.send(JSON.stringify({ type: 'history', roomId }));
  // علامت‌گذاری به‌عنوان خوانده‌شده + وضعیت طرف مقابل
  markRead(roomId);
  const isDmHuman = roomId.startsWith('dm:') && !roomId.includes(BOT_USERNAME);
  if (isDmHuman) {
    const peer = roomId.slice(3).split('|').find((p) => p !== state.me.username);
    fetchPeerStatus(peer);
  } else {
    state.peerStatus = '';
    refreshTitle();
  }
  loadDraft(roomId);
  renderPinBar();
}

function markRead(roomId) {
  if (!roomId) return;
  api('/api/chats/read', { method: 'POST', body: JSON.stringify({ roomId }) }).catch(() => {});
}

async function fetchPeerStatus(peer) {
  try {
    const r = await api('/api/users/exists/' + encodeURIComponent(peer));
    const d = await r.json();
    state.peerStatus = d.online ? 'آنلاین' : (d.lastSeen ? 'آخرین بازدید ' + timeAgo(d.lastSeen) : '');
  } catch { state.peerStatus = ''; }
  if (state.room.startsWith('dm:') && state.room.includes(peer)) refreshTitle();
}

function refreshTitle() {
  let t = state.roomTitle;
  if (state.peerStatus && state.room.startsWith('dm:')) t += ' — ' + state.peerStatus;
  $('chat-title').textContent = t;
}

function groupIcon(g) { return g.type === 'channel' ? svg('channel') : svg('people'); }

function currentGroup() {
  if (!state.room || !state.room.startsWith('group:')) return null;
  return state.groups.find((g) => g.id === state.room.slice(6)) || null;
}

function canPostHere() {
  const g = currentGroup();
  if (!g) return true;
  if (g.type !== 'channel') return true;
  return g.myRole === 'owner' || g.myRole === 'admin';
}

function updateComposerLock() {
  const ok = canPostHere();
  $('msg-input').disabled = !ok;
  $('send-btn').disabled = !ok;
  $('msg-input').placeholder = ok ? 'پیام خود را مخابره کن...' : 'در کانال فقط مدیران می‌توانند پیام بفرستند';
}

function renderGroups() {
  const ul = $('group-list');
  ul.innerHTML = '';
  const items = state.groups
    .map((g) => ({ g, roomId: 'group:' + g.id }))
    .filter(({ g, roomId }) => !!chatFlags(roomId).archived === state.showArchive)
    .sort((a, b) => (chatFlags(b.roomId).pinned ? 1 : 0) - (chatFlags(a.roomId).pinned ? 1 : 0));
  items.forEach(({ g, roomId }) => {
    const li = document.createElement('li');
    li.dataset.roomId = roomId;
    li.innerHTML = `${chatFlags(roomId).pinned ? '<span class="pin">' + svg('pin') + '</span>' : ''}<span class="avatar sm" style="border-radius:10px;background:linear-gradient(135deg,#0ea5e9,var(--primary))">${g.type === 'channel' ? svg('channel') : svg('people')}</span>
      <span class="grow">${esc(g.name)} <small>${g.members} عضو</small></span>
      ${g.myRole === 'owner' ? '<span class="badge-admin">OWNER</span>' : ''}
      ${g.myRole === 'admin' ? '<span class="badge-admin" style="background:#0ea5e9">ADMIN</span>' : ''}`;
    li.onclick = () => openRoom(roomId, `${groupIcon(g)} ${g.name}`);
    li.oncontextmenu = (e) => { e.preventDefault(); openChatMenu(e, roomId); };
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = `<li class="empty">${state.showArchive ? 'چت بایگانی‌شده‌ای نیست' : 'گروهی نیست — با + بساز'}</li>`;
}

function updateArchiveCount() {
  let n = 0;
  const all = [...state.groups.map((g) => 'group:' + g.id), ...state.users.map((u) => dmRoom(u)), 'dm:' + [state.me.username, BOT_USERNAME].sort().join('|')];
  const c = getContacts();
  Object.keys(c).forEach((u) => all.push(dmRoom({ username: u })));
  all.forEach((rid) => { if (chatFlags(rid).archived) n++; });
  const el = $('archive-count');
  if (n > 0) { el.textContent = n; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
  const at = $('archive-toggle');
  at.classList.toggle('active', state.showArchive);
  at.querySelector('.ar-label').textContent = state.showArchive ? 'بازگشت به چت‌ها' : 'بایگانی‌ها';
}

$('archive-toggle').onclick = () => {
  state.showArchive = !state.showArchive;
  renderGroups(); renderUsers(); updateArchiveCount();
};

/* منوی راست‌کلیک/لمس طولانی روی چت: سنجاق + بایگانی */
function openChatMenu(e, roomId) {
  closeChatMenu();
  const popup = document.createElement('div');
  popup.id = 'chat-menu';
  popup.className = 'chat-menu';
  const pinned = chatFlags(roomId).pinned;
  const archived = chatFlags(roomId).archived;
  popup.innerHTML = `
    <button data-act="pin">${pinned ? svg('outbox') + ' برداشتن سنجاق' : svg('pin') + ' سنجاق کردن'}</button>
    <button data-act="archive">${archived ? svg('outbox') + ' خارج از بایگانی' : svg('inbox') + ' بایگانی کردن'}</button>
    <button data-act="cancel">لغو</button>`;
  popup.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  popup.style.top = Math.min(e.clientY, window.innerHeight - 130) + 'px';
  document.body.appendChild(popup);
  popup.querySelector('[data-act="pin"]').onclick = async () => { closeChatMenu(); await setChatState(roomId, { pinned: !pinned }); updateArchiveCount(); };
  popup.querySelector('[data-act="archive"]').onclick = async () => { closeChatMenu(); await setChatState(roomId, { archived: !archived }); updateArchiveCount(); };
  popup.querySelector('[data-act="cancel"]').onclick = closeChatMenu;
}
function closeChatMenu() { const p = $('chat-menu'); if (p) p.remove(); }
document.addEventListener('click', (e) => { if ($('chat-menu') && !$('chat-menu').contains(e.target)) closeChatMenu(); });

/* ---- new group/channel modal ---- */
$('new-group-btn').onclick = () => {
  $('ng-name').value = '';
  $('ng-error').textContent = '';
  $('new-group-modal').classList.remove('hidden');
  $('ng-name').focus();
};
$('ng-create').onclick = async () => {
  const name = $('ng-name').value.trim();
  const type = document.querySelector('input[name="ng-type"]:checked').value;
  try {
    const r = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name, type }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    $('new-group-modal').classList.add('hidden');
    if (data.group) openRoom('group:' + data.group.id, `${groupIcon(data.group)} ${data.group.name}`);
  } catch (e) { $('ng-error').textContent = e.message; }
};

/* ---- group settings modal ---- */
let gsData = null;

$('group-settings-btn').onclick = async () => {
  const g = currentGroup();
  if (!g) return;
  $('gsettings-modal').classList.remove('hidden');
  await loadGroupSettings();
};

async function loadGroupSettings() {
  const g = currentGroup();
  if (!g) return;
  try {
    const r = await api(`/api/groups/${g.id}/members`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    gsData = data;
    renderGroupSettings();
  } catch (e) { alert(e.message); }
}

function renderGroupSettings() {
  if (!gsData) return;
  const { group, members } = gsData;
  const g = currentGroup();
  const amOwner = g ? g.myRole === 'owner' : false;

  $('gs-title').textContent = `${group.type === 'channel' ? 'کانال' : 'گروه'} «${group.name}»`;
  $('gs-add-row').classList.toggle('hidden', !amOwner);
  $('gs-delete').classList.toggle('hidden', !amOwner);

  const ul = $('gs-members');
  ul.innerHTML = '';
  members.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="avatar sm">${initial(m.displayName)}</span>
      <span class="grow">${esc(m.displayName)} <small>@${esc(m.username)}</small></span>
      ${m.role === 'owner' ? '<span class="badge-admin">OWNER</span>' : ''}
      ${m.role === 'admin' ? '<span class="badge-admin" style="background:#0ea5e9">ADMIN</span>' : ''}`;
    if (m.role !== 'owner') {
      if (amOwner) {
        const roleBtn = mkBtn(m.role === 'member' ? 'ارتقا به ادمین' : 'عزل از ادمینی', m.role === 'member' ? 'mini-btn ok' : 'mini-btn no',
          async () => {
            await api(`/api/groups/${group.id}/role`, { method: 'POST', body: JSON.stringify({ username: m.username, role: m.role === 'member' ? 'admin' : 'member' }) });
            loadGroupSettings();
          });
        li.appendChild(roleBtn);
        if (!state.me.isAdmin || state.me.username !== m.username) {
          const kickBtn = mkBtn('حذف', 'mini-btn no', async () => {
            await api(`/api/groups/${group.id}/kick`, { method: 'POST', body: JSON.stringify({ username: m.username }) });
            loadGroupSettings();
          });
          li.appendChild(kickBtn);
        }
      }
      if (m.username === state.me.username) {
        const leaveBtn = mkBtn('خروج', 'mini-btn no', async () => {
          if (!confirm('از گروه خارج شوی؟')) return;
          await api(`/api/groups/${group.id}/leave`, { method: 'POST' });
          $('gsettings-modal').classList.add('hidden');
          openRoom('', '');
          state.room = null;
          $('chat-title').textContent = 'یک گفتگو را انتخاب کنید';
        });
        li.appendChild(leaveBtn);
      }
    }
    ul.appendChild(li);
  });
}

$('gs-add-btn').onclick = async () => {
  const g = currentGroup();
  if (!g) return;
  const username = $('gs-add-input').value.trim();
  if (!username) return;
  try {
    const r = await api(`/api/groups/${g.id}/members`, { method: 'POST', body: JSON.stringify({ username }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    $('gs-add-input').value = '';
    loadGroupSettings();
  } catch (e) { alert(e.message); }
};
$('gs-add-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gs-add-btn').click(); });

$('gs-leave').onclick = async () => {
  const g = currentGroup();
  if (!g) return;
  if (g.myRole === 'owner') { alert('مالک نمی‌تواند خارج شود؛ ابتدا گروه را حذف کن'); return; }
  if (!confirm('از این گروه خارج شوی؟')) return;
  await api(`/api/groups/${g.id}/leave`, { method: 'POST' });
  $('gsettings-modal').classList.add('hidden');
  state.room = null;
  $('messages').innerHTML = '';
  $('chat-title').textContent = 'یک گفتگو را انتخاب کنید';
  $('group-settings-btn').classList.add('hidden');
};

$('gs-delete').onclick = async () => {
  const g = currentGroup();
  if (!g) return;
  if (!confirm(`«${g.name}» برای همیشه حذف شود؟`)) return;
  await api(`/api/groups/${g.id}/delete`, { method: 'POST' });
  $('gsettings-modal').classList.add('hidden');
  state.room = null;
  $('messages').innerHTML = '';
  $('chat-title').textContent = 'یک گفتگو را انتخاب کنید';
  $('group-settings-btn').classList.add('hidden');
};

/* ================= MESSAGES ================= */
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function fmtTime(t) { return new Date(t).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); }

// ---------- قالب‌بندی متن (Markdown + Mention + Hashtag + Link + Spoiler) ----------
function formatText(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  s = s.replace(/_([^_]+)_/g, '<i>$1</i>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>');
  s = s.replace(/(^|[\s])(@[a-zA-Z0-9_]{3,20})/g, (m, p, u) => `${p}<span class="mention">${u}</span>`);
  s = s.replace(/(^|[\s])(#[^\s#]{2,30})/g, (m, p, t) => `${p}<span class="hashtag">${t}</span>`);
  return s;
}

function loadLinkPreview(m, div) {
  const urls = (m.content || '').match(/https?:\/\/[^\s<)]+/g);
  if (!urls || !urls.length) return;
  const url = urls[0];
  fetch('/api/link-preview?url=' + encodeURIComponent(url), { headers: { Authorization: 'Bearer ' + state.token } })
    .then((r) => r.json())
    .then((d) => {
      if (!d || d.error) return;
      const card = document.createElement('a');
      card.className = 'link-preview'; card.href = url; card.target = '_blank'; card.rel = 'noopener';
      card.innerHTML = (d.image ? `<img src="${esc(d.image)}" class="lp-img" onerror="this.remove()"/>` : `<span class="lp-ico">${svg('attach')}</span>`)
        + `<span class="lp-body"><small>${esc(d.domain || '')}</small><b>${esc(d.title || d.domain || url)}</b>${d.description ? `<span>${esc(d.description.slice(0, 140))}</span>` : ''}</span>`;
      div.appendChild(card);
    })
    .catch(() => {});
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎮', '🔥', '👏', '✅', '🚀'];

function renderBody(m) {
  if (m.kind === 'text') return `<span class="msg-body">${formatText(m.content)}</span>`;
  if (m.kind === 'sticker') return `<span class="sticker-emoji">${esc(m.content)}</span>`;
  if (m.kind === 'image' || m.kind === 'gif') return `<img class="media" src="${esc(m.url)}" alt="${esc(m.name || '')}" loading="lazy" />`;
  if (m.kind === 'video') return `<video class="media" src="${esc(m.url)}" controls preload="metadata"></video>`;
  if (m.kind === 'audio') return `<audio src="${esc(m.url)}" controls preload="metadata"></audio><a class="file-chip" href="${esc(m.url)}" download="${esc(m.name || 'voice')}">${svg('voice')} دانلود صدا</a>`;
  if (m.kind === 'file') return `<a class="file-chip" href="${esc(m.url)}" download="${esc(m.name || '')}">${svg('attach')} <span>${esc(m.name || 'فایل')}</span> <small>دانلود</small></a>`;
  if (m.kind === 'album') return `<div class="album">${m.album.map((u) => `<img class="media" src="${esc(u)}" loading="lazy" onclick="window.open('${esc(u)}','_blank')" />`).join('')}</div>`;
  if (m.kind === 'poll') return renderPoll(m);
  if (m.kind === 'checklist') return renderChecklist(m);
  return '';
}

function renderPoll(m) {
  const p = m.poll; if (!p) return '';
  const total = Object.keys(p.votes || {}).length;
  const myVote = p.votes ? p.votes[state.me.username] : undefined;
  const items = p.options.map((opt, i) => {
    const cnt = Object.values(p.votes || {}).filter((v) => v === i).length;
    const pct = total ? Math.round((cnt / total) * 100) : 0;
    const voted = myVote === i;
    const correctMark = p.quiz && p.correct === i && myVote !== undefined ? ' ✓' : '';
    return `<button class="poll-opt ${voted ? 'voted' : ''}" data-opt="${i}">
      <span class="poll-bar" style="width:${pct}%"></span>
      <span class="poll-label">${esc(opt)}${correctMark}</span>
      <span class="poll-cnt">${cnt}</span>
    </button>`;
  }).join('');
  return `<div class="poll" data-poll="${m.id}"><div class="poll-q">${svg('chat')} ${esc(p.question)}</div>${items}<div class="poll-foot">${total} رأی${p.quiz ? ' • مسابقه' : ''}</div></div>`;
}

function renderChecklist(m) {
  const c = m.checklist; if (!c) return '';
  const items = c.items.map((it, i) => `<label class="chk-item ${it.done ? 'done' : ''}"><input type="checkbox" data-chk="${i}" ${it.done ? 'checked' : ''}/> <span>${esc(it.text)}</span></label>`).join('');
  const done = c.items.filter((i) => i.done).length;
  return `<div class="checklist" data-chk-msg="${m.id}"><div class="chk-title">${svg('check')} ${esc(c.title)} (${done}/${c.items.length})</div>${items}</div>`;
}

function renderReactions(m) {
  if (!m.reactions || !Object.keys(m.reactions).length) return '';
  const chips = Object.entries(m.reactions).map(([e, users]) => `<button class="react-chip ${users.includes(state.me.username) ? 'mine' : ''}" data-emoji="${e}">${e}<small>${users.length}</small></button>`).join('');
  return `<div class="reactions">${chips}</div>`;
}

function openReactionPicker(m, btn) {
  closeReactionPicker();
  const pop = document.createElement('div');
  pop.id = 'react-pop';
  pop.className = 'react-pop';
  pop.innerHTML = REACTION_EMOJIS.map((e) => `<button data-emoji="${e}">${e}</button>`).join('');
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  document.body.appendChild(pop);
  pop.querySelectorAll('button').forEach((b) => {
    b.onclick = async () => {
      closeReactionPicker();
      await api('/api/reactions', { method: 'POST', body: JSON.stringify({ roomId: m.roomId, msgId: m.id, emoji: b.dataset.emoji }) });
    };
  });
}
function closeReactionPicker() { const p = $('react-pop'); if (p) p.remove(); }

function updateMessage(d) {
  if (d.roomId !== state.room) return;
  const el = document.querySelector(`#messages .msg[data-id="${d.id}"]`);
  if (!el) return;
  if (d.reactions !== undefined) {
    let r = el.querySelector('.reactions');
    if (!r) { r = document.createElement('div'); r.className = 'reactions'; el.appendChild(r); }
    r.outerHTML = renderReactions({ reactions: d.reactions });
  }
  if (d.poll !== undefined) { const p = el.querySelector('.poll'); if (p) p.outerHTML = renderPoll({ id: d.id, poll: d.poll }); }
  if (d.checklist !== undefined) { const c = el.querySelector('.checklist'); if (c) c.outerHTML = renderChecklist({ id: d.id, checklist: d.checklist }); }
}

function renderPinBar() {
  const bar = $('pin-bar');
  if (!bar) return;
  const ids = state.pinned[state.room] || [];
  if (!ids.length || !state.room) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="pin-ico">${svg('pin')}</span>` + ids.map((id) => {
    const el = document.querySelector(`#messages .msg[data-id="${id}"]`);
    let label = 'پیام سنجاق‌شده';
    if (el) {
      const b = el.querySelector('.msg-body');
      label = b ? b.textContent : (el.querySelector('.poll-q') ? 'نظرسنجی' : el.querySelector('.chk-title') ? 'چک‌لیست' : el.querySelector('.media') ? 'رسانه' : 'پیام');
    }
    return `<button class="pin-item" data-id="${id}">${esc(label.slice(0, 50))}</button>`;
  }).join('');
  bar.querySelectorAll('.pin-item').forEach((b) => b.onclick = () => {
    const el = document.querySelector(`#messages .msg[data-id="${b.dataset.id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
  });
}

// ---------- پیش‌نویس (Draft) ----------
function draftKey(room) { return 'vx_draft_' + state.me.username + '_' + room; }
function saveDraft() { if (state.room) localStorage.setItem(draftKey(state.room), $('msg-input').value); }
function loadDraft(room) { const v = localStorage.getItem(draftKey(room)); $('msg-input').value = v || ''; applyTierLimits(); }

// ---------- پیام‌های ذخیره‌شده (Saved) ----------
function savedKey() { return 'vx_saved_' + state.me.username; }
function getSaved() { try { return JSON.parse(localStorage.getItem(savedKey()) || '[]'); } catch { return []; } }
function addSaved(m) {
  const arr = getSaved();
  if (arr.some((x) => x.id === m.id)) return;
  arr.push({ id: m.id, kind: m.kind, content: m.content, url: m.url, name: m.name, from: m.from, fromName: m.fromName, fromPremium: m.fromPremium, time: m.time, poll: m.poll, checklist: m.checklist, album: m.album, reactions: m.reactions });
  localStorage.setItem(savedKey(), JSON.stringify(arr.slice(-200)));
  toast('در پیام‌های ذخیره‌شده ذخیره شد');
}
function savedRoomId() { return 'saved:' + state.me.username; }
function openSaved() { openRoom(savedRoomId(), 'پیام‌های ذخیره‌شده'); }
function renderSaved() {
  const arr = getSaved();
  state.lastDay = null;
  arr.forEach((m) => addMessage({ ...m, roomId: savedRoomId() }));
  scrollBottom();
}


function addMessage(m) {
  if (!m || !m.roomId) return;
  if (m.roomId !== state.room) return;

  const day = new Date(m.time).toDateString();
  if (day !== state.lastDay) {
    state.lastDay = day;
    const sep = document.createElement('div');
    sep.className = 'day-sep';
    sep.textContent = new Date(m.time).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('messages').appendChild(sep);
  }

  const mine = m.from === state.me.username;
  const div = document.createElement('div');
  div.className = `msg ${mine ? 'out' : 'in'}${m.kind === 'sticker' ? ' sticker' : ''}`;
  div.dataset.id = m.id;
  div.dataset.room = m.roomId;

  let body = renderBody(m);

  const fwd = m.fwdFrom ? `<div class="fwd">${svg('forward')} بازنشر از ${esc(m.fwdFrom)}</div>` : '';
  const ticks = mine ? `<span class="ticks" data-room="${m.roomId}" data-time="${m.time}">${peerReadTime(m.roomId) >= m.time ? svg('checkDouble') : svg('check')}</span>` : '';
  const head = mine ? '' : `<span class="from">${esc(m.fromName)}${m.fromPremium ? premiumBadge() : ''}</span>`;
  const silentIco = m.silent ? ` <span class="silent-ico" title="بی‌صدا">${svg('mute')}</span>` : '';
  div.innerHTML = `${fwd}${head}${body}<span class="meta">${fmtTime(m.time)}${m.edited ? ' <span class="edited-tag">(ویرایش شد)</span>' : ''}${silentIco}${ticks}</span>${renderReactions(m)}`;

  // نقل قول پیام
  if (m.replyTo && m.replyTo.id) {
    const q = document.createElement('div');
    q.className = 'reply-quote';
    q.innerHTML = `<b>${esc(m.replyTo.name || '؟')}</b> ${esc((m.replyTo.snippet || '').slice(0, 100))}`;
    q.onclick = () => {
      const orig = document.querySelector(`[data-id="${m.replyTo.id}"]`);
      if (orig) {
        orig.scrollIntoView({ behavior: 'smooth', block: 'center' });
        orig.classList.add('flash');
        setTimeout(() => orig.classList.remove('flash'), 1500);
      }
    };
    const bodyEl = div.querySelector('.msg-body');
    if (bodyEl) div.insertBefore(q, bodyEl);
    else div.appendChild(q);
  }

  if (!mine && m.fromAvatar) {
    div.classList.add('with-av');
    const av = document.createElement('span');
    av.className = 'avatar xs';
    setAvatar(av, { avatar: m.fromAvatar, isPremium: m.fromPremium });
    div.prepend(av);
  }

  // دکمه‌های پیام: ریپلای برای همه، ویرایش/حذف فقط برای خودم
  const acts = document.createElement('span');
  acts.className = 'msg-actions';
  const reactBtn = document.createElement('button');
  reactBtn.innerHTML = svg('smiley'); reactBtn.title = 'واکنش';
  reactBtn.onclick = (e) => { e.stopPropagation(); openReactionPicker(m, reactBtn); };
  acts.appendChild(reactBtn);
  const replyBtn = document.createElement('button');
  replyBtn.innerHTML = svg('reply'); replyBtn.title = 'پاسخ';
  replyBtn.onclick = () => setReplyTo(m);
  acts.appendChild(replyBtn);
  const fwdBtn = document.createElement('button');
  fwdBtn.innerHTML = svg('forward'); fwdBtn.title = 'فوروارد';
  fwdBtn.onclick = () => forwardMessage(m);
  acts.appendChild(fwdBtn);
  const pinBtn = document.createElement('button');
  pinBtn.innerHTML = svg('pin'); pinBtn.title = 'سنجاق';
  pinBtn.onclick = async () => { await api('/api/pin', { method: 'POST', body: JSON.stringify({ roomId: m.roomId, msgId: m.id }) }); };
  acts.appendChild(pinBtn);
  const saveBtn = document.createElement('button');
  saveBtn.innerHTML = svg('bookmark'); saveBtn.title = 'ذخیره';
  saveBtn.onclick = () => addSaved(m);
  acts.appendChild(saveBtn);
  if (mine && m.kind === 'text') {
    const editBtn = document.createElement('button');
    editBtn.textContent = '✎'; editBtn.title = 'ویرایش';
      editBtn.onclick = () => {
        const nv = prompt('ویرایش پیام:', m.content);
        if (!nv || !nv.trim()) return;
        if (m.roomId.startsWith('saved:')) {
          const arr = getSaved().map((x) => x.id === m.id ? { ...x, content: nv.trim() } : x);
          localStorage.setItem(savedKey(), JSON.stringify(arr));
          const mb = div.querySelector('.msg-body'); if (mb) mb.innerHTML = formatText(nv.trim());
          return;
        }
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'edit-message', roomId: m.roomId, id: m.id, content: nv.trim() }));
        }
      };
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑'; delBtn.title = 'حذف';
      delBtn.onclick = () => {
        if (!confirm('این پیام حذف شود؟')) return;
        if (m.roomId.startsWith('saved:')) {
          localStorage.setItem(savedKey(), JSON.stringify(getSaved().filter((x) => x.id !== m.id)));
          div.remove();
          return;
        }
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'delete-message', roomId: m.roomId, id: m.id }));
        }
      };
    acts.append(editBtn, delBtn);
  }
  div.appendChild(acts);

  $('messages').appendChild(div);
  if (m.kind === 'text' && /https?:\/\//.test(m.content || '')) loadLinkPreview(m, div);
  scrollBottom();
}

function scrollBottom() { const el = $('messages'); el.scrollTop = el.scrollHeight; }

function updateTicks() {
  if (!state.room) return;
  const t = peerReadTime(state.room);
  document.querySelectorAll('.ticks').forEach((sp) => {
    if (sp.dataset.room === state.room) sp.innerHTML = (parseInt(sp.dataset.time, 10) <= t) ? svg('checkDouble') : svg('check');
  });
}

function forwardMessage(m) {
  const targets = [];
  state.groups.forEach((g) => targets.push(['گروه: ' + g.name, 'group:' + g.id]));
  const c = getContacts();
  Object.entries(c).forEach(([u, d]) => targets.push(['@' + u, dmRoom({ username: u })]));
  if (!targets.length) { alert('چتی برای فوروارد نداری'); return; }
  const list = targets.map((t, i) => `${i + 1}) ${t[0]}`).join('\n');
  const ans = prompt('فوروارد به کدام چت؟\n(شماره را وارد کن)\n\n' + list, '1');
  const idx = parseInt(ans, 10) - 1;
  if (isNaN(idx) || !targets[idx]) return;
  const [label, rid] = targets[idx];
  send({
    type: 'message', kind: m.kind, content: m.content || '', url: m.url || undefined,
    mime: m.mime, name: m.name, fwdFrom: m.fromName,
  }, rid);
  alert('فوروارد شد به ' + label);
}

/* ---- ضبط پیام صوتی ---- */
let recChunks = [], recTimer = null, recStart = 0;
async function startRec() {
  if (state.rec) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mrType = '';
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mrType = 'audio/webm;codecs=opus';
    else if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) mrType = 'audio/webm';
    else if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4')) mrType = 'audio/mp4';
    const mr = mrType ? new MediaRecorder(stream, { mimeType: mrType }) : new MediaRecorder(stream);
    recChunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const blobType = mr.mimeType || 'audio/webm';
      const ext = blobType.includes('mp4') ? '.m4a' : '.webm';
      const blob = new Blob(recChunks, { type: blobType });
      const file = new File([blob], 'voice_' + Date.now() + ext, { type: blobType });
      $('rec-bar').classList.add('hidden');
      clearInterval(recTimer);
      uploadWithProgress(file);
      state.rec = null;
    };
    mr.start();
    state.rec = mr;
    $('rec-bar').classList.remove('hidden');
    recStart = Date.now();
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('rec-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 500);
  } catch (e) { alert('دسترسی به میکروفون داده نشد: ' + e.message); }
}
$('mic-btn').onclick = startRec;
$('rec-stop').onclick = () => { if (state.rec && state.rec.state !== 'inactive') state.rec.stop(); };
$('rec-cancel').onclick = () => {
  if (state.rec) { state.rec.stop(); state.rec = null; }
  $('rec-bar').classList.add('hidden'); clearInterval(recTimer);
};

function showEmptyHint() {
  if (state.room || $('messages').children.length) return;
  if ($('empty-hint')) return;
  const div = document.createElement('div');
  div.id = 'empty-hint';
  div.className = 'system-note';
  div.textContent = 'برای شروع، از لیست کنار یک نفر (یا Vortex AI) را انتخاب کن';
  $('messages').appendChild(div);
}

/* ================= SENDING ================= */
function send(obj, roomIdOverride) {
  const roomId = roomIdOverride || state.room;
  if (!roomId) return;
  if (roomId.startsWith('saved:')) {
    if (obj.type === 'message') {
      const m = {
        id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        kind: obj.kind || 'text',
        content: obj.content || '',
        url: obj.url, name: obj.name, mime: obj.mime,
        from: state.me.username,
        fromName: state.me.displayName || state.me.username,
        fromPremium: state.me.isPremium,
        time: Date.now(),
        replyTo: obj.replyTo,
        album: obj.album,
      };
      addSaved(m);
      if (state.room === roomId) { addMessage({ ...m, roomId }); scrollBottom(); }
    }
    return;
  }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ ...obj, roomId }));
  else { state.outbox.push({ ...obj, roomId }); renderOutbox(); }
}
function fetchHistory(roomId) {
  return new Promise((resolve) => {
    state.historyReqs = state.historyReqs || {};
    state.historyReqs[roomId] = resolve;
    state.ws.send(JSON.stringify({ type: 'history', roomId }));
  });
}
function renderOutbox() {
  let b = $('outbox-bar');
  if (!b) { b = document.createElement('div'); b.id = 'outbox-bar'; b.className = 'outbox-bar hidden'; $('chat-area').insertBefore(b, document.querySelector('.composer')); }
  if (!state.outbox.length) { b.classList.add('hidden'); b.innerHTML = ''; return; }
  b.classList.remove('hidden');
  b.innerHTML = `<span>${state.outbox.length} پیام در صف ارسال</span><button id="outbox-retry" class="mini-btn ok">${svg('forward')} ارسال مجدد</button>`;
  $('outbox-retry').onclick = flushOutbox;
}
function flushOutbox() {
  if (!state.outbox.length) return;
  if (!(state.ws && state.ws.readyState === WebSocket.OPEN)) { alert('هنوز متصل نیستید'); return; }
  const items = state.outbox.slice(); state.outbox = [];
  items.forEach((o) => state.ws.send(JSON.stringify(o)));
  renderOutbox();
}
function toast(msg, actionBtn) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (actionBtn) { actionBtn.classList.add('toast-btn'); t.appendChild(actionBtn); }
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), actionBtn ? 6000 : 2200);
}

const clientBotDm = (u) => 'dm:' + [u, BOT_USERNAME].sort().join('|');

async function openAiSummary() {
  if (!state.room || state.room.startsWith('saved:')) return;
  $('ai-modal').classList.remove('hidden');
  $('ai-result').textContent = 'در حال تولید خلاصه...';
  $('ai-reply-opts').classList.add('hidden');
  $('ai-input').classList.add('hidden'); $('ai-tone').classList.add('hidden'); $('ai-run').classList.add('hidden');
  try {
    const r = await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'summarize', roomId: state.room }) });
    const d = await r.json();
    $('ai-result').textContent = d.result || 'خطا در دریافت خلاصه';
  } catch (e) { $('ai-result').textContent = 'خطا: ' + e.message; }
}

async function openAiReply() {
  if (!state.room || state.room.startsWith('saved:')) return;
  $('ai-modal').classList.remove('hidden');
  $('ai-result').textContent = 'در حال تولید پیشنهاد پاسخ...';
  $('ai-reply-opts').classList.add('hidden');
  $('ai-input').classList.add('hidden'); $('ai-tone').classList.add('hidden'); $('ai-run').classList.add('hidden');
  try {
    const r = await api('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'reply', roomId: state.room }) });
    const d = await r.json();
    const lines = (d.result || '').split('\n').map((s) => s.trim()).filter(Boolean);
    $('ai-result').textContent = '';
    const box = $('ai-reply-opts'); box.classList.remove('hidden'); box.innerHTML = '';
    if (!lines.length) box.textContent = 'پیشنهادی یافت نشد';
    lines.slice(0, 4).forEach((t) => {
      const b = document.createElement('button'); b.className = 'mini-btn'; b.style.width = '100%'; b.style.margin = '6px 0'; b.textContent = t;
      b.onclick = () => { $('msg-input').value = t; $('ai-modal').classList.add('hidden'); $('msg-input').focus(); };
      box.appendChild(b);
    });
  } catch (e) { $('ai-result').textContent = 'خطا: ' + e.message; }
}

function showAiSuggestion(d) {
  const btn = document.createElement('button'); btn.className = 'mini-btn ok'; btn.textContent = 'ایجاد یادآوری';
  btn.onclick = async () => {
    try {
      await api('/api/schedule', { method: 'POST', body: JSON.stringify({ roomId: clientBotDm(state.me.username), kind: 'text', content: 'یادآوری: ' + d.text, at: d.at }) });
      toast('یادآوری ثبت شد: ' + d.when);
    } catch (e) { toast('خطا: ' + e.message); }
  };
  toast(`تاریخ شناسایی شد — ${d.when}: ${d.text}`, btn);
}

function sendText() {
  const text = $('msg-input').value.trim();
  if (!text) return;
  send({ type: 'message', kind: 'text', content: text, replyTo: state.replyTo || undefined, silent: state.composeSilent });
  $('msg-input').value = '';
  clearReply();
  if (state.room) localStorage.removeItem(draftKey(state.room));
}
$('send-btn').onclick = sendText;
$('msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
$('msg-input').addEventListener('input', () => {
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => send({ type: 'typing' }), 600);
});

function showTyping(d) {
  if (d.roomId !== state.room) return;
  $('typing-indicator').textContent = `${d.name} در حال نوشتن...`;
  $('typing-indicator').classList.remove('hidden');
  clearTimeout(state.typingHide);
  state.typingHide = setTimeout(() => $('typing-indicator').classList.add('hidden'), 2000);
}

/* ================= PICKERS ================= */
function buildPicker(el, dataFn, gridClass) {
  el.innerHTML = '';
  el.classList.toggle('stickers', gridClass === 'stickers');
  dataFn().forEach(([title, items]) => {
    const h = document.createElement('h5');
    h.textContent = title;
    el.appendChild(h);
    const g = document.createElement('div');
    g.className = 'grid';
    items.forEach((ch) => {
      const b = document.createElement('button');
      b.textContent = ch;
      b.onclick = () => { send({ type: 'message', kind: el.id === 'emoji-picker' ? 'text' : 'sticker', content: ch, replyTo: state.replyTo || undefined }); togglePicker(el, false); clearReply(); };
      g.appendChild(b);
    });
    el.appendChild(g);
  });
}
function togglePicker(el, force) {
  const show = force ?? el.classList.contains('hidden');
  $('emoji-picker').classList.add('hidden');
  $('sticker-picker').classList.add('hidden');
  if (show) {
    if (el.id === 'emoji-picker') buildPicker(el, () => Object.entries(EMOJI));
    else buildPicker(el, () => Object.entries(STICKERS), 'stickers');
    el.classList.remove('hidden');
  }
}
$('emoji-btn').onclick = () => togglePicker($('emoji-picker'));
$('sticker-btn').onclick = () => togglePicker($('sticker-picker'));

/* ================= UPLOAD ================= */
$('attach-btn').onclick = () => $('file-input').click();
$('file-input').onchange = async () => {
  const files = Array.from($('file-input').files || []);
  $('file-input').value = '';
  if (!files.length) return;
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (imgs.length > 1 && imgs.length === files.length) {
    try {
      const datas = await Promise.all(imgs.map(uploadOne));
      send({ type: 'message', kind: 'album', album: datas.map((d) => d.url), replyTo: state.replyTo || undefined });
      clearReply();
    } catch (e) { alert(e.message); }
  } else {
    uploadWithProgress(files[0]);
  }
};

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const maxMB = state.me.isPremium ? 100 : 30;
    if (file.size > maxMB * 1024 * 1024) { reject(new Error(`حداکثر ${maxMB} مگابایت` + (state.me.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ'))); return; }
    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    $('upload-progress').classList.remove('hidden');
    $('up-name').textContent = file.name;
    $('up-fill').style.width = '0%';
    $('up-percent').textContent = '0%';
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('up-fill').style.width = pct + '%';
      $('up-percent').textContent = pct + '%';
    };
    xhr.onload = () => {
      $('upload-progress').classList.add('hidden');
      try { const data = JSON.parse(xhr.responseText); if (xhr.status !== 200) throw new Error(data.error || 'خطا در آپلود'); resolve(data); } catch (err) { reject(err instanceof Error ? err : new Error('خطا در آپلود')); }
    };
    xhr.onerror = () => { $('upload-progress').classList.add('hidden'); reject(new Error('آپلود قطع شد')); };
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
    xhr.send(fd);
  });
}
function uploadWithProgress(file) {
  uploadOne(file).then((data) => {
    send({ type: 'message', kind: data.kind, url: data.url, mime: data.mime, name: data.name, content: '', replyTo: state.replyTo || undefined });
    clearReply();
  }).catch((err) => alert(err.message));
}

// ---------- دکمه‌های کامپوزر: بی‌صدا / زمان‌بندی / نظرسنجی / چک‌لیست ----------
state.composeSilent = false;
$('silent-btn').onclick = () => {
  state.composeSilent = !state.composeSilent;
  $('silent-btn').classList.toggle('active', state.composeSilent);
  toast(state.composeSilent ? 'حالت بی‌صدا روشن شد' : 'حالت بی‌صدا خاموش شد');
};
$('schedule-btn').onclick = async () => {
  const when = prompt('زمان ارسال (فرمت YYYY-MM-DD HH:MM):', '');
  if (!when) return;
  const ts = new Date(when.trim().replace(' ', 'T')).getTime();
  if (isNaN(ts) || ts < Date.now()) { alert('زمان نامعتبر'); return; }
  const text = prompt('متن پیام زمان‌بندی‌شده:');
  if (!text || !text.trim()) return;
  await api('/api/schedule', { method: 'POST', body: JSON.stringify({ roomId: state.room, kind: 'text', content: text.trim(), at: ts, replyTo: state.replyTo || undefined }) }).catch(() => {});
  alert('پیام زمان‌بندی شد');
  clearReply();
};
$('poll-btn').onclick = () => {
  const q = prompt('سوال نظرسنجی:'); if (!q || !q.trim()) return;
  const opts = prompt('گزینه‌ها را با خط تیره جدا کنید (مثال: بله-خیر-شاید):'); if (!opts) return;
  const options = opts.split('-').map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) { alert('حداقل ۲ گزینه لازم است'); return; }
  const quiz = confirm('این یک مسابقه (Quiz) است؟ گزینه صحیح بعد از رأی نمایش داده می‌شود.');
  let correct = null;
  if (quiz) { const ci = prompt('شماره گزینه صحیح (۱ تا ' + options.length + '):'); correct = parseInt(ci, 10) - 1; }
  send({ type: 'message', kind: 'poll', poll: { question: q.trim(), options, quiz, correct: quiz ? correct : null } });
};
$('checklist-btn').onclick = () => {
  const t = prompt('عنوان چک‌لیست:'); if (!t || !t.trim()) return;
  const its = prompt('آیتم‌ها را با خط تیره جدا کنید:'); if (!its) return;
  const items = its.split('-').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return;
  send({ type: 'message', kind: 'checklist', checklist: { title: t.trim(), items } });
};
$('ai-summary-btn').onclick = () => openAiSummary();
$('ai-reply-btn').onclick = () => openAiReply();
$('saved-li').onclick = () => openSaved();

// ---------- تعامل با پیام‌ها (نظرسنجی / چک‌لیست / واکنش / اسپویلر) ----------
$('messages').addEventListener('click', (e) => {
  const opt = e.target.closest('.poll-opt');
  if (opt) {
    const mid = opt.closest('.poll').dataset.poll;
    api('/api/poll/vote', { method: 'POST', body: JSON.stringify({ roomId: state.room, msgId: mid, option: parseInt(opt.dataset.opt, 10) }) }).catch(() => {});
    return;
  }
  const chk = e.target.closest('.chk-item input');
  if (chk) {
    const mid = chk.closest('.checklist').dataset.chkMsg;
    api('/api/checklist/toggle', { method: 'POST', body: JSON.stringify({ roomId: state.room, msgId: mid, index: parseInt(chk.dataset.chk, 10) }) }).catch(() => {});
    return;
  }
  const chip = e.target.closest('.react-chip');
  if (chip) {
    api('/api/reactions', { method: 'POST', body: JSON.stringify({ roomId: state.room, msgId: chip.closest('.msg').dataset.id, emoji: chip.dataset.emoji }) }).catch(() => {});
    return;
  }
  const sp = e.target.closest('.spoiler');
  if (sp) { sp.classList.toggle('revealed'); }
});

// بستن پاپ‌آور واکنش با کلیک بیرون
document.addEventListener('click', (e) => { if (!e.target.closest('#react-pop') && !e.target.closest('[title="واکنش"]')) closeReactionPicker(); });


document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('media')) {
    const lb = document.createElement('div');
    lb.id = 'lightbox';
    const isVideo = e.target.tagName === 'VIDEO';
    lb.innerHTML = isVideo ? `<video src="${e.target.src}" controls autoplay></video>` : `<img src="${e.target.src}" />`;
    lb.onclick = (ev) => { if (ev.target === lb) lb.remove(); };
    document.body.appendChild(lb);
  }
});

/* ================= PROFILE MODAL ================= */
$('profile-btn').onclick = () => {
  $('profile-modal').classList.remove('hidden');
  $('rename-input').value = state.me.displayName;
  $('rename-status').textContent = '';
  $('bio-input').value = state.me.bio || '';
  updateBioCount();
  refreshProfileUI();
};
function refreshProfileUI() {
  setAvatar($('profile-avatar'), state.me);
  $('profile-displayname').textContent = state.me.displayName + (state.me.isPremium ? premiumBadge() : '');
  $('profile-username').textContent = '@' + state.me.username;
  applyTierLimits();
  const p = $('profile-premium');
  if (state.me.isAdmin) p.innerHTML = svg('crown') + ' ادمین سیستم — همه امکانات';
  else if (state.me.isPremium) p.innerHTML = svg('crown') + ' پرمیوم: آپلود ۱۰۰مگ + پیام ۴۰۰۰ نویسه + بیو بلند + ساخت ۱۰ گروه/کانال + نشان طلایی';
  else p.textContent = 'رایگان: آپلود ۳۰مگ + پیام ۷۰۰ نویسه + ۲ گروه — پرمیوم از ادمین بگیر';
}
function openUserProfile(username) {
  if (!username) return;
  const isBot = username === BOT_USERNAME;
  const u = state.users.find((x) => x.username === username);
  const isAdmin = !!(u && u.isAdmin);
  $('user-profile-modal').classList.remove('hidden');
  setAvatar($('up-avatar'), { avatar: u && u.avatar, isPremium: u && u.isPremium });
  $('up-name').textContent = isBot ? BOT_NAME : (u ? u.displayName : username);
  $('up-username').textContent = '@' + username;
  $('up-badges').innerHTML = (u && u.isPremium ? svg('crown') + ' پرمیوم' : '') + (isAdmin ? ' ' + svg('crown') + ' ادمین' : '') + (isBot ? ' AI' : '');
  $('up-status').textContent = '';
  $('up-bio').style.display = 'none';
  if (isBot) {
    $('up-status').textContent = 'ربات هوش مصنوعی (آنلاین)';
  } else {
    try {
      const r = api('/api/users/exists/' + encodeURIComponent(username));
      r.then(async (res) => {
        const d = await res.json();
        $('up-status').textContent = d.online ? 'آنلاین' : (d.lastSeen ? 'آخرین بازدید ' + timeAgo(d.lastSeen) : '');
        if (d.avatar) setAvatar($('up-avatar'), { avatar: d.avatar, isPremium: d.isPremium });
        if (d.bio) { $('up-bio').style.display = ''; $('up-bio').textContent = d.bio; }
      }).catch(() => {});
    } catch (e) {}
  }
  const rb = $('up-reset');
  if (state.me.isAdmin && !isAdmin && !isBot) {
    rb.classList.remove('hidden');
    rb.onclick = async () => {
      const pw = prompt('رمز جدید برای @' + username + ' (حداقل ۴ کاراکتر):');
      if (!pw || pw.length < 4) return;
      const res = await api('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
      const j = await res.json();
      toast(j.ok ? 'رمز ریست شد' : ('خطا: ' + (j.error || '')));
    };
  } else rb.classList.add('hidden');
  renderSharedMedia(username);
  $('up-chat').onclick = () => {
    const room = 'dm:' + [state.me.username, username].sort().join('|');
    const nm = isBot ? BOT_NAME : (u ? u.displayName : username);
    $('user-profile-modal').classList.add('hidden');
    openRoom(room, nm);
  };
}
function renderSharedMedia(username) {
  const box = $('up-media');
  if (!box) return;
  box.innerHTML = '<div class="hint">در حال بارگذاری رسانه‌های مشترک...</div>';
  if (!(state.ws && state.ws.readyState === WebSocket.OPEN)) { box.innerHTML = ''; return; }
  const dm = 'dm:' + [state.me.username, username].sort().join('|');
  fetchHistory(dm).then((msgs) => {
    const images = [], files = [], links = [];
    (msgs || []).forEach((m) => {
      if (m.kind === 'image' || m.kind === 'gif') images.push(m.url);
      else if (m.kind === 'album') (m.album || []).forEach((x) => images.push(x));
      else if (m.kind === 'file') files.push(m);
      else if (m.kind === 'text') {
        const found = (m.content || '').match(/https?:\/\/[^\s]+/g);
        if (found) found.forEach((l) => links.push(l));
      }
    });
    let html = '';
    if (images.length) {
      html += '<div style="margin-top:10px;text-align:right"><b style="font-size:12px;color:var(--dim)">تصاویر (' + images.length + ')</b><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px">' +
        images.slice(0, 30).map((u) => '<a href="' + esc(u) + '" target="_blank"><img class="media" src="' + esc(u) + '" loading="lazy" style="width:100%;height:70px;object-fit:cover;border-radius:8px"></a>').join('') + '</div></div>';
    }
    if (files.length) {
      html += '<div style="margin-top:10px;text-align:right"><b style="font-size:12px;color:var(--dim)">فایل‌ها (' + files.length + ')</b><div style="margin-top:6px">' +
        files.slice(0, 30).map((f) => '<a class="file-chip" href="' + esc(f.url) + '" download="' + esc(f.name || 'file') + '" style="display:inline-flex;margin:4px 4px 0 0">' + svg('attach') + ' <span>' + esc(f.name || 'فایل') + '</span></a>').join('') + '</div></div>';
    }
    if (links.length) {
      html += '<div style="margin-top:10px;text-align:right"><b style="font-size:12px;color:var(--dim)">لینک‌ها (' + links.length + ')</b><div style="margin-top:6px">' +
        links.slice(0, 30).map((l) => '<a href="' + esc(l) + '" target="_blank" style="display:block;color:var(--cyan);font-size:12px;margin-top:4px;word-break:break-all">' + esc(l) + '</a>').join('') + '</div></div>';
    }
    box.innerHTML = html || '<div class="hint">رسانه‌ی مشترکی نیست</div>';
  }).catch(() => { box.innerHTML = ''; });
}
function updateBioCount() {
  const max = state.me.isPremium ? 200 : 80;
  $('bio-count').textContent = `${$('bio-input').value.length}/${max}`;
}
$('bio-input').addEventListener('input', updateBioCount);
$('avatar-btn').onclick = () => $('avatar-input').click();
$('avatar-input').onchange = async () => {
  const f = $('avatar-input').files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await fetch('/api/profile/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.me.avatar = data.avatar;
    refreshProfileUI();
    renderMyAvatar();
  } catch (e) { alert(e.message); }
  $('avatar-input').value = '';
};
$('bio-btn').onclick = async () => {
  try {
    const r = await api('/api/profile/bio', { method: 'POST', body: JSON.stringify({ bio: $('bio-input').value }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.me.bio = data.me.bio;
    $('rename-status').innerHTML = svg('check') + ' بیو ذخیره شد';
  } catch (e) { $('rename-status').textContent = e.message; }
};
$('logout-btn').onclick = logout;
$('rename-btn').onclick = async () => {
  const displayName = $('rename-input').value.trim();
  try {
    const r = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ displayName }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.applied) {
      state.me.displayName = displayName;
      renderMyAvatar();
      $('rename-status').innerHTML = svg('check') + ' به‌عنوان ادمین مستقیم اعمال شد';
    } else {
      $('rename-status').textContent = 'درخواست ثبت شد؛ بعد از تایید ادمین اعمال می‌شود ⏳';
    }
  } catch (e) { $('rename-status').textContent = e.message; }
};

/* ================= ADMIN MODAL ================= */
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token, ...(opts.headers || {}) } });

$('admin-btn').onclick = async () => {
  $('admin-chats').classList.add('hidden');
  $('admin-main').classList.remove('hidden');
  $('admin-modal').classList.remove('hidden');
  loadAdmin();
};

async function loadAdmin() {
  const rq = $('admin-requests'), us = $('admin-users'), su = $('admin-signups');
  rq.innerHTML = '<li class="empty">...</li>'; us.innerHTML = '<li class="empty">...</li>'; su.innerHTML = '<li class="empty">...</li>';
  const [reqRes, usrRes, signRes] = await Promise.all([api('/api/admin/requests'), api('/api/admin/users'), api('/api/admin/signups')]);
  const reqs = (await reqRes.json()).requests || [];
  const users = (await usrRes.json()).users || [];
  const signups = (await signRes.json()).signups || [];

  su.innerHTML = '';
  if (!signups.length) su.innerHTML = '<li class="empty">درخواست ثبت‌نامی نیست</li>';
  signups.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="grow"><b>@${esc(s.username)}</b> <small>می‌خواهد عضو شود</small></span>`;
    const ok = mkBtn(svg('check') + ' تایید', 'mini-btn ok', async () => {
      await api(`/api/admin/signups/${s.id}`, { method: 'POST', body: JSON.stringify({ approve: true }) });
      loadAdmin();
    }, true);
    const no = mkBtn(svg('close') + ' رد', 'mini-btn no', async () => {
      await api(`/api/admin/signups/${s.id}`, { method: 'POST', body: JSON.stringify({ approve: false }) });
      loadAdmin();
    }, true);
    li.append(ok, no);
    su.appendChild(li);
  });

  rq.innerHTML = '';
  if (!reqs.length) rq.innerHTML = '<li class="empty">درخواستی نیست</li>';
  reqs.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="grow">${esc(r.username)}: <b>${esc(r.oldName)}</b> ← <b style="color:var(--secondary)">${esc(r.newName)}</b></span>`;
    const ok = mkBtn(svg('check'), 'mini-btn ok', async () => { await api(`/api/admin/requests/${r.id}`, { method: 'POST', body: JSON.stringify({ approve: true }) }); loadAdmin(); }, true);
    const no = mkBtn(svg('close'), 'mini-btn no', async () => { await api(`/api/admin/requests/${r.id}`, { method: 'POST', body: JSON.stringify({ approve: false }) }); loadAdmin(); }, true);
    li.append(ok, no);
    rq.appendChild(li);
  });

  us.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="avatar sm">${initial(u.displayName)}</span>
      <span class="grow">${esc(u.displayName)} <small>@${esc(u.username)}</small></span>
      ${u.isAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}
      ${u.banned ? '<small>مسدود</small>' : ''}`;
    if (u.username !== state.me.username) {
      li.appendChild(mkBtn(svg('chat') + ' چت‌ها', 'mini-btn', async () => openAdminChats(u.username, u.displayName), true));
    }
    if (!u.isAdmin) {
      const banBtn = mkBtn(u.banned ? 'رفع مسدودی' : 'مسدودسازی', u.banned ? 'mini-btn ok' : 'mini-btn no',
        async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u.username, banned: !u.banned }) }); loadAdmin(); });
      li.appendChild(banBtn);
      const premBtn = mkBtn(u.isPremium ? 'لغو پرمیوم' : 'پرمیوم کن', u.isPremium ? 'mini-btn no' : 'mini-btn prem',
        async () => { await api('/api/admin/premium', { method: 'POST', body: JSON.stringify({ username: u.username, isPremium: !u.isPremium }) }); loadAdmin(); });
      li.appendChild(premBtn);
      const resetBtn = mkBtn(svg('lock') + ' ریست رمز', 'mini-btn', async () => {
        const np = prompt('رمز عبور جدید برای @' + u.username + ' (حداقل ۴ کاراکتر):');
        if (!np || np.length < 4) { if (np !== null) alert('رمز باید حداقل ۴ کاراکتر باشد'); return; }
        await api('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ username: u.username, newPassword: np }) });
        alert('رمز جدید برای @' + u.username + ' ثبت شد. کاربر بعد از ورود با رمز جدید، از سیستم خارج می‌شود.');
      }, true);
      li.appendChild(resetBtn);
    }
    us.appendChild(li);
  });
}
function mkBtn(text, cls, fn, html) {
  const b = document.createElement('button');
  if (html) b.innerHTML = text; else b.textContent = text;
  b.className = cls; b.style.fontSize = '11px'; b.style.padding = '6px 10px';
  b.onclick = fn;
  return b;
}

/* ---- admin: read users' chats ---- */
async function openAdminChats(username, displayName) {
  $('admin-main').classList.add('hidden');
  $('admin-chats').classList.remove('hidden');
  $('ac-msgs').classList.add('hidden');
  $('ac-msgs').innerHTML = '';
  $('ac-title').innerHTML = svg('chat') + ` چت‌های ${esc(displayName)}`;
  const ul = $('ac-rooms');
  ul.innerHTML = '<li class="empty">...</li>';
  try {
    const r = await api(`/api/admin/user/${encodeURIComponent(username)}/rooms`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    ul.innerHTML = '';
    if (!data.rooms.length) { ul.innerHTML = '<li class="empty">این کاربر هنوز چتی نداشته</li>'; return; }
    data.rooms.forEach((room) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="grow">${esc(room.title)}</span><small>${room.count} پیام</small>`;
      li.appendChild(mkBtn('خواندن', 'mini-btn ok', async () => {
        try {
          const rr = await api('/api/admin/room/messages?roomId=' + encodeURIComponent(room.roomId));
          const dd = await rr.json();
          if (!rr.ok) throw new Error(dd.error);
          renderAdminMessages(dd.messages, room.title);
        } catch (e) { alert(e.message); }
      }));
      ul.appendChild(li);
    });
  } catch (e) { ul.innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

function renderAdminMessages(msgs, title) {
  const box = $('ac-msgs');
  box.classList.remove('hidden');
  box.innerHTML = '';
  if (!msgs.length) { box.innerHTML = '<p class="empty">پیامی نیست</p>'; return; }
  let lastDay = null;
  msgs.forEach((m) => {
    const day = new Date(m.time).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = new Date(m.time).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' });
      box.appendChild(sep);
    }
    const div = document.createElement('div');
    div.className = 'msg in' + (m.kind === 'sticker' ? ' sticker' : '');
    let body = '';
    if (m.kind === 'text') body = `<span class="msg-body">${esc(m.content)}</span>`;
    else if (m.kind === 'sticker') body = esc(m.content);
    else if (m.kind === 'image' || m.kind === 'gif') body = `<img class="media" src="${esc(m.url)}" loading="lazy" />`;
    else if (m.kind === 'video') body = `<video class="media" src="${esc(m.url)}" controls preload="metadata"></video>`;
  else if (m.kind === 'audio') body = `<audio src="${esc(m.url)}" controls preload="metadata"></audio><a class="file-chip" href="${esc(m.url)}" download="${esc(m.name || 'voice')}"><span>${svg('attach')}</span> دانلود صدا</a>`;
    else if (m.kind === 'file') body = `<a class="file-chip" href="${esc(m.url)}">${svg('attach')} ${esc(m.name || 'فایل')}</a>`;
    const botTag = m.from === BOT_USERNAME ? ' <span class="badge-admin">AI</span>' : '';
    div.innerHTML = `
      <span class="from">${esc(m.fromName)}${botTag}${m.fromPremium ? premiumBadge() : ''} <small class="ac-un">@${esc(m.from)}</small></span>
      ${body}<span class="meta">${fmtTime(m.time)}${m.edited ? ' <span class="edited-tag">(ویرایش شد)</span>' : ''}</span>`;
    if (m.fromAvatar) {
      div.classList.add('with-av');
      const av = document.createElement('span');
      av.className = 'avatar xs';
      setAvatar(av, { avatar: m.fromAvatar, isPremium: m.fromPremium });
      div.prepend(av);
    } else {
      div.classList.add('with-av');
      const av = document.createElement('span');
      av.className = 'avatar xs';
      av.textContent = initial(m.fromName);
      div.prepend(av);
    }
    box.appendChild(div);
  });
}

$('ac-back').onclick = () => {
  $('admin-chats').classList.add('hidden');
  $('admin-main').classList.remove('hidden');
};

/* close modals */
document.querySelectorAll('.modal-close').forEach((b) => {
  b.onclick = () => $(b.dataset.close).classList.add('hidden');
});
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
});

/* ================= CALLS (WebRTC) ================= */
const RTC_CFG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
  ],
  iceCandidatePoolSize: 2,
};

function peerOfRoom() {
  if (!state.room || !state.room.startsWith('dm:')) return null;
  const parts = state.room.slice(3).split('|');
  return parts.find((p) => p !== state.me.username) || null;
}

$('call-btn').onclick = () => startCall(false);

async function createPC(peer) {
  const pc = new RTCPeerConnection(RTC_CFG);
  pc.onicecandidate = (e) => {
    if (e.candidate && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'call-ice', to: peer, candidate: e.candidate }));
    }
  };
  pc.ontrack = (e) => onRemoteTrack(e);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      showCallBar('تماس برقرار نشد — احتمالاً هر دو طرف پشت شبکه‌های مختلف (NAT) هستید و سرور TURN نداریم');
      setTimeout(() => endCall(true), 2500);
    } else if (['disconnected', 'closed'].includes(pc.connectionState)) endCall(true);
  };
  return pc;
}

async function startCall(withScreen) {
  const peer = peerOfRoom();
  if (!peer) { alert('تماس فقط در چت خصوصی است'); return; }
  try {
    const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = await createPC(peer);
    pc.addTransceiver('video', { direction: 'sendrecv' });
    audio.getTracks().forEach((t) => pc.addTrack(t, audio));
    state.call = { peer, pc, localStream: audio, screenStream: null, muted: false };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.ws.send(JSON.stringify({ type: 'call-offer', to: peer, sdp: pc.localDescription }));
    showCallBar(`در حال تماس با ${peer}...`);
  } catch (e) {
    alert('دسترسی به میکروفون داده نشد: ' + e.message);
  }
}

async function acceptCall(from) {
  try {
    const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = await createPC(state.call.peer);
    pc.addTransceiver('video', { direction: 'sendrecv' });
    audio.getTracks().forEach((t) => pc.addTrack(t, audio));
    state.call.pc = pc;
    state.call.localStream = audio;
    await pc.setRemoteDescription(new RTCSessionDescription(state.call.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.ws.send(JSON.stringify({ type: 'call-answer', to: state.call.peer, sdp: pc.localDescription }));
    showCallBar(`در تماس با ${state.call.fromName}`);
  } catch (e) {
    alert('میکروفون در دسترس نیست: ' + e.message);
    declineCall();
  }
}

function declineCall() {
  if (state.call?.peer && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'call-end', to: state.call.peer }));
  }
  cleanupCall();
}

function endCall(silent) {
  if (state.call?.peer && state.ws.readyState === WebSocket.OPEN && !silent) {
    state.ws.send(JSON.stringify({ type: 'call-end', to: state.call.peer }));
  }
  cleanupCall();
}

function cleanupCall() {
  state.call?.localStream?.getTracks().forEach((t) => t.stop());
  state.call?.screenStream?.getTracks().forEach((t) => t.stop());
  state.call?.pc?.close();
  state.call = null;
  $('call-bar').classList.add('hidden');
  $('remote-media').innerHTML = '';
  $('screen-btn').innerHTML = svg('screen') + ' اشتراک صفحه';
}

function showCallBar(status) {
  $('call-bar').classList.remove('hidden');
  $('call-status').textContent = status;
}
$('end-call-btn').onclick = () => endCall(false);
$('mute-btn').onclick = () => {
  if (!state.call?.localStream) return;
  const track = state.call.localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  state.call.muted = !track.enabled;
  $('mute-btn').innerHTML = svg('mic') + ` ${state.call.muted ? 'وصل صدا' : 'قطع صدا'}`;
};

$('screen-btn').onclick = async () => {
  if (!state.call?.pc) return;
  try {
    if (state.call.screenStream) {
      state.call.screenStream.getTracks().forEach((t) => t.stop());
      state.call.screenStream = null;
      const sender = state.call.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(null);
      $('screen-btn').innerHTML = svg('screen') + ' اشتراک صفحه';
      return;
    }
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.call.screenStream = screen;
    let sender = state.call.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) sender = state.call.pc.addTrack(screen.getVideoTracks()[0], screen);
    else await sender.replaceTrack(screen.getVideoTracks()[0]);
    screen.getVideoTracks()[0].onended = () => { $('screen-btn').click(); };
    $('screen-btn').innerHTML = svg('screen') + ' قطع اشتراک';
  } catch (e) { /* کاربر لغو کرد */ }
};

function onRemoteTrack(e) {
  const [stream] = e.streams;
  if (!stream) return;
  const hasVideo = stream.getVideoTracks().length > 0;
  let el = $('remote-' + (hasVideo ? 'video' : 'audio'));
  if (hasVideo) {
    if (!$('remote-video')) {
      const v = document.createElement('video');
      v.id = 'remote-video'; v.autoplay = true; v.playsInline = true;
      $('remote-media').appendChild(v);
    }
    $('remote-video').srcObject = stream;
  } else {
    if (!$('remote-audio')) {
      const a = document.createElement('audio');
      a.id = 'remote-audio'; a.autoplay = true;
      document.body.appendChild(a);
    }
    $('remote-audio').srcObject = stream;
  }
  showCallBar(`در تماس...`);
}

$('accept-call').onclick = () => {
  $('incoming-modal').classList.add('hidden');
  if (state.call?.offer) acceptCall();
};
$('reject-call').onclick = () => {
  $('incoming-modal').classList.add('hidden');
  declineCall();
};

/* ================= BOOT ================= */
(async () => {
  if (await tryResume()) enterApp();
})();