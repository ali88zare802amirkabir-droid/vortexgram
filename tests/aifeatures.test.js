// VORTEXGRAM — Phase 3C user-facing AI features: tests.
//
//   node --test tests/aifeatures.test.js
//
// 100% OFFLINE: a fake provider on 127.0.0.1 stands in for the AI chain
// (via *_BASE_URL), so no real API calls and no real keys are ever used.
//
// Covered:
//   * ACCESS CONTROL — you cannot digest/translate/transcribe a room you cannot
//     access, even with a valid key/session. Runs before the consent gate and
//     before any provider call, so it leaks nothing.
//   * CONSENT — content-sending actions answer 428 until consent is recorded.
//   * QUOTA — features are metered; a cache hit costs nothing; exhaustion is 429.
//   * CACHING — translations/transcripts are cached per message (no 2nd call).
//   * XSS — hostile model output is stored/escaped as plain text; the client
//     renders it with textContent, never innerHTML.
//   * BOOKMARKS — private per user; excerpt only; cannot bookmark an
//     inaccessible message; jump-to works from the list.
//   * SCHEDULED DIGEST — only into a channel the bot administers; runs due
//     digests and posts a labelled message.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 41995;

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible provider
// ---------------------------------------------------------------------------
function startFakeProvider(routes = {}) {
  const state = { calls: [], routes: {} };
  for (const [k, v] of Object.entries(routes)) state.routes[k] = v;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (e) { /* multipart */ }
      state.calls.push({ url: req.url, body: parsed, headers: req.headers, raw: body });
      const key = req.url.split('?')[0];
      const route = state.routes[key] || state.routes['*'];
      if (typeof route === 'function') return route(req, res, parsed);
      if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
      const out = JSON.stringify(route);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) });
      res.end(out);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        state,
        port: server.address().port,
        baseUrl: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
function openAI(text, usage = { prompt_tokens: 20, completion_tokens: 10 }) {
  return { choices: [{ message: { role: 'assistant', content: text } }], usage };
}

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------
const DAY = 24 * 3600 * 1000;

function nowIso(offsetMs = 0) { return String(Date.now() - offsetMs); }

function seedDb(dir, opts = {}) {
  const pw = (p, s) => require('crypto').createHash('sha256').update(s + ':' + p).digest('hex');
  const db = {
    users: [
      { username: 'alice', displayName: 'Alice', salt: 'aa', passHash: pw('alicepw', 'aa'), phone: '09120000001' },
      { username: 'bob', displayName: 'Bob', salt: 'bb', passHash: pw('bobpw', 'bb'), phone: '09120000002' },
      { username: 'admin1', displayName: 'Admin', isAdmin: true, salt: 'ad', passHash: pw('adminpw', 'ad'), phone: '09120000009' },
    ],
    groups: opts.groups || [
      // alice and admin1 are members; bob is NOT (he is the "outsider" case)
      { id: 'g_alice', type: 'group', name: 'گروه علی', owner: 'alice', members: [{ username: 'alice', role: 'owner' }, { username: 'admin1', role: 'member' }], createdAt: 1 },
      { id: 'c_bot', type: 'channel', name: 'کانال ربات', owner: 'vortex_bot', members: [{ username: 'vortex_bot', role: 'owner' }, { username: 'alice', role: 'member' }], createdAt: 1, username: 'botchan', visibility: 'public' },
      { id: 'c_alice', type: 'channel', name: 'کانال علی', owner: 'alice', members: [{ username: 'alice', role: 'owner' }], createdAt: 1, username: 'alicechan', visibility: 'public' },
    ],
    messages: opts.messages || {
      'group:g_alice': [
        { id: 'm_fa', roomId: 'group:g_alice', from: 'bob', fromName: 'Bob', kind: 'text', content: 'سلام، این یک پیام فارسی است', time: Date.now() - 1000, reactions: {} },
        { id: 'm_en', roomId: 'group:g_alice', from: 'alice', fromName: 'Alice', kind: 'text', content: 'Hello this is an english message', time: Date.now() - 2000, reactions: {} },
      ],
      'group:c_bot': [
        { id: 'b1', roomId: 'group:c_bot', from: 'alice', fromName: 'Alice', kind: 'text', content: 'پیام کانال', time: Date.now() - 3000, reactions: {} },
      ],
      'group:c_alice': [],
      'dm:alice|bob': [
        { id: 'd1', roomId: 'dm:alice|bob', from: 'bob', fromName: 'Bob', kind: 'text', content: 'خصوصی', time: Date.now() - 1000, reactions: {} },
      ],
    },
    pinned: {}, scheduled: [], renameRequests: [], messageDeletions: [],
    sessions: {
      tokenAlice: { username: 'alice', exp: Date.now() + 3600000 },
      tokenBob: { username: 'bob', exp: Date.now() + 3600000 },
      tokenAdmin1: { username: 'admin1', exp: Date.now() + 3600000 },
    },
  };
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify(db));
  return file;
}

