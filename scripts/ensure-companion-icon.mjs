#!/usr/bin/env node
/**
 * Bootstrap the companion app's icon set.
 *
 * Source of truth is `apps/companion/src-tauri/icons/icon.svg` (mirrored from
 * `assets/brand/logo.svg`). We rasterize it to a 1024x1024 PNG via
 * @resvg/resvg-js, then run `tauri icon` to materialize every platform
 * artifact (.ico, .icns, square logos, iOS, Android).
 *
 * Idempotent: skips if `icon.ico` and `icon.icns` already exist.
 *
 * Used by:
 *   - .github/workflows/release-companion.yml
 *   - `pnpm companion:icons`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const iconsDir = resolve(repoRoot, 'apps/companion/src-tauri/icons');
const sourceSvg = resolve(iconsDir, 'icon.svg');
const sourcePng = resolve(iconsDir, 'icon.png');

mkdirSync(iconsDir, { recursive: true });

const existing = readdirSync(iconsDir);
if (existing.some((f) => /\.ico$/i.test(f)) && existing.some((f) => /\.icns$/i.test(f))) {
  console.log('[ensure-icon] platform icons already present, skipping');
  process.exit(0);
}

if (!existsSync(sourceSvg)) {
  console.error(`[ensure-icon] missing source SVG: ${sourceSvg}`);
  process.exit(1);
}

console.log('[ensure-icon] rasterizing icon.svg -> icon.png (1024x1024)');
const { Resvg } = await import('@resvg/resvg-js');
const svg = readFileSync(sourceSvg);
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
writeFileSync(sourcePng, resvg.render().asPng());

console.log('[ensure-icon] running `tauri icon` to populate platform icons');
const result = spawnSync(
  'pnpm',
  ['--filter', '@metu/companion', 'exec', 'tauri', 'icon', sourcePng],
  { stdio: 'inherit', cwd: repoRoot, shell: true },
);
process.exit(result.status ?? 1);
