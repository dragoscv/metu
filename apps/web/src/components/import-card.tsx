'use client';

/**
 * Takeout import card — uploads a `/api/workspace/export` NDJSON file and
 * shows a per-table import/skip summary. Insert-only, dedupe-by-content.
 */
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardTitle } from '@metu/ui';
import { importTakeoutAction } from '@/app/actions/takeout-import';

export function ImportCard() {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<Record<
    string,
    { imported: number; skipped: number }
  > | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) {
      toast.error('Choose an export file first');
      return;
    }
    startTransition(async () => {
      const res = await importTakeoutAction(fd);
      if (res.ok) {
        setSummary(res.summary);
        const total = Object.values(res.summary).reduce((n, s) => n + s.imported, 0);
        toast.success(`Imported ${total} rows`);
        form.reset();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Card className="space-y-3 p-5">
      <CardTitle>Import takeout</CardTitle>
      <p className="text-sm text-[var(--color-fg-subtle)]">
        Restore projects, captures, tasks, decisions, goals, and timeline events from a workspace
        export (.ndjson). Existing data is never modified — duplicates are skipped.
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".ndjson,.json,.jsonl,text/plain"
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--color-border)] file:bg-[var(--color-bg-muted)] file:px-3 file:py-1.5 file:text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-bg-subtle)] disabled:opacity-50"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </form>
      {summary ? (
        <ul className="space-y-0.5 text-xs text-[var(--color-fg-subtle)]">
          {Object.entries(summary).map(([table, s]) => (
            <li key={table}>
              {table}: {s.imported} imported, {s.skipped} skipped
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
