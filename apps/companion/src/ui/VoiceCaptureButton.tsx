/**
 * VoiceCaptureButton — quick mic-to-capture: press to record, press
 * again to stop, transcript becomes a 'text' capture in metu. See
 * `useVoiceCapture` for the pipeline.
 */
import type { AuthState } from '../state/auth';
import { useVoiceCapture } from '../state/useVoiceCapture';
import { useVoiceCaptureHotkey } from '../state/useVoiceCaptureHotkey';

const LABELS = {
  idle: 'Hold to capture (voice)',
  recording: 'Stop recording',
  transcribing: 'Transcribing…',
  capturing: 'Saving…',
  error: 'Try again',
} as const;

export function VoiceCaptureButton({ auth }: { auth: AuthState }) {
  const {
    status,
    lastTranscript,
    lastError,
    lastCaptureId,
    recentTranscripts,
    toggle,
    undoLast,
    clearRecent,
  } = useVoiceCapture(auth);
  const busy = status === 'transcribing' || status === 'capturing';
  // Global hotkey: Cmd/Ctrl+Shift+V toggles capture from anywhere on
  // the desktop, including when the companion window is hidden.
  useVoiceCaptureHotkey({
    accelerator: 'CmdOrCtrl+Shift+V',
    onToggle: () => {
      void toggle();
    },
    enabled: !busy,
  });
  return (
    <div className="card">
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Voice capture
      </p>
      <button
        className="btn"
        style={{ marginTop: 8, width: '100%' }}
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={status === 'recording'}
      >
        <span className={`dot${status === 'recording' ? '' : 'off'}`} style={{ marginRight: 8 }} />
        {LABELS[status]}
      </button>
      {lastTranscript ? (
        <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>
          Last: “{lastTranscript.length > 80 ? `${lastTranscript.slice(0, 77)}…` : lastTranscript}”
          {lastCaptureId ? (
            <button
              type="button"
              onClick={() => void undoLast()}
              style={{
                marginLeft: 8,
                background: 'transparent',
                border: 0,
                color: 'var(--brand, #4f46e5)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                textDecoration: 'underline',
              }}
            >
              undo
            </button>
          ) : null}
        </p>
      ) : null}
      {lastError ? (
        <p
          className="muted"
          style={{ marginTop: 6, fontSize: 11, color: 'var(--danger, #ef4444)' }}
        >
          {lastError}
        </p>
      ) : null}
      {recentTranscripts.length > 1 ? (
        <div
          style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border, #e5e7eb)' }}
        >
          <p
            className="muted"
            style={{
              margin: 0,
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Recent</span>
            <button
              type="button"
              onClick={clearRecent}
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--muted, #6b7280)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 10,
                textTransform: 'none',
                letterSpacing: 0,
                textDecoration: 'underline',
              }}
            >
              clear
            </button>
          </p>
          <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
            {recentTranscripts.slice(1).map((r) => (
              <li
                key={r.id}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  fontSize: 11,
                  color: 'var(--muted, #6b7280)',
                  padding: '2px 0',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  “{r.text.length > 60 ? `${r.text.slice(0, 57)}…` : r.text}”
                </span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(r.text)}
                  title="Copy transcript"
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--brand, #4f46e5)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 10,
                    textDecoration: 'underline',
                  }}
                >
                  copy
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