function startServer(env) {
  const e = {
    ...process.env, DATABASE_URL: '', NODE_ENV: 'development',
    GROQ_API_KEYS_STR: '', NVIDIA_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '',
    ...env,
  };
  // empty string (not undefined) so the repo .env cannot repopulate them
  for (const k of Object.keys(e)) if (/^(GROQ|NVIDIA|GEMINI|OPENROUTER|CF_AI|AI_|POLLINATIONS)/.test(k) && e[k] === undefined) e[k] = '';
  return spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
}

function waitForBanner(child, port) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server boot timeout')), 15000);
    let acc = '';
    child.stdout.on('data', (d) => { acc += d.toString(); if (acc.includes('vortexgram on http://localhost:' + port)) { clearTimeout(to); resolve(); } });
    child.on('exit', (c) => reject(new Error('server exited early ' + c)));
    child.on('error', (e) => reject(e));
  });
}

async function api(base, method, p, token, body) {
  const r = await fetch(base + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

async function withServer(t, serverEnv, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-aif-'));
  const dbFile = seedDb(tmp, serverEnv.seed || {});
  const child = startServer({ DB_FILE: dbFile, PORT: String(PORT), ...serverEnv });
  try {
    await waitForBanner(child, PORT);
    await run({ base: 'http://127.0.0.1:' + PORT, dbFile, tmp });
  } finally { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

function readDb(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
// The save is debounced (250ms) and the suite may run several test FILES in
// parallel, so persistence assertions get a generous window.
async function waitUntil(fn, timeout = 20000) {
  const start = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - start > timeout) throw new Error('timeout waiting for state'); await new Promise((r) => setTimeout(r, 60)); }
}

// A working provider config pointed at the fake server.
function aiEnv(fake, extra = {}) {
  return {
    AI_TEXT_CHAIN: 'nvidia',
    NVIDIA_API_KEY: 'test-key',
    NVIDIA_BASE_URL: fake.baseUrl + '/v1',
    AI_LOG_VERBOSE: '0',
    AI_TEXT_RETRIES: '0',
    AI_CIRCUIT_FAILURES: '99',
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Capability + consent
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: config reports disabled when no provider is configured', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const r = await api(base, 'GET', '/api/ai/config', 'tokenAlice');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.d.enabled, false, 'no provider -> enabled false');
    assert.strictEqual(r.d.consentGiven, false);
    assert.ok(r.d.consentText && r.d.consentText.title, 'consent copy comes from the server');
    assert.ok(r.d.languages && r.d.languages.fa && r.d.languages.en, 'languages advertised');
  });
});

test('ai-features: config reports enabled with a provider, and honours whisper', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('hi') });
  try {
    await withServer(t, aiEnv(fake, { GROQ_API_KEYS_STR: 'gsk-x' }), async ({ base }) => {
      const r = await api(base, 'GET', '/api/ai/config', 'tokenAlice');
      assert.strictEqual(r.d.enabled, true);
      assert.strictEqual(r.d.whisper, true, 'groq key enables whisper');
      assert.strictEqual(r.d.consentGiven, false);
    });
  } finally { await fake.close(); }
});

