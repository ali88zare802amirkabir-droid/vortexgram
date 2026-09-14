// VORTEXGRAM — POST /api/forward regression tests (file backend + spawned server).
// Run:  node --test tests/forward.test.js
//
// Covers: auth, per-ID source membership, chronological ordering (not click order),
// dedupe, batch limit, channel-post permission, cross-room rejection, no dup output.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 41987;

function seedDb(dir) {
  const db = {
    users: [
      { username: 'alice', displayName: 'Alice', isPremium: true },
      { username: 'bob', displayName: 'Bob' },
      { username: 'eve', displayName: 'Eve' },
    ],
    groups: [
      { id: 'chan1', type: 'channel', name: 'News', owner: 'bob', members: [{ username: 'bob', role: 'owner' }, { username: 'alice', role: 'member' }], createdAt: 1 },
    ],
    messages: {
      'dm:alice|bob': [
        { id: 'm1', roomId: 'dm:alice|bob', from: 'bob', fromName: 'Bob', kind: 'text', content: 'one', time: 100, reactions: {}, silent: false },
        { id: 'm2', roomId: 'dm:alice|bob', from: 'alice', fromName: 'Alice', kind: 'text', content: 'two', time: 101, reactions: {}, silent: false },
        { id: 'm3', roomId: 'dm:alice|bob', from: 'eve', fromName: 'Eve', kind: 'text', content: 'three', time: 102, reactions: {}, silent: false },
      ],
      'dm:alice|eve': [],
      'dm:bob|eve': [
        { id: 'r1', roomId: 'dm:bob|eve', from: 'bob', fromName: 'Bob', kind: 'text', content: 'secret', time: 10, reactions: {}, silent: false },
      ],
    },
    pinned: {},
    scheduled: [],
    renameRequests: [],
    sessions: {
      tokenAlice: { username: 'alice', exp: Date.now() + 3600000 },
      tokenBob: { username: 'bob', exp: Date.now() + 3600000 },
    },
  };
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify(db));
  return file;
}

function startServer(env) {
  return spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, DATABASE_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForBanner(child, port) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server boot timeout')), 12000);
    let acc = '';
    child.stdout.on('data', (d) => {
      acc += d.toString();
      if (acc.includes('vortexgram on http://localhost:' + port)) { clearTimeout(to); resolve(); }
    });
    child.on('exit', (c) => reject(new Error('server exited early ' + c)));
    child.on('error', (e) => reject(e));
  });
}

async function post(base, token, body) {
  const r = await fetch(base + '/api/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

function readDestMessages(dbFile) {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  return (db.messages || {})['dm:alice|eve'] || [];
}

async function waitUntil(fn, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('timeout waiting for state');
    await new Promise((r) => setTimeout(r, 80));
  }
}

test('POST /api/forward — auth, order, dedupe, limits, security', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-fwd-'));
  const dbFile = seedDb(tmp);
  const child = startServer({ DB_FILE: dbFile, PORT: String(PORT), FORWARD_LIMIT: '3' });
  try {
    await waitForBanner(child, PORT);
    const base = 'http://127.0.0.1:' + PORT;

    // 1) بدون توکن → 401
    let r = await fetch(base + '/api/forward', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceRoomId: 'dm:alice|bob', messageIds: ['m1'], destinationRoomId: 'dm:alice|eve' }),
    });
    assert.strictEqual(r.status, 401, 'auth required');

    // 2) فوروارد معتبر — ترتیب زمانیِ اصلی حتی با ورودیِ نامرتب (m3,m1,m2)
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m3', 'm1', 'm2'], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 200, 'ok status');
    assert.strictEqual(r.d.ok, true, 'ok flag');
    assert.strictEqual(r.d.count, 3, 'three forwarded');

    const fwd3 = await waitUntil(() => { const msgs = readDestMessages(dbFile); return msgs.length >= 3 ? msgs : null; });
    assert.strictEqual(fwd3.length, 3, 'destination got 3');
    assert.deepStrictEqual(fwd3.map((m) => m.content), ['one', 'two', 'three'], 'chronological order (not click order)');
    assert.ok(fwd3.every((m) => m.from === 'alice'), 'forwarded as alice');
    assert.ok(fwd3.every((m) => typeof m.fwdFrom === 'string' && m.fwdFrom.length), 'fwdFrom recorded');

    // 3) شناسهٔ خارج از اتاق مبدأ → 404 (injection رد شد)
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['r1'], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 404, 'foreign/unknown id rejected');

    // 4) مبدأِ بدون دسترسی → 403
    r = await post(base, 'tokenBob', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1'], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 403, 'source access denied');

    // 5) مقصدِ بدون دسترسی → 403
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1'], destinationRoomId: 'dm:bob|eve' });
    assert.strictEqual(r.status, 403, 'destination access denied');

    // 6) تکراری → dedupe، بدون پیام تکراری در مقصد
    const before = readDestMessages(dbFile).length;
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1', 'm1', 'm2'], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 200, 'dedupe accepted');
    assert.strictEqual(r.d.count, 2, 'deduped to 2');
    await waitUntil(() => readDestMessages(dbFile).length === before + 2);
    const msgs = readDestMessages(dbFile);
    const contents = msgs.slice(msgs.length - 2).map((m) => m.content);
    assert.strictEqual(new Set(contents).size, 2, 'no duplicate forwarded messages');

    // 7) آرایهٔ خالی → 400
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: [], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 400, 'empty rejected');

    // 8) غیرآرایه → 400
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: 'm1', destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 400, 'non-array rejected');

    // 9) بیش از سقف (FORWARD_LIMIT=3) → 400
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1', 'm2', 'm3', 'm1'], destinationRoomId: 'dm:alice|eve' });
    assert.strictEqual(r.status, 400, 'over limit rejected');

    // 10) ارسال به کانالِ بدون حق → 403
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1'], destinationRoomId: 'group:chan1' });
    assert.strictEqual(r.status, 403, 'channel post denied for non-admin member');

    // 11) فوروارد به همان اتاق مجاز است
    r = await post(base, 'tokenAlice', { sourceRoomId: 'dm:alice|bob', messageIds: ['m1'], destinationRoomId: 'dm:alice|bob' });
    assert.strictEqual(r.status, 200, 'same-room forward allowed');
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});