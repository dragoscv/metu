/**
 * Device presence queries — used by the morning brief delivery and any
 * other "is this workspace listening?" decision.
 */
import { and, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { device } from '../schema';

const FRESH_PRESENCE_MS = 5 * 60 * 1000;

/**
 * Returns the set of workspace ids (subset of `workspaceIds`) that have at
 * least one device with presence in ('online','idle') and a fresh
 * `lastSeenAt`. Used to skip hub broadcasts to offline workspaces.
 */
export async function workspacesWithLiveDevices(workspaceIds: string[]): Promise<Set<string>> {
  if (workspaceIds.length === 0) return new Set();
  const db = getDb();
  const cutoff = new Date(Date.now() - FRESH_PRESENCE_MS);
  const rows = await db
    .selectDistinct({ workspaceId: device.workspaceId })
    .from(device)
    .where(
      and(
        inArray(device.workspaceId, workspaceIds),
        sql`${device.presence} in ('online', 'idle')`,
        gte(device.lastSeenAt, cutoff),
      ),
    );
  return new Set(rows.map((r) => r.workspaceId));
}

/**
 * Returns count of online devices per workspace for `workspaceIds`. Useful
 * for surfaces that want to badge "3 devices online" or pick the right
 * fallback channel.
 */
export async function countLiveDevicesByWorkspace(
  workspaceIds: string[],
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const db = getDb();
  const cutoff = new Date(Date.now() - FRESH_PRESENCE_MS);
  const rows = await db
    .select({
      workspaceId: device.workspaceId,
      n: sql<number>`count(*)::int`,
    })
    .from(device)
    .where(
      and(
        inArray(device.workspaceId, workspaceIds),
        sql`${device.presence} in ('online', 'idle')`,
        gte(device.lastSeenAt, cutoff),
      ),
    )
    .groupBy(device.workspaceId);
  return new Map(rows.map((r) => [r.workspaceId, Number(r.n)]));
}

/** True iff the given workspace has any fresh-online device right now. */
export async function workspaceHasLiveDevice(workspaceId: string): Promise<boolean> {
  const set = await workspacesWithLiveDevices([workspaceId]);
  return set.has(workspaceId);
}
