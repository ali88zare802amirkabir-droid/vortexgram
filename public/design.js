/* ===================== VORTEX — design runtime (Phase 4 + 5A) =====================
 * Owns the whole "look" layer so no other file has to. Loaded BEFORE app.js so
 * every attribute is on <html> at first paint (no flash of the wrong theme).
 *
 *   1. POWER SAVING  — `data-power="full|saver"`; saver kills blur + long anims.
 *   2. GLASS         — `data-glass="on|off"`; off = opaque, no blur pass.
 *   3. THEME         - `data-theme` (day/night/dark-AMOLED) + auto day/night.
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
  var LS_DENSITY = 'vx_density';
  var LS_TEXT = 'vx_text_scale';
  var LS_FONT = 'vx_font_face';
  var LS_UI_RADIUS = 'vx_ui_radius';
  var LS_BUBBLE_STYLE = 'vx_bubble_style';
  var LS_WALLPAPER = 'vx_wallpaper';
  var LS_WALL_BLUR = 'vx_wall_blur';
  var LS_WALL_BRIGHT = 'vx_wall_bright';
  var LS_WALL_MOTION = 'vx_wall_motion';
  var LS_ANIM = 'vx_animations';

  var root = document.documentElement;

  /* Named themes the picker offers (kept in sync with style.css + tokens.css). */
  var THEMES = ['day', 'night', 'dark'];
  /* Stage-2 theme system: three canonical palettes (day / night / dark-AMOLED).
     Old mood themes are folded into the nearest canonical palette on read so
     existing users keep a coherent look and localStorage is rewritten. */
  var THEME_MIGRATE = {
    cyber: 'night', midnight: 'dark', 'midnight-rose': 'dark', matrix: 'dark',
    synthwave: 'night', sunset: 'night', forest: 'night', light: 'day', ios: 'day', amoled: 'dark'
  };
  function migrateTheme(name) { return THEME_MIGRATE[name] || name; }
  /* Named accents: the 8 from style.css plus 7 more from tokens.css. */
  var ACCENTS = ['blue', 'cyan', 'green', 'pink', 'orange', 'red', 'ios', 'indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime'];
  var RADII = ['sharp', 'compact', 'round', 'pill'];
  /* Stage-2 appearance presets (selectors live in style.css). */
  var DENSITIES = ['compact', 'comfortable', 'spacious'];
  var TEXT_SCALES = ['small', 'normal', 'large', 'xlarge'];
  var FONTS = ['default', 'mono', 'round', 'vazir'];
  var UI_RADII = ['sharp', 'round', 'soft'];
  var BUBBLE_STYLES = ['classic', 'accent', 'glass'];
  var WALLPAPERS = ['none', 'grad-ocean', 'grad-sunset', 'grad-aurora', 'grad-forest', 'pattern-dots', 'pattern-grid', 'pattern-bubbles'];
  var ACCENT_MIGRATE = { purple: 'violet' };
  function migrateAccent(name) { return ACCENT_MIGRATE[name] || name; }

  var state = {
    glass: true,
    power: 'auto',
    lowEnd: false,
    reasons: [],
    reducedMotion: false,
    theme: 'night',
    accent: 'blue',
    accentCustom: '',
    aurora: true,
    bubbleRadius: 'round',
    reduceGlass: false,
    themeAuto: 'off',
    nightStart: 20,
    nightEnd: 7,
    density: 'comfortable',
    textScale: 'normal',
    font: 'default',
    uiRadius: 'round',
    bubbleStyle: 'classic',
    wallpaper: 'none',
    wallBlur: 0,
    wallBright: 1,
    wallMotion: true,
    animations: true,
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
  function darkBase() { return state.theme === 'day' ? 'night' : state.theme; }
  function inNightWindow() {
    var h = new Date().getHours();
    var s = state.nightStart, e = state.nightEnd;
    return s <= e ? (h >= s && h < e) : (h >= s || h < e);
  }
  function effectiveTheme() {
    if (state.themeAuto === 'system') {
      return matchMedia('(prefers-color-scheme: light)').matches ? 'day' : darkBase();
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
        var onPrimary = lum > 0.45 ? '#111111' : '#ffffff';
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
    root.setAttribute('data-theme', th === 'cyber' ? 'night' : (th || 'night'));

    applyAccent();

    root.setAttribute('data-aurora', state.aurora ? 'on' : 'off');
    root.setAttribute('data-bubble-radius', RADII.indexOf(state.bubbleRadius) >= 0 ? state.bubbleRadius : 'round');
    root.setAttribute('data-density', state.density);
    root.setAttribute('data-text-scale', state.textScale);
    root.setAttribute('data-font', state.font);
    root.setAttribute('data-ui-radius', state.uiRadius);
    root.setAttribute('data-bubble-style', state.bubbleStyle);
    root.setAttribute('data-animations', state.animations ? 'on' : 'off');
    root.setAttribute('data-wall-motion', state.wallMotion ? 'on' : 'off');
    root.setAttribute('data-wallpaper', wallpaperName());
    try {
      root.style.setProperty('--wall-blur', state.wallBlur + 'px');
      root.style.setProperty('--wall-bright', String(state.wallBright));
    } catch (e) {}

    syncThemeColor(th);
  }

  function syncThemeColor(th) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var map = { day: '#FFFFFF', dark: '#000000', amoled: '#000000', light: '#FFFFFF' };
    meta.setAttribute('content', map[th] || '#17212B');
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
  function legacyWallpaper() {
    try { return !!(localStorage.getItem('vx_bgimg') || localStorage.getItem('vx_bg')); } catch (e) { return false; }
  }
  function wallpaperName() {
    if (state.wallpaper !== 'none') return state.wallpaper;
    return legacyWallpaper() ? 'custom' : 'none';
  }
  function syncWallpaper() {
    var name = wallpaperName();
    root.setAttribute('data-wallpaper', name);
    return name !== 'none';
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
    get density() { return state.density; },
    get textScale() { return state.textScale; },
    get font() { return state.font; },
    get uiRadius() { return state.uiRadius; },
    get bubbleStyle() { return state.bubbleStyle; },
    get wallpaper() { return state.wallpaper; },
    get wallBlur() { return state.wallBlur; },
    get wallBright() { return state.wallBright; },
    get wallMotion() { return state.wallMotion; },
    get animations() { return state.animations; },
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
      name = migrateTheme(name);
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
      } else if (ACCENTS.indexOf(migrateAccent(name)) >= 0) {
        state.accent = migrateAccent(name);
        write(LS_ACCENT, state.accent);
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

    setDensity(name) {
      if (DENSITIES.indexOf(name) < 0) return state.density;
      state.density = name;
      write(LS_DENSITY, name);
      apply();
      api._emit('density', name);
      return name;
    },
    setTextScale(name) {
      if (TEXT_SCALES.indexOf(name) < 0) return state.textScale;
      state.textScale = name;
      write(LS_TEXT, name);
      apply();
      api._emit('textScale', name);
      return name;
    },
    setFont(name) {
      if (FONTS.indexOf(name) < 0) return state.font;
      state.font = name;
      write(LS_FONT, name);
      apply();
      api._emit('font', name);
      return name;
    },
    setUiRadius(name) {
      if (UI_RADII.indexOf(name) < 0) return state.uiRadius;
      state.uiRadius = name;
      write(LS_UI_RADIUS, name);
      apply();
      api._emit('uiRadius', name);
      return name;
    },
    setBubbleStyle(name) {
      if (BUBBLE_STYLES.indexOf(name) < 0) return state.bubbleStyle;
      state.bubbleStyle = name;
      write(LS_BUBBLE_STYLE, name);
      apply();
      api._emit('bubbleStyle', name);
      return name;
    },
    setWallpaper(name) {
      if (WALLPAPERS.indexOf(name) < 0) return state.wallpaper;
      state.wallpaper = name;
      write(LS_WALLPAPER, name);
      apply();
      api._emit('wallpaper', name);
      return name;
    },
    setWallBlur(px) {
      var n = Number(px);
      if (!Number.isFinite(n)) return state.wallBlur;
      state.wallBlur = Math.max(0, Math.min(40, Math.round(n)));
      write(LS_WALL_BLUR, String(state.wallBlur));
      apply();
      api._emit('wallBlur', state.wallBlur);
      return state.wallBlur;
    },
    setWallBright(v) {
      var n = Number(v);
      if (!Number.isFinite(n)) return state.wallBright;
      state.wallBright = Math.max(0.2, Math.min(1.5, Math.round(n * 100) / 100));
      write(LS_WALL_BRIGHT, String(state.wallBright));
      apply();
      api._emit('wallBright', state.wallBright);
      return state.wallBright;
    },
    setWallMotion(on) {
      state.wallMotion = !!on;
      write(LS_WALL_MOTION, state.wallMotion ? '1' : '0');
      apply();
      api._emit('wallMotion', state.wallMotion);
      return state.wallMotion;
    },
    setAnimations(on) {
      state.animations = !!on;
      write(LS_ANIM, state.animations ? '1' : '0');
      apply();
      api._emit('animations', state.animations);
      return state.animations;
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
        density: state.density, textScale: state.textScale, font: state.font, uiRadius: state.uiRadius,
        bubbleStyle: state.bubbleStyle, wallpaper: state.wallpaper, wallBlur: state.wallBlur,
        wallBright: state.wallBright, wallMotion: state.wallMotion, animations: state.animations,
      };
    },
    applySnapshot(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.glass === 'boolean') state.glass = s.glass;
      if (s.power) state.power = (s.power === 'full' || s.power === 'saver') ? s.power : 'auto';
      if (typeof s.theme === 'string') { var mt = migrateTheme(s.theme); if (THEMES.indexOf(mt) >= 0) state.theme = mt; }
      if (typeof s.accent === 'string') {
        if (s.accent === 'custom' && parseHex(s.accentCustom)) { state.accent = 'custom'; state.accentCustom = s.accentCustom; }
        else if (ACCENTS.indexOf(migrateAccent(s.accent)) >= 0) state.accent = migrateAccent(s.accent);
      }
      if (typeof s.aurora === 'boolean') state.aurora = s.aurora;
      if (typeof s.bubbleRadius === 'string' && RADII.indexOf(s.bubbleRadius) >= 0) state.bubbleRadius = s.bubbleRadius;
      if (typeof s.reduceGlass === 'boolean') state.reduceGlass = s.reduceGlass;
      if (typeof s.themeAuto === 'string') state.themeAuto = s.themeAuto;
      if (typeof s.density === 'string' && DENSITIES.indexOf(s.density) >= 0) state.density = s.density;
      if (typeof s.textScale === 'string' && TEXT_SCALES.indexOf(s.textScale) >= 0) state.textScale = s.textScale;
      if (typeof s.font === 'string' && FONTS.indexOf(s.font) >= 0) state.font = s.font;
      if (typeof s.uiRadius === 'string' && UI_RADII.indexOf(s.uiRadius) >= 0) state.uiRadius = s.uiRadius;
      if (typeof s.bubbleStyle === 'string' && BUBBLE_STYLES.indexOf(s.bubbleStyle) >= 0) state.bubbleStyle = s.bubbleStyle;
      if (typeof s.wallpaper === 'string' && WALLPAPERS.indexOf(s.wallpaper) >= 0) state.wallpaper = s.wallpaper;
      if (Number.isFinite(Number(s.wallBlur))) state.wallBlur = Math.max(0, Math.min(40, Math.round(Number(s.wallBlur))));
      if (Number.isFinite(Number(s.wallBright))) state.wallBright = Math.max(0.2, Math.min(1.5, Math.round(Number(s.wallBright) * 100) / 100));
      if (typeof s.wallMotion === 'boolean') state.wallMotion = s.wallMotion;
      if (typeof s.animations === 'boolean') state.animations = s.animations;
      write(LS_GLASS, state.glass ? '1' : '0');
      write(LS_POWER, state.power);
      write(LS_THEME, state.theme);
      write(LS_ACCENT, state.accent);
      if (state.accentCustom) write(LS_ACCENT_CUSTOM, state.accentCustom);
      write(LS_AURORA, state.aurora ? '1' : '0');
      write(LS_RADIUS, state.bubbleRadius);
      write(LS_REDUCE, state.reduceGlass ? '1' : '0');
      write(LS_THEME_AUTO, state.themeAuto);
      write(LS_DENSITY, state.density);
      write(LS_TEXT, state.textScale);
      write(LS_FONT, state.font);
      write(LS_UI_RADIUS, state.uiRadius);
      write(LS_BUBBLE_STYLE, state.bubbleStyle);
      write(LS_WALLPAPER, state.wallpaper);
      write(LS_WALL_BLUR, String(state.wallBlur));
      write(LS_WALL_BRIGHT, String(state.wallBright));
      write(LS_WALL_MOTION, state.wallMotion ? '1' : '0');
      write(LS_ANIM, state.animations ? '1' : '0');
      apply();
    },
    reset() {
      state.glass = true; state.power = 'auto'; state.theme = 'night'; state.accent = 'blue';
      state.accentCustom = ''; state.aurora = true; state.bubbleRadius = 'round';
      state.reduceGlass = false; state.themeAuto = 'off';
      state.density = 'comfortable'; state.textScale = 'normal'; state.font = 'default';
      state.uiRadius = 'round'; state.bubbleStyle = 'classic'; state.wallpaper = 'none';
      state.wallBlur = 0; state.wallBright = 1; state.wallMotion = true; state.animations = true;
      write(LS_GLASS, '1'); write(LS_POWER, 'auto'); write(LS_THEME, 'night');
      write(LS_ACCENT, 'blue'); write(LS_ACCENT_CUSTOM, ''); write(LS_AURORA, '1');
      write(LS_RADIUS, 'round'); write(LS_REDUCE, '0'); write(LS_THEME_AUTO, 'off');
      write(LS_DENSITY, 'comfortable'); write(LS_TEXT, 'normal'); write(LS_FONT, 'default');
      write(LS_UI_RADIUS, 'round'); write(LS_BUBBLE_STYLE, 'classic'); write(LS_WALLPAPER, 'none');
      write(LS_WALL_BLUR, '0'); write(LS_WALL_BRIGHT, '1'); write(LS_WALL_MOTION, '1'); write(LS_ANIM, '1');
      api.reevaluate();
    },
  };

  /* ---------- load persisted state ---------- */
  detectLowEnd();
  state.glass = read(LS_GLASS, '1') === '1';
  state.power = (function () { var v = read(LS_POWER, 'auto'); return (v === 'full' || v === 'saver') ? v : 'auto'; })();
  var th0 = migrateTheme(read(LS_THEME, 'night'));
  state.theme = THEMES.indexOf(th0) >= 0 ? th0 : 'night';
  var ac0 = migrateAccent(read(LS_ACCENT, 'blue'));
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
  var d0 = read(LS_DENSITY, 'comfortable');
  state.density = DENSITIES.indexOf(d0) >= 0 ? d0 : 'comfortable';
  var ts0 = read(LS_TEXT, 'normal');
  state.textScale = TEXT_SCALES.indexOf(ts0) >= 0 ? ts0 : 'normal';
  var fnt0 = read(LS_FONT, 'default');
  state.font = FONTS.indexOf(fnt0) >= 0 ? fnt0 : 'default';
  var ur0 = read(LS_UI_RADIUS, 'round');
  state.uiRadius = UI_RADII.indexOf(ur0) >= 0 ? ur0 : 'round';
  var bs0 = read(LS_BUBBLE_STYLE, 'classic');
  state.bubbleStyle = BUBBLE_STYLES.indexOf(bs0) >= 0 ? bs0 : 'classic';
  var wp0 = read(LS_WALLPAPER, 'none');
  state.wallpaper = WALLPAPERS.indexOf(wp0) >= 0 ? wp0 : 'none';
  var wb0 = parseFloat(read(LS_WALL_BLUR, '0'));
  state.wallBlur = Number.isFinite(wb0) ? Math.max(0, Math.min(40, Math.round(wb0))) : 0;
  var br0 = parseFloat(read(LS_WALL_BRIGHT, '1'));
  state.wallBright = Number.isFinite(br0) ? Math.max(0.2, Math.min(1.5, br0)) : 1;
  state.wallMotion = read(LS_WALL_MOTION, '1') === '1';
  state.animations = read(LS_ANIM, '1') === '1';

  apply();
  write(LS_THEME, state.theme);
  write(LS_ACCENT, state.accent);
  write(LS_DENSITY, state.density);
  write(LS_TEXT, state.textScale);
  write(LS_FONT, state.font);
  write(LS_UI_RADIUS, state.uiRadius);
  write(LS_BUBBLE_STYLE, state.bubbleStyle);
  write(LS_WALLPAPER, state.wallpaper);

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
