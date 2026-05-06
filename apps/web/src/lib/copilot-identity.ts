import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { open, getCopilotUser, type CopilotUser } from '@metu/ai';

/**
 * Resolve the GitHub account behind a workspace's Copilot connection.
 * Returns null if Copilot isn't connected or the token is invalid.
 */
export async function loadCopilotIdentity(workspaceId: string): Promise<CopilotUser | null> {
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
        eq(providerCredential.provider, 'copilot'),
      ),
    )
    .limit(1);
  if (!row) return null;
  try {
    const ghToken = open({
      ciphertext: row.apiKeyCiphertext,
      iv: row.apiKeyIv,
      tag: row.apiKeyTag,
    });
    return await getCopilotUser(ghToken);
  } catch {
    return null;
  }
}
