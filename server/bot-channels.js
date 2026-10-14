// VORTEXGRAM — کانال‌های عمومیِ محتوایی که ربات‌ها اداره می‌کنند.
//
// این فهرست «idempotent» است: اجرای دوبارهٔ seed هیچ کانال تکراری نمی‌سازد.
// برای هر کانال یک ربات اختصاصی وجود دارد (نه یک ربات مشترک) تا اگر کلید یک
// کانال لو رفت، بتوان فقط همان را باطل کرد و بقیهٔ کانال‌ها سالم بمانند.
//
// فقط کانال‌هایی که *کاربر* ندارند (محتوای ماشینی) از این مسیر ساخته می‌شوند؛
// کاربر همچنان می‌تواند کانال عمومی خودش را با دستگاه سادهٔ موجود بسازد.

'use strict';

const bots = require('./bots');

/**
 * هر ردیف: ربات + کانالی که همان ربات مالک/مدیر آن است.
 * username کانال باید با ^[a-z0-9_]{3,20}$$ هم‌خوان باشد و یکتا بماند؛ چون آیدی
 * عمومی کانال همان چیزی است که در لینک‌ها و n8n استفاده می‌شود، عمداً ثابت است.
 */
const SEED_CHANNELS = [
  {
    bot: { username: 'news_ai_bot', displayName: 'ربات اخبار هوش مصنوعی', bio: 'اخبار تکنولوژی و هوش مصنوعی — هر مطلب با لینک منبع.' },
    channel: {
      username: 'ai_news', name: 'تکنولوژی و هوش مصنوعی',
      description: 'تازه‌ترین اخبار فناوری، مدل‌های زبانی و ابزارهای هوش مصنوعی — هر خبر با لینک منبع و برچسب «تولید شده با هوش مصنوعی».',
      category: 'tech',
    },
  },
  {
    bot: { username: 'fx_rates_bot', displayName: 'ربات نرخ ارز', bio: 'نرخ لحظه‌ای دلار، طلا و ارزهای دیجیتال.' },
    channel: {
      username: 'fx_gold_crypto', name: 'نرخ ارز، طلا و کریپتو',
      description: 'نرخ دلار، سکه و طلا و مهم‌ترین ارزهای دیجیتال به همراه درصد تغییرات.',
      category: 'finance',
    },
  },
  {
    bot: { username: 'football_bot', displayName: 'ربات فوتبال', bio: 'نتایچ، جدول و اخبار فوتبال.' },
    channel: {
      username: 'football', name: 'فوتبال',
      description: 'نتایج زنده، جدول لیگ‌ها و اخبار روز فوتبال.',
      category: 'sports',
    },
  },
  {
    bot: { username: 'hafez_bot', displayName: 'ربات فال حافظ', bio: 'فال حافظ روزانه هر صبح.' },
    channel: {
      username: 'hafez_fal', name: 'فال حافظ روزانه',
      description: 'هر روز یک فال حافظ تازه، همراه با تفسیر کوتاه و معنی واژه‌های کلیدی.',
      category: 'culture',
    },
  },
  {
    bot: { username: 'joke_bot', displayName: 'ربات جوک و چالش', bio: 'جوک روزانه و چالش‌های کوتاه.' },
    channel: {
      username: 'jokes_daily', name: 'جوک و چالش روزانه',
      description: 'هر روز یک جوک بی‌خطر و یک چالش کوتاه برای شروع روز.',
      category: 'fun',
    },
  },
  {
    bot: { username: 'english_bot', displayName: 'ربات آموزش انگلیسی', bio: 'واژه، idiom و تمرین کوتاه انگلیسی.' },
    channel: {
      username: 'english_daily', name: 'آموزش زبان انگلیسی',
      description: 'هر روز یک واژه یا عبارت پرکاربرد انگلیسی با معنی، تلفظ و مثال در جمله.',
      category: 'learn',
    },
  },
  {
    bot: { username: 'movie_bot', displayName: 'ربات فیلم و سریال', bio: 'اخبار فیلم و سریال.' },
    channel: {
      username: 'movies_series', name: 'فیلم و سریال',
      description: 'اخبار فیلم و سریال، زمان اکران و معرفی آثار تازه.',
      category: 'media',
    },
  },
  {
    bot: { username: 'game_news_bot', displayName: 'ربات اخبار بازی', bio: 'اخبار بازی‌های کامپیوتری و کنسول.' },
    channel: {
      username: 'game_news', name: 'اخبار بازی',
      description: 'تازه‌ترین اخبار بازی‌های کامپیوتری، کنسول و بازی‌های موبایل.',
      category: 'games',
    },
  },
  {
    bot: { username: 'konkur_bot', displayName: 'ربات نکات کنکور', bio: 'برنامهٔ مطالعه و نکات کنکور.' },
    channel: {
      username: 'konkur_tips', name: 'نکات مطالعه کنکور',
      description: 'برنامهٔ مطالعه، روش تست‌زنی و نکات کنکوری به زبان ساده.',
      category: 'study',
    },
  },
];

