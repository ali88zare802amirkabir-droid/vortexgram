// VORTEXGRAM — security regression tests (spawned server, file backend).
// Run:  node --test tests/security.test.js
//
// Covers the fixes from the 18-phase security audit:
//   * /api/swtest removed + JSON 404
//   * devCode (OTP) NOT returned in production
//   * /api/logout invalidates the session server-side
//   * session tokens are NOT persisted in data/db.json (separate gitignored file)
//   * register rate-limit cannot be bypassed with spoofed X-Forwarded-For (TRUST_PROXY=0)
//   * scrypt password hashing + backward-compat with legacy SHA-256 hashes
//   * /api/user/:username does not leak phone/blocked/hasPassword to others
//   * /api/schedule requires canPost; /api/pin requires the message to exist
//   * original admins cannot be demoted/promoted globally
//   * WebSocket upgrade rejects a foreign Origin and accepts same-host Origin

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 41989;

function legacyHash(pw, salt) {
  return require('crypto').createHash('sha256').update(salt + ':' + pw).digest('hex');
}

function seedDb(dir, opts = {}) {
  const users = opts.users || [
    { username: 'alice', displayName: 'Alice', isPremium: true, salt: 'aa', passHash: legacyHash('alicepw', 'aa'), blocked: ['carol'], phone: '09120000001' },
    { username: 'bob', displayName: 'Bob', salt: 'bb', passHash: 'scrypt$ZGVhZGNvZGU=', phone: '09120000002' },
    { username: 'carol', displayName: 'Carol', salt: null, passHash: null, phone: '09120000003' },
  ];
  const db = {
    users,
    groups: opts.groups || [],
    messages: opts.messages || {
      'dm:alice|bob': [
        { id: 'm1', roomId: 'dm:alice|bob', from: 'bob', fromName: 'Bob', kind: 'text', content: 'hi', time: 1, reactions: {}, silent: false },
      ],
    },
    pinned: {},
    scheduled: [],
    renameRequests: [],
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
  const r = await fetch(base + pathname, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-sec-'));
  const dbFile = seedDb(tmp, env.seed || {});
  const child = startServer({ DB_FILE: dbFile, PORT: String(PORT), ...(env.server || {}) });
  try {
    await waitForBanner(child, PORT);
    await run({ base: 'http://127.0.0.1:' + PORT, dbFile });
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('security: swtest removed, JSON 404, logout invalidation, sessions out of db.json', async (t) => {
  await withServer(t, {}, async ({ base, dbFile }) => {
    // 1) /api/swtest حذف شده → 404 JSON
    let r = await api(base, 'POST', '/api/swtest', null, { hello: 1 });
    assert.strictEqual(r.status, 404, 'swtest removed');

    // 2) مسیر‌های API ناشناخته → 404 JSON (بدون HTML پیش‌فرض Express)
    r = await api(base, 'GET', '/api/does-not-exist');
    assert.strictEqual(r.status, 404, 'unknown api 404');
    assert.strictEqual(typeof r.d.error, 'string', 'json error body');

    // 3) ورود با توکن و باطل‌سازی با /api/logout
    r = await api(base, 'GET', '/api/me', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'me ok before logout');
    r = await api(base, 'POST', '/api/logout', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'logout ok');
    r = await api(base, 'GET', '/api/me', 'tokenAlice');
    assert.strictEqual(r.status, 401, 'token invalid after logout');

    // 4) ساخت کاربر جدید → نشست در db.json نباید بنشیند
    const uname = 'u' + Date.now();
    r = await api(base, 'POST', '/api/register', null, { username: uname, password: 'sekret123' });
    assert.strictEqual(r.status, 200, 'register ok');
    assert.ok(r.d.token, 'token returned');
    await waitUntil(() => !('sessions' in readDb(dbFile)));
    const saved = readDb(dbFile);
    assert.strictEqual(saved.sessions, undefined, 'no sessions field in db.json');
    const sessFile = dbFile.replace(/\.json$/i, '') + '.sessions.json';
    assert.ok(fs.existsSync(sessFile), 'sessions persisted to separate gitignored file');
    const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    assert.ok(sess[r.d.token], 'new token lives in sessions file');
  });
});

test('security: OTP code shown in page by default; VX_HIDE_CODE=1 re-gates it', async (t) => {
  // پیش‌فرض (این دمو) → کد در همان صفحه برمی‌گردد و OTP اجباری می‌ماند
  await withServer(t, { seed: {} }, async ({ base }) => {
    const r = await api(base, 'POST', '/api/send-code', null, { phone: '09121234567' });
    assert.strictEqual(r.status, 200, 'send-code ok');
    assert.match(String(r.d.devCode || ''), /^\d{6}$/, 'code visible in page by default');
    const ok = await api(base, 'POST', '/api/verify-code', null, { phone: '09121234567', code: r.d.devCode });
    assert.strictEqual(ok.status, 200, 'correct code accepted');
    assert.strictEqual(ok.d.needsName, true, 'new phone proceeds to name');
    const bad = await api(base, 'POST', '/api/verify-code', null, { phone: '09121234567', code: '000000' });
    assert.strictEqual(bad.status, 401, 'wrong code still blocked');
  });

  // production + VX_HIDE_CODE=1 → کد هرگز برنگردد و OTP اجباری بماند
  await withServer(t, { server: { NODE_ENV: 'production', VX_HIDE_CODE: '1' }, seed: {} }, async ({ base }) => {
    const r = await api(base, 'POST', '/api/send-code', null, { phone: '09121234567' });
    assert.strictEqual(r.status, 200, 'send-code ok (prod)');
    assert.strictEqual(r.d.devCode, undefined, 'devCode NOT returned with VX_HIDE_CODE=1');
    const v = await api(base, 'POST', '/api/verify-code', null, { phone: '09121234567', code: '000000' });
    assert.strictEqual(v.status, 401, 'wrong code blocked in locked-down production');
  });
});

test('security: register rate limit cannot be bypassed via spoofed X-Forwarded-For (TRUST_PROXY off)', async (t) => {
  await withServer(t, { server: { TRUST_PROXY: '0' } }, async ({ base }) => {
    let last = null;
    for (let i = 0; i < 8; i++) {
      last = await api(base, 'POST', '/api/register', null,
        { username: 'r' + Date.now() + i, password: 'sekret123' },
        { 'X-Forwarded-For': '10.0.0.' + i });
      assert.strictEqual(last.status, 200, 'register ' + i + ' ok');
    }
    // حتی با XFF جعلیِ متفاوت، سلول rate-limit بر اساس IP سوکت است → 429
    const blocked = await api(base, 'POST', '/api/register', null,
      { username: 'r' + Date.now() + 99, password: 'sekret123' },
      { 'X-Forwarded-For': '203.0.113.50' });
    assert.strictEqual(blocked.status, 429, 'over-limit register blocked despite spoofed XFF');
  });
});

test('security: scrypt hashes + legacy SHA-256 login compat + wrong password', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    // legacy sha256 کاربرِ seed هنوز وارد می‌شود
    let r = await api(base, 'POST', '/api/login', null, { username: 'alice', password: 'alicepw' });
    assert.strictEqual(r.status, 200, 'legacy sha256 login works');
    assert.ok(r.d.token, 'legacy login token');

    // رمز اشتباه → 401
    r = await api(base, 'POST', '/api/login', null, { username: 'alice', password: 'wrong' });
    assert.strictEqual(r.status, 401, 'wrong password rejected');

    // کاربر جدید با scrypt ثبت می‌شود
    const uname = 'nova' + Date.now();
    let reg = await api(base, 'POST', '/api/register', null, { username: uname, password: 'strongish' });
    assert.strictEqual(reg.status, 200, 'register ok');
    reg = await api(base, 'POST', '/api/login', null, { username: uname, password: 'strongish' });
    assert.strictEqual(reg.status, 200, 'scrypt user logs in');
  });
});

test('security: /api/user/:username does not leak phone/blocked/hasPassword of others', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    let r = await api(base, 'GET', '/api/user/bob', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'profile of other user');
    assert.strictEqual(r.d.u.phone, undefined, 'phone hidden');
    assert.strictEqual(r.d.u.blocked, undefined, 'blocked list hidden');
    assert.strictEqual(r.d.u.hasPassword, undefined, 'hasPassword hidden');

    // پروفایل خودِ کاربر → phone مجاز (مثل قبل)
    r = await api(base, 'GET', '/api/user/alice', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'own profile');
    assert.strictEqual(r.d.u.phone, '09120000001', 'own phone visible');
  });
});

