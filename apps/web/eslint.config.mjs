import { default as nextConfig } from '@next/eslint-plugin-next';
import baseConfig from '@metu/config/eslint.base.mjs';

// ESM-compatible dynamic import for react-hooks plugin
const reactHooksPlugin = await import('eslint-plugin-react-hooks');

export default [
  ...baseConfig,
  {
    plugins: { '@next/next': nextConfig, 'react-hooks': reactHooksPlugin },
    rules: {
      ...nextConfig.configs.recommended.rules,
      ...nextConfig.configs['core-web-vitals'].rules,
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
