'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { seal } from '@metu/ai/crypto';
import { createOauthApp, deleteOauthApp, deleteOauthConnection } from '@metu/db/queries';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { discoverOidc } from '@/lib/oauth/discover';
import { callbackUrl } from '@/lib/oauth/pkce';
import { assertSafeOutboundUrl } from '@/lib/safe-equal';

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(slugRegex, 'Use lowercase letters, digits, dashes (max 40 chars)'),
  authorizeUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userinfoUrl: z.string().url().optional().or(z.literal('')),
  revokeUrl: z.string().url().optional().or(z.literal('')),
  discoveryUrl: z.string().url().optional().or(z.literal('')),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(2000),
  scopes: z.string().max(500).optional().default(''),
  pkce: z.boolean().optional().default(true),
});

export interface DiscoverResult {
  ok: boolean;
  endpoints?: {
    authorizeUrl?: string;
    tokenUrl?: string;
    userinfoUrl?: string;
    revokeUrl?: string;
    issuer?: string;
    scopesSupported?: string[];
    grantTypesSupported?: string[];
    codeChallengeMethodsSupported?: string[];
  };
  error?: string;
}

export async function discoverOauthAppAction(rawUrl: string): Promise<DiscoverResult> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = z.string().url().safeParse(rawUrl);
  if (!parsed.success) return { ok: false, error: 'Invalid URL' };
  try {
    await assertSafeOutboundUrl(parsed.data);
    const d = await discoverOidc(parsed.data);
    return {
      ok: true,
      endpoints: {
        authorizeUrl: d.authorizationEndpoint,
        tokenUrl: d.tokenEndpoint,
        userinfoUrl: d.userinfoEndpoint,
        revokeUrl: d.revocationEndpoint,
        issuer: d.issuer,
        scopesSupported: d.scopesSupported,
        grantTypesSupported: d.grantTypesSupported,
        codeChallengeMethodsSupported: d.codeChallengeMethodsSupported,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Discovery failed',
    };
  }
}

export interface CreateOauthAppResult {
  ok: boolean;
  appId?: string;
  callbackUrl?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createOauthAppAction(formData: FormData): Promise<CreateOauthAppResult> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };

  const raw = {
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? '')
      .toLowerCase()
      .trim(),
    authorizeUrl: String(formData.get('authorizeUrl') ?? '').trim(),
    tokenUrl: String(formData.get('tokenUrl') ?? '').trim(),
    userinfoUrl: String(formData.get('userinfoUrl') ?? '').trim(),
    revokeUrl: String(formData.get('revokeUrl') ?? '').trim(),
    discoveryUrl: String(formData.get('discoveryUrl') ?? '').trim(),
    clientId: String(formData.get('clientId') ?? '').trim(),
    clientSecret: String(formData.get('clientSecret') ?? ''),
    scopes: String(formData.get('scopes') ?? '').trim(),
    pkce: formData.get('pkce') !== 'false',
  };

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: 'Validation failed', fieldErrors };
  }

  const sealed = seal(parsed.data.clientSecret);

  const appId = await createOauthApp({
    workspaceId: session.user.workspaceId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    discoveryUrl: parsed.data.discoveryUrl || null,
    authorizeUrl: parsed.data.authorizeUrl,
    tokenUrl: parsed.data.tokenUrl,
    userinfoUrl: parsed.data.userinfoUrl || null,
    revokeUrl: parsed.data.revokeUrl || null,
    clientId: parsed.data.clientId,
    clientSecretCiphertext: sealed.ciphertext,
    clientSecretIv: sealed.iv,
    clientSecretTag: sealed.tag,
    scopes: parsed.data.scopes ?? '',
    pkce: parsed.data.pkce ?? true,
  });

  await getDb()
    .insert(timelineEvent)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: 'oauth_app.created',
      title: `Created OAuth app “${parsed.data.name}”`,
      payload: { appId, slug: parsed.data.slug, tokenUrl: parsed.data.tokenUrl },
      importance: 0.7,
    });

  revalidatePath('/integrations');
  return { ok: true, appId, callbackUrl: callbackUrl(appId) };
}

export async function deleteOauthAppAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' as const };
  await deleteOauthApp(session.user.workspaceId, id);
  await getDb()
    .insert(timelineEvent)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: 'oauth_app.deleted',
      title: 'Deleted OAuth app',
      payload: { appId: id },
      importance: 0.7,
    });
  revalidatePath('/integrations');
  return { ok: true as const };
}

export async function deleteOauthConnectionAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' as const };
  await deleteOauthConnection(session.user.workspaceId, id);
  await getDb()
    .insert(timelineEvent)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: 'oauth_connection.removed',
      title: 'Disconnected OAuth identity',
      payload: { connectionId: id },
      importance: 0.6,
    });
  revalidatePath('/integrations');
  return { ok: true as const };
}
