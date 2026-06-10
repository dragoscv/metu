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
import { listen } from '@tauri-apps/api/event';
import { loadAuth, type AuthState } from '../state/auth';
import { isTauri } from '../state/runtime';
import { useVoiceSession } from '../state/useVoiceSession';
import { useWakeWord } from '../state/useWakeWord';
import { useBillingTier, usePersonas, useResolvedPersona } from '../state/usePersonas';
import { playWakeBlip } from '../state/wakeBlip';
import { AvatarHost } from '../avatar/AvatarHost';
import type { AvatarState } from '../avatar/types';
import { usePetBrain, type PointRequest } from '../pet/usePetBrain';
import { SpeechBubble, type BubbleAction } from '../pet/SpeechBubble';
import { petLines } from '../pet/petMessages';
import { showHighlight } from '../pet/overlay-bridge';
import { onProposal } from '../pet/petActions';
import {
  loadPersonality,
  onPersonalityChange,
  PERSONALITIES,
  type PersonalityId,
} from '../avatar/personality';

export function PresencePet() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  if (!auth) {
    return <PetSkin slug="atlas" personality={loadPersonality()} speaking={false} />;
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

  // Active personality (calm / playful / quiet), switchable from the main
  // window; persisted in localStorage and synced across windows.
  const [personality, setPersonality] = useState<PersonalityId>(() => loadPersonality());
  useEffect(() => onPersonalityChange(setPersonality), []);

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

  const voiceBubble = state.partial || (state.status === 'listening' ? 'Listening…' : undefined);

  return (
    <PetSkin
      slug={persona.slug}
      personality={personality}
      speaking={state.status === 'speaking'}
      listening={state.status === 'listening'}
      thinking={state.lastToolCall?.tool === 'conductor.escalate'}
      voiceBubble={voiceBubble}
      onClick={onPetClick}
      onDoubleClick={onPetDoubleClick}
      audioRef={setAudioElement}
    />
  );
}

function PetSkin({
  slug,
  personality,
  speaking,
  listening,
  thinking,
  voiceBubble,
  onClick,
  onDoubleClick,
  audioRef,
}: {
  slug: string;
  personality: PersonalityId;
  speaking: boolean;
  listening?: boolean;
  thinking?: boolean;
  voiceBubble?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  audioRef?: (el: HTMLAudioElement | null) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Local handle to the <audio> element so the VRM avatar can attach an
  // analyser to the same audio graph the voice session writes to.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  // Ambient (non-voice) bubble the brain raises for greetings, idle nudges,
  // window reactions and ask-before-act confirmations.
  const [ambient, setAmbient] = useState<{ text: string; action?: BubbleAction } | null>(null);
  const cfg = PERSONALITIES[personality];

  // The pet window is 280×340 logical; the body avatar is centered. We pass
  // physical px to the brain (logical × devicePixelRatio).
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const petWidth = Math.round(280 * dpr);
  const petHeight = Math.round(340 * dpr);

  // Pause autonomous motion while the user is actively talking with the pet.
  const conversing = speaking || !!listening;

  // Pause autonomous motion while the user is dragging the pet (and for a
  // short cooldown after release) so the brain never fights the OS drag or
  // snaps the pet back to a wander target after a manual move.
  const [dragging, setDragging] = useState(false);
  const dragCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drag detection: when the user presses on the pet body (data-tauri-drag-region),
  // pause the brain. When they release (or the window loses focus), start a cooldown
  // so the brain doesn't immediately yank the pet back to a wander target.
  useEffect(() => {
    const handleDragStart = () => {
      if (dragCooldownRef.current) {
        clearTimeout(dragCooldownRef.current);
        dragCooldownRef.current = null;
      }
      setDragging(true);
    };
    const handleDragEnd = () => {
      if (dragCooldownRef.current) clearTimeout(dragCooldownRef.current);
      dragCooldownRef.current = setTimeout(() => setDragging(false), 1500);
    };
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener('pointerdown', handleDragStart);
    // Global listeners for drag end (since data-tauri-drag-region hands to OS).
    window.addEventListener('pointerup', handleDragEnd, true);
    window.addEventListener('mouseup', handleDragEnd, true);
    window.addEventListener('blur', handleDragEnd, true);
    return () => {
      body.removeEventListener('pointerdown', handleDragStart);
      window.removeEventListener('pointerup', handleDragEnd, true);
      window.removeEventListener('mouseup', handleDragEnd, true);
      window.removeEventListener('blur', handleDragEnd, true);
    };
  }, []);

  const handlePoint = useCallback((req: PointRequest | null) => {
    if (req?.rect) void showHighlight({ ...req.rect, label: req.label });
  }, []);

  const handleRemark = useCallback(
    (kind: 'greeting' | 'idleNudge' | 'windowReact') => {
      const line = petLines[kind](personality);
      if (line) setAmbient({ text: line });
    },
    [personality],
  );

  const { hovering } = usePetBrain({
    personality,
    petWidth,
    petHeight,
    paused: conversing || dragging,
    onRemark: handleRemark,
    onPoint: handlePoint,
  });

  // Greet once on mount.
  useEffect(() => {
    const line = petLines.greeting(personality);
    if (line) setAmbient({ text: line });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask-before-act: surface a confirm bubble for any proposed window action.
  useEffect(() => {
    return onProposal((p) => {
      setAmbient({
        text: p.prompt,
        action: {
          label: p.confirmLabel,
          onConfirm: () => {
            setAmbient(null);
            void p.execute();
          },
          onDeny: () => setAmbient(null),
        },
      });
    });
  }, []);

  // Proactivity: react in-character to conductor notifications forwarded from
  // the main window's hub connection.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // Only listen if we're in the pet window (not the fallback render).
    if (isTauri()) {
      void listen<{ title?: string; body?: string }>('metu://pet-notify', (event) => {
        const { title, body } = event.payload ?? {};
        const text = [title, body].filter(Boolean).join(' — ');
        if (text) setAmbient({ text });
      }).then((fn) => {
        unlisten = fn;
      });
    }
    return () => unlisten?.();
  }, []);

  const handleAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      setAudioEl(el);
      audioRef?.(el);
    },
    [audioRef],
  );

  // Map the discrete pet flags to the avatar drive state. AvatarHost owns the
  // orb↔VRM decision (and falls back to the orb when a VRM fails to load).
  const avatarState: AvatarState = thinking
    ? 'thinking'
    : speaking
      ? 'speaking'
      : listening
        ? 'listening'
        : 'idle';

  // Voice output takes precedence over ambient chatter in the bubble.
  const bubbleText = voiceBubble ?? ambient?.text;
  const bubbleAction = voiceBubble ? undefined : ambient?.action;

  return (
    <div
      className="pet-stage"
      data-persona={slug}
      data-speaking={speaking}
      data-hovering={hovering}
    >
      {bubbleText && (
        <SpeechBubble
          text={bubbleText}
          ttlMs={cfg.bubbleTtlMs}
          action={bubbleAction}
          onDismiss={() => setAmbient(null)}
        />
      )}
      <div
        ref={bodyRef}
        className={`pet-body ${speaking ? 'pet-body--speaking' : ''}`}
        data-tauri-drag-region
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <AvatarHost state={avatarState} size={180} audioEl={audioEl} />
      </div>
      <audio ref={handleAudio} autoPlay playsInline />
    </div>
  );
}
