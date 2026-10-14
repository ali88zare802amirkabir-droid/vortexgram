/* VORTEX — Phase 4 screenshot + DOM-metrics harness (reused by slices A–G).
 *
 *   node tools/phase4-shots.js [slice] [--view-only]
 *
 * Produces the required evidence matrix, per slice:
 *   4 viewports (390x844, 430x932, 360x640, 1440x900)
 *     × 2 themes (dark = default 'cyber', light)
 *     × 2 modes  (glass, saver)
 *   = 16 screenshots -> docs/screenshots/phase4/<slice>/<w>x<h>-<theme>-<mode>.png
 *
 * Alongside each screenshot it collects DOM metrics (positions, computed
 * backdrop-filter, overflow, a11y names) and writes
 *   docs/screenshots/phase4/<slice>/metrics.json
 *
 * It boots the REAL server.js against a throwaway JSON DB, registers two users,
 * seeds a DM so the shell has content, then drives headless Chrome.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = process.env.VX_ROOT || 'D:\\Projects\\Vortex\\messenger';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUPPETEER = path.join(ROOT, 'node_modules', 'puppeteer-core');
const WS = path.join(ROOT, 'node_modules', 'ws');
const SLICE = (process.argv[2] || 'sliceA').replace(/[^a-zA-Z0-9_-]/g, '');
const OUT = path.join(ROOT, 'docs', 'screenshots', 'phase4', SLICE);
const PORT = Number(process.env.VX_SHOT_PORT || 4612);
const BASE = 'http://127.0.0.1:' + PORT;
const puppeteer = require(PUPPETEER);
const WebSocket = require(WS);

const VIEWPORTS = [
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  { w: 360, h: 640 },
  { w: 1440, h: 900 },
];
const THEMES = ['dark', 'light'];   // dark = app default (no data-theme)
const MODES = ['glass', 'saver'];   // glass = blur on, saver = power saving on

const TMP = path.join(os.tmpdir(), 'vx-p4-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

function log() { console.log.apply(console, ['[p4]'].concat([].slice.call(arguments))); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        data ? { 'content-length': data.length } : {},
        token ? { authorization: 'Bearer ' + token } : {}
      ),
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, json, body: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitReady() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      http.get(BASE + '/', (res) => { res.resume(); resolve(); }).on('error', () => {
        if (++tries > 80) return reject(new Error('server never came up'));
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

/* ── the DOM metric probe ───────────────────────────────────────────────────
   Kept in one place so every slice reports the same shape and results can be
   diffed slice-to-slice. `metrics.extra(page)` lets a slice add its own probe. */
