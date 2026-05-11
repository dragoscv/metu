'use server';

import { auth } from '@metu/auth';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy } from '@metu/db/schema';
import { revalidatePath } from 'next/cache';
import { inngest } from '@/inngest/client';

const PRESETS = {
  observe: {
    defaultMode: 'observe' as const,
    enabled: true,
    dailyCostCapUsd: 0,
    dailyActionCap: 0,
    notificationLevel: 20,
  },
  ask: {
    defaultMode: 'ask' as const,
    enabled: true,
    dailyCostCapUsd: 2,
    dailyActionCap: 50,
    notificationLevel: 40,
  },
  autopilot: {
    defaultMode: 'auto_with_undo' as const,
    enabled: true,
    dailyCostCapUsd: 10,
    dailyActionCap: 200,
    notificationLevel: 60,
  },
} as const;

const schema = z.object({ preset: z.enum(['observe', 'ask', 'autopilot']) });

export async function applyAutonomyPresetAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; preset: keyof typeof PRESETS } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };

  const cfg = PRESETS[parsed.data.preset];
  const db = getDb();
  const workspaceId = session.user.workspaceId;

  await db
    .insert(agentPolicy)
    .values({ workspaceId, ...cfg })
    .onConflictDoUpdate({
      target: agentPolicy.workspaceId,
      set: { ...cfg, updatedAt: sql`now()` },
    });

  await inngest
    .send({
      name: 'conductor/observe',
      data: {
        workspaceId,
        userId: session.user.id,
        eventKind: 'autonomy.preset.applied',
        payload: { preset: parsed.data.preset },
      },
    })
    .catch(() => null);

  revalidatePath('/settings/agents');
  return { ok: true, preset: parsed.data.preset };
}
