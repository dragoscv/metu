'use server';

/**
 * Takeout import — restores rows from a `/api/workspace/export` NDJSON
 * file into the CURRENT workspace.
 *
 * v1 semantics (deliberately conservative):
 *  - Insert-only with NEW ids — existing data is never modified.
 *  - Idempotent-ish: a row whose (table, title/content hash) already
 *    exists in the workspace is skipped.
 *  - Core content domains only: projects, captures, tasks, decisions,
 *    goals, timeline events. System tables (tokens, devices, tool calls,
 *    sealed credentials) are intentionally NOT importable.
 *  - Caps at MAX_ROWS to bound a malicious/huge file.
 */
import { createHash } from 'node:crypto';
import { auth } from '@metu/auth';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import {
  capture,
  decision,
  goal,
  project,
  task,
  timelineEvent,
  workspaceMember,
} from '@metu/db/schema';
import { revalidatePath } from 'next/cache';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_ROWS = 20_000;

const lineSchema = z.object({
  table: z.string(),
  row: z.record(z.string(), z.unknown()),
});

type Summary = Record<string, { imported: number; skipped: number }>;

function hashOf(parts: Array<unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

export async function importTakeoutAction(
  formData: FormData,
): Promise<{ ok: true; summary: Summary } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;

  const db = getDb();
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, session.user.id), eq(workspaceMember.workspaceId, wsId)))
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return { ok: false, error: 'Owner or admin only' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file provided' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'File too large (max 50MB)' };

  const text = await file.text();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > MAX_ROWS + 10) return { ok: false, error: `Too many rows (max ${MAX_ROWS})` };

  const summary: Summary = {};
  const bump = (t: string, k: 'imported' | 'skipped') => {
    summary[t] ??= { imported: 0, skipped: 0 };
    summary[t][k]++;
  };

  // Pre-load existing content hashes for dedupe (title/content based).
  const [existingCaptures, existingTasks, existingProjects, existingDecisions, existingGoals] =
    await Promise.all([
      db.select({ content: capture.content }).from(capture).where(eq(capture.workspaceId, wsId)),
      db.select({ title: task.title }).from(task).where(eq(task.workspaceId, wsId)),
      db.select({ name: project.name }).from(project).where(eq(project.workspaceId, wsId)),
      db.select({ title: decision.title }).from(decision).where(eq(decision.workspaceId, wsId)),
      db.select({ title: goal.title }).from(goal).where(eq(goal.workspaceId, wsId)),
    ]);
  const seen = new Set<string>([
    ...existingCaptures.map((r) => hashOf(['capture', r.content])),
    ...existingTasks.map((r) => hashOf(['task', r.title])),
    ...existingProjects.map((r) => hashOf(['project', r.name])),
    ...existingDecisions.map((r) => hashOf(['decision', r.title])),
    ...existingGoals.map((r) => hashOf(['goal', r.title])),
  ]);

  // Old export project id → newly created project id (to preserve links).
  const projectIdMap = new Map<string, string>();
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  for (const line of lines) {
    let parsed: z.infer<typeof lineSchema>;
    try {
      const json: unknown = JSON.parse(line);
      const res = lineSchema.safeParse(json);
      if (!res.success) continue; // _meta lines etc.
      parsed = res.data;
    } catch {
      continue;
    }
    const { table: t, row } = parsed;

    try {
      if (t === 'project') {
        const name = str(row.name);
        if (!name) continue;
        const h = hashOf(['project', name]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        const [created] = await db
          .insert(project)
          .values({
            workspaceId: wsId,
            name,
            slug: `${name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 40)}-${hashOf(['slug', name]).slice(0, 6)}`,
            summary: str(row.summary),
          })
          .returning();
        if (created && str(row.id)) projectIdMap.set(str(row.id)!, created.id);
        bump(t, 'imported');
      } else if (t === 'capture') {
        const content = str(row.content);
        if (!content) continue;
        const h = hashOf(['capture', content]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        await db.insert(capture).values({
          workspaceId: wsId,
          userId: session.user.id,
          kind: 'text',
          source: 'import',
          content,
          projectId: str(row.projectId) ? (projectIdMap.get(str(row.projectId)!) ?? null) : null,
        });
        bump(t, 'imported');
      } else if (t === 'task') {
        const title = str(row.title);
        if (!title) continue;
        const h = hashOf(['task', title]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        await db.insert(task).values({
          workspaceId: wsId,
          title,
          body: str(row.body),
          projectId: str(row.projectId) ? (projectIdMap.get(str(row.projectId)!) ?? null) : null,
        });
        bump(t, 'imported');
      } else if (t === 'decision') {
        const title = str(row.title);
        if (!title) continue;
        const h = hashOf(['decision', title]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        await db.insert(decision).values({
          workspaceId: wsId,
          title,
          rationale: str(row.rationale) ?? '(imported without rationale)',
          projectId: str(row.projectId) ? (projectIdMap.get(str(row.projectId)!) ?? null) : null,
        });
        bump(t, 'imported');
      } else if (t === 'goal') {
        const title = str(row.title);
        if (!title) continue;
        const h = hashOf(['goal', title]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        await db.insert(goal).values({
          workspaceId: wsId,
          userId: session.user.id,
          title,
          body: str(row.body),
        });
        bump(t, 'imported');
      } else if (t === 'timeline_event') {
        const title = str(row.title);
        const kind = str(row.kind);
        if (!title || !kind) continue;
        const occurredAt = str(row.occurredAt);
        const h = hashOf(['timeline', kind, title, occurredAt]);
        if (seen.has(h)) {
          bump(t, 'skipped');
          continue;
        }
        seen.add(h);
        await db.insert(timelineEvent).values({
          workspaceId: wsId,
          kind,
          title,
          body: str(row.body),
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
          projectId: str(row.projectId) ? (projectIdMap.get(str(row.projectId)!) ?? null) : null,
        });
        bump(t, 'imported');
      }
      // All other tables intentionally ignored.
    } catch {
      bump(t, 'skipped');
    }
  }

  revalidatePath('/captures');
  revalidatePath('/timeline');
  revalidatePath('/projects');
  return { ok: true, summary };
}
