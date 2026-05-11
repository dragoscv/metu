/**
 * SDK v1 — /api/sdk/v1/notai/notes
 *
 * Bearer-auth notes CRUD for the notai reference app.
 *
 *  - GET                 → list current user's notes
 *  - POST                → create note (body: {title?, body?, folderId?})
 *  - PUT  ?id=…          → update note (partial)
 *  - DELETE ?id=…        → soft delete
 *
 * Read uses `recall:read`, writes use `capture:write` because every
 * save mirrors into metu memory as a capture (see sync below).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  createNotaiNote,
  listNotaiNotes,
  softDeleteNotaiNote,
  updateNotaiNote,
} from '@metu/db/queries';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

const UpsertSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(50_000).optional(),
  folderId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();
  const limited = await rateLimit('sdk-read', session.userId);
  if (limited) return limited;

  const notes = await listNotaiNotes(session.workspaceId, session.userId);
  return NextResponse.json({ ok: true, notes });
}

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();
  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = UpsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const note = await createNotaiNote({
    workspaceId: session.workspaceId,
    userId: session.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    folderId: parsed.data.folderId ?? null,
    pinned: parsed.data.pinned,
  });

  await syncNoteToCapture(session, note.id, note.title, note.body, null);
  return NextResponse.json({ ok: true, note });
}

export async function PUT(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();
  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  const json = await req.json().catch(() => null);
  const parsed = UpsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const note = await updateNotaiNote(id, session.workspaceId, session.userId, parsed.data);
  if (!note) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  await syncNoteToCapture(session, note.id, note.title, note.body, note.lastSyncedCaptureId);
  return NextResponse.json({ ok: true, note });
}

export async function DELETE(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  await softDeleteNotaiNote(id, session.workspaceId, session.userId);
  return NextResponse.json({ ok: true });
}

/**
 * Mirror a note into metu memory. If the note already has a synced
 * capture, update it in-place to avoid duplicates piling up; otherwise
 * insert a new one and back-link via `lastSyncedCaptureId`.
 */
async function syncNoteToCapture(
  session: { workspaceId: string; userId: string; clientId: string | null },
  noteId: string,
  title: string,
  body: string,
  existingCaptureId: string | null,
): Promise<void> {
  const db = getDb();
  const content = `${title}\n\n${body}`.trim();

  if (existingCaptureId) {
    await db
      .update(capture)
      .set({
        content,
        metadata: {
          source: 'notai',
          noteId,
          ...(session.clientId ? { oauthClientId: session.clientId } : {}),
        },
      })
      .where(and(eq(capture.id, existingCaptureId), eq(capture.workspaceId, session.workspaceId)));
    return;
  }

  const [row] = await db
    .insert(capture)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      kind: 'text',
      status: 'ready',
      content,
      source: 'notai',
      metadata: {
        noteId,
        ...(session.clientId ? { oauthClientId: session.clientId } : {}),
      },
    })
    .returning();

  await updateNotaiNote(noteId, session.workspaceId, session.userId, {
    lastSyncedCaptureId: row!.id,
  });

  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    kind: 'capture.created',
    title: title.slice(0, 80) || 'notai note',
    importance: 0.2,
    payload: { captureId: row!.id, source: 'notai', noteId },
  });

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'capture.created',
      payload: { captureId: row!.id, kind: 'text', source: 'notai' },
    },
  });
}
