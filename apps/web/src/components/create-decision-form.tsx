'use client';
import { Button, Input } from '@metu/ui';
import { Loader2, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { logDecisionAction } from '@/app/actions/project';

export function CreateDecisionForm({ projectId }: { projectId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setTitle('');
    setRationale('');
    setError(null);
    setOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !rationale.trim() || pending) return;
    start(async () => {
      const res = await logDecisionAction({
        title: title.trim(),
        rationale: rationale.trim(),
        ...(projectId ? { projectId } : {}),
        alternatives: [],
        metadata: {},
      });
      if (res.ok) reset();
      else setError(res.error);
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Log a decision
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3"
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Decision title (e.g. Use Drizzle over Prisma)"
        autoFocus
        disabled={pending}
      />
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Why? Trade-offs? Alternatives considered?"
        rows={3}
        disabled={pending}
        className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] disabled:opacity-50"
      />
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={!title.trim() || !rationale.trim() || pending}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Log decision
        </Button>
      </div>
    </form>
  );
}
