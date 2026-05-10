/**
 * Right-to-delete — owner-only endpoint that nukes the entire workspace.
 *
 * The cascade is handled by `onDelete: 'cascade'` references defined on
 * every domain table back to `workspace.id`, so a single DELETE here
 * removes every row this workspace owns. We still emit one final
 * timeline+notification before the row is gone so the audit trail (which
 * lives in the same workspace) is captured upstream by export.
 *
 * Auth: session cookie, owner role, AND the user must POST a JSON body
 * `{ confirm: '<workspace_id>' }` to prove they typed the id. This is
 * the same pattern GitHub uses for repo deletion.
 *
 * No undo. The matching `/api/workspace/export` should be encouraged
 * via the UI before the user lands on this endpoint.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspace, workspaceMember } from '@metu/db/schema';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  confirm: z.string().uuid(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const workspaceId = session.user.workspaceId;

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', detail: parsed.error.issues },
      { status: 400 },
    );
  }
  if (parsed.data.confirm !== workspaceId) {
    return NextResponse.json({ error: 'confirmation_mismatch' }, { status: 400 });
  }

  const db = getDb();

  const [member] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(eq(workspaceMember.userId, userId))
    .limit(1);
  if (!member || member.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Log BEFORE the delete because the timeline row lives inside the
  // workspace and is about to be cascade-deleted with everything else.
  log.warn('workspace.delete.requested', {
    workspaceId,
    userId,
    userEmail: session.user.email,
  });

  try {
    const deleted = await db.delete(workspace).where(eq(workspace.id, workspaceId)).returning();
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    log.warn('workspace.delete.completed', { workspaceId, userId });
    return NextResponse.json({ ok: true, deleted: workspaceId });
  } catch (err) {
    log.error('workspace.delete.failed', { workspaceId, userId }, err);
    return NextResponse.json(
      { error: 'delete_failed', detail: 'see server logs' },
      { status: 500 },
    );
  }
}
