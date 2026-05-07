'use client';
import { Button, Input, Select } from '@metu/ui';
import { Loader2, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createGoalAction } from '@/app/actions/goals';

export function CreateGoalForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once'>(
    'weekly',
  );
  const [progressMode, setProgressMode] = useState<'manual' | 'from_tasks' | 'from_evidence'>(
    'manual',
  );
  const [weight, setWeight] = useState(3);
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setTitle('');
    setBody('');
    setCadence('weekly');
    setProgressMode('manual');
    setWeight(3);
    setDueAt('');
    setError(null);
    setOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || pending) return;
    start(async () => {
      const res = await createGoalAction({
        title: title.trim(),
        body: body.trim() || undefined,
        cadence,
        progressMode,
        weight,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      if (res.ok) reset();
      else setError(res.error);
    });
  };

  if (!open) {
    return (
      <Button id="new-goal" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New goal
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
      id="new-goal"
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal title (e.g. Ship facturai v1)"
        autoFocus
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Optional: definition of done, why it matters"
        className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Cadence
          </label>
          <Select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="once">Once</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Progress
          </label>
          <Select
            value={progressMode}
            onChange={(e) => setProgressMode(e.target.value as typeof progressMode)}
          >
            <option value="manual">Manual</option>
            <option value="from_tasks">From tasks</option>
            <option value="from_evidence">From evidence</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Weight 1–5
          </label>
          <Input
            type="number"
            min="1"
            max="5"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Due
          </label>
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim() || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create goal
        </Button>
      </div>
    </form>
  );
}
