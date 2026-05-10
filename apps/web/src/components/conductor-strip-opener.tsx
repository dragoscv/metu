'use client';
/**
 * Client opener for the persistent Conductor strip — fires the same
 * `conductor:toggle` window event the keyboard shortcut uses, so the
 * existing drawer animates in without needing shared state.
 */
import { Sparkles } from 'lucide-react';

export function ConductorStripOpener({
  awaiting,
  recentLabel,
  spendLabel,
  spendPct,
}: {
  awaiting: number;
  recentLabel: string | null;
  spendLabel: string;
  spendPct: number;
}) {
  const tone = awaiting > 0 ? 'attention' : spendPct >= 0.8 ? 'warn' : 'idle';
  const dotColor =
    tone === 'attention' ? 'bg-amber-400' : tone === 'warn' ? 'bg-rose-400' : 'bg-emerald-400/80';

  // Single screen-reader summary in addition to the button's aria-label
  // so changes (awaiting count, spend) are announced politely.
  const srStatus =
    awaiting > 0
      ? `${awaiting} action${awaiting === 1 ? '' : 's'} awaiting approval. Spend ${spendLabel}.`
      : tone === 'warn'
        ? `Conductor idle. Spend high: ${spendLabel}.`
        : `Conductor idle. Spend ${spendLabel}.`;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('conductor:toggle'))}
      className="bg-[var(--color-bg-elevated)]/95 hover:border-[var(--color-brand)]/60 group pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--color-border)] px-4 py-2 text-xs shadow-lg backdrop-blur transition hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      aria-label="Open Conductor (Ctrl+J)"
    >
      <span className="sr-only" aria-live="polite">
        {srStatus}
      </span>
      <span className="flex items-center gap-2">
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`}>
          {tone === 'attention' ? (
            <span
              className={`absolute inset-0 -m-0.5 rounded-full ${dotColor} animate-ping opacity-75 motion-reduce:hidden`}
              aria-hidden
            />
          ) : null}
        </span>
        <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
        <span className="font-medium text-[var(--color-fg)]">Conductor</span>
      </span>
      <span aria-hidden className="text-[var(--color-fg-subtle)]">
        ·
      </span>
      {awaiting > 0 ? (
        <span className="font-medium text-amber-400">{awaiting} awaiting</span>
      ) : (
        <span className="text-[var(--color-fg-subtle)]">idle</span>
      )}
      {recentLabel ? (
        <>
          <span aria-hidden className="text-[var(--color-fg-subtle)]">
            ·
          </span>
          <span className="hidden truncate text-[var(--color-fg-subtle)] md:inline-block md:max-w-[24ch]">
            {recentLabel}
          </span>
        </>
      ) : null}
      <span aria-hidden className="text-[var(--color-fg-subtle)]">
        ·
      </span>
      <span className={spendPct >= 0.8 ? 'text-rose-300' : 'text-[var(--color-fg-subtle)]'}>
        {spendLabel}
      </span>
      <kbd className="group-hover:border-[var(--color-brand)]/40 ml-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-subtle)]">
        Ctrl+J
      </kbd>
    </button>
  );
}
