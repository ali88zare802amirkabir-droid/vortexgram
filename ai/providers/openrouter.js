// VORTEXGRAM — OpenRouter text provider (OpenAI-compatible), ':free' models only.
//
// OpenRouter is the last resort in the chain: the free tier is a shared,
// best-effort pool. The model env is coerced to end with ':free' because paid
// models must never be selected implicitly — spending a user's credit without
// them asking is exactly what ':free' guards against.

'use strict';

const {
  ProviderError, postJson, httpError,
  extractOpenAIText, extractOpenAIUsage, cleanReply, splitKeys,
} = require('./base');

const NAME = 'openrouter';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

// A ':free' suffix means "this choice costs nothing". Anything without it is
// rejected at config time so an operator cannot accidentally bill users.
function forceFree(model) {
  const m = String(model || '').trim();
  return /:free$/i.test(m) ? m : (m + ':free');
}

function config(env = process.env) {
  return {
    keys: splitKeys(env.OPENROUTER_API_KEY),
    baseUrl: String(env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: forceFree(env.OPENROUTER_MODEL || DEFAULT_MODEL),
    timeoutMs: Number(env.OPENROUTER_TIMEOUT_MS || env.AI_TEXT_TIMEOUT_MS || 25000),
    maxTokens: Number(env.AI_TEXT_MAX_TOKENS || 512),
  };
}

function available(env = process.env) {
  return splitKeys(env.OPENROUTER_API_KEY).length > 0;
}

async function complete(messages, opts = {}, env = process.env, deps = {}) {
  const cfg = config(env);
  const key = cfg.keys[0];
  if (!key) throw new ProviderError(NAME, 0, 'openrouter not configured', { retryable: false });
  const model = opts.model ? forceFree(opts.model) : cfg.model;
  const resp = await postJson(NAME, cfg.baseUrl + '/chat/completions', {
    headers: { Authorization: 'Bearer ' + key, 'HTTP-Referer': String(env.OPENROUTER_SITE_URL || 'https://vortexgram.app'), 'X-Title': 'VortexGram' },
    body: {
      model,
      messages,
      max_tokens: opts.maxTokens || cfg.maxTokens,
      temperature: opts.temperature !== undefined ? opts.temperature : 0.9,
    },
    timeoutMs: opts.timeoutMs || cfg.timeoutMs,
    fetchImpl: deps.fetchImpl || fetch,
  });
  if (!resp.ok) throw httpError(NAME, resp.status, await safeSnippet(resp));
  let data = null;
  try { data = await resp.json(); } catch (e) { throw new ProviderError(NAME, resp.status, 'openrouter returned invalid JSON', { retryable: true }); }
  const text = extractOpenAIText(data);
  if (!text) throw new ProviderError(NAME, resp.status, 'openrouter returned no text', { retryable: true });
  const { tokensIn, tokensOut } = extractOpenAIUsage(data);
  return { text: cleanReply(text), model, tokensIn, tokensOut };
}

async function safeSnippet(resp) {
  try { const t = await resp.text(); return t.slice(0, 120); } catch (e) { return ''; }
}

module.exports = { name: NAME, config, available, complete, forceFree, DEFAULT_MODEL, DEFAULT_BASE_URL };