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
  type MetuMotion,
} from './metuModel';

export function MetuStage({
  paletteId,
  state,
  locomotion,
  facing,
  size = 220,
  audioEl,
}: AvatarDriveProps & { paletteId: string }) {
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

    // Measure the foot anchor: project the model's feet (y=0 in rig space)
    // to canvas coordinates, then convert to "distance from the window
    // bottom" in logical px. Re-measured on mount (layout/canvas/camera
    // are stable afterwards; squash scaling never moves the feet).
    const measureFeet = () => {
      const v = new THREE.Vector3(0, 0, 0); // feet in world space
      v.project(camera);
      // NDC y → canvas px (top-left origin).
      const feetCanvasY = ((1 - v.y) / 2) * size;
      const rect = canvas.getBoundingClientRect();
      const feetViewportY = rect.top + (feetCanvasY / size) * rect.height;
      const offset = window.innerHeight - feetViewportY;
      reportFootOffset(offset);
    };
    // Layout settles a tick after mount.
    const measureTimer = setTimeout(measureFeet, 100);

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

      // Landing squash: falling/jumping → grounded triggers a brief
      // squash-and-stretch (scaleY dip + scaleX bulge, 180ms recover).
      if (
        (lastLoco === 'falling' || lastLoco === 'jumping') &&
        (loco === 'idle' || loco === 'walking')
      ) {
        squash = 0.18;
      }
      lastLoco = loco;
      if (squash > 0) {
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

      poseMetu(rig, loco, expr, t, amp, look);

      // Face travel direction while moving; face camera when stationary.
      const face = driveRef.current.facing ?? 1;
      const wantYaw =
        loco === 'walking' || loco === 'climbing'
          ? face === 1
            ? Math.PI / 2
            : -Math.PI / 2
          : Math.sin(t * 0.3) * 0.08;
      let dy = wantYaw - yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      yaw += dy * 0.16;
      rig.root.rotation.y = yaw;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (cursorTimer) clearInterval(cursorTimer);
      clearTimeout(measureTimer);
      scene.remove(rig.root);
      disposeMetuRig(rig);
      renderer.dispose();
      void audioCtx?.close().catch(() => {});
    };
  }, [paletteId, size]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: size, height: size }} />;
}
