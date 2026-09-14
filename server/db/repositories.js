// VORTEXGRAM — repository layer: 1:1 row mapping between the runtime in-memory
// `db` object and the normalized PostgreSQL schema (migrations/0001_init).
//
// buildAll(data)   -> plain-row batches for every table (used by save()).
// insertAll(client) -> batch-inserts those rows inside the caller's transaction.
// loadAll(exec)     -> materializes the full `db` object from the tables.
//
// Round-trip guarantee: loadAll(buildAll(db)) reproduces the same runtime object
// (key set included), so server.js never changes regardless of backend.

const MODELED_KEYS = new Set(['users', 'groups', 'messages', 'pinned', 'scheduled', 'readState', 'chatState', 'renameRequests', 'sessions']);
const INTERNAL_KV = new Set(['__group_ids__', '__stub_users__', '__chat_empty__']);
const MEDIA_KINDS = new Set(['image', 'gif', 'video', 'audio', 'voice', 'file']);

// ---------------------------------------------------------------------------
// Save side — runtime object -> normalized rows
// ---------------------------------------------------------------------------

function num(v) { return (v === undefined || v === null || Number.isNaN(v)) ? null : Number(v); }
const text = (v) => (v === undefined || v === null ? null : String(v));
const bool = (v) => !!v;
const jstr = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

