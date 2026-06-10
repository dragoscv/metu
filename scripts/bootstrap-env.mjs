#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * metu — bootstrap .env.local for local development.
 *
 * Generates a working .env.local pointing at the docker-compose stack and
 * fills in cryptographically random secrets. Idempotent: existing values are
 * preserved unless `--force` is passed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, '.env.local');
const FORCE = process.argv.includes('--force');

const b64 = (n) => randomBytes(n).toString('base64');
const hex = (n) => randomBytes(n).toString('hex');

const defaults = {
  NODE_ENV: 'development',
  AUTH_SECRET: b64(32),
  AUTH_URL: 'http://localhost:24890',
  NEXTAUTH_URL: 'http://localhost:24890',

  // Local Postgres + pgvector (docker-compose, host port 24800 to avoid clashes
  // with the Windows-reserved Hyper-V/WSL port range that includes 5433)
  DATABASE_URL: 'postgres://metu:metu@localhost:24800/metu?sslmode=disable',
  DIRECT_URL: 'postgres://metu:metu@localhost:24800/metu?sslmode=disable',

  // Auth.js — create at https://console.cloud.google.com/apis/credentials
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',

  // BYOK envelope encryption (32 bytes base64 = 256 bits)
  ENCRYPTION_KEY: b64(32),
  MASTER_ENCRYPTION_KEY: b64(32),

  // GCP — defaults to project; ADC via `gcloud auth application-default login`
  GCP_PROJECT_ID: 'metu-prod-495423',
  GCP_REGION: 'europe-west1',

  // Local object storage (MinIO) — wire S3 SDK to it via these
  GCS_BUCKET: 'metu-uploads',
  S3_ENDPOINT: 'http://localhost:24897',
  S3_ACCESS_KEY: 'metu',
  S3_SECRET_KEY: 'metu-local-password',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
  STORAGE_DRIVER: 's3-local', // app reads this to pick MinIO over GCS

  // Upstash-compatible REST proxy → local redis
  UPSTASH_REDIS_REST_URL: 'http://localhost:24899',
  UPSTASH_REDIS_REST_TOKEN: 'metu-local-token',
  REDIS_URL: 'redis://localhost:24896',

  // Inngest dev server (no signing key needed in dev)
  INNGEST_DEV: '1',
  INNGEST_BASE_URL: 'http://localhost:24893',
  INNGEST_EVENT_KEY: 'local-dev',
  INNGEST_SIGNING_KEY: '',

  // SMTP (mailpit)
  SMTP_URL: 'smtp://localhost:24898',
  EMAIL_FROM: 'metu <noreply@localhost>',

  // NOTE: AI provider API keys (Anthropic / OpenAI / Google / Azure) are
  // intentionally NOT stored as env vars. Add them per-workspace via
  // Settings → AI providers (BYOK); they are sealed (AES-256-GCM) and
  // stored in the `provider_credential` table. ENCRYPTION_KEY above is the
  // envelope key.

  // Worker (Cloud Run in prod, local in dev)
  WORKER_URL: 'http://localhost:24892',
  WORKER_AUTH_TOKEN: hex(32),

  // Cross-client bearer (mobile/ext) — dev only; prod uses hashed PATs
  METU_DEV_API_TOKEN: hex(32),
  METU_DEV_WORKSPACE_ID: '',
  METU_DEV_USER_ID: '',

  // Integrations
  GITHUB_APP_ID: '',
  GITHUB_APP_PRIVATE_KEY: '',
  GITHUB_WEBHOOK_SECRET: hex(24),
  TELEGRAM_BOT_TOKEN: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: hex(24),

  NEXT_PUBLIC_APP_URL: 'http://localhost:24890',
  NEXT_PUBLIC_APP_NAME: 'metu',

  // Realtime hub (apps/hub) — internal shared secret + URL the web app uses
  // to broadcast back into the hub. WEB_INTERNAL_URL is what the hub posts to
  // when forwarding tool.result envelopes.
  HUB_INTERNAL_URL: 'http://localhost:24891',
  HUB_INTERNAL_SECRET: hex(32),
  WEB_INTERNAL_URL: 'http://localhost:24890',
  HUB_PORT: '24891',

  // Web push (VAPID) — generate with `npx web-push generate-vapid-keys`.
  // Empty by default so push gracefully no-ops in dev.
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  VAPID_SUBJECT: 'mailto:dev@localhost',

  // Expo push — only needed if you're testing native mobile notifications.
  EXPO_ACCESS_TOKEN: '',

  // Companion (Tauri) public client id. Must match the row in /apps page.
  METU_COMPANION_CLIENT_ID: 'metu_app_companion',
};

function parse(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function format(obj) {
  const groups = [
    ['Core', ['NODE_ENV', 'AUTH_SECRET', 'AUTH_URL', 'NEXTAUTH_URL']],
    ['Database', ['DATABASE_URL', 'DIRECT_URL']],
    ['Google OAuth', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
    ['Encryption', ['ENCRYPTION_KEY', 'MASTER_ENCRYPTION_KEY']],
    [
      'GCP / object storage',
      [
        'GCP_PROJECT_ID',
        'GCP_REGION',
        'GCS_BUCKET',
        'STORAGE_DRIVER',
        'S3_ENDPOINT',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'S3_REGION',
        'S3_FORCE_PATH_STYLE',
      ],
    ],
    ['Redis', ['REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']],
    ['Inngest', ['INNGEST_DEV', 'INNGEST_BASE_URL', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']],
    ['Email (mailpit)', ['SMTP_URL', 'EMAIL_FROM']],
    [
      'Worker + bearer',
      [
        'WORKER_URL',
        'WORKER_AUTH_TOKEN',
        'METU_DEV_API_TOKEN',
        'METU_DEV_WORKSPACE_ID',
        'METU_DEV_USER_ID',
      ],
    ],
    [
      'Integrations',
      [
        'GITHUB_APP_ID',
        'GITHUB_APP_PRIVATE_KEY',
        'GITHUB_WEBHOOK_SECRET',
        'TELEGRAM_BOT_TOKEN',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
      ],
    ],
    ['Public', ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_NAME']],
  ];
  const lines = [
    '# Auto-generated by scripts/bootstrap-env.mjs — safe to edit by hand.',
    '# Re-run with --force to regenerate secrets (will overwrite).',
    '',
  ];
  for (const [title, keys] of groups) {
    lines.push(`# ----- ${title}`);
    for (const k of keys) lines.push(`${k}=${obj[k] ?? ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

const existing = existsSync(ENV_PATH) && !FORCE ? parse(readFileSync(ENV_PATH, 'utf8')) : {};
const merged = { ...defaults, ...existing };
writeFileSync(ENV_PATH, format(merged));
console.log(`✔ wrote ${ENV_PATH}`);
console.log(
  FORCE
    ? '  (forced regeneration — secrets rotated)'
    : Object.keys(existing).length
      ? '  (preserved existing values)'
      : '  (created with fresh secrets)',
);
