(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- invite param: forward to messenger ---------- */
  var q = new URLSearchParams(location.search);
  if (q.get('invite')) {
    location.replace('/app?invite=' + encodeURIComponent(String(q.get('invite')).replace('@', '')));
    return;
  }

  /* ---------- sticky header ---------- */
  var header = document.getElementById('site-header');
  function onScroll() { header.classList.toggle('scrolled', window.scrollY > 12); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- mobile nav toggle ---------- */
  var navToggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');
  navToggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') { nav.classList.remove('open'); navToggle.setAttribute('aria-expanded', 'false'); }
  });

  /* ---------- scroll reveal ---------- */
  if ('IntersectionObserver' in window && !reduceMotion) {
    var targets = document.querySelectorAll('.section h2, .pillar, .feature-card, .screen-card, .security-list li, .faq-item, .about-glass, .security-card');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (el) { el.classList.add('reveal'); io.observe(el); });
  }

  /* ---------- FAQ: only one open at a time (still fully keyboard accessible) ---------- */
  var items = document.querySelectorAll('.faq-item');
  items.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      items.forEach(function (other) { if (other !== item && other.open) other.open = false; });
    });
  });
})();