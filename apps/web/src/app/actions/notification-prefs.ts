'use server';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { agentPolicy } from '@metu/db/schema';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const NotificationPrefsSchema = z.object({
  quietHours: z
    .object({
      enabled: z.boolean(),
      start: TIME,
      end: TIME,
      tz: z.string().min(1).max(64),
    })
    .nullable()
    .optional(),
  mutedChannels: z.array(z.enum(['ws', 'web_push', 'expo'])).optional(),
});

export type NotificationPrefsInput = z.infer<typeof NotificationPrefsSchema>;

export interface NotificationPrefs {
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
  mutedChannels: Array<'ws' | 'web_push' | 'expo'>;
}

// Not exported — `'use server'` files may only export async functions.
// Callers needing the default should call `getNotificationPrefsAction()`.
const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  quietHours: { enabled: false, start: '22:00', end: '08:00', tz: 'Europe/Bucharest' },
  mutedChannels: [],
};

export async function getNotificationPrefsAction(): Promise<NotificationPrefs> {
  const session = await auth();
  if (!session) return DEFAULT_NOTIFICATION_PREFS;
  const db = getDb();
  const [row] = await db
    .select({ quietHours: agentPolicy.quietHours, metadata: agentPolicy.metadata })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, session.user.workspaceId))
    .limit(1);
  const qh = (row?.quietHours ?? {}) as Partial<NotificationPrefs['quietHours']>;
  const meta = (row?.metadata ?? {}) as { mutedChannels?: NotificationPrefs['mutedChannels'] };
  return {
    quietHours: { ...DEFAULT_NOTIFICATION_PREFS.quietHours, ...qh },
    mutedChannels: meta.mutedChannels ?? [],
  };
}

export async function updateNotificationPrefsAction(input: NotificationPrefsInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'unauthenticated' };
  const parsed = NotificationPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  const db = getDb();
  const wsId = session.user.workspaceId;

  const [existing] = await db
    .select({ id: agentPolicy.id })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, wsId))
    .limit(1);

  if (!existing) {
    await db.insert(agentPolicy).values({
      workspaceId: wsId,
      quietHours: parsed.data.quietHours ?? {},
      metadata: parsed.data.mutedChannels ? { mutedChannels: parsed.data.mutedChannels } : {},
    });
  } else {
    const patch: Record<string, unknown> = {};
    if (parsed.data.quietHours !== undefined) {
      patch.quietHours = parsed.data.quietHours ?? {};
    }
    if (parsed.data.mutedChannels !== undefined) {
      // Merge into existing metadata so we don't blow away unrelated keys.
      patch.metadata = sql`jsonb_set(coalesce(${agentPolicy.metadata}, '{}'::jsonb), '{mutedChannels}', ${JSON.stringify(parsed.data.mutedChannels)}::jsonb, true)`;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(agentPolicy).set(patch).where(eq(agentPolicy.workspaceId, wsId));
    }
  }

  revalidatePath('/settings/notifications');
  return { ok: true as const };
}
