/* VORTEX Gram — phase 6 settings/theme verification harness.
 *
 *   node tools/settings-shots.js
 *
 * Boots the REAL server against a throwaway JSON DB, registers a user, then
 * for every settings category:
 *   • renders it at 390x844 (mobile) and 1440x900 (desktop)
 *   • screenshots it into docs/screenshots/settings/phase6/
 *   • collects DOM metrics (control counts, missing labels, contrast tokens)
 * and finally proves the theme system really swaps tokens.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = process.env.VX_ROOT || 'D:\\Projects\\Vortex\\messenger';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUPPETEER = path.join(ROOT, 'node_modules', 'puppeteer-core');
const PORT = Number(process.env.VX_SHOT_PORT || 4633);
const BASE = 'http://127.0.0.1:' + PORT;
const puppeteer = require(PUPPETEER);

const TMP = path.join(os.tmpdir(), 'vx-set-' + Date.now());
const OUT = path.join(ROOT, 'docs', 'screenshots', 'settings', 'phase6');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const CATS = ['appearance', 'chat', 'security', 'notifications', 'storage', 'calls', 'language', 'premium', 'account', 'background', 'folders', 'help'];
const VIEWPORTS = [{ w: 390, h: 844, tag: 'mobile' }, { w: 1440, h: 900, tag: 'desktop' }];

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + p);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) }, (res) => {
      let acc = '';
      res.on('data', (d) => { acc += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(acc); } catch (e) { /* ignore */ } resolve({ status: res.statusCode, body: j, raw: acc }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitServer() {
  for (let i = 0; i < 90; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status === 200) return true; } catch (e) { /* retry */ }
    await wait(300);
  }
  throw new Error('server did not boot');
}

(async () => {
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify({ users: [], groups: [], messages: {}, sessions: {} }));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { DATABASE_URL: '', NODE_ENV: 'development', DB_FILE: path.join(TMP, 'db.json'), PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => { });
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  const report = { at: new Date().toISOString(), categories: {}, theme: {} };
  try {
    await waitServer();
    const reg = await req('POST', '/api/register', { username: 'setter', password: 'Test12345!', displayName: 'تنظیم‌گر' });
    if (reg.status !== 200 || !reg.body || !reg.body.token) throw new Error('register failed: ' + reg.raw.slice(0, 200));
    const token = reg.body.token;

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument((tok) => {
        localStorage.setItem('ft_token', tok);
        localStorage.setItem('ft_me', JSON.stringify({ username: 'setter', displayName: 'تنظیم‌گر' }));
        localStorage.setItem('ft_me_ts', String(Date.now()));
      }, token);
      await page.goto(BASE + '/app', { waitUntil: 'networkidle2', timeout: 45000 });
      await wait(2500);

      for (const cat of CATS) {
        await page.evaluate((c) => { state.settingsCat = c; renderView('settings'); }, cat);
        await wait(600);
        const metrics = await page.evaluate(() => {
          const body = document.querySelector('.view-body');
          if (!body) return { error: 'no body' };
          const controls = body.querySelectorAll('input,select,button,textarea,[role=radio],[role=switch]');
          const unlabelled = [];
          controls.forEach((c) => {
            const id = c.id || '';
            const hasLabel = (id && body.querySelector('label[for="' + CSS.escape(id) + '"]'))
              || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')
              || (c.tagName === 'BUTTON' && c.textContent.trim())
              || c.closest('label');
            if (!hasLabel) unlabelled.push(c.tagName + (id ? '#' + id : ''));
          });
          const overflow = body.scrollWidth > body.clientWidth + 2;
          return {
            controls: controls.length,
            unlabelled: unlabelled.slice(0, 10),
            sections: body.querySelectorAll('.settings-sec').length,
            switches: body.querySelectorAll('.switch input').length,
            selects: body.querySelectorAll('select').length,
            sliders: body.querySelectorAll('input[type=range]').length,
            overflowX: overflow,
            scrollW: body.scrollWidth,
            clientW: body.clientWidth,
            text: body.innerText.slice(0, 120).replace(/\s+/g, ' '),
          };
        });
        const key = vp.tag + ':' + cat;
        report.categories[key] = { metrics, errors: errors.slice() };
        const file = path.join(OUT, cat + '-' + vp.w + 'x' + vp.h + '.png');
        await page.screenshot({ path: file, fullPage: false });
      }
      await page.close();
    }

    /* ── theme proof: switch themes and read the resolved tokens ── */
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((tok) => {
      localStorage.setItem('ft_token', tok);
      localStorage.setItem('ft_me', JSON.stringify({ username: 'setter', displayName: 'تنظیم‌گر' }));
      localStorage.setItem('ft_me_ts', String(Date.now()));
    }, token);
    await page.goto(BASE + '/app', { waitUntil: 'networkidle2', timeout: 45000 });
    await wait(2500);
    for (const th of ['day', 'night', 'dark']) {
      const t = await page.evaluate((x) => {
        window.VXDesign.setTheme(x);
        const cs = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        return {
          attr: document.documentElement.getAttribute('data-theme'),
          surface: cs.getPropertyValue('--surface').trim(),
          bg: cs.getPropertyValue('--bg').trim(),
          text: cs.getPropertyValue('--text').trim(),
          primary: cs.getPropertyValue('--primary').trim(),
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
        };
      }, th);
      report.theme[th] = t;
      await wait(300);
      await page.screenshot({ path: path.join(OUT, 'theme-' + th + '.png') });
    }
    /* accent + persistence */
    const acc = await page.evaluate(() => {
      window.VXDesign.setAccent('rose');
      return { accent: document.documentElement.getAttribute('data-accent'), primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), ls: localStorage.getItem('vx_accent') };
    });
    report.theme.accent = acc;
    await page.close();
    await browser.close();
  } catch (e) {
    report.error = String(e && e.stack || e);
  } finally {
    try { child.kill(); } catch (e) { /* ignore */ }
  }
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.error ? 1 : 0);
})();
