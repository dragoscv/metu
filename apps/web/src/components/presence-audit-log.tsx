'use client';
/**
 * Slice 10 — last 50 device-tool calls audit log.
 *
 * Read-only table; refreshes via Next-Server-revalidate when ACL changes
 * or the user navigates back to the page. Status colours match the global
 * StatusDot palette.
 */
import type { DeviceToolCallRow } from '@/app/actions/presence';

export function PresenceAuditLog({ rows }: { rows: DeviceToolCallRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-fg-muted)]">
        No device tool calls yet. Activity from companion / mobile shows up here.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)]">
          <tr>
            <th className="px-3 py-2 text-left">When</th>
            <th className="px-3 py-2 text-left">Tool</th>
            <th className="px-3 py-2 text-left">ACL</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-[var(--color-border)]/60 odd:bg-[var(--color-surface-1)]/40 border-t"
            >
              <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                {formatRel(r.requestedAt)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.tool}</td>
              <td className="px-3 py-2 text-xs">{r.aclMode ?? '—'}</td>
              <td className="px-3 py-2">
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' +
                    statusClass(r.status)
                  }
                >
                  {r.status}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                {r.error
                  ? r.error.slice(0, 80)
                  : r.finishedAt
                    ? `finished ${formatRel(r.finishedAt)}`
                    : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'error':
      return 'bg-red-500/15 text-red-300';
    case 'denied':
      return 'bg-amber-500/15 text-amber-300';
    case 'pending':
      return 'bg-sky-500/15 text-sky-300';
    default:
      return 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]';
  }
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