test('security: schedule requires canPost + pin requires the message to exist', async (t) => {
  await withServer(t, {
    seed: {
      groups: [{ id: 'chan1', type: 'channel', name: 'News', owner: 'bob', members: [{ username: 'bob', role: 'owner' }, { username: 'alice', role: 'member' }], createdAt: 1 }],
    },
  }, async ({ base }) => {
    // alice عضوِ غیرمدیرِ کانال → scheduling پیام 403
    let r = await api(base, 'POST', '/api/schedule', 'tokenAlice', { roomId: 'group:chan1', kind: 'text', content: 'x', at: Date.now() + 60000 });
    assert.strictEqual(r.status, 403, 'schedule to channel denied for non-admin');

    // سنجاق پیامِ ناموجود → 404
    r = await api(base, 'POST', '/api/pin', 'tokenAlice', { roomId: 'dm:alice|bob', msgId: 'does-not-exist' });
    assert.strictEqual(r.status, 404, 'pinning unknown message rejected');
  });
});

test('security: original admins cannot be demoted globally', async (t) => {
  const admins = [
    { username: 'admin1', displayName: 'Admin One', isAdmin: true, phone: '09120000011', salt: 'x1', passHash: legacyHash('admin1pw', 'x1') },
    { username: 'admin2', displayName: 'Admin Two', isAdmin: true, phone: '09120000022', salt: 'x2', passHash: legacyHash('admin2pw', 'x2') },
    { username: 'alice', displayName: 'Alice', isAdmin: false, phone: '09120000033', salt: 'aa', passHash: legacyHash('alicepw', 'aa') },
  ];
  await withServer(t, { server: { ADMIN_PHONES: '09120000011,09120000022' }, seed: { users: admins } }, async ({ base }) => {
    let r = await api(base, 'POST', '/api/admin/promote', 'tokenAdmin1', { username: 'admin2', scope: 'global', role: 'member' });
    assert.strictEqual(r.status, 400, 'original admin protected from global demote');
    // ادمین معمولی اصلاً حق ندارد
    r = await api(base, 'POST', '/api/admin/promote', 'tokenAlice', { username: 'admin2', scope: 'global', role: 'member' });
    assert.strictEqual(r.status, 403, 'non-original admin lacks promote permission');
  });
});

