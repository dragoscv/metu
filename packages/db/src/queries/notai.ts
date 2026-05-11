/**
 * notai notes/folders queries — workspace + user scoped.
 *
 * Two-key tenancy: every query filters on `workspaceId` AND `userId`.
 * Because notai notes are personal (not shared across workspace
 * members), we never want one user's notes to leak to another even
 * inside the same tenant.
 *
 * Soft delete via `deletedAt`; reads exclude rows where it is set.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../client';
import { notaiFolder, notaiNote } from '../schema';

export interface NotaiNoteRow {
  id: string;
  workspaceId: string;
  userId: string;
  folderId: string | null;
  title: string;
  body: string;
  pinned: boolean;
  lastSyncedCaptureId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotaiFolderRow {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapNote(r: typeof notaiNote.$inferSelect): NotaiNoteRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    userId: r.userId,
    folderId: r.folderId,
    title: r.title,
    body: r.body,
    pinned: r.pinned,
    lastSyncedCaptureId: r.lastSyncedCaptureId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listNotaiNotes(
  workspaceId: string,
  userId: string,
): Promise<NotaiNoteRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notaiNote)
    .where(
      and(
        eq(notaiNote.workspaceId, workspaceId),
        eq(notaiNote.userId, userId),
        isNull(notaiNote.deletedAt),
      ),
    )
    .orderBy(desc(notaiNote.pinned), desc(notaiNote.updatedAt));
  return rows.map(mapNote);
}

export async function getNotaiNote(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<NotaiNoteRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notaiNote)
    .where(
      and(
        eq(notaiNote.id, id),
        eq(notaiNote.workspaceId, workspaceId),
        eq(notaiNote.userId, userId),
        isNull(notaiNote.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? mapNote(rows[0]) : null;
}

export interface UpsertNotaiNoteInput {
  id?: string;
  workspaceId: string;
  userId: string;
  folderId?: string | null;
  title?: string;
  body?: string;
  pinned?: boolean;
  lastSyncedCaptureId?: string | null;
}

export async function createNotaiNote(input: UpsertNotaiNoteInput): Promise<NotaiNoteRow> {
  const db = getDb();
  // Drizzle 0.36 .returning() has no projection; read full row.
  await db.insert(notaiNote).values({
    workspaceId: input.workspaceId,
    userId: input.userId,
    folderId: input.folderId ?? null,
    title: input.title ?? 'Untitled',
    body: input.body ?? '',
    pinned: input.pinned ?? false,
  });
  // Most recent insert for this user — safe because we just inserted.
  const rows = await db
    .select()
    .from(notaiNote)
    .where(and(eq(notaiNote.workspaceId, input.workspaceId), eq(notaiNote.userId, input.userId)))
    .orderBy(desc(notaiNote.createdAt))
    .limit(1);
  return mapNote(rows[0]!);
}

export async function updateNotaiNote(
  id: string,
  workspaceId: string,
  userId: string,
  patch: Partial<Pick<UpsertNotaiNoteInput, 'folderId' | 'title' | 'body' | 'pinned' | 'lastSyncedCaptureId'>>,
): Promise<NotaiNoteRow | null> {
  const db = getDb();
  await db
    .update(notaiNote)
    .set(patch)
    .where(
      and(
        eq(notaiNote.id, id),
        eq(notaiNote.workspaceId, workspaceId),
        eq(notaiNote.userId, userId),
      ),
    );
  return getNotaiNote(id, workspaceId, userId);
}

export async function softDeleteNotaiNote(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(notaiNote)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(notaiNote.id, id),
        eq(notaiNote.workspaceId, workspaceId),
        eq(notaiNote.userId, userId),
      ),
    );
}

export async function listNotaiFolders(
  workspaceId: string,
  userId: string,
): Promise<NotaiFolderRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notaiFolder)
    .where(
      and(
        eq(notaiFolder.workspaceId, workspaceId),
        eq(notaiFolder.userId, userId),
        isNull(notaiFolder.deletedAt),
      ),
    )
    .orderBy(notaiFolder.name);
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    userId: r.userId,
    name: r.name,
    parentId: r.parentId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
