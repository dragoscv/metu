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
  /** Face (v4.2): eye groups each contain 'ball' + happy 'arc' variants. */
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  /** Mouth LED segments: [left, center, right]. */
  mouth: [THREE.Mesh, THREE.Mesh, THREE.Mesh];
  /** Finger groups (curl via rotation.x): pointing reads properly now. */
  fingersL: THREE.Group;
  fingersR: THREE.Group;
  /** Springy antenna (physics lag applied by the stage). */
  antenna: THREE.Group;
  /** Back thruster — glows during jump/fall/teleport. */
  thrusterMat: THREE.MeshStandardMaterial;
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
  // Seam glow lines (v4.2): thin emissive strips that pulse with the
  // chest core (shared coreMat — zero extra material cost).
  const mkSeam = (x: number) => {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.1, 0.004), coreMat);
    seam.position.set(x, 0.12, 0.1);
    torso.add(seam);
  };
  mkSeam(-0.055);
  mkSeam(0.055);
  // Back thruster — flares during jump/fall/teleport.
  const thrusterMat = glowMat(palette, 0.25);
  const thruster = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 10), thrusterMat);
  thruster.rotation.x = Math.PI;
  thruster.position.set(0, 0.08, -0.115);
  torso.add(thruster);

  // Head: rounded helmet + visor screen with a FACE (v4.2).
  const head = new THREE.Group();
  head.position.y = 0.31;
  torso.add(head);
  const helmet = sphere(0.105, shell);
  helmet.scale.set(1, 0.92, 0.95);
  head.add(helmet);
  // Visor glass: dark screen plate the eyes/mouth live on.
  const visorGlass = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.046, 0.085, 4, 10),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.visor),
      roughness: 0.15,
      metalness: 0.4,
    }),
  );
  visorGlass.rotation.z = Math.PI / 2;
  visorGlass.position.set(0, 0.012, 0.078);
  visorGlass.scale.set(1, 1, 0.55);
  head.add(visorGlass);
  // Eyes: emissive ball (round) + happy torus-arc variant per eye.
  // Group scale.y = lid (blink/squint); position nudges = gaze.
  const mkEye = (side: 1 | -1) => {
    const eye = new THREE.Group();
    eye.position.set(0.034 * side, 0.02, 0.1);
    head.add(eye);
    const ball = sphere(0.017, visorMat);
    ball.scale.z = 0.45;
    ball.name = 'ball';
    eye.add(ball);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0055, 6, 12, Math.PI), visorMat);
    arc.name = 'arc';
    arc.position.z = 0.004;
    arc.scale.set(1, 1, 0.5);
    arc.visible = false;
    eye.add(arc);
    return eye;
  };
  const eyeL = mkEye(-1);
  const eyeR = mkEye(1);
  // Mouth: 3 LED segments — outer tilt up = smile, down = frown.
  const mkSeg = (x: number) => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.005, 0.004), visorMat);
    seg.position.set(x, -0.028, 0.1);
    head.add(seg);
    return seg;
  };
  const mouth: [THREE.Mesh, THREE.Mesh, THREE.Mesh] = [mkSeg(-0.017), mkSeg(0), mkSeg(0.017)];
  // Springy antenna — stage applies lag to rotation.
  const antenna = new THREE.Group();
  antenna.position.set(0.05, 0.09, 0);
  head.add(antenna);
  const stalk = capsule(0.006, 0.045, joints);
  stalk.position.y = 0.028;
  antenna.add(stalk);
  const nub = sphere(0.016, accent);
  nub.position.y = 0.06;
  antenna.add(nub);

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
    // Hand (v4.2): palm + 3 simple fingers that curl (fingers.rotation.x).
    // An open pointing hand reads far better than the old ball.
    const palm = sphere(0.028, shell);
    palm.scale.set(1, 0.8, 0.6);
    palm.position.y = -0.125;
    forearm.add(palm);
    const fingers = new THREE.Group();
    fingers.position.y = -0.145;
    forearm.add(fingers);
    for (let f = 0; f < 3; f++) {
      const digit = capsule(0.0085, 0.03, shell);
      digit.position.set((f - 1) * 0.017, -0.022, 0.004);
      fingers.add(digit);
    }
    fingers.rotation.x = -0.5; // relaxed half-curl
    return { arm, forearm, fingers };
  };
  const { arm: armL, forearm: forearmL, fingers: fingersL } = mkArm(-1);
  const { arm: armR, forearm: forearmR, fingers: fingersR } = mkArm(1);

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
    eyeL,
    eyeR,
    mouth,
    fingersL,
    fingersR,
    antenna,
    thrusterMat,
    visorMat,
    coreMat,
  };
}

