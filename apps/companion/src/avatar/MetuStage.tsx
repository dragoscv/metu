/**
 * MetuStage — renders the procedural "metu unit" synthetic being.
 *
 * - Code-driven animation (poseMetu): walk/jump/fall/climb match the
 *   platformer physics exactly; idle carries the expressive layer
 *   (listening lean, thinking chin-hand, speaking gestures).
 * - Adaptive frame budget: 60fps while moving/speaking/listening,
 *   20fps when idle — the decided perf policy.
 * - Per-persona palettes (METU_PALETTES) — one rig, many identities.
 * - Voice-amplitude visor/core glow via the shared audio element.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../state/runtime';
import { getCursor } from '../assistant/spatial';
import { reportFootOffset } from './footAnchor';
import type { AvatarDriveProps } from './types';
import {
  buildMetuRig,
  disposeMetuRig,
  getMetuPalette,
  poseMetu,
  applyMetuGesture,
  type MetuMotion,
  type MetuGesture,
} from './metuModel';
import { TELEPORT_OUT_S, TELEPORT_IN_S } from '../assistant/avatarPhysics';

export function MetuStage({
  paletteId,
  state,
  locomotion,
  facing,
  size = 220,
  audioEl,
  anchor = false,
}: AvatarDriveProps & {
  paletteId: string;
  /**
   * Only the MAIN desktop stage reports the foot anchor. Previews (chat
   * panel 72px, Avatar studio 220px in another window) must NOT — their
   * measurements would corrupt the physics alignment.
   */
  anchor?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driveRef = useRef({ state, locomotion, facing, audioEl });
  driveRef.current.state = state;
  driveRef.current.locomotion = locomotion;
  driveRef.current.facing = facing;
  driveRef.current.audioEl = audioEl;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    camera.position.set(0, 0.62, 2.45);
    camera.lookAt(0, 0.48, 0);

    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x90b4ff, 0.8);
    rim.position.set(-1.5, 1, -1.5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));

    const rig = buildMetuRig(getMetuPalette(paletteId));
    scene.add(rig.root);

    // Measure the foot anchor from the ACTUAL mesh bottom (Box3 min in the
    // neutral pose) — NOT rig y=0: the foot boxes bottom out at y≈0.057 in
    // rig space, so projecting y=0 made the whole character hover. Only
    // the main desktop stage reports (previews would corrupt the value).
    const measureFeet = () => {
      if (!anchor) return;
      poseMetu(rig, 'idle', 'idle', 0, 0); // deterministic neutral pose
      const box = new THREE.Box3().setFromObject(rig.root);
      const v = new THREE.Vector3(0, box.min.y, 0);
      v.project(camera);
      const feetCanvasY = ((1 - v.y) / 2) * size;
      const rect = canvas.getBoundingClientRect();
      const feetViewportY = rect.top + (feetCanvasY / size) * rect.height;
      const offset = window.innerHeight - feetViewportY;
      reportFootOffset(offset);
    };
    // Layout settles a tick after mount.
    const measureTimer = setTimeout(measureFeet, 120);

    // Voice amplitude via WebAudio analyser on the shared element.
    let analyser: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    const tryAttachAudio = () => {
      const el = driveRef.current.audioEl;
      if (!el || analyser) return;
      try {
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaElementSource(el);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        analyser.connect(audioCtx.destination);
        freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } catch {
        analyser = null; // element may already be claimed — glow stays static
      }
    };

    const clock = new THREE.Clock();
    let raf = 0;
    let lastFrame = 0;
    let yaw = 0;
    let lastLoco: MetuMotion = 'idle';
    /** Seconds remaining of landing squash (set on fall→ground transition). */
    let squash = 0;
    let lastT = 0;
    // Gesture playback: one-shot overlays triggered via window event
    // (e.g. 'wave' on greeting, 'typing' while a terminal command runs).
    let gesture: { kind: MetuGesture; start: number; dur: number } | null = null;
    const onGesture = (e: Event) => {
      if (!anchor) return; // only the main desktop stage gestures
      const d = (e as CustomEvent<{ gesture: MetuGesture; durationMs?: number }>).detail;
      if (d?.gesture) {
        gesture = {
          kind: d.gesture,
          start: clock.getElapsedTime(),
          dur: Math.max(0.4, (d.durationMs ?? 1400) / 1000),
        };
      }
    };
    window.addEventListener('metu:assistant-gesture', onGesture);
    // Idle variety: every 25–60s of uninterrupted idle, play a subtle
    // life-sign gesture (stretch or look-around). Main stage only.
    let idleVarietyTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleIdleVariety = () => {
      idleVarietyTimer = setTimeout(
        () => {
          const loco = (driveRef.current.locomotion ?? 'idle') as MetuMotion;
          if (anchor && loco === 'idle' && driveRef.current.state === 'idle' && !gesture) {
            const pick: MetuGesture = Math.random() < 0.5 ? 'stretch' : 'look-around';
            gesture = { kind: pick, start: clock.getElapsedTime(), dur: 2.6 };
          }
          scheduleIdleVariety();
        },
        25_000 + Math.random() * 35_000,
      );
    };
    if (anchor) scheduleIdleVariety();
    // Teleport morph clock: counts seconds inside the 'teleporting' state.
    let warpT = 0;
    // Continuous locomotion phase (radians). Advancing by dt — instead of
    // deriving from global time — means the gait cycle (a) never jumps when
    // entering walking mid-sine, and (b) eases in/out: cadence ramps up
    // over ~0.25s on start and decays on stop, so transitions don't snap.
    let gaitPhase = 0;
    let gaitSpeed = 0; // current cadence (rad/s), eased toward the target
    const GAIT_CADENCE = 5.5; // rad/s ≈ 0.9 strides/s
    // Cursor curiosity: poll the native cursor at 4Hz while idle and derive
    // a clamped gaze offset relative to the window center.
    let look: { x: number; y: number } | null = null;
    let cursorTimer: ReturnType<typeof setInterval> | null = null;
    if (isTauri()) {
      cursorTimer = setInterval(() => {
        const loco = (driveRef.current.locomotion ?? 'idle') as MetuMotion;
        // Gaze-follow while idle OR sitting (relaxed but attentive).
        if ((loco !== 'idle' && loco !== 'sitting') || driveRef.current.state !== 'idle') {
          look = null;
          return;
        }
        void Promise.all([getCursor(), getCurrentWindow().outerPosition()])
          .then(([cur, pos]) => {
            if (!cur) {
              look = null;
              return;
            }
            const cx = pos.x + (size * (window.devicePixelRatio || 1)) / 2;
            const cy = pos.y + (size * (window.devicePixelRatio || 1)) / 2;
            // Normalize by ~a half-monitor of distance; clamp to [-1, 1].
            look = {
              x: Math.max(-1, Math.min(1, (cur.x - cx) / 900)),
              y: Math.max(-1, Math.min(1, (cur.y - cy) / 700)),
            };
          })
          .catch(() => {
            look = null;
          });
      }, 250);
    }

    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);

      const loco = (driveRef.current.locomotion ?? 'idle') as MetuMotion;
      const expr = driveRef.current.state;
      // Adaptive budget: 60fps active, 20fps idle/sitting.
      const active = (loco !== 'idle' && loco !== 'sitting') || expr !== 'idle';
      const minInterval = active ? 0 : 50 - 16; // ~20fps when idle
      if (now - lastFrame < minInterval) return;
      lastFrame = now;

      const t = clock.getElapsedTime();
      const dt = Math.min(t - lastT, 0.1);
      lastT = t;

      // Ease the cadence toward its target and integrate the phase.
      const gaitTarget = loco === 'walking' || loco === 'climbing' ? GAIT_CADENCE : 0;
      gaitSpeed += (gaitTarget - gaitSpeed) * Math.min(1, dt * 8);
      gaitPhase += gaitSpeed * dt;

      // Landing squash: falling/jumping → grounded triggers a brief
      // squash-and-stretch (scaleY dip + scaleX bulge, 180ms recover).
      if (
        (lastLoco === 'falling' || lastLoco === 'jumping') &&
        (loco === 'idle' || loco === 'walking')
      ) {
        squash = 0.18;
      }
      lastLoco = loco;
      // Teleport morph: dissolve-out (shrink + spin + skew), the window
      // jumps at the midpoint (physics), then materialize-in (overshoot
      // scale + counter-spin). Pure transform on rig.root — cheap & juicy.
      if (loco === 'teleporting') {
        warpT += dt;
        const total = TELEPORT_OUT_S + TELEPORT_IN_S;
        if (warpT <= TELEPORT_OUT_S) {
          const k = warpT / TELEPORT_OUT_S; // 0→1 dissolve out
          const e = k * k; // ease-in
          const s = Math.max(0.02, 1 - e);
          rig.root.scale.set(s * (1 - e * 0.4), s * (1 + e * 1.6), s); // stretch into a beam
          rig.root.rotation.z = e * 0.9;
          rig.visorMat.emissiveIntensity = 2 + e * 6;
          rig.coreMat.emissiveIntensity = 2 + e * 8;
        } else if (warpT <= total) {
          const k = (warpT - TELEPORT_OUT_S) / TELEPORT_IN_S; // 0→1 materialize
          const e = 1 - (1 - k) * (1 - k); // ease-out
          const over = 1 + Math.sin(k * Math.PI) * 0.18; // overshoot squash
          const s = Math.max(0.02, e);
          rig.root.scale.set(s * over, s * (2.6 - e * 1.6), s);
          rig.root.rotation.z = (1 - e) * -0.9;
          rig.visorMat.emissiveIntensity = 8 - e * 6;
          rig.coreMat.emissiveIntensity = 10 - e * 8;
        }
      } else if (warpT > 0) {
        warpT = 0;
        rig.root.scale.set(1, 1, 1);
        rig.root.rotation.z = 0;
      } else if (squash > 0) {
        squash = Math.max(0, squash - dt);
        const k = squash / 0.18; // 1 → 0
        const dip = Math.sin(k * Math.PI) * 0.18; // peak mid-squash
        rig.root.scale.set(1 + dip * 0.6, 1 - dip, 1 + dip * 0.6);
      } else {
        rig.root.scale.set(1, 1, 1);
      }

      let amp = 0;
      if (expr === 'speaking') {
        tryAttachAudio();
        if (analyser && freqBuf) {
          analyser.getByteFrequencyData(freqBuf);
          let sum = 0;
          for (const v of freqBuf) sum += v;
          amp = Math.min(1, sum / freqBuf.length / 140);
        }
      }

      poseMetu(rig, loco, expr, t, amp, look, gaitPhase);

      // poseMetu resets emissive each frame — re-boost during the warp.
      if (loco === 'teleporting') {
        rig.visorMat.emissiveIntensity = 6;
        rig.coreMat.emissiveIntensity = 8;
      }

      // One-shot gesture overlay (after the base pose).
      if (gesture) {
        const k = (t - gesture.start) / gesture.dur;
        if (k >= 1) gesture = null;
        else applyMetuGesture(rig, gesture.kind, k, t);
      }

      // Face travel direction while moving; face camera when stationary.
      // Jump/fall keep the travel yaw too — flipping to camera mid-hop and
      // back on landing read as a fast wiggle on every bounce.
      const face = driveRef.current.facing ?? 1;
      const wantYaw =
        loco === 'walking' || loco === 'climbing' || loco === 'jumping' || loco === 'falling'
          ? face === 1
            ? Math.PI / 2
            : -Math.PI / 2
          : Math.sin(t * 0.3) * 0.08;
      let dy = wantYaw - yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      // Frame-rate-independent smoothing (~7%/frame at 60fps equivalent);
      // the old 16%/frame snap was half the "too fast" feel.
      yaw += dy * Math.min(1, dt * 4.5);
      rig.root.rotation.y = yaw;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (cursorTimer) clearInterval(cursorTimer);
      clearTimeout(measureTimer);
      window.removeEventListener('metu:assistant-gesture', onGesture);
      if (idleVarietyTimer) clearTimeout(idleVarietyTimer);
      scene.remove(rig.root);
      disposeMetuRig(rig);
      renderer.dispose();
      void audioCtx?.close().catch(() => {});
    };
    // `anchor` is static per mount — intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteId, size]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: size, height: size }} />;
}
