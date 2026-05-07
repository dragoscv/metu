'use server';
import { auth } from '@metu/auth';
import { listTimelineFiltered } from '@metu/db/queries';

export interface TimelineRowDTO {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  importance: number;
  occurredAt: string;
  projectId: string | null;
}

export interface LoadMoreInput {
  cursor: { occurredAt: string; id: string } | null;
  kinds: string[];
  projectId: string | null;
  since: string | null;
  search: string | null;
}

export async function loadMoreTimelineAction(input: LoadMoreInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'unauthorized' };
  const wsId = session.user.workspaceId;

  const since = parseSince(input.since);

  const { items, nextCursor } = await listTimelineFiltered({
    workspaceId: wsId,
    kinds: input.kinds.length > 0 ? input.kinds : undefined,
    projectId: input.projectId || undefined,
    since,
    search: input.search || undefined,
    cursor: input.cursor
      ? { occurredAt: new Date(input.cursor.occurredAt), id: input.cursor.id }
      : null,
    limit: 40,
  });

  const rows: TimelineRowDTO[] = items.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    body: e.body,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    importance: e.importance,
    occurredAt: e.occurredAt.toISOString(),
    projectId: e.projectId,
  }));

  return { ok: true as const, items: rows, nextCursor };
}

function parseSince(since: string | null): Date | null {
  if (!since) return null;
  const m = since.match(/^(\d+)d$/);
  if (!m) return null;
  const days = Number(m[1]);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
