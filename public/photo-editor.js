/* =========================================================================
   ویرایشگر عکس — نقاشی با قلم‌های مختلف، سانسور با قلم (تار کردن ناحیهٔ
   کشیده‌شده)، و برش کشیدنی مستقیم روی تصویر.

   ساختار لایه‌ها:
     base   = عکس اصلی (تغییرنکرده)
     ink    = نقاشی‌های کاربر
     mask   = ناحیه‌هایی که با قلم سانسور رنگ شده (سفید)
     blurF  = نسخهٔ تارشدهٔ کل عکس (یک‌بار ساخته می‌شود)
     bc     = خروجی ترکیبی = base + ink + ناحیه‌های تار
   ========================================================================= */
const PE_TOOLS = [
  { id: 'pen',    label: 'مداد',    icon: 'pencil',     w: 1.0,  alpha: 1,    composite: 'source-over' },
  { id: 'marker', label: 'ماژیک',   icon: 'pen-tool',   w: 1.7,  alpha: 0.95, composite: 'source-over' },
  { id: 'brush',  label: 'قلم‌مو',   icon: 'paintbrush', w: 2.6,  alpha: 1,    composite: 'source-over' },
  { id: 'neon',   label: 'نئون',    icon: 'sparkles',   w: 1.5,  alpha: 1,    composite: 'lighter' },
  { id: 'hilite', label: 'هایلایت', icon: 'highlighter',w: 3.2,  alpha: 0.45, composite: 'source-over' },
  { id: 'censor', label: 'سانسور',  icon: 'eye-off',    w: 3.0,  alpha: 1,    composite: 'mask' },
  { id: 'eraser', label: 'پاک‌کن',  icon: 'eraser',     w: 3.0,  alpha: 1,    composite: 'erase' },
];
const PE_COLORS = ['#ffffff', '#000000', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#00bcd4', '#ff6f91'];

function peC(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
function peHasPaint(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
  } catch (e) {}
  return false;
}
function peHasAlpha(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch (e) {}
  return false;
}

function openPhotoEditor(file, onDone, opts = {}) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
    /* برای روان بودن نقاشی، بوم ویرایش محدود می‌شود؛ کیفیت برای چت کافی است. */
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(natW, natH));
    const W = Math.max(1, Math.round(natW * scale)), H = Math.max(1, Math.round(natH * scale));

    const base = peC(W, H), bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(img, 0, 0, W, H);
    const hasAlphaSrc = peHasAlpha(bctx, W, H);

    const ink = peC(W, H), ictx = ink.getContext('2d');
    const mask = peC(W, H), mctx = mask.getContext('2d');
    const blurF = peC(W, H), fctx = blurF.getContext('2d');
    fctx.filter = 'blur(' + Math.max(5, Math.min(W, H) * 0.022).toFixed(1) + 'px) saturate(1.15)';
    fctx.drawImage(base, 0, 0);
    fctx.filter = 'none';
    const mb = peC(W, H), mbx = mb.getContext('2d');
    const bc = peC(W, H), bcx = bc.getContext('2d');

    let tool = 'pen', color = '#e53935';
    let size = Math.max(8, Math.round(Math.min(W, H) * 0.03));
    let mode = opts.startInCrop ? 'crop' : 'draw';
    /* برش به‌صورت نسبت نگه داشته می‌شود: ۰ تا ۱ */
    let cl = 0, ct = 0, cr = 0, cb = 0;
    const undo = [];

    const m = document.createElement('div');
    m.className = 'modal-ov';
    m.innerHTML = '<div class="modal pe-modal">'
      + '<h3 class="modal-title">' + ic('image') + ' ویرایش عکس</h3>'
      /* نوار حالت: همیشه دیده می‌شود، نه داخل منوی کشویی */
      + '<div class="pe-modes">'
      +   '<button type="button" class="pe-mode" data-m="draw">' + ic('paintbrush') + ' نقاشی و سانسور</button>'
      +   '<button type="button" class="pe-mode" data-m="crop">' + ic('crop') + ' برش عکس</button>'
      + '</div>'
      + '<div class="pe-stage" id="pe-stage">'
      +   '<div class="pe-wrap" id="pe-wrap">'
      +     '<canvas id="pe-canvas"></canvas>'
      +     '<div class="pe-crop" id="pe-crop"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div>'
      +   '</div>'
      + '</div>'
      /* ابزارهای نقاشی */
      + '<div class="pe-tools" id="pe-tools"></div>'
      + '<div class="pe-colors" id="pe-colors"></div>'
      + '<div class="pe-slider-row">'
      +   '<span class="pe-lbl">اندازهٔ قلم</span>'
      +   '<input type="range" id="pe-size" min="6" max="140" value="' + size + '">'
      +   '<span class="pe-val" id="pe-size-val"></span>'
      + '</div>'
      + '<div class="pe-status" id="pe-status"></div>'
      + '<div class="modal-actions">'
      +   '<button class="btn ghost" id="pe-cancel">' + ic('x') + ' انصراف</button>'
      +   '<button class="btn ghost" id="pe-undo">' + ic('undo-2') + ' واگرد</button>'
      +   '<button class="btn ghost" id="pe-reset">' + ic('rotate-ccw') + ' بازنشانی</button>'
      +   '<button class="btn primary" id="pe-ok">' + ic('check') + ' ارسال</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(m);
    applyIcons(m);

    const wrap = m.querySelector('#pe-wrap');
    const cv = m.querySelector('#pe-canvas');
    const ctx = cv.getContext('2d');
    const cropEl = m.querySelector('#pe-crop');
    const statusEl = m.querySelector('#pe-status');
    cv.width = W; cv.height = H;

    function say(t) { statusEl.textContent = t || ''; }

    /* ---------- ترکیب لایه‌ها ---------- */
    function composite() {
      bcx.clearRect(0, 0, W, H);
      bcx.drawImage(base, 0, 0);
      bcx.drawImage(ink, 0, 0);
      /* ناحیه‌های سانسورشده: نسخهٔ تار، فقط جای mask */
      mbx.clearRect(0, 0, W, H);
      mbx.drawImage(blurF, 0, 0);
      mbx.globalCompositeOperation = 'destination-in';
      mbx.drawImage(mask, 0, 0);
      mbx.globalCompositeOperation = 'source-over';
      bcx.drawImage(mb, 0, 0);
    }
    let raf = 0;
    function paint() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        composite();
        if (mode === 'crop') { ctx.clearRect(0, 0, W, H); ctx.drawImage(bc, 0, 0); dimOutside(); }
        else { ctx.clearRect(0, 0, W, H); ctx.drawImage(bc, 0, 0); }
      });
    }
    function dimOutside() {
      const x = cl * W, y = ct * H, w = Math.max(0, W * (1 - cl - cr)), h = Math.max(0, H * (1 - ct - cb));
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
      ctx.restore();
    }

    /* ---------- نوار حالت ---------- */
    const modeBtns = [...m.querySelectorAll('.pe-mode')];
    function setMode(nm) {
      mode = nm;
      modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.m === nm));
      cropEl.classList.toggle('on', nm === 'crop');
      m.querySelector('#pe-tools').style.opacity = nm === 'crop' ? '.4' : '1';
      m.querySelector('#pe-tools').style.pointerEvents = nm === 'crop' ? 'none' : '';
      m.querySelector('#pe-colors').style.opacity = nm === 'crop' ? '.4' : '1';
      cv.style.cursor = nm === 'crop' ? 'crosshair' : 'crosshair';
      if (nm === 'crop') say('روی عکس بکشید تا ناحیهٔ برش مشخص شود؛ گوشه‌ها را برای تغییر اندازه بکشید');
      else say('');
      paint();
    }
    modeBtns.forEach((b) => { b.onclick = () => setMode(b.dataset.m); });

    /* ---------- ابزارها ---------- */
    const toolsEl = m.querySelector('#pe-tools');
    PE_TOOLS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pe-tool' + (t.id === tool ? ' active' : '');
      b.title = t.label;
      b.innerHTML = '<i data-lucide="' + t.icon + '" class="icon"></i><span>' + t.label + '</span>';
      b.onclick = () => {
        tool = t.id;
        toolsEl.querySelectorAll('.pe-tool').forEach((x) => x.classList.toggle('active', x === b));
        if (t.id === 'censor') say('روی بخش موردنظر بکشید تا تار شود');
      };
      toolsEl.appendChild(b);
    });
    const colorsEl = m.querySelector('#pe-colors');
    PE_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pe-color' + (i === 2 ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => { color = c; colorsEl.querySelectorAll('.pe-color').forEach((x) => x.classList.toggle('active', x === b)); };
      colorsEl.appendChild(b);
    });
    const sizeIn = m.querySelector('#pe-size'), sizeVal = m.querySelector('#pe-size-val');
    const setSize = () => { size = Math.max(6, Math.min(140, Number(sizeIn.value) || 6)); sizeVal.textContent = size + 'px'; };
    sizeIn.addEventListener('input', setSize); setSize();

    /* ---------- واگرد ---------- */
    function pushUndo() {
      undo.push({ i: ictx.getImageData(0, 0, W, H), m: mctx.getImageData(0, 0, W, H) });
      if (undo.length > 10) undo.shift();
    }
    m.querySelector('#pe-undo').onclick = () => {
      const u = undo.pop();
      if (!u) { toast('چیزی برای واگرد نیست'); return; }
      ictx.putImageData(u.i, 0, 0);
      mctx.putImageData(u.m, 0, 0);
      paint();
    };
    m.querySelector('#pe-reset').onclick = () => {
      ictx.clearRect(0, 0, W, H);
      mctx.clearRect(0, 0, W, H);
      undo.length = 0;
      cl = ct = cr = cb = 0;
      paint();
    };

    /* ---------- مختصات ---------- */
    function toLocal(e) {
      const r = cv.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      return {
        x: Math.max(0, Math.min(W, (p.clientX - r.left) * (W / r.width))),
        y: Math.max(0, Math.min(H, (p.clientY - r.top) * (H / r.height))),
      };
    }
    const tdef = () => PE_TOOLS.find((t) => t.id === tool) || PE_TOOLS[0];

    /* ---------- قلم سنسور: مثل قلم‌مو کشیده می‌شود و ناحیه را تار می‌کند ---------- */
    function stroke(x0, y0, x1, y1) {
      const t = tdef();
      if (t.composite === 'erase') {
        ictx.globalCompositeOperation = 'destination-out';
        mctx.globalCompositeOperation = 'destination-out';
        for (const c of [ictx, mctx]) {
          c.strokeStyle = '#000'; c.fillStyle = '#000';
          c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = size * t.w;
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
          c.globalCompositeOperation = 'source-over';
        }
        return;
      }
      if (t.composite === 'mask') {
        /* ناحیهٔ سانسور در mask رنگ می‌شود؛ خودِ تاری در composite انجام می‌گیرد */
        mctx.globalCompositeOperation = 'source-over';
        mctx.strokeStyle = '#fff'; mctx.fillStyle = '#fff';
        mctx.lineCap = 'round'; mctx.lineJoin = 'round';
        mctx.lineWidth = size * t.w;
        mctx.beginPath(); mctx.moveTo(x0, y0); mctx.lineTo(x1, y1); mctx.stroke();
        /* لبهٔ نرم تا مرز تاری تیز نباشد */
        mctx.globalAlpha = 0.35;
        mctx.lineWidth = size * t.w * 1.5;
        mctx.beginPath(); mctx.moveTo(x0, y0); mctx.lineTo(x1, y1); mctx.stroke();
        mctx.globalAlpha = 1;
        return;
      }
      ictx.globalCompositeOperation = t.composite;
      ictx.globalAlpha = t.alpha;
      ictx.strokeStyle = color; ictx.fillStyle = color;
      ictx.lineCap = 'round'; ictx.lineJoin = 'round';
      ictx.lineWidth = size * t.w;
      ictx.beginPath(); ictx.moveTo(x0, y0); ictx.lineTo(x1, y1); ictx.stroke();
      if (t.id === 'neon') { ictx.shadowColor = color; ictx.shadowBlur = size * 2; ictx.stroke(); ictx.shadowBlur = 0; }
      ictx.globalAlpha = 1;
      ictx.globalCompositeOperation = 'source-over';
    }

    /* ---------- اشاره‌گر: نقاشی ---------- */
    let drawing = false, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (mode !== 'draw' || !e.isPrimary) return;
      e.preventDefault();
      pushUndo();
      drawing = true;
      const p = toLocal(e);
      lx = p.x; ly = p.y;
      stroke(lx, ly, lx + 0.01, ly);
      paint();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = toLocal(e);
      stroke(lx, ly, p.x, p.y);
      lx = p.x; ly = p.y;
      paint();
    });
    const endDraw = () => { if (drawing) { drawing = false; compositeNow(); } };
    cv.addEventListener('pointerup', endDraw);
    cv.addEventListener('pointercancel', endDraw);
    cv.addEventListener('pointerleave', endDraw);
    function compositeNow() { composite(); ctx.clearRect(0, 0, W, H); ctx.drawImage(bc, 0, 0); if (mode === 'crop') dimOutside(); }

    /* ---------- برش کشیدنی مستقیم روی تصویر ---------- */
    let drag = null;
    function normRect(a, b2) {
      let x1 = Math.min(a.x, b2.x), y1 = Math.min(a.y, b2.y);
      let x2 = Math.max(a.x, b2.x), y2 = Math.max(a.y, b2.y);
      const MIN = 0.06;
      if ((x2 - x1) / W < MIN) { const c = x1; x1 = Math.max(0, c - W * MIN / 2); x2 = Math.min(W, x1 + W * MIN); }
      if ((y2 - y1) / H < MIN) { const c = y1; y1 = Math.max(0, c - H * MIN / 2); y2 = Math.min(H, y1 + H * MIN); }
      return { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H };
    }
    function applyRect(r) {
      cl = r.x1; ct = r.y1; cr = 1 - r.x2; cb = 1 - r.y2;
      cropEl.style.left = (r.x1 * 100) + '%';
      cropEl.style.top = (r.y1 * 100) + '%';
      cropEl.style.right = ((1 - r.x2) * 100) + '%';
      cropEl.style.bottom = ((1 - r.y2) * 100) + '%';
      const wpx = Math.round(W * (r.x2 - r.x1)), hpx = Math.round(H * (r.y2 - r.y1));
      say('ناحیهٔ برش: ' + wpx + '×' + hpx + ' پیکسل');
      paint();
    }
    const curRect = () => ({ x1: cl, y1: ct, x2: 1 - cr, y2: 1 - cb });
    cv.addEventListener('pointerdown', (e) => {
      if (mode !== 'crop' || !e.isPrimary) return;
      e.preventDefault();
      const p = toLocal(e);
      const rx = p.x / W, ry = p.y / H;
      const r = curRect();
      const near = (hx, hy, vx, vy) => Math.abs(hx - vx) < 0.05 && Math.abs(hy - vy) < 0.05;
      let handle = null;
      if (near(r.x1, r.y1, rx, ry)) handle = 'nw';
      else if (near(r.x2, r.y1, rx, ry)) handle = 'ne';
      else if (near(r.x1, r.y2, rx, ry)) handle = 'sw';
      else if (near(r.x2, r.y2, rx, ry)) handle = 'se';
      else if (rx > r.x1 && rx < r.x2 && ry > r.y1 && ry < r.y2) handle = 'move';
      if (handle === 'move') { drag = { type: 'move', r, ox: rx - r.x1, oy: ry - r.y1 }; }
      else if (handle) { drag = { type: handle, r }; }
      else { drag = { type: 'new', from: p }; applyRect(normRect(p, p)); }
    }, true);

    function cropMove(e) {
      if (!drag || mode !== 'crop') return;
      e.preventDefault();
      const p = toLocal(e);
      const r = drag.r;
      if (drag.type === 'new') { applyRect(normRect(drag.from, p)); return; }
      const rx = p.x / W, ry = p.y / H;
      if (drag.type === 'move') {
        const w = r.x2 - r.x1, h = r.y2 - r.y1;
        const nx = Math.max(0, Math.min(1 - w, rx - drag.ox));
        const ny = Math.max(0, Math.min(1 - h, ry - drag.oy));
        applyRect({ x1: nx, y1: ny, x2: nx + w, y2: ny + h });
      } else {
        const nr = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
        if (drag.type.indexOf('n') >= 0) nr.y1 = Math.min(ry, r.y2 - 0.06);
        if (drag.type.indexOf('s') >= 0) nr.y2 = Math.max(ry, r.y1 + 0.06);
        if (drag.type.indexOf('w') >= 0) nr.x1 = Math.min(rx, r.x2 - 0.06);
        if (drag.type.indexOf('e') >= 0) nr.x2 = Math.max(rx, r.x1 + 0.06);
        applyRect(nx_clamp(nr));
      }
    }
    function cropUp() { if (drag) { drag = null; compositeNow(); } }
    function nx_clamp(r) {
      return {
        x1: Math.max(0, Math.min(1, r.x1)), y1: Math.max(0, Math.min(1, r.y1)),
        x2: Math.max(0, Math.min(1, r.x2)), y2: Math.max(0, Math.min(1, r.y2)),
      };
    }
    window.addEventListener('pointermove', cropMove);
    window.addEventListener('pointerup', cropUp);

    /* ---------- خروجی ---------- */
    function commit() {
      composite();
      const hasEdits = peHasPaint(ictx, W, H) || peHasPaint(mctx, W, H);
      const hasCrop = cl > 0.001 || ct > 0.001 || cr > 0.001 || cb > 0.001;
      if (!hasEdits && !hasCrop) {
        /* هیچ تغییری نشده ⇒ همان فایل اصلی، بدون افت کیفیت */
        cleanup();
        if (onDone) onDone(file, file.name || 'image.jpg');
        return;
      }
      let out = bc, ow = W, oh = H;
      if (hasCrop) {
        const sx = Math.round(cl * W), sy = Math.round(ct * H);
        const sw = Math.max(1, Math.round(W * (1 - cl - cr))), sh = Math.max(1, Math.round(H * (1 - ct - cb)));
        const c2 = peC(sw, sh);
        const x2 = c2.getContext('2d');
        x2.imageSmoothingQuality = 'high';
        x2.drawImage(bc, sx, sy, sw, sh, 0, 0, sw, sh);
        out = c2; ow = sw; oh = sh;
      }
      /* JPEG شفافیت را نمی‌پذیرد ⇒ اگر عکس شفاف بود PNG می‌دهیم */
      const usePng = hasAlphaSrc;
      out.toBlob((blob) => {
        cleanup();
        if (!blob) { toast('خطا در ساخت تصویر'); return; }
        const nm = (file.name || 'image').replace(/\.[^.]+$/, '') + (usePng ? '.png' : '.jpg');
        if (onDone) onDone(blob, nm);
      }, usePng ? 'image/png' : 'image/jpeg', 0.92);
    }
    function cleanup() {
      try { window.removeEventListener('pointermove', cropMove); window.removeEventListener('pointerup', cropUp); } catch (e) {}
      document.removeEventListener('keydown', onEsc);
      m.remove();
      URL.revokeObjectURL(url);
    }
    const onEsc = (e) => { if (e.key === 'Escape') { cleanup(); if (opts.onCancel) opts.onCancel(); } };
    document.addEventListener('keydown', onEsc);
    m.onclick = (e) => { if (e.target === m) { cleanup(); if (opts.onCancel) opts.onCancel(); } };
    m.querySelector('#pe-ok').onclick = commit;
    m.querySelector('#pe-cancel').onclick = () => { cleanup(); if (opts.onCancel) opts.onCancel(); };

    setMode(mode);
    if (mode === 'crop') { applyRect({ x1: 0, y1: 0, x2: 1, y2: 1 }); }
    composite();
    ctx.drawImage(bc, 0, 0);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('خطا در خواندن عکس'); };
  img.src = url;
}
