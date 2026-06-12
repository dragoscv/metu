/**
 * Chat session persistence (Jarvis v4.4).
 *
 * Conversations survive restarts/hot-reloads: every session (id, title,
 * messages) lives in localStorage, the active one is restored on mount.
 * The user can create/switch sessions; the assistant stays aware of the
 * OTHER recent sessions through a compact digest the chat hook prepends
 * to the model history — one continuous relationship, many threads.
 */
import type { ChatMessage } from './useAssistantChat';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_KEY = 'metu.chat.sessions.v1';
const ACTIVE_KEY = 'metu.chat.activeSession.v1';
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 60;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as ChatSession[]).filter(
      (s) => typeof s?.id === 'string' && Array.isArray(s.messages),
    );
  } catch {
    return [];
  }
}

function persist(sessions: ChatSession[]): void {
  try {
    // Newest first, capped; drop pending/error transients before saving.
    const clean = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS)
      .map((s) => ({
        ...s,
        messages: s.messages
          .filter((m) => !m.pending)
          .slice(-MAX_MESSAGES_PER_SESSION)
          .map((m) => ({ ...m, toolActivity: undefined })),
      }));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(clean));
  } catch {
    /* quota — drop oldest and retry once */
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(loadSessions().slice(0, 5)));
    } catch {
      /* give up silently */
    }
  }
}

export function saveSession(session: ChatSession): void {
  const sessions = loadSessions().filter((s) => s.id !== session.id);
  sessions.push(session);
  persist(sessions);
}

export function deleteSession(id: string): void {
  persist(loadSessions().filter((s) => s.id !== id));
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function createSession(): ChatSession {
  const now = Date.now();
  return { id: uid(), title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
}

/** Auto-title from the first user message (cheap, local). */
export function titleFor(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New conversation';
  const t = first.content.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

/**
 * Compact digest of OTHER recent sessions — prepended to model history so
 * the assistant feels like ONE continuous conversation across threads
 * ("as we discussed about the trading bot…") without bloating tokens.
 */
export function otherSessionsDigest(activeId: string): string | null {
  const others = loadSessions()
    .filter((s) => s.id !== activeId && s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  if (others.length === 0) return null;
  const lines = others.map((s) => {
    const lastAssistant = [...s.messages].reverse().find((m) => m.role === 'assistant');
    const gist = lastAssistant?.content.trim().replace(/\s+/g, ' ').slice(0, 100) ?? '';
    return `- "${s.title}"${gist ? ` — last: ${gist}` : ''}`;
  });
  return `(Context from our other recent conversations:\n${lines.join('\n')})`;
}
