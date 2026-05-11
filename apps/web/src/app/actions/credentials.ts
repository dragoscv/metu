'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { seal } from '@metu/ai';
import { upsertProviderCredentialSchema, type UpsertProviderCredentialInput } from '@metu/types';
import { requireTier } from '@/lib/tier-gate';

// Free tier may store ONE provider credential to seed evaluation; any
// additional provider requires upgrading. `copilot` (the OAuth flow,
// which lands rows here too) is not gated — we want users to be able
// to plug their existing GitHub Copilot subscription on free.
const FREE_PROVIDER_LIMIT = 1;

export async function upsertProviderCredentialAction(input: UpsertProviderCredentialInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = upsertProviderCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const sealed = seal(parsed.data.apiKey);
  const db = getDb();

  // Try update existing (workspace + provider + label) else insert
  const existing = await db
    .select({ id: providerCredential.id })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, parsed.data.provider),
        eq(providerCredential.label, parsed.data.label),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(providerCredential)
      .set({
        apiKeyCiphertext: sealed.ciphertext,
        apiKeyIv: sealed.iv,
        apiKeyTag: sealed.tag,
        endpoint: parsed.data.endpoint ?? null,
        defaultModel: parsed.data.defaultModel ?? null,
        config: parsed.data.config,
        isDefault: parsed.data.isDefault ? 1 : 0,
      })
      .where(eq(providerCredential.id, existing[0].id));
  } else {
    // Plan-gate: count existing distinct providers (excluding copilot
    // which has its own OAuth flow). Free tier caps at FREE_PROVIDER_LIMIT.
    const owned = await db
      .selectDistinct({ provider: providerCredential.provider })
      .from(providerCredential)
      .where(eq(providerCredential.workspaceId, session.user.workspaceId));
    const distinct = owned.filter((r) => r.provider !== 'copilot' && r.provider !== parsed.data.provider).length;
    if (distinct >= FREE_PROVIDER_LIMIT) {
      const gate = await requireTier(session.user.workspaceId, 'starter');
      if (!gate.ok) {
        return {
          ok: false as const,
          error: 'plan_required',
          tier: gate.tier,
          minTier: gate.minTier,
        };
      }
    }

    await db.insert(providerCredential).values({
      workspaceId: session.user.workspaceId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyIv: sealed.iv,
      apiKeyTag: sealed.tag,
      endpoint: parsed.data.endpoint ?? null,
      defaultModel: parsed.data.defaultModel ?? null,
      config: parsed.data.config,
      isDefault: parsed.data.isDefault ? 1 : 0,
    });
  }

  revalidatePath('/settings');
  return { ok: true as const };
}