function makeGroupId() {
  return require('crypto').randomBytes(6).toString('hex');
}

/**
 * ساخت/به‌روزرسانی idempotent کانال‌ها.
 *
 * @param {object} deps
 * @param {Array} deps.db            وضعیت runtime
 * @param {string} deps.username    کاربری که به‌عنوان مالک اولیه (ادمین) ثبت می‌شود
 * @param {Function} deps.uid        () => شماره یکتا
 * @param {Function} deps.mintKey    (botUsername, label) => { raw, rec }
 * @param {Function} deps.save       () => void
 * @param {Function} deps.pushUsers  () => void
 * @param {string}  deps.categoryFallback
 * @returns {{channels: Array, createdBots: Array, createdChannels: number, updatedChannels: number}}
 */
function ensureSeedChannels(deps) {
  const { db, uid, mintKey, save, pushUsers } = deps;
  const result = { channels: [], createdBots: [], createdChannels: 0, updatedChannels: 0 };

  for (const entry of SEED_CHANNELS) {
    const botName = bots.cleanLine(entry.bot.username, 20).toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(botName)) continue; // دادهٔ خراب در تعریف

    // --- ربات ---
    let bot = db.users.find((u) => u.username === botName);
    if (!bot) {
      bot = {
        username: botName,
        uid: uid(),
        displayName: bots.cleanLine(entry.bot.displayName, 30),
        isAdmin: false,
        isBot: true,
        banned: false,
        createdAt: Date.now(),
        avatar: null,
        bio: bots.cleanLine(entry.bot.bio, 200),
        activeSkin: 'default',
        profileEffect: 'off',
        profileEffectColor: null,
        profileBg: null,
      };
      db.users.push(bot);
      // کلید فقط برای ربات‌های *تازه* ساخته می‌شود؛ اجرای دوبارهٔ seed نباید
      // کلید ربات‌های موجود را باطل کند (ورک‌فلوهای n8n را می‌شکند).
      const { raw, rec } = mintKey(botName, 'seed:' + entry.channel.username);
      result.createdBots.push({
        username: botName,
        displayName: bot.displayName,
        channelUsername: entry.channel.username,
        apiKey: raw,              // ← فقط همین یک‌بار
        keyPrefix: rec.keyPrefix,
      });
    } else if (!bot.isBot) {
      // نام کاربری از قبل توسط یک حساب عادی گرفته شده — دست نمی‌زنیم (بدون تغییر ناگهانی)
      continue;
    }

    // --- کانال ---
    const want = entry.channel;
    let g = db.groups.find((x) => x.username === want.username);
    if (!g) {
      g = {
        id: makeGroupId(),
        type: 'channel',
        name: bots.cleanLine(want.name, 30),
        owner: botName,
        members: [{ username: botName, role: 'owner' }],
        createdAt: Date.now(),
        avatar: null,
        username: want.username,
        visibility: 'public',
        description: bots.cleanLine(want.description, 200),
        category: want.category,
      };
      db.groups.push(g);
      result.createdChannels++;
    } else {
      // به‌روزرسانی جزئی (بدون ساخت دوباره) — نام/توضیح/دسته همیشه همگام می‌مانند
      let touched = false;
      const nm = bots.cleanLine(want.name, 30);
      if (nm && g.name !== nm) { g.name = nm; touched = true; }
      const ds = bots.cleanLine(want.description, 200);
      if (ds && g.description !== ds) { g.description = ds; touched = true; }
      if (g.category !== want.category) { g.category = want.category; touched = true; }
      if (g.visibility !== 'public') { g.visibility = 'public'; touched = true; }
      if (g.owner !== botName) { g.owner = botName; touched = true; }
      if (!Array.isArray(g.members)) g.members = [];
      if (!g.members.some((m) => m.username === botName)) {
        g.members.push({ username: botName, role: g.owner === botName ? 'owner' : 'member' });
        touched = true;
      }
      if (touched) result.updatedChannels++;
    }

    result.channels.push({
      id: g.id,
      name: g.name,
      username: g.username,
      category: g.category || null,
      owner: g.owner,
      visibility: g.visibility || 'private',
      roomId: 'group:' + g.id,
    });
  }

  save();
  if (pushUsers) pushUsers();
  return result;
}

module.exports = { SEED_CHANNELS, ensureSeedChannels };