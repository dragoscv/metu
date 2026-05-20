'use client';
/**
 * ActionConsole — inline Conductor reply box.
 *
 * Always visible just below the NowRail. The user types one sentence;
 * on submit we create a text capture (which fans out via `capture/created`
 * to the planner) AND nudge the conductor. The latest assistant pulse
 * is shown above so the box reads like an asynchronous chat.
 *
 * Keep it tight: single textarea, ⌘+Enter or click "send". No history,
 * no scrollback — for that the user opens /agents/conductor.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { createCapture } from '@/app/actions/capture';
import { kickConductorAction } from '@/app/actions/metu';

export function ActionConsole() {
  const [value, setValue] = useState('');
  const [pending, start] = useTransition();
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Autosize the textarea to its content (up to ~5 rows).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || pending) return;
    start(async () => {
      try {
        await createCapture({ kind: 'text', content: text, source: 'web', metadata: {} });
        await kickConductorAction();
        setValue('');
        setLastSentAt(Date.now());
      } catch {
        /* surfaced via toast in upstream action */
      }
    });
  }

  return (
    <div
      className="bg-[var(--color-night-elev)]/40 rounded-2xl border border-[var(--color-border)] p-3 backdrop-blur-md"
      data-action-console
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        <Sparkles className="h-3 w-3" />
        <span>tell the conductor</span>
        {lastSentAt && (
          <span className="ml-auto text-[var(--color-mist)]">
            sent{' '}
            {new Date(lastSentAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="What should I notice, or do, next?"
          className="bg-[var(--color-bg)]/40 focus:ring-[var(--color-pulse)]/40 flex-1 resize-none rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-pulse)] focus:outline-none focus:ring-1"
          disabled={pending}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || value.trim().length === 0}
          aria-label="send to conductor"
          className="bg-[var(--color-night-deep)]/80 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-pulse)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ boxShadow: pending ? undefined : 'var(--shadow-glow-pulse)' }}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
        ⌘+Enter to send · captures land in your inbox · conductor wakes on next tick
      </div>
    </div>
  );
}
