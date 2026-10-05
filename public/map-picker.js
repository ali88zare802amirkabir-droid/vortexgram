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
  var TILE_STYLES = {
    std: { label: 'استاندارد', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, dark: false },
    light: { label: 'روشن', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', max: 19, dark: false },
    dark: { label: 'تیره', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', max: 19, dark: true },
    topo: { label: 'توپوگرافی', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, dark: false },
    sat: { label: 'ماهواره‌ای', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, dark: true },
  };
  var SUB = ['a', 'b', 'c'];

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
        '<div class="vxmap-marker" hidden><span class="vxmap-pin"></span></div>' +
        '<div class="vxmap-cross" hidden></div>' +
        '<div class="vxmap-me" hidden><i data-lucide="crosshair" class="icon"></i></div>' +
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
      view.setPointerCapture(e.pointerId);
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

  /* جابه‌جایی نقشه به اندازهٔ پیکسل روی صفحه */
  VXMap.prototype._panBy = function (dx, dy) {
    var cx = lonToX(this.lon, this.zoom) * TILE - this._cx();
    var cy = latToY(this.lat, this.zoom) * TILE - this._cy();
    var nx = cx + dx, ny = cy + dy;
    this.lon = xToLon(nx / TILE, this.zoom);
    this.lat = clampLat(yToLat(ny / TILE, this.zoom));
    this.render();
  };

  VXMap.prototype._cx = function () { return this.view.clientWidth / 2; };
  VXMap.prototype._cy = function () { return this.view.clientHeight / 2; };

  /* مختصات نقطهٔ دلخواه در صفحه ⇒ lon/lat (برای زوم روی نقطه و انتخاب نقطه) */
  VXMap.prototype._lonAt = function (px, py) {
    var vw = this.view.clientWidth, vh = this.view.clientHeight;
    var cx = lonToX(this.lon, this.zoom) * TILE;
    var cy = latToY(this.lat, this.zoom) * TILE;
    /* در حالت چرخیده/کج‌شده باید برعکسِ ترنسفور روی بردار حرکت اعمال شود */
    var dx = px - vw / 2, dy = py - vh / 2;
    if (this.bearing || this.pitch) dx = this._invertVec(dx, dy);
    return { lon: xToLon((cx + dx) / TILE, this.zoom), lat: clampLat(yToLat((cy + dy) / TILE, this.zoom)) };
  };

  /* بردار صفحه را به فضای نقشه برمی‌گرداند (چون صفحه کج/چرخیده است) */
  VXMap.prototype._invertVec = function (dx, dy) {
    var a = -this.bearing * Math.PI / 180, p = this.pitch * Math.PI / 180;
    var x = dx, y = dy / Math.cos(Math.max(0.01, p));
    var c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  };

  VXMap.prototype.zoomBy = function (d) { this.zoomTo(this.zoom + d, this._cx(), this._cy()); };
  VXMap.prototype.zoomTo = function (z, px, py) {
    if (px == null) { px = this._cx(); py = this._cy(); }
    var cfg = this.cfg || TILE_STYLES[this.style] || TILE_STYLES.std;
    var max = this.custom ? (cfg.max || 19) : ((TILE_STYLES[this.style] || TILE_STYLES.std).max || 19);
    var nz = Math.max(2, Math.min(max, z));
    var anchor = this._lonAt(px, py);
    this.zoom = nz;
    this.lat = anchor.lat; this.lon = anchor.lon;
    /* بعد از تغییر زوم، مرکز را روی همان نقطه برمی‌گردانیم */
    var t = this._pointAt(px, py);
    this.lat = clampLat(this.lat + (anchor.lat - t.lat));
    this.lon = this.lon + (anchor.lon - t.lon);
    this.render();
  };
  VXMap.prototype._pointAt = function (px, py) {
    return this._lonAt(px, py);
  };

  VXMap.prototype.setView = function (lat, lon, zoom) {
    this.lat = clampLat(lat); this.lon = lon;
    if (zoom) this.zoom = zoom;
    this.render();
  };
  VXMap.prototype.setStyle = function (k) {
    if (!TILE_STYLES[k]) return;
    this.style = k;
    this._tiles = {}; this._els = {};
    this.plane.innerHTML = '';
    this.render();
  };
  VXMap.prototype.set3d = function (on, pitch) {
    this.pitch = on ? (pitch == null ? 52 : pitch) : 0;
    this.el.classList.toggle('vxmap-3d', !!on);
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
    var cfg = this.custom || TILE_STYLES[this.style] || TILE_STYLES.std;
    var vw = this.view.clientWidth || 300, vh = this.view.clientHeight || 200;
    var z = Math.round(this.zoom);
    this.z = z;
    var scale = Math.pow(2, this.zoom - z);

    var cx = lonToX(this.lon, z) * TILE;
    var cy = latToY(this.lat, z) * TILE;
    this._origin = { cx: cx, cy: cy, vw: vw, vh: vh };

    /* چرخش و کج‌شدن صفحه (نمای سه‌بعدی) */
    var t = 'translate(-50%,-50%)';
    if (this.bearing) t += ' rotate(' + (-this.bearing) + 'deg)';
    if (this.pitch) t += ' rotateX(' + this.pitch + 'deg) scale(' + (1 / Math.cos(this.pitch * Math.PI / 180)) + ')';
    this.plane.style.transform = t;
    this.plane.style.width = vw + 'px';
    this.plane.style.height = vh + 'px';

    var pad = 1;
    var n = Math.pow(2, z);
    var x0 = Math.floor((cx - vw / 2) / TILE) - pad;
    var x1 = Math.floor((cx + vw / 2) / TILE) + pad;
    var y0 = Math.floor((cy - vh / 2) / TILE) - pad;
    var y1 = Math.floor((cy + vh / 2) / TILE) + pad;

    var need = {};
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        var xx = ((x % n) + n) % n;
        var key = z + ':' + xx + ':' + y;
        need[key] = { z: z, x: xx, y: y };
        var left = x * TILE - cx + vw / 2;
        var top = y * TILE - cy + vh / 2;
        var el = this._els[key];
        if (!el) {
          el = document.createElement('img');
          el.className = 'vxmap-tile';
          el.decoding = 'async';
          el.alt = '';
          el.referrerPolicy = 'no-referrer';
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
        img.referrerPolicy = 'no-referrer';
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

  /* گذاشتن نشانگر روی مختصات */
  VXMap.prototype._place = function (el, ll) {
    if (!el) return;
    if (!ll) { el.hidden = true; return; }
    var z = this.z || Math.round(this.zoom);
    var cx = lonToX(this.lon, z) * TILE, cy = latToY(this.lat, z) * TILE;
    var vw = this.view.clientWidth, vh = this.view.clientHeight;
    var px = lonToX(ll.lon, z) * TILE - cx + vw / 2;
    var py = latToY(ll.lat, z) * TILE - cy + vh / 2;
    /* در حالت کج/چرخیده، نقطه را در صفحه می‌چرخانیم */
    if (this.bearing || this.pitch) {
      var a = -this.bearing * Math.PI / 180;
      var k = 1 / Math.cos(Math.max(0.01, this.pitch * Math.PI / 180));
      var rx = px * Math.cos(a) - (py / k) * Math.sin(a);
      var ry = px * Math.sin(a) + (py / k) * Math.cos(a);
      px = rx; py = ry * k;
    }
    el.hidden = false;
    el.style.transform = 'translate(' + px + 'px,' + py + 'px)';
  };

  VXMap.prototype.destroy = function () { this._els = {}; this.el.remove(); };
  window.VXMap = VXMap;
  window.VXMAP_TILE_STYLES = TILE_STYLES;

  /* =======================================================================
     جست‌وجوی نام مکان
     ======================================================================= */
  function searchPlace(q) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=fa&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        return (arr || []).map(function (a) {
          return { lat: Number(a.lat), lon: Number(a.lon), label: a.display_name || q };
        }).filter(function (a) { return Number.isFinite(a.lat) && Number.isFinite(a.lon); });
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
      function setMode(is3d) {
        map.set3d(is3d, 52);
        b2.classList.toggle('active', !is3d);
        b3.classList.toggle('active', is3d);
        ov.classList.toggle('vxmp-3d', is3d);
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

      /* ترافیک */
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
        var app = MAP_APPS.find(function (a) { return a.k === b.dataset.k; }) || MAP_APPS[0];
        openInApp(app, ll, mode);
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
      apps(b.dataset.a === 'nav' ? 'nav' : 'view');
    });
    stage.addEventListener('click', function (e) { e.stopPropagation(); apps('view'); });
    return wrap;
  }

  window.VXMapOpenPicker = openLocationPicker;
  window.VXMapOpenApps = openMapApps;
  window.VXMapLocationCard = locationCard;
  window.VXMapSearchPlace = searchPlace;
})();