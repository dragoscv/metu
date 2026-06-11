/**
 * Form D — the desktop assistant. A transparent always-on-top window hosting
 * the persona character, an ambient speech bubble with inline quick-reply /
 * confirm actions, and an expandable agentic chat panel that talks to the
 * metu Conductor (codai-backed) via `/api/sdk/v1/companion/turn/stream`.
 *
 * ── Drag model (fix v2) ────────────────────────────────────────────────────
 * `data-tauri-drag-region` only fires on the attributed element itself (the
 * avatar's WebGL canvas swallowed it), and handing off to the OS modal move
 * loop (`win_start_drag`) mid-gesture proved unreliable in WebView2. We now
 * move the window OURSELVES: pointerdown captures the pointer and snapshots
 * the window's outerPosition; each pointermove computes the screen-space
 * delta and calls `setPosition`. Pointer capture keeps events flowing even
 * while the window moves under the cursor. Releases without movement remain
 * clicks (toggle chat, interrupt, etc).
 *
 * Click-through is owned by the brain via DOM-exact `setInteractive` — see
 * useAssistantBrain for the contract.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { loadAuth, type AuthState } from '../state/auth';
import { isTauri } from '../state/runtime';
import { useVoiceSession } from '../state/useVoiceSession';
import { useWakeWord } from '../state/useWakeWord';
import { useBillingTier, usePersonas, useResolvedPersona } from '../state/usePersonas';
import { playWakeBlip } from '../state/wakeBlip';
import { AvatarHost } from '../avatar/AvatarHost';
import type { AvatarState } from '../avatar/types';
import { useAssistantBrain, type PointRequest } from '../assistant/useAssistantBrain';
import { onActivityChange, startActivityModel, startDistiller } from '../assistant/activityModel';
import { applySenseSettings, saveWatchPaused } from '../state/senseSettings';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  startSuggestionEngine,
  loadProactivity,
  saveProactivity,
  type ProactivityMode,
} from '../assistant/proactivity';
import { MetuTtsProxyProvider } from '@metu/voice/tts-proxy';
import { SpeechBubble, type BubbleAction } from '../assistant/SpeechBubble';
import { assistantLines, QUICK_REPLIES } from '../assistant/assistantMessages';
import { showHighlight } from '../assistant/overlay-bridge';
import { onProposal } from '../assistant/assistantActions';
import { useAssistantChat } from '../assistant/useAssistantChat';
import { ChatPanel } from '../assistant/ChatPanel';
import {
  loadPersonality,
  onPersonalityChange,
  PERSONALITIES,
  type PersonalityId,
} from '../avatar/personality';

/** Logical window size — must match the `assistant` window in tauri.conf.json. */
const WIN_W = 380;
const WIN_H = 560;
const DRAG_THRESHOLD_PX = 6;

export function PresenceAssistant() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  // Jarvis Slice B — live activity model (sense-event reducer) runs for the
  // window's lifetime; the distiller needs auth and follows it.
  useEffect(() => startActivityModel(), []);
  useEffect(() => {
    if (!auth) return;
    return startDistiller(auth);
  }, [auth]);

  if (!auth) {
    return (
      <AssistantSkin
        auth={null}
        personaSlug="atlas"
        personaName="metu"
        personality={loadPersonality()}
        speaking={false}
      />
    );
  }
  return <AssistantInner auth={auth} />;
}

function AssistantInner({ auth }: { auth: AuthState }) {
  const personas = usePersonas(auth);
  const persona = useResolvedPersona('assistant', personas);
  const billingTier = useBillingTier();
  const { state, start, stop, interrupt, setMicEnabled, setAudioElement } = useVoiceSession(auth);

  const [personality, setPersonality] = useState<PersonalityId>(() => loadPersonality());
  useEffect(() => onPersonalityChange(setPersonality), []);

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

  const voiceBubble = state.partial || (state.status === 'listening' ? 'Listening…' : undefined);

  return (
    <AssistantSkin
      auth={auth}
      personaSlug={persona.slug}
      personaName={persona.name}
      personality={personality}
      speaking={state.status === 'speaking'}
      listening={state.status === 'listening'}
      thinking={state.lastToolCall?.tool === 'conductor.escalate'}
      voiceBubble={voiceBubble}
      onInterrupt={() => {
        if (state.status === 'speaking') interrupt();
      }}
      onToggleMic={() => setMicEnabled(state.status !== 'listening')}
      audioRef={setAudioElement}
    />
  );
}

