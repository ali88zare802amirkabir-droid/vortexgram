// VORTEXGRAM — one-shot seed: applies the versioned schema and imports a JSON
// snapshot (data/db.json.migrated) through the SAME normalized relational path
// used by the runtime (server/db/repositories). No JSON blobs are stored.
//
//   DATABASE_URL=... node migrate-pg.js [snapshot.json]

const path = require('path');
const fs = require('fs');
const { poolFromEnv } = require('./server/db/connection');
const migrate = require('./server/db/migrate');
const repo = require('./server/db/repositories');

const SNAPSHOT = process.env.SNAPSHOT_FILE || path.join(__dirname, 'data', 'db.json.migrated');

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL env required'); process.exit(1); }
  const file = process.argv[2] || SNAPSHOT;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete data.sessions; // expired dev tokens — intentionally not seeded into a fresh DB
  const pool = poolFromEnv();
  pool.on('error', (e) => console.error('pool error:', e.message));

  await migrate.up(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.truncateAll(client);
    await repo.insertAll(client, repo.buildAll(data));
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
  console.log(
    `Seeded Postgres: ${data.users.length} users, ${data.groups.length} groups, ` +
    `${Object.values(data.messages || {}).reduce((a, x) => a + x.length, 0)} messages (normalized relational schema)`
  );
}

main().catch((e) => { console.error('migrate failed:', e.message); process.exit(1); });