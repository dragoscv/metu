'use client';
import { Button, SegmentedControl, Select } from '@metu/ui';
import { Loader2, Trash2, CheckCircle2, PauseCircle } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useTransition } from 'react';
import {
  bulkDeleteGoalsAction,
  bulkUpdateGoalStatusAction,
  reviewGoalsAction,
} from '@/app/actions/goals';

export interface GoalsToolbarProps {
  facets: {
    status: { value: string; count: number }[];
    drift: { value: string; count: number }[];
  };
  resultCount: number;
  selectedIds: string[];
  onClearSelection: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  achieved: 'Achieved',
  dropped: 'Dropped',
};
const DRIFT_LABELS: Record<string, string> = {
  on_track: 'On track',
  slipping: 'Slipping',
  stalled: 'Stalled',
};

export function GoalsToolbar({
  facets,
  resultCount,
  selectedIds,
  onClearSelection,
}: GoalsToolbarProps) {
  const [filters, setFilters] = useQueryStates(
    {
      status: parseAsString.withDefault(''),
      drift: parseAsString.withDefault(''),
      cadence: parseAsString.withDefault(''),
      sort: parseAsString.withDefault('weight'),
    },
    { shallow: false },
  );
  const [pendingBulk, startBulk] = useTransition();
  const [pendingReview, startReview] = useTransition();

  const totalAll = facets.status.reduce((s, f) => s + f.count, 0);
  const statusOptions = [
    { value: '', label: 'All', count: totalAll },
    ...['active', 'paused', 'achieved', 'dropped'].map((s) => ({
      value: s,
      label: STATUS_LABELS[s] ?? s,
      count: facets.status.find((f) => f.value === s)?.count ?? 0,
    })),
  ];

  const totalDrift = facets.drift.reduce((s, f) => s + f.count, 0);
  const driftOptions = [
    { value: '', label: 'Any', count: totalDrift },
    ...['on_track', 'slipping', 'stalled'].map((s) => ({
      value: s,
      label: DRIFT_LABELS[s] ?? s,
      count: facets.drift.find((f) => f.value === s)?.count ?? 0,
    })),
  ];

  const onBulk = (kind: 'archive' | 'pause' | 'delete') => {
    if (selectedIds.length === 0) return;
    if (kind === 'delete' && !confirm(`Delete ${selectedIds.length} goals? Cannot be undone.`))
      return;
    startBulk(async () => {
      if (kind === 'archive')
        await bulkUpdateGoalStatusAction({ ids: selectedIds, status: 'achieved' });
      else if (kind === 'pause')
        await bulkUpdateGoalStatusAction({ ids: selectedIds, status: 'paused' });
      else await bulkDeleteGoalsAction(selectedIds);
      onClearSelection();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Filter by status"
            value={filters.status}
            onChange={(v) => void setFilters({ status: v || null })}
            options={statusOptions}
            size="sm"
          />
          <SegmentedControl
            ariaLabel="Filter by drift"
            value={filters.drift}
            onChange={(v) => void setFilters({ drift: v || null })}
            options={driftOptions}
            size="sm"
          />
          <Select
            aria-label="Filter by cadence"
            value={filters.cadence}
            onChange={(e) => void setFilters({ cadence: e.target.value || null })}
            className="h-8 w-auto text-xs"
          >
            <option value="">All cadences</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="once">Once</option>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-fg-subtle)]">{resultCount} shown</span>
          <Select
            aria-label="Sort goals"
            value={filters.sort}
            onChange={(e) => void setFilters({ sort: e.target.value || null })}
            className="h-8 w-auto text-xs"
          >
            <option value="weight">Sort: Weight</option>
            <option value="progress">Sort: Progress</option>
            <option value="due">Sort: Due date</option>
            <option value="recent">Sort: Recently updated</option>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => startReview(async () => void (await reviewGoalsAction()))}
            disabled={pendingReview}
          >
            {pendingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Recompute drift
          </Button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="border-[var(--color-brand)]/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-[var(--color-brand-soft)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-brand)]">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onBulk('pause')}
              disabled={pendingBulk}
            >
              <PauseCircle className="h-4 w-4" />
              Pause
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onBulk('archive')}
              disabled={pendingBulk}
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark achieved
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => onBulk('delete')}
              disabled={pendingBulk}
            >
              {pendingBulk ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
