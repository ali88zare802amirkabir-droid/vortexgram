if ('serviceWorker' in navigator) {
  // بدون این بخش، کاربر تا وقتی خودش دستی پاک نکند، نسخه‌ی کهنه را از کش
  // می‌گیرد: sw.js نسخه‌دار با (?v=) برای همیشه cache-first است و browser هم
  // تا قبل از به‌روزرسانی worker، هیچ اعلانی نمی‌دهد. اینجا هر نسخه‌ی تازه
  // خودش را تحویل می‌گیرد و صفحه یک‌بار رفرش می‌شود.
  var reloading = false;
  var applyUpdate = function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    reg.addEventListener('updatefound', function () {
      var sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', function () {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) applyUpdate();
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) applyUpdate();
  }).catch(function () {});
  navigator.serviceWorker.addEventListener('controllerchange', applyUpdate);
}
(function () {
  var q = new URLSearchParams(location.search);
  var inv = q.get('invite') || '';
  if (inv) { localStorage.setItem('vx_inviter', inv.replace('@', '').toLowerCase().slice(0, 50)); history.replaceState(null, '', location.pathname); }
  var jm = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)/);
  if (jm) { localStorage.setItem('vx_group_invite', jm[1].slice(0, 60)); history.replaceState(null, '', '/app'); }

  var def = null;
  var banner = null;
  var DISMISS_KEY = 'vx_pwa_dismissed';

  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (err) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) {}
    if (banner && banner.isConnected) banner.remove();
    banner = null;
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

  function build() {
    if (banner && banner.isConnected) return banner;
    var el = document.createElement('div');
    el.id = 'pwa-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'نصب اپ VORTEX');
    el.innerHTML = '<span class="pwa-banner-text">VORTEX را نصب کنید</span>' +
      '<button type="button" class="pwa-banner-install">نصب</button>' +
      '<button type="button" class="pwa-banner-close" aria-label="بستن پیشنهاد نصب">\u00d7</button>';
    document.body.appendChild(el);
    banner = el;
    el.querySelector('.pwa-banner-install').addEventListener('click', function () {
      if (def) { try { def.prompt(); } catch (err) {} def = null; }
      else installFallback();
    });
    el.querySelector('.pwa-banner-close').addEventListener('click', dismiss);
    return el;
  }

  function show() {
    if (dismissed()) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    build();
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
    dismiss();
  });
})();
