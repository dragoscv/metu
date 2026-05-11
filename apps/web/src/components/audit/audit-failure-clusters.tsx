/**
 * Recurring failure clusters — surfaces the top tools that keep
 * failing for the same reason in the window. Read-only summary;
 * deep-links into the filtered audit list.
 */
import Link from 'next/link';
import { Card, CardTitle } from '@metu/ui';
import { AlertTriangle } from 'lucide-react';
import { toolCallFailureClusters } from '@metu/db/queries';

export async function AuditFailureClusters({
  workspaceId,
  since,
}: {
  workspaceId: string;
  since: Date;
}) {
  const clusters = await toolCallFailureClusters(workspaceId, since, 5);
  if (clusters.length === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
        <CardTitle>Recurring failures</CardTitle>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {clusters.map((c, i) => (
          <li
            key={`${c.tool}:${i}`}
            className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/audit?tools=${encodeURIComponent(c.tool)}&statuses=failed`}
                className="font-medium hover:underline"
              >
                {c.tool}
              </Link>
              <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{c.errorKey}</p>
            </div>
            <span className="bg-[var(--color-danger)]/10 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]">
              {c.count}×
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
