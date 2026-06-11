/**
 * Activity summaries — the ONLY ambient-awareness data that leaves the
 * companion device. Raw frames/OCR stay in the local activity.db; the
 * distiller reduces them to these text summaries (Jarvis plan, Slice B).
 */
import { z } from 'zod';

export const ActivitySummarySchema = z.object({
  /** Period covered (epoch ms). */
  startTs: z.number().int().nonnegative(),
  endTs: z.number().int().nonnegative(),
  /** 'periodic' (~15min cadence) | 'session' (focus session end) | 'daily'. */
  kind: z.enum(['periodic', 'session', 'daily']),
  /** Distilled "what the user worked on" — plain text, ≤ 2k chars. */
  summary: z.string().min(1).max(2_000),
  /** Top apps by foreground time, most-used first. */
  apps: z.array(z.string().max(120)).max(12).default([]),
  /** Project/repo guess if confident (e.g. 'metu', 'mmo'). */
  projectGuess: z.string().max(120).nullish(),
  /** Coarse activity class. */
  activityClass: z
    .enum(['coding', 'browsing', 'writing', 'comms', 'media', 'design', 'mixed', 'idle'])
    .default('mixed'),
});
export type ActivitySummary = z.infer<typeof ActivitySummarySchema>;