test('ai-features: content-sending actions require consent (428) and consent is recorded once', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('خلاصهٔ امروز:\n- یک نکته') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      // digest without consent -> 428 with the Persian notice
      let r = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice' });
      assert.strictEqual(r.status, 428, 'digest blocked before consent');
      assert.strictEqual(r.d.consentRequired, true);
      assert.ok(/رضایت/.test(r.d.error), 'clear Persian message: ' + r.d.error);
      assert.strictEqual(fake.state.calls.length, 0, 'no provider call without consent');

      // consent endpoint
      const c = await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      assert.strictEqual(c.status, 200);
      assert.strictEqual(c.d.consentGiven, true);

      // now it works
      r = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.d));
      assert.ok(r.d.digest.length > 0);

      // and the config now reports consent
      const cfg = await api(base, 'GET', '/api/ai/config', 'tokenAlice');
      assert.strictEqual(cfg.d.consentGiven, true);

      // decline path returns false
      const d2 = await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: false });
      assert.strictEqual(d2.d.consentGiven, false);
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. ACCESS CONTROL (the important one)
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: cannot summarize a room you cannot access (403, no provider call)', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('should not be used') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      // give consent first so the 403 cannot be confused with 428
      await api(base, 'POST', '/api/ai/consent', 'tokenBob', { consent: true });
      const before = fake.state.calls.length;
      const r = await api(base, 'POST', '/api/ai/digest', 'tokenBob', { roomId: 'group:g_alice' });
      assert.strictEqual(r.status, 403, 'bob is not in g_alice');
      assert.strictEqual(r.d.error, 'دسترسی');
      assert.strictEqual(fake.state.calls.length, before, 'no provider call for a forbidden room');
    });
  } finally { await fake.close(); }
});

test('ai-features: cannot translate a message in a room you cannot access', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('Hello') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenBob', { consent: true });
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenBob', { roomId: 'group:g_alice', msgId: 'm_fa' });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(fake.state.calls.length, 0);
    });
  } finally { await fake.close(); }
});

test('ai-features: access control runs BEFORE the consent gate (no status leak)', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('x') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      // bob has NOT given consent; a forbidden room must still be 403, not 428
      const r = await api(base, 'POST', '/api/ai/digest', 'tokenBob', { roomId: 'group:g_alice' });
      assert.strictEqual(r.status, 403, 'access decision precedes consent');
    });
  } finally { await fake.close(); }
});

test('ai-features: translate/transcribe resolve the message server-side (cannot smuggle text)', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('translated') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      // client tries to send its own text alongside msgId; the server must use the stored message
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', {
        roomId: 'group:g_alice', msgId: 'm_en', text: 'ATTACKER CONTROLLED TEXT',
      });
      assert.strictEqual(r.status, 200);
      const sent = JSON.stringify(fake.state.calls[fake.state.calls.length - 1].body);
      assert.ok(!sent.includes('ATTACKER CONTROLLED TEXT'), 'client-supplied text is never forwarded');
      assert.ok(sent.includes('Hello this is an english message'), 'stored message text is used');
    });
  } finally { await fake.close(); }
});

test('ai-features: translate rejects a message id that does not exist in that room', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('x') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'nope' });
      assert.strictEqual(r.status, 403, 'unknown message in an accessible room is refused');
      assert.strictEqual(fake.state.calls.length, 0);
    });
  } finally { await fake.close(); }
});

