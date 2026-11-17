import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Applies migrations/*.sql in name order, each in its own transaction, and
// records them in schema_migrations.
//
// Safe to start from several places at once (for example, every replica of a
// deploy): a Postgres advisory lock lets one run while the others wait, then
// find nothing left to do. Advisory locks belong to a database session, so
// this script uses a single dedicated connection, and it must connect to
// Postgres directly rather than through PgBouncer in transaction mode.

const log = logger.child({ service: 'migrate' });
const migrationsDir = new URL('../../migrations/', import.meta.url);
const LOCK_KEY = 7_420_001;

const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });

async function migrate(): Promise<void> {
  await sql`select pg_advisory_lock(${LOCK_KEY})`;
  try {
    await sql`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )`;
    const rows = await sql<{ version: string }[]>`select version from schema_migrations`;
    const applied = new Set(rows.map((row) => row.version));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = await readFile(new URL(file, migrationsDir), 'utf8');
      log.info({ file }, 'applying migration');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (version) values (${file})`;
      });
      count += 1;
    }
    log.info({ applied: count, total: files.length }, count > 0 ? 'migrations applied' : 'database is up to date');
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`;
  }
}

try {
  await migrate();
} catch (err) {
  log.error({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
