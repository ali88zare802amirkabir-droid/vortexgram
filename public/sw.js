var CACHE = 'vortex-v191';
var SHELL = ['/', '/app', '/manifest.json', '/landing.css?v=8', '/landing-theme.js?v=1', '/landing.js?v=8', '/privacy.html', '/terms.html', '/style.css?v=158', '/app.js?v=178', '/sanitize.js?v=1', '/emoji-effect.js?v=6', '/icons.js?v=90', '/effects.js?v=78', '/theme.js?v=1', '/pwa.js?v=3', '/map-picker.js?v=6'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// حریم خصوصی:
//  - پاسخ‌های /api/ و فایل‌های /uploads/ هرگز در کشِ مشترکِ بین‌کاربری ذخیره نمی‌شوند
//    (در غیر این صورت داده‌ی خصوصی یک کاربر برای کاربر بعدیِ همین مرورگر در دسترس بود).
//    عکس‌های /uploads/ به لطف هدر `immutable` سرور در کشِ HTTP مرورگر می‌مانند و دوباره دانلود نمی‌شوند.
//  - assetهای نسخه‌دار (?v=) همیشه یکتا هستند → cache-first: بعد از اولین دانلود، مستقیم از کش.
//  - بقیه (شِل، گالری) → stale-while-revalidate: آنی از کش + تازه‌سازی در پس‌زمینه.

function isPrivate(url) {
  return url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/uploads/') === 0;
}

function cachePut(req, r) {
  if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cl); }); }
}
function cacheMatch(req) { return caches.match(req); }

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  if (isPrivate(url)) {
    e.respondWith(fetch(e.request).catch(function () {
      return new Response('offline', { status: 503, statusText: 'Offline' });
    }));
    return;
  }

  if (e.request.mode === 'navigate') {
    // شبکه اول؛ در موفقیت، HTML تازه هم در کش می‌نشیند تا fallback آینده هیچ‌وقت کهنه نباشد.
    e.respondWith(fetch(e.request).then(function (r) {
      cachePut(e.request, r);
      return r;
    }).catch(function () {
      if (url.pathname === '/' || url.pathname === '/index.html') return caches.match('/');
      // /app?room=... یک کلید کش متفاوت است ⇒ بدون ?v و search هم امتحان می‌کنیم
      return caches.match(e.request).then(function (m) {
        return m || caches.match(e.request, { ignoreSearch: true }).then(function (m2) {
          return m2 || caches.match('/app') || new Response('offline', { status: 503, statusText: 'Offline' });
        });
      });
    }));
    return;
  }

  var isVersioned = url.search.indexOf('?v=') >= 0;

  if (isVersioned) {
    // نسخه‌دار = غیرقابل تغییر → بعد از کش‌شدن هرگز دوباره دانلود نمی‌شود (پرت‌ترینِ اینترنت)
    e.respondWith(cacheMatch(e.request).then(function (m) {
      if (m) return m;
      return fetch(e.request).then(function (r) { cachePut(e.request, r); return r; }).catch(function () {
        return new Response('offline', { status: 503, statusText: 'Offline' });
      });
    }));
    return;
  }

  // بقیه: stale-while-revalidate — پاسخ آنی از کش، تازه‌سازی بی‌صدا در پس‌زمینه
  e.respondWith(cacheMatch(e.request).then(function (m) {
    if (m) {
      fetch(e.request).then(function (r) { cachePut(e.request, r); }).catch(function () {});
      return m;
    }
    return fetch(e.request).then(function (r) { cachePut(e.request, r); return r; }).catch(function () {
      if (url.pathname.indexOf('/img/') === 0) return new Response('', { status: 503, statusText: 'Offline' });
      return new Response('offline', { status: 503, statusText: 'Offline' });
    });
  }));
});