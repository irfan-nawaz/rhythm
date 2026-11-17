import postgres from 'postgres';
import { config } from './config.js';

// One connection pool per process. Total connections to Postgres =
// DB_POOL_MAX x number of running processes, which must stay below the
// server's max_connections (100 by default).
export const sql = postgres(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  idle_timeout: 30,
  connect_timeout: 10,
  // Set DB_PREPARE=false when connecting through PgBouncer in transaction mode.
  prepare: config.DB_PREPARE,
  // snake_case columns in SQL, camelCase properties in TypeScript.
  transform: postgres.camel,
  types: {
    // Keep DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, so a
    // calendar day never shifts because of a server's time zone.
    dateString: {
      to: 1082,
      from: [1082],
      serialize: (value: string) => value,
      parse: (value: string) => value,
    },
  },
  // Shows up in pg_stat_activity, so you can see which service holds connections.
  connection: { application_name: `rhythm-${config.serviceName}` },
  onnotice: () => {},
});

export type Sql = typeof sql;

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
