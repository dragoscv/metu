'use client';

/**
 * StreakCard — one streak with stats, today-quick-log, and a 12-week heatmap.
 */
import { useTransition, useState } from 'react';
import { Flame, Plus, X, Trophy, Archive } from 'lucide-react';
import { Card } from '@metu/ui';
import { logStreakEntryAction, archiveStreakAction } from '@/app/actions/streaks';

export interface StreakStatsView {
  currentRun: number;
  longestRun: number;
  thisWeek: number;
  totalValue: number;
  lastEntryDay: string | null;
}

export interface StreakRow {
  id: string;
  name: string;
  body: string | null;
  kind: 'abstain' | 'do_daily' | 'count' | 'boolean';
  target: number | null;
  unit: string | null;
  color: string | null;
  weight: number;
  startedAt: string; // ISO
  archivedAt: string | null;
}

export interface StreakEntryRow {
  day: string; // YYYY-MM-DD
  value: number;
  failed: boolean;
  note: string | null;
}

const KIND_LABEL: Record<StreakRow['kind'], string> = {
  abstain: 'no',
  do_daily: 'daily',
  count: 'count',
  boolean: 'check-in',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function StreakCard({
  streak,
  entries,
  stats,
}: {
  streak: StreakRow;
  entries: StreakEntryRow[];
  stats: StreakStatsView;
}) {
  const [isPending, startTransition] = useTransition();
  const [showCount, setShowCount] = useState(false);
  const [countValue, setCountValue] = useState('');

  const today = todayKey();
  const todayEntry = entries.find((e) => e.day === today);

  const accent = streak.color ?? 'var(--color-brand)';

  function logToday(value?: number, failed?: boolean) {
    startTransition(async () => {
      await logStreakEntryAction({
        streakId: streak.id,
        day: today,
        value,
        failed,
        note: null,
      });
      setShowCount(false);
      setCountValue('');
    });
  }

  function archive() {
    if (!confirm(`Archive "${streak.name}"?`)) return;
    startTransition(async () => {
      await archiveStreakAction(streak.id);
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
              aria-hidden
            />
            <h3 className="truncate text-sm font-semibold text-[var(--color-fg)]">{streak.name}</h3>
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              {KIND_LABEL[streak.kind]}
            </span>
          </div>
          {streak.body ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">{streak.body}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={archive}
          className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
          aria-label="Archive streak"
          title="Archive"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-baseline gap-3">
        <div className="flex items-baseline gap-1">
          <Flame
            className="h-5 w-5"
            style={{ color: stats.currentRun > 0 ? accent : 'var(--color-muted)' }}
            aria-hidden
          />
          <span className="text-3xl font-semibold tabular-nums text-[var(--color-fg)]">
            {stats.currentRun}
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            {streak.kind === 'abstain' ? 'days clean' : 'day run'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
          <Trophy className="h-3 w-3" aria-hidden />
          best {stats.longestRun}
        </div>
      </div>

      <Heatmap entries={entries} accent={accent} kind={streak.kind} />

      <div className="flex flex-wrap items-center gap-2">
        {streak.kind === 'abstain' ? (
          todayEntry?.failed ? (
            <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-400">
              relapsed today
            </span>
          ) : (
            <button
              type="button"
              onClick={() => logToday(1, true)}
              disabled={isPending}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
            >
              Mark relapse
            </button>
          )
        ) : streak.kind === 'count' ? (
          showCount ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(countValue);
                if (!Number.isFinite(n) || n <= 0) return;
                logToday(n, false);
              }}
              className="flex items-center gap-1"
            >
              <input
                type="number"
                step="any"
                min="0"
                autoFocus
                value={countValue}
                onChange={(e) => setCountValue(e.target.value)}
                placeholder={streak.unit ?? 'value'}
                className="w-20 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs text-[var(--color-fg)]"
              />
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md px-2 py-1 text-xs text-[var(--color-fg)] hover:bg-[var(--color-bg-card)] disabled:opacity-50"
                style={{ background: accent, color: 'white' }}
              >
                Log
              </button>
              <button
                type="button"
                onClick={() => setShowCount(false)}
                className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-bg-card)]"
                aria-label="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowCount(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg)] hover:bg-[var(--color-bg-card)] disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> log {streak.unit ?? 'value'}
              {todayEntry ? (
                <span className="ml-1 text-[var(--color-muted)]">({todayEntry.value})</span>
              ) : null}
            </button>
          )
        ) : todayEntry ? (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-400">
            ✓ today
          </span>
        ) : (
          <button
            type="button"
            onClick={() => logToday(1, false)}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg)] hover:bg-[var(--color-bg-card)] disabled:opacity-50"
            style={{ borderColor: accent }}
          >
            <Plus className="h-3 w-3" /> mark today
          </button>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-[var(--color-muted)]">
          {stats.thisWeek}/7 this week
        </span>
      </div>
    </Card>
  );
}

function Heatmap({
  entries,
  accent,
  kind,
}: {
  entries: StreakEntryRow[];
  accent: string;
  kind: StreakRow['kind'];
}) {
  // 12 weeks (84 days) ending today, oldest -> newest
  const days: { day: string; value: number; failed: boolean }[] = [];
  const map = new Map(entries.map((e) => [e.day, e]));
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  for (let i = 83; i >= 0; i--) {
    const d = new Date(t);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const e = map.get(key);
    days.push({ day: key, value: e?.value ?? 0, failed: e?.failed ?? false });
  }
  // group into 12 columns of 7 days
  const cols: { day: string; value: number; failed: boolean }[][] = [];
  for (let c = 0; c < 12; c++) {
    cols.push(days.slice(c * 7, (c + 1) * 7));
  }
  return (
    <div className="flex gap-[2px]">
      {cols.map((week, ci) => (
        <div key={ci} className="flex flex-col gap-[2px]">
          {week.map((d) => {
            const filled = kind === 'abstain' ? !d.failed : d.value > 0;
            const isFail = kind === 'abstain' && d.failed;
            const intensity = kind === 'count' ? Math.min(1, d.value / 5) : filled ? 1 : 0;
            return (
              <div
                key={d.day}
                title={`${d.day} • ${isFail ? 'relapse' : d.value > 0 ? d.value : '—'}`}
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{
                  background: isFail
                    ? 'rgb(244 63 94 / 70%)'
                    : intensity > 0
                      ? `color-mix(in oklab, ${accent} ${20 + intensity * 70}%, transparent)`
                      : 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
