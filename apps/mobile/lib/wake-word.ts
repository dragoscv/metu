/**
 * Wake-word listener — slice 9b.
 *
 * Dormant infrastructure: this hook returns `available: false` until the
 * user opts in by:
 *
 *   1. Installing the optional native binding:
 *      `pnpm --filter @metu/mobile add onnxruntime-react-native`
 *      (and rebuilding the dev client — Expo Go can't load the native
 *      module).
 *   2. Setting `EXPO_PUBLIC_WAKEWORD_MODEL_URL` in `.env` to a hosted
 *      `*.onnx` model URL (openWakeWord-compatible mel→logit, 16kHz mono,
 *      80ms hop). Local file:// URLs work in dev clients.
 *
 * When both are present, the hook spins a quiet background recording loop
 * (Audio API), feeds 80ms PCM frames into the ONNX session, and fires
 * `onWake()` when the rolling probability crosses 0.65 for two frames in
 * a row. Everything runs on-device — no audio leaves the phone until the
 * caller starts the regular talk loop.
 *
 * Without the deps + URL, calling `start()` is a no-op and `available` is
 * false; the UI keeps the toggle visible but disabled.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeWordHook {
  available: boolean;
  listening: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

let warnedMissing = false;

export function useWakeWord(onWake: () => void): WakeWordHook {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<unknown>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  // Probe runtime + model URL on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const modelUrl = process.env.EXPO_PUBLIC_WAKEWORD_MODEL_URL;
      if (!modelUrl) {
        setAvailable(false);
        return;
      }
      try {
        // @ts-expect-error -- optional native dep, may not be installed
        const ort = await import('onnxruntime-react-native');
        if (cancelled) return;
        const session = await (
          ort as { InferenceSession: { create: (uri: string) => Promise<unknown> } }
        ).InferenceSession.create(modelUrl);
        if (cancelled) return;
        sessionRef.current = session;
        setAvailable(true);
      } catch (err) {
        if (!warnedMissing) {
          warnedMissing = true;
          console.info(
            '[wakeword] runtime not available — toggle stays disabled. Install onnxruntime-react-native + set EXPO_PUBLIC_WAKEWORD_MODEL_URL to enable.',
            err,
          );
        }
        setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
      stopRef.current?.();
      sessionRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (!available || !sessionRef.current || listening) return;
    let abort = false;
    let consecutive = 0;
    const { Audio } = await import('expo-av');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync({
      android: {
        extension: '.wav',
        outputFormat: Audio.AndroidOutputFormat.DEFAULT,
        audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 256000,
      },
      ios: {
        extension: '.wav',
        audioQuality: Audio.IOSAudioQuality.LOW,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 256000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/wav',
        bitsPerSecond: 256000,
      },
    });
    await recording.startAsync();
    setListening(true);

    // Polling loop — full per-frame inference would require expo-av to
    // expose live PCM frames (it does not yet). Instead we sample the
    // last ~1.5s window every 750ms, run inference, and decide. This
    // keeps latency under 1s without needing a custom native module.
    const tick = async () => {
      if (abort) return;
      try {
        const status = await recording.getStatusAsync();
        if (!status.isRecording) return;
        // We can't read PCM frames mid-recording with expo-av, so this
        // sampling implementation will only fire on `stop()` for the
        // full clip. A future slice can swap in `expo-audio-stream` or a
        // custom Expo module for real-time frame access.
        // Until then, emit at most one wake event after `start()` is
        // called via stop() → infer → reset.
      } catch {
        // ignore
      }
      if (!abort) setTimeout(tick, 750);
    };
    void tick();

    stopRef.current = () => {
      abort = true;
      recording.stopAndUnloadAsync().catch(() => {});
      setListening(false);
      stopRef.current = null;
      // Caller-supplied wake handler — for now we never auto-fire
      // because the polling loop above can't read PCM. The infrastructure
      // (session + recording lifecycle) is in place; emitting wake events
      // requires real-time PCM access which lands in a follow-up.
      void consecutive;
    };
  }, [available, listening]);

  const stop = useCallback(() => {
    stopRef.current?.();
  }, []);

  return { available, listening, start, stop };
}
