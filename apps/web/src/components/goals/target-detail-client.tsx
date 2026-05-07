'use client';
import { Button, Input } from '@metu/ui';
import { motion } from 'framer-motion';
import { Loader2, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { deleteTargetValueAction, recordTargetValueAction } from '@/app/actions/goals';

export interface TargetValuePoint {
  id: string;
  value: number;
  source: string;
  note: string | null;
  recordedAt: string;
}

export function TargetDetailClient({
  target,
  values,
}: {
  target: {
    id: string;
    unit: string;
    targetValue: number;
    currentValue: number;
    aggregation: string;
  };
  values: TargetValuePoint[];
}) {
  const sorted = [...values].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  // Build cumulative or rolling series based on aggregation
  let runningTotal = 0;
  const chartData = sorted.map((v) => {
    runningTotal += v.value;
    return {
      t: new Date(v.recordedAt).getTime(),
      label: new Date(v.recordedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      value: v.value,
      cumulative: runningTotal,
    };
  });

  const useCumulative = target.aggregation === 'sum';
  const dataKey = useCumulative ? 'cumulative' : 'value';

  const pct = target.targetValue
    ? Math.min(100, (target.currentValue / target.targetValue) * 100)
    : 0;
  const remaining = Math.max(0, target.targetValue - target.currentValue);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Current
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-semibold tabular-nums">
              {target.currentValue.toLocaleString()}
            </span>
            <span className="text-sm text-[var(--color-fg-subtle)]">
              / {target.targetValue.toLocaleString()} {target.unit}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 25 }}
              className="h-full rounded-full bg-[var(--color-brand)]"
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-fg-subtle)]">
            {pct.toFixed(0)}% · {remaining.toLocaleString()} {target.unit} to go
          </p>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 md:col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {useCumulative ? 'Cumulative progress' : 'Per-entry value'} · {sorted.length} entries
          </p>
          <div className="mt-2 h-40">
            {chartData.length < 2 ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                Record at least 2 entries to see the trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="targetFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-fg-subtle)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--color-fg-subtle)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v) => [
                      `${Number(v).toLocaleString()} ${target.unit}`,
                      useCumulative ? 'Total' : 'Value',
                    ]}
                  />
                  {useCumulative && target.targetValue > 0 && (
                    <ReferenceLine
                      y={target.targetValue}
                      stroke="var(--color-success)"
                      strokeDasharray="4 4"
                      label={{
                        value: 'target',
                        position: 'right',
                        fill: 'var(--color-success)',
                        fontSize: 10,
                      }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey={dataKey}
                    stroke="var(--color-brand)"
                    strokeWidth={2}
                    fill="url(#targetFill)"
                    isAnimationActive
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <RecordValueForm targetId={target.id} unit={target.unit} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
          Recent entries
        </h2>
        {sorted.length === 0 ? (
          <p className="text-sm italic text-[var(--color-fg-subtle)]">No entries yet.</p>
        ) : (
          <ul className="space-y-1">
            {[...sorted].reverse().map((v) => (
              <ValueRow key={v.id} value={v} unit={target.unit} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RecordValueForm({ targetId, unit }: { targetId: string; unit: string }) {
  const [val, setVal] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(val);
    if (!Number.isFinite(n) || pending) return;
    start(async () => {
      const res = await recordTargetValueAction({
        targetId,
        value: n,
        source: 'manual',
        note: note.trim() || undefined,
      });
      if (res.ok) {
        setVal('');
        setNote('');
      } else setError(res.error);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
    >
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Value {unit && `(${unit})`}
        </label>
        <Input
          type="number"
          step="any"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="h-9 w-32"
          autoFocus
        />
      </div>
      <div className="flex-1 space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Note (optional)
        </label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
      </div>
      <Button type="submit" size="sm" disabled={pending || !val || !Number.isFinite(Number(val))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Record
      </Button>
      {error && <p className="w-full text-xs text-[var(--color-danger)]">{error}</p>}
    </form>
  );
}

function ValueRow({ value, unit }: { value: TargetValuePoint; unit: string }) {
  const [pending, start] = useTransition();
  const onDelete = () => {
    if (!confirm('Delete this entry?')) return;
    start(async () => {
      await deleteTargetValueAction(value.id);
    });
  };
  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-mono tabular-nums">
          {value.value.toLocaleString()} {unit}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {new Date(value.recordedAt).toLocaleString()}
        </span>
        {value.source !== 'manual' && (
          <span className="rounded bg-[var(--color-info-bg)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-info)]">
            {value.source}
          </span>
        )}
        {value.note && (
          <span className="truncate text-[var(--color-fg-muted)]">— {value.note}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label="Delete entry"
        className="text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}
