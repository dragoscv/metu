/**
 * Database client. Single Drizzle instance shared across server runtimes.
 *
 * - In Vercel/Edge: uses @neondatabase/serverless WebSocket driver.
 * - In Node (worker, scripts): uses postgres-js.
 */
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNeonPool } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzleNeonPool<typeof schema>>
  | ReturnType<typeof drizzlePg<typeof schema>>;

// Persist across HMR reloads in dev to avoid leaking connections (Postgres "too many clients").
const globalForDb = globalThis as unknown as { __metuDb?: DbClient };

/** Lazy singleton — picks the right driver based on env. */
export function getDb(): DbClient {
  if (globalForDb.__metuDb) return globalForDb.__metuDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const isNeon = /neon\.tech/.test(url);
  const isEdge = process.env.NEXT_RUNTIME === 'edge';

  let db: DbClient;
  if (isNeon && isEdge) {
    const sql = neon(url);
    db = drizzleNeon(sql, { schema });
  } else if (isNeon) {
    // Node runtime + Neon: use pool for transactions
    neonConfig.fetchConnectionCache = true;
    const pool = new Pool({ connectionString: url });
    db = drizzleNeonPool(pool, { schema });
  } else {
    // Plain Postgres (Cloud SQL / local)
    const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 });
    db = drizzlePg(sql, { schema });
  }

  globalForDb.__metuDb = db;
  return db;
}

export { schema };
