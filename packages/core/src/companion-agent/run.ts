/**
 * Orchestrator — `runCompanionTurn`.
 *
 * Triages → either runs the local lane and returns text, OR signals
 * escalation. Escalation itself (sending the `conductor/tick` Inngest
 * event) lives in the caller, since `packages/core` doesn't depend on
 * the Inngest client (`apps/web` does). The caller passes a small
 * `onEscalate` callback; we hand it the same context we used for triage.
 *
 * Even on escalate, we still return a one-line "ack" the caller can
 * speak immediately so the user feels heard while the Conductor warms
 * up. The ack is computed locally with no LLM call (no extra latency).
 */
import { triageTurn } from './triage';
import { respondLocal, streamLocal, type LocalStreamEvent } from './respond';
import { getBuiltInPersona } from '@metu/presence';
import {
  companionTurnInputSchema,
  type CompanionTurnInput,
  type CompanionTurnResult,
  type TriageDecision,
} from './types';

export interface RunCompanionTurnOptions {
  /**
   * Called when triage decides to escalate. Should send the
   * `conductor/tick` Inngest event (or equivalent). Returning the event
   * id is optional but useful for the audit log.
   */
  onEscalate?: (input: CompanionTurnInput, reason: string) => Promise<string | undefined>;
}

const ACKS_BY_LANGUAGE: Record<string, string[]> = {
  en: ['On it.', "I'll get that going.", 'Working on it now.', 'Picking that up.'],
  ro: ['Mă ocup.', 'Imediat.', 'Mă apuc acum.', 'Preiau eu.'],
  fr: ["Je m'en occupe.", 'Tout de suite.', 'Je le fais.'],
  de: ['Mache ich.', 'Sofort.', 'Wird erledigt.'],
  es: ['Voy a ello.', 'Enseguida.', 'Lo hago.'],
};

function pickAck(personaSlug: string): string {
  const persona = getBuiltInPersona(personaSlug);
  const lang = persona?.language ?? 'en';
  const pool = ACKS_BY_LANGUAGE[lang] ?? ACKS_BY_LANGUAGE.en ?? ['On it.'];
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? pool[0]!;
}

export async function runCompanionTurn(
  rawInput: CompanionTurnInput,
  opts: RunCompanionTurnOptions = {},
): Promise<CompanionTurnResult> {
  const input = companionTurnInputSchema.parse(rawInput);

  const triage = await triageTurn(input);

  if (triage.lane === 'escalate') {
    let eventId: string | undefined;
    try {
      eventId = await opts.onEscalate?.(input, triage.reason);
    } catch {
      // Escalation transport failure must never break the user-visible turn —
      // the user still gets the ack; the audit log will show no eventId.
    }
    return {
      kind: 'escalated',
      triage,
      eventId,
      ack: pickAck(input.personaSlug),
    };
  }

  const local = await respondLocal(input);
  return {
    kind: 'local',
    text: local.text,
    triage,
    toolCallNames: local.toolCallNames,
  };
}

// ─── Streaming variant ────────────────────────────────────────────────────

export type CompanionStreamEvent =
  | { type: 'triage'; triage: TriageDecision }
  | { type: 'ack'; text: string }
  | { type: 'escalated'; eventId?: string; triage: TriageDecision }
  | { type: 'delta'; text: string }
  | { type: 'final'; text: string; toolCallNames: string[]; triage: TriageDecision }
  | { type: 'error'; message: string };

/**
 * Streaming twin of `runCompanionTurn`. Emits a `triage` event first, then
 * either:
 *   - escalate path: `ack` + `escalated` (with optional eventId)
 *   - local path: zero or more `delta` events + a single `final`
 *
 * Always terminates with either a `final`, `escalated`, or `error` event.
 * Caller wraps each event as one NDJSON line for transport.
 */
export async function* streamCompanionTurn(
  rawInput: CompanionTurnInput,
  opts: RunCompanionTurnOptions = {},
): AsyncGenerator<CompanionStreamEvent> {
  const input = companionTurnInputSchema.parse(rawInput);

  let triage: TriageDecision;
  try {
    triage = await triageTurn(input);
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: 'triage', triage };

  if (triage.lane === 'escalate') {
    const ack = pickAck(input.personaSlug);
    yield { type: 'ack', text: ack };
    let eventId: string | undefined;
    try {
      eventId = await opts.onEscalate?.(input, triage.reason);
    } catch {
      // Escalation transport failure must not surface as an error to the
      // user — we still gave them an ack and the audit log will show the
      // missing eventId.
    }
    yield { type: 'escalated', eventId, triage };
    return;
  }

  let assembled = '';
  let toolCallNames: string[] = [];
  try {
    for await (const ev of streamLocal(input) as AsyncGenerator<LocalStreamEvent>) {
      if (ev.type === 'delta') {
        assembled += ev.text;
        yield { type: 'delta', text: ev.text };
      } else if (ev.type === 'final') {
        toolCallNames = ev.toolCallNames;
        yield { type: 'final', text: ev.text, toolCallNames, triage };
        return;
      } else if (ev.type === 'error') {
        yield { type: 'error', message: ev.message };
        return;
      }
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  // Defensive: if streamLocal somehow ends without `final` we still emit
  // one so the consumer's stream handler resolves cleanly.
  yield {
    type: 'final',
    text: assembled.trim() || 'Mm-hm.',
    toolCallNames,
    triage,
  };
}
