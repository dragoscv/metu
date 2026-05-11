/**
 * Surfaces tool calls in `awaiting_approval` so the user can decide
 * inline from the dashboard "now" tab without jumping to /audit.
 */
import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { Card, CardTitle } from '@metu/ui';
import { getDb } from '@metu/db';
import { toolCall } from '@metu/db/schema';
import { Sparkles } from 'lucide-react';
import { ProposedActionRow } from './proposed-action-row';

export async function ProposedActionsStrip({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const rows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      args: toolCall.args,
      aclMode: toolCall.aclMode,
      estimatedCostUsd: toolCall.estimatedCostUsd,
      requestedAt: toolCall.requestedAt,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), eq(toolCall.status, 'awaiting_approval')))
    .orderBy(desc(toolCall.requestedAt))
    .limit(5);

  if (rows.length === 0) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
          <CardTitle>Proposed actions</CardTitle>
        </div>
        <Link
          href="/audit?status=awaiting_approval"
          className="text-xs text-[var(--color-fg-subtle)] hover:underline"
        >
          See all
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <ProposedActionRow
            key={r.id}
            id={r.id}
            tool={r.tool}
            args={r.args as Record<string, unknown> | null}
            estimatedCostUsd={r.estimatedCostUsd}
            requestedAt={r.requestedAt.toISOString()}
          />
        ))}
      </ul>
    </Card>
  );
}
