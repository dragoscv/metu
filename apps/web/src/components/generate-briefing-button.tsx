'use client';
/**
 * Two cinematic buttons that call the briefing-generate server actions and
 * surface the result inline. Uses `useTransition` for the optimistic state
 * and framer-motion for the "writing…" → "written" reveal.
 */
import { useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { regenerateWorkspaceBriefingAction } from '@/app/actions/resume';

export function GenerateBriefingButton({
  className = '',
  variant = 'primary',
}: {
  className?: string;
  variant?: 'primary' | 'ghost';
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    start(async () => {
      const r = await regenerateWorkspaceBriefingAction();
      if (r.ok) setResult(r.briefing);
      else setError(r.error);
    });
  }

  const base =
    variant === 'primary'
      ? 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50'
      : 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-overlay)] disabled:opacity-50';

  return (
    <div className={className}>
      <button type="button" disabled={pending} onClick={onClick} className={base}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : result ? (
          <RefreshCw className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {pending ? 'Writing…' : result ? 'Regenerate' : 'Generate fresh briefing'}
      </button>
      <AnimatePresence>
        {result ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="border-[var(--color-brand)]/30 mt-4 rounded-lg border bg-[var(--color-bg-elevated)] p-4 text-sm leading-relaxed"
          >
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--color-brand)]">
              <Sparkles className="h-3 w-3" />
              Fresh briefing
            </div>
            <p className="whitespace-pre-wrap text-[var(--color-fg)]">{result}</p>
          </motion.div>
        ) : null}
        {error ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-xs text-[var(--color-danger)]"
          >
            {error === 'awaiting_approval'
              ? 'Your autonomy policy requires approval for this — open the Conductor thread to approve.'
              : `Couldn't generate briefing: ${error}`}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
