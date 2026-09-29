if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function () {}); }
(function () {
  var q = new URLSearchParams(location.search);
  var inv = q.get('invite') || '';
  if (inv) { localStorage.setItem('vx_inviter', inv.replace('@', '').toLowerCase().slice(0, 50)); history.replaceState(null, '', location.pathname); }
  var jm = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)/);
  if (jm) { localStorage.setItem('vx_group_invite', jm[1].slice(0, 60)); history.replaceState(null, '', '/app'); }

  var def = null;
  var btn = null;
  var dragging = false;
  var moved = false;
  var sx = 0, sy = 0, sl = 0, st = 0;

  function isMobile() { return window.innerWidth <= 820 || window.matchMedia('(hover: none)').matches; }
  function saveState() {
    try {
      if (btn && btn.classList.contains('collapsed')) localStorage.setItem('vx_pwa_state', 'collapsed');
      else localStorage.setItem('vx_pwa_state', 'expanded');
    } catch (e) {}
  }
  function collapse() {
    if (!btn) return;
    btn.classList.add('collapsed');
    var x = btn.querySelector('.pwa-fab-x'); if (x) x.style.display = 'none';
    saveState();
  }
  function expand() {
    if (!btn) return;
    btn.classList.remove('collapsed');
    var x = btn.querySelector('.pwa-fab-x'); if (x) x.style.display = '';
    saveState();
  }
  function toggle() { if (btn && btn.classList.contains('collapsed')) expand(); else collapse(); }

  function build() {
    if (btn && btn.isConnected) return btn;
    var el = document.createElement('div');
    el.id = 'pwa-install';
    el.className = 'pwa-fab';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'نصب اپ VORTEX');
    el.innerHTML = '<span class="pwa-fab-x" role="button" tabindex="0" aria-label="کوچک و بزرگ کردن">\u00d7</span>' +
                   '<span class="pwa-fab-text">نصب اپ VORTEX</span>';
    document.body.appendChild(el);
    btn = el;
    window.__pwaBtn = el;
    try {
      var saved = JSON.parse(localStorage.getItem('vx_pwa_pos') || 'null');
      if (saved && isMobile()) {
        el.style.left = saved.left + 'px';
        el.style.top = saved.top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    } catch (e) {}
    return el;
  }

  function installFallback() {
    try {
      if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        alert('برای نصب: روی Share بزنید و سپس «Add to Home Screen» را انتخاب کنید.');
      } else {
        alert('برای نصب: از منوی مرورگر (⋮) گزینه «Install app» یا «Add to Home screen» را انتخاب کنید.');
      }
    } catch (e) {}
  }

  function show() {
    var el = build();
    var mob = isMobile();

    if (!mob) {
      el.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('pwa-fab-x')) return;
        if (def) { def.prompt(); def = null; } else installFallback();
      });
      return;
    }

    var x = el.querySelector('.pwa-fab-x');
    el.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      sx = e.clientX; sy = e.clientY;
      var r = el.getBoundingClientRect();
      sl = r.left; st = r.top;
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) {
        var w = el.offsetWidth, h = el.offsetHeight;
        el.style.left = Math.max(4, Math.min(sl + dx, window.innerWidth - w - 4)) + 'px';
        el.style.top = Math.max(4, Math.min(st + dy, window.innerHeight - h - 4)) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      try {
        localStorage.setItem('vx_pwa_pos', JSON.stringify({
          left: Math.round(el.getBoundingClientRect().left),
          top: Math.round(el.getBoundingClientRect().top)
        }));
      } catch (err) {}
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }
      if (e.target && e.target.classList && e.target.classList.contains('pwa-fab-x')) return;
      if (btn.classList.contains('collapsed')) {
        expand();
      } else {
        if (def) { try { def.prompt(); } catch (err) {} def = null; }
        collapse();
      }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
    });
    x.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      toggle();
    });

    if (localStorage.getItem('vx_pwa_state') === 'collapsed') collapse();
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    def = e;
    show();
  });

  if (!window.matchMedia('(display-mode: standalone)').matches) {
    setTimeout(show, 1500);
  }

  window.addEventListener('appinstalled', function () {
    if (window.__pwaBtn) { window.__pwaBtn.remove(); window.__pwaBtn = null; }
  });
})();