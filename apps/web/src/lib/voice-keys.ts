/**
 * Server-side voice provider key resolution.
 *
 * Slice 5b — BYOK first, env-var fallback second. Voice providers are
 * stored in the same `provider_credential` table as LLM providers
 * (`ai_provider_kind` enum extended with deepgram / cartesia / elevenlabs)
 * so users get one BYOK editor for everything.
 *
 * Resolution order per provider:
 *   1. Workspace-scoped sealed credential (default first, otherwise the
 *      most-recently-updated row for that provider).
 *   2. Process env var (`DEEPGRAM_API_KEY`, ...) — kept for local dev and
 *      managed-tier deployments.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { open } from '@metu/ai';

export type VoiceProviderKey = 'deepgram' | 'cartesia' | 'elevenlabs';

const VOICE_ENV: Record<VoiceProviderKey, string> = {
  deepgram: 'DEEPGRAM_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

export async function getVoiceProviderKey(
  workspaceId: string,
  provider: VoiceProviderKey,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      apiKeyCiphertext: providerCredential.apiKeyCiphertext,
      apiKeyIv: providerCredential.apiKeyIv,
      apiKeyTag: providerCredential.apiKeyTag,
    })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, workspaceId),
        eq(providerCredential.provider, provider),
      ),
    )
    .orderBy(desc(providerCredential.isDefault), desc(providerCredential.updatedAt))
    .limit(1);

  if (row) {
    try {
      return open({
        ciphertext: row.apiKeyCiphertext,
        iv: row.apiKeyIv,
        tag: row.apiKeyTag,
      });
    } catch {
      // Sealed row exists but ENCRYPTION_KEY can't open it — fall through to env.
    }
  }
  return process.env[VOICE_ENV[provider]] ?? null;
}

export async function requireVoiceProviderKey(
  workspaceId: string,
  provider: VoiceProviderKey,
): Promise<{ key: string } | { error: 'no_voice_credential'; provider: VoiceProviderKey }> {
  const key = await getVoiceProviderKey(workspaceId, provider);
  if (!key) return { error: 'no_voice_credential', provider };
  return { key };
}
