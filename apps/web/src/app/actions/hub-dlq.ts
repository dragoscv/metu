'use server';

import { auth } from '@metu/auth';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { hubDlqEnvelope, workspaceMember } from '@metu/db/schema';
import { hubBroadcast, type DeviceKindFilter, type ServerEvent } from '@/lib/hub';
import { revalidatePath } from 'next/cache';

const replaySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
const discardSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

async function requireAdmin(): Promise<
  { ok: true; userId: string; workspaceId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };
  const db = getDb();
  const workspaceId = session.user.workspaceId;
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, userId: session.user.id, workspaceId };
}

export async function replayDlqAction(
  input: z.input<typeof replaySchema>,
): Promise<{ ok: true; replayed: number; failed: number } | { ok: false; error: string }> {
  const parsed = replaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { workspaceId } = guard;

  const db = getDb();

  const rows = await db
    .select()
    .from(hubDlqEnvelope)
    .where(
      and(
        inArray(hubDlqEnvelope.id, parsed.data.ids),
        eq(hubDlqEnvelope.workspaceId, workspaceId),
        isNull(hubDlqEnvelope.replayedAt),
      ),
    );

  let replayed = 0;
  let failed = 0;
  for (const row of rows) {
    const res = await hubBroadcast({
      workspaceId: row.workspaceId,
      envelope: row.envelope as ServerEvent,
      kinds: (row.kinds as DeviceKindFilter[]) ?? undefined,
      deviceIds: (row.deviceIds as string[]) ?? undefined,
    });
    if (res) {
      await db
        .update(hubDlqEnvelope)
        .set({ replayedAt: sql`now()`, lastAttemptAt: sql`now()` })
        .where(and(eq(hubDlqEnvelope.id, row.id), eq(hubDlqEnvelope.workspaceId, workspaceId)));
      replayed++;
    } else {
      await db
        .update(hubDlqEnvelope)
        .set({ attempts: sql`${hubDlqEnvelope.attempts} + 1`, lastAttemptAt: sql`now()` })
        .where(and(eq(hubDlqEnvelope.id, row.id), eq(hubDlqEnvelope.workspaceId, workspaceId)));
      failed++;
    }
  }

  revalidatePath('/admin/hub-dlq');
  return { ok: true, replayed, failed };
}

export async function discardDlqAction(
  input: z.input<typeof discardSchema>,
): Promise<{ ok: true; discarded: number } | { ok: false; error: string }> {
  const parsed = discardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { workspaceId } = guard;

  const db = getDb();
  // Mark as replayedAt=now even though we never sent — semantically
  // "no longer pending". Keeps the row for audit instead of deleting.
  const rows = await db
    .update(hubDlqEnvelope)
    .set({ replayedAt: sql`now()`, reason: sql`${hubDlqEnvelope.reason} || ' (discarded)'` })
    .where(
      and(
        inArray(hubDlqEnvelope.id, parsed.data.ids),
        eq(hubDlqEnvelope.workspaceId, workspaceId),
        isNull(hubDlqEnvelope.replayedAt),
      ),
    )
    .returning();

  revalidatePath('/admin/hub-dlq');
  return { ok: true, discarded: rows.length };
}
