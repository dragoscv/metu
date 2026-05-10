/**
 * Server-rendered presence pill — "N device online". Reads `device` rows
 * directly (we already have a server context here) so no extra HTTP hop.
 * Fresh = lastSeenAt within 5 min AND presence in (online, idle).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { Wifi, WifiOff } from 'lucide-react';
import { getDb } from '@metu/db';
import { device } from '@metu/db/schema';

const FRESH_MS = 5 * 60 * 1000;

export async function PresencePill({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const cutoff = new Date(Date.now() - FRESH_MS);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(device)
    .where(
      and(
        eq(device.workspaceId, workspaceId),
        sql`${device.presence} in ('online', 'idle')`,
        gte(device.lastSeenAt, cutoff),
      ),
    );
  const n = Number(row?.n ?? 0);
  if (n === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1 text-xs text-[var(--color-fg-subtle)]"
        title="No device currently connected — morning briefs will skip live push."
      >
        <WifiOff className="h-3 w-3" />
        offline
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200"
      title={`${n} device${n === 1 ? '' : 's'} listening — morning briefs will live-push.`}
    >
      <Wifi className="h-3 w-3" />
      {n} online
    </span>
  );
}
