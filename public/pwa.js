if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function () {}); }
(function () {
  var q = new URLSearchParams(location.search);
  var inv = q.get('invite') || '';
  if (inv) { localStorage.setItem('vx_inviter', inv.replace('@', '').toLowerCase().slice(0, 50)); history.replaceState(null, '', location.pathname); }
  var jm = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)/);
  if (jm) { localStorage.setItem('vx_group_invite', jm[1].slice(0, 60)); history.replaceState(null, '', '/app'); }
  var def = null;
  var btn = null;
  function createPwaBtn() {
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'pwa-install';
    btn.className = 'pwa-fab';
    btn.innerHTML = '<span class="pwa-fab-text">نصب اپ VORTEX</span>';
    btn.onclick = function () {
      if (def) { def.prompt(); }
      else {
        var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
          alert('برای نصب: روی Share بزنید و سپس «Add to Home Screen» را انتخاب کنید.');
        } else {
          alert('برای نصب: از منوی مرورگر (⋮) گزینه «Install app» یا «Add to Home screen» را انتخاب کنید.');
        }
      }
    };
    document.body.appendChild(btn);
    window.__pwaBtn = btn;
    setTimeout(function () { btn.classList.add('pwa-fab-circle'); }, 2000);
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); def = e;
    createPwaBtn();
  });
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    setTimeout(createPwaBtn, 1500);
  }
  window.addEventListener('appinstalled', function () { if (window.__pwaBtn) { window.__pwaBtn.remove(); window.__pwaBtn = null; } });
})();