export type MetuMotion =
  | 'idle'
  | 'walking'
  | 'jumping'
  | 'falling'
  | 'climbing'
  | 'sitting'
  | 'teleporting';
export type MetuExpression = 'idle' | 'listening' | 'speaking' | 'thinking';

/** Emotional face overlays (v4.2) — driven by events, decay back to neutral. */
export type MetuEmotion =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'focused'
  | 'sad'
  | 'sleepy'
  | 'surprised'
  | 'mischievous';

/**
 * Drive the FACE for one frame. Call after poseMetu (which sets head
 * orientation); this only touches eyes/mouth/antenna-independent parts.
 *
 * `blink` 0..1 (1 = closed) is owned by the stage's blink scheduler.
 * `talk` 0..1 voice amplitude animates the center mouth segment.
 */
export function poseMetuFace(
  rig: MetuRig,
  emotion: MetuEmotion,
  t: number,
  blink: number,
  talk = 0,
  gaze?: { x: number; y: number } | null,
): void {
  const { eyeL, eyeR, mouth } = rig;
  const [mL, mC, mR] = mouth;

  // Eye style per emotion: lid (scale.y), size (scale.x), arc swap,
  // asymmetry for mischief.
  let lid = 1; // 1 = fully open
  let size = 1;
  let arcs = false; // happy arc eyes
  let lidL = -1; // per-eye override (-1 = use `lid`)
  let mouthCurve = 0; // +up smile, -down frown (radians of outer tilt)
  let mouthGap = 0; // vertical spread of outer segments
  switch (emotion) {
    case 'happy':
      arcs = true;
      mouthCurve = 0.5;
      break;
    case 'excited':
      arcs = true;
      size = 1.2;
      mouthCurve = 0.7;
      mouthGap = 0.004;
      break;
    case 'curious':
      size = 1.15;
      lid = 1.05;
      mouthCurve = 0.15;
      break;
    case 'focused':
      lid = 0.45; // squint
      mouthCurve = -0.05;
      break;
    case 'sad':
      lid = 0.7;
      mouthCurve = -0.5;
      break;
    case 'sleepy':
      lid = 0.35 + Math.sin(t * 0.8) * 0.1; // heavy, slowly drooping
      mouthCurve = -0.1;
      break;
    case 'surprised':
      size = 1.35;
      lid = 1.15;
      mouthGap = 0.006;
      break;
    case 'mischievous':
      lidL = 0.35; // asymmetric squint/wink
      lid = 0.95;
      mouthCurve = 0.35;
      break;
    default:
      mouthCurve = 0.12; // faint resting smile — approachable
  }

  // Blink multiplies the lid (snaps eyes shut over everything).
  const open = Math.max(0.06, lid * (1 - blink));
  const openL = Math.max(0.06, (lidL >= 0 ? lidL : lid) * (1 - blink));
  for (const [eye, o] of [
    [eyeL, openL],
    [eyeR, open],
  ] as const) {
    eye.scale.set(size, o, 1);
    const ball = eye.getObjectByName('ball');
    const arc = eye.getObjectByName('arc');
    if (ball) ball.visible = !arcs;
    if (arc) arc.visible = arcs;
    // Gaze: tiny eye offsets sell look direction even with head still.
    eye.position.z = 0.1;
    eye.position.x = (eye === eyeL ? -0.034 : 0.034) + (gaze?.x ?? 0) * 0.008;
    eye.position.y = 0.02 + (gaze?.y ?? 0) * -0.006;
  }

  // Mouth: outer segments tilt for smile/frown; center pulses when talking.
  mL.rotation.z = mouthCurve;
  mR.rotation.z = -mouthCurve;
  mL.position.y = -0.028 + mouthGap + mouthCurve * 0.006;
  mR.position.y = -0.028 + mouthGap + mouthCurve * 0.006;
  const talkPulse = talk > 0.02 ? 1 + Math.sin(t * 18) * 0.6 * Math.min(1, talk * 2) : 1;
  mC.scale.set(1, talkPulse, 1);
  mC.position.y = -0.028 - mouthGap * 0.5;
}

