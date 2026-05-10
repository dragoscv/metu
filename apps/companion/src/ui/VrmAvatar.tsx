/**
 * VRM avatar mount — companion-agent slice 3.
 *
 * Dormant infrastructure, mirroring `Live2DAvatar.tsx`: this component is
 * wired into the pet/HUD forms but does nothing until the user opts in by:
 *
 *   1. Installing optional runtime deps:
 *      `pnpm --filter @metu/companion add three @react-three/fiber @react-three/drei @pixiv/three-vrm`
 *      `pnpm --filter @metu/companion add -D @types/three`
 *   2. Setting `VITE_VRM_MODEL_URL` in `.env.local` to a `*.vrm` URL
 *      (local file:// works in Tauri; bundled `appdata/avatars/metu.vrm`
 *      recommended) — OR using a persona whose `avatarUrl` is a `.vrm`.
 *
 * Without those, the dynamic import throws, we log once, and the parent
 * form falls back to the next avatar tier. Zero bundle weight added until
 * the user installs the deps.
 *
 * Animation:
 *   - Idle: gentle head sway + subtle breath driven by elapsed time.
 *   - Mouth: if `audioEl` is supplied AND a WebAudio AnalyserNode can be
 *     attached, the `aa` blendshape is driven by RMS amplitude. Otherwise
 *     a 6Hz sine wave fallback while `speaking` is true. Either way the
 *     mouth feels alive without per-sample buffer copies.
 */
import { useEffect, useRef, useState } from 'react';

export interface VrmAvatarProps {
  modelUrl: string;
  speaking?: boolean;
  /**
   * When true the avatar tilts head forward subtly + raises eye attention,
   * reading as "actively listening". Cheap idle animation otherwise.
   */
  listening?: boolean;
  /**
   * Rendered tilted-down with knit-brow expression to read as "working on
   * something" — fired briefly when the Conductor takes over from a
   * realtime persona via shadow triage escalation.
   */
  thinking?: boolean;
  size?: number;
  audioEl?: HTMLAudioElement | null;
}

let warnedMissing = false;

// Loose duck-typed shapes for runtime-only deps so we don't depend on @types/three.
type LoadedVrm = {
  scene: { rotation: { y: number; x: number }; position: { y: number } };
  expressionManager?: {
    setValue: (name: string, value: number) => void;
  };
  humanoid?: {
    getNormalizedBoneNode: (name: string) => { rotation: { y: number; x: number } } | null;
  };
  update: (delta: number) => void;
};

