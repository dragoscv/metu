'use client';
/**
 * Persona import/export — JSON bundle download + paste-or-pick file upload.
 *
 * Export: triggers a browser download of `metu-personas-<timestamp>.json`
 * containing every workspace persona (built-in + custom).
 *
 * Import: accepts a JSON string (textarea) OR a `.json` file. On collision
 * the user picks Skip (keep existing) or Rename (insert with `-imported`
 * suffix). Built-ins are never overwritten.
 */
import { useRef, useState, useTransition } from 'react';
import { Button } from '@metu/ui';
import {
  exportPersonasAction,
  importPersonasAction,
  type ImportMode,
} from '@/app/actions/personas';

export function PersonaImportExport() {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ImportMode>('skip');
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    startTransition(async () => {
      const bundle = await exportPersonasAction();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `metu-personas-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${bundle.personas.length} persona(s).`);
    });
  };

  const handleImport = (raw: string) => {
    if (!raw.trim()) {
      setStatus('Paste JSON or pick a file first.');
      return;
    }
    startTransition(async () => {
      const res = await importPersonasAction(raw, mode);
      if (!res.ok) {
        setStatus(`Import failed: ${res.error}`);
        return;
      }
      setStatus(
        `Imported ${res.inserted} · skipped ${res.skipped} · renamed ${res.renamed}. Refresh to see the new rows.`,
      );
      setText('');
    });
  };

  const handleFile = async (file: File) => {
    const raw = await file.text();
    setText(raw);
    handleImport(raw);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleExport} disabled={pending} size="sm" variant="ghost">
          Download bundle
        </Button>
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          size="sm"
          variant="ghost"
        >
          Upload file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ImportMode)}
          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 text-xs"
        >
          <option value="skip">On collision: skip</option>
          <option value="rename">On collision: rename</option>
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"version":1,"personas":[…]} — paste a bundle here, or use Upload file.'
        rows={6}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2 font-mono text-xs"
      />
      <div className="flex items-center justify-between">
        <Button onClick={() => handleImport(text)} disabled={pending} size="sm">
          {pending ? 'Working…' : 'Import pasted JSON'}
        </Button>
        {status ? <span className="text-xs text-[var(--color-fg-subtle)]">{status}</span> : null}
      </div>
    </div>
  );
}
