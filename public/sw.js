var CACHE = 'vortex-v134';
var SHELL = ['/', '/manifest.json', '/style.css?v=132', '/app.js?v=138', '/icons.js?v=86', '/effects.js?v=78'];

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
//  - فقط شِلِ عمومی اپ، گالری عمومی /img/ و assetها کش می‌شوند.

// استراتژی: همیشه «شبکه اول، کش به‌عنوان پشتیبان» (stale-while-revalidate).
// هرگز یک پاسخ خراب/قدیمی asset دیروزی در کش نمی‌ماند و برنامه «مرده» نمی‌شود.
function isPrivate(url) {
  return url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/uploads/') === 0;
}

function cachePut(req, r) {
  if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cl); }); }
}

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
      return caches.match(e.request).then(function (m) { return m || new Response('offline', { status: 503, statusText: 'Offline' }); });
    }));
    return;
  }

  // assetها و گالری: شبکه اول با fallback کش
  e.respondWith(fetch(e.request).then(function (r) {
    cachePut(e.request, r);
    return r;
  }).catch(function () {
    return caches.match(e.request).then(function (m) {
      if (m) return m;
      if (url.pathname.indexOf('/img/') === 0) return new Response('', { status: 503, statusText: 'Offline' });
      return new Response('offline', { status: 503, statusText: 'Offline' });
    });
  }));
});