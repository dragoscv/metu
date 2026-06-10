/**
 * VRM presets — selectable 3D humanoid models for the "metu" character.
 *
 * Models are loaded by URL. We ship a curated list of free/sample VRM avatars
 * plus:
 *   - 'none'   → no bundled model; falls back to the shader orb.
 *   - 'custom' → user supplies a URL (or a local file:// path, which works in
 *                the Tauri webview) via the avatar picker.
 *   - 'env'    → uses VITE_VRM_MODEL_URL if set.
 *
 * The sample URLs point at the pixiv/three-vrm test assets (CC0 / sample-use
 * licensed) so there is always something to look at out of the box. Users who
 * want their own VRoid character pick 'custom'.
 */
export interface VrmPreset {
  id: string;
  name: string;
  /** model URL, or null when resolved at runtime (none/custom/env) */
  url: string | null;
  note?: string;
}

const THREE_VRM_SAMPLES =
  'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models';

/**
 * Curated character pack — full VRoid Studio sample characters mirrored in
 * madjin/vrm-samples (github). Licensing: the AvatarSample_* models follow
 * pixiv's VRoid sample conditions of use (free to use in apps); the beta-era
 * presets (Vita, Vivi, Victoria, Sendagaya, Sakurada) are CC0 per the repo's
 * README. Streamed on first use, then browser-cached.
 */
const VRM_PACK_BASE = 'https://raw.githubusercontent.com/madjin/vrm-samples/master';

const CURATED: VrmPreset[] = [
  {
    id: 'sample-a',
    name: 'Hana (Sample A)',
    url: `${VRM_PACK_BASE}/vroid/stable/AvatarSample_A.vrm`,
    note: 'VRoid official sample',
  },
  {
    id: 'sample-b',
    name: 'Mio (Sample B)',
    url: `${VRM_PACK_BASE}/vroid/stable/AvatarSample_B.vrm`,
    note: 'VRoid official sample',
  },
  {
    id: 'sample-c',
    name: 'Ren (Sample C)',
    url: `${VRM_PACK_BASE}/vroid/stable/AvatarSample_C.vrm`,
    note: 'VRoid official sample',
  },
  {
    id: 'vita',
    name: 'Vita',
    url: `${VRM_PACK_BASE}/vroid/beta/Vita.vrm`,
    note: 'VRoid preset — CC0',
  },
  {
    id: 'vivi',
    name: 'Vivi',
    url: `${VRM_PACK_BASE}/vroid/beta/Vivi.vrm`,
    note: 'VRoid preset — CC0',
  },
  {
    id: 'victoria',
    name: 'Victoria',
    url: `${VRM_PACK_BASE}/vroid/beta/Victoria_Rubin.vrm`,
    note: 'VRoid preset — CC0',
  },
  {
    id: 'shino',
    name: 'Shino',
    url: `${VRM_PACK_BASE}/vroid/beta/Sendagaya_Shino.vrm`,
    note: 'VRoid preset — CC0',
  },
  {
    id: 'fumiriya',
    name: 'Fumiriya',
    url: `${VRM_PACK_BASE}/vroid/beta/Sakurada_Fumiriya.vrm`,
    note: 'VRoid preset — CC0',
  },
  {
    id: 'femme',
    name: 'Femme (base)',
    url: `${VRM_PACK_BASE}/vroid/fem_vroid.vrm`,
    note: 'VRoid base body',
  },
  {
    id: 'masc',
    name: 'Masc (base)',
    url: `${VRM_PACK_BASE}/vroid/masc_vroid.vrm`,
    note: 'VRoid base body',
  },
  {
    id: 'seed-san',
    name: 'Seed-san',
    url: `${VRM_PACK_BASE}/Seed-san/vrm/Seed-san.vrm`,
    note: 'VRM Consortium sample',
  },
  // ── Western / game-art styles ────────────────────────────────────────────
  {
    id: 'meebit',
    name: 'Meebit (voxel)',
    url: `${VRM_PACK_BASE}/meebits/meebit_09842.vrm`,
    note: 'Minecraft-style voxel character',
  },
  {
    id: 'voxel-girl',
    name: 'Voxel Scout',
    url: `${VRM_PACK_BASE}/cryptovoxels.vrm`,
    note: 'CryptoVoxels block character',
  },
  {
    id: 'orion',
    name: 'Orion',
    url: `${VRM_PACK_BASE}/Avatar_Orion.vrm`,
    note: 'Sci-fi western character',
  },
];

/**
 * Bundled character pack — drop CC0/`.vrm` files into
 * `apps/companion/public/avatars/` and list them here. Vite serves `public/`
 * at the app root, so the URLs are relative and work offline in the Tauri
 * webview. See `public/avatars/README.md` for sourcing suggestions
 * (VRoid Hub CC0 models, pixiv samples, etc).
 */
const BUNDLED: VrmPreset[] = [
  {
    id: 'pack-sora',
    name: 'Sora (local)',
    url: '/avatars/sora.vrm',
    note: 'drop sora.vrm in public/avatars',
  },
  {
    id: 'pack-yuki',
    name: 'Yuki (local)',
    url: '/avatars/yuki.vrm',
    note: 'drop yuki.vrm in public/avatars',
  },
  {
    id: 'pack-kai',
    name: 'Kai',
    url: '/avatars/kai.vrm',
    note: 'bundled — drop kai.vrm in public/avatars',
  },
];

export const VRM_PRESETS: VrmPreset[] = [
  { id: 'none', name: 'No model (use orb)', url: null },
  ...CURATED,
  {
    id: 'vrm1-a',
    name: 'Sample — VRM1 Constraint',
    url: `${THREE_VRM_SAMPLES}/VRM1_Constraint_Twist_Sample.vrm`,
    note: 'pixiv three-vrm sample (VRM 1.0)',
  },
  {
    id: 'vrm0-a',
    name: 'Sample — Ashtra (VRM0)',
    url: `${THREE_VRM_SAMPLES}/three-vrm-girl.vrm`,
    note: 'pixiv three-vrm sample (VRM 0.x)',
  },
  ...BUNDLED,
  { id: 'env', name: 'From VITE_VRM_MODEL_URL', url: null },
  { id: 'custom', name: 'Custom URL…', url: null },
];

export function getVrmPreset(id: string): VrmPreset {
  return VRM_PRESETS.find((p) => p.id === id) ?? VRM_PRESETS[0]!;
}

/**
 * Resolve the effective model URL for a preset id, honouring env + a
 * user-supplied custom URL (persisted separately).
 */
export function resolveVrmUrl(id: string, customUrl: string | null): string | null {
  if (id === 'custom') return customUrl && customUrl.trim().length ? customUrl.trim() : null;
  if (id === 'env') {
    const envUrl = (import.meta.env.VITE_VRM_MODEL_URL as string | undefined) ?? null;
    return envUrl && envUrl.length ? envUrl : null;
  }
  return getVrmPreset(id).url;
}
