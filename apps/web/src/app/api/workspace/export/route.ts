/**
 * Workspace data export — streaming NDJSON ("right to portability").
 *
 * Each output line is `{ table, row }` (plus a leading/trailing _meta).
 * Sensitive fields (secret hashes, push tokens, sealed credential blobs,
 * undo payloads, embeddings) are stripped before serialization.
 *
 * Owner-only, cookie session only (no bearer SDK), rate-limited via
 * the shared limiter.
 */
import { NextResponse } from 'next/server';
import { eq, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  agentRun,
  capture,
  continuityBriefing,
  conversation,
  decision,
  device,
  deviceEvent,
  goal,
  goalCheckin,
  memoryChunk,
  message,
  notaiFolder,
  notaiNote,
  notification,
  notificationSubscription,
  project,
  projectLink,
  target,
  targetValue,
  timelineEvent,
  toolAcl,
  toolCall,
  workspace,
  workspaceMember,
} from '@metu/db/schema';
import { log } from '@/lib/logger';
import { rateLimit, clientKey } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExportTable = {
  name: string;
  table: PgTable & { workspaceId: AnyColumn };
  strip?: Record<string, true>;
};

const tables: ExportTable[] = [
  { name: 'workspace', table: workspace as never },
  { name: 'project', table: project as never },
  { name: 'project_link', table: projectLink as never },
  { name: 'capture', table: capture as never },
  { name: 'memory_chunk', table: memoryChunk as never, strip: { embedding: true } },
  { name: 'timeline_event', table: timelineEvent as never },
  { name: 'conversation', table: conversation as never },
  { name: 'message', table: message as never },
  { name: 'tool_call', table: toolCall as never, strip: { undoPayload: true } },
  { name: 'agent_run', table: agentRun as never },
  { name: 'device', table: device as never, strip: { pushToken: true } },
  { name: 'device_event', table: deviceEvent as never },
  { name: 'notification', table: notification as never },
  {
    name: 'notification_subscription',
    table: notificationSubscription as never,
    strip: { endpoint: true, p256dhKey: true, authKey: true, expoToken: true },
  },
  { name: 'goal', table: goal as never },
  { name: 'goal_checkin', table: goalCheckin as never },
  { name: 'target', table: target as never },
  { name: 'target_value', table: targetValue as never },
  { name: 'agent_policy', table: agentPolicy as never },
  { name: 'tool_acl', table: toolAcl as never },
  { name: 'continuity_briefing', table: continuityBriefing as never },
  { name: 'decision', table: decision as never },
  { name: 'notai_folder', table: notaiFolder as never },
  { name: 'notai_note', table: notaiNote as never },
];

const MAX_ROWS_PER_TABLE = 50_000;
const enc = new TextEncoder();

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const workspaceId = session.user.workspaceId;

  const limited = await rateLimit('workspace-export', `${userId}:${clientKey(req)}`);
  if (limited) return limited;

  const db = getDb();

  // Owner-only — export reveals every member's content.
  const [member] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(eq(workspaceMember.userId, userId))
    .limit(1);
  if (!member || member.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const exportedAt = new Date().toISOString();
  const counts: Record<string, number> = {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeLine = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        writeLine({
          _meta: 'metu-export/v1',
          workspaceId,
          userId,
          exportedAt,
        });

        for (const t of tables) {
          const rows = (await db
            .select()
            .from(t.table)
            .where(eq(t.table.workspaceId, workspaceId))
            .limit(MAX_ROWS_PER_TABLE)) as Array<Record<string, unknown>>;
          counts[t.name] = rows.length;
          for (const row of rows) {
            if (t.strip) {
              for (const k of Object.keys(t.strip)) delete row[k];
            }
            writeLine({ table: t.name, row });
          }
        }

        writeLine({ _meta: 'end', exportedAt, counts });
        controller.close();

        log.info('workspace.export.completed', { workspaceId, userId, counts });
      } catch (err) {
        log.error('workspace.export.failed', { workspaceId, userId }, err);
        controller.error(err);
      }
    },
  });

  // Best-effort audit row before streaming starts; failure here must
  // not block the export itself.
  try {
    await db.insert(timelineEvent).values({
      workspaceId,
      userId,
      kind: 'workspace.exported',
      title: 'Workspace data exported',
      body: 'NDJSON download',
    });
  } catch (err) {
    log.warn('workspace.export.timeline_insert_failed', { workspaceId }, err);
  }

  const filename = `metu-export-${workspaceId}-${exportedAt.slice(0, 10)}.ndjson`;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
