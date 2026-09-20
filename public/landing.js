/* ============================================================
   VortexGram — Landing (v2)
   Theme system (system/light/dark) + switcher + mobile menu.
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
    var targets = Array.prototype.slice.call(document.querySelectorAll('main > section:not(.hero), .cta-box'));
    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('in', 'reveal'); });
      return;
    }
    targets.forEach(function (el) { el.classList.add('reveal'); });

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
})();