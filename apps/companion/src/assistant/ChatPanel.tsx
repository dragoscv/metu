/**
 * ChatPanel — the assistant's expandable conversation surface. Lives inside
 * the assistant window beneath the avatar: a scrollable thread + composer.
 * Streams agent turns via {@link useAssistantChat} (codai-backed companion
 * agent: local fast lane with read tools, or escalation to the Conductor).
 *
 * Context menu: WebView2 suppresses the native menu on our transparent
 * frameless window, so we draw our own — Copy (selection), Copy message,
 * Copy conversation, Select all; Cut/Paste in the composer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauri } from '../state/runtime';
import type { ChatMessage, ChatStatus } from './useAssistantChat';
import { RichMessage } from './RichMessage';
import { addAttachments, fromFile, type ChatAttachment } from './attachments';

/** Clipboard write that works in both Tauri (plugin) and browser dev. */
async function copyText(text: string): Promise<void> {
  if (!text) return;
  try {
    if (isTauri()) await writeText(text);
    else await navigator.clipboard.writeText(text);
  } catch {
    /* best-effort */
  }
}

interface MenuState {
  x: number;
  y: number;
  /** Message under the cursor (null = empty area / composer). */
  message: ChatMessage | null;
  /** Right-clicked inside the composer textarea. */
  inComposer: boolean;
  /** Live selection text at menu-open time. */
  selection: string;
}

const STATUS_HINT: Record<ChatStatus, string | null> = {
  idle: null,
  thinking: 'Thinking…',
  streaming: null,
  escalated: 'Handed to your Conductor — running in the background.',
  error: null,
};

/** Friendly labels for tool activity rows (VS Code agent style). */
const TOOL_LABELS: Record<string, string> = {
  recall: 'Searching memory',
  list_projects: 'Reading projects',
  list_tasks: 'Reading tasks',
  restore_continuity: 'Restoring context',
  'device.screenshot': 'Taking a screenshot',
  'device.list_windows': 'Listing windows',
  'device.a11y_tree': 'Reading the UI',
  'device.a11y_find': 'Finding elements',
  'device.observe_window': 'Observing the window',
  'device.see': 'Looking at the screen',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/^device\./, '').replace(/_/g, ' ');
}