function AssistantSkin({
  auth,
  personaSlug,
  personaName,
  personality,
  speaking,
  listening,
  thinking,
  voiceBubble,
  onInterrupt,
  onToggleMic,
  audioRef,
}: {
  auth: AuthState | null;
  personaSlug: string;
  personaName: string;
  personality: PersonalityId;
  speaking: boolean;
  listening?: boolean;
  thinking?: boolean;
  voiceBubble?: string;
  onInterrupt?: () => void;
  onToggleMic?: () => void;
  audioRef?: (el: HTMLAudioElement | null) => void;
}) {
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [ambient, setAmbient] = useState<{
    text: string;
    action?: BubbleAction;
    quickReplies?: string[];
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const cfg = PERSONALITIES[personality];

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const physW = Math.round(WIN_W * dpr);
  const physH = Math.round(WIN_H * dpr);

  const conversing = speaking || !!listening;

  // ── Manual drag gesture (self-move) ──────────────────────────────────────
  // We move the window ourselves with setPosition deltas instead of handing
  // off to the OS modal loop, which silently no-ops when invoked mid-gesture
  // from an async IPC call on WebView2. Pointer capture guarantees we keep
  // receiving pointermove while the window slides under the cursor.
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    started: boolean;
    el: HTMLElement;
  } | null>(null);
  const dragCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Right-click context menu (anchored inside the window).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Proactivity mode (silent/aware/chatty) — gated in the suggestion engine.
  const [proactivity, setProactivity] = useState<ProactivityMode>(() => loadProactivity());
  // Sense engine watching state (false = user-paused or privacy gate).
  const [watching, setWatching] = useState(true);
  const [userPausedWatch, setUserPausedWatch] = useState(false);
  useEffect(() => onActivityChange((s) => setWatching(s.watching)), []);
  // Restore persisted privacy choices (blocklist + paused) on mount.
  useEffect(() => {
    void applySenseSettings().then(({ paused }) => setUserPausedWatch(paused));
  }, []);

  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isTauri()) return;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    // Snapshot async; gesture arms when the position lands (a few ms).
    void getCurrentWindow()
      .outerPosition()
      .then((pos) => {
        // User may have released already.
        dragRef.current = {
          pointerId,
          startX: e.screenX,
          startY: e.screenY,
          winX: pos.x,
          winY: pos.y,
          started: false,
          el,
        };
      })
      .catch(() => {});
  };

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const flush = () => {
      raf = 0;
      if (!pending) return;
      const { x, y } = pending;
      pending = null;
      void getCurrentWindow()
        .setPosition(new PhysicalPosition(x, y))
        .catch(() => {});
    };

    const onMove = (e: PointerEvent) => {
      const g = dragRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const dxLogical = e.screenX - g.startX;
      const dyLogical = e.screenY - g.startY;
      if (!g.started) {
        if (Math.hypot(dxLogical, dyLogical) < DRAG_THRESHOLD_PX) return;
        g.started = true;
        suppressClickRef.current = true;
        setDragging(true);
        try {
          g.el.setPointerCapture(g.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
      // screenX/Y are logical CSS px; outerPosition is physical px.
      pending = {
        x: Math.round(g.winX + dxLogical * dpr),
        y: Math.round(g.winY + dyLogical * dpr),
      };
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const endDrag = () => {
      const g = dragRef.current;
      dragRef.current = null;
      if (!g) return;
      try {
        g.el.releasePointerCapture(g.pointerId);
      } catch {
        /* ignore */
      }
      if (g.started) {
        if (dragCooldownRef.current) clearTimeout(dragCooldownRef.current);
        // Brief cooldown so the brain doesn't immediately re-target, and so
        // the click that follows pointerup doesn't toggle the chat.
        dragCooldownRef.current = setTimeout(() => {
          setDragging(false);
          suppressClickRef.current = false;
        }, 400);
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    window.addEventListener('blur', endDrag, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
      window.removeEventListener('blur', endDrag, true);
      if (raf) cancelAnimationFrame(raf);
      if (dragCooldownRef.current) clearTimeout(dragCooldownRef.current);
    };
  }, []);

  // ── Chat (agentic, codai-backed) ─────────────────────────────────────────
  const chat = useAssistantChat(
    auth ?? {
      accessToken: '',
      refreshToken: null,
      expiresAt: 0,
      workspaceId: '',
      userId: '',
      apiBase: '',
      hubUrl: '',
    },
    personaSlug,
  );
  const chatBusy = chat.status === 'thinking' || chat.status === 'streaming';

  // Surface the latest assistant chat text as a bubble while collapsed.
  const [chatBubble, setChatBubble] = useState<string | null>(null);
  useEffect(() => {
    if (chatOpen) {
      setChatBubble(null);
      return;
    }
    if (chat.lastAssistantText) setChatBubble(chat.lastAssistantText);
  }, [chat.lastAssistantText, chatOpen]);

  const handlePoint = useCallback((req: PointRequest | null) => {
    if (req?.rect) void showHighlight({ ...req.rect, label: req.label });
  }, []);

  const handleRemark = useCallback(
    (kind: 'greeting' | 'idleNudge' | 'windowReact') => {
      const line = assistantLines[kind](personality);
      if (line) setAmbient({ text: line });
    },
    [personality],
  );

  // Lock interactivity whenever ANY clickable surface is on screen: the chat
  // panel, a drag, ANY bubble (quick-replies/dismiss are clickable even
  // without a confirm action), or the right-click menu. The native watcher
  // keeps click-through OFF while locked, so these are always clickable.
  const interactionLocked =
    chatOpen || dragging || !!ambient || !!chatBubble || !!voiceBubble || !!menu;

  const { mode, hovering, setInteractive } = useAssistantBrain({
    personality,
    width: physW,
    height: physH,
    paused: conversing || dragging,
    interactionLocked,
    onRemark: handleRemark,
    onPoint: handlePoint,
  });

  // Greet once on mount.
  useEffect(() => {
    const line = assistantLines.greeting(personality);
    if (line) setAmbient({ text: line });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-greet whenever the window is actually SHOWN. The webview mounts while
  // the window is still hidden (`visible: false` in tauri.conf.json), so the
  // mount-greeting's TTL expires before the user ever sees it — which looked
  // like "the bubble is missing".
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen('metu://assistant-shown', () => {
        const line = assistantLines.greeting(personality);
        if (line) setAmbient({ text: line });
      }).then((fn) => {
        unlisten = fn;
      });
    }
    return () => unlisten?.();
  }, [personality]);

  // Jarvis Slice D — proactive suggestions (mode-gated in the engine).
  useEffect(() => {
    return startSuggestionEngine({
      onSuggest: (s) => {
        setAmbient({ text: s.text, quickReplies: s.quickReplies });
        // Verbal interjection: chatty mode only, never while a voice
        // conversation is active (don't talk over the user or yourself).
        if (auth && audioEl && loadProactivity() === 'chatty' && !speaking && !listening) {
          void MetuTtsProxyProvider.speakToAudioElement(
            s.text,
            {
              apiBase: auth.apiBase,
              accessToken: auth.accessToken,
              personaSlug,
              voiceId: '',
            },
            audioEl,
          ).catch(() => {
            /* spoken nudge is best-effort — the bubble already showed */
          });
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, audioEl, personaSlug]);

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

  // Conductor notifications forwarded from the main window's hub connection.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen<{ title?: string; body?: string }>('metu://assistant-notify', (event) => {
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

  const avatarState: AvatarState =
    thinking || chatBusy ? 'thinking' : speaking ? 'speaking' : listening ? 'listening' : 'idle';

  // Priority: live voice transcript > fresh chat reply > ambient remark.
  const bubbleText = voiceBubble ?? chatBubble ?? ambient?.text;
  const bubbleAction = voiceBubble || chatBubble ? undefined : ambient?.action;
  const bubbleIsChat = !voiceBubble && !!chatBubble;
  // One-tap chips: ambient remarks get conversation starters; chat replies
  // get follow-ups. Confirm bubbles + live voice transcripts get none.
  // Suggestion bubbles carry their own context-specific replies.
  const bubbleSuggestions =
    voiceBubble || bubbleAction || !auth
      ? undefined
      : bubbleIsChat
        ? QUICK_REPLIES.followup
        : (ambient?.quickReplies ?? QUICK_REPLIES.ambient);

  const dismissBubble = () => {
    if (bubbleIsChat) setChatBubble(null);
    else setAmbient(null);
  };

  // The assistant window is created with `focus: false` (it must never steal
  // focus while ambient). Opening the chat is an explicit user action, so we
  // DO want focus then — otherwise the input can't receive keystrokes and
  // clicks feel dead on Windows until the user alt-tabs.
  useEffect(() => {
    if (chatOpen && isTauri()) {
      void getCurrentWindow()
        .setFocus()
        .catch(() => {});
    }
  }, [chatOpen]);

  const onAvatarClick = () => {
    if (suppressClickRef.current) return;
    if (speaking) {
      onInterrupt?.();
      return;
    }
    setChatOpen((v) => !v);
  };

  // Right-click: in-window context menu. WebView2 suppresses the native menu
  // on transparent frameless windows, so we draw our own.
  const onAvatarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  // Dismiss the menu on any click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const quickReply = auth
    ? (text: string) => {
        setChatBubble(null);
        setAmbient(null);
        void chat.send(text);
      }
    : undefined;

  return (
    <div
      className="assistant-stage"
      data-persona={personaSlug}
      data-speaking={speaking}
      data-hovering={hovering}
      data-mode={mode}
    >
      {/* Watching indicator — green eye while ambient sensing is active,
            gray when paused (user or privacy gate). Always visible so the
            user can ALWAYS tell whether the screen is being observed. */}
      <div
        className={`assistant-watchdot ${watching && !userPausedWatch ? 'assistant-watchdot--on' : ''}`}
        title={
          watching && !userPausedWatch
            ? 'Watching your screen (right-click to stop)'
            : 'Not watching (paused or sensitive context)'
        }
        aria-hidden
      />
      {chatOpen && auth ? (
        <div
          className="assistant-panel"
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          <div className="assistant-panel__avatar" onPointerDown={onBodyPointerDown}>
            <AvatarHost state={avatarState} size={72} audioEl={audioEl} />
          </div>
          <ChatPanel
            messages={chat.messages}
            status={chat.status}
            personaName={personaName}
            onSend={(t) => void chat.send(t)}
            onStop={chat.stop}
            onClear={chat.clear}
            onClose={() => setChatOpen(false)}
            onDragPointerDown={onBodyPointerDown}
          />
        </div>
      ) : (
        <>
          {bubbleText && (
            <div
              className="assistant-bubblezone"
              onPointerEnter={() => setInteractive(true)}
              onPointerLeave={() => setInteractive(false)}
            >
              <SpeechBubble
                text={bubbleText}
                ttlMs={cfg.bubbleTtlMs}
                action={bubbleAction}
                pending={bubbleIsChat && chatBusy}
                onDismiss={dismissBubble}
                onQuickReply={quickReply}
                suggestions={bubbleSuggestions}
                onOpenChat={auth ? () => setChatOpen(true) : undefined}
              />
            </div>
          )}
          <div
            className={`assistant-body ${speaking ? 'assistant-body--speaking' : ''}`}
            onPointerEnter={() => setInteractive(true)}
            onPointerLeave={() => setInteractive(false)}
            onPointerDown={onBodyPointerDown}
            onClick={onAvatarClick}
            onDoubleClick={() => onToggleMic?.()}
            onContextMenu={onAvatarContextMenu}
            title="Click to chat · drag to move · double-click for voice"
          >
            <AvatarHost state={avatarState} size={180} audioEl={audioEl} />
          </div>
        </>
      )}
      {menu && (
        <div
          className="assistant-menu"
          style={{ left: Math.min(menu.x, WIN_W - 168), top: Math.min(menu.y, WIN_H - 190) }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                setChatOpen(true);
              }}
            >
              💬 Open chat
            </button>
          )}
          {bubbleText && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                void writeText(bubbleText).catch(() => {});
                setMenu(null);
              }}
            >
              📋 Copy bubble text
            </button>
          )}
          <button
            className="assistant-menu__item"
            onClick={() => {
              setMenu(null);
              onToggleMic?.();
            }}
          >
            🎤 Toggle voice
          </button>
          <button
            className="assistant-menu__item"
            onClick={() => {
              // Cycle silent → aware → chatty.
              const order: ProactivityMode[] = ['silent', 'aware', 'chatty'];
              const cur = loadProactivity();
              const next = order[(order.indexOf(cur) + 1) % order.length] ?? 'aware';
              saveProactivity(next);
              setProactivity(next);
              setMenu(null);
              setAmbient({
                text:
                  next === 'silent'
                    ? "Going quiet — I'll only speak when you ask."
                    : next === 'aware'
                      ? "I'll speak up when it matters."
                      : "Chatty mode — I'll share thoughts as we go!",
              });
            }}
          >
            {proactivity === 'silent' ? '🔕' : proactivity === 'aware' ? '🔔' : '💬'} Mode:{' '}
            {proactivity}
          </button>
          <button
            className="assistant-menu__item"
            onClick={() => {
              setMenu(null);
              setAmbient(null);
              setChatBubble(null);
            }}
          >
            ✨ Dismiss bubble
          </button>
          <button
            className="assistant-menu__item"
            onClick={() => {
              const next = !userPausedWatch;
              setUserPausedWatch(next);
              setMenu(null);
              void saveWatchPaused(next); // persists + applies to the engine
              setAmbient({
                text: next
                  ? "Stopped watching — I can't see your screen until you resume."
                  : 'Watching again. Privacy gate still applies.',
              });
            }}
          >
            {userPausedWatch ? '🙈 Resume watching' : '👁 Stop watching'}
          </button>
          <button
            className="assistant-menu__item"
            onClick={() => {
              setMenu(null);
              void invoke('presence_assistant_hide').catch(() => {});
            }}
          >
            👻 Hide assistant
          </button>
        </div>
      )}
      <audio ref={handleAudio} autoPlay playsInline />
    </div>
  );
}
