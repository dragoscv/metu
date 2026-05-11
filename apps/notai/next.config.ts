import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@metu/sdk', '@metu/protocol'],
};

export default nextConfig;
