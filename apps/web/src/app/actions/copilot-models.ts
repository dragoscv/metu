'use server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { open, listCopilotModels, type CopilotModel } from '@metu/ai';

export interface CopilotModelOption {
  id: string;
  name: string;
  vendor: string;
  family: string;
  preview: boolean;
  supportsToolCalls: boolean;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
}

export async function listCopilotModelsAction(): Promise<
  { ok: true; models: CopilotModelOption[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
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
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, 'copilot'),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: 'Copilot not connected' };
  try {
    const ghToken = open({
      ciphertext: row.apiKeyCiphertext,
      iv: row.apiKeyIv,
      tag: row.apiKeyTag,
    });
    const models = await listCopilotModels(ghToken);
    const enabled: CopilotModel[] = models.filter((m) => m.enabled);
    return {
      ok: true,
      models: enabled.map((m) => ({
        id: m.id,
        name: m.name,
        vendor: m.vendor,
        family: m.family,
        preview: m.preview,
        supportsToolCalls: m.supportsToolCalls,
        supportsVision: m.supportsVision,
        supportsEmbeddings: m.supportsEmbeddings,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to list models',
    };
  }
}
