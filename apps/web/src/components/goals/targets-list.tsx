'use client';
import { Badge, Button, EmptyState, Input, Select } from '@metu/ui';
import { motion } from 'framer-motion';
import { Loader2, Plus, Target as TargetIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { createTargetAction, recordTargetValueAction } from '@/app/actions/goals';

export interface TargetItem {
  id: string;
  goalId: string | null;
  title: string;
  unit: string;
  targetValue: number;
  currentValue: number;
  period: string;
  status: string;
  aggregation: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  achieved: 'neutral',
  dropped: 'danger',
};

export function TargetsList({
  targets,
  goals,
}: {
  targets: TargetItem[];
  goals: { id: string; title: string }[];
}) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-3">
      {showCreate && <NewTargetInline goals={goals} onDone={() => setShowCreate(false)} />}
      {targets.length === 0 ? (
        <EmptyState
          icon={<TargetIcon className="h-5 w-5" />}
          title="No targets yet"
          description="Targets are numeric KPIs (e.g. 10 deep work blocks per week)."
          action={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              New target
            </Button>
          }
        />
      ) : (
        <>
          {!showCreate && (
            <Button id="new-target" variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Add target
            </Button>
          )}
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {targets.map((t, i) => (
              <TargetCard key={t.id} target={t} index={i} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TargetCard({ target, index }: { target: TargetItem; index: number }) {
  const [value, setValue] = useState('');
  const [pending, start] = useTransition();
  const pct = target.targetValue
    ? Math.min(100, (target.currentValue / target.targetValue) * 100)
    : 0;
  const remaining = Math.max(0, target.targetValue - target.currentValue);

  const onAdd = () => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    start(async () => {
      await recordTargetValueAction({ targetId: target.id, value: n, source: 'manual' });
      setValue('');
    });
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
      layout
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/goals/targets/${target.id}`} className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold tracking-tight">{target.title}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
            {target.period} · {target.aggregation} · {target.unit || 'no unit'}
          </p>
        </Link>
        <Badge variant={STATUS_TONE[target.status] ?? 'neutral'} size="xs">
          {target.status}
        </Badge>
      </div>

      <div className="mt-3 flex items-baseline gap-1 font-mono">
        <span className="text-lg font-semibold tabular-nums">
          {target.currentValue.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--color-fg-subtle)]">
          / {target.targetValue.toLocaleString()} {target.unit}
        </span>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
          <span>{pct.toFixed(0)}%</span>
          <span>
            {remaining.toLocaleString()} {target.unit} to go
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 25 }}
            className="h-full rounded-full bg-[var(--color-brand)]"
          />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
        className="mt-3 flex items-center gap-2"
      >
        <Input
          type="number"
          step="any"
          value={value}
          placeholder="Add value"
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-28"
        />
        <Button
          type="submit"
          variant="subtle"
          size="sm"
          disabled={pending || !value || !Number.isFinite(Number(value))}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Record
        </Button>
      </form>
    </motion.li>
  );
}

function NewTargetInline({
  goals,
  onDone,
}: {
  goals: { id: string; title: string }[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [targetValueStr, setTargetValueStr] = useState('');
  const [period, setPeriod] = useState<
    'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once'
  >('monthly');
  const [aggregation, setAggregation] = useState<'sum' | 'avg' | 'last' | 'max'>('sum');
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(targetValueStr);
    if (!title.trim() || !Number.isFinite(n) || pending) return;
    start(async () => {
      const res = await createTargetAction({
        title: title.trim(),
        unit: unit.trim(),
        targetValue: n,
        period,
        aggregation,
        ...(goalId ? { goalId } : {}),
      });
      if (res.ok) {
        onDone();
      } else setError(res.error);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Target title (e.g. Weekly deep blocks)"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          type="number"
          step="any"
          value={targetValueStr}
          onChange={(e) => setTargetValueStr(e.target.value)}
          placeholder="Target #"
        />
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit (e.g. RON, hr)"
        />
        <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
          <option value="once">Once</option>
        </Select>
        <Select
          value={aggregation}
          onChange={(e) => setAggregation(e.target.value as typeof aggregation)}
        >
          <option value="sum">Sum</option>
          <option value="avg">Average</option>
          <option value="last">Last value</option>
          <option value="max">Max</option>
        </Select>
      </div>
      <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
        <option value="">— No parent goal —</option>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || !Number.isFinite(Number(targetValueStr)) || pending}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create target
        </Button>
      </div>
    </form>
  );
}
