'use client';
/**
 * Slice 10 — Sensory ring viewer + "clear ephemeral now" action.
 *
 * Lists the most-recent sensory rows (screenshots, transcripts, focus
 * events, etc.) so the user can audit what the agent has been allowed to
 * see. Bytes (storageKey) are hyperlinks when the row was persisted.
 */
import { useState, useTransition } from 'react';
import { Button } from '@metu/ui';
import { pruneSensoryRingAction, type SensoryRingViewRow } from '@/app/actions/presence';

export function SensoryRingViewer({ rows }: { rows: SensoryRingViewRow[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearNow() {
    setError(null);
    setRemoved(null);
    startTransition(async () => {
      const res = await pruneSensoryRingAction();
      if (res.ok) setRemoved(res.removed);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-fg-muted)]">
          Default retention is a 24h ring buffer (D17). Persisted rows survive across devices;
          ephemeral rows expire automatically — or click below to drop them now.
        </p>
        <Button size="sm" variant="ghost" disabled={pending} onClick={clearNow}>
          {pending ? 'Clearing…' : 'Clear ephemeral now'}
        </Button>
      </div>
      {removed !== null ? (
        <p className="text-xs text-emerald-300">Removed {removed} ephemeral rows.</p>
      ) : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-fg-muted)]">
          Nothing observed yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Retention</th>
                <th className="px-3 py-2 text-left">Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-[var(--color-border)]/60 odd:bg-[var(--color-surface-1)]/40 border-t"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                    {formatRel(r.occurredAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.kind}</td>
                  <td className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">{r.retention}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.summary || (r.storageKey ? `bytes://${r.storageKey}` : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatRel(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - t.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
