'use server';
/**
 * Persona server actions — workspace-scoped CRUD + built-in seed.
 *
 * Built-in personas (`isBuiltIn = true`) cannot be deleted, but their
 * editable fields can be tweaked per-workspace. Slugs are unique within a
 * workspace; clones get a `-copy[-N]` suffix.
 *
 * Voice/STT provider strings are stored verbatim using the canonical hyphen
 * form used by the runtime (`'openai-realtime'`, `'deepgram-nova3'`, …).
 */
import { revalidatePath } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { persona, type Persona } from '@metu/db/schema';
import {
  AVATAR_KINDS,
  BUILT_IN_PERSONAS,
  COST_TIERS,
  FormPrefsSchema,
  PERSONA_FORMS,
  PERSONA_MODES,
  PROACTIVITY,
  PersonaInputSchema,
  VoiceTuningSchema,
} from '@metu/presence';

// ─── Listing ──────────────────────────────────────────────────────────────

/**
 * Returns workspace personas in deterministic order: built-ins first (in the
 * order declared in `BUILT_IN_PERSONAS`), then custom personas alphabetically.
 */
export async function listPersonas(): Promise<Persona[]> {
  const session = await auth();
  if (!session) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(persona)
    .where(eq(persona.workspaceId, session.user.workspaceId))
    .orderBy(asc(persona.isBuiltIn), asc(persona.name));
  // Resort: built-ins by canonical order, then customs A→Z.
  const builtinOrder = new Map(BUILT_IN_PERSONAS.map((p, i) => [p.slug, i] as const));
  return rows.sort((a, b) => {
    if (a.isBuiltIn && b.isBuiltIn) {
      return (builtinOrder.get(a.slug) ?? 99) - (builtinOrder.get(b.slug) ?? 99);
    }
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Seed built-ins ───────────────────────────────────────────────────────

/**
 * Idempotently insert any missing built-in personas for the workspace.
 * Existing rows (matched by `slug`) are left untouched so user edits stick.
 */
export async function seedBuiltInPersonasAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const existing = await db
    .select({ slug: persona.slug })
    .from(persona)
    .where(eq(persona.workspaceId, session.user.workspaceId));
  const have = new Set(existing.map((r) => r.slug));
  const toInsert = BUILT_IN_PERSONAS.filter((p) => !have.has(p.slug)).map((p) => ({
    workspaceId: session.user.workspaceId,
    slug: p.slug,
    name: p.name,
    description: p.description,
    systemPrompt: p.systemPrompt,
    voiceProvider: p.voiceProvider,
    voiceId: p.voiceId,
    voiceTuning: p.voiceTuning,
    sttProvider: p.sttProvider,
    avatarKind: p.avatarKind,
    avatarUrl: p.avatarUrl,
    formPrefs: p.formPrefs,
    defaultForm: p.defaultForm,
    wakeWord: p.wakeWord,
    hotkey: p.hotkey,
    proactivity: p.proactivity,
    aclOverrides: p.aclOverrides,
    isBuiltIn: true,
  }));
  if (toInsert.length > 0) {
    await db.insert(persona).values(toInsert);
  }
  revalidatePath('/settings/presence');
  return { ok: true as const, inserted: toInsert.length };
}

// ─── Create / clone ───────────────────────────────────────────────────────

const createPersonaSchema = PersonaInputSchema.extend({
  cloneFromId: z.string().uuid().optional(),
});

export async function createPersonaAction(input: z.input<typeof createPersonaSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createPersonaSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  // Slug uniqueness within workspace (case-insensitive).
  const slug = await ensureUniqueSlug(parsed.data.slug, session.user.workspaceId);
  const [row] = await db
    .insert(persona)
    .values({
      workspaceId: session.user.workspaceId,
      slug,
      name: parsed.data.name,
      description: parsed.data.description,
      systemPrompt: parsed.data.systemPrompt,
      voiceProvider: parsed.data.voiceProvider,
      voiceId: parsed.data.voiceId,
      voiceTuning: parsed.data.voiceTuning,
      sttProvider: parsed.data.sttProvider,
      avatarKind: parsed.data.avatarKind,
      avatarUrl: parsed.data.avatarUrl,
      formPrefs: parsed.data.formPrefs,
      defaultForm: parsed.data.defaultForm,
      wakeWord: parsed.data.wakeWord,
      hotkey: parsed.data.hotkey,
      proactivity: parsed.data.proactivity,
      language: parsed.data.language,
      costTier: parsed.data.costTier,
      mode: parsed.data.mode,
      eagerness: parsed.data.eagerness,
      aclOverrides: parsed.data.aclOverrides,
      isBuiltIn: false,
    })
    .returning();
  revalidatePath('/settings/presence');
  return { ok: true as const, id: row!.id };
}

async function ensureUniqueSlug(base: string, workspaceId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ slug: persona.slug })
    .from(persona)
    .where(eq(persona.workspaceId, workspaceId));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ─── Update ───────────────────────────────────────────────────────────────

const updatePersonaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(8000).optional(),
  voiceProvider: PersonaInputSchema.shape.voiceProvider.optional(),
  voiceId: z.string().optional(),
  voiceTuning: VoiceTuningSchema.optional(),
  sttProvider: PersonaInputSchema.shape.sttProvider.optional(),
  avatarKind: z.enum(AVATAR_KINDS).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  formPrefs: FormPrefsSchema.optional(),
  defaultForm: z.enum(PERSONA_FORMS).optional(),
  wakeWord: z.string().nullable().optional(),
  hotkey: z.string().nullable().optional(),
  proactivity: z.enum(PROACTIVITY).optional(),
  language: z.string().min(2).max(16).optional(),
  costTier: z.enum(COST_TIERS).optional(),
  mode: z.enum(PERSONA_MODES).optional(),
  eagerness: z.number().int().min(0).max(100).optional(),
  aclOverrides: z
    .record(z.string(), z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot']))
    .optional(),
});

