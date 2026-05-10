/**
 * Triage — decide whether an utterance is handled by the fast on-device
 * lane or escalated to the heavy Conductor.
 *
 * Two stages:
 *   1. Heuristic short-circuits — keyword / length checks. If a clearly
 *      conductor-grade verb appears ("schedule", "create", "send",
 *      "remind me tomorrow", …) we skip the LLM call entirely. Same for
 *      anything > 600 chars (treat as a real instruction, not a chat).
 *   2. LLM classifier — cheap `intent: 'classify'` model returning a
 *      single token. We use `generateObject` for type safety. On model
 *      failure we default-escalate so we never lose a user request.
 *
 * The eagerness scalar from the persona shifts the threshold:
 *   - eagerness ≥ 75 → skip step 2 entirely (always-local unless the
 *     heuristic forces escalate). Useful for "anticipatory" personas.
 *   - eagerness ≤ 25 → step 1 is treated as binding and step 2 is
 *     biased toward escalate.
 */
import { z } from 'zod';
import { generateObject } from 'ai';
import { getModel } from '@metu/ai';
import type { CompanionTurnInput, TriageDecision } from './types';

/**
 * Words that always mean "this is real work" and belong on the
 * Conductor. Order doesn't matter; matched as whole words case-insensitive.
 */
export const HEURISTIC_ESCALATE_KEYWORDS = [
  // Calendar / time
  'schedule',
  'remind',
  'tomorrow',
  'next week',
  'next month',
  // Mutations
  'create',
  'send',
  'email',
  'message',
  'post',
  'commit',
  'merge',
  'delete',
  'cancel',
  'pay',
  'invoice',
  'subscribe',
  // Multi-step planning
  'plan',
  'strategy',
  'roadmap',
  'breakdown',
  'organise',
  'organize',
  // External integrations
  'github',
  'slack',
  'telegram',
  'gmail',
  'calendar',
  'notion',
  'linear',
  // Long-running
  'monitor',
  'watch',
  'every day',
  'every hour',
  'until',
];

const LOCAL_HINT_KEYWORDS = [
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank you',
  'cool',
  'ok',
  'okay',
  'what time',
  'what is',
  "what's",
  'who is',
  "who's",
  'tell me',
  'what can you',
  'are you',
];

function heuristic(input: CompanionTurnInput): TriageDecision | null {
  const text = input.utterance.trim();
  if (text.length === 0) {
    return { lane: 'local', reason: 'empty utterance', source: 'heuristic' };
  }
  if (text.length > 600) {
    return { lane: 'escalate', reason: 'long utterance (>600 chars)', source: 'heuristic' };
  }
  const lower = ` ${text.toLowerCase()} `;
  for (const kw of HEURISTIC_ESCALATE_KEYWORDS) {
    if (lower.includes(` ${kw} `)) {
      return {
        lane: 'escalate',
        reason: `matched keyword "${kw}"`,
        source: 'heuristic',
      };
    }
  }
  // Bare greetings / acks — always local.
  for (const kw of LOCAL_HINT_KEYWORDS) {
    if (lower.startsWith(` ${kw}`) || lower === ` ${kw} `) {
      return { lane: 'local', reason: `matched local hint "${kw}"`, source: 'heuristic' };
    }
  }
  return null;
}

const triageSchema = z.object({
  lane: z.enum(['local', 'escalate']),
  reason: z.string().max(160),
});

const TRIAGE_SYSTEM = `You are a routing classifier inside a personal AI operating system.
Decide whether the user's utterance can be answered by a fast on-device assistant ("local")
or whether it requires the heavy planning agent ("escalate").

Return "local" when the utterance is:
  - small talk, greetings, acknowledgements
  - a question whose answer is general knowledge
  - a question about the assistant itself
  - a request to read or describe what is currently on screen / in a window
  - a quick search through recent personal memory ("what was I doing?")

Return "escalate" when the utterance:
  - asks for any change in the world (create, send, schedule, post, delete…)
  - involves an external integration (GitHub, Slack, Calendar, Email…)
  - requires multi-step planning, comparisons, or research
  - sets a reminder, deadline, or rule that lives beyond this turn
  - is anything you are uncertain about — escalate by default

Respond ONLY with the structured object {lane, reason}. Reason ≤ 160 chars.`;

export async function triageTurn(input: CompanionTurnInput): Promise<TriageDecision> {
  const h = heuristic(input);
  if (h) return h;

  // Eagerness ≥ 75 personas trust the heuristic and stay local when it
  // didn't fire. (anticipatory mode is supposed to feel snappy.)
  if (input.eagerness >= 75) {
    return { lane: 'local', reason: 'high eagerness, no escalate keyword', source: 'heuristic' };
  }

  try {
    // 'fast' is the cheapest classifier-grade intent in our registry.
    // We deliberately don't add a separate 'classify' intent: the
    // intent set is curated.
    const { model } = await getModel({ workspaceId: input.workspaceId, intent: 'fast' });
    const { object } = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: triageSchema,
      system: TRIAGE_SYSTEM,
      prompt: `Persona: ${input.personaSlug}\nSurface: ${input.surface}\nUtterance: ${input.utterance}`,
      maxOutputTokens: 80,
    });
    // Low-eagerness personas bias toward escalate when the model is
    // ambivalent — if reason mentions uncertainty, force escalate.
    if (
      input.eagerness <= 25 &&
      object.lane === 'local' &&
      /uncertain|ambig|maybe|not sure/i.test(object.reason)
    ) {
      return {
        lane: 'escalate',
        reason: `low-eagerness override: ${object.reason}`,
        source: 'classifier',
      };
    }
    return { ...object, source: 'classifier' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Fail safe: when the classifier is down, escalate so we never
    // silently swallow a real instruction.
    return {
      lane: 'escalate',
      reason: `classifier error: ${detail.slice(0, 100)}`,
      source: 'classifier',
    };
  }
}