export function VrmAvatar({
  modelUrl,
  speaking,
  listening,
  thinking,
  size = 200,
  audioEl,
}: VrmAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{
    dispose: () => void;
    setMouth: (v: number) => void;
    setListening: (v: boolean) => void;
    setThinking: (v: boolean) => void;
  } | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  // Boot Three.js scene once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        // @ts-expect-error -- optional peer dep, may not be installed
        const THREE = await import('three');
        // @ts-expect-error -- optional peer dep, may not be installed
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        // @ts-expect-error -- optional peer dep, may not be installed
        const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
        if (cancelled) return;

        const T = THREE as unknown as {
          Scene: new () => { add: (o: unknown) => void; background: unknown };
          PerspectiveCamera: new (
            fov: number,
            aspect: number,
            near: number,
            far: number,
          ) => { position: { set: (x: number, y: number, z: number) => void } };
          WebGLRenderer: new (opts: unknown) => {
            setSize: (w: number, h: number) => void;
            setPixelRatio: (r: number) => void;
            render: (s: unknown, c: unknown) => void;
            dispose: () => void;
            setClearColor: (c: number, a: number) => void;
          };
          DirectionalLight: new (
            color: number,
            intensity: number,
          ) => {
            position: { set: (x: number, y: number, z: number) => void };
          };
          AmbientLight: new (color: number, intensity: number) => unknown;
          Clock: new () => { getDelta: () => number; getElapsedTime: () => number };
        };

        const scene = new T.Scene();
        const camera = new T.PerspectiveCamera(28, 1, 0.1, 20);
        camera.position.set(0, 1.35, 1.2);
        const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(size, size);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);
        const dir = new T.DirectionalLight(0xffffff, 1);
        dir.position.set(1, 2, 1);
        scene.add(dir);
        scene.add(new T.AmbientLight(0xffffff, 0.4));

        // Load VRM
        const loader = new (GLTFLoader as new () => {
          register: (cb: (parser: unknown) => unknown) => void;
          loadAsync: (url: string) => Promise<{ userData: { vrm?: LoadedVrm } }>;
        })();
        loader.register(
          (parser: unknown) => new (VRMLoaderPlugin as new (p: unknown) => unknown)(parser),
        );
        const gltf = await loader.loadAsync(modelUrl);
        if (cancelled) return;
        const vrm = gltf.userData.vrm;
        if (!vrm) throw new Error('vrm_payload_missing');
        (VRMUtils as { rotateVRM0?: (v: LoadedVrm) => void }).rotateVRM0?.(vrm);
        scene.add(vrm.scene as unknown);
        vrm.scene.position.y = 0;

        // Audio analyser (optional)
        let audioCtx: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let amplitudeBuf: Uint8Array | null = null;
        let audioSource: MediaElementAudioSourceNode | null = null;
        const tryAttachAudio = (el: HTMLAudioElement | null) => {
          if (!el || analyser) return;
          try {
            audioCtx = new (
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            )();
            audioSource = audioCtx.createMediaElementSource(el);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            amplitudeBuf = new Uint8Array(analyser.frequencyBinCount);
            audioSource.connect(analyser);
            analyser.connect(audioCtx.destination);
          } catch {
            // Element may already be hooked to another graph; fall back to sine.
            analyser = null;
          }
        };
        tryAttachAudio(audioEl ?? null);

        let mouthOverride: number | null = null;
        const setMouth = (v: number) => {
          mouthOverride = v;
        };
        let listeningFlag = false;
        const setListening = (v: boolean) => {
          listeningFlag = v;
        };
        let thinkingUntil = -1;
        const setThinking = (v: boolean) => {
          if (v) {
            // Brief thinking pose; auto-clears so a stuck flag never freezes
            // the avatar in a frown. ~2.4s reads as "taking the wheel".
            thinkingUntil = clock.getElapsedTime() + 2.4;
          } else {
            thinkingUntil = -1;
          }
        };

        // Random blink scheduler — humans blink every 2–6 s for ~80–120 ms.
        // Using elapsed time inside the render loop keeps it cheap and
        // synced to the same clock as the rest of the animation.
        let nextBlinkAt = 1.5 + Math.random() * 4;
        let blinkUntil = -1;

        const clock = new T.Clock();
        let raf = 0;
        const tick = () => {
          const delta = clock.getDelta();
          const t = clock.getElapsedTime();
          // Idle sway — dampen when listening so the head reads as still.
          const swayScale = listeningFlag ? 0.4 : 1;
          vrm.scene.rotation.y = Math.sin(t * 0.5) * 0.08 * swayScale;
          // Forward tilt when listening (chin down ~5°), default upright.
          // When thinking, tilt slightly more + freeze sway entirely.
          const isThinking = thinkingUntil > 0 && t <= thinkingUntil;
          if (isThinking) vrm.scene.rotation.y = 0;
          const targetTiltX = isThinking ? 0.14 : listeningFlag ? 0.09 : Math.sin(t * 0.3) * 0.02;
          vrm.scene.rotation.x = targetTiltX;
          // Breath
          vrm.scene.position.y = Math.sin(t * 1.6) * 0.005;
          // Blink
          if (t >= nextBlinkAt && blinkUntil < 0) {
            blinkUntil = t + 0.09;
            nextBlinkAt = t + 2 + Math.random() * 4;
          }
          const blink = blinkUntil > 0 && t <= blinkUntil ? 1 : 0;
          if (blinkUntil > 0 && t > blinkUntil) blinkUntil = -1;
          vrm.expressionManager?.setValue('blink', blink);
          // Mouth
          let mouth = 0;
          if (analyser && amplitudeBuf) {
            // Cast to satisfy lib.dom's stricter Uint8Array<ArrayBuffer>
            // signature; the runtime accepts any Uint8Array view.
            (
              analyser as unknown as { getByteTimeDomainData: (a: Uint8Array) => void }
            ).getByteTimeDomainData(amplitudeBuf);
            let sum = 0;
            for (let i = 0; i < amplitudeBuf.length; i++) {
              const v = (amplitudeBuf[i]! - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / amplitudeBuf.length);
            mouth = Math.min(1, rms * 4);
          } else if (mouthOverride !== null) {
            mouth = mouthOverride;
          }
          vrm.expressionManager?.setValue('aa', mouth);
          // Knit-brow / thinking expression — try a few common VRM
          // expression names; whichever exists on this model wins. Cleared
          // automatically when `thinkingUntil` lapses.
          const thinkAmount = isThinking ? 1 : 0;
          vrm.expressionManager?.setValue('sad', thinkAmount);
          vrm.expressionManager?.setValue('angry', thinkAmount * 0.4);
          vrm.update(delta);
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        stateRef.current = {
          setMouth,
          setListening,
          setThinking,
          dispose: () => {
            cancelAnimationFrame(raf);
            try {
              audioSource?.disconnect();
              analyser?.disconnect();
              void audioCtx?.close();
            } catch {
              /* ignore */
            }
            renderer.dispose();
          },
        };
        setAvailable(true);
      } catch (err) {
        if (!warnedMissing) {
          warnedMissing = true;
          console.info(
            '[vrm] runtime not available — falling back. Install three + @react-three/fiber + @pixiv/three-vrm to enable.',
            err,
          );
        }
        setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
      stateRef.current?.dispose();
      stateRef.current = null;
    };
    // We intentionally only re-init on URL/size change, not on audioEl/speaking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, size]);

  // Drive sine-wave mouth fallback while `speaking` flips on, when no
  // analyser is attached. The render loop reads `mouthOverride` each tick.
  useEffect(() => {
    if (!speaking) {
      stateRef.current?.setMouth(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const open = (Math.sin(t * 6 * Math.PI) + 1) / 2;
      stateRef.current?.setMouth(open);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stateRef.current?.setMouth(0);
    };
  }, [speaking]);

  // Push `listening` prop into the live render loop without re-mounting.
  useEffect(() => {
    stateRef.current?.setListening(!!listening);
  }, [listening]);
  // Push `thinking` pulses into the live render loop. Auto-clears inside
  // the loop so we don't need to manage the falsy edge.
  useEffect(() => {
    if (thinking) stateRef.current?.setThinking(true);
  }, [thinking]);

  if (available === false) {
    return null; // Parent renders next-tier fallback.
  }
  return <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block' }} />;
}

/**
 * Resolve a VRM model URL from env or persona override. Returns null when
 * VRM should not mount; the parent then falls through to Live2D / orb.
 */
export const vrmEnabled = (personaAvatarUrl?: string | null): string | null => {
  if (personaAvatarUrl && personaAvatarUrl.toLowerCase().endsWith('.vrm')) {
    return personaAvatarUrl;
  }
  const url = (import.meta.env.VITE_VRM_MODEL_URL as string | undefined) ?? null;
  return url && url.length > 0 ? url : null;
};
