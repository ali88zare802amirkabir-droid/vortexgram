const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('ft_token') || null,
  me: null,
  room: 'general',
  users: [],
  ws: null,
  typingTimer: null,
  typingHide: null,
  lastDay: null,
};

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
  $('admin-btn').classList.toggle('hidden', !state.me.isAdmin);
  renderMyAvatar();
  connectWS();
  openRoom('general', 'گروه عمومی');
}

function logout() {
  localStorage.removeItem('ft_token');
  location.reload();
}

/* ================= WEBSOCKET ================= */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onopen = () => state.ws.send(JSON.stringify({ type: 'auth', token: state.token }));

  state.ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    switch (d.type) {
      case 'users': state.users = d.users; renderUsers(); break;
      case 'history':
        if (d.roomId !== state.room) break;
        $('messages').innerHTML = '';
        state.lastDay = null;
        d.messages.forEach(addMessage);
        scrollBottom();
        break;
      case 'message': addMessage(d.message); break;
      case 'typing': showTyping(d); break;
      case 'rename-result':
        if (d.approved && state.me) { state.me.displayName = d.displayName; renderMyAvatar(); }
        alert(d.approved ? 'درخواست تغییر نام تایید شد ✅' : 'درخواست تغییر نام رد شد ❌');
        break;
      case 'kicked': alert('حساب شما توسط ادمین مسدود شد'); logout(); break;
      case 'error': alert(d.text); break;
      case 'auth-failed': logout(); break;
    }
  };

  state.ws.onclose = () => setTimeout(() => { if (state.token) connectWS(); }, 2500);
}

/* ================= ROOMS & USERS ================= */
function dmRoom(u) { return 'dm:' + [state.me.username, u.username].sort().join('|'); }

