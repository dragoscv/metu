/**
 * The "metu unit" — our own procedural synthetic being.
 *
 * Built from three.js primitives (no external assets, fully ours to
 * iterate): a humanoid robot with a visor face, emissive accent lines,
 * and articulated limbs. Animations are code-driven (walk/jump/climb/
 * idle/expressive), so it moves correctly with the platformer physics
 * without any retargeting pipeline.
 *
 * Per-persona palettes: one rig, different emissive identities.
 */
import * as THREE from 'three';

export interface MetuPalette {
  id: string;
  name: string;
  /** Body shell color. */
  shell: string;
  /** Darker joint/under-suit color. */
  joints: string;
  /** Emissive accent (visor, chest core, seams). */
  accent: string;
  /** Visor glass tint. */
  visor: string;
}

export const METU_PALETTES: MetuPalette[] = [
  {
    id: 'metu',
    name: 'metu',
    shell: '#e8ecf4',
    joints: '#2a2f3e',
    accent: '#7c8cff',
    visor: '#10131d',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    shell: '#dfe6ee',
    joints: '#26303c',
    accent: '#4fc3f7',
    visor: '#0e141b',
  },
  {
    id: 'iris',
    name: 'Iris',
    shell: '#ece6f4',
    joints: '#322a3e',
    accent: '#c084fc',
    visor: '#160f1e',
  },
  {
    id: 'jarvis',
    name: 'Jarvis',
    shell: '#e6eee8',
    joints: '#26342b',
    accent: '#ffd54f',
    visor: '#101810',
  },
  {
    id: 'ember',
    name: 'Ember',
    shell: '#f4e8e4',
    joints: '#3e2c28',
    accent: '#ff8a65',
    visor: '#1d1210',
  },
];

export function getMetuPalette(id: string): MetuPalette {
  return METU_PALETTES.find((p) => p.id === id) ?? METU_PALETTES[0]!;
}

/** Named bones the animator drives. All are children of `root`. */
export interface MetuRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  /** Emissive materials for amplitude-driven glow. */
  visorMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
}

function shellMat(p: MetuPalette): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.shell),
    roughness: 0.35,
    metalness: 0.15,
  });
}
function jointMat(p: MetuPalette): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.joints),
    roughness: 0.6,
    metalness: 0.3,
  });
}
function glowMat(p: MetuPalette, intensity = 1.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.accent),
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: intensity,
    roughness: 0.2,
    metalness: 0,
  });
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.castShadow = false;
  return m;
}
function sphere(r: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
}

/**
 * Build the rig. Total height ≈ 1.0 unit (feet at y=0, head top ≈ 1.0)
 * so the stage can scale it predictably.
 */
export function buildMetuRig(palette: MetuPalette): MetuRig {
  const shell = shellMat(palette);
  const joints = jointMat(palette);
  const accent = glowMat(palette);
  const visorMat = glowMat(palette, 1.2);
  const coreMat = glowMat(palette, 2.0);

  const root = new THREE.Group();

  // Hips at standing height; legs hang below.
  const hips = new THREE.Group();
  hips.position.y = 0.46;
  root.add(hips);
  const pelvis = capsule(0.085, 0.06, joints);
  pelvis.rotation.z = Math.PI / 2;
  hips.add(pelvis);

  // Torso + chest core.
  const torso = new THREE.Group();
  torso.position.y = 0.1;
  hips.add(torso);
  const chest = capsule(0.105, 0.16, shell);
  chest.position.y = 0.12;
  torso.add(chest);
  const core = sphere(0.035, coreMat);
  core.position.set(0, 0.13, 0.095);
  torso.add(core);

  // Head: rounded helmet + visor bar.
  const head = new THREE.Group();
  head.position.y = 0.31;
  torso.add(head);
  const helmet = sphere(0.105, shell);
  helmet.scale.set(1, 0.92, 0.95);
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.07, 4, 10), visorMat);
  visor.rotation.z = Math.PI / 2;
  visor.position.set(0, 0.01, 0.085);
  head.add(visor);
  // Antenna nub — personality.
  const nub = sphere(0.018, accent);
  nub.position.set(0.06, 0.1, 0);
  head.add(nub);

  // Arms (shoulder pivot at torso top corners).
  const mkArm = (side: 1 | -1) => {
    const arm = new THREE.Group();
    arm.position.set(0.14 * side, 0.2, 0);
    torso.add(arm);
    const upper = capsule(0.034, 0.1, shell);
    upper.position.y = -0.07;
    arm.add(upper);
    const forearm = new THREE.Group();
    forearm.position.y = -0.16;
    arm.add(forearm);
    const lower = capsule(0.03, 0.09, joints);
    lower.position.y = -0.06;
    forearm.add(lower);
    const hand = sphere(0.035, shell);
    hand.position.y = -0.13;
    forearm.add(hand);
    return { arm, forearm };
  };
  const { arm: armL, forearm: forearmL } = mkArm(-1);
  const { arm: armR, forearm: forearmR } = mkArm(1);

  // Legs (hip pivot).
  const mkLeg = (side: 1 | -1) => {
    const leg = new THREE.Group();
    leg.position.set(0.06 * side, -0.02, 0);
    hips.add(leg);
    const thigh = capsule(0.042, 0.11, shell);
    thigh.position.y = -0.08;
    leg.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -0.2;
    leg.add(shin);
    const calf = capsule(0.036, 0.1, joints);
    calf.position.y = -0.07;
    shin.add(calf);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.12), shell);
    foot.position.set(0, -0.165, 0.025);
    shin.add(foot);
    return { leg, shin };
  };
  const { leg: legL, shin: shinL } = mkLeg(-1);
  const { leg: legR, shin: shinR } = mkLeg(1);

  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    forearmL,
    forearmR,
    legL,
    legR,
    shinL,
    shinR,
    visorMat,
    coreMat,
  };
}

