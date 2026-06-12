'use client';

/**
 * AI week-in-review narrative block. Loads (cached) on mount; offers a
 * regenerate button. Renders nothing while the workspace is silent or
 * when no BYOK model is configured (fail-soft).
 */
import { useEffect, useState, useTransition } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardTitle } from '@metu/ui';
import { generateReviewNarrativeAction } from '@/app/actions/review-narrative';

export function ReviewNarrative({ windowDays }: { windowDays: 7 | 14 | 30 }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'unavailable'>('loading');
  const [pending, startTransition] = useTransition();

  function load(force: boolean) {
    startTransition(async () => {
      const res = await generateReviewNarrativeAction({ windowDays, force });
      if (res.ok && res.narrative) {
        setNarrative(res.narrative);
        setGeneratedAt(res.generatedAt ?? null);
        setState('ready');
      } else if (res.ok) {
        setState('empty');
      } else {
        setState('unavailable');
      }
    });
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-load per window change only
  }, [windowDays]);

  if (state === 'empty' || state === 'unavailable') return null;

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
          The story of your week
        </CardTitle>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={pending}
          aria-label="Regenerate narrative"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${pending ? 'animate-spin' : ''}`} />
          Regenerate
        </button>
      </div>
      {state === 'loading' ? (
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-[var(--color-bg-muted)]" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--color-bg-muted)]" />
          <div className="h-3 w-4/6 animate-pulse rounded bg-[var(--color-bg-muted)]" />
        </div>
      ) : (
        <>
          <div className="space-y-2 text-sm leading-relaxed text-[var(--color-fg)]">
            {narrative?.split(/\n{2,}|\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {generatedAt ? (
            <p className="text-[10px] text-[var(--color-fg-subtle)]">
              Generated {new Date(generatedAt).toLocaleString()}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
