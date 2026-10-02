/* =========================================================================
   ویرایشگر عکس — نقاشی با انواع قلم، رنگ‌ها، سانسور شفاف، و برش
   ========================================================================= */
const PE_TOOLS = [
  { id: 'pen',      label: 'مداد',    icon: 'pencil',    w: 1.0,  alpha: 1,    cap: 'round', join: 'round', composite: 'source-over' },
  { id: 'marker',   label: 'ماژیک',   icon: 'pen-tool',  w: 1.6,  alpha: 0.95, cap: 'round', join: 'round', composite: 'source-over' },
  { id: 'brush',    label: 'قلم‌مو',   icon: 'paintbrush',w: 2.4,  alpha: 1,    cap: 'round', join: 'round', composite: 'source-over' },
  { id: 'neon',     label: 'نئون',    icon: 'sparkles',  w: 1.4,  alpha: 1,    cap: 'round', join: 'round', composite: 'lighter' },
  { id: 'hilite',   label: 'هایلایت', icon: 'highlighter', w: 3.0, alpha: 0.42, cap: 'square', join: 'round', composite: 'source-over' },
  { id: 'censor',   label: 'سانسور',  icon: 'eye-off',   w: 2.2,  alpha: 0.72, cap: 'square', join: 'miter', composite: 'source-over' },
  { id: 'blur',     label: 'تاری',    icon: 'droplet',   w: 3.4,  alpha: 0.9,  cap: 'square', join: 'miter', composite: 'source-over' },
  { id: 'eraser',   label: 'پاک‌کن',  icon: 'eraser',    w: 3.0,  alpha: 1,    cap: 'round', join: 'round', composite: 'destination-out' },
];
const PE_COLORS = ['#ffffff', '#000000', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#00bcd4', '#ff6f91'];

/* ساخت یک بوم قلم (offscreen) تا بتوان خط‌های قبلی را دوباره کشید */
function peStrokeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ناحیه‌ی تاری (blur) به‌صورت محلی و ساده پیاده می‌شود: یک کپی کوچک از
   تصویرِ زیرِ ناحیه گرفته و با فیلتر blur روی همان ناحیه کشیده می‌شود. */
function peBlurRegion(dst, srcCanvas, x, y, w, h) {
  if (w < 2 || h < 2) return;
  const k = Math.max(6, Math.round(Math.min(w, h) * 0.18));
  const tmp = peStrokeCanvas(Math.max(1, w), Math.max(1, h));
  const tctx = tmp.getContext('2d');
  tctx.filter = 'blur(' + k + 'px) saturate(1.2)';
  tctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  tctx.filter = 'none';
  dst.drawImage(tmp, x, y);
}

/* -------------------------------------------------------------------------
   ویرایشگر اصلی. file = File/Blob عکس. onDone(blob, name) وقتی کاربر «ارسال»
   یا «ذخیره» را می‌زند صدا زده می‌شود.
   ------------------------------------------------------------------------- */
function openPhotoEditor(file, onDone, opts = {}) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
    /* خروجی محدود می‌شود تا فایل خیلی بزرگ نشود (مثل prepImage). */
    const MAX = 1920;
    const scale = Math.min(1, MAX / Math.max(natW, natH));
    const W = Math.max(1, Math.round(natW * scale)), H = Math.max(1, Math.round(natH * scale));

    const base = peStrokeCanvas(W, H);          // عکس اصلی (بدون تغییر)
    const bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(img, 0, 0, W, H);
    const ink = peStrokeCanvas(W, H);           // لایه‌ی نقاشی
    const ictx = ink.getContext('2d');

    let tool = opts.tool && PE_TOOLS.some((t) => t.id === opts.tool) ? opts.tool : 'pen';
    let color = PE_COLORS[0];
    let size = Math.max(4, Math.round(Math.min(W, H) * 0.018));
    let mode = 'draw';                            // draw | crop
    const undoStack = [];

    const m = document.createElement('div');
    m.className = 'modal-ov';
    m.innerHTML = '<div class="modal pe-modal">'
      + '<h3 class="modal-title">' + ic('image') + ' ویرایش عکس</h3>'
      + '<div class="pe-stage" id="pe-stage">'
      +   '<canvas id="pe-canvas"></canvas>'
      +   '<div class="pe-crop-box" id="pe-crop-box" hidden><i data-n="tl"></i><i data-n="tr"></i><i data-n="bl"></i><i data-n="br"></i></div>'
      + '</div>'
      + '<div class="pe-tools" id="pe-tools"></div>'
      + '<div class="pe-colors" id="pe-colors"></div>'
      + '<div class="pe-slider-row">'
      +   '<span class="pe-lbl">اندازه</span>'
      +   '<input type="range" id="pe-size" min="2" max="90" value="' + size + '">'
      +   '<span class="pe-val" id="pe-size-val"></span>'
      + '</div>'
      + '<div class="pe-crop-row" id="pe-crop-row" hidden>'
      +   '<span class="pe-lbl">برش از کناره‌ها</span>'
      +   '<input type="range" id="pe-cl" min="0" max="45" value="0"><span class="pe-val" id="pe-cl-v">۰٪</span>'
      +   '<input type="range" id="pe-cr" min="0" max="45" value="0"><span class="pe-val" id="pe-cr-v">۰٪</span>'
      +   '<input type="range" id="pe-ct" min="0" max="45" value="0"><span class="pe-val" id="pe-ct-v">۰٪</span>'
      +   '<input type="range" id="pe-cb" min="0" max="45" value="0"><span class="pe-val" id="pe-cb-v">۰٪</span>'
      + '</div>'
      + '<div class="modal-actions">'
      +   '<button class="btn ghost" id="pe-cancel">' + ic('x') + ' انصراف</button>'
      +   '<button class="btn ghost" id="pe-undo">' + ic('undo-2') + ' واگرد</button>'
      +   '<button class="btn ghost" id="pe-cropbtn">' + ic('crop') + ' برش</button>'
      +   '<button class="btn ghost" id="pe-reset">' + ic('rotate-ccw') + ' بازنشانی</button>'
      +   '<button class="btn primary" id="pe-ok">' + ic('check') + ' ارسال</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(m);
    applyIcons(m);

    const stage = m.querySelector('#pe-stage');
    const cv = m.querySelector('#pe-canvas');
    const ctx = cv.getContext('2d');
    const cropBox = m.querySelector('#pe-crop-box');
    const cropRow = m.querySelector('#pe-crop-row');

    /* نمایش: بوم داخل قاب با حفظ نسبت */
    const VIEW_W = 320;
    let dispW = VIEW_W, dispH = Math.max(1, Math.round(VIEW_W * H / W));
    cv.width = W; cv.height = H;
    cv.style.width = '100%'; cv.style.maxWidth = VIEW_W + 'px';
    cv.style.aspectRatio = W + ' / ' + H;

    function paint() {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      ctx.drawImage(ink, 0, 0);
    }

    /* ---------- ابزارها ---------- */
    const toolsEl = m.querySelector('#pe-tools');
    PE_TOOLS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pe-tool' + (t.id === tool ? ' active' : '');
      b.title = t.label;
      b.setAttribute('aria-label', t.label);
      b.innerHTML = '<i data-lucide="' + t.icon + '" class="icon"></i><span>' + t.label + '</span>';
      b.onclick = () => {
        tool = t.id;
        if (t.id === 'blur') toast('قلم «تاری» را روی بخش موردنظر بکشید');
        toolsEl.querySelectorAll('.pe-tool').forEach((x) => x.classList.toggle('active', x === b));
        m.querySelector('#pe-colors').style.opacity = t.id === 'eraser' ? '.35' : '1';
      };
      toolsEl.appendChild(b);
    });
    /* رنگ‌ها */
    const colorsEl = m.querySelector('#pe-colors');
    PE_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pe-color' + (i === 0 ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', 'رنگ ' + c);
      b.onclick = () => {
        color = c;
        colorsEl.querySelectorAll('.pe-color').forEach((x) => x.classList.toggle('active', x === b));
      };
      colorsEl.appendChild(b);
    });
    /* اندازه */
    const sizeIn = m.querySelector('#pe-size');
    const sizeVal = m.querySelector('#pe-size-val');
    const setSize = () => {
      size = Math.max(2, Math.min(90, Number(sizeIn.value) || 2));
      sizeVal.textContent = size + 'px';
    };
    sizeIn.addEventListener('input', setSize); setSize();

    /* ---------- نقاشی ---------- */
    let drawing = false, sx = 0, sy = 0, px = 0, py = 0;
    const undoPush = () => {
      undoStack.push(ink.getContext('2d').getImageData(0, 0, W, H));
      if (undoStack.length > 12) undoStack.shift();
    };
    const tdef = () => PE_TOOLS.find((t) => t.id === tool) || PE_TOOLS[0];
    function toLocal(e) {
      const r = cv.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      return { x: (p.clientX - r.left) * (W / r.width), y: (p.clientY - r.top) * (H / r.height) };
    }
    function strokeTo(ictx2, x0, y0, x1, y1, t) {
      const col = t.id === 'eraser' ? '#000000' : color;
      ictx2.globalCompositeOperation = t.composite;
      ictx2.globalAlpha = t.alpha;
      ictx2.strokeStyle = col;
      ictx2.fillStyle = col;
      ictx2.lineCap = t.cap;
      ictx2.lineJoin = t.join;
      ictx2.lineWidth = Math.max(1, size * t.w);
      if (t.id === 'hilite') ictx2.lineWidth = Math.max(2, size * t.w);
      ictx2.beginPath();
      ictx2.moveTo(x0, y0);
      ictx2.lineTo(x1, y1);
      ictx2.stroke();
      if (t.id === 'neon') {
        ictx2.shadowColor = col; ictx2.shadowBlur = size * 2;
        ictx2.stroke();
        ictx2.shadowBlur = 0;
      }
      ictx2.globalAlpha = 1;
      ictx2.globalCompositeOperation = 'source-over';
    }
    function down(e) {
      if (mode === 'crop' || !e.isPrimary) return;
      e.preventDefault();
      undoPush();
      drawing = true;
      const p = toLocal(e);
      sx = px = p.x; sy = py = p.y;
      if (tool === 'censor' || tool === 'blur') {
        /* سانسور/تاری: مستطیل کشیده می‌شود و در پایان روی لایه می‌نشیند */
        return;
      }
      ictx.beginPath();
      ictx.moveTo(sx, sy);
      strokeTo(ictx, sx, sy, sx + 0.01, sy, tdef());
    }
    function move(e) {
      if (!drawing || mode === 'crop') return;
      e.preventDefault();
      const p = toLocal(e);
      const t = tdef();
      if (tool === 'censor' || tool === 'blur') { paint(); return; }
      strokeTo(ictx, px, py, p.x, p.y, t);
      px = p.x; py = p.y;
      paint();
    }
    function up(e) {
      if (!drawing) return;
      drawing = false;
      const p = e ? toLocal(e) : { x: px, y: py };
      const t = tdef();
      if (tool === 'censor') {
        const x = Math.min(sx, p.x), y = Math.min(sy, p.y);
        const w = Math.abs(p.x - sx), h = Math.abs(p.y - sy);
        if (w > 2 && h > 2) {
          ictx.globalCompositeOperation = 'source-over';
          ictx.globalAlpha = 0.72;
          ictx.fillStyle = color;
          ictx.fillRect(x, y, w, h);
          /* نوارهای تیره تا کاملاً غیرقابل تشخیص نباشد */
          ictx.globalAlpha = 0.5;
          ictx.strokeStyle = 'rgba(0,0,0,.6)';
          ictx.lineWidth = Math.max(2, Math.min(w, h) * 0.06);
          const step = Math.max(8, Math.min(w, h) * 0.16);
          for (let d = -h; d < w + h; d += step) {
            ictx.beginPath(); ictx.moveTo(x + d, y + h); ictx.lineTo(x + d + h, y); ictx.stroke();
          }
          ictx.globalAlpha = 1;
          ictx.globalCompositeOperation = 'source-over';
        }
      } else if (tool === 'blur') {
        const x = Math.max(0, Math.min(sx, p.x)), y = Math.max(0, Math.min(sy, p.y));
        const w = Math.min(W - x, Math.abs(p.x - sx)), h = Math.min(H - y, Math.abs(p.y - sy));
        if (w > 2 && h > 2) {
          const composed = peStrokeCanvas(W, H);
          const cctx = composed.getContext('2d');
          cctx.drawImage(base, 0, 0);
          cctx.drawImage(ink, 0, 0);
          peBlurRegion(cctx, composed, x, y, w, h);
          ictx.clearRect(x, y, w, h);
          ictx.drawImage(composed, 0, 0);
        }
      }
      paint();
    }
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', up);
    cv.style.touchAction = 'none';
    cv.style.cursor = 'crosshair';

    /* ---------- برش ---------- */
    let cl = 0, cr = 0, ct = 0, cb = 0;
    const cropInputs = [
      [m.querySelector('#pe-cl'), m.querySelector('#pe-cl-v'), 'cl'],
      [m.querySelector('#pe-cr'), m.querySelector('#pe-cr-v'), 'cr'],
      [m.querySelector('#pe-ct'), m.querySelector('#pe-ct-v'), 'ct'],
      [m.querySelector('#pe-cb'), m.querySelector('#pe-cb-v'), 'cb'],
    ];
    function applyCropBox() {
      if (mode !== 'crop') { cropBox.hidden = true; return; }
      cropBox.hidden = false;
      const l = cl / 100, r = cr / 100, t = ct / 100, b = cb / 100;
      cropBox.style.left = (l * 100) + '%';
      cropBox.style.top = (t * 100) + '%';
      cropBox.style.right = (r * 100) + '%';
      cropBox.style.bottom = (b * 100) + '%';
      /* خارج از کادر تیره می‌شود */
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      ctx.drawImage(ink, 0, 0);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      const sx2 = l * W, sy2 = t * H, sw2 = Math.max(1, W * (1 - l - r)), sh2 = Math.max(1, H * (1 - t - b));
      ctx.rect(sx2, sy2, sw2, sh2);
      ctx.fill('evenodd');
      ctx.restore();
    }
    cropInputs.forEach(([inp, val, key]) => {
      inp.addEventListener('input', () => {
        const v = Math.max(0, Math.min(45, Number(inp.value) || 0));
        if (key === 'cl') cl = v;
        if (key === 'cr') cr = v;
        if (key === 'ct') ct = v;
        if (key === 'cb') cb = v;
        if (cl + cr > 90) { if (key === 'cl') { cl = 90 - cr; inp.value = cl; } else { cr = 90 - cl; inp.value = cr; } }
        if (ct + cb > 90) { if (key === 'ct') { ct = 90 - cb; inp.value = ct; } else { cb = 90 - ct; inp.value = cb; } }
        val.textContent = (key === 'cl' ? cl : key === 'cr' ? cr : key === 'ct' ? ct : cb) + '٪';
        applyCropBox();
      });
    });
    const cropBtn = m.querySelector('#pe-cropbtn');
    cropBtn.onclick = () => {
      mode = mode === 'crop' ? 'draw' : 'crop';
      cropBtn.classList.toggle('primary', mode === 'crop');
      cropBtn.classList.toggle('ghost', mode !== 'crop');
      cropRow.hidden = mode !== 'crop';
      if (mode === 'crop') { cropInputs.forEach(([i]) => { i.value = 0; i.dispatchEvent(new Event('input')); }); }
      applyCropBox();
    };
    /* اگر کاربر از منوی «برش عکس» آمده، مستقیم در حالت برش باز شو */
    if (opts.startInCrop) cropBtn.onclick();

    /* ---------- واگرد / بازنشانی ---------- */
    m.querySelector('#pe-undo').onclick = () => {
      const prev = undoStack.pop();
      if (!prev) { toast('چیزی برای واگرد نیست'); return; }
      ictx.putImageData(prev, 0, 0);
      paint();
    };
    m.querySelector('#pe-reset').onclick = () => {
      ictx.clearRect(0, 0, W, H);
      undoStack.length = 0;
      cl = cr = ct = cb = 0;
      cropInputs.forEach(([i]) => { i.value = 0; i.dispatchEvent(new Event('input')); });
      if (mode === 'crop') applyCropBox(); else paint();
    };

    /* ---------- خروجی ---------- */
    function buildOutput() {
      const l = cl / 100, r = cr / 100, t = ct / 100, b = cb / 100;
      const sw = Math.max(1, Math.round(W * (1 - l - r)));
      const sh = Math.max(1, Math.round(H * (1 - t - b)));
      if (sw === W && sh === H) return null;
      const out = peStrokeCanvas(sw, sh);
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(base, l * W, t * H, sw, sh, 0, 0, sw, sh);
      octx.drawImage(ink, l * W, t * H, sw, sh, 0, 0, sw, sh);
      return out;
    }
    function commit() {
      const cropped = buildOutput();
      const target = cropped || base;
      const hasInk = ink.getContext('2d').getImageData(0, 0, W, H).data.some((v, i) => i % 4 === 3 && v > 0);
      const src = cropped
        ? (hasInk ? (() => { const c = peStrokeCanvas(cropped.width, cropped.height); const x = c.getContext('2d'); x.drawImage(cropped, 0, 0); return c; })() : cropped)
        : base;
      if (!hasInk && !cropped) { cleanup(); if (onDone) onDone(file, file.name || 'image.jpg'); return; }
      src.toBlob((blob) => {
        cleanup();
        if (!blob) { toast('خطا در ساخت تصویر'); return; }
        const nm = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
        if (onDone) onDone(blob, nm);
      }, 'image/jpeg', 0.92);
    }
    function cleanup() {
      try { document.removeEventListener('keydown', m._esc); } catch (e) {}
      m.remove();
      URL.revokeObjectURL(url);
    }
    m.querySelector('#pe-ok').onclick = commit;
    m.querySelector('#pe-cancel').onclick = () => { cleanup(); if (opts.onCancel) opts.onCancel(); };
    m._esc = (e) => { if (e.key === 'Escape') { cleanup(); if (opts.onCancel) opts.onCancel(); } };
    document.addEventListener('keydown', m._esc);
    m.onclick = (e) => { if (e.target === m) { cleanup(); if (opts.onCancel) opts.onCancel(); } };
    paint();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('خطا در خواندن عکس'); };
  img.src = url;
}
