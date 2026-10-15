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
const THEMES = ['dark', 'light', 'amoled'];   // dark = app default (no data-theme)
const MODES = ['glass', 'saver'];   // glass = blur on, saver = power saving on
const THEME_LS = { dark: 'cyber', light: 'light', amoled: 'amoled', cyber: 'cyber' };

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

    // — slice B: folder strip + chat rows —
    const bar = document.getElementById('cl-tabs');
    if (bar) {
      const tabs = Array.prototype.slice.call(bar.querySelectorAll('.vx-folder'));
      const act = bar.querySelector('.vx-folder[aria-selected="true"]');
      out.folders = {
        present: true,
        count: tabs.length,
        labels: tabs.map((t) => ((t.firstChild && t.firstChild.textContent) || '').trim()),
        active: act ? act.dataset.folder : null,
        addBtn: !!bar.querySelector('.vx-folder-add'),
        roving: tabs.filter((t) => t.tabIndex === 0).length,
        allTabs: tabs.every((t) => t.getAttribute('role') === 'tab'),
        allNamed: tabs.every((t) => !!((t.getAttribute('aria-label') || '').trim() || (t.textContent || '').trim())),
        overflowX: bar.scrollWidth > bar.clientWidth + 1,
        overflowXStyle: getComputedStyle(bar).overflowX,
        boxInViewport: (() => {
          const r = bar.getBoundingClientRect();
          return r.left >= -1 && r.right <= window.innerWidth + 1;
        })(),
        wrapped: bar.scrollHeight > bar.clientHeight + 2,
        height: Math.round(bar.getBoundingClientRect().height),
        // the list must not render underneath the strip
        listStartsBelow: (() => {
          const li = document.getElementById('cl-items');
          if (!li) return null;
          return li.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 2;
        })(),
      };
    } else {
      out.folders = { present: false };
    }

    const rows = document.querySelectorAll('#cl-items .chat-item');
    if (rows.length) {
      const r0 = rows[0];
      const surf = r0.querySelector('.ci-surface');
      const endAct = r0.querySelector('.ci-actions.end');
      const startAct = r0.querySelector('.ci-actions.start');
      out.chatRows = {
        count: rows.length,
        hasSurface: !!surf,
        surfaceIsTop: surf ? getComputedStyle(surf).zIndex !== 'auto' && parseFloat(getComputedStyle(surf).zIndex) > 0 : null,
        surfaceBg: surf ? getComputedStyle(surf).backgroundColor : null,
        rowBg: getComputedStyle(r0).backgroundColor,
        restActionsVisibility: endAct ? getComputedStyle(endAct).visibility : null,
        startActionsVisibility: startAct ? getComputedStyle(startAct).visibility : null,
        rowHeight: Math.round(r0.getBoundingClientRect().height),
        swipeClass: r0.classList.contains('swipe'),
        touchAction: surf ? getComputedStyle(surf).touchAction : null,
        surfaces: document.querySelectorAll('#cl-items .chat-item .ci-surface').length,
        actionCount: document.querySelectorAll('#cl-items .ci-act').length,
      };
    }

    // — slice C: search controls, no CSP-dead inline handlers, no stale view mode —
    const sInp = document.getElementById('cl-search-input');
    const sX = document.getElementById('cl-search-x');
    out.searchCtl = {
      present: !!(sInp && sX),
      inputNamed: !!(sInp && (sInp.getAttribute('aria-label') || '').trim()),
      clearPresent: !!sX,
      clearHidden: sX ? (sX.hidden === true) : null,
      clearNamed: !!(sX && (sX.getAttribute('aria-label') || '').trim()),
    };
    out.inlineHandlers = document.querySelectorAll('[onclick], [onchange], [oninput], [onkeydown]').length;
    out.appView = document.getElementById('app').classList.contains('app-view');
    out.nestedViewBody = document.querySelectorAll('.view-body .view-body').length;

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

    // — slice 5A: design tokens, self-hosted font, aurora, glass fallback —
    const aur = document.getElementById('vx-aurora');
    const blob0 = aur ? aur.querySelector('i') : null;
    out.tokens = {
      tokensSheet: !!Array.prototype.find.call(document.styleSheets, (s) => (s.href || '').indexOf('tokens.css') >= 0),
      fontFaceSheet: !!Array.prototype.find.call(document.styleSheets, (s) => (s.href || '').indexOf('font-face.css') >= 0),
      fontReady: (() => { try { return document.fonts && document.fonts.check('16px Vazirmatn'); } catch (e) { return null; } })(),
      bodyFont: getComputedStyle(document.body).fontFamily,
      radiusVar: cs.getPropertyValue('--vx-r-bubble').trim(),
      glassBlurVar: cs.getPropertyValue('--vx-glass-blur').trim(),
      glassSatVar: cs.getPropertyValue('--vx-glass-sat').trim(),
      accentVar: de.getAttribute('data-accent'),
      bubbleRadiusVar: de.getAttribute('data-bubble-radius'),
      themeVar: de.getAttribute('data-theme') || 'cyber',
      wallpaperVar: de.getAttribute('data-wallpaper'),
      reduceGlassClass: de.classList.contains('reduce-glass'),
      primaryRgb: cs.getPropertyValue('--primary-rgb').trim(),
      aurora: {
        present: !!aur,
        blobs: aur ? aur.querySelectorAll('i').length : 0,
        position: aur ? getComputedStyle(aur).position : null,
        pointerEvents: aur ? getComputedStyle(aur).pointerEvents : null,
        ariaHidden: aur ? aur.getAttribute('aria-hidden') : null,
        animationName: blob0 ? getComputedStyle(blob0).animationName : null,
      },
    };

    // — slice 5B: resizable panes + command palette —
    const rz = document.getElementById('vx-resize');
    if (rz) {
      const rst = getComputedStyle(rz);
      out.resize = {
        present: true,
        display: rst.display,
        role: rz.getAttribute('role'),
        orientation: rz.getAttribute('aria-orientation'),
        tabbable: rz.tabIndex === 0,
        hasName: !!((rz.getAttribute('aria-label') || '').trim()),
        valueMin: rz.getAttribute('aria-valuemin'),
        valueMax: rz.getAttribute('aria-valuemax'),
        valueNow: rz.getAttribute('aria-valuenow'),
        listW: cs.getPropertyValue('--vx-list-w').trim(),
      };
    } else {
      out.resize = { present: false };
    }
    const pal = document.getElementById('vx-palette');
    out.palette = {
      present: !!pal,
      hiddenByDefault: pal ? pal.classList.contains('hidden') : null,
      hasInput: !!(pal && pal.querySelector('#vx-palette-input')),
      hasList: !!(pal && pal.querySelector('#vx-palette-list')),
      role: pal ? pal.getAttribute('role') : null,
      modal: pal ? pal.getAttribute('aria-modal') : null,
      inputNamed: !!(pal && (function () { const i = pal.querySelector('#vx-palette-input'); return i && (i.getAttribute('aria-label') || '').trim(); })()),
    };

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
  // — slice B —
  if (m.folders && m.folders.present) {
    if (m.folders.count < 6) f.push('folder count < 6 (' + m.folders.count + ')');
    if (!m.folders.active) f.push('no active folder');
    if (m.folders.roving > 1) f.push('more than one folder tabbable');
    if (m.folders.allTabs === false) f.push('folders missing role=tab');
    if (m.folders.allNamed === false) f.push('folder without accessible name');
    if (!m.folders.addBtn) f.push('folder add button missing');
    // the strip may scroll (it is a scroll-snap row), but it must never wrap,
    // never leave the viewport, and never push page-level horizontal overflow
    if (m.folders.boxInViewport === false) f.push('folder strip out of viewport');
    if (m.folders.wrapped) f.push('folder strip wrapped to more than one row');
    if (m.folders.overflowX && ['auto', 'scroll'].indexOf(m.folders.overflowXStyle) < 0) f.push('overflowing folder strip is not scrollable');
    if (m.folders.listStartsBelow === false) f.push('chat list overlaps folder strip');
  }
    if (m.chatRows && m.chatRows.count) {
    if (!m.chatRows.hasSurface) f.push('chat row missing .ci-surface');
    if (m.chatRows.surfaceIsTop !== true) f.push('chat surface not layered above actions');
    if (m.chatRows.restActionsVisibility !== 'hidden') f.push('swipe actions visible at rest');
    if (m.chatRows.swipeClass === false) f.push('chat row not swipeable');
    if (m.chatRows.rowHeight < 60) f.push('chat row too short (' + m.chatRows.rowHeight + 'px)');
    if (m.chatRows.surfaces !== m.chatRows.count) f.push('rows without a surface');
  }
  // — slice C —
  if (!m.searchCtl || !m.searchCtl.present) f.push('search clear control missing');
  else {
    if (!m.searchCtl.inputNamed) f.push('chat search input has no accessible name');
    if (!m.searchCtl.clearNamed) f.push('search clear button has no accessible name');
    if (m.searchCtl.clearHidden !== true) f.push('search clear button visible with an empty query');
  }
  if (m.inlineHandlers) f.push('CSP-dead inline handlers present: ' + m.inlineHandlers);
  if (m.appView) f.push('app-view stuck while the chat list is shown');
  if (m.nestedViewBody) f.push('nested .view-body (double padding): ' + m.nestedViewBody);
  // — slice 5A: tokens / self-hosted font / aurora baseline (applies to every slice) —
  if (m.tokens) {
    if (!m.tokens.tokensSheet) f.push('tokens.css not loaded');
    if (!m.tokens.fontFaceSheet) f.push('font-face.css not loaded');
    if (!m.tokens.bodyFont || m.tokens.bodyFont.toLowerCase().indexOf('vazirmatn') < 0) f.push('body font not Vazirmatn: ' + m.tokens.bodyFont);
    if (!m.tokens.radiusVar) f.push('--vx-r-bubble token missing');
    if (!m.tokens.glassBlurVar) f.push('--vx-glass-blur token missing');
    if (!m.tokens.aurora.present) f.push('aurora layer missing');
    else {
      if (m.tokens.aurora.blobs !== 3) f.push('aurora blob count != 3');
      if (m.tokens.aurora.position !== 'fixed') f.push('aurora not fixed');
      if (m.tokens.aurora.pointerEvents !== 'none') f.push('aurora captures pointer events');
      if (m.tokens.aurora.ariaHidden !== 'true') f.push('aurora not aria-hidden');
    }
    if (m.tokens.wallpaperVar && ['set', 'none'].indexOf(m.tokens.wallpaperVar) < 0) f.push('unknown data-wallpaper: ' + m.tokens.wallpaperVar);
  }
  // — slice 5B: resizable panes + command palette —
  if (m.resize && m.resize.present) {
    const desktop = m.viewportW >= 720;
    if (desktop) {
      if (m.resize.display === 'none') f.push('resize handle hidden on desktop');
      if (m.resize.role !== 'separator') f.push('resize handle role != separator');
      if (m.resize.orientation !== 'vertical') f.push('resize handle aria-orientation != vertical');
      if (!m.resize.tabbable) f.push('resize handle not keyboard focusable');
      if (!m.resize.hasName) f.push('resize handle has no accessible name');
      if (!m.resize.listW) f.push('--vx-list-w token missing');
    } else if (m.resize.display !== 'none') {
      f.push('resize handle visible on mobile');
    }
  }
  if (!m.palette || !m.palette.present) f.push('command palette missing');
  else {
    if (m.palette.hiddenByDefault !== true) f.push('palette visible at rest');
    if (m.palette.role !== 'dialog') f.push('palette role != dialog');
    if (m.palette.modal !== 'true') f.push('palette aria-modal != true');
    if (!m.palette.hasInput || !m.palette.hasList) f.push('palette missing input/list');
  }
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
    const sara = (await req('POST', '/api/register', { username: 'sara', password: 'Test12345!', displayName: 'سارا' })).json;
    if (!ali || !ali.token || !bob || !bob.token || !sara || !sara.token) throw new Error('register failed: ' + JSON.stringify([ali && ali.error, bob && bob.error, sara && sara.error]));
    log('registered ali, bob, sara');

    // — seed DMs so the chat list has real rows —
    const seedDM = (token, rid, lines) => new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:' + PORT);
      let i = 0;
      const send = () => {
        if (i >= lines.length) { setTimeout(() => { try { ws.close(); } catch (e) {} resolve(); }, 400); return; }
        ws.send(JSON.stringify({ type: 'message', roomId: rid, kind: 'text', content: lines[i++] }));
        setTimeout(send, 150);
      };
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: token })));
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.type === 'ready') send();
      });
      ws.on('error', () => resolve());
      setTimeout(resolve, 6000);
    });
    await seedDM(bob.token, 'dm:ali|bob', [
      'سلام علیرضا! پنل موبایل چطور پیش میره؟',
      'کنتراست متن هم مهمه، یادت نره',
      'لیست چت‌ها الان شلوغ‌تره، خوبه',
    ]);
    await seedDM(sara.token, 'dm:ali|sara', [
      'امتحانام تموم شد بالاخره 😄',
      'یه لیست برای پروژه برات میفرستم',
    ]);
    log('seeded DMs');

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
          localStorage.setItem('vx_contacts_ali', JSON.stringify({ bob: 'بابک', sara: 'سارا' }));
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
          await page.evaluate((lsTheme, md) => {
            try {
              localStorage.setItem('vx_theme', lsTheme);
              localStorage.setItem('vx_glass', md === 'glass' ? '1' : '0');
              localStorage.setItem('vx_power', md === 'saver' ? 'saver' : 'auto');
            } catch (e) {}
          }, THEME_LS[theme] || 'cyber', mode);
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
        localStorage.setItem('vx_contacts_ali', JSON.stringify({ bob: 'بابک', sara: 'سارا' }));
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

    /* ── slice B: folder switching, custom folders, swipe, contacts ── */
    await inter.evaluate(() => { try { switchNav('chats'); } catch (e) {} });
    await sleep(400);

    interactions.folders = await inter.evaluate(async () => {
      const bar = document.getElementById('cl-tabs');
      if (!bar) return { ok: false, reason: 'no folder bar' };
      // NOTE: renderFolderBar() rebuilds every node, so always re-query — a held
      // reference goes stale the moment a folder is selected.
      const q = (id) => bar.querySelector('.vx-folder[data-folder="' + id + '"]');
      const tabs = () => Array.prototype.slice.call(bar.querySelectorAll('.vx-folder'));
      if (tabs().length < 6) return { ok: false, reason: 'tabs=' + tabs().length };
      const rowsNow = () => document.querySelectorAll('#cl-items .chat-item').length;
      const emptyNow = () => !!document.querySelector('#cl-items .empty-state');
      const act = () => { const a = bar.querySelector('.vx-folder[aria-selected="true"]'); return a ? a.dataset.folder : null; };
      const steps = [];
      for (const id of ['unread', 'private', 'groups', 'all']) {
        const t = q(id);
        if (!t) return { ok: false, reason: 'missing folder ' + id };
        t.click();
        await new Promise((r) => setTimeout(r, 220));
        const fresh = q(id);
        steps.push({
          id: id, active: act(), rows: rowsNow(), empty: emptyNow(),
          tabbable: tabs().filter((x) => x.tabIndex === 0).length,
          selected: fresh ? fresh.getAttribute('aria-selected') : null,
        });
      }
      // RTL keyboard: ArrowLeft moves forward
      const all = q('all');
      if (!all) return { ok: false, reason: 'all folder gone' };
      all.focus();
      all.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await new Promise((r) => setTimeout(r, 220));
      const ae = document.activeElement;
      const kb = { focused: (ae && ae.dataset && ae.dataset.folder) ? ae.dataset.folder : null };
      const unreadRows = (steps.filter((s) => s.id === 'unread')[0] || {}).rows;
      const allRows = (steps.filter((s) => s.id === 'all')[0] || {}).rows;
      const ok = steps.every((s) => s.active === s.id && s.tabbable === 1 && s.selected === 'true')
        && kb.focused && kb.focused !== 'all'
        && unreadRows !== undefined && allRows !== undefined && unreadRows <= allRows;
      return { ok: ok, steps: steps, kb: kb, unreadRows: unreadRows, allRows: allRows };
    });
    if (!interactions.folders.ok) failures.push('folder switching broken: ' + JSON.stringify(interactions.folders));

    interactions.folderManager = await inter.evaluate(async () => {
      const bar = document.getElementById('cl-tabs');
      if (!bar) return { ok: false, reason: 'no folder bar' };
      const before = bar.querySelectorAll('.vx-folder.custom').length;
      const add = bar.querySelector('.vx-folder-add');
      if (!add) return { ok: false, reason: 'no add button' };
      add.click();
      await new Promise((r) => setTimeout(r, 300));
      const pop = document.querySelector('.u-pop-box.vx-folder-box');
      if (!pop) return { ok: false, reason: 'manager did not open' };
      const nameInp = pop.querySelector('[data-k="name"]');
      const checks = pop.querySelectorAll('[data-k="chats"] input');
      if (!nameInp || !checks.length) return { ok: false, reason: 'manager incomplete' };
      nameInp.value = 'کاری';
      checks[0].click();
      await new Promise((r) => setTimeout(r, 60));
      pop.querySelector('[data-k="1"]').click();
      await new Promise((r) => setTimeout(r, 350));
      const custom = Array.prototype.slice.call(bar.querySelectorAll('.vx-folder.custom'));
      const created = custom.length === before + 1;
      const chip = custom[custom.length - 1];
      const label = chip ? ((chip.firstChild && chip.firstChild.textContent) || '').trim() : null;
      if (chip) chip.click();
      await new Promise((r) => setTimeout(r, 300));
      const a = bar.querySelector('.vx-folder[aria-selected="true"]');
      const activeFolder = a ? a.dataset.folder : null;
      let persisted = null;
      try { persisted = JSON.parse(localStorage.getItem('vxFolders:ali')) || null; } catch (e) { persisted = null; }
      const rows = document.querySelectorAll('#cl-items .chat-item').length;
      const empty = !!document.querySelector('#cl-items .empty-state');
      // delete it again
      if (activeFolder) { openFolderManager(activeFolder); await new Promise((r) => setTimeout(r, 280)); }
      const pop2 = document.querySelector('.u-pop-box.vx-folder-box');
      const hasDel = !!(pop2 && pop2.querySelector('[data-k="del"]'));
      if (hasDel) { pop2.querySelector('[data-k="del"]').click(); await new Promise((r) => setTimeout(r, 300)); }
      const afterDelete = bar.querySelectorAll('.vx-folder.custom').length;
      return {
        ok: created && !!(activeFolder && activeFolder.indexOf('f:') === 0) && !!persisted && hasDel && afterDelete === before,
        before: before, created: created, label: label,
        activeFolder: activeFolder, persisted: !!persisted, persistedCount: persisted ? persisted.length : 0,
        rows: rows, empty: empty, hasDel: hasDel, afterDelete: afterDelete,
      };
    });
    if (!interactions.folderManager.ok) failures.push('folder manager broken: ' + JSON.stringify(interactions.folderManager));

    interactions.swipe = await inter.evaluate(async () => {
      const row = document.querySelector('#cl-items .chat-item.swipe');
      if (!row) return { ok: false, reason: 'no chat row' };
      const surf = row.querySelector('.ci-surface');
      const end = row.querySelector('.ci-actions.end');
      const start = row.querySelector('.ci-actions.start');
      if (!surf || !end || !start) return { ok: false, reason: 'row incomplete' };
      const restVis = getComputedStyle(end).visibility;
      const rtl = getComputedStyle(row).direction === 'rtl';
      const box = surf.getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const dir = rtl ? 1 : -1; // toward the writing-mode start
      const pd = (type, x, y) => surf.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
        clientX: x, clientY: y, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      }));
      pd('pointerdown', cx, cy);
      let x = cx;
      for (let i = 1; i <= 15; i++) { x = cx + dir * (i * 9); pd('pointermove', x, cy); await new Promise((r) => setTimeout(r, 8)); }
      pd('pointerup', x, cy);
      await new Promise((r) => setTimeout(r, 350));
      const opened = row.classList.contains('open');
      const openVis = getComputedStyle(end).visibility;
      const tr = getComputedStyle(surf).transform;
      const buttonsFocusable = Array.prototype.every.call(end.querySelectorAll('.ci-act'), (b) => b.tabIndex === 0 && b.tagName === 'BUTTON');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'touch', clientX: 4, clientY: 4 }));
      await new Promise((r) => setTimeout(r, 420));
      const closed = !row.classList.contains('open');
      const restTr = getComputedStyle(surf).transform;
      const restVisAfter = getComputedStyle(end).visibility;
      const restTrClean = restTr === 'none' || restTr === 'matrix(1, 0, 0, 1, 0, 0)';
      return {
        ok: restVis === 'hidden' && opened && openVis === 'visible' && closed && restVisAfter === 'hidden' && buttonsFocusable && restTrClean,
        restVis: restVis, opened: opened, openVis: openVis, transform: tr,
        closed: closed, restTr: restTr, restTrClean: restTrClean, restVisAfter: restVisAfter, rtl: rtl, buttonsFocusable: buttonsFocusable,
      };
    });
    if (!interactions.swipe.ok) failures.push('swipe actions broken: ' + JSON.stringify(interactions.swipe));

    // contacts view: sections, naming, and a dedicated screenshot
    interactions.contacts = await inter.evaluate(async () => {
      switchNav('contacts');
      await new Promise((r) => setTimeout(r, 700));
      const view = document.querySelector('[data-view="contacts"]');
      if (!view) return { ok: false, reason: 'contacts view not rendered' };
      const secTitles = Array.prototype.slice.call(view.querySelectorAll('.vx-sec-title')).map((s) => (s.textContent || '').trim());
      const items = Array.prototype.slice.call(view.querySelectorAll('.contact-item'));
      const namesOk = items.every((it) => !!((it.getAttribute('aria-label') || '').trim() || (it.textContent || '').trim()));
      const btnsOk = Array.prototype.every.call(view.querySelectorAll('.contact-item .btn'), (b) => !!((b.getAttribute('aria-label') || '').trim() || (b.textContent || '').trim()));
      const empty = !!view.querySelector('.vx-empty');
      const emptyOk = !!view.querySelector('.vx-empty .t') || items.length > 0;
      const toolbar = !!view.querySelector('#ct-sync') && !!view.querySelector('#ct-invite');
      const search = !!view.querySelector('#ct-search');
      // every item must be reachable by keyboard
      const focusable = items.every((it) => it.tabIndex === 0);
      const sectioned = secTitles.length >= 1 || empty;
      return {
        ok: sectioned && namesOk && btnsOk && emptyOk && toolbar && search && focusable,
        sections: secTitles, items: items.length, namesOk: namesOk, btnsOk: btnsOk,
        empty: empty, toolbar: toolbar, search: search, focusable: focusable, sectioned: sectioned,
      };
    });
    if (!interactions.contacts.ok) failures.push('contacts view broken: ' + JSON.stringify(interactions.contacts));
    await inter.screenshot({ path: path.join(OUT, 'interactions-contacts.png') });
    await inter.evaluate(() => { try { switchNav('chats'); } catch (e) {} });
    await sleep(300);
    await inter.screenshot({ path: path.join(OUT, 'interactions-chats.png') });

    /* ── slice C: settings framework, profile screen, search ── */
    interactions.settings = await inter.evaluate(async () => {
      switchNav('settings');
      await new Promise((r) => setTimeout(r, 600));
      const view = document.querySelector('[data-view="settings"]');
      if (!view) return { ok: false, reason: 'settings view missing' };
      const main = view.querySelector('.settings-main');
      const cats = main ? Array.prototype.slice.call(main.querySelectorAll('.set-cat')) : [];
      const named = cats.length > 0 && cats.every((c) => !!((c.getAttribute('aria-label') || '').trim() || (c.textContent || '').trim()));
      const allButtons = cats.length > 0 && cats.every((c) => c.tagName === 'BUTTON');
      const grps = main ? main.querySelectorAll('.set-grp').length : 0;
      const rowGroups = main ? main.querySelectorAll('.set-rows').length : 0;
      const acct = main ? main.querySelector('.set-account') : null;
      const logoutRow = main ? main.querySelector('.set-cat[data-action="logout"]') : null;
      const nested = view.querySelectorAll('.view-body .view-body').length;
      const inline = view.querySelectorAll('[onclick]').length;
      const appView = document.getElementById('app').classList.contains('app-view');
      const headH2 = ((view.querySelector('.view-head h2') || {}).textContent || '').trim();
      return {
        ok: !!main && cats.length >= 8 && named && allButtons && grps >= 3 && rowGroups >= 3 &&
          !!acct && !!logoutRow && nested === 0 && inline === 0 && appView && headH2 === 'تنظیمات',
        cats: cats.length, named: named, allButtons: allButtons, grps: grps, rowGroups: rowGroups,
        hasAccount: !!acct, hasLogout: !!logoutRow, nested: nested, inline: inline,
        appView: appView, headH2: headH2,
        labels: cats.map((c) => (c.getAttribute('aria-label') || '').split('،')[0]),
      };
    });
    if (!interactions.settings.ok) failures.push('settings main list broken: ' + JSON.stringify(interactions.settings));
    await inter.screenshot({ path: path.join(OUT, 'interactions-settings.png') });

    interactions.settingsSub = await inter.evaluate(async () => {
      const view = document.querySelector('[data-view="settings"]');
      const acc = view ? view.querySelector('.set-cat[data-cat="appearance"]') : null;
      if (!acc) return { ok: false, reason: 'appearance row missing' };
      acc.click();
      await new Promise((r) => setTimeout(r, 450));
      const sub = document.querySelector('[data-view="settings"] .settings-sub');
      const crumb = document.querySelector('[data-view="settings"] .view-head .crumb');
      const back = document.getElementById('view-back');
      const backLabel = back ? (back.getAttribute('aria-label') || '') : '';
      const secs = sub ? sub.querySelectorAll('.settings-sec').length : 0;
      const chips = sub ? sub.querySelectorAll('.chip').length : 0;
      const nested = document.querySelectorAll('[data-view="settings"] .view-body .view-body').length;
      const inAppView = document.getElementById('app').classList.contains('app-view');
      const stateCat = state.settingsCat;
      if (back) back.click();
      await new Promise((r) => setTimeout(r, 450));
      const backToMain = !!document.querySelector('[data-view="settings"] .settings-main');
      const catAfterBack = state.settingsCat;
      // leaving settings entirely must not strand the user on a sub-page
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 350));
      const appViewGone = !document.getElementById('app').classList.contains('app-view');
      switchNav('settings');
      await new Promise((r) => setTimeout(r, 450));
      const relandedMain = !!document.querySelector('[data-view="settings"] .settings-main');
      const appViewAgain = document.getElementById('app').classList.contains('app-view');
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 250));
      return {
        ok: !!sub && !!crumb && backLabel.indexOf('تنظیمات') >= 0 && secs >= 4 && chips >= 10 &&
          nested === 0 && inAppView && stateCat === 'appearance' && backToMain && catAfterBack === 'main' &&
          appViewGone && relandedMain && appViewAgain,
        sub: !!sub, crumb: crumb ? crumb.textContent.trim() : null, backLabel: backLabel,
        secs: secs, chips: chips, nested: nested, inAppView: inAppView, stateCat: stateCat,
        backToMain: backToMain, catAfterBack: catAfterBack, appViewGone: appViewGone,
        relandedMain: relandedMain, appViewAgain: appViewAgain,
      };
    });
    if (!interactions.settingsSub.ok) failures.push('settings sub-page navigation broken: ' + JSON.stringify(interactions.settingsSub));

    // the logout row must be an ACTION on the list, never a dead-end sub-page
    interactions.logoutRow = await inter.evaluate(async () => {
      switchNav('settings');
      await new Promise((r) => setTimeout(r, 450));
      const row = document.querySelector('[data-view="settings"] .set-cat[data-action="logout"]');
      if (!row) return { ok: false, reason: 'logout row missing' };
      const listBefore = !!document.querySelector('[data-view="settings"] .settings-main');
      row.click();
      await new Promise((r) => setTimeout(r, 300));
      const confirmShown = !!document.querySelector('body > .u-pop');
      const cancel = confirmShown ? document.querySelector('body > .u-pop [data-k="0"]') : null;
      if (cancel) cancel.click();
      await new Promise((r) => setTimeout(r, 350));
      const stillLoggedIn = typeof state !== 'undefined' && !!state.token;
      const listStillThere = !!document.querySelector('[data-view="settings"] .settings-main');
      const cat = state.settingsCat;
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 250));
      return {
        ok: listBefore && confirmShown && stillLoggedIn && listStillThere && cat === 'main',
        listBefore: listBefore, confirmShown: confirmShown, stillLoggedIn: stillLoggedIn,
        listStillThere: listStillThere, cat: cat,
      };
    });
    if (!interactions.logoutRow.ok) failures.push('logout row dead-end: ' + JSON.stringify(interactions.logoutRow));

    interactions.accountCard = await inter.evaluate(async () => {
      switchNav('settings');
      await new Promise((r) => setTimeout(r, 450));
      const acct = document.querySelector('[data-view="settings"] .set-account');
      if (!acct) return { ok: false, reason: 'account card missing' };
      acct.click();
      await new Promise((r) => setTimeout(r, 750));
      const opened = !!document.querySelector('.profile-view');
      const back = opened ? document.querySelector('.profile-view [data-act="back"]') : null;
      if (back) back.click();
      await new Promise((r) => setTimeout(r, 550));
      const backToSettings = !!document.querySelector('[data-view="settings"] .settings-main');
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 250));
      return { ok: opened && backToSettings, opened: opened, backToSettings: backToSettings };
    });
    if (!interactions.accountCard.ok) failures.push('settings account card broken: ' + JSON.stringify(interactions.accountCard));

    interactions.profile = await inter.evaluate(async () => {
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 350));
      const chatOpenBefore = document.getElementById('conversation').classList.contains('chat-open');
      openProfile('ali');
      await new Promise((r) => setTimeout(r, 750));
      const pv = document.querySelector('.profile-view');
      if (!pv) return { ok: false, reason: 'profile not rendered' };
      const title = document.getElementById('profile-title');
      const actions = pv.querySelector('.profile-actions');
      const actionsInside = !!(actions && pv.contains(actions));
      const heroInside = !!pv.querySelector('.profile-hero');
      const top = !!pv.querySelector('.profile-top');
      const back = pv.querySelector('[data-act="back"]');
      const backNamed = !!(back && ((back.getAttribute('aria-label') || '').trim() || (back.textContent || '').trim()));
      const backIcon = !!(back && back.querySelector('svg'));
      const role = pv.getAttribute('role');
      const labelled = pv.getAttribute('aria-labelledby');
      const labelledOk = !!(labelled && document.getElementById(labelled));
      const focusOnView = document.activeElement === pv;
      const inline = pv.querySelectorAll('[onclick]').length;
      const chatOpenNow = document.getElementById('conversation').classList.contains('chat-open');
      const appViewNow = document.getElementById('app').classList.contains('app-view');
      return {
        ok: !!title && title.tagName === 'H2' && actionsInside && heroInside && top && backNamed && backIcon &&
          role === 'region' && labelledOk && focusOnView && inline === 0 && chatOpenNow && appViewNow,
        title: title ? title.textContent.trim() : null, titleTag: title ? title.tagName : null,
        actionsInside: actionsInside, heroInside: heroInside, top: top,
        backNamed: backNamed, backIcon: backIcon, role: role, labelled: labelled,
        labelledOk: labelledOk, focusOnView: focusOnView, inline: inline,
        chatOpenBefore: chatOpenBefore, chatOpenNow: chatOpenNow, appViewNow: appViewNow,
      };
    });
    if (!interactions.profile.ok) failures.push('profile screen broken: ' + JSON.stringify(interactions.profile));
    await inter.screenshot({ path: path.join(OUT, 'interactions-profile.png') });
    await inter.evaluate(async () => {
      const back = document.querySelector('.profile-view [data-act="back"]');
      if (back) back.click();
      await new Promise((r) => setTimeout(r, 500));
    });

    interactions.search = await inter.evaluate(async () => {
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 400));
      /* start from a known list state — earlier checks may have left a folder filter on */
      try { state.chatFilter = 'all'; buildChatList(); } catch (e) {}
      const inp = document.getElementById('cl-search-input');
      const x = document.getElementById('cl-search-x');
      if (!inp || !x) return { ok: false, reason: 'search controls missing' };
      const inputNamed = !!((inp.getAttribute('aria-label') || '').trim());
      const restHidden = x.hidden === true;
      const type = (v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };

      // 1) a query that matches an existing contact
      type('sara');
      await new Promise((r) => setTimeout(r, 1100));
      const heads = Array.prototype.slice.call(document.querySelectorAll('#cl-items .arch-head')).map((h) => (h.textContent || '').trim());
      const staticHeads = document.querySelectorAll('#cl-items .arch-head.static').length;
      const people = Array.prototype.slice.call(document.querySelectorAll('#cl-items .chat-item[data-uname]'));
      const xShown = x.hidden === false;
      const unnamedRows = people.filter((p) => {
        const s = p.querySelector('.ci-surface');
        return !(s && ((s.getAttribute('aria-label') || '').trim() || (s.textContent || '').trim()));
      }).length;

      // 2) clear control resets everything
      x.click();
      await new Promise((r) => setTimeout(r, 450));
      const cleared = inp.value === '' && x.hidden === true &&
        document.querySelectorAll('#cl-items .arch-head').length === 0;

      // 3) picking a person opens the DM
      type('sara');
      await new Promise((r) => setTimeout(r, 1100));
      const again = document.querySelectorAll('#cl-items .chat-item[data-uname]');
      let room = null;
      if (again.length) {
        const t = again[0].querySelector('.ci-surface');
        if (t) t.click();
        await new Promise((r) => setTimeout(r, 800));
        room = state.room;
      }

      // 4) a query that matches nothing shows an empty state, not a blank list
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 350));
      type('zzzqvxy9');
      await new Promise((r) => setTimeout(r, 1100));
      const empty = !!document.querySelector('#cl-items .empty-state');
      const emptyText = (document.querySelector('#cl-items .empty-state') || { textContent: '' }).textContent || '';
      x.click();
      await new Promise((r) => setTimeout(r, 400));
      const backToFull = document.querySelectorAll('#cl-items .chat-item').length > 0;

      const ok = inputNamed && restHidden && people.length >= 1 && staticHeads >= 1 &&
        heads.some((h) => h.indexOf('مخاطبین') >= 0) && xShown && unnamedRows === 0 &&
        cleared && room === 'dm:ali|sara' && empty && emptyText.indexOf('zzzqvxy9') >= 0 && backToFull;
      return {
        ok: ok, inputNamed: inputNamed, restHidden: restHidden, heads: heads, staticHeads: staticHeads,
        people: people.length, xShown: xShown, unnamedRows: unnamedRows, cleared: cleared,
        room: room, empty: empty, emptyHasQuery: emptyText.indexOf('zzzqvxy9') >= 0, backToFull: backToFull,
      };
    });
    if (!interactions.search.ok) failures.push('chat search broken: ' + JSON.stringify(interactions.search));
    await inter.evaluate(async () => {
      const inp = document.getElementById('cl-search-input');
      const x = document.getElementById('cl-search-x');
      if (x && !x.hidden) x.click();
      switchNav('chats');
      await new Promise((r) => setTimeout(r, 350));
    });
    await inter.screenshot({ path: path.join(OUT, 'interactions-search.png') });

    /* ── slice 5A: live theme / accent / radius / glass-fallback / font ──
       Proves the token system reacts live (not just at boot): AMOLED black,
       a custom accent hex, bubble-radius variants, the reduced-glass fallback,
       aurora visibility and that the self-hosted Vazirmatn actually loaded. */
    interactions.tokens = await inter.evaluate(async () => {
      const de = document.documentElement;
      const cs = () => getComputedStyle(de);
      const res = {};
      res.apiPresent = !!(window.VXDesign && window.VXDesign.setTheme);
      if (!res.apiPresent) return { ok: false, reason: 'VXDesign API missing' };

      try { switchNav('settings'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 500));

      // self-hosted font actually parsed + used
      try { await document.fonts.ready; } catch (e) {}
      try { res.fontLoaded = document.fonts.check('16px Vazirmatn'); } catch (e) { res.fontLoaded = null; }

      // AMOLED
      VXDesign.setTheme('amoled');
      VXDesign.setGlass(true);
      VXDesign.setAurora(true);
      await new Promise((r) => setTimeout(r, 350));
      res.amoledTheme = de.getAttribute('data-theme') === 'amoled';
      res.amoledSurface = cs().getPropertyValue('--surface').trim().replace(/^#/, '');

      // custom accent
      VXDesign.setAccent('custom', 'ff7a00');
      await new Promise((r) => setTimeout(r, 200));
      res.customAccentAttr = de.getAttribute('data-accent');
      res.customAccentRgb = cs().getPropertyValue('--primary-rgb').trim();
      res.customAccentPrimary = cs().getPropertyValue('--primary').trim();

      // bubble radius
      const radii = {};
      for (const r of ['sharp', 'compact', 'round', 'pill']) {
        VXDesign.setBubbleRadius(r);
        await new Promise((x) => setTimeout(x, 60));
        radii[r] = { attr: de.getAttribute('data-bubble-radius'), v: cs().getPropertyValue('--vx-r-bubble').trim() };
      }
      res.radii = radii;
      VXDesign.setBubbleRadius('round');

      // reduced-glass fallback must zero the blur
      VXDesign.setReduceGlass(true);
      await new Promise((r) => setTimeout(r, 120));
      res.reduceClass = de.classList.contains('reduce-glass');
      res.reduceAttr = de.getAttribute('data-reduce-glass');
      res.reduceBlur = cs().getPropertyValue('--vx-glass-blur').trim();
      VXDesign.setReduceGlass(false);
      await new Promise((r) => setTimeout(r, 120));
      res.reduceBlurRestored = cs().getPropertyValue('--vx-glass-blur').trim();

      // aurora visibility toggle
      VXDesign.setAurora(false);
      await new Promise((r) => setTimeout(r, 80));
      const blob = document.querySelector('#vx-aurora i');
      res.auroraOffName = de.getAttribute('data-aurora');
      res.auroraBlobDisplayOff = blob ? getComputedStyle(blob).display : null;
      VXDesign.setAurora(true);
      await new Promise((r) => setTimeout(r, 80));
      res.auroraOnName = de.getAttribute('data-aurora');

      res.ok = res.amoledTheme && res.amoledSurface === '000000' &&
        res.customAccentAttr === 'custom' && res.customAccentRgb === '255,122,0' &&
        radii.sharp.v === '4px' && radii.compact.v === '12px' && radii.round.v === '22px' && radii.pill.v === '26px' &&
        res.reduceClass === true && res.reduceAttr === 'on' && res.reduceBlur === '0px' &&
        res.auroraOffName === 'off' && res.auroraBlobDisplayOff === 'none' && res.auroraOnName === 'on' &&
        res.fontLoaded !== false;
      return res;
    });
    if (!interactions.tokens.ok) failures.push('5A token system: ' + JSON.stringify(interactions.tokens));

    // AMOLED + custom accent, glass on, aurora on → the 5A hero shot
    await inter.evaluate(async () => {
      VXDesign.setTheme('amoled'); VXDesign.setGlass(true); VXDesign.setAurora(true); VXDesign.setAccent('custom', 'ff7a00');
      VXDesign.setBubbleRadius('round'); VXDesign.setReduceGlass(false);
      try { switchNav('chats'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 600));
    });
    await inter.screenshot({ path: path.join(OUT, 'interactions-amoled.png') });

    // AMOLED light-on-black with the reduced-glass fallback (Android WebView path)
    await inter.evaluate(async () => {
      VXDesign.setTheme('amoled'); VXDesign.setGlass(true); VXDesign.setReduceGlass(true);
      try { switchNav('chats'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 500));
    });
    await inter.screenshot({ path: path.join(OUT, 'interactions-reduce-glass.png') });

    // restore defaults before closing so metrics.json reflects a clean state
    await inter.evaluate(async () => {
      VXDesign.setTheme('cyber'); VXDesign.setAccent('blue'); VXDesign.setGlass(true);
      VXDesign.setAurora(true); VXDesign.setBubbleRadius('round'); VXDesign.setReduceGlass(false);
      await new Promise((r) => setTimeout(r, 300));
    });

    /* ── slice 5B: command palette + resizable panes ── */
    interactions.palette = await inter.evaluate(async () => {
      const pal = document.getElementById('vx-palette');
      const inp = document.getElementById('vx-palette-input');
      const list = document.getElementById('vx-palette-list');
      if (!pal || !inp || !list) return { ok: false, reason: 'palette DOM missing' };
      const before = VXDesign.theme;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const opened = !pal.classList.contains('hidden');
      const itemsAll = list.querySelectorAll('.vx-palette-item').length;
      const groups = list.querySelectorAll('.vx-palette-group').length;
      const firstSelected = !!list.querySelector('.vx-palette-item[aria-selected="true"]');
      inp.value = 'amoled';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      const filtered = list.querySelectorAll('.vx-palette-item').length;
      const filteredLabel = (list.querySelector('.vx-palette-item .vx-palette-label') || {}).textContent || '';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const closedAfterRun = pal.classList.contains('hidden');
      const themeAfter = VXDesign.theme;
      try { VXDesign.setTheme(before); } catch (e) {}
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const selEl = list.querySelector('.vx-palette-item[aria-selected="true"]');
      const selIdx = selEl ? selEl.dataset.idx : null;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const closedAfterEsc = pal.classList.contains('hidden');
      const ok = opened && itemsAll > 0 && groups > 0 && firstSelected &&
        filtered >= 1 && filteredLabel.indexOf('AMOLED') >= 0 &&
        closedAfterRun && themeAfter === 'amoled' && selIdx === '1' && closedAfterEsc;
      return { ok, opened, itemsAll, groups, firstSelected, filtered, filteredLabel, closedAfterRun, themeAfter, selIdx, closedAfterEsc };
    });
    if (!interactions.palette.ok) failures.push('command palette: ' + JSON.stringify(interactions.palette));

    // screenshot with the palette open (filtered to show both groups + matching)
    await inter.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 350));
    });
    await inter.screenshot({ path: path.join(OUT, 'interactions-palette.png') });
    await inter.evaluate(() => { const p = document.getElementById('vx-palette'); if (p) p.classList.add('hidden'); });

    // resizable panes need a desktop viewport
    await inter.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await inter.evaluate(async () => { try { switchNav('chats'); } catch (e) {} await new Promise((r) => setTimeout(r, 400)); });
    interactions.resize = await inter.evaluate(async () => {
      const de = document.documentElement;
      const h = document.getElementById('vx-resize');
      if (!h) return { ok: false, reason: 'no resize handle' };
      const display = getComputedStyle(h).display;
      if (display === 'none') return { ok: false, reason: 'handle hidden on desktop' };
      const read = () => parseFloat(getComputedStyle(de).getPropertyValue('--vx-list-w')) || 320;
      const rtl = getComputedStyle(de).direction === 'rtl';
      const before = read();
      h.focus();
      h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((r) => setTimeout(r, 90));
      const afterRight = read();
      h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await new Promise((r) => setTimeout(r, 90));
      const afterLeft = read();
      const r = h.getBoundingClientRect();
      const startX = r.left + r.width / 2;
      h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, button: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 60, pointerId: 1 }));
      await new Promise((r2) => setTimeout(r2, 70));
      const afterDrag = read();
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX + 60, pointerId: 1 }));
      await new Promise((r2) => setTimeout(r2, 70));
      const persisted = localStorage.getItem('vx_list_w');
      const ariaNow = h.getAttribute('aria-valuenow');
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r2) => setTimeout(r2, 90));
      const afterReset = read();
      const ok = afterRight !== before && afterLeft === before &&
        afterDrag !== afterRight && persisted !== null &&
        afterReset === 320 && parseInt(ariaNow, 10) === Math.round(afterDrag);
      return { ok, rtl, before, afterRight, afterLeft, afterDrag, persisted, afterReset, ariaNow };
    });
    if (!interactions.resize.ok) failures.push('resize panes: ' + JSON.stringify(interactions.resize));
    await inter.screenshot({ path: path.join(OUT, 'interactions-resize.png') });
    await inter.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

    /* ── slice 5C: bubble radius wiring, message grouping, composer morph ── */
    interactions.conversation = await inter.evaluate(async () => {
      const res = {};
      try { switchNav('chats'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
      try { openRoom('dm:ali|sara'); } catch (e) { res.openErr = String(e); }
      await new Promise((r) => setTimeout(r, 500));

      // deterministic conversation: two back-to-back from one sender + one reply
      try {
        const rid = 'dm:ali|sara';
        state.room = rid;
        state.rooms[rid] = state.rooms[rid] || {};
        const t = Date.now();
        state.rooms[rid].messages = [
          { id: 'c1', from: 'sara', content: 'سلام', time: t - 60000, kind: 'text', roomId: rid },
          { id: 'c2', from: 'sara', content: 'خوبی؟', time: t - 55000, kind: 'text', roomId: rid },
          { id: 'c3', from: 'ali', content: 'مرسی', time: t - 50000, kind: 'text', roomId: rid },
        ];
        const box = document.getElementById('messages');
        box.innerHTML = ''; state.lastDay = null;
        renderMessagesBatch(state.rooms[rid].messages.slice(-100));
      } catch (e) { res.renderErr = String(e); }
      await new Promise((r) => setTimeout(r, 120));

      const nodes = Array.from(document.querySelectorAll('#messages .msg'));
      res.msgs = nodes.length;
      res.byId = {};
      for (const n of nodes) res.byId[n.dataset.id] = (n.className.match(/grp-\w+/) || [null])[0];
      res.allClassed = nodes.every((n) =>
        n.classList.contains('grp-first') || n.classList.contains('grp-mid') ||
        n.classList.contains('grp-last') || n.classList.contains('grp-only'));
      let adjSameFromGrouped = true;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i];
        if (a.dataset.from && a.dataset.from === b.dataset.from && a.nextElementSibling === b) {
          if (b.classList.contains('grp-first') || b.classList.contains('grp-only')) adjSameFromGrouped = false;
        }
      }
      res.adjSameFromGrouped = adjSameFromGrouped;
      // c1 starts the sara group, c2 ends it (gets the tail), c3 is a lone message
      res.groupingOk = res.byId.c1 === 'grp-first' && res.byId.c2 === 'grp-last' && res.byId.c3 === 'grp-only';

      // radius wiring: the bubble corner must follow --vx-r-bubble
      const bubble = document.querySelector('#messages .msg:not(:has(.media)) .bubble') ||
        document.querySelector('#messages .bubble');
      const radiusFor = (r) => {
        try { VXDesign.setBubbleRadius(r); } catch (e) {}
        return bubble ? getComputedStyle(bubble).borderTopLeftRadius : null;
      };
      res.radiusSharp = radiusFor('sharp');
      res.radiusRound = radiusFor('round');
      res.radiusWired = res.radiusSharp === '4px' && res.radiusRound === '22px';

      // composer morph: has-text follows the field, send button settles vs glows
      const box = document.getElementById('composer');
      const inp = document.getElementById('composer-input');
      const send = document.getElementById('composer-send');
      const morph = async (val) => {
        inp.value = val;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 280));
        return {
          hasText: box.classList.contains('has-text'),
          sendOpacity: parseFloat(getComputedStyle(send).opacity),
        };
      };
      const empty = await morph('');
      const typed = await morph('سلام');
      res.morphEmptyHasText = empty.hasText;
      res.morphTypedHasText = typed.hasText;
      res.morphTypedOpacity = typed.sendOpacity;
      res.morphOk = empty.hasText === false && typed.hasText === true && typed.sendOpacity > 0.9;
      inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));

      res.ok = res.msgs >= 3 && res.allClassed === true && res.groupingOk === true &&
        res.adjSameFromGrouped === true && res.radiusWired === true && res.morphOk === true;
      return res;
    });
    if (!interactions.conversation.ok) failures.push('5C conversation polish: ' + JSON.stringify(interactions.conversation));
    await inter.screenshot({ path: path.join(OUT, 'interactions-conversation.png') });

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