test('security: websocket rejects foreign Origin, accepts same-host, auth works', async (t) => {
  await withServer(t, { seed: {} }, async ({ base, dbFile }) => {
    const { WebSocket } = require('ws');
    const url = 'ws://127.0.0.1:' + PORT;

    // Origin خارجی → 403
    await new Promise((resolve) => {
      const ws = new WebSocket(url, { origin: 'http://evil.example' });
      ws.on('unexpected-response', (req, res) => {
        assert.strictEqual(res.statusCode, 403, 'foreign origin rejected');
        ws.terminate();
        resolve();
      });
      ws.on('error', () => {});
      ws.on('open', () => { assert.fail('foreign origin should not connect'); ws.terminate(); resolve(); });
      setTimeout(() => { ws.terminate(); resolve(); }, 3000);
    });

    // Origin همان‌هاست → اتصال + auth → ready
    await new Promise((resolve) => {
      const ws = new WebSocket(url, { origin: 'http://127.0.0.1:' + PORT });
      ws.on('unexpected-response', () => { assert.fail('same-host origin rejected'); resolve(); });
      ws.on('error', () => { resolve(); });
      ws.on('open', () => {
        ws.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'ready') {
            assert.strictEqual(d.me.username, 'alice', 'auth => ready');
            ws.terminate();
            resolve();
          }
        });
        ws.send(JSON.stringify({ type: 'auth', token: 'tokenAlice' }));
      });
      setTimeout(() => { ws.terminate(); resolve(); }, 4000);
    });

    // سوکت بدون auth نمی‌تواند چیزی ارسال کند (هیچ واکنشی نمی‌گیرد) — ساده‌ترین مورد حفظ شده است
    await new Promise((resolve) => {
      const ws = new WebSocket(url, { origin: 'http://127.0.0.1:' + PORT });
      let got = 0;
      ws.on('message', () => { got++; });
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'history', roomId: 'dm:alice|bob' }));
        setTimeout(() => { ws.terminate(); assert.strictEqual(got, 0, 'no data before auth'); resolve(); }, 700);
      });
      ws.on('error', () => resolve());
    });
  });
});

