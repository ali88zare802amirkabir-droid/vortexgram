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

  state.ws.onopen = () => state.ws.send(JSON.stringify({ type: 'auth', token: state.token }));

  state.ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    switch (d.type) {
      case 'ready':
        if (d.groups) { state.groups = d.groups; renderGroups(); }
        break;
      case 'users': state.users = d.users; renderUsers(); showEmptyHint(); break;
      case 'groups': state.groups = d.groups; renderGroups(); updateComposerLock(); break;
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
      case 'premium-changed':
        if (state.me) {
          state.me.isPremium = d.isPremium;
          renderMyAvatar();
          applyTierLimits();
          alert(d.isPremium ? '🌟 تبریک! حساب شما پرمیوم شد' : 'عضویت پرمیوم شما لغو شد');
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

function contactLi(username, displayName, isOnline) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="presence ${isOnline ? 'on' : ''}"></span>
    <span class="avatar sm" data-av>${esc(initial(displayName))}</span>
    <span class="grow">${esc(displayName)} <small>@${esc(username)}</small></span>`;
  li.onclick = () => openRoom(dmRoom({ username }), displayName);
  return li;
}

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

  if (state.me.isAdmin) {
    state.users.filter((u) => u.username !== state.me.username).forEach((u) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="presence ${u.online && !u.banned ? 'on' : ''}"></span>
        <span class="avatar sm" data-av></span>
        <span class="grow">${esc(u.displayName)}${u.isPremium ? premiumBadge() : ''} <small>@${esc(u.username)}${u.online ? '' : ' — آفلاین'}</small></span>
        ${u.isAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}`;
      setAvatar(li.querySelector('[data-av]'), { ...u, isPremium: u.isPremium });
      li.onclick = () => openRoom(dmRoom(u), u.displayName);
      ul.appendChild(li);
    });
  } else {
    const contacts = getContacts();
    Object.entries(contacts).forEach(([username, displayName]) => {
      ul.appendChild(contactLi(username, displayName, false));
    });
    if (!Object.keys(contacts).length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'مخاطبی نداری — با @آیدی اضافه کن';
      ul.appendChild(li);
    }
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
$('menu-btn').onclick = () => $('sidebar').classList.toggle('open');
document.addEventListener('click', (e) => {
  const sb = $('sidebar');
  if (sb.classList.contains('open') && !sb.contains(e.target) && e.target.id !== 'menu-btn' && !$('menu-btn').contains(e.target)) {
    sb.classList.remove('open');
  }
});
$('reply-cancel').onclick = clearReply;

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

function premiumBadge() { return ' <span class="badge-premium">⭐</span>'; }

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
  state.room = roomId;
  state.roomTitle = title;
  $('chat-title').textContent = title;
  $('messages').innerHTML = '';
  $('empty-hint')?.remove();
  state.lastDay = null;
  clearReply();
  const isDmHuman = roomId.startsWith('dm:') && !roomId.includes(BOT_USERNAME);
  $('call-btn').classList.toggle('hidden', !isDmHuman);
  const g = currentGroup();
  $('group-settings-btn').classList.toggle('hidden', !(g && g.joined));
  updateComposerLock();
  state.ws.send(JSON.stringify({ type: 'history', roomId }));
}

function groupIcon(g) { return g.type === 'channel' ? '📢' : '👥'; }

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
  $('msg-input').placeholder = ok ? 'پیام خود را مخابره کن...' : '📢 در کانال فقط مدیران می‌توانند پیام بفرستند';
}

