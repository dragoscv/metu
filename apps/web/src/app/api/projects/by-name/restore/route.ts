import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { project } from '@metu/db/schema';
import { continuity } from '@metu/core';
import { resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

const schema = z.object({ name: z.string().min(1).max(120) });

/**
 * Used by the VS Code extension: maps the open workspace folder name to a
 * metu project (case-insensitive substring), then returns its restoration
 * briefing.
 */
export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const db = getDb();
  const rows = await db.select().from(project).where(eq(project.workspaceId, session.workspaceId));

  const target = rows.find(
    (p) =>
      p.slug.toLowerCase() === parsed.data.name.toLowerCase() ||
      p.name.toLowerCase().includes(parsed.data.name.toLowerCase()),
  );
  if (!target) {
    return NextResponse.json(
      { ok: false, error: `No project matching '${parsed.data.name}'` },
      { status: 404 },
    );
  }
  const r = await continuity.restoreProjectContext(session.workspaceId, target.id);
  return NextResponse.json({ ok: true, project: target, ...r });
}
