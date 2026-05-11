'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { createCapture } from '@/app/actions/capture';

/**
 * Cmd/Ctrl+Shift+K — quick capture modal. Posts a `text` capture into the brain dump.
 *
 * Voice mode runs two paths in parallel for the best UX:
 *  - Web Speech API (when available) streams an interim transcript into
 *    the textarea so the user sees words as they speak.
 *  - MediaRecorder uploads the captured audio to /api/voice/transcribe
 *    once the user clicks stop. The Whisper response replaces the
 *    interim transcript as ground-truth (Whisper handles punctuation +
 *    accents better than the browser SR engine).
 *
 * Both paths fail-soft: if the mic is denied or the browser doesn't
 * support either API, the capture stays text-only.
 */
export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [pending, startTransition] = useTransition();
  const [recState, setRecState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Web Speech recognizer is constructor-typed (window.SpeechRecognition
  // or webkitSpeechRecognition); kept as `unknown` to dodge ambient
  // global types that aren't always present.
  const recogRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const interimRef = useRef('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isShortcut = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k';
      if (isShortcut) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    // Allow other components (e.g. CommandBar `/capture`) to open us with
    // optional pre-filled text.
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (detail?.text) setContent(detail.text);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('metu:quick-capture', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('metu:quick-capture', onOpen);
    };
  }, [open]);

  function submit() {
    const text = content.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await createCapture({ kind: 'text', content: text, source: 'web', metadata: {} });
      if (r.ok) {
        toast.success('Captured');
        setContent('');
        setOpen(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  async function startVoice() {
    if (recState !== 'idle') return;
    interimRef.current = content;
    chunksRef.current = [];

    // Path A — MediaRecorder for ground-truth transcript. Required.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Microphone permission denied.');
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size === 0) {
        setRecState('idle');
        return;
      }
      setRecState('transcribing');
      const fd = new FormData();
      fd.append('file', blob, 'recording.webm');
      try {
        const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; text?: string; error?: string }
          | null;
        if (res.ok && json?.text) {
          setContent(json.text);
        } else if (json?.error === 'openai_credential_missing') {
          toast.message('Voice fallback to live preview', {
            description:
              'Add your OpenAI key in /settings/byok to use server-side Whisper transcription.',
          });
        } else {
          toast.error('Transcription failed');
        }
      } catch {
        toast.error('Transcription failed');
      } finally {
        setRecState('idle');
      }
    };
    rec.start();
    recorderRef.current = rec;
    setRecState('recording');

    // Path B — live preview via Web Speech API. Optional (Chromium-only
    // in practice). Fails silent so non-supported browsers still get
    // the upload-side transcript.
    type SRConstructor = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void;
      onerror: () => void;
      start: () => void;
      stop: () => void;
      abort: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (SR) {
      try {
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = navigator.language || 'en-US';
        r.onresult = (ev) => {
          let interim = '';
          for (let i = 0; i < ev.results.length; i++) {
            interim += ev.results[i]![0]!.transcript + ' ';
          }
          setContent((interimRef.current ? interimRef.current + ' ' : '') + interim.trim());
        };
        r.onerror = () => undefined;
        r.start();
        recogRef.current = { stop: () => r.stop(), abort: () => r.abort() };
      } catch {
        // Browser refused (e.g. lacking permission policy) — ignore.
      }
    }
  }

  function stopVoice() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    recogRef.current?.stop();
    recogRef.current = null;
  }

  // Cleanup on unmount: kill any in-flight recorder.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        // Already stopped.
      }
      recogRef.current?.abort();
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/60 px-4 pt-32 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
                Quick capture
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
              }}
              placeholder="Drop a thought, link, or task. Cmd+Enter to save."
              className="h-32 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
            />
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-fg-subtle)]">
              <span>
                {recState === 'recording'
                  ? 'Recording… click mic to stop.'
                  : recState === 'transcribing'
                    ? 'Transcribing…'
                    : 'Tagged source: web · Routed to Brain dump'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={recState === 'recording' ? stopVoice : startVoice}
                  disabled={recState === 'transcribing' || pending}
                  title={recState === 'recording' ? 'Stop recording' : 'Voice capture'}
                  className={`rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)] disabled:opacity-50 ${
                    recState === 'recording' ? 'bg-rose-500/15 text-rose-300' : ''
                  }`}
                  aria-label={recState === 'recording' ? 'Stop recording' : 'Start voice capture'}
                >
                  {recState === 'recording' ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || !content.trim()}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-brand)] px-3 py-1 text-xs text-[var(--color-brand-fg)] disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Capture'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
