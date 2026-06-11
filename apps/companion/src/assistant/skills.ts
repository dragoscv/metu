/**
 * Direct skill lane (Jarvis perf pass) — avatar quick actions that bypass
 * triage/Conductor entirely. Each skill:
 *   1. Shows an instant contextual ack (caller renders it in the bubble).
 *   2. Gathers the right LOCAL context (activity timeline, OCR text).
 *   3. Streams a single `fast`-intent completion from
 *      POST /api/sdk/v1/companion/skill into the bubble as it arrives.
 *
 * Latency budget: ack <50ms, first token ~1-2s, full answer 2-4s.
 */
import { invoke } from '@tauri-apps/api/core';
import { ensureFreshAuth, type AuthState } from '../state/auth';
import { isTauri } from '../state/runtime';
import { getActivityState } from './activityModel';

export type SkillId = 'catch_up' | 'analyze_screen' | 'explain_error' | 'whats_next';

export const SKILL_ACKS: Record<SkillId, string> = {
  catch_up: 'Looking back at what you were doing…',
  analyze_screen: 'Reading your screen…',
  explain_error: 'Looking at that error…',
  whats_next: 'Checking where you left off…',
};

interface TimelineEntry {
  app: string;
  title: string;
  startedTs: number;
  endedTs: number | null;
}

/** Build the context string each skill needs — all local, all fast. */
async function gatherContext(skill: SkillId): Promise<string> {
  if (!isTauri()) return '';
  const act = getActivityState();
  const head = act.app
    ? `Currently focused: ${act.app}${act.title ? ` — ${act.title}` : ''} (${act.appClass}${
        act.projectGuess ? `, project: ${act.projectGuess}` : ''
      })`
    : '';

  if (skill === 'analyze_screen' || skill === 'explain_error') {
    const recent = await invoke<string>('sense_recent_text', {
      minutes: 5,
      maxChars: 8_000,
    }).catch(() => '');
    return [head, recent ? `Screen text (most recent first):\n${recent}` : '']
      .filter(Boolean)
      .join('\n\n');
  }

  // catch_up / whats_next → timeline + a bit of screen text.
  const [timeline, recent] = await Promise.all([
    invoke<TimelineEntry[]>('sense_timeline', {
      sinceTs: Date.now() - 6 * 3600_000,
      limit: 60,
    }).catch(() => [] as TimelineEntry[]),
    invoke<string>('sense_recent_text', { minutes: 15, maxChars: 3_000 }).catch(() => ''),
  ]);
  const sessions = timeline
    .slice(0, 25)
    .map((t) => {
      const mins = Math.max(1, Math.round(((t.endedTs ?? Date.now()) - t.startedTs) / 60_000));
      return `- ${t.app}: ${t.title.slice(0, 90)} (${mins}min)`;
    })
    .join('\n');
  return [
    head,
    sessions ? `Recent sessions (newest first):\n${sessions}` : '',
    recent ? `Recent screen text:\n${recent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Run a skill, streaming text chunks to `onChunk`. Returns the full text.
 * Throws on transport errors — caller shows the error in the bubble.
 */
export async function runSkill(
  auth: AuthState,
  skill: SkillId,
  personaSlug: string,
  onChunk: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const [fresh, context] = await Promise.all([
    ensureFreshAuth(auth).then((a) => a ?? auth),
    gatherContext(skill),
  ]);

  const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/skill`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${fresh.accessToken}`,
    },
    body: JSON.stringify({ skill, context, personaSlug }),
  });
  if (!res.ok || !res.body) {
    throw new Error(res.status === 402 ? 'Budget reached.' : `Request failed (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(full);
  }
  return full;
}
