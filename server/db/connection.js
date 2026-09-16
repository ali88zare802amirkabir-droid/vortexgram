// VORTEXGRAM — single connection factory shared by db.js, migrate.js, migrate-pg.js and tests.
// Usage: const { poolFromEnv } = require('./db/connection');

const { Pool } = require('pg');

// node-pg treats `sslmode=require` as verify-full (cert validation the app does
// not want) and chokes on Neon's `channel_binding=require`. Normalize those out
// and drive TLS via the `ssl` option below instead.
function normalizeUrl(url) {
  const [base, query] = String(url || '').split('?');
  if (!query) return url;
  const keep = query.split('&').filter((p) => !/^(sslmode|channel_binding)=/i.test(p));
  return keep.length ? base + '?' + keep.join('&') : base;
}

function poolFromEnv(url) {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) return null;
  const hadPlain = /(?:^|[?&])sslmode=disable/i.test(String(connectionString));
  const cfg = {
    connectionString: normalizeUrl(connectionString),
    max: 4,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  };
  if (!hadPlain) cfg.ssl = { rejectUnauthorized: false };
  const p = new Pool(cfg);
  p.on('error', (e) => console.error('DB pool error:', e.message));
  return p;
}

module.exports = { poolFromEnv };