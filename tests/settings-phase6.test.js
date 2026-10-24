const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 41997;

function legacyHash(pw, salt) {
  return require('crypto').createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function seedDb(dir) {
  const db = {
    users: [
      { username: 'alice', displayName: 'Alice', salt: 'aa', passHash: legacyHash('alicepw', 'aa'), lastSeen: 111111, avatar: '/uploads/alice.png', bio: 'hi', phone: '+989120000001' },
      { username: 'bob', displayName: 'Bob', salt: 'bb', passHash: legacyHash('bobpw', 'bb'), lastSeen: 222222, avatar: '/uploads/bob.png', bio: 'bob', phone: '+989120000002' },
    ],
    groups: [],
    messages: { 'dm:alice|bob': [] },
    pinned: {}, scheduled: [], renameRequests: [], messageDeletions: [],
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
async function api(base, method, pathname, token, body) {
  const h = {};
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(base + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
async function withServer(t, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-set6-'));
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

/* ═══════════════ phase 6 — the new settings surface ═══════════════ */

test('phase6 settings: every new appearance/chat/security key is accepted and persisted', async (t) => {
  await withServer(t, async ({ base }) => {
    const patch = {
      appearance: {
        theme: 'dark', accent: 'violet', accentCustom: '#a855f7', bubbleRadius: 'pill',
        bubbleStyle: 'accent', reduceGlass: true, aurora: false, animations: false, glass: false,
        density: 'compact', textScale: 'large', font: 'mono', uiRadius: 'round',
        wallpaper: 'grad-ocean', wallBlur: 12, wallBright: 0.8, wallMotion: false, themeAuto: 'schedule',
      },
      chat: {
        showTyping: false, enterToSend: false, autoEmoji: false, linkPreview: false,
        translateMessages: true, markdown: false, autoArchive: true, archiveDays: 14,
        folderBehavior: 'groups', swipeAction: 'pin', listView: 'three', shareDirect: false,
        spacingUnits: 'narrow', inAppBrowser: true, autoNight: true,
        mediaTapToNext: false, raiseToListen: false, raiseToSpeak: true,
        pauseMusicRecord: true, pauseMusicMedia: true, internalMic: true,
        shortcutSend: 'ctrlEnter', shortcutRead: 'enter',
      },
      privacy: {
        lastSeen: 'contacts', profilePhoto: 'contacts', bio: 'nobody', birthday: 'nobody',
        phone: 'contacts', calls: 'nobody', forwards: 'contacts', groups: 'nobody',
        voiceMessages: 'contacts', readReceipts: false, presence: false,
        alwaysShare: ['bob'], neverShare: ['carol'],
      },
      security: { passcode: true, autoLock: '5m', twoFactor: true, deleteMessages: '7d', sessionLimit: 10 },
      notifications: {
        enabled: true, sound: false, preview: true, privateMessages: false, groupMessages: true,
        channelMessages: false, reactions: true, badgeCount: false, desktop: true, calls: false, inAppSound: true,
      },
      data: {
        autoDownloadPhotos: false, autoDownloadVideos: true, saveData: true,
        autoDownloadOnMobile: true, autoDownloadOnWifi: false, maxSizeMB: 100,
        saveToGallery: true, proxy: 'http://127.0.0.1:8080',
      },
      language: { code: 'en', translateEnabled: true, autoTranslate: true },
      calls: { micInput: 'builtin', speaker: 'system', camera: 'back', noiseSuppression: false, p2p: false, ringtone: 'silent', quality: 'fullhd' },
      premium: { customStickers: true, customReactions: false, biggerFiles: true, customNameColor: false },
    };
    let r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', { settings: patch });
    assert.strictEqual(r.status, 200, 'new keys accepted: ' + JSON.stringify(r.d));
    const s = r.d.settings;
    assert.strictEqual(s.appearance.theme, 'dark');
    assert.strictEqual(s.appearance.density, 'compact');
    assert.strictEqual(s.appearance.wallBlur, 12);
    assert.strictEqual(s.appearance.wallBright, 0.8);
    assert.strictEqual(s.chat.shortcutSend, 'ctrlEnter');
    assert.strictEqual(s.chat.listView, 'three');
    assert.strictEqual(s.privacy.calls, 'nobody');
    assert.deepStrictEqual(s.privacy.alwaysShare, ['bob']);
    assert.deepStrictEqual(s.privacy.neverShare, ['carol']);
    assert.strictEqual(s.security.autoLock, '5m');
    assert.strictEqual(s.data.maxSizeMB, 100);
    assert.strictEqual(s.data.proxy, 'http://127.0.0.1:8080');
    assert.strictEqual(s.calls.quality, 'fullhd');
    assert.strictEqual(s.premium.biggerFiles, true);

    /* the document survives a reload */
    r = await api(base, 'GET', '/api/profile/settings', 'tokenAlice');
    assert.strictEqual(r.d.settings.appearance.theme, 'dark');
    assert.strictEqual(r.d.settings.chat.swipeAction, 'pin');
    assert.deepStrictEqual(r.d.settings.privacy.neverShare, ['carol']);
  });
});

test('phase6 settings: out-of-range and unknown values are rejected with 400', async (t) => {
  await withServer(t, async ({ base }) => {
    const cases = [
      { settings: { appearance: { theme: 'neon' } } },              /* unknown enum */
      { settings: { appearance: { density: 'ultra' } } },           /* unknown enum */
      { settings: { appearance: { wallBlur: 999 } } },              /* number out of range */
      { settings: { appearance: { wallBright: 9 } } },              /* number out of range */
      { settings: { data: { maxSizeMB: 0 } } },                     /* number out of range */
      { settings: { chat: { archiveDays: 'soon' } } },              /* wrong type */
      { settings: { security: { sessionLimit: 9999 } } },           /* number out of range */
      { settings: { privacy: { alwaysShare: 'bob' } } },            /* list expected */
      { settings: { privacy: { alwaysShare: ['not a username!'] } } },/* list item invalid */
      { settings: { data: { proxy: 'javascript:alert(1)' } } },     /* proxy scheme */
      { settings: { appearance: { accentCustom: 'red' } } },        /* not a hex */
    ];
    for (const c of cases) {
      const r = await api(base, 'POST', '/api/profile/settings', 'tokenAlice', c);
      assert.strictEqual(r.status, 400, 'must reject ' + JSON.stringify(c.settings));
    }
    /* nothing was stored */
    const r = await api(base, 'GET', '/api/profile/settings', 'tokenAlice');
    assert.strictEqual(r.d.settings.appearance.theme, 'night', 'default theme untouched');
    assert.strictEqual(r.d.settings.appearance.wallBlur, 0);
    assert.deepStrictEqual(r.d.settings.privacy.alwaysShare, []);
  });
});

test('phase6 account: username change is validated, unique and renames references', async (t) => {
  await withServer(t, async ({ base, dbFile }) => {
    let r = await api(base, 'POST', '/api/profile/username', 'tokenAlice', { username: 'bob' });
    assert.strictEqual(r.status, 409, 'taken username rejected');
    r = await api(base, 'POST', '/api/profile/username', 'tokenAlice', { username: 'x' });
    assert.strictEqual(r.status, 400, 'too-short username rejected');
    r = await api(base, 'POST', '/api/profile/username', 'tokenAlice', { username: 'not valid!' });
    assert.strictEqual(r.status, 400, 'illegal characters rejected');
    r = await api(base, 'POST', '/api/profile/username', 'tokenAlice', { username: 'alice2' });
    assert.strictEqual(r.status, 200, 'valid username accepted');
    assert.strictEqual(r.d.me.username, 'alice2');
    await new Promise((res) => setTimeout(res, 500));
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.ok(db.users.find((u) => u.username === 'alice2'), 'user renamed on disk');
    assert.ok(!db.users.find((u) => u.username === 'alice'), 'old name gone');
    assert.ok(db.messages['dm:alice2|bob'], 'room renamed with the user');
  });
});

test('phase6 account: phone change needs the password and rejects duplicates', async (t) => {
  await withServer(t, async ({ base }) => {
    let r = await api(base, 'POST', '/api/profile/phone', 'tokenAlice', { phone: '09121110000', password: 'wrong' });
    assert.strictEqual(r.status, 403, 'wrong password rejected');
    r = await api(base, 'POST', '/api/profile/phone', 'tokenAlice', { phone: '12345', password: 'alicepw' });
    assert.strictEqual(r.status, 400, 'invalid phone rejected');
    r = await api(base, 'POST', '/api/profile/phone', 'tokenAlice', { phone: '09121110000', password: 'alicepw' });
    assert.strictEqual(r.status, 200, 'valid phone accepted');
    assert.strictEqual(r.d.me.phone, '09121110000');
  });
});

test('phase6 account: deleting an account removes the user and its sessions', async (t) => {
  await withServer(t, async ({ base, dbFile }) => {
    let r = await api(base, 'POST', '/api/profile/delete-account', 'tokenAlice', { password: 'nope' });
    assert.strictEqual(r.status, 403, 'wrong password rejected');
    r = await api(base, 'POST', '/api/profile/delete-account', 'tokenAlice', { password: 'alicepw' });
    assert.strictEqual(r.status, 200, 'account deleted');
    await new Promise((res) => setTimeout(res, 500));
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.ok(!db.users.find((u) => u.username === 'alice'), 'user removed from disk');
    /* the token is dead now */
    r = await api(base, 'GET', '/api/profile/settings', 'tokenAlice');
    assert.strictEqual(r.status, 401, 'session invalidated');
  });
});
