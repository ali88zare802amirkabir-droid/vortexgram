// VORTEXGRAM — settings / active-sessions regression tests (spawned server, file backend).
// Run:  node --test tests/settings.test.js
//
// Covers phase 5E (server-side settings persistence):
//   * GET /api/profile/settings returns a full default document for a fresh user
//   * POST /api/profile/settings validates a whitelist (enums + booleans) and
//     rejects out-of-range values with 400, storing nothing
//   * unknown / free-form keys are never persisted (sparse document)
//   * settings survive a server restart (written to the db file)
//   * the write path is rate limited per user
//   * privacy.lastSeen / privacy.presence are enforced server-side on the
//     public "user exists" endpoint (others cannot see what the user hid)
//   * active sessions: two devices are listed with stable ids, exactly one is
//     "current", and revoking a device invalidates its session token

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 41991;

const UA_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_B = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

function legacyHash(pw, salt) {
  return require('crypto').createHash('sha256').update(salt + ':' + pw).digest('hex');
}

function seedDb(dir) {
  const db = {
    users: [
      { username: 'alice', displayName: 'Alice', salt: 'aa', passHash: legacyHash('alicepw', 'aa'), lastSeen: 111111 },
      { username: 'bob', displayName: 'Bob', salt: 'bb', passHash: legacyHash('bobpw', 'bb'), lastSeen: 222222 },
    ],
    groups: [],
    messages: {},
    pinned: {},
    scheduled: [],
    renameRequests: [],
    messageDeletions: [],
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
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'development', GROQ_API_KEYS_STR: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForBanner(child, port) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server boot timeout')), 12000);
    let acc = '';
    child.stdout.on('data', (d) => { acc += d.toString(); if (acc.includes('vortexgram on http://localhost:' + port)) { clearTimeout(to); resolve(); } });
    child.on('exit', (c) => reject(new Error('server exited early ' + c)));
    child.on('error', (e) => reject(e));
  });
}

