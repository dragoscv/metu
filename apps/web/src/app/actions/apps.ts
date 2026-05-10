'use server';
import { revalidatePath } from 'next/cache';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { hashToken, parseScopes, randomToken, scopesAllowed } from '@metu/auth/oauth';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken, timelineEvent } from '@metu/db/schema';
import { issueToken } from '@/lib/oauth-provider';
import { assertSafeOutboundUrl } from '@/lib/safe-equal';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);

const registerSchema = z.object({
  name: z.string().min(2).max(64),
  type: z.enum(['first_party', 'third_party', 'public']).default('first_party'),
  redirectUris: z
    .array(z.string().url().max(500))
    .min(1, 'At least one redirect URI is required.')
    .max(10),
  scopes: z.string().max(500).default('openid profile capture:write recall:read notify:write'),
  iconUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
});

export interface RegisterAppResult {
  ok: true;
  clientId: string;
  /** Plain-text secret. SHOWN ONCE to the user — never returned again. */
  clientSecret: string | null;
  webhookSecret: string | null;
}

export async function registerAppAction(
  input: z.infer<typeof registerSchema>,
): Promise<RegisterAppResult | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  // SSRF guard on outbound webhook URL.
  if (parsed.data.webhookUrl) {
    try {
      assertSafeOutboundUrl(parsed.data.webhookUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'invalid webhook url' };
    }
  }
  const db = getDb();
  const wsId = session.user.workspaceId;

  const clientIdSlug = `${slugify(parsed.data.name)}-${randomToken(6)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)}`;
  const clientIdValue = `metu_app_${clientIdSlug}`;

  const isPublic = parsed.data.type === 'public';
  const clientSecretRaw = isPublic ? null : 'metu_cs_' + randomToken(32);
  const webhookSecretRaw = parsed.data.webhookUrl ? 'metu_wh_' + randomToken(24) : null;

  await db.insert(oauthClient).values({
    workspaceId: wsId,
    clientId: clientIdValue,
    clientSecretHash: clientSecretRaw ? hashToken(clientSecretRaw) : null,
    type: parsed.data.type,
    name: parsed.data.name,
    iconUrl: parsed.data.iconUrl ?? null,
    redirectUris: parsed.data.redirectUris,
    allowedScopes: parsed.data.scopes,
    webhookUrl: parsed.data.webhookUrl ?? null,
    // Store only the hash; the plaintext is returned to the user once below.
    webhookSecretHash: webhookSecretRaw ? hashToken(webhookSecretRaw) : null,
  });

  await db.insert(timelineEvent).values({
    workspaceId: wsId,
    userId: session.user.id,
    kind: 'app.registered',
    title: `Registered app “${parsed.data.name}”`,
    payload: {
      clientId: clientIdValue,
      type: parsed.data.type,
      redirectUris: parsed.data.redirectUris,
      scopes: parsed.data.scopes,
      hasWebhook: !!parsed.data.webhookUrl,
    },
    importance: 0.7,
  });

  revalidatePath('/apps');
  return {
    ok: true,
    clientId: clientIdValue,
    clientSecret: clientSecretRaw,
    webhookSecret: webhookSecretRaw,
  };
}

export async function revokeAppAction(clientUuid: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(oauthClient)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(oauthClient.id, clientUuid), eq(oauthClient.workspaceId, session.user.workspaceId)),
    );
  // Revoke all outstanding tokens for the client.
  await db
    .update(oauthToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthToken.clientId, clientUuid), isNull(oauthToken.revokedAt)));
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'app.revoked',
    title: 'Revoked OAuth app',
    payload: { clientUuid },
    importance: 0.8,
  });
  revalidatePath('/apps');
  return { ok: true as const };
}

