/**
 * Database client. Single Drizzle instance shared across server runtimes.
 *
 * Postgres (Cloud SQL in prod, local Docker in dev) via postgres-js.
 * SSL is auto-enabled for non-local hosts (Cloud SQL requires it).
 */
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzlePg<typeof schema>>;

// Persist across HMR reloads in dev to avoid leaking connections (Postgres "too many clients").
const globalForDb = globalThis as unknown as { __metuDb?: DbClient };

/** Lazy singleton — picks the right driver based on env. */
export function getDb(): DbClient {
  if (globalForDb.__metuDb) return globalForDb.__metuDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  // Enable SSL for managed Postgres (Cloud SQL). Local dev (localhost /
  // 127.0.0.1 / *.internal) connects without SSL. Honors sslmode in the URL.
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
