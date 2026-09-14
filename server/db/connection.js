// VORTEXGRAM — single connection factory shared by db.js, migrate.js, migrate-pg.js and tests.
// Usage: const { poolFromEnv } = require('./db/connection');

const { Pool } = require('pg');

function poolFromEnv(url) {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) return null;
  const cfg = {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 30000,
  };
  if (!/sslmode=disable/.test(connectionString)) cfg.ssl = { rejectUnauthorized: false };
  const p = new Pool(cfg);
  p.on('error', (e) => console.error('DB pool error:', e.message));
  return p;
}

module.exports = { poolFromEnv };