/**
 * GET /settings/data/export — full workspace takeout as a downloadable
 * JSON file. Owner/admin only. Streams a single JSON document containing
 * every core domain plus memory chunks (embeddings included as float
 * arrays — they're the user's data too).
 *
 * Batched per table with keyset pagination so a large workspace doesn't
 * OOM the server; we build NDJSON-ish sections into one JSON body.
 */
import { auth } from '@metu/auth';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { getDb } from '@metu/db';
import {
  capture,
  decision,
  goal,
  memoryChunk,
  project,
  task,
  timelineEvent,
  workspace,
  workspaceMember,
} from '@metu/db/schema';

const BATCH = 500;

async function dumpTable<T extends { id: string }>(
  fetchBatch: (afterId: string | null) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const rows = await fetchBatch(after);
    out.push(...rows);
    if (rows.length < BATCH) break;
    after = rows[rows.length - 1]!.id;
    if (out.length > 200_000) break; // hard safety valve
  }
  return out;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response('unauthorized', { status: 401 });
  const wsId = session.user.workspaceId;

  const db = getDb();
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, session.user.id), eq(workspaceMember.workspaceId, wsId)))
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return new Response('forbidden', { status: 403 });
  }

  const [ws] = await db.select().from(workspace).where(eq(workspace.id, wsId)).limit(1);

  // Per-table fetchers (drizzle's select typing can't be made generic over
  // arbitrary PgTables without unsound casts — keep each site concrete).
  const keyset = <C extends PgColumn, W extends PgColumn>(
    idCol: C,
    wsCol: W,
    afterId: string | null,
  ) => (afterId ? and(eq(wsCol, wsId), gt(idCol, afterId)) : eq(wsCol, wsId));

  const [captures, tasks, projects, decisions, timeline, goals, memory] = await Promise.all([
    dumpTable((a) =>
      db
        .select()
        .from(capture)
        .where(keyset(capture.id, capture.workspaceId, a))
        .orderBy(asc(capture.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(task)
        .where(keyset(task.id, task.workspaceId, a))
        .orderBy(asc(task.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(project)
        .where(keyset(project.id, project.workspaceId, a))
        .orderBy(asc(project.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(decision)
        .where(keyset(decision.id, decision.workspaceId, a))
        .orderBy(asc(decision.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(timelineEvent)
        .where(keyset(timelineEvent.id, timelineEvent.workspaceId, a))
        .orderBy(asc(timelineEvent.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(goal)
        .where(keyset(goal.id, goal.workspaceId, a))
        .orderBy(asc(goal.id))
        .limit(BATCH),
    ),
    dumpTable((a) =>
      db
        .select()
        .from(memoryChunk)
        .where(keyset(memoryChunk.id, memoryChunk.workspaceId, a))
        .orderBy(asc(memoryChunk.id))
        .limit(BATCH),
    ),
  ]);

  const body = JSON.stringify(
    {
      format: 'metu-takeout',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: ws ? { id: ws.id, name: ws.name, slug: ws.slug, createdAt: ws.createdAt } : null,
      counts: {
        captures: captures.length,
        tasks: tasks.length,
        projects: projects.length,
        decisions: decisions.length,
        timeline: timeline.length,
        goals: goals.length,
        memoryChunks: memory.length,
      },
      captures,
      tasks,
      projects,
      decisions,
      timeline,
      goals,
      memoryChunks: memory,
    },
    null,
    0,
  );

  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="metu-takeout-${wsId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
