'use client';
/**
 * Single-field selector for the Conductor activity level. Backs a
 * Server Action so we don't need a client-side mutation.
 */
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  setConductorActivityLevelAction,
  type ConductorActivityLevel,
} from '@/app/actions/workspace-preferences';

const LEVELS: Array<{ value: ConductorActivityLevel; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Ignore device activity entirely.' },
  { value: 'passive', label: 'Passive', hint: 'Observe silently. Never interrupt.' },
  {
    value: 'gentle',
    label: 'Gentle',
    hint: 'Welcome you back after a long pause. (default)',
  },
  {
    value: 'aggressive',
    label: 'Aggressive',
    hint: 'React to every context switch with suggestions.',
  },
];

export function ConductorActivityLevelForm({ initial }: { initial: ConductorActivityLevel }) {
  const [pending, start] = useTransition();

  function onChange(level: ConductorActivityLevel) {
    if (level === initial) return;
    const fd = new FormData();
    fd.set('conductorActivityLevel', level);
    start(async () => {
      try {
        await setConductorActivityLevelAction(fd);
        toast.success(`Conductor reactivity: ${level}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-fg)]">Conductor reactivity</h2>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
        How loudly the Conductor responds to ambient activity (VS Code, browser, companion). Tool
        ACL below is unaffected.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {LEVELS.map((l) => (
          <label
            key={l.value}
            className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border p-2 text-xs transition ${
              initial === l.value
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft,rgba(124,58,237,0.08))]'
                : 'border-[var(--color-border)] hover:border-[var(--color-fg-muted)]'
            } ${pending ? 'opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="conductorActivityLevel"
              value={l.value}
              checked={initial === l.value}
              disabled={pending}
              onChange={() => onChange(l.value)}
              className="mt-0.5 accent-[var(--color-brand)]"
            />
            <span>
              <span className="font-medium text-[var(--color-fg)]">{l.label}</span>
              <span className="block text-[var(--color-fg-muted)]">{l.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
