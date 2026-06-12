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
import { consumePreparedContext } from './autonomy';

export type SkillId =
  | 'catch_up'
  | 'analyze_screen'
  | 'explain_error'
  | 'whats_next'
  | 'anticipate'
  | 'deliberate'
  | 'reflect'
  | 'morning_brief'
  | 'eod_wrap';

const SKILL_ACKS_EN: Record<SkillId, string> = {
  catch_up: 'Looking back at what you were doing…',
  analyze_screen: 'Reading your screen…',
  explain_error: 'Looking at that error…',
  whats_next: 'Checking where you left off…',
  anticipate: '…',
  deliberate: '…',
  reflect: '…',
  morning_brief: 'Putting your morning brief together…',
  eod_wrap: 'Wrapping up your day…',
};
const SKILL_ACKS_RO: Record<SkillId, string> = {
  catch_up: 'Mă uit la ce făceai…',
  analyze_screen: 'Îți citesc ecranul…',
  explain_error: 'Mă uit la eroarea aia…',
  whats_next: 'Verific unde ai rămas…',
  anticipate: '…',
  deliberate: '…',
  reflect: '…',
  morning_brief: 'Îți pregătesc brieful de dimineață…',
  eod_wrap: 'Îți închei ziua…',
};
/** Acks follow the assistant language (Proxy keeps call sites unchanged). */
export const SKILL_ACKS: Record<SkillId, string> = new Proxy(SKILL_ACKS_EN, {
  get(target, prop: string) {
    const src = loadAssistantLanguage() === 'ro' ? SKILL_ACKS_RO : target;
    return src[prop as SkillId] ?? target[prop as SkillId];
  },
});

/**
 * Strip the `CHIPS: [...]` trailer the server appends (Jarvis v3 dynamic
 * quick replies). Returns clean text + parsed chips (possibly empty).
 */