export async function updatePersonaAction(input: z.input<typeof updatePersonaSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updatePersonaSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const patch: Record<string, unknown> = {};
  for (const k of [
    'name',
    'description',
    'systemPrompt',
    'voiceProvider',
    'voiceId',
    'voiceTuning',
    'sttProvider',
    'avatarKind',
    'avatarUrl',
    'formPrefs',
    'defaultForm',
    'wakeWord',
    'hotkey',
    'proactivity',
    'language',
    'costTier',
    'mode',
    'eagerness',
    'aclOverrides',
  ] as const) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return { ok: true as const };
  await db
    .update(persona)
    .set(patch)
    .where(and(eq(persona.id, parsed.data.id), eq(persona.workspaceId, session.user.workspaceId)));
  revalidatePath('/settings/presence');
  return { ok: true as const };
}

// ─── Delete (custom only) ─────────────────────────────────────────────────

export async function deletePersonaAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  // Built-ins are not deletable. Match by id+workspace+!isBuiltIn so deletion
  // becomes a no-op (rather than an error) on built-ins.
  await db
    .delete(persona)
    .where(
      and(
        eq(persona.id, id),
        eq(persona.workspaceId, session.user.workspaceId),
        eq(persona.isBuiltIn, false),
      ),
    );
  revalidatePath('/settings/presence');
  return { ok: true as const };
}

// ─── Import / export ──────────────────────────────────────────────────────

/**
 * Serialise every workspace persona as a portable JSON bundle. Strips
 * workspace-specific fields (`id`, `workspaceId`, timestamps) and the
 * `isBuiltIn` flag — the bundle is meant to seed a fresh workspace, not
 * to round-trip identity.
 */
export interface PersonaBundle {
  version: 1;
  exportedAt: string;
  personas: Array<z.infer<typeof PersonaInputSchema>>;
}

export async function exportPersonasAction(): Promise<PersonaBundle> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const rows = await listPersonas();
  const personas = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    systemPrompt: r.systemPrompt,
    voiceProvider: r.voiceProvider as z.infer<typeof PersonaInputSchema>['voiceProvider'],
    voiceId: r.voiceId,
    voiceTuning: r.voiceTuning as z.infer<typeof PersonaInputSchema>['voiceTuning'],
    sttProvider: r.sttProvider as z.infer<typeof PersonaInputSchema>['sttProvider'],
    avatarKind: r.avatarKind as z.infer<typeof PersonaInputSchema>['avatarKind'],
    avatarUrl: r.avatarUrl,
    formPrefs: r.formPrefs as z.infer<typeof PersonaInputSchema>['formPrefs'],
    defaultForm: r.defaultForm,
    wakeWord: r.wakeWord,
    hotkey: r.hotkey,
    proactivity: r.proactivity,
    language: r.language,
    costTier: r.costTier as z.infer<typeof PersonaInputSchema>['costTier'],
    mode: r.mode,
    eagerness: r.eagerness,
    aclOverrides: r.aclOverrides as z.infer<typeof PersonaInputSchema>['aclOverrides'],
  }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    personas,
  };
}

const ImportBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  personas: z.array(PersonaInputSchema).min(1).max(100),
});

export type ImportMode = 'skip' | 'rename';

/**
 * Insert each persona from `bundleJson`. When a slug already exists in this
 * workspace the behaviour depends on `mode`:
 *   - `'skip'`: leave the existing row alone.
 *   - `'rename'`: insert with a unique suffix (`-imported`, `-imported-2`, …).
 *
 * Built-in personas in the workspace are never overwritten or shadowed.
 */
export async function importPersonasAction(
  bundleJson: string,
  mode: ImportMode = 'skip',
): Promise<
  { ok: true; inserted: number; skipped: number; renamed: number } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bundleJson);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  const parsed = ImportBundleSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_bundle' };
  }
  const db = getDb();
  const existingRows = await db
    .select({ slug: persona.slug })
    .from(persona)
    .where(eq(persona.workspaceId, session.user.workspaceId));
  const taken = new Set(existingRows.map((r) => r.slug));
  let inserted = 0;
  let skipped = 0;
  let renamed = 0;
  for (const p of parsed.data.personas) {
    let slug = p.slug;
    if (taken.has(slug)) {
      if (mode === 'skip') {
        skipped++;
        continue;
      }
      slug = `${p.slug}-imported`;
      let i = 2;
      while (taken.has(slug)) slug = `${p.slug}-imported-${i++}`;
      renamed++;
    }
    taken.add(slug);
    await db.insert(persona).values({
      workspaceId: session.user.workspaceId,
      slug,
      name: p.name,
      description: p.description,
      systemPrompt: p.systemPrompt,
      voiceProvider: p.voiceProvider,
      voiceId: p.voiceId,
      voiceTuning: p.voiceTuning,
      sttProvider: p.sttProvider,
      avatarKind: p.avatarKind,
      avatarUrl: p.avatarUrl,
      formPrefs: p.formPrefs,
      defaultForm: p.defaultForm,
      wakeWord: p.wakeWord,
      hotkey: p.hotkey,
      proactivity: p.proactivity,
      language: p.language,
      costTier: p.costTier,
      mode: p.mode,
      eagerness: p.eagerness,
      aclOverrides: p.aclOverrides,
      isBuiltIn: false,
    });
    inserted++;
  }
  revalidatePath('/settings/presence');
  return { ok: true, inserted, skipped, renamed };
}