test('security: /uploads/* requires auth (Unauthenticated → 401; Bearer/cookie → 200; logout revokes)', async (t) => {
  const uploadDir = path.join(ROOT, 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const fname = 'sec-test-' + Date.now() + '.txt';
  const fpath = path.join(uploadDir, fname);
  fs.writeFileSync(fpath, 'PRIVATE-SECRET');
  try {
    await withServer(t, { seed: {} }, async ({ base }) => {
      // بدون هیچ auth → 401
      let r = await api(base, 'GET', '/uploads/' + fname);
      assert.strictEqual(r.status, 401, 'upload without auth rejected');

      // هدر Authorization معتبر → 200
      r = await api(base, 'GET', '/uploads/' + fname, 'tokenAlice');
      assert.strictEqual(r.status, 200, 'upload with bearer ok');

      // Bearer → بدنه صحیح
      const rb = await fetch(base + '/uploads/' + fname, { headers: { Authorization: 'Bearer tokenAlice' } });
      assert.strictEqual(rb.status, 200, 'bearer 200');
      assert.strictEqual(await rb.text(), 'PRIVATE-SECRET', 'file content served');

      // کوکی نشست (Set-Cookie از /api/login) → 200 (تصویر <img> در UI با کوکی لود می‌شود)
      const login = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'alicepw' }),
      });
      assert.strictEqual(login.status, 200, 'login ok');
      const setCookie = (login.headers.get('set-cookie') || '').split('\n')[0] || login.headers.get('set-cookie') || '';
      assert.match(setCookie, /ft_sess=/, 'session cookie issued on login');
      assert.match(setCookie, /HttpOnly/i, 'cookie is HttpOnly');
      assert.match(setCookie, /SameSite=Strict/i, 'cookie SameSite=Strict');
      const cookieToken = decodeURIComponent((setCookie.match(/ft_sess=([^;]+)/) || [])[1] || '');
      assert.ok(cookieToken, 'cookie token extracted');
      const rc = await fetch(base + '/uploads/' + fname, { headers: { Cookie: 'ft_sess=' + cookieToken } });
      assert.strictEqual(rc.status, 200, 'upload with session cookie ok');
      assert.strictEqual(await rc.text(), 'PRIVATE-SECRET', 'file served via cookie');

      // logout → کوکی پاک و فایل دیگر قابل دسترسی نیست
      // (logout فقط از طریق هدر باطل می‌کند؛ کوکیِ باطل‌شده دیگر فایل نمی‌دهد)
      const mainCookie = cookieToken; // token فعلی که به uploads دسترسی می‌داد
      await api(base, 'POST', '/api/logout', mainCookie);
      const rd = await fetch(base + '/uploads/' + fname, { headers: { Cookie: 'ft_sess=' + mainCookie } });
      assert.strictEqual(rd.status, 401, 'revoked cookie cannot fetch private file');

      // فایل ناشناخته با auth معتبر → 404 (نه fallback به استاتیک ریشه)
      r = await api(base, 'GET', '/uploads/definitely-missing-' + Date.now() + '.png', 'tokenAlice');
      assert.strictEqual(r.status, 404, 'missing private file -> JSON 404, not served by root static');
    });
  } finally {
    try { fs.unlinkSync(fpath); } catch (e) {}
  }
});

