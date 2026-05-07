'use client';
import { Button, Input } from '@metu/ui';
import { motion } from 'framer-motion';
import { Loader2, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { deleteCheckinAction, recordCheckinAction } from '@/app/actions/goals';

export interface CheckinPoint {
  id: string;
  progress: number;
  note: string | null;
  occurredAt: string;
  createdBy: string;
}

export function GoalDetailClient({
  goalId,
  progress,
  checkins,
}: {
  goalId: string;
  progress: number;
  checkins: CheckinPoint[];
}) {
  const sorted = [...checkins].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const chartData = sorted.map((c) => ({
    t: new Date(c.occurredAt).getTime(),
    pct: Math.round(c.progress * 100),
    label: new Date(c.occurredAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Current progress
          </p>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {Math.round(progress * 100)}%
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 25 }}
              className="h-full rounded-full bg-[var(--color-brand)]"
            />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 md:col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Progress history · {sorted.length} check-ins
          </p>
          <div className="mt-2 h-32">
            {chartData.length < 2 ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                Record at least 2 check-ins to see the trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-fg-subtle)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="var(--color-fg-subtle)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${v}%`, 'Progress']}
                  />
                  <Line
                    type="monotone"
                    dataKey="pct"
                    stroke="var(--color-brand)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--color-brand)' }}
                    activeDot={{ r: 5 }}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <CheckinComposer goalId={goalId} initial={progress} />

      {sorted.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
            Recent check-ins
          </h2>
          <ul className="space-y-1">
            {[...sorted].reverse().map((c) => (
              <CheckinRow key={c.id} checkin={c} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CheckinComposer({ goalId, initial }: { goalId: string; initial: number }) {
  const [progress, setProgress] = useState(Math.round(initial * 100));
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    start(async () => {
      const res = await recordCheckinAction({
        goalId,
        progress: progress / 100,
        note: note.trim() || undefined,
      });
      if (res.ok) setNote('');
      else setError(res.error);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Quick check-in</label>
          <span className="text-sm font-semibold tabular-nums">{progress}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          className="w-full accent-[var(--color-brand)]"
        />
      </div>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What changed? (optional)"
      />
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save check-in
        </Button>
      </div>
    </form>
  );
}

function CheckinRow({ checkin }: { checkin: CheckinPoint }) {
  const [pending, start] = useTransition();

  const onDelete = () => {
    if (!confirm('Delete this check-in?')) return;
    start(async () => {
      await deleteCheckinAction(checkin.id);
    });
  };

  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-[var(--color-fg-muted)]">
          {Math.round(checkin.progress * 100)}%
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {new Date(checkin.occurredAt).toLocaleString()}
        </span>
        {checkin.createdBy === 'conductor' && (
          <span className="rounded bg-[var(--color-info-bg)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-info)]">
            auto
          </span>
        )}
        {checkin.note && (
          <span className="truncate text-[var(--color-fg-muted)]">— {checkin.note}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label="Delete check-in"
        className="text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}
