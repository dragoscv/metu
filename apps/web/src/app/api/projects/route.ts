import { NextResponse } from 'next/server';
import { listProjects } from '@metu/db/queries';
import { resolveSession, unauthorized } from '@/lib/bearer';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  const rows = await listProjects(session.workspaceId);
  return NextResponse.json(rows);
}