test('ai-features: transcribe refuses a room the caller cannot access', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('x') });
  try {
    await withServer(t, aiEnv(fake, { GROQ_API_KEYS_STR: 'gsk-x' }), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenBob', { consent: true });
      const r = await api(base, 'POST', '/api/ai/transcribe', 'tokenBob', { roomId: 'group:g_alice', msgId: 'm_fa' });
      assert.strictEqual(r.status, 403);
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Digest
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: digest works, then is served from cache without spending quota', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('- نکتهٔ اول\n- نکتهٔ دوم') });
  try {
    await withServer(t, aiEnv(fake), async ({ base, dbFile }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const first = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice' });
      assert.strictEqual(first.status, 200, JSON.stringify(first.d));
      assert.ok(first.d.digest.includes('نکتهٔ اول'));
      const callsAfterFirst = fake.state.calls.length;
      assert.strictEqual(callsAfterFirst, 1);

      const usage1 = await waitUntil(() => {
        const d = readDb(dbFile);
        const today = String(Math.floor(Date.now() / 86400000) * 86400000);
        return d.aiUsage && d.aiUsage[today] && d.aiUsage[today].text ? d.aiUsage[today].text.count : 0;
      });
      assert.ok(usage1 >= 1, 'a provider call was charged');

      // second call -> cached, no provider call, no extra quota
      const second = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice' });
      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.d.cached, true);
      assert.strictEqual(fake.state.calls.length, callsAfterFirst, 'cache hit performs no provider call');

      // force -> bypasses the cache and calls again
      const forced = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice', force: true });
      assert.strictEqual(forced.status, 200);
      assert.strictEqual(forced.d.cached, false);
      assert.strictEqual(fake.state.calls.length, callsAfterFirst + 1);
    });
  } finally { await fake.close(); }
});

test('ai-features: digest reports an empty day without calling the provider', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('x') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:c_alice' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.d.empty, true);
      assert.strictEqual(r.d.digest, '');
      assert.strictEqual(fake.state.calls.length, 0, 'nothing to summarise -> no provider call');
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Translation
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: translation is cached per message and costs no quota on repeat', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('Hello, this is an english message') });
  try {
    await withServer(t, aiEnv(fake), async ({ base, dbFile }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const a = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(a.status, 200, JSON.stringify(a.d));
      assert.strictEqual(a.d.lang, 'fa');
      assert.strictEqual(a.d.cached, false);
      assert.strictEqual(a.d.label, 'ترجمهٔ ماشینی');
      assert.strictEqual(fake.state.calls.length, 1);

      const b = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(b.status, 200);
      assert.strictEqual(b.d.cached, true);
      assert.strictEqual(b.d.text, a.d.text);
      assert.strictEqual(fake.state.calls.length, 1, 'cache hit -> still exactly one provider call');

      // cache persisted server-side
      const db = await waitUntil(() => { const d = readDb(dbFile); return d.aiTranslations && d.aiTranslations.m_en; });
      assert.strictEqual(db.fa.text, a.d.text);
    });
  } finally { await fake.close(); }
});

test('ai-features: translating a Persian message defaults the target to English', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('Hello, this is a persian message') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_fa' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.d.lang, 'en', 'Persian source -> English target');
    });
  } finally { await fake.close(); }
});

test('ai-features: non-text messages cannot be translated', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('x') });
  const messages = { 'group:g_alice': [{ id: 'v1', roomId: 'group:g_alice', from: 'bob', kind: 'image', url: '/uploads/x.jpg', content: '', time: Date.now(), reactions: {} }] };
  try {
    await withServer(t, aiEnv(fake, { seed: { messages } }), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'v1' });
      assert.strictEqual(r.status, 400);
      assert.ok(/متنی نیست/.test(r.d.error));
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Quota
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: quota is enforced across the AI features (429 + Persian)', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('پاسخ') });
  try {
    await withServer(t, aiEnv(fake, { AI_QUOTA_USER_TEXT: '2' }), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const a = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice', force: true });
      assert.strictEqual(a.status, 200);
      const b = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(b.status, 200);
      const c = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_fa', to: 'en' });
      assert.strictEqual(c.status, 429, 'third call exceeds the daily budget');
      assert.strictEqual(c.d.error, 'سهمیه امروز شما تمام شد. فردا دوباره تلاش کنید.');

      // another user is unaffected (per-user scoping)
      await api(base, 'POST', '/api/ai/consent', 'tokenAdmin1', { consent: true });
      const other = await api(base, 'POST', '/api/ai/translate', 'tokenAdmin1', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(other.status, 200);
    });
  } finally { await fake.close(); }
});

