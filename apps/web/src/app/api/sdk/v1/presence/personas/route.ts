/**
 * SDK v1 — GET /api/sdk/v1/presence/personas
 *
 * Bearer auth (`presence:talk` scope). Returns the merged persona catalogue
 * the companion needs to render its avatar + wire up wake words: built-in
 * personas first, then any workspace-specific custom personas. Each entry
 * carries the fields the companion's `useWakeWord` and `VrmAvatar` consume
 * — slug, name, voiceProvider, avatarKind, wakeWord, hotkey, language,
 * costTier, mode.
 *
 * No mutation; no observe event. Safe to poll, but companion caches it
 * for the session and only refetches on auth change.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { getDb } from '@metu/db';
import { agentPolicy, persona } from '@metu/db/schema';
import { BUILT_IN_PERSONAS } from '@metu/presence';
import { getVoiceCapState, getWorkspaceBillingTier } from '@/lib/voice-billing';
import { isQuietHoursActive } from '@/lib/quiet-hours';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const db = getDb();
  const [rows, billingTier, voiceCap, policyRow] = await Promise.all([
    db
      .select({
        slug: persona.slug,
        name: persona.name,
        voiceProvider: persona.voiceProvider,
        avatarKind: persona.avatarKind,
        avatarUrl: persona.avatarUrl,
        defaultForm: persona.defaultForm,
        wakeWord: persona.wakeWord,
        hotkey: persona.hotkey,
        language: persona.language,
        costTier: persona.costTier,
        mode: persona.mode,
        isBuiltIn: persona.isBuiltIn,
      })
      .from(persona)
      .where(eq(persona.workspaceId, session.workspaceId)),
    getWorkspaceBillingTier(session.workspaceId),
    getVoiceCapState(session.workspaceId),
    db
      .select({ quietHours: agentPolicy.quietHours })
      .from(agentPolicy)
      .where(eq(agentPolicy.workspaceId, session.workspaceId))
      .limit(1),
  ]);
  const quietActive = isQuietHoursActive(
    (policyRow[0]?.quietHours ?? null) as Record<string, unknown> | null,
  );

  // Merge: workspace rows override built-ins by slug; remaining built-ins
  // are appended so a fresh workspace (no inserted rows yet) still works.
  const bySlug = new Map<string, unknown>();
  for (const b of BUILT_IN_PERSONAS) {
    bySlug.set(b.slug, {
      slug: b.slug,
      name: b.name,
      voiceProvider: b.voiceProvider,
      avatarKind: b.avatarKind,
      avatarUrl: b.avatarUrl ?? null,
      defaultForm: b.defaultForm,
      wakeWord: b.wakeWord ?? null,
      hotkey: b.hotkey ?? null,
      language: b.language,
      costTier: b.costTier,
      mode: b.mode,
      isBuiltIn: true,
    });
  }
  for (const r of rows) {
    bySlug.set(r.slug, { ...r, avatarUrl: r.avatarUrl ?? null });
  }

  return NextResponse.json({
    ok: true,
    billingTier,
    voiceCap,
    quietActive,
    personas: Array.from(bySlug.values()),
  });
}
