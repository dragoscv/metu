/**
 * Integration queries — tenant-scoped.
 * AES-256-GCM auth tag is stored inside `config.tokenTag` to avoid a
 * dedicated column (the integration table predates the tag split used by
 * provider_credential).
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { integration } from '../schema';

type IntegrationKindRow =
  | 'github'
  | 'google'
  | 'gmail'
  | 'gcal'
  | 'telegram'
  | 'whatsapp'
  | 'stripe'
  | 'vercel'
  | 'firebase'
  | 'spotify'
  | 'slack'
  | 'notion'
  | 'linear'
  | 'browser'
  | 'vscode'
  | 'webhook'
  | 'external_mcp';

type IntegrationStatusRow = 'active' | 'paused' | 'error' | 'revoked';

export interface IntegrationRow {
  id: string;
  workspaceId: string;
  userId: string | null;
  kind: IntegrationKindRow;
  externalId: string;
  label: string;
  status: IntegrationStatusRow;
  expiresAt: Date | null;
  config: Record<string, unknown>;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listIntegrations(workspaceId: string): Promise<IntegrationRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: integration.id,
      workspaceId: integration.workspaceId,
      userId: integration.userId,
      kind: integration.kind,
      externalId: integration.externalId,
      label: integration.label,
      status: integration.status,
      expiresAt: integration.expiresAt,
      config: integration.config,
      lastSyncAt: integration.lastSyncAt,
      lastError: integration.lastError,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    })
    .from(integration)
    .where(eq(integration.workspaceId, workspaceId))
    .orderBy(asc(integration.kind));
  return rows as IntegrationRow[];
}

export async function getIntegrationByKind(workspaceId: string, kind: IntegrationKindRow) {
  const db = getDb();
  const rows = await db
    .select()
    .from(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.kind, kind)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertIntegrationInput {
  workspaceId: string;
  userId: string;
  kind: IntegrationKindRow;
  externalId: string;
  label: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  config?: Record<string, unknown>;
}

export async function upsertIntegration(input: UpsertIntegrationInput) {
  const db = getDb();
  const config = { ...(input.config ?? {}), tokenTag: input.tokenTag };
  const existing = await db
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, input.workspaceId),
        eq(integration.kind, input.kind),
        eq(integration.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(integration)
      .set({
        userId: input.userId,
        label: input.label,
        status: 'active',
        tokenCiphertext: input.tokenCiphertext,
        tokenIv: input.tokenIv,
        config,
        lastError: null,
        lastSyncAt: new Date(),
      })
      .where(eq(integration.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(integration)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: input.kind,
      externalId: input.externalId,
      label: input.label,
      status: 'active',
      tokenCiphertext: input.tokenCiphertext,
      tokenIv: input.tokenIv,
      config,
      lastSyncAt: new Date(),
    })
    .returning();
  return inserted[0]!.id;
}

export async function deleteIntegrationById(workspaceId: string, id: string) {
  const db = getDb();
  await db
    .delete(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.id, id)));
}
