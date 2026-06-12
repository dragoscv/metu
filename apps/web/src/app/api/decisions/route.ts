import { NextResponse } from 'next/server';
import { getDb } from '@metu/db';
import { decision, timelineEvent } from '@metu/db/schema';
import { createDecisionSchema } from '@metu/types';
import { resolveSession, unauthorized } from '@/lib/bearer';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  const json = await req.json().catch(() => null);
  const parsed = createDecisionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const db = getDb();
  const [row] = await db
    .insert(decision)
    .values({
      workspaceId: session.workspaceId,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      rationale: parsed.data.rationale,
      alternatives: parsed.data.alternatives ?? [],
    })
    .returning();
  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    projectId: parsed.data.projectId ?? null,
    kind: 'decision.logged',
    title: parsed.data.title,
    importance: 0.8,
  });
  return NextResponse.json({ ok: true, id: row!.id });
}
