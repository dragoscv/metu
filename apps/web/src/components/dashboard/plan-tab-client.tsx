'use client';

import { Card, CardTitle, SegmentedControl } from '@metu/ui';
import { parseAsString, useQueryStates } from 'nuqs';
import { useMemo } from 'react';
import { NewPlanTaskInline } from './new-plan-task-inline';

interface OpenTask {
  id: string;
  title: string;
  kind: string;
  dueAt: Date | null;
  projectId: string | null;
}

interface BlockedTask {
  id: string;
  title: string;
  blockedReason: string | null;
}

const KIND_OPTIONS = [
  { value: '', label: 'All kinds' },
  { value: 'deep', label: 'Deep' },
  { value: 'shallow', label: 'Shallow' },
  { value: 'creative', label: 'Creative' },
  { value: 'maintenance', label: 'Maintenance' },
];

const DUE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'undated', label: 'Undated' },
];

export function PlanTabClient({
  openTasks,
  blocked,
}: {
  openTasks: OpenTask[];
  blocked: BlockedTask[];
}) {
  const [filters, setFilters] = useQueryStates(
    { kind: parseAsString.withDefault(''), due: parseAsString.withDefault('') },
    { shallow: false },
  );

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    return openTasks.filter((t) => {
      if (filters.kind && t.kind !== filters.kind) return false;
      if (filters.due) {
        const due = t.dueAt ? new Date(t.dueAt) : null;
        if (filters.due === 'overdue' && !(due && due < today)) return false;
        if (filters.due === 'today' && !(due && due >= today && due < tomorrow)) return false;
        if (filters.due === 'week' && !(due && due >= today && due < weekEnd)) return false;
        if (filters.due === 'undated' && due) return false;
      }
      return true;
    });
  }, [openTasks, filters.kind, filters.due]);

  const hasFilters = !!(filters.kind || filters.due);

  // Re-bucket the filtered tasks the same way the prior server-side code
  // did, so the visual rhythm of three columns is preserved.
  const buckets = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueToday = filtered.filter((t) => t.dueAt && new Date(t.dueAt) < tomorrow);
    const dueLater = filtered.filter((t) => t.dueAt && new Date(t.dueAt) >= tomorrow).slice(0, 10);
    const undated = filtered.filter((t) => !t.dueAt).slice(0, 10);
    return { dueToday, dueLater, undated };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NewPlanTaskInline />
        <SegmentedControl
          ariaLabel="Filter by kind"
          size="sm"
          value={filters.kind}
          onChange={(v) => void setFilters({ kind: v || null })}
          options={KIND_OPTIONS}
        />
        <SegmentedControl
          ariaLabel="Filter by due window"
          size="sm"
          value={filters.due}
          onChange={(v) => void setFilters({ due: v || null })}
          options={DUE_OPTIONS}
        />
        {hasFilters ? (
          <button
            type="button"
            onClick={() => void setFilters({ kind: null, due: null })}
            className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-[var(--color-fg-subtle)]">
          {filtered.length} of {openTasks.length} open
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <PlanColumn title="Due today" tasks={buckets.dueToday} accent="text-[var(--color-brand)]" />
        <PlanColumn title="Upcoming" tasks={buckets.dueLater} accent="text-[var(--color-fg)]" />
        <PlanColumn title="Undated" tasks={buckets.undated} accent="text-[var(--color-fg-muted)]" />
        {blocked.length > 0 && (
          <Card className="md:col-span-3">
            <CardTitle>Blocked</CardTitle>
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {blocked.map((t) => (
                <li
                  key={t.id}
                  className="rounded-md border border-[var(--color-border)] p-3 text-sm"
                >
                  <div className="font-medium">{t.title}</div>
                  {t.blockedReason && (
                    <div className="mt-1 text-xs text-[var(--color-fg-muted)]">
                      {t.blockedReason}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function PlanColumn({
  title,
  tasks,
  accent,
}: {
  title: string;
  tasks: OpenTask[];
  accent: string;
}) {
  return (
    <Card>
      <CardTitle className={accent}>{title}</CardTitle>
      <ul className="mt-3 space-y-2 text-sm">
        {tasks.length === 0 && <li className="text-[var(--color-fg-subtle)]">—</li>}
        {tasks.map((t) => (
          <li key={t.id} className="rounded-md border border-[var(--color-border)] px-3 py-2">
            <div className="truncate">{t.title}</div>
            {t.dueAt && (
              <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                {new Date(t.dueAt).toLocaleDateString()}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
