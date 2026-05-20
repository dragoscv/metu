'use client';
import { Badge, Button, Input, SegmentedControl, Select } from '@metu/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs';
import { useMemo, useState } from 'react';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  killed: 'Killed',
};

const PROVIDER_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'notion', label: 'Notion' },
  { value: 'linear', label: 'Linear' },
  { value: 'slack', label: 'Slack' },
  { value: 'gdrive', label: 'Drive' },
  { value: 'figma', label: 'Figma' },
];

const ACTIVITY_OPTIONS = [
  { value: '', label: 'Anytime' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'stale', label: 'Stale (>30d)' },
];

const STRING_LIST = parseAsArrayOf(parseAsString).withDefault([]);

export function ProjectsToolbar({
  facets,
  resultCount,
  availableStack,
}: {
  facets: { status: string; count: number }[];
  resultCount: number;
  availableStack: string[];
}) {
  const [filters, setFilters] = useQueryStates(
    {
      status: parseAsString.withDefault(''),
      sort: parseAsString.withDefault('momentum'),
      q: parseAsString.withDefault(''),
      hasLink: parseAsString.withDefault(''),
      linkProviders: STRING_LIST,
      stack: STRING_LIST,
      lastActivity: parseAsString.withDefault(''),
      hasOpenTasks: parseAsString.withDefault(''),
      hasBlockedTasks: parseAsString.withDefault(''),
      hasGoal: parseAsString.withDefault(''),
    },
    { shallow: false },
  );

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const total = facets.reduce((s, f) => s + f.count, 0);
  const statusOptions = [
    { value: '', label: 'All', count: total },
    ...['active', 'paused', 'archived', 'killed'].map((s) => ({
      value: s,
      label: STATUS_LABEL[s] ?? s,
      count: facets.find((f) => f.status === s)?.count ?? 0,
    })),
  ];

  const activeAdvancedCount = useMemo(() => {
    let n = 0;
    if (filters.q) n++;
    if (filters.hasLink) n++;
    if (filters.linkProviders.length > 0) n++;
    if (filters.stack.length > 0) n++;
    if (filters.lastActivity) n++;
    if (filters.hasOpenTasks) n++;
    if (filters.hasBlockedTasks) n++;
    if (filters.hasGoal) n++;
    return n;
  }, [filters]);

  const toggleArr = (key: 'linkProviders' | 'stack', value: string) => {
    const cur = filters[key];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    void setFilters({ [key]: next.length ? next : null } as never);
  };

  const clearAll = () => {
    void setFilters({
      q: null,
      hasLink: null,
      linkProviders: null,
      stack: null,
      lastActivity: null,
      hasOpenTasks: null,
      hasBlockedTasks: null,
      hasGoal: null,
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="Filter projects by status"
          value={filters.status}
          onChange={(v) => void setFilters({ status: v || null })}
          options={statusOptions}
        />
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
            <Input
              value={filters.q}
              onChange={(e) => void setFilters({ q: e.target.value || null })}
              placeholder="Search… (press / to focus)"
              className="h-8 w-44 pl-7 text-xs"
              id="projects-search"
            />
          </div>
          <Button
            variant={activeAdvancedCount > 0 ? 'subtle' : 'ghost'}
            size="sm"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeAdvancedCount > 0 && (
              <Badge size="xs" variant="brand">
                {activeAdvancedCount}
              </Badge>
            )}
          </Button>
          <span className="text-xs text-[var(--color-fg-subtle)]">{resultCount}</span>
          <Select
            aria-label="Sort projects"
            value={filters.sort}
            onChange={(e) => void setFilters({ sort: e.target.value || null })}
            className="h-8 w-auto text-xs"
          >
            <option value="momentum">Momentum</option>
            <option value="recent">Recently updated</option>
            <option value="name">Name</option>
          </Select>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {advancedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
              <FilterRow label="Has links">
                <SegmentedControl
                  ariaLabel="Has links"
                  value={filters.hasLink}
                  onChange={(v) => void setFilters({ hasLink: v || null })}
                  options={[
                    { value: '', label: 'Any' },
                    { value: 'yes', label: 'With' },
                    { value: 'no', label: 'Without' },
                  ]}
                />
              </FilterRow>

              <FilterRow label="Link providers">
                <div className="flex flex-wrap gap-1">
                  {PROVIDER_OPTIONS.map((p) => (
                    <ChipToggle
                      key={p.value}
                      active={filters.linkProviders.includes(p.value)}
                      onClick={() => toggleArr('linkProviders', p.value)}
                    >
                      {p.label}
                    </ChipToggle>
                  ))}
                </div>
              </FilterRow>

              {availableStack.length > 0 && (
                <FilterRow label="Stack">
                  <div className="flex flex-wrap gap-1">
                    {availableStack.map((tag) => (
                      <ChipToggle
                        key={tag}
                        active={filters.stack.includes(tag)}
                        onClick={() => toggleArr('stack', tag)}
                      >
                        {tag}
                      </ChipToggle>
                    ))}
                  </div>
                </FilterRow>
              )}

              <FilterRow label="Last activity">
                <SegmentedControl
                  ariaLabel="Last activity"
                  value={filters.lastActivity}
                  onChange={(v) => void setFilters({ lastActivity: v || null })}
                  options={ACTIVITY_OPTIONS}
                />
              </FilterRow>

              <FilterRow label="Tasks & goals">
                <div className="flex flex-wrap gap-1">
                  <ChipToggle
                    active={filters.hasOpenTasks === 'yes'}
                    onClick={() =>
                      void setFilters({
                        hasOpenTasks: filters.hasOpenTasks === 'yes' ? null : 'yes',
                      })
                    }
                  >
                    Has open tasks
                  </ChipToggle>
                  <ChipToggle
                    active={filters.hasBlockedTasks === 'yes'}
                    onClick={() =>
                      void setFilters({
                        hasBlockedTasks: filters.hasBlockedTasks === 'yes' ? null : 'yes',
                      })
                    }
                  >
                    Has blocked tasks
                  </ChipToggle>
                  <ChipToggle
                    active={filters.hasGoal === 'yes'}
                    onClick={() =>
                      void setFilters({
                        hasGoal: filters.hasGoal === 'yes' ? null : 'yes',
                      })
                    }
                  >
                    Has goal
                  </ChipToggle>
                </div>
              </FilterRow>

              {activeAdvancedCount > 0 && (
                <div className="flex justify-end pt-1">
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    <X className="h-3.5 w-3.5" />
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-28 shrink-0 text-[var(--color-fg-muted)]">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ChipToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
      }`}
    >
      {children}
    </button>
  );
}
