/**
 * Presence — personas, character forms, and on-device sensory ring.
 *
 * Slice 1 (foundation): tables only, no behavior. The Settings → Presence UI
 * and the companion device bridge in later slices read/write these rows.
 *
 * - `persona`        — character definitions (system prompt, voice, avatar, ACL overrides).
 * - `personaActivation` — running instances of a persona on a device + form + position.
 * - `sensoryRing`    — summary index of on-device sensory captures (the raw bytes
 *                       live in the local 24h ring buffer on the companion;
 *                       this row exists only when retention ≠ 'ephemeral').
 *
 * Multi-tenant: every row scoped by `workspaceId`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

export const personaForm = pgEnum('persona_form', ['panel', 'in_window', 'hud', 'pet']);

export const personaProactivity = pgEnum('persona_proactivity', ['silent', 'gentle', 'active']);

// Companion-Agent slice 2 — proper agent autonomy modes (parallel to the
// legacy `proactivity` 3-tone enum, which we keep for backwards-compat).
export const personaMode = pgEnum('persona_mode', [
  'silent',
  'ambient_nudges',
  'anticipatory',
  'autonomous',
]);

export const personaCostTier = pgEnum('persona_cost_tier', ['budget', 'balanced', 'premium']);

export const sensoryKind = pgEnum('sensory_kind', [
  'screenshot',
  'screen_text',
  'audio_transcript',
  'window_focus',
  'clipboard',
  'webcam',
]);

export const sensoryRetention = pgEnum('sensory_retention', ['ephemeral', 'ring_24h', 'persisted']);

export const persona = pgTable(
  'persona',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Stable slug; built-ins use 'atlas' | 'iris' | 'mira' | 'echo' | 'minimal'. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    // Voice
    voiceProvider: text('voice_provider').notNull().default('openai_realtime'),
    voiceId: text('voice_id').notNull().default('verse'),
    voiceTuning: jsonb('voice_tuning')
      .notNull()
      .default(sql`'{}'::jsonb`),
    sttProvider: text('stt_provider').notNull().default('deepgram_nova3'),
    // Visual
    avatarKind: text('avatar_kind').notNull().default('orb'), // orb | portrait | live2d | vrm | sprite
    avatarUrl: text('avatar_url'),
    /** { panel, inWindow, hud, pet } booleans — which forms can host this persona. */
    formPrefs: jsonb('form_prefs')
      .notNull()
      .default(sql`'{"panel":true,"inWindow":true,"hud":true,"pet":false}'::jsonb`),
    defaultForm: personaForm('default_form').notNull().default('panel'),
    // Behaviour
    wakeWord: text('wake_word'),
    hotkey: text('hotkey'),
    proactivity: personaProactivity('proactivity').notNull().default('gentle'),
    /** BCP-47, e.g. 'en', 'ro'. Drives voice routing (Romanian → ElevenLabs). */
    language: text('language').notNull().default('en'),
    costTier: personaCostTier('cost_tier').notNull().default('balanced'),
    /** Companion-Agent slice 2 — autonomy mode (mirrors Conductor modes). */
    mode: personaMode('mode').notNull().default('ambient_nudges'),
    /** 0..100 eagerness scalar; biases planner thresholds. */
    eagerness: integer('eagerness').notNull().default(50),
    /** Per-tool ACL overrides: { 'device.open_url': 'auto_with_undo', ... }. */
    aclOverrides: jsonb('acl_overrides')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('persona_workspace_idx').on(t.workspaceId),
    index('persona_slug_idx').on(t.workspaceId, t.slug),
  ],
);

export const personaActivation = pgTable(
  'persona_activation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'cascade' }),
    /** The device hosting this activation. Joined to `device` table by id. */
    deviceId: uuid('device_id').notNull(),
    form: personaForm('form').notNull(),
    /** { x, y, monitor } for floating forms; {} otherwise. */
    position: jsonb('position')
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('persona_activation_workspace_idx').on(t.workspaceId),
    index('persona_activation_device_idx').on(t.deviceId),
  ],
);

/**
 * Sensory ring — index of on-device sensory captures.
 *
 * Default retention per kind is configured per-workspace (D17). Raw bytes
 * (screenshots, audio) remain on-device; only the summary lands here when the
 * retention is `ring_24h` (TTL-pruned by Inngest) or `persisted` (kept).
 */
export const sensoryRing = pgTable(
  'sensory_ring',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull(),
    kind: sensoryKind('kind').notNull(),
    summary: text('summary').notNull().default(''),
    /** GCS object key when retention='persisted' and bytes were uploaded. */
    storageKey: text('storage_key'),
    retention: sensoryRetention('retention').notNull().default('ring_24h'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('sensory_ring_workspace_idx').on(t.workspaceId),
    index('sensory_ring_device_idx').on(t.deviceId),
    index('sensory_ring_occurred_idx').on(t.workspaceId, t.occurredAt),
  ],
);

export type Persona = typeof persona.$inferSelect;
export type NewPersona = typeof persona.$inferInsert;
export type PersonaActivation = typeof personaActivation.$inferSelect;
export type SensoryRingRow = typeof sensoryRing.$inferSelect;
