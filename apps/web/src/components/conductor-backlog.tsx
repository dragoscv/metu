/**
 * Conductor backlog — last few escalation events for the workspace.
 *
 * Server component. Renders a Card with the most recent
 * `conductor.observed.*`, `conductor.escalation.completed`, and
 * `conductor.tool.approved` rows so the user can see what their
 * supervisor has been doing without leaving the dashboard.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { Card, CardTitle } from '@metu/ui';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';

const KINDS = [
  'conductor.escalation.completed',
  'conductor.tool.approved',
  'conductor.observed.companion-agent escalate',
];

const KIND_LABEL: Record<string, string> = {
  'conductor.escalation.completed': 'Escalation handled',
  'conductor.tool.approved': 'Tool approved',
};

function relTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export async function ConductorBacklog({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const rows = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(and(eq(timelineEvent.workspaceId, workspaceId), inArray(timelineEvent.kind, KINDS)))
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(8);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Conductor backlog</CardTitle>
        <Link
          href="/timeline?q=conductor"
          className="text-xs text-[var(--color-fg-subtle)] hover:underline"
        >
          See all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-fg-subtle)]">
          No recent supervisor activity. The Conductor wakes up when something happens.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="truncate">
                <span className="text-[var(--color-fg-subtle)]">
                  {KIND_LABEL[r.kind] ?? r.kind.replace('conductor.', '')}
                </span>{' '}
                {r.title}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-fg-subtle)]">
                {relTime(new Date(r.occurredAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
