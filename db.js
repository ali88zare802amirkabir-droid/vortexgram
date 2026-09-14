// VORTEXGRAM — Persistent database layer
// Two backends, both fully autonomous:
//   1) PostgreSQL — when DATABASE_URL is set. Stores EVERYTHING (users, messages,
//      groups, reactions, read state, pins, scheduled msgs, rename requests,
//      sessions, chat prefs) in a normalized relational schema managed by the
//      versioned migrations under server/db/migrations (see server/db/migrate.js).
//      Old auto-created JSONB tables and any pre-existing 'state' KV snapshot are
//      upgraded automatically on first boot (originals preserved until the new
//      write commits).
//   2) Local JSON file — when DATABASE_URL is NOT set (zero-setup fallback that
//      keeps all data across server restarts, via data/db.json).
//
// The in-memory `db` object remains the single source of truth at runtime;
// save() synchronizes it transactionally (single writer).

const path = require('path');
const fs = require('fs');
const { poolFromEnv } = require('./server/db/connection');
const migrate = require('./server/db/migrate');
const repo = require('./server/db/repositories');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');

let pool = null;
let healthy = false;
let mode = 'file'; // 'file' or 'pg'
let queue = Promise.resolve();

// ---------------------------------------------------------------------------
// PostgreSQL backend — normalized relational storage
// ---------------------------------------------------------------------------
async function _doSave(data) {
  if (!healthy) { console.error('DB not healthy yet, skipping save'); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.truncateAll(client);
    await repo.insertAll(client, repo.buildAll(data));
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function _loadFromTables() {
  return repo.loadAll(pool);
}

async function _hasTable(name) {
  const r = await pool.query('SELECT to_regclass($1) AS o', [name]);
  return !!r.rows[0] && !!r.rows[0].o;
}

// Old runtime schema used JSONB `data` blobs per row. Detect it and upgrade.
async function _isOldSchema() {
  const r = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'data'");
  return r.rowCount > 0;
}

async function _loadOldTables() {
  const db = { users: [], renameRequests: [], messages: {}, groups: [], pinned: {}, scheduled: [], readState: {}, chatState: {} };
  const q = async (sql) => { try { return (await pool.query(sql)).rows; } catch { return []; } };
  for (const row of await q('SELECT data FROM users')) { try { if (row.data) db.users.push(row.data); } catch {} }
  for (const row of await q('SELECT data FROM groups')) { try { if (row.data) db.groups.push(row.data); } catch {} }
  for (const row of await q('SELECT room_id, data FROM messages ORDER BY time ASC')) {
    try { const m = row.data; if (m && m.roomId) (db.messages[m.roomId] = db.messages[m.roomId] || []).push(m); } catch {}
  }
  for (const row of await q('SELECT room_id, msg_id FROM pinned')) (db.pinned[row.room_id] = db.pinned[row.room_id] || []).push(row.msg_id);
  for (const row of await q('SELECT room_id, username, ts FROM read_state')) (db.readState[row.room_id] = db.readState[row.room_id] || {})[row.username] = Number(row.ts || 0);
  for (const row of await q('SELECT username, room_id, data FROM chat_state')) (db.chatState[row.username] = db.chatState[row.username] || {})[row.room_id] = row.data;
  for (const row of await q('SELECT data FROM scheduled')) { try { if (row.data) db.scheduled.push(row.data); } catch {} }
  for (const row of await q('SELECT data FROM rename_requests')) { try { if (row.data) db.renameRequests.push(row.data); } catch {} }
  const sessionsObj = {};
  for (const row of await q('SELECT token, username, expires_at FROM sessions')) sessionsObj[row.token] = { username: row.username, exp: Number(row.expires_at || 0) };
  if (Object.keys(sessionsObj).length) db.sessions = sessionsObj;
  for (const row of await q('SELECT key, value FROM kv')) {
    if (repo.MODELED_KEYS.has(row.key) || row.key in db) continue;
    try { db[row.key] = JSON.parse(row.value); } catch { db[row.key] = row.value; }
  }
  return db;
}

async function _relocateOldTables() {
  for (const n of ['users', 'groups', 'messages', 'read_state', 'chat_state', 'pinned', 'scheduled', 'rename_requests', 'sessions', 'kv', 'state']) {
    if (await _hasTable(n)) await pool.query('ALTER TABLE IF EXISTS "' + n + '" RENAME TO "vx_legacy_' + n + '"');
  }
}

async function _dropRelocated() {
  for (const n of ['users', 'groups', 'messages', 'read_state', 'chat_state', 'pinned', 'scheduled', 'rename_requests', 'sessions', 'kv', 'state']) {
    await pool.query('DROP TABLE IF EXISTS "vx_legacy_' + n + '"');
  }
}

// Legacy KV snapshot (old migrate-pg 'state' table) auto-migration
async function _tryMigrateLegacy() {
  try {
    if (!(await _hasTable('state'))) return null;
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
  if (!pool) pool = poolFromEnv();
  if (!pool) {
    mode = 'file';
    console.log('DATABASE_URL not set — persisting to ' + DB_FILE + ' (local JSON file, survives restarts)');
    return _loadFromFile();
  }
  mode = 'pg';
  try {
    // First boot over a database created by the old JSONB schema: read it into
    // memory, park the tables aside (kept until the normalized write commits),
    // then apply the versioned schema and re-persist.
    const hasSchemaLog = await _hasTable('schema_migrations');
    const isOld = await _isOldSchema();
    if (!hasSchemaLog && isOld) {
      const legacyDb = await _loadOldTables();
      await _relocateOldTables();
      await migrate.up(pool);
      healthy = true;
      await _doSave(legacyDb);
      await _dropRelocated();
      console.log('DB upgraded: legacy JSONB tables -> normalized relational schema');
      return legacyDb;
    }

    await migrate.up(pool);
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
  if (mode === 'file') {
    try { _writeFileData(data); return queue; } catch (e) { console.error('DB file save failed:', e.message); return queue; }
  }
  queue = queue.then(() => _doSave(data)).catch((e) => console.error('DB save failed:', e.message));
  return queue;
}

async function close() {
  await queue.catch(() => {});
  if (pool) { try { await pool.end(); } catch {} pool = null; }
  healthy = false;
}

// ---------------------------------------------------------------------------
// Local JSON file backend (fallback when DATABASE_URL is not set)
// ---------------------------------------------------------------------------
function _writeFileData(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DB_FILE);
}

function _loadFromFile() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const nMsg = Object.values(obj.messages || {}).reduce((a, x) => a + x.length, 0);
    console.log('DB loaded from ' + DB_FILE + ' (' + (Array.isArray(obj.users) ? obj.users.length : 0) + ' users, ' + nMsg + ' messages)');
    return obj;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('DB file load failed:', e.message);
    return null;
  }
}

module.exports = { load, save, close };