/**
 * Persistent Conductor strip — fixed pill at the bottom of the (app) layout
 * that surfaces awaiting-approval count, last conductor activity, and
 * today's spend vs cap. Acts as the always-on "your supervisor" indicator
 * and a fast opener for the existing drawer (Ctrl+J).
 *
 * Server component: a fresh aggregate is fetched on each navigation
 * (Cache Components disabled for now). Lightweight queries — three small
 * selects, all indexed.
 */
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, timelineEvent } from '@metu/db/schema';
import { toolCallSummary } from '@metu/db/queries';
import { ConductorStripOpener } from './conductor-strip-opener';

const RECENT_KINDS = new Set([
  'conductor.tool.proposed',
  'conductor.tool.approved',
  'conductor.escalation.completed',
  'conductor.cap.exceeded',
]);

function relTime(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export async function ConductorStrip({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [summary, latestEvent, policyRow] = await Promise.all([
    toolCallSummary(workspaceId, since),
    db
      .select({
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(eq(timelineEvent.workspaceId, workspaceId))
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(20)
      .then((rows) => rows.find((r) => RECENT_KINDS.has(r.kind)) ?? null),
    db
      .select({ dailyCostCapUsd: agentPolicy.dailyCostCapUsd })
      .from(agentPolicy)
      .where(eq(agentPolicy.workspaceId, workspaceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const spent = Number(summary.cost ?? 0);
  const cap = policyRow?.dailyCostCapUsd ?? null;
  const spendPct = cap && cap > 0 ? Math.min(1, spent / cap) : 0;
  const spendLabel =
    cap == null ? `$${spent.toFixed(2)} today` : `$${spent.toFixed(2)} / $${cap.toFixed(2)}`;

  // Hide the strip entirely when nothing is going on. Avoids visual noise
  // for first-time users who haven't kicked off the conductor yet.
  if (summary.awaiting === 0 && spent === 0 && !latestEvent) {
    return null;
  }

  const recentLabel = latestEvent
    ? `${latestEvent.title.slice(0, 60)} · ${relTime(new Date(latestEvent.occurredAt))}`
    : null;

  return (
    <div
      // left offset = live sidebar width (CSS var from SidebarProvider):
      // the pill centers within the CONTENT area instead of the window,
      // so it never slides under the expanded sidebar.
      className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3 transition-[left] duration-200"
      style={{ left: 'var(--sidebar-w, 0px)' }}
      aria-live="polite"
    >
      <ConductorStripOpener
        awaiting={summary.awaiting}
        recentLabel={recentLabel}
        spendLabel={spendLabel}
        spendPct={spendPct}
      />
    </div>
  );
}
