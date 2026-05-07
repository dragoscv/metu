'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { seal } from '@metu/ai';
import { upsertIntegration, deleteIntegrationById, setDefaultIntegration } from '@metu/db/queries';
import {
  connectIntegrationSchema,
  disconnectIntegrationSchema,
  type ConnectIntegrationInput,
  type DisconnectIntegrationInput,
} from '@metu/types';
import { z } from 'zod';
import { verifyIntegrationToken } from '@/lib/integrations/verifiers';
import { inngest } from '@/inngest/client';

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

export async function connectIntegrationAction(
  input: ConnectIntegrationInput,
): Promise<ActionResult<{ id: string; externalId: string; label: string }>> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };

  const parsed = connectIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const verify = await verifyIntegrationToken(parsed.data.kind, parsed.data.token);
  if (!verify.ok) return { ok: false, error: verify.error };

  const sealed = seal(parsed.data.token);
  try {
    const id = await upsertIntegration({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: parsed.data.kind,
      externalId: verify.externalId,
      label: parsed.data.label?.trim() || verify.label,
      tokenCiphertext: sealed.ciphertext,
      tokenIv: sealed.iv,
      tokenTag: sealed.tag,
      config: verify.metadata,
    });
    revalidatePath('/integrations');
    // Wake the conductor — a new integration usually unlocks new tools.
    await inngest
      .send({
        name: 'conductor/observe',
        data: {
          workspaceId: session.user.workspaceId,
          eventKind: 'integration.connected',
          payload: {
            integrationId: id,
            kind: parsed.data.kind,
            externalId: verify.externalId,
            label: verify.label,
          },
        },
      })
      .catch(() => {});
    return {
      ok: true,
      data: { id, externalId: verify.externalId, label: verify.label },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save integration',
    };
  }
}

export async function disconnectIntegrationAction(
  input: DisconnectIntegrationInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = disconnectIntegrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid id' };
  try {
    await deleteIntegrationById(session.user.workspaceId, parsed.data.id);
    revalidatePath('/integrations');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to disconnect',
    };
  }
}

const setDefaultSchema = z.object({ id: z.string().uuid() });
export type SetDefaultIntegrationInput = z.infer<typeof setDefaultSchema>;

export async function setDefaultIntegrationAction(
  input: SetDefaultIntegrationInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = setDefaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid id' };
  try {
    const r = await setDefaultIntegration(session.user.workspaceId, parsed.data.id);
    if (!r.ok) return { ok: false, error: 'Integration not found' };
    revalidatePath('/integrations');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to set default',
    };
  }
}
