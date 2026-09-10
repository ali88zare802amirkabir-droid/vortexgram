const { Pool } = require('pg');

let pool = null;
let healthy = false;
let queue = Promise.resolve();

function _poolCfg() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const cfg = { connectionString: url, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 };
  if (!/sslmode=disable/.test(url)) {
    if (!/sslmode/.test(url)) cfg.ssl = { rejectUnauthorized: false };
  }
  return cfg;
}

function _makePool() {
  const cfg = _poolCfg();
  if (!cfg) return null;
  const p = new Pool(cfg);
  p.on('error', (e) => console.error('DB pool error:', e.message));
  return p;
}

async function _ensureSchema() {
  await pool.query('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

async function load() {
  if (!pool) pool = _makePool();
  if (!pool) {
    console.warn('DATABASE_URL not set — using in-memory data (NOT persisted across restarts)');
    return null;
  }
  try {
    await _ensureSchema();
    const r = await pool.query('SELECT value FROM state WHERE key = $1', ['main']);
    healthy = true;
    const row = r.rows[0];
    if (!row) return null;
    return JSON.parse(row.value);
  } catch (e) {
    console.error('DB load failed:', e.message);
    return null;
  }
}

async function _doSave(data) {
  if (!healthy) { console.error('DB not healthy yet, skipping save'); return; }
  try {
    await pool.query(
      'INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['main', JSON.stringify(data)]
    );
  } catch (e) {
    console.error('DB save failed:', e.message);
  }
}

function save(data) {
  queue = queue.then(() => _doSave(data)).catch(() => {});
  return queue;
}

async function close() {
  await queue.catch(() => {});
  if (pool) { try { await pool.end(); } catch {} pool = null; }
  healthy = false;
}

module.exports = { load, save, close };