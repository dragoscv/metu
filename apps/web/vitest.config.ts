import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.ts'],
    exclude: ['node_modules', '.next'],
    // Toolchain standardisation (2026-11-24): pin the worker count. The bare
    // config spawned cpus-1 workers, so wall time and peak memory depended on
    // the machine (31 workers on the 32-core dev box). The persistent transform
    // cache needs no config here: Vitest 5 defaults `fsModuleCache` to true
    // with `node_modules/.vitest-cache`.
    maxWorkers: '50%',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
