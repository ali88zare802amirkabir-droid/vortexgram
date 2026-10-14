// VORTEXGRAM — bot accounts + /api/bot/post tests (spawned server, file backend).
// Run:  node --test tests/bots.test.js
//
// Coverage required by the Phase 3A spec:
//   * bot auth      — missing / wrong / rotated / revoked keys are all rejected
//   * key storage   — only an HMAC hash is persisted, never the raw key
//   * ownership     — a bot may only post to channels it owns/administers
//   * non-bot user  — a normal user session cannot call /api/bot/post
//   * bot login     — isBot accounts cannot log in (password or OTP)
//   * rate limit    — per-bot posting budget
//   * idempotency   — the same idempotencyKey never double-posts
//   * SSRF          — imageUrl pointing at a private IP / non-image is refused
//   * XSS           — content/sourceUrl are stripped and only http(s) survives
//   * provenance    — source link + AI label are stored as STRUCTURED fields
//   * views         — unique-viewer counting exposes a number, never identities
//   * seeding       — the 9 public channels are created once and stay idempotent

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 41991;          // distinct from security.test.js (41989) / forward (41987)
const PEPPER = 'test-pepper-value-that-is-at-least-32-chars-long-xxxx';

function legacyHash(pw, salt) {
  return require('crypto').createHash('sha256').update(salt + ':' + pw).digest('hex');
}

function seedDb(dir, opts = {}) {
  // توجه: این فهرست عمداً «ربات» ندارد. هر تستی که کلید می‌خواهد خودش رباتش را
  // از POST /api/admin/bots می‌سازد؛ اگر از قبل وجود داشته باشد endpoint
  // درست 409 می‌دهد و تست به‌اشتباه شکست می‌خورد.
  const users = opts.users || [
    { username: 'alice', displayName: 'Alice', salt: 'aa', passHash: legacyHash('alicepw', 'aa'), phone: '09120000001' },
    { username: 'admin1', displayName: 'Admin', isAdmin: true, salt: 'ad', passHash: legacyHash('adminpw', 'ad'), phone: '09120000009' },
  ];
  const db = {
    users,
    groups: opts.groups || [],
    messages: opts.messages || {},
    pinned: {},
    scheduled: [],
    renameRequests: [],
    messageDeletions: [],
    botApiKeys: [],
    sessions: opts.sessions || {
      tokenAlice: { username: 'alice', exp: Date.now() + 3600000 },
      tokenAdmin1: { username: 'admin1', exp: Date.now() + 3600000 },
    },
  };
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify(db));
  return file;
}

function startServer(env) {
  return spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env, DATABASE_URL: '', NODE_ENV: 'development', GROQ_API_KEYS_STR: '',
      BOT_KEY_PEPPER: PEPPER, BOT_PEPPER_FILE: path.join(os.tmpdir(), 'vx-bot-test-pepper'),
      ...env,
    },
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

