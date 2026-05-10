/**
 * Companion-Agent — two-tier reactive loop (slice 8).
 *
 * The Conductor is metu's continuous, planning-grade backend agent: it
 * runs on Inngest ticks, calls big models (Sonnet / GPT-5), and is
 * appropriate for goals, multi-step plans, and anything that needs
 * memory or integrations. Latency: seconds.
 *
 * The Companion-Agent is a **fast on-device reactive lane**: when a
 * user speaks to a persona on the companion or mobile, we want sub-second
 * acknowledgment ("yes, looking now…") and immediate handling of trivial
 * intents (greetings, simple Q&A on cached state, immediate device
 * read tools) **without** waking the heavy Conductor for every utterance.
 *
 * This package owns the triage decision and the local lane. Anything
 * the local lane can't or shouldn't handle escalates to the Conductor
 * via the existing `conductor/tick` Inngest event.
 *
 * Surface:
 *   - `runCompanionTurn(input)` — single-call entry point.
 *   - `triageTurn(input)` — exported for visibility / debugging.
 *   - Types: `CompanionTurnInput`, `CompanionTurnResult`.
 */
export * from './types';
export { triageTurn, HEURISTIC_ESCALATE_KEYWORDS } from './triage';
export { runCompanionTurn, streamCompanionTurn } from './run';
export type { CompanionStreamEvent } from './run';