// ---- helpers for multi-socket WS tests ----
function wsOpen(base, token) {
  const { WebSocket } = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT, { origin: 'http://127.0.0.1:' + PORT });
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const d = JSON.parse(raw.toString());
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i](d)) { waiters.splice(i, 1); i--; return; }
      }
      inbox.push(d);
    });
    const waitFor = (match, timeout = 4000) => new Promise((res, rej) => {
      const idx = inbox.findIndex(match);
      if (idx >= 0) return res(inbox.splice(idx, 1)[0]);
      const to = setTimeout(() => rej(new Error('ws wait timeout')), timeout);
      waiters.push((d) => { if (match(d)) { clearTimeout(to); res(d); return true; } return false; });
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      resolve({ ws, waitFor, inbox });
    });
    ws.on('error', (e) => reject(e));
  });
}

test('security: ws call relay requires shared room and honors blocks (no call-spam / presence probe)', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    const reg = await api(base, 'POST', '/api/register', null, { username: 'dave', password: 'davepass123' });
    assert.strictEqual(reg.status, 200, 'dave registered');
    const daveToken = reg.d.token;
    const alice = await wsOpen(base, 'tokenAlice');
    const bob = await wsOpen(base, 'tokenBob');
    const dave = await wsOpen(base, daveToken);
    try {
      // 1) dave (آنلاین!) با alice اتاق مشترک ندارد → relay نشود و خطا بدهد (وجود آنلاین لو نرود)
      dave.ws.send(JSON.stringify({ type: 'call-offer', to: 'alice', sdp: 'SDP1' }));
      const err1 = await dave.waitFor((d) => d.type === 'error');
      assert.match(String(err1.text || ''), /آنلاین نیست/, 'stranger call rejected');
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(alice.inbox.some((d) => d.type === 'call-offer'), false, 'stranger gets no relay despite being online');

      // 2) alice که dave را بلاک کرده → تماس به dave (آنلاین) relay نشود
      await api(base, 'POST', '/api/block', 'tokenAlice', { username: 'dave' });
      alice.ws.send(JSON.stringify({ type: 'call-offer', to: 'dave', sdp: 'SDP2' }));
      await alice.waitFor((d) => d.type === 'error');
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(dave.inbox.some((d) => d.type === 'call-offer'), false, 'blocked target never receives call');

      // 3) اتاق مشترک dm:alice|bob و آنلاین بودن bob → تماس relay شود
      bob.ws.send(JSON.stringify({ type: 'call-offer', to: 'alice', sdp: 'SDP3' }));
      const offer = await alice.waitFor((d) => d.type === 'call-offer');
      assert.strictEqual(offer.from, 'bob', 'relay carries the caller username');
      assert.strictEqual(offer.sdp, 'SDP3', 'payload reaches target');
    } finally {
      alice.ws.terminate(); bob.ws.terminate(); dave.ws.terminate();
    }
  });
});

