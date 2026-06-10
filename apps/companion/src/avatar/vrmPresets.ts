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
 * Bundled character pack — drop CC0/`.vrm` files into
 * `apps/companion/public/avatars/` and list them here. Vite serves `public/`
 * at the app root, so the URLs are relative and work offline in the Tauri
 * webview. See `public/avatars/README.md` for sourcing suggestions
 * (VRoid Hub CC0 models, pixiv samples, etc).
 */
const BUNDLED: VrmPreset[] = [
  {
    id: 'pack-sora',
    name: 'Sora',
    url: '/avatars/sora.vrm',
    note: 'bundled — drop sora.vrm in public/avatars',
  },
  {
    id: 'pack-yuki',
    name: 'Yuki',
    url: '/avatars/yuki.vrm',
    note: 'bundled — drop yuki.vrm in public/avatars',
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
