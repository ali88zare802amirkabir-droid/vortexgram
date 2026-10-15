/* ===================== VORTEX — design runtime (Phase 4 + 5A) =====================
 * Owns the whole "look" layer so no other file has to. Loaded BEFORE app.js so
 * every attribute is on <html> at first paint (no flash of the wrong theme).
 *
 *   1. POWER SAVING  — `data-power="full|saver"`; saver kills blur + long anims.
 *   2. GLASS         — `data-glass="on|off"`; off = opaque, no blur pass.
 *   3. THEME         — `data-theme` (cyber/midnight/…/amoled) + auto day/night.
 *   4. ACCENT        — `data-accent` preset or custom hex, with contrast-safe
 *                      `--on-primary` computed from luminance.
 *   5. AURORA        — animated mesh background (`data-aurora`), transform-only.
 *   6. BUBBLE RADIUS — `data-bubble-radius` drives `--vx-r-bubble`.
 *   7. REDUCE GLASS  — `.reduce-glass` fallback for slow Android WebViews.
 *   8. WALLPAPER     — `data-wallpaper="set|none"` so the shell knows whether it
 *                      may stay translucent.
 *
 * Everything is mirrored into localStorage (failures are non-fatal) and
 * published through window.VXDesign + a `vx-design` CustomEvent.
 */
'use strict';