function buildAll(data) {
  data = data || {};
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.groups)) data.groups = [];
  if (!data.messages || typeof data.messages !== 'object') data.messages = {};
  if (!data.pinned || typeof data.pinned !== 'object') data.pinned = {};
  if (!Array.isArray(data.scheduled)) data.scheduled = [];
  if (!Array.isArray(data.renameRequests)) data.renameRequests = [];
  const readState = (data.readState && typeof data.readState === 'object') ? data.readState : {};
  const chatState = (data.chatState && typeof data.chatState === 'object') ? data.chatState : {};
  const sessions = (data.sessions && typeof data.sessions === 'object') ? data.sessions : {};

  const users = [];
  const convRows = [];
  const convMap = new Map(); // roomId -> {type,title,avatar,owner,createdAt}
  const memberRows = [];
  const memberSeen = new Set();
  const msgRows = [];
  const attachRows = [];
  const reactRows = new Map();
  const roomEarliest = new Map();

  // --- users --------------------------------------------------------------
  for (const u of data.users) {
    if (!u || !u.username) continue;
    users.push([
      u.username, text(u.phone), text(u.displayName) || u.username, text(u.avatar),
      text(u.salt), text(u.passHash), text(u.bio),
      bool(u.isAdmin), bool(u.isPremium), bool(u.banned),
      text(u.activeSkin), text(u.profileEffect), text(u.profileEffectColor), text(u.profileBg),
      Array.isArray(u.blocked) ? u.blocked : [], num(u.createdAt), num(u.lastSeen), num(u.updatedAt),
    ]);
  }
  const knownUsers = new Set(data.users.map((u) => u && u.username));

  // --- conversations (groups first = authoritative) -----------------------
  const groupRoomIds = [];
  for (const g of data.groups) {
    if (!g || !g.id) continue;
    const roomId = 'group:' + g.id;
    convMap.set(roomId, {
      type: (g.type === 'channel' ? 'channel' : 'group'),
      title: text(g.name) || '', avatar: text(g.avatar), owner: text(g.owner),
      createdAt: num(g.createdAt) || Date.now(),
    });
    groupRoomIds.push(roomId);
  }
  const addRoom = (id) => {
    if (!id || typeof id !== 'string' || convMap.has(id)) return;
    if (id.startsWith('dm:')) convMap.set(id, { type: 'dm', title: null, avatar: null, owner: null, createdAt: null });
    else convMap.set(id, { type: 'group', title: null, avatar: null, owner: null, createdAt: null });
  };
  for (const id of Object.keys(data.messages)) addRoom(id);
  for (const id of Object.keys(data.pinned)) addRoom(id);
  for (const id of Object.keys(readState)) addRoom(id);
  for (const rooms of Object.values(chatState)) if (rooms && typeof rooms === 'object') for (const id of Object.keys(rooms)) addRoom(id);
  for (const s of data.scheduled) if (s && s.roomId) addRoom(s.roomId);

  const addMember = (roomId, username, role) => {
    if (!username) return;
    const key = roomId + '\u0000' + username;
    if (memberSeen.has(key)) return;
    memberSeen.add(key);
    memberRows.push([roomId, username, text(role), null, null]);
  };
  for (const g of data.groups) {
    if (!g || !g.id) continue;
    const roomId = 'group:' + g.id;
    addMember(roomId, g.owner, 'owner');
    for (const m of (g.members || [])) addMember(roomId, m && text(m.username), (m && m.role) || (m && text(m.username) === g.owner ? 'owner' : 'member'));
    // keep chronological rows at group birth
  }

  for (const roomId of convMap.keys()) {
    if (!roomId.startsWith('dm:')) continue;
    for (const p of roomId.split('|').slice(1)) if (p) addMember(roomId, p, null);
  }

  for (const g of data.groups) {
    if (!g || !g.id) continue;
    const roomId = 'group:' + g.id;
    const ts = num(g.createdAt) || Date.now();
    if (convMap.has(roomId)) convMap.get(roomId).createdAt = ts;
    for (const m of (g.members || [])) {
      const key = roomId + '\u0000' + text(m && m.username);
      const idx = memberRows.findIndex((r) => r[0] === roomId && r[1] === text(m && m.username));
      if (idx >= 0) memberRows[idx][3] = ts;
    }
  }

  // --- messages, attachments, reactions ------------------------------------
  const allMsgIds = new Set();
  const rawReplies = [];
  for (const arr of Object.values(data.messages)) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (!m || !m.id) continue;
      allMsgIds.add(m.id);
      const t = num(m.time) || 0;
      if (!roomEarliest.has(m.roomId) || t < roomEarliest.get(m.roomId)) roomEarliest.set(m.roomId, t);
      const poll = jstr(m.poll);
      const checklist = jstr(m.checklist);
      if (Array.isArray(m.album)) {
        m.album.forEach((url, i) => {
          attachRows.push(['att-' + m.id + '-' + i, m.id, 'album', String(url), null, null, null, null, null, i, num(m.time) || 0]);
        });
      } else if (MEDIA_KINDS.has(m.kind) && m.url) {
        attachRows.push([
          m.id + '#0', m.id, text(m.kind) || 'file', text(m.url), text(m.name),
          num(m.size), text(m.mime), m.duration === undefined || m.duration === null ? null : Number(m.duration),
          Array.isArray(m.wave) ? m.wave.map(Number) : null, 0, num(m.time) || 0,
        ]);
      }
      for (const [emoji, usernames] of Object.entries(m.reactions || {})) {
        if (!Array.isArray(usernames)) continue;
        for (const uname of usernames) {
          if (!uname) continue;
          reactRows.set(m.id + '\u0000' + uname, [m.id, uname, String(emoji), num(m.time) || 0, num(m.time) || 0]);
        }
      }
      rawReplies.push([m, text(m.replyTo && m.replyTo.id)]);
    }
  }

  for (const [m, replyToId] of rawReplies) {
    const t = num(m.time) || 0;
    msgRows.push([
      m.id, text(m.roomId), text(m.from), text(m.fromName),
      text(m.fromAvatar), bool(m.fromPremium), text(m.kind) || 'text', text(m.content) || '',
      bool(m.silent), text(m.fwdFrom), bool(m.edited),
      replyToId, allMsgIds.has(replyToId) ? replyToId : null,
      text(m.replyTo && m.replyTo.name), text(m.replyTo && m.replyTo.snippet),
      m.poll !== undefined ? jstr(m.poll) : null,
      m.checklist !== undefined ? jstr(m.checklist) : null,
      Array.isArray(m.album) ? m.album : null,
      t, num(m.editedAt) || null, null,
    ]);
  }

  for (const g of data.groups) { // rooms always exist for groups even if empty of messages
    if (!g || !g.id || !roomEarliest.has('group:' + g.id)) roomEarliest.set('group:' + g.id, num(g.createdAt) || Date.now());
  }

  for (const [roomId, info] of convMap) {
    convRows.push([roomId, info.type, info.title, info.avatar, info.owner, null, info.createdAt || roomEarliest.get(roomId) || Date.now(), null]);
  }

  // --- read_state / chat_state / pinned / scheduled / rename / sessions ----
  const readStateRows = [];
  for (const [roomId, readers] of Object.entries(readState)) {
    if (!readers || typeof readers !== 'object') continue;
    for (const [uname, ts] of Object.entries(readers)) readStateRows.push([roomId, uname, num(ts) || 0]);
  }
  const chatStateRows = [];
  const emptyChatUsers = new Set();
  for (const [uname, rooms] of Object.entries(chatState)) {
    if (!rooms || typeof rooms !== 'object' || !Object.keys(rooms).length) {
      if (typeof uname === 'string' && uname) emptyChatUsers.add(uname); // file backend keeps empty {} states as keys
      continue;
    }
    for (const [roomId, flags] of Object.entries(rooms)) chatStateRows.push([uname, roomId, jstr(flags || {})]);
  }
  const pinRows = [];
  for (const [roomId, ids] of Object.entries(data.pinned)) {
    if (!Array.isArray(ids)) continue;
    ids.forEach((id, i) => pinRows.push([roomId, String(id), i]));
  }
  const scheduledRows = [];
  for (const s of data.scheduled) {
    if (!s || !s.id) continue;
    scheduledRows.push([
      s.id, text(s.roomId), text(s.from), text(s.kind) || 'text', text(s.content) || '',
      text(s.url), text(s.name), text(s.mime),
      jstr(s.poll), jstr(s.checklist), num(s.at) || 0, null,
    ]);
  }
  const renameRows = [];
  for (const r of data.renameRequests) {
    if (!r || !r.id) continue;
    renameRows.push([r.id, text(r.username), text(r.oldName) || '', text(r.newName) || '', text(r.status) || 'pending', num(r.at)]);
  }
  const sessionRows = [];
  for (const [token, s] of Object.entries(sessions)) {
    if (token && s) sessionRows.push([token, text(s.username), num(s.exp) || 0, null]);
  }

  // --- stub users (legacy handles referenced in state but w/o a profile row) -
  const referenced = new Set();
  for (const r of convRows) if (r[4]) referenced.add(r[4]);
  for (const r of memberRows) referenced.add(r[1]);
  for (const r of msgRows) referenced.add(r[1]);
  for (const [, r] of reactRows) referenced.add(r[1]);
  for (const r of readStateRows) referenced.add(r[1]);
  for (const r of chatStateRows) referenced.add(r[0]);
  for (const r of scheduledRows) if (r[2]) referenced.add(r[2]);
  for (const r of renameRows) referenced.add(r[1]);
  for (const r of sessionRows) referenced.add(r[1]);
  const stubs = [];
  for (const uname of referenced) {
    if (!uname || knownUsers.has(uname) || users.some((u) => u[0] === uname)) continue;
    stubs.push(uname);
    users.push([uname, null, uname, null, null, null, null, false, false, false, null, null, null, null, [], null, null, null]);
  }

  // --- kv (non-modeled top-level keys + internal bookkeeping) ---------------
  const kvRows = [];
  for (const [k, v] of Object.entries(data)) {
    if (MODELED_KEYS.has(k)) continue;
    let sval;
    try { sval = JSON.stringify(v); } catch { sval = String(v); }
    kvRows.push([k, sval]);
  }
  if (groupRoomIds.length) kvRows.push(['__group_ids__', JSON.stringify(groupRoomIds)]);
  if (emptyChatUsers.size) kvRows.push(['__chat_empty__', JSON.stringify([...emptyChatUsers])]);
  if (stubs.length) kvRows.push(['__stub_users__', JSON.stringify(stubs)]);

  return {
    users, conversations: convRows, members: memberRows, messages: msgRows,
    attachments: attachRows, reactions: [...reactRows.values()],
    readState: readStateRows, chatState: chatStateRows, pinned: pinRows,
    scheduled: scheduledRows, renameRequests: renameRows, sessions: sessionRows, kv: kvRows,
  };
}

