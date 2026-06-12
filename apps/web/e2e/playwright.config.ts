import { defineConfig } from '@playwright/test';

/**
 * Smoke pack — runs against an ALREADY-RUNNING dev stack
 * (`pnpm dev` / the "⚡ start everything" task). Requires
 * E2E_AUTH_SECRET to be set in .env.local (and in this process's env)
 * for the authenticated flows.
 *
 *   pnpm --filter @metu/web e2e
 */
export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  retries: 1,
  workers: 1,
  use: {
    // 127.0.0.1 (not localhost): Node 17+ resolves localhost to ::1 first,
    // but next dev binds IPv4 only.
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:24890',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
