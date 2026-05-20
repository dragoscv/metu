'use client';
import { Input, Select } from '@metu/ui';
import { Search } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';

export interface InsightsFilterFacets {
  kinds: { value: string; count: number }[];
  projects: { id: string; name: string }[];
}

const RANGE_OPTIONS = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

const IMPORTANCE_OPTIONS = [
  { value: '', label: 'Any importance' },
  { value: 'high', label: 'High (≥0.7)' },
  { value: 'medium', label: 'Medium (≥0.5)' },
  { value: 'low', label: 'Low (<0.5)' },
] as const;

export function InsightsFilters({ facets }: { facets: InsightsFilterFacets }) {
  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      kind: parseAsString.withDefault(''),
      importance: parseAsString.withDefault(''),
      range: parseAsString.withDefault('7d'),
      project: parseAsString.withDefault(''),
    },
    { shallow: false },
  );
  const [searchInput, setSearchInput] = useState(filters.q);

  useEffect(() => {
    if (searchInput === filters.q) return;
    const t = setTimeout(() => {
      void setFilters({ q: searchInput || null });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.q, setFilters]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search title or kind…"
          className="h-9 pl-9"
        />
      </div>
      <Select
        value={filters.kind}
        onChange={(e) => void setFilters({ kind: e.target.value || null })}
        className="h-9"
      >
        <option value="">All kinds</option>
        {facets.kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.value} ({k.count})
          </option>
        ))}
      </Select>
      <Select
        value={filters.importance}
        onChange={(e) => void setFilters({ importance: e.target.value || null })}
        className="h-9"
      >
        {IMPORTANCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select
        value={filters.range}
        onChange={(e) => void setFilters({ range: e.target.value })}
        className="h-9"
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {facets.projects.length > 0 ? (
        <Select
          value={filters.project}
          onChange={(e) => void setFilters({ project: e.target.value || null })}
          className="h-9"
        >
          <option value="">All projects</option>
          <option value="none">No project</option>
          {facets.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}
