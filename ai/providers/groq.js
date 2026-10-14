// VORTEXGRAM — Groq text provider (OpenAI-compatible chat completions).
//
// Keeps the original key rotation: 429/401 rotates to the next key with NO
// sleep (a different credential, not a retry). 5xx / network / timeout fail
// over to the NEXT provider in the chain immediately — never slept on.
//
// Model comes from GROQ_MODEL. Default is qwen/qwen3.8-27b: the old default
// qwen/qwen3.6-27b was shut down on Groq on 14 Sep 2026, and the allam-2-7b
// fallback assumption no longer exists, so both are gone.

'use strict';

const {
  ProviderError, postJson, httpError,
  extractOpenAIText, extractOpenAIUsage, cleanReply,
  KeyRotator, splitKeys,
} = require('./base');

const NAME = 'groq';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'qwen/qwen3.8-27b';

function config(env = process.env) {
  return {
    keys: splitKeys(env.GROQ_API_KEYS_STR),
    baseUrl: String(env.GROQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: String(env.GROQ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.GROQ_TIMEOUT_MS || env.AI_TEXT_TIMEOUT_MS || 25000),
    maxTokens: Number(env.AI_TEXT_MAX_TOKENS || 512),
  };
}

function available(env = process.env) {
  return splitKeys(env.GROQ_API_KEYS_STR).length > 0;
}

async function complete(messages, opts = {}, env = process.env, deps = {}) {
  const cfg = config(env);
  if (!cfg.keys.length) throw new ProviderError(NAME, 0, 'groq not configured', { retryable: false });
  const fetchImpl = deps.fetchImpl || fetch;
  const rotator = new KeyRotator(cfg.keys);
  let lastErr = null;

  for (let k = 0; k < cfg.keys.length; k++) {
    const key = rotator.next();
    if (!key) break;
    let resp;
    try {
      resp = await postJson(NAME, cfg.baseUrl + '/chat/completions', {
        headers: { Authorization: 'Bearer ' + key },
        body: {
          model: opts.model || cfg.model,
          messages,
          max_tokens: opts.maxTokens || cfg.maxTokens,
          temperature: opts.temperature !== undefined ? opts.temperature : 0.9,
        },
        timeoutMs: opts.timeoutMs || cfg.timeoutMs,
        fetchImpl,
      });
    } catch (e) {
      // network/timeout — the chain (not us) decides failover vs last-resort retry
      lastErr = e;
      break;
    }
    if (resp.ok) {
      let data = null;
      try { data = await resp.json(); } catch (e) { lastErr = new ProviderError(NAME, resp.status, 'groq returned invalid JSON', { retryable: true }); break; }
      const text = extractOpenAIText(data);
      if (!text) { lastErr = new ProviderError(NAME, resp.status, 'groq returned no text', { retryable: true }); break; }
      const { tokensIn, tokensOut } = extractOpenAIUsage(data);
      return { text: cleanReply(text), model: opts.model || cfg.model, tokensIn, tokensOut };
    }
    if (resp.status === 401 || resp.status === 403) {
      // Bad key — drop it and try the next credential without sleeping.
      rotator.markBad(key);
      lastErr = httpError(NAME, resp.status, 'invalid API key');
      continue;
    }
    if (resp.status === 429) {
      // Per-key budget — next key, no sleep. If no keys remain the chain moves on.
      lastErr = httpError(NAME, resp.status, 'rate limited');
      continue;
    }
    lastErr = httpError(NAME, resp.status, await safeSnippet(resp));
    break;
  }
  throw lastErr || new ProviderError(NAME, 0, 'groq: all keys exhausted', { retryable: true });
}

async function safeSnippet(resp) {
  try { const t = await resp.text(); return t.slice(0, 120); } catch (e) { return ''; }
}

module.exports = { name: NAME, config, available, complete, DEFAULT_MODEL, DEFAULT_BASE_URL };