function renderUsers() {
  const ul = $('user-list');
  ul.innerHTML = '';

  const bot = document.createElement('li');
  bot.innerHTML = `<span class="presence on"></span>
    <span class="avatar sm" style="background:linear-gradient(135deg,var(--accent),var(--primary))">V</span>
    <span class="grow">${BOT_NAME}</span>
    <span class="badge-admin">AI</span>`;
  bot.onclick = () => openRoom('dm:' + [state.me.username, BOT_USERNAME].sort().join('|'), BOT_NAME);
  ul.appendChild(bot);

  state.users.filter((u) => u.username !== state.me.username).forEach((u) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="presence ${u.banned ? '' : 'on'}"></span>
      <span class="avatar sm">${initial(u.displayName)}</span>
      <span class="grow">${esc(u.displayName)}</span>
      ${u.isAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}`;
    li.onclick = () => openRoom(dmRoom(u), u.displayName);
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = '<li class="empty">فقط تو آنلاین هستی 🌙</li>';
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function renderMyAvatar() {
  $('my-avatar').textContent = initial(state.me.displayName || state.me.username);
  $('room-general').classList.toggle('active', state.room === 'general');
}

function openRoom(roomId, title) {
  state.room = roomId;
  $('chat-title').textContent = title;
  $('messages').innerHTML = '';
  state.lastDay = null;
  $('room-general').classList.toggle('active', roomId === 'general');
  state.ws.send(JSON.stringify({ type: 'history', roomId }));
}
$('room-general').onclick = () => openRoom('general', 'گروه عمومی');

/* ================= MESSAGES ================= */
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function fmtTime(t) { return new Date(t).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); }

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

  let body = '';
  if (m.kind === 'text') body = esc(m.content);
  else if (m.kind === 'sticker') body = esc(m.content);
  else if (m.kind === 'image' || m.kind === 'gif') body = `<img class="media" src="${esc(m.url)}" alt="${esc(m.name || '')}" loading="lazy" />`;
  else if (m.kind === 'video') body = `<video class="media" src="${esc(m.url)}" controls preload="metadata"></video>`;
  else if (m.kind === 'audio') body = `<audio src="${esc(m.url)}" controls></audio>`;
  else if (m.kind === 'file') body = `<a class="file-chip" href="${esc(m.url)}" download="${esc(m.name || '')}">📄 <span>${esc(m.name || 'فایل')}</span> <small>دانلود</small></a>`;

  const head = mine ? '' : `<span class="from">${esc(m.fromName)}</span>`;
  div.innerHTML = `${head}${body}<span class="meta">${fmtTime(m.time)}</span>`;
  $('messages').appendChild(div);
  scrollBottom();
}

function scrollBottom() { const el = $('messages'); el.scrollTop = el.scrollHeight; }

/* ================= SENDING ================= */
function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ ...obj, roomId: state.room }));
}

function sendText() {
  const text = $('msg-input').value.trim();
  if (!text) return;
  send({ type: 'message', kind: 'text', content: text });
  $('msg-input').value = '';
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
      b.onclick = () => { send({ type: 'message', kind: el.id === 'emoji-picker' ? 'text' : 'sticker', content: ch }); togglePicker(el, false); };
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
  const f = $('file-input').files[0];
  if (!f) return;
  if (f.size > 30 * 1024 * 1024) { alert('حداکثر حجم ۳۰ مگابایت'); return; }
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    send({ type: 'message', kind: data.kind, url: data.url, mime: data.mime, name: data.name, content: '' });
  } catch (e) { alert(e.message); }
  $('file-input').value = '';
};

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
      $('rename-status').textContent = 'به‌عنوان ادمین مستقیم اعمال شد ✅';
    } else {
      $('rename-status').textContent = 'درخواست ثبت شد؛ بعد از تایید ادمین اعمال می‌شود ⏳';
    }
  } catch (e) { $('rename-status').textContent = e.message; }
};

/* ================= ADMIN MODAL ================= */
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token, ...(opts.headers || {}) } });

$('admin-btn').onclick = async () => {
  $('admin-modal').classList.remove('hidden');
  loadAdmin();
};

async function loadAdmin() {
  const rq = $('admin-requests'), us = $('admin-users');
  rq.innerHTML = '<li class="empty">...</li>'; us.innerHTML = '<li class="empty">...</li>';
  const [reqRes, usrRes] = await Promise.all([api('/api/admin/requests'), api('/api/admin/users')]);
  const reqs = (await reqRes.json()).requests || [];
  const users = (await usrRes.json()).users || [];

  rq.innerHTML = '';
  if (!reqs.length) rq.innerHTML = '<li class="empty">درخواستی نیست</li>';
  reqs.forEach((r) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="grow">${esc(r.username)}: <b>${esc(r.oldName)}</b> ← <b style="color:var(--secondary)">${esc(r.newName)}</b></span>`;
    const ok = mkBtn('✔', 'mini-btn ok', async () => { await api(`/api/admin/requests/${r.id}`, { method: 'POST', body: JSON.stringify({ approve: true }) }); loadAdmin(); });
    const no = mkBtn('✖', 'mini-btn no', async () => { await api(`/api/admin/requests/${r.id}`, { method: 'POST', body: JSON.stringify({ approve: false }) }); loadAdmin(); });
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
    if (!u.isAdmin) {
      const banBtn = mkBtn(u.banned ? 'رفع مسدودی' : 'مسدودسازی', u.banned ? 'mini-btn ok' : 'mini-btn no',
        async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u.username, banned: !u.banned }) }); loadAdmin(); });
      li.appendChild(banBtn);
    }
    us.appendChild(li);
  });
}
function mkBtn(text, cls, fn) {
  const b = document.createElement('button');
  b.textContent = text; b.className = cls; b.style.fontSize = '11px'; b.style.padding = '6px 10px';
  b.onclick = fn;
  return b;
}

/* close modals */
document.querySelectorAll('.modal-close').forEach((b) => {
  b.onclick = () => $(b.dataset.close).classList.add('hidden');
});
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
});

/* ================= BOOT ================= */
(async () => {
  if (await tryResume()) enterApp();
})();