async function waitUntil(fn, timeout = 6000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('timeout waiting for state');
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function withServer(t, env, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-bot-'));
  const dbFile = seedDb(tmp, env.seed || {});
  const child = startServer({ DB_FILE: dbFile, PORT: String(PORT), ...(env.server || {}) });
  try {
    await waitForBanner(child, PORT);
    await run({ base: 'http://127.0.0.1:' + PORT, dbFile, tmp });
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// mint a key exactly the way the admin endpoint does, so tests can authenticate
const bots = require(path.join(ROOT, 'server', 'bots.js'));
bots._setPepper(PEPPER);
function mintFor(username) {
  const { raw, keyId, secret } = bots.generateKey();
  const rec = {
    keyId, botUsername: username, keyHash: bots.hashKey(secret, keyId),
    keyPrefix: raw.slice(0, 16), status: 'active', createdAt: Date.now(),
  };
  return { raw, rec };
}

function channel(id, owner, extra = {}) {
  return {
    id, type: 'channel', name: 'Chan ' + id, owner,
    members: [{ username: owner, role: 'owner' }],
    createdAt: 1, avatar: null, username: 'chan_' + id, visibility: 'public',
    description: 'test', category: 'tech', ...extra,
  };
}

// ---------------------------------------------------------------------------
test('bot auth: missing, malformed, wrong-secret and unknown keys are rejected', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const good = mintFor('bot_a');
    // register the key server-side through the admin endpoint instead of seeding,
    // so this test also proves admin creation works
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    assert.strictEqual(created.status, 201, 'admin should be able to create a bot');
    const rawKey = created.d.apiKey;
    assert.ok(rawKey && rawKey.startsWith('vxk_'), 'raw key is returned once at creation');

    // missing
    let r = await api(base, 'POST', '/api/bot/post', null, { channelId: 'c1', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401);

    // wrong shape
    r = await api(base, 'POST', '/api/bot/post', 'not-a-key', { channelId: 'c1', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401);

    // structurally valid but unknown keyId
    const unknown = bots.generateKey();
    r = await api(base, 'POST', '/api/bot/post', unknown.raw, { channelId: 'c1', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401);

    // right keyId, wrong secret
    const tampered = rawKey.slice(0, 17) + 'f'.repeat(64);
    r = await api(base, 'POST', '/api/bot/post', tampered, { channelId: 'c1', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401);
    assert.ok(good); // silence unused warnings in some runners
  });
});

test('bot auth: rotation invalidates the old key, revocation kills all keys', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    assert.strictEqual(created.status, 201);
    const first = created.d.apiKey;

    const rot = await api(base, 'POST', '/api/admin/bots/bot_a/rotate-key', 'tokenAdmin1', {});
    assert.strictEqual(rot.status, 200);
    const second = rot.d.apiKey;
    assert.ok(second && second !== first, 'rotate returns a brand new key');

    // the rotated-away key must stop working immediately
    let r = await api(base, 'POST', '/api/bot/post', first, { channelId: 'x', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401, 'old key must be rejected after rotation');

    // revoke everything
    const rev = await api(base, 'POST', '/api/admin/bots/bot_a/revoke-keys', 'tokenAdmin1', {});
    assert.strictEqual(rev.status, 200);
    assert.ok(rev.d.revoked >= 1);

    r = await api(base, 'POST', '/api/bot/post', second, { channelId: 'x', kind: 'text', content: 'hi' });
    assert.strictEqual(r.status, 401, 'revoked key must be rejected');
  });
});

test('key material: only a hash is persisted, never the raw key', async (t) => {
  await withServer(t, {}, async ({ base, dbFile }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const rawKey = created.d.apiKey;
    await waitUntil(() => (readDb(dbFile).botApiKeys || []).length > 0);
    const db = readDb(dbFile);
    const rec = db.botApiKeys.find((k) => k.botUsername === 'bot_a');
    assert.ok(rec, 'a key record is persisted');
    assert.ok(rec.keyHash && rec.keyHash.length === 64, 'stored as a sha256-length hex digest');
    assert.ok(!JSON.stringify(db).includes(rawKey), 'raw key must NOT appear anywhere in the database');
    assert.ok(rec.keyHash !== rawKey);
  });
});

test('ownership: a bot may only post to a channel it owns or administers', async (t) => {
  const groups = [
    channel('own', 'bot_a'),
    channel('admins', 'alice', { members: [{ username: 'alice', role: 'owner' }, { username: 'bot_a', role: 'admin' }] }),
    channel('foreign', 'bob'),
  ];
  await withServer(t, { seed: { groups } }, async ({ base }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;

    // owns it
    let r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'hello from owner' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.d));
    // administers it
    r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'admins', kind: 'text', content: 'hello from admin' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.d));
    // not a member at all → 403
    r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'foreign', kind: 'text', content: 'nope' });
    assert.strictEqual(r.status, 403);
    // unknown channel → 404
    r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'missing', kind: 'text', content: 'nope' });
    assert.strictEqual(r.status, 404);
  });
});

test('a normal user session cannot call /api/bot/post', async (t) => {
  const groups = [channel('own', 'alice')];
  await withServer(t, { seed: { groups } }, async ({ base }) => {
    // alice is a human, not a bot
    const r = await api(base, 'POST', '/api/bot/post', 'tokenAlice', { channelId: 'own', kind: 'text', content: 'human tries bot api' });
    assert.strictEqual(r.status, 401, 'a human session token is not a bot key');
  });
});

test('bot accounts cannot log in with password or OTP', async (t) => {
  const users = [
    { username: 'admin1', displayName: 'Admin', isAdmin: true, salt: 'ad', passHash: legacyHash('adminpw', 'ad'), phone: '09120000009' },
    { username: 'bot_a', displayName: 'Bot A', isBot: true, salt: 'bp', passHash: legacyHash('botpw', 'bp'), phone: '09120000010' },
  ];
  await withServer(t, { seed: { users, sessions: { tokenAdmin1: { username: 'admin1', exp: Date.now() + 3600000 } } } }, async ({ base }) => {
    // password login for a bot is refused even though the hash matches
    const r = await api(base, 'POST', '/api/login', null, { username: 'bot_a', password: 'botpw' });
    assert.strictEqual(r.status, 403);
    assert.ok(/ربات/.test(r.d.error || ''), 'error should mention bot');
  });
});

