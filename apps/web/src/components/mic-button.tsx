'use client';
/**
 * Push-to-talk mic button.
 *
 * - Hold (mouse-down / touch-start / spacebar) to record.
 * - Release to upload the recorded blob to /api/voice/transcribe.
 * - On success, the transcript is appended to the parent input via
 *   `onTranscript`. The parent owns the textarea state.
 *
 * Uses MediaRecorder with WebM/Opus (browser default). No third-party
 * deps. Microphone permission is requested on the first hold; denial
 * shows a toast and the button stays usable for the next attempt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';

type RecorderState = 'idle' | 'requesting' | 'recording' | 'uploading';

export function MicButton({
  onTranscript,
  disabled,
  spaceHotkey = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** When true, holding spacebar (without focus inside an input) records. */
  spaceHotkey?: boolean;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') {
      cleanupStream();
      setState('idle');
      return;
    }
    setState('uploading');
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
      rec.stop();
    });
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    cleanupStream();
    if (blob.size < 1000) {
      // Sub-1KB usually means a fat-finger — silently drop instead of
      // burning a Whisper call on noise.
      setState('idle');
      return;
    }
    try {
      const form = new FormData();
      form.set('file', blob, 'recording.webm');
      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: form,
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !json.text) {
        toast.error(humanizeError(json.error));
      } else {
        onTranscript(json.text);
      }
    } catch {
      toast.error('Network error transcribing audio.');
    } finally {
      setState('idle');
    }
  }, [onTranscript]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = rec;
      rec.start();
      setState('recording');
    } catch (err) {
      cleanupStream();
      setState('idle');
      const msg = err instanceof Error ? err.message : 'unknown';
      toast.error(`Microphone unavailable: ${msg}`);
    }
  }, [state]);

  // Spacebar hold-to-talk. We ignore key events when focus is inside an
  // editable element so we don't intercept the user's typing.
  useEffect(() => {
    if (!spaceHotkey) return;
    const isTyping = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    let pressed = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isTyping(e.target)) return;
      pressed = true;
      e.preventDefault();
      void start();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pressed) return;
      pressed = false;
      e.preventDefault();
      void stop();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [spaceHotkey, start, stop]);

  // Defensive: stop on unmount so a hung recorder doesn't keep the mic
  // light on.
  useEffect(() => () => cleanupStream(), []);

  const isBusy = state === 'recording' || state === 'requesting' || state === 'uploading';
  const Icon = state === 'recording' ? MicOff : Mic;
  const label =
    state === 'recording'
      ? 'Recording — release to send'
      : state === 'uploading'
        ? 'Transcribing…'
        : state === 'requesting'
          ? 'Requesting mic…'
          : 'Hold to talk';

  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={state === 'recording'}
      aria-busy={state === 'uploading'}
      onMouseDown={(e) => {
        e.preventDefault();
        void start();
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        void stop();
      }}
      onMouseLeave={() => {
        if (state === 'recording') void stop();
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        void start();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        void stop();
      }}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-elevated)] ${
        state === 'recording'
          ? 'border-rose-400/60 bg-rose-500/10 text-rose-300 shadow-[0_0_0_4px_rgba(244,63,94,0.15)]'
          : 'hover:border-[var(--color-brand)]/60 border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
      } disabled:opacity-40`}
    >
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      <Icon
        className={`h-4 w-4 ${isBusy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        aria-hidden
      />
    </button>
  );
}

function humanizeError(code?: string): string {
  switch (code) {
    case 'openai_credential_missing':
      return 'Add an OpenAI key in Settings to use voice input.';
    case 'rate_limited':
      return 'Too many voice requests — slow down a moment.';
    case 'invalid_size':
      return 'Recording too long or empty.';
    default:
      return 'Voice transcription failed.';
  }
}
