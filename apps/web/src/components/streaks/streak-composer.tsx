'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card } from '@metu/ui';
import { createStreakAction } from '@/app/actions/streaks';

const KINDS: {
  value: 'abstain' | 'do_daily' | 'count' | 'boolean';
  label: string;
  hint: string;
}[] = [
  { value: 'abstain', label: 'Abstain', hint: 'no smoking / no alcohol / no doomscroll' },
  { value: 'do_daily', label: 'Do daily', hint: 'walk / meditate / call mom' },
  { value: 'count', label: 'Count', hint: '12 pages today / 240 this week' },
  { value: 'boolean', label: 'Yes / No', hint: 'simple daily check' },
];

export function StreakComposer() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'abstain' | 'do_daily' | 'count' | 'boolean'>('do_daily');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName('');
    setBody('');
    setUnit('');
    setTarget('');
    setKind('do_daily');
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    startTransition(async () => {
      const res = await createStreakAction({
        name: name.trim(),
        body: body.trim() || undefined,
        kind,
        unit: kind === 'count' ? unit.trim() || undefined : undefined,
        target: kind === 'count' && target ? Number(target) : undefined,
        weight: 3,
      });
      if (res.ok) {
        reset();
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="default">
        <Plus className="h-4 w-4" /> New streak
      </Button>
    );
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                kind === k.value
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              <div className="text-sm font-medium text-[var(--color-fg)]">{k.label}</div>
              <div className="text-[10px] opacity-70">{k.hint}</div>
            </button>
          ))}
        </div>

        <input
          type="text"
          autoFocus
          placeholder="Name (e.g. no doomscroll, walk 30 min, pages read)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)]"
        />
        <input
          type="text"
          placeholder="Why this matters (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={500}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-xs text-[var(--color-fg)]"
        />

        {kind === 'count' ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="unit (pages, km, glasses)"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              maxLength={40}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-xs text-[var(--color-fg)]"
            />
            <input
              type="number"
              step="any"
              min="0"
              placeholder="daily target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-32 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-xs text-[var(--color-fg)]"
            />
          </div>
        ) : null}

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !name.trim()}>
            {isPending ? 'Creating…' : 'Create streak'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
