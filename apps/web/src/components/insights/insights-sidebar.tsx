'use client';
import { parseAsString, useQueryStates } from 'nuqs';

interface KindFacet {
  value: string;
  count: number;
}

/**
 * Per-source navigator for /insights. Each entry sets the `kind` query
 * param so the timeline filters in place without a page navigation
 * (nuqs `shallow:false` triggers an RSC re-render).
 */
export function InsightsSidebar({ facets }: { facets: KindFacet[] }) {
  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      kind: parseAsString.withDefault(''),
      importance: parseAsString.withDefault(''),
      range: parseAsString.withDefault('7d'),
    },
    { shallow: false },
  );

  // Group by source prefix (the first dotted segment after `device.`).
  const groups = new Map<string, KindFacet[]>();
  let totalAll = 0;
  for (const f of facets) {
    totalAll += f.count;
    const stripped = f.value.startsWith('device.') ? f.value.slice('device.'.length) : f.value;
    const head = stripped.split('.')[0] ?? 'other';
    const arr = groups.get(head) ?? [];
    arr.push(f);
    groups.set(head, arr);
  }

  const entries = Array.from(groups.entries())
    .map(([head, items]) => ({
      head,
      items: items.sort((a, b) => b.count - a.count),
      total: items.reduce((acc, x) => acc + x.count, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <nav aria-label="Filter by source" className="text-sm">
      <button
        type="button"
        onClick={() => void setFilters({ kind: null })}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--color-bg-elevated)] ${
          filters.kind === '' ? 'bg-[var(--color-bg-elevated)] font-medium' : ''
        }`}
      >
        <span>All sources</span>
        <span className="text-xs text-[var(--color-fg-subtle)]">{totalAll}</span>
      </button>
      <div className="mt-3 space-y-3">
        {entries.map(({ head, items, total }) => (
          <div key={head}>
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {head} <span className="font-mono normal-case opacity-60">· {total}</span>
            </div>
            <ul className="space-y-0.5">
              {items.map((k) => (
                <li key={k.value}>
                  <button
                    type="button"
                    onClick={() => void setFilters({ kind: k.value })}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition hover:bg-[var(--color-bg-elevated)] ${
                      filters.kind === k.value ? 'bg-[var(--color-bg-elevated)] font-medium' : ''
                    }`}
                    title={k.value}
                  >
                    <span className="truncate font-mono">{k.value}</span>
                    <span className="ml-2 text-[var(--color-fg-subtle)]">{k.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
