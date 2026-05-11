/**
 * SDK v1 — /api/sdk/v1/notai/folders
 *
 *  - GET     → list folders for the user
 *  - POST    → create folder ({ name, parentId? })
 *  - DELETE  → soft delete (?id=…)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notaiFolder } from '@metu/db/schema';
import { listNotaiFolders } from '@metu/db/queries';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  parentId: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();
  const folders = await listNotaiFolders(session.workspaceId, session.userId);
  return NextResponse.json({ ok: true, folders });
}

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();
  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  await db.insert(notaiFolder).values({
    workspaceId: session.workspaceId,
    userId: session.userId,
    name: parsed.data.name,
    parentId: parsed.data.parentId ?? null,
  });
  const rows = await db
    .select()
    .from(notaiFolder)
    .where(
      and(eq(notaiFolder.workspaceId, session.workspaceId), eq(notaiFolder.userId, session.userId)),
    )
    .orderBy(desc(notaiFolder.createdAt))
    .limit(1);
  return NextResponse.json({ ok: true, folder: rows[0] });
}

export async function DELETE(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  const db = getDb();
  await db
    .update(notaiFolder)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(notaiFolder.id, id),
        eq(notaiFolder.workspaceId, session.workspaceId),
        eq(notaiFolder.userId, session.userId),
        isNull(notaiFolder.deletedAt),
      ),
    );
  return NextResponse.json({ ok: true });
}
