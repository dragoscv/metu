'use client';
import { Button, Input, Select } from '@metu/ui';
import { ChevronDown, Filter, X } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { kindMeta } from './kind-meta';

interface Props {
  kindFacets: { kind: string; count: number }[];
  projects: { id: string; name: string }[];
}

export function TimelineToolbar({ kindFacets, projects }: Props) {
  const [filters, setFilters] = useQueryStates(
    {
      kinds: parseAsString.withDefault(''),
      projectId: parseAsString.withDefault(''),
      since: parseAsString.withDefault(''),
      q: parseAsString.withDefault(''),
    },
    { shallow: false },
  );

  const selectedKinds = filters.kinds ? filters.kinds.split(',').filter(Boolean) : [];
  const [kindOpen, setKindOpen] = useState(false);

  const toggleKind = (k: string) => {
    const next = selectedKinds.includes(k)
      ? selectedKinds.filter((x) => x !== k)
      : [...selectedKinds, k];
    setFilters({ kinds: next.join(',') });
  };

  const clearAll = () => {
    setFilters({ kinds: '', projectId: '', since: '', q: '' });
  };

  const hasFilters =
    selectedKinds.length > 0 || !!filters.projectId || !!filters.since || !!filters.q;

  const PRESETS: { label: string; kinds: string[] }[] = [
    {
      label: 'Conductor escalations',
      kinds: ['conductor.escalation.completed', 'conductor.observation', 'intent.received'],
    },
    {
      label: 'Billing',
      kinds: ['subscription.activated', 'subscription.updated', 'subscription.canceled'],
    },
    {
      label: 'Decisions',
      kinds: ['decision.logged'],
    },
  ];

  const applyPreset = (kinds: string[]) => {
    setFilters({ kinds: kinds.join(',') });
  };

  const presetActive = (kinds: string[]) =>
    kinds.length === selectedKinds.length && kinds.every((k) => selectedKinds.includes(k));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => {
          const active = presetActive(p.kinds);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.kinds)}
              className={
                active
                  ? 'bg-[var(--color-brand)]/15 rounded-full border border-[var(--color-brand)] px-2.5 py-0.5 text-xs text-[var(--color-brand)]'
                  : 'rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2.5 py-0.5 text-xs hover:bg-[var(--color-bg-elevated)]'
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="timeline-search"
          placeholder="Search title or body…  (press / to focus)"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          className="h-9 w-64"
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setKindOpen((o) => !o)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
          >
            <Filter className="h-3.5 w-3.5" />
            Kind
            {selectedKinds.length > 0 && (
              <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] text-white">
                {selectedKinds.length}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
          {kindOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setKindOpen(false)} aria-hidden />
              <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1 shadow-lg">
                {kindFacets.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-[var(--color-fg-subtle)]">No events yet.</p>
                ) : (
                  kindFacets.map((f) => {
                    const m = kindMeta(f.kind);
                    const checked = selectedKinds.includes(f.kind);
                    return (
                      <label
                        key={f.kind}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-bg-elevated)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKind(f.kind)}
                          className="h-3.5 w-3.5"
                        />
                        <m.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="flex-1 truncate">{m.label}</span>
                        <span className="text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
                          {f.count}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <Select
          value={filters.projectId}
          onChange={(e) => setFilters({ projectId: e.target.value })}
          className="h-9 w-44"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <Select
          value={filters.since}
          onChange={(e) => setFilters({ since: e.target.value })}
          className="h-9 w-36"
        >
          <option value="">All time</option>
          <option value="1d">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {selectedKinds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedKinds.map((k) => {
            const m = kindMeta(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5 text-xs hover:bg-[var(--color-bg-elevated)]"
              >
                <m.icon className="h-3 w-3" />
                {m.label}
                <X className="h-3 w-3 opacity-60" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