export type MetuMotion = 'idle' | 'walking' | 'jumping' | 'falling' | 'climbing';
export type MetuExpression = 'idle' | 'listening' | 'speaking' | 'thinking';

/**
 * Drive one animation frame. `t` seconds since start, `amp` 0..1 voice
 * amplitude. Pure pose-setting — call every frame before render.
 */
export function poseMetu(
  rig: MetuRig,
  motion: MetuMotion,
  expression: MetuExpression,
  t: number,
  amp = 0,
): void {
  const { hips, torso, head, armL, armR, forearmL, forearmR, legL, legR, shinL, shinR } = rig;

  // Defaults each frame (poses below override selectively).
  let hipsY = 0.46;
  let torsoPitch = 0;
  let headPitch = 0;
  let headYaw = 0;
  let headRoll = 0;

  switch (motion) {
    case 'walking': {
      const w = t * 9; // cadence
      const swing = Math.sin(w);
      legL.rotation.x = swing * 0.7;
      legR.rotation.x = -swing * 0.7;
      shinL.rotation.x = Math.max(0, -Math.sin(w - 0.5)) * 0.9;
      shinR.rotation.x = Math.max(0, Math.sin(w - 0.5)) * 0.9;
      armL.rotation.x = -swing * 0.5;
      armR.rotation.x = swing * 0.5;
      forearmL.rotation.x = -0.35;
      forearmR.rotation.x = -0.35;
      hipsY = 0.46 + Math.abs(Math.cos(w)) * 0.02;
      torsoPitch = 0.08;
      headPitch = -0.04;
      break;
    }
    case 'jumping': {
      legL.rotation.x = -0.9;
      legR.rotation.x = -0.7;
      shinL.rotation.x = 1.5;
      shinR.rotation.x = 1.2;
      armL.rotation.x = -2.4;
      armR.rotation.x = -2.4;
      forearmL.rotation.x = -0.3;
      forearmR.rotation.x = -0.3;
      torsoPitch = -0.12;
      headPitch = -0.15;
      break;
    }
    case 'falling': {
      legL.rotation.x = -0.25;
      legR.rotation.x = 0.15;
      shinL.rotation.x = 0.4;
      shinR.rotation.x = 0.25;
      const flail = Math.sin(t * 14) * 0.25;
      armL.rotation.x = -2.6 + flail;
      armR.rotation.x = -2.6 - flail;
      torsoPitch = 0.15;
      headPitch = 0.2;
      break;
    }
    case 'climbing': {
      const c = t * 6;
      const reach = Math.sin(c);
      armL.rotation.x = -2.2 - reach * 0.5;
      armR.rotation.x = -2.2 + reach * 0.5;
      forearmL.rotation.x = -0.5;
      forearmR.rotation.x = -0.5;
      legL.rotation.x = -0.6 - reach * 0.4;
      legR.rotation.x = -0.6 + reach * 0.4;
      shinL.rotation.x = 0.9;
      shinR.rotation.x = 0.9;
      torsoPitch = -0.25;
      headPitch = -0.35;
      break;
    }
    case 'idle':
    default: {
      const breathe = Math.sin(t * 1.6) * 0.5 + 0.5;
      hipsY = 0.46 + breathe * 0.008;
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      shinL.rotation.x = 0.04;
      shinR.rotation.x = 0.04;
      armL.rotation.x = 0.06 + breathe * 0.04;
      armR.rotation.x = 0.06 + breathe * 0.04;
      armL.rotation.z = 0.1;
      armR.rotation.z = -0.1;
      forearmL.rotation.x = -0.15;
      forearmR.rotation.x = -0.15;

      // Expressive layer (only meaningful when stationary).
      if (expression === 'listening') {
        headRoll = 0.12;
        headPitch = -0.05;
        torsoPitch = -0.04; // lean in
      } else if (expression === 'thinking') {
        headPitch = 0.18;
        headYaw = Math.sin(t * 0.7) * 0.15;
        forearmR.rotation.x = -1.9; // hand toward chin
        armR.rotation.x = 0.5;
      } else if (expression === 'speaking') {
        headPitch = Math.sin(t * 5) * 0.03;
        torsoPitch = Math.sin(t * 2.4) * 0.02;
        armR.rotation.x = 0.2 + Math.sin(t * 3.1) * 0.18;
        forearmR.rotation.x = -0.6 + Math.sin(t * 3.7) * 0.2;
      } else {
        headYaw = Math.sin(t * 0.35) * 0.1; // slow curious look-around
      }
      break;
    }
  }

  hips.position.y = hipsY;
  torso.rotation.x = torsoPitch;
  head.rotation.x = headPitch;
  head.rotation.y = headYaw;
  head.rotation.z = headRoll;

  // Voice-reactive glow: visor + chest core pulse with amplitude.
  const glow = 1.2 + amp * 2.2 + (expression === 'speaking' ? Math.sin(t * 10) * 0.25 : 0);
  rig.visorMat.emissiveIntensity = glow;
  rig.coreMat.emissiveIntensity = 1.6 + amp * 1.6;
}

/** Dispose all geometries/materials in the rig. */
export function disposeMetuRig(rig: MetuRig): void {
  rig.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) (m as THREE.Material | undefined)?.dispose?.();
  });
}
