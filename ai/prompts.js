// شخصیت ربات — پورت‌شده از D:\clan\app\ai\prompts.py
const P = require("./prompts.json");

module.exports = {
  SYSTEM_PROMPT: P.SYSTEM_PROMPT,
  RUDE_PROMPT: P.RUDE_PROMPT,
  ADMIN_PROMPT: P.ADMIN_PROMPT,
  RUDE_ADMIN_PROMPT: P.RUDE_ADMIN_PROMPT,
  SOFT_PROMPT: P.SOFT_PROMPT,
  HARD_PROMPT: P.HARD_PROMPT,

  buildMessages(userText, contextMessages, username, isRude, isAdmin, aggression) {
    let system;
    if (aggression <= 0) system = this.SOFT_PROMPT;
    else if (isRude && isAdmin) system = this.RUDE_ADMIN_PROMPT;
    else if (isRude) system = this.RUDE_PROMPT;
    else if (isAdmin) system = this.ADMIN_PROMPT;
    else if (aggression >= 2) system = this.HARD_PROMPT;
    else system = this.SYSTEM_PROMPT;

    const msgs = [{ role: "system", content: system }];

    if (contextMessages && contextMessages.length) {
      const recent = contextMessages.slice(-10);
      const ctxText = recent.map((m, i) => `${i + 1}. ${m}`).join("\n");
      msgs.push({
        role: "user",
        content:
          "این\u200cها پیام\u200cهای اخیر گروه هستند.\n" +
          "از آن\u200cها فقط برای فهم فضای گفتگو، شوخی\u200cها و موضوع استفاده کن.\n" +
          "لازم نیست به همه\u200cی آن\u200cها پاسخ بدهی.\n\n" + ctxText,
      });
    }

    const label = username ? "@" + username : "\u06a9\u0627\u0631\u0628\u0631";
    msgs.push({
      role: "user",
      content: `پیام فعلی از ${label}:\n${userText}\n\nحالا یک جواب کوتاه و طبیعی بده.`,
    });
    return msgs;
  },
};
