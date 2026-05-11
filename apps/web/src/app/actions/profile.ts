'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth, signOut } from '@metu/auth';
import { getDb } from '@metu/db';
import { timelineEvent, user, workspaceMember } from '@metu/db/schema';

const updateNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function updateDisplayNameAction(
  input: z.input<typeof updateNameSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };
  const parsed = updateNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };

  const db = getDb();
  await db.update(user).set({ name: parsed.data.name }).where(eq(user.id, session.user.id));
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'profile.updated',
    title: 'Display name updated',
    body: parsed.data.name,
  });
  revalidatePath('/settings/profile');
  return { ok: true };
}

const deleteSchema = z.object({
  confirm: z.string(),
});

/**
 * Delete the user account. The user is removed from every workspace they
 * belong to; workspaces where they were the sole owner are NOT
 * auto-deleted — we surface that in the error so the user can transfer
 * ownership or rename/delete the workspace first.
 */
export async function deleteAccountAction(input: z.input<typeof deleteSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'unauthorized' };
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirm !== 'DELETE') {
    return { ok: false as const, error: 'type DELETE to confirm' };
  }

  const db = getDb();
  const userId = session.user.id;

  const soleOwnerWorkspaces = await db.execute(sql`
    select wm.workspace_id
    from ${workspaceMember} wm
    where wm.user_id = ${userId} and wm.role = 'owner'
      and (
        select count(*) from ${workspaceMember} wm2
        where wm2.workspace_id = wm.workspace_id and wm2.role = 'owner'
      ) = 1
  `);

  const blockers = ((soleOwnerWorkspaces as { rows?: Array<{ workspace_id: string }> }).rows ??
    (soleOwnerWorkspaces as unknown as Array<{ workspace_id: string }>)) as Array<{
    workspace_id: string;
  }>;
  if (blockers.length > 0) {
    return {
      ok: false as const,
      error: `You are the sole owner of ${blockers.length} workspace(s). Transfer ownership or delete those workspaces first.`,
    };
  }

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId,
    kind: 'account.deleted',
    title: 'Account deletion requested',
    body: session.user.email ?? userId,
  });

  await db.delete(workspaceMember).where(eq(workspaceMember.userId, userId));
  await db.delete(user).where(eq(user.id, userId));

  await signOut({ redirect: false });
  redirect('/sign-in?deleted=1');
}

// ─── Avatar upload ────────────────────────────────────────────────────────

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const AVATAR_MIME_ALLOW = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Upload a new avatar. Validates size and content type, uploads to the
 * public-read GCS bucket, then writes the public URL to `user.image`.
 * Old avatar (if it was on our bucket) is best-effort deleted afterwards.
 */
export async function uploadAvatarAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'file missing' };
  if (file.size <= 0) return { ok: false, error: 'empty file' };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: 'file too large (max 2 MiB)' };
  if (!AVATAR_MIME_ALLOW.has(file.type)) {
    return { ok: false, error: 'unsupported type (use png, jpeg or webp)' };
  }

  const { gcs } = await import('@metu/integrations');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = gcs.newStorageKey(`avatars/${session.user.id}`, ext);
  const buf = Buffer.from(await file.arrayBuffer());

  let publicUrl: string;
  try {
    const uploaded = await gcs.uploadPublicObject({
      storageKey: key,
      contentType: file.type,
      data: buf,
    });
    publicUrl = uploaded.url;
  } catch (err) {
    return { ok: false, error: `upload failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  const db = getDb();
  const [prev] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  await db.update(user).set({ image: publicUrl }).where(eq(user.id, session.user.id));

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'profile.updated',
    title: 'Avatar updated',
    body: publicUrl,
  });

  // Best-effort cleanup of the previous object if it lived on our public bucket.
  if (prev?.image) {
    const publicBase = process.env.GCS_PUBLIC_BASE_URL
      ? process.env.GCS_PUBLIC_BASE_URL
      : `https://storage.googleapis.com/${process.env.GCS_PUBLIC_BUCKET ?? 'metu-public'}`;
    if (prev.image.startsWith(publicBase + '/')) {
      const oldKey = prev.image.slice(publicBase.length + 1);
      void gcs.deletePublicObject(oldKey).catch(() => {
        /* lifecycle policy will catch orphans */
      });
    }
  }

  revalidatePath('/settings/profile');
  return { ok: true, url: publicUrl };
}
