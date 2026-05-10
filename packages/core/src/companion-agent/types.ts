import { z } from 'zod';

export const companionTurnInputSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  /** Persona slug talking. Used to colour responses and pick the right voice. */
  personaSlug: z.string().min(1).max(80),
  /** Last user utterance (already transcribed when it comes from voice). */
  utterance: z.string().min(1).max(4_000),
  /**
   * Optional rolling context — last few exchanges. The local lane will
   * use these directly; the escalation lane carries them as part of the
   * `conductor/tick` reason payload so the Conductor can pick them up
   * from observability.
   */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4_000),
      }),
    )
    .max(20)
    .default([]),
  /**
   * Eagerness scalar (0-100) from the active persona. Higher values
   * make triage more permissive about handling things locally and
   * escalating less often. Lower values make the local lane decline
   * more, deferring to the Conductor.
   */
  eagerness: z.number().int().min(0).max(100).default(50),
  /**
   * Surface emitting the turn. Mostly for audit + future routing
   * (e.g. mobile prefers shorter responses than companion).
   */
  surface: z
    .enum(['companion', 'mobile', 'web', 'vscode', 'browser', 'telegram', 'mcp'])
    .default('companion'),
  /**
   * Optional render context — values substituted into persona system
   * prompts via `{{userName}}`, `{{language}}`, `{{recentDigest}}`, etc.
   * Date/time placeholders are always filled at render time.
   */
  promptContext: z
    .object({
      userName: z.string().max(120).optional(),
      language: z.string().max(20).optional(),
      recentDigest: z.string().max(2_000).optional(),
    })
    .optional(),
});

export type CompanionTurnInput = z.infer<typeof companionTurnInputSchema>;

export type TriageDecision = {
  lane: 'local' | 'escalate';
  /** Short human-readable reason — surfaced in the audit log. */
  reason: string;
  /** Triage source — heuristic short-circuit vs LLM classifier. */
  source: 'heuristic' | 'classifier';
};

export type CompanionTurnResult =
  | {
      kind: 'local';
      text: string;
      triage: TriageDecision;
      /** Tool names called by the local lane (best-effort, may be empty). */
      toolCallNames: string[];
    }
  | {
      kind: 'escalated';
      triage: TriageDecision;
      /** Inngest event id returned by `inngest.send`, when available. */
      eventId?: string;
      /** Optional fast acknowledgment played to the user while the Conductor runs. */
      ack: string;
    };
