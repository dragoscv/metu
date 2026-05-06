import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load env from repo root .env.local for local dev
for (const candidate of ['../../.env.local', '../../.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for drizzle-kit');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
