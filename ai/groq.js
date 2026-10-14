// VORTEXGRAM — ai/groq.js (compatibility shim).
//
// The old single-provider module was refactored into ai/providers/*.js with an
// ordered fallback chain. This file keeps the historical import path working:
//   const { chatCompletion } = require('./ai/groq');
// now resolves to the chain in ai/providers/index.js, so existing callers get
// multi-provider failover and circuit breaking without changing their code.
//
// New code should import from './ai/providers' (or the top-level ai/index.js).

'use strict';

const chain = require('./providers');

async function chatCompletion(messages, primaryModel, opts = {}) {
  // Historical signature: chatCompletion(messages, primaryModel).
  const model = primaryModel || opts.model;
  return chain.chatCompletion(messages, { ...opts, model });
}

module.exports = {
  chatCompletion,
  // Re-export the chain surface so callers can migrate incrementally.
  isConfigured: chain.isConfigured,
  configuredChain: chain.configuredChain,
  PROVIDERS: chain.PROVIDERS,
};