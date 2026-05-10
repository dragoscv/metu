/**
 * Form C — full-screen HUD overlay. Hotkey-summoned (Ctrl+Alt+Space). The
 * scrim darkens the desktop, a centred console hosts the persona orb and
 * live transcript, Esc dismisses. The HUD lives in its own borderless,
 * transparent, always-on-top Tauri window labelled "hud" (see
 * tauri.conf.json + src-tauri/src/forms.rs).
 *
 * Slice 8 ships the visual + voice loop; later slices add particle field,
 * tool-call ribbon, and persona switcher.
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadAuth, type AuthState } from '../state/auth';
import { useVoiceSession, type VoiceStatus } from '../state/useVoiceSession';
import { useWakeWord } from '../state/useWakeWord';
import {
  useBillingTier,
  usePersonas,
  useResolvedPersona,
  getPersonaOverride,
} from '../state/usePersonas';
import { playWakeBlip } from '../state/wakeBlip';
import { VrmAvatar, vrmEnabled } from '../ui/VrmAvatar';

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  ready: 'Ready',
  listening: 'Listening',
  speaking: 'Speaking',
  error: 'Error',
};

export function PresenceHud() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [personaSlug, setPersonaSlug] = useState('atlas');

  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  // Esc dismisses the HUD by hiding its window — Rust owns the lifecycle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void invoke('presence_hud_hide');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!auth) {
    return (
      <div className="hud-scrim">
        <div className="hud-console">
          <p className="muted">Sign in via the main window first.</p>
        </div>
      </div>
    );
  }
  return <HudInner auth={auth} personaSlug={personaSlug} setPersonaSlug={setPersonaSlug} />;
}

function HudInner({
  auth,
  personaSlug,
  setPersonaSlug,
}: {
  auth: AuthState;
  personaSlug: string;
  setPersonaSlug: (s: string) => void;
}) {
  const { state, start, stop, interrupt, setMicEnabled, setAudioElement } = useVoiceSession(auth);
  const personas = usePersonas(auth);
  const billingTier = useBillingTier();
  const voicePersonas = personas.filter((p) => p.voiceProvider !== 'none');
  const overridden = useResolvedPersona('hud', personas);
  const hasOverride = getPersonaOverride('hud') !== null;
  const persona = hasOverride
    ? overridden
    : (voicePersonas.find((p) => p.slug === personaSlug) ?? voicePersonas[0] ?? personas[0]!);

  // Persona-pinned wake word: even outside the HUD, listen for the active
  // persona's word and pop the HUD on detection. Disabled while voice is
  // already engaged (avoid retrigger storm).
  useWakeWord({
    word: persona.wakeWord,
    costTier: persona.costTier,
    billingTier,
    enabled: state.status === 'idle' || state.status === 'ready',
    onWake: () => {
      playWakeBlip();
      void invoke('presence_hud_show').catch(() => {});
    },
  });
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const handleAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      setAudioEl(el);
      setAudioElement(el);
    },
    [setAudioElement],
  );

  // Auto-arm mic the moment HUD mounts — that's the whole UX promise.
  useEffect(() => {
    void (async () => {
      await stop();
      await start(persona.slug, persona.voiceProvider);
      setMicEnabled(true);
    })();
    return () => {
      setMicEnabled(false);
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, persona.slug]);

  const vrmUrl = persona.avatarKind === 'vrm' ? vrmEnabled(persona.avatarUrl) : vrmEnabled(null);

  return (
    <div className="hud-scrim" onClick={() => void invoke('presence_hud_hide')}>
      <div
        className={`hud-console hud-console--${state.status}`}
        onClick={(e) => e.stopPropagation()}
      >
        {vrmUrl ? (
          <div className="hud-orb" aria-hidden>
            <VrmAvatar
              modelUrl={vrmUrl}
              speaking={state.status === 'speaking'}
              listening={state.status === 'listening'}
              thinking={state.lastToolCall?.tool === 'conductor.escalate'}
              size={220}
              audioEl={audioEl}
            />
          </div>
        ) : (
          <div className="hud-orb" aria-hidden>
            <div className="hud-orb__core" />
            <div className="hud-orb__rim" />
          </div>
        )}
        <div className="hud-meta">
          <strong className="hud-name">{persona.name}</strong>
          <span className="muted">
            {STATUS_LABEL[state.status]}
            {state.lane && <> · {state.lane}</>}
          </span>
        </div>
        <div className="hud-transcript" aria-live="polite">
          {state.partial || state.finalText || (
            <span className="muted">Speak. Esc to dismiss.</span>
          )}
        </div>
        <div className="hud-controls">
          <select
            className="hud-persona"
            value={personaSlug}
            onChange={(e) => setPersonaSlug(e.target.value)}
          >
            {voicePersonas.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn ghost" onClick={() => interrupt()}>
            Interrupt
          </button>
        </div>
        {state.errorMessage && <div className="hud-error">{state.errorMessage}</div>}
        <audio ref={handleAudio} autoPlay playsInline />
      </div>
    </div>
  );
}
