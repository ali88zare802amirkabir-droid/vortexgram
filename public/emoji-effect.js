/* ============================================================================
   افکت ایموجی Interactive (Single Emoji) — سازگاری با معماری فعلی VortexGram.

   • وقتی پیام از نظر محتوا دقیقاً «یک ایموجی» باشد، با ضربه (pointerdown) روی
     حبابِ آن، انیمیشنِ همان ایموجی اجرا می‌شود.
   • assetها از نوع TGS (لوتی متراکم‌شده با gzip) هستند که با lottie-web پخش
     می‌شوند؛ هیچ dependency خارجی روی CDN نداریم — همه چیز محلی است.
   • هر ضربه یک نمونهٔ جدید می‌سازد و نمونه‌های قبلی restart نمی‌شوند.
   • بعد از finish یا پس از خطا، instance نابود و DOM پاک می‌شود.
   • حداکثر چند انیمیشنِ همزمان باقی می‌تواند روی صفحه باشد تا CPU/حافظه
     خراب نشود.
   ============================================================================ */
(function (global) {
  'use strict';

  var FX_MANIFEST_URL = '/emoji-effects/manifest.json?v=1';
  var LOTTIE_URL = '/lottie/lottie.min.js?v=1';
  var MAX_CONCURRENT = 6;
  var active = [];          // { host, anim }
  var manifest = null;      // emoji -> path (نرمال‌شده)
  var manifestPromise = null;
  var lottiePromise = null;
  var dataCache = new Map();; // url -> animationData

  /* نرمال‌سازی: تفاوت در U+FE0F / U+200D تا match روی ایموجی‌ها درست کار کند */
  function norm(e) { return String(e || '').replace(/[\uFE0F\u200D]/gu, ''); }

  function emojiRunsOf(text) {
    if (global.emojiRuns) return global.emojiRuns(text);
    var m = String(text || '').match(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu);
    return m || [];
  }

  /* پیام فقط یک ایموجی است (نه متن، نه چند ایموجی)؟ */
  function isSingleEmojiMessage(m) {
    if (!m) return false;
    var kind = m.kind || 'text';
    if (kind !== 'text' && kind !== undefined) return false;
    var t = (m.content || '').trim();
    if (!t) return false;
    if (typeof global.emojiOnly === 'function' && !global.emojiOnly(t)) return false;
    var runs = emojiRunsOf(t);
    return runs.length === 1 && norm(runs[0]) === norm(t);
  }

  function loadLottie() {
    if (global.lottie) return Promise.resolve(global.lottie);
    if (lottiePromise) return lottiePromise;
    lottiePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LOTTIE_URL;
      s.async = true;
      s.onload = function () { resolve(global.lottie); };
      s.onerror = function () { lottiePromise = null; reject(new Error('lottie load failed')); };
      document.head.appendChild(s);
    });
    return lottiePromise;
  }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetch(FX_MANIFEST_URL).then(function (r) { return r.ok ? r.json() : {}; }).then(function (raw) {
      manifest = {};
      Object.keys(raw || {}).forEach(function (k) { manifest[norm(k)] = raw[k]; });
      return manifest;
    }).catch(function () { manifest = {}; return manifest; });
    return manifestPromise;
  }

  function loadAnimationData(url) {
    if (dataCache.has(url)) return Promise.resolve(dataCache.get(url));
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('asset ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return unpack(new Uint8Array(buf));
    }).then(function (json) {
      var data = JSON.parse(json);
      dataCache.set(url, data);
      return data;
    });
  }

  /* TGS همان لوتی است ولی gzip شده؛ اگر فایل لوتیِ خام بود هم می‌خواندش */
  function unpack(bytes) {
    if (bytes[0] === 0x7B /* { */) return new TextDecoder().decode(bytes);
    var ds = new DecompressionStream('gzip');
    return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  }

  function destroyEntry(entry) {
    try { if (entry && entry.anim) entry.anim.destroy(); } catch (e) {}
    try { if (entry && entry.host) entry.host.remove(); } catch (e) {}
  }

  function spawnAt(url, rect) {
    loadLottie().then(function () { return loadAnimationData(url); }).then(function (data) {
      /* شمارهٔ فعال‌ها را محدود می‌کنیم؛ قدیمی‌ترین فدا */
      while (active.length >= MAX_CONCURRENT) { destroyEntry(active.shift()); }
      var size = Math.max(132, Math.min(220, Math.round(window.innerWidth * 0.5)));
      var host = document.createElement('div');
      host.className = 'emoji-fx-layer';
      host.style.position = 'fixed';
      host.style.width = size + 'px';
      host.style.height = size + 'px';
      host.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
      host.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
      host.style.pointerEvents = 'none';
      host.style.zIndex = 1600;
      document.body.appendChild(host);
      var anim = global.lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: true, animationData: data });
      var entry = { host: host, anim: anim };
      var done = false;
      var finish = function () {
        if (done) return; done = true;
        var i = active.indexOf(entry); if (i >= 0) active.splice(i, 1);
        destroyEntry(entry);
      };
      anim.addEventListener('complete', finish);
      anim.addEventListener('error', finish);
      active.push(entry);
      /* ایمنی: اگر «complete» زده نشد، بعد از ۵ ثانیه پاک‌سازی کنیم */
      entry._t = setTimeout(finish, 5000);
    }).catch(function () {});
  }

  function effectUrlFor(content) {
    var runs = emojiRunsOf(content);
    if (runs.length !== 1) return null;
    var map = manifest;
    var key = norm(runs[0]);
    var p = map ? map[key] : null;
    return p || null;
  }

  function handlePointerDown(e) {
    var bubble = e.target.closest ? e.target.closest('.bubble') : null;
    if (!bubble) return;
    /* `state` یک binding lexically-global است که app.js می‌سازد؛ مستقیم قابل دسترسی است */
    var appState = null;
    try { appState = (typeof state !== 'undefined') ? state : null; } catch (e) { appState = null; }
    if (!appState || !appState.room) return;
    var room = appState.rooms && appState.rooms[appState.room];
    if (!room || !room.messages) return;
    var id = bubble.dataset && bubble.dataset.id;
    var m = room.messages.find(function (x) { return String(x.id) === String(id); });
    if (!m || !isSingleEmojiMessage(m)) return;
    if (!manifest) {
      /* نخستین ضربه: manifest را بار می‌کنیم و همان‌جا اثر را پخش می‌کنیم */
      loadManifest().then(function () {
        var u = effectUrlFor(m.content);
        if (u) spawnAt(u, bubble.getBoundingClientRect());
      });
      try { global.__emojiFxSuppressCtxUntil = Date.now() + 1200; } catch (e) {}
      return;
    }
    var url = effectUrlFor(m.content);
    if (!url) return;
    spawnAt(url, bubble.getBoundingClientRect());
    /* پنجرهٔ زمانی کوتاه تا tap برای باز شدن منویپیام استفاده نشود */
    try { global.__emojiFxSuppressCtxUntil = Date.now() + 1000; } catch (err) {}
  }

  function attach() {
    if (global.__emojiFxAttached) return;
    global.__emojiFxAttached = true;
    document.addEventListener('pointerdown', handlePointerDown, true);
    loadManifest();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();

  global.VXEmojiFx = { attach: attach, isSingleEmojiMessage: isSingleEmojiMessage };
})(window);