// VORTEXGRAM — Google Gemini free tier (generateContent).
//
// Gemini uses a different wire format (contents/parts + systemInstruction), so
// this provider translates the OpenAI-style message array. Key and model come
// from env; the free tier needs no billing.

'use strict';

const { ProviderError, postJson, httpError, cleanReply, splitKeys } = require('./base');

const NAME = 'gemini';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';

function config(env = process.env) {
  return {
    keys: splitKeys(env.GEMINI_API_KEY),
    baseUrl: String(env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: String(env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS || env.AI_TEXT_TIMEOUT_MS || 25000),
    maxTokens: Number(env.AI_TEXT_MAX_TOKENS || 512),
  };
}

function available(env = process.env) {
  return splitKeys(env.GEMINI_API_KEY).length > 0;
}

// system messages -> systemInstruction; the rest -> contents[{role, parts:[{text}]}].
function toGeminiPayload(messages, model, maxTokens, temperature) {
  let system = '';
  const contents = [];
  for (const m of messages || []) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role === 'system') { system += (system ? '\n\n' : '') + m.content; continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const payload = { contents, generationConfig: { maxOutputTokens: maxTokens, temperature } };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  return { payload, model };
}

async function complete(messages, opts = {}, env = process.env, deps = {}) {
  const cfg = config(env);
  const key = cfg.keys[0];
  if (!key) throw new ProviderError(NAME, 0, 'gemini not configured', { retryable: false });
  const model = opts.model || cfg.model;
  const temperature = opts.temperature !== undefined ? opts.temperature : 0.9;
  const maxTokens = opts.maxTokens || cfg.maxTokens;
  const { payload } = toGeminiPayload(messages, model, maxTokens, temperature);
  const url = cfg.baseUrl + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

  const resp = await postJson(NAME, url, {
    headers: {},
    body: payload,
    timeoutMs: opts.timeoutMs || cfg.timeoutMs,
    fetchImpl: deps.fetchImpl || fetch,
  });
  if (!resp.ok) throw httpError(NAME, resp.status, await safeSnippet(resp));
  let data = null;
  try { data = await resp.json(); } catch (e) { throw new ProviderError(NAME, resp.status, 'gemini returned invalid JSON', { retryable: true }); }
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && Array.isArray(data.candidates[0].content.parts) ? data.candidates[0].content.parts : [];
  const text = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  if (!text) throw new ProviderError(NAME, resp.status, 'gemini returned no text', { retryable: true });
  const usage = (data && data.usageMetadata) || {};
  return {
    text: cleanReply(text),
    model,
    tokensIn: Number.isFinite(+usage.promptTokenCount) ? +usage.promptTokenCount : null,
    tokensOut: Number.isFinite(+usage.candidatesTokenCount) ? +usage.candidatesTokenCount : null,
  };
}

async function safeSnippet(resp) {
  try { const t = await resp.text(); return t.slice(0, 120); } catch (e) { return ''; }
}

module.exports = { name: NAME, config, available, complete, toGeminiPayload, DEFAULT_MODEL, DEFAULT_BASE_URL };