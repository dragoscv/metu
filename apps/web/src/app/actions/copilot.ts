'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { providerCredential } from '@metu/db/schema';
import { seal, startDeviceFlow, pollDeviceFlow, getCopilotSession } from '@metu/ai';

export async function startCopilotConnect() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  try {
    const flow = await startDeviceFlow();
    return {
      ok: true as const,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      deviceCode: flow.deviceCode,
      interval: flow.interval,
      expiresIn: flow.expiresIn,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : 'Failed to start device flow',
    };
  }
}

export async function pollCopilotConnect(deviceCode: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (!deviceCode || typeof deviceCode !== 'string') {
    return { ok: false as const, error: 'Invalid device code' };
  }

  const result = await pollDeviceFlow(deviceCode);
  if (result.status !== 'ok') {
    return { ok: true as const, status: result.status };
  }

  // Verify we can actually mint a Copilot session token before persisting.
  let endpoint: string;
  try {
    const s = await getCopilotSession(result.accessToken);
    endpoint = s.endpoint;
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error
          ? `Copilot subscription check failed: ${err.message}`
          : 'No active Copilot subscription on this GitHub account',
    };
  }

  const sealed = seal(result.accessToken);
  const db = getDb();
  const existing = await db
    .select({ id: providerCredential.id })
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, 'copilot'),
        eq(providerCredential.label, 'github-copilot'),
      ),
    )
    .limit(1);

  const values = {
    apiKeyCiphertext: sealed.ciphertext,
    apiKeyIv: sealed.iv,
    apiKeyTag: sealed.tag,
    endpoint,
    config: { endpoint, connectedAt: Date.now() },
    isDefault: 1,
  } as const;

  if (existing[0]) {
    await db
      .update(providerCredential)
      .set(values)
      .where(eq(providerCredential.id, existing[0].id));
  } else {
    await db.insert(providerCredential).values({
      workspaceId: session.user.workspaceId,
      provider: 'copilot',
      label: 'github-copilot',
      ...values,
    });
  }

  revalidatePath('/settings');
  return { ok: true as const, status: 'ok' as const };
}

export async function disconnectCopilot() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, session.user.workspaceId),
        eq(providerCredential.provider, 'copilot'),
      ),
    );
  revalidatePath('/settings');
  return { ok: true as const };
}
