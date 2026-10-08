/* =========================================================================
   نقشهٔ موقعیت مکانی — بدون هیچ کتابخانهٔ بیرونی و بدون CDN.

   چرا دست‌ساز؟ کل برنامه بدون CDN است (آفلاین‌کار می‌ماند)، پس مپ هم باید
   خودش کاشی‌ها را بکشد و مختصات را حساب کند.

   چه کارهایی می‌کند:
     • پروژهٔ Web Mercator و کشیدن کاشی‌ها (زوم/پن/چرخش با لمس و ماوس)
     • چند پس‌زمینه: دو‌بعدی (استاندارد/روشن/تیره/ماهواره‌ای/توپوگرافی)
       و سه‌بعدیِ زاویه‌دار (کج‌شدن صفحهٔ نقشه + چرخش + حس برجستگی)
     • لایهٔ ترافیک (اگر سرور آدرس کاشی ترافیک داشته باشد)
     • جست‌وجوی نام مکان (OpenStreetMap/Nominatim) و «موقعیت فعلی من»
     • انتخاب نقطه روی نقشه با نشانگر صلیبی و ارسال آن به چت
     • کارت موقعیت داخل پیام + باز کردن در نشان، گوگل‌مپ و مسیریابی
   ========================================================================= */
(function () {
  'use strict';

  var TILE = 256;
  /* پس‌زمینه‌های نقشه.
   نکتهٔ مهم: فقط از سرویس‌هایی استفاده می‌کنیم که استفادهٔ بدون‌کلید را
   مجاز بدانند. OSM رایگان است ولی «سیاست کاری» سختی دارد: باید Referer
   بفرستیم (هدر Referrer-Policy سایت را برای همین strict-origin تنظیم کردیم)
   و نباید حجم زیادی کاشی بکشیم یا کاشی‌ها را بی‌نهایت کش نکنیم.
   آینه‌ها هم در کنار هم هستند تا اگر یکی خطا داد، بقیه کار کنند. */
var TILE_STYLES = {
    std: { label: 'استاندارد', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, dark: false, attrib: '© OpenStreetMap' },
    de: { label: 'OSM آلمان', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', max: 18, dark: false, attrib: '© OpenStreetMap' },
    fr: { label: 'OSM فرانسه', url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', max: 19, dark: false, attrib: '© OpenStreetMap' },
    dark: { label: 'تیره', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, dark: true, attrib: '© OpenStreetMap' },
  };
/* اگر سرویس پیش‌فرض خطا داد، به‌ترتیب روی این‌ها امتحان می‌کنیم */
var TILE_FALLBACKS = ['fr', 'de', 'std'];
  var SUB = ['a', 'b', 'c'];

  /* نشانگر انتخاب‌شده: سوزن قطره‌ای با نوک دقیقاً روی نقطه */
  var VX_PIN_SVG =
    '<svg class="vxmap-pin" viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="vxpinG" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ff6b57"/><stop offset="1" stop-color="#d92d20"/>' +
        '</linearGradient>' +
        '<filter id="vxpinS" x="-40%" y="-25%" width="180%" height="170%">' +
          '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".45"/>' +
        '</filter>' +
      '</defs>' +
      '<path d="M14 39.5 C14 39.5 27 24.5 27 14.5 A13 13 0 1 0 1 14.5 C1 24.5 14 39.5 14 39.5 Z" fill="url(#vxpinG)" filter="url(#vxpinS)"/>' +
      '<circle cx="14" cy="14.5" r="4.6" fill="#fff"/>' +
    '</svg>';
  /* نشانگر «موقعیت فعلی من»: نقطهٔ آبی با حلقهٔ تپنده */
  var VX_DOT_SVG =
    '<svg class="vxmap-dot" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="12" fill="#fff"/>' +
      '<circle cx="12" cy="12" r="9.5" fill="#1a73e8"/>' +
      '<circle cx="12" cy="12" r="3.4" fill="#fff" opacity=".95"/>' +
    '</svg>';

  /* ---------- کمکی‌های مختصات ---------- */
  function lonToX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function latToY(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
  }
  function xToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function yToLat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function clampLat(lat) { return Math.max(-85.05112878, Math.min(85.05112878, lat)); }
  function fmtLat(lat) { return (Math.abs(lat)).toFixed(5); }

  /* ---------- پیکربندی سرور (کاشی سفارشی/نشان + ترافیک) ---------- */
  var CFG = null;
  function loadCfg() {
    if (CFG) return Promise.resolve(CFG);
    return fetch('/api/map-config', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        CFG = {
          tileUrl: (d && d.tileUrl) || '',
          tileAttrib: (d && d.tileAttrib) || '© OpenStreetMap',
          trafficUrl: (d && d.trafficUrl) || '',
          maxZoom: (d && d.maxZoom) || 19,
        };
        return CFG;
      });
  }

  /* جایگزینی الگوی کاشی؛ {s} را با زیردامنه و بقیه را با اعداد پر می‌کند */
  function tileUrl(tpl, z, x, y) {
    return String(tpl)
      .replace('{s}', SUB[Math.abs((x * 7 + y * 13 + z * 3)) % SUB.length])
      .replace('{z}', z).replace('{x}', x).replace('{y}', y)
      .replace('{r}', '');
  }

  /* =======================================================================
     VXMap — خود نقشه
     ======================================================================= */
  function VXMap(opts) {
    opts = opts || {};
    this.el = document.createElement('div');
    this.el.className = 'vxmap' + (opts.className ? ' ' + opts.className : '');
    this.zoom = opts.zoom || 12;
    this.bearing = opts.bearing || 0;
    this.pitch = opts.pitch || 0;
    this.lat = opts.lat != null ? opts.lat : 35.6892;
    this.lon = opts.lon != null ? opts.lon : 51.3890;
    this.style = opts.style || 'std';
    this.interactive = opts.interactive !== false;
    this.traffic = false;
    this.onPick = null;
    this._tiles = {};
    this._els = {};
    this._pointers = new Map();
    this._raf = 0;
    this._build();
    this.render(true);
  }

  VXMap.prototype._build = function () {
    var self = this;
    this.el.innerHTML =
      '<div class="vxmap-view">' +
        '<div class="vxmap-plane"></div>' +
        '<div class="vxmap-marker" hidden>' + VX_PIN_SVG + '</div>' +
        '<div class="vxmap-cross" hidden></div>' +
        '<div class="vxmap-me" hidden><span class="vxmap-me-pulse"></span>' + VX_DOT_SVG + '</div>' +
      '</div>' +
      '<div class="vxmap-ctrl">' +
        '<button type="button" class="vxmap-cbtn" data-m="zoom-in" title="نزدیک‌تر" aria-label="نزدیک‌تر">+</button>' +
        '<button type="button" class="vxmap-cbtn" data-m="zoom-out" title="دورتر" aria-label="دورتر">−</button>' +
        '<button type="button" class="vxmap-cbtn" data-m="locate" title="موقعیت فعلی من" aria-label="موقعیت فعلی من">◎</button>' +
      '</div>' +
      '<div class="vxmap-attrib"></div>';

    this.view = this.el.querySelector('.vxmap-view');
    this.plane = this.el.querySelector('.vxmap-plane');
    this.marker = this.el.querySelector('.vxmap-marker');
    this.cross = this.el.querySelector('.vxmap-cross');
    this.me = this.el.querySelector('.vxmap-me');

    this.el.querySelector('[data-m="zoom-in"]').onclick = function () { self.zoomBy(1); };
    this.el.querySelector('[data-m="zoom-out"]').onclick = function () { self.zoomBy(-1); };
    this.el.querySelector('[data-m="locate"]').onclick = function () { self.locate(); };

    if (this.interactive) this._bind();
  };

  /* ---------- تعامل: پن، زوم دوسر، چرخش ---------- */
  VXMap.prototype._bind = function () {
    var self = this, view = this.view;
    var pinch0 = 0, dist0 = 0, cx0 = 0, cy0 = 0, z0 = 0;
    var moved = false, start = null;

    view.style.touchAction = 'none';

    view.addEventListener('pointerdown', function (e) {
      /* گرفتن اشاره‌گر اختیاری است؛ اگر خطا داد نباید حرکت نقشه متوقف شود */
      try { view.setPointerCapture(e.pointerId); } catch (err) {}
      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (self._pointers.size === 1) {
        moved = false;
        start = { x: e.clientX, y: e.clientY, z: self.zoom };
      } else if (self._pointers.size === 2) {
        var p = Array.from(self._pointers.values());
        pinch0 = self._dist(p[0], p[1]);
        dist0 = pinch0;
        z0 = self.zoom;
        cx0 = (p[0].x + p[1].x) / 2;
        cy0 = (p[0].y + p[1].y) / 2;
      }
    });

    view.addEventListener('pointermove', function (e) {
      if (!self._pointers.has(e.pointerId)) return;
      var prev = self._pointers.get(e.pointerId);
      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (self._pointers.size === 1 && start) {
        var dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        /* حرکت دکمه رایگیری کند تا زوم روی نقطهٔ انگشت بماند */
        self._panBy(dx, dy);
        start = { x: e.clientX, y: e.clientY, z: self.zoom };
      } else if (self._pointers.size === 2 && pinch0 > 0) {
        var q = Array.from(self._pointers.values());
        var d = self._dist(q[0], q[1]);
        if (d > 0) {
          var nz = z0 + Math.log2(d / pinch0);
          self.zoomTo(nz, cx0, cy0);
        }
        moved = true;
      }
      e.preventDefault();
    });

    var up = function (e) {
      self._pointers.delete(e.pointerId);
      if (self._pointers.size === 0) {
        /* ضربهٔ کوتاه بدون حرکت ⇒ انتخاب نقطه */
        if (!moved && start && self.onPick && e.type === 'pointerup') {
          var r = view.getBoundingClientRect();
          var px = self._lonAt(e.clientX - r.left, e.clientY - r.top);
          if (px) self.onPick(px.lat, px.lng);
        }
        start = null; pinch0 = 0;
      }
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('pointerleave', up);

    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = view.getBoundingClientRect();
      self.zoomTo(self.zoom + (e.deltaY < 0 ? 0.6 : -0.6), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    view.addEventListener('dblclick', function (e) {
      var r = view.getBoundingClientRect();
      self.zoomTo(self.zoom + 1, e.clientX - r.left, e.clientY - r.top);
    });
  };

  VXMap.prototype._dist = function (a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /* ---------- هندسه: همه‌چیز روی «زومِ صحیحِ کاشی» حساب می‌شود ----------
     کاشی‌ها با زومِ صحیح (z) کشیده می‌شوند و زومِ کسری فقط با scale روی
     صفحه اعمال می‌شود. اگر این دو قاطی شوند، یک پیکسل حرکت انگشت چند
     کیلومتر جابه‌جا می‌کند و جهت حرکت هم برعکس می‌شود. */
  VXMap.prototype._z = function () { return Math.round(this.zoom); };
  VXMap.prototype._scale = function () { return Math.pow(2, this.zoom - Math.round(this.zoom)); };
  VXMap.prototype._cx = function () { return this.view.clientWidth / 2; };
  VXMap.prototype._cy = function () { return this.view.clientHeight / 2; };

  /* جابه‌جایی نقشه با حرکت انگشت.
     کشیدن نقشه به راست ⇒ محتوا راست می‌رود ⇒ طول جغرافیایی مرکز کم می‌شود. */
  VXMap.prototype._panBy = function (dx, dy) {
    var z = this._z(), s = this._scale();
    var cx = lonToX(this.lon, z) * TILE;
    var cy = latToY(this.lat, z) * TILE;
    var nx = cx - dx / s;
    var ny = cy - dy / s;
    this.lon = xToLon(nx / TILE, z);
    this.lat = clampLat(yToLat(ny / TILE, z));
    this.render();
  };

  /* مختصات دلخواه صفحه ⇒ lon/lat (برای انتخاب نقطه و زوم روی نقطه) */
  VXMap.prototype._lonAt = function (px, py) {
    var z = this._z(), s = this._scale();
    var vw = this.view.clientWidth, vh = this.view.clientHeight;
    var cx = lonToX(this.lon, z) * TILE;
    var cy = latToY(this.lat, z) * TILE;
    var dx = px - vw / 2, dy = py - vh / 2;
    /* در نمای چرخیده/کج، بردار صفحه را به فضای نقشه برمی‌گردانیم
       (همان ترنسفور plane، ولی معکوس) و بعد scale را برمی‌داریم. */
    if (this.bearing || this.pitch) {
      var a = this.bearing * Math.PI / 180;
      var c = Math.cos(a), sn = Math.sin(a);
      var rx = dx * c - dy * sn;
      var ry = dx * sn + dy * c;
      dx = rx;
      dy = ry * Math.cos(Math.max(0.01, this.pitch * Math.PI / 180));
    }
    dx /= s; dy /= s;
    return { lon: xToLon((cx + dx) / TILE, z), lat: clampLat(yToLat((cy + dy) / TILE, z)) };
  };

  VXMap.prototype.zoomBy = function (d) { this.zoomTo(this.zoom + d, this._cx(), this._cy()); };
  /* نقطهٔ صفحه ⇒ مختصات (عمومی؛ تست‌ها و افزونه‌ها از همین استفاده می‌کنند) */
  VXMap.prototype.pointAt = function (px, py) { return this._lonAt(px, py); };
  VXMap.prototype.zoomTo = function (z, px, py) {
    if (px == null) { px = this._cx(); py = this._cy(); }
    var cfg = this.custom || TILE_STYLES[this.style] || TILE_STYLES.std;
    var max = (cfg && cfg.max) || 19;
    var nz = Math.max(2, Math.min(max, z));
    /* نقطه‌ای که انگشت/نشانگر روی آن است باید همان‌جا بماند */
    var anchor = this._lonAt(px, py);
    this.zoom = nz;
    /* مرکز را طوری جابه‌جا می‌کنیم که anchor زیر همان نقطه بیفتد */
    var now = this._lonAt(px, py);
    this.lon += anchor.lon - now.lon;
    this.lat = clampLat(this.lat + (anchor.lat - now.lat));
    this.render();
  };

  VXMap.prototype.setView = function (lat, lon, zoom) {
    this.lat = clampLat(lat); this.lon = lon;
    if (zoom) this.zoom = zoom;
    this.render();
  };
  VXMap.prototype.setStyle = function (k) {
    if (!TILE_STYLES[k]) return;
    this.style = k;
    this._fails = 0;
    this._els = {}; this.plane.innerHTML = '';
    this.render();
  };

  /* وقتی کاشی بارگذاری نشد ⇒ شمارندهٔ خطا بالا می‌رود و به آینهٔ بعدی می‌رویم.
     پس از چند خطای پشت‌سرهم به کاربر می‌گوییم سرویس نقشه در دسترس نیست. */
  VXMap.prototype._tileFailed = function (key) {
    if (this._switching) return;
    this._fails = (this._fails || 0) + 1;
    if (this._fails < 4) return;
    var order = TILE_FALLBACKS;
    var cur = order.indexOf(this.style);
    var next = order[(cur + 1) % order.length];
    if (this.style === next) return;
    this._switching = true;
    var self = this;
    setTimeout(function () {
      self._switching = false;
      self._fails = 0;
      self.style = next;
      self._els = {}; self.plane.innerHTML = '';
      if (self.onTileFallback) self.onTileFallback(next);
      self.render();
    }, 60);
  };
  VXMap.prototype.set3d = function (on, pitch) {
    this.pitch = on ? (pitch == null ? 52 : pitch) : 0;
    this.el.classList.toggle('vxmap-3d', !!on);
    /* در نمای سه‌بعدی ساختمان‌ها روشن می‌شوند؛ در دوبعدی خاموش */
    this.setBuildings(!!on);
    this.render();
  };
  VXMap.prototype.setBearing = function (deg) { this.bearing = deg % 360; this.render(); };
  VXMap.prototype.rotateBy = function (d) { this.setBearing(this.bearing + d); };

  VXMap.prototype.locate = function (cb) {
    var self = this;
    if (!navigator.geolocation) { toast('موقعیت‌یابی در این مرورگر پشتیبانی نمی‌شود'); return; }
    toast('در حال یافتن موقعیت شما…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var la = pos.coords.latitude, lo = pos.coords.longitude;
      self.me.hidden = false;
      self._meLL = { lat: la, lon: lo };
      if (self._follow !== false) self.setView(la, lo, Math.max(self.zoom, 15));
      else self.render();
      if (cb) cb(la, lo);
    }, function (err) {
      if (err.code === 1) toast('دسترسی به موقعیت رد شد');
      else if (err.code === 2) toast('موقعیت در دسترس نیست');
      else toast('خطا در دریافت موقعیت');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  };

  VXMap.prototype.showMarker = function (lat, lon) {
    this._pin = { lat: lat, lon: lon };
    this.marker.hidden = false;
    this.render();
  };

  /* ---------- کشیدن کاشی‌ها ---------- */
  VXMap.prototype.render = function (force) {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      self._render(force);
    });
  };

  VXMap.prototype._render = function () {
    var self = this;
    var cfg = this.custom || TILE_STYLES[this.style] || TILE_STYLES.std;
    /* حالت تیره با فیلتر روی همان کاشی‌های OSM ساخته می‌شود (سرویس جدا لازم نیست) */
    var isDark = !this.custom && !!(cfg && cfg.dark);
    this.plane.classList.toggle('vxmap-dark', isDark);
    var vw = this.view.clientWidth || 300, vh = this.view.clientHeight || 200;
    var z = Math.round(this.zoom);
    this.z = z;
    var scale = this._scale();

    var cx = lonToX(this.lon, z) * TILE;
    var cy = latToY(this.lat, z) * TILE;
    this._origin = { cx: cx, cy: cy, vw: vw, vh: vh, scale: scale };

    /* صفحهٔ نقشه با زومِ کسری بزرگ/کوچک می‌شود تا حرکت انگشت نرم باشد.
       اندازهٔ plane تقسیم بر scale است تا بعد از scale دقیقاً اندازهٔ نما شود. */
    var pw = vw / scale, ph = vh / scale;
    var t = 'translate(-50%,-50%) scale(' + scale + ')';
    if (this.bearing) t += ' rotate(' + (-this.bearing) + 'deg)';
    if (this.pitch) t += ' rotateX(' + this.pitch + 'deg) scale(' + (1 / Math.cos(this.pitch * Math.PI / 180)) + ')';
    this.plane.style.transform = t;
    this.plane.style.width = pw + 'px';
    this.plane.style.height = ph + 'px';

    var pad = 1;
    var n = Math.pow(2, z);
    var x0 = Math.floor((cx - pw / 2) / TILE) - pad;
    var x1 = Math.floor((cx + pw / 2) / TILE) + pad;
    var y0 = Math.floor((cy - ph / 2) / TILE) - pad;
    var y1 = Math.floor((cy + ph / 2) / TILE) + pad;

    var need = {};
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        var xx = ((x % n) + n) % n;
        var key = z + ':' + xx + ':' + y;
        need[key] = { z: z, x: xx, y: y };
        var left = x * TILE - cx + pw / 2;
        var top = y * TILE - cy + ph / 2;
        var el = this._els[key];
        if (!el) {
          el = document.createElement('img');
          el.className = 'vxmap-tile';
          el.decoding = 'async';
          el.alt = '';
          /* ارسال مبدأ به سرویس کاشی الزامی است (سیاست کاری OSM) */
          el.referrerPolicy = 'origin';
          /* اگر سرویس کاشی خطا داد، خودکار به آینهٔ بعدی می‌رویم تا نقشه
             سفید نماند */
          el.addEventListener('error', function () { self._tileFailed(key); });
          this.plane.appendChild(el);
          this._els[key] = el;
        }
        el.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
        el.style.width = TILE + 'px';
        el.style.height = TILE + 'px';
        if (el.dataset.k !== key || el.dataset.u !== tileUrl(cfg.url, z, xx, y)) {
          el.dataset.k = key;
          el.dataset.u = tileUrl(cfg.url, z, xx, y);
          el.src = el.dataset.u;
        }
      }
    }
    /* حذف کاشی‌های خارج از دید */
    for (var k in this._els) {
      if (!need[k]) { this._els[k].remove(); delete this._els[k]; }
    }

    /* لایهٔ ترافیک اگر پیکربندی شده باشد */
    this._renderOverlay(cfg, z, cx, cy);

    /* نشانگرها */
    this._place(this.marker, this._pin);
    this._place(this.me, this._meLL);
    this._drawBuildings();
    if (this.wantBuildings) this.loadBuildings(false);
    this.cross.hidden = !this.pickMode;
    var at = this.el.querySelector('.vxmap-attrib');
    if (at) at.textContent = this.traffic && this._trafficCfg ? this._trafficCfg.attrib : (this.custom ? this.customAttrib : cfg.attrib || '');
    this.plane.style.setProperty('--vxmap-scale', scale);
  };

  VXMap.prototype._renderOverlay = function (cfg, z, cx, cy) {
    var self = this;
    var ov = this.el.querySelector('.vxmap-ov');
    if (!this.traffic || !this._trafficCfg) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'vxmap-ov';
      this.plane.appendChild(ov);
    }
    var n = Math.pow(2, z);
    var keys = {};
    for (var k in this._els) {
      var p = k.split(':');
      var x = Number(p[1]), y = Number(p[2]);
      var left = Number(this._els[k].style.transform.match(/translate\((-?[\d.]+)px/)[1]);
      var top = Number(this._els[k].style.transform.match(/,\s*(-?[\d.]+)px/)[1]);
      var key = k;
      keys[key] = true;
      var img = ov.querySelector('[data-ov="' + key + '"]');
      if (!img) {
        img = document.createElement('img');
        img.className = 'vxmap-ovtile';
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'origin';
        img.dataset.ov = key;
        ov.appendChild(img);
      }
      var url = tileUrl(this._trafficCfg.url, z, x, y);
      if (img.dataset.u !== url) { img.dataset.u = url; img.src = url; }
      img.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      img.style.width = TILE + 'px';
      img.style.height = TILE + 'px';
    }
    for (var child of Array.from(ov.children)) {
      if (!keys[child.dataset.ov]) child.remove();
    }
  };

  /* گذاشتن نشانگر روی مختصات (مختصات صفحه، نه فضای plane) */
  VXMap.prototype._place = function (el, ll) {
    if (!el) return;
    if (!ll) { el.hidden = true; return; }
    var z = this.z || Math.round(this.zoom);
    var s = this._scale();
    var cx = lonToX(this.lon, z) * TILE, cy = latToY(this.lat, z) * TILE;
    var vw = this.view.clientWidth, vh = this.view.clientHeight;
    /* بردار در فضای plane، بعد به صفحه */
    var px = lonToX(ll.lon, z) * TILE - cx;
    var py = latToY(ll.lat, z) * TILE - cy;
    /* اگر چرخیده/کج است، همان ترنسفور plane را روی بردار بگردان تا دقیقاً بچسبد */
    if (this.bearing) {
      var a = this.bearing * Math.PI / 180;
      var c = Math.cos(a), sn = Math.sin(a);
      var rx = px * c - py * sn, ry = px * sn + py * c;
      px = rx; py = ry;
    }
    if (this.pitch) py *= Math.cos(Math.max(0.01, this.pitch * Math.PI / 180));
    px = px * s + vw / 2;
    py = py * s + vh / 2;
    el.hidden = false;
    el.style.transform = 'translate(' + px + 'px,' + py + 'px)';
  };

  VXMap.prototype.destroy = function () { this._els = {}; this.el.remove(); };
  window.VXMap = VXMap;
  window.VXMAP_TILE_STYLES = TILE_STYLES;

  /* =======================================================================
     ساختمان‌های سه‌بعدی
     پایهٔ ساختمان‌ها از سرور خودمان (/api/map-buildings ⇒ Overpass) گرفته
     می‌شود و روی canvas به‌صورت حجم کشیده می‌شود: هر ضلعی که رو به دوربین
     است پر می‌شود و بالای ساختمان روشن‌تر کشیده می‌شود تا حجم دیده شود.
     ======================================================================= */
  var BLD_MIN_ZOOM = 14;

  VXMap.prototype.loadBuildings = function (force) {
    var self = this;
    if (!this.wantBuildings) return;
    var z = Math.round(this.zoom);
    if (z < BLD_MIN_ZOOM) { this._clearBuildings(); return; }
    var key = this.lat.toFixed(3) + ',' + this.lon.toFixed(3) + ',' + z;
    if (!force && this._bldKey === key) return;
    this._bldKey = key;
    fetch('/api/map-buildings?lat=' + encodeURIComponent(this.lat.toFixed(5))
      + '&lng=' + encodeURIComponent(this.lon.toFixed(5)) + '&zoom=' + z, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { buildings: [] }; })
      .then(function (d) {
        /* اگر کاربر بین درخواست و پاسخ جابه‌جا شده، پاسخ قدیمی نادیده گرفته می‌شود */
        if (self._bldKey !== key) return;
        self.buildings = (d && d.buildings) || [];
        self.buildingsUnavailable = !!(d && d.unavailable);
        if (self.onBuildingsState) self.onBuildingsState(self.buildingsUnavailable ? 'unavailable' : (self.buildings.length ? 'ok' : 'empty'));
        self.render();
      })
      .catch(function () {
        self.buildings = [];
        self.buildingsUnavailable = true;
        if (self.onBuildingsState) self.onBuildingsState('unavailable');
        self.render();
      });
  };

  VXMap.prototype._clearBuildings = function () {
    if (this.bldCv) { this.bldCv.remove(); this.bldCv = null; }
    this.buildings = [];
    this._bldKey = null;
  };

  VXMap.prototype._ensureBldCv = function () {
    if (this.bldCv) return this.bldCv;
    var cv = document.createElement('canvas');
    cv.className = 'vxmap-bld';
    this.view.appendChild(cv);
    this.bldCv = cv;
    return cv;
  };

  /* نقاط lon/lat ⇒ پیکسل روی canvas (با احترام به چرخش و کج‌شدن) */
  VXMap.prototype._llToPx = function (lat, lon) {
    var z = this.z || Math.round(this.zoom);
    var cx = lonToX(this.lon, z) * TILE, cy = latToY(this.lat, z) * TILE;
    var vw = this.view.clientWidth, vh = this.view.clientHeight;
    var px = lonToX(lon, z) * TILE - cx + vw / 2;
    var py = latToY(lat, z) * TILE - cy + vh / 2;
    if (this.bearing || this.pitch) {
      var a = -this.bearing * Math.PI / 180;
      var k = 1 / Math.cos(Math.max(0.01, this.pitch * Math.PI / 180));
      var rx = px * Math.cos(a) - (py / k) * Math.sin(a);
      var ry = px * Math.sin(a) + (py / k) * Math.cos(a);
      px = rx; py = ry * k;
    }
    return [px, py];
  };

  VXMap.prototype._drawBuildings = function () {
    if (!this.wantBuildings || !this.buildings || !this.buildings.length) { if (this.bldCv) this.bldCv.style.display = 'none'; return; }
    var cv = this._ensureBldCv();
    cv.style.display = '';
    var w = this.view.clientWidth, h = this.view.clientHeight;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var pitch = this.pitch * Math.PI / 180;
    var sinP = Math.sin(pitch), cosP = Math.cos(pitch);
    /* مقیاس ارتفاع: هر متر ≈ چند پیکسل (در زوم‌های معمول ~۱.۴ پیکسل) */
    var mPerPx = 156543.03392 * Math.cos(latToYRad(this.lat)) / Math.pow(2, this.z);
    var pxPerM = 1 / Math.max(1e-9, mPerPx);

    var self = this;
    this.buildings.forEach(function (b) {
      if (!b || !b.ring || b.ring.length < 3) return;
      var pts = [];
      for (var i = 0; i < b.ring.length; i++) {
        var p = self._llToPx(b.ring[i][1], b.ring[i][0]);
        if (p[0] < -400 || p[0] > w + 400 || p[1] < -600 || p[1] > h + 400) continue;
        pts.push(p);
      }
      if (pts.length < 3) return;

      /* هر ضلع: از پایین به بالا کشیده می‌شود؛ فقط ضلع‌های رو به بیننده پر می‌شوند */
      var i2, n = pts.length;
      for (i2 = 0; i2 < n; i2++) {
        var a = pts[i2], c = pts[(i2 + 1) % n];
        /* نرمال ضلع برای تشخیص رو‌به‌دوربین بودن */
        var ex = c[0] - a[0], ey = c[1] - a[1];
        /* ضلع‌هایی که به بالای صفحه نگاه می‌کنند (ey<0) دیده می‌شوند */
        if (ey >= 0) continue;
        var hgt = b.h * pxPerM;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(c[0], c[1]);
        g.lineTo(c[0], c[1] - hgt * cosP);
        g.lineTo(a[0], a[1] - hgt * cosP);
        g.closePath();
        var shade = 118 + Math.min(52, Math.round(hgt / 9));
        g.fillStyle = 'rgb(' + shade + ',' + (shade + 4) + ',' + (shade + 10) + ')';
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,.22)';
        g.lineWidth = 0.6;
        g.stroke();
      }
      /* سقف */
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1] - b.h * pxPerM * cosP);
      for (i2 = 1; i2 < n; i2++) g.lineTo(pts[i2][0], pts[i2][1] - b.h * pxPerM * cosP);
      g.closePath();
      g.fillStyle = 'rgba(226,232,240,.80)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 0.8;
      g.stroke();
    });
  };
  function latToYRad(lat) { return lat * Math.PI / 180; }

  /* فعال/غیرفعال کردن ساختمان‌ها (فقط در نمای سه‌بعدی معنا دارد) */
  VXMap.prototype.setBuildings = function (on) {
    this.wantBuildings = !!on;
    this.el.classList.toggle('vxmap-bld-on', !!on);
    if (!on) { this._clearBuildings(); this.render(); return; }
    this.loadBuildings(true);
  };

  /* =======================================================================
     جست‌وجوی نام مکان
   از /api/map-search روی سرور خودمان رد می‌شود، چون CSP سایت
   (connect-src 'self') اجازهٔ اتصال مستقیم به سرویس بیرونی را نمی‌دهد
   و ضمناً محدودیت نرخ Nominatim هم باید سمت سرور رعایت شود.
     ======================================================================= */
  function searchPlace(q) {
    var url = '/api/map-search?q=' + encodeURIComponent(String(q || '').slice(0, 120));
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (d) {
        return ((d && d.results) || []).map(function (a) {
          return { lat: Number(a.lat), lon: Number(a.lon), label: a.label || '' };
        });
      })
      .catch(function () { return []; });
  }

  /* =======================================================================
     پنجرهٔ انتخاب موقعیت روی نقشه
     ======================================================================= */
  function openLocationPicker(opts) {
    opts = opts || {};
    return loadCfg().then(function (cfg) {
      var ov = document.createElement('div');
      ov.className = 'vxmp';
      ov.innerHTML =
        '<div class="vxmp-box">' +
          '<div class="vxmp-top">' +
            '<input class="vxmp-search" type="search" placeholder="جست‌وجوی مکان یا آدرس…" aria-label="جست‌وجوی مکان">' +
            '<button type="button" class="vxmp-x" data-a="close" title="بستن" aria-label="بستن">' + ic('x') + '</button>' +
          '</div>' +
          '<div class="vxmp-res"></div>' +
          '<div class="vxmp-stage"></div>' +
          '<div class="vxmp-side">' +
            '<div class="vxmp-srow">' +
              '<button type="button" class="vxmp-mbtn" data-a="mode2d">۲بعدی</button>' +
              '<button type="button" class="vxmp-mbtn" data-a="mode3d">۳بعدی</button>' +
            '</div>' +
            '<div class="vxmp-srow vxmp-styles"></div>' +
            '<div class="vxmp-srow">' +
              '<button type="button" class="vxmp-mbtn" data-a="bld">ساختمان‌ها</button>' +
              '<button type="button" class="vxmp-mbtn" data-a="traffic">ترافیک</button>' +
              '<button type="button" class="vxmp-mbtn" data-a="rotate">چرخش</button>' +
            '</div>' +
          '</div>' +
          '<div class="vxmp-foot">' +
            '<div class="vxmp-coord"></div>' +
            '<button type="button" class="vxmp-send" data-a="send">' + ic('send') + ' ارسال موقعیت</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      applyIcons(ov);

      var stage = ov.querySelector('.vxmp-stage');
      var map = new VXMap({
        lat: opts.lat != null ? opts.lat : 35.6892,
        lon: opts.lon != null ? opts.lon : 51.3890,
        zoom: opts.zoom || 13,
      });
      if (cfg.tileUrl) {
        map.custom = { url: cfg.tileUrl, max: cfg.maxZoom, attrib: cfg.tileAttrib };
        map.customAttrib = cfg.tileAttrib;
      }
      if (cfg.trafficUrl) map._trafficCfg = { url: cfg.trafficUrl, attrib: 'ترافیک' };
      stage.appendChild(map.el);

      var picked = { lat: map.lat, lon: map.lon, label: '' };
      map.pickMode = true;
      map.cross.hidden = false;
      map.onPick = function (lat, lon) { setPick(lat, lon, ''); };
      setPick(map.lat, map.lon, '');

      function setPick(lat, lon, label) {
        picked.lat = lat; picked.lon = lon;
        if (label) picked.label = label;
        map.setView(lat, lon, map.zoom);
        map.showMarker(lat, lon);
        map.cross.hidden = false;
        ov.querySelector('.vxmp-coord').textContent =
          fmtLat(lat) + ' , ' + fmtLat(lon) + (picked.label ? ' — ' + picked.label : '');
      }

      /* دکمه‌های حالت */
      var b2 = ov.querySelector('[data-a="mode2d"]'), b3 = ov.querySelector('[data-a="mode3d"]');
      var bldBtn = ov.querySelector('[data-a="bld"]');
      function setMode(is3d) {
        map.set3d(is3d, 52);
        b2.classList.toggle('active', !is3d);
        b3.classList.toggle('active', is3d);
        ov.classList.toggle('vxmp-3d', is3d);
        /* ساختمان‌ها فقط در نمای سه‌بعدی */
        bldBtn.classList.toggle('active', !!is3d && !!map.wantBuildings);
        if (!is3d) map.onBuildingsState = null;
      }
      b2.onclick = function () { setMode(false); };
      b3.onclick = function () { setMode(true); };

      /* پس‌زمینه‌ها */
      var sw = ov.querySelector('.vxmp-styles');
      Object.keys(TILE_STYLES).forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'vxmp-sbtn' + (k === 'std' ? ' active' : '');
        b.textContent = TILE_STYLES[k].label;
        b.dataset.k = k;
        b.onclick = function () {
          map.custom = null;
          map.setStyle(k);
          sw.querySelectorAll('.vxmp-sbtn').forEach(function (x) { x.classList.toggle('active', x === b); });
        };
        sw.appendChild(b);
      });
      /* اگر سرویس کاشی مسدود شد یا خطا داد، خودکار آینهٔ بعدی روشن می‌شود */
      map.onTileFallback = function (nextKey) {
        var b2b = sw.querySelector('[data-k="' + nextKey + '"]');
        if (b2b) sw.querySelectorAll('.vxmp-sbtn').forEach(function (x) { x.classList.toggle('active', x === b2b); });
        toast('سرویس نقشهٔ قبلی پاسخ نداد؛ آینهٔ ' + (TILE_STYLES[nextKey] ? TILE_STYLES[nextKey].label : '') + ' روشن شد');
      };

      /* ترافیک */
      /* ساختمان‌ها */
      bldBtn.onclick = function () {
        if (map.pitch < 1) { toast('اول نمای سه‌بعدی را روشن کن'); return; }
        var on = !map.wantBuildings;
        map.onBuildingsState = function (st) {
          if (st === 'unavailable') { bldBtn.classList.remove('active'); toast('سرویس دادهٔ ساختمان در دسترس نیست'); }
          else if (st === 'empty') { toast('برای این ناحیه دادهٔ ساختمان ثبت نشده است'); }
        };
        map.setBuildings(on);
        bldBtn.classList.toggle('active', on);
        if (on) toast('در حال آوردن ساختمان‌ها…');
      };
      var tb = ov.querySelector('[data-a="traffic"]');
      if (!cfg.trafficUrl) {
        tb.disabled = true;
        tb.title = 'برای نمایش ترافیک باید آدرس کاشی ترافیک روی سرور تنظیم شود (VX_TRAFFIC_URL)';
      }
      tb.onclick = function () {
        if (!cfg.trafficUrl) return;
        map.traffic = !map.traffic;
        tb.classList.toggle('active', map.traffic);
        map.render();
        toast(map.traffic ? 'لایهٔ ترافیک روشن شد' : 'لایهٔ ترافیک خاموش شد');
      };

      ov.querySelector('[data-a="rotate"]').onclick = function () { map.rotateBy(45); };

      /* جست‌وجو */
      var inp = ov.querySelector('.vxmp-search');
      var res = ov.querySelector('.vxmp-res');
      var tmr = 0;
      inp.addEventListener('input', function () {
        clearTimeout(tmr);
        var v = inp.value.trim();
        if (v.length < 2) { res.innerHTML = ''; return; }
        tmr = setTimeout(function () {
          searchPlace(v).then(function (list) {
            if (!list.length) { res.innerHTML = '<div class="vxmp-resx">نتیجه‌ای پیدا نشد</div>'; return; }
            res.innerHTML = '';
            list.forEach(function (r) {
              var b = document.createElement('button');
              b.type = 'button';
              b.className = 'vxmp-resi';
              b.innerHTML = '<b>' + esc(r.label.split(',')[0]) + '</b><span>' + esc(r.label) + '</span>';
              b.onclick = function () {
                res.innerHTML = '';
                inp.value = r.label.split(',')[0];
                map.setView(r.lat, r.lon, Math.max(map.zoom, 15));
                setPick(r.lat, r.lon, r.label);
              };
              res.appendChild(b);
            });
          });
        }, 380);
      });

      /* موقعیت فعلی */
      stage.querySelector('.vxmap-cbtn[data-m="locate"]').addEventListener('click', function () {
        map.locate(function (la, lo) { setPick(la, lo, 'موقعیت فعلی من'); });
      });

      /* بستن و ارسال */
      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        map.destroy();
        ov.remove();
        vxOverlayClose();
      }
      ov._vxClose = close;
      ov.close = close;
      ov.querySelector('[data-a="close"]').onclick = close;
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      ov.querySelector('[data-a="send"]').onclick = function () {
        var out = { lat: picked.lat, lon: picked.lon, label: picked.label || '' };
        close();
        if (opts.onPick) opts.onPick(out);
      };

      vxOverlayOpen();
      /* اگر مختصات اولیه داده شده بود، همان را نشان بده؛ وگرنه موقعیت کاربر */
      if (opts.lat != null && opts.lon != null) setPick(opts.lat, opts.lon, opts.label || '');
      else map.locate(function () {});
      setTimeout(function () { inp.focus(); }, 80);
      return { close: close, map: map };
    });
  }

  /* =======================================================================
     کارت موقعیت داخل پیام + باز کردن در اپ‌های نقشه
     ======================================================================= */
  var MAP_APPS = [
    { k: 'neshan', label: 'نشان', hint: 'نشان (ایرانی)', build: function (ll, mode) {
        var base = mode === 'nav'
          ? 'https://neshan.org/directions?destination=' + ll.lat + ',' + ll.lon
          : 'https://neshan.org/?lat=' + ll.lat + '&lng=' + ll.lon;
        return { url: base, android: 'https://play.google.com/store/apps/details?id=' + encodeURIComponent('com.neshan'), ios: 'https://apps.apple.com/app/neshan/id1459271588' };
      } },
    { k: 'google', label: 'گوگل‌مپ', hint: 'Google Maps', build: function (ll, mode) {
        var base = mode === 'nav'
          ? 'https://www.google.com/maps/dir/?api=1&destination=' + ll.lat + ',' + ll.lon
          : 'https://www.google.com/maps/search/?api=1&query=' + ll.lat + ',' + ll.lon;
        return { url: base, android: 'https://play.google.com/store/apps/details?id=com.google.android.apps.maps', ios: 'https://apps.apple.com/app/google-maps/id585027354' };
      } },
    { k: 'waze', label: 'ویز', hint: 'Waze', build: function (ll) {
        return { url: 'https://waze.com/ul?ll=' + ll.lat + ',' + ll.lon + '&navigate=yes', android: 'https://play.google.com/store/apps/details?id=com.waze', ios: 'https://apps.apple.com/app/waze/id404950997' };
      } },
    { k: 'osm', label: 'اپ‌فید', hint: 'OpenStreetMap', build: function (ll) {
        return { url: 'https://uri.openstreetmap.org/?mlat=' + ll.lat + '&mlon=' + ll.lon + '#map=16/' + ll.lat + '/' + ll.lon };
      } },
  ];

  /* باز کردن اپ؛ اول تلاش اپ نصب‌شده، بعد مرورگر */
  function openInApp(app, ll, mode) {
    var built = app.build(ll, mode);
    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    var deep = isIOS ? built.ios : built.android;
    var fallback = function () { window.open(built.url, '_blank', 'noopener'); };
    if (deep) {
      var t = Date.now();
      var hidden = false;
      var onHide = function () { hidden = true; };
      document.addEventListener('visibilitychange', onHide, { once: true });
      window.location.href = deep;
      setTimeout(function () {
        document.removeEventListener('visibilitychange', onHide);
        if (!hidden && Date.now() - t < 2500) fallback();
      }, 1200);
    } else fallback();
  }

  function toFin(v) { var n = Number(v); return isFinite(n) ? n : null; }
  /* باز کردن نقشهٔ Google: destination از مختصات، و اگر نبود از آدرس (label) */
  function googleDirectionsUrl(lat, lng, label) {
    var la = toFin(lat), ln = toFin(lng);
    if (la !== null && ln !== null && la >= -90 && la <= 90 && ln >= -180 && ln <= 180)
      return 'https://www.google.com/maps/dir/?api=1&origin=&destination=' + la + ',' + ln;
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(String(label || '').trim());
  }
  function googleViewUrl(lat, lng, label) {
    var la = toFin(lat), ln = toFin(lng);
    if (la !== null && ln !== null && la >= -90 && la <= 90 && ln >= -180 && ln <= 180)
      return 'https://www.google.com/maps/search/?api=1&query=' + la + ',' + ln;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(label || '').trim());
  }
  function openUrl(url) {
    try { window.open(url, '_blank', 'noopener'); } catch (e) { window.location.href = url; }
  }
  /* «مسیریابی»: Google Maps در desktop مرورگر، و روی موبایل اول اپِ Google Maps
     (چون همون لینک در اندروید/آی‌او‌اس اپ را باز می‌کند و در غیابش مرورگر می‌رود). */
  function openDirections(lat, lng, label) {
    var url = googleDirectionsUrl(lat, lng, label);
    openUrl(url);
  }
  function openMapsView(which, lat, lng, label) {
    var la = toFin(lat), ln = toFin(lng);
    if (which === 'neshan' && la !== null && ln !== null) openUrl('https://neshan.org/?lat=' + la + '&lng=' + ln);
    else if (which === 'google') openUrl(googleViewUrl(lat, lng, label));
    else if (which === 'waze' && la !== null && ln !== null) openUrl('https://waze.com/ul?ll=' + la + ',' + ln + '&navigate=yes');
    else openUrl(googleViewUrl(lat, lng, label));
  }

  /* برگهٔ «باز کردن با…» — نشان (ایرانی) اول از همه */
  function openMapApps(lat, lon, label) {
    var ov = document.createElement('div');
    ov.className = 'vxmap-sheet-wrap';
    var ll = { lat: lat, lon: lon };
    var html = '<div class="vxmap-sheet">';
    html += '<div class="vxmap-sheet-h"><b>موقعیت</b><span>' + esc(label || (fmtLat(lat) + ' , ' + fmtLat(lon))) + '</span></div>';
    html += '<div class="vxmap-apps">';
    MAP_APPS.forEach(function (a) {
      html += '<button type="button" class="vxmap-app" data-k="' + a.k + '" data-m="view">'
        + '<span class="vxmap-appic ' + a.k + '">' + ic(a.k === 'neshan' ? 'map-pin' : a.k === 'osm' ? 'globe' : 'navigation') + '</span>'
        + '<b>' + a.label + '</b><small>' + esc(a.hint) + '</small></button>';
    });
    html += '</div>';
    html += '<div class="vxmap-navrow"><button type="button" class="vxmap-nav" data-m="nav">' + ic('navigation') + ' شروع مسیریابی</button></div>';
    html += '</div>';
    ov.innerHTML = html;
    document.body.appendChild(ov);
    applyIcons(ov);
    vxOverlayOpen();

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      ov.remove();
      vxOverlayClose();
    }
    ov._vxClose = close;
    ov.close = close;
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('.vxmap-app, .vxmap-nav');
      if (b) {
        var mode = b.dataset.m === 'nav' ? 'nav' : 'view';
        if (mode === 'nav') { openDirections(ll.lat, ll.lon, label); close(); return; }
        var app = MAP_APPS.find(function (a) { return a.k === b.dataset.k; }) || MAP_APPS[0];
        openInApp(app, ll, 'view');
        close();
        return;
      }
      if (e.target === ov) close();
    });
    return { close: close };
  }

  /* کارت موقعیت برای نمایش داخل حباب پیام */
  /* عددِ معتبر در بازهٔ جغرافیایی؛ چون بعضی مرورگرها/محیط‌ها Number.isFinite
     را دستکاری می‌کنند، از بررسی نوعِ خودِ مقدار استفاده می‌کنیم (typeof). */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toLL(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '') { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
    return NaN;
  }
  function locationCard(m) {
    var wrap = document.createElement('div');
    wrap.className = 'vxloc';
    var g = m.geo || null;
    var lat = toLL(g && g.lat), lng = toLL(g && g.lng);
    if (!isNum(lat) || !isNum(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      wrap.textContent = 'موقعیت نامعتبر';
      return wrap;
    }
    var label = (m.geo && m.geo.label) || m.content || (fmtLat(lat) + ' , ' + fmtLat(lng));
    var stage = document.createElement('div');
    stage.className = 'vxloc-map';
    var info = document.createElement('div');
    info.className = 'vxloc-info';
    info.innerHTML = '<b>' + esc(label) + '</b><small>' + fmtLat(lat) + ' , ' + fmtLat(lng) + '</small>';
    var acts = document.createElement('div');
    acts.className = 'vxloc-acts';
    acts.innerHTML =
      '<button type="button" class="vxloc-b primary" data-a="neshan">' + ic('map-pin') + ' نشان</button>' +
      '<button type="button" class="vxloc-b" data-a="google">' + ic('globe') + ' گوگل‌مپ</button>' +
      '<button type="button" class="vxloc-b" data-a="nav">' + ic('navigation') + ' مسیریابی</button>';
    wrap.appendChild(stage); wrap.appendChild(info); wrap.appendChild(acts);
    applyIcons(wrap);

    /* پیش‌نمایش نقشه: چند کاشی، ساخته‌شده با موتور خودمان */
    var mini = new VXMap({ lat: lat, lon: lng, zoom: 14, interactive: false, className: 'vxloc-mini' });
    stage.appendChild(mini.el);

    function apps(mode) { openMapApps(lat, lng, label); }
    acts.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      e.stopPropagation();
      /* دکمه‌های کارت مستقیم اجرا می‌شوند؛ ورقِ انتخاب از tap روی خودِ نقشهٔ کوچک باز می‌شود */
      if (b.dataset.a === 'nav') openDirections(lat, lng, label);
      else if (b.dataset.a === 'google') openMapsView('google', lat, lng, label);
      else if (b.dataset.a === 'neshan') openMapsView('neshan', lat, lng, label);
    });
    stage.addEventListener('click', function (e) { e.stopPropagation(); openMapApps(lat, lng, label); });
    return wrap;
  }

  window.VXMapOpenPicker = openLocationPicker;
  window.VXMapOpenApps = openMapApps;
  window.VXMapLocationCard = locationCard;
  window.VXMapSearchPlace = searchPlace;
  window.VXMapDirections = openDirections;
})();