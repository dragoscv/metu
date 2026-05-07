'use client';
import { Button, Input, Select } from '@metu/ui';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteTargetAction, updateTargetAction } from '@/app/actions/goals';

export interface TargetEditData {
  id: string;
  title: string;
  unit: string;
  targetValue: number;
  period: string;
  aggregation: string;
  status: string;
  goalId: string | null;
}

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once';
type Aggregation = 'sum' | 'avg' | 'last' | 'max';
type Status = 'active' | 'paused' | 'achieved' | 'dropped';

export function TargetEditForm({
  target,
  goals,
}: {
  target: TargetEditData;
  goals: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(target.title);
  const [unit, setUnit] = useState(target.unit);
  const [tv, setTv] = useState(String(target.targetValue));
  const [period, setPeriod] = useState<Period>(target.period as Period);
  const [aggregation, setAggregation] = useState<Aggregation>(target.aggregation as Aggregation);
  const [status, setStatus] = useState<Status>(target.status as Status);
  const [goalId, setGoalId] = useState(target.goalId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingDelete, startDelete] = useTransition();

  const dirty =
    title !== target.title ||
    unit !== target.unit ||
    Number(tv) !== target.targetValue ||
    period !== target.period ||
    aggregation !== target.aggregation ||
    status !== target.status ||
    goalId !== (target.goalId ?? '');

  const save = () => {
    setError(null);
    const n = Number(tv);
    if (!Number.isFinite(n)) {
      setError('Target value must be a number');
      return;
    }
    startSave(async () => {
      const res = await updateTargetAction({
        id: target.id,
        title: title.trim(),
        unit,
        targetValue: n,
        period,
        aggregation,
        status,
        goalId: goalId || null,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm(`Delete "${target.title}"? Cannot be undone.`)) return;
    startDelete(async () => {
      const res = await deleteTargetAction(target.id);
      if (!res.ok) setError(res.error);
      else router.push('/goals#targets');
    });
  };

  return (
    <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Target #</label>
          <Input type="number" step="any" value={tv} onChange={(e) => setTv(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Unit</label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="RON, hr…" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Period</label>
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="once">Once</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Aggregation</label>
          <Select
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as Aggregation)}
          >
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="last">Last</option>
            <option value="max">Max</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="achieved">Achieved</option>
            <option value="dropped">Dropped</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Parent goal</label>
          <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">— None —</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </div>
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
          Save
        </Button>
      </div>
    </div>
  );
}
