'use client';
/**
 * Slice 10 — Presence ACL editor.
 *
 * One row per `device.*` tool. Mode dropdown writes a workspace-scoped
 * `tool_acl` row (or clears it back to the catalog default). Default ACL
 * for write tools is `ask` per D14, mirrored from
 * `packages/core/src/agent/device-tools.ts`.
 */
import { useState, useTransition } from 'react';
import { setDeviceToolAclAction, type DeviceToolAclRow } from '@/app/actions/presence';

const MODES = [
  { value: '', label: 'Default' },
  { value: 'observe', label: 'Observe' },
  { value: 'ask', label: 'Ask' },
  { value: 'auto_with_undo', label: 'Auto (with undo)' },
  { value: 'autopilot', label: 'Autopilot' },
] as const;

export function DeviceAclEditor({ initial }: { initial: DeviceToolAclRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(tool: string, value: string) {
    const mode = (value || null) as DeviceToolAclRow['mode'];
    setRows((prev) => prev.map((r) => (r.tool === tool ? { ...r, mode } : r)));
    setError(null);
    startTransition(async () => {
      const res = await setDeviceToolAclAction({ tool, mode });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Tool</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Default</th>
              <th className="px-3 py-2 text-left">Workspace mode</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.tool}
                className="border-[var(--color-border)]/60 odd:bg-[var(--color-surface-1)]/40 border-t"
              >
                <td className="px-3 py-2 font-mono text-xs">{r.tool}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">{r.kind}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">{r.defaultMode}</td>
                <td className="px-3 py-2">
                  <select
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs"
                    value={r.mode ?? ''}
                    disabled={pending}
                    onChange={(e) => update(r.tool, e.target.value)}
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        Default ACL for every <code>device.*</code> write is <code>ask</code>. Switching to{' '}
        <code>autopilot</code> means the conductor will execute without confirmation — only flip per
        tool you genuinely trust.
      </p>
    </div>
  );
}