function renderGroups() {
  const ul = $('group-list');
  ul.innerHTML = '';
  state.groups.forEach((g) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="avatar sm" style="border-radius:10px;background:linear-gradient(135deg,#0ea5e9,var(--primary))">${g.type === 'channel' ? '📢' : '👥'}</span>
      <span class="grow">${esc(g.name)} <small>${g.members} عضو${g.joined ? '' : ' — برای ورود کلیک کن'}</small></span>
      ${g.joined && g.myRole === 'owner' ? '<span class="badge-admin">OWNER</span>' : ''}
      ${g.joined && g.myRole === 'admin' ? '<span class="badge-admin" style="background:#0ea5e9">ADMIN</span>' : ''}`;
    li.onclick = async () => {
      if (!g.joined) {
        await api(`/api/groups/${g.id}/join`, { method: 'POST' });
        g.joined = true;
        g.myRole = 'member';
        updateComposerLock();
      }
      openRoom('group:' + g.id, `${groupIcon(g)} ${g.name}`);
    };
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = '<li class="empty">گروهی نیست — با + بساز</li>';
}

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

  $('gs-title').textContent = `${group.type === 'channel' ? '📢 کانال' : '👥 گروه'} «${group.name}»`;
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
        const roleBtn = mkBtn(m.role === 'member' ? '⬆ ادمین کن' : '⬇ عزل از ادمینی', m.role === 'member' ? 'mini-btn ok' : 'mini-btn no',
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

  let body = '';
  if (m.kind === 'text') body = `<span class="msg-body">${esc(m.content)}</span>`;
  else if (m.kind === 'sticker') body = esc(m.content);
  else if (m.kind === 'image' || m.kind === 'gif') body = `<img class="media" src="${esc(m.url)}" alt="${esc(m.name || '')}" loading="lazy" />`;
  else if (m.kind === 'video') body = `<video class="media" src="${esc(m.url)}" controls preload="metadata"></video>`;
  else if (m.kind === 'audio') body = `<audio src="${esc(m.url)}" controls></audio>`;
  else if (m.kind === 'file') body = `<a class="file-chip" href="${esc(m.url)}" download="${esc(m.name || '')}">📄 <span>${esc(m.name || 'فایل')}</span> <small>دانلود</small></a>`;

  const head = mine ? '' : `<span class="from">${esc(m.fromName)}${m.fromPremium ? premiumBadge() : ''}</span>`;
  div.innerHTML = `${head}${body}<span class="meta">${fmtTime(m.time)}${m.edited ? ' <span class="edited-tag">(ویرایش شد)</span>' : ''}</span>`;

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
  const replyBtn = document.createElement('button');
  replyBtn.textContent = '↩'; replyBtn.title = 'پاسخ';
  replyBtn.onclick = () => setReplyTo(m);
  acts.appendChild(replyBtn);
  if (mine && m.kind === 'text') {
    const editBtn = document.createElement('button');
    editBtn.textContent = '✎'; editBtn.title = 'ویرایش';
    editBtn.onclick = () => {
      const nv = prompt('ویرایش پیام:', m.content);
      if (nv && nv.trim() && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'edit-message', roomId: m.roomId, id: m.id, content: nv.trim() }));
      }
    };
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑'; delBtn.title = 'حذف';
    delBtn.onclick = () => {
      if (confirm('این پیام حذف شود؟') && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'delete-message', roomId: m.roomId, id: m.id }));
      }
    };
    acts.append(editBtn, delBtn);
  }
  div.appendChild(acts);

  $('messages').appendChild(div);
  scrollBottom();
}

function scrollBottom() { const el = $('messages'); el.scrollTop = el.scrollHeight; }

function showEmptyHint() {
  if (state.room || $('messages').children.length) return;
  if ($('empty-hint')) return;
  const div = document.createElement('div');
  div.id = 'empty-hint';
  div.className = 'system-note';
  div.textContent = 'برای شروع، از لیست کنار یک نفر (یا Vortex AI) را انتخاب کن 👋';
  $('messages').appendChild(div);
}

/* ================= SENDING ================= */
function send(obj) {
  if (!state.room) return;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ ...obj, roomId: state.room }));
}

function sendText() {
  const text = $('msg-input').value.trim();
  if (!text) return;
  send({ type: 'message', kind: 'text', content: text, replyTo: state.replyTo || undefined });
  $('msg-input').value = '';
  clearReply();
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
$('file-input').onchange = () => {
  const f = $('file-input').files[0];
  if (!f) return;
  const maxMB = state.me.isPremium ? 100 : 30;
  if (f.size > maxMB * 1024 * 1024) {
    alert(`حداکثر ${maxMB} مگابایت` + (state.me.isPremium ? '' : ' — با پرمیوم تا ۱۰۰ مگ'));
    $('file-input').value = '';
    return;
  }
  uploadWithProgress(f);
};

function uploadWithProgress(file) {
  const fd = new FormData();
  fd.append('file', file);
  const xhr = new XMLHttpRequest();
  $('upload-progress').classList.remove('hidden');
  $('up-name').textContent = '⬆ ' + file.name;
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
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status !== 200) throw new Error(data.error || 'خطا در آپلود');
      send({ type: 'message', kind: data.kind, url: data.url, mime: data.mime, name: data.name, content: '', replyTo: state.replyTo || undefined });
      clearReply();
    } catch (err) { alert(err.message); }
  };
  xhr.onerror = () => { $('upload-progress').classList.add('hidden'); alert('آپلود قطع شد'); };
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
  xhr.send(fd);
  $('file-input').value = '';
}

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
  if (state.me.isAdmin) p.textContent = '👑 ادمین سیستم — همه امکانات';
  else if (state.me.isPremium) p.textContent = '⭐ پرمیوم: آپلود ۱۰۰مگ + پیام ۴۰۰۰ نویسه + بیو بلند + ساخت ۱۰ گروه/کانال + نشان طلایی';
  else p.textContent = 'رایگان: آپلود ۳۰مگ + پیام ۷۰۰ نویسه + ۲ گروه — پرمیوم از ادمین بگیر ⭐';
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
    $('rename-status').textContent = 'بیو ذخیره شد ✅';
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
      $('rename-status').textContent = 'به‌عنوان ادمین مستقیم اعمال شد ✅';
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
    const ok = mkBtn('✔ تایید', 'mini-btn ok', async () => {
      await api(`/api/admin/signups/${s.id}`, { method: 'POST', body: JSON.stringify({ approve: true }) });
      loadAdmin();
    });
    const no = mkBtn('✖ رد', 'mini-btn no', async () => {
      await api(`/api/admin/signups/${s.id}`, { method: 'POST', body: JSON.stringify({ approve: false }) });
      loadAdmin();
    });
    li.append(ok, no);
    su.appendChild(li);
  });

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
    if (u.username !== state.me.username) {
      li.appendChild(mkBtn('💬 چت‌ها', 'mini-btn', async () => openAdminChats(u.username, u.displayName)));
    }
    if (!u.isAdmin) {
      const banBtn = mkBtn(u.banned ? 'رفع مسدودی' : 'مسدودسازی', u.banned ? 'mini-btn ok' : 'mini-btn no',
        async () => { await api('/api/admin/ban', { method: 'POST', body: JSON.stringify({ username: u.username, banned: !u.banned }) }); loadAdmin(); });
      li.appendChild(banBtn);
      const premBtn = mkBtn(u.isPremium ? 'لغو پرمیوم' : '⭐ پرمیوم کن', u.isPremium ? 'mini-btn no' : 'mini-btn prem',
        async () => { await api('/api/admin/premium', { method: 'POST', body: JSON.stringify({ username: u.username, isPremium: !u.isPremium }) }); loadAdmin(); });
      li.appendChild(premBtn);
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

/* ---- admin: read users' chats ---- */
async function openAdminChats(username, displayName) {
  $('admin-main').classList.add('hidden');
  $('admin-chats').classList.remove('hidden');
  $('ac-msgs').classList.add('hidden');
  $('ac-msgs').innerHTML = '';
  $('ac-title').textContent = `💬 چت‌های ${displayName}`;
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
    else if (m.kind === 'audio') body = `<audio src="${esc(m.url)}" controls></audio>`;
    else if (m.kind === 'file') body = `<a class="file-chip" href="${esc(m.url)}">📄 ${esc(m.name || 'فایل')}</a>`;
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
const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) endCall(true);
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
  $('screen-btn').textContent = '🖥 اشتراک صفحه';
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
  $('mute-btn').textContent = state.call.muted ? '🎤 وصل صدا' : '🎤 قطع صدا';
};

$('screen-btn').onclick = async () => {
  if (!state.call?.pc) return;
  try {
    if (state.call.screenStream) {
      state.call.screenStream.getTracks().forEach((t) => t.stop());
      state.call.screenStream = null;
      const sender = state.call.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(null);
      $('screen-btn').textContent = '🖥 اشتراک صفحه';
      return;
    }
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.call.screenStream = screen;
    let sender = state.call.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) sender = state.call.pc.addTrack(screen.getVideoTracks()[0], screen);
    else await sender.replaceTrack(screen.getVideoTracks()[0]);
    screen.getVideoTracks()[0].onended = () => { $('screen-btn').click(); };
    $('screen-btn').textContent = '⏹ قطع اشتراک';
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