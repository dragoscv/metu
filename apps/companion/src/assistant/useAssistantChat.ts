/**
 * useAssistantChat — typed, agentic chat against the metu Conductor.
 *
 * Streams from `POST /api/sdk/v1/companion/turn/stream` (NDJSON). That endpoint
 * runs the companion-agent: it triages each turn into a fast LOCAL lane (read
 * tools, streamed tokens) or ESCALATES to the full Conductor (returns an ack +
 * fires a `conductor/tick`). The model is resolved through the workspace
 * provider mesh — codai first — so this uses whatever the account configured.
 *
 * This is the text twin of `useVoiceSession`: same auth, same persona, but the
 * "utterance" is typed instead of spoken and the reply renders as a chat
 * thread + speech bubble instead of audio.
 */
import { useCallback, useRef, useState } from 'react';
import type { AuthState } from '../state/auth';
import { ensureFreshAuth } from '../state/auth';
import { fetchScreenContext } from './activityModel';
import { loadAssistantLanguage } from '../state/language';
import { splitChips } from './skills';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Tool names the agent called on this turn (assistant messages only). */
  tools?: string[];
  /** Live tool activity while streaming: name → running|done. */
  toolActivity?: Array<{ name: string; status: 'running' | 'done' }>;
  /** True while this assistant message is still streaming. */
  pending?: boolean;
  /** Set when the turn escalated to the Conductor (async background work). */
  escalated?: boolean;
  /** Terminal error for this turn, if any. */
  error?: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'streaming' | 'escalated' | 'error';

export interface AssistantChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  /** The most recent assistant text — handy for the compact speech bubble. */
  lastAssistantText: string | null;
  /** LLM-suggested follow-up chips from the last reply (Jarvis v3.2). */
  lastChips: string[];
}

interface TurnEvent {
  type: 'triage' | 'ack' | 'escalated' | 'delta' | 'tool' | 'final' | 'error';
  text?: string;
  message?: string;
  toolCallNames?: string[];
  eventId?: string;
  triage?: { lane?: string; reason?: string };
  /** tool events */
  name?: string;
  status?: 'start' | 'done';
}

