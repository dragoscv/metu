/**
 * @metu/presence — character/persona runtime shared by companion + mobile.
 *
 * Slice 1 (foundation): types + built-in persona seeds. The runtime
 * (PersonaRuntime that mounts a form, drives the voice loop, and renders the
 * visual character) lands in slices 4 and 8.
 */
import { z } from 'zod';
import type { VoicePersonaTuning } from '@metu/voice';

export const PERSONA_FORMS = ['panel', 'in_window', 'hud', 'assistant'] as const;
export type PersonaForm = (typeof PERSONA_FORMS)[number];

export const AVATAR_KINDS = ['orb', 'portrait', 'live2d', 'vrm', 'sprite'] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

export const PROACTIVITY = ['silent', 'gentle', 'active'] as const;
export type Proactivity = (typeof PROACTIVITY)[number];

// Companion-Agent slice 2 — proper autonomy modes (mirror Conductor).
// Coexists with `proactivity` for backwards-compat; new code reads `mode`.
export const PERSONA_MODES = ['silent', 'ambient_nudges', 'anticipatory', 'autonomous'] as const;
export type PersonaMode = (typeof PERSONA_MODES)[number];

export const COST_TIERS = ['budget', 'balanced', 'premium'] as const;
export type CostTier = (typeof COST_TIERS)[number];

export const FormPrefsSchema = z.object({
  panel: z.boolean().default(true),
  inWindow: z.boolean().default(true),
  hud: z.boolean().default(true),
  assistant: z.boolean().default(false),
});
export type FormPrefs = z.infer<typeof FormPrefsSchema>;

export const VoiceTuningSchema = z.object({
  speed: z.number().min(0.5).max(2).optional(),
  stability: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  pitch: z.number().min(-12).max(12).optional(),
}) satisfies z.ZodType<VoicePersonaTuning>;

export const PersonaInputSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  systemPrompt: z.string().max(8000).default(''),
  voiceProvider: z
    .union([
      z.enum([
        'openai-realtime',
        'anthropic-realtime',
        'cartesia-sonic-turbo',
        'elevenlabs-flash',
        'deepgram-aura-2',
        'piper-local',
      ]),
      z.literal('none'),
    ])
    .default('openai-realtime'),
  voiceId: z.string().default('verse'),
  voiceTuning: VoiceTuningSchema.default({}),
  sttProvider: z
    .enum(['deepgram-nova3', 'openai-whisper-1', 'openai-4o-mini-transcribe', 'local-whisper-cpp'])
    .default('deepgram-nova3'),
  avatarKind: z.enum(AVATAR_KINDS).default('orb'),
  avatarUrl: z.string().url().nullable().default(null),
  formPrefs: FormPrefsSchema.default({
    panel: true,
    inWindow: true,
    hud: true,
    assistant: false,
  }),
  defaultForm: z.enum(PERSONA_FORMS).default('panel'),
  wakeWord: z.string().nullable().default(null),
  hotkey: z.string().nullable().default(null),
  proactivity: z.enum(PROACTIVITY).default('gentle'),
  /** BCP-47 language tag — e.g. 'en', 'ro'. */
  language: z.string().min(2).max(16).default('en'),
  costTier: z.enum(COST_TIERS).default('balanced'),
  /** Autonomy mode (Companion-Agent slice 2). */
  mode: z.enum(PERSONA_MODES).default('ambient_nudges'),
  /** 0..100 eagerness scalar (Companion-Agent slice 2). */
  eagerness: z.number().int().min(0).max(100).default(50),
  aclOverrides: z
    .record(z.string(), z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot']))
    .default({}),
});
export type PersonaInput = z.infer<typeof PersonaInputSchema>;

export type PersonaActivationInput = {
  personaId: string;
  deviceId: string;
  form: PersonaForm;
  position?: Record<string, unknown>;
};
