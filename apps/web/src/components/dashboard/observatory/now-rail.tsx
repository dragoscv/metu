'use client';
/**
 * NowRail — the always-visible top anchor on the observatory.
 *
 * Three blocks:
 *   1. Live wall-clock (HH:MM:SS, tabular-nums) + today's long date.
 *   2. "Time since you opened metu today" (per-tab, sessionStorage).
 *   3. Capture CTA (focuses the BrainDump).
 *
 * Anchoring rationale: ADHD-friendly orientation. The user always knows
 * NOW (clock), TODAY (long date), and HOW LONG (session anchor) before
 * any agency surface. Clock + anchor never blink, never tween — they
 * are the still point.
 */
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ActionSurface } from '@/lib/dashboard/types';
import { humanTimeSince } from '@/lib/dashboard/valence';

const SESSION_KEY = 'metu:dashboard:openedAt';

function readSessionAnchor(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const now = new Date().toISOString();
    sessionStorage.setItem(SESSION_KEY, now);
    return now;
  } catch {
    return new Date().toISOString();
  }
}

export interface NowRailProps {
  greetingName?: string;
  showSessionAnchor: boolean;
  /** When 'awareness', no CTA is rendered — pure observation mode. */
  actionSurface?: ActionSurface;
}

export function NowRail({
  greetingName,
  showSessionAnchor,
  actionSurface = 'capture',
}: NowRailProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [openedAt, setOpenedAt] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (showSessionAnchor) setOpenedAt(readSessionAnchor());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [showSessionAnchor]);

  // SSR-safe placeholder until first client tick.
  const clockText = now
    ? now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '--:--:--';
  const dateText = now
    ? now.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <header className="flex flex-wrap items-end justify-between gap-6 pb-2">
      <div className="space-y-1">
        <div
          className="font-mono text-5xl font-light tabular-nums tracking-tight text-[var(--color-fg)] sm:text-6xl"
          aria-label="current time"
        >
          {clockText}
        </div>
        <div className="text-sm text-[var(--color-fg-muted)]">
          {dateText}
          {greetingName && (
            <span className="text-[var(--color-fg-subtle)]"> — hi, {greetingName}.</span>
          )}
        </div>
        {showSessionAnchor && openedAt && (
          <div
            className="text-xs text-[var(--color-fg-subtle)]"
            title={`session opened at ${new Date(openedAt).toLocaleTimeString()}`}
          >
            you opened metu{' '}
            <span className="text-[var(--color-mist)]">{humanTimeSince(openedAt)}</span> ago
          </div>
        )}
      </div>

      <button
        type="button"
        hidden={actionSurface === 'awareness'}
        onClick={() => {
          // Smooth scroll to BrainDump if mounted, else fallback.
          const el = document.querySelector('[data-brain-dump]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el?.querySelector('textarea, input') as HTMLElement | null)?.focus();
        }}
        className="bg-[var(--color-bg-elevated)]/60 group inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-fg-muted)] backdrop-blur-md transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-fg)]"
      >
        <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
        capture
      </button>
      {actionSurface === 'awareness' && (
        <div className="text-xs italic text-[var(--color-fg-subtle)]">
          observation mode — no actions, just awareness.
        </div>
      )}
    </header>
  );
}
