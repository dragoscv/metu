/**
 * Drizzle migration runner. Run after `drizzle-kit generate`.
 *   pnpm --filter @metu/db migrate
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

// Also try repo-root .env.local for local dev.
loadEnv({ path: new URL('../../../.env.local', import.meta.url).pathname.replace(/^\//, '') });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

async function main() {
  // Ensure pgvector extension first.
  await sql`create extension if not exists vector`;
  await sql`create extension if not exists pg_trgm`;
  await migrate(db, { migrationsFolder: './drizzle' });
  console.info('✅ migrations applied');
  await sql.end();
}

main().catch((err) => {
  console.error('❌ migration failed', err);
  process.exit(1);
});