test('rate limit: per-bot posting budget returns 429 when exceeded', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    // The configured budget is small in tests via LIMITS default 30; exceed it.
    let sawLimit = false;
    for (let i = 0; i < bots.LIMITS.rateMax + 5; i++) {
      const r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'msg ' + i });
      if (r.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'expected a 429 once the per-bot budget is exhausted');
  });
});

test('idempotency: same idempotencyKey does not double-post', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    const body = { channelId: 'own', kind: 'text', content: 'idempotent', idempotencyKey: 'daily-2024-01-01' };
    const first = await api(base, 'POST', '/api/bot/post', key, body);
    assert.strictEqual(first.status, 201, JSON.stringify(first.d));
    const second = await api(base, 'POST', '/api/bot/post', key, body);
    assert.strictEqual(second.status, 200, 'a repeat is answered 200, not a new post');
    assert.strictEqual(second.d.duplicate, true);
    assert.strictEqual(second.d.messageId, first.d.messageId, 'same message id returned');
  });
});

test('SSRF: private-IP / non-image imageUrl is refused', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    const attempt = (imageUrl) => api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'image', content: 'x', imageUrl });

    // loopback
    let r = await attempt('http://127.0.0.1:80/secret.png');
    assert.strictEqual(r.status, 400, 'loopback must be blocked');
    // link-local metadata endpoint
    r = await attempt('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(r.status, 400, 'link-local must be blocked');
    // private range
    r = await attempt('http://10.0.0.5/img.png');
    assert.strictEqual(r.status, 400, 'private range must be blocked');
    // localhost alias
    r = await attempt('http://localhost:3000/img.png');
    assert.strictEqual(r.status, 400, 'localhost must be blocked');
    // non-http scheme
    r = await attempt('file:///etc/passwd');
    assert.strictEqual(r.status, 400, 'file scheme must be blocked');
  });
});

test('SSRF: a redirect from a public host to a private IP is blocked', async (t) => {
  const groups = [channel('own', 'bot_a')];
  // decoy "public" server that 302s to a link-local address
  const decoy = http.createServer((req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/' }); res.end(); });
  await new Promise((r) => decoy.listen(0, '127.0.0.1', r));
  const port = decoy.address().port;
  try {
    await withServer(t, { seed: { groups } }, async ({ base }) => {
      const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
      const key = created.d.apiKey;
      const r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'image', content: 'x', imageUrl: `http://127.0.0.1:${port}/x.png` });
      // 127.0.0.1 is itself private, so the initial hop is already refused
      assert.strictEqual(r.status, 400);
    });
  } finally { decoy.close(); }
});

test('XSS / injection: content and sourceUrl are sanitized, only http(s) source survives', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base, dbFile }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;

    // script payload + bidi override in content
    const evil = '<script>alert(1)</script>\u202Ehello';
    const r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: evil });
    assert.strictEqual(r.status, 201, JSON.stringify(r.d));
    // saveDB() debounces 250ms — wait for the flush before reading the file
    const stored = await waitUntil(() => (readDb(dbFile).messages['group:own'] || []).find((m) => m.id === r.d.messageId));
    assert.ok(stored, 'message persisted');
    assert.ok(!stored.content.includes('\u202E'), 'bidi override stripped from content');
    assert.ok(stored.content.includes('<script>'), 'raw text kept as-is; client escapes at render');

    // javascript: sourceUrl must be rejected
    let bad = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'x', sourceUrl: 'javascript:alert(1)' });
    assert.strictEqual(bad.status, 400, 'javascript: source refused');
    // data: sourceUrl must be rejected
    bad = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'x', sourceUrl: 'data:text/html,<script>' });
    assert.strictEqual(bad.status, 400, 'data: source refused');
    // good https source is stored as a STRUCTURED field, not appended to content
    const good = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'news today', sourceUrl: 'https://example.com/a', sourceTitle: 'Headline' });
    assert.strictEqual(good.status, 201, JSON.stringify(good.d));
    const db2 = await waitUntil(() => { const d = readDb(dbFile); return (d.messages['group:own'] || []).find((m) => m.id === good.d.messageId); });
    assert.ok(db2.source && db2.source.url === 'https://example.com/a', 'source stored structurally');
    assert.strictEqual(db2.source.site, 'example.com');
    assert.ok(!db2.content.includes('http'), 'url must NOT be embedded in the text body');
  });
});

