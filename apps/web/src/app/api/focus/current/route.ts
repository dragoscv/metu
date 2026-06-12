import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { focusState } from '@metu/db/schema';
import { resolveSession, unauthorized } from '@/lib/bearer';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  const db = getDb();
  const [row] = await db
    .select()
    .from(focusState)
    .where(eq(focusState.userId, session.userId))
    .orderBy(desc(focusState.computedAt))
    .limit(1);
  if (!row) return NextResponse.json({});
  return NextResponse.json({
    nowTaskId: row.nowTaskId,
    nextTaskIds: row.nextTaskIds,
    ignoredProjectIds: row.ignoredProjectIds,
    rationale: row.rationale,
    energyLevel: row.energyLevel,
    computedAt: row.computedAt,
  });
}
