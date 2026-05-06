import baseConfig from '@metu/config/eslint.base.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['src-tauri/**', 'dist/**'],
  },
];
