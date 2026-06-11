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
import { loadAssistantLanguage } from '../state/language';

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

interface A11yNode {
  role: string;
  name: string;
  value: string;
  enabled: boolean;
  selected: boolean;
  patterns: string[];
  children: A11yNode[];
}

/**
 * Flatten the focused window's UIA tree into a compact, LLM-readable
 * outline: real UI structure (buttons, fields, tabs, their state) instead
 * of flat OCR text. Skips structural noise (panes/groups without names).
 */
function outlineA11y(node: A11yNode, depth: number, out: string[], budget: { left: number }): void {
  if (budget.left <= 0 || depth > 7) return;
  const interesting =
    node.name.trim() !== '' || node.value.trim() !== '' || node.patterns.length > 0;
  const structural = /pane|group|custom|window/i.test(node.role) && !node.name.trim();
  if (interesting && !structural) {
    const bits = [
      `${'  '.repeat(Math.min(depth, 5))}[${node.role}] ${node.name.slice(0, 80)}`,
      node.value ? `= "${node.value.slice(0, 120)}"` : '',
      !node.enabled ? '(disabled)' : '',
      node.selected ? '(selected)' : '',
    ].filter(Boolean);
    out.push(bits.join(' '));
    budget.left--;
  }
  for (const c of node.children) outlineA11y(c, depth + 1, out, budget);
}

/** Read the focused window's accessibility outline. '' on any failure. */
async function a11yOutline(): Promise<string> {
  try {
    const tree = await invoke<{ root: A11yNode | null; truncated: boolean }>('sense_ui_outline', {
      args: { maxDepth: 7, maxNodes: 400 },
    });
    if (!tree.root) return '';
    const out: string[] = [];
    outlineA11y(tree.root, 0, out, { left: 120 });
    return out.join('\n');
  } catch {
    return ''; // capability disabled / non-Windows / UIA hiccup
  }
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
    // Structured UI first (real elements + state via UIA), OCR as the
    // content layer. Together the model sees both WHAT the app is and
    // WHAT it says — far better than OCR alone.
    const [outline, recent] = await Promise.all([
      a11yOutline(),
      invoke<string>('sense_recent_text', { minutes: 5, maxChars: 6_000 }).catch(() => ''),
    ]);
    return [
      head,
      outline ? `UI structure of the focused window (role/name/value):\n${outline}` : '',
      recent ? `Screen text (most recent first):\n${recent}` : '',
    ]
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
    body: JSON.stringify({ skill, context, personaSlug, language: loadAssistantLanguage() }),
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

// ── Act skill: instruction → ONE confirmed UIA action ─────────────────────

export interface ActPlan {
  feasible: boolean;
  reason?: string;
  action?: 'invoke' | 'set_value';
  role?: string;
  name?: string;
  value?: string;
  prompt?: string;
}

/**
 * Plan a UI action from a natural-language instruction. Sends the focused
 * window's a11y outline to the act planner; returns the plan. The CALLER
 * is responsible for user confirmation before calling {@link executeActPlan}
 * — ask-before-act is non-negotiable.
 */
export async function planAct(
  auth: AuthState,
  instruction: string,
  personaSlug: string,
): Promise<ActPlan> {
  const [fresh, context] = await Promise.all([
    ensureFreshAuth(auth).then((a) => a ?? auth),
    gatherContext('analyze_screen'), // outline + screen text — same context
  ]);
  const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/skill`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${fresh.accessToken}`,
    },
    body: JSON.stringify({ skill: 'act', instruction, context, personaSlug }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  const json = (await res.json()) as { ok: boolean; plan?: ActPlan };
  if (!json.ok || !json.plan) throw new Error('Planner returned nothing.');
  return json.plan;
}

/** Execute a confirmed act plan via the native UIA layer. */
export async function executeActPlan(plan: ActPlan): Promise<void> {
  if (!plan.feasible || !plan.action || !plan.role || !plan.name) {
    throw new Error(plan.reason ?? 'Nothing to execute.');
  }
  const args = {
    role: plan.role,
    name: plan.name,
    ...(plan.action === 'set_value' ? { value: plan.value ?? '' } : {}),
  };
  // sense_ui_* are the ungated user-confirmed variants — only ever called
  // after the confirm bubble (ask-before-act).
  await invoke(plan.action === 'invoke' ? 'sense_ui_invoke' : 'sense_ui_set_value', { args });
}
