// VORTEXGRAM — Persistent database layer (PostgreSQL)
// Stores EVERYTHING (users, messages, groups, reactions, read state, pins,
// scheduled msgs, rename requests, sessions, chat prefs) in proper relational
// tables. Layer is fully autonomous: schema auto-creates on first boot and any
// pre-existing KV snapshot is migrated automatically.
//
// The in-memory `db` object remains the single source of truth at runtime;
// save() synchronizes it to Postgres transactionally (single writer).

const { Pool } = require('pg');

let pool = null;
let healthy = false;
let queue = Promise.resolve();

function _poolCfg() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const cfg = { connectionString: url, max: 4, connectionTimeoutMillis: 12000, idleTimeoutMillis: 30000 };
  if (!/sslmode=disable/.test(url)) cfg.ssl = { rejectUnauthorized: false };
  return cfg;
}

function _makePool() {
  const cfg = _poolCfg();
  if (!cfg) return null;
  const p = new Pool(cfg);
  p.on('error', (e) => console.error('DB pool error:', e.message));
  return p;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
// Every entity keeps its full canonical object in a `data` JSONB column
// (guarantees NOTHING is ever lost), plus a few real columns for indexing and
// ad-hoc querying.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    phone TEXT,
    display_name TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT,
    last_seen BIGINT,
    data JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    owner TEXT,
    created_at BIGINT,
    data JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    from_user TEXT,
    time BIGINT,
    data JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, time)`,
  `CREATE TABLE IF NOT EXISTS read_state (
    room_id TEXT NOT NULL,
    username TEXT NOT NULL,
    ts BIGINT NOT NULL,
    PRIMARY KEY (room_id, username)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_state (
    username TEXT NOT NULL,
    room_id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (username, room_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pinned (
    room_id TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    PRIMARY KEY (room_id, msg_id)
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    at BIGINT,
    data JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rename_requests (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT,
    expires_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

const TRUNCATE = 'TRUNCATE users, groups, messages, read_state, chat_state, pinned, scheduled, rename_requests, sessions, kv';

const MODELED_KEYS = new Set(['users', 'groups', 'messages', 'pinned', 'scheduled', 'readState', 'chatState', 'renameRequests', 'sessions']);

async function _ensureSchema(p) {
  for (const ddl of SCHEMA) await p.query(ddl);
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------
async function _insertRows(p, table, cols, rows) {
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
    await p.query('INSERT INTO "' + table + '" (' + colNames + ') VALUES ' + values.join(','), params);
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------
const j = (v) => (v === undefined ? null : (v && typeof v === 'object' ? JSON.stringify(v) : v));

function userRow(u) {
  return [u.username, u.phone || null, u.displayName || u.username, !!u.isAdmin, !!u.isPremium, !!u.banned, u.createdAt || Date.now(), u.lastSeen || null, j(u)];
}
function groupRow(g) {
  return [g.id, g.name || '', g.type || 'group', g.owner || '', g.createdAt || Date.now(), j(g)];
}
function messageRow(m) {
  return [m.id, m.roomId, m.from || null, m.time || 0, j(m)];
}
function scheduledRow(s) {
  return [s.id, s.roomId || null, s.at || 0, j(s)];
}
function renameRow(r) {
  return [r.id, j(r)];
}

async function _doSave(data) {
  if (!healthy) { console.error('DB not healthy yet, skipping save'); return; }
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(TRUNCATE);

    await _insertRows(client, 'users', ['username', 'phone', 'display_name', 'is_admin', 'is_premium', 'banned', 'created_at', 'last_seen', 'data'], data.users.map(userRow));
    await _insertRows(client, 'groups', ['id', 'name', 'type', 'owner', 'created_at', 'data'], data.groups.map(groupRow));

    const msgRows = [];
    for (const [roomId, arr] of Object.entries(data.messages)) {
      if (!Array.isArray(arr)) continue;
      for (const m of arr) { if (m && m.id) { try { msgRows.push(messageRow(m)); } catch {} } }
    }
    await _insertRows(client, 'messages', ['id', 'room_id', 'from_user', 'time', 'data'], msgRows);

    const rsRows = [];
    for (const [roomId, readers] of Object.entries(readState)) {
      if (!readers || typeof readers !== 'object') continue;
      for (const [uname, ts] of Object.entries(readers)) rsRows.push([roomId, uname, ts || 0]);
    }
    await _insertRows(client, 'read_state', ['room_id', 'username', 'ts'], rsRows);

    const csRows = [];
    for (const [uname, rooms] of Object.entries(chatState)) {
      if (!rooms || typeof rooms !== 'object') continue;
      for (const [roomId, flags] of Object.entries(rooms)) csRows.push([uname, roomId, j(flags || {})]);
    }
    await _insertRows(client, 'chat_state', ['username', 'room_id', 'data'], csRows);

    const pinRows = [];
    for (const [roomId, ids] of Object.entries(data.pinned)) {
      if (Array.isArray(ids)) for (const id of ids) pinRows.push([roomId, String(id)]);
    }
    await _insertRows(client, 'pinned', ['room_id', 'msg_id'], pinRows);

    await _insertRows(client, 'scheduled', ['id', 'room_id', 'at', 'data'], data.scheduled.filter((s) => s && s.id).map(scheduledRow));
    await _insertRows(client, 'rename_requests', ['id', 'data'], data.renameRequests.filter((r) => r && r.id).map(renameRow));

    const sessRows = [];
    for (const [token, s] of Object.entries(sessions)) {
      if (token && s) sessRows.push([token, s.username || null, (s.exp || 0)]);
    }
    await _insertRows(client, 'sessions', ['token', 'username', 'expires_at'], sessRows);

    const kvRows = [];
    for (const [k, v] of Object.entries(data)) {
      if (MODELED_KEYS.has(k)) continue;
      let sval;
      try { sval = JSON.stringify(v); } catch { sval = String(v); }
      kvRows.push([k, sval]);
    }
    await _insertRows(client, 'kv', ['key', 'value'], kvRows);

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Read back — materialize the full `db` object
// ---------------------------------------------------------------------------
async function _loadFromTables() {
  const db = { users: [], renameRequests: [], messages: {}, groups: [], pinned: {}, scheduled: [], readState: {}, chatState: {} };

  const ur = await pool.query('SELECT data FROM users');
  for (const row of ur.rows) { try { db.users.push(row.data); } catch {} }

  const gr = await pool.query('SELECT data FROM groups');
  for (const row of gr.rows) { try { db.groups.push(row.data); } catch {} }

  const mr = await pool.query('SELECT room_id, data FROM messages ORDER BY time ASC');
  for (const row of mr.rows) {
    try {
      const m = row.data;
      if (!db.messages[m.roomId]) db.messages[m.roomId] = [];
      db.messages[m.roomId].push(m);
    } catch {}
  }

  const pr = await pool.query('SELECT room_id, msg_id FROM pinned');
  for (const row of pr.rows) {
    if (!db.pinned[row.room_id]) db.pinned[row.room_id] = [];
    db.pinned[row.room_id].push(row.msg_id);
  }

  const rr = await pool.query('SELECT room_id, username, ts FROM read_state');
  for (const row of rr.rows) {
    if (!db.readState[row.room_id]) db.readState[row.room_id] = {};
    db.readState[row.room_id][row.username] = Number(row.ts || 0);
  }

  const cr = await pool.query('SELECT username, room_id, data FROM chat_state');
  for (const row of cr.rows) {
    if (!db.chatState[row.username]) db.chatState[row.username] = {};
    db.chatState[row.username][row.room_id] = row.data;
  }

  const sr = await pool.query('SELECT data FROM scheduled');
  for (const row of sr.rows) { try { db.scheduled.push(row.data); } catch {} }

  const nr = await pool.query('SELECT data FROM rename_requests');
  for (const row of nr.rows) { try { db.renameRequests.push(row.data); } catch {} }

  const ss = await pool.query('SELECT token, username, expires_at FROM sessions');
  const sessionsObj = {};
  for (const row of ss.rows) sessionsObj[row.token] = { username: row.username, exp: Number(row.expires_at || 0) };
  if (Object.keys(sessionsObj).length) db.sessions = sessionsObj;

  const kvr = await pool.query('SELECT key, value FROM kv');
  for (const row of kvr.rows) {
    if (MODELED_KEYS.has(row.key) || row.key in db) continue;
    try { db[row.key] = JSON.parse(row.value); } catch { db[row.key] = row.value; }
  }
  return db;
}

// Legacy KV snapshot (old db.js) auto-migration
async function _tryMigrateLegacy() {
  try {
    const check = await pool.query("SELECT to_regclass('state') IS NOT NULL AS has_state");
    if (!check.rows[0].has_state) return null;
    const r = await pool.query('SELECT value FROM state WHERE key = $1', ['main']);
    if (!r.rows[0]) return null;
    const obj = JSON.parse(r.rows[0].value);
    await _doSave(obj);
    try { await pool.query('DROP TABLE IF EXISTS state'); } catch {}
    console.log('DB legacy KV snapshot migrated to relational schema');
    return obj;
  } catch (e) {
    console.error('DB legacy migration failed:', e.message);
    return null;
  }
}

async function load() {
  if (!pool) pool = _makePool();
  if (!pool) {
    console.warn('DATABASE_URL not set — using in-memory data (NOT persisted across restarts)');
    return null;
  }
  try {
    const probe = await pool.connect();
    await _ensureSchema(probe);
    probe.release();
    healthy = true;
    const legacy = await _tryMigrateLegacy();
    if (legacy) return legacy;
    return await _loadFromTables();
  } catch (e) {
    console.error('DB load failed:', e.message);
    return null;
  }
}

function save(data) {
  queue = queue.then(() => _doSave(data)).catch((e) => console.error('DB save failed:', e.message));
  return queue;
}

async function close() {
  await queue.catch(() => {});
  if (pool) { try { await pool.end(); } catch {} pool = null; }
  healthy = false;
}

module.exports = { load, save, close };