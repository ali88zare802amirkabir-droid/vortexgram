// VORTEXGRAM — AI provider chain.
//
// `chatCompletion(messages, opts)` walks AI_TEXT_CHAIN in order and returns the
// first successful answer, or null when nothing is usable. Backwards compatible
// with the old ai/groq.js entry point (server.js keeps importing the same
// symbol shape).
//
// Failover policy
// ---------------
//   * 429 / 5xx / network / timeout  -> move to the NEXT provider IMMEDIATELY.
//     No sleep, no retry-until-quota is exceeded: a stalled provider must not
//     hold up the request.
//   * A provider whose circuit is OPEN is skipped without any HTTP.
//   * When EVERY configured provider fails, the chain retries the whole list
//     once with exponential backoff + jitter (the only sleeping path), so a
//     brief blip on a single-provider setup still recovers.
//   * Tokens reported by the provider are counted against the caller's quota
//     through onUsage; unconfigured providers cost nothing.
//
// Logging
// -------
// Only provider names, models, statuses and latency are logged — never prompt
// or completion content. See the `logLine` helper.

'use strict';

const { CircuitBreaker } = require('../reliability');
const { ProviderError, retryWithBackoff } = require('./base');

const PROVIDERS = {
  nvidia: require('./nvidia'),
  groq: require('./groq'),
  gemini: require('./gemini'),
  openrouter: require('./openrouter'),
};

// Ordered by AI_TEXT_CHAIN (comma separated). Unknown names are ignored with a
// warning so a typo degrades to "fewer providers", not "app broken on boot".
function configuredChain(env = process.env) {
  const raw = String(env.AI_TEXT_CHAIN || 'nvidia,groq,gemini,openrouter');
  const names = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (PROVIDERS[n]) out.push(PROVIDERS[n]);
    else console.warn('[ai] unknown provider in AI_TEXT_CHAIN:', n);
  }
  return out;
}

function envFlag(name, fallback = false, env = process.env) {
  const v = String(env[name] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function logLine(parts, env = process.env) {
  if (envFlag('AI_LOG_VERBOSE', true, env)) console.log('[ai]', parts);
}

function isConfigured(env = process.env) {
  return configuredChain(env).some((p) => {
    try { return p.available(env); } catch (e) { return false; }
  });
}

// circuit breakers live per provider and are shared across calls (that is the
// point — a dead provider must stay dead for everyone until its cooldown).
const breakers = new Map();
function breakerFor(name, env = process.env) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker({
      failures: Number(env.AI_CIRCUIT_FAILURES || 5),
      cooldownMs: Number(env.AI_CIRCUIT_COOLDOWN_MS || 60000),
    }));
  }
  return breakers.get(name);
}
function _resetBreakers() { breakers.clear(); }

/**
 * @param {Array} messages            OpenAI-style [{role, content}]
 * @param {object} opts
 *   - timeoutMs / maxTokens / temperature  per-call overrides
 *   - onUsage(result, provider)           quota hook, called once on success
 *   - env                                inject env (tests)
 *   - fetchImpl                           inject fetch (tests / fake provider)
 * @returns {Promise<{text, provider, model, tokensIn, tokensOut}|null>}
 */
async function chatCompletion(messages, opts = {}) {
  const env = opts.env || process.env;
  const deps = { fetchImpl: opts.fetchImpl };
  const chain = configuredChain(env);
  const usable = chain.filter((p) => {
    try { return p.available(env); } catch (e) { return false; }
  });

  if (!usable.length) {
    // App must stay healthy with zero providers; callers turn this into a
    // clear "AI تنظیم نشده" response.
    return null;
  }

  const passthrough = {
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  };

  const attemptProvider = async (provider) => {
    const br = breakerFor(provider.name, env);
    if (!br.canAttempt()) {
      logLine('skip ' + provider.name + ' (circuit ' + br.state + ')', env);
      return null; // no HTTP at all
    }
    const started = Date.now();
    try {
      const result = await provider.complete(messages, { ...passthrough, model: opts.model }, env, deps);
      if (!result || !result.text) throw new ProviderError(provider.name, 0, 'empty completion', { retryable: true });
      br.recordSuccess();
      logLine('answered by ' + provider.name + ' model=' + result.model + ' in ' + (Date.now() - started) + 'ms', env);
      // Stamp the winner so callers (quota logging, /api/ai) know who answered.
      result.provider = provider.name;
      if (typeof opts.onUsage === 'function') {
        try { opts.onUsage(result, provider); } catch (e) { /* quota errors must not break the reply */ }
      }
      return result;
    } catch (e) {
      br.recordFailure();
      const status = e && e.status ? e.status : 0;
      logLine('failed ' + provider.name + ' status=' + status + ' (' + (Date.now() - started) + 'ms) -> failover', env);
      return null;
    }
  };

  const sweep = async () => {
    for (const provider of usable) {
      const result = await attemptProvider(provider);
      if (result) return result;
    }
    return null;
  };

  let out = await sweep();
  if (out) return out;

  // Everything failed once — one jittered retry of the whole chain. This is the
  // ONLY path that sleeps, and only when there is no provider left to fail over to.
  const globalRetries = Number(env.AI_TEXT_RETRIES || 1);
  if (globalRetries > 0 && usable.length === 1) {
    try {
      out = await retryWithBackoff(() => sweep(), { retries: globalRetries });
    } catch (e) {
      logLine('all providers failed after retries', env);
      return null;
    }
    if (out) return out;
  }
  logLine('all configured providers failed', env);
  return null;
}

module.exports = { chatCompletion, configuredChain, isConfigured, breakerFor, _resetBreakers, PROVIDERS };