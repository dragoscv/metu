import { z } from 'zod';

// ─── Capture ────────────────────────────────────────────────────────────────

export const captureKindSchema = z.enum([
  'text',
  'voice',
  'screenshot',
  'link',
  'code',
  'email',
  'message',
  'file',
]);
export type CaptureKind = z.infer<typeof captureKindSchema>;

export const captureSourceSchema = z.enum([
  'web',
  'mobile',
  'browser-ext',
  'vscode-ext',
  'mcp',
  'telegram',
  'whatsapp',
  'gmail',
  'gcal',
  'webhook',
]);
export type CaptureSource = z.infer<typeof captureSourceSchema>;

export const createCaptureSchema = z.object({
  kind: captureKindSchema,
  content: z.string().max(50_000).optional(),
  storageKey: z.string().max(1024).optional(),
  sourceUrl: z.url().max(2048).optional(),
  source: captureSourceSchema.default('web'),
  projectId: z.uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;

// ─── Project ────────────────────────────────────────────────────────────────

export const projectStatusSchema = z.enum(['active', 'paused', 'archived', 'killed']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, hyphens only'),
  summary: z.string().max(2000).optional(),
  goalId: z.uuid().optional(),
  metadata: z
    .object({
      stack: z.array(z.string()).optional(),
      goals: z.array(z.string()).optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      links: z.record(z.string(), z.string()).optional(),
      repos: z.array(z.string()).optional(),
    })
    .partial()
    .default({}),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ─── Task ───────────────────────────────────────────────────────────────────

export const taskStatusSchema = z.enum(['inbox', 'next', 'doing', 'blocked', 'done', 'dropped']);
export const taskKindSchema = z.enum(['deep', 'shallow', 'creative', 'maintenance']);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(280),
  body: z.string().max(10_000).optional(),
  projectId: z.uuid().optional(),
  goalId: z.uuid().optional(),
  status: taskStatusSchema.default('inbox'),
  kind: taskKindSchema.default('shallow'),
  dueAt: z.iso.datetime().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// ─── Decision ───────────────────────────────────────────────────────────────

export const createDecisionSchema = z.object({
  title: z.string().min(1).max(280),
  rationale: z.string().min(1).max(20_000),
  projectId: z.uuid().optional(),
  alternatives: z.array(z.object({ name: z.string(), reason: z.string().optional() })).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

// ─── Energy ─────────────────────────────────────────────────────────────────

export const logEnergySchema = z.object({
  energy: z.number().int().min(1).max(5),
  mood: z.number().int().min(1).max(5).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string()).default([]),
});
export type LogEnergyInput = z.infer<typeof logEnergySchema>;

// ─── Focus engine ───────────────────────────────────────────────────────────

/** Constrained output of the Focus Engine LLM call. */
export const focusOutputSchema = z.object({
  now: z.object({
    taskId: z.uuid().nullable(),
    title: z.string(),
    why: z.string(),
  }),
  next: z
    .array(
      z.object({
        taskId: z.uuid().nullable(),
        title: z.string(),
        why: z.string(),
      }),
    )
    .max(3),
  ignoreThisWeek: z
    .array(
      z.object({
        projectId: z.uuid(),
        name: z.string(),
        reason: z.string(),
      }),
    )
    .min(1),
  rationale: z.string().min(20).max(2000),
});
export type FocusOutput = z.infer<typeof focusOutputSchema>;

// ─── AI providers / BYOK ────────────────────────────────────────────────────

export const aiProviderSchema = z.enum([
  'anthropic',
  'openai',
  'azure_openai',
  'google',
  'vertex',
  'copilot',
  'ollama',
  'custom',
  'deepgram',
  'cartesia',
  'elevenlabs',
]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const aiIntentSchema = z.enum([
  'reasoning',
  'agentic',
  'fast',
  'embed',
  'transcribe',
  'vision',
]);
export type AiIntent = z.infer<typeof aiIntentSchema>;

/** Per-intent routing entry: which provider + (optional) which model id. */
export const providerPolicyEntrySchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1).max(200).optional(),
});
export type ProviderPolicyEntry = z.infer<typeof providerPolicyEntrySchema>;

/** Whole policy: any intent → entry. */
export const providerPolicySchema = z.partialRecord(aiIntentSchema, providerPolicyEntrySchema);
export type ProviderPolicy = z.infer<typeof providerPolicySchema>;

export const updateProviderPolicyEntrySchema = z.object({
  intent: aiIntentSchema,
  provider: aiProviderSchema.nullable(),
  model: z.string().min(1).max(200).nullable().optional(),
});
export type UpdateProviderPolicyEntryInput = z.infer<typeof updateProviderPolicyEntrySchema>;

// ─── External integrations ──────────────────────────────────────────────────

export const integrationKindSchema = z.enum([
  'github',
  'google',
  'gmail',
  'gcal',
  'telegram',
  'whatsapp',
  'stripe',
  'vercel',
  'firebase',
  'spotify',
  'slack',
  'notion',
  'linear',
  'browser',
  'vscode',
  'webhook',
  'external_mcp',
]);
export type IntegrationKind = z.infer<typeof integrationKindSchema>;

export const integrationStatusSchema = z.enum(['active', 'paused', 'error', 'revoked']);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const connectIntegrationSchema = z.object({
  kind: integrationKindSchema,
  token: z.string().min(1).max(2000),
  label: z.string().min(1).max(120).optional(),
});
export type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;

export const disconnectIntegrationSchema = z.object({
  id: z.uuid(),
});
export type DisconnectIntegrationInput = z.infer<typeof disconnectIntegrationSchema>;

export const upsertProviderCredentialSchema = z.object({
  provider: aiProviderSchema,
  label: z.string().min(1).max(120),
  apiKey: z.string().min(1).max(500),
  endpoint: z.url().optional(),
  defaultModel: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().default(false),
});
export type UpsertProviderCredentialInput = z.infer<typeof upsertProviderCredentialSchema>;

// ─── Inngest event payloads ─────────────────────────────────────────────────

export const captureCreatedEvent = z.object({
  workspaceId: z.uuid(),
  userId: z.uuid(),
  captureId: z.uuid(),
});
export type CaptureCreatedEvent = z.infer<typeof captureCreatedEvent>;

export const memoryIndexedEvent = z.object({
  workspaceId: z.uuid(),
  sourceKind: z.string(),
  sourceId: z.uuid(),
  chunkCount: z.number().int(),
});

export const focusRecomputeEvent = z.object({
  workspaceId: z.uuid(),
  userId: z.uuid(),
  reason: z.string().optional(),
});
