/**
 * Retrieval-time composite scoring — TS mirror of the SQL in
 * packages/db/src/queries/memory.ts (recallByEmbedding). Keep the two in
 * sync; the unit tests in __tests__/scoring.test.ts encode the contract.
 *
 *   score = similarity × recencyDecay(ageDays) × typeBoost(kind, origin)
 */

export const RECENCY_HALF_LIFE_DAYS = 30;
export const RECENCY_FLOOR = 0.2;

/** e^(-ageDays/30), floored at 0.2 so durable old insights never vanish. */
export function recencyDecay(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  return Math.max(RECENCY_FLOOR, Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS));
}

/** Boost distilled insights, dampen raw ambient activity. */
export function typeBoost(sourceKind: string, origin?: string | null): number {
  if (origin === 'consolidation') return 1.5;
  if (sourceKind === 'decision' || sourceKind === 'project_summary') return 1.3;
  if (origin === 'companion-activity') return 0.7;
  return 1.0;
}

export function compositeScore(input: {
  similarity: number;
  ageDays: number;
  sourceKind: string;
  origin?: string | null;
}): number {
  return input.similarity * recencyDecay(input.ageDays) * typeBoost(input.sourceKind, input.origin);
}
