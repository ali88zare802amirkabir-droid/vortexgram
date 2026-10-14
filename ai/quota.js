// VORTEXGRAM — AI quotas.
//
// Daily budgets, reset at 00:00 UTC, tracked separately for text and image, at
// two levels: per-user and global.
//
// Atomicity
// ---------
// All counters live in ONE runtime db object and every mutation runs to
// completion inside a single synchronous critical section (no await inside the
// check-and-increment). Node executes that section without interleaving, so two
// concurrent requests can never both observe "1 left" and both spend it — the
// classic double-spend race cannot happen here. The debounced saveDB() then
// flushes the counters to the file/DB backend together with everything else.
//
// Accounting happens AFTER the provider answered: a failed call (or one blocked
// by moderation) never burns a user's quota.

'use strict';

const KIND_TEXT = 'text';
const KIND_IMAGE = 'image';

// 00:00 UTC of the current day, as a ms epoch. Quota days are UTC days so the
// reset time does not drift with the server's timezone.
function dayStart(now = Date.now()) {
  return Math.floor(now / 86400000) * 86400000;
}
function nextDay(now = Date.now()) {
  return dayStart(now) + 86400000;
}

function numEnv(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Quota configuration. Every limit defaults to "generous but finite"; set a
 * limit to 0 to disable that tier, and to a huge number to make it irrelevant.
 */
function config(env = process.env) {
  const globalText = numEnv(env.AI_QUOTA_GLOBAL_TEXT, 5000);
  const globalImage = numEnv(env.AI_QUOTA_GLOBAL_IMAGE, 500);
  return {
    userText: numEnv(env.AI_QUOTA_USER_TEXT, 50),
    userImage: numEnv(env.AI_QUOTA_USER_IMAGE, 5),
    globalText,
    globalImage,
    // Tokens: only charged when the provider reports usage. 0 = unlimited.
    userTokens: numEnv(env.AI_QUOTA_USER_TOKENS, 0),
    // Admin/premium accounts bypass the per-user limit (global still applies).
    adminBypass: String(env.AI_QUOTA_ADMIN_BYPASS || '1') !== '0',
  };
}

/**
 * Create the quota store.
 *
 * @param {object} deps
 * @param {Function} deps.getState  () => runtime db object
 * @param {Function} deps.setState  (patch) => void   merge into the runtime db
 * @param {Function} deps.save      () => void        persist (debounced saveDB)
 * @param {Function} [deps.now]     () => number      injectable clock (tests)
 */
function createQuotaStore({ getState, setState, save, now = Date.now }) {
  // Ensure aiUsage exists ON THE REAL STATE OBJECT. Assigning it (rather than
  // `db.aiUsage || {}`) matters: the `||` form creates a throwaway literal whose
  // writes are silently lost, so every counter would stay at zero forever.
  function usage() {
    const db = getState();
    if (!db.aiUsage || typeof db.aiUsage !== 'object') setState({ aiUsage: {} });
    return getState().aiUsage;
  }

  // Buckets: aiUsage[day][kind].{count,tokens,users}
  function bucket(kind) {
    const today = dayStart(now());
    const usageMap = usage();
    if (!usageMap[today]) usageMap[today] = {};
    const row = usageMap[today][kind] || (usageMap[today][kind] = { count: 0, tokens: 0, users: {} });
    return row;
  }

  function userCount(username, kind) {
    const row = bucket(kind);
    const u = row.users[username] || 0;
    return Number.isFinite(u) ? u : 0;
  }

  /**
   * Synchronous check. Returns { ok, limit, used, reason, resetsAt }.
   * MUST be called immediately before spending, with no await in between.
   */
  function check(username, kind, opts = {}) {
    const cfg = opts.config || config();
    const isAdmin = !!opts.isAdmin;
    const row = bucket(kind);
    const resetsAt = nextDay(now());

    // per-user count
    const limit = kind === KIND_IMAGE ? cfg.userImage : cfg.userText;
    const bypassUser = cfg.adminBypass && isAdmin;
    const used = userCount(username, kind);
    if (!bypassUser && limit > 0 && used >= limit) {
      return { ok: false, reason: 'user', limit, used, resetsAt };
    }
    // per-user tokens
    if (!bypassUser && cfg.userTokens > 0 && kind === KIND_TEXT) {
      const t = Number(row.tokens || 0);
      if (t >= cfg.userTokens) return { ok: false, reason: 'tokens', limit: cfg.userTokens, used: t, resetsAt };
    }
    // global count
    const globalLimit = kind === KIND_IMAGE ? cfg.globalImage : cfg.globalText;
    const g = Number(row.count || 0);
    if (globalLimit > 0 && g >= globalLimit) {
      return { ok: false, reason: 'global', limit: globalLimit, used: g, resetsAt };
    }
    return { ok: true, used, resetsAt };
  }

  /** Synchronous increment. Call right after a successful provider call. */
  function spend(username, kind, { tokens = 0, config: cfg } = {}) {
    const row = bucket(kind);
    row.count = (Number(row.count) || 0) + 1;
    const cur = row.users[username] || 0;
    row.users[username] = cur + 1;
    if (Number.isFinite(tokens) && tokens > 0) row.tokens = (Number(row.tokens) || 0) + Math.floor(tokens);
    save();
    return { count: row.count, tokens: row.tokens, user: row.users[username] };
  }

  /** Read-only snapshot for admin UIs / tests. Does not create state. */
  function snapshot() {
    const db = getState();
    const today = dayStart(now());
    const row = (db.aiUsage && db.aiUsage[today]) || {};
    return { day: today, resetsAt: nextDay(now()), text: row[KIND_TEXT] || { count: 0, tokens: 0, users: {} }, image: row[KIND_IMAGE] || { count: 0, tokens: 0, users: {} } };
  }

  /** Drop days older than today (called on boot / hourly like other prunes). */
  function prune(keepDays = 3) {
    const db = getState();
    const usage = db.aiUsage;
    if (!usage || typeof usage !== 'object') return 0;
    const cutoff = dayStart(now()) - (Math.max(0, keepDays - 1) * 86400000);
    let removed = 0;
    for (const k of Object.keys(usage)) {
      const n = Number(k);
      if (Number.isFinite(n) && n < cutoff) { delete usage[k]; removed++; }
    }
    if (removed) save();
    return removed;
  }

  /** Test helper: wipe all usage. */
  function reset() {
    setState({ aiUsage: {} });
    save();
  }

  return { check, spend, snapshot, prune, reset, config, dayStart, nextDay };
}

// Persian messages, one per refusal reason. Kept here so every caller answers
// identically.
const ERRORS = {
  user: 'سهمیه امروز شما تمام شد. فردا دوباره تلاش کنید.',
  tokens: 'سهمیه امروز شما تمام شد. فردا دوباره تلاش کنید.',
  global: 'سهمیهٔ امروز سرویس هوش مصنوعی تمام شد. کمی بعد دوباره تلاش کنید.',
  notConfigured: 'هوش مصنوعی تنظیم نشده است.',
};

function quotaError(reason) {
  return ERRORS[reason] || ERRORS.user;
}

module.exports = { createQuotaStore, config, quotaError, dayStart, nextDay, ERRORS, KIND_TEXT, KIND_IMAGE };