async function api(base, method, pathname, token, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(base + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

function readDb(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// saveDB() is debounced (~250ms); wait past the flush before inspecting disk.
async function waitForSettings(file, username) {
  for (let i = 0; i < 40; i++) {
    const u = readDb(file).users.find((x) => x.username === username);
    if (u && u.settings) return u.settings;
    await delay(50);
  }
  return readDb(file).users.find((x) => x.username === username).settings;
}

async function withServer(t, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-set-'));
  const dbFile = seedDb(tmp);
  const child = startServer({ DB_FILE: dbFile, SESSIONS_FILE: path.join(tmp, 'sessions.json'), PORT: String(PORT) });
  try {
    await waitForBanner(child, PORT);
    await run({ base: 'http://127.0.0.1:' + PORT, dbFile, tmp });
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('settings: defaults, whitelist validation, sparse persistence, restart-safe', async (t) => {
  await withServer(t, async ({ base, dbFile, tmp }) => {
    // 1) defaults for a fresh account
    let r = await api(base, 'GET', '/api/profile/settings', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'settings readable');
    assert.strictEqual(r.d.settings.privacy.lastSeen, 'everybody', 'default lastSeen');
    assert.strictEqual(r.d.settings.appearance.bubbleRadius, 'round', 'default radius');
    assert.strictEqual(r.d.settings.language.code, 'fa', 'default language');

    // 2) valid patch persists (nested)
    r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', {
      settings: { privacy: { lastSeen: 'nobody', readReceipts: false }, appearance: { bubbleRadius: 'pill', accent: 'ff7a00' } },
    });
    assert.strictEqual(r.status, 200, 'valid patch accepted');
    assert.strictEqual(r.d.settings.privacy.lastSeen, 'nobody', 'applied lastSeen');
    assert.strictEqual(r.d.settings.privacy.readReceipts, false, 'applied bool');
    assert.strictEqual(r.d.settings.appearance.bubbleRadius, 'pill', 'applied enum');
    assert.strictEqual(r.d.settings.appearance.accent, 'ff7a00', 'applied accent');

    // 3) out-of-range enum / wrong type → 400, nothing stored
    const before = await waitForSettings(dbFile, 'alice');
    r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', { settings: { privacy: { lastSeen: 'sometimes' } } });
    assert.strictEqual(r.status, 400, 'bad enum rejected');
    r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', { settings: { notifications: { enabled: 'yes' } } });
    assert.strictEqual(r.status, 400, 'bad bool rejected');
    const after = await waitForSettings(dbFile, 'alice');
    assert.deepStrictEqual(after, before, 'rejected patch stored nothing');

    // 4) unknown / free-form keys never persisted (sparse doc)
    r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', {
      settings: { evil: { x: 1 }, privacy: { lastSeen: 'everybody', hacked: true } },
    });
    assert.strictEqual(r.status, 200, 'patch accepted for known keys only');
    assert.strictEqual(r.d.settings.evil, undefined, 'unknown top-level key dropped');
    assert.strictEqual(r.d.settings.privacy.hacked, undefined, 'unknown nested key dropped');
    await delay(400);
    const doc = readDb(dbFile).users.find((u) => u.username === 'alice').settings;
    assert.ok(!('evil' in doc), 'unknown key not on disk');
    assert.deepStrictEqual(doc.privacy, { lastSeen: 'everybody', readReceipts: false }, 'sparse doc keeps only whitelisted paths');
    assert.strictEqual(doc.appearance.accent, 'ff7a00', 'previously stored accent kept');

    // 5) rate limit caps writes per user
    let got429 = false;
    for (let i = 0; i < 60; i++) {
      r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', { settings: { chat: { enterToSend: i % 2 === 0 } } });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, 'settings writes are rate limited');
  });
});

test('settings: persist across a server restart', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-set-restart-'));
  const dbFile = seedDb(tmp);
  const ses = path.join(tmp, 'sessions.json');
  const boot = async () => {
    const child = startServer({ DB_FILE: dbFile, SESSIONS_FILE: ses, PORT: String(PORT) });
    await waitForBanner(child, PORT);
    return child;
  };
  try {
    const c1 = await boot();
    let r = await api('http://127.0.0.1:' + PORT, 'POST', '/api/profile/settings', 'tokenAlice', {
      settings: { privacy: { lastSeen: 'nobody', presence: false }, language: { code: 'en' } },
    });
    assert.strictEqual(r.status, 200, 'write before restart');
    await delay(400);
    c1.kill();
    await new Promise((res) => setTimeout(res, 400));

    const c2 = await boot();
    try {
      r = await api('http://127.0.0.1:' + PORT, 'GET', '/api/profile/settings', 'tokenAlice');
      assert.strictEqual(r.status, 200, 'session survives restart');
      assert.strictEqual(r.d.settings.privacy.lastSeen, 'nobody', 'privacy persisted');
      assert.strictEqual(r.d.settings.privacy.presence, false, 'bool persisted');
      assert.strictEqual(r.d.settings.language.code, 'en', 'language persisted');
    } finally { c2.kill(); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings: privacy.lastSeen / presence enforced server-side', async (t) => {
  await withServer(t, async ({ base }) => {
    // bob sees alice's lastSeen while it is public
    let r = await api(base, 'GET', '/api/users/exists/alice', 'tokenBob');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.d.lastSeen, 111111, 'public lastSeen visible to others');

    // alice hides it
    r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', { settings: { privacy: { lastSeen: 'nobody', presence: false } } });
    assert.strictEqual(r.status, 200);

    // bob can no longer see it; online is hidden too
    r = await api(base, 'GET', '/api/users/exists/alice', 'tokenBob');
    assert.strictEqual(r.d.lastSeen, null, 'hidden lastSeen not leaked');
    assert.strictEqual(r.d.online, false, 'presence hidden');

    // alice still sees her own lastSeen
    r = await api(base, 'GET', '/api/users/exists/alice', 'tokenAlice');
    assert.strictEqual(r.d.lastSeen, 111111, 'owner still sees own lastSeen');
  });
});

test('settings: active sessions list + per-device revoke', async (t) => {
  await withServer(t, async ({ base }) => {
    // new account on two different clients
    let r = await api(base, 'POST', '/api/register', null, { username: 'duser', password: 'sekret123' }, { 'User-Agent': UA_A });
    assert.strictEqual(r.status, 200, 'register ok');
    const tokenA = r.d.token;
    r = await api(base, 'POST', '/api/login', null, { username: 'duser', password: 'sekret123' }, { 'User-Agent': UA_B });
    assert.strictEqual(r.status, 200, 'login ok');
    const tokenB = r.d.token;

    // both devices listed, stable ids, exactly one current (as seen from device A)
    r = await api(base, 'GET', '/api/profile/devices', tokenA, undefined, { 'User-Agent': UA_A });
    assert.strictEqual(r.status, 200);
    const devices = r.d.devices;
    assert.strictEqual(devices.length, 2, 'two devices tracked');
    const ids = devices.map((d) => d.id).filter(Boolean);
    assert.strictEqual(new Set(ids).size, 2, 'device ids are stable + distinct');
    assert.strictEqual(devices.filter((d) => d.current).length, 1, 'exactly one current device');

    // revoke the other device → its token is dead, device removed
    const other = devices.find((d) => !d.current);
    r = await api(base, 'POST', '/api/profile/devices/revoke', tokenA, { id: other.id }, { 'User-Agent': UA_A });
    assert.strictEqual(r.status, 200, 'revoke ok');
    assert.ok(r.d.revoked >= 1, 'at least one session revoked');

    const tokenBdead = await api(base, 'GET', '/api/me', tokenB, undefined, { 'User-Agent': UA_B });
    assert.strictEqual(tokenBdead.status, 401, 'revoked device token rejected');

    r = await api(base, 'GET', '/api/profile/devices', tokenA, undefined, { 'User-Agent': UA_A });
    assert.strictEqual(r.d.devices.length, 1, 'revoked device removed from list');

    // revoke-others keeps the current session alive
    r = await api(base, 'POST', '/api/profile/devices/revoke-others', tokenA, {}, { 'User-Agent': UA_A });
    assert.strictEqual(r.status, 200, 'revoke-others ok');
    const stillIn = await api(base, 'GET', '/api/me', tokenA, undefined, { 'User-Agent': UA_A });
    assert.strictEqual(stillIn.status, 200, 'current session survives revoke-others');
  });
});

// Phase 5F — the Help/About screen needs a real version string. /api/health is
// public (no token) and must report the package version, and must not leak any
// secret-ish field beyond the whitelisted ones.
test('health: reports app version + build, no auth required', async (t) => {
  await withServer(t, async ({ base }) => {
    const r = await api(base, 'GET', '/api/health', undefined);
    assert.strictEqual(r.status, 200, 'health is public');
    assert.strictEqual(r.d.status, 'ok');
    assert.strictEqual(r.d.version, require('../package.json').version, 'version matches package.json');
    assert.ok('build' in r.d, 'build field present (may be empty in dev)');
    assert.ok(!('token' in r.d) && !('db' in r.d) && !('users' in r.d), 'no sensitive fields leaked');
  });
});