(function () {
  var LS_GLASS = 'vx_glass';
  var LS_POWER = 'vx_power';
  var LS_AUTO = 'vx_power_auto';
  var LS_THEME = 'vx_theme';
  var LS_ACCENT = 'vx_accent';
  var LS_ACCENT_CUSTOM = 'vx_accent_custom';
  var LS_AURORA = 'vx_aurora';
  var LS_RADIUS = 'vx_bubble_radius';
  var LS_REDUCE = 'vx_reduce_glass';
  var LS_THEME_AUTO = 'vx_theme_auto';
  var LS_NIGHT_START = 'vx_night_start';
  var LS_NIGHT_END = 'vx_night_end';

  var root = document.documentElement;

  /* Named themes the picker offers (kept in sync with style.css + tokens.css). */
  var THEMES = ['cyber', 'midnight', 'midnight-rose', 'matrix', 'synthwave', 'sunset', 'forest', 'light', 'ios', 'amoled'];
  /* Named accents: the 8 from style.css plus 7 more from tokens.css. */
  var ACCENTS = ['blue', 'purple', 'cyan', 'green', 'pink', 'orange', 'red', 'ios', 'indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime'];
  var RADII = ['sharp', 'compact', 'round', 'pill'];

  var state = {
    glass: true,
    power: 'auto',
    lowEnd: false,
    reasons: [],
    reducedMotion: false,
    theme: 'cyber',
    accent: 'blue',
    accentCustom: '',
    aurora: true,
    bubbleRadius: 'round',
    reduceGlass: false,
    themeAuto: 'off',
    nightStart: 20,
    nightEnd: 7,
  };

  /* ---------- storage (never throws) ---------- */
  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode / quota */ }
  }

  /* ---------- colour helpers (custom accent) ---------- */
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  function luminance(r, g, b) {
    function ch(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  /* ---------- device profile ---------- */
  function detectLowEnd() {
    var reasons = [];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reasons.push('prefers-reduced-motion');
      state.reducedMotion = true;
    }
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) reasons.push('prefers-reduced-transparency');
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) reasons.push('deviceMemory=' + navigator.deviceMemory);
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) reasons.push('cores=' + navigator.hardwareConcurrency);
    try {
      var c = navigator.connection || {};
      if (c.saveData) reasons.push('saveData');
      if (c.effectiveType && /^(slow-2g|2g)$/.test(c.effectiveType)) reasons.push('net=' + c.effectiveType);
    } catch (e) { /* not supported */ }
    if (window.matchMedia('(prefers-contrast: more)').matches) reasons.push('prefers-contrast');

    state.reasons = reasons;
    var strong = state.reducedMotion || reasons.indexOf('saveData') >= 0 || reasons.indexOf('prefers-reduced-transparency') >= 0;
    state.lowEnd = strong || reasons.length >= 2;
    return state.lowEnd;
  }

  /* ---------- frame-time probe (optional, non-blocking) ---------- */
  function frameProbe(cb) {
    if (!window.requestAnimationFrame) return cb(false);
    var samples = [];
    var last = 0;
    var t0 = 0;
    function step(ts) {
      if (!t0) { t0 = ts; last = ts; requestAnimationFrame(step); return; }
      var dt = ts - last; last = ts;
      if (dt > 0 && dt < 400) samples.push(dt);
      if (samples.length < 20) { requestAnimationFrame(step); return; }
      var avg = samples.reduce(function (a, b) { return a + b; }, 0) / samples.length;
      cb(avg > 33);
    }
    requestAnimationFrame(step);
  }

  /* ---------- theme resolution (auto day/night) ---------- */
  function darkBase() { return state.theme === 'light' ? 'cyber' : state.theme; }
  function inNightWindow() {
    var h = new Date().getHours();
    var s = state.nightStart, e = state.nightEnd;
    return s <= e ? (h >= s && h < e) : (h >= s || h < e);
  }
  function effectiveTheme() {
    if (state.themeAuto === 'system') {
      return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : darkBase();
    }
    if (state.themeAuto === 'schedule') {
      return inNightWindow() ? darkBase() : 'light';
    }
    return state.theme;
  }

  /* ---------- applying ---------- */
  function effectivePower() {
    if (state.power === 'full' || state.power === 'saver') return state.power;
    return state.lowEnd ? 'saver' : 'full';
  }

  function applyAccent() {
    if (state.accent === 'custom') {
      var rgb = parseHex(state.accentCustom);
      if (rgb) {
        var lum = luminance(rgb.r, rgb.g, rgb.b);
        var onPrimary = lum > 0.45 ? '#0a0a0a' : '#ffffff';
        var css = rgb.r + ',' + rgb.g + ',' + rgb.b;
        root.style.setProperty('--primary', state.accentCustom);
        root.style.setProperty('--primary-rgb', css);
        root.style.setProperty('--on-primary', onPrimary);
        root.setAttribute('data-accent', 'custom');
        return;
      }
      /* Invalid custom value: fall back to the default preset. */
      state.accent = 'blue';
      write(LS_ACCENT, 'blue');
    }
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-rgb');
    root.style.removeProperty('--on-primary');
    root.setAttribute('data-accent', state.accent);
  }

  function apply() {
    var p = effectivePower();
    root.setAttribute('data-power', p);
    root.setAttribute('data-motion', state.reducedMotion ? 'reduced' : 'full');
    root.setAttribute('data-glass', state.glass ? 'on' : 'off');
    root.classList.toggle('vx-saver', p === 'saver');
    root.classList.toggle('reduce-glass', !!state.reduceGlass);
    root.setAttribute('data-reduce-glass', state.reduceGlass ? 'on' : 'off');

    var th = effectiveTheme();
    if (th === 'cyber' || !th) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', th);

    applyAccent();

    root.setAttribute('data-aurora', state.aurora ? 'on' : 'off');
    root.setAttribute('data-bubble-radius', RADII.indexOf(state.bubbleRadius) >= 0 ? state.bubbleRadius : 'round');

    syncThemeColor(th);
  }

  function syncThemeColor(th) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var map = { amoled: '#000000', light: '#f5f7fb' };
    meta.setAttribute('content', map[th] || '#031427');
  }

  /* ---------- aurora element ---------- */
  function ensureAurora() {
    if (!document.body) return;
    if (document.getElementById('vx-aurora')) return;
    var layer = document.createElement('div');
    layer.id = 'vx-aurora';
    layer.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i++) layer.appendChild(document.createElement('i'));
    document.body.insertBefore(layer, document.body.firstChild);
  }

  /* ---------- wallpaper awareness ---------- */
  function syncWallpaper() {
    var has = false;
    try { has = !!(localStorage.getItem('vx_bgimg') || localStorage.getItem('vx_bg')); } catch (e) {}
    root.setAttribute('data-wallpaper', has ? 'set' : 'none');
    return has;
  }

  var api = {
    get glass() { return state.glass; },
    get power() { return state.power; },
    get lowEnd() { return state.lowEnd; },
    get reasons() { return state.reasons.slice(); },
    get reducedMotion() { return state.reducedMotion; },
    get effectivePower() { return effectivePower(); },

    /* theme + accent */
    get theme() { return state.theme; },
    get effectiveTheme() { return effectiveTheme(); },
    get themeAuto() { return state.themeAuto; },
    get accent() { return state.accent; },
    get accentCustom() { return state.accentCustom; },
    get aurora() { return state.aurora; },
    get bubbleRadius() { return state.bubbleRadius; },
    get reduceGlass() { return state.reduceGlass; },
    themes: THEMES.slice(),
    accents: ACCENTS.slice(),
    radii: RADII.slice(),

    setGlass(on) {
      state.glass = !!on;
      write(LS_GLASS, state.glass ? '1' : '0');
      apply();
      api._emit('glass', state.glass);
      return state.glass;
    },
    toggleGlass() { return api.setGlass(!state.glass); },

    /** mode: 'auto' | 'full' | 'saver' */
    setPower(mode) {
      state.power = (mode === 'full' || mode === 'saver') ? mode : 'auto';
      write(LS_POWER, state.power);
      write(LS_AUTO, state.power === 'auto' ? '1' : '0');
      apply();
      api._emit('power', state.power);
      return state.power;
    },

    setTheme(name) {
      if (THEMES.indexOf(name) < 0) return state.theme;
      state.theme = name;
      write(LS_THEME, name);
      apply();
      api._emit('theme', name);
      return name;
    },

    /** preset name, or 'custom' together with a hex. */
    setAccent(name, hex) {
      if (name === 'custom') {
        var rgb = parseHex(hex);
        if (!rgb) return state.accent;
        state.accent = 'custom';
        state.accentCustom = '#' + hex.trim().replace(/^#/, '');
        write(LS_ACCENT_CUSTOM, state.accentCustom);
        write(LS_ACCENT, 'custom');
      } else if (ACCENTS.indexOf(name) >= 0) {
        state.accent = name;
        write(LS_ACCENT, name);
      } else {
        return state.accent;
      }
      apply();
      api._emit('accent', state.accent);
      return state.accent;
    },

    setAurora(on) {
      state.aurora = !!on;
      write(LS_AURORA, state.aurora ? '1' : '0');
      apply();
      api._emit('aurora', state.aurora);
      return state.aurora;
    },
    toggleAurora() { return api.setAurora(!state.aurora); },

    setBubbleRadius(name) {
      if (RADII.indexOf(name) < 0) return state.bubbleRadius;
      state.bubbleRadius = name;
      write(LS_RADIUS, name);
      apply();
      api._emit('bubbleRadius', name);
      return name;
    },

    setReduceGlass(on) {
      state.reduceGlass = !!on;
      write(LS_REDUCE, state.reduceGlass ? '1' : '0');
      apply();
      api._emit('reduceGlass', state.reduceGlass);
      return state.reduceGlass;
    },
    toggleReduceGlass() { return api.setReduceGlass(!state.reduceGlass); },

    /** mode: 'off' | 'system' | 'schedule' */
    setThemeAuto(mode) {
      state.themeAuto = (mode === 'system' || mode === 'schedule') ? mode : 'off';
      write(LS_THEME_AUTO, state.themeAuto);
      apply();
      api._emit('themeAuto', state.themeAuto);
      return state.themeAuto;
    },
    setNightWindow(start, end) {
      var s = Number(start), e = Number(end);
      if (Number.isFinite(s)) state.nightStart = Math.max(0, Math.min(23, s | 0));
      if (Number.isFinite(e)) state.nightEnd = Math.max(0, Math.min(23, e | 0));
      write(LS_NIGHT_START, String(state.nightStart));
      write(LS_NIGHT_END, String(state.nightEnd));
      apply();
      api._emit('night', { start: state.nightStart, end: state.nightEnd });
    },

    syncWallpaper: syncWallpaper,

    /** Called after the frame probe: downgrade once if the device is clearly slow. */
    _autoDowngradeIfSlow() {
      if (state.power !== 'auto') return;
      if (effectivePower() === 'saver') return;
      state.lowEnd = true;
      state.reasons.push('frame-time');
      apply();
      api._emit('power', state.power);
    },

    reevaluate() {
      detectLowEnd();
      apply();
      api._emit('power', state.power);
      return effectivePower();
    },

    _emit(name, value) {
      try { window.dispatchEvent(new CustomEvent('vx-design', { detail: { key: name, value: value } })); } catch (e) {}
    },

    /** Serialisable snapshot for the settings export / server sync. */
    snapshot() {
      return {
        glass: state.glass, power: state.power, theme: state.theme, accent: state.accent,
        accentCustom: state.accentCustom, aurora: state.aurora, bubbleRadius: state.bubbleRadius,
        reduceGlass: state.reduceGlass, themeAuto: state.themeAuto,
      };
    },
    applySnapshot(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.glass === 'boolean') state.glass = s.glass;
      if (s.power) state.power = (s.power === 'full' || s.power === 'saver') ? s.power : 'auto';
      if (typeof s.theme === 'string' && THEMES.indexOf(s.theme) >= 0) state.theme = s.theme;
      if (typeof s.accent === 'string') {
        if (s.accent === 'custom' && parseHex(s.accentCustom)) { state.accent = 'custom'; state.accentCustom = s.accentCustom; }
        else if (ACCENTS.indexOf(s.accent) >= 0) state.accent = s.accent;
      }
      if (typeof s.aurora === 'boolean') state.aurora = s.aurora;
      if (typeof s.bubbleRadius === 'string' && RADII.indexOf(s.bubbleRadius) >= 0) state.bubbleRadius = s.bubbleRadius;
      if (typeof s.reduceGlass === 'boolean') state.reduceGlass = s.reduceGlass;
      if (typeof s.themeAuto === 'string') state.themeAuto = s.themeAuto;
      write(LS_GLASS, state.glass ? '1' : '0');
      write(LS_POWER, state.power);
      write(LS_THEME, state.theme);
      write(LS_ACCENT, state.accent);
      if (state.accentCustom) write(LS_ACCENT_CUSTOM, state.accentCustom);
      write(LS_AURORA, state.aurora ? '1' : '0');
      write(LS_RADIUS, state.bubbleRadius);
      write(LS_REDUCE, state.reduceGlass ? '1' : '0');
      write(LS_THEME_AUTO, state.themeAuto);
      apply();
    },
    reset() {
      state.glass = true; state.power = 'auto'; state.theme = 'cyber'; state.accent = 'blue';
      state.accentCustom = ''; state.aurora = true; state.bubbleRadius = 'round';
      state.reduceGlass = false; state.themeAuto = 'off';
      write(LS_GLASS, '1'); write(LS_POWER, 'auto'); write(LS_THEME, 'cyber');
      write(LS_ACCENT, 'blue'); write(LS_ACCENT_CUSTOM, ''); write(LS_AURORA, '1');
      write(LS_RADIUS, 'round'); write(LS_REDUCE, '0'); write(LS_THEME_AUTO, 'off');
      api.reevaluate();
    },
  };

  /* ---------- load persisted state ---------- */
  detectLowEnd();
  state.glass = read(LS_GLASS, '1') === '1';
  state.power = (function () { var v = read(LS_POWER, 'auto'); return (v === 'full' || v === 'saver') ? v : 'auto'; })();
  var th0 = read(LS_THEME, 'cyber');
  state.theme = THEMES.indexOf(th0) >= 0 ? th0 : 'cyber';
  var ac0 = read(LS_ACCENT, 'blue');
  state.accent = (ac0 === 'custom' || ACCENTS.indexOf(ac0) >= 0) ? ac0 : 'blue';
  state.accentCustom = read(LS_ACCENT_CUSTOM, '');
  if (state.accent === 'custom' && !parseHex(state.accentCustom)) state.accent = 'blue';
  state.aurora = read(LS_AURORA, '1') === '1';
  var r0 = read(LS_RADIUS, 'round');
  state.bubbleRadius = RADII.indexOf(r0) >= 0 ? r0 : 'round';
  state.reduceGlass = read(LS_REDUCE, '0') === '1';
  var auto0 = read(LS_THEME_AUTO, 'off');
  state.themeAuto = (auto0 === 'system' || auto0 === 'schedule') ? auto0 : 'off';
  state.nightStart = parseInt(read(LS_NIGHT_START, '20'), 10) || 20;
  state.nightEnd = parseInt(read(LS_NIGHT_END, '7'), 10) || 7;

  apply();

  /* Aurura + wallpaper need the body, so do it once the DOM is ready. */
  function boot2() { ensureAurora(); syncWallpaper(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot2, { once: true });
  else boot2();

  /* ---------- live OS / time changes ---------- */
  function onMedia(q, fn) { try { matchMedia(q).addEventListener('change', fn); } catch (e) {} }
  onMedia('(prefers-reduced-motion: reduce)', function () { api.reevaluate(); });
  onMedia('(prefers-reduced-transparency: reduce)', function () { api.reevaluate(); });
  onMedia('(prefers-contrast: more)', function () { api.reevaluate(); });
  onMedia('(prefers-color-scheme: light)', function () { if (state.themeAuto === 'system') apply(); });

  /* Schedule mode re-checks on a slow interval — cheap and always current. */
  setInterval(function () { if (state.themeAuto === 'schedule') apply(); }, 60000);

  /* Frame probe once, after first paint, so it cannot delay boot. */
  function probe() { setTimeout(function () { frameProbe(function (slow) { if (slow) api._autoDowngradeIfSlow(); }); }, 1200); }
  if (document.readyState === 'complete') probe();
  else window.addEventListener('load', probe);

  window.VXDesign = api;
})();
