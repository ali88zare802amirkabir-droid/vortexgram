// VORTEXGRAM — AI media: image generation (optional) + Whisper transcription.
//
// Both are entirely optional. With no credentials configured the functions
// return null / throw a ProviderError and the app keeps working — the caller
// turns that into a clear Persian "not configured" message.
//
// Image chain: Cloudflare Workers AI first, then Pollinations *only* when an
// API key is present (Pollinations no longer serves requests without one).
// Voice: Groq Whisper (optional).

'use strict';

const { ProviderError, rawRequest, httpError, splitKeys } = require('./providers/base');

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Cloudflare Workers AI  (https://<account>.workers.ai/@cf/<model>)
// ---------------------------------------------------------------------------
function workersConfig(env = process.env) {
  return {
    accountId: String(env.CF_AI_ACCOUNT_ID || '').trim(),
    token: String(env.CF_AI_TOKEN || '').trim(),
    baseUrl: String(env.CF_AI_BASE_URL || 'https://api.cloudflare.com/client/v4/accounts').replace(/\/+$/, ''),
    model: String(env.CF_AI_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell').trim(),
    steps: numOr(env.CF_AI_IMAGE_STEPS, 4),
    timeoutMs: numOr(env.CF_AI_TIMEOUT_MS, 60000),
  };
}
function workersAvailable(env = process.env) {
  const c = workersConfig(env);
  return !!(c.accountId && c.token);
}

// ---------------------------------------------------------------------------
// Pollinations  (https://image.pollinations.ai/prompt/<prompt>)
// ---------------------------------------------------------------------------
function pollinationsConfig(env = process.env) {
  return {
    key: String(env.POLLINATIONS_API_KEY || '').trim(),
    baseUrl: String(env.POLLINATIONS_BASE_URL || 'https://image.pollinations.ai').replace(/\/+$/, ''),
    model: String(env.POLLINATIONS_MODEL || 'flux').trim(),
    timeoutMs: numOr(env.POLLINATIONS_TIMEOUT_MS, 60000),
    seed: numOr(env.POLLINATIONS_SEED, 0),
  };
}
// Key is REQUIRED now — without one Pollinations returns an error, so treating
// "no key" as "not available" avoids a pointless slow failure.
function pollinationsAvailable(env = process.env) {
  return !!pollinationsConfig(env).key;
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function readCapped(resp, cap) {
  const chunks = [];
  let size = 0;
  for await (const c of resp.body) {
    size += c.length;
    if (size > cap) throw new ProviderError('image', 0, 'تصویر بیش از حد بزرگ است', { retryable: false });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 6 && buf.slice(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// Generate with Cloudflare Workers AI; returns {buffer, mime, provider}.
async function generateWorkersAI(prompt, opts = {}, env = process.env) {
  const cfg = workersConfig(env);
  if (!workersAvailable(env)) throw new ProviderError('cf-workers-ai', 0, 'Cloudflare Workers AI not configured', { retryable: false });
  const fetchImpl = opts.fetchImpl || fetch;
  const url = cfg.baseUrl + '/' + encodeURIComponent(cfg.accountId) + '/ai/run/' + encodeURIComponent(cfg.model);
  const body = {
    prompt,
    steps: opts.steps || cfg.steps,
    // Flux-schnell is fast; guidance stays low to keep latency predictable.
    guidance: opts.guidance || 1,
  };
  const resp = await rawRequest('cf-workers-ai', url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: opts.timeoutMs || cfg.timeoutMs,
    fetchImpl,
  });
  if (!resp.ok) throw httpError('cf-workers-ai', resp.status, await snippet(resp));
  const data = await resp.json().catch(() => null);
  // Workers AI returns { result: { image: "data:image/png;base64,...." } }
  const img = data && data.result && (data.result.image || data.result);
  if (typeof img !== 'string') throw new ProviderError('cf-workers-ai', resp.status, 'no image in response', { retryable: true });
  const m = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(img);
  if (!m) throw new ProviderError('cf-workers-ai', resp.status, 'unexpected image payload', { retryable: true });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new ProviderError('cf-workers-ai', resp.status, 'empty image', { retryable: true });
  const mime = sniffImage(buf);
  if (!mime) throw new ProviderError('cf-workers-ai', resp.status, 'not a valid image', { retryable: false });
  return { buffer: buf, mime, provider: 'cf-workers-ai', model: cfg.model };
}

// Generate with Pollinations (needs API key).
async function generatePollinations(prompt, opts = {}, env = process.env) {
  const cfg = pollinationsConfig(env);
  if (!pollinationsAvailable(env)) throw new ProviderError('pollinations', 0, 'Pollinations not configured (POLLINATIONS_API_KEY missing)', { retryable: false });
  const fetchImpl = opts.fetchImpl || fetch;
  const params = new URLSearchParams({
    model: cfg.model,
    nologo: 'true',
    width: String(opts.width || 1024),
    height: String(opts.height || 1024),
    seed: String(opts.seed || cfg.seed || Math.floor(Math.random() * 1e9)),
  });
  if (opts.negative) params.set('negative_prompt', String(opts.negative).slice(0, 400));
  const url = cfg.baseUrl + '/prompt/' + encodeURIComponent(String(prompt).slice(0, 800)) + '?' + params.toString();
  const headers = { Authorization: 'Bearer ' + cfg.key, Accept: 'image/*' };
  if (cfg.key.startsWith('Bearer ')) headers.Authorization = cfg.key;
  const resp = await rawRequest('pollinations', url, { method: 'GET', headers, timeoutMs: opts.timeoutMs || cfg.timeoutMs, fetchImpl });
  if (!resp.ok) throw httpError('pollinations', resp.status, await snippet(resp));
  const buf = await readCapped(resp, opts.maxBytes || IMAGE_MAX_BYTES);
  const mime = sniffImage(buf);
  if (!mime) throw new ProviderError('pollinations', resp.status, 'response was not an image', { retryable: true });
  return { buffer: buf, mime, provider: 'pollinations', model: cfg.model };
}

async function snippet(resp) {
  try { const t = await resp.text(); return t.slice(0, 120); } catch (e) { return ''; }
}

/** Ordered image chain: Workers AI, then Pollinations (if keyed). */
async function generateImage(prompt, opts = {}, env = process.env) {
  const chain = [];
  if (workersAvailable(env)) chain.push(['cf-workers-ai', generateWorkersAI]);
  if (pollinationsAvailable(env)) chain.push(['pollinations', generatePollinations]);
  if (!chain.length) return null;
  for (const [name, fn] of chain) {
    try {
      return await fn(prompt, opts, env);
    } catch (e) {
      if (envFlag(env, 'AI_LOG_VERBOSE', true)) console.log('[ai] image provider', name, 'failed:', (e && e.status) || '?', '-> failover');
    }
  }
  return null;
}

function envFlag(env, key, fallback) {
  const v = String(env[key] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function imageConfigured(env = process.env) {
  return workersAvailable(env) || pollinationsAvailable(env);
}

// ---------------------------------------------------------------------------
// Voice transcription — Groq Whisper (optional)
// ---------------------------------------------------------------------------
function whisperConfig(env = process.env) {
  return {
    keys: splitKeys(env.GROQ_API_KEYS_STR || env.GROQ_WHISPER_API_KEYS_STR),
    baseUrl: String(env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: String(env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo').trim(),
    timeoutMs: numOr(env.GROQ_WHISPER_TIMEOUT_MS, 60000),
    maxBytes: numOr(env.AI_TRANSCRIBE_MAX_BYTES, 20 * 1024 * 1024),
  };
}
function whisperAvailable(env = process.env) {
  return whisperConfig(env).keys.length > 0;
}

/**
 * @param {Buffer} buffer  raw audio bytes
 * @param {string} filename  used only for the multipart filename field
 * @returns {Promise<{text, provider, model, duration}|null>}
 */
async function transcribe(buffer, filename, opts = {}, env = process.env) {
  const cfg = whisperConfig(env);
  if (!whisperAvailable(env)) return null;
  if (!buffer || !buffer.length) return null;
  if (buffer.length > cfg.maxBytes) throw new ProviderError('whisper', 0, 'فایل صوتی بزرگ‌تر از حد مجاز است', { retryable: false });
  const fetchImpl = opts.fetchImpl || fetch;
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename || 'audio.webm');
  fd.append('model', cfg.model);
  fd.append('response_format', 'json');
  if (opts.language) fd.append('language', String(opts.language).slice(0, 8));
  if (opts.prompt) fd.append('prompt', String(opts.prompt).slice(0, 300));

  let lastErr = null;
  for (const key of cfg.keys) {
    const resp = await rawRequest('whisper', cfg.baseUrl + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: fd,
      timeoutMs: opts.timeoutMs || cfg.timeoutMs,
      fetchImpl,
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const text = data && typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) throw new ProviderError('whisper', resp.status, 'no transcript returned', { retryable: true });
      return { text, provider: 'whisper', model: cfg.model, duration: Number(data.duration) || null };
    }
    if (resp.status === 429) { lastErr = httpError('whisper', resp.status, 'rate limited'); continue; }
    lastErr = httpError('whisper', resp.status, await snippet(resp));
    break;
  }
  throw lastErr || new ProviderError('whisper', 0, 'transcription failed', { retryable: true });
}

module.exports = {
  generateImage, imageConfigured, workersAvailable, pollinationsAvailable,
  transcribe, whisperAvailable, sniffImage,
};