# Vortex v2 — PHP + Next.js rebuild

نسخه‌ی دوم ورتکس: بک‌اند **PHP 8 (بدون هیچ dependency)** و فرانت‌اند **Next.js 14 + TypeScript + Tailwind**.
WebSocket حذف شد؛ ریل‌تایم با **SSE** است. دیتابیس **SQLite** است.

```
v2/
  backend/          PHP API (zero-dependency)
    public/index.php   front controller (+ .htaccess)
    app/               Config, Db, Util, Auth, Room, Events, RateLimit, Routes*
    tools/             import-dbjson.php (migration از db.json نسخه‌ی اول)
                       smoke-phpwasm.mjs (تست خودکار بک‌اند بدون نصب PHP)
    Dockerfile         php:8.3-apache برای Render
    .env.example
  frontend/         Next.js 14 App Router
    app/            page.tsx (ورود) + chat/page.tsx + layout + globals.css
    components/     ChatList.tsx + RoomView.tsx
    lib/            api.ts (کلاینت REST) + sse.ts (استریم + reconnect)
    .env.example
  Dockerfile        (بیلد بک‌اند — کانتکست همین پوشه‌ی v2)
  render.yaml       بلوپرینت Render برای API
```

## اجرای لوکال (جایی که اینترنت و PHP هست)

```bash
# بک‌اند (نیاز به PHP 8.1+)
cd v2/backend
cp .env.example .env   # ویرایش کن
php -S 127.0.0.1:8000 -t public public/index.php

# فرانت‌اند (نیاز به Node 18+ و اینترنت برای npm)
cd v2/frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm install
npm run dev                  # http://localhost:3000
```

## مهاجرت دیتا از نسخه‌ی اول

```bash
cd v2/backend
php tools/import-dbjson.php /path/to/data/db.json
```

کاربران/گروه‌ها/پیام‌ها/پین‌ها می‌آیند. نشست‌ها و کدها **نمی‌آیند** (همه دوباره لاگین می‌کنند).
رمزهای sha256 قدیمی با اولین لاگین موفق به bcrypt تبدیل می‌شوند.

## تست خودکار بک‌اند (بدون نیاز به نصب PHP)

با **PHP-WASM** (پی‌اچ‌پیِ کامپایل‌شده برای Node) اجرا می‌شود و ۳۳ سناریوی واقعی
(ثبت‌نام/ورود/ارسال/فوروارد/هیستوری/گروه/نظرسنجی/چک‌لیست/rate-limit/دسترسی + باز کردن واقعی
استریم SSE) را می‌زند:

```bash
cd v2/tools
npm install        # فقط یک‌بار: @php-wasm/node
npm run smoke      # → RESULT pass=33 fail=0
```

دیتابیس تست در پوشه‌ی موقت ساخته و خودکار پاک می‌شود؛ چیزی در پروژه‌ی واقعی نمی‌سازد.

## وضعیت تأیید (تست‌شده)

- بک‌اند: **۳۳/۳۳** اسموک در PHP 8.3 (PHP-WASM) — ثبت‌نام/ورود/پیام/فوروارد/گروه/نظرسنجی/چک‌لیست/
  ری‌اکشن/پین/ویرایش/بلاک‌ها/rate-limit/هدرهای امنیتی/تحویل زنده‌ی SSE تأیید شد.
  وابستگی به `mbstring` حذف شده (polyfill امن) تا روی هاست‌های بدون این افزونه هم کار کند.
- فرانت‌اند: `tsc --noEmit` و `next build` هردو بدون خطا؛ `next` روی **14.2.35** (آخرین پچ امنیتی سری ۱۴).
  ارسال پیام/عکس/ویس **اپتیمیستیک** است (حباب فوراً با ⏳ ظاهر و بعد با تیک ✓/✓✓ تأیید می‌شود)؛
  فوروارد از منوی ⋮ هر پیام به هر گفتگو، ریپلای، و پین با بازخورد فوری + بنر «پیام سنجاق‌شده» داریم.
- ریل‌تایم: کلاینت `last_id` را به ازای هر نشست جدا نگه می‌دارد و اگر دیتابیس سرور بعد از
  redeploy نو شود (با `maxEventId` در فرم `ready`) خودش را ری‌سینک می‌کند — پیام‌ها بعد از دیپلوی جدید هم زنده می‌رسند.

## دیپلوی

- **API روی Render**: Blueprint از `v2/render.yaml` (Docker). متغیرها: `ADMIN_PHONES`,
  `FRONTEND_ORIGIN` (آدرس ورسل)، `APP_DEBUG=0`، و اختیاری `GROQ_API_KEY` برای جواب هوشمند بات.
- **فرانت روی Vercel**: ایمپورت ریپو، Root Directory = `v2/frontend`، متغیر
  `NEXT_PUBLIC_API_URL=https://vortex-v2-api.onrender.com`.

## مدل امنیتی (صادقانه: «سخت» نه «غیرممکن»)

- همه‌ی کوئری‌ها Prepared Statement (SQL Injection عملاً مرده)
- رمز با `password_hash` (bcrypt/argon2)؛ توکن نشست ۲۵۶ بیتی که فقط هش آن ذخیره می‌شود
- Rate-limit روی لاگین/کد/پیام/تایپینگ (جدول SQLite)
- آپلود: sniff واقعی MIME با finfo (نه حرف کلاینت)، وایت‌لیست پسوند، اسم تصادفی،
  ذخیره **بیرون از web root** و سرو با هدر `nosniff` — اجرای PHP از آپلود ممکن نیست
- هدرها: nosniff، DENY frame، Referrer no-referrer، HSTS روی HTTPS، CSP سخت‌گیرانه
- OTP شش‌رقمی با هش، انقضای ۲ دقیقه، قفل بعد از ۵ تلاش؛ `devCode` فقط وقتی `APP_DEBUG=1`
- استریم SSE با **تیکت یک‌بارمصرف ۶۰ ثانیه‌ای** (توکن اصلی در URL نمی‌آید)
- عملیات حساس ادمین فقط برای شماره‌های `ADMIN_PHONES`
- فرانت‌اند با React رندر می‌کند (XSS از innerHTML نداریم)؛ احراز هویت با Bearer header (بدون CSRF)

## فاز ۲ (فعلاً نیست)

پیام زمان‌بندی‌شده، لینک‌پریویو (حذف شد — ریسک SSRF)، تماس صوتی/تصویری، دستورات `@ai`
(فقط جواب خودکار در DM بات هست)، گالری پس‌زمینه، افکت‌های پروفایل.

## نکته‌ی محیطی

این کد ابتدا در `.../Temp/opencode/vortex-v2` ساخته شد (درایو D کاملاً پر بود)؛ حالا پروژه در
`D:\Projects\fake-telegram\v2` مستقر است. نسخه‌ی قدیمی‌ی آزمایشی در `v2-old/` نگهداری شده.
