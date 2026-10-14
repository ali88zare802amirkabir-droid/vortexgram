# راهنمای ربات‌ها و انتشار خودکار با n8n

این راهنما توضیح می‌دهد چطور یک **حساب ربات** بسازید، **کلید API** بگیرید/بچرخانید/باطل کنید و
از طریق n8n در کانال‌ها پست بگذارید.

 endpoint اصلی: `POST /api/bot/post`
 احراز هویت: هدر `Authorization: Bearer <کلید ربات>`

> **نکتهٔ امنیتی:** متن خام کلید فقط **یک‌بار** هنگام ساخت (یا چرخش) نمایش داده می‌شود.
> در پایگاه‌داده فقط یک **هش کلید‌شده** (`HMAC-SHA256`) ذخیره می‌شود؛ اگر دیتابیس شما لو برود،
> کلید از آن قابل بازیابی نیست. اگر کلید را گم کردید، باید **بچرخانید**.

---

## ۱) ساخت ربات (فقط ادمین)

```bash
curl -X POST https://YOUR-DOMAIN/api/admin/bots \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"username":"news_ai_bot","displayName":"ربات اخبار هوش مصنوعی","bio":"اخبار فناوری"}'
```

پاسخ (کلید فقط همین‌جا یک‌بار دیده می‌شود):

```json
{
  "ok": true,
  "bot": { "username": "news_ai_bot", "isBot": true, "hasPassword": false, "...": "..." },
  "apiKey": "vxk_30108c5fc552_a0341b80624455e42...",
  "keyPrefix": "vxk_30108c5fc552",
  "warning": "این کلید فقط همین یک‌بار نمایش داده می‌شود. آن را ذخیره کنید."
}
```

**ویژگی حساب ربات:** با `isBot` ساخته می‌شود، برچسب «ربات» در اپ می‌گیرد، می‌تواند **مالک یا مدیر کانال** باشد،
اما **نمی‌تواند وارد شود** (ورود با رمز، کد یک‌بارمصرف و تکمیل ثبت‌نام همه برایش ۴۰۳ می‌دهند).

---

## ۲) ساخت کانال‌های محتوایی (idempotent)

یک endpoint برای ساخت هر ۹ کانال عمومی با ربات اختصاصی خودش. **اجرای دوباره بی‌خطر است**:
کانال تکراری نمی‌سازد و برای ربات‌های موجود کلید تازه صادر نمی‌کند (تا ورک‌فلوهای n8n نشکند).

```bash
curl -X POST https://YOUR-DOMAIN/api/admin/bots/seed-channels \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" -d '{}'
```

کانال‌های ساخته‌شده (هر کدام با یک ربات مستقل):

| کانال | آیدی | دسته | ربات |
|---|---|---|---|
| تکنولوژی و هوش مصنوعی | `ai_news` | tech | `news_ai_bot` |
| نرخ ارز، طلا و کریپتو | `fx_gold_crypto` | finance | `fx_rates_bot` |
| فوتبال | `football` | sports | `football_bot` |
| فال حافظ روزانه | `hafez_fal` | culture | `hafez_bot` |
| جوک و چالش روزانه | `jokes_daily` | fun | `joke_bot` |
| آموزش زبان انگلیسی | `english_daily` | learn | `english_bot` |
| فیلم و سریال | `movies_series` | media | `movie_bot` |
| اخبار بازی | `game_news` | games | `game_news_bot` |
| نکات مطالعه کنکور | `konkur_tips` | study | `konkur_bot` |

در پاسخ، `channels[].id` همان چیزی است که باید به‌عنوان `channelId` به `/api/bot/post` بدهید.
`newBotKeys[].apiKey` فقط برای ربات‌های **تازه‌ساخته** برگردانده می‌شود (یک‌بار).

---

## ۳) گرفتن / چرخاندن / باطل کردن کلید

**لیست ربات‌ها و کلیدهایشان** (هیچ متن خامی برنمی‌گردد، فقط پیشوند):

```bash
curl https://YOUR-DOMAIN/api/admin/bots -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>"
```

**چرخش کلید** (کلید قبلی بلافاصله باطل می‌شود):

```bash
curl -X POST https://YOUR-DOMAIN/api/admin/bots/news_ai_bot/rotate-key \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" -d '{}'
```

**ابطال همهٔ کلیدهای یک ربات:**

```bash
curl -X POST https://YOUR-DOMAIN/api/admin/bots/news_ai_bot/revoke-keys \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" -d '{}'
```

همهٔ این کارها در **audit log ادمین** ثبت می‌شود (`bot-create`، `bot-key-rotate`، `bot-key-revoke`، `bot-channels-seed`).

---

## ۴) فراخوانی endpoint پست با curl

متن ساده:

```bash
curl -X POST https://YOUR-DOMAIN/api/bot/post \
  -H "Authorization: Bearer vxk_30108c5fc552_a0341b80624455e42..." \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "<channelId>",
    "kind": "text",
    "content": "دلار امروز ۶۱٬۲۰۰ تومان معامله شد.",
    "aiGenerated": true,
    "idempotencyKey": "fx-2024-06-11-08:00"
  }'
```

پست **دارای منبع خارجی** (لینک منبع به‌صورت ساختاریافته ذخیره و در اپ نمایش داده می‌شود):

