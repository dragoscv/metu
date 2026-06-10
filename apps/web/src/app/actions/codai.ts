'use server';
/**
 * Codai (ai.codai.ro) — first-class provider connect/disconnect.
 *
 * codai is OpenAI-compatible; the base URL, models and tuning headers are
 * baked into the registry (see `packages/ai/src/registry.ts`). The user only
 * provides an API key, which is sealed (AES-256-GCM) and stored per workspace.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { seal, CODAI_BASE_URL } from '@metu/ai';

const ConnectSchema = z.object({
  apiKey: z.string().min(1).max(500),
});

export async function connectCodai(input: { apiKey: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = ConnectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const sealed = seal(parsed.data.apiKey.trim());
  const db = getDb();

  const existing = await db
    .select({ id: providerCredential.id })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, 'codai'),
        eq(providerCredential.label, 'default'),
      ),
    )
    .limit(1);

  const values = {
    apiKeyCiphertext: sealed.ciphertext,
    apiKeyIv: sealed.iv,
    apiKeyTag: sealed.tag,
    endpoint: CODAI_BASE_URL,
    defaultModel: 'codai',
    isDefault: 1,
  };

  if (existing[0]) {
    await db
      .update(providerCredential)
      .set(values)
      .where(
        and(
          eq(providerCredential.id, existing[0].id),
          eq(providerCredential.workspaceId, session.user.workspaceId),
        ),
      );
  } else {
    await db.insert(providerCredential).values({
      workspaceId: session.user.workspaceId,
      provider: 'codai',
      label: 'default',
      ...values,
    });
  }

  revalidatePath('/settings');
  return { ok: true as const };
}

export async function disconnectCodai() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, 'codai'),
      ),
    );
  revalidatePath('/settings');
  return { ok: true as const };
}
