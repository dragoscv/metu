/**
 * SpeechBubble — the assistant's in-character popup. Auto-dismisses after a
 * TTL (ambient remarks), or stays while it carries interaction:
 *   - `action`     → confirm/deny affordance ("ask before acting" prompts)
 *   - `onQuickReply` → inline reply input so the user can answer by typing
 *                      without opening the full chat panel.
 */
import { useEffect, useRef, useState } from 'react';
import { RichMessage } from './RichMessage';
import { loadAssistantLanguage } from '../state/language';

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
  progressLabel,
  onDismiss,
  onExpire,
  onQuickReply,
  suggestions,
  onOpenChat,
  apiBase,
}: {
  text: string;
  ttlMs: number;
  action?: BubbleAction;
  /** True while the assistant is thinking/streaming — shows the pulse dots. */
  pending?: boolean;
  /** Human-readable stage shown while pending ("Reading your screen…"). */
  progressLabel?: string | null;
  onDismiss?: () => void;
  /** TTL expiry (no user gesture). Falls back to onDismiss when omitted. */
  onExpire?: () => void;
  /** When provided, renders the inline quick-reply input. */
  onQuickReply?: (text: string) => void;
  /** One-tap canned replies — each chip sends its text immediately. */
  suggestions?: string[];
  /** Expand to the full chat panel. */
  onOpenChat?: () => void;
  /** Console base URL — enables markdown entity/link cards. */
  apiBase?: string;
}) {
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  /** True when content fits without scrolling — disables the bottom fade. */
  const [fits, setFits] = useState(true);
  const onExpireRef = useRef(onExpire ?? onDismiss);
  onExpireRef.current = onExpire ?? onDismiss;

  // Re-measure on text change + container resize (images/blocks loading).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setFits(el.scrollHeight <= el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    // Interactive bubbles stay until the user responds; ambient auto-dismiss.
    // Hover pauses the TTL so the user can read/select/copy without the
    // bubble vanishing mid-gesture.
    if (action || replying || pending || hovered) return;
    const t = setTimeout(() => onExpireRef.current?.(), ttlMs);
    return () => clearTimeout(t);
  }, [text, ttlMs, action, replying, pending, hovered]);

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
    <div
      className="bubble"
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="bubble__close"
        aria-label="Dismiss"
        onClick={() => onDismiss?.()}
      >
        ✕
      </button>
      <span ref={textRef} className={`bubble__text ${fits ? 'bubble__text--fits' : ''}`}>
        <RichMessage text={text} apiBase={apiBase} />
        {pending && (
          <span className="bubble__dots" aria-label="thinking">
            <i />
            <i />
            <i />
          </span>
        )}
      </span>

      {pending && progressLabel && (
        <div className="bubble__progress">
          <span className="bubble__progress-spinner" aria-hidden />
          {progressLabel}
        </div>
      )}

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
          {suggestions?.map((s) => (
            <button
              type="button"
              key={s}
              className="bubble__chip bubble__chip--suggest"
              onClick={() => onQuickReply(s)}
            >
              {s}
            </button>
          ))}
          <button type="button" className="bubble__chip" onClick={() => setReplying(true)}>
            ↩ {loadAssistantLanguage() === 'ro' ? 'Răspunde' : 'Reply'}
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
            placeholder={loadAssistantLanguage() === 'ro' ? 'Scrie un răspuns…' : 'Type a reply…'}
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