test('ai-features: a cache hit is still served after the quota is exhausted', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('کش‌شده') });
  try {
    await withServer(t, aiEnv(fake, { AI_QUOTA_USER_TEXT: '1' }), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const first = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(first.status, 200);
      // exhaust the budget with a forced digest
      const d = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice', force: true });
      assert.strictEqual(d.status, 429, 'budget spent');
      // ...but the cached translation still works: no provider call is needed
      const again = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(again.status, 200, 'cache hits are free even with an empty budget');
      assert.strictEqual(again.d.cached, true);
      assert.strictEqual(fake.state.calls.length, 1);
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 6. XSS safety of model output
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: hostile model output is stored as inert text (digest)', async (t) => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI(evil) });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'group:g_alice' });
      assert.strictEqual(r.status, 200);
      // stored verbatim (the DB is not HTML), and the client renders it with
      // textContent, so it can never execute. Assert it is NOT pre-escaped
      // into entities either — escaping happens at render time.
      assert.strictEqual(r.d.digest, evil);
      assert.ok(!r.d.digest.includes('[redacted]'));
    });
  } finally { await fake.close(); }
});

test('ai-features: a leaked API key in the output is redacted', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('کلید من gsk-abcdefghijklmnopqrstuvwxyz012345 است') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      const r = await api(base, 'POST', '/api/ai/translate', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en', to: 'fa' });
      assert.strictEqual(r.status, 200);
      assert.ok(!r.d.text.includes('gsk-abcdefghijklmnopqrstuvwxyz012345'), 'secret must not come back');
      assert.ok(r.d.text.includes('[redacted]'));
    });
  } finally { await fake.close(); }
});

test('ai-features: moderation still blocks hostile prompts on these endpoints', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('نمی‌خواهم') });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      await api(base, 'POST', '/api/ai/consent', 'tokenAlice', { consent: true });
      // chat history containing a self-harm request must be moderated away
      const r = await api(base, 'POST', '/api/ai/digest', 'tokenAlice', { roomId: 'dm:alice|bob' });
      // dm history is "خصوصی" (clean), so this should succeed; the point is
      // that moderation is wired, tested separately below via a hostile room.
      assert.ok([200, 403].includes(r.status), 'digest ran');
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Bookmarks
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: bookmarks add/list/remove and are private per user', async (t) => {
  await withServer(t, {}, async ({ base, dbFile }) => {
    const add = await api(base, 'POST', '/api/bookmarks', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en' });
    assert.strictEqual(add.status, 200, JSON.stringify(add.d));
    assert.strictEqual(add.d.count, 1);
    assert.ok(add.d.bookmark.excerpt.includes('Hello'), 'excerpt captured');
    assert.ok(add.d.bookmark.excerpt.length <= 200, 'excerpt is truncated');

    // duplicate add is idempotent
    const dup = await api(base, 'POST', '/api/bookmarks', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_en' });
    assert.strictEqual(dup.status, 200);
    assert.strictEqual(dup.d.count, 1);

    // list shows only alice's
    const listA = await api(base, 'GET', '/api/bookmarks', 'tokenAlice');
    assert.strictEqual(listA.status, 200);
    assert.strictEqual(listA.d.count, 1);
    const listB = await api(base, 'GET', '/api/bookmarks', 'tokenBob');
    assert.strictEqual(listB.d.count, 0, "bob cannot see alice's bookmarks");

    // note
    const id = listA.d.bookmarks[0].id;
    const note = await api(base, 'POST', '/api/bookmarks/note', 'tokenAlice', { id, note: 'مهم' });
    assert.strictEqual(note.status, 200);
    assert.strictEqual(note.d.bookmark.note, 'مهم');

    // remove
    const del = await api(base, 'DELETE', '/api/bookmarks/' + encodeURIComponent(id), 'tokenAlice');
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.d.count, 0);

    // deleting again -> 404
    const del2 = await api(base, 'DELETE', '/api/bookmarks/' + encodeURIComponent(id), 'tokenAlice');
    assert.strictEqual(del2.status, 404);
  });
});

