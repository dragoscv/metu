/**
 * SpeechBubble — the pet's in-character popup. Auto-dismisses after a TTL and
 * supports an optional confirm/deny affordance for "ask before acting" prompts
 * (the pet proposes a window action; the user approves or declines inline).
 */
import { useEffect } from 'react';

export interface BubbleAction {
  label: string;
  onConfirm: () => void;
  onDeny: () => void;
}

export function SpeechBubble({
  text,
  ttlMs,
  action,
  onDismiss,
}: {
  text: string;
  ttlMs: number;
  action?: BubbleAction;
  onDismiss?: () => void;
}) {
  useEffect(() => {
    // Action bubbles stay until the user responds; ambient ones auto-dismiss.
    if (action) return;
    const t = setTimeout(() => onDismiss?.(), ttlMs);
    return () => clearTimeout(t);
  }, [text, ttlMs, action, onDismiss]);

  return (
    <div className="pet-bubble" role="status">
      <span className="pet-bubble__text">{text}</span>
      {action && (
        <div className="pet-bubble__actions">
          <button
            type="button"
            className="pet-bubble__btn pet-bubble__btn--yes"
            onClick={action.onConfirm}
          >
            {action.label}
          </button>
          <button
            type="button"
            className="pet-bubble__btn pet-bubble__btn--no"
            onClick={action.onDeny}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
