/**
 * SDK v1 — GET /api/sdk/v1/devices
 *
 * Bearer auth (`notify:read` scope). Returns the workspace's devices with
 * presence + lastSeen, sorted by recency. Used by web topbar, /resume
 * page, and external clients to render "N device online" badges.
 */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { device } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FRESH_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:read')) return forbidden();

  const db = getDb();
  const rows = await db
    .select({
      id: device.id,
      kind: device.kind,
      name: device.name,
      platform: device.platform,
      presence: device.presence,
      lastSeenAt: device.lastSeenAt,
      version: device.version,
    })
    .from(device)
    .where(eq(device.workspaceId, session.workspaceId))
    .orderBy(desc(device.lastSeenAt))
    .limit(50);

  const now = Date.now();
  const items = rows.map((r) => {
    const fresh = r.lastSeenAt && now - r.lastSeenAt.getTime() < FRESH_MS;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      platform: r.platform,
      version: r.version,
      presence: fresh ? r.presence : 'offline',
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      live: Boolean(fresh && (r.presence === 'online' || r.presence === 'idle')),
    };
  });

  const liveCount = items.filter((i) => i.live).length;

  return NextResponse.json({
    ok: true,
    workspaceId: session.workspaceId,
    devices: items,
    liveCount,
    total: items.length,
  });
}
