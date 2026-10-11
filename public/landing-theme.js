// VORTEXGRAM — public landing/legal theme bootstrap (early, render-blocking).
(function () {
  try {
    var pref = localStorage.getItem('vx_lp_theme') || 'system';
    var resolved = pref;
    if (pref === 'system') {
      resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved === 'light' ? 'light' : 'dark');
    root.setAttribute('data-theme-pref', pref === 'light' || pref === 'dark' ? pref : 'system');
    root.style.colorScheme = resolved;
  } catch (e) { document.documentElement.setAttribute('data-theme', 'dark'); }
})();
