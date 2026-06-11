# Companion "Jarvis" Plan — Ambient Awareness, Purposeful Presence, Earned Autonomy

> Status: locked with Dragos 2026-06-11. This is the build order of record.
> Owner doc for the next ~6 slices of `apps/companion` + Conductor work.

## 0. Decisions (from planning session)

| Question            | Decision                                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| Awareness depth     | **Full ambient recording** — screenshots + OCR + a11y, indexed locally     |
| Understanding runs  | **Hybrid local-first** — NO local LLM for now (no Ollama on user machines); local = heuristics + Windows native OCR + UIA text; cloud (codai) does distillation/suggestions on text summaries |
| Autonomy            | **Risk-tiered envelopes + earned autonomy + session autopilot grants** (all three) |
| Proactivity         | **Switchable modes**: on-demand / context-gated / chatty — plus mood switch |
| Voice               | **Full duplex companion** (wake word, streaming STT/TTS, verbal interjections, screen-aware) |
| Avatar behavior     | **Purposeful presence** — no random wander; moves only with intent         |
| Privacy exclusions  | Password/banking auto-pause, private browsing skipped, user-editable app blocklist |
| Retention           | ~7 days raw frames/OCR; AI summaries forever                              |
| Cloud sync          | **Summaries only** — raw screen data never leaves the device              |

## 1. Architecture overview

```
┌────────────────────────── companion (Tauri) ──────────────────────────┐
│                                                                       │
│  SENSE (Rust, always-on, cheap)                                       │
│   • foreground watcher (event-driven WinEventHook, not polling)       │
│   • window geometry map (all top-level windows, z-order, monitors)    │
│   • input cadence (typing burst / idle / reading detection)           │
│   • frame sampler: focused-window screenshot every ~10s OR on switch  │
│   • Windows.Media.Ocr on sampled frames (native, no model)            │
│   • UIA text extraction of focused control (no OCR needed when avail) │
│   • privacy gate: password-field detect, private-window detect,       │
│     app blocklist → sampler pauses, indicator shows "not watching"    │
│                                                                       │
│  REMEMBER (Rust + SQLite, local-only)                                 │
│   • activity.db: frames(ts, app, title, ocr_text, hash),              │
│     sessions(app, title, start, end), fts5 index over ocr/uia text    │
│   • 7-day raw retention pruner; summaries table kept forever          │
│                                                                       │
│  UNDERSTAND (TS, periodic, cloud-cheap)                               │
│   • ActivityModel: rolling "what is Dragos doing" state machine fed   │
│     by sense events (app class, project guess, focus depth, mood)     │
│   • Distiller: every ~15min + on session end → codai turn w/ text     │
│     summary → activity_summary rows + sync to metu memory (SDK)       │
│                                                                       │
│  ACT / SPEAK (existing + upgraded)                                    │
│   • Avatar director: purposeful movement engine (dock/approach/point) │
│   • Suggestion engine: proactivity-mode-gated bubbles & voice         │
│   • Full duplex voice w/ screen context injection                     │
└───────────────┬───────────────────────────────────────────────────────┘
                │  summaries + intents only (never raw frames)
┌───────────────▼───────────────────────────────────────────────────────┐
│  metu web — Conductor v2                                              │
│   • risk-tiered action envelopes (reversibility × blast-radius score) │
│   • earned autonomy ledger (per-tool approval history → auto-promote) │
│   • session autopilot grants ("act freely for 4h / this project")     │
│   • approval batching: digest instead of per-action blocking          │
└────────────────────────────────────────────────────────────────────────┘
```

Key non-LLM tricks that make this cheap:
- **UIA first, OCR fallback**: most apps (browsers, editors, Office) expose
  text through accessibility — already wired in `a11y.rs`. OCR only for
  canvas-ish apps (games, image viewers, terminals w/o UIA).
- **Event-driven sensing**: `SetWinEventHook` for foreground/move/resize
  instead of polling; frame sampling only on change + low cadence.
- **Perceptual hash dedupe**: skip OCR when the frame barely changed.
- **Text-only cloud calls**: codai sees distilled text timelines, not
  screenshots — 100× cheaper than vision calls, and private-by-default.

## 2. Slices (build order)

### Slice A — Sense: window & activity awareness (foundation)
Rust: `sense.rs` — WinEventHook foreground/location watcher; window map
(all top-level windows + z-order + monitor); input cadence sensor
(GetLastInputInfo + keyboard hook counts only, NEVER keylogging content);
focused-window frame sampler w/ phash dedupe; Windows.Media.Ocr wrapper;
privacy gate (UIA password detect via `IsPassword`, private-window title
heuristics, blocklist in store). Events → JS via channel `metu://sense`.
SQLite `activity.db` (rusqlite, FTS5) + 7-day pruner.

