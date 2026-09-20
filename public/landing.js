/* ============================================================
    VortexGram — Landing (v4)
    Theme system (system/light/dark) + switcher + mobile menu.
    Cinematic neon stage: canvas starfield, counters, reveal variants.
    ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'vx_lp_theme';
  var root = document.documentElement;
  var darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /* ---------- Theme core ---------- */
  function getPref() {
    try { return localStorage.getItem(STORE_KEY) || 'system'; }
    catch (e) { return 'system'; }
  }

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return (darkMQ && darkMQ.matches) ? 'dark' : 'light';
  }

  function currentResolved() {
    return root.getAttribute('data-theme') || resolve(getPref());
  }

  function applyTheme() {
    var pref = getPref();
    var resolved = resolve(pref);

    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-pref', pref === 'light' || pref === 'dark' ? pref : 'system');
    root.style.colorScheme = resolved;

    // status-bar / chrome color
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#f2f2f7' : '#07090f');

    syncUI(pref);
  }

  function setPref(pref) {
    try { localStorage.setItem(STORE_KEY, pref); } catch (e) {}
    applyTheme();
  }

  /* ---------- UI sync ---------- */
  function syncUI() {
    var pref = getPref();
    var resolved = currentResolved();

    document.querySelectorAll('#theme-pop [data-theme-opt]').forEach(function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-theme-opt') === pref ? 'true' : 'false');
    });
    document.querySelectorAll('.m-seg [data-theme-opt]').forEach(function (b) {
      var active = b.getAttribute('data-theme-opt') === pref;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    var label = document.querySelector('[data-theme-label]');
    if (label) {
      label.textContent = { light: 'روشن', system: 'سیستم', dark: 'تاریک' }[pref] || 'سیستم';
    }
    if (resolved) {
      document.body.setAttribute('data-appearance', resolved);
    }
  }

  /* System appearance changes live */
  if (darkMQ && window.addEventListener) {
    darkMQ.addEventListener('change', function () {
      if (getPref() === 'system') applyTheme();
    });
  }

  /* ---------- Theme popover ---------- */
  var toggle = document.getElementById('theme-toggle');
  var pop = document.getElementById('theme-pop');
  var lastFocused = null;

  function openPop() {
    if (!pop) return;
    pop.hidden = false;
    requestAnimationFrame(function () { pop.classList.add('show'); });
    if (toggle) {
      lastFocused = document.activeElement;
      setTimeout(function () {
        var checked = pop.querySelector('[aria-checked="true"]');
        (checked || pop.querySelector('button')) && (checked || pop.querySelector('button')).focus();
      }, 40);
    }
  }

  function closePop() {
    if (!pop) return;
    pop.classList.remove('show');
    setTimeout(function () { pop.hidden = true; }, 180);
  }

  function isPopOpen() {
    return pop && !pop.hidden && pop.classList.contains('show');
  }

  if (toggle && pop) {
    toggle.addEventListener('click', function () {
      if (isPopOpen()) { closePop(); toggle.setAttribute('aria-expanded', 'false'); }
      else {
        openPop();
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    pop.querySelectorAll('[data-theme-opt]').forEach(function (opt) {
      opt.addEventListener('click', function () {
        setPref(opt.getAttribute('data-theme-opt'));
        closePop();
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (isPopOpen() && !e.target.closest('#theme-switch')) {
        closePop();
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isPopOpen()) {
        closePop();
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      }
    });
  }

  /* ---------- Mobile menu ---------- */
  var navBtn = document.getElementById('nav-toggle');
  var mobileMenu = document.getElementById('mobile-menu');

  function openMenu() {
    if (!mobileMenu) return;
    mobileMenu.hidden = false;
    requestAnimationFrame(function () { mobileMenu.classList.add('open'); });
    root.classList.add('menu-open');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu(restoreFocus) {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('open');
    root.classList.remove('menu-open');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    setTimeout(function () { mobileMenu.hidden = true; }, 180);
    if (restoreFocus && navBtn) navBtn.focus();
  }

  function isMenuOpen() {
    return mobileMenu && !mobileMenu.hidden && mobileMenu.classList.contains('open');
  }

  if (navBtn && mobileMenu) {
    navBtn.addEventListener('click', function () {
      if (isMenuOpen()) closeMenu(true);
      else openMenu();
    });

    mobileMenu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { closeMenu(false); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isMenuOpen()) closeMenu(true);
    });

    mobileMenu.querySelectorAll('.m-seg-btn').forEach(function (opt) {
      opt.addEventListener('click', function () { setPref(opt.getAttribute('data-theme-opt')); });
    });
  }

  /* ---------- Reveal on scroll (progressive) ---------- */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initReveal() {
    root.classList.add('has-js');
    var targets = Array.prototype.slice.call(document.querySelectorAll('main > section:not(.hero), .cta-box, [data-reveal]'));
    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('in', 'reveal'); });
      return;
    }
    targets.forEach(function (el) {
      el.classList.add('reveal');
      var v = (el.getAttribute('data-reveal') || '').trim();
      if (v) el.classList.add('rv-' + v);
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });

    targets.forEach(function (el) { io.observe(el); });
  }

  initReveal();
  applyTheme();

  /* ---------- Hero entrance ---------- */
  if (reduced) {
    root.classList.add('loaded');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(function () { root.classList.add('loaded'); });
    });
  }

  /* ---------- Scroll progress bar ---------- */
  var progress = document.getElementById('scroll-progress');
  if (progress && !reduced) {
    var ticking = false;
    function updateProgress() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
      progress.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
    }, { passive: true });
    updateProgress();
  }

  /* ---------- Device tilt (desktop pointers only) ---------- */
  var heroVis = document.querySelector('.hero-visual');
  var deviceEl = document.querySelector('.device');
  var canTilt = heroVis && deviceEl && !reduced &&
                window.matchMedia && window.matchMedia('(pointer: fine)').matches &&
                window.matchMedia('(hover: hover)').matches;
  if (canTilt) {
    var rx = 0, ry = 0, tiltRaf = null;
    heroVis.addEventListener('pointermove', function (e) {
      var r = heroVis.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      rx = (py * -12).toFixed(2);
      ry = (px * 14).toFixed(2);
      if (deviceEl.style.transition) { deviceEl.style.transition = ''; }
      if (!tiltRaf) {
        tiltRaf = requestAnimationFrame(function () {
          tiltRaf = null;
          deviceEl.style.transform = 'perspective(900px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
        });
      }
    });
    heroVis.addEventListener('pointerleave', function () {
      rx = 0; ry = 0;
      deviceEl.style.transition = 'transform .45s var(--ease)';
      deviceEl.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
    });
  }

  /* ---------- Canvas starfield (cinematic neon) ---------- */
  if (!reduced) {
    var canvas = document.getElementById('fx-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      var stars = [];
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var hero = document.querySelector('.hero');
      var visible = true;
      var rafId = null;

      function resize() {
        var r = hero.getBoundingClientRect();
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var isCoarse = window.matchMedia('(pointer: coarse)').matches;
        var count = Math.min(isCoarse ? 60 : 130, Math.floor(r.width * r.height / 20000));
        stars = Array.from({ length: count }, function () {
          return {
            x: Math.random() * r.width,
            y: Math.random() * r.height,
            r: Math.random() * 1.2 + 0.4,
            s: Math.random() * 0.5 + 1.2,
            ph: Math.random() * Math.PI * 2
          };
        });
      }

      function getStarColor() {
        var theme = root.getAttribute('data-theme');
        return theme === 'light' ? '#3a4a6a' : '#bfd8ff';
      }

      function draw(ts) {
        if (!visible) { rafId = null; return; }
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        var color = getStarColor();
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          var a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(ts / 1000 * s.s + s.ph));
          ctx.globalAlpha = a;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        rafId = requestAnimationFrame(draw);
      }

      var ioHero = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && !rafId) draw(performance.now());
      }, { rootMargin: '100px' });
      ioHero.observe(hero);

      window.addEventListener('resize', function () { resize(); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && visible && !rafId) draw(performance.now());
      });

      resize();
      draw(performance.now());
    }
  }

  /* ---------- Animated counters (real stats) ---------- */
  if (!reduced) {
    var statNums = Array.prototype.slice.call(document.querySelectorAll('.stat-num[data-count]'));
    if (statNums.length && 'IntersectionObserver' in window) {
      var fmt = function (n) { return n.toLocaleString('fa-IR'); };
      var ioStats = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var el = en.target;
            var target = parseInt(el.getAttribute('data-count'), 10);
            var prefix = el.getAttribute('data-prefix') || '';
            var t0 = performance.now();
            var dur = 1200;
            function tick(t) {
              var p = Math.min(1, (t - t0) / dur);
              var e = 1 - Math.pow(1 - p, 3);
              el.textContent = prefix + fmt(Math.round(target * e));
              if (p < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
            ioStats.unobserve(el);
          }
        });
      }, { threshold: 0.35 });
      statNums.forEach(function (el) { ioStats.observe(el); });
    }
  }
})();