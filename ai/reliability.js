// VORTEXGRAM — AI reliability primitives: circuit breaker + backoff with jitter.
//
// A dead provider must never stall requests: after N consecutive failures its
// circuit OPENS and the chain skips it without attempting; after a cooldown it
// goes HALF-OPEN and lets one probe through. `now` is injectable so the breaker
// is unit-testable without sleeping.

'use strict';

class CircuitBreaker {
  constructor({ failures = 5, cooldownMs = 60000, now = Date.now } = {}) {
    this.failures = Math.max(1, failures | 0);
    // No artificial floor: a caller asking for a 250ms cooldown (tests, or a
    // deliberately twitchy breaker) gets exactly that. Only negatives are clamped.
    this.cooldownMs = Math.max(0, cooldownMs | 0);
    this._now = now;
    this._consecutive = 0;
    this._openedAt = null;    // null = closed (0 would collide with a valid ts)
    this._halfOpen = false;
  }

  get state() {
    if (this._openedAt === null) return 'closed';
    if (this._now() - this._openedAt >= this.cooldownMs) return 'half-open';
    return 'open';
  }

  // True when a call may be attempted right now. Transitions open -> half-open.
  canAttempt() {
    if (this._openedAt === null) { this._halfOpen = false; return true; }
    if (this._now() - this._openedAt >= this.cooldownMs) { this._halfOpen = true; return true; }
    return false;
  }

  recordSuccess() {
    this._consecutive = 0;
    this._openedAt = null;
    this._halfOpen = false;
  }

  recordFailure() {
    this._consecutive += 1;
    if (this._halfOpen || this._consecutive >= this.failures) {
      this._openedAt = this._now();
      this._halfOpen = false;
    }
  }

  get consecutiveFailures() { return this._consecutive; }
}

// Exponential backoff with full jitter: delay = min(cap, base * 2^attempt) + rand(0, base).
// Pure function of (attempt, baseMs, capMs, rand) — unit-tested, never called with
// the intent to "wait and retry the same provider instead of failing over".
function backoffDelay(attempt, baseMs = 200, capMs = 2000, rand = Math.random) {
  const grown = Math.min(capMs, baseMs * (2 ** Math.max(0, attempt | 0)));
  return Math.floor(grown + rand() * baseMs);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

module.exports = { CircuitBreaker, backoffDelay, sleep };