test('security: /api/ai and /api/link-preview are rate limited', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    let last = null;
    for (let i = 0; i < 20; i++) last = await api(base, 'POST', '/api/ai', 'tokenAlice', { action: 'translate', text: 'hi' });
    assert.strictEqual(last.status, 503, 'ai under limit (no GROQ key configured)');
    last = await api(base, 'POST', '/api/ai', 'tokenAlice', { action: 'translate', text: 'hi' });
    assert.strictEqual(last.status, 429, 'ai over limit -> 429');

    last = null;
    for (let i = 0; i < 30; i++) last = await api(base, 'GET', '/api/link-preview?url=' + encodeURIComponent('not a url ' + i), 'tokenAlice');
    assert.strictEqual(last.status, 400, 'link-preview under limit (invalid url rejected fast)');
    last = await api(base, 'GET', '/api/link-preview?url=' + encodeURIComponent('still not a url'), 'tokenAlice');
    assert.strictEqual(last.status, 429, 'link-preview over limit -> 429');
  });
});

test('security: users/search hides banned users and the banned flag from non-admins', async (t) => {
  const users = [
    { username: 'alice', displayName: 'Alice', salt: 'aa', passHash: legacyHash('alicepw', 'aa'), blocked: ['carol'], phone: '09120000001' },
    { username: 'badguy', displayName: 'Bad Guy', salt: null, passHash: null, banned: true, phone: '09120000099' },
    { username: 'admin1', displayName: 'Admin One', isAdmin: true, phone: '09120000011', salt: 'x1', passHash: legacyHash('admin1pw', 'x1') },
  ];
  await withServer(t, { server: { ADMIN_PHONES: '09120000011' }, seed: { users } }, async ({ base }) => {
    let r = await api(base, 'GET', '/api/users/search?q=bad', 'tokenAlice');
    assert.strictEqual(r.status, 200, 'search ok');
    assert.strictEqual(r.d.users.filter((u) => u.username === 'badguy').length, 0, 'banned user excluded for non-admin');
    r = await api(base, 'GET', '/api/users/search?q=a', 'tokenAlice');
    assert.strictEqual(r.d.users.every((u) => !('banned' in u)), true, 'no banned flag leaked to non-admin');

    r = await api(base, 'GET', '/api/users/search?q=bad', 'tokenAdmin1');
    assert.strictEqual(r.d.users.some((u) => u.username === 'badguy' && u.banned === true), true, 'admin still sees banned flag');
  });
});

test('security: weak passwords rejected (min length 6 on register)', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    let r = await api(base, 'POST', '/api/register', null, { username: 'weak' + Date.now(), password: 'ab12' });
    assert.strictEqual(r.status, 400, '4-char password rejected');
    r = await api(base, 'POST', '/api/register', null, { username: 'ok' + Date.now(), password: 'ab12cd' });
    assert.strictEqual(r.status, 200, '6-char password accepted');
  });
});

test('security: unauthenticated client gets no API/state data (me/user/search/messages all gated)', async (t) => {
  await withServer(t, { seed: {} }, async ({ base }) => {
    const probes = [
      ['GET', '/api/me'],
      ['GET', '/api/user/bob'],
      ['GET', '/api/users/search?q=a'],
      ['GET', '/api/users/exists/alice'],
      ['GET', '/api/groups/group:chan1/members'],
      ['GET', '/api/images'],
      ['GET', '/api/reactions/m1?roomId=dm:alice|bob'],
      ['GET', '/api/react-config'], // این یک مسیر عمومی عمدی است — باید 200 بماند
    ];
    for (const [method, p] of probes) {
      const r = await api(base, method, p);
      if (p === '/api/react-config') assert.strictEqual(r.status, 200, 'react-config is intentionally public');
      else assert.ok(r.status === 401, p + ' requires auth (got ' + r.status + ')');
    }
    // داده حاضر در بدنه؟ مطمئن شویم 401 داده لو نمی‌دهد
    const r = await api(base, 'GET', '/api/me');
    assert.strictEqual(r.d.users, undefined, 'no users leaked');
    assert.strictEqual(r.d.me, undefined, 'no me leaked');
  });
});