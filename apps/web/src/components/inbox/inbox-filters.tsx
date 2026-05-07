'use client';
import { Input, Select, SegmentedControl } from '@metu/ui';
import { Search, X } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';

export interface InboxFilterFacets {
  kinds: { value: string; count: number }[];
  statuses: { value: string; count: number }[];
  sources: { value: string; count: number }[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'received', label: 'Received' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
] as const;

export function InboxFilters({
  facets,
  totalCount,
}: {
  facets: InboxFilterFacets;
  totalCount: number;
}) {
  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      kind: parseAsString.withDefault(''),
      status: parseAsString.withDefault(''),
      source: parseAsString.withDefault(''),
    },
    { shallow: false },
  );
  const [searchInput, setSearchInput] = useState(filters.q);

  // Debounced sync
  useEffect(() => {
    if (searchInput === filters.q) return;
    const t = setTimeout(() => {
      void setFilters({ q: searchInput || null });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.q, setFilters]);

  const hasFilters = !!(filters.q || filters.kind || filters.status || filters.source);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search content or URLs…"
            className="h-9 pl-9"
          />
        </div>
        <Select
          aria-label="Filter by kind"
          value={filters.kind}
          onChange={(e) => void setFilters({ kind: e.target.value || null })}
          className="w-auto"
        >
          <option value="">All kinds</option>
          {facets.kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.value} ({k.count})
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by source"
          value={filters.source}
          onChange={(e) => void setFilters({ source: e.target.value || null })}
          className="w-auto"
        >
          <option value="">All sources</option>
          {facets.sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value} ({s.count})
            </option>
          ))}
        </Select>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              void setFilters({ q: null, kind: null, status: null, source: null });
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-2.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="Filter by status"
          size="sm"
          value={filters.status}
          onChange={(v) => void setFilters({ status: v || null })}
          options={STATUS_OPTIONS.map((o) => {
            const facet = facets.statuses.find((s) => s.value === o.value);
            return { value: o.value, label: o.label, count: facet?.count };
          })}
        />
        <span className="text-xs tabular-nums text-[var(--color-fg-subtle)]">
          {totalCount} {totalCount === 1 ? 'capture' : 'captures'}
        </span>
      </div>
    </div>
  );
}
