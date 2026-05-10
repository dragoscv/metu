'use client';
import { Badge } from '@metu/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';
import { Sparkline, type SparklinePoint } from './sparkline';

export type Drift = 'on_track' | 'slipping' | 'stalled';

export interface GoalListItem {
  id: string;
  title: string;
  body: string | null;
  status: string;
  cadence: string;
  progressMode: string;
  progress: number;
  drift: Drift;
  weight: number;
  dueAt: string | null;
  lastProgressAt: string | null;
  parentGoalId: string | null;
  history: SparklinePoint[];
  pinned?: { tasks: number; projects: number; decisions: number };
}

const DRIFT_TONE: Record<Drift, 'success' | 'warning' | 'danger'> = {
  on_track: 'success',
  slipping: 'warning',
  stalled: 'danger',
};
const DRIFT_ICON: Record<Drift, typeof AlertTriangle> = {
  on_track: CheckCircle2,
  slipping: Clock,
  stalled: AlertTriangle,
};
const DRIFT_LABEL: Record<Drift, string> = {
  on_track: 'On track',
  slipping: 'Slipping',
  stalled: 'Stalled',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  achieved: 'neutral',
  dropped: 'danger',
};

export function GoalRow({
  goal,
  index = 0,
  selected,
  onToggleSelect,
  isSubGoal = false,
}: {
  goal: GoalListItem;
  index?: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  isSubGoal?: boolean;
}) {
  const DriftIcon = DRIFT_ICON[goal.drift];
  const pct = Math.round(goal.progress * 100);
  const overdue =
    goal.dueAt && new Date(goal.dueAt).getTime() < Date.now() && goal.status === 'active';

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
      layout
      className={isSubGoal ? 'ml-6' : ''}
    >
      <div
        className={`group relative flex items-stretch gap-3 rounded-xl border bg-[var(--color-bg-card)] p-3 transition ${
          selected
            ? 'border-[var(--color-brand)] shadow-sm'
            : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'
        }`}
      >
        <label className="flex items-start pt-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(goal.id)}
            className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
            aria-label={`Select ${goal.title}`}
          />
        </label>

        <Link href={`/goals/${goal.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {isSubGoal && (
                  <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    sub-goal ↳
                  </span>
                )}
                <h3 className="truncate text-sm font-semibold tracking-tight">{goal.title}</h3>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                {goal.cadence} · {goal.progressMode.replaceAll('_', ' ')} · w{goal.weight}
                {goal.dueAt && (
                  <>
                    {' · '}
                    <span className={overdue ? 'text-[var(--color-danger)]' : ''}>
                      due {new Date(goal.dueAt).toLocaleDateString()}
                    </span>
                  </>
                )}
                {goal.pinned &&
                  goal.pinned.tasks + goal.pinned.projects + goal.pinned.decisions > 0 && (
                    <>
                      {' · '}
                      {goal.pinned.tasks > 0 && (
                        <span className="mr-1.5">{goal.pinned.tasks}t</span>
                      )}
                      {goal.pinned.projects > 0 && (
                        <span className="mr-1.5">{goal.pinned.projects}p</span>
                      )}
                      {goal.pinned.decisions > 0 && <span>{goal.pinned.decisions}d</span>}
                    </>
                  )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {goal.status !== 'active' && (
                <Badge variant={STATUS_TONE[goal.status] ?? 'neutral'} size="xs">
                  {goal.status}
                </Badge>
              )}
              <Badge variant={DRIFT_TONE[goal.drift]} size="xs">
                <DriftIcon className="h-3 w-3" />
                {DRIFT_LABEL[goal.drift]}
              </Badge>
            </div>
          </div>

          {goal.body && (
            <p className="line-clamp-1 text-xs text-[var(--color-fg-muted)]">{goal.body}</p>
          )}

          <div className="grid grid-cols-[1fr_auto_120px] items-center gap-3">
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 25 }}
                  className="h-full rounded-full bg-[var(--color-brand)]"
                />
              </div>
            </div>
            <span className="text-xs tabular-nums text-[var(--color-fg-muted)]">{pct}%</span>
            <Sparkline data={goal.history} height={28} />
          </div>
        </Link>
      </div>
    </motion.li>
  );
}