// ---------------------------------------------------------------------------
// Batch insert
// ---------------------------------------------------------------------------
async function _insertRows(exec, table, cols, rows) {
  if (!rows.length) return;
  const colNames = cols.map((c) => '"' + c + '"').join(',');
  const CHUNK = 2000;
  for (let s = 0; s < rows.length; s += CHUNK) {
    const chunk = rows.slice(s, s + CHUNK);
    const params = [];
    const values = [];
    chunk.forEach((row, ri) => {
      const base = ri * row.length;
      values.push('(' + row.map((_, ki) => '$' + (base + ki + 1)).join(',') + ')');
      row.forEach((v) => params.push(v));
    });
    await exec.query('INSERT INTO "' + table + '" (' + colNames + ') VALUES ' + values.join(','), params);
  }
}

const TRUNCATE = 'TRUNCATE users, conversations, conversation_members, messages, attachments, message_reactions, message_reads, notifications, read_state, chat_state, pinned, scheduled, rename_requests, sessions, kv';

async function truncateAll(exec) {
  await exec.query(TRUNCATE);
}

async function insertAll(exec, b) {
  // FK-safe order
  await _insertRows(exec, 'users', ['username', 'phone', 'display_name', 'avatar', 'salt', 'pass_hash', 'bio', 'is_admin', 'is_premium', 'banned', 'active_skin', 'profile_effect', 'profile_effect_color', 'profile_bg', 'blocked', 'created_at', 'last_seen', 'updated_at'], b.users);
  await _insertRows(exec, 'conversations', ['id', 'type', 'title', 'avatar', 'owner', 'invite_token', 'created_at', 'updated_at'], b.conversations);
  await _insertRows(exec, 'conversation_members', ['conversation_id', 'user_id', 'role', 'joined_at', 'last_read_message_id'], b.members);
  await _insertRows(exec, 'messages', ['id', 'conversation_id', 'from', 'from_name', 'from_avatar', 'from_premium', 'kind', 'content', 'silent', 'fwd_from', 'edited', 'reply_to_id', 'reply_to_message_id', 'reply_to_name', 'reply_to_snippet', 'poll', 'checklist', 'album', 'time', 'updated_at', 'deleted_at'], b.messages);
  await _insertRows(exec, 'attachments', ['id', 'message_id', 'type', 'url', 'filename', 'size', 'mime_type', 'duration', 'wave', 'sort', 'created_at'], b.attachments);
  await _insertRows(exec, 'message_reactions', ['message_id', 'user_id', 'reaction', 'created_at', 'updated_at'], b.reactions);
  await _insertRows(exec, 'read_state', ['conversation_id', 'user_id', 'ts'], b.readState);
  await _insertRows(exec, 'chat_state', ['username', 'room_id', 'data'], b.chatState);
  await _insertRows(exec, 'pinned', ['room_id', 'msg_id', 'ts'], b.pinned);
  await _insertRows(exec, 'scheduled', ['id', 'conversation_id', 'from_user', 'kind', 'content', 'url', 'name', 'mime_type', 'poll', 'checklist', 'scheduled_for', 'created_at'], b.scheduled);
  await _insertRows(exec, 'rename_requests', ['id', 'username', 'old_name', 'new_name', 'status', 'requested_at'], b.renameRequests);
  await _insertRows(exec, 'sessions', ['token', 'username', 'expires_at', 'created_at'], b.sessions);
  await _insertRows(exec, 'kv', ['key', 'value'], b.kv);
}