export function splitChips(full: string): { text: string; chips: string[] } {
  // Models decorate the trailer ("**CHIPS:**", "CHIPS -", leading spaces…)
  // — match liberally: last line containing CHIPS followed by a JSON array.
  const m = /\n[*_\s>#-]*CHIPS:?[*_\s]*?(\[[\s\S]*?\])[*_\s]*$/i.exec(full);
  if (!m) {
    // Mid-stream: a partially-arrived trailer ("\nCHIPS: [\"Fi…") must not
    // flash raw JSON in the bubble — hide the incomplete line.
    const partial = /\n[*_\s>#-]*CHIPS:?[\s\S]*$/i.exec(full);
    if (partial) return { text: full.slice(0, partial.index).trim(), chips: [] };
    return { text: full.trim(), chips: [] };
  }
  let chips: string[] = [];
  try {
    const arr: unknown = JSON.parse(m[1]!);
    if (Array.isArray(arr)) {
      chips = arr.filter((c): c is string => typeof c === 'string' && c.length <= 60).slice(0, 3);
    }
  } catch {
    /* malformed trailer — drop it */
  }
  return { text: full.slice(0, m.index).trim(), chips };
}

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
    // Auto-research (Jarvis v6): if the autonomy engine pre-fetched
    // memory matches for the error on screen, ride them along — the
    // answer lands instantly WITH workspace history.
    const prepared = skill === 'explain_error' ? consumePreparedContext('') : null;
    return [
      head,
      outline ? `UI structure of the focused window (role/name/value):\n${outline}` : '',
      recent ? `Screen text (most recent first):\n${recent}` : '',
      prepared ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // catch_up / whats_next / anticipate / briefs → timeline + screen text.
  // Briefs look back further (the whole day; eod covers since morning).
  const hours = skill === 'morning_brief' || skill === 'eod_wrap' ? 18 : 6;
  const [timeline, recent] = await Promise.all([
    invoke<TimelineEntry[]>('sense_timeline', {
      sinceTs: Date.now() - hours * 3600_000,
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
    throw new Error(
      res.status === 402
        ? 'Budget reached.'
        : res.status === 429
          ? loadAssistantLanguage() === 'ro'
            ? 'Prea multe cereri — o clipă și încerc din nou.'
            : 'Too many requests — give me a moment.'
          : `Request failed (${res.status}).`,
    );
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

// ── Image generation (Jarvis v4): "draw/imagine …" → inline image card ────

export async function generateImage(auth: AuthState, prompt: string): Promise<{ src: string }> {
  const fresh = (await ensureFreshAuth(auth)) ?? auth;
  const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/image`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${fresh.accessToken}`,
    },
    body: JSON.stringify({ prompt }),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    dataUri?: string;
    url?: string;
    message?: string;
    error?: string;
  } | null;
  if (!res.ok || !json?.ok) {
    throw new Error(
      json?.message ??
        (res.status === 402
          ? 'Budget reached.'
          : res.status === 409
            ? 'No codai key configured for images.'
            : `Image generation failed (${res.status}).`),
    );
  }
  const src = json.dataUri ?? json.url;
  if (!src) throw new Error('Empty image response.');
  return { src };
}

// ── Vision skill (Jarvis v5): real screenshot → vision model ──────────────

/**
 * Capture the screen natively and stream a vision-model answer. Falls
 * back with a clear error when the screenshot capability is disabled.
 */
export async function runVision(
  auth: AuthState,
  question: string,
  personaSlug: string,
  onChunk: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const shot = await invoke<{ dataBase64: string }>('device_screenshot', {
    args: { target: 'screen' },
  }).catch((e: unknown) => {
    throw new Error(
      /capability/i.test(String(e))
        ? 'Screenshot capability is disabled (METU_COMPANION_CAPS).'
        : `Screenshot failed: ${String(e).slice(0, 120)}`,
    );
  });
  const fresh = (await ensureFreshAuth(auth)) ?? auth;
  const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/vision`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${fresh.accessToken}`,
    },
    body: JSON.stringify({
      imageBase64: shot.dataBase64,
      question,
      personaSlug,
      language: loadAssistantLanguage(),
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(res.status === 402 ? 'Budget reached.' : `Vision failed (${res.status}).`);
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

export interface ActStep {
  action: 'invoke' | 'set_value';
  role: string;
  name: string;
  value?: string;
}

export interface ActPlan {
  feasible: boolean;
  reason?: string;
  action?: 'invoke' | 'set_value';
  role?: string;
  name?: string;
  value?: string;
  /** Multi-step plan (max 3). Supersedes action/role/name when present. */
  steps?: ActStep[];
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

/** Normalize a plan to its ordered step list (compat with single-action). */
export function planSteps(plan: ActPlan): ActStep[] {
  if (plan.steps?.length) return plan.steps.slice(0, 3);
  if (plan.action && plan.role && plan.name) {
    return [{ action: plan.action, role: plan.role, name: plan.name, value: plan.value }];
  }
  return [];
}

/**
 * Execute a confirmed act plan via the native UIA layer — sequentially,
 * verifying between steps (Jarvis v3 multi-step): after each step the
 * next target must still exist in a FRESH a11y outline, otherwise we
 * stop and report instead of clicking blind into a changed UI.
 * One user approval covers the whole chain (steps were shown upfront).
 */
export async function executeActPlan(
  plan: ActPlan,
  onProgress?: (done: number, total: number, step: ActStep) => void,
): Promise<{ verified: boolean }> {
  const steps = planSteps(plan);
  if (!plan.feasible || steps.length === 0) {
    throw new Error(plan.reason ?? 'Nothing to execute.');
  }
  // Outcome verification baseline: snapshot the outline BEFORE acting so
  // we can tell afterwards whether the UI actually responded (a click
  // that lands on a dead button "succeeds" at the UIA level but changes
  // nothing — the user deserves to know the difference).
  const before = await a11yOutline();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    // Verify the target still exists before steps 2+ (the UI may have
    // changed after the previous action — dialogs close, tabs switch).
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 450)); // let the UI settle
      const outline = await a11yOutline();
      if (outline && !outline.toLowerCase().includes(step.name.toLowerCase().slice(0, 40))) {
        throw new Error(
          `Stopped after step ${i}: "${step.name}" is no longer on screen — the UI changed.`,
        );
      }
    }
    onProgress?.(i, steps.length, step);
    const args = {
      role: step.role,
      name: step.name,
      ...(step.action === 'set_value' ? { value: step.value ?? '' } : {}),
    };
    // sense_ui_* are the ungated user-confirmed variants — only ever called
    // after the confirm bubble (ask-before-act, one approval per plan).
    await invoke(step.action === 'invoke' ? 'sense_ui_invoke' : 'sense_ui_set_value', { args });
  }
  // Verify: did the UI change at all? (set_value chains always mutate
  // state; pure-invoke chains should visibly react.) Best-effort — an
  // empty outline (a11y hiccup) counts as unverified, not failed.
  await new Promise((r) => setTimeout(r, 500));
  const after = await a11yOutline();
  const verified = !!after && after !== before;
  return { verified };
}
