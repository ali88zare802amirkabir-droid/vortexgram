var CACHE = 'vortex-v107';
var SHELL = ['/', '/manifest.json', '/style.css?v=102', '/app.js?v=103', '/icons.js?v=83', '/effects.js?v=78'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(function () {
      if (url.pathname === '/' || url.pathname === '/index.html') return caches.match('/');
      return new Response('offline', { status: 503, statusText: 'Offline' });
    }));
    return;
  }
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/uploads/') === 0 || url.pathname.indexOf('/img/backgrounds/') === 0) {
    e.respondWith(fetch(e.request).then(function (r) {
      if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cl); }); }
      return r;
    }).catch(function () { return caches.match(e.request).then(function (m) { return m || new Response('', { status: 503, statusText: 'Offline' }); }); }));
    return;
  }
  e.respondWith(caches.match(e.request).then(function (m) {
    return m || fetch(e.request).then(function (r) {
      if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cl); }); }
      return r;
    });
  }));
});