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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
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
        ],
      },
    ];
  },
};

export default nextConfig;
