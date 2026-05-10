import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Optional runtime peers loaded via dynamic `import()` from
// `src/ui/Live2DAvatar.tsx` and `src/ui/VrmAvatar.tsx`. They are *not*
// installed in the workspace by default — the avatar components handle
// the resulting load failure and fall back to a CSS orb. Without these
// externals, Rollup tries to resolve them at build time and fails.
const OPTIONAL_AVATAR_DEPS = ['pixi.js', 'pixi-live2d-display', '@pixiv/three-vrm', 'three'];

// Also match deep subpath imports like `three/examples/jsm/...` so they
// stay external. Rollup external accepts either string or RegExp.
const OPTIONAL_AVATAR_PATTERNS: (string | RegExp)[] = [
  ...OPTIONAL_AVATAR_DEPS,
  /^three\//,
  /^@pixiv\/three-vrm\//,
];

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: false,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  optimizeDeps: {
    exclude: OPTIONAL_AVATAR_DEPS,
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      external: OPTIONAL_AVATAR_PATTERNS,
    },
  },
});
