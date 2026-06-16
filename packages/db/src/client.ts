/**
 * Database client. Single Drizzle instance shared across server runtimes.
 *
 * Postgres (Cloud SQL in prod, local Docker in dev) via postgres-js.
 * SSL is auto-enabled for managed hosts (Cloud SQL requires it).
 */
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzlePg<typeof schema>>;

// Persist across HMR reloads in dev to avoid leaking connections (Postgres "too many clients").
const globalForDb = globalThis as unknown as { __metuDb?: DbClient };

/** Lazy singleton Postgres client. */
export function getDb(): DbClient {
  if (globalForDb.__metuDb) return globalForDb.__metuDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  // SSL for managed Postgres (Cloud SQL); local dev connects plaintext.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.internal)/.test(url);
  const wantsSsl = !isLocal || /sslmode=require/.test(url);
  const sql = postgres(url, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzlePg(sql, { schema });

  globalForDb.__metuDb = db;
  return db;
}

export { schema };
