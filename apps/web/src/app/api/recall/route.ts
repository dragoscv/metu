import { NextResponse } from 'next/server';
import { z } from 'zod';
import { memory } from '@metu/core';
import { resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

const schema = z.object({
  query: z.string().min(2).max(500),
  projectId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  const hits = await memory.recall({
    workspaceId: session.workspaceId,
    query: parsed.data.query,
    projectId: parsed.data.projectId,
    limit: parsed.data.limit ?? 8,
  });
  return NextResponse.json({ ok: true, hits });
}
