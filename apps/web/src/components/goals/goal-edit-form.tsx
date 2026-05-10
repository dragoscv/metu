'use client';
import { Button, Input, Select } from '@metu/ui';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteGoalAction, updateGoalAction } from '@/app/actions/goals';

export interface GoalEditData {
  id: string;
  title: string;
  body: string | null;
  status: string;
  cadence: string;
  progressMode: string;
  weight: number;
  dueAt: string | null;
}

function dateInputValue(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function GoalEditForm({ goal }: { goal: GoalEditData }) {
  const router = useRouter();
  const [title, setTitle] = useState(goal.title);
  const [body, setBody] = useState(goal.body ?? '');
  const [status, setStatus] = useState(goal.status);
  const [cadence, setCadence] = useState(goal.cadence);
  const [progressMode, setProgressMode] = useState(goal.progressMode);
  const [weight, setWeight] = useState(goal.weight);
  const [dueAt, setDueAt] = useState(dateInputValue(goal.dueAt));
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingDelete, startDelete] = useTransition();

  const dirty =
    title !== goal.title ||
    body !== (goal.body ?? '') ||
    status !== goal.status ||
    cadence !== goal.cadence ||
    progressMode !== goal.progressMode ||
    weight !== goal.weight ||
    dueAt !== dateInputValue(goal.dueAt);

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await updateGoalAction({
        id: goal.id,
        title: title.trim(),
        body: body.trim() || null,
        status: status as 'active' | 'paused' | 'achieved' | 'dropped',
        cadence: cadence as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once',
        progressMode: progressMode as
          | 'manual'
          | 'from_tasks'
          | 'from_projects'
          | 'from_decisions'
          | 'from_evidence',
        weight,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm(`Delete "${goal.title}"? This cannot be undone.`)) return;
    startDelete(async () => {
      const res = await deleteGoalAction(goal.id);
      if (!res.ok) setError(res.error);
      else router.push('/goals');
    });
  };

  return (
    <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          placeholder="Why this matters, definition of done…"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="achieved">Achieved</option>
            <option value="dropped">Dropped</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Cadence</label>
          <Select value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="once">Once</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Progress</label>
          <Select value={progressMode} onChange={(e) => setProgressMode(e.target.value)}>
            <option value="manual">Manual</option>
            <option value="from_tasks">From tasks</option>
            <option value="from_projects">From projects</option>
            <option value="from_decisions">From decisions</option>
            <option value="from_evidence">From evidence</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Weight</label>
          <Input
            type="number"
            min="1"
            max="5"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Due date</label>
        <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
        <Button variant="danger" size="sm" onClick={onDelete} disabled={pendingDelete}>
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Button onClick={save} disabled={!dirty || pendingSave || !title.trim()} size="sm">
          {pendingSave ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );
}
