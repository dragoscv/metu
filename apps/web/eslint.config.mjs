import { default as nextConfig } from '@next/eslint-plugin-next';
import baseConfig from '@metu/config/eslint.base.mjs';

export default [
  ...baseConfig,
  {
    plugins: { '@next/next': nextConfig },
    rules: {
      ...nextConfig.configs.recommended.rules,
      ...nextConfig.configs['core-web-vitals'].rules,
    },
  },
];
