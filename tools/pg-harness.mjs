/* Boots the embedded Postgres that tests/db.test.js needs.
 *
 *   node --test --import ./tools/pg-harness.mjs tests/db.test.js
 *
 * The instance listens on 127.0.0.1:55432 with user/password postgres/postgres.
 * It lives inside the repo so Node can resolve the `embedded-postgres`
 * devDependency; the data directory is kept in the OS temp folder.
 *
 * node:test runs every test file in its own child process, so this module may
 * be evaluated more than once — it therefore checks whether the server is
 * already up and reuses it instead of starting a second one.
 */
import EmbeddedPostgres from 'embedded-postgres';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const PG_PORT = Number(process.env.VX_PG_PORT || 55432);
const DATA_DIR = process.env.VX_PG_DATA || path.join(os.tmpdir(), 'vortexgram-pg-data');

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

if (await portOpen(PG_PORT)) {
  console.log('[pg-harness] postgres already listening on ' + PG_PORT + ' — reusing it');
} else {
  let pg;
  try {
    pg = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: 'postgres',
      password: 'postgres',
      port: PG_PORT,
      persistent: true,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('vortex_test');
    console.log('[pg-harness] embedded postgres ready on ' + PG_PORT);
  } catch (e) {
    console.error('[pg-harness] could not start embedded postgres:', e && e.message);
  }
  process.on('exit', () => { try { pg && pg.stop(); } catch (e) { /* ignore */ } });
}