const HISTORY_LIMIT = 16;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function useAssistantChat(auth: AuthState, personaSlug: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [lastChips, setLastChips] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const authRef = useRef(auth);
  authRef.current = auth;

  const patch = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const utterance = text.trim();
      if (!utterance || status === 'thinking' || status === 'streaming') return;

      // Snapshot history (prior turns) before appending the new user message.
      const history = messages
        .filter((m) => !m.error)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: utterance };
      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('thinking');

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const fresh = (await ensureFreshAuth(authRef.current)) ?? authRef.current;
        authRef.current = fresh;
        // Jarvis Slice B — attach live screen context (text-only, already
        // privacy-gated natively) so "what am I looking at?" just works.
        const screenContext = (await fetchScreenContext().catch(() => '')) || undefined;
        const res = await fetch(
          `${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/turn/stream`,
          {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${fresh.accessToken}`,
            },
            body: JSON.stringify({
              personaSlug,
              utterance,
              history,
              surface: 'companion',
              screenContext,
              language: loadAssistantLanguage(),
            }),
          },
        );

        if (!res.ok || !res.body) {
          const msg =
            res.status === 402
              ? 'Voice/agent budget reached for this workspace.'
              : `Request failed (${res.status}).`;
          patch(assistantId, (m) => ({ ...m, pending: false, error: msg }));
          setStatus('error');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let gotDelta = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let ev: TurnEvent;
            try {
              ev = JSON.parse(trimmed) as TurnEvent;
            } catch {
              continue;
            }
            switch (ev.type) {
              case 'delta':
                if (ev.text) {
                  gotDelta = true;
                  setStatus('streaming');
                  // Hide a (possibly partial) CHIPS trailer while streaming.
                  patch(assistantId, (m) => ({
                    ...m,
                    content: splitChips(m.content + ev.text!).text,
                  }));
                }
                break;
              case 'tool':
                // Live tool lifecycle → IDE-agent-style activity rows.
                if (ev.name) {
                  setStatus('streaming');
                  patch(assistantId, (m) => {
                    const acts = [...(m.toolActivity ?? [])];
                    const i = acts.findIndex((a) => a.name === ev.name && a.status === 'running');
                    if (ev.status === 'done' && i >= 0) {
                      acts[i] = { name: ev.name!, status: 'done' };
                    } else if (ev.status === 'start') {
                      acts.push({ name: ev.name!, status: 'running' });
                    }
                    return { ...m, toolActivity: acts };
                  });
                }
                break;
              case 'ack':
                // Escalation path: show the ack as the assistant body.
                if (ev.text && !gotDelta) {
                  patch(assistantId, (m) => ({ ...m, content: ev.text! }));
                }
                break;
              case 'escalated':
                patch(assistantId, (m) => ({
                  ...m,
                  pending: false,
                  escalated: true,
                  content:
                    m.content ||
                    "On it — I've handed this to your Conductor and will follow up here.",
                }));
                setStatus('escalated');
                break;
              case 'final':
                patch(assistantId, (m) => {
                  const { text, chips } = splitChips(ev.text ?? m.content);
                  setLastChips(chips);
                  return {
                    ...m,
                    pending: false,
                    content: text,
                    tools: ev.toolCallNames && ev.toolCallNames.length ? ev.toolCallNames : m.tools,
                    toolActivity: m.toolActivity?.map((a) => ({ ...a, status: 'done' as const })),
                  };
                });
                setStatus('idle');
                break;
              case 'error':
                patch(assistantId, (m) => ({
                  ...m,
                  pending: false,
                  error: ev.message ?? 'Something went wrong.',
                }));
                setStatus('error');
                break;
              default:
                break;
            }
          }
        }
        // Stream closed without an explicit terminator — settle gracefully.
        patch(assistantId, (m) => (m.pending ? { ...m, pending: false } : m));
        setStatus((s) => (s === 'streaming' || s === 'thinking' ? 'idle' : s));
      } catch (err) {
        if (ctrl.signal.aborted) {
          patch(assistantId, (m) => ({ ...m, pending: false }));
          setStatus('idle');
          return;
        }
        patch(assistantId, (m) => ({
          ...m,
          pending: false,
          error: err instanceof Error ? err.message : 'Network error.',
        }));
        setStatus('error');
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [messages, status, personaSlug, patch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus('idle');
  }, []);

  /**
   * Thread an out-of-band assistant message into the conversation —
   * Conductor follow-ups after an escalation ("3 done, 1 awaiting your
   * approval"). Closes the agentic loop: the thread that promised "I'll
   * follow up here" actually does. Also flips the last escalated
   * message's status so the UI stops implying it's still pending.
   */
  const appendAssistant = useCallback((text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => {
      // Mark the most recent escalated turn as resolved.
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]!;
        if (m.role === 'assistant' && m.escalated) {
          next[i] = { ...m, escalated: false };
          break;
        }
      }
      return [...next, { id: uid(), role: 'assistant' as const, content: text.trim() }];
    });
    setStatus('idle');
  }, []);

  /**
   * Run a LOCAL skill turn inside the thread (Jarvis v4.3): shows the
   * user's message + a pending assistant message immediately, streams
   * updates into it, and settles with chips. This is how skills
   * (analyze_screen, catch_up…) appear in the PANEL with live progress
   * instead of streaming into the invisible bubble while the panel is
   * open — the "nothing is happening" gap.
   */
  const startLocalTurn = useCallback(
    (userText: string, ack: string) => {
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: userText };
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: ack, pending: true },
      ]);
      setStatus('thinking');
      return {
        update: (full: string) => {
          setStatus('streaming');
          patch(assistantId, (m) => ({ ...m, content: full }));
        },
        finish: (text: string, chips: string[]) => {
          setLastChips(chips);
          patch(assistantId, (m) => ({ ...m, content: text, pending: false }));
          setStatus('idle');
        },
        fail: (message: string) => {
          patch(assistantId, (m) => ({ ...m, pending: false, error: message, content: '' }));
          setStatus('error');
        },
      };
    },
    [patch],
  );

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  const state: AssistantChatState = {
    messages,
    status,
    lastAssistantText: lastAssistant?.error ?? lastAssistant?.content ?? null,
    lastChips,
  };

  return { ...state, send, stop, clear, appendAssistant, startLocalTurn };
}
