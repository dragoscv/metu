/**
 * Face presets — procedural SVG characters with animated eyes/expressions.
 *
 * Unlike the orb (abstract being) these read as little creatures/robots with
 * faces. Everything is vector + CSS animation — zero external assets, fully
 * offline, and each preset is just palette + geometry params so adding a new
 * character is a data change.
 */
export interface FacePreset {
  id: string;
  name: string;
  /** Head/body fill (gradient start). */
  skin: string;
  /** Gradient end (darker shade of skin). */
  skinDeep: string;
  /** Eye + mouth color. */
  feature: string;
  /** Cheek blush / accent details. */
  blush: string;
  /** Ambient glow behind the character. */
  glow: string;
  /** Head silhouette. */
  shape: 'round' | 'squircle' | 'teardrop' | 'cat' | 'ghost' | 'bot';
  /** Eye style. */
  eyes: 'dot' | 'oval' | 'happy' | 'visor' | 'sleepy' | 'star';
  /** 0..1 — how much the body bobs/squashes when animated. */
  bounce: number;
}

export const FACE_PRESETS: FacePreset[] = [
  {
    id: 'mochi',
    name: 'Mochi',
    skin: '#aab8ff',
    skinDeep: '#5b6bff',
    feature: '#1e1b4b',
    blush: '#f9a8d4',
    glow: '#7c8cff',
    shape: 'round',
    eyes: 'oval',
    bounce: 0.7,
  },
  {
    id: 'kiko',
    name: 'Kiko',
    skin: '#fcd9a8',
    skinDeep: '#f59e0b',
    feature: '#451a03',
    blush: '#fb923c',
    glow: '#fbbf24',
    shape: 'cat',
    eyes: 'happy',
    bounce: 0.9,
  },
  {
    id: 'volt',
    name: 'Volt',
    skin: '#a7f3d0',
    skinDeep: '#10b981',
    feature: '#022c22',
    blush: '#34d399',
    glow: '#2dd4bf',
    shape: 'bot',
    eyes: 'visor',
    bounce: 0.4,
  },
  {
    id: 'boo',
    name: 'Boo',
    skin: '#e9ecf8',
    skinDeep: '#aab4d4',
    feature: '#1f2438',
    blush: '#c4b5fd',
    glow: '#cdd8ff',
    shape: 'ghost',
    eyes: 'dot',
    bounce: 0.6,
  },
  {
    id: 'pip',
    name: 'Pip',
    skin: '#fbcfe8',
    skinDeep: '#ec4899',
    feature: '#500724',
    blush: '#f472b6',
    glow: '#f9a8d4',
    shape: 'teardrop',
    eyes: 'star',
    bounce: 1,
  },
  {
    id: 'sage',
    name: 'Sage',
    skin: '#d9f99d',
    skinDeep: '#65a30d',
    feature: '#1a2e05',
    blush: '#a3e635',
    glow: '#84cc16',
    shape: 'squircle',
    eyes: 'sleepy',
    bounce: 0.3,
  },
  {
    id: 'nyx',
    name: 'Nyx',
    skin: '#6d6a96',
    skinDeep: '#312e81',
    feature: '#e0e7ff',
    blush: '#818cf8',
    glow: '#4f46e5',
    shape: 'cat',
    eyes: 'oval',
    bounce: 0.55,
  },
  {
    id: 'rusty',
    name: 'Rusty',
    skin: '#fdba74',
    skinDeep: '#c2410c',
    feature: '#431407',
    blush: '#fb923c',
    glow: '#ea580c',
    shape: 'bot',
    eyes: 'dot',
    bounce: 0.45,
  },
  {
    id: 'frost',
    name: 'Frost',
    skin: '#cffafe',
    skinDeep: '#0891b2',
    feature: '#083344',
    blush: '#67e8f9',
    glow: '#22d3ee',
    shape: 'round',
    eyes: 'happy',
    bounce: 0.65,
  },
  {
    id: 'ember-chan',
    name: 'Emberly',
    skin: '#fecaca',
    skinDeep: '#dc2626',
    feature: '#450a0a',
    blush: '#f87171',
    glow: '#ef4444',
    shape: 'teardrop',
    eyes: 'oval',
    bounce: 0.85,
  },
  {
    id: 'pixel',
    name: 'Pixel',
    skin: '#c7d2fe',
    skinDeep: '#4338ca',
    feature: '#eef2ff',
    blush: '#a5b4fc',
    glow: '#6366f1',
    shape: 'bot',
    eyes: 'visor',
    bounce: 0.5,
  },
  {
    id: 'luna',
    name: 'Luna',
    skin: '#f5f3ff',
    skinDeep: '#8b5cf6',
    feature: '#2e1065',
    blush: '#c4b5fd',
    glow: '#a78bfa',
    shape: 'ghost',
    eyes: 'sleepy',
    bounce: 0.4,
  },
];

export function getFacePreset(id: string): FacePreset {
  return FACE_PRESETS.find((p) => p.id === id) ?? FACE_PRESETS[0]!;
}
