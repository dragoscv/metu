/**
 * Parsers for chat conversation exports.
 *
 * Supported formats (auto-detected):
 *   - chatgpt-json:    `conversations.json` from a ChatGPT data export, or a
 *                      single conversation object in the same shape (the
 *                      tree-of-messages format with `mapping` keyed by node id).
 *   - claude-json:     `conversations.json` from a Claude data export
 *                      (`chat_messages` array per conversation).
 *   - markdown:        Generic markdown / pasted text where lines starting
 *                      with `User:`, `Assistant:`, `**You**`, `**ChatGPT**`,
 *                      `### User`, etc. delimit turns. Falls through to a
 *                      single-message conversation when no markers found.
 *
 * Pure functions, no I/O. Throw on truly malformed input; otherwise return
 * a list of `ParsedConversation`s.
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ParsedMessage {
  role: Role;
  content: string;
  /** ISO 8601 if known. */
  createdAt?: string;
  /** Underlying model id if known. */
  model?: string;
}

export interface ParsedConversation {
  /** Source-provided id when present, else a stable hash placeholder. */
  externalId?: string;
  title: string;
  messages: ParsedMessage[];
  /** ISO 8601 of the first message. */
  createdAt?: string;
  /** ISO 8601 of the last message. */
  updatedAt?: string;
  /** Underlying source format that produced this conversation. */
  format: ConversationFormat;
  /** Free-form metadata captured from the source (model used, etc.). */
  metadata?: Record<string, unknown>;
}

export type ConversationFormat = 'chatgpt-json' | 'claude-json' | 'markdown' | 'unknown';

// ─── Public API ────────────────────────────────────────────────────────────

export interface ParseResult {
  format: ConversationFormat;
  conversations: ParsedConversation[];
}

export function detectFormat(raw: string): ConversationFormat {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(raw);
      if (looksLikeChatGptJson(json)) return 'chatgpt-json';
      if (looksLikeClaudeJson(json)) return 'claude-json';
    } catch {
      // fall through
    }
  }
  return 'markdown';
}

export function parseConversations(raw: string, format?: ConversationFormat): ParseResult {
  const fmt = format && format !== 'unknown' ? format : detectFormat(raw);
  switch (fmt) {
    case 'chatgpt-json':
      return { format: fmt, conversations: parseChatGptJson(raw) };
    case 'claude-json':
      return { format: fmt, conversations: parseClaudeJson(raw) };
    case 'markdown':
      return { format: fmt, conversations: parseMarkdown(raw) };
    default:
      return { format: 'unknown', conversations: [] };
  }
}

/**
 * Render a parsed conversation as plain text suitable for embedding /
 * memory chunking. Each turn is prefixed with the role and (when known)
 * timestamp. Trims excessive blank lines.
 */
export function renderConversation(conv: ParsedConversation): string {
  const head = conv.title ? `# ${conv.title}\n\n` : '';
  const body = conv.messages
    .map((m) => {
      const ts = m.createdAt ? ` · ${m.createdAt}` : '';
      const model = m.model ? ` · ${m.model}` : '';
      const role = m.role[0]!.toUpperCase() + m.role.slice(1);
      return `## ${role}${model}${ts}\n${m.content.trim()}`;
    })
    .join('\n\n');
  return (head + body).replace(/\n{3,}/g, '\n\n').trim();
}

// ─── ChatGPT (export `conversations.json`) ─────────────────────────────────

interface ChatGptNode {
  id: string;
  message: {
    id: string;
    author: { role: Role; metadata?: Record<string, unknown> };
    create_time?: number | null;
    content?: {
      content_type?: string;
      parts?: unknown[];
      text?: string;
    };
    metadata?: { model_slug?: string };
  } | null;
  parent?: string | null;
  children: string[];
}

interface ChatGptConv {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping: Record<string, ChatGptNode>;
}

function looksLikeChatGptJson(json: unknown): boolean {
  if (Array.isArray(json) && json.length > 0) {
    const first = json[0] as Partial<ChatGptConv>;
    return !!first.mapping && typeof first.mapping === 'object';
  }
  if (json && typeof json === 'object') {
    const obj = json as Partial<ChatGptConv>;
    return !!obj.mapping && typeof obj.mapping === 'object';
  }
  return false;
}

function parseChatGptJson(raw: string): ParsedConversation[] {
  const json = JSON.parse(raw) as ChatGptConv | ChatGptConv[];
  const list = Array.isArray(json) ? json : [json];
  return list
    .map((c) => parseChatGptConversation(c))
    .filter((c): c is ParsedConversation => c !== null && c.messages.length > 0);
}

