/**
 * Database client. Single Drizzle instance shared across server runtimes.
 *
 * Two drivers:
 *  - Cloud SQL Connector (`pg` + drizzle node-postgres) when
 *    INSTANCE_CONNECTION_NAME is set. Used on Vercel/Cloud Run — no public
 *    IP allowlisting needed; auth via IAM/ADC (GCP_SA_KEY on Vercel).
 *  - postgres-js otherwise (local Docker dev, scripts).
 */
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import postgres from 'postgres';
import * as schema from './schema';

// Both drivers expose the same Drizzle query API; we standardize the public
// type on the postgres-js shape so callers get a single, stable surface.
// The node-postgres client (Cloud SQL connector path) is structurally
// compatible and cast to this type at construction.
export type DbClient = ReturnType<typeof drizzlePg<typeof schema>>;

// Persist across HMR reloads in dev to avoid leaking connections (Postgres "too many clients").
const globalForDb = globalThis as unknown as { __metuDb?: DbClient };

/**
 * Resolve GCP credentials for the Cloud SQL Connector. On Vercel we can't
 * mount a key file, so accept a base64 or raw JSON service-account key in
 * GCP_SA_KEY and hand it to the connector. On Cloud Run / GCP, ADC is used
 * automatically (return undefined).
 */
function gcpCredentials(): Record<string, unknown> | undefined {
  const raw = process.env.GCP_SA_KEY;
  if (!raw) return undefined;
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Async initializer. Use this on serverless/edge entrypoints that can await.
 * The Cloud SQL Connector's getOptions() is async, so when
 * INSTANCE_CONNECTION_NAME is set we must await it before building the Pool.
 */
export async function initDb(): Promise<DbClient> {
  if (globalForDb.__metuDb) return globalForDb.__metuDb;

  const instance = process.env.INSTANCE_CONNECTION_NAME;
  if (instance) {
    const { Connector, IpAddressTypes } = await import('@google-cloud/cloud-sql-connector');
    const pg = await import('pg');
    const credentials = gcpCredentials();
    let connector;
    if (credentials) {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
      });
      connector = new Connector({ auth });
    } else {
      connector = new Connector();
    }
    const clientOpts = await connector.getOptions({
      instanceConnectionName: instance,
      ipType: IpAddressTypes.PUBLIC,
    });
    const pool = new pg.default.Pool({
      ...clientOpts,
      user: process.env.DB_USER ?? 'metu',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME ?? 'metu',
      max: 5,
    });
    const db = drizzleNodePg(pool, { schema }) as unknown as DbClient;
    globalForDb.__metuDb = db;
    return db;
  }

  return getDb();
}

/**
 * Sync singleton. Works for postgres-js (local/scripts) and, once initDb()
 * has run, returns the cached Cloud SQL client. If the connector is required
 * but not yet initialized, throws — callers in serverless should prefer
 * awaiting initDb() at module load.
 */
export function getDb(): DbClient {
  if (globalForDb.__metuDb) return globalForDb.__metuDb;

  if (process.env.INSTANCE_CONNECTION_NAME) {
    throw new Error('Cloud SQL connector requires initDb() to be awaited before getDb()');
  }

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
