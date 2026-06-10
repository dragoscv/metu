/**
 * SpeechBubble — the assistant's in-character popup. Auto-dismisses after a
 * TTL (ambient remarks), or stays while it carries interaction:
 *   - `action`     → confirm/deny affordance ("ask before acting" prompts)
 *   - `onQuickReply` → inline reply input so the user can answer by typing
 *                      without opening the full chat panel.
 */
import { useEffect, useRef, useState } from 'react';

export interface BubbleAction {
  label: string;
  onConfirm: () => void;
  onDeny: () => void;
}

export function SpeechBubble({
  text,
  ttlMs,
  action,
  pending,
  onDismiss,
  onQuickReply,
  onOpenChat,
}: {
  text: string;
  ttlMs: number;
  action?: BubbleAction;
  /** True while the assistant is thinking/streaming — shows the pulse dots. */
  pending?: boolean;
  onDismiss?: () => void;
  /** When provided, renders the inline quick-reply input. */
  onQuickReply?: (text: string) => void;
  /** Expand to the full chat panel. */
  onOpenChat?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Interactive bubbles stay until the user responds; ambient auto-dismiss.
    if (action || replying || pending) return;
    const t = setTimeout(() => onDismiss?.(), ttlMs);
    return () => clearTimeout(t);
  }, [text, ttlMs, action, replying, pending, onDismiss]);

  useEffect(() => {
    if (replying) inputRef.current?.focus();
  }, [replying]);

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    setDraft('');
    setReplying(false);
    onQuickReply?.(v);
  };

  return (
    <div className="bubble" role="status">
      <span className="bubble__text">
        {text}
        {pending && (
          <span className="bubble__dots" aria-label="thinking">
            <i />
            <i />
            <i />
          </span>
        )}
      </span>

      {action && (
        <div className="bubble__actions">
          <button type="button" className="bubble__btn bubble__btn--yes" onClick={action.onConfirm}>
            {action.label}
          </button>
          <button type="button" className="bubble__btn bubble__btn--no" onClick={action.onDeny}>
            Not now
          </button>
        </div>
      )}

      {!action && onQuickReply && !replying && (
        <div className="bubble__quick">
          <button type="button" className="bubble__chip" onClick={() => setReplying(true)}>
            ↩ Reply
          </button>
          {onOpenChat && (
            <button type="button" className="bubble__chip" onClick={onOpenChat}>
              ⤢ Chat
            </button>
          )}
        </div>
      )}

      {replying && (
        <div className="bubble__reply">
          <input
            ref={inputRef}
            className="bubble__input"
            value={draft}
            placeholder="Type a reply…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setReplying(false);
            }}
          />
          <button type="button" className="bubble__send" onClick={submit} aria-label="Send">
            ➤
          </button>
        </div>
      )}
    </div>
  );
}
