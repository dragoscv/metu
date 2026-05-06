'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspace } from '@metu/db/schema';
import { updateProviderPolicyEntrySchema, type UpdateProviderPolicyEntryInput } from '@metu/types';

export async function updateProviderPolicyAction(input: UpdateProviderPolicyEntryInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updateProviderPolicyEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const db = getDb();
  const [row] = await db
    .select({ providerPolicy: workspace.providerPolicy })
    .from(workspace)
    .where(eq(workspace.id, session.user.workspaceId))
    .limit(1);

  const policy = ((row?.providerPolicy ?? {}) as Record<string, unknown>) ?? {};
  const next = { ...policy };

  if (parsed.data.provider === null) {
    delete next[parsed.data.intent];
  } else {
    next[parsed.data.intent] = {
      provider: parsed.data.provider,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
    };
  }

  await db
    .update(workspace)
    .set({ providerPolicy: next })
    .where(eq(workspace.id, session.user.workspaceId));

  revalidatePath('/settings');
  return { ok: true as const };
}