### Slice B — Understand: activity model + distiller
TS: `ActivityModel` — reduces sense events to a live state: { app, appClass
(code/browser/comms/media/docs), projectGuess, focusDepth (deep/normal/idle),
sinceTs }. Project guess from window titles + known repo names. Distiller:
periodic codai call (text summary in → structured summary out), writes
summaries locally + POSTs to `/api/sdk/v1/companion/activity` (new endpoint,
summaries only). Powers "Catch me up" instantly.

### Slice C — Avatar director: purposeful presence
Replace random wander in `useAssistantBrain` with a director: states
DOCKED (home corner, calm idle) / APPROACH (has something to say — walks
toward active window edge) / POINT (existing) / RETREAT (user in deep
focus → shrink + dock) / CONVERSE (talking — faces user, full size).
Movement only ever triggered by director intents, never random. Uses the
window map to dock to real free screen space (not over content).

### Slice D — Proactivity modes + suggestion engine
Modes: `silent` (on-demand only) / `aware` (context-gated, default) /
`chatty`. Mood: reuse personality (calm/playful/quiet) — both switchable
from tray menu + right-click menu + main-window settings. Suggestion
engine: rules + ActivityModel triggers (stuck-on-error detection via OCR
of error text, long-reading detection, return-from-idle catch-up,
repeated app-switching = lost context). Each suggestion has a confidence
+ relevance gate; `aware` mode only surfaces ≥high confidence AND
focusDepth ≠ deep.

### Slice E — Conductor v2: unstick autonomy
Web side. (1) Risk envelope: score = reversibility × blast-radius;
read/draft/undoable-local → auto-run + toast w/ undo; external/irreversible
→ ask. (2) Earned autonomy ledger: per-(workspace,tool) approval streak;
N consecutive approvals → propose auto-promotion (one-click accept) to
auto_with_undo. (3) Session grants: `autonomy_grant` table (scope, expiry);
Conductor checks active grant before asking. (4) Approval batching: digest
notification listing pending asks instead of one blocking ask per action.
FORCE_ASK list (send_telegram, send_email) stays.

### Slice F — Full duplex voice + screen-aware conversation
Wake word always-on (exists), streaming STT/TTS (exists via voice pkg) —
upgrade: inject ActivityModel state + recent OCR context into companion
turn prompt so "what am I looking at?" works; barge-in (user speech
interrupts TTS — exists as interrupt, wire to VAD); verbal interjections
routed through proactivity gate (chatty mode only by default).

## 3. Privacy invariants (non-negotiable)

1. Raw frames + OCR text NEVER leave the device. Cloud sees distilled
   summaries only (`activity_summary` shape, reviewed in code).
2. Sampler hard-pauses on: password field focus, private browsing,
   blocklisted apps, explicit "stop watching" (tray + right-click).
3. Visible state: tray icon + avatar mood reflect watching/paused.
4. `activity.db` lives under app-data, OS-user-readable only; raw
   retention 7 days enforced by pruner on every launch + daily.
5. Input cadence sensor counts keystrokes per window of time — it never
   records WHICH keys (no keylogging, ever).

## 4. Current assets we build on

- `a11y.rs` (18KB): UIA tree read, find, invoke, set_value — Slice A reuses
  for text extraction; UFO²-style hybrid GUI+API action layer later.
- `spatial.rs`: monitors/cursor/foreground (polling) → upgrade to hooks.
- `screenshot.rs` + `see.rs`: one-shot capture + composition for planner.
- `windowing.rs`: list/focus/move windows.
- `sensors.rs`: (check contents — may already do idle detection).
- Native click-through autopilot (forms.rs) — v3, solid.
- Voice: wake word + STT/TTS sessions; `useVoiceSession`/`useWakeWord`.
- Conductor: policy.ts ACL (observe/ask/auto_with_undo/autopilot),
  FORCE_ASK, cost brakes — Slice E extends, doesn't replace.

## 5. Open follow-ups (later)

- Local VLM/LLM path when user hardware allows (Ollama already tunneled).
- macOS/Linux sense parity (Windows first).
- App-specific deep adapters (VS Code via extension, browser via ext —
  both already exist in repo as `apps/vscode-ext`, `apps/browser-ext`).
- Vision calls (screenshot → cloud VLM) as explicit user-invoked "look at
  my screen" rather than ambient (cost).
