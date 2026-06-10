/**
 * VrmStage — typed 3D humanoid renderer for the avatar system.
 *
 * Loads a .vrm via three's GLTFLoader + the VRMLoaderPlugin, then animates:
 *   - idle: gentle head sway + breathing + random blinks
 *   - listening: head tilts toward camera, sway dampened
 *   - speaking: mouth ('aa') driven by live audio RMS (or 6 Hz sine fallback)
 *   - thinking: brief downward tilt + slight frown
 *
 * Now that `three` + `@pixiv/three-vrm` are real dependencies we use proper
 * types instead of the duck-typed `unknown` dance the legacy VrmAvatar used.
 *
 * Loading + error are surfaced via `onStatus` so the host can show a spinner
 * or fall back to the orb when a model URL is bad.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AvatarDriveProps } from './types';

export type VrmStatus = 'loading' | 'ready' | 'error';

export function VrmStage({
  modelUrl,
  state,
  audioEl,
  size = 220,
  onStatus,
}: AvatarDriveProps & { modelUrl: string; onStatus?: (s: VrmStatus) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driveRef = useRef({ state });
  driveRef.current.state = state;
  const audioRef = useRef<HTMLAudioElement | null>(audioEl ?? null);
  audioRef.current = audioEl ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let disposed = false;
    onStatus?.('loading');

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    camera.position.set(0, 1.32, 1.25);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x90b4ff, 0.8);
    rim.position.set(-1.5, 1, -1.5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    let vrm: VRM | null = null;

    // audio analyser for mouth
    let analyser: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const tryAttach = () => {
      const el = audioRef.current;
      if (!el || analyser) return;
      try {
        audioCtx = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
        const src = audioCtx.createMediaElementSource(el);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        buf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        src.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch {
        analyser = null;
      }
    };

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader
      .loadAsync(modelUrl)
      .then((gltf) => {
        if (disposed) return;
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) {
          onStatus?.('error');
          return;
        }
        vrm = loaded;
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);
        onStatus?.('ready');
      })
      .catch(() => {
        if (!disposed) onStatus?.('error');
      });

    const clock = new THREE.Clock();
    let nextBlink = 1.5 + Math.random() * 4;
    let blinkUntil = -1;
    let thinkUntil = -1;
    let lastState = state;

    const tick = () => {
      if (disposed) return;
      const delta = clock.getDelta();
      const t = clock.getElapsedTime();
      const s = driveRef.current.state;
      if (s !== lastState) {
        if (s === 'thinking') thinkUntil = t + 2.4;
        lastState = s;
      }

      if (vrm) {
        const listening = s === 'listening';
        const head = vrm.humanoid?.getNormalizedBoneNode('head');
        const sway = listening ? 0.4 : 1;
        if (head) {
          head.rotation.y = Math.sin(t * 0.6) * 0.12 * sway;
          head.rotation.x =
            Math.sin(t * 0.4) * 0.05 * sway + (listening ? 0.12 : 0) + (t < thinkUntil ? 0.2 : 0);
        }
        vrm.scene.position.y = Math.sin(t * 1.2) * 0.005;

        const em = vrm.expressionManager;
        if (em) {
          // blink
          if (t > nextBlink && blinkUntil < 0) blinkUntil = t + 0.12;
          if (blinkUntil > 0) {
            em.setValue('blink', t < blinkUntil ? 1 : 0);
            if (t >= blinkUntil) {
              blinkUntil = -1;
              nextBlink = t + 2 + Math.random() * 4;
            }
          }
          // mouth
          tryAttach();
          let mouth = 0;
          if (s === 'speaking') {
            if (analyser && buf) {
              analyser.getByteFrequencyData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) sum += buf[i]!;
              mouth = Math.min(1, sum / buf.length / 160);
            } else {
              mouth = (Math.sin(t * 6 * Math.PI) + 1) / 2;
            }
          }
          em.setValue('aa', mouth);
          em.setValue('happy', s === 'speaking' ? 0.15 : 0);
          em.setValue('sad', t < thinkUntil ? 0.25 : 0);
        }
        vrm.update(delta);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
      audioCtx?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, size]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: size, height: size }} />;
}