async function probe(page) {
  return page.evaluate(() => {
    const out = {};
    const de = document.documentElement;
    const cs = getComputedStyle(de);

    // — shell flags —
    out.flags = {
      theme: de.getAttribute('data-theme') || 'cyber',
      glass: de.getAttribute('data-glass'),
      power: de.getAttribute('data-power'),
      motion: de.getAttribute('data-motion'),
      lowend: de.getAttribute('data-lowend'),
      dir: de.getAttribute('dir') || de.dir || null,
    };
    out.design = (window.VXDesign && window.VXDesign.snapshot) ? window.VXDesign.snapshot() : null;
    out.designEffective = (window.VXDesign && window.VXDesign.effectivePower) ? window.VXDesign.effectivePower : null;

    // — horizontal overflow —
    out.horizontalOverflow = de.scrollWidth > window.innerWidth + 1;
    out.docScrollW = de.scrollWidth;
    out.viewportW = window.innerWidth;

    // — floating pill —
    const pill = document.querySelector('.vx-pill');
    if (pill) {
      const r = pill.getBoundingClientRect();
      const st = getComputedStyle(pill);
      out.pill = {
        present: true,
        visible: st.display !== 'none' && r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        backdropFilter: st.backdropFilter || st.webkitBackdropFilter || 'none',
        background: st.backgroundColor,
        inViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
        buttons: pill.querySelectorAll('.vx-pill-btn').length,
        selected: pill.querySelector('.vx-pill-btn[aria-selected="true"]') ? (pill.querySelector('.vx-pill-btn[aria-selected="true"] .lb') || {}).textContent : null,
        tabRoles: Array.prototype.filter.call(pill.querySelectorAll('[role="tab"]'), (b) => true).length,
        tabsRoving: Array.prototype.filter.call(pill.querySelectorAll('.vx-pill-btn'), (b) => b.tabIndex === 0).length,
      };
      const ind = pill.querySelector('.vx-pill-ind');
      if (ind) {
        const ir = ind.getBoundingClientRect();
        out.pill.indicator = {
          w: Math.round(ir.width), x: Math.round(ir.x),
          transform: getComputedStyle(ind).transform,
          widthProp: ind.style.width,
        };
      }
      // does the pill collide with the composer / last list row?
      const comp = document.querySelector('.composer');
      if (comp) {
        const cr = comp.getBoundingClientRect();
        out.pill.overlapsComposer = !(r.right <= cr.left || r.left >= cr.right || r.bottom <= cr.top || r.top >= cr.bottom);
      }
      // list bottom clearance
      const items = document.querySelector('#cl-items');
      if (items) {
        const pb = parseFloat(getComputedStyle(document.querySelector('#chat-list-column')).paddingBottom) || 0;
        out.pill.listBottomPadding = pb;
        out.pill.listClearsPill = pb >= r.height + 8;
      }
    } else {
      out.pill = { present: false };
    }

    // — desktop rail —
    const rail = document.getElementById('nav-sidebar');
    if (rail) {
      const rr = rail.getBoundingClientRect();
      const st = getComputedStyle(rail);
      out.rail = {
        visible: st.display !== 'none' && rr.width > 0,
        w: Math.round(rr.width),
        expanded: rail.classList.contains('expanded'),
        backdropFilter: st.backdropFilter || 'none',
        items: rail.querySelectorAll('.nav-item').length,
        itemDirs: rail.querySelector('.nav-item') ? getComputedStyle(rail.querySelector('.nav-item')).flexDirection : null,
        labelsShown: rail.querySelector('.nav-item .label') ? getComputedStyle(rail.querySelector('.nav-item .label')).display : null,
        onScreen: rr.left >= -1 && rr.right <= window.innerWidth + 1,
      };
    }

    // — legacy dock must be gone —
    const dock = document.getElementById('command-dock');
    out.legacyDockHidden = !dock || getComputedStyle(dock).display === 'none';

    // — a11y: interactive controls must have an accessible name —
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hasName = (el) => {
      if ((el.getAttribute('aria-label') || '').trim()) return true;
      const alb = el.getAttribute('aria-labelledby');
      if (alb) { const ref = document.getElementById(alb.split(' ')[0]); if (ref && (ref.textContent || '').trim()) return true; }
      if ((el.textContent || '').trim()) return true;
      if (el.getAttribute('title')) return false;
      return false;
    };
    const missing = [];
    document.querySelectorAll('button, [role="button"], [role="tab"]').forEach((el) => {
      if (!visible(el)) return;
      if (hasName(el)) return;
      missing.push((el.id ? '#' + el.id : (el.className ? '.' + String(el.className).split(' ')[0] : el.tagName)));
    });
    out.a11yUnnamedControls = missing.slice(0, 20);

    return out;
  });
}

/* Global pass/fail rollup over all shots. */
function evaluate(m) {
  const f = [];
  if (!m.flags || m.flags.power === null || m.flags.glass === null) f.push('missing shell flags');
  if (m.horizontalOverflow) f.push('horizontal overflow');
  if (m.viewportW < 900) {
    if (!m.pill.present || !m.pill.visible) f.push('pill hidden on mobile');
    if (m.pill.present && m.pill.inViewport === false) f.push('pill out of viewport');
    if (m.pill.present && m.pill.overlapsComposer) f.push('pill overlaps composer');
    if (m.pill.present && m.pill.listClearsPill === false) f.push('list not cleared behind pill');
    // the morphing highlight must actually sit under the active tab
    if (m.pill.present && m.pill.indicator) {
      const ind = m.pill.indicator;
      const pr = m.pill.rect;
      if (ind.w < 20) f.push('indicator too narrow');
      else if (ind.x < pr.x - 1 || ind.x + ind.w > pr.x + pr.w + 1) f.push('indicator outside pill @' + ind.x + '..' + (ind.x + ind.w) + ' pill ' + pr.x + '..' + (pr.x + pr.w));
    }
  } else {
    if (m.pill.present && m.pill.visible) f.push('pill should be hidden on desktop');
    if (m.rail && m.rail.visible === false) f.push('desktop rail hidden');
  }
  if (m.pill.present && m.pill.visible && m.pill.buttons !== 4) f.push('pill tab count != 4');
  if (m.pill.present && m.pill.tabsRoving > 1) f.push('more than one tab tabbable');
  if (!m.legacyDockHidden) f.push('legacy dock still visible');
  if (m.viewportW >= 900 && m.rail && m.rail.itemDirs !== 'column') f.push('desktop rail not column');
  if (m.viewportW >= 900 && m.rail && m.rail.labelsShown !== 'none' && !m.rail.expanded) f.push('collapsed rail still shows labels');
  if (m.a11yUnnamedControls && m.a11yUnnamedControls.length) f.push('unnamed controls: ' + m.a11yUnnamedControls.join(','));
  return f;
}

