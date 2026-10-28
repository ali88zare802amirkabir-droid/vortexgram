/* ═══════════════════════════════════════════════════════════════════════
   VXGroupSettings — Telegram-faithful group / channel info & settings
   ─ One module, two containers: full-screen stack on mobile, right-hand
     glass side panel on desktop (>=768px). Same page builders for both.
   ─ Every network call goes through `svc`, a thin service layer, so a
     backend change is a one-line edit here, never scattered in the UI.
   ─ RTL-first: logical CSS properties, mirrored chevrons, Persian digits.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.VXGroupSettings) return;

  /* ───────────────────────────── utils ───────────────────────────── */
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const faNum = (v) => String(v == null ? '' : v).replace(/[0-9]/g, (d) => FA[+d]);
  const faGroup = (n) => faNum(Number(n || 0).toLocaleString('en-US')).replace(/,/g, '٬');
  const escT = (s) => (window.VXSanitize && VXSanitize.escText)
    ? VXSanitize.escText(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escA = (s) => (window.VXSanitize && VXSanitize.escAttr) ? VXSanitize.escAttr(s) : escT(s);
  const I = (n) => (typeof ic === 'function' ? ic(n) : '<i data-lucide="' + n + '" class="icon"></i>');
  const RTL = () => ((document.documentElement.getAttribute('dir') || 'rtl') === 'rtl');
  const BACK_IC = () => (RTL() ? 'chevron-right' : 'chevron-left');
  const FWD_IC = () => (RTL() ? 'chevron-left' : 'chevron-right');
  const mobile = () => (typeof isMobile === 'function' ? isMobile() : window.innerWidth < 768);

  function toastMsg(m) { if (typeof toast === 'function') toast(m); else console.log(m); }
  function reloadIcons(scope) {
    try { if (window.lucide) lucide.createIcons(scope || document); } catch (e) {}
  }
  function avHTML(u, size) {
    try { return avatarEl(u, size).outerHTML; }
    catch (e) {
      const t = escT((u && (u.displayName || u.username)) || '?').slice(0, 1);
      return '<span class="av ' + (size || 'sm') + '">' + t + '</span>';
    }
  }
  function relTime(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60e3) return 'همین حالا';
    if (d < 3600e3) return faNum(Math.floor(d / 60e3)) + ' دقیقه پیش';
    if (d < 86400e3) return faNum(Math.floor(d / 3600e3)) + ' ساعت پیش';
    if (d < 7 * 86400e3) return faNum(Math.floor(d / 86400e3)) + ' روز پیش';
    try { return new Date(ts).toLocaleDateString('fa-IR'); } catch (e) { return ''; }
  }
  function fmtSize(b) {
    if (!b && b !== 0) return '';
    const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
    let n = Number(b), i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return faNum(i === 0 ? Math.round(n) : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  }
  function fmtDur(s) {
    if (!isFinite(s) || s <= 0) return '۰:۰۰';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return faNum(m) + ':' + faNum(String(sec).padStart(2, '0'));
  }
  function debounce(fn, ms) {
    let t = null;
    return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); };
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ─────────────────────────── session state ─────────────────────── */
  const S = {
    gid: null, rid: null, info: null, settings: null,
    isStaff: false, isOwner: false, isChannel: false,
    members: null, admins: null, inviteLinks: null, banned: null,
    log: null, joinRequests: null, activeTab: null, editDirty: false,
  };

  function syncGroupToState() {
    try {
      const g = (state.groups || []).find((x) => x.id === S.gid);
      if (!g || !S.info) return;
      g.name = S.info.name;
      g.avatar = S.info.avatar;
      g.username = S.info.username;
      g.visibility = S.info.visibility;
      g.description = S.info.description;
      if (typeof renderRoomHeader === 'function') renderRoomHeader();
      if (typeof buildChatList === 'function') buildChatList();
      if (state.ws && state.ws.readyState === 1) {
        try { state.ws.send(JSON.stringify({ type: 'groups', groups: state.groups })); } catch (e) {}
      }
    } catch (e) {}
  }

  /* ───────────────────────── service layer ───────────────────────── */
  async function jget(path) {
    const r = await api(path);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'خطا در دریافت اطلاعات');
    return d;
  }
  async function jsend(method, path, body) {
    const r = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'خطا در انجام عملیات');
    return d;
  }

  const svc = {
    base() { return '/api/groups/' + encodeURIComponent(S.gid); },
    getInfo() { return jget(this.base() + '/settings'); },
    updateInfo(patch) { return jsend('PATCH', this.base(), patch); },
    updateSettings(patch) { return jsend('PATCH', this.base() + '/settings', patch); },
    checkUsername(u) { return jget('/api/groups/username-available?u=' + encodeURIComponent(u)); },
    listMembers() { return jget(this.base() + '/members'); },
    addMember(username) { return jsend('POST', this.base() + '/members', { username }); },
    removeMember(username) { return jsend('POST', this.base() + '/kick', { username }); },
    setRole(username, role) { return jsend('POST', this.base() + '/role', { username, role }); },
    restrict(username, payload) { return jsend('POST', this.base() + '/restrict/' + encodeURIComponent(username), payload); },
    listAdmins() { return jget(this.base() + '/admins'); },
    saveAdmin(username, payload) { return jsend('POST', this.base() + '/admins/' + encodeURIComponent(username), payload); },
    removeAdmin(username) { return jsend('DELETE', this.base() + '/admins/' + encodeURIComponent(username)); },
    listInviteLinks() { return jget(this.base() + '/invite-links'); },
    createInviteLink(payload) { return jsend('POST', this.base() + '/invite-links', payload); },
    revokeInviteLink(token) { return jsend('DELETE', this.base() + '/invite-links/' + encodeURIComponent(token)); },
    listJoinRequests() { return jget(this.base() + '/join-requests'); },
    decideJoinRequest(username, action) { return jsend('POST', this.base() + '/join-requests/' + encodeURIComponent(username), { action }); },
    listBanned() { return jget(this.base() + '/banned'); },
    unban(username) { return jsend('POST', this.base() + '/banned/' + encodeURIComponent(username), { unban: true }); },
    getLog() { return jget(this.base() + '/log'); },
    listMedia(kind) { return jget(this.base() + '/media?kind=' + encodeURIComponent(kind)); },
    leave() { return jsend('POST', this.base() + '/leave'); },
    destroy() { return jsend('POST', this.base() + '/delete'); },
    transfer(username) { return jsend('POST', this.base() + '/transfer', { username }); },
    uploadAvatar(file) {
      const fd = new FormData();
      fd.append('avatar', file);
      return fetch(this.base() + '/avatar', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + state.token },
        body: fd,
      }).then((r) => r.json());
    },
  };

  /* ─────────────────────── panel container / stack ───────────────── */
  let panelEl = null, scrimEl = null, stack = [], isOpen = false, closeToken = 0;

  function ensurePanel() {
    if (panelEl) return;
    scrimEl = el('div', 'tg-scrim');
    scrimEl.addEventListener('click', closePanel);
    panelEl = el('aside', 'tg-panel');
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-modal', 'true');
    panelEl.setAttribute('aria-label', 'اطلاعات گروه');
    document.body.appendChild(scrimEl);
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', onPanelClick);
    panelEl.addEventListener('change', onPanelChange);
    panelEl.addEventListener('input', onPanelInput);
    document.addEventListener('keydown', onKeyDown);
    bindEdgeSwipe();
  }

  function pushPage(pageEl, opts) {
    if (pageEl && !pageEl.classList && pageEl.el) pageEl = pageEl.el;
    pageEl.classList.add('tg-page');
    const prev = stack[stack.length - 1];
    if (prev) prev.el.style.display = 'none';
    panelEl.appendChild(pageEl);
    const rec = { el: pageEl, onShow: opts && opts.onShow };
    stack.push(rec);
    const sc = pageEl.querySelector('.tg-scroll');
    if (sc) {
      sc.addEventListener('scroll', () => {
        pageEl.classList.toggle('is-scrolled', sc.scrollTop > 4);
      }, { passive: true });
    }
    requestAnimationFrame(() => pageEl.classList.add('is-active'));
    return rec;
  }

  function popPage() {
    if (stack.length <= 1) { closePanel(); return; }
    const top = stack.pop();
    top.el.classList.add('tg-page-out');
    setTimeout(() => { try { top.el.remove(); } catch (e) {} }, 200);
    const prev = stack[stack.length - 1];
    if (prev) {
      prev.el.style.display = '';
      if (prev.onShow) { try { prev.onShow(); } catch (e) {} }
    }
  }

  function closePanel() {
    isOpen = false;
    const tok = ++closeToken;
    if (panelEl) panelEl.classList.remove('is-open');
    if (scrimEl) scrimEl.classList.remove('is-open');
    document.body.classList.remove('tg-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (tok === closeToken && !isOpen && stack.length) { stack.forEach((p) => { try { p.el.remove(); } catch (e) {} }); stack = []; }
    }, 260);
  }

  function onKeyDown(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      const scrim = document.querySelector('.tg-dialog-scrim.is-open, .tg-sheet-scrim.is-open');
      if (scrim) { scrim.remove(); return; }
      popPage();
    }
  }

  /* mobile edge-swipe back (start edge = right in RTL) */
  function bindEdgeSwipe() {
    let sx = 0, sy = 0, tracking = false;
    panelEl.addEventListener('touchstart', (e) => {
      if (!mobile() || e.touches.length !== 1) return;
      const x = e.touches[0].clientX, w = window.innerWidth;
      const startEdge = RTL() ? x > w - 30 : x < 30;
      if (!startEdge) return;
      tracking = true; sx = x; sy = e.touches[0].clientY;
    }, { passive: true });
    panelEl.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - sx;
      const dy = Math.abs(e.touches[0].clientY - sy);
      if (Math.abs(dx) > 70 && dy < 60 && (RTL() ? dx > 0 : dx < 0)) {
        tracking = false;
        popPage();
      }
    }, { passive: true });
    panelEl.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  }

  /* ───────────────────────── shared builders ─────────────────────── */
  function topbarHTML(o) {
    o = o || {};
    let h = '<header class="tg-topbar">';
    if (o.back) h += '<button type="button" class="tg-iconbtn" data-act="back" aria-label="بازگشت">' + I(BACK_IC()) + '</button>';
    if (o.close) h += '<button type="button" class="tg-iconbtn" data-act="close" aria-label="بستن">' + I('x') + '</button>';
    h += '<div class="tg-topbar-title">' + escT(o.title || '');
    if (o.sub) h += '<span class="tg-topbar-sub">' + escT(o.sub) + '</span>';
    h += '</div>';
    (o.actions || []).forEach((a) => {
      h += '<button type="button" class="tg-iconbtn' + (a.accent ? ' is-accent' : '') + '" data-act="' + escA(a.act) + '" aria-label="' + escA(a.label || '') + '"' + (a.disabled ? ' disabled' : '') + '>' + I(a.icon) + '</button>';
    });
    h += '</header>';
    return h;
  }

  function rowHTML(o) {
    o = o || {};
    const cls = ['tg-row'];
    if (o.static) cls.push('is-static');
    if (o.danger) cls.push('is-danger');
    if (o.checked) cls.push('is-checked');
    let trail = '';
    if (o.toggle != null) {
      trail = '<span class="tg-switch' + (o.disabled ? ' is-disabled' : '') + '"><input type="checkbox" data-tg="' + escA(o.toggle) + '"' + (o.on ? ' checked' : '') + (o.disabled ? ' disabled' : '') + ' aria-label="' + escA(o.title) + '"></span>';
    } else if (o.radio) {
      trail = '<span class="tg-radio" aria-hidden="true"></span>';
    } else if (o.check) {
      trail = '<span class="tg-check" aria-hidden="true">' + I('check') + '</span>';
    } else if (o.badge != null) {
      trail = '<span class="tg-row-badge">' + escT(o.badge) + '</span>';
    } else if (o.value != null) {
      trail = '<span class="tg-row-val' + (o.ltr ? ' tg-ltr' : '') + '">' + escT(o.value) + '</span>';
    }
    if (o.go) trail += '<span class="tg-row-go" aria-hidden="true">' + I(FWD_IC()) + '</span>';
    const tag = o.href ? 'a' : 'button';
    const hrefAttr = o.href ? ' href="' + escA(o.href) + '"' + (o.external ? ' target="_blank" rel="noopener noreferrer"' : '') : ' type="button"';
    const actAttr = o.act ? ' data-act="' + escA(o.act) + '"' : '';
    const dataAttr = o.data ? Object.keys(o.data).map((k) => ' data-' + k + '="' + escA(o.data[k]) + '"').join('') : '';
    let h = '<' + tag + ' class="' + cls.join(' ') + '"' + hrefAttr + actAttr + dataAttr + (o.disabled ? ' disabled' : '') + '>';
    if (o.icon) h += '<span class="tg-row-ic' + (o.tone ? ' t-' + o.tone : '') + '" aria-hidden="true">' + I(o.icon) + '</span>';
    h += '<span class="tg-row-main"><span class="tg-row-title">' + escT(o.title) + '</span>';
    if (o.sub) h += '<span class="tg-row-sub">' + escT(o.sub) + '</span>';
    h += '</span>';
    h += trail;
    h += '</' + tag + '>';
    return h;
  }

  function sectionHTML(o) {
    o = o || {};
    let h = '<section class="tg-section">';
    if (o.head) h += '<div class="tg-section-head">' + escT(o.head) + '</div>';
    if (o.body) h += '<div class="tg-card">' + o.body + '</div>';
    if (o.foot) h += '<div class="tg-section-foot">' + escT(o.foot) + '</div>';
    h += '</section>';
    return h;
  }

  function emptyHTML(icon, text) {
    return '<div class="tg-empty">' + I(icon || 'inbox') + '<span>' + escT(text) + '</span></div>';
  }

  function skeletonRows(n) {
    let h = '';
    for (let i = 0; i < (n || 6); i++) {
      h += '<div class="tg-skel-row"><div class="tg-skel tg-skel-av"></div><div class="tg-skel-lines"><div class="tg-skel tg-skel-line w60"></div><div class="tg-skel tg-skel-line w40"></div></div></div>';
    }
    return h;
  }

  function makePage() { return el('div', 'tg-page'); }

  /* ───────────────────────── dialogs / sheets ────────────────────── */
  function confirmDialog(opts) {
    return new Promise((resolve) => {
      const scrim = el('div', 'tg-dialog-scrim');
      scrim.innerHTML =
        '<div class="tg-dialog" role="alertdialog" aria-modal="true">' +
          '<div class="tg-dialog-body">' +
            '<div class="tg-dialog-title">' + escT(opts.title || '') + '</div>' +
            (opts.text ? '<div>' + escT(opts.text) + '</div>' : '') +
          '</div>' +
          '<div class="tg-dialog-actions">' +
            '<button type="button" class="tg-btn" data-d="0">' + escT(opts.cancel || 'انصراف') + '</button>' +
            '<button type="button" class="tg-btn ' + (opts.danger ? 'is-danger' : 'is-primary') + '" data-d="1">' + escT(opts.ok || 'تأیید') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(scrim);
      requestAnimationFrame(() => scrim.classList.add('is-open'));
      const done = (v) => { scrim.classList.remove('is-open'); setTimeout(() => scrim.remove(), 180); resolve(v); };
      scrim.querySelector('[data-d="0"]').onclick = () => done(false);
      scrim.querySelector('[data-d="1"]').onclick = () => done(true);
      scrim.onclick = (e) => { if (e.target === scrim) done(false); };
      scrim.querySelector('[data-d="1"]').focus();
    });
  }

  function actionSheet(opts) {
    return new Promise((resolve) => {
      const scrim = el('div', 'tg-sheet-scrim');
      let items = '';
      (opts.items || []).forEach((it, i) => {
        items += '<button type="button" class="tg-sheet-item' + (it.danger ? ' is-danger' : '') + (it.checked ? ' is-checked' : '') + '" data-i="' + i + '">' + (it.icon ? I(it.icon) : '') + '<span>' + escT(it.label) + '</span></button>';
      });
      scrim.innerHTML =
        '<div class="tg-sheet" role="dialog" aria-modal="true">' +
          '<div class="tg-sheet-handle" aria-hidden="true"></div>' +
          (opts.title ? '<div class="tg-sheet-title">' + escT(opts.title) + '</div>' : '') +
          items +
        '</div>';
      document.body.appendChild(scrim);
      requestAnimationFrame(() => scrim.classList.add('is-open'));
      const done = (v) => { scrim.classList.remove('is-open'); setTimeout(() => scrim.remove(), 220); resolve(v); };
      scrim.querySelectorAll('[data-i]').forEach((b) => {
        b.onclick = () => { const it = opts.items[+b.dataset.i]; done(it.value != null ? it.value : it.label); };
      });
      scrim.onclick = (e) => { if (e.target === scrim) done(null); };
    });
  }

  function promptDialog(opts) {
    return new Promise((resolve) => {
      const scrim = el('div', 'tg-dialog-scrim');
      scrim.innerHTML =
        '<div class="tg-dialog" role="dialog" aria-modal="true">' +
          '<div class="tg-dialog-body">' +
            '<div class="tg-dialog-title">' + escT(opts.title || '') + '</div>' +
            '<input class="tg-input" data-p="inp" maxlength="' + (opts.maxlength || 64) + '" value="' + escA(opts.value || '') + '" placeholder="' + escA(opts.placeholder || '') + '">' +
          '</div>' +
          '<div class="tg-dialog-actions">' +
            '<button type="button" class="tg-btn" data-d="0">انصراف</button>' +
            '<button type="button" class="tg-btn is-primary" data-d="1">' + escT(opts.ok || 'ذخیره') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(scrim);
      requestAnimationFrame(() => scrim.classList.add('is-open'));
      const inp = scrim.querySelector('[data-p="inp"]');
      const done = (v) => { scrim.classList.remove('is-open'); setTimeout(() => scrim.remove(), 180); resolve(v); };
      scrim.querySelector('[data-d="0"]').onclick = () => done(null);
      scrim.querySelector('[data-d="1"]').onclick = () => done(inp.value.trim());
      scrim.onclick = (e) => { if (e.target === scrim) done(null); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim()); });
      setTimeout(() => inp.focus(), 60);
    });
  }

  /* ─────────────────────── delegated event handling ──────────────── */
  function onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'back') { e.preventDefault(); popPage(); return; }
    if (act === 'close') { e.preventDefault(); closePanel(); return; }
    const page = btn.closest('.tg-page');
    if (page && typeof page.__onAct === 'function') {
      try { page.__onAct(act, btn, e); } catch (err) { console.error(err); }
    }
  }

  function onPanelChange(e) {
    const inp = e.target.closest('input[data-tg]');
    if (!inp) return;
    const page = inp.closest('.tg-page');
    if (page && typeof page.__onToggle === 'function') {
      try { page.__onToggle(inp.getAttribute('data-tg'), !!inp.checked, inp); } catch (err) { console.error(err); }
    }
  }

  function onPanelInput(e) {
    const inp = e.target.closest('[data-search]');
    if (!inp) return;
    const page = inp.closest('.tg-page');
    if (page && typeof page.__onSearch === 'function') {
      try { page.__onSearch(inp.getAttribute('data-search'), inp.value, inp); } catch (err) { console.error(err); }
    }
  }

  /* ─────────────────────────── info page ─────────────────────────── */
  function linkDisplay(link) {
    return String(link || '').replace(/^https?:\/\//, '');
  }

  function quickBtn(act, icon, label, muted) {
    return '<button type="button" class="tg-quick-btn' + (muted ? ' is-muted' : '') + '" data-act="' + escA(act) + '">' + I(icon) + '<span>' + escT(label) + '</span></button>';
  }

  function tabsHTML(isCh) {
    const tabs = isCh
      ? [['media', 'رسانه'], ['files', 'فایل‌ها'], ['links', 'لینک‌ها'], ['music', 'موسیقی'], ['voice', 'صدا'], ['gif', 'GIF']]
      : [['members', 'اعضا'], ['media', 'رسانه'], ['files', 'فایل‌ها'], ['links', 'لینک‌ها'], ['music', 'موسیقی'], ['voice', 'صدا'], ['gif', 'GIF']];
    return '<div class="tg-tabs" role="tablist" aria-label="محتوای گروه">' +
      tabs.map(([id, lbl]) => '<button type="button" class="tg-tab" role="tab" data-act="tab" data-tab="' + id + '" aria-selected="false">' + escT(lbl) + '</button>').join('') +
      '</div>';
  }

  function memberCellHTML(m, opts) {
    opts = opts || {};
    const roleTag = m.role === 'owner' ? '<span class="tg-cell-tag is-owner">مالک</span>'
      : m.role === 'admin' ? '<span class="tg-cell-tag">' + escT(m.title || 'ادمین') + '</span>' : '';
    let sub = m.online ? 'آنلاین' : 'آخرین بازدید اخیراً';
    if (m.restriction) sub = 'محدود شده';
    return '<button type="button" class="tg-cell" data-act="member" data-username="' + escA(m.username) + '"' + (opts.select ? ' data-select="1"' : '') + '>' +
      '<span class="tg-cell-av">' + avHTML(m, 'md') + (m.online ? '<span class="tg-online-dot" aria-hidden="true"></span>' : '') + '</span>' +
      '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(m.displayName || m.username) + '</span>' +
      '<span class="tg-cell-sub">' + escT(sub) + '</span></span>' +
      (opts.select ? '<span class="tg-check" aria-hidden="true">' + I('check') + '</span>' : roleTag) +
      '</button>';
  }

  async function buildInfoPage() {
    const page = makePage();
    const info = S.info, s = S.settings;
    const isCh = S.isChannel;
    const flags = (typeof chatFlags === 'function' ? chatFlags(S.rid) : {}) || {};
    const muted = !!flags.muted;
    const subtitle = isCh
      ? faGroup(info.memberCount) + ' مشترک'
      : faGroup(info.memberCount) + ' عضو، ' + faNum(info.onlineCount) + ' آنلاین';

    let h = topbarHTML({
      close: true,
      title: isCh ? 'اطلاعات کانال' : 'اطلاعات گروه',
      actions: S.isStaff ? [{ act: 'edit', icon: 'edit-3', label: 'ویرایش' }] : [{ act: 'more', icon: 'more-vertical', label: 'بیشتر' }],
    });
    h += '<div class="tg-scroll">';

    /* hero */
    h += '<div class="tg-hero">';
    h += '<div class="tg-hero-av" data-act="hero-av" role="button" tabindex="0" aria-label="تصویر پروفایل">';
    h += info.avatar ? '<img src="' + escA(info.avatar) + '" alt="">' : escT((info.name || '?').slice(0, 1));
    if (S.isStaff) h += '<span class="tg-av-edit">' + I('edit-3') + '</span>';
    h += '</div>';
    h += '<h1 class="tg-hero-name">' + escT(info.name) + '</h1>';
    h += '<div class="tg-hero-sub">' + escT(subtitle) + '</div>';
    h += '</div>';

    /* quick actions */
    h += '<div class="tg-quick">';
    if (isCh) h += quickBtn('share', 'share', 'اشتراک‌گذاری');
    else h += quickBtn('add-members', 'user-plus', 'افزودن عضو');
    h += quickBtn('search', 'search', 'جستجو');
    h += quickBtn('mute', muted ? 'volume-2' : 'volume-x', muted ? 'صدا دار' : 'بی‌صدا', muted);
    h += quickBtn('more', 'more-horizontal', 'بیشتر');
    h += '</div>';

    /* info card */
    let infoBody = '';
    infoBody += rowHTML({ icon: 'link', tone: 'blue', title: 'لینک', value: linkDisplay(info.inviteLink), act: 'copy-link' });
    infoBody += rowHTML({ icon: 'hash', tone: 'purple', title: 'آیدی', value: info.username ? '@' + info.username : 'ندارد', ltr: !!info.username, act: info.username ? 'copy-username' : null, static: !info.username });
    if (info.description) {
      infoBody += rowHTML({ icon: 'info', tone: 'green', title: 'توضیحات', sub: info.description, act: 'toggle-desc', go: true });
    } else if (S.isStaff) {
      infoBody += rowHTML({ icon: 'info', tone: 'green', title: 'توضیحات', sub: 'افزودن توضیح', act: 'edit' });
    }
    h += sectionHTML({ body: infoBody });

    /* notifications */
    h += sectionHTML({
      body: rowHTML({ icon: 'bell', tone: 'orange', title: 'اعلان‌ها', sub: muted ? 'خاموش' : 'فعال', toggle: 'muted', on: !muted }),
      foot: muted ? 'اعلان‌های این گفتگو خاموش است.' : 'اعلان‌های این گفتگو روشن است.',
    });

    /* tabs */
    h += tabsHTML(isCh);
    h += '<div id="tg-tab-body">' + skeletonRows(4) + '</div>';

    /* danger zone */
    let dangerBody = '';
    if (S.isOwner) {
      dangerBody += rowHTML({ icon: 'trash-2', tone: 'red', title: isCh ? 'حذف کانال' : 'حذف گروه', act: 'delete', danger: true });
    } else {
      dangerBody += rowHTML({ icon: 'log-out', tone: 'red', title: isCh ? 'ترک کانال' : 'ترک گروه', act: 'leave', danger: true });
    }
    h += sectionHTML({ body: dangerBody });
    h += '</div>';

    page.innerHTML = h;
    reloadIcons(page);

    const tabBody = page.querySelector('#tg-tab-body');
    let activeTab = isCh ? 'media' : 'members';
    let descOpen = false;

    function selectTab(kind) {
      activeTab = kind;
      page.querySelectorAll('.tg-tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === kind ? 'true' : 'false'));
      loadTab(kind);
    }

    async function loadTab(kind) {
      tabBody.innerHTML = skeletonRows(5);
      try {
        if (kind === 'members') {
          const d = await svc.listMembers();
          S.members = d.members || [];
          renderMembersTab();
        } else {
          const d = await svc.listMedia(kind);
          renderMediaTab(kind, d.items || []);
        }
      } catch (e) {
        tabBody.innerHTML = emptyHTML('alert-triangle', e.message || 'خطا در بارگذاری');
      }
    }

    function renderMembersTab() {
      const list = (S.members || []).slice().sort((a, b) => {
        const rank = (m) => (m.role === 'owner' ? 0 : m.role === 'admin' ? 1 : 2);
        return rank(a) - rank(b) || String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'fa');
      });
      let h2 = '';
      if (S.isStaff) h2 += '<div class="tg-card">' + rowHTML({ icon: 'user-plus', tone: 'blue', title: 'افزودن عضو', act: 'add-members' }) + '</div>';
      const admins = list.filter((m) => m.role === 'admin' || m.role === 'owner');
      const members = list.filter((m) => m.role === 'member');
      if (admins.length) {
        h2 += '<div class="tg-section-head" style="padding:12px 16px 6px">مدیران</div>';
        h2 += '<div class="tg-card">' + admins.map((m) => memberCellHTML(m)).join('') + '</div>';
      }
      if (members.length) {
        h2 += '<div class="tg-section-head" style="padding:12px 16px 6px">' + (S.isChannel ? 'مشترکین' : 'اعضا') + ' <span style="color:var(--on-surface-variant);font-size:13px">' + faGroup(members.length) + '</span></div>';
        h2 += '<div class="tg-card">' + members.map((m) => memberCellHTML(m)).join('') + '</div>';
      }
      if (!list.length) h2 = emptyHTML('users', 'عضوی وجود ندارد');
      tabBody.innerHTML = h2;
      reloadIcons(tabBody);
    }

    function renderMediaTab(kind, items) {
      if (!items.length) {
        const label = { media: 'رسانه‌ای ارسال نشده است', files: 'فایلی ارسال نشده است', links: 'لینکی ارسال نشده است', music: 'موسیقی ارسال نشده است', voice: 'پیام صوتی ارسال نشده است', gif: 'GIF ارسال نشده است' }[kind] || 'موردی نیست';
        tabBody.innerHTML = emptyHTML(kind === 'links' ? 'link' : kind === 'music' ? 'music' : kind === 'voice' ? 'mic' : 'image', label);
        return;
      }
      let h2 = '';
      if (kind === 'media' || kind === 'gif') {
        h2 += '<div class="tg-media-grid">';
        items.forEach((m) => {
          const isImg = m.kind === 'image' || m.kind === 'sticker' || (m.kind === 'gif' && /\.(gif|webp|png|jpe?g)$/i.test(m.src || ''));
          if (isImg && m.src) {
            h2 += '<button type="button" class="tg-media-cell" data-act="media" data-src="' + escA(m.src) + '"><img src="' + escA(m.src) + '" loading="lazy" alt=""><span class="tg-media-kind">' + I(m.kind === 'gif' ? 'film' : 'image') + '</span></button>';
          } else {
            h2 += '<button type="button" class="tg-media-cell" data-act="media" data-src="' + escA(m.src || '') + '"><span class="tg-media-ph">' + I(m.kind === 'video' ? 'film' : 'file') + '</span><span class="tg-media-kind">' + I(m.kind === 'video' ? 'film' : 'file') + escT(m.kind === 'video' ? 'ویدیو' : '') + '</span></button>';
          }
        });
        h2 += '</div>';
      } else if (kind === 'links') {
        h2 += '<div class="tg-card">' + items.map((m) => {
          const url = m.link || (String(m.content || '').match(/https?:\/\/\S+/) || [])[0] || '';
          return '<a class="tg-file-row" href="' + escA(url) + '" target="_blank" rel="noopener noreferrer"><span class="tg-file-ic">' + I('link') + '</span><span class="tg-file-main"><span class="tg-file-name">' + escT(url || m.content) + '</span><span class="tg-file-meta">' + escT(m.fromName || '') + ' · ' + relTime(m.time) + '</span></span></a>';
        }).join('') + '</div>';
      } else {
        h2 += '<div class="tg-card">' + items.map((m) => {
          const iconName = kind === 'music' ? 'music' : kind === 'voice' ? 'mic' : 'file';
          return '<a class="tg-file-row" href="' + escA(m.src || '#') + '" target="_blank" rel="noopener noreferrer"><span class="tg-file-ic">' + I(iconName) + '</span><span class="tg-file-main"><span class="tg-file-name">' + escT(m.name || m.content || 'فایل') + '</span><span class="tg-file-meta">' + escT(m.fromName || '') + (m.size ? ' · ' + fmtSize(m.size) : '') + ' · ' + relTime(m.time) + '</span></span></a>';
        }).join('') + '</div>';
      }
      tabBody.innerHTML = h2;
      reloadIcons(tabBody);
    }

    function openMore() {
      const items = [];
      items.push({ label: 'اشتراک‌گذاری لینک', icon: 'share', value: 'share' });
      if (S.isStaff) {
        items.push({ label: 'ویرایش', icon: 'edit-3', value: 'edit' });
        items.push({ label: 'مجوزها', icon: 'shield', value: 'permissions' });
        items.push({ label: 'ادمین‌ها', icon: 'crown', value: 'admins' });
        items.push({ label: 'لینک‌های دعوت', icon: 'link', value: 'invite-links' });
        items.push({ label: 'واکنش‌ها', icon: 'smile', value: 'reactions' });
        items.push({ label: 'اقدامات اخیر', icon: 'list', value: 'log' });
        items.push({ label: 'درخواست‌های عضویت', icon: 'user-check', value: 'join-requests' });
        items.push({ label: 'کاربران مسدود', icon: 'user-x', value: 'blocked' });
        if (S.isChannel) items.push({ label: 'گروه گفتگو', icon: 'message-circle', value: 'discussion' });
      }
      if (S.isOwner) items.push({ label: S.isChannel ? 'حذف کانال' : 'حذف گروه', icon: 'trash-2', value: 'delete', danger: true });
      else items.push({ label: S.isChannel ? 'ترک کانال' : 'ترک گروه', icon: 'log-out', value: 'leave', danger: true });
      actionSheet({ title: 'بیشتر', items }).then((v) => { if (v) route(v); });
    }

    async function route(v) {
      if (v === 'edit') return pushPage(await buildEditPage());
      if (v === 'permissions') return pushPage(await buildPermissionsPage());
      if (v === 'admins') return pushPage(await buildAdminsPage());
      if (v === 'invite-links') return pushPage(await buildInviteLinksPage());
      if (v === 'reactions') return pushPage(await buildReactionsPage());
      if (v === 'log') return pushPage(await buildLogPage());
      if (v === 'join-requests') return pushPage(await buildJoinRequestsPage());
      if (v === 'blocked') return pushPage(await buildBlockedPage());
      if (v === 'discussion') return pushPage(await buildDiscussionPage());
      if (v === 'add-members') return pushPage(await buildAddMembersPage());
      if (v === 'share') return shareLink();
      if (v === 'leave') return doLeave();
      if (v === 'delete') return doDelete();
    }

    async function shareLink() {
      const link = info.inviteLink;
      if (!link) return toastMsg('لینکی موجود نیست');
      try {
        if (navigator.share) { await navigator.share({ title: info.name, url: link }); return; }
      } catch (e) {}
      copyText(link);
    }

    function copyText(txt) {
      try { navigator.clipboard.writeText(txt).then(() => toastMsg('کپی شد')).catch(() => toastMsg('کپی نشد')); }
      catch (e) { toastMsg('کپی نشد'); }
    }

    async function doLeave() {
      const ok = await confirmDialog({ title: S.isChannel ? 'ترک کانال؟' : 'ترک گروه؟', text: 'دیگر پیامی از این ' + (S.isChannel ? 'کانال' : 'گروه') + ' دریافت نخواهید کرد.', ok: 'ترک', danger: true });
      if (!ok) return;
      try {
        await svc.leave();
        toastMsg(S.isChannel ? 'کانال را ترک کردید' : 'گروه را ترک کردید');
        try { state.groups = state.groups.filter((g) => g.id !== S.gid); } catch (e) {}
        closePanel();
        if (typeof switchNav === 'function') switchNav('chats');
      } catch (e) { toastMsg(e.message); }
    }

    async function doDelete() {
      const ok = await confirmDialog({ title: S.isChannel ? 'حذف کانال؟' : 'حذف گروه؟', text: 'این عمل قابل بازگشت نیست.', ok: 'حذف', danger: true });
      if (!ok) return;
      try {
        await svc.destroy();
        toastMsg('حذف شد');
        try { state.groups = state.groups.filter((g) => g.id !== S.gid); } catch (e) {}
        closePanel();
        if (typeof switchNav === 'function') switchNav('chats');
      } catch (e) { toastMsg(e.message); }
    }

    page.__onAct = async (act, btn) => {
      if (act === 'edit') { pushPage(await buildEditPage()); return; }
      if (act === 'more') { openMore(); return; }
      if (act === 'add-members') { pushPage(await buildAddMembersPage()); return; }
      if (act === 'share') { shareLink(); return; }
      if (act === 'copy-link') { copyText(info.inviteLink); return; }
      if (act === 'copy-username') { copyText('@' + info.username); return; }
      if (act === 'search') { pushPage(await buildMembersSearchPage()); return; }
      if (act === 'mute') {
        actionSheet({
          title: 'بی‌صدا کردن',
          items: [
            { label: 'برای ۱ ساعت', value: 3600e3 },
            { label: 'برای ۸ ساعت', value: 8 * 3600e3 },
            { label: 'برای ۲ روز', value: 2 * 86400e3 },
            { label: 'همیشه', value: 0 },
            { label: 'تنظیمات اعلان', value: 'notif' },
          ],
        }).then(async (v) => {
          if (v == null) return;
          if (v === 'notif') { pushPage(await buildNotifPage()); return; }
          if (typeof setFlag === 'function') setFlag(S.rid, 'muted', true);
          if (v > 0) { try { localStorage.setItem('vx_mute_until_' + S.rid, String(Date.now() + v)); } catch (e) {} }
          toastMsg('بی‌صدا شد');
          refreshInfo();
        });
        return;
      }
      if (act === 'toggle-desc') {
        descOpen = !descOpen;
        const sub = btn.querySelector('.tg-row-sub');
        if (sub) {
          sub.style.whiteSpace = descOpen ? 'normal' : 'nowrap';
          sub.style.overflow = descOpen ? 'visible' : 'hidden';
        }
        btn.classList.toggle('is-open', descOpen);
        return;
      }
      if (act === 'tab') { selectTab(btn.dataset.tab); return; }
      if (act === 'member') {
        const uname = btn.dataset.username;
        const m = (S.members || []).find((x) => x.username === uname);
        openMemberMenu(m);
        return;
      }
      if (act === 'hero-av') { if (S.isStaff) pushPage(await buildEditPage()); return; }
      if (act === 'leave') { doLeave(); return; }
      if (act === 'delete') { doDelete(); return; }
      if (act === 'media') { openMedia(btn.dataset.src); return; }
    };

    page.__onToggle = (key, on) => {
      if (key === 'muted') {
        if (typeof setFlag === 'function') setFlag(S.rid, 'muted', !on);
        toastMsg(on ? 'اعلان‌ها روشن شد' : 'اعلان‌ها خاموش شد');
        refreshInfo();
      }
    };

    function refreshInfo() {
      if (stack.length === 1) openInfo(S.rid);
    }

    function openMemberMenu(m) {
      if (!m) return;
      const items = [{ label: 'مشاهده پروفایل', icon: 'user', value: 'profile' }];
      if (S.isStaff && m.role !== 'owner' && m.username !== (state.me && state.me.username)) {
        if (m.role !== 'admin') items.push({ label: 'ارتقا به ادمین', icon: 'crown', value: 'promote' });
        items.push({ label: 'محدود کردن', icon: 'shield', value: 'restrict' });
        items.push({ label: 'حذف از ' + (S.isChannel ? 'کانال' : 'گروه'), icon: 'user-x', value: 'kick', danger: true });
      }
      actionSheet({ title: m.displayName || m.username, items }).then(async (v) => {
        if (!v) return;
        if (v === 'profile') { closePanel(); if (typeof openProfile === 'function') openProfile(m.username); return; }
        if (v === 'promote') {
          try { await svc.saveAdmin(m.username, { rights: { changeInfo: true, deleteMessages: true, banUsers: true, inviteUsers: true, pinMessages: true, addAdmins: false } }); toastMsg('ادمین شد'); pushPage(await buildAdminRightsPage(m.username)); }
          catch (e) { toastMsg(e.message); }
          return;
        }
        if (v === 'restrict') { pushPage(await buildRestrictPage(m.username)); return; }
        if (v === 'kick') {
          const ok = await confirmDialog({ title: 'حذف ' + (m.displayName || m.username) + '؟', ok: 'حذف', danger: true });
          if (!ok) return;
          try { await svc.removeMember(m.username); toastMsg('حذف شد'); S.members = null; loadTab('members'); } catch (e) { toastMsg(e.message); }
        }
      });
    }

    function openMedia(src) {
      if (!src) return;
      const a = document.createElement('a');
      a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.click();
    }

    selectTab(activeTab);
    return { el: page };
  }

  /* members-only search page (quick action) */
  async function buildMembersSearchPage() {
    const page = makePage();
    let h = topbarHTML({ back: true, title: 'جستجوی اعضا' });
    h += '<div class="tg-scroll">';
    h += '<div class="tg-search">' + I('search') + '<input type="search" data-search="members" placeholder="جستجوی نام یا شناسه" aria-label="جستجوی اعضا"><button type="button" class="tg-search-x" data-act="clear-search" aria-label="پاک کردن">' + I('x') + '</button></div>';
    h += '<div id="tg-ms-body">' + skeletonRows(6) + '</div>';
    h += '</div>';
    page.innerHTML = h;
    reloadIcons(page);
    const body = page.querySelector('#tg-ms-body');
    let all = [];
    try { const d = await svc.listMembers(); all = d.members || []; } catch (e) { body.innerHTML = emptyHTML('alert-triangle', e.message); return { el: page }; }
    function render(q) {
      const term = String(q || '').trim().toLowerCase();
      const list = all.filter((m) => !term || String(m.displayName || '').toLowerCase().includes(term) || String(m.username || '').toLowerCase().includes(term));
      body.innerHTML = list.length ? '<div class="tg-card">' + list.map((m) => memberCellHTML(m)).join('') + '</div>' : emptyHTML('search', 'کاربری یافت نشد');
      reloadIcons(body);
    }
    render('');
    page.__onSearch = (k, v) => render(v);
    page.__onAct = (act) => { if (act === 'clear-search') { const i = page.querySelector('[data-search]'); if (i) { i.value = ''; render(''); } } };
    return { el: page };
  }

  /* ─────────────────────────── edit page ─────────────────────────── */
  const PERM_DEFS = [
    ['sendMessages', 'ارسال پیام', 'message-square', 'blue'],
    ['sendPhotos', 'عکس', 'image', 'green'],
    ['sendVideos', 'ویدیو', 'film', 'purple'],
    ['sendStickers', 'استیکر و GIF', 'sticker', 'orange'],
    ['sendMusic', 'موسیقی', 'music', 'pink'],
    ['sendFiles', 'فایل', 'file', 'blue'],
    ['sendVoice', 'پیام صوتی', 'mic', 'green'],
    ['sendVideoMessages', 'پیام ویدیویی', 'video', 'purple'],
    ['sendPolls', 'نظرسنجی', 'bar-chart-2', 'orange'],
    ['embedLinks', 'پیش‌نمایش لینک', 'link', 'blue'],
    ['addMembers', 'افزودن عضو', 'user-plus', 'green'],
    ['pinMessages', 'پین کردن پیام', 'pin', 'red'],
    ['changeInfo', 'تغییر اطلاعات گروه', 'edit-3', 'purple'],
  ];
  const MEDIA_KEYS = ['sendPhotos', 'sendVideos', 'sendStickers', 'sendMusic', 'sendFiles', 'sendVoice', 'sendVideoMessages', 'sendPolls', 'embedLinks'];

  function permOn(s, k) { return !(s && s.permissions && s.permissions[k] === false); }

  async function buildEditPage() {
    const page = makePage();
    const info = S.info, s = S.settings;
    const isCh = S.isChannel;
    const draft = { name: info.name, description: info.description || '' };
    let dirty = false;

    function paintSave() {
      const btn = page.querySelector('[data-act="save-edit"]');
      if (btn) btn.disabled = !dirty;
    }

    function shell() {
      let h = topbarHTML({
        back: true,
        title: 'ویرایش',
        actions: [{ act: 'save-edit', icon: 'check', label: 'ذخیره', accent: true, disabled: !dirty }],
      });
      h += '<div class="tg-scroll">';

      /* avatar */
      h += '<div class="tg-hero" style="padding-bottom:8px">';
      h += '<div class="tg-hero-av" data-act="pick-avatar" role="button" tabindex="0" aria-label="تغییر تصویر">';
      h += info.avatar ? '<img src="' + escA(info.avatar) + '" alt="">' : escT((info.name || '?').slice(0, 1));
      h += '<span class="tg-av-edit">' + I('camera') + '</span>';
      h += '</div></div>';

      /* name + description */
      h += '<div class="tg-field"><div class="tg-field-label">نام</div>';
      h += '<input class="tg-input" data-edit="name" maxlength="128" value="' + escA(draft.name) + '" placeholder="نام ' + (isCh ? 'کانال' : 'گروه') + '" aria-label="نام">';
      h += '<div class="tg-field-meta"><span>حداکثر ۱۲۸ کاراکتر</span><span>' + faNum(draft.name.length) + '/۱۲۸</span></div></div>';

      h += '<div class="tg-field"><div class="tg-field-label">توضیحات</div>';
      h += '<textarea class="tg-textarea" data-edit="description" maxlength="255" rows="2" placeholder="توضیح کوتاه درباره این ' + (isCh ? 'کانال' : 'گروه') + '" aria-label="توضیحات">' + escT(draft.description) + '</textarea>';
      h += '<div class="tg-field-meta"><span>حداکثر ۲۵۵ کاراکتر</span><span data-desc-count>' + faNum(draft.description.length) + '/۲۵۵</span></div></div>';

      /* type */
      h += sectionHTML({
        head: isCh ? 'نوع کانال' : 'نوع گروه',
        body: rowHTML({
          icon: 'globe', tone: 'blue',
          title: info.visibility === 'public' ? 'عمومی' : 'خصوصی',
          sub: info.visibility === 'public' ? 'همه می‌توانند پیدا کنند' : 'فقط با لینک دعوت',
          go: true, act: 'open-type',
        }),
      });

      /* behavior */
      let beh = '';
      if (!isCh) beh += rowHTML({ icon: 'eye-off', tone: 'orange', title: 'سابقه چت برای اعضای جدید', sub: s.historyVisible ? 'قابل مشاهده' : 'پنهان', toggle: 'historyVisible', on: !!s.historyVisible });
      beh += rowHTML({ icon: 'shield', tone: 'green', title: 'مجوزها', sub: permSummary(), go: true, act: 'open-perms' });
      beh += rowHTML({ icon: 'crown', tone: 'orange', title: 'ادمین‌ها', value: faNum(info.staffCount || 0), go: true, act: 'open-admins' });
      beh += rowHTML({ icon: 'users', tone: 'blue', title: isCh ? 'مشترکین' : 'اعضا', value: faGroup(info.memberCount), go: true, act: 'open-members' });
      beh += rowHTML({ icon: 'link', tone: 'purple', title: 'لینک‌های دعوت', go: true, act: 'open-invites' });
      beh += rowHTML({ icon: 'smile', tone: 'pink', title: 'واکنش‌ها', sub: reactionsLabel(), go: true, act: 'open-reactions' });
      if (!isCh) beh += rowHTML({ icon: 'gauge', tone: 'red', title: 'حالت آهسته', value: slowLabel(), go: true, act: 'open-slow' });
      beh += rowHTML({ icon: 'lock', tone: 'orange', title: 'محتوای محافظت‌شده', sub: 'ممنوعیت کپی، فوروارد و ذخیره', toggle: 'protectedContent', on: !!s.protectedContent });
      beh += rowHTML({ icon: 'user-check', tone: 'green', title: 'تأیید عضویت', sub: 'ورود با تأیید مدیر', toggle: 'joinByRequest', on: !!s.joinByRequest });
      h += sectionHTML({ body: beh });

      if (isCh) {
        let ch = '';
        ch += rowHTML({ icon: 'pen-tool', tone: 'blue', title: 'امضای پیام‌ها', toggle: 'signMessages', on: !!s.signMessages });
        ch += rowHTML({ icon: 'users', tone: 'green', title: 'نمایش نام ادمین‌ها', toggle: 'showAdminNames', on: !!s.showAdminNames });
        ch += rowHTML({ icon: 'message-circle', tone: 'purple', title: 'گروه گفتگو', sub: discussionLabel(), go: true, act: 'open-discussion' });
        ch += rowHTML({ icon: 'volume-x', tone: 'orange', title: 'ارسال بی‌صدا به‌صورت پیش‌فرض', toggle: 'silentSendDefault', on: !!s.silentSendDefault });
        h += sectionHTML({ head: 'تنظیمات کانال', body: ch });
      }

      h += '</div>';
      return h;
    }

    function permSummary() {
      const on = PERM_DEFS.filter(([k]) => permOn(s, k)).length;
      return faNum(on) + '/' + faNum(PERM_DEFS.length);
    }
    function reactionsLabel() {
      const r = s.reactions || { mode: 'all' };
      return r.mode === 'all' ? 'همه' : r.mode === 'none' ? 'هیچ' : faNum((r.set || []).length) + ' واکنش';
    }
    function slowLabel() {
      const v = s.slowMode || 0;
      if (!v) return 'خاموش';
      if (v < 60) return faNum(v) + ' ثانیه';
      if (v < 3600) return faNum(Math.round(v / 60)) + ' دقیقه';
      return faNum(Math.round(v / 3600)) + ' ساعت';
    }
    function discussionLabel() {
      if (!s.discussionGroupId) return 'متصل نیست';
      const g = (state.groups || []).find((x) => x.id === s.discussionGroupId);
      return g ? g.name : 'متصل';
    }

    function render() { page.innerHTML = shell(); reloadIcons(page); }

    async function saveNameDesc() {
      try {
        const body = {};
        if (draft.name !== info.name) body.name = draft.name.trim();
        if (draft.description !== (info.description || '')) body.description = draft.description.trim();
        if (!Object.keys(body).length) { dirty = false; paintSave(); return; }
        const d = await svc.updateInfo(body);
        if (d.group) { info.name = d.group.name; info.description = d.group.description || ''; }
        dirty = false; paintSave(); syncGroupToState();
        toastMsg('ذخیره شد');
      } catch (e) { toastMsg(e.message); }
    }

    async function patchSetting(key, val, prev) {
      s[key] = val;
      try { await svc.updateSettings({ [key]: val }); }
      catch (e) { s[key] = prev; toastMsg(e.message); render(); }
    }

    function openSlow() {
      const opts = [[0, 'خاموش'], [10, '۱۰ ثانیه'], [30, '۳۰ ثانیه'], [60, '۱ دقیقه'], [300, '۵ دقیقه'], [900, '۱۵ دقیقه'], [3600, '۱ ساعت']];
      actionSheet({
        title: 'حالت آهسته',
        items: opts.map(([v, l]) => ({ label: l, value: v, checked: (s.slowMode || 0) === v })),
      }).then(async (v) => {
        if (v == null) return;
        const prev = s.slowMode; s.slowMode = v; render();
        try { await svc.updateSettings({ slowMode: v }); toastMsg('ذخیره شد'); }
        catch (e) { s.slowMode = prev; toastMsg(e.message); render(); }
      });
    }

    async function pickAvatar() {
      const v = await actionSheet({
        title: 'تصویر ' + (isCh ? 'کانال' : 'گروه'),
        items: [{ label: 'انتخاب عکس', icon: 'image', value: 'pick' }, { label: 'حذف عکس', icon: 'trash-2', value: 'clear', danger: true }],
      });
      if (!v) return;
      if (v === 'clear') {
        try { await svc.updateInfo({ avatar: '' }); info.avatar = null; render(); syncGroupToState(); toastMsg('حذف شد'); } catch (e) { toastMsg(e.message); }
        return;
      }
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return;
        let file = f;
        try { file = await cropImage(f); } catch (e) {}
        try {
          const r = await svc.uploadAvatar(file);
          if (r && r.ok) { info.avatar = r.avatar; render(); syncGroupToState(); toastMsg('تصویر به‌روز شد'); }
          else toastMsg((r && r.error) || 'بارگذاری نشد');
        } catch (e) { toastMsg(e.message); }
      };
      inp.click();
    }

    render();

    page.__onAct = async (act, btn) => {
      if (act === 'save-edit') { saveNameDesc(); return; }
      if (act === 'pick-avatar') { pickAvatar(); return; }
      if (act === 'open-type') { pushPage(await buildTypePage()); return; }
      if (act === 'open-perms') { pushPage(await buildPermissionsPage()); return; }
      if (act === 'open-admins') { pushPage(await buildAdminsPage()); return; }
      if (act === 'open-members') { pushPage(await buildMembersPage()); return; }
      if (act === 'open-invites') { pushPage(await buildInviteLinksPage()); return; }
      if (act === 'open-reactions') { pushPage(await buildReactionsPage()); return; }
      if (act === 'open-slow') { openSlow(); return; }
      if (act === 'open-discussion') { pushPage(await buildDiscussionPage()); return; }
    };

    page.__onToggle = async (key, on) => {
      const prev = s[key];
      s[key] = on;
      try { await svc.updateSettings({ [key]: on }); }
      catch (e) { s[key] = prev; toastMsg(e.message); render(); }
    };

    page.addEventListener('input', (e) => {
      const f = e.target.closest('[data-edit]');
      if (!f) return;
      const k = f.getAttribute('data-edit');
      draft[k] = f.value;
      if (k === 'description') {
        const c = page.querySelector('[data-desc-count]');
        if (c) c.textContent = faNum(f.value.length) + '/۲۵۵';
        f.style.height = 'auto';
        f.style.height = Math.min(220, f.scrollHeight) + 'px';
      }
      dirty = draft.name !== info.name || draft.description !== (info.description || '');
      paintSave();
    });

    return { el: page };
  }

  /* ─────────────────────── crop (canvas, circle) ─────────────────── */
  function cropImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scrim = el('div', 'tg-dialog-scrim');
        scrim.innerHTML =
          '<div class="tg-dialog" role="dialog" aria-modal="true" style="max-width:460px">' +
            '<div class="tg-dialog-body" style="padding:16px">' +
              '<div class="tg-dialog-title">برش تصویر</div>' +
              '<div class="tg-crop-stage" style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:50%;background:#000;touch-action:none;cursor:grab">' +
                '<img alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center">' +
              '</div>' +
              '<input type="range" min="1" max="3" step="0.01" value="1" data-crop="zoom" style="width:100%;margin-top:14px">' +
            '</div>' +
            '<div class="tg-dialog-actions">' +
              '<button type="button" class="tg-btn" data-d="0">انصراف</button>' +
              '<button type="button" class="tg-btn is-primary" data-d="1">ذخیره</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(scrim);
        requestAnimationFrame(() => scrim.classList.add('is-open'));
        const stage = scrim.querySelector('.tg-crop-stage');
        const im = stage.querySelector('img');
        im.src = url;
        let zoom = 1, ox = 0, oy = 0;
        function paint() { im.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + zoom + ')'; }
        scrim.querySelector('[data-crop="zoom"]').oninput = (e) => { zoom = +e.target.value; paint(); };
        let drag = null;
        stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - ox, y: e.clientY - oy }; stage.setPointerCapture(e.pointerId); });
        stage.addEventListener('pointermove', (e) => { if (!drag) return; ox = e.clientX - drag.x; oy = e.clientY - drag.y; paint(); });
        stage.addEventListener('pointerup', () => { drag = null; });
        const done = (ok) => {
          scrim.classList.remove('is-open');
          setTimeout(() => scrim.remove(), 180);
          if (!ok) { URL.revokeObjectURL(url); reject(new Error('cancel')); return; }
          try {
            const size = 512;
            const c = document.createElement('canvas'); c.width = size; c.height = size;
            const ctx = c.getContext('2d');
            const rect = stage.getBoundingClientRect();
            const scale = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight) * zoom;
            const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
            const cx = (rect.width - dw) / 2 + ox, cy = (rect.height - dh) / 2 + oy;
            const k = size / rect.width;
            ctx.drawImage(img, cx * k, cy * k, dw * k, dh * k);
            c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(new File([b], 'avatar.jpg', { type: 'image/jpeg' })) : reject(new Error('crop')); }, 'image/jpeg', 0.9);
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        scrim.querySelector('[data-d="0"]').onclick = () => done(false);
        scrim.querySelector('[data-d="1"]').onclick = () => done(true);
        scrim.onclick = (e) => { if (e.target === scrim) done(false); };
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  /* ─────────────────────────── type page ─────────────────────────── */
  async function buildTypePage() {
    const page = makePage();
    const info = S.info;
    let vis = info.visibility === 'public' ? 'public' : 'private';
    let uname = info.username || '';
    let available = null, checking = false;
    let saveBtn = null;

    function shell() {
      let h = topbarHTML({ back: true, title: S.isChannel ? 'نوع کانال' : 'نوع گروه' });
      h += '<div class="tg-scroll">';
      h += sectionHTML({
        body:
          rowHTML({ icon: 'lock', tone: 'orange', title: 'خصوصی', sub: 'فقط با لینک دعوت', radio: true, checked: vis === 'private', act: 'vis-private' }) +
          rowHTML({ icon: 'globe', tone: 'blue', title: 'عمومی', sub: 'همه می‌توانند پیدا کنند', radio: true, checked: vis === 'public', act: 'vis-public' }),
        foot: vis === 'public' ? 'این ' + (S.isChannel ? 'کانال' : 'گروه') + ' در جستجو و فهرست عمومی دیده می‌شود.' : 'فقط افرادی که لینک دعوت دارند می‌توانند عضو شوند.',
      });
      if (vis === 'public') {
        h += '<div class="tg-field"><div class="tg-field-label">نام کاربری عمومی</div>';
        h += '<div class="tg-prefix-wrap"><span class="tg-prefix">vortexgram.onrender.com/</span><input class="tg-input" data-type="uname" dir="ltr" maxlength="20" value="' + escA(uname) + '" placeholder="username" aria-label="نام کاربری"></div>';
        h += '<div class="tg-field-meta"><span data-uname-msg></span><span>' + faNum(uname.length) + '/۲۰</span></div></div>';
      } else {
        h += '<div class="tg-link-card"><span class="tg-link-txt" data-link-txt>' + escT(linkDisplay(info.inviteLink)) + '</span>' +
          '<button type="button" class="tg-iconbtn" data-act="copy-invite" aria-label="کپی">' + I('copy') + '</button>' +
          '<button type="button" class="tg-iconbtn" data-act="share-invite" aria-label="اشتراک‌گذاری">' + I('share') + '</button></div>';
      }
      h += sectionHTML({
        body: rowHTML({ icon: 'lock', tone: 'red', title: 'ذخیره محتوا', sub: 'محدود کردن کپی و ذخیره', toggle: 'protectedContent', on: !!S.settings.protectedContent }),
      });
      h += '<div class="tg-btn-row"><button type="button" class="tg-btn is-primary" data-act="save-type" disabled>ذخیره</button></div>';
      h += '</div>';
      return h;
    }

    function render() { page.innerHTML = shell(); reloadIcons(page); saveBtn = page.querySelector('[data-act="save-type"]'); updateSave(); }
    function updateSave() {
      if (!saveBtn) return;
      const changed = vis !== (info.visibility === 'public' ? 'public' : 'private') || (vis === 'public' && uname !== (info.username || ''));
      saveBtn.disabled = !changed || (vis === 'public' && (!uname || available !== true));
    }

    function unameMsg() {
      const m = page.querySelector('[data-uname-msg]');
      if (!m) return;
      if (!uname) { m.textContent = ''; m.className = ''; return; }
      if (!/^[a-z][a-z0-9_]{2,19}$/.test(uname)) { m.textContent = '۳ تا ۲۰ کاراکتر، شروع با حرف، فقط a-z 0-9 _'; m.className = 'tg-bad'; return; }
      if (checking) { m.textContent = 'در حال بررسی…'; m.className = ''; return; }
      if (available === true) { m.textContent = uname + ' در دسترس است'; m.className = 'tg-ok'; return; }
      if (available === false) { m.textContent = 'قبلاً گرفته شده'; m.className = 'tg-bad'; }
    }

    const check = debounce(async () => {
      if (!uname) { available = null; unameMsg(); updateSave(); return; }
      if (!/^[a-z][a-z0-9_]{2,19}$/.test(uname)) { available = false; unameMsg(); updateSave(); return; }
      checking = true; unameMsg();
      try { const d = await svc.checkUsername(uname); available = !!d.available; }
      catch (e) { available = null; }
      checking = false; unameMsg(); updateSave();
    }, 400);

    render();

    page.__onAct = async (act) => {
      if (act === 'vis-private') { vis = 'private'; render(); return; }
      if (act === 'vis-public') { vis = 'public'; render(); check(); return; }
      if (act === 'copy-invite') { copyText(info.inviteLink); return; }
      if (act === 'share-invite') {
        try { if (navigator.share) { await navigator.share({ title: info.name, url: info.inviteLink }); return; } } catch (e) {}
        copyText(info.inviteLink); return;
      }
      if (act === 'save-type') {
        try {
          const body = { visibility: vis };
          if (vis === 'public') body.username = uname;
          const d = await svc.updateInfo(body);
          if (d.group) { info.visibility = d.group.visibility || vis; info.username = d.group.username || null; }
          else { info.visibility = vis; info.username = vis === 'public' ? uname : null; }
          toastMsg('ذخیره شد'); syncGroupToState(); popPage();
        } catch (e) { toastMsg(e.message); }
      }
    };

    page.addEventListener('input', (e) => {
      const f = e.target.closest('[data-type="uname"]');
      if (!f) return;
      uname = f.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (f.value !== uname) f.value = uname;
      available = null; updateSave(); unameMsg(); check();
    });

    page.__onToggle = async (key, on) => {
      const prev = S.settings[key]; S.settings[key] = on;
      try { await svc.updateSettings({ [key]: on }); } catch (e) { S.settings[key] = prev; toastMsg(e.message); render(); }
    };

    return { el: page };
  }

  function copyText(txt) {
    try { navigator.clipboard.writeText(txt).then(() => toastMsg('کپی شد')).catch(() => toastMsg('کپی نشد')); }
    catch (e) { toastMsg('کپی نشد'); }
  }

  /* ─────────────────────── permissions page ──────────────────────── */
  async function buildPermissionsPage() {
    const page = makePage();
    const s = S.settings;
    if (!s.permissions) s.permissions = {};
    let mediaOpen = false;
    let exceptions = null;

    function isOn(k) { return permOn(s, k); }
    function mediaOn() { return MEDIA_KEYS.every((k) => isOn(k)); }

    function shell() {
      let h = topbarHTML({ back: true, title: 'مجوزها' });
      h += '<div class="tg-scroll">';

      let main = '';
      main += rowHTML({ icon: 'message-square', tone: 'blue', title: 'ارسال پیام', toggle: 'sendMessages', on: isOn('sendMessages') });
      main += rowHTML({ icon: 'image', tone: 'green', title: 'ارسال رسانه', sub: mediaOn() ? 'همه انواع مجاز' : 'برخی محدود شده', toggle: 'media-all', on: mediaOn(), act: 'media-parent' });
      if (mediaOpen) {
        MEDIA_KEYS.forEach(([k, label, icon, tone]) => {
          main += '<div style="padding-inline-start:44px;opacity:' + (mediaOn() ? 1 : .5) + '">' +
            rowHTML({ icon, tone, title: label, toggle: k, on: isOn(k), disabled: false }) + '</div>';
        });
      }
      main += rowHTML({ icon: 'user-plus', tone: 'green', title: 'افزودن عضو', toggle: 'addMembers', on: isOn('addMembers') });
      main += rowHTML({ icon: 'pin', tone: 'red', title: 'پین کردن پیام', toggle: 'pinMessages', on: isOn('pinMessages') });
      main += rowHTML({ icon: 'edit-3', tone: 'purple', title: 'تغییر اطلاعات گروه', toggle: 'changeInfo', on: isOn('changeInfo') });

      h += sectionHTML({ head: 'اعضا چه کارهایی می‌توانند انجام دهند؟', body: main });

      let ex = '';
      if (exceptions && exceptions.length) {
        ex += rowHTML({ icon: 'trash-2', tone: 'red', title: 'حذف همه استثناها', act: 'clear-exceptions', danger: true });
      }
      h += sectionHTML({
        head: 'استثناها',
        body: ex || rowHTML({ icon: 'shield', tone: 'orange', title: 'افزودن استثنا', sub: 'محدودیت برای یک عضو خاص', act: 'add-exception', go: true }),
        foot: 'استثناها فقط روی همان عضو اعمال می‌شوند.',
      });
      h += '</div>';
      return h;
    }

    function render() { page.innerHTML = shell(); reloadIcons(page); loadExceptions(); }

    async function loadExceptions() {
      try {
        const d = await svc.getInfo();
        S.settings.exceptions = d.settings.exceptions || {};
        exceptions = Object.keys(S.settings.exceptions).map((u) => {
          const e = S.settings.exceptions[u];
          const member = (S.members || []).find((m) => m.username === u);
          return { username: u, displayName: (member && member.displayName) || u, exception: e };
        });
        const host = page.querySelector('#tg-ex-list');
        if (host) {
          host.innerHTML = exceptions.map((x) => memberCellHTML({ username: x.username, displayName: x.displayName, role: 'member', restriction: x.exception })).join('');
          reloadIcons(host);
        }
      } catch (e) {}
    }

    async function persistPerms() {
      try { await svc.updateSettings({ permissions: s.permissions }); }
      catch (e) { toastMsg(e.message); }
    }

    async function setAllMedia(on) {
      MEDIA_KEYS.forEach((k) => { s.permissions[k] = on; });
      render(); await persistPerms();
    }

    render();

    page.__onAct = async (act, btn) => {
      if (act === 'media-parent') { mediaOpen = !mediaOpen; render(); return; }
      if (act === 'clear-exceptions') {
        const ok = await confirmDialog({ title: 'حذف همه استثناها؟', ok: 'حذف', danger: true });
        if (!ok) return;
        try {
          const names = Object.keys(s.exceptions || {});
          for (const n of names) await svc.restrict(n, { clear: true });
          s.exceptions = {}; toastMsg('حذف شد'); render();
        } catch (e) { toastMsg(e.message); }
        return;
      }
      if (act === 'add-exception') {
        const d = await svc.listMembers();
        const existing = new Set(Object.keys(s.exceptions || {}));
        const list = (d.members || []).filter((m) => m.role !== 'owner' && !existing.has(m.username));
        pushPage(await buildMemberPickerPage({
          title: 'افزودن استثنا',
          members: list,
          onPick: async (uname) => { pushPage(await buildRestrictPage(uname)); },
        }));
        return;
      }
    };

    page.__onToggle = async (key, on) => {
      if (key === 'media-all') { setAllMedia(on); return; }
      s.permissions[key] = on;
      render();
      await persistPerms();
    };

    return { el: page };
  }

  /* ──────────────────────── restrict page ────────────────────────── */
  async function buildRestrictPage(username) {
    const page = makePage();
    const s = S.settings;
    const cur = (s.exceptions && s.exceptions[username]) || { permissions: {}, until: null };
    const perms = Object.assign({}, cur.permissions);
    let until = cur.until || null;

    function isOn(k) { return perms[k] !== false; }
    function untilLabel() {
      if (!until) return 'برای همیشه';
      const left = until - Date.now();
      if (left <= 0) return 'منقضی شده';
      if (left < 86400e3) return faNum(Math.ceil(left / 3600e3)) + ' ساعت';
      return faNum(Math.ceil(left / 86400e3)) + ' روز';
    }

    function shell() {
      let h = topbarHTML({ back: true, title: 'محدود کردن', sub: '@' + username });
      h += '<div class="tg-scroll">';
      let body = '';
      PERM_DEFS.forEach(([k, label, icon, tone]) => {
        body += rowHTML({ icon, tone, title: label, toggle: 'r-' + k, on: isOn(k) });
      });
      h += sectionHTML({ head: 'اجازه‌ها', body });
      h += sectionHTML({
        body: rowHTML({ icon: 'calendar', tone: 'orange', title: 'مدت محدودیت', value: untilLabel(), act: 'pick-until', go: true }) +
              rowHTML({ icon: 'check', tone: 'green', title: 'حذف محدودیت', act: 'clear-restrict', danger: true }),
      });
      h += '<div class="tg-btn-row"><button type="button" class="tg-btn is-primary" data-act="save-restrict">ذخیره</button></div>';
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();

    page.__onAct = async (act) => {
      if (act === 'pick-until') {
        const v = await actionSheet({
          title: 'مدت محدودیت',
          items: [
            { label: 'برای همیشه', value: 0 },
            { label: '۱ روز', value: 86400e3 },
            { label: '۱ هفته', value: 7 * 86400e3 },
            { label: '۱ ماه', value: 30 * 86400e3 },
            { label: 'سفارشی…', value: 'custom' },
          ],
        });
        if (v == null) return;
        if (v === 'custom') {
          const days = await promptDialog({ title: 'چند روز؟', value: '3', ok: 'تأیید' });
          if (days == null) return;
          const n = Math.max(1, Math.min(365, parseInt(days, 10) || 1));
          until = Date.now() + n * 86400e3;
        } else if (v === 0) until = null;
        else until = Date.now() + v;
        render(); return;
      }
      if (act === 'clear-restrict') {
        try { await svc.restrict(username, { clear: true }); delete s.exceptions[username]; toastMsg('محدودیت برداشته شد'); popPage(); }
        catch (e) { toastMsg(e.message); }
        return;
      }
      if (act === 'save-restrict') {
        try {
          const d = await svc.restrict(username, { permissions: perms, until });
          s.exceptions = s.exceptions || {};
          if (d.exception) s.exceptions[username] = d.exception; else delete s.exceptions[username];
          toastMsg('ذخیره شد'); popPage();
        } catch (e) { toastMsg(e.message); }
      }
    };

    page.__onToggle = (key, on) => {
      if (!key.startsWith('r-')) return;
      const k = key.slice(2);
      perms[k] = on;
      render();
    };

    return { el: page };
  }

  /* ───────────────────────── admins page ─────────────────────────── */
  async function buildAdminsPage() {
    const page = makePage();
    let admins = null;
    const s = S.settings;

    function shell() {
      let h = topbarHTML({ back: true, title: 'ادمین‌ها' });
      h += '<div class="tg-scroll">';
      if (S.isOwner) {
        h += sectionHTML({ body: rowHTML({ icon: 'user-plus', tone: 'green', title: 'افزودن ادمین', act: 'add-admin' }) });
      }
      if (admins == null) {
        h += '<div class="tg-card">' + skeletonRows(3) + '</div>';
      } else if (!admins.length) {
        h += emptyHTML('crown', 'ادمینی وجود ندارد');
      } else {
        h += '<div class="tg-card" id="tg-admins-list">' + admins.map(adminCell).join('') + '</div>';
      }
      h += '</div>';
      return h;
    }

    function adminCell(a) {
      const isOwner = a.role === 'owner';
      const tag = isOwner ? 'مالک' : (a.title || 'ادمین');
      return '<button type="button" class="tg-cell" data-act="admin" data-username="' + escA(a.username) + '">' +
        '<span class="tg-cell-av">' + avHTML(a, 'md') + (a.online ? '<span class="tg-online-dot"></span>' : '') + '</span>' +
        '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(a.displayName || a.username) + '</span>' +
        '<span class="tg-cell-sub">' + escT(isOwner ? 'مالک ' + (S.isChannel ? 'کانال' : 'گروه') : ('توسط ' + (a.appointedBy || '—') + ' منصوب شد')) + '</span></span>' +
        '<span class="tg-cell-tag' + (isOwner ? ' is-owner' : '') + '">' + escT(tag) + '</span>' +
        '</button>';
    }

    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();

    try { const d = await svc.listAdmins(); admins = d.admins || []; S.admins = admins; }
    catch (e) { admins = []; }
    render();

    page.__onAct = async (act, btn) => {
      if (act === 'add-admin') {
        const d = await svc.listMembers();
        const adminNames = new Set((admins || []).map((a) => a.username));
        const list = (d.members || []).filter((m) => m.role !== 'owner' && !adminNames.has(m.username));
        pushPage(await buildMemberPickerPage({
          title: 'افزودن ادمین',
          members: list,
          onPick: async (uname) => {
            try {
              await svc.saveAdmin(uname, { rights: {} });
              toastMsg('ادمین شد');
              const dd = await svc.listAdmins();
              admins = dd.admins || [];
              S.admins = admins;
              render();
              pushPage(await buildAdminRightsPage(uname));
            } catch (e) { toastMsg(e.message); }
          },
        }));
        return;
      }
      if (act === 'admin') {
        const uname = btn.dataset.username;
        const a = (admins || []).find((x) => x.username === uname);
        if (!a || a.role === 'owner') return;
        pushPage(await buildAdminRightsPage(uname));
        return;
      }
    };

    return { el: page };
  }

  /* ───────────────────── admin rights page ───────────────────────── */
  const RIGHT_DEFS = [
    ['changeInfo', 'تغییر اطلاعات', 'edit-3', 'blue'],
    ['deleteMessages', 'حذف پیام‌ها', 'trash-2', 'red'],
    ['banUsers', 'مسدود کردن کاربران', 'user-x', 'orange'],
    ['inviteUsers', 'دعوت کاربران', 'user-plus', 'green'],
    ['pinMessages', 'پین پیام‌ها', 'pin', 'purple'],
    ['anonymous', 'ناشناس ماندن', 'eye-off', 'pink'],
    ['addAdmins', 'افزودن ادمین جدید', 'crown', 'orange'],
  ];
  const RIGHT_DEFS_CHANNEL = [
    ['postMessages', 'ارسال پیام‌ها', 'send', 'blue'],
    ['editMessages', 'ویرایش پیام‌های دیگران', 'edit-3', 'green'],
    ['deleteOthers', 'حذف پیام‌های دیگران', 'trash-2', 'red'],
  ];

  async function buildAdminRightsPage(username) {
    const page = makePage();
    const a = (S.admins || []).find((x) => x.username === username) || { rights: {}, title: null, displayName: username };
    const rights = Object.assign({}, a.rights || {});
    let title = a.title || '';

    function defs() { return S.isChannel ? RIGHT_DEFS.concat(RIGHT_DEFS_CHANNEL) : RIGHT_DEFS; }

    function shell() {
      let h = topbarHTML({ back: true, title: 'حقوق ادمین', sub: a.displayName || username });
      h += '<div class="tg-scroll">';
      h += '<div class="tg-field"><div class="tg-field-label">عنوان سفارشی</div>' +
        '<input class="tg-input" data-right="title" maxlength="16" value="' + escA(title) + '" placeholder="ادمین" aria-label="عنوان سفارشی">' +
        '<div class="tg-field-meta"><span>حداکثر ۱۶ کاراکتر</span><span>' + faNum(title.length) + '/۱۶</span></div></div>';
      let body = '';
      defs().forEach(([k, label, icon, tone]) => {
        body += rowHTML({ icon, tone, title: label, toggle: 'rt-' + k, on: !!rights[k] });
      });
      h += sectionHTML({ body });
      h += sectionHTML({ body: rowHTML({ icon: 'user-x', tone: 'red', title: 'برکناری ادمین', act: 'demote', danger: true }) });
      h += '<div class="tg-btn-row"><button type="button" class="tg-btn is-primary" data-act="save-rights">ذخیره</button></div>';
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();

    page.__onAct = async (act) => {
      if (act === 'demote') {
        const ok = await confirmDialog({ title: 'برکناری ' + (a.displayName || username) + '؟', ok: 'برکنار', danger: true });
        if (!ok) return;
        try { await svc.removeAdmin(username); toastMsg('برکنار شد'); popPage(); } catch (e) { toastMsg(e.message); }
        return;
      }
      if (act === 'save-rights') {
        try {
          await svc.saveAdmin(username, { rights, title });
          toastMsg('ذخیره شد'); popPage();
        } catch (e) { toastMsg(e.message); }
      }
    };

    page.__onToggle = (key, on) => {
      if (!key.startsWith('rt-')) return;
      rights[key.slice(3)] = on;
      render();
    };

    page.addEventListener('input', (e) => {
      const f = e.target.closest('[data-right="title"]');
      if (!f) return;
      title = f.value.slice(0, 16);
      const c = page.querySelector('.tg-field-meta span:last-child');
      if (c) c.textContent = faNum(title.length) + '/۱۶';
    });

    return { el: page };
  }

  /* ───────────────────────── members page ────────────────────────── */
  async function buildMembersPage() {
    const page = makePage();
    let all = [];
    function shell() {
      let h = topbarHTML({ back: true, title: S.isChannel ? 'مشترکین' : 'اعضا' });
      h += '<div class="tg-scroll">';
      if (S.isStaff) h += '<div class="tg-card">' + rowHTML({ icon: 'user-plus', tone: 'blue', title: 'افزودن عضو', act: 'add-members' }) + '</div>';
      h += '<div class="tg-search">' + I('search') + '<input type="search" data-search="members" placeholder="جستجوی اعضا" aria-label="جستجوی اعضا"><button type="button" class="tg-search-x" data-act="clear-search" aria-label="پاک کردن">' + I('x') + '</button></div>';
      h += '<div id="tg-members-body">' + skeletonRows(6) + '</div>';
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); paint(''); }
    function paint(q) {
      const body = page.querySelector('#tg-members-body');
      if (!body) return;
      const term = String(q || '').trim().toLowerCase();
      const list = all.filter((m) => !term || String(m.displayName || '').toLowerCase().includes(term) || String(m.username || '').toLowerCase().includes(term));
      body.innerHTML = list.length ? '<div class="tg-card">' + list.map((m) => memberCellHTML(m)).join('') + '</div>' : emptyHTML('users', 'کاربری یافت نشد');
      reloadIcons(body);
    }
    render();
    try { const d = await svc.listMembers(); all = d.members || []; S.members = all; } catch (e) {}
    paint('');
    page.__onSearch = (k, v) => paint(v);
    page.__onAct = async (act, btn) => {
      if (act === 'clear-search') { const i = page.querySelector('[data-search]'); if (i) { i.value = ''; paint(''); } return; }
      if (act === 'add-members') { pushPage(await buildAddMembersPage()); return; }
      if (act === 'member') {
        const m = all.find((x) => x.username === btn.dataset.username);
        if (!m) return;
        actionSheet({
          title: m.displayName || m.username,
          items: [
            { label: 'مشاهده پروفایل', icon: 'user', value: 'profile' },
            { label: 'ارسال پیام', icon: 'message-square', value: 'dm' },
          ],
        }).then((v) => {
          if (v === 'profile') { closePanel(); if (typeof openProfile === 'function') openProfile(m.username); }
          if (v === 'dm') { closePanel(); if (typeof openDM === 'function') openDM(m.username); }
        });
      }
    };
    return { el: page };
  }

  /* ─────────────────────── add members page ──────────────────────── */
  async function buildAddMembersPage() {
    const page = makePage();
    let candidates = [];
    const selected = new Map();

    function shell() {
      let h = topbarHTML({ back: true, title: 'افزودن عضو', actions: [{ act: 'confirm-add', icon: 'check', label: 'افزودن', accent: true, disabled: !selected.size }] });
      h += '<div class="tg-scroll">';
      h += '<div class="tg-chips" id="tg-chips">' + chipsHTML() + '</div>';
      h += '<div class="tg-search">' + I('search') + '<input type="search" data-search="cand" placeholder="جستجوی مخاطبین" aria-label="جستجوی مخاطبین"><button type="button" class="tg-search-x" data-act="clear-search" aria-label="پاک کردن">' + I('x') + '</button></div>';
      h += '<div class="tg-section-foot" id="tg-count" style="padding:0 16px 8px">' + (selected.size ? faNum(selected.size) + ' نفر انتخاب شده' : '') + '</div>';
      h += '<div id="tg-cand-body">' + skeletonRows(6) + '</div>';
      h += '</div>';
      h += '<button type="button" class="tg-fab" data-act="confirm-add" aria-label="افزودن">' + I('check') + '</button>';
      return h;
    }
    function chipsHTML() {
      if (!selected.size) return '';
      return Array.from(selected.values()).map((m) =>
        '<span class="tg-chip">' + avHTML(m, 'xs') + '<span class="tg-chip-name">' + escT(m.displayName || m.username) + '</span>' +
        '<button type="button" class="tg-chip-x" data-act="unpick" data-username="' + escA(m.username) + '" aria-label="حذف">' + I('x') + '</button></span>').join('');
    }
    function paint(q) {
      const body = page.querySelector('#tg-cand-body');
      if (!body) return;
      const term = String(q || '').trim().toLowerCase();
      const list = candidates.filter((m) => !term || String(m.displayName || '').toLowerCase().includes(term) || String(m.username || '').toLowerCase().includes(term));
      body.innerHTML = list.length ? '<div class="tg-card">' + list.map((m) => {
        const on = selected.has(m.username);
        return '<button type="button" class="tg-cell' + (on ? ' is-checked' : '') + '" data-act="pick" data-username="' + escA(m.username) + '">' +
          '<span class="tg-cell-av">' + avHTML(m, 'md') + '</span>' +
          '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(m.displayName || m.username) + '</span><span class="tg-cell-sub">@' + escT(m.username) + '</span></span>' +
          '<span class="tg-check">' + I('check') + '</span></button>';
      }).join('') + '</div>' : emptyHTML('users', 'مخاطبی برای افزودن نیست');
      reloadIcons(body);
    }
    function updateChrome() {
      const chips = page.querySelector('#tg-chips'); if (chips) { chips.innerHTML = chipsHTML(); reloadIcons(chips); }
      const cnt = page.querySelector('#tg-count'); if (cnt) cnt.textContent = selected.size ? faNum(selected.size) + ' نفر انتخاب شده' : '';
      const btn = page.querySelector('.tg-topbar [data-act="confirm-add"]'); if (btn) btn.disabled = !selected.size;
    }
    function repaint() {
      updateChrome();
      paint(page.querySelector('[data-search="cand"]') ? page.querySelector('[data-search="cand"]').value : '');
    }

    page.innerHTML = shell(); reloadIcons(page);
    try {
      const d = await svc.listMembers();
      const inGroup = new Set((d.members || []).map((m) => m.username));
      const allUsers = d.allUsers || [];
      candidates = allUsers.filter((u) => !inGroup.has(u.username));
      if (!candidates.length) candidates = (state.users || []).filter((u) => !inGroup.has(u.username));
    } catch (e) {}
    paint('');

    page.__onSearch = (k, v) => paint(v);
    page.__onAct = async (act, btn) => {
      if (act === 'clear-search') { const i = page.querySelector('[data-search]'); if (i) { i.value = ''; paint(''); } return; }
      if (act === 'pick') {
        const u = btn.dataset.username;
        const m = candidates.find((x) => x.username === u);
        if (!m) return;
        if (selected.has(u)) selected.delete(u); else selected.set(u, m);
        btn.classList.toggle('is-checked', selected.has(u));
        updateChrome();
        return;
      }
      if (act === 'unpick') { selected.delete(btn.dataset.username); repaint(); return; }
      if (act === 'confirm-add') {
        if (!selected.size) return;
        const btnTop = page.querySelector('.tg-topbar [data-act="confirm-add"]');
        if (btnTop) btnTop.disabled = true;
        let ok = 0, fail = 0;
        for (const u of selected.keys()) {
          try { await svc.addMember(u); ok++; } catch (e) { fail++; }
        }
        toastMsg(ok ? faNum(ok) + ' نفر اضافه شد' + (fail ? '، ' + faNum(fail) + ' ناموفق' : '') : 'افزودن ناموفق');
        S.members = null;
        popPage();
        return;
      }
    };

    return { el: page };
  }

  /* ───────────────────── generic member picker ───────────────────── */
  async function buildMemberPickerPage(opts) {
    const page = makePage();
    const members = opts.members || [];
    function shell(q) {
      let h = topbarHTML({ back: true, title: opts.title || 'انتخاب عضو' });
      h += '<div class="tg-scroll">';
      h += '<div class="tg-search">' + I('search') + '<input type="search" data-search="pick" placeholder="جستجو" aria-label="جستجو"><button type="button" class="tg-search-x" data-act="clear-search" aria-label="پاک کردن">' + I('x') + '</button></div>';
      h += '<div id="tg-pick-body">' + listHTML(q) + '</div>';
      h += '</div>';
      return h;
    }
    function listHTML(q) {
      const term = String(q || '').trim().toLowerCase();
      const list = members.filter((m) => !term || String(m.displayName || '').toLowerCase().includes(term) || String(m.username || '').toLowerCase().includes(term));
      if (!list.length) return emptyHTML('users', 'کاربری برای انتخاب نیست');
      return '<div class="tg-card">' + list.map((m) => memberCellHTML(m)).join('') + '</div>';
    }
    function render(q) { page.innerHTML = shell(q); reloadIcons(page); }
    render('');
    page.__onSearch = (k, v) => {
      const body = page.querySelector('#tg-pick-body');
      if (body) { body.innerHTML = listHTML(v); reloadIcons(body); }
    };
    page.__onAct = (act, btn) => {
      if (act === 'clear-search') { render(''); return; }
      if (act === 'member') {
        const u = btn.dataset.username;
        popPage();
        if (opts.onPick) setTimeout(() => opts.onPick(u), 40);
      }
    };
    return { el: page };
  }

  /* ─────────────────────── invite links page ─────────────────────── */
  async function buildInviteLinksPage() {
    const page = makePage();
    let data = null;
    function shell() {
      let h = topbarHTML({ back: true, title: 'لینک‌های دعوت' });
      h += '<div class="tg-scroll">';
      if (!data) { h += '<div class="tg-card">' + skeletonRows(3) + '</div>'; }
      else {
        h += '<div class="tg-section-head" style="padding:12px 16px 6px">لینک اصلی</div>';
        h += '<div class="tg-link-card"><span class="tg-link-txt">' + escT(linkDisplay(data.primary && data.primary.link)) + '</span>' +
          '<button type="button" class="tg-iconbtn" data-act="copy-primary" aria-label="کپی">' + I('copy') + '</button>' +
          '<button type="button" class="tg-iconbtn" data-act="share-primary" aria-label="اشتراک‌گذاری">' + I('share') + '</button>' +
          '<button type="button" class="tg-iconbtn" data-act="qr-primary" aria-label="کد QR">' + I('scan') + '</button></div>';

        if (S.isStaff) h += '<div class="tg-card" style="margin:0 16px 10px">' + rowHTML({ icon: 'plus', tone: 'green', title: 'ایجاد لینک جدید', act: 'create-link' }) + '</div>';

        const active = (data.links || []).filter((l) => !l.revoked);
        const revoked = (data.links || []).filter((l) => l.revoked);
        h += '<div class="tg-section-head" style="padding:12px 16px 6px">لینک‌های فعال</div>';
        h += active.length ? '<div class="tg-card">' + active.map(linkRow).join('') + '</div>' : '<div class="tg-section-foot" style="padding:0 16px 8px">لینک فعالی نیست.</div>';
        if (revoked.length) {
          h += '<div class="tg-section-head" style="padding:12px 16px 6px">لینک‌های ابطال‌شده</div>';
          h += '<div class="tg-card">' + revoked.map(linkRow).join('') + '</div>';
        }
      }
      h += '</div>';
      return h;
    }
    function linkRow(l) {
      const uses = l.maxUses ? faNum(l.uses) + '/' + faNum(l.maxUses) : faNum(l.uses || 0) + ' استفاده';
      const exp = l.expiresAt ? relTime(l.expiresAt) : 'بدون انقضا';
      return '<button type="button" class="tg-cell" data-act="link-detail" data-token="' + escA(l.token) + '">' +
        '<span class="tg-cell-av"><span class="tg-row-ic t-blue" style="width:42px;height:42px">' + I('link') + '</span></span>' +
        '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(l.name || linkDisplay(l.link)) + '</span>' +
        '<span class="tg-cell-sub">' + escT(uses + ' · ' + exp) + (l.revoked ? ' · ابطال‌شده' : '') + '</span></span>' +
        '<span class="tg-row-go">' + I(FWD_IC()) + '</span></button>';
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    try { data = await svc.listInviteLinks(); } catch (e) { data = { primary: { link: '' }, links: [] }; }
    render();

    page.__onAct = async (act, btn) => {
      if (act === 'copy-primary') { copyText(data.primary && data.primary.link); return; }
      if (act === 'share-primary') {
        const link = data.primary && data.primary.link;
        try { if (navigator.share) { await navigator.share({ title: S.info.name, url: link }); return; } } catch (e) {}
        copyText(link); return;
      }
      if (act === 'qr-primary') { showQR(data.primary && data.primary.link, S.info.name); return; }
      if (act === 'create-link') { pushPage(await buildInviteCreatePage()); return; }
      if (act === 'link-detail') {
        const l = (data.links || []).find((x) => x.token === btn.dataset.token);
        if (l) pushPage(await buildInviteDetailPage(l));
      }
    };

    return { el: page, refresh: async () => { try { data = await svc.listInviteLinks(); render(); } catch (e) {} } };
  }

  async function buildInviteCreatePage() {
    const page = makePage();
    let name = '';
    let expiresAt = null, maxUses = 0, approve = false;
    function expLabel() { return expiresAt ? relTime(expiresAt) : 'بدون محدودیت'; }
    function usesLabel() { return maxUses ? faNum(maxUses) + ' نفر' : 'بدون محدودیت'; }
    function shell() {
      let h = topbarHTML({ back: true, title: 'ایجاد لینک جدید', actions: [{ act: 'create', icon: 'check', accent: true, label: 'ایجاد' }] });
      h += '<div class="tg-scroll">';
      h += '<div class="tg-field"><div class="tg-field-label">نام لینک (اختیاری)</div><input class="tg-input" data-link="name" maxlength="32" value="' + escA(name) + '" placeholder="مثلاً کمپین بهار" aria-label="نام لینک"></div>';
      let body = '';
      body += rowHTML({ icon: 'calendar', tone: 'orange', title: 'محدودیت زمانی', value: expLabel(), act: 'pick-exp', go: true });
      body += rowHTML({ icon: 'users', tone: 'blue', title: 'محدودیت تعداد', value: usesLabel(), act: 'pick-uses', go: true });
      body += rowHTML({ icon: 'user-check', tone: 'green', title: 'درخواست تأیید', sub: 'ورود نیاز به تأیید مدیر', toggle: 'approve', on: approve });
      h += sectionHTML({ body });
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();

    page.addEventListener('input', (e) => {
      const f = e.target.closest('[data-link="name"]');
      if (f) name = f.value;
    });

    page.__onAct = async (act) => {
      if (act === 'pick-exp') {
        const v = await actionSheet({
          title: 'انقضا',
          items: [
            { label: 'بدون محدودیت', value: 0 },
            { label: '۱ ساعت', value: 3600e3 },
            { label: '۱ روز', value: 86400e3 },
            { label: '۱ هفته', value: 7 * 86400e3 },
            { label: 'سفارشی…', value: 'custom' },
          ],
        });
        if (v == null) return;
        if (v === 'custom') {
          const days = await promptDialog({ title: 'چند روز؟', value: '7', ok: 'تأیید' });
          if (days == null) return;
          expiresAt = Date.now() + Math.max(1, Math.min(365, parseInt(days, 10) || 1)) * 86400e3;
        } else if (v === 0) expiresAt = null;
        else expiresAt = Date.now() + v;
        render(); return;
      }
      if (act === 'pick-uses') {
        const v = await actionSheet({
          title: 'حداکثر استفاده',
          items: [
            { label: 'بدون محدودیت', value: 0 },
            { label: '۱ نفر', value: 1 },
            { label: '۱۰ نفر', value: 10 },
            { label: '۱۰۰ نفر', value: 100 },
            { label: 'سفارشی…', value: 'custom' },
          ],
        });
        if (v == null) return;
        if (v === 'custom') {
          const n = await promptDialog({ title: 'چند نفر؟', value: '50', ok: 'تأیید' });
          if (n == null) return;
          maxUses = Math.max(1, Math.min(100000, parseInt(n, 10) || 1));
        } else maxUses = v;
        render(); return;
      }
      if (act === 'create') {
        try {
          await svc.createInviteLink({ name, expiresAt, maxUses, approve });
          toastMsg('لینک ساخته شد');
          popPage();
        } catch (e) { toastMsg(e.message); }
      }
    };

    page.__onToggle = (key, on) => { if (key === 'approve') { approve = on; render(); } };
    return { el: page };
  }

  async function buildInviteDetailPage(link) {
    const page = makePage();
    function shell() {
      let h = topbarHTML({ back: true, title: link.name || 'لینک دعوت' });
      h += '<div class="tg-scroll">';
      h += '<div class="tg-link-card"><span class="tg-link-txt">' + escT(linkDisplay(link.link)) + '</span>' +
        '<button type="button" class="tg-iconbtn" data-act="copy" aria-label="کپی">' + I('copy') + '</button>' +
        '<button type="button" class="tg-iconbtn" data-act="qr" aria-label="کد QR">' + I('scan') + '</button></div>';
      let body = '';
      body += rowHTML({ icon: 'calendar', tone: 'orange', title: 'انقضا', value: link.expiresAt ? relTime(link.expiresAt) : 'بدون محدودیت', static: true });
      body += rowHTML({ icon: 'users', tone: 'blue', title: 'استفاده', value: link.maxUses ? faNum(link.uses) + '/' + faNum(link.maxUses) : faNum(link.uses || 0), static: true });
      body += rowHTML({ icon: 'user-check', tone: 'green', title: 'درخواست تأیید', value: link.approve ? 'فعال' : 'غیرفعال', static: true });
      h += sectionHTML({ body });
      if (!link.revoked) h += sectionHTML({ body: rowHTML({ icon: 'x', tone: 'red', title: 'ابطال لینک', act: 'revoke', danger: true }) });
      h += '</div>';
      return h;
    }
    page.innerHTML = shell(); reloadIcons(page);
    page.__onAct = async (act) => {
      if (act === 'copy') { copyText(link.link); return; }
      if (act === 'qr') { showQR(link.link, S.info.name); return; }
      if (act === 'revoke') {
        const ok = await confirmDialog({ title: 'ابطال لینک؟', text: 'این لینک دیگر کار نخواهد کرد.', ok: 'ابطال', danger: true });
        if (!ok) return;
        try { await svc.revokeInviteLink(link.token); link.revoked = true; toastMsg('ابطال شد'); popPage(); } catch (e) { toastMsg(e.message); }
      }
    };
    return { el: page };
  }

  /* ───────────────────────── reactions page ─────────────────────── */
  const ALL_REACTIONS = ['👍', '❤️', '🔥', '🎉', '😁', '🤔', '👎', '😢', '💯', '🙏', '👏', '🥰', '🤩', '😍', '😮', '🤯', '😡', '🤝'];
  async function buildReactionsPage() {
    const page = makePage();
    const r = S.settings.reactions || { mode: 'all', set: [] };
    let mode = r.mode || 'all';
    let set = Array.isArray(r.set) && r.set.length ? r.set.slice() : ALL_REACTIONS.slice(0, 8);
    function shell() {
      let h = topbarHTML({ back: true, title: 'واکنش‌ها' });
      h += '<div class="tg-scroll">';
      h += sectionHTML({
        body:
          rowHTML({ icon: 'check-circle', tone: 'green', title: 'همه واکنش‌ها', radio: true, checked: mode === 'all', act: 'mode-all' }) +
          rowHTML({ icon: 'smile', tone: 'orange', title: 'برخی واکنش‌ها', radio: true, checked: mode === 'some', act: 'mode-some' }) +
          rowHTML({ icon: 'x', tone: 'red', title: 'هیچ', radio: true, checked: mode === 'none', act: 'mode-none' }),
      });
      if (mode === 'some') {
        h += '<div class="tg-section-head" style="padding:12px 16px 6px">واکنش‌های مجاز</div>';
        h += '<div class="tg-card"><div class="tg-emoji-grid">' + ALL_REACTIONS.map((e) =>
          '<button type="button" class="tg-emoji' + (set.includes(e) ? ' is-on' : '') + '" data-act="emoji" data-emoji="' + escA(e) + '" aria-pressed="' + (set.includes(e) ? 'true' : 'false') + '">' + e + '</button>').join('') + '</div></div>';
      }
      h += sectionHTML({ foot: mode === 'all' ? 'اعضا می‌توانند به همه پیام‌ها واکنش دهند.' : mode === 'none' ? 'واکنش‌ها غیرفعال است.' : 'فقط واکنش‌های انتخاب‌شده مجاز است.' });
      h += '<div class="tg-btn-row"><button type="button" class="tg-btn is-primary" data-act="save">ذخیره</button></div>';
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    page.__onAct = async (act, btn) => {
      if (act === 'mode-all') { mode = 'all'; render(); return; }
      if (act === 'mode-some') { mode = 'some'; render(); return; }
      if (act === 'mode-none') { mode = 'none'; render(); return; }
      if (act === 'emoji') {
        const e = btn.dataset.emoji;
        const i = set.indexOf(e);
        if (i >= 0) set.splice(i, 1); else set.push(e);
        btn.classList.toggle('is-on', set.includes(e));
        btn.setAttribute('aria-pressed', set.includes(e) ? 'true' : 'false');
        return;
      }
      if (act === 'save') {
        try {
          await svc.updateSettings({ reactions: { mode, set } });
          S.settings.reactions = { mode, set };
          toastMsg('ذخیره شد'); popPage();
        } catch (e) { toastMsg(e.message); }
      }
    };
    return { el: page };
  }

  /* ───────────────────────── admin log page ─────────────────────── */
  const LOG_LABELS = {
    'change-info': 'اطلاعات را تغییر داد',
    'promote': 'را ادمین کرد',
    'demote': 'از ادمینی حذف کرد',
    'restrict': 'را محدود کرد',
    'unrestrict': 'محدودیت را برداشت',
    'invite-create': 'لینک دعوت ساخت',
    'invite-revoke': 'لینک دعوت را ابطال کرد',
    'join-approve': 'درخواست عضویت را تأیید کرد',
    'join-reject': 'درخواست عضویت را رد کرد',
    'ban': 'را مسدود کرد',
    'unban': 'مسدودیت را برداشت',
    'transfer': 'مالکیت را منتقل کرد',
  };
  async function buildLogPage() {
    const page = makePage();
    let log = null, filter = 'all';
    function shell() {
      let h = topbarHTML({ back: true, title: 'اقدامات اخیر', actions: [{ act: 'filter', icon: 'filter', label: 'فیلتر' }] });
      h += '<div class="tg-scroll">';
      if (log == null) h += '<div class="tg-card">' + skeletonRows(6) + '</div>';
      else {
        const items = log.filter((x) => filter === 'all' || x.action === filter);
        if (!items.length) h += emptyHTML('list', 'اقدامی ثبت نشده است');
        else h += '<div class="tg-card">' + items.map(logRow).join('') + '</div>';
      }
      h += '</div>';
      return h;
    }
    function logRow(x) {
      const label = LOG_LABELS[x.action] || x.action;
      const actor = escT(x.actor || 'سیستم');
      const target = x.target ? ' <b>@' + escT(x.target) + '</b>' : '';
      return '<div class="tg-log-item"><span class="tg-cell-av">' + avHTML({ username: x.actor, displayName: x.actor }, 'md') + '</span>' +
        '<span class="tg-log-main"><b>' + actor + '</b> ' + escT(label) + target + '<div class="tg-log-time">' + relTime(x.at) + '</div></span></div>';
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    try { const d = await svc.getLog(); log = d.log || []; } catch (e) { log = []; }
    render();
    page.__onAct = async (act) => {
      if (act === 'filter') {
        const items = [{ label: 'همه اقدامات', value: 'all' }].concat(Object.keys(LOG_LABELS).map((k) => ({ label: LOG_LABELS[k], value: k, checked: filter === k })));
        const v = await actionSheet({ title: 'فیلتر اقدامات', items });
        if (v) { filter = v; render(); }
      }
    };
    return { el: page };
  }

  /* ─────────────────────── discussion page ──────────────────────── */
  async function buildDiscussionPage() {
    const page = makePage();
    const linkedId = S.settings.discussionGroupId;
    const linked = (state.groups || []).find((g) => g.id === linkedId);
    function shell() {
      let h = topbarHTML({ back: true, title: 'گروه گفتگو' });
      h += '<div class="tg-scroll">';
      if (linked) {
        h += '<div class="tg-card">' + rowHTML({ icon: 'message-circle', tone: 'purple', title: linked.name, sub: 'گروه گفتگوی متصل', static: true }) + '</div>';
        h += sectionHTML({ body: rowHTML({ icon: 'x', tone: 'red', title: 'قطع اتصال', act: 'unlink', danger: true }) });
      } else {
        h += emptyHTML('message-circle', 'گروهی متصل نیست');
        const groups = (state.groups || []).filter((g) => (g.type || 'group') !== 'channel' && g.id !== S.gid);
        if (!groups.length) h += '<div class="tg-section-foot" style="padding:0 16px">گروهی برای اتصال وجود ندارد.</div>';
        else h += '<div class="tg-card">' + groups.map((g) => rowHTML({ icon: 'users', tone: 'blue', title: g.name, act: 'link', data: { gid: g.id } })).join('') + '</div>';
      }
      h += '</div>';
      return h;
    }
    page.innerHTML = shell(); reloadIcons(page);
    page.__onAct = async (act, btn) => {
      if (act === 'link') {
        try { await svc.updateSettings({ discussionGroupId: btn.dataset.gid }); S.settings.discussionGroupId = btn.dataset.gid; toastMsg('متصل شد'); popPage(); }
        catch (e) { toastMsg(e.message); }
        return;
      }
      if (act === 'unlink') {
        try { await svc.updateSettings({ discussionGroupId: null }); S.settings.discussionGroupId = null; toastMsg('قطع شد'); popPage(); }
        catch (e) { toastMsg(e.message); }
      }
    };
    return { el: page };
  }

  /* ─────────────────────── join requests page ───────────────────── */
  async function buildJoinRequestsPage() {
    const page = makePage();
    let list = null;
    function shell() {
      let h = topbarHTML({ back: true, title: 'درخواست‌های عضویت' });
      h += '<div class="tg-scroll">';
      if (list == null) h += '<div class="tg-card">' + skeletonRows(4) + '</div>';
      else if (!list.length) h += emptyHTML('user-check', 'درخواستی وجود ندارد');
      else {
        if (list.length > 1) {
          h += '<div class="tg-btn-row" style="padding:8px 16px 10px"><button type="button" class="tg-btn is-primary" data-act="approve-all">تأیید همه</button><button type="button" class="tg-btn is-danger" data-act="reject-all">رد همه</button></div>';
        }
        h += '<div class="tg-card">' + list.map((r) =>
          '<div class="tg-cell" style="cursor:default"><span class="tg-cell-av">' + avHTML(r, 'md') + '</span>' +
          '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(r.displayName || r.username) + '</span>' +
          '<span class="tg-cell-sub">@' + escT(r.username) + ' · ' + relTime(r.at) + '</span></span>' +
          '<button type="button" class="tg-iconbtn" data-act="approve" data-username="' + escA(r.username) + '" aria-label="تأیید">' + I('check') + '</button>' +
          '<button type="button" class="tg-iconbtn" data-act="reject" data-username="' + escA(r.username) + '" aria-label="رد">' + I('x') + '</button></div>').join('') + '</div>';
      }
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    try { const d = await svc.listJoinRequests(); list = d.requests || []; } catch (e) { list = []; }
    render();
    async function decide(u, action) {
      try { await svc.decideJoinRequest(u, action); list = list.filter((x) => x.username !== u); render(); }
      catch (e) { toastMsg(e.message); }
    }
    page.__onAct = async (act, btn) => {
      if (act === 'approve') { decide(btn.dataset.username, 'approve'); return; }
      if (act === 'reject') { decide(btn.dataset.username, 'reject'); return; }
      if (act === 'approve-all') { for (const r of list.slice()) await decide(r.username, 'approve'); return; }
      if (act === 'reject-all') { for (const r of list.slice()) await decide(r.username, 'reject'); return; }
    };
    return { el: page };
  }

  /* ───────────────────────── blocked page ──────────────────────── */
  async function buildBlockedPage() {
    const page = makePage();
    let list = null;
    function shell() {
      let h = topbarHTML({ back: true, title: 'کاربران مسدود' });
      h += '<div class="tg-scroll">';
      if (list == null) h += '<div class="tg-card">' + skeletonRows(4) + '</div>';
      else if (!list.length) h += emptyHTML('user-x', 'کاربر مسدودی وجود ندارد');
      else h += '<div class="tg-card">' + list.map((b) =>
        '<div class="tg-cell" style="cursor:default"><span class="tg-cell-av">' + avHTML(b, 'md') + '</span>' +
        '<span class="tg-cell-main"><span class="tg-cell-name">' + escT(b.displayName || b.username) + '</span>' +
        '<span class="tg-cell-sub">مسدود شده · ' + relTime(b.at) + '</span></span>' +
        '<button type="button" class="tg-btn is-ghost" data-act="unban" data-username="' + escA(b.username) + '">آنبلاک</button></div>').join('') + '</div>';
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    try { const d = await svc.listBanned(); list = d.banned || []; } catch (e) { list = []; }
    render();
    page.__onAct = async (act, btn) => {
      if (act === 'unban') {
        try { await svc.unban(btn.dataset.username); list = list.filter((x) => x.username !== btn.dataset.username); render(); toastMsg('آنبلاک شد'); }
        catch (e) { toastMsg(e.message); }
      }
    };
    return { el: page };
  }

  /* ─────────────────────── notifications page ───────────────────── */
  async function buildNotifPage() {
    const page = makePage();
    const flags = (typeof chatFlags === 'function' ? chatFlags(S.rid) : {}) || {};
    let muted = !!flags.muted;
    let preview = localStorage.getItem('vx_notif_preview') !== '0';
    let sound = localStorage.getItem('vx_notif_sound') !== '0';
    function shell() {
      let h = topbarHTML({ back: true, title: 'تنظیمات اعلان' });
      h += '<div class="tg-scroll">';
      h += sectionHTML({
        body:
          rowHTML({ icon: 'bell', tone: 'orange', title: 'اعلان‌ها', sub: muted ? 'خاموش' : 'فعال', toggle: 'muted', on: !muted }) +
          rowHTML({ icon: 'eye-off', tone: 'blue', title: 'پیش‌نمایش پیام', toggle: 'preview', on: preview }) +
          rowHTML({ icon: 'volume-2', tone: 'green', title: 'صدا', toggle: 'sound', on: sound }),
      });
      h += '</div>';
      return h;
    }
    function render() { page.innerHTML = shell(); reloadIcons(page); }
    render();
    page.__onToggle = (key, on) => {
      if (key === 'muted') { muted = !on; if (typeof setFlag === 'function') setFlag(S.rid, 'muted', muted); render(); return; }
      if (key === 'preview') { preview = on; localStorage.setItem('vx_notif_preview', on ? '1' : '0'); return; }
      if (key === 'sound') { sound = on; localStorage.setItem('vx_notif_sound', on ? '1' : '0'); return; }
    };
    return { el: page };
  }

  /* ─────────────────────────── QR code ─────────────────────────── */
  const QR_EXP = new Array(512);
  const QR_LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
  })();
  function qrMul(a, b) { if (!a || !b) return 0; return QR_EXP[QR_LOG[a] + QR_LOG[b]]; }
  function qrGen(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const a = QR_EXP[i];
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= qrMul(poly[j], a);
      }
      poly = next;
    }
    return poly;
  }
  function qrRS(data, n) {
    const gen = qrGen(n);
    const res = data.concat(new Array(n).fill(0));
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (!f) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= qrMul(gen[j], f);
    }
    return res.slice(data.length);
  }
  /* byte mode, EC level L, mask 0 — versions 1..6 (up to 134 bytes) */
  const QR_CAP = [
    null,
    { data: 19, ec: 7, blocks: [19] },
    { data: 34, ec: 10, blocks: [34] },
    { data: 55, ec: 15, blocks: [55] },
    { data: 80, ec: 20, blocks: [80] },
    { data: 108, ec: 26, blocks: [108] },
    { data: 136, ec: 18, blocks: [68, 68] },
  ];
  const QR_ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  function qrBCH15(data) {
    const bitLen = (x) => { let n = 0; while (x) { n++; x >>= 1; } return n; };
    let d = data << 10;
    while (bitLen(d) - 11 >= 0) d ^= 0x537 << (bitLen(d) - 11);
    return ((data << 10) | d) ^ 0x5412;
  }

  function qrMatrix(text) {
    let bytes;
    try { bytes = Array.from(new TextEncoder().encode(String(text || ''))); }
    catch (e) { bytes = Array.from(unescape(encodeURIComponent(String(text || '')))).map((c) => c.charCodeAt(0)); }

    let ver = 0;
    for (let v = 1; v <= 6; v++) {
      if (4 + 8 + bytes.length * 8 <= QR_CAP[v].data * 8) { ver = v; break; }
    }
    if (!ver) return null;
    const cap = QR_CAP[ver];

    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4);
    push(bytes.length, 8);
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);
    const maxBits = cap.data * 8;
    for (let i = 0; i < Math.min(4, maxBits - bits.length); i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }
    const pad = [0xec, 0x11];
    let pi = 0;
    while (cw.length < cap.data) cw.push(pad[pi++ % 2]);

    const blocks = [];
    let off = 0;
    for (let i = 0; i < cap.blocks.length; i++) { blocks.push(cw.slice(off, off + cap.blocks[i])); off += cap.blocks[i]; }
    const ecs = blocks.map((b) => qrRS(b, cap.ec));
    const out = [];
    let maxLen = 0;
    blocks.forEach((b) => { if (b.length > maxLen) maxLen = b.length; });
    for (let i = 0; i < maxLen; i++) for (let k = 0; k < blocks.length; k++) if (i < blocks[k].length) out.push(blocks[k][i]);
    for (let i = 0; i < cap.ec; i++) for (let k = 0; k < ecs.length; k++) out.push(ecs[k][i]);

    const size = 17 + ver * 4;
    const m = [], fn = [];
    for (let r = 0; r < size; r++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(r, c, v) {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      m[r][c] = !!v; fn[r][c] = true;
    }
    function finder(r0, c0) {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 &&
          (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        set(r0 + i, c0 + j, on);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = QR_ALIGN[ver] || [];
    for (let a = 0; a < al.length; a++) for (let b = 0; b < al.length; b++) {
      const r = al[a], c = al[b];
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
      }
    }
    /* reserve format areas + dark module */
    for (let i = 0; i <= 5; i++) set(i, 8, false);
    set(7, 8, false); set(8, 8, false);
    for (let i = 8; i < 15; i++) set(size - 15 + i, 8, false);
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, false);
    set(8, 7, false);
    for (let i = 9; i < 15; i++) set(8, 15 - i - 1, false);
    set(size - 8, 8, false);

    /* data placement, zig-zag from bottom-right */
    let idx = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let k = 0; k < size; k++) {
        const row = up ? size - 1 - k : k;
        for (let j = 0; j < 2; j++) {
          const c = col - j;
          if (fn[row][c]) continue;
          let bit = 0;
          if (idx < out.length * 8) bit = (out[idx >> 3] >> (7 - (idx & 7))) & 1;
          idx++;
          m[row][c] = !!bit ^ ((row + c) % 2 === 0);
        }
      }
      up = !up;
    }

    /* format info: EC L (01) + mask 0 */
    const fmt = qrBCH15((1 << 3) | 0);
    const fb = (i) => (fmt >> i) & 1;
    for (let i = 0; i < 6; i++) m[i][8] = !!fb(i);
    m[7][8] = !!fb(6);
    m[8][8] = !!fb(7);
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = !!fb(i);
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = !!fb(i);
    m[8][7] = !!fb(8);
    for (let i = 9; i < 15; i++) m[8][15 - i - 1] = !!fb(i);
    m[size - 8][8] = true;

    return m;
  }

  function qrSVG(text) {
    let m = null;
    try { m = qrMatrix(text); } catch (e) { m = null; }
    if (!m) return '';
    const n = m.length, q = 4, size = n + q * 2;
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (m[r][c]) path += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  function showQR(link, title) {
    if (!link) { toastMsg('لینکی موجود نیست'); return; }
    const svg = qrSVG(link);
    const scrim = el('div', 'tg-dialog-scrim');
    scrim.innerHTML =
      '<div class="tg-dialog" role="dialog" aria-modal="true" style="max-width:340px">' +
        '<div class="tg-dialog-body" style="padding:16px;text-align:center">' +
          '<div class="tg-dialog-title">' + escT(title || 'کد QR') + '</div>' +
          (svg ? '<div class="tg-qr-wrap"><div class="tg-qr">' + svg + '</div></div>'
               : '<div class="tg-section-foot">ساخت کد QR ممکن نشد.</div>') +
          '<div style="direction:ltr;text-align:center;font-size:12px;color:var(--on-surface-variant);word-break:break-all">' + escT(linkDisplay(link)) + '</div>' +
        '</div>' +
        '<div class="tg-dialog-actions">' +
          '<button type="button" class="tg-btn" data-q="copy">کپی لینک</button>' +
          '<button type="button" class="tg-btn is-primary" data-q="close">بستن</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('is-open'));
    const done = () => { scrim.classList.remove('is-open'); setTimeout(() => scrim.remove(), 180); };
    scrim.querySelector('[data-q="close"]').onclick = done;
    scrim.querySelector('[data-q="copy"]').onclick = () => copyText(link);
    scrim.onclick = (e) => { if (e.target === scrim) done(); };
  }

  /* ────────────────────────── loading page ──────────────────────── */
  function loadingPage() {
    const p = makePage();
    p.innerHTML = topbarHTML({ close: true, title: 'در حال بارگذاری…' }) +
      '<div class="tg-scroll">' + skeletonRows(8) + '</div>';
    reloadIcons(p);
    return p;
  }

  /* ─────────────────────────── public API ──────────────────────── */
  let openSeq = 0;

  async function openInfo(rid) {
    ensurePanel();
    closeToken++;
    const seq = ++openSeq;
    const g = (state.groups || []).find((x) => 'group:' + x.id === rid);
    if (!g) { toastMsg('گروه یافت نشد'); return; }

    S.gid = g.id;
    S.rid = rid;
    S.isChannel = (g.type || 'group') === 'channel';
    S.members = null; S.admins = null; S.inviteLinks = null; S.banned = null;
    S.log = null; S.joinRequests = null; S.info = null; S.settings = null;
    S.isStaff = false; S.isOwner = false;

    stack.forEach((p) => { try { p.el.remove(); } catch (e) {} });
    stack = [];

    isOpen = true;
    panelEl.classList.add('is-open');
    scrimEl.classList.add('is-open');
    document.body.classList.add('tg-open');
    if (mobile()) document.body.style.overflow = 'hidden';

    pushPage(loadingPage());

    try {
      const d = await svc.getInfo();
      if (seq !== openSeq) return;
      S.info = d.info;
      S.settings = d.settings || {};
      if (!S.settings.permissions) S.settings.permissions = {};
      if (!S.settings.reactions) S.settings.reactions = { mode: 'all', set: [] };
      S.isStaff = !!d.isStaff;
      S.isOwner = d.info.myRole === 'owner';
      S.isChannel = (d.info.type || 'group') === 'channel';
      const built = await buildInfoPage();
      if (seq !== openSeq) return;
      stack.forEach((p) => { try { p.el.remove(); } catch (e) {} });
      stack = [];
      pushPage(built.el, { onShow: built.refresh });
    } catch (e) {
      if (seq !== openSeq) return;
      toastMsg((e && e.message) || 'خطا در بارگذاری');
      const p = makePage();
      p.innerHTML = topbarHTML({ close: true, title: 'خطا' }) +
        '<div class="tg-scroll"><div class="tg-empty">' +
        '<div class="tg-empty-title">بارگذاری نشد</div>' +
        '<div class="tg-empty-sub">اتصال را بررسی کنید و دوباره تلاش کنید.</div>' +
        '<button type="button" class="tg-btn is-primary" data-act="retry">تلاش دوباره</button>' +
        '</div></div>';
      reloadIcons(p);
      p.__onAct = (act) => { if (act === 'retry') { stack.forEach((x) => { try { x.el.remove(); } catch (er) {} }); stack = []; openInfo(rid); } };
      stack.forEach((x) => { try { x.el.remove(); } catch (er) {} });
      stack = [];
      pushPage(p);
    }
  }

  window.VXGroupSettings = {
    open: openInfo,
    openInfo: openInfo,
    close: closePanel,
    isOpen: function () { return isOpen; },
    qrSVG: qrSVG,
  };
})();
