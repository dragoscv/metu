/**
 * Voice capture — press the button to start recording mic audio,
 * press again to stop. On stop:
 *   1. POST the webm/opus blob to /api/sdk/v1/presence/transcribe
 *      (bearer auth, Deepgram STT) → returns { text }.
 *   2. POST the transcript to /api/sdk/v1/capture as a `text` capture
 *      with `source: 'companion-voice'` so it joins the normal capture
 *      pipeline (timeline event + conductor/observe).
 *
 * No GCS upload — Deepgram streams directly. Single utterance, ≤10MB.
 */
import { useCallback, useRef, useState } from 'react';
import { createClient } from '@metu/sdk';
import type { AuthState } from './auth';

export type VoiceCaptureStatus = 'idle' | 'recording' | 'transcribing' | 'capturing' | 'error';

export interface VoiceCaptureState {
  status: VoiceCaptureStatus;
  lastTranscript: string | null;
  lastError: string | null;
  /** Capture id of the most recent successful save — usable for undo. */
  lastCaptureId: string | null;
  /** Up to 5 most recent transcripts (newest first), in-memory for the current session. */
  recentTranscripts: Array<{ id: string; text: string; at: string }>;
  toggle: () => Promise<void>;
  undoLast: () => Promise<void>;
  /** Clear the recent transcripts list (does not delete captures). */
  clearRecent: () => void;
}

export function useVoiceCapture(auth: AuthState | null): VoiceCaptureState {
  const [status, setStatus] = useState<VoiceCaptureStatus>('idle');
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastCaptureId, setLastCaptureId] = useState<string | null>(null);
  const [recentTranscripts, setRecentTranscripts] = useState<
    Array<{ id: string; text: string; at: string }>
  >([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopAndProcess = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    const blob: Blob = await new Promise((resolve) => {
      rec.addEventListener(
        'stop',
        () => {
          resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
        },
        { once: true },
      );
      rec.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
    if (!auth || blob.size === 0) {
      setStatus('idle');
      return;
    }
    try {
      setStatus('transcribing');
      const form = new FormData();
      form.append('audio', blob, 'capture.webm');
      const res = await fetch(`${auth.apiBase.replace(/\/$/, '')}/api/sdk/v1/presence/transcribe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.accessToken}` },
        body: form,
      });
      if (!res.ok) throw new Error(`transcribe_failed_${res.status}`);
      const json = (await res.json()) as { text?: string };
      const text = (json.text ?? '').trim();
      if (!text) {
        setLastTranscript('');
        setStatus('idle');
        return;
      }
      setLastTranscript(text);
      setStatus('capturing');
      const client = createClient({
        baseUrl: auth.apiBase,
        auth: { kind: 'token', accessToken: auth.accessToken },
      });
      const captured = await client.capture({
        kind: 'text',
        content: text,
        source: 'companion-voice',
        metadata: { capturedAt: new Date().toISOString() },
      });
      // SDK return shape is { ok, id } — id is the capture row id we
      // can DELETE through /api/sdk/v1/capture/[id].
      const captureId = (captured as { id?: string } | null)?.id ?? null;
      setLastCaptureId(captureId);
      if (captureId) {
        setRecentTranscripts((prev) =>
          [{ id: captureId, text, at: new Date().toISOString() }, ...prev].slice(0, 5),
        );
      }
      setStatus('idle');
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'voice_capture_failed');
      setStatus('error');
    }
  }, [auth]);

  const toggle = useCallback(async () => {
    if (status === 'recording') {
      await stopAndProcess();
      return;
    }
    if (status !== 'idle' && status !== 'error') return;
    setLastError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      });
      rec.start();
      recRef.current = rec;
      setStatus('recording');
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'mic_permission_denied');
      setStatus('error');
    }
  }, [status, stopAndProcess]);

  const undoLast = useCallback(async () => {
    if (!auth || !lastCaptureId) return;
    const id = lastCaptureId;
    setLastCaptureId(null);
    try {
      await fetch(`${auth.apiBase}/api/sdk/v1/capture/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      });
      setLastTranscript(null);
      setRecentTranscripts((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'undo_failed');
    }
  }, [auth, lastCaptureId]);

  return {
    status,
    lastTranscript,
    lastError,
    lastCaptureId,
    recentTranscripts,
    toggle,
    undoLast,
    clearRecent: () => setRecentTranscripts([]),
  };
}
