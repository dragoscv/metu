/**
 * GLB presets — animated game-style characters and pets.
 *
 * VRM requires a humanoid rig, which rules out animals and most western
 * game-art styles. These are classic CC0 animated glTF models (three.js
 * examples + Khronos glTF sample assets) rendered by {@link GlbStage} with
 * an AnimationMixer: state changes pick different clips when the model has
 * them (e.g. the Fox's Survey/Walk/Run).
 *
 * All hosted on raw.githubusercontent.com (already in the CSP) and cached by
 * the webview after first load.
 */
export interface GlbPreset {
  id: string;
  name: string;
  url: string;
  note?: string;
  /**
   * Clip names to use per avatar state. First existing clip wins; falls back
   * to the model's first clip. Names are matched case-insensitively.
   */
  clips?: {
    idle?: string[];
    listening?: string[];
    speaking?: string[];
    thinking?: string[];
  };
  /** Extra yaw (radians) so side-facing models look at the camera. */
  yaw?: number;
  /** 1 = auto-fit exactly; >1 zooms the camera out a touch. */
  fitMargin?: number;
}

const THREE_GLTF = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf';
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0';

export const GLB_PRESETS: GlbPreset[] = [
  // ── Game characters ──────────────────────────────────────────────────────
  {
    id: 'robo',
    name: 'Robo',
    url: `${THREE_GLTF}/RobotExpressive/RobotExpressive.glb`,
    note: 'Expressive robot — CC0 (Tomás Laulhé)',
    clips: {
      idle: ['Idle'],
      listening: ['Wave', 'Idle'],
      speaking: ['Dance', 'ThumbsUp'],
      thinking: ['Sitting', 'Idle'],
    },
  },
  {
    id: 'soldier',
    name: 'Soldier',
    url: `${THREE_GLTF}/Soldier.glb`,
    note: 'Realistic western character — CC0 (three.js)',
    clips: {
      idle: ['Idle'],
      listening: ['Idle'],
      speaking: ['Walk'],
      thinking: ['TPose', 'Idle'],
    },
  },
  {
    id: 'xbot',
    name: 'Xenia',
    url: `${THREE_GLTF}/Xbot.glb`,
    note: 'Stylized android — CC0 (mixamo/three.js)',
    clips: {
      idle: ['idle'],
      listening: ['idle'],
      speaking: ['walk', 'run'],
      thinking: ['idle'],
    },
  },
  {
    id: 'cesium-man',
    name: 'Cesium Man',
    url: `${KHRONOS}/CesiumMan/glTF-Binary/CesiumMan.glb`,
    note: 'Khronos sample — walking man',
  },
  {
    id: 'brainstem',
    name: 'BrainStem',
    url: `${KHRONOS}/BrainStem/glTF-Binary/BrainStem.glb`,
    note: 'Khronos sample — sci-fi robot',
  },
  // ── Pets & creatures ─────────────────────────────────────────────────────
  {
    id: 'fox',
    name: 'Fox',
    url: `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
    note: 'Pet fox — CC0 (PixelMannen)',
    clips: {
      idle: ['Survey'],
      listening: ['Survey'],
      speaking: ['Walk'],
      thinking: ['Run'],
    },
    yaw: Math.PI / 6,
  },
  {
    id: 'horse',
    name: 'Horse',
    url: `${THREE_GLTF}/Horse.glb`,
    note: 'Galloping horse — CC0 (three.js)',
    yaw: Math.PI / 5,
  },
  {
    id: 'parrot',
    name: 'Parrot',
    url: `${THREE_GLTF}/Parrot.glb`,
    note: 'Flying parrot — CC0 (three.js)',
    yaw: Math.PI / 5,
  },
  {
    id: 'flamingo',
    name: 'Flamingo',
    url: `${THREE_GLTF}/Flamingo.glb`,
    note: 'Flying flamingo — CC0 (three.js)',
    yaw: Math.PI / 5,
  },
  {
    id: 'stork',
    name: 'Stork',
    url: `${THREE_GLTF}/Stork.glb`,
    note: 'Flying stork — CC0 (three.js)',
    yaw: Math.PI / 5,
  },
];

export function getGlbPreset(id: string): GlbPreset {
  return GLB_PRESETS.find((p) => p.id === id) ?? GLB_PRESETS[0]!;
}