async function main() {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), NODE_ENV: 'development', VX_HIDE_CODE: '1',
    DB_FILE: path.join(TMP, 'db.json'), SESSIONS_FILE: path.join(TMP, 'sessions.json'),
  });
  delete env.DATABASE_URL; delete env.R2_ACCOUNT_ID; delete env.R2_ACCESS_KEY_ID;
  delete env.R2_SECRET_ACCESS_KEY; delete env.R2_BUCKET; delete env.R2_PUBLIC_BASE;
  const logf = fs.openSync(path.join(TMP, 'server.log'), 'w');
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', logf, logf] });

  const browserErrors = [];
  try {
    await waitReady();
    log('server up on', PORT, '| slice', SLICE);

    // — accounts (register rate-limit: 8 per 60s per IP) —
    const ali = (await req('POST', '/api/register', { username: 'ali', password: 'Test12345!', displayName: 'علیرضا' })).json;
    const bob = (await req('POST', '/api/register', { username: 'bob', password: 'Test12345!', displayName: 'بابک' })).json;
    if (!ali || !ali.token || !bob || !bob.token) throw new Error('register failed: ' + JSON.stringify([ali && ali.error, bob && bob.error]));
    log('registered ali, bob');

    // — seed a DM so the chat list has a real row —
    await new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:' + PORT);
      const rid = 'dm:ali|bob';
      const lines = [
        'سلام علیرضا! پنل موبایل چطور پیش میره؟',
        'کنتراست متن هم مهمه، یادت نره',
        'لیست چت‌ها الان شلوغ‌تره، خوبه',
      ];
      let i = 0;
      const send = () => {
        if (i >= lines.length) { setTimeout(() => { try { ws.close(); } catch (e) {} resolve(); }, 400); return; }
        ws.send(JSON.stringify({ type: 'message', roomId: rid, kind: 'text', content: lines[i++] }));
        setTimeout(send, 150);
      };
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: bob.token })));
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.type === 'ready') send();
      });
      ws.on('error', () => resolve());
      setTimeout(resolve, 6000);
    });
    log('seeded DM');

    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--lang=fa'],
    });

    const results = {};
    const failures = [];

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((tok, me) => {
        try {
          localStorage.setItem('ft_token', tok);
          localStorage.setItem('ft_me', JSON.stringify(me));
          localStorage.setItem('ft_me_ts', String(Date.now()));
          localStorage.removeItem('vx_pwa_dismissed');
        } catch (e) {}
      }, ali.token, ali.me);
      page.on('pageerror', (e) => { browserErrors.push(vp.w + 'x' + vp.h + ' ' + e.message); log('PAGEERROR', e.message); });

      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => {
        const app = document.getElementById('app');
        return app && !app.classList.contains('hidden') && typeof state !== 'undefined' && state.me && state.me.username;
      }, { timeout: 25000 }).catch(() => {});

      for (const theme of THEMES) {
        for (const mode of MODES) {
          const name = vp.w + 'x' + vp.h + '-' + theme + '-' + mode;
          await page.evaluate((th, md) => {
            try {
              localStorage.setItem('vx_theme', th === 'light' ? 'light' : 'cyber');
              localStorage.setItem('vx_glass', md === 'glass' ? '1' : '0');
              localStorage.setItem('vx_power', md === 'saver' ? 'saver' : 'auto');
            } catch (e) {}
          }, theme, mode);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForFunction(() => {
            const app = document.getElementById('app');
            return app && !app.classList.contains('hidden') && typeof state !== 'undefined' && state.me && state.me.username;
          }, { timeout: 25000 }).catch(() => {});
          await sleep(700);

          const m = await probe(page);
          m.screenshot = name + '.png';
          m.viewport = vp;
          m.theme = theme;
          m.mode = mode;
          const fails = evaluate(m);
          m.fail = fails;
          results[name] = m;
          if (fails.length) failures.push(name + ' :: ' + fails.join(' | '));
          await page.screenshot({ path: path.join(OUT, name + '.png') });
          log('shot', name, fails.length ? 'FAIL ' + fails.join(' | ') : 'ok');
        }
      }
      await page.close();
    }

    /* ── interaction checks on the primary mobile viewport ──
       Static screenshots cannot prove that the highlight actually follows
       navigation, that the roving tabindex works, or that the glass/power API
       reacts live. These do. */
    const inter = await browser.newPage();
    await inter.evaluateOnNewDocument((tok, me) => {
      try {
        localStorage.setItem('ft_token', tok);
        localStorage.setItem('ft_me', JSON.stringify(me));
        localStorage.setItem('ft_me_ts', String(Date.now()));
        localStorage.setItem('vx_theme', 'cyber');
        localStorage.setItem('vx_glass', '1');
        localStorage.setItem('vx_power', 'auto');
      } catch (e) {}
    }, ali.token, ali.me);
    inter.on('pageerror', (e) => { browserErrors.push('interactions ' + e.message); log('PAGEERROR(interactions)', e.message); });
    await inter.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await inter.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await inter.waitForFunction(() => {
      const app = document.getElementById('app');
      return app && !app.classList.contains('hidden') && typeof state !== 'undefined' && state.me && state.me.username;
    }, { timeout: 25000 }).catch(() => {});
    await sleep(600);

    const interactions = {};
    const selTab = () => inter.evaluate(() => {
      const p = document.querySelector('.vx-pill');
      if (!p) return null;
      const a = p.querySelector('.vx-pill-btn[aria-selected="true"]');
      const ind = p.querySelector('.vx-pill-ind');
      const pr = p.getBoundingClientRect();
      const ir = ind ? ind.getBoundingClientRect() : null;
      return {
        tab: a ? (a.querySelector('.lb') || {}).textContent : null,
        focusable: Array.prototype.filter.call(p.querySelectorAll('.vx-pill-btn'), (b) => b.tabIndex === 0).length,
        ind: ir ? { x: Math.round(ir.x), w: Math.round(ir.width), inside: ir.left >= pr.left - 1 && ir.right <= pr.right + 1 } : null,
      };
    });
    const seen = {};
    for (const tab of ['chats', 'contacts', 'settings']) {
      await inter.evaluate((id) => { try { switchNav(id); } catch (e) {} }, tab);
      await sleep(500);
      const s = await selTab();
      seen[tab] = s;
      if (!s || s.tab === null) failures.push('nav->' + tab + ' :: no active tab');
      else if (!s.ind || !s.ind.inside) failures.push('nav->' + tab + ' :: indicator outside pill ' + JSON.stringify(s && s.ind));
      else if (s.focusable !== 1) failures.push('nav->' + tab + ' :: focusable tabs=' + s.focusable);
    }
    interactions.tabs = seen;
    // the indicator must have MOVED between tabs, not merely been on-screen
    const xs = Object.keys(seen).map((k) => (seen[k] && seen[k].ind ? seen[k].ind.x : null));
    interactions.indicatorMoved = new Set(xs.filter((v) => v !== null)).size >= 2;
    if (!interactions.indicatorMoved) failures.push('indicator did not move between tabs: ' + JSON.stringify(xs));

    // keyboard: ArrowRight must move focus to the next tab (roving tabindex)
    await inter.evaluate(() => { try { switchNav('chats'); } catch (e) {} });
    await sleep(400);
    interactions.keyboard = await inter.evaluate(async () => {
      const p = document.querySelector('.vx-pill');
      const btns = p ? Array.prototype.slice.call(p.querySelectorAll('.vx-pill-btn')) : [];
      if (!btns.length) return { ok: false, reason: 'no tabs' };
      btns[0].focus();
      btns[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      const ae = document.activeElement;
      return { ok: !!(ae && ae !== btns[0] && ae.getAttribute('role') === 'tab'), focused: ae ? (ae.querySelector('.lb') || {}).textContent : null };
    });
    if (!interactions.keyboard.ok) failures.push('keyboard ArrowRight did not move focus: ' + JSON.stringify(interactions.keyboard));

    // sidebar design switches: glass + power-saving must be real, named controls.
    interactions.designControls = await inter.evaluate(async () => {
      const g = document.getElementById('nav-glass');
      const p = document.getElementById('nav-power');
      if (!g || !p) return { ok: false, reason: 'controls missing', g: !!g, p: !!p };
      const named = (el) => !!((el.getAttribute('aria-label') || '').trim() || (el.textContent || '').trim());
      const start = { glassPressed: g.getAttribute('aria-pressed'), powerMode: p.dataset.mode, powerLabel: (p.querySelector('.label') || {}).textContent };
      g.click();
      await new Promise((r) => setTimeout(r, 60));
      const afterGlass = g.getAttribute('aria-pressed');
      g.click();
      await new Promise((r) => setTimeout(r, 60));
      const restored = g.getAttribute('aria-pressed');

      const modes = [];
      for (let i = 0; i < 3; i++) {
        p.click();
        await new Promise((r) => setTimeout(r, 60));
        modes.push({ mode: p.dataset.mode, label: (p.querySelector('.label') || {}).textContent, de: document.documentElement.getAttribute('data-power') });
      }
      return {
        ok: named(g) && named(p) && start.glassPressed === 'true' && afterGlass === 'false' && restored === 'true' &&
          modes.length === 3 && new Set(modes.map((m) => m.mode)).size === 3 && modes.every((m) => m.label && m.de),
        named: { g: named(g), p: named(p) },
        start: start, afterGlass: afterGlass, restored: restored, modes: modes,
      };
    });
    if (!interactions.designControls.ok) failures.push('design switches broken: ' + JSON.stringify(interactions.designControls));

    // live glass / power toggles through the public design API.
    // NOTE: `data-power` is always the RESOLVED mode ('full'|'saver'); the
    // 'auto' preference lives in VXDesign.power and is resolved at apply time.
    interactions.designApi = await inter.evaluate(async () => {
      const D = window.VXDesign;
      if (!D) return { ok: false, reason: 'VXDesign missing' };
      const de = document.documentElement;
      const before = de.getAttribute('data-glass');
      D.toggleGlass();
      const off = de.getAttribute('data-glass');
      D.setGlass(true);
      const on = de.getAttribute('data-glass');

      D.setPower('auto');
      const autoPref = D.power;
      const autoAttr = de.getAttribute('data-power');
      const autoEff = D.effectivePower;

      D.setPower('saver');
      const saver = de.getAttribute('data-power');
      const saverFilter = getComputedStyle(document.querySelector('.vx-pill')).backdropFilter;
      const saverBg = getComputedStyle(document.querySelector('.vx-pill')).backgroundColor;

      D.setPower('full');
      const full = de.getAttribute('data-power');
      const fullFilter = getComputedStyle(document.querySelector('.vx-pill')).backdropFilter;
      D.setPower('auto');
      const endAttr = de.getAttribute('data-power');

      const blurOff = /none|0px/.test(saverFilter);
      const blurOn = /blur\((?!0px)/.test(fullFilter);
      return {
        ok:
          before === 'on' && off === 'off' && on === 'on' &&
          autoPref === 'auto' && (autoAttr === 'full' || autoAttr === 'saver') && autoEff === autoAttr &&
          saver === 'saver' && full === 'full' &&
          blurOff && blurOn && (endAttr === 'full' || endAttr === 'saver'),
        before: before, off: off, on: on,
        autoPref: autoPref, autoAttr: autoAttr, autoEff: autoEff,
        saver: saver, saverFilter: saverFilter, saverBg: saverBg,
        full: full, fullFilter: fullFilter, endAttr: endAttr,
        blurOff: blurOff, blurOn: blurOn,
      };
    });
    if (!interactions.designApi.ok) failures.push('design API toggles broken: ' + JSON.stringify(interactions.designApi));
    await inter.close();

    await browser.close();

    const summary = {
      slice: SLICE,
      generatedAt: new Date().toISOString(),
      total: Object.keys(results).length,
      failed: failures.length,
      failures,
      browserErrors,
    };
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ summary, interactions, results }, null, 2));
    log('interactions', JSON.stringify(interactions, null, 2));
    log('--- SUMMARY ---');
    log(JSON.stringify(summary, null, 2));
    log('written:', path.join(OUT, 'metrics.json'));
    if (failures.length || browserErrors.length) process.exitCode = 1;
  } finally {
    try { srv.kill(); } catch (e) {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });