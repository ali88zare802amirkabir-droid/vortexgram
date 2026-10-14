// شخصیت ربات — پورت‌شده از D:\clan\app\ai\prompts.py
const P = require("./prompts.json");

module.exports = {
  SYSTEM_PROMPT: P.SYSTEM_PROMPT,
  RUDE_PROMPT: P.RUDE_PROMPT,
  ADMIN_PROMPT: P.ADMIN_PROMPT,
  RUDE_ADMIN_PROMPT: P.RUDE_ADMIN_PROMPT,
  SOFT_PROMPT: P.SOFT_PROMPT,
  HARD_PROMPT: P.HARD_PROMPT,

  /**
   * فقط «دستورالعمل سیستم» را برمی‌گرداند.
   *
   * تغییر مهم نسبت به نسخهٔ قبل: buildMessages اینجا داده‌های غیرقابل‌اعتماد
   * (تاریخچهٔ گفتگو و متن کاربر) را درون همان آرایهٔ پیام‌ها می‌ساخت. حالا
   * داده‌ها توسط ai.safeMessages در بلوک‌های قفسه‌بندی‌شده و جدا از پیام
   * سیستم ساخته می‌شوند، تا محتوای چت هرگز نتواند نقش system را جعل کند یا
   * دستورالعمل‌ها را افشا کند.
   */
  promptFor({ isRude, isAdmin, aggression = 1 } = {}) {
    if (aggression <= 0) return this.SOFT_PROMPT;
    if (isRude && isAdmin) return this.RUDE_ADMIN_PROMPT;
    if (isRude) return this.RUDE_PROMPT;
    if (isAdmin) return this.ADMIN_PROMPT;
    if (aggression >= 2) return this.HARD_PROMPT;
    return this.SYSTEM_PROMPT;
  },

  /**
   * سازگاری با کد قدیمی: همان خروجی قبلی را می‌سازد، ولی داده‌های
   * غیرقابل‌اعتماد در یک بلوک قفسه‌بندی‌شده قرار می‌گیرند.
   * (سرور دیگر از این مسیر استفاده نمی‌کند؛ برای ابزارها/تست‌ها نگه داشته شده.)
   */
  buildMessages(userText, contextMessages, username, isRude, isAdmin, aggression) {
    const safety = require('./safety');
    const system = this.promptFor({ isRude, isAdmin, aggression });
    if (contextMessages && contextMessages.length) {
      const recent = contextMessages.slice(-10).map((m, i) => `${i + 1}. ${m}`).join("\n");
      return safety.safeMessages(system, recent, { label: 'chat' });
    }
    const label = username ? "@" + username : "کاربر";
    return safety.safeMessages(system, `پیام فعلی از ${label}:\n${userText}`, { label: 'chat' });
  },
};
