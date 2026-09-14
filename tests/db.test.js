// VORTEXGRAM — DB layer tests against a REAL PostgreSQL.
// Run:  set VX_PG_URL=<postgres url>      (defaults to the local test PG)
//       node --test tests/
//
// Covers: versioned migrations (up/down/status), schema constraints & indexes,
// exact snapshot round-trip through the normalized tables, save idempotence,
// legacy JSONB schema auto-upgrade, legacy 'state' KV auto-migration, and the
// zero-setup file fallback + server boot (spawned in isolated child processes).

const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PG_URL = process.env.VX_PG_URL || 'postgresql://postgres:vx@127.0.0.1:55432/postgres?sslmode=disable';
const SNAPSHOT = path.join(ROOT, 'data', 'db.json.migrated');

const { poolFromEnv } = require('../server/db/connection');
const repo = require('../server/db/repositories');
const migrate = require('../server/db/migrate');

let pool;
before(() => { pool = poolFromEnv(PG_URL); });
test.after(async () => { if (pool) { await pool.end(); } });

function runNode(script, env = {}, args = []) {
  return execFileSync(process.execPath, ['-e', script, ...args], {
    env: { ...process.env, DATABASE_URL: '', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// treats null/undefined/absent as equivalent (the runtime only uses truthiness
// for these optional fields, and the file backend stores them inconsistently)
function eq(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => eq(v, b[i]));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!eq(a[k], b[k])) return false;
  return true;
}

test('0001_init migration is versioned, reversible idempotent', async () => {
  await migrate.up(pool);
  const rows = await migrate.status(pool);
  assert.ok(rows.some((r) => r.version === '0001' && r.applied === 'yes'), '0001 applied');

  await migrate.down(pool);
  const st = (await pool.query("SELECT to_regclass('messages') AS o")).rows[0].o;
  assert.strictEqual(st, null, 'messages dropped after down');

  await migrate.up(pool);
  const up2 = (await pool.query("SELECT to_regclass('conversations') AS o")).rows[0].o;
  assert.ok(up2, 'conversations recreated after second up');
});

test('schema has FKs, unique, check constraints and the spec indexes', async () => {
  const fk = await pool.query(
    `SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid IN ('messages'::regclass,'conversation_members'::regclass)`
  );
  assert.ok(fk.rowCount >= 2, 'messages + conversation_members have FKs');

  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename IN ('messages','message_reactions','conversation_members')
     AND indexname IN ('idx_messages_room_time','idx_messages_sender','idx_messages_reply','message_reactions_pkey','conversation_members_pkey','idx_members_user')`
  );
  assert.strictEqual(idx.rowCount, 6, 'expected indexes exist');

  // reactions: one per (message, user) — PK rejects a second reaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.truncateAll(client);
    await repo.insertAll(client, repo.buildAll({
      users: [{ username: 'alice' }, { username: 'bob' }],
      groups: [],
      messages: { 'dm:alice|bob': [{ id: 'm1', roomId: 'dm:alice|bob', from: 'alice', fromName: 'Alice', kind: 'text', content: 'hi', time: 1, reactions: { '👍': ['bob'] } }] },
      pinned: {}, scheduled: [], readState: {}, chatState: {}, renameRequests: [],
    }));
    await client.query('COMMIT');
  } finally { client.release(); }

  const dupReaction = pool.query(
    "INSERT INTO message_reactions (message_id, user_id, reaction) VALUES ('m1','bob','❤️')"
  );
  await assert.rejects(dupReaction, (e) => e.code === '23505', 'reaction PK rejects per-user duplicate');

  const badKind = pool.query('INSERT INTO messages (id, conversation_id, "from", kind, content, time) VALUES ($1,$2,$3,$4,$5,$6)', ['x', 'dm:alice|bob', 'alice', 'banana', '', 1]);
  await assert.rejects(badKind, (e) => e.code === '23514', 'kind CHECK rejects unknown kind');

  const badType = pool.query("INSERT INTO conversations (id, type) VALUES ('x1:y','warp')");
  await assert.rejects(badType, (e) => e.code === '23514', 'conversations.type CHECK rejects unknown type');
});

test('full snapshot round-trips through normalized tables', async () => {
  const data = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.truncateAll(client);
    await repo.insertAll(client, repo.buildAll(data));
    await client.query('COMMIT');
  } finally { client.release(); }

  const loaded = await repo.loadAll(pool);

  assert.strictEqual(loaded.users.filter((u) => u.username).length, data.users.length, 'users preserved');
  assert.strictEqual(loaded.groups.length, data.groups.length, 'groups preserved');
  const nMsgOrig = Object.values(data.messages).reduce((a, x) => a + x.length, 0);
  const nMsgLoaded = Object.values(loaded.messages).reduce((a, x) => a + x.length, 0);
  assert.strictEqual(nMsgLoaded, nMsgOrig, 'message count preserved (' + nMsgOrig + ')');
  assert.strictEqual(Object.keys(loaded.readState).length, Object.keys(data.readState).length, 'readState rooms preserved');
  assert.strictEqual(Object.keys(loaded.chatState).length, Object.keys(data.chatState).length, 'chatState users preserved');
  assert.strictEqual(Object.keys(loaded.pinned).length, Object.keys(data.pinned).length, 'pinned rooms preserved');
  assert.strictEqual(JSON.stringify(loaded.tmpAdminFlag), 'true', 'kv extra preserved');
  assert.ok(Array.isArray(loaded.signupRequests), 'signupRequests preserved');

  const room = Object.keys(data.messages)[0];
  assert.ok(loaded.messages[room], 'first room present');
  assert.ok(eq(loaded.users, data.users), 'users deep-equal (null==absent)');
  assert.ok(eq(loaded.messages, data.messages), 'messages deep-equal (null==absent)');
  assert.ok(eq(loaded.groups, data.groups), 'groups deep-equal');
  assert.ok(eq(loaded.pinned, data.pinned), 'pinned deep-equal');
  assert.ok(eq(loaded.readState, data.readState), 'readState deep-equal');
  assert.ok(eq(loaded.chatState, data.chatState), 'chatState deep-equal');

  // reactions + media attachments survive the trip
  const reacted = Object.values(data.messages).flat().find((m) => m.reactions && Object.keys(m.reactions).length);
  assert.ok(reacted, 'snapshot has a reacted message');
  const loadedReacted = loaded.messages[reacted.roomId].find((m) => m.id === reacted.id);
  assert.deepStrictEqual(loadedReacted.reactions, reacted.reactions, 'reactions map exact');
  const media = Object.values(data.messages).flat().find((m) => m.kind === 'voice');
  const loadedMedia = media && loaded.messages[media.roomId].find((m) => m.id === media.id);
  if (media) {
    assert.ok(loadedMedia.url && loadedMedia.src, 'media url/src preserved');
    assert.strictEqual(loadedMedia.duration, media.duration, 'media duration preserved');
    assert.deepStrictEqual(loadedMedia.wave || [], media.wave || [], 'waveform preserved');
  }

  // saving the same state again yields an identical object (idempotent)
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');
    await repo.truncateAll(client2);
    await repo.insertAll(client2, repo.buildAll(data));
    await client2.query('COMMIT');
  } finally { client2.release(); }
  assert.deepStrictEqual(await repo.loadAll(pool), loaded, 'second save/load is byte-identical');
});

test('legacy JSONB schema auto-upgrades on first boot (separate database)', async () => {
  const dbName = 'vxtest_upgrade';
  const createName = PG_URL.replace('/postgres?', '/' + dbName + '?');
  const admin = poolFromEnv(PG_URL);
  await admin.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
  await admin.query('CREATE DATABASE "' + dbName + '"');
  await admin.end();

  const out = runNode(
    `const child = require('child_process');
     const { Pool } = require('pg');
     (async () => {
       const p = new Pool({ connectionString: process.env.UPG_URL, ssl: /sslmode=disable/.test(process.env.UPG_URL) ? false : { rejectUnauthorized: false } });
       const t = (n) => 'CREATE TABLE ' + n;
       await p.query('CREATE TABLE users (username TEXT PRIMARY KEY, phone TEXT, display_name TEXT, is_admin BOOLEAN, is_premium BOOLEAN, banned BOOLEAN, created_at BIGINT, last_seen BIGINT, data JSONB NOT NULL)');
       await p.query('CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT, type TEXT, owner TEXT, created_at BIGINT, data JSONB NOT NULL)');
       await p.query('CREATE TABLE messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, from_user TEXT, time BIGINT, data JSONB NOT NULL)');
       await p.query('CREATE TABLE read_state (room_id TEXT NOT NULL, username TEXT NOT NULL, ts BIGINT NOT NULL, PRIMARY KEY (room_id, username))');
       await p.query('CREATE TABLE chat_state (username TEXT NOT NULL, room_id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (username, room_id))');
       await p.query('CREATE TABLE pinned (room_id TEXT NOT NULL, msg_id TEXT NOT NULL, PRIMARY KEY (room_id, msg_id))');
       await p.query('CREATE TABLE scheduled (id TEXT PRIMARY KEY, room_id TEXT, at BIGINT, data JSONB NOT NULL)');
       await p.query('CREATE TABLE rename_requests (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
       await p.query('CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT, expires_at BIGINT)');
       await p.query('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
       const u = JSON.stringify({ username: 'admin', displayName: 'رها', phone: '0912', isAdmin: true, isPremium: false, createdAt: 1787489100575 });
       const m = JSON.stringify({ id: 'm1', roomId: 'dm:admin|test', from: 'admin', fromName: 'رها', kind: 'text', content: 'سلام', time: 1787489100600, reactions: {}, silent: false, fromPremium: false });
       await p.query("INSERT INTO users VALUES ('admin','0912','رها',TRUE,FALSE,FALSE,1787489100575,NULL,$1::jsonb)", [u]);
       await p.query("INSERT INTO messages VALUES ('m1','dm:admin|test','admin',1787489100600,$1::jsonb)", [m]);
       await p.end();
       const dbStore = require(process.env.VX_DB_PATH);
       const db = await dbStore.load();
       if (!db || !Array.isArray(db.users) || db.users.length !== 1) throw new Error('legacy users lost');
       if (!db.messages['dm:admin|test'] || db.messages['dm:admin|test'][0].content !== 'سلام') throw new Error('legacy message lost');
       db.users.push({ username: 'second', displayName: 'Second' });
       await dbStore.save(db);
       await dbStore.close();
       console.log('UPGRADED_OK');
     })().catch((e) => { console.error(e.stack); process.exit(1); });`,
    { UPG_URL: createName, DATABASE_URL: createName, VX_DB_PATH: path.join(ROOT, 'db.js') }
  );
  assert.match(out, /UPGRADED_OK/, 'child upgrade completed');

  const upgPool = poolFromEnv(createName);
  const cols = await upgPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='messages'");
  assert.ok(!cols.rows.some((r) => r.column_name === 'data'), 'new messages table has no JSONB data column');
  const after = await repo.loadAll(upgPool);
  assert.strictEqual(after.users.length, 2, 'post-upgrade save kept both users');
  assert.strictEqual(after.messages['dm:admin|test'][0].content, 'سلام', 'legacy message content preserved after upgrade');
  await upgPool.end();
});

test('legacy "state" KV snapshot auto-migrates (separate database)', async () => {
  const dbName = 'vxtest_state';
  const createName = PG_URL.replace('/postgres?', '/' + dbName + '?');
  const admin = poolFromEnv(PG_URL);
  await admin.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
  await admin.query('CREATE DATABASE "' + dbName + '"');
  await admin.end();

  const mini = { users: [{ username: 'carol', displayName: 'Carol' }], groups: [], messages: { 'dm:carol|bob': [{ id: 's1', roomId: 'dm:carol|bob', from: 'carol', fromName: 'Carol', kind: 'text', content: 'legacy kv', time: 5, reactions: {}, silent: false, fromPremium: false }] }, pinned: {}, scheduled: [], renameRequests: [], readState: {}, chatState: {}, signupRequests: [] };
  const out = runNode(
    `const { Pool } = require('pg');
     (async () => {
       const p = new Pool({ connectionString: process.env.UPG_URL, ssl: /sslmode=disable/.test(process.env.UPG_URL) ? false : { rejectUnauthorized: false } });
       await p.query('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
       await p.query('INSERT INTO state (key, value) VALUES ($1, $2)', ['main', process.env.SNAP]);
       await p.end();
       const dbStore = require(process.env.VX_DB_PATH);
       const db = await dbStore.load();
       if (!db || db.users.length !== 1 || db.users[0].username !== 'carol') throw new Error('state users lost');
       if (!db.messages['dm:carol|bob']) throw new Error('state messages lost');
       const mirrored = await dbStore.save ? (async () => { await dbStore.save(db); return true; })() : false;
       await dbStore.close();
       console.log('STATE_MIGRATED_OK');
     })().catch((e) => { console.error(e.stack); process.exit(1); });`,
    { UPG_URL: createName, SNAP: JSON.stringify(mini), DATABASE_URL: createName, VX_DB_PATH: path.join(ROOT, 'db.js') }
  );
  assert.match(out, /STATE_MIGRATED_OK/, 'state migration completed');
  const stPool = poolFromEnv(createName);
  const gone = await stPool.query("SELECT to_regclass('state') AS o");
  assert.strictEqual(gone.rows[0].o, null, 'state table dropped after migration');
  const after = await repo.loadAll(stPool);
  assert.strictEqual(after.users[0].username, 'carol');
  assert.deepStrictEqual(after.signupRequests, [], 'kv extra preserved');
  await stPool.end();
});

test('file backend round-trips locally (no DATABASE_URL) and boots server.js', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vx-file-'));
  const dbFile = path.join(tmpDir, 'db.json');

  // save/load through db.js file mode in a child process
  const roundtrip = runNode(
    `(async () => {
       const dbStore = require(process.env.VX_DB_PATH);
       const db = await dbStore.load();
       if (db) throw new Error('expected empty file');
       const data = { users: [{ username: 'fileuser', displayName: 'File User', isPremium: true }], groups: [ { id: 'abc123', type: 'group', name: 'G', owner: 'fileuser', members: [{ username: 'fileuser', role: 'owner' }], createdAt: 123 } ], messages: { 'dm:fileuser|bot': [{ id: 'f1', roomId: 'dm:fileuser|bot', from: 'fileuser', fromName: 'File User', kind: 'text', content: 'hello', time: 9, reactions: {}, silent: false, fromPremium: true }] }, pinned: {}, scheduled: [], renameRequests: [], readState: { 'dm:fileuser|bot': { fileuser: 10 } }, chatState: {}, signupRequests: [] };
       await dbStore.save(data);
       const back = await dbStore.load();
       if (!back || back.users.length !== 1 || back.messages['dm:fileuser|bot'][0].content !== 'hello') throw new Error('file roundtrip failed');
       await dbStore.close();
       console.log('FILE_OK');
     })().catch((e) => { console.error(e.stack); process.exit(1); });`,
    { VX_DB_PATH: path.join(ROOT, 'db.js'), DB_FILE: dbFile }
  );
  assert.match(roundtrip, /FILE_OK/, 'file-mode roundtrip');

  // full server boot in file mode (isolated port), then kill after ready banner
  const bootScript = `
    const { spawn } = require('child_process');
    const srv = spawn(process.execPath, [process.env.VX_SERVER_PATH], { env: process.env });
    let done = false;
    const to = setTimeout(() => { console.log('BOOT_TIMEOUT'); process.exit(1); }, 20000);
    srv.stdout.on('data', (d) => {
      const t = d.toString();
      if (t.includes('vortexgram on http://localhost:3123')) { done = true; console.log('BOOT_OK'); clearTimeout(to); srv.kill(); process.exit(0); }
    });
    srv.on('exit', (c) => { if (!done) { console.log('SERVER_EXIT ' + c); process.exit(1); } });
  `;
  const boot = runNode(bootScript, { VX_SERVER_PATH: path.join(ROOT, 'server.js'), DB_FILE: path.join(tmpDir, 'srv-db.json'), PORT: '3123' });
  assert.match(boot, /BOOT_OK/, 'server.js boots in file mode');
});