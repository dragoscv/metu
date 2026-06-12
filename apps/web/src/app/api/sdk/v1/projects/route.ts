/**
 * SDK v1 — GET /api/sdk/v1/projects
 *
 * Bearer auth (`recall:read` scope — project metadata is read-only and
 * shares the same risk class as recall hits). Used by surfaces that need
 * to let the user pick a project for scoped capture (browser-ext context
 * menu, mobile share-sheet, future: VS Code workspace picker).
 *
 * Returns active projects only; archived/killed are filtered out so the
 * picker stays short. Caller can pass `?include=all` for the full list.
 */
import { NextResponse } from 'next/server';
import { listProjects } from '@metu/db/queries';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();

  const url = new URL(req.url);
  const includeAll = url.searchParams.get('include') === 'all';
  const all = await listProjects(session.workspaceId);

  const rows = all
    .filter((p) => (includeAll ? true : p.status !== 'archived' && p.status !== 'killed'))
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      momentumScore: p.momentumScore,
    }));

  return NextResponse.json(rows);
}
