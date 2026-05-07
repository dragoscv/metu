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
