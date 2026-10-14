/* ===================== VORTEX — design runtime (Phase 4) =====================
 * Owns three things the whole client depends on, and nothing else:
 *
 *   1. POWER SAVING — `data-power="full|saver"` on <html>. In saver mode the
 *      expensive CSS (backdrop-filter, long animations, emoji effects) is turned
 *      off. This is not cosmetic: backdrop-filter on a mid-range Android can
 *      halve the frame rate, so the switch is a real performance control.
 *   2. GLASS        — `data-glass="on|off"`. Off = opaque surfaces, no blur.
 *      Same reason, and also useful for users who prefer less transparency.
 *   3. DEVICE PROFILE — low-end detection so slice A can default to the light
 *      mode on weak hardware instead of assuming a flagship phone.
 *
 * Everything is exposed through window.VXDesign so later slices (settings UI,
 * Power saving page) can read AND write it. All state is mirrored into
 * localStorage so it survives reloads, and a storage failure is non-fatal.
 *
 * Loaded BEFORE app.js so the flags are on <html> at first paint (no flash of
 * heavy glass on a slow device).
 */
'use strict';

(function () {
  var LS_GLASS = 'vx_glass';
  var LS_POWER = 'vx_power';
  var LS_AUTO = 'vx_power_auto';

  var root = document.documentElement;

  var state = {
    glass: true,
    // 'auto' follows the device profile; 'full'/'saver' are user overrides
    power: 'auto',
    lowEnd: false,
    reasons: [],
    reducedMotion: false,
  };

  /* ---------- storage (never throws) ---------- */
  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode / quota */ }
  }

  /* ---------- device profile ----------
   * Signals are cheap and independent; any two of them are enough to default
   * to saver. The frame probe is a real measurement (rAF delta) rather than a
   * guess, but it runs once and never blocks paint.
   */
  function detectLowEnd() {
    var reasons = [];

    // Explicit user preference always wins over the device guess.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reasons.push('prefers-reduced-motion');
      state.reducedMotion = true;
    }
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) reasons.push('deviceMemory=' + navigator.deviceMemory);
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) reasons.push('cores=' + navigator.hardwareConcurrency);
    // connection hints: slow/effectiveType 2g|slow-2g
    try {
      var c = navigator.connection || {};
      if (c.saveData) reasons.push('saveData');
      if (c.effectiveType && /^(slow-2g|2g)$/.test(c.effectiveType)) reasons.push('net=' + c.effectiveType);
    } catch (e) { /* not supported */ }
    if (window.matchMedia('(prefers-contrast: more)').matches) reasons.push('prefers-contrast');

    state.reasons = reasons;
    // Two independent soft signals, or one strong one (reduced-motion / saveData),
    // is enough to start in saver mode.
    var strong = state.reducedMotion || reasons.indexOf('saveData') >= 0;
    state.lowEnd = strong || reasons.length >= 2;
    return state.lowEnd;
  }

  /* ---------- frame-time probe (optional, non-blocking) ----------
   * Measures how long ~20 frames take. If the device cannot hold ~30fps we
   * drop to saver automatically. Runs after first paint so it never delays boot.
   */
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
      cb(avg > 33); // slower than ~30fps
    }
    requestAnimationFrame(step);
  }

  /* ---------- applying ---------- */
  function effectivePower() {
    if (state.power === 'full' || state.power === 'saver') return state.power;
    return state.lowEnd ? 'saver' : 'full';
  }

  function apply() {
    var p = effectivePower();
    root.setAttribute('data-power', p);
    // Reduced motion always wins for animation-sensitive CSS; power mode adds
    // the extra off switch for blur/effects.
    root.setAttribute('data-motion', state.reducedMotion ? 'reduced' : 'full');
    root.setAttribute('data-glass', state.glass ? 'on' : 'off');
    root.classList.toggle('vx-saver', p === 'saver');
  }

  var api = {
    get glass() { return state.glass; },
    get power() { return state.power; },
    get lowEnd() { return state.lowEnd; },
    get reasons() { return state.reasons.slice(); },
    get reducedMotion() { return state.reducedMotion; },
    /** Effective mode actually in force (resolves 'auto'). */
    get effectivePower() { return effectivePower(); },

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

    /** Called after the frame probe: downgrade once if the device is clearly slow. */
    _autoDowngradeIfSlow() {
      if (state.power !== 'auto') return;
      if (effectivePower() === 'saver') return;
      state.lowEnd = true;
      state.reasons.push('frame-time');
      apply();
      api._emit('power', state.power);
    },

    /** Re-run detection (used when the settings page changes things). */
    reevaluate() {
      detectLowEnd();
      apply();
      api._emit('power', state.power);
      return effectivePower();
    },

    _emit(name, value) {
      try { window.dispatchEvent(new CustomEvent('vx-design', { detail: { key: name, value: value } })); } catch (e) {}
    },

    /** Serialisable snapshot for the settings export. */
    snapshot() {
      return { glass: state.glass, power: state.power };
    },
    applySnapshot(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.glass === 'boolean') api.setGlass(s.glass);
      if (s.power) api.setPower(s.power);
    },
    reset() {
      state.glass = true; state.power = 'auto';
      write(LS_GLASS, '1'); write(LS_POWER, 'auto');
      api.reevaluate();
    },
  };

  // ---- boot ----
  detectLowEnd();
  state.glass = read(LS_GLASS, '1') === '1';
  state.power = (function () {
    var v = read(LS_POWER, 'auto');
    return (v === 'full' || v === 'saver') ? v : 'auto';
  })();
  apply();

  // React to live OS-level changes.
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () { api.reevaluate(); });
  } catch (e) {}
  try {
    matchMedia('(prefers-contrast: more)').addEventListener('change', function () { api.reevaluate(); });
  } catch (e) {}

  // Frame probe once, after the first paint, so it cannot delay boot.
  if (document.readyState === 'complete') setTimeout(function () { frameProbe(function (slow) { if (slow) api._autoDowngradeIfSlow(); }); }, 1200);
  else window.addEventListener('load', function () { setTimeout(function () { frameProbe(function (slow) { if (slow) api._autoDowngradeIfSlow(); }); }, 1200); });

  window.VXDesign = api;
})();