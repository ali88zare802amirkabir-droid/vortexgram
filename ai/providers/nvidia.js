// VORTEXGRAM — NVIDIA NIM text provider (OpenAI-compatible chat completions).
//
// Base URL and model both come from env. Any NIM-hosted OpenAI-compatible
// endpoint works, including self-hosted NIMs behind the same path layout.

'use strict';

const {
  ProviderError, postJson, httpError,
  extractOpenAIText, extractOpenAIUsage, cleanReply, splitKeys,
} = require('./base');

const NAME = 'nvidia';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'meta/llama-3.1-405b-instruct';

function config(env = process.env) {
  return {
    keys: splitKeys(env.NVIDIA_API_KEY),
    baseUrl: String(env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: String(env.NVIDIA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.NVIDIA_TIMEOUT_MS || env.AI_TEXT_TIMEOUT_MS || 25000),
    maxTokens: Number(env.AI_TEXT_MAX_TOKENS || 512),
  };
}

function available(env = process.env) {
  return splitKeys(env.NVIDIA_API_KEY).length > 0;
}

async function complete(messages, opts = {}, env = process.env, deps = {}) {
  const cfg = config(env);
  const key = cfg.keys[0];
  if (!key) throw new ProviderError(NAME, 0, 'nvidia not configured', { retryable: false });
  const fetchImpl = deps.fetchImpl || fetch;
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
    throw e instanceof ProviderError ? e : new ProviderError(NAME, 0, String((e && e.message) || e), { retryable: true });
  }
  if (!resp.ok) throw httpError(NAME, resp.status, await safeSnippet(resp));
  let data = null;
  try { data = await resp.json(); } catch (e) { throw new ProviderError(NAME, resp.status, 'nvidia returned invalid JSON', { retryable: true }); }
  const text = extractOpenAIText(data);
  if (!text) throw new ProviderError(NAME, resp.status, 'nvidia returned no text', { retryable: true });
  const { tokensIn, tokensOut } = extractOpenAIUsage(data);
  return { text: cleanReply(text), model: opts.model || cfg.model, tokensIn, tokensOut };
}

async function safeSnippet(resp) {
  try { const t = await resp.text(); return t.slice(0, 120); } catch (e) { return ''; }
}

module.exports = { name: NAME, config, available, complete, DEFAULT_MODEL, DEFAULT_BASE_URL };
