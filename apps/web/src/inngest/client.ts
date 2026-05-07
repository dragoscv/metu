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
};

export const inngest = new Inngest({
  id: 'metu',
  schemas: new EventSchemas().fromRecord<Events>(),
});
