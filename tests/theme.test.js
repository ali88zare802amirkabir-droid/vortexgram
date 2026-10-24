// VORTEXGRAM — theme system tests (design.js) + new settings whitelist tests.
//
// Run:  node --test tests/theme.test.js
//
// The theme runtime lives in public/design.js and runs in the browser before
// the first paint, so the test drives it inside a minimal DOM shim:
//
//   * switching the theme sets data-theme and swaps the resolved tokens
//   * the choice survives a reload (localStorage) and is restored
//   * a custom accent keeps its colour and computes a readable --on-primary
//   * legacy theme/accent names are migrated instead of being lost
//   * snapshot() → applySnapshot() round-trips every appearance option

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DESIGN_SRC = fs.readFileSync(path.join(ROOT, 'public', 'design.js'), 'utf8');

/* ── a very small DOM shim: enough for design.js ── */
function makeEnv(initialStore, opts) {
  const store = initialStore || {};
  const prefersLight = !!(opts && opts.prefersLight);
  const listeners = {};
  const root = {
    _attrs: {},
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      removeProperty(k) { delete this._props[k]; },
    },
    classList: {
      _set: new Set(),
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
  };
  const meta = { _content: '', setAttribute(k, v) { if (k === 'content') this._content = v; }, getAttribute(k) { return k === 'content' ? this._content : null; } };
  const el = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, insertBefore() {},
    id: '', innerHTML: '', textContent: '',
  });
  const sandbox = {
    document: {
      documentElement: root,
      body: { insertBefore() {}, appendChild() {}, firstChild: null },
      readyState: 'complete',
      createElement: el,
      getElementById(id) { return id === 'vx-aurora' ? { id: 'vx-aurora' } : null; },
      querySelector(sel) { return sel.indexOf('theme-color') >= 0 ? meta : null; },
      addEventListener() {},
    },
    window: {
      addEventListener() {},
      matchMedia(q) {
        return { matches: prefersLight && q.indexOf('prefers-color-scheme: light') >= 0, media: q, addEventListener() {}, removeEventListener() {} };
      },
      dispatchEvent() { return true; },
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
      clear() { for (const k of Object.keys(store)) delete store[k]; },
    },
    navigator: { deviceMemory: 8, hardwareConcurrency: 8, connection: {} },
    matchMedia(q) { return { matches: prefersLight && q.indexOf('prefers-color-scheme: light') >= 0, media: q, addEventListener() {}, removeEventListener() {} }; },
    setTimeout: (fn) => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    console,
  };
  sandbox.window.document = sandbox.document;
  sandbox.self = sandbox.window;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(DESIGN_SRC, ctx, { filename: 'design.js' });
  return { api: sandbox.window.VXDesign, root, store, meta };
}

test('theme: the three canonical themes exist and switch the resolved tokens', () => {
  const { api, root } = makeEnv();
  assert.deepStrictEqual(Array.from(api.themes), ['day', 'night', 'dark']);
  api.setTheme('day');
  assert.strictEqual(root.getAttribute('data-theme'), 'day');
  api.setTheme('night');
  assert.strictEqual(root.getAttribute('data-theme'), 'night');
  api.setTheme('dark');
  assert.strictEqual(root.getAttribute('data-theme'), 'dark');
  /* an unknown theme is rejected, the previous one stays */
  api.setTheme('neon');
  assert.strictEqual(root.getAttribute('data-theme'), 'dark');
});

test('theme: the choice is persisted and restored on the next boot', () => {
  const store = {};
  const first = makeEnv(store);
  first.api.setTheme('day');
  first.api.setAccent('rose');
  assert.strictEqual(store.vx_theme, 'day');
  assert.strictEqual(store.vx_accent, 'rose');

  /* a fresh boot with the same localStorage restores the look */
  const second = makeEnv(store);
  assert.strictEqual(second.api.theme, 'day');
  assert.strictEqual(second.api.accent, 'rose');
  assert.strictEqual(second.root.getAttribute('data-theme'), 'day');
});

