import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Live2D peers (`pixi.js`, `pixi-live2d-display`) remain optional and are NOT
// installed — the Live2D avatar tier is dormant and falls back to the shader
// orb / VRM. `three` and `@pixiv/three-vrm` ARE installed now (VRM tier is
// live), so they must resolve normally. Without this stub Vite's dev
// import-analysis 500s on the uninstalled pixi packages.
const OPTIONAL_LIVE2D_DEPS = ['pixi.js', 'pixi-live2d-display'];

function optionalLive2dDepsStub(): Plugin {
  const VIRTUAL = '\0metu-missing-optional-dep';
  const isOptional = (id: string) => OPTIONAL_LIVE2D_DEPS.includes(id);
  return {
    name: 'metu:optional-live2d-deps-stub',
    enforce: 'pre',
    resolveId(id) {
      if (isOptional(id)) return VIRTUAL;
      return null;
    },
    load(id) {
      if (id === VIRTUAL) {
        return `throw new Error('optional Live2D dependency not installed');`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [optionalLive2dDepsStub(), react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: false,
    // Tauri writes build artifacts (incl. a locked *.dll) under src-tauri/.
    // Watching them races cargo and crashes Vite with EBUSY on Windows.
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  optimizeDeps: {
    // Workspace packages ship raw TS source (`exports: ./src/*.ts`).
    // Excluding them from pre-bundling keeps them on the normal module
    // graph so edits in packages/voice|sdk|protocol|presence HMR
    // instantly instead of requiring a dev-server restart (esbuild
    // pre-bundle snapshots are NOT watched).
    exclude: [
      ...OPTIONAL_LIVE2D_DEPS,
      '@metu/voice',
      '@metu/sdk',
      '@metu/protocol',
      '@metu/presence',
    ],
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },
});
