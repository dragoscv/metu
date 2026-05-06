'use client';
import { useState, useTransition } from 'react';
import { Mic, Send, StopCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button, Textarea } from '@metu/ui';
import { createCapture } from '@/app/actions/capture';

export function BrainDump() {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [pending, startTransition] = useTransition();
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  function submit() {
    if (!text.trim()) return;
    const value = text;
    setText('');
    startTransition(async () => {
      const res = await createCapture({
        kind: 'text',
        content: value,
        source: 'web',
        metadata: {},
      });
      if (res.ok) toast.success('Captured.');
      else toast.error(res.error ?? 'Failed to capture');
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await uploadVoice(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      r.start();
      setRecorder(r);
      setRecording(true);
    } catch {
      toast.error('Microphone permission denied');
    }
  }

  function stopRecording() {
    recorder?.stop();
    setRecorder(null);
    setRecording(false);
  }

  async function uploadVoice(blob: Blob) {
    const sig = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'audio/webm', kind: 'voice' }),
    }).then((r) => r.json());
    if (!sig.ok) {
      toast.error('Upload sign failed');
      return;
    }
    await fetch(sig.url, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: blob,
    });
    const res = await createCapture({
      kind: 'voice',
      storageKey: sig.storageKey,
      source: 'web',
      metadata: { mime: 'audio/webm', size: blob.size },
    });
    if (res.ok) toast.success('Voice note uploaded — transcribing…');
    else toast.error(res.error ?? 'Failed to capture');
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5"
    >
      <p className="mb-3 text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">
        Brain dump
      </p>
      <Textarea
        placeholder="Anything. An idea, a worry, a half-thought. metu will sort it."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
        rows={3}
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-[var(--color-fg-subtle)]">
          ⌘↵ to capture · ⌘K for command palette
        </p>
        <div className="flex gap-2">
          {!recording ? (
            <Button variant="ghost" size="sm" onClick={startRecording}>
              <Mic className="h-4 w-4" />
              Voice
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={stopRecording}>
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          )}
          <Button size="sm" onClick={submit} disabled={pending || !text.trim()}>
            <Send className="h-4 w-4" />
            Capture
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
