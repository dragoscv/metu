'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { seal, startDeviceFlow, pollDeviceFlow } from '@metu/ai';
import { upsertIntegration } from '@metu/db/queries';
import { integrationKindSchema, type IntegrationKind } from '@metu/types';
import { deviceFlowConfig } from '@/lib/integrations/connect-methods';
import { verifyIntegrationToken } from '@/lib/integrations/verifiers';

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

interface StartDeviceFlowData {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

/**
 * Kick off a device-code flow against the integration's OAuth provider.
 * Currently GitHub-only (since it's the only provider whose device flow
 * doesn't need a client secret).
 */
export async function startIntegrationDeviceFlowAction(
  rawKind: string,
): Promise<Result<StartDeviceFlowData>> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const kindParse = integrationKindSchema.safeParse(rawKind);
  if (!kindParse.success) return { ok: false, error: 'Invalid integration kind' };
  const cfg = deviceFlowConfig(kindParse.data);
  if (!cfg) {
    return {
      ok: false,
      error: `Device flow not configured for ${kindParse.data}. Set the corresponding *_OAUTH_CLIENT_ID env var.`,
    };
  }
  try {
    const flow = await startDeviceFlow({ clientId: cfg.clientId, scope: cfg.scope });
    return {
      ok: true,
      data: {
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        deviceCode: flow.deviceCode,
        interval: flow.interval,
        expiresIn: flow.expiresIn,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to start device flow',
    };
  }
}

interface PollData {
  status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'ok';
  externalId?: string;
  label?: string;
}

export async function pollIntegrationDeviceFlowAction(
  rawKind: string,
  deviceCode: string,
): Promise<Result<PollData>> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const kindParse = integrationKindSchema.safeParse(rawKind);
  if (!kindParse.success) return { ok: false, error: 'Invalid integration kind' };
  const kind: IntegrationKind = kindParse.data;
  const cfg = deviceFlowConfig(kind);
  if (!cfg) return { ok: false, error: 'Device flow not configured' };
  if (!deviceCode || typeof deviceCode !== 'string') {
    return { ok: false, error: 'Invalid device code' };
  }

  const result = await pollDeviceFlow(deviceCode, { clientId: cfg.clientId });
  if (result.status !== 'ok') {
    return { ok: true, data: { status: result.status } };
  }

  // Verify the token actually works against the provider's API and resolve
  // identity (login + display name).
  const verify = await verifyIntegrationToken(kind, result.accessToken);
  if (!verify.ok) {
    return { ok: false, error: verify.error };
  }

  const sealed = seal(result.accessToken);
  try {
    await upsertIntegration({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind,
      externalId: verify.externalId,
      label: verify.label,
      tokenCiphertext: sealed.ciphertext,
      tokenIv: sealed.iv,
      tokenTag: sealed.tag,
      config: { ...verify.metadata, connectedVia: 'device-flow' },
    });
    revalidatePath('/integrations');
    return {
      ok: true,
      data: {
        status: 'ok',
        externalId: verify.externalId,
        label: verify.label,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save integration',
    };
  }
}