export async function rotateClientSecretAction(clientUuid: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [client] = await db
    .select()
    .from(oauthClient)
    .where(
      and(eq(oauthClient.id, clientUuid), eq(oauthClient.workspaceId, session.user.workspaceId)),
    )
    .limit(1);
  if (!client) return { ok: false as const, error: 'Not found' };
  if (client.type === 'public') {
    return { ok: false as const, error: 'Public clients have no secret.' };
  }
  const next = 'metu_cs_' + randomToken(32);
  await db
    .update(oauthClient)
    .set({ clientSecretHash: hashToken(next) })
    .where(
      and(eq(oauthClient.id, clientUuid), eq(oauthClient.workspaceId, session.user.workspaceId)),
    );
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'app.secret_rotated',
    title: 'Rotated OAuth client secret',
    payload: { clientUuid },
    importance: 0.8,
  });
  revalidatePath('/apps');
  return { ok: true as const, clientSecret: next };
}

const verifyDeviceSchema = z.object({
  userCode: z.string().min(4).max(20),
  decision: z.enum(['allow', 'deny']),
});

export async function verifyDeviceCodeAction(input: z.infer<typeof verifyDeviceSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = verifyDeviceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  const db = getDb();
  const code = parsed.data.userCode.trim().toUpperCase();
  const [row] = await db
    .select()
    .from(oauthToken)
    .where(
      and(
        eq(oauthToken.userCode, code),
        eq(oauthToken.kind, 'device_code'),
        isNull(oauthToken.consumedAt),
        isNull(oauthToken.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: 'Code not found or already used.' };
  if (row.expiresAt < new Date()) {
    return { ok: false as const, error: 'Code expired. Restart the device pairing.' };
  }
  if (row.workspaceId !== session.user.workspaceId) {
    return { ok: false as const, error: 'This code was issued in a different workspace.' };
  }
  if (parsed.data.decision === 'deny') {
    await db
      .update(oauthToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthToken.id, row.id), eq(oauthToken.workspaceId, session.user.workspaceId)));
    return { ok: true as const, decision: 'denied' as const };
  }
  // Approve: bind the user_id so the device's polling token call succeeds.
  await db
    .update(oauthToken)
    .set({ userId: session.user.id })
    .where(and(eq(oauthToken.id, row.id), eq(oauthToken.workspaceId, session.user.workspaceId)));
  return { ok: true as const, decision: 'allowed' as const };
}

// ─── Personal access tokens ────────────────────────────────────────────────
//
// Long-lived `metu_at_*` access tokens minted from the cookie-authenticated
// /apps UI. Used by headless clients that can't run a device flow (notably
// the MCP server, which needs ONE token in mcp.json). The token is bound to
// the calling user, scoped to the chosen oauthClient, and resolved by the
// same `findActiveTokenByHash` path SDK routes already use.
//
// Security:
//   - Only the row hash is stored; plaintext returned once.
//   - TTL capped at 365d (force rotation; long-lived tokens are a footgun).
//   - Scopes can't exceed the oauthClient's `allowedScopes` allowlist.

const mintTokenSchema = z.object({
  clientUuid: z.string().uuid(),
  scopes: z.string().max(500).optional(),
  ttlDays: z.number().int().min(1).max(365).default(90),
});

export async function mintAccessTokenAction(input: z.infer<typeof mintTokenSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = mintTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  const db = getDb();
  const [client] = await db
    .select()
    .from(oauthClient)
    .where(
      and(
        eq(oauthClient.id, parsed.data.clientUuid),
        eq(oauthClient.workspaceId, session.user.workspaceId),
        isNull(oauthClient.revokedAt),
      ),
    )
    .limit(1);
  if (!client) return { ok: false as const, error: 'App not found.' };

  const allowed = parseScopes(client.allowedScopes);
  const requested = parsed.data.scopes ? parseScopes(parsed.data.scopes) : allowed;
  const check = scopesAllowed(requested, allowed);
  if (!check.ok) {
    return { ok: false as const, error: `scopes not in allowlist: ${check.missing.join(' ')}` };
  }
  if (requested.length === 0) {
    return { ok: false as const, error: 'At least one scope required.' };
  }

  const issued = await issueToken({
    workspaceId: session.user.workspaceId,
    clientUuid: client.id,
    userId: session.user.id,
    kind: 'access_token',
    scopes: requested,
    ttlSeconds: parsed.data.ttlDays * 24 * 60 * 60,
    metadata: { mintedFrom: 'apps_ui', mintedBy: session.user.id },
  });

  revalidatePath('/apps');
  return {
    ok: true as const,
    token: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
    scopes: requested.join(' '),
  };
}
