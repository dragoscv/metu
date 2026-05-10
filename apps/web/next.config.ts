import type { NextConfig } from 'next';
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: isProd,
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
    ];
  },
};

export default nextConfig;
