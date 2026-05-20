'use server';
/**
 * Presence slice 10 — manager polish: ACL editor, audit log, sensory ring,
 * privacy badge state.
 *
 * This module owns the presence-specific server actions that DON'T live in
 * `personas.ts` (CRUD) — they all read/mutate workspace-scoped tables and
 * revalidate `/settings/presence`.
 */
import { revalidatePath } from 'next/cache';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { device, personaActivation, sensoryRing, toolAcl, toolCall } from '@metu/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * The full `device.*` registry, kept here to avoid pulling
 * `@metu/core/agent` (and its AI-SDK / DB chain) into a client component.
 * Default ACL mirrors `packages/core/src/agent/device-tools.ts`.
 *
 * Not exported \u2014 `'use server'` files can only export async functions.
 */
const DEVICE_TOOL_CATALOG = [
  { tool: 'device.screenshot', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.list_windows', kind: 'read', defaultMode: 'auto_with_undo' },
  { tool: 'device.a11y_tree', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.observe_window', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.webcam_snapshot', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.focus_window', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.move_window', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.open_url', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.open_path', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.type_text', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.send_keys', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.click', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.clipboard_read', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.clipboard_write', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.fs_read', kind: 'read', defaultMode: 'ask' },
  { tool: 'device.fs_write', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.shell_exec', kind: 'write', defaultMode: 'ask' },
  { tool: 'device.media_key', kind: 'write', defaultMode: 'auto_with_undo' },
  { tool: 'device.notify', kind: 'write', defaultMode: 'auto_with_undo' },
  { tool: 'device.persona_set', kind: 'write', defaultMode: 'ask' },
] as const;

const AutonomyEnum = z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot']);
const DEVICE_TOOL_NAMES = DEVICE_TOOL_CATALOG.map((t) => t.tool) as readonly string[];

// ─── ACL editor ───────────────────────────────────────────────────────────

export interface DeviceToolAclRow {
  tool: string;
  kind: 'read' | 'write';
  defaultMode: 'observe' | 'ask' | 'auto_with_undo' | 'autopilot';
  /** Workspace override for this tool (no integrationId). null = default. */
  mode: 'observe' | 'ask' | 'auto_with_undo' | 'autopilot' | null;
}

export async function listDeviceAcl(): Promise<DeviceToolAclRow[]> {
  const session = await auth();
  if (!session) return [];
  const db = getDb();
  const overrides = await db
    .select({ tool: toolAcl.tool, mode: toolAcl.mode })
    .from(toolAcl)
    .where(
      and(
        eq(toolAcl.workspaceId, session.user.workspaceId),
        inArray(toolAcl.tool, DEVICE_TOOL_NAMES as string[]),
        sql`${toolAcl.integrationId} is null`,
      ),
    );
  const overrideMap = new Map(overrides.map((o) => [o.tool, o.mode]));
  return DEVICE_TOOL_CATALOG.map((t) => ({
    tool: t.tool,
    kind: t.kind,
    defaultMode: t.defaultMode,
    mode: overrideMap.get(t.tool) ?? null,
  }));
}

const setDeviceAclSchema = z.object({
  tool: z.string().refine((t) => DEVICE_TOOL_NAMES.includes(t), 'unknown_tool'),
  /** null clears the override (falls back to the catalog default). */
  mode: AutonomyEnum.nullable(),
});

export async function setDeviceToolAclAction(input: z.input<typeof setDeviceAclSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = setDeviceAclSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  if (parsed.data.mode === null) {
    await db
      .delete(toolAcl)
      .where(
        and(
          eq(toolAcl.workspaceId, session.user.workspaceId),
          eq(toolAcl.tool, parsed.data.tool),
          sql`${toolAcl.integrationId} is null`,
        ),
      );
  } else {
    // Upsert against the partial unique index (workspaceId, tool) WHERE integrationId IS NULL.
    await db
      .insert(toolAcl)
      .values({
        workspaceId: session.user.workspaceId,
        tool: parsed.data.tool,
        mode: parsed.data.mode,
      })
      .onConflictDoUpdate({
        target: [toolAcl.workspaceId, toolAcl.tool],
        targetWhere: sql`${toolAcl.integrationId} is null`,
        set: { mode: parsed.data.mode },
      });
  }
  revalidatePath('/settings/presence');
  return { ok: true as const };
}

// ─── Audit log (last N device-tool calls) ─────────────────────────────────

export interface DeviceToolCallRow {
  id: string;
  tool: string;
  status: string;
  aclMode: string | null;
  error: string | null;
  requestedAt: Date;
  finishedAt: Date | null;
}

export async function listRecentDeviceToolCalls(limit = 50): Promise<DeviceToolCallRow[]> {
  const session = await auth();
  if (!session) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      aclMode: toolCall.aclMode,
      error: toolCall.error,
      requestedAt: toolCall.requestedAt,
      finishedAt: toolCall.finishedAt,
    })
    .from(toolCall)
    .where(
      and(
        eq(toolCall.workspaceId, session.user.workspaceId),
        inArray(toolCall.tool, DEVICE_TOOL_NAMES as string[]),
      ),
    )
    .orderBy(desc(toolCall.requestedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows;
}

// ─── Sensory ring viewer ──────────────────────────────────────────────────

export interface SensoryRingViewRow {
  id: string;
  kind: string;
  retention: string;
  summary: string;
  storageKey: string | null;
  occurredAt: Date;
}

export async function listRecentSensory(limit = 30): Promise<SensoryRingViewRow[]> {
  const session = await auth();
  if (!session) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: sensoryRing.id,
      kind: sensoryRing.kind,
      retention: sensoryRing.retention,
      summary: sensoryRing.summary,
      storageKey: sensoryRing.storageKey,
      occurredAt: sensoryRing.occurredAt,
    })
    .from(sensoryRing)
    .where(eq(sensoryRing.workspaceId, session.user.workspaceId))
    .orderBy(desc(sensoryRing.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows;
}

/**
 * Prune ephemeral sensory rows older than 24h. Inngest will eventually call
 * this on a cron; exposed as an action so the user can also "clear now"
 * from the UI.
 */
export async function pruneSensoryRingAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(sensoryRing)
    .where(
      and(
        eq(sensoryRing.workspaceId, session.user.workspaceId),
        eq(sensoryRing.retention, 'ring_24h'),
        lt(sensoryRing.occurredAt, cutoff),
      ),
    )
    .returning();
  revalidatePath('/settings/presence');
  return { ok: true as const, removed: deleted.length };
}

// ─── Privacy badge state ──────────────────────────────────────────────────

export interface PrivacyBadgeState {
  /** Any persona currently bound to a device (slice 8 forms). */
  observingActivations: number;
  /** Sensory rows captured in the last 5 minutes. */
  recentSensoryCount: number;
  /** Last sensory event for the live "you were just observed" line. */
  lastSensoryAt: Date | null;
  lastSensoryKind: string | null;
}

export async function getPrivacyBadgeState(): Promise<PrivacyBadgeState> {
  const session = await auth();
  if (!session)
    return {
      observingActivations: 0,
      recentSensoryCount: 0,
      lastSensoryAt: null,
      lastSensoryKind: null,
    };
  const db = getDb();
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const [activationCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(personaActivation)
    .where(eq(personaActivation.workspaceId, session.user.workspaceId));
  const [sensoryCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sensoryRing)
    .where(
      and(
        eq(sensoryRing.workspaceId, session.user.workspaceId),
        gte(sensoryRing.occurredAt, since),
      ),
    );
  const [last] = await db
    .select({ kind: sensoryRing.kind, occurredAt: sensoryRing.occurredAt })
    .from(sensoryRing)
    .where(eq(sensoryRing.workspaceId, session.user.workspaceId))
    .orderBy(desc(sensoryRing.occurredAt))
    .limit(1);
  return {
    observingActivations: activationCount?.n ?? 0,
    recentSensoryCount: sensoryCount?.n ?? 0,
    lastSensoryAt: last?.occurredAt ?? null,
    lastSensoryKind: last?.kind ?? null,
  };
}

// ─── Activation list (used by section 1 "Active personas") ────────────────

export interface ActivationViewRow {
  id: string;
  personaId: string;
  deviceId: string;
  deviceName: string | null;
  deviceKind: string | null;
  form: string;
  startedAt: Date;
}

export async function listActivations(): Promise<ActivationViewRow[]> {
  const session = await auth();
  if (!session) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: personaActivation.id,
      personaId: personaActivation.personaId,
      deviceId: personaActivation.deviceId,
      deviceName: device.name,
      deviceKind: device.kind,
      form: personaActivation.form,
      startedAt: personaActivation.startedAt,
    })
    .from(personaActivation)
    .leftJoin(device, eq(device.id, personaActivation.deviceId))
    .where(eq(personaActivation.workspaceId, session.user.workspaceId))
    .orderBy(desc(personaActivation.startedAt));
  return rows;
}

export async function deactivatePersonaAction(activationId: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(personaActivation)
    .where(
      and(
        eq(personaActivation.id, activationId),
        eq(personaActivation.workspaceId, session.user.workspaceId),
      ),
    );
  revalidatePath('/settings/presence');
  return { ok: true as const };
}

// ─── Companion-Agent slice 7 — voice cost meter ───────────────────────────

export type VoiceCapView = {
  spentUsd: number;
  capUsd: number;
  soft: boolean;
  hard: boolean;
  unlimited: boolean;
};

export async function getVoiceCapStateAction(): Promise<VoiceCapView> {
  const session = await auth();
  if (!session) {
    return { spentUsd: 0, capUsd: 0, soft: false, hard: true, unlimited: false };
  }
  const { getVoiceCapState } = await import('@/lib/voice-billing');
  return getVoiceCapState(session.user.workspaceId);
}
