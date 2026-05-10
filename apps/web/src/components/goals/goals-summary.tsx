/**
 * Compact "this week" health summary at the top of /goals.
 *
 * Server-rendered. Uses only the in-memory goal rows we already
 * have to compute counts — zero extra DB hits.
 */
import { Card } from '@metu/ui';

export interface GoalsSummaryGoal {
  status: string | null;
  drift: string | null;
  progress: number;
  dueAt: string | null;
}

const ON_TRACK_DRIFT = new Set(['on_track', 'ahead']);

export function GoalsSummary({ goals }: { goals: GoalsSummaryGoal[] }) {
  const active = goals.filter((g) => g.status === 'active');
  const total = active.length;

  const onTrack = active.filter((g) => g.drift && ON_TRACK_DRIFT.has(g.drift)).length;
  const stalled = active.filter((g) => g.drift === 'stalled').length;
  const drifting = active.filter((g) => g.drift === 'drifting').length;
  const onTrackPct = total === 0 ? 0 : Math.round((onTrack / total) * 100);

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const dueThisWeek = active.filter((g) => {
    if (!g.dueAt) return false;
    const t = new Date(g.dueAt).getTime();
    return t > now && t - now <= sevenDaysMs;
  }).length;
  const overdue = active.filter((g) => {
    if (!g.dueAt) return false;
    return new Date(g.dueAt).getTime() < now && g.progress < 1;
  }).length;

  if (total === 0) return null;

  return (
    <Card className="mb-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="On track" value={`${onTrackPct}%`} hint={`${onTrack}/${total} active`} />
        <Stat
          label="Drifting"
          value={String(drifting)}
          hint={drifting === 0 ? 'all clear' : 'needs attention'}
          tone={drifting > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Stalled"
          value={String(stalled)}
          hint={stalled === 0 ? 'none' : 'needs revival'}
          tone={stalled > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Due this week"
          value={String(dueThisWeek)}
          hint={overdue > 0 ? `${overdue} overdue` : 'within 7d'}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-fg-subtle)]">
          <span>Health</span>
          <span>{onTrackPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
          <div
            className="h-full rounded-full bg-emerald-400/70 transition-[width]"
            style={{ width: `${onTrackPct}%` }}
            aria-hidden
          />
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : 'text-[var(--color-fg)]';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-xs text-[var(--color-fg-subtle)]">{hint}</div>
    </div>
  );
}