function parseChatGptConversation(c: ChatGptConv): ParsedConversation | null {
  if (!c.mapping) return null;
  // Build linear path from root to current_node (leaf) by walking parents.
  const leaf =
    c.current_node ??
    Object.values(c.mapping)
      .filter((n) => !n.children?.length)
      .map((n) => n.id)
      .pop();
  if (!leaf) return null;

  const path: ChatGptNode[] = [];
  let cur: string | null | undefined = leaf;
  const seen = new Set<string>();
  while (cur && c.mapping[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.unshift(c.mapping[cur]!);
    cur = c.mapping[cur]?.parent ?? null;
  }

  const messages: ParsedMessage[] = [];
  for (const node of path) {
    const m = node.message;
    if (!m) continue;
    const role = m.author?.role;
    if (!role || (role !== 'user' && role !== 'assistant' && role !== 'system')) {
      continue;
    }
    const text = extractChatGptText(m.content);
    if (!text || !text.trim()) continue;
    messages.push({
      role,
      content: text,
      createdAt: m.create_time ? new Date(m.create_time * 1000).toISOString() : undefined,
      model: m.metadata?.model_slug,
    });
  }

  if (messages.length === 0) return null;
  const externalId = c.id ?? c.conversation_id;
  return {
    externalId,
    title: c.title?.trim() || messages[0]!.content.slice(0, 80),
    messages,
    createdAt: c.create_time
      ? new Date(c.create_time * 1000).toISOString()
      : messages[0]?.createdAt,
    updatedAt: c.update_time
      ? new Date(c.update_time * 1000).toISOString()
      : messages[messages.length - 1]?.createdAt,
    format: 'chatgpt-json',
    metadata: { sourceId: externalId },
  };
}

function extractChatGptText(
  content: { content_type?: string; parts?: unknown[]; text?: string } | undefined,
): string {
  if (!content) return '';
  if (content.text && typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          const obj = p as { text?: string; content_type?: string };
          if (typeof obj.text === 'string') return obj.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// ─── Claude (export `conversations.json`) ──────────────────────────────────

interface ClaudeChatMessage {
  uuid?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string }>;
  sender?: 'human' | 'assistant';
  created_at?: string;
}

interface ClaudeConv {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages: ClaudeChatMessage[];
}

function looksLikeClaudeJson(json: unknown): boolean {
  if (Array.isArray(json) && json.length > 0) {
    const first = json[0] as Partial<ClaudeConv>;
    return Array.isArray(first.chat_messages);
  }
  if (json && typeof json === 'object') {
    const obj = json as Partial<ClaudeConv>;
    return Array.isArray(obj.chat_messages);
  }
  return false;
}

function parseClaudeJson(raw: string): ParsedConversation[] {
  const json = JSON.parse(raw) as ClaudeConv | ClaudeConv[];
  const list = Array.isArray(json) ? json : [json];
  return list
    .map((c) => parseClaudeConversation(c))
    .filter((c): c is ParsedConversation => c !== null && c.messages.length > 0);
}

function parseClaudeConversation(c: ClaudeConv): ParsedConversation | null {
  if (!Array.isArray(c.chat_messages)) return null;
  const messages: ParsedMessage[] = [];
  for (const m of c.chat_messages) {
    const role: Role | null =
      m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const text =
      (m.text && m.text.trim()) ||
      (Array.isArray(m.content)
        ? m.content
            .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
            .filter(Boolean)
            .join('\n')
        : '');
    if (!text.trim()) continue;
    messages.push({
      role,
      content: text,
      createdAt: m.created_at,
    });
  }
  if (messages.length === 0) return null;
  return {
    externalId: c.uuid,
    title: c.name?.trim() || messages[0]!.content.slice(0, 80),
    messages,
    createdAt: c.created_at ?? messages[0]?.createdAt,
    updatedAt: c.updated_at ?? messages[messages.length - 1]?.createdAt,
    format: 'claude-json',
    metadata: { sourceId: c.uuid },
  };
}

// ─── Markdown / pasted text ───────────────────────────────────────────────

const ROLE_LINE =
  /^(?:#{1,6}\s+)?(?:\*\*)?(user|you|me|assistant|chatgpt|gpt|claude|ai|bot|system)(?:\*\*)?\s*:?\s*$/i;

function normalizeRole(s: string): Role | null {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[*:#\s]+/g, '');
  if (t === 'user' || t === 'you' || t === 'me') return 'user';
  if (
    t === 'assistant' ||
    t === 'chatgpt' ||
    t === 'gpt' ||
    t === 'claude' ||
    t === 'ai' ||
    t === 'bot'
  )
    return 'assistant';
  if (t === 'system') return 'system';
  return null;
}

function parseMarkdown(raw: string): ParsedConversation[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const messages: ParsedMessage[] = [];
  let currentRole: Role | null = null;
  let buffer: string[] = [];

  function flush() {
    if (currentRole && buffer.length) {
      const content = buffer.join('\n').trim();
      if (content) messages.push({ role: currentRole, content });
    }
    buffer = [];
  }

  for (const line of lines) {
    const m = ROLE_LINE.exec(line.trim());
    if (m) {
      const role = normalizeRole(m[1]!);
      if (role) {
        flush();
        currentRole = role;
        continue;
      }
    }
    if (currentRole) {
      buffer.push(line);
    }
  }
  flush();

  // Fallback: no role markers found → treat whole text as one user message.
  if (messages.length === 0) {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return [
      {
        title: trimmed.slice(0, 80),
        messages: [{ role: 'user', content: trimmed }],
        format: 'markdown',
      },
    ];
  }

  return [
    {
      title: messages[0]!.content.slice(0, 80),
      messages,
      format: 'markdown',
    },
  ];
}
