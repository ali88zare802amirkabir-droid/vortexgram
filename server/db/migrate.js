// VORTEXGRAM — versioned migration runner.
// Each folder under server/db/migrations/<version>_<name>/ holds up.sql + down.sql.
// Applied migrations are tracked in the `schema_migrations` table, so `up` is
// safe to re-run (idempotent) and `down` rolls back in reverse order.
//
//   node server/db/migrate.js up            apply all pending migrations
//   node server/db/migrate.js down          roll back the most recent one
//   node server/db/migrate.js status        show applied/pending migrations

const fs = require('fs');
const path = require('path');
const { poolFromEnv } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function listMigrations() {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+_/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return dirs.map((dir) => {
    const version = dir.split('_')[0];
    return {
      version,
      dir,
      upSql: fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'up.sql'), 'utf8'),
      downSql: fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'down.sql'), 'utf8'),
    };
  });
}

async function _ensureTable(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
}

async function appliedVersions(pool) {
  const r = await pool.query('SELECT version, name FROM schema_migrations ORDER BY version');
  return new Map(r.rows.map((x) => [x.version, x.name]));
}

async function up(pool) {
  await _ensureTable(pool);
  const applied = await appliedVersions(pool);
  const appliedNow = [];
  for (const m of listMigrations()) {
    if (applied.has(m.version)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.upSql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.dir]);
      await client.query('COMMIT');
      console.log('migrated up   : ' + m.dir);
      appliedNow.push(m.version);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw new Error('migration failed: ' + m.dir + ' — ' + e.message);
    } finally {
      client.release();
    }
  }
  if (!appliedNow.length) console.log('migrations up-to-date');
  return appliedNow;
}

async function down(pool, { all = false } = {}) {
  await _ensureTable(pool);
  const applied = await appliedVersions(pool);
  const allMigrations = listMigrations();
  const pending = allMigrations.filter((m) => applied.has(m.version)).reverse();
  if (!pending.length) { console.log('no migrations to roll back'); return []; }
  const targets = all ? pending : [pending[0]];
  const rolledBack = [];
  for (const m of targets) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.downSql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [m.version]);
      await client.query('COMMIT');
      console.log('migrated down : ' + m.dir);
      rolledBack.push(m.version);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw new Error('rollback failed: ' + m.dir + ' — ' + e.message);
    } finally {
      client.release();
    }
  }
  return rolledBack;
}

async function status(pool) {
  await _ensureTable(pool);
  const applied = await appliedVersions(pool);
  const rows = listMigrations().map((m) => ({
    version: m.version,
    name: m.dir.replace(/^0+/, ''),
    applied: applied.has(m.version) ? 'yes' : 'no',
  }));
  for (const r of rows) console.log('\t' + (r.applied === 'yes' ? 'applied  ' : 'pending  ') + '\t' + r.version + '  ' + r.name);
  if (!rows.length) console.log('\t(no migrations found in ' + MIGRATIONS_DIR + ')');
  return rows;
}

module.exports = { up, down, status, listMigrations, MIGRATIONS_DIR };

if (require.main === module) {
  const cmd = process.argv[2] || 'up';
  const pool = poolFromEnv();
  if (!pool) { console.error('DATABASE_URL env required'); process.exit(1); }
  const job = cmd === 'down' ? down(pool, { all: process.argv.includes('--all') }) : cmd === 'status' ? status(pool) : cmd === 'up' ? up(pool) : (console.error('usage: migrate.js <up|down|status> [--all]'), process.exit(1));
  job.then(() => pool.end()).catch((e) => { console.error(e.message); pool.end().then(() => process.exit(1)); });
}