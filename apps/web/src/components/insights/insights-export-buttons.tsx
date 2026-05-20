'use client';
import { useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';

const BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-transparent px-3 text-sm text-[var(--color-fg)] transition-colors hover:bg-[var(--color-bg-elevated)]';

/**
 * InsightsExportButtons — preserves the current /insights filters (range,
 * kind, importance, q) and downloads CSV / JSON via /insights/export.
 */
export function InsightsExportButtons() {
  const sp = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of ['range', 'kind', 'importance', 'q']) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  function href(format: 'csv' | 'json') {
    const out = new URLSearchParams(qs);
    out.set('format', format);
    return `/insights/export?${out.toString()}`;
  }
  return (
    <div className="flex gap-2">
      <a className={BTN} href={href('csv')}>
        <Download className="h-3.5 w-3.5" /> CSV
      </a>
      <a className={BTN} href={href('json')}>
        <Download className="h-3.5 w-3.5" /> JSON
      </a>
    </div>
  );
}
