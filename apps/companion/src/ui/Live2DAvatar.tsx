/**
 * Live2D avatar mount — slice 8b.
 *
 * Dormant infrastructure: this component is wired into the pet form but
 * does nothing useful until the user opts in by:
 *
 *   1. Installing optional runtime deps:
 *      `pnpm --filter @metu/companion add pixi.js@^7 pixi-live2d-display`
 *   2. Loading the Cubism Core script in `index.html` head:
 *      `<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>`
 *   3. Setting `VITE_LIVE2D_MODEL_URL` in `.env.local` to the URL of a
 *      `*.model3.json` (Cubism 4) — local file:// URLs work in Tauri.
 *
 * Without any of those, the dynamic import throws, we log once, and the
 * pet form falls back to the CSS orb. No bundle weight is added until a
 * user installs the deps.
 *
 * The mouth/lip-sync hook (`speaking` prop) toggles the model's
 * `ParamMouthOpenY` parameter; if the model lacks it the call no-ops.
 */
import { useEffect, useRef, useState } from 'react';

export interface Live2DAvatarProps {
  modelUrl: string;
  speaking?: boolean;
  size?: number;
}

let warnedMissing = false;

export function Live2DAvatar({ modelUrl, speaking, size = 200 }: Live2DAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Stored as `unknown` because the optional dep types aren't present at
  // typecheck time — we narrow only at the per-call level via duck typing.
  const modelRef = useRef<unknown>(null);
  const appRef = useRef<unknown>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        // @ts-expect-error -- optional peer dep, may not be installed
        const PIXI = await import('pixi.js');
        // @ts-expect-error -- optional peer dep, may not be installed
        const { Live2DModel } = await import('pixi-live2d-display');
        if (cancelled) return;
        // pixi-live2d-display registers PIXI Ticker on import; nothing else needed.
        const app = new (PIXI as { Application: new (opts: unknown) => unknown }).Application({
          view: canvas,
          width: size,
          height: size,
          backgroundAlpha: 0,
          antialias: true,
        });
        appRef.current = app;
        const model = await (Live2DModel as { from: (url: string) => Promise<unknown> }).from(
          modelUrl,
        );
        if (cancelled) return;
        const m = model as {
          width: number;
          height: number;
          scale: { set: (v: number) => void };
          x: number;
          y: number;
          anchor: { set: (x: number, y: number) => void };
        };
        m.anchor.set(0.5, 0.5);
        m.x = size / 2;
        m.y = size / 2;
        const fit = Math.min(size / m.width, size / m.height);
        m.scale.set(fit);
        (app as { stage: { addChild: (c: unknown) => void } }).stage.addChild(model);
        modelRef.current = model;
        setAvailable(true);
      } catch (err) {
        if (!warnedMissing) {
          warnedMissing = true;
          console.info(
            '[live2d] runtime not available — falling back to CSS orb. Install pixi.js + pixi-live2d-display + Cubism Core to enable.',
            err,
          );
        }
        setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
      const app = appRef.current as { destroy?: (a: boolean, b: unknown) => void } | null;
      app?.destroy?.(true, { children: true, texture: true });
      appRef.current = null;
      modelRef.current = null;
    };
  }, [modelUrl, size]);

  // Drive `ParamMouthOpenY` while the persona is speaking. Smooth sine
  // wave at ~6Hz so the mouth feels alive without per-sample audio.
  useEffect(() => {
    if (!speaking || !modelRef.current) return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const open = (Math.sin(t * 6 * Math.PI) + 1) / 2;
      const m = modelRef.current as {
        internalModel?: {
          coreModel?: { setParameterValueById?: (id: string, v: number) => void };
        };
      } | null;
      m?.internalModel?.coreModel?.setParameterValueById?.('ParamMouthOpenY', open);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  if (available === false) {
    return null; // Pet.tsx renders the CSS orb fallback.
  }
  return <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block' }} />;
}

export const live2dEnabled = (): string | null => {
  const url = (import.meta.env.VITE_LIVE2D_MODEL_URL as string | undefined) ?? null;
  return url && url.length > 0 ? url : null;
};