/** One-shot gestures layered over the base pose (k = 0..1 progress). */
export type MetuGesture =
  | 'wave'
  | 'salute'
  | 'bow'
  | 'facepalm'
  | 'stretch'
  | 'dance'
  | 'look-around'
  | 'point-left'
  | 'point-right'
  | 'point-up'
  | 'nod'
  | 'shake'
  | 'shrug'
  | 'celebrate'
  | 'typing';

/**
 * Drive one animation frame. `t` seconds since start, `amp` 0..1 voice
 * amplitude. Pure pose-setting — call every frame before render.
 *
 * `phase` is the CONTINUOUS locomotion phase (radians) maintained by the
 * caller — NOT global time. Cyclic gaits (walk/climb) key off it so the
 * cycle starts at a neutral point on every state entry and never snaps:
 * deriving phase from `t` meant entering 'walking' at a random point in
 * the sine cycle, which read as a fast wiggle on each transition.
 */
export function poseMetu(
  rig: MetuRig,
  motion: MetuMotion,
  expression: MetuExpression,
  t: number,
  amp = 0,
  /** Optional gaze target in [-1..1] screen-relative offsets (idle only). */
  look?: { x: number; y: number } | null,
  phase = t * 5.5,
): void {
  const { hips, torso, head, armL, armR, forearmL, forearmR, legL, legR, shinL, shinR } = rig;

  // Defaults each frame (poses below override selectively).
  let hipsY = 0.46;
  let torsoPitch = 0;
  let headPitch = 0;
  let headYaw = 0;
  let headRoll = 0;
  torso.rotation.y = 0; // reset gaze-follow twist from previous frames
  torso.rotation.z = 0; // reset dance sway from previous frames
  hips.position.x = 0; // reset idle weight-sway (set only in idle below)

  switch (motion) {
    case 'teleporting': {
      // Energy-gather pose while the warp morph plays: arms drawn in,
      // head down, slight crouch — the renderer adds scale/spin/fade.
      hipsY = 0.42;
      legL.rotation.x = -0.2;
      legR.rotation.x = -0.2;
      shinL.rotation.x = 0.45;
      shinR.rotation.x = 0.45;
      armL.rotation.x = -0.8;
      armR.rotation.x = -0.8;
      armL.rotation.z = 0.5;
      armR.rotation.z = -0.5;
      forearmL.rotation.x = -1.4;
      forearmR.rotation.x = -1.4;
      torsoPitch = 0.18;
      headPitch = 0.3;
      break;
    }
    case 'walking': {
      // Phase-driven gait: `phase` is advanced continuously by the caller
      // (proportional to dt, optionally scaled by real ground speed), so
      // the cycle is smooth across frame-rate changes and state entries.
      const w = phase;
      const swing = Math.sin(w);
      legL.rotation.x = swing * 0.55;
      legR.rotation.x = -swing * 0.55;
      shinL.rotation.x = Math.max(0, -Math.sin(w - 0.5)) * 0.7;
      shinR.rotation.x = Math.max(0, Math.sin(w - 0.5)) * 0.7;
      armL.rotation.x = -swing * 0.35;
      armR.rotation.x = swing * 0.35;
      forearmL.rotation.x = -0.35;
      forearmR.rotation.x = -0.35;
      // Hip bob at 2× stride frequency (two footfalls per cycle), smooth
      // sine — abs(cos) has a velocity discontinuity at each footfall
      // which contributed the "vibration" feel.
      hipsY = 0.452 + (Math.sin(w * 2 - Math.PI / 2) * 0.5 + 0.5) * 0.012;
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
      const flail = Math.sin(t * 6) * 0.18; // gentle, not panicked
      armL.rotation.x = -2.6 + flail;
      armR.rotation.x = -2.6 - flail;
      torsoPitch = 0.15;
      headPitch = 0.2;
      break;
    }
    case 'climbing': {
      const c = phase * 0.7; // climb reach keyed to the same continuous phase
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
    case 'sitting': {
      // Sitting on an edge, legs dangling — long-idle charm pose.
      hipsY = 0.36;
      legL.rotation.x = -1.5;
      legR.rotation.x = -1.5;
      const dangle = Math.sin(t * 1.1);
      shinL.rotation.x = 1.25 + dangle * 0.12;
      shinR.rotation.x = 1.25 - dangle * 0.12;
      armL.rotation.x = -0.25;
      armR.rotation.x = -0.25;
      armL.rotation.z = 0.22;
      armR.rotation.z = -0.22;
      forearmL.rotation.x = -0.3;
      forearmR.rotation.x = -0.3;
      torsoPitch = 0.1;
      headPitch = 0.02;
      // Watch the cursor if available, else relaxed look-around.
      if (look) {
        headYaw = look.x * 0.45;
        headPitch = 0.02 + look.y * 0.25;
      } else {
        headYaw = Math.sin(t * 0.3) * 0.18;
      }
      break;
    }
    case 'idle':
    default: {
      const breathe = Math.sin(t * 1.6) * 0.5 + 0.5;
      // Layered idle (v4.5): breath + slow weight sway + subtle arm drift
      // — three incommensurate frequencies so the pattern never visibly
      // repeats. Reads as "alive" even between idle-variety gestures.
      const sway = Math.sin(t * 0.55);
      const drift = Math.sin(t * 0.83 + 1.7);
      hipsY = 0.46 + breathe * 0.008;
      hips.position.x = sway * 0.012; // weight shifts foot-to-foot
      torso.rotation.z = sway * 0.03;
      headRoll = sway * 0.025;
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      shinL.rotation.x = 0.04;
      shinR.rotation.x = 0.04;
      armL.rotation.x = 0.06 + breathe * 0.04 + drift * 0.02;
      armR.rotation.x = 0.06 + breathe * 0.04 - drift * 0.02;
      armL.rotation.z = 0.1 + sway * 0.02;
      armR.rotation.z = -0.1 + sway * 0.02;
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
      } else if (look) {
        // Cursor curiosity: follow the user's mouse with head (and a hint
        // of torso). look.x/y are clamped screen-relative offsets.
        headYaw = look.x * 0.55;
        headPitch = look.y * 0.3;
        torso.rotation.y = look.x * 0.12;
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
  // Visor patterns per expression:
  //   speaking  → amplitude-driven pulse
  //   thinking  → slow scan (saw-tooth sweep, like processing)
  //   listening → steady bright (full attention)
  //   idle      → soft breathing glow
  let visor: number;
  switch (expression) {
    case 'speaking':
      visor = 1.2 + amp * 2.2 + Math.sin(t * 10) * 0.25;
      break;
    case 'thinking':
      visor = 0.8 + ((t * 1.4) % 1) * 1.2; // rising sweep, snaps back
      break;
    case 'listening':
      visor = 2.2;
      break;
    default:
      visor = 1.1 + (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.3;
  }
  rig.visorMat.emissiveIntensity = visor;
  rig.coreMat.emissiveIntensity = 1.6 + amp * 1.6;
}

/**
 * Layer a one-shot gesture OVER the base pose. Call AFTER poseMetu.
 * `k` is normalized progress 0..1 (caller owns timing); `t` is global
 * time for cyclic gestures (typing, celebrate).
 * Envelope: smooth in/out so gestures blend rather than snap.
 */
export function applyMetuGesture(rig: MetuRig, gesture: MetuGesture, k: number, t: number): void {
  const { head, torso, armL, armR, forearmL, forearmR } = rig;
  // Smooth bell envelope: 0 → 1 → 0 across the gesture's life.
  const env = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI);
  switch (gesture) {
    case 'wave': {
      armR.rotation.x = -2.6 * env;
      armR.rotation.z = -0.4 * env;
      forearmR.rotation.x = (-0.4 + Math.sin(t * 9) * 0.45) * env;
      break;
    }
    case 'salute': {
      // Crisp military salute: upper arm raised out, forearm folded so
      // the hand meets the brow; head straightens; tiny chest-out.
      // Snap up fast, hold, release — use a plateau envelope instead of
      // the bell so the hold reads as deliberate.
      const hold = Math.min(1, Math.min(k / 0.18, (1 - k) / 0.22));
      const e = Math.max(0, hold);
      armR.rotation.x = -1.9 * e;
      armR.rotation.z = -1.0 * e;
      forearmR.rotation.x = -2.35 * e;
      head.rotation.x += -0.06 * e;
      head.rotation.z += -0.04 * e;
      torso.rotation.x += -0.06 * e;
      break;
    }
    case 'bow': {
      // Formal bow: torso + head pitch forward, arms tucked to the sides.
      torso.rotation.x += 0.55 * env;
      head.rotation.x += 0.35 * env;
      armL.rotation.x = 0.15 * env;
      armR.rotation.x = 0.15 * env;
      armL.rotation.z = 0.06 * env;
      armR.rotation.z = -0.06 * env;
      break;
    }
    case 'facepalm': {
      // Hand to visor, head drops into it, slight slump.
      armR.rotation.x = -2.5 * env;
      armR.rotation.z = -0.35 * env;
      forearmR.rotation.x = -2.2 * env;
      head.rotation.x += 0.4 * env;
      torso.rotation.x += 0.12 * env;
      break;
    }
    case 'stretch': {
      // Both arms overhead, torso arches back, slow side-to-side sway.
      armL.rotation.x = -3.0 * env;
      armR.rotation.x = -3.0 * env;
      armL.rotation.z = (0.25 + Math.sin(t * 1.4) * 0.1) * env;
      armR.rotation.z = (-0.25 - Math.sin(t * 1.4) * 0.1) * env;
      forearmL.rotation.x = -0.15 * env;
      forearmR.rotation.x = -0.15 * env;
      torso.rotation.x += -0.18 * env;
      head.rotation.x += -0.25 * env;
      break;
    }
    case 'dance': {
      // Cheesy two-step: alternating arm pumps, hip sway via torso roll,
      // head bops on the beat (~2 Hz).
      const beat = t * Math.PI * 4; // 2 Hz
      const a = Math.sin(beat);
      armL.rotation.x = (-1.4 + a * 0.7) * env;
      armR.rotation.x = (-1.4 - a * 0.7) * env;
      forearmL.rotation.x = -1.1 * env;
      forearmR.rotation.x = -1.1 * env;
      torso.rotation.z = a * 0.12 * env;
      torso.rotation.y += a * 0.18 * env;
      head.rotation.x += Math.abs(Math.sin(beat)) * -0.12 * env;
      head.rotation.z += a * 0.08 * env;
      break;
    }
    case 'look-around': {
      // Deliberate scan: head sweeps left → right with torso follow.
      const sweep = Math.sin(k * Math.PI * 2) * 0.7;
      head.rotation.y += sweep * env;
      torso.rotation.y += sweep * 0.25 * env;
      break;
    }
    case 'point-left':
    case 'point-right':
    case 'point-up': {
      const arm = gesture === 'point-left' ? armL : armR;
      const fore = gesture === 'point-left' ? forearmL : forearmR;
      const pitch = gesture === 'point-up' ? -2.9 : -1.55;
      arm.rotation.x = pitch * env;
      arm.rotation.z = (gesture === 'point-left' ? 0.25 : -0.25) * env;
      fore.rotation.x = -0.08 * env;
      head.rotation.y +=
        (gesture === 'point-left' ? 0.35 : gesture === 'point-right' ? -0.35 : 0) * env;
      if (gesture === 'point-up') head.rotation.x += -0.3 * env;
      break;
    }
    case 'nod': {
      head.rotation.x += Math.sin(k * Math.PI * 4) * 0.28 * env;
      break;
    }
    case 'shake': {
      head.rotation.y += Math.sin(k * Math.PI * 5) * 0.32 * env;
      break;
    }
    case 'shrug': {
      armL.rotation.z = 0.85 * env;
      armR.rotation.z = -0.85 * env;
      forearmL.rotation.x = -1.5 * env;
      forearmR.rotation.x = -1.5 * env;
      head.rotation.z += 0.14 * env;
      torso.rotation.x += -0.04 * env;
      break;
    }
    case 'celebrate': {
      const bounce = Math.abs(Math.sin(t * 6));
      armL.rotation.x = (-2.8 + bounce * 0.3) * env;
      armR.rotation.x = (-2.8 + (1 - bounce) * 0.3) * env;
      head.rotation.x += -0.18 * env;
      break;
    }
    case 'typing': {
      const tap = Math.sin(t * 16);
      armL.rotation.x = -0.9 * env;
      armR.rotation.x = -0.9 * env;
      forearmL.rotation.x = (-0.9 + tap * 0.12) * env;
      forearmR.rotation.x = (-0.9 - tap * 0.12) * env;
      head.rotation.x += 0.22 * env;
      break;
    }
  }
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