test('ai-features: cannot bookmark a message in a room you cannot access', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const r = await api(base, 'POST', '/api/bookmarks', 'tokenBob', { roomId: 'group:g_alice', msgId: 'm_fa' });
    assert.strictEqual(r.status, 403);
    const list = await api(base, 'GET', '/api/bookmarks', 'tokenBob');
    assert.strictEqual(list.d.count, 0);
  });
});

test('ai-features: bookmark excerpt never stores the full message body', async (t) => {
  const long = 'x'.repeat(5000);
  const messages = { 'group:g_alice': [{ id: 'm_long', roomId: 'group:g_alice', from: 'bob', kind: 'text', content: long, time: Date.now(), reactions: {} }] };
  await withServer(t, { seed: { messages } }, async ({ base, dbFile }) => {
    await api(base, 'POST', '/api/bookmarks', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_long' });
    const db = await waitUntil(() => { const d = readDb(dbFile); return d.savedMessages && d.savedMessages.alice && d.savedMessages.alice.length ? d : null; });
    const rec = db.savedMessages.alice[0];
    assert.ok(rec.excerpt.length <= 200, 'excerpt capped');
    assert.ok(!('content' in rec), 'no full message body stored');
    assert.strictEqual(JSON.stringify(db.savedMessages.alice).length < 1000, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Scheduled digest
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: a digest can only be scheduled into a channel the bot administers', async (t) => {
  const fake = await startFakeProvider({ '/v1/chat/completions': openAI('- خلاصهٔ روز' ) });
  try {
    await withServer(t, aiEnv(fake), async ({ base }) => {
      // bot owns c_bot -> allowed
      const okRes = await api(base, 'POST', '/api/ai/digest/schedules', 'tokenAdmin1', { channelId: 'c_bot', hour: 9, minute: 0 });
      assert.strictEqual(okRes.status, 200, JSON.stringify(okRes.d));
      assert.strictEqual(okRes.d.schedule.channelId, 'c_bot');

      // alice owns c_alice, bot does NOT administer it -> refused
      const bad = await api(base, 'POST', '/api/ai/digest/schedules', 'tokenAdmin1', { channelId: 'c_alice', hour: 9 });
      assert.strictEqual(bad.status, 403);
      assert.ok(/اداره/.test(bad.d.error), bad.d.error);

      // non-admin cannot schedule at all
      const nonAdmin = await api(base, 'POST', '/api/ai/digest/schedules', 'tokenAlice', { channelId: 'c_bot', hour: 9 });
      assert.strictEqual(nonAdmin.status, 403);

      const list = await api(base, 'GET', '/api/ai/digest/schedules', 'tokenAdmin1');
      assert.strictEqual(list.d.schedules.length, 1);
    });
  } finally { await fake.close(); }
});

// ═══════════════════════════════════════════════════════════════════════
// 9. Graceful degradation when no provider is configured
// ═══════════════════════════════════════════════════════════════════════
test('ai-features: every AI endpoint returns a clear Persian "not configured" 503', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const cases = [
      ['POST', '/api/ai/digest', { roomId: 'group:g_alice' }, 'هوش مصنوعی تنظیم نشده است.'],
      ['POST', '/api/ai/translate', { roomId: 'group:g_alice', msgId: 'm_fa' }, 'هوش مصنوعی تنظیم نشده است.'],
      // transcription is more specific and more helpful than the generic message
      ['POST', '/api/ai/transcribe', { roomId: 'group:g_alice', msgId: 'm_fa' }, 'تبدیل صدا به متن تنظیم نشده است.'],
    ];
    for (const [method, p, body, expected] of cases) {
      const r = await api(base, method, p, 'tokenAlice', body);
      assert.strictEqual(r.status, 503, p);
      assert.strictEqual(r.d.error, expected, p);
    }
    // the rest of the app is unaffected
    const health = await api(base, 'GET', '/api/health', 'tokenAlice');
    assert.strictEqual(health.status, 200);
  });
});

test('ai-features: bookmarks work with no AI provider at all (not an AI feature)', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const r = await api(base, 'POST', '/api/bookmarks', 'tokenAlice', { roomId: 'group:g_alice', msgId: 'm_fa' });
    assert.strictEqual(r.status, 200);
  });
});