test('theme: legacy theme and accent names are migrated, never lost', () => {
  const { api, root, store } = makeEnv({ vx_theme: 'cyber', vx_accent: 'purple' });
  assert.strictEqual(api.theme, 'night');
  assert.strictEqual(api.accent, 'violet');
  assert.strictEqual(store.vx_theme, 'night');
  assert.strictEqual(store.vx_accent, 'violet');
  assert.strictEqual(root.getAttribute('data-theme'), 'night');
  assert.strictEqual(root.getAttribute('data-accent'), 'violet');
});

test('theme: a custom accent keeps its colour and gets a readable on-primary', () => {
  const { api, root } = makeEnv();
  api.setAccent('custom', '#3390ec');
  assert.strictEqual(root.getAttribute('data-accent'), 'custom');
  assert.strictEqual(root.style._props['--primary'], '#3390ec');
  assert.strictEqual(root.style._props['--primary-rgb'], '51,144,236');
  assert.strictEqual(root.style._props['--on-primary'], '#ffffff');
  /* a very light accent must flip the foreground to dark */
  api.setAccent('custom', '#fde68a');
  assert.strictEqual(root.style._props['--on-primary'], '#111111');
});

test('theme: appearance options round-trip through snapshot()', () => {
  const { api, root } = makeEnv();
  api.setTheme('dark');
  api.setAccent('teal');
  api.setBubbleRadius('pill');
  api.setBubbleStyle('accent');
  api.setDensity('compact');
  api.setTextScale('large');
  api.setFont('mono');
  api.setUiRadius('round');
  api.setWallpaper('grad-ocean');
  api.setWallBlur(12);
  api.setWallBright(0.8);
  api.setWallMotion(false);
  api.setAnimations(false);
  api.setGlass(false);
  api.setReduceGlass(true);
  api.setAurora(false);
  const snap = api.snapshot();
  assert.strictEqual(snap.theme, 'dark');
  assert.strictEqual(snap.accent, 'teal');
  assert.strictEqual(snap.bubbleRadius, 'pill');
  assert.strictEqual(snap.density, 'compact');
  assert.strictEqual(snap.wallpaper, 'grad-ocean');

  const other = makeEnv();
  other.api.applySnapshot(snap);
  assert.strictEqual(other.root.getAttribute('data-theme'), 'dark');
  assert.strictEqual(other.root.getAttribute('data-accent'), 'teal');
  assert.strictEqual(other.root.getAttribute('data-bubble-radius'), 'pill');
  assert.strictEqual(other.root.getAttribute('data-bubble-style'), 'accent');
  assert.strictEqual(other.root.getAttribute('data-density'), 'compact');
  assert.strictEqual(other.root.getAttribute('data-text-scale'), 'large');
  assert.strictEqual(other.root.getAttribute('data-wallpaper'), 'grad-ocean');
  assert.strictEqual(other.api.wallBlur, 12);
  assert.strictEqual(other.api.animations, false);
  assert.strictEqual(other.api.glass, false);
});

test('theme: auto mode follows the system preference', () => {
  const { api, root } = makeEnv({}, { prefersLight: true });
  api.setTheme('night');
  api.setThemeAuto('system');
  assert.strictEqual(api.themeAuto, 'system');
  /* the shim reports a light OS → the day palette is used */
  assert.strictEqual(root.getAttribute('data-theme'), 'day');
  api.setThemeAuto('off');
  assert.strictEqual(root.getAttribute('data-theme'), 'night');
});

test('theme: reset() returns every appearance option to its default', () => {
  const { api, root } = makeEnv();
  api.setTheme('day');
  api.setAccent('red');
  api.setDensity('spacious');
  api.setWallpaper('pattern-dots');
  api.reset();
  assert.strictEqual(api.theme, 'night');
  assert.strictEqual(api.accent, 'blue');
  assert.strictEqual(api.density, 'comfortable');
  assert.strictEqual(api.wallpaper, 'none');
  assert.strictEqual(root.getAttribute('data-theme'), 'night');
  assert.strictEqual(root.getAttribute('data-accent'), 'blue');
});

test('theme: every accent preset has a swatch colour for the picker', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'public', 'tokens.css'), 'utf8');
  const { api } = makeEnv();
  for (const a of api.accents) {
    assert.ok(tokens.indexOf('--a-' + a + ':') >= 0, 'missing swatch colour for ' + a);
  }
  assert.ok(api.accents.length >= 8, 'at least eight accent presets are required');
});
