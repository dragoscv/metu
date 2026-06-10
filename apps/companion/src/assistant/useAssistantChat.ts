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

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Tool names the agent called on this turn (assistant messages only). */
  tools?: string[];
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
}

interface TurnEvent {
  type: 'triage' | 'ack' | 'escalated' | 'delta' | 'final' | 'error';
  text?: string;
  message?: string;
  toolCallNames?: string[];
  eventId?: string;
  triage?: { lane?: string; reason?: string };
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
                  patch(assistantId, (m) => ({ ...m, content: m.content + ev.text }));
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
                patch(assistantId, (m) => ({
                  ...m,
                  pending: false,
                  content: ev.text ?? m.content,
                  tools: ev.toolCallNames && ev.toolCallNames.length ? ev.toolCallNames : m.tools,
                }));
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

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  const state: AssistantChatState = {
    messages,
    status,
    lastAssistantText: lastAssistant?.error ?? lastAssistant?.content ?? null,
  };

  return { ...state, send, stop, clear };
}
