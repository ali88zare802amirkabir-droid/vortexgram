// پورت‌شده از D:\clan\app\ai\client.py — Groq با چرخش کلید و مدل fallback
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const FALLBACK_MODELS = ["allam-2-7b"];
const MODELS_WITH_REASONING = new Set(["qwen/qwen3.6-27b"]);

class KeyRotator {
  constructor(keys) {
    this.keys = [...keys];
    this.idx = 0;
    this.exhausted = new Map();
  }
  next() {
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[this.idx % this.keys.length];
      this.idx++;
      if ((this.exhausted.get(k) || 0) < now) return k;
    }
    return null;
  }
  markExhausted(key, cooldown = 60000) {
    this.exhausted.set(key, Date.now() + cooldown);
  }
  available() {
    const now = Date.now();
    return this.keys.filter((k) => (this.exhausted.get(k) || 0) < now).length;
  }
}

const rotator = new KeyRotator(
  (process.env.GROQ_API_KEYS_STR || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
);

async function tryOne(model, messages, apiKey) {
  const payload = { model, messages, max_tokens: 256, temperature: 0.9 };
  if (MODELS_WITH_REASONING.has(model)) payload.reasoning_effort = "none";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.error(`Groq ${resp.status} on ${model}`);
      return null;
    }
    const data = await resp.json();
    let text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    text = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "").trim();
    text = text.replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/g, "").trim();
    text = text.replace(/<\|thinking\|>[\s\S]*?(?:<\|\/thinking\|>|$)/g, "").trim();
    return text || null;
  } catch (e) {
    console.error(`Groq error on ${model}:`, e.message);
    return null;
  }
}

function cleanReply(text) {
  let t = text
    .replace(/^\s*(باشه|خب|خُب|خوب)\s*[.:،]?\s*/, "")
    .replace(/^OK\s*[:.]?\s*/i, "");
  return t.trim();
}

async function chatCompletion(messages, primaryModel) {
  if (!rotator.keys.length) {
    console.warn("No GROQ_API_KEYS_STR configured");
    return null;
  }
  const primary = primaryModel || process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
  const models = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];

  const attempts = rotator.keys.length * models.length;
  for (let i = 0; i < attempts; i++) {
    const key = rotator.next();
    if (!key) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const model of models) {
      const text = await tryOne(model, messages, key);
      if (text) return cleanReply(text);
      await new Promise((r) => setTimeout(r, 500));
    }
    rotator.markExhausted(key);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("All Groq keys/models exhausted");
  return null;
}

module.exports = { chatCompletion };