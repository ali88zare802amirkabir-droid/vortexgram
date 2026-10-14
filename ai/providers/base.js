// VORTEXGRAM — shared base for AI providers.
//
// Every provider speaks the same tiny interface:
//
//   { name, available(), complete(messages, opts) }
//
// * `available()` is a pure env check — no network. A provider with no
//   credentials is skipped before any HTTP happens, so the app boots and runs
//   with zero providers configured.
// * `complete(messages, opts)` resolves `{ text, model, tokensIn, tokensOut }`
//   or throws a ProviderError. `opts` carries `{ timeoutMs, signal?, maxTokens,
//   temperature }`. Callers (the chain) own failover, quota and logging.
// * NOTHING here logs message content — only provider names, models and HTTP
//   statuses. Grep `console` in ai/ to audit that invariant.

'use strict';

const { backoffDelay, sleep } = require('../reliability');

class ProviderError extends Error {
  constructor(provider, status, message, { retryable = false } = {}) {
    super(message || (provider + ' failed' + (status ? ' (' + status + ')' : '')));
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status || 0;
    this.retryable = retryable;
  }
}

// fetch with a hard timeout; AbortError surfaces as a retryable ProviderError.
async function postJson(provider, url, { headers = {}, body, timeoutMs = 25000, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) {
      throw new ProviderError(provider, 0, provider + ' timed out after ' + timeoutMs + 'ms', { retryable: true });
    }
    throw new ProviderError(provider, 0, provider + ' network error: ' + String((e && e.message) || e).slice(0, 120), { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  return resp;
}

// Same, but for multipart (Whisper) or GET (Pollinations) — kept separate so the
// JSON helper above stays the single place that stringifies request bodies.
async function rawRequest(provider, url, { method = 'GET', headers = {}, body, timeoutMs = 60000, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method, headers, body, signal: controller.signal });
  } catch (e) {
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) {
      throw new ProviderError(provider, 0, provider + ' timed out after ' + timeoutMs + 'ms', { retryable: true });
    }
    throw new ProviderError(provider, 0, provider + ' network error: ' + String((e && e.message) || e).slice(0, 120), { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// Map an HTTP failure to a ProviderError. 429/5xx are retryable-elsewhere
// (the chain fails over immediately); other 4xx fail over too but do NOT count
// as provider-death for the circuit breaker (the request itself was bad).
function httpError(provider, status, snippet) {
  const retryable = status === 429 || (status >= 500 && status <= 599);
  return new ProviderError(provider, status, provider + ' HTTP ' + status + (snippet ? ': ' + String(snippet).slice(0, 120) : ''), { retryable });
}

// OpenAI-compatible `choices[0].message.content` extraction.
function extractOpenAIText(data) {
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    && typeof data.choices[0].message.content === 'string'
    ? data.choices[0].message.content.trim()
    : '';
  return text || null;
}

function extractOpenAIUsage(data) {
  const u = (data && data.usage) || {};
  const tokensIn = Number.isFinite(+u.prompt_tokens) ? +u.prompt_tokens : null;
  const tokensOut = Number.isFinite(+u.completion_tokens) ? +u.completion_tokens : null;
  return { tokensIn, tokensOut };
}

// The old groq.js reply cleaner, kept verbatim (backwards-compatible output):
// strips reasoning wrappers and chatty openers.
function cleanReply(text) {
  let t = String(text || '');
  t = t.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
  t = t.replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/g, '').trim();
  t = t.replace(/<\|thinking\|>[\s\S]*?(?:<\|\/thinking\|>|$)/g, '').trim();
  // Legacy Persian opener strip (unchanged). NOTE: no \b here — JS \b is
  // ASCII-only, so \b after a Persian letter never matches.
  t = t.replace(/^\s*(?:باشه|خب|خُب|خوب)\s*[.:،]?\s*/, '');
  // English opener: punctuation is REQUIRED. The old /^OK\s*[:.]?\s*/i also
  // ate "okay"/"okt" and reduced a reply that was literally "ok" to "", which
  // the chain then counted as a provider failure.
  t = t.replace(/^OK\b\s*[:.]\s*/i, '');
  return t.trim();
}

// Key rotation for providers with a comma-separated key list. Rotating to the
// NEXT key on 429/401 costs no sleep and is not a "retry" — it is a different
// credential for the same provider.
class KeyRotator {
  constructor(keys) {
    this.keys = [...keys];
    this.idx = 0;
    this.bad = new Set(); // keys that returned 401/403 — never tried again this process
  }
  next() {
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[this.idx % this.keys.length];
      this.idx++;
      if (!this.bad.has(k)) return k;
    }
    return null;
  }
  markBad(key) { this.bad.add(key); }
  get size() { return this.keys.length; }
}

function splitKeys(str) {
  return String(str || '').split(',').map((k) => k.trim()).filter(Boolean);
}

// A same-provider retry with backoff+jitter. Used ONLY when there is no untried
// provider left (single-provider chain or everything else failing) and only for
// retryable errors — bounded by `retries` (default 1 extra attempt). 429/5xx on
// a provider that still has successors is NEVER slept on: the chain moves on.
async function retryWithBackoff(fn, { retries = 1, baseMs = 200, capMs = 2000, sleepImpl = sleep, rand = Math.random } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const retryable = e && (e.retryable || e instanceof ProviderError && e.status === 0);
      if (!retryable || attempt >= retries) throw e;
      await sleepImpl(backoffDelay(attempt, baseMs, capMs, rand));
    }
  }
  throw lastErr;
}

module.exports = {
  ProviderError,
  postJson,
  rawRequest,
  httpError,
  extractOpenAIText,
  extractOpenAIUsage,
  cleanReply,
  KeyRotator,
  splitKeys,
  retryWithBackoff,
};
