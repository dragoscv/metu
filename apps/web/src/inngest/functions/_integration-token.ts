/**
 * Generic per-integration token unsealer. Used by sync functions for OAuth
 * providers that don't have a bespoke helper (slack/gcal/linear/reddit/
 * twitter and friends). Returns the access token + externalId, or null
 * when the integration row is missing/invalid/unsealable.
 */
import { and, eq } from 'drizzle-orm';
import { open as openSealed } from '@metu/ai';
import { log } from '@/lib/logger';
import { getDb } from '@metu/db';
import { integration } from '@metu/db/schema';

export interface IntegrationCreds {
  token: string;
  externalId: string | null;
  config: Record<string, unknown>;
}

export async function getIntegrationToken(
  workspaceId: string,
  kind: string,
  integrationId: string,
): Promise<IntegrationCreds | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, kind as never),
      ),
    )
    .limit(1);
  if (!row?.tokenCiphertext || !row.tokenIv) return null;
  const config = (row.config ?? {}) as { tokenTag?: string };
  if (!config.tokenTag) return null;
  try {
    const token = await openSealed({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: config.tokenTag,
    });
    return {
      token,
      externalId: row.externalId ?? null,
      config: (row.config ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    // Unseal failure is actionable (key rotation / corrupt row) — don't
    // swallow silently or the sync just quietly stops forever.
    log.warn('integration.token.unseal_failed', {
      workspaceId,
      integrationId,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
