'use client';
/**
 * URL-driven filter bar for the /audit page. Mirrors the Timeline
 * toolbar pattern: nuqs `useQueryStates` with `shallow: false` so the
 * server component re-renders with new filters.
 */
import { useState } from 'react';
import { Button, Input, Select } from '@metu/ui';
import { ChevronDown, Download, Filter, X } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';

interface Props {
  toolFacets: { tool: string; count: number }[];
  statusFacets: { status: string; count: number }[];
  runKindFacets: { kind: string; count: number }[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  undone: 'Undone',
  cancelled: 'Cancelled',
};

interface Preset {
  label: string;
  tools?: string[];
  statuses?: string[];
  q?: string;
}

// Presets surface common views without forcing the user through the
// facet menus. `q` matches `tool LIKE %q%` — so 'billing' catches every
// `billing.*` and `subscription.*` tool the OAuth + Stripe code emits.
const PRESETS: Preset[] = [
  { label: 'Billing & Stripe', q: 'billing' },
  { label: 'Awaiting approval', statuses: ['awaiting_approval'] },
  { label: 'Failures', statuses: ['failed'] },
  { label: 'Conductor escalations', q: 'conductor' },
];

function arraysEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function AuditToolbar({ toolFacets, statusFacets, runKindFacets }: Props) {
  const [filters, setFilters] = useQueryStates(
    {
      tools: parseAsString.withDefault(''),
      statuses: parseAsString.withDefault(''),
      kinds: parseAsString.withDefault(''),
      since: parseAsString.withDefault(''),
      q: parseAsString.withDefault(''),
    },
    { shallow: false },
  );

  const selectedTools = filters.tools ? filters.tools.split(',').filter(Boolean) : [];
  const selectedStatuses = filters.statuses ? filters.statuses.split(',').filter(Boolean) : [];
  const selectedKinds = filters.kinds ? filters.kinds.split(',').filter(Boolean) : [];
  const [toolOpen, setToolOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);

  const toggleTool = (t: string) => {
    const next = selectedTools.includes(t)
      ? selectedTools.filter((x) => x !== t)
      : [...selectedTools, t];
    setFilters({ tools: next.join(',') });
  };

  const toggleStatus = (s: string) => {
    const next = selectedStatuses.includes(s)
      ? selectedStatuses.filter((x) => x !== s)
      : [...selectedStatuses, s];
    setFilters({ statuses: next.join(',') });
  };

  const toggleKind = (k: string) => {
    const next = selectedKinds.includes(k)
      ? selectedKinds.filter((x) => x !== k)
      : [...selectedKinds, k];
    setFilters({ kinds: next.join(',') });
  };

  const clearAll = () => setFilters({ tools: '', statuses: '', kinds: '', since: '', q: '' });

  const applyPreset = (p: { tools?: string[]; statuses?: string[]; q?: string }) => {
    setFilters({
      tools: (p.tools ?? []).join(','),
      statuses: (p.statuses ?? []).join(','),
      q: p.q ?? '',
    });
  };

  const hasFilters =
    selectedTools.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedKinds.length > 0 ||
    !!filters.since ||
    !!filters.q;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Presets
        </span>
        {PRESETS.map((p) => {
          const isActive =
            arraysEq(p.tools ?? [], selectedTools) &&
            arraysEq(p.statuses ?? [], selectedStatuses) &&
            (p.q ?? '') === filters.q;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] transition ${
                isActive
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-elevated)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tool or error…"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          className="h-9 w-64"
        />

        <FacetMenu
          label="Tool"
          icon={Filter}
          open={toolOpen}
          setOpen={setToolOpen}
          selected={selectedTools}
          options={toolFacets.map((f) => ({ value: f.tool, label: f.tool, count: f.count }))}
          onToggle={toggleTool}
          emptyText="No tool calls yet."
        />

        <FacetMenu
          label="Status"
          icon={Filter}
          open={statusOpen}
          setOpen={setStatusOpen}
          selected={selectedStatuses}
          options={statusFacets.map((f) => ({
            value: f.status,
            label: STATUS_LABELS[f.status] ?? f.status,
            count: f.count,
          }))}
          onToggle={toggleStatus}
          emptyText="No statuses observed."
        />

        <FacetMenu
          label="Source"
          icon={Filter}
          open={kindOpen}
          setOpen={setKindOpen}
          selected={selectedKinds}
          options={runKindFacets.map((f) => ({ value: f.kind, label: f.kind, count: f.count }))}
          onToggle={toggleKind}
          emptyText="No agent runs observed."
        />

        <Select
          value={filters.since}
          onChange={(e) => setFilters({ since: e.target.value })}
          className="h-9 w-36"
        >
          <option value="">Last 7 days</option>
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

        <a
          href={(() => {
            const qs = new URLSearchParams();
            if (selectedTools.length > 0) qs.set('tools', selectedTools.join(','));
            if (selectedStatuses.length > 0) qs.set('statuses', selectedStatuses.join(','));
            if (selectedKinds.length > 0) qs.set('kinds', selectedKinds.join(','));
            if (filters.since) qs.set('since', filters.since);
            if (filters.q) qs.set('q', filters.q);
            const s = qs.toString();
            return s ? `/api/audit/export?${s}` : '/api/audit/export';
          })()}
          download
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
          title="Download the matching tool calls as CSV (max 50k rows)"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </div>
    </div>
  );
}

function FacetMenu({
  label,
  icon: Icon,
  open,
  setOpen,
  selected,
  options,
  onToggle,
  emptyText,
}: {
  label: string;
  icon: typeof Filter;
  open: boolean;
  setOpen: (v: boolean) => void;
  selected: string[];
  options: { value: string; label: string; count: number }[];
  onToggle: (v: string) => void;
  emptyText: string;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        {selected.length > 0 && (
          <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] text-white">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1 shadow-lg">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--color-fg-subtle)]">{emptyText}</p>
            ) : (
              options.map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-bg-elevated)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(o.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 truncate font-mono text-xs">{o.label}</span>
                    <span className="text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
                      {o.count}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
