/**
 * ChatPanel — the assistant's expandable conversation surface. Lives inside
 * the assistant window beneath the avatar: a scrollable thread + composer.
 * Streams agent turns via {@link useAssistantChat} (codai-backed companion
 * agent: local fast lane with read tools, or escalation to the Conductor).
 */
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatStatus } from './useAssistantChat';

const STATUS_HINT: Record<ChatStatus, string | null> = {
  idle: null,
  thinking: 'Thinking…',
  streaming: null,
  escalated: 'Handed to your Conductor — running in the background.',
  error: null,
};

export function ChatPanel({
  messages,
  status,
  personaName,
  onSend,
  onStop,
  onClear,
  onClose,
}: {
  messages: ChatMessage[];
  status: ChatStatus;
  personaName: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === 'thinking' || status === 'streaming';

  // Pin scroll to the bottom as messages stream in.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const v = draft.trim();
    if (!v || busy) return;
    setDraft('');
    onSend(v);
  };

  const hint = STATUS_HINT[status];

  return (
    <div className="chat" onPointerDown={(e) => e.stopPropagation()}>
      <div className="chat__head" data-tauri-drag-region>
        <span className="chat__title">{personaName}</span>
        <div className="chat__head-actions">
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

      <div className="chat__thread" ref={threadRef}>
        {messages.length === 0 && (
          <p className="chat__empty">
            Ask anything — I can read your workspace, look at your screen, and hand bigger jobs to
            the Conductor.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}${m.error ? 'msg--error' : ''}`}>
            {m.content && <div className="msg__body">{m.content}</div>}
            {m.pending && !m.content && (
              <div className="msg__body">
                <span className="bubble__dots" aria-label="thinking">
                  <i />
                  <i />
                  <i />
                </span>
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

      <div className="chat__composer">
        <textarea
          ref={inputRef}
          className="chat__input"
          rows={1}
          value={draft}
          placeholder={busy ? 'Working…' : 'Message your assistant…'}
          onChange={(e) => setDraft(e.target.value)}
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
    </div>
  );
}
