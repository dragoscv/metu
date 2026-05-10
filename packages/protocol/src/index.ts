/**
 * @metu/protocol — shared zod schemas for cross-app + cross-device traffic.
 *
 * Used by: web (server), apps/hub (WS gateway), @metu/sdk (clients), companion
 * desktop, vscode-ext, browser-ext, mobile, third-party apps.
 *
 * Versioning: every payload is wrapped in `{ v: 1, ... }`. Bump on breaking
 * changes; the hub negotiates the highest mutually-supported version on
 * connect.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

// ─── Shared primitives ────────────────────────────────────────────────────

export const Uuid = z.string().uuid();
export const Iso = z.string().datetime();

// ─── Auth / handshake ─────────────────────────────────────────────────────

export const HelloSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('hello'),
  /** OAuth bearer (access token) — short-lived, refreshed by SDK. */
  accessToken: z.string(),
  /** What kind of endpoint is connecting. */
  kind: z.enum([
    'web',
    'mobile',
    'vscode_ext',
    'browser_ext',
    'companion_desktop',
    'mcp_client',
    'external_app',
    'cli',
  ]),
  platform: z.string(),
  name: z.string(),
  /** Stable client-generated fingerprint (UUID v5 of platform+install id). */
  fingerprint: z.string(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
});

export const HelloAckSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('hello_ack'),
  deviceId: Uuid,
  workspaceId: Uuid,
  userId: Uuid,
  /** Server-side enforced ACL summary for this device. */
  acl: z.record(z.string(), z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot'])).default({}),
  serverTime: Iso,
});

// ─── Server → client envelopes ────────────────────────────────────────────

export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event.timeline'),
    id: Uuid,
    kind: z.string(),
    title: z.string(),
    body: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    occurredAt: Iso,
  }),
  z.object({
    type: z.literal('event.notification'),
    id: Uuid,
    title: z.string(),
    body: z.string().optional(),
    urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
    actionUrl: z.string().url().optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(['approve', 'reject', 'open', 'custom']),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal('tool.invoke'),
    id: Uuid,
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    timeoutSec: z.number().int().positive().default(30),
  }),
  z.object({
    type: z.literal('command'),
    id: Uuid,
    command: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  // ── Presence (slice 1 contract) ─────────────────────────────────────────
  z.object({
    type: z.literal('persona.activate'),
    activationId: Uuid,
    personaId: Uuid,
    /** 'panel' | 'in_window' | 'hud' | 'pet' */
    form: z.enum(['panel', 'in_window', 'hud', 'pet']),
    position: z.record(z.string(), z.unknown()).default({}),
    /** Snapshot of persona fields the device needs to render + speak. */
    persona: z.object({
      slug: z.string(),
      name: z.string(),
      systemPrompt: z.string(),
      voiceProvider: z.string(),
      voiceId: z.string(),
      voiceTuning: z.record(z.string(), z.unknown()).default({}),
      sttProvider: z.string(),
      avatarKind: z.string(),
      avatarUrl: z.string().nullable(),
      wakeWord: z.string().nullable(),
      hotkey: z.string().nullable(),
      proactivity: z.enum(['silent', 'gentle', 'active']),
    }),
  }),
  z.object({
    type: z.literal('persona.deactivate'),
    activationId: Uuid,
  }),
  z.object({
    type: z.literal('voice.token'),
    /** Lane: 'realtime' | 'stt' | 'tts'. */
    lane: z.enum(['realtime', 'stt', 'tts']),
    provider: z.string(),
    sessionToken: z.string(),
    expiresAt: Iso,
    /** Optional ICE servers when transport=webrtc. */
    iceServers: z
      .array(
        z.object({
          urls: z.union([z.string(), z.array(z.string())]),
          username: z.string().optional(),
          credential: z.string().optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('tool.partial'),
    id: Uuid,
    chunk: z.unknown(),
  }),
  z.object({ type: z.literal('ping'), at: Iso }),
]);

// ─── Client → server envelopes ────────────────────────────────────────────

export const ClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event.app'),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
    occurredAt: Iso.optional(),
  }),
  z.object({
    type: z.literal('event.device'),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()).default({}),
    occurredAt: Iso.optional(),
  }),
  z.object({
    type: z.literal('tool.result'),
    id: Uuid,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('presence'),
    state: z.enum(['online', 'idle', 'offline']),
    activity: z.record(z.string(), z.unknown()).optional(),
  }),
  // ── Presence (slice 1 contract) ─────────────────────────────────────────
  z.object({
    type: z.literal('voice.transcript'),
    personaId: Uuid.optional(),
    partial: z.string().optional(),
    final: z.string().optional(),
  }),
  z.object({
    type: z.literal('voice.utterance'),
    personaId: Uuid,
    text: z.string(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('sensory.summary'),
    kind: z.enum([
      'screenshot',
      'screen_text',
      'audio_transcript',
      'window_focus',
      'clipboard',
      'webcam',
    ]),
    summary: z.string(),
    storageKey: z.string().nullable().default(null),
    retention: z.enum(['ephemeral', 'ring_24h', 'persisted']),
  }),
  z.object({ type: z.literal('pong'), at: Iso }),
]);

// ─── REST surface (mirrors WS where useful) ───────────────────────────────

export const CaptureCreateSchema = z.object({
  kind: z.enum(['text', 'voice', 'screenshot', 'link', 'code', 'email', 'message', 'file']),
  source: z.string().default('sdk'),
  content: z.string().optional(),
  storageKey: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  projectId: Uuid.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const RecallQuerySchema = z.object({
  query: z.string().min(1),
  projectId: Uuid.optional(),
  kinds: z.array(z.string()).optional(),
  k: z.number().int().min(1).max(50).default(10),
  timeRange: z.object({ from: Iso.optional(), to: Iso.optional() }).optional(),
});

export const NotifyCreateSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  source: z.string().default('app'),
  actionUrl: z.string().url().optional(),
});

/**
 * Intent — a satellite app (notai/bancai/facturai/…) signaling that one of
 * its domain entities needs user action. Mirrors up into METU as a `task` row
 * tagged with `sourceApp` + `sourceEntityRef` + `sourceUrl` so the Conductor
 * can reason about it in the unified plan.
 */
export const IntentCreateSchema = z.object({
  /** Slug of the originating app — defaults to the OAuth client_id when omitted. */
  sourceApp: z.string().min(1).max(64).optional(),
  /** Free-form ref to the entity in the satellite app. */
  sourceEntityRef: z.record(z.string(), z.unknown()).default({}),
  /** Deep link the user (or Conductor) can follow to the source entity. */
  sourceUrl: z.string().url().optional(),
  /** One-line action title shown in the Conductor's plan. */
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  /** Optional METU project to attach to. */
  projectId: Uuid.optional(),
  /** When the action becomes overdue. */
  dueAt: Iso.optional(),
  /** Coarse importance hint 0..1; the planner may override. */
  importance: z.number().min(0).max(1).default(0.5),
  /**
   * Initial status. `inbox` means the Conductor will triage; `next` means
   * surface immediately. Defaults to `inbox`.
   */
  status: z.enum(['inbox', 'next']).default('inbox'),
});

// ─── Types ────────────────────────────────────────────────────────────────

export type Hello = z.infer<typeof HelloSchema>;
export type HelloAck = z.infer<typeof HelloAckSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type CaptureCreate = z.infer<typeof CaptureCreateSchema>;
export type RecallQuery = z.infer<typeof RecallQuerySchema>;
export type NotifyCreate = z.infer<typeof NotifyCreateSchema>;
export type IntentCreate = z.infer<typeof IntentCreateSchema>;
