/**
 * Form D — desktop pet. A small transparent always-on-top window that
 * shows the persona character. Slice 8 shipped a CSS orb placeholder;
 * companion-agent slice 3 adds the VRM tier (3D avatar via three +
 * @pixiv/three-vrm) above the existing Live2D fallback.
 *
 * Avatar tier resolution (first available wins):
 *   1. VRM   — `persona.avatarKind === 'vrm'` OR `VITE_VRM_MODEL_URL` set
 *   2. Live2D — `VITE_LIVE2D_MODEL_URL` set + pixi-live2d-display installed
 *   3. CSS orb — always available, fallback
 *
 * Click-through model: the window starts NOT click-through so the user can
 * grab the character. Hovering off the character body re-enables
 * click-through via `presence_pet_set_clickthrough`. The transparent area
 * outside the character bbox forwards clicks to the desktop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadAuth, type AuthState } from '../state/auth';
import { useVoiceSession } from '../state/useVoiceSession';
import { useWakeWord } from '../state/useWakeWord';
import { useBillingTier, usePersonas, useResolvedPersona } from '../state/usePersonas';
import { playWakeBlip } from '../state/wakeBlip';
import { Live2DAvatar, live2dEnabled } from '../ui/Live2DAvatar';
import { VrmAvatar, vrmEnabled } from '../ui/VrmAvatar';

export function PresencePet() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  if (!auth) {
    return <PetSkin slug="atlas" speaking={false} avatarKind="orb" avatarUrl={null} />;
  }
  return <PetInner auth={auth} />;
}

function PetInner({ auth }: { auth: AuthState }) {
  // Workspace-aware persona list — built-ins merged with the user's custom
  // personas. This is what makes per-persona wake words actually work for
  // user-defined characters.
  const personas = usePersonas(auth);
  const persona = useResolvedPersona('pet', personas);
  const billingTier = useBillingTier();
  const { state, start, stop, interrupt, setMicEnabled, setAudioElement } = useVoiceSession(auth);

  // Wake word: when the persona names a wake word, listen for it via
  // Porcupine / openWakeWord and pop the HUD on detection. Disabled while
  // voice is already active to avoid retriggering during conversation.
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

  useEffect(() => {
    void start(persona.slug, persona.voiceProvider);
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, persona.slug]);

  const onPetClick = () => {
    if (state.status === 'speaking') interrupt();
  };
  const onPetDoubleClick = () => {
    if (state.status === 'listening') {
      setMicEnabled(false);
    } else {
      setMicEnabled(true);
    }
  };

  return (
    <PetSkin
      slug={persona.slug}
      speaking={state.status === 'speaking'}
      listening={state.status === 'listening'}
      thinking={state.lastToolCall?.tool === 'conductor.escalate'}
      bubble={state.partial || (state.status === 'listening' ? 'Listening…' : undefined)}
      onClick={onPetClick}
      onDoubleClick={onPetDoubleClick}
      audioRef={setAudioElement}
      avatarKind={persona.avatarKind}
      avatarUrl={persona.avatarUrl}
    />
  );
}

function PetSkin({
  slug,
  speaking,
  listening,
  thinking,
  bubble,
  onClick,
  onDoubleClick,
  audioRef,
  avatarKind,
  avatarUrl,
}: {
  slug: string;
  speaking: boolean;
  listening?: boolean;
  thinking?: boolean;
  bubble?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  audioRef?: (el: HTMLAudioElement | null) => void;
  avatarKind: string;
  avatarUrl: string | null;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Local handle to the <audio> element so the VRM avatar can attach an
  // analyser to the same audio graph the voice session writes to.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    void invoke('presence_pet_set_clickthrough', { enabled: true });
  }, []);

  const onEnter = () => {
    void invoke('presence_pet_set_clickthrough', { enabled: false });
  };
  const onLeave = () => {
    void invoke('presence_pet_set_clickthrough', { enabled: true });
  };

  const handleAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      setAudioEl(el);
      audioRef?.(el);
    },
    [audioRef],
  );

  // Resolve avatar tier: VRM → Live2D → orb.
  const vrmUrl = avatarKind === 'vrm' ? vrmEnabled(avatarUrl) : vrmEnabled(null);
  const live2dUrl = !vrmUrl ? live2dEnabled() : null;

  return (
    <div className="pet-stage" data-persona={slug} data-speaking={speaking}>
      {bubble && <div className="pet-bubble">{bubble}</div>}
      <div
        ref={bodyRef}
        className={`pet-body ${speaking ? 'pet-body--speaking' : ''}`}
        data-tauri-drag-region
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {vrmUrl ? (
          <VrmAvatar
            modelUrl={vrmUrl}
            speaking={speaking}
            listening={listening}
            thinking={thinking}
            size={180}
            audioEl={audioEl}
          />
        ) : live2dUrl ? (
          <Live2DAvatar modelUrl={live2dUrl} speaking={speaking} size={140} />
        ) : (
          <div className="pet-orb">
            <div className="pet-orb__core" />
            <div className="pet-orb__halo" />
          </div>
        )}
      </div>
      <audio ref={handleAudio} autoPlay playsInline />
    </div>
  );
}
