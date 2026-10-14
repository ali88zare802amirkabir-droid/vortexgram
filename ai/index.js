// VORTEXGRAM — AI facade (public surface for server.js).
//
//   const ai = require('./ai');
//   ai.isConfigured()               -> any text provider present?
//   ai.chatCompletion(messages,o)   -> ordered chain + circuit breaker
//   ai.moderate / ai.safeMessages   -> safety layer
//   ai.quotas.check/spend           -> DB-backed daily quotas
//   ai.generateImage / ai.transcribe -> optional media
//
// Nothing here throws for "not configured": the caller maps null to a Persian
// 503 so the rest of the app keeps working with zero AI environment set.

'use strict';

const chain = require('./providers');
const safety = require('./safety');
const quota = require('./quota');
const media = require('./media');
const reliability = require('./reliability');

module.exports = {
  // text
  chatCompletion: chain.chatCompletion,
  isConfigured: chain.isConfigured,
  configuredChain: chain.configuredChain,
  PROVIDERS: chain.PROVIDERS,

  // safety
  moderate: safety.moderate,
  guardPrompt: safety.guardPrompt,
  guardOutput: safety.guardOutput,
  capOutput: safety.capOutput,
  wrapUntrusted: safety.wrapUntrusted,
  safeMessages: safety.safeMessages,
  stripRoleMarkers: safety.stripRoleMarkers,

  // quotas
  createQuotaStore: quota.createQuotaStore,
  quotaConfig: quota.config,
  quotaError: quota.quotaError,
  dayStart: quota.dayStart,
  nextDay: quota.nextDay,

  // media
  generateImage: media.generateImage,
  imageConfigured: media.imageConfigured,
  transcribe: media.transcribe,
  whisperAvailable: media.whisperAvailable,

  // reliability (exported for tests)
  CircuitBreaker: reliability.CircuitBreaker,
  backoffDelay: reliability.backoffDelay,
  ProviderError: require('./providers/base').ProviderError,
};