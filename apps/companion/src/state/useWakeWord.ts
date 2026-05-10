/**
 * Wake-word listener — companion-agent slice 4.
 *
 * Wires the dormant adapters (`@metu/voice/porcupine`,
 * `@metu/voice/open-wake-word`) into the Tauri webview. Uses
 * `pickWakeRoute()` to decide which engine to start based on the active
 * persona and which optional deps are installed at runtime.
 *
 * Activation, in priority order:
 *   1. **Porcupine** — `pnpm --filter @metu/companion add @picovoice/porcupine-web @picovoice/web-voice-processor`
 *      and set `VITE_PORCUPINE_ACCESS_KEY` (free Picovoice tier).
 *      Built-in keywords (`'jarvis'`, `'hey-google'`, …) work out of the
 *      box; custom words need a `*.ppn` file under `public/wake/`.
 *   2. **openWakeWord** — `pnpm --filter @metu/companion add onnxruntime-web`
 *      and drop a `.onnx` model at `public/wake/<word>.onnx` OR set
 *      `VITE_OPENWAKEWORD_MODEL_URL`. The open-wake-word runner is left
 *      as a stub here (one TODO inside `loadOpenWakeWordRunner`) because
 *      the inference graph requires bundling the embedding + classifier
 *      models — the structure is in place so adding it later is one diff.
 *
 * When neither runner loads we fall back silently; the global hotkey
 * (`usePushToTalkHotkey`) remains the canonical activation path.
 */
import { useEffect, useRef } from 'react';
import { getWake, pickWakeRoute, type BillingTier, type CostTier, type Off } from '@metu/voice';
// Side-effect imports register the providers in the voice registry AND
// expose the runner-factory setters / runner type aliases.
import { setPorcupineRunnerFactory, type PorcupineRunner } from '@metu/voice/porcupine';
import { setOpenWakeWordRunnerFactory, type OpenWakeWordRunner } from '@metu/voice/open-wake-word';

export interface UseWakeWordOpts {
  /** Persona-pinned wake word, e.g. `'hey-metu'`. Null disables. */
  word: string | null;
  costTier: CostTier;
  /** Workspace billing tier. Gates Porcupine to pro+. Defaults to 'free'. */
  billingTier?: BillingTier;
  /** Fires once per detection. */
  onWake: () => void;
  /** Optional gate (e.g. don't listen while voice session is active). */
  enabled?: boolean;
}

let runnersBootstrapped = false;
let hasPorcupine = false;
let hasOpenWakeWord = false;

function bootstrapRunners(): void {
  if (runnersBootstrapped) return;
  runnersBootstrapped = true;

  const accessKey = (import.meta.env.VITE_PORCUPINE_ACCESS_KEY as string | undefined) ?? '';
  if (accessKey) {
    setPorcupineRunnerFactory(() => makePorcupineRunner(accessKey));
    hasPorcupine = true;
  }

  const owwModelUrl = (import.meta.env.VITE_OPENWAKEWORD_MODEL_URL as string | undefined) ?? '';
  if (owwModelUrl) {
    setOpenWakeWordRunnerFactory(() => makeOpenWakeWordRunner(owwModelUrl));
    hasOpenWakeWord = true;
  }
}

/**
 * Dynamic import via runtime string so TypeScript doesn't try to resolve
 * the optional peer dep at typecheck time. The Vite + Tauri bundler
 * resolves it at runtime if installed; otherwise the import throws and
 * we fall through to the no-op handle.
 */
async function loadOptional(name: string): Promise<unknown> {
  // The `/* @vite-ignore */` comment tells Vite not to pre-bundle / warn
  // about the dynamic specifier.
  return import(/* @vite-ignore */ name);
}

function makePorcupineRunner(accessKey: string): PorcupineRunner {
  return async (model: string, onWake: () => void) => {
    try {
      const porcMod = (await loadOptional('@picovoice/porcupine-web')) as {
        PorcupineWorker: {
          create: (
            key: string,
            kw: unknown,
            cb: (detection: { label: string }) => void,
          ) => Promise<{ release: () => Promise<void> }>;
        };
        BuiltInKeyword: Record<string, unknown>;
      };
      const wvpMod = (await loadOptional('@picovoice/web-voice-processor')) as {
        WebVoiceProcessor: {
          subscribe: (s: unknown) => Promise<void>;
          unsubscribe: (s: unknown) => Promise<void>;
        };
      };

      // Resolve keyword: a built-in name (case-insensitive) OR a custom
      // .ppn file URL under /public/wake/.
      const builtIn = porcMod.BuiltInKeyword[toBuiltInName(model)];
      const keyword = builtIn
        ? { builtin: builtIn, sensitivity: 0.6 }
        : {
            label: model,
            publicPath: `/wake/${slugify(model)}.ppn`,
            sensitivity: 0.6,
          };

      const worker = await porcMod.PorcupineWorker.create(accessKey, keyword, () => onWake());

      await wvpMod.WebVoiceProcessor.subscribe(worker);

      const off: Off = () => {
        void (async () => {
          try {
            await wvpMod.WebVoiceProcessor.unsubscribe(worker);
            await worker.release();
          } catch {
            /* swallow teardown errors */
          }
        })();
      };
      return off;
    } catch (err) {
      console.warn('[wake] porcupine start failed', err);
      return () => {};
    }
  };
}

