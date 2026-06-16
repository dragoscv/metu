import type { NextConfig } from 'next';
import type * as SentryNextjs from '@sentry/nextjs';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load env from monorepo root .env.local for local dev
for (const candidate of ['../../.env.local', '../../.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    loadEnv({ path: p });
  }
}

// React Compiler (babel-plugin-react-compiler) is expensive in dev with Turbopack
// because every file is re-transpiled on change. Restrict it to production builds.
const isProd = process.env.NODE_ENV === 'production';

// Resolve the monorepo root robustly: walk up from cwd until we find
// pnpm-workspace.yaml. Neither __dirname (wrong in the compiled config)
// nor a fixed `cwd + ../..` (wrong on config re-evaluation) is reliable.
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), '../..');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: isProd,
  cacheComponents: true,
  // Pin the monorepo root explicitly — inference warns and has produced
  // Turbopack panics when multiple lockfiles are visible on the machine.
  turbopack: {
    root: findRepoRoot(),
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  transpilePackages: [
    '@metu/ai',
    '@metu/auth',
    '@metu/core',
    '@metu/db',
    '@metu/integrations',
    '@metu/types',
    '@metu/ui',
  ],
  serverExternalPackages: [
    'postgres',
    '@neondatabase/serverless',
    'googleapis',
    'octokit',
    '@google-cloud/storage',
    '@google-cloud/secret-manager',
    '@google-cloud/speech',
    'telegraf',
    '@sentry/node',
    '@sentry/nextjs',
  ],
  async headers() {
    // CSP: 'unsafe-inline' on script-src is currently required because Next.js
    // App Router emits inline bootstrap scripts without a per-request nonce in
    // RSC. Revisit when next-safe-action / nonce middleware lands.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.googleusercontent.com https://avatars.githubusercontent.com https://storage.googleapis.com",
      "media-src 'self' blob: https://storage.googleapis.com",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      // CORS for the bearer-token API surface used by non-browser-origin
      // clients: the Tauri companion webview (http://localhost:5173 in dev,
      // tauri.localhost in prod), browser extension, etc. These routes
      // authenticate via Authorization header — never cookies — so a
      // wildcard origin does not enable CSRF. Without these headers every
      // companion fetch dies with "Failed to fetch" (no ACAO on response).
      ...['/api/sdk/:path*', '/api/voice/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'authorization, content-type' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      })),
    ];
  },
};

// Wrap with Sentry only when the build plugin is available AND an auth token
// is present (source-map upload). Guarded so local/CI builds without Sentry
// configured never fail. Source maps are uploaded + hidden from the client.
let exported: NextConfig = nextConfig;
if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withSentryConfig } = require('@sentry/nextjs') as typeof SentryNextjs;
    exported = withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      disableLogger: true,
      telemetry: false,
    }) as NextConfig;
  } catch {
    // plugin not installed — ship without source-map upload
  }
}

export default exported;
