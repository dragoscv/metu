/**
 * Inngest workflows. Mounted in apps/web at /api/inngest.
 * Worker app can also serve these for long-running jobs (transcription).
 */
import { Inngest, EventSchemas } from 'inngest';

export type Events = {
  'capture/created': {
    data: { workspaceId: string; userId: string; captureId: string };
  };
  'memory/indexed': {
    data: { workspaceId: string; sourceKind: string; sourceId: string; chunkCount: number };
  };
  'focus/recompute': {
    data: { workspaceId: string; userId: string; reason?: string };
  };
  'project/momentum-recompute': {
    data: { workspaceId: string; projectId: string };
  };
  'integration/sync': {
    data: { workspaceId: string; integrationId: string };
  };
  'agent/run': {
    data: { workspaceId: string; userId: string; kind: string; input: unknown };
  };
  // ─── Conductor (continuous supervisor) ─────────────────────────────────
  'conductor/tick': {
    data: { workspaceId: string; reason?: string };
  };
  'conductor/observe': {
    data: { workspaceId: string; eventKind: string; payload: unknown };
  };
  'conductor/proactive-sweep': {
    data: { workspaceId?: string; hint?: string };
  };
  'conductor/approved': {
    data: { workspaceId: string; toolCallId: string; userId: string };
  };
  'conductor/rejected': {
    data: { workspaceId: string; toolCallId: string; userId: string; reason?: string };
  };
  'conductor/notify': {
    data: {
      workspaceId: string;
      userId: string;
      title: string;
      body?: string;
      urgency?: 'low' | 'normal' | 'high' | 'critical';
      source?: string;
      actionUrl?: string;
      actions?: Array<{
        id: string;
        label: string;
        kind: 'approve' | 'reject' | 'open' | 'custom';
      }>;
      metadata?: Record<string, unknown>;
    };
  };
  // ─── Devices + apps ────────────────────────────────────────────────────
  'device/connected': {
    data: { workspaceId: string; deviceId: string };
  };
  'device/disconnected': {
    data: { workspaceId: string; deviceId: string };
  };
  'device/event': {
    data: { workspaceId: string; deviceId: string; kind: string; payload: unknown };
  };
  'app/event': {
    data: { workspaceId: string; clientId: string; kind: string; payload: unknown };
  };
  // ─── Goals + Targets ───────────────────────────────────────────────────
  'goals/review': {
    data: { workspaceId: string; reason: 'morning' | 'weekly' | 'manual' };
  };
  // ─── GitHub repo memory seeding ────────────────────────────────────────
  'github/repo.linked': {
    data: {
      workspaceId: string;
      userId: string;
      projectId: string;
      integrationId: string;
      repoFullName: string;
      repoUrl: string;
    };
  };
  // ─── GitHub stats sync (cron-driven + manual) ──────────────────────────
  'github/stats.sync.repo': {
    data: {
      workspaceId: string;
      integrationId: string;
      resourceId: string;
      repoFullName: string;
      reason?: string;
    };
  };
  'github/repo.webhook.ensure': {
    data: {
      workspaceId: string;
      integrationId: string;
      repoFullName: string;
      webhookUrl: string;
    };
  };
  'github/digest.daily': {
    data: { workspaceId?: string };
  };
  'project/anomaly.scan': {
    data: { workspaceId?: string };
  };
  // ─── Continuity (auto-prewarm stale briefings) ─────────────────────────
  'continuity/prewarm': {
    data: { workspaceId: string; projectId: string; reason?: string };
  };
  // ─── Per-platform sync (slack/gcal/linear/reddit/twitter) ──────────────
  'slack/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'gcal/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'linear/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'reddit/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'twitter/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'youtube/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'spotify/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'instagram/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'notion/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'stripe/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
  'vercel/sync.requested': {
    data: { workspaceId: string; integrationId: string; reason?: string };
  };
};

export const inngest = new Inngest({
  id: 'metu',
  schemas: new EventSchemas().fromRecord<Events>(),
  // In prod, INNGEST_EVENT_KEY + (optional) INNGEST_BASE_URL point at our
  // self-hosted Inngest on Cloud Run. When unset, the SDK would try Inngest
  // Cloud and hang — the timeout wrapper below guarantees we never block a
  // Server Action regardless.
  ...(process.env.INNGEST_BASE_URL ? { baseUrl: process.env.INNGEST_BASE_URL } : {}),
});

// ── Fail-fast send ─────────────────────────────────────────────────────────
// inngest.send() performs a network round-trip. If the Inngest endpoint is
// unreachable/misconfigured it can block until the serverless function times
// out (15s) — which surfaces to the user as "An unexpected response was
// received from the server" on every Server Action that emits an event.
// Wrap send() so it always resolves quickly and never throws into callers.
const SEND_TIMEOUT_MS = 3000;
const rawSend = inngest.send.bind(inngest);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
inngest.send = (async (...args: Parameters<typeof rawSend>): Promise<any> => {
  try {
    return await Promise.race([
      rawSend(...args),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('inngest.send timeout')), SEND_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // Best-effort telemetry; never propagate to the caller.
    console.error('[inngest] send failed (non-fatal):', err instanceof Error ? err.message : err);
    return { ids: [] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;
