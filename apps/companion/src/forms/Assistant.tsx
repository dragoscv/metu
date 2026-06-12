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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { ensureFreshAuth, loadAuth, type AuthState } from '../state/auth';
import { isTauri } from '../state/runtime';
import { useVoiceSession } from '../state/useVoiceSession';
import { useWakeWord } from '../state/useWakeWord';
import { useBillingTier, usePersonas, useResolvedPersona } from '../state/usePersonas';
import { playWakeBlip } from '../state/wakeBlip';
import { AvatarHost } from '../avatar/AvatarHost';
import type { AvatarState } from '../avatar/types';
import { useAssistantBrain, type PointRequest } from '../assistant/useAssistantBrain';
import { getActivityState, startActivityModel, startDistiller } from '../assistant/activityModel';
import {
  executeActPlan,
  generateImage,
  planAct,
  planSteps,
  runSkill,
  SKILL_ACKS,
  splitChips,
  type SkillId,
} from '../assistant/skills';
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
import { assistantLines } from '../assistant/assistantMessages';
import { fromPath } from '../assistant/attachments';
import { getSmartChips } from '../assistant/smartChips';
import { showHighlight } from '../assistant/overlay-bridge';
import { onProposal } from '../assistant/assistantActions';
import { useAssistantChat } from '../assistant/useAssistantChat';
import { ChatPanel } from '../assistant/ChatPanel';
import { CalibrateOverlay } from '../assistant/CalibrateOverlay';
import { playGesture, tryGestureCommand } from '../avatar/gestures';
import {
  classifyCommand,
  isRiskyInvocation,
  parseCommandLine,
  runTerminal,
} from '../assistant/terminal';
import {
  maybeLearnFromUtterance,
  maybeWeeklyReflection,
  recordSuggestionEngaged,
  suggestionCategory,
  type SuggestionCategory,
} from '../assistant/learning';
import {
  LANGUAGE_LABELS,
  loadAssistantLanguage,
  saveAssistantLanguage,
  type AssistantLanguage,
} from '../state/language';
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
// 720 gives the bubble real headroom above the ~220px avatar — replies
// GROW instead of scrolling (the transparent click-through window makes
// the extra height free; the avatar stays planted by the feet math).
const WIN_H = 720;
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

  // Size invariant: the physics positions the window as `feet − height`,
  // so a mismatch between the REAL window size and WIN_W/WIN_H silently
  // offsets the avatar from the taskbar (the "hovers above the bar" bug:
  // tauri.conf.json said 560 while JS assumed 720). Enforce the JS size
  // at mount — config drift can no longer break placement.
  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .setSize(new LogicalSize(WIN_W, WIN_H))
      .catch(() => {});
  }, []);

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
  const [calibrating, setCalibrating] = useState(false);
  // Proactivity mode (silent/aware/chatty) — gated in the suggestion engine.
  const [proactivity, setProactivity] = useState<ProactivityMode>(() => loadProactivity());
  /** Assistant RESPONSE language (replies + voice); UI stays English. */
  const [assistantLang, setAssistantLang] = useState<AssistantLanguage>(() =>
    loadAssistantLanguage(),
  );
  // Avatar selection (for the "Next avatar" cycler).
  const avatarSel = useAvatarSelection();
  // Snooze guard — only the latest snooze's timeout restores aware mode.
  const suggestionSnoozeUntilRef = useRef<number>(0);
  /** Category of the most recent proactive suggestion — engagement with
   *  the next quick-reply credits this category (learning loop). */
  const lastSuggestionCatRef = useRef<SuggestionCategory | null>(null);
  // Sense engine watching state (false = user-paused or privacy gate).
  // `watching` state lives in the activity model; the menu only needs the
  // user-paused flag since the corner watchdot was removed.
  const [userPausedWatch, setUserPausedWatch] = useState(false);
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
  /** Jarvis v3 — LLM-suggested follow-up chips for the current reply. */
  const [dynamicChips, setDynamicChips] = useState<string[]>([]);
  // Unread reply: parked when a chat bubble leaves the screen unseen.
  // 'expired' (TTL) restores on avatar hover; 'dismissed' (explicit ✕)
  // keeps the badge but only restores on CLICK — the user said "not now",
  // so hover must not nag them.
  const [unreadReply, setUnreadReply] = useState<{
    text: string;
    how: 'expired' | 'dismissed';
  } | null>(null);
  /** True once the user has explicitly restored/read the current bubble —
   *  a read bubble must NOT re-park as unread on expiry/dismiss (that made
   *  the badge immortal). Reset whenever a NEW assistant reply arrives. */
  const bubbleReadRef = useRef(false);
  /** The reply text already SURFACED as a bubble — a dismissed/expired
   *  reply must never re-appear when this effect re-runs (panel close,
   *  dep churn). Only genuinely NEW replies open a fresh bubble. */
  const lastSurfacedRef = useRef<string | null>(null);
  // Human-readable progress stage while a quick-reply/chat turn runs.
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  useEffect(() => {
    if (chatOpen) {
      setChatBubble(null);
      setUnreadReply(null);
      bubbleReadRef.current = true; // panel shows the thread — all read
      // Panel showed the thread — everything in it counts as surfaced.
      lastSurfacedRef.current = chat.lastAssistantText;
      return;
    }
    if (chat.lastAssistantText && chat.lastAssistantText !== lastSurfacedRef.current) {
      lastSurfacedRef.current = chat.lastAssistantText;
      bubbleReadRef.current = false; // fresh reply — unread until seen
      setChatBubble(chat.lastAssistantText);
      setDynamicChips(chat.lastChips);
      setUnreadReply(null);
    }
  }, [chat.lastAssistantText, chatOpen]);

  // Progress narration: rotate friendly stage lines while the turn runs.
  useEffect(() => {
    if (!chatBusy) {
      setProgressLabel(null);
      return;
    }
    // Live tool activity beats the canned narration — show what the
    // agent is ACTUALLY doing ("Reading tasks…"), Copilot-agent style.
    const lastMsg = chat.messages[chat.messages.length - 1];
    const running = lastMsg?.toolActivity?.filter((a) => a.status === 'running') ?? [];
    if (running.length > 0) {
      const labels: Record<string, string> = {
        recall: 'Searching memory',
        list_projects: 'Reading projects',
        list_tasks: 'Reading tasks',
        restore_continuity: 'Restoring context',
        'device.see': 'Looking at the screen',
        'device.screenshot': 'Taking a screenshot',
      };
      const last = running[running.length - 1]!;
      setProgressLabel(`${labels[last.name] ?? last.name.replace(/_/g, ' ')}…`);
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
  }, [chatBusy, chat.status, chat.messages]);

  const handlePoint = useCallback((req: PointRequest | null) => {
    if (req?.rect) {
      void showHighlight({ ...req.rect, label: req.label });
      // Point AT the highlight: pick the arm matching the target's side.
      const winX = window.screenX + WIN_W / 2;
      playGesture(req.rect.x + req.rect.w / 2 < winX ? 'point-left' : 'point-right', 2200);
    }
  }, []);

  const handleRemark = useCallback(
    (kind: 'greeting' | 'idleNudge' | 'windowReact') => {
      const line = assistantLines[kind](personality);
      if (line) setAmbient({ text: line });
      if (kind === 'greeting') playGesture('wave');
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
    playGesture('wave', 1800);
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
        lastSuggestionCatRef.current = suggestionCategory(s.id);
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
              language: loadAssistantLanguage(),
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

  // ── Jarvis v3 — anticipation engine + daily rhythm ───────────────────────
  // Every ~12min of ACTIVE use (not idle, not deep focus, mode≠silent) run
  // the 'anticipate' skill: live context → 0..1 proactive suggestion. The
  // model is instructed to PASS by default; we stay quiet on PASS.
  // Morning brief: first activity of a calendar day. EOD wrap: explicit
  // via menu (scheduling sunset detection adds noise; menu first).
  const anticipateBusyRef = useRef(false);
  useEffect(() => {
    if (!auth) return;
    const ANTICIPATE_MS = 12 * 60_000;
    const timer = setInterval(() => {
      if (anticipateBusyRef.current || chatOpen || skillBusy) return;
      if (loadProactivity() === 'silent') return;
      const act = getActivityState();
      if (act.focusDepth !== 'normal') return; // deep focus or idle
      if (Date.now() < suggestionSnoozeUntilRef.current) return;
      anticipateBusyRef.current = true;
      runSkill(auth, 'anticipate', personaSlug, () => {})
        .then((full) => {
          const { text, chips } = splitChips(full);
          const clean = text.trim();
          if (!clean || /^PASS\b/i.test(clean)) return; // nothing valuable
          setAmbient({ text: clean, quickReplies: chips.length ? chips : undefined });
        })
        .catch(() => {})
        .finally(() => {
          anticipateBusyRef.current = false;
        });
    }, ANTICIPATE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, personaSlug]);

  // Morning brief: fires once per calendar day, on the first tick where
  // the user is actually active (so it lands when they sit down).
  useEffect(() => {
    if (!auth) return;
    const KEY = 'metu.lastMorningBrief';
    const timer = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10);
      try {
        if (localStorage.getItem(KEY) === today) return;
      } catch {
        return;
      }
      const act = getActivityState();
      if (act.focusDepth === 'idle' || loadProactivity() === 'silent') return;
      try {
        localStorage.setItem(KEY, today);
      } catch {
        /* ignore */
      }
      maybeWeeklyReflection(auth); // piggyback: weekly self-reflection
      playGesture('wave', 1800);
      fireSkill('morning_brief');
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, personaSlug]);

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
        if (!text) return;
        // Escalation follow-throughs THREAD into the conversation — the
        // chat promised "handed to your Conductor, will follow up here",
        // so the follow-up must land in the same thread, not just float
        // by as an ambient bubble.
        const isFollowUp = /escalation|followed through|conductor/i.test(title ?? '');
        if (isFollowUp && chat.messages.length > 0) {
          chat.appendAssistant(body ?? text);
          if (!chatOpen) {
            setChatBubble(body ?? text);
            bubbleReadRef.current = false;
          }
          playGesture('nod');
          return;
        }
        setAmbient({ text });
      }).then((fn) => {
        unlisten = fn;
      });
    }
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, chat.messages.length]);

  // Native drag-drop onto the AVATAR (Jarvis v4.6): dropping files on the
  // character reads them locally and opens the chat with them attached —
  // "hand metu a file". Tauri emits drag-drop for the whole window.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop' || !event.payload.paths.length) return;
        const paths = event.payload.paths.slice(0, 4);
        playGesture('nod');
        void Promise.all(paths.map(fromPath)).then((files) => {
          // Stash for the panel; open chat with a prefill hinting intent.
          window.dispatchEvent(new CustomEvent('metu:chat-attach', { detail: files }));
          setChatOpen(true);
        });
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
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
  // One-tap chips (Jarvis v4.1 — ALL dynamic now):
  //   chat replies     → LLM CHIPS trailer (grounded in the reply)
  //   suggestion bubbles → their own context-specific replies
  //   ambient/greeting  → getSmartChips(): live activity + time-of-day +
  //                       project continuity (recomputed per bubble)
  // Confirm bubbles + live voice transcripts get none.
  const smartChips = useMemo(
    () => getSmartChips(),
    // Recompute per bubble appearance — ambient text is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ambient?.text],
  );
  const bubbleSuggestions =
    voiceBubble || bubbleAction || !auth || workingBubble
      ? undefined
      : bubbleIsChat
        ? dynamicChips.length
          ? dynamicChips
          : smartChips
        : (ambient?.quickReplies ?? smartChips);

  const dismissBubble = () => {
    if (bubbleIsChat) {
      // Manual ✕ on a bubble the user has ALREADY restored once counts as
      // read — don't re-park it (the badge would never go away). Fresh
      // bubbles park as 'dismissed' (cheap undo).
      if (chatBubble && !bubbleReadRef.current) {
        setUnreadReply({ text: chatBubble, how: 'dismissed' });
      }
      setChatBubble(null);
    } else {
      setAmbient(null);
    }
  };

  /** TTL expiry of a chat reply — parked as hover-restorable unread. */
  const expireBubble = () => {
    if (bubbleIsChat) {
      // Once restored (= read), expiry is silent: re-parking made the
      // unread badge immortal — read the message, bubble re-expires,
      // badge returns. Read means read.
      if (chatBubble && !bubbleReadRef.current) {
        setUnreadReply({ text: chatBubble, how: 'expired' });
      }
      setChatBubble(null);
    } else {
      setAmbient(null);
    }
  };

  const restoreUnread = () => {
    if (!unreadReply) return;
    bubbleReadRef.current = true; // user explicitly opened it — it's read
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
          const steps = planSteps(plan);
          if (!plan.feasible || steps.length === 0) {
            setChatBubble(plan.reason ?? "I couldn't find a safe way to do that.");
            return;
          }
          setChatBubble(null);
          const stepDesc = steps
            .map((s, i) => `${i + 1}. ${s.action === 'invoke' ? 'click' : 'fill'} "${s.name}"`)
            .join(', ');
          setAmbient({
            text: plan.prompt ?? `Do this: ${stepDesc}?`,
            action: {
              label: 'Do it',
              onConfirm: () => {
                setAmbient(null);
                playGesture('typing', steps.length * 1500);
                executeActPlan(plan, (done, total, step) =>
                  // Live checklist — RichMessage renders GFM task lists.
                  setChatBubble(
                    steps
                      .map((s, j) =>
                        j < done
                          ? `- [x] ${s.action === 'invoke' ? 'click' : 'fill'} "${s.name}"`
                          : j === done
                            ? `- [ ] **${step.action === 'invoke' ? 'clicking' : 'filling'} "${step.name}"…**`
                            : `- [ ] ${s.action === 'invoke' ? 'click' : 'fill'} "${s.name}"`,
                      )
                      .join('\n'),
                  ),
                )
                  .then(({ verified }) => {
                    const done = steps.length > 1 ? `Done — all ${steps.length} steps.` : 'Done.';
                    setChatBubble(
                      verified ? done : `${done} (I couldn't confirm the app reacted — check it.)`,
                    );
                    playGesture(verified ? 'nod' : 'shrug');
                  })
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
    (skill: SkillId, chipLabel?: string) => {
      if (!auth) return;
      skillAbortRef.current?.abort();
      const ctrl = new AbortController();
      skillAbortRef.current = ctrl;
      setSkillBusy(true);
      // Panel open → the skill runs IN-THREAD with live pending state
      // (the "nothing is happening" gap: skills used to stream into the
      // hidden bubble while the panel covered it). Panel closed → bubble.
      const inThread = chatOpen
        ? chat.startLocalTurn(chipLabel ?? SKILL_ACKS[skill], SKILL_ACKS[skill])
        : null;
      if (!inThread) {
        setUnreadReply(null);
        setDynamicChips([]);
        setChatBubble(SKILL_ACKS[skill]);
      }
      runSkill(
        auth,
        skill,
        personaSlug,
        (full) => {
          if (ctrl.signal.aborted) return;
          // Hide the (possibly partial) CHIPS trailer while streaming.
          const clean = splitChips(full).text;
          if (inThread) inThread.update(clean);
          else setChatBubble(clean);
        },
        ctrl.signal,
      )
        .then((full) => {
          if (ctrl.signal.aborted) return;
          const { text, chips } = splitChips(full);
          if (inThread) inThread.finish(text, chips);
          else {
            setChatBubble(text);
            setDynamicChips(chips);
            // Bubble interactions are part of THE conversation: thread the
            // exchange into the active session so opening the panel shows
            // it and the model remembers it (one continuous conversation).
            chat.recordExchange(chipLabel ?? SKILL_ACKS[skill], text);
          }
          // EOD wrap doubles as continuity memory: tomorrow-me (and the
          // morning brief) recalls exactly where today ended.
          if (skill === 'eod_wrap' && text) {
            void ensureFreshAuth(auth)
              .then((fresh) => {
                const a = fresh ?? auth;
                return fetch(`${a.apiBase}/api/sdk/v1/companion/memory`, {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${a.accessToken}`,
                  },
                  body: JSON.stringify({ kind: 'continuity', statement: text.slice(0, 2_000) }),
                });
              })
              .catch(() => {});
          }
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          const msg = err instanceof Error ? err.message : 'Something went wrong.';
          if (inThread) inThread.fail(msg);
          else setChatBubble(msg);
        })
        .finally(() => {
          if (skillAbortRef.current === ctrl) {
            skillAbortRef.current = null;
            setSkillBusy(false);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, personaSlug, chatOpen, chat.startLocalTurn],
  );

  /**
   * Terminal lane (decided policy): allowlisted commands run on AUTOPILOT,
   * unknown commands ask via confirm bubble, denylisted never run. The
   * 'typing' gesture plays while the command executes; output (or error)
   * lands in the chat bubble.
   */
  const fireTerminal = useCallback((line: string) => {
    const parsed = parseCommandLine(line);
    if (!parsed) {
      setChatBubble('I need a command to run.');
      return;
    }
    const { command, args } = parsed;
    const verdict = classifyCommand(command);
    if (verdict === 'denied') {
      setChatBubble(`I won't run "${command}" — it's on the denylist.`);
      playGesture('shake');
      return;
    }
    const execute = () => {
      setAmbient(null);
      setChatBubble(`Running \`${command} ${args.join(' ')}\`…`);
      playGesture('typing', 4000);
      runTerminal(command, args)
        .then((res) => {
          const out = (res.stdout || res.stderr || '(no output)').trim();
          const tail = out.length > 900 ? `…${out.slice(-900)}` : out;
          // Render as a code card (RichMessage) — monospace + copy button.
          const fenced = `\`\`\`shell\n${tail}\n\`\`\``;
          setChatBubble(res.exitCode === 0 ? fenced : `**Exit ${res.exitCode ?? '?'}**\n${fenced}`);
          playGesture(res.exitCode === 0 ? 'nod' : 'shrug');
        })
        .catch((err: unknown) => {
          setChatBubble(err instanceof Error ? err.message : 'Command failed.');
          playGesture('shrug');
        });
    };
    const risky = isRiskyInvocation(command, args);
    if (verdict === 'auto' && !risky) {
      execute(); // autopilot — the decided model
      return;
    }
    setChatBubble(null);
    setAmbient({
      text: `Run \`${command} ${args.join(' ')}\`?${risky ? ' (looks risky)' : ''}`,
      action: {
        label: 'Run it',
        onConfirm: execute,
        onDeny: () => {
          setAmbient(null);
          setChatBubble('Okay, not running it.');
        },
      },
    });
  }, []);

  /** Image generation lane: "draw/imagine <prompt>" → inline image card. */
  const lastImagePromptRef = useRef<string>('');
  const fireImage = useCallback(
    (prompt: string) => {
      if (!auth) return;
      lastImagePromptRef.current = prompt;
      setUnreadReply(null);
      setDynamicChips([]);
      setSkillBusy(true);
      setChatBubble(`Imagining "${prompt.slice(0, 60)}"…`);
      playGesture('typing', 6000);
      generateImage(auth, prompt)
        .then(({ src }) => {
          // RichMessage renders the markdown image as a card w/ shimmer+zoom.
          setChatBubble(`![${prompt.slice(0, 80)}](${src})`);
          setDynamicChips([
            `Draw ${prompt.slice(0, 40)}, new variation`,
            `Draw ${prompt.slice(0, 36)}, more detailed`,
          ]);
          playGesture('celebrate');
        })
        .catch((err: unknown) => {
          setChatBubble(err instanceof Error ? err.message : 'Image generation failed.');
          playGesture('shrug');
        })
        .finally(() => setSkillBusy(false));
    },
    [auth],
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
    // Smart-chip labels (smartChips.ts) — every generated chip MUST map
    // to its skill here, otherwise it falls through to generic chat and
    // the model TALKS about doing the thing instead of doing it (the
    // "Analyze my screen does nothing" bug).
    'Analyze my screen': 'analyze_screen',
    'Summarize this page': 'analyze_screen',
    'Improve this paragraph': 'analyze_screen',
    'Draft a reply': 'analyze_screen',
    'Morning brief': 'morning_brief',
    'Wrap up my day': 'eod_wrap',
    'Suggest a break point': 'whats_next',
  };
  /** Prefix matches for dynamic chip text (project names vary). */
  const SKILL_CHIP_PREFIXES: Array<[RegExp, SkillId]> = [[/^Where was I on /i, 'catch_up']];
  const quickReply = auth
    ? (text: string) => {
        setAmbient(null);
        // Learning loop: tapping a quick reply = engagement with the last
        // proactive suggestion's category.
        if (lastSuggestionCatRef.current) {
          recordSuggestionEngaged(lastSuggestionCatRef.current);
          lastSuggestionCatRef.current = null;
        }
        // Learning loop: persist durable preferences/corrections.
        maybeLearnFromUtterance(auth, text);
        // "salute" / "dance" / "take a bow" → instant body language,
        // no LLM round-trip.
        if (tryGestureCommand(text)) return;
        // "run <command…>" / ">cmd" → local terminal lane.
        const runMatch = /^(?:run|exec|\$|>)\s+(.+)$/i.exec(text.trim());
        if (runMatch?.[1]) {
          fireTerminal(runMatch[1]);
          return;
        }
        // "draw/imagine/generate an image of …" → image lane.
        const drawMatch =
          /^(?:draw|imagine|generate (?:an? )?(?:image|picture|photo)(?: of)?)\s+(.+)$/i.exec(
            text.trim(),
          );
        if (drawMatch?.[1]) {
          fireImage(drawMatch[1]);
          return;
        }
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
        const prefix = SKILL_CHIP_PREFIXES.find(([re]) => re.test(text));
        if (prefix) {
          fireSkill(prefix[1]);
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
      data-bubble={!!bubbleText}
    >
      {/* Watching state surfaces in the right-click menu (Pause/Resume
          watching) — the always-on corner orb was visual noise the user
          asked to remove. */}
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
            onSend={(t) => {
              // Learning loop: persist durable preferences/corrections.
              if (auth) maybeLearnFromUtterance(auth, t);
              // Gesture commands ("salute", "dance"…) → instant, local.
              if (tryGestureCommand(t)) {
                setChatOpen(false);
                return;
              }
              // Skill phrases typed/tapped IN the panel run as in-thread
              // skills with live progress ("Analyze my screen" used to
              // fall through to chat and the model only TALKED about it).
              const skillHit =
                SKILL_CHIPS[t.trim()] ?? SKILL_CHIP_PREFIXES.find(([re]) => re.test(t.trim()))?.[1];
              if (skillHit) {
                fireSkill(skillHit, t.trim());
                return;
              }
              // "run <cmd…>" in chat → local terminal lane (closes the
              // panel so the result bubble is visible at the avatar).
              const m = /^(?:run|exec|\$|>)\s+(.+)$/i.exec(t.trim());
              if (m?.[1]) {
                setChatOpen(false);
                fireTerminal(m[1]);
                return;
              }
              // "draw …" → image lane (closes panel; result is a bubble card).
              const d =
                /^(?:draw|imagine|generate (?:an? )?(?:image|picture|photo)(?: of)?)\s+(.+)$/i.exec(
                  t.trim(),
                );
              if (d?.[1]) {
                setChatOpen(false);
                fireImage(d[1]);
                return;
              }
              void chat.send(t);
            }}
            onStop={chat.stop}
            onClear={chat.clear}
            onClose={() => setChatOpen(false)}
            onDragPointerDown={onBodyPointerDown}
            apiBase={auth?.apiBase}
            sessions={chat.listSessions()}
            activeSessionId={chat.activeSessionId}
            onNewSession={chat.newSession}
            onSwitchSession={chat.switchSession}
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
                apiBase={auth?.apiBase}
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
              anchor
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
                fireSkill('eod_wrap');
              }}
            >
              🌙 Wrap up my day
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
              // Toggle assistant RESPONSE language (UI stays English).
              const next: AssistantLanguage = assistantLang === 'en' ? 'ro' : 'en';
              saveAssistantLanguage(next);
              setAssistantLang(next);
              setMenu(null);
              setAmbient({
                text:
                  next === 'ro'
                    ? 'De acum răspund în română. (Interfața rămâne în engleză.)'
                    : "I'll reply in English from now on.",
              });
            }}
          >
            🌐 Language: {LANGUAGE_LABELS[assistantLang]}
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
          <button
            className="assistant-menu__item"
            onClick={() => {
              setMenu(null);
              setCalibrating(true);
            }}
          >
            📐 Calibrate feet
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
      {calibrating && <CalibrateOverlay winH={WIN_H} onClose={() => setCalibrating(false)} />}
      <audio ref={handleAudio} autoPlay playsInline />
    </div>
  );
}