export function ChatPanel({
  messages,
  status,
  personaName,
  onSend,
  onStop,
  onClear,
  onClose,
  onDragPointerDown,
  apiBase,
  sessions,
  activeSessionId,
  onNewSession,
  onSwitchSession,
}: {
  messages: ChatMessage[];
  status: ChatStatus;
  personaName: string;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  /** Press-and-drag on the header repositions the assistant window. */
  onDragPointerDown?: (e: React.PointerEvent) => void;
  /** Console base URL for entity/link cards in rich messages. */
  apiBase?: string;
  /** Session management (Jarvis v4.4). */
  sessions?: Array<{ id: string; title: string; updatedAt: number }>;
  activeSessionId?: string;
  onNewSession?: () => void;
  onSwitchSession?: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === 'thinking' || status === 'streaming';
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the context menu on click-away / Escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  const openMenu = useCallback(
    (e: React.MouseEvent, message: ChatMessage | null, inComposer = false) => {
      e.preventDefault();
      e.stopPropagation();
      const root = rootRef.current?.getBoundingClientRect();
      const selection = window.getSelection()?.toString() ?? '';
      // Clamp inside the panel so the menu never overflows the window.
      const x = Math.min(e.clientX - (root?.left ?? 0), (root?.width ?? 320) - 190);
      const y = Math.min(e.clientY - (root?.top ?? 0), (root?.height ?? 480) - 220);
      setMenu({ x: Math.max(4, x), y: Math.max(4, y), message, inComposer, selection });
    },
    [],
  );

  // Pin scroll to the bottom as messages stream in.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Prefill requests from the avatar context menu ("Search screen history…").
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string') {
        setDraft(text);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('metu:chat-prefill', handler);
    return () => window.removeEventListener('metu:chat-prefill', handler);
  }, []);

  // Files dropped on the AVATAR arrive here (already read natively).
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent<ChatAttachment[]>).detail;
      if (Array.isArray(files) && files.length) {
        setPendingFiles((cur) => addAttachments(cur, files));
        inputRef.current?.focus();
      }
    };
    window.addEventListener('metu:chat-attach', handler);
    return () => window.removeEventListener('metu:chat-attach', handler);
  }, []);

  const submit = () => {
    const v = draft.trim();
    // Files without text get a sensible default instruction.
    const text = v || (pendingFiles.length ? 'Look at the attached files.' : '');
    if (!text || busy) return;
    setDraft('');
    const files = pendingFiles;
    setPendingFiles([]);
    onSend(text, files.length ? files : undefined);
  };

  const addFiles = async (list: FileList | File[]) => {
    const incoming = await Promise.all([...list].map(fromFile));
    setPendingFiles((cur) => addAttachments(cur, incoming));
    inputRef.current?.focus();
  };

  const hint = STATUS_HINT[status];

  return (
    <div
      className={`chat ${dragOver ? 'chat--dragover' : ''}`}
      ref={rootRef}
      onContextMenu={(e) => openMenu(e, null)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="chat__dropzone" aria-hidden>
          <span>📎 Drop files to attach</span>
        </div>
      )}
      <div className="chat__head" onPointerDown={onDragPointerDown} style={{ cursor: 'grab' }}>
        <span className="chat__title">{personaName}</span>
        <div className="chat__head-actions">
          {onSwitchSession && (
            <button
              className="chat__hbtn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowSessions((v) => !v)}
              title="Conversations"
            >
              ☰
            </button>
          )}
          {onNewSession && (
            <button
              className="chat__hbtn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onNewSession();
                setShowSessions(false);
              }}
              title="New conversation"
            >
              ＋
            </button>
          )}
          {messages.length > 0 && (
            <button className="chat__hbtn" onClick={onClear} title="Clear conversation">
              ⟲
            </button>
          )}
          <button className="chat__hbtn" onClick={onClose} title="Collapse">
            ⌄
          </button>
        </div>
      </div>

      {/* Sessions drawer: slides in from the left over the thread. */}
      {sessions && (
        <>
          {showSessions && (
            <button
              type="button"
              aria-label="Close conversations"
              className="chat__drawer-scrim"
              onClick={() => setShowSessions(false)}
            />
          )}
          <div className={`chat__drawer ${showSessions ? 'chat__drawer--open' : ''}`}>
            <div className="chat__drawer-head">
              <span>Conversations</span>
              <button
                type="button"
                className="chat__hbtn"
                onClick={() => {
                  onNewSession?.();
                  setShowSessions(false);
                }}
                title="New conversation"
              >
                ＋
              </button>
            </div>
            <div className="chat__drawer-list">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className={`chat__session ${s.id === activeSessionId ? 'chat__session--active' : ''}`}
                  onClick={() => {
                    onSwitchSession?.(s.id);
                    setShowSessions(false);
                  }}
                >
                  <span className="chat__session-title">{s.title}</span>
                  <span className="chat__session-time">
                    {new Date(s.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </button>
              ))}
              {sessions.length === 0 && <p className="chat__empty">No previous conversations.</p>}
            </div>
          </div>
        </>
      )}

      <div className="chat__thread" ref={threadRef}>
        {messages.length === 0 && (
          <p className="chat__empty">
            Ask anything — I can read your workspace, look at your screen, and hand bigger jobs to
            the Conductor.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`msg msg--${m.role}${m.error ? 'msg--error' : ''}`}
            onContextMenu={(e) => openMenu(e, m)}
          >
            {m.content && (
              <div className="msg__body">
                {m.role === 'assistant' ? (
                  <RichMessage text={m.content} apiBase={apiBase} />
                ) : (
                  m.content
                )}
              </div>
            )}
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg__files">
                {m.attachments.map((a) => (
                  <span key={a.name} className="msg__file">
                    📄 {a.name}
                  </span>
                ))}
              </div>
            )}
            {/* Live agent activity rows — visible WHILE tools run, the
                "it's actually doing something" signal (Copilot-style). */}
            {m.toolActivity && m.toolActivity.length > 0 && (m.pending || !m.content) && (
              <div className="msg__activity">
                {m.toolActivity.map((a, i) => (
                  <div key={`${a.name}_${i}`} className={`msg__act msg__act--${a.status}`}>
                    <span className="msg__act-icon">
                      {a.status === 'done' ? '✓' : <span className="msg__act-spin" aria-hidden />}
                    </span>
                    {toolLabel(a.name)}
                    {a.status === 'running' ? '…' : ''}
                  </div>
                ))}
              </div>
            )}
            {m.pending && !m.content && (!m.toolActivity || m.toolActivity.length === 0) && (
              <div className="msg__body msg__body--skeleton" aria-label="thinking">
                <span className="msg__skel" style={{ width: '82%' }} />
                <span className="msg__skel" style={{ width: '64%' }} />
                <span className="msg__skel" style={{ width: '45%' }} />
              </div>
            )}
            {m.error && <div className="msg__error">{m.error}</div>}
            {m.tools && m.tools.length > 0 && (
              <div className="msg__tools">
                {m.tools.map((t) => (
                  <span key={t} className="msg__tool">
                    ⚒ {t}
                  </span>
                ))}
              </div>
            )}
            {m.escalated && <div className="msg__escalated">→ Conductor</div>}
          </div>
        ))}
      </div>

      {hint && <div className="chat__hint">{hint}</div>}

      {pendingFiles.length > 0 && (
        <div className="chat__attach-row">
          {pendingFiles.map((f) => (
            <span key={f.name} className="chat__attach-chip" title={`${f.bytes} bytes`}>
              📄 {f.name.length > 22 ? `${f.name.slice(0, 22)}…` : f.name}
              {f.truncated ? ' (trimmed)' : ''}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPendingFiles((cur) => cur.filter((c) => c.name !== f.name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat__composer">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="chat__hbtn chat__attach-btn"
          title="Attach files"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <textarea
          ref={inputRef}
          className="chat__input"
          rows={1}
          value={draft}
          placeholder={busy ? 'Working…' : 'Message your assistant…'}
          onChange={(e) => setDraft(e.target.value)}
          onContextMenu={(e) => openMenu(e, null, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') onClose();
          }}
        />
        {busy ? (
          <button className="chat__send chat__send--stop" onClick={onStop} title="Stop">
            ◼
          </button>
        ) : (
          <button className="chat__send" onClick={submit} disabled={!draft.trim()} title="Send">
            ➤
          </button>
        )}
      </div>

      {menu && (
        <div
          className="ctxmenu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.selection && (
            <button
              className="ctxmenu__item"
              onClick={() => {
                void copyText(menu.selection);
                setMenu(null);
              }}
            >
              Copy
            </button>
          )}
          {menu.message?.content && (
            <button
              className="ctxmenu__item"
              onClick={() => {
                void copyText(menu.message!.content);
                setMenu(null);
              }}
            >
              Copy message
            </button>
          )}
          {menu.inComposer && (
            <>
              {menu.selection && (
                <button
                  className="ctxmenu__item"
                  onClick={() => {
                    void copyText(menu.selection);
                    setDraft((d) => d.replace(menu.selection, ''));
                    setMenu(null);
                  }}
                >
                  Cut
                </button>
              )}
              <button
                className="ctxmenu__item"
                onClick={() => {
                  void (async () => {
                    try {
                      const t = isTauri()
                        ? ((await readText()) ?? '')
                        : await navigator.clipboard.readText();
                      if (t) {
                        setDraft((d) => d + t);
                        inputRef.current?.focus();
                      }
                    } catch {
                      /* clipboard empty / denied */
                    }
                  })();
                  setMenu(null);
                }}
              >
                Paste
              </button>
            </>
          )}
          {messages.length > 0 && (
            <button
              className="ctxmenu__item"
              onClick={() => {
                const all = messages
                  .filter((m) => m.content)
                  .map((m) => `${m.role === 'user' ? 'You' : personaName}: ${m.content}`)
                  .join('\n\n');
                void copyText(all);
                setMenu(null);
              }}
            >
              Copy conversation
            </button>
          )}
          <button
            className="ctxmenu__item"
            onClick={() => {
              const el = menu.inComposer ? inputRef.current : threadRef.current;
              if (el instanceof HTMLTextAreaElement) {
                el.select();
              } else if (el) {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
              setMenu(null);
            }}
          >
            Select all
          </button>
          {messages.length > 0 && (
            <button
              className="ctxmenu__item ctxmenu__item--danger"
              onClick={() => {
                onClear();
                setMenu(null);
              }}
            >
              Clear conversation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
