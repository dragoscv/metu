/**
 * Runtime Zod schemas for Inngest event payloads.
 *
 * The `Events` map in `client.ts` is a TS-only contract — at runtime,
 * `event.data` is `unknown` and a malformed cross-service emit would
 * silently insert garbage into the DB. Each handler should call
 * `parseEvent(<name>, event.data)` once at the top to fail fast with a
 * clear error before any side effect.
 *
 * Keep this file in sync with `client.ts#Events`.
 */
import { z } from 'zod';

const wsId = z.string().uuid();
const userId = z.string().uuid();

export const eventSchemas = {
  'capture/created': z.object({
    workspaceId: wsId,
    userId,
    captureId: z.string().uuid(),
  }),
  'memory/indexed': z.object({
    workspaceId: wsId,
    sourceKind: z.string(),
    sourceId: z.string(),
    chunkCount: z.number().int().nonnegative(),
  }),
  'focus/recompute': z.object({
    workspaceId: wsId,
    userId,
    reason: z.string().optional(),
  }),
  'project/momentum-recompute': z.object({
    workspaceId: wsId,
    projectId: z.string().uuid(),
  }),
  'integration/sync': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
  }),
  'agent/run': z.object({
    workspaceId: wsId,
    userId,
    kind: z.string(),
    input: z.unknown(),
  }),
  'conductor/tick': z.object({
    workspaceId: wsId,
    reason: z.string().optional(),
  }),
  'conductor/observe': z.object({
    workspaceId: wsId,
    eventKind: z.string(),
    payload: z.unknown(),
  }),
  'conductor/approved': z.object({
    workspaceId: wsId,
    toolCallId: z.string().uuid(),
    userId,
  }),
  'conductor/rejected': z.object({
    workspaceId: wsId,
    toolCallId: z.string().uuid(),
    userId,
    reason: z.string().optional(),
  }),
  'conductor/notify': z.object({
    workspaceId: wsId,
    userId,
    title: z.string(),
    body: z.string().optional(),
    urgency: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    source: z.string().optional(),
    actionUrl: z.string().optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(['approve', 'reject', 'open', 'custom']),
        }),
      )
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  'device/connected': z.object({
    workspaceId: wsId,
    deviceId: z.string().uuid(),
  }),
  'device/disconnected': z.object({
    workspaceId: wsId,
    deviceId: z.string().uuid(),
  }),
  'device/event': z.object({
    workspaceId: wsId,
    deviceId: z.string().uuid(),
    kind: z.string(),
    payload: z.unknown(),
  }),
  'app/event': z.object({
    workspaceId: wsId,
    clientId: z.string(),
    kind: z.string(),
    payload: z.unknown(),
  }),
  'goals/review': z.object({
    workspaceId: wsId,
    reason: z.enum(['morning', 'weekly', 'manual']),
  }),
  'github/repo.linked': z.object({
    workspaceId: wsId,
    userId,
    projectId: z.string().uuid(),
    integrationId: z.string().uuid(),
    repoFullName: z.string(),
    repoUrl: z.string(),
  }),
  'github/stats.sync.repo': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    resourceId: z.string().uuid(),
    repoFullName: z.string(),
    reason: z.string().optional(),
  }),
  'github/repo.webhook.ensure': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    repoFullName: z.string(),
    webhookUrl: z.string().url(),
  }),
  'github/digest.daily': z.object({
    workspaceId: wsId.optional(),
  }),
  'project/anomaly.scan': z.object({
    workspaceId: wsId.optional(),
  }),
  'continuity/prewarm': z.object({
    workspaceId: wsId,
    projectId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'slack/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'gcal/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'linear/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'reddit/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'twitter/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'youtube/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'spotify/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'instagram/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'notion/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'stripe/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'vercel/sync.requested': z.object({
    workspaceId: wsId,
    integrationId: z.string().uuid(),
    reason: z.string().optional(),
  }),
} as const;

export type EventName = keyof typeof eventSchemas;
export type ParsedEvent<K extends EventName> = z.infer<(typeof eventSchemas)[K]>;

/**
 * Parse and narrow an Inngest event payload. Throws on mismatch — callers
 * should let the error propagate so Inngest marks the run failed and
 * retries (or surfaces the bad envelope in the dashboard).
 */
export function parseEvent<K extends EventName>(name: K, data: unknown): ParsedEvent<K> {
  const schema = eventSchemas[name];
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[inngest] invalid event '${name}' payload — ${issues}`);
  }
  return parsed.data as ParsedEvent<K>;
}
