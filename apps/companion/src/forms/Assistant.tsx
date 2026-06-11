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
import { executeActPlan, planAct, runSkill, SKILL_ACKS, type SkillId } from '../assistant/skills';
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
  savePersonality,
  type PersonalityId,
} from '../avatar/personality';
import { GLB_PRESETS } from '../avatar/glbPresets';
import { useAvatarSelection } from '../avatar/useAvatarSelection';
import { open as openUrl } from '@tauri-apps/plugin-shell';

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
  // Drag-gesture race guards (see onBodyPointerDown).
  const dragGenRef = useRef(0);
  const pointerStillDownRef = useRef(false);
  // Right-click context menu (anchored inside the window).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Proactivity mode (silent/aware/chatty) — gated in the suggestion engine.
  const [proactivity, setProactivity] = useState<ProactivityMode>(() => loadProactivity());
  // Avatar selection (for the "Next avatar" cycler).
  const avatarSel = useAvatarSelection();
  // Snooze guard — only the latest snooze's timeout restores aware mode.
  const suggestionSnoozeUntilRef = useRef<number>(0);
  // Sense engine watching state (false = user-paused or privacy gate).
  const [watching, setWatching] = useState(true);
  const [userPausedWatch, setUserPausedWatch] = useState(false);
  useEffect(() => onActivityChange((s) => setWatching(s.watching)), []);
  // Restore persisted privacy choices (blocklist + paused) on mount.
  useEffect(() => {
    void applySenseSettings().then(({ paused }) => setUserPausedWatch(paused));
  }, []);

  // Report interactive zones to the native watcher. The assistant window
  // is a tall transparent sheet; the watcher must only make it clickable
  // over real UI (avatar, bubble, panel, menu) or it swallows clicks meant
  // for apps behind the transparent area — which also broke OTHER windows'
  // buttons when the sheet overlapped them.
  useEffect(() => {
    if (!isTauri()) return;
    const report = () => {
      const rects: Array<[number, number, number, number]> = [];
      for (const sel of [
        '.assistant-body',
        '.bubble',
        '.assistant-menu',
        '.assistant-panel',
        '.assistant-unread',
      ]) {
        document.querySelectorAll(sel).forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) rects.push([r.x, r.y, r.width, r.height]);
        });
      }
      void invoke('presence_assistant_set_zones', { zones: rects }).catch(() => {});
    };
    report();
    const t = setInterval(report, 500);
    return () => clearInterval(t);
  }, []);

  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isTauri()) return;
    pointerStillDownRef.current = true;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    // Generation guard: if the pointer is released before the async
    // position snapshot lands, the stale .then() must NOT arm a gesture —
    // an armed-but-unstarted dragRef turns subsequent HOVER movement into a
    // phantom drag that suppresses every click (the "nothing works" bug).
    const gen = ++dragGenRef.current;
    // Snapshot async; gesture arms when the position lands (a few ms).
    void getCurrentWindow()
      .outerPosition()
      .then((pos) => {
        // User may have released already — or a newer gesture started.
        if (dragGenRef.current !== gen || !pointerStillDownRef.current) return;
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
      pointerStillDownRef.current = false;
      dragGenRef.current++; // invalidate any in-flight position snapshot
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
  // Unread reply: parked when a chat bubble leaves the screen unseen.
  // 'expired' (TTL) restores on avatar hover; 'dismissed' (explicit ✕)
  // keeps the badge but only restores on CLICK — the user said "not now",
  // so hover must not nag them.
  const [unreadReply, setUnreadReply] = useState<{
    text: string;
    how: 'expired' | 'dismissed';
  } | null>(null);
  // Human-readable progress stage while a quick-reply/chat turn runs.
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  useEffect(() => {
    if (chatOpen) {
      setChatBubble(null);
      setUnreadReply(null);
      return;
    }
    if (chat.lastAssistantText) {
      setChatBubble(chat.lastAssistantText);
      setUnreadReply(null);
    }
  }, [chat.lastAssistantText, chatOpen]);

  // Progress narration: rotate friendly stage lines while the turn runs.
  useEffect(() => {
    if (!chatBusy) {
      setProgressLabel(null);
      return;
    }
    const stages =
      chat.status === 'thinking'
        ? ['Reading your screen…', 'Gathering context…', 'Thinking it through…']
        : ['Writing the answer…'];
    let i = 0;
    setProgressLabel(stages[0] ?? null);
    const t = setInterval(() => {
      i = Math.min(i + 1, stages.length - 1);
      setProgressLabel(stages[i] ?? null);
    }, 2_200);
    return () => clearInterval(t);
  }, [chatBusy, chat.status]);

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

  const { mode, hovering, setInteractive, locomotion, facing } = useAssistantBrain({
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
  // While a turn is running with no bubble up yet, show a progress bubble
  // so a quick-reply tap never looks like it swallowed the request.
  const workingBubble = chatBusy && !chatBubble && !voiceBubble ? (progressLabel ?? '…') : null;
  const bubbleText = voiceBubble ?? chatBubble ?? workingBubble ?? ambient?.text;
  const bubbleAction = voiceBubble || chatBubble ? undefined : ambient?.action;
  const bubbleIsChat = !voiceBubble && !!chatBubble;
  // One-tap chips: ambient remarks get conversation starters; chat replies
  // get follow-ups. Confirm bubbles + live voice transcripts get none.
  // Suggestion bubbles carry their own context-specific replies.
  const bubbleSuggestions =
    voiceBubble || bubbleAction || !auth || workingBubble
      ? undefined
      : bubbleIsChat
        ? QUICK_REPLIES.followup
        : (ambient?.quickReplies ?? QUICK_REPLIES.ambient);

  const dismissBubble = () => {
    if (bubbleIsChat) {
      // Auto-expiry parks the reply as "unread" — the avatar badge brings
      // it back on hover. Manual ✕ also parks it (cheap undo).
      if (chatBubble) setUnreadReply({ text: chatBubble, how: 'dismissed' });
      setChatBubble(null);
    } else {
      setAmbient(null);
    }
  };

  /** TTL expiry of a chat reply — parked as hover-restorable unread. */
  const expireBubble = () => {
    if (bubbleIsChat) {
      if (chatBubble) setUnreadReply({ text: chatBubble, how: 'expired' });
      setChatBubble(null);
    } else {
      setAmbient(null);
    }
  };

  const restoreUnread = () => {
    if (!unreadReply) return;
    setChatBubble(unreadReply.text);
    setUnreadReply(null);
  };

  // ── Direct skill lane: instant ack + stream into the bubble ─────────────
  const skillAbortRef = useRef<AbortController | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  /**
   * Act skill: natural-language instruction → ONE planned UIA step →
   * ask-before-act confirm bubble → native execute. Never runs without
   * the user pressing the confirm button.
   */
  const fireAct = useCallback(
    (instruction: string) => {
      if (!auth) return;
      setUnreadReply(null);
      setChatBubble('Working out how to do that…');
      setSkillBusy(true);
      planAct(auth, instruction, personaSlug)
        .then((plan) => {
          setSkillBusy(false);
          if (!plan.feasible || !plan.action) {
            setChatBubble(plan.reason ?? "I couldn't find a safe way to do that.");
            return;
          }
          setChatBubble(null);
          setAmbient({
            text: plan.prompt ?? `Do this: ${plan.action} "${plan.name}"?`,
            action: {
              label: 'Do it',
              onConfirm: () => {
                setAmbient(null);
                setChatBubble(
                  `On it — ${plan.action === 'invoke' ? 'clicking' : 'filling'} "${plan.name}"…`,
                );
                executeActPlan(plan)
                  .then(() => setChatBubble(`Done — ${plan.name}.`))
                  .catch((err: unknown) =>
                    setChatBubble(err instanceof Error ? err.message : 'That didn’t work.'),
                  );
              },
              onDeny: () => {
                setAmbient(null);
                setChatBubble('Okay, not doing it.');
              },
            },
          });
        })
        .catch((err: unknown) => {
          setSkillBusy(false);
          setChatBubble(err instanceof Error ? err.message : 'Planning failed.');
        });
    },
    [auth, personaSlug],
  );
  const fireSkill = useCallback(
    (skill: SkillId) => {
      if (!auth) return;
      skillAbortRef.current?.abort();
      const ctrl = new AbortController();
      skillAbortRef.current = ctrl;
      setSkillBusy(true);
      // Instant ack — the bubble appears before any network round-trip.
      setUnreadReply(null);
      setChatBubble(SKILL_ACKS[skill]);
      runSkill(
        auth,
        skill,
        personaSlug,
        (full) => {
          if (!ctrl.signal.aborted) setChatBubble(full);
        },
        ctrl.signal,
      )
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setChatBubble(err instanceof Error ? err.message : 'Something went wrong.');
        })
        .finally(() => {
          if (skillAbortRef.current === ctrl) {
            skillAbortRef.current = null;
            setSkillBusy(false);
          }
        });
    },
    [auth, personaSlug],
  );

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

  // Single click → conversational bubble with quick actions.
  // Double click → morph into the chat panel.
  // Disambiguated with a short timer so a double-click never first flashes
  // the bubble. Voice toggle lives in the context menu (and hotkey).
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-click detection via e.detail on click events. WebView2's native
  // `dblclick` proved unreliable here: the first click's state update
  // re-renders the subtree, and a re-rendered/remounted node between the
  // two clicks swallows the dblclick. `detail` is computed by the input
  // pipeline on the SECOND click event itself, so it always arrives.
  const onAvatarClick = (e: React.MouseEvent) => {
    if (suppressClickRef.current) return;
    if (speaking) {
      onInterrupt?.();
      return;
    }
    if (e.detail >= 2) {
      // Double click: cancel the pending single-click action and morph.
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      setAmbient(null);
      setChatBubble(null);
      setUnreadReply(null);
      setChatOpen(true);
      return;
    }
    if (clickTimerRef.current) return; // already pending
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (chatOpen) return; // panel open: single click does nothing
      // Surface something useful: unread reply > fresh greeting w/ actions.
      if (unreadReply) {
        restoreUnread();
      } else if (!bubbleText) {
        const line = assistantLines.greeting(personality) ?? 'Ready when you are.';
        setAmbient({ text: line });
      } else {
        // A bubble is already up — nudge: refresh its TTL by re-setting.
        setAmbient((a) => (a ? { ...a } : a));
      }
    }, 260);
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

  /** Canned chips that map to the fast skill lane instead of full chat. */
  const SKILL_CHIPS: Record<string, SkillId> = {
    'Catch me up': 'catch_up',
    'What was I doing?': 'catch_up',
    'Summarize where I left off': 'catch_up',
    "What's next on my plate?": 'whats_next',
    'What does this error mean?': 'explain_error',
    'Suggest a fix': 'explain_error',
  };
  const quickReply = auth
    ? (text: string) => {
        setAmbient(null);
        // "do <instruction>" → act skill (plan → confirm → UIA execute).
        const doMatch = /^(?:do|click|press|type|fill|select|open tab)\b/i.test(text.trim());
        if (doMatch) {
          fireAct(text.trim());
          return;
        }
        const skill = SKILL_CHIPS[text];
        if (skill) {
          // Fast lane: ack + streamed answer, no triage round-trip.
          fireSkill(skill);
          return;
        }
        setChatBubble(null);
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
                ttlMs={bubbleIsChat ? Math.max(cfg.bubbleTtlMs * 3, 18_000) : cfg.bubbleTtlMs}
                action={bubbleAction}
                pending={(chatBusy && (bubbleIsChat || !!workingBubble)) || skillBusy}
                progressLabel={progressLabel}
                onDismiss={dismissBubble}
                onExpire={expireBubble}
                onQuickReply={workingBubble ? undefined : quickReply}
                suggestions={bubbleSuggestions}
                onOpenChat={auth ? () => setChatOpen(true) : undefined}
              />
            </div>
          )}
          <div
            className={`assistant-body ${speaking ? 'assistant-body--speaking' : ''}`}
            onPointerEnter={() => {
              setInteractive(true);
              // Hover restores TTL-expired replies only; explicitly
              // dismissed ones need a click (user said "not now").
              if (unreadReply?.how === 'expired' && !bubbleText) restoreUnread();
            }}
            onPointerLeave={() => setInteractive(false)}
            onPointerDown={onBodyPointerDown}
            onClick={onAvatarClick}
            onContextMenu={onAvatarContextMenu}
            title="Click for quick actions · double-click to chat · right-click for menu"
          >
            <AvatarHost
              state={avatarState}
              size={180}
              audioEl={audioEl}
              locomotion={locomotion}
              facing={facing}
            />
            {unreadReply && !bubbleText && (
              <button
                type="button"
                className="assistant-unread"
                title="Show the last reply"
                onPointerEnter={() => {
                  if (unreadReply.how === 'expired') restoreUnread();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  restoreUnread();
                }}
              >
                💬
              </button>
            )}
          </div>
        </>
      )}
      {menu && (
        <div
          className="assistant-menu"
          style={{
            left: Math.min(menu.x, WIN_W - 200),
            top: Math.max(8, Math.min(menu.y, WIN_H - 430)),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          {/* ── Chat & context ── */}
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
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                fireSkill('catch_up');
              }}
            >
              ⏪ Catch me up
            </button>
          )}
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                fireSkill('analyze_screen');
              }}
            >
              👀 Analyze my screen
            </button>
          )}
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                setChatOpen(true);
                window.dispatchEvent(
                  new CustomEvent('metu:chat-prefill', {
                    detail: 'Search my screen history for ',
                  }),
                );
              }}
            >
              🔎 Search screen history
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
          {(bubbleText || unreadReply) && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                setAmbient(null);
                setChatBubble(null);
                setUnreadReply(null);
              }}
            >
              ✨ Dismiss bubble
            </button>
          )}
          <div className="assistant-menu__sep" />
          {/* ── Behavior ── */}
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
              // Cycle calm → playful → quiet.
              const order: PersonalityId[] = ['calm', 'playful', 'quiet'];
              const next = order[(order.indexOf(personality) + 1) % order.length] ?? 'calm';
              savePersonality(next);
              setMenu(null);
              setAmbient({
                text: `Mood: ${PERSONALITIES[next].label}. ${PERSONALITIES[next].description}`,
              });
            }}
          >
            {personality === 'calm' ? '😌' : personality === 'playful' ? '😄' : '🤫'} Mood:{' '}
            {personality}
          </button>
          <button
            className="assistant-menu__item"
            onClick={() => {
              // Cycle through GLB characters (the assistant's usual form).
              const ids = GLB_PRESETS.map((p) => p.id);
              const cur = avatarSel.selection.glbPresetId;
              const next = ids[(ids.indexOf(cur) + 1) % ids.length] ?? ids[0]!;
              avatarSel.setKind('glb');
              avatarSel.setGlbPreset(next);
              setMenu(null);
              setAmbient({
                text: `Switched to ${GLB_PRESETS.find((p) => p.id === next)?.name ?? next}.`,
              });
            }}
          >
            🎭 Next avatar
          </button>
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                const until = Date.now() + 3600_000;
                suggestionSnoozeUntilRef.current = until;
                saveProactivity('silent');
                setProactivity('silent');
                // Auto-restore after an hour.
                setTimeout(() => {
                  if (suggestionSnoozeUntilRef.current === until) {
                    saveProactivity('aware');
                    setProactivity('aware');
                  }
                }, 3600_000);
                setAmbient({ text: 'Snoozed for 1 hour — no interruptions.' });
              }}
            >
              😴 Snooze 1h
            </button>
          )}
          <div className="assistant-menu__sep" />
          {/* ── Privacy & window ── */}
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
              window.dispatchEvent(new CustomEvent('metu:assistant-dock'));
            }}
          >
            📍 Dock to corner
          </button>
          {auth && (
            <button
              className="assistant-menu__item"
              onClick={() => {
                setMenu(null);
                void openUrl(auth.apiBase).catch(() => {});
              }}
            >
              🌐 Open dashboard
            </button>
          )}
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
