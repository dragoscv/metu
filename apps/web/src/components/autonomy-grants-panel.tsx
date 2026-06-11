'use client';
/**
 * Session autopilot grants (Conductor v2 — Jarvis Slice E polish).
 *
 * "Act freely for the next N hours" — while a grant is active, the
 * Conductor upgrades `ask` to `auto_with_undo` for the granted scope
 * (everything or one tool). FORCE_ASK tools (telegram/email) never
 * soften regardless. Grants auto-expire and are revocable here.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createAutonomyGrantAction, revokeAutonomyGrantAction } from '@/app/actions/autonomy';

export interface GrantRow {
  id: string;
  tool: string | null;
  note: string | null;
  expiresAt: string; // ISO
  createdAt: string; // ISO
}

const QUICK_GRANTS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: 'Workday' },
];

function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export function AutonomyGrantsPanel({ grants, tools }: { grants: GrantRow[]; tools: string[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function grant(hours: number, tool: string | null) {
    start(async () => {
      const res = await createAutonomyGrantAction({ hours, tool });
      if (res.ok) {
        toast.success(
          `Autopilot granted${tool ? ` for ${tool}` : ''} — ${hours}h. The Conductor acts with undo instead of asking.`,
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function revoke(id: string) {
    start(async () => {
      const res = await revokeAutonomyGrantAction(id);
      if (res.ok) {
        toast.success('Grant revoked — the Conductor asks again.');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-fg)]">Session autopilot</h2>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
        Grant the Conductor freedom to act without asking, for a bounded window. Actions stay
        visible (undo toasts + audit trail); messaging tools (Telegram, email) always ask.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-fg-muted)]">Act freely for:</span>
        {QUICK_GRANTS.map((q) => (
          <button
            key={q.hours}
            type="button"
            disabled={pending}
            onClick={() => grant(q.hours, null)}
            className="rounded-[var(--radius)] border border-[var(--color-brand)] px-3 py-1 text-xs font-medium text-[var(--color-brand)] transition hover:bg-[var(--color-brand-soft,rgba(124,58,237,0.08))] disabled:opacity-50"
          >
            {q.label}
          </button>
        ))}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const tool = String(fd.get('tool') ?? '');
            const hours = Number(fd.get('hours') ?? 4);
            if (tool) grant(hours, tool);
          }}
        >
          <select
            name="tool"
            disabled={pending}
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)]"
            defaultValue=""
          >
            <option value="" disabled>
              one tool…
            </option>
            {tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            name="hours"
            disabled={pending}
            defaultValue="4"
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)]"
          >
            <option value="1">1h</option>
            <option value="4">4h</option>
            <option value="8">8h</option>
            <option value="24">24h</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius)] border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-fg)] transition hover:border-[var(--color-fg-muted)] disabled:opacity-50"
          >
            Grant
          </button>
        </form>
      </div>

      {grants.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {grants.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-[var(--color-fg)]">
                <span className="font-medium">{g.tool ?? 'All tools'}</span>
                <span className="ml-2 text-[var(--color-fg-muted)]">{remaining(g.expiresAt)}</span>
                {g.note && <span className="ml-2 text-[var(--color-fg-muted)]">· {g.note}</span>}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => revoke(g.id)}
                className="shrink-0 rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)] transition hover:border-red-400 hover:text-red-400 disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
