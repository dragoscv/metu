/**
 * External MCP server registration.
 *
 * Lets a user wire notai/mmo (or any MCP-compatible second-brain) into METU
 * so the Conductor can call their tools. We test the connection synchronously
 * before persisting so bad URLs fail loud.
 */
'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { integration } from '@metu/db/schema';
import { listRemoteTools, sealToken, type ExternalMcpConfig } from '@metu/integrations/mcp';
import { assertSafeOutboundUrl } from '@/lib/safe-equal';

const inputSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().url(),
  token: z.string().optional(),
  toolPrefix: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'lowercase a-z 0-9 _ only'),
  toolAllowlist: z.array(z.string()).optional(),
});

export async function connectExternalMcpAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true; id: string; tools: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }

  // SSRF guard — reject loopback / RFC1918 / metadata IPs and enforce https in prod.
  try {
    assertSafeOutboundUrl(parsed.data.url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid url' };
  }

  const config: ExternalMcpConfig = {
    url: parsed.data.url,
    tokenSealed: parsed.data.token ? sealToken(parsed.data.token) : null,
    toolPrefix: parsed.data.toolPrefix,
    toolAllowlist: parsed.data.toolAllowlist,
  };

  // Test the connection now — bad URL/token should fail before persisting.
  const probe = await listRemoteTools(config);
  if (!probe.ok) return { ok: false, error: `connection failed: ${probe.error}` };

  config.lastTools = probe.tools.map((t) => ({ name: t.name, description: t.description }));

  const db = getDb();
  const externalId = new URL(parsed.data.url).host;
  const [row] = await db
    .insert(integration)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: 'external_mcp',
      externalId,
      label: parsed.data.label,
      status: 'active',
      config: config as unknown as Record<string, unknown>,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [integration.workspaceId, integration.kind, integration.externalId],
      set: {
        label: parsed.data.label,
        status: 'active',
        config: config as unknown as Record<string, unknown>,
        lastSyncAt: new Date(),
        lastError: null,
      },
    })
    .returning();

  revalidatePath('/integrations');
  return { ok: true, id: row!.id, tools: probe.tools.length };
}

export async function refreshExternalMcpAction(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: 'unauthorized' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, id),
        eq(integration.workspaceId, session.user.workspaceId),
        eq(integration.kind, 'external_mcp'),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: 'not_found' };

  const cfg = row.config as unknown as ExternalMcpConfig;
  const probe = await listRemoteTools(cfg);
  if (!probe.ok) {
    await db
      .update(integration)
      .set({ status: 'error', lastError: probe.error })
      .where(eq(integration.id, id));
    return { ok: false as const, error: probe.error };
  }
  const next: ExternalMcpConfig = {
    ...cfg,
    lastTools: probe.tools.map((t) => ({ name: t.name, description: t.description })),
  };
  await db
    .update(integration)
    .set({
      config: next as unknown as Record<string, unknown>,
      status: 'active',
      lastSyncAt: new Date(),
      lastError: null,
    })
    .where(eq(integration.id, id));
  revalidatePath('/integrations');
  return { ok: true as const, tools: probe.tools.length };
}

export async function removeExternalMcpAction(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: 'unauthorized' };
  const db = getDb();
  await db
    .delete(integration)
    .where(
      and(
        eq(integration.id, id),
        eq(integration.workspaceId, session.user.workspaceId),
        eq(integration.kind, 'external_mcp'),
      ),
    );
  revalidatePath('/integrations');
  return { ok: true as const };
}
