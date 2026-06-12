/**
 * SDK v1 — DELETE /api/sdk/v1/capture/[id]
 *
 * Bearer auth (`capture:write` scope). Soft-deletes a capture the
 * caller owns. Used by the companion's voice-undo affordance and by
 * future "delete that last one" flows. Idempotent: returns ok=true
 * even if the capture is already deleted (or doesn't exist for this
 * caller) so the UI can fire-and-forget without race noise.
 *
 * Tightly scoped: only the user who created the capture may delete
 * it (not anyone else in the workspace) so a shared workspace can't
 * accidentally lose someone else's notes.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .update(capture)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(capture.id, id),
        eq(capture.workspaceId, session.workspaceId),
        eq(capture.userId, session.userId),
        isNull(capture.deletedAt),
      ),
    )
    .returning();

  if (row) {
    await db.insert(timelineEvent).values({
      workspaceId: session.workspaceId,
      kind: 'capture.deleted',
      title: 'Capture removed',
      importance: 0.1,
      payload: { captureId: id, source: row.source },
    });
  }

  return NextResponse.json({ ok: true });
}