```bash
  -d '{
    "channelId": "<channelId>",
    "kind": "text",
    "content": "خلاصهٔ خبر: مدل جدید زبانی معرفی شد.",
    "sourceUrl": "https://example.com/article/123",
    "sourceTitle": "معرفی مدل جدید",
    "sourceProvider": "rss",
    "aiGenerated": true,
    "idempotencyKey": "news-2024-06-11-08:00"
  }'
```

پست **تصویری** (تصویر از راه دور هرگز hotlink نمی‌شود؛ سرور آن را با فیلتر ضد-SSRF می‌گیرد و روی خودش میزبانی می‌کند):

```bash
  -d '{
    "channelId": "<channelId>",
    "kind": "image",
    "imageUrl": "https://example.com/chart.png",
    "content": "نمودار نرخ امروز",
    "aiGenerated": false
  }'
```

پست **نظرسنجی**:

```bash
  -d '{
    "channelId": "<channelId>",
    "kind": "poll",
    "question": "کدام زبان را یاد بگیریم؟",
    "options": ["انگلیسی", "آلمانی", "فرانسه", "ژاپنی"]
  }'
```

### پارامترهای درخواست

| فیلد | لازم | توضیح |
|---|---|---|
| `channelId` | بله | شناسهٔ کانال (`channels[].id` از seed یا از `GET /api/groups/explore`) |
| `kind` | خیر (پیش‌فرض `text`) | `text` \| `image` \| `poll` |
| `content` | برای text/image | متن پیام (حداکثر ۴۰۰۰ کاراکتر؛ کاراکترهای کنترلی حذف می‌شوند) |
| `imageUrl` | برای image | فقط `http`/`https`، تصویر باید واقعاً تصویر باشد |
| `sourceUrl` | خیر | لینک منبع؛ فقط `http`/`https` (بدون نام کاربری/رمز) |
| `sourceTitle` / `sourceProvider` | خیر | عنوان و منبع خبر |
| `aiGenerated` | خیر | اگر `true` برچسب «تولید شده با هوش مصنوعی» می‌خورد |
| `idempotencyKey` | خیر | کلید یکتا؛ ارسال دوبارهٔ همان کلید پست تکراری نمی‌سازد (۲۴ ساعت) |
| `question` / `options` | برای poll | سؤال (۲۰۰ کاراکتر) و ۲ تا ۱۰ گزینه |

### قوانین و خطاها (پیام‌ها فارسی‌اند)

| وضعیت | معنا |
|---|---|
| `401` | کلید ناقص/نامعتبر/باطل‌شده یا کلید نشست کاربر به‌جای کلید ربات |
| `403` | ربات مالک یا مدیر این کانال نیست، یا حساب ربات مسدود است |
| `404` | کانال یافت نشد |
| `400` | ورودی نامعتبر (نوع، طول، یا لینک غیر `http/https`/داخلی) |
| `429` | سقف ارسال این ربات در یک دقیقه تکمیل شد |
| `201` | پست ایجاد شد → `{ ok, messageId, roomId, time }` |
| `200` | پست تکراری بود (همان `idempotencyKey`) → `duplicate: true` |

---

## ۵) ورک‌فلو آمادهٔ n8n

فایل `docs/n8n/ai-news-workflow.json` یک ورک‌فلو کامل و آمادهٔ ایمپورت است:

```
Schedule (هر ۳۰ دقیقه) → RSS فناوری → انتخاب آیتم جدید (+ساخت idempotencyKey)
   → بازنویسی با هوش مصنوعی → POST /api/bot/post
```

### مراحل ایمپورت و راه‌اندازی

1. در n8n: **Workflows → Import from File** و انتخاب `ai-news-workflow.json`.
2. در مرحلهٔ **AI rewrite**، کلید (Credential) مدل هوش مصنوعی خود را انتخاب/بسازید.
3. در n8n متغیرهای محیطی زیر را تنظیم کنید:

   ```bash
   export VORTEX_BOT_KEY="vxk_..."        # کلید ربات (همان که یک‌بار نمایش داده شد)
   export VORTEX_CHANNEL_ID="<channelId>" # شناسهٔ کانال
   ```

4. در گرهٔ **Post to channel** آدرس `https://YOUR-DOMAIN/api/bot/post` را با دامنهٔ خودتان جایگزین کنید.
5. گره را تست کنید و سپس **Activate** بزنید.

**چرا `idempotencyKey` مهم است:** اگر n8n یک اجرا را دوباره تکرار کند (تلاش مجدد، یا اجرای دستی)،
به‌جای دو پست یک پست می‌سازد.

---

## ۶) نکات اجرایی

- **متغیر محیطی pepper:** برای پایدار ماندن کلیدها بین ری‌استارت‌ها، `BOT_KEY_PEPPER` را ست کنید
  (یک رشتهٔ تصادفیِ طولانی). اگر ست نشود، کلیدها در `data/.bot-pepper` ساخته می‌شوند.
- **سقف ارسال:** هر ربات ۳۰ پست در ۶۰ ثانیه.
- **حریم خصوصی:** شمار بازدید هر پست فقط «تعداد بازدیدکنندهٔ یکتا» است؛ هرگز فهرست بیننده‌ها
  ذخیره یا منتشر نمی‌شود. endpoint شمارش واکنش (`/api/reactions/:id/counts`) هم فقط عدد می‌دهد.
- **برچسب AI و منبع:** هر دو به‌صورت **فیلد ساختاریافته** (`msg.ai` و `msg.source`) ذخیره می‌شوند،
  نه متن آزاد؛ بنابراین همیشه در اپ قابل تفکیک و بررسی‌اند.