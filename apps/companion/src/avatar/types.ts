/**
 * Shared avatar types for the companion's "metu" character system.
 *
 * Four renderers, user-switchable:
 *   - 'orb'  → a custom Three.js shader being (many color/shape presets)
 *   - 'face' → a procedural SVG character with animated eyes/expressions
 *   - 'vrm'  → a 3D humanoid loaded from a .vrm model (anime/VRoid style)
 *   - 'glb'  → an animated glTF model (game characters, robots, pets)
 *
 * All react to the same expressive `AvatarState` so the rest of the app
 * (voice session, hub) drives one interface regardless of renderer.
 */
export type AvatarState = 'idle' | 'listening' | 'speaking' | 'thinking';

export type AvatarKind = 'orb' | 'face' | 'vrm' | 'glb';

export interface AvatarSelection {
  kind: AvatarKind;
  /** id of the active orb preset (when kind==='orb') */
  orbPresetId: string;
  /** id of the active face preset (when kind==='face') */
  facePresetId: string;
  /** id of the active vrm preset (when kind==='vrm') */
  vrmPresetId: string;
  /** id of the active glb preset (when kind==='glb') */
  glbPresetId: string;
}

export const DEFAULT_AVATAR_SELECTION: AvatarSelection = {
  kind: 'orb',
  orbPresetId: 'aurora',
  facePresetId: 'mochi',
  vrmPresetId: 'none',
  glbPresetId: 'robo',
};

export interface AvatarDriveProps {
  state: AvatarState;
  /** 0..1 mouth/energy amplitude, typically RMS from the voice audio element */
  amplitude?: number;
  size?: number;
  /** optional <audio> element the renderer can analyse for live amplitude */
  audioEl?: HTMLAudioElement | null;
}
