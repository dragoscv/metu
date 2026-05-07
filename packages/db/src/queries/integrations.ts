/**
 * Integration queries — tenant-scoped.
 * AES-256-GCM auth tag is stored inside `config.tokenTag` to avoid a
 * dedicated column (the integration table predates the tag split used by
 * provider_credential).
 */
import { and, asc, desc, eq, ne } from 'drizzle-orm';
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
  isDefault: boolean;
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
      isDefault: integration.isDefault,
      lastSyncAt: integration.lastSyncAt,
      lastError: integration.lastError,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    })
    .from(integration)
    .where(eq(integration.workspaceId, workspaceId))
    .orderBy(asc(integration.kind), desc(integration.isDefault), asc(integration.createdAt));
  return rows as IntegrationRow[];
}

export async function listIntegrationsByKind(
  workspaceId: string,
  kind: IntegrationKindRow,
): Promise<IntegrationRow[]> {
  const all = await listIntegrations(workspaceId);
  return all.filter((r) => r.kind === kind);
}

export async function getIntegrationByKind(workspaceId: string, kind: IntegrationKindRow) {
  const db = getDb();
  const rows = await db
    .select()
    .from(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.kind, kind)))
    .orderBy(desc(integration.isDefault), asc(integration.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the user's preferred account for `kind` — the row marked `isDefault`,
 * or the oldest active row when none is flagged. Use this anywhere you need
 * to pick "the" GitHub/Stripe/etc. when several are connected.
 */
export async function getDefaultIntegration(workspaceId: string, kind: IntegrationKindRow) {
  const db = getDb();
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, kind),
        eq(integration.status, 'active'),
      ),
    )
    .orderBy(desc(integration.isDefault), asc(integration.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Atomically promote one row and demote any other default for the same kind. */
export async function setDefaultIntegration(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const db = getDb();
  const target = await db
    .select({ id: integration.id, kind: integration.kind })
    .from(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.id, id)))
    .limit(1);
  const row = target[0];
  if (!row) return { ok: false };

  await db
    .update(integration)
    .set({ isDefault: false })
    .where(
      and(
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, row.kind),
        ne(integration.id, id),
      ),
    );
  await db
    .update(integration)
    .set({ isDefault: true })
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.id, id)));
  return { ok: true };
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

  // First connection of this kind in the workspace becomes the default.
  const peers = await db
    .select({ id: integration.id })
    .from(integration)
    .where(and(eq(integration.workspaceId, input.workspaceId), eq(integration.kind, input.kind)))
    .limit(1);
  const isDefault = peers.length === 0;

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
      isDefault,
      lastSyncAt: new Date(),
    })
    .returning();
  return inserted[0]!.id;
}

export async function deleteIntegrationById(workspaceId: string, id: string) {
  const db = getDb();
  // Capture the row first so we can pick a new default if we just deleted it.
  const existing = await db
    .select({ kind: integration.kind, isDefault: integration.isDefault })
    .from(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.id, id)))
    .limit(1);

  await db
    .delete(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.id, id)));

  if (existing[0]?.isDefault) {
    const next = await db
      .select({ id: integration.id })
      .from(integration)
      .where(and(eq(integration.workspaceId, workspaceId), eq(integration.kind, existing[0].kind)))
      .orderBy(asc(integration.createdAt))
      .limit(1);
    if (next[0]) {
      await db.update(integration).set({ isDefault: true }).where(eq(integration.id, next[0].id));
    }
  }
}
