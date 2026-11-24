import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Toolchain standardisation (2026-11-24): pin the worker count. The bare
    // config spawned cpus-1 workers, so wall time and peak memory depended on
    // the machine. The persistent transform cache needs no config here: Vitest 5
    // defaults `fsModuleCache` to true with `node_modules/.vitest-cache`.
    maxWorkers: '50%',
  },
});
