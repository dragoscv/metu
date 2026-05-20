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
  /**
   * Per-source mute prefixes. Match a notification when its `source`
   * starts with any entry, OR when any of its inferred kinds (from
   * metadata.kinds[]) starts with one. e.g. `'integration:github'`,
   * `'device.vscode'`, `'browser-ext'`.
   */
  mutedSources: z.array(z.string().min(1).max(120)).optional(),
  digestEmail: z.boolean().optional(),
});

export type NotificationPrefsInput = z.infer<typeof NotificationPrefsSchema>;

export interface NotificationPrefs {
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
  mutedChannels: Array<'ws' | 'web_push' | 'expo'>;
  mutedSources: string[];
  digestEmail: boolean;
}

// Not exported — `'use server'` files may only export async functions.
// Callers needing the default should call `getNotificationPrefsAction()`.
const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  quietHours: { enabled: false, start: '22:00', end: '08:00', tz: 'Europe/Bucharest' },
  mutedChannels: [],
  mutedSources: [],
  digestEmail: true,
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
  const meta = (row?.metadata ?? {}) as {
    mutedChannels?: NotificationPrefs['mutedChannels'];
    mutedSources?: NotificationPrefs['mutedSources'];
    digestEmail?: boolean;
  };
  return {
    quietHours: { ...DEFAULT_NOTIFICATION_PREFS.quietHours, ...qh },
    mutedChannels: meta.mutedChannels ?? [],
    mutedSources: meta.mutedSources ?? [],
    digestEmail: meta.digestEmail ?? true,
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
    const meta: Record<string, unknown> = {};
    if (parsed.data.mutedChannels) meta.mutedChannels = parsed.data.mutedChannels;
    if (parsed.data.mutedSources) meta.mutedSources = parsed.data.mutedSources;
    if (parsed.data.digestEmail !== undefined) meta.digestEmail = parsed.data.digestEmail;
    await db.insert(agentPolicy).values({
      workspaceId: wsId,
      quietHours: parsed.data.quietHours ?? {},
      metadata: meta,
    });
  } else {
    const patch: Record<string, unknown> = {};
    if (parsed.data.quietHours !== undefined) {
      patch.quietHours = parsed.data.quietHours ?? {};
    }
    if (parsed.data.mutedChannels !== undefined) {
      patch.metadata = sql`jsonb_set(coalesce(${agentPolicy.metadata}, '{}'::jsonb), '{mutedChannels}', ${JSON.stringify(parsed.data.mutedChannels)}::jsonb, true)`;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(agentPolicy).set(patch).where(eq(agentPolicy.workspaceId, wsId));
    }
    // mutedSources is patched separately so both fields can update in the
    // same call without one overwriting the other in the metadata jsonb.
    if (parsed.data.mutedSources !== undefined) {
      await db
        .update(agentPolicy)
        .set({
          metadata: sql`jsonb_set(coalesce(${agentPolicy.metadata}, '{}'::jsonb), '{mutedSources}', ${JSON.stringify(parsed.data.mutedSources)}::jsonb, true)`,
        })
        .where(eq(agentPolicy.workspaceId, wsId));
    }
    if (parsed.data.digestEmail !== undefined) {
      await db
        .update(agentPolicy)
        .set({
          metadata: sql`jsonb_set(coalesce(${agentPolicy.metadata}, '{}'::jsonb), '{digestEmail}', to_jsonb(${parsed.data.digestEmail}::boolean), true)`,
        })
        .where(eq(agentPolicy.workspaceId, wsId));
    }
  }

  revalidatePath('/settings/notifications');
  return { ok: true as const };
}
