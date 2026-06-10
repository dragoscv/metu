/**
 * Form A — "Panel": the persistent floating window with an orb visualizer,
 * push-to-talk button, live transcript, and persona picker. This is the
 * default voice surface for slice 4.
 *
 * Layout is intentionally compact (320×420). Designed to live pinned to the
 * desktop edge. Future slices wrap it in a dedicated Tauri window with
 * `alwaysOnTop` + click-through margins; for slice 4 it renders inline so we
 * can ship without a second window.
 */
import { useEffect, useState } from 'react';
import type { AuthState } from '../state/auth';
import { useVoiceSession, type VoiceStatus } from '../state/useVoiceSession';
import { usePushToTalkHotkey } from '../state/usePushToTalkHotkey';
import { BUILT_IN_PERSONAS } from '@metu/presence';
import { getPersonaOverride, useResolvedPersona, usePersonas } from '../state/usePersonas';
const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'Press to talk',
  connecting: 'Connecting…',
  ready: 'Ready',
  listening: 'Listening',
  speaking: 'Speaking',
  error: 'Error',
};

const VOICE_PERSONAS = BUILT_IN_PERSONAS.filter((p) => p.voiceProvider !== 'none');

export function PresencePanel({ auth }: { auth: AuthState }) {
  const { state, start, stop, interrupt, setMicEnabled, setAudioElement } = useVoiceSession(auth);
  const [personaSlug, setPersonaSlug] = useState<string>('atlas');

  // Conductor-side persona override (device.persona_set) takes priority over
  // the user's manual selection — when the agent swaps the persona, the
  // dropdown follows.
  const personas = usePersonas(auth);
  const overridden = useResolvedPersona('panel', personas);
  const hasOverride = getPersonaOverride('panel') !== null;
  const persona = hasOverride
    ? overridden
    : (VOICE_PERSONAS.find((p) => p.slug === personaSlug) ?? VOICE_PERSONAS[0]!);

  // Auto-mint on first mount + whenever persona changes.
  useEffect(() => {
    void (async () => {
      await stop();
      await start(persona.slug, persona.voiceProvider);
    })();
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, persona.slug]);

  usePushToTalkHotkey({
    accelerator: persona.hotkey ?? 'CommandOrControl+Alt+A',
    onPress: () => {
      if (state.status === 'speaking') interrupt();
      setMicEnabled(true);
    },
    onRelease: () => setMicEnabled(false),
    enabled:
      state.status === 'ready' || state.status === 'listening' || state.status === 'speaking',
  });

  const dotClass = `presence-dot presence-dot--${state.status}`;

  return (
    <div className="presence-panel">
      <header className="presence-panel__head">
        <span className={dotClass} aria-hidden />
        <div className="presence-panel__title">
          <strong>{persona.name}</strong>
          <span className="muted">
            {STATUS_LABEL[state.status]}
            {state.lane && <> · {state.lane}</>}
          </span>
        </div>
      </header>

      <div className="select-wrap">
        <select
          className="field field--select"
          value={personaSlug}
          onChange={(e) => setPersonaSlug(e.target.value)}
        >
          {VOICE_PERSONAS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name} — {p.voiceProvider}
            </option>
          ))}
        </select>
        <span className="select-wrap__chevron" aria-hidden>
          ⌄
        </span>
      </div>

      <div className="presence-panel__transcript" aria-live="polite">
        {state.partial || state.finalText || (
          <span className="muted">Hold {persona.hotkey ?? '⌃⌥A'} or the button to talk.</span>
        )}
      </div>

      <div className="presence-panel__controls">
        <button
          className="btn"
          onPointerDown={() => {
            if (state.status === 'speaking') interrupt();
            setMicEnabled(true);
          }}
          onPointerUp={() => setMicEnabled(false)}
          onPointerLeave={() => setMicEnabled(false)}
          disabled={state.status === 'connecting' || state.status === 'idle'}
        >
          🎙️ Hold to talk
        </button>
        <button className="btn ghost" onClick={() => void stop()}>
          End
        </button>
      </div>

      {state.lastToolCall && (
        <div className="presence-panel__toolcall muted">
          tool: <code>{state.lastToolCall.tool}</code>
        </div>
      )}
      {state.errorMessage && <div className="presence-panel__error">{state.errorMessage}</div>}

      {/* Hidden audio sink for the remote / TTS track. */}
      <audio ref={setAudioElement} autoPlay playsInline />
    </div>
  );
}