// ---------------------------------------------------------------------------
// Load side — normalized rows -> runtime `db` object
// ---------------------------------------------------------------------------
function lnum(v) { return v === null || v === undefined ? null : Number(v); }
const setIf = (obj, key, value) => { if (value !== null && value !== undefined) obj[key] = value; return obj; };

async function loadAll(exec) {
  const db = { users: [], renameRequests: [], messages: {}, groups: [], pinned: {}, scheduled: [], readState: {}, chatState: {} };

  const kvRes = await exec.query('SELECT key, value FROM kv');
  const kvMap = new Map(kvRes.rows.map((r) => [r.key, r.value]));
  const groupRoomIds = new Set(JSON.parse(kvMap.get('__group_ids__') || '[]'));
  const stubUsers = new Set(JSON.parse(kvMap.get('__stub_users__') || '[]'));
  const emptyChatUsers = new Set(JSON.parse(kvMap.get('__chat_empty__') || '[]'));

  // --- users (stub handles excluded from the runtime list) -----------------
  const userRows = (await exec.query('SELECT username, phone, display_name, avatar, salt, pass_hash, bio, is_admin, is_premium, banned, active_skin, profile_effect, profile_effect_color, profile_bg, blocked, created_at, last_seen, updated_at FROM users')).rows;
  const usersById = new Map();
  for (const r of userRows) {
    if (stubUsers.has(r.username)) continue;
    const u = setIf({ username: r.username, displayName: r.display_name }, 'phone', r.phone);
    setIf(u, 'avatar', r.avatar); setIf(u, 'salt', r.salt); setIf(u, 'passHash', r.pass_hash);
    setIf(u, 'bio', r.bio); setIf(u, 'activeSkin', r.active_skin); setIf(u, 'profileEffect', r.profile_effect);
    setIf(u, 'profileEffectColor', r.profile_effect_color); setIf(u, 'profileBg', r.profile_bg);
    u.isAdmin = !!r.is_admin; u.isPremium = !!r.is_premium;
    if (r.banned) u.banned = true;
    if (Array.isArray(r.blocked) && r.blocked.length) u.blocked = r.blocked;
    setIf(u, 'createdAt', lnum(r.created_at)); setIf(u, 'lastSeen', lnum(r.last_seen));
    setIf(u, 'updatedAt', lnum(r.updated_at));
    usersById.set(r.username, r.username);
    db.users.push(u);
  }

  // --- conversations + groups ----------------------------------------------
  const convRes = (await exec.query('SELECT id, type, title, avatar, owner, created_at FROM conversations')).rows;
  const convById = new Map(convRes.map((r) => [r.id, r]));
  const memberRes = (await exec.query('SELECT conversation_id, user_id, role FROM conversation_members ORDER BY conversation_id')).rows;
  const membersByRoom = new Map();
  for (const r of memberRes) {
    if (!membersByRoom.has(r.conversation_id)) membersByRoom.set(r.conversation_id, []);
    membersByRoom.get(r.conversation_id).push({ username: r.user_id, role: r.role });
  }
  for (const roomId of groupRoomIds) {
    const c = convById.get(roomId);
    if (!c) continue;
    const g = { id: roomId.slice('group:'.length), type: c.type, name: c.title || '', owner: c.owner || '' };
    if (c.avatar !== null && c.avatar !== undefined) g.avatar = c.avatar;
    g.members = (membersByRoom.get(roomId) || []).filter((m) => m.username).map((m) => ({ username: m.username, ...(m.role ? { role: m.role } : {}) }));
    setIf(g, 'createdAt', lnum(c.created_at));
    db.groups.push(g);
  }

  // --- messages (+ attachments + reactions + replies) ----------------------
  const msgRes = (await exec.query('SELECT id, conversation_id, "from", from_name, from_avatar, from_premium, kind, content, silent, fwd_from, edited, reply_to_id, reply_to_name, reply_to_snippet, poll, checklist, album, time FROM messages ORDER BY time ASC, id ASC')).rows;
  const attachRes = (await exec.query('SELECT message_id, type, url, filename, size, mime_type, duration, wave FROM attachments ORDER BY sort ASC, id ASC')).rows;
  const reactRes = (await exec.query('SELECT message_id, user_id, reaction FROM message_reactions ORDER BY message_id')).rows;

  const attachmentsByMsg = new Map();
  for (const a of attachRes) {
    if (!attachmentsByMsg.has(a.message_id)) attachmentsByMsg.set(a.message_id, []);
    attachmentsByMsg.get(a.message_id).push(a);
  }
  const reactionsByMsg = new Map();
  for (const r of reactRes) {
    if (!reactionsByMsg.has(r.message_id)) reactionsByMsg.set(r.message_id, []);
    reactionsByMsg.get(r.message_id).push(r);
  }

  for (const row of msgRes) {
    const m = {
      id: row.id, roomId: row.conversation_id,
      from: row.from, fromName: row.from_name, kind: row.kind, content: row.content || '',
      time: Number(row.time),
    };
    setIf(m, 'fromAvatar', row.from_avatar);
    m.fromPremium = !!row.from_premium;
    m.silent = !!row.silent;
    if (row.fwd_from !== null && row.fwd_from !== undefined) m.fwdFrom = row.fwd_from;
    if (row.edited) m.edited = true;

    const imgs = attachmentsByMsg.get(row.id) || [];
    if (row.kind === 'album') {
      if (imgs.length) m.album = imgs.map((a) => a.url);
    } else if (imgs.length) {
      const a = imgs[0];
      m.url = a.url;
      m.src = a.url;
      if (a.filename !== null) m.name = a.filename;
      if (a.size !== null) m.size = Number(a.size);
      if (a.mime_type !== null) m.mime = a.mime_type;
      if (a.duration !== null) m.duration = Number(a.duration);
      if (Array.isArray(a.wave) && a.wave.length) m.wave = a.wave.map(Number);
    }

    if (row.reply_to_id !== null && row.reply_to_id !== undefined) {
      const rt = { id: row.reply_to_id };
      setIf(rt, 'name', row.reply_to_name); setIf(rt, 'snippet', row.reply_to_snippet);
      m.replyTo = rt;
    }
    if (row.poll !== null && row.poll !== undefined) m.poll = row.poll;
    if (row.checklist !== null && row.checklist !== undefined) m.checklist = row.checklist;

    const reacts = reactionsByMsg.get(row.id) || [];
    const map = {};
    for (const r of reacts) (map[r.reaction] = map[r.reaction] || []).push(r.user_id);
    m.reactions = map;

    if (!db.messages[m.roomId]) db.messages[m.roomId] = [];
    db.messages[m.roomId].push(m);
  }

  // --- pinned / read_state / chat_state ------------------------------------
  const pinRes = (await exec.query('SELECT room_id, msg_id FROM pinned ORDER BY ts ASC')).rows;
  for (const r of pinRes) { (db.pinned[r.room_id] = db.pinned[r.room_id] || []).push(r.msg_id); }

  const rsRes = (await exec.query('SELECT conversation_id, user_id, ts FROM read_state')).rows;
  for (const r of rsRes) { (db.readState[r.conversation_id] = db.readState[r.conversation_id] || {})[r.user_id] = Number(r.ts || 0); }

  const csRes = (await exec.query('SELECT username, room_id, data FROM chat_state')).rows;
  for (const r of csRes) { (db.chatState[r.username] = db.chatState[r.username] || {})[r.room_id] = r.data; }
  for (const uname of emptyChatUsers) if (!db.chatState[uname]) db.chatState[uname] = {};

  // --- scheduled / rename_requests / sessions ------------------------------
  const schRes = (await exec.query('SELECT id, conversation_id, from_user, kind, content, url, name, mime_type, poll, checklist, scheduled_for FROM scheduled')).rows;
  for (const r of schRes) {
    const s = setIf({ id: r.id, roomId: r.conversation_id }, 'from', r.from_user);
    s.kind = r.kind; s.content = r.content || ''; setIf(s, 'url', r.url); setIf(s, 'name', r.name);
    setIf(s, 'mime', r.mime_type); setIf(s, 'poll', r.poll); setIf(s, 'checklist', r.checklist);
    setIf(s, 'at', lnum(r.scheduled_for));
    db.scheduled.push(s);
  }

  const rnRes = (await exec.query('SELECT id, username, old_name, new_name, status, requested_at FROM rename_requests')).rows;
  for (const r of rnRes) {
    const rr = { id: r.id, username: r.username };
    setIf(rr, 'oldName', r.old_name);
    setIf(rr, 'newName', r.new_name);
    setIf(rr, 'status', r.status);
    setIf(rr, 'at', lnum(r.requested_at));
    db.renameRequests.push(rr);
  }

  const sessRes = (await exec.query('SELECT token, username, expires_at FROM sessions')).rows;
  const sessionsObj = {};
  for (const r of sessRes) sessionsObj[r.token] = { username: r.username, exp: Number(r.expires_at || 0) };
  if (Object.keys(sessionsObj).length) db.sessions = sessionsObj;

  // --- kv extras (signupRequests, tmpAdminFlag, future keys) ----------------
  for (const [k, v] of kvMap) {
    if (MODELED_KEYS.has(k) || INTERNAL_KV.has(k) || k in db) continue;
    let parsed; try { parsed = JSON.parse(v); } catch { parsed = v; }
    db[k] = parsed;
  }

  return db;
}

module.exports = { buildAll, insertAll, truncateAll, loadAll, MODELED_KEYS, INTERNAL_KV, MEDIA_KINDS };