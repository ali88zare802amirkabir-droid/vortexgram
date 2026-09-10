const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const SNAPSHOT = process.env.SNAPSHOT_FILE || path.join(__dirname, 'data', 'db.json.migrated');

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL env required'); process.exit(1); }
  const raw = fs.readFileSync(SNAPSHOT, 'utf8');
  const data = JSON.parse(raw);
  delete data.sessions;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=disable/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (e) => console.error('pool error:', e.message));
  await pool.query('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  await pool.query(
    'INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    ['main', JSON.stringify(data)]
  );
  await pool.end();
  console.log(`Seeded Postgres: ${data.users.length} users, ${data.groups.length} groups, ${Object.values(data.messages || {}).reduce((a, x) => a + x.length, 0)} messages`);
}

main().catch((e) => { console.error('migrate failed:', e.message); process.exit(1); });