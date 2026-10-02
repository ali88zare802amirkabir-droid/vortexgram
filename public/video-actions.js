/* =========================================================================
   منوی ابزارهای ویدیو — کاهش حجم، بی‌صدا و تبدیل به GIF، کوتاه کردن، برش کناره‌ها
   وقتی کاربر یک ویدیو انتخاب می‌کند این منو باز می‌شود و بستهٔ پیوست بسته نمی‌شود.
   ========================================================================= */

function veFileName(file, ext) {
  const base = (file && file.name ? file.name : 'video').replace(/\.[^.]+$/, '');
  return base + '.' + ext;
}

/* ---------- منوی ابزارهای ویدیو ---------- */
function openVideoTools(file, opts = {}) {
  const src = URL.createObjectURL(file);
  const pop = veOpenModal('ابزارهای ویدیو');
  const body = pop.querySelector('.ve-body');
  const foot = pop.querySelector('.ve-foot');
  pop.classList.add('ve-wide');

  const status = document.createElement('div');
  status.className = 've-status';
  const bar = document.createElement('div');
  bar.className = 've-bar';
  bar.innerHTML = '<div class="ve-bar-fill"></div>';
  bar.hidden = true;

  const prev = document.createElement('video');
  prev.className = 've-preview'; prev.src = src; prev.muted = true; prev.playsInline = true; prev.controls = true; prev.preload = 'metadata';

  const tools = document.createElement('div');
  tools.className = 'vt-grid';
  tools.innerHTML = [
    { id: 'compress', icon: 'minimize-2', label: 'کاهش حجم', hint: 'کوچک‌تر و سبک‌تر', },
    { id: 'mute-gif', icon: 'image', label: 'بی‌صدا و ارسال به‌صورت GIF', hint: 'بدون صدا، مثل GIF', },
    { id: 'trim', icon: 'scissors', label: 'کوتاه کردن فیلم', hint: 'تعیین بازهٔ زمانی', },
    { id: 'crop', icon: 'crop', label: 'برش از کناره‌ها', hint: 'حذف لبه‌ها', },
  ].map((t) => '<button type="button" class="vt-card" data-t="' + t.id + '">'
    + '<i data-lucide="' + t.icon + '" class="icon"></i>'
    + '<b>' + t.label + '</b><small>' + t.hint + '</small></button>').join('');

  body.appendChild(prev);
  body.appendChild(tools);
  foot.appendChild(status);
  foot.appendChild(bar);
  const sendRaw = document.createElement('button');
  sendRaw.type = 'button';
  sendRaw.className = 'btn primary';
  sendRaw.innerHTML = ic('send') + ' ارسال بدون تغییر';
  foot.appendChild(sendRaw);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn ghost';
  cancel.textContent = 'انصراف';
  foot.appendChild(cancel);
  applyIcons(pop);

  let busy = false;
  function setBusy(on, msg) {
    busy = on;
    tools.style.opacity = on ? '.4' : '1';
    tools.style.pointerEvents = on ? 'none' : '';
    sendRaw.disabled = on;
    status.classList.remove('hidden');
    status.textContent = msg || '';
    bar.hidden = !on;
  }
  function prog(p) { bar.querySelector('.ve-bar-fill').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; }
  function say(t, err) { status.classList.remove('hidden'); status.textContent = t; if (err) status.style.color = 'var(--danger)'; else status.style.color = ''; }
  function done(t) { status.classList.remove('hidden'); status.textContent = t || 'تمام شد'; bar.querySelector('.ve-bar-fill').style.width = '100%'; setBusy(false); }
  function fail(msg) { setBusy(false); say(msg || 'خطا در پردازش ویدیو', true); }
  function finish(blob, name, type) {
    const f = new File([blob], name, { type });
    sendFileMessage(f, f.name);
    toast('در حال ارسال…');
    close();
  }
  /* انصراف فقط این پنجره را می‌بندد؛ بستهٔ پیوست باز می‌ماند. */
  function close() { try { URL.revokeObjectURL(src); } catch (e) {} pop.remove(); }
  cancel.onclick = () => { if (!busy) close(); };
  pop.addEventListener('mousedown', (e) => { if (e.target === pop && !busy) close(); });
  sendRaw.onclick = () => { if (opts.onSendRaw) { close(); opts.onSendRaw(file); } else finish(file, file.name || 'video.mp4', file.type || 'video/mp4'); };

  /* ---------- کاهش حجم ---------- */
  async function doCompress() {
    setBusy(true, 'در حال کاهش حجم…'); prog(0);
    try {
      const meta = await veProbeMeta(src);
      const longSide = Math.max(meta.w, meta.h) || 1;
      const scale = Math.min(1, 480 / longSide);
      const w = Math.max(160, Math.round(meta.w * scale / 2) * 2);
      const opts2 = {
        start: 0, end: Math.min(meta.dur || 5, 30), fps: 12, width: w,
        filter: 'none', text: '', bitrate: 700_000,
      };
      const blob = await videoToWebM(src, opts2, (p) => prog(p * 0.95));
      if (!blob) return fail('لغو شد');
      prog(1);
      const old = Math.round(file.size / 1024), nw = Math.round(blob.size / 1024);
      done('حجم: ' + old + 'KB → ' + nw + 'KB');
      setTimeout(() => finish(blob, veFileName(file, 'webm'), 'video/webm'), 700);
    } catch (e) { fail('کاهش حجم ممکن نشد'); }
  }

  /* ---------- بی‌صدا + GIF ---------- */
  async function doMuteGif() {
    setBusy(true, 'در حال تبدیل به GIF…'); prog(0);
    try {
      const meta = await veProbeMeta(src);
      const end = Math.min(meta.dur || 5, 6);
      const gopts = { start: 0, end, fps: 10, width: 320, filter: 'none', text: '' };
      const blob = await videoToGif(src, gopts, (p) => prog(p * 0.95));
      if (!blob) return fail('لغو شد');
      prog(1);
      /* ذخیره در «GIFهای من» تا بعداً هم قابل ارسال باشد */
      saveToMyGifs(blob, 'GIF ' + new Date().toLocaleString('fa')).then(() => {
        try { const g = $('emoji-grid'); if (g && emojiPanelTab === 'gif') renderGifGrid(g); } catch (e) {}
      });
      done('آماده شد — بی‌صدا');
      setTimeout(() => finish(blob, veFileName(file, 'gif'), 'image/gif'), 700);
    } catch (e) { fail('تبدیل به GIF ممکن نشد'); }
  }

  /* ---------- کوتاه کردن ---------- */
  function doTrim() {
    if (busy) return;
    veProbeMeta(src).then((meta) => {
      const dur = Math.max(0.5, meta.dur || 1);
      let s = 0, e = dur;
      const p = veOpenModal('کوتاه کردن فیلم');
      p.classList.add('ve-wide');
      const b = p.querySelector('.ve-body'), f = p.querySelector('.ve-foot');
      const lab = document.createElement('div');
      lab.className = 've-timebar-label';
      const r1 = document.createElement('input'); r1.type = 'range'; r1.step = '0.05'; r1.min = 0; r1.max = dur; r1.value = 0;
      const r2 = document.createElement('input'); r2.type = 'range'; r2.step = '0.05'; r2.min = 0; r2.max = dur; r2.value = dur;
      const hint = document.createElement('div');
      hint.className = 've-css-hint';
      hint.textContent = 'بازهٔ دلخواه را انتخاب کنید؛ نتیجه بی‌صدا ارسال می‌شود.';
      const upd = () => {
        s = Math.max(0, Math.min(Number(r1.value), dur - 0.1));
        e = Math.min(dur, Math.max(Number(r2.value), s + 0.1));
        lab.textContent = veFmtTime(s) + ' → ' + veFmtTime(e) + '  (' + (e - s).toFixed(1) + ' ثانیه)';
      };
      r1.oninput = () => { if (Number(r1.value) > e - 0.1) r1.value = e - 0.1; upd(); };
      r2.oninput = () => { if (Number(r2.value) < s + 0.1) r2.value = s + 0.1; upd(); };
      b.appendChild(lab); b.appendChild(r1); b.appendChild(r2); b.appendChild(hint);
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn primary'; go.innerHTML = ic('scissors') + ' کوتاه کن';
      const cc = document.createElement('button');
      cc.type = 'button'; cc.className = 'btn ghost'; cc.textContent = 'انصراف';
      f.appendChild(go); f.appendChild(cc);
      applyIcons(p);
      upd();
      cc.onclick = () => p.remove();
      go.onclick = () => {
        p.remove();
        setBusy(true, 'در حال ساخت…'); prog(0);
        const w = Math.min(480, Math.max(160, Math.round((meta.w || 320) / 2) * 2));
        videoToWebM(src, { start: s, end: e, fps: 15, width: w, filter: 'none', text: '', bitrate: 1_200_000 }, (pp) => prog(pp * 0.95))
          .then((blob) => {
            if (!blob) return fail('لغو شد');
            prog(1);
            done('برش زمانی انجام شد');
            setTimeout(() => finish(blob, veFileName(file, 'webm'), 'video/webm'), 700);
          })
          .catch(() => fail('کوتاه کردن ممکن نشد'));
      };
    });
  }

  /* ---------- برش از کناره‌ها ---------- */
  function doCrop() {
    if (busy) return;
    veProbeMeta(src).then((meta) => {
      const W = Math.max(1, meta.w), H = Math.max(1, meta.h);
      let l = 0, r = 0, t = 0, b = 0;
      const p = veOpenModal('برش از کناره‌ها');
      p.classList.add('ve-wide');
      const body = p.querySelector('.ve-body'), f = p.querySelector('.ve-foot');
      const box = document.createElement('div');
      box.className = 'vt-crop-box';
      box.innerHTML = '<div class="vt-crop-mask"></div><div class="vt-crop-view"><video class="ve-preview" muted playsinline></video></div>'
        + '<i class="vt-h nw"></i><i class="vt-h ne"></i><i class="vt-h sw"></i><i class="vt-h se"></i>'
        + '<i class="vt-v nn"></i><i class="vt-v en"></i><i class="vt-v ws"></i><i class="vt-v es"></i>';
      body.appendChild(box);
      const vid = box.querySelector('video');
      vid.src = src; vid.preload = 'metadata'; vid.muted = true; vid.playsInline = true;
      const mk = (key, label, max) => {
        const row = document.createElement('div');
        row.className = 've-row';
        row.innerHTML = '<label><span>' + label + '</span><span class="ve-val">۰٪</span></label>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0; inp.max = max; inp.value = 0; inp.step = 1;
        row.appendChild(inp);
        const val = row.querySelector('.ve-val');
        inp.oninput = () => {
          const v = Number(inp.value);
          if (key === 'l') l = Math.min(v, 90 - r);
          if (key === 'r') r = Math.min(v, 90 - l);
          if (key === 't') t = Math.min(v, 90 - b);
          if (key === 'b') b = Math.min(v, 90 - t);
          inp.value = (key === 'l' ? l : key === 'r' ? r : key === 't' ? t : b);
          val.textContent = inp.value + '٪';
          draw();
        };
        body.appendChild(row);
        return inp;
      };
      mk('l', 'چپ', 45); mk('r', 'راست', 45); mk('t', 'بالا', 45); mk('b', 'پایین', 45);
      function draw() {
        const mask = box.querySelector('.vt-crop-mask');
        const view = box.querySelector('.vt-crop-view');
        view.style.left = (l / 100 * 100) + '%';
        view.style.right = (r / 100 * 100) + '%';
        view.style.top = (t / 100 * 100) + '%';
        view.style.bottom = (b / 100 * 100) + '%';
        box.style.setProperty('--padl', l + '%');
        box.style.setProperty('--padr', r + '%');
        box.style.setProperty('--padt', t + '%');
        box.style.setProperty('--padb', b + '%');
        if (mask) mask.style.opacity = 1;
      }
      draw();
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn primary'; go.innerHTML = ic('crop') + ' ببر و ارسال کن';
      const cc = document.createElement('button');
      cc.type = 'button'; cc.className = 'btn ghost'; cc.textContent = 'انصراف';
      f.appendChild(go); f.appendChild(cc);
      applyIcons(p);
      cc.onclick = () => p.remove();
      go.onclick = () => {
        p.remove();
        if (l + r + t + b === 0) { toast('چیزی برای برش انتخاب نشده'); return; }
        setBusy(true, 'در حال برش…'); prog(0);
        const cw = W * (1 - (l + r) / 100), chh = H * (1 - (t + b) / 100);
        const w = Math.max(160, Math.min(720, Math.round(cw / 2) * 2));
        const cropOpt = { l: l / 100, t: t / 100, r: 1 - r / 100, b: 1 - b / 100 };
        videoToWebM(src, { start: 0, end: Math.min(meta.dur || 5, 30), fps: 15, width: w, filter: 'none', text: '', bitrate: 1_500_000, crop: cropOpt }, (pp) => prog(pp * 0.95))
          .then((blob) => {
            if (!blob) return fail('لغو شد');
            prog(1);
            done('برش از کناره‌ها انجام شد');
            setTimeout(() => finish(blob, veFileName(file, 'webm'), 'video/webm'), 700);
          })
          .catch(() => fail('برش ممکن نشد'));
      };
    });
  }

  tools.addEventListener('click', (e) => {
    const b = e.target.closest('.vt-card');
    if (!b || busy) return;
    const t = b.dataset.t;
    if (t === 'compress') doCompress();
    else if (t === 'mute-gif') doMuteGif();
    else if (t === 'trim') doTrim();
    else if (t === 'crop') doCrop();
  });
}

/* خواندن ابعاد/مدت ویدیو بدون دانلود کامل */
function veProbeMeta(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      resolve({ w: v.videoWidth || 320, h: v.videoHeight || 240, dur: (isFinite(v.duration) && v.duration) || 0 });
      v.removeAttribute('src'); v.load && v.load();
    };
    v.preload = 'metadata';
    v.addEventListener('loadedmetadata', fin);
    v.addEventListener('error', fin);
    setTimeout(fin, 2500);
    v.src = src;
  });
}