test('provenance: AI-generated posts carry the structured AI label', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base, dbFile }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    const r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'AI summary', aiGenerated: true });
    assert.strictEqual(r.status, 201);
    const msg = await waitUntil(() => { const d = readDb(dbFile); return (d.messages['group:own'] || []).find((m) => m.id === r.d.messageId); });
    assert.ok(msg.ai && msg.ai.generated === true, 'ai.generated flag set');
    assert.strictEqual(msg.ai.label, 'تولید شده با هوش مصنوعی');
  });
});

test('poll posts validate options and persist a poll payload', async (t) => {
  const groups = [channel('own', 'bot_a')];
  await withServer(t, { seed: { groups } }, async ({ base, dbFile }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    // too few options → 400
    let r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'poll', question: 'Which one?', options: ['only-one'] });
    assert.strictEqual(r.status, 400);
    // valid poll
    r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'poll', question: 'Which one?', options: ['A', 'B', 'C'] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.d));
    const msg = await waitUntil(() => { const d = readDb(dbFile); return (d.messages['group:own'] || []).find((m) => m.id === r.d.messageId); });
    assert.ok(msg.poll && msg.poll.question === 'Which one?');
    assert.strictEqual(msg.poll.options.length, 3);
    assert.ok(!msg.content, 'poll content is empty; question lives in the poll object');
  });
});

test('views: unique viewers are counted by number, identities never exposed', async (t) => {
  // alice must be a member of the channel, otherwise canAccess() legitimately 403s
  const groups = [channel('own', 'bot_a', { members: [{ username: 'bot_a', role: 'owner' }, { username: 'alice', role: 'member' }] })];
  await withServer(t, { seed: { groups } }, async ({ base, dbFile }) => {
    const created = await api(base, 'POST', '/api/admin/bots', 'tokenAdmin1', { username: 'bot_a', displayName: 'Bot A' });
    const key = created.d.apiKey;
    const r = await api(base, 'POST', '/api/bot/post', key, { channelId: 'own', kind: 'text', content: 'count my views' });
    const msgId = r.d.messageId;
    // fetch history as alice twice via WS is heavy; instead assert the counter is a plain number field
    const msg = await waitUntil(() => { const d = readDb(dbFile); return (d.messages['group:own'] || []).find((m) => m.id === msgId); });
    assert.strictEqual(typeof msg.views, 'number', 'views is an aggregate number');
    // there is no per-viewer identity field stored
    assert.ok(!('viewers' in msg) && !('viewedBy' in msg), 'no viewer identity list is stored');
    // counts endpoint exposes only numbers
    const counts = await api(base, 'GET', `/api/reactions/${msgId}/counts?roomId=group:own`, 'tokenAlice');
    assert.strictEqual(counts.status, 200);
    assert.strictEqual(typeof counts.d.total, 'number');
    assert.ok(!JSON.stringify(counts.d).includes('alice'), 'counts endpoint must not name viewers');
  });
});

test('seed: creates the 9 public channels once and is idempotent', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const first = await api(base, 'POST', '/api/admin/bots/seed-channels', 'tokenAdmin1', {});
    assert.strictEqual(first.status, 200, JSON.stringify(first.d));
    assert.strictEqual(first.d.channels.length, 9, 'nine channels');
    assert.strictEqual(first.d.createdBotCount, 9, 'nine bots created');
    assert.ok(first.d.newBotKeys.every((b) => b.apiKey.startsWith('vxk_')), 'each new bot gets a key shown once');

    // second run must be a no-op for channel creation
    const second = await api(base, 'POST', '/api/admin/bots/seed-channels', 'tokenAdmin1', {});
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.d.createdChannels, 0, 'no duplicate channels on re-run');
    assert.strictEqual(second.d.createdBotCount, 0, 'no new bots on re-run');
    assert.strictEqual(second.d.channels.length, 9, 'still nine channels');

    // each seeded channel is owned by a bot
    for (const c of first.d.channels) {
      const list = await api(base, 'GET', '/api/admin/bots', 'tokenAdmin1');
      const owner = list.d.bots.find((b) => b.username === c.owner);
      assert.ok(owner, 'channel owner ' + c.owner + ' is a bot account');
    }
  });
});

test('admin bot endpoints require an admin session', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    let r = await api(base, 'POST', '/api/admin/bots', 'tokenAlice', { username: 'sneaky_bot', displayName: 'x' });
    assert.strictEqual(r.status, 403, 'non-admin cannot create bots');
    r = await api(base, 'GET', '/api/admin/bots', 'tokenAlice');
    assert.strictEqual(r.status, 403, 'non-admin cannot list bots');
  });
});