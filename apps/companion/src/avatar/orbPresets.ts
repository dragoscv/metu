/**
 * Orb presets — the palette + behaviour library for the shader being.
 *
 * Each preset is a self-contained "look": a dominant core color, an accent
 * (rim / fresnel), an ambient glow, a surface style, and motion tuning. The
 * shader in `ShaderOrb.tsx` reads these uniforms, so adding a new look is just
 * adding an entry here — no shader edits required.
 *
 * Colors are linear-ish sRGB hex; the shader converts to vec3 [0..1].
 */
export interface OrbPreset {
  id: string;
  name: string;
  /** core color (center of the orb) */
  core: string;
  /** accent color (fresnel rim + speaking shift) */
  accent: string;
  /** ambient halo / outer glow */
  glow: string;
  /** surface character */
  style: 'plasma' | 'liquid' | 'crystal' | 'nebula' | 'ember' | 'ghost';
  /** 0..1 noise turbulence */
  turbulence: number;
  /** 0..1 how prismatic / refractive the rim reads */
  refraction: number;
  /** base breathing speed multiplier */
  speed: number;
}

export const ORB_PRESETS: OrbPreset[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    core: '#7cc5ff',
    accent: '#a78bfa',
    glow: '#3b6fff',
    style: 'plasma',
    turbulence: 0.55,
    refraction: 0.7,
    speed: 1,
  },
  {
    id: 'ember',
    name: 'Ember',
    core: '#ffb47c',
    accent: '#ff5e7c',
    glow: '#ff7a18',
    style: 'ember',
    turbulence: 0.7,
    refraction: 0.45,
    speed: 1.15,
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    core: '#d7b6ff',
    accent: '#7c3aed',
    glow: '#9d5bff',
    style: 'crystal',
    turbulence: 0.4,
    refraction: 0.95,
    speed: 0.85,
  },
  {
    id: 'jade',
    name: 'Jade',
    core: '#8af0c8',
    accent: '#2dd4bf',
    glow: '#10b981',
    style: 'liquid',
    turbulence: 0.5,
    refraction: 0.6,
    speed: 0.95,
  },
  {
    id: 'nebula',
    name: 'Nebula',
    core: '#b8c2ff',
    accent: '#f0abfc',
    glow: '#6366f1',
    style: 'nebula',
    turbulence: 0.85,
    refraction: 0.5,
    speed: 0.75,
  },
  {
    id: 'gold',
    name: 'Solar Gold',
    core: '#ffe7a3',
    accent: '#ffb020',
    glow: '#ff8a00',
    style: 'plasma',
    turbulence: 0.6,
    refraction: 0.55,
    speed: 1.05,
  },
  {
    id: 'rose',
    name: 'Rose Quartz',
    core: '#ffc4d6',
    accent: '#ff5e9c',
    glow: '#ff2d78',
    style: 'liquid',
    turbulence: 0.45,
    refraction: 0.75,
    speed: 0.9,
  },
  {
    id: 'cyan',
    name: 'Cyber Cyan',
    core: '#9bf6ff',
    accent: '#22d3ee',
    glow: '#06b6d4',
    style: 'crystal',
    turbulence: 0.5,
    refraction: 0.9,
    speed: 1.1,
  },
  {
    id: 'ghost',
    name: 'Ghost',
    core: '#e8eeff',
    accent: '#9fb4ff',
    glow: '#cdd8ff',
    style: 'ghost',
    turbulence: 0.35,
    refraction: 0.4,
    speed: 0.7,
  },
  {
    id: 'inferno',
    name: 'Inferno',
    core: '#ff9d6c',
    accent: '#ff2d2d',
    glow: '#ff5400',
    style: 'ember',
    turbulence: 0.9,
    refraction: 0.4,
    speed: 1.25,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    core: '#6e8bff',
    accent: '#3b4ff0',
    glow: '#1e2a78',
    style: 'nebula',
    turbulence: 0.6,
    refraction: 0.65,
    speed: 0.8,
  },
  {
    id: 'spring',
    name: 'Spring',
    core: '#d6ff9b',
    accent: '#84cc16',
    glow: '#22c55e',
    style: 'liquid',
    turbulence: 0.5,
    refraction: 0.6,
    speed: 1,
  },
];

export function getOrbPreset(id: string): OrbPreset {
  return ORB_PRESETS.find((p) => p.id === id) ?? ORB_PRESETS[0]!;
}

/** Map style enum → a numeric code the shader can branch on. */
export const ORB_STYLE_CODE: Record<OrbPreset['style'], number> = {
  plasma: 0,
  liquid: 1,
  crystal: 2,
  nebula: 3,
  ember: 4,
  ghost: 5,
};