function makeOpenWakeWordRunner(modelUrl: string): OpenWakeWordRunner {
  return async (_model: string, onWake: () => void) => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    let stopped = false;

    try {
      const ort = (await loadOptional('onnxruntime-web')) as {
        InferenceSession: {
          create: (path: string) => Promise<{
            run: (
              feeds: Record<string, unknown>,
            ) => Promise<Record<string, { data: Float32Array }>>;
            inputNames: readonly string[];
            outputNames: readonly string[];
            release?: () => Promise<void>;
          }>;
        };
        Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
      };

      // Probe the model URL before lighting up the mic. If it 404s or
      // the runtime rejects it, we stay silent — the global hotkey
      // remains the canonical activation path.
      let session: Awaited<ReturnType<typeof ort.InferenceSession.create>>;
      try {
        session = await ort.InferenceSession.create(modelUrl);
      } catch (err) {
        console.warn('[wake] openWakeWord model load failed', modelUrl, err);
        return () => {};
      }

      // Expected model shape: input `[1, 16000]` Float32 (1 s mono @
      // 16 kHz), output `[1, 1]` Float32 score in `[0..1]`. End-to-end
      // keyword classifiers (Hello-Edge, lightweight CTC) match this.
      // Real openWakeWord pipelines that need the separate
      // melspec→embedding→classifier graphs should pre-compose the
      // three .onnx files into one bundle and expose this signature.
      const window16k = new Float32Array(16_000);
      const inputName = session.inputNames[0] ?? 'input';

      // Threshold + cooldown to suppress consecutive triggers.
      const THRESHOLD = 0.5;
      const COOLDOWN_MS = 1500;
      let lastFiredAt = 0;
      let inflight = false;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule('/wake-worklet.js');
      const src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'wake-processor');
      src.connect(node);

      node.port.onmessage = async (ev: MessageEvent<Float32Array>) => {
        if (stopped || inflight) return;
        const chunk = ev.data;
        // Slide window: shift left by chunk.length, append new samples.
        window16k.copyWithin(0, chunk.length);
        window16k.set(chunk, window16k.length - chunk.length);

        inflight = true;
        try {
          const tensor = new ort.Tensor('float32', window16k, [1, window16k.length]);
          const out = await session.run({ [inputName]: tensor });
          const firstKey = Object.keys(out)[0];
          const score = firstKey ? (out[firstKey]?.data[0] ?? 0) : 0;
          const now = Date.now();
          if (score >= THRESHOLD && now - lastFiredAt > COOLDOWN_MS) {
            lastFiredAt = now;
            onWake();
          }
        } catch (err) {
          console.warn('[wake] openWakeWord inference error', err);
        } finally {
          inflight = false;
        }
      };

      console.info('[wake] openWakeWord active', { modelUrl, sampleRate: 16000 });

      return () => {
        stopped = true;
        try {
          node?.disconnect();
          stream?.getTracks().forEach((t) => t.stop());
          void ctx?.close();
          void session.release?.();
        } catch {
          /* swallow teardown errors */
        }
      };
    } catch (err) {
      console.warn('[wake] openWakeWord start failed', err);
      try {
        node?.disconnect();
        stream?.getTracks().forEach((t) => t.stop());
        void ctx?.close();
      } catch {
        /* swallow */
      }
      return () => {};
    }
  };
}

function toBuiltInName(word: string): string {
  // 'hey-google' → 'HeyGoogle', 'jarvis' → 'Jarvis'
  return word
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function useWakeWord({
  word,
  costTier,
  billingTier,
  onWake,
  enabled = true,
}: UseWakeWordOpts): void {
  // Keep latest onWake without re-subscribing on every render.
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    if (!enabled || !word) return;
    bootstrapRunners();

    const chain = pickWakeRoute({
      word,
      costTier,
      billingTier,
      hasPorcupine,
      hasOpenWakeWord,
    });
    if (chain.length === 0) return;

    let cancelled = false;
    let off: Off | null = null;

    (async () => {
      for (const id of chain) {
        const provider = getWake(id);
        if (!provider) continue;
        try {
          const handle = await provider.start(word, () => onWakeRef.current());
          if (cancelled) {
            handle();
            return;
          }
          off = handle;
          return;
        } catch (err) {
          console.warn('[wake] provider failed, trying next', id, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      off?.();
    };
  }, [word, costTier, billingTier, enabled]);
}
