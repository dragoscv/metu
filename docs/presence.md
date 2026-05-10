# Presence — on-device AI character system

> "After 3 days, 3 weeks, or 3 months metu knows where I left off."
> Presence is metu's **face**, **voice**, and **hands** on the user's devices.

This document is the contract. Every slice below ships against it.

---

## 1. Vision

metu's web app already runs the **Conductor** agent (memory, planning, tools,
ACL). Presence brings the Conductor onto the user's _devices_:

- **Voice you can talk to** in real time, full barge-in, low latency.
- **A character you can see** four visual forms (panel + orb, in-window,
  full-screen HUD, true desktop pet) chosen per-persona, hot-swappable, multiple
  on screen at once.
- **Hands on the OS** screenshots, active-window context, accessibility tree,
  synthetic input, file/clipboard/shell — every action gated by the existing
  `runTool` ACL.
- **Multiple personas** distinct named characters (Atlas / Iris / Mira / Echo
  / Minimal) + custom slot. Each has a persona prompt, voice, avatar, default
  ACL, and surface preferences.
- **One brain, many surfaces** desktop companion (full power), mobile (voice
  - always-on wake word), VS Code ext (chat + Copilot bridge), web (talking
    Conductor in browser). All share the same persona registry, same memory,
    same provider mesh.

---

## 2. Decisions ledger (locked, do not relitigate)

| #   | Decision                     | Choice                                                                                                                                                                                                    |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | First surfaces               | Companion + Mobile in parallel                                                                                                                                                                            |
| D2  | Visual forms (v1)            | All four (panel+orb, in-window, full-screen HUD, desktop pet) + manager                                                                                                                                   |
| D3  | Persona system               | 5 curated built-ins (Atlas / Iris / Mira / Echo / Minimal) + custom                                                                                                                                       |
| D4  | Voice tier                   | Hybrid (Realtime preferred → pipeline → local offline)                                                                                                                                                    |
| D5  | Realtime transport           | WebRTC for client, WebSocket fallback through hub                                                                                                                                                         |
| D6  | Default Realtime model       | `gpt-realtime-mini`, escalate on demand                                                                                                                                                                   |
| D7  | TTS providers                | Cartesia Sonic-Turbo + ElevenLabs + Deepgram Aura (persona picks)                                                                                                                                         |
| D8  | STT providers                | Deepgram Nova-3 + Whisper-1 + gpt-4o-mini-transcribe + local whisper.cpp (user picks)                                                                                                                     |
| D9  | Wake word                    | openWakeWord (MIT, on-device, custom words per persona)                                                                                                                                                   |
| D10 | Activation                   | Hotkey default + optional wake word per persona                                                                                                                                                           |
| D11 | Vision capabilities          | Screenshot, active-window context, continuous opt-in observation, webcam, clipboard r/w, mic, accessibility tree                                                                                          |
| D12 | OS actions                   | Open apps/URLs/files, type/paste, window mgmt, allowlisted shell, FS in user folders, synthetic input, media keys, OS dialogs                                                                             |
| D13 | OS-control Rust crates       | `enigo` + `tauri-plugin-screenshots` + `clipboard-manager` + `fs` + `shell` + `window-state` + `positioner` + `autostart` + `updater` + per-OS accessibility (`uiautomation` / `accessibility` / `atspi`) |
| D14 | Default ACL for device tools | `ask` (every action confirmed)                                                                                                                                                                            |
| D15 | Settings mutability          | Yes, `ask` mode (each settings change confirmed)                                                                                                                                                          |
| D16 | Screen-content privacy       | No filtering (user responsibility) — surface a clear UI badge while observing                                                                                                                             |
| D17 | Sensory persistence          | Configurable per-kind; **default = local ring buffer (24h on device)** for context awareness                                                                                                              |
| D18 | Mobile scope                 | Voice + chat + push + capture + always-listening on-device wake word                                                                                                                                      |
| D19 | Barge-in                     | Yes, full (Realtime + pipeline)                                                                                                                                                                           |
| D20 | Package shape                | New `packages/presence` (persona, characters) + `packages/voice` (provider mesh)                                                                                                                          |
| D21 | Billing                      | BYOK only for v1, revisit credits later                                                                                                                                                                   |
| D22 | Persona naming               | Distinct named characters (Atlas / Iris / Mira / Echo / Minimal)                                                                                                                                          |
| D23 | Existing AI mesh reuse       | All connected providers from `packages/ai` available everywhere — including the GitHub Copilot proxy. Configure once in web, use everywhere.                                                              |
| D24 | Platform priority            | Windows + macOS + Linux all v1                                                                                                                                                                            |

---

## 3. Architecture (one diagram in words)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          metu web (apps/web)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │  Conductor   │  │ Persona Mgr  │  │ Provider Mesh (packages/ai + │   │
│  │  + runTool() │  │ (CRUD per WS)│  │  packages/voice)             │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────────┘   │
│         │                 │                     │                       │
│         │            persona events       BYOK creds (sealed)           │
└─────────┼─────────────────┼─────────────────────┼───────────────────────┘
          │                 │                     │
   ToolCall (audited)   pushed to devices    presigned voice tokens
          │                 │                     │
          ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       apps/hub (WebSocket gateway)                      │
│  Routes tool.invoke / persona.update / voice.token to the right device  │
└─────────────────────────────────────────────────────────────────────────┘
          │                                       │
          ▼                                       ▼
┌────────────────────────────┐         ┌──────────────────────────────┐
│  apps/companion (Tauri)    │         │  apps/mobile (Expo)          │
│  ┌──────────────────────┐  │         │  ┌────────────────────────┐  │
│  │  packages/presence   │  │         │  │  packages/presence     │  │
│  │  • PersonaRuntime    │  │         │  │  (mobile build flag)   │  │
│  │  • Forms: panel/orb, │  │         │  │  • voice push-to-talk  │  │
│  │    in-window, HUD,   │  │         │  │  • wake word always on │  │
│  │    desktop pet       │  │         │  │  • notifications       │  │
│  │  • Voice loop        │  │         │  └────────────────────────┘  │
│  └──────────┬───────────┘  │         └──────────────────────────────┘
│             │              │
│  ┌──────────▼───────────┐  │
│  │  packages/voice      │  │  ←─── WebRTC direct to OpenAI Realtime
│  │  • realtime adapters │  │       (token brokered by web)
│  │  • STT adapters x4   │  │
│  │  • TTS adapters x3   │  │  ←─── Pipeline path: STT → LLM → TTS
│  │  • wake word         │  │
│  │  • VAD + barge-in    │  │
│  └──────────┬───────────┘  │
│             │              │
│  ┌──────────▼───────────┐  │  ┌──────────────────────────┐
│  │  Rust device layer   │◄─┼──│  device.* tool family    │
│  │  (Tauri commands)    │  │  │  registered in           │
│  │  • screenshot        │  │  │  packages/core/agent     │
│  │  • enigo input       │  │  │  via runTool(...) gated  │
│  │  • a11y tree         │  │  │  by ACL                  │
│  │  • clipboard / fs    │  │  └──────────────────────────┘
│  │  • shell allowlist   │  │
│  └──────────────────────┘  │
└────────────────────────────┘
```

**Key flow** (voice + tool):

1. User taps mic in panel/orb (or says wake word).
2. `packages/voice` opens WebRTC to OpenAI Realtime (token from
   `POST /api/voice/realtime/session` brokered by web with sealed BYOK key).
3. Audio streams up; transcript + audio comes back; barge-in handled by
   Realtime API. `presence` syncs lip/state to character form.
4. Model emits a tool call (`device.screenshot`, `device.open_url`, ...).
5. Tool routes through web `runTool()` → ACL check → `hubBroadcast` →
   companion receives `tool.invoke` → executes locally via Rust →
   sends `tool.result` back → audit row stored → result fed to model.
6. Sensory data (screenshot, audio) lands in **local ring buffer** by default;
   only persists to Conductor memory if user/agent calls `capture` tool.

---

## 4. Persona model

```ts
// packages/db/src/schema/presence.ts
type Persona = {
  id: uuid;
  workspaceId: uuid; // scoped, like everything
  slug: 'atlas' | 'iris' | 'mira' | 'echo' | 'minimal' | string;
  name: string; // "Atlas"
  description: string;
  systemPrompt: text; // persona character prompt
  // Voice
  voiceProvider: 'openai_realtime' | 'cartesia' | 'elevenlabs' | 'deepgram' | 'local';
  voiceId: string; // provider-specific voice id
  voiceTuning: jsonb; // { speed, stability, style }
  sttProvider: 'deepgram' | 'whisper-1' | 'gpt-4o-mini-transcribe' | 'local';
  // Visual
  avatarKind: 'orb' | 'portrait' | 'live2d' | 'vrm' | 'sprite';
  avatarUrl: string | null; // model file, image, or shader id
  formPrefs: {
    // which forms can host this persona
    panel: boolean;
    inWindow: boolean;
    hud: boolean;
    pet: boolean;
  };
  defaultForm: 'panel' | 'inWindow' | 'hud' | 'pet';
  // Behavior
  wakeWord: string | null; // null = hotkey only
  hotkey: string | null; // e.g. "Ctrl+Alt+A"
  proactivity: 'silent' | 'gentle' | 'active'; // when may it speak unprompted
  // ACL overrides (per-persona, layered on workspace ACL)
  aclOverrides: jsonb; // Record<toolName, AutonomyMode>
  // Lifecycle
  isBuiltIn: boolean;
  createdAt;
  updatedAt;
};

type PersonaActivation = {
  // Many personas can be active across many devices simultaneously.
  id: uuid;
  workspaceId: uuid;
  personaId: uuid;
  deviceId: uuid; // which device hosts this instance
  form: 'panel' | 'inWindow' | 'hud' | 'pet';
  position: jsonb; // { x, y, monitor } for floating forms
  startedAt;
};

type SensoryRing = {
  // Local ring buffer is on-device only; this table tracks summaries for
  // cross-device recall when the user opts to persist.
  id: uuid;
  workspaceId: uuid;
  deviceId: uuid;
  kind: 'screenshot' | 'screen_text' | 'audio_transcript' | 'window_focus' | 'clipboard';
  summary: text; // model-generated short summary
  storageKey: string | null; // null = ephemeral
  retention: 'ephemeral' | 'ring_24h' | 'persisted';
  occurredAt;
};
```

**Built-in personas (seed)**

| Slug    | Persona                            | Voice (default)    | Avatar                       | Default form |
| ------- | ---------------------------------- | ------------------ | ---------------------------- | ------------ |
| atlas   | Strategic, formal Jarvis-like      | Realtime `verse`   | Cyan orb with HUD glyphs     | hud          |
| iris    | Warm, conversational Samantha-like | Realtime `shimmer` | Pearl portrait               | panel        |
| mira    | Encouraging coach                  | Realtime `coral`   | Live2D illustrated character | pet          |
| echo    | Minimal, low-talk operator         | Cartesia Sonic     | Plain text waveform          | inWindow     |
| minimal | Text-only, no voice, no avatar     | (none)             | (none)                       | inWindow     |

---

## 5. Visual forms — scene briefs

### Form A — Floating panel + orb

```
SCENE: companion floating panel
SUBJECT      A 64px luminous orb above a 320×420 frosted-glass card
COMPOSITION  Orb centered horizontally, top of card at 1/3 vertical mark
PALETTE      Base oklch(0.12 0.04 280), accent per-persona, ivory text oklch(0.95 0.02 80)
LIGHTING     Orb has internal volumetric light + outer rim glow in persona accent
ATMOSPHERE   Card backdrop-filter blur(24px), 1px hairline border in persona accent at 8% opacity
TYPOGRAPHY   Display: Geist 18/24/600. Body: Geist 14/20/400. Mono for tool calls.
CHOREOGRAPHY 0ms card scale 0.96 → 1, 200ms orb breathes in, 500ms text streams in, 900ms settle
INTERACTION  Click orb = mute/unmute mic. Drag header = move. Hover orb = ring pulses.
TRANSITION   Window slides in from screen edge with `framer-motion` slide+fade
SOUND        Optional wake/ack chimes (cookie-gated)
ACCESSIBILITY Reduced-motion: no breath, no slide. ARIA live region for streaming text.
```

### Form B — In-window mode

Collapses Form A into the existing 380×520 companion window as a chat surface.
Same orb above the message list, same controls. Used when the user wants the
assistant docked.

### Form C — Full-screen HUD (hotkey-summoned)

```
SCENE: HUD overlay
SUBJECT      Centered 720×480 dark glass console with persona orb and large mic
COMPOSITION  Subject at exact center; rest of screen is darkened to oklch(0.05 0.02 280 / 0.65)
PALETTE      Same as Form A, +1 cyan rim light for the dark backdrop
LIGHTING     Single key light from above, rim light from behind in persona accent
ATMOSPHERE   Particles drift slowly behind console (FPS-cheap CSS gradient + blur)
TYPOGRAPHY   Display: Geist 28/36/500 for transcript, body 16/24/400
CHOREOGRAPHY Hotkey: 0ms scrim fades in (180ms ease), 100ms console scales 0.94 → 1, 300ms orb in
INTERACTION  Esc dismisses. Mic auto-armed. Hotkey to release voice = same as press.
TRANSITION   Mounted as transparent always-on-top, click-through outside console
SOUND        Soft "armed" chime
```

### Form D — Desktop pet

```
SCENE: desktop pet
SUBJECT      Persona character (Live2D first, VRM later) ~256px tall
COMPOSITION  Anchored to screen edge by default (bottom-right), can walk across
PALETTE      Persona-defined; rim light tracks the dominant screen color
LIGHTING     Soft top-down + persona rim
ATMOSPHERE   None (transparent click-through window)
TYPOGRAPHY   Speech bubble appears on speak: 14/18/500, ivory on persona-tinted glass
CHOREOGRAPHY Walks (idle 4s → walk 2s → idle), points when mentioning a window
INTERACTION  Right-click = persona menu. Click = focus + start voice.
              Drag = relocate. Double-click character = toggle voice.
TRANSITION   Spawn = scale 0 → 1 with light burst; despawn = fade
SOUND        Per-persona voice + footsteps (subtle)
ACCESSIBILITY Toggle to disable motion entirely; static badge mode.
```

**Click-through implementation:** transparent always-on-top window, JS sends a
polygonal hit region (just the character bbox) via a Rust command using
`set_ignore_cursor_events(true|false)` toggled by mousemove + alpha test.

---

## 6. Voice provider mesh (`packages/voice`)

Single interface, swappable adapters. Persona declares preference; runtime
falls back if BYOK key absent.

```ts
// packages/voice/src/types.ts
export interface VoiceSession {
  start(opts: VoiceSessionOpts): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  /** Server-side or model-side push-to-stop for barge-in. */
  interrupt(): void;
  on(event: 'partial' | 'final' | 'speaking' | 'tool_call' | 'error', cb): Off;
}

export interface RealtimeProvider {
  kind: 'realtime';
  open(opts): Promise<VoiceSession>;
}

export interface STTProvider {
  kind: 'stt';
  transcribeStream(opts): AsyncIterable<{ partial?: string; final?: string }>;
}

export interface TTSProvider {
  kind: 'tts';
  speak(text: string, opts): AsyncIterable<Uint8Array>; // streaming PCM/Opus
}

export interface WakeWordProvider {
  kind: 'wake';
  start(model: string, onWake: () => void): Promise<Off>;
}
```

**Adapters shipped v1:**

- `RealtimeProvider`: `openai-realtime` (WebRTC primary, WS via hub fallback)
- `STTProvider`: `deepgram-nova3`, `openai-whisper-1`, `openai-4o-mini-transcribe`, `local-whisper-cpp`
- `TTSProvider`: `cartesia-sonic-turbo`, `elevenlabs-flash`, `deepgram-aura-2`
- `WakeWordProvider`: `open-wake-word` (ONNX Runtime via `onnxruntime-web` in Tauri webview, or `ort` Rust crate for native path)

**Token brokerage:** the device never holds the user's BYOK keys. It calls
`POST /api/voice/realtime/session` (web) which opens a sealed key, mints an
ephemeral OpenAI Realtime session token (or signed Cartesia/ElevenLabs URL),
and returns it. Audit row written.

---

## 7. Device tool family (`device.*`)

All registered in `packages/core/src/agent/tools.ts` with `kind: 'device'`
(new). All default to `ask` ACL (D14). All execute by emitting `tool.invoke`
to the connected companion through `hubBroadcast` and awaiting `tool.result`.

| Tool                     | Kind  | Default ACL    | Args                                                                 | Returns                                 |
| ------------------------ | ----- | -------------- | -------------------------------------------------------------------- | --------------------------------------- |
| `device.screenshot`      | read  | ask            | `{ target: 'screen' \| 'window', windowId?, monitor? }`              | `{ storageKey, dims }`                  |
| `device.list_windows`    | read  | auto_with_undo | `{}`                                                                 | `[{ id, title, app, bounds, focused }]` |
| `device.focus_window`    | write | ask            | `{ windowId }`                                                       | `{ ok }`                                |
| `device.move_window`     | write | ask            | `{ windowId, bounds }`                                               | `{ ok }`                                |
| `device.open_url`        | write | ask            | `{ url }` (SSRF-checked)                                             | `{ ok }`                                |
| `device.open_path`       | write | ask            | `{ path }`                                                           | `{ ok }`                                |
| `device.type_text`       | write | ask            | `{ text, target?: 'focused' }`                                       | `{ ok }`                                |
| `device.send_keys`       | write | ask            | `{ keys: string[] }` (allowlisted combos)                            | `{ ok }`                                |
| `device.click`           | write | ask            | `{ x, y, button: 'left'\|'right' }`                                  | `{ ok }`                                |
| `device.clipboard_read`  | read  | ask            | `{}`                                                                 | `{ text? }`                             |
| `device.clipboard_write` | write | ask            | `{ text }`                                                           | `{ ok }`                                |
| `device.fs_read`         | read  | ask            | `{ path }` (allowlisted roots)                                       | `{ content }`                           |
| `device.fs_write`        | write | ask            | `{ path, content, mode? }` (allowlisted roots)                       | `{ ok }`                                |
| `device.shell_exec`      | write | ask            | `{ command, args[] }` (allowlist only)                               | `{ exitCode, stdout, stderr }`          |
| `device.media_key`       | write | auto_with_undo | `{ key: 'play'\|'pause'\|'next'\|'prev'\|'volup'\|'voldn'\|'mute' }` | `{ ok }`                                |
| `device.notify`          | write | auto_with_undo | `{ title, body, urgency }`                                           | `{ ok }`                                |
| `device.observe_window`  | read  | ask            | `{ windowId, durationSec }`                                          | streams `tool.partial`                  |
| `device.a11y_tree`       | read  | ask            | `{ windowId? }`                                                      | `{ tree }` (UIA/AX/AT-SPI)              |
| `device.webcam_snapshot` | read  | ask            | `{}`                                                                 | `{ storageKey }`                        |
| `device.persona_set`     | write | ask            | `{ personaId, form?, position? }`                                    | `{ ok }`                                |
| `device.settings_update` | write | ask            | `{ patch }` (Zod validated)                                          | `{ ok }`                                |

**Undo payloads** captured for window moves, clipboard writes, fs writes, and
persona changes per the existing `runTool` undo mechanism.

---

## 8. Protocol additions (`packages/protocol`)

Extend `ServerEventSchema` and `ClientEventSchema`:

```ts
// Server → device
| { type: 'tool.partial'; id: Uuid; chunk: unknown }   // for streaming tools
| { type: 'persona.activate'; activationId: Uuid; persona: Persona; form, position }
| { type: 'persona.deactivate'; activationId: Uuid }
| { type: 'voice.token';      // ephemeral session credential push
    provider: 'openai_realtime' | 'cartesia' | 'elevenlabs' | 'deepgram';
    sessionToken: string; expiresAt: Iso; ice?: RTCIceServer[] }

// Device → server
| { type: 'voice.transcript'; final?: string; partial?: string; personaId?: Uuid }
| { type: 'voice.utterance';  // model spoke (for memory)
    personaId: Uuid; text: string; durationMs: number }
| { type: 'sensory.summary'; kind, summary, storageKey?, retention }
```

Hub already routes `tool.invoke` to `companion_desktop` kinds; the new
envelopes ride the same path.

---

## 9. Capability + Cargo additions (companion)

`apps/companion/src-tauri/capabilities/default.json` — append:

```jsonc
"clipboard-manager:default",
"clipboard-manager:allow-read-text",
"clipboard-manager:allow-write-text",
"fs:default",
"fs:scope-app-data-recursive",
"fs:allow-read-text-file",
"fs:allow-write-text-file",
"http:default",
"dialog:default",
"window-state:default",
"positioner:default",
"autostart:default",
"updater:default",
"shell:allow-execute"  // command allowlist enforced at runtime by Rust
```

`apps/companion/src-tauri/Cargo.toml` — add:

```toml
tauri-plugin-clipboard-manager = "2.2"
tauri-plugin-fs = "2.2"
tauri-plugin-http = "2.2"
tauri-plugin-dialog = "2.2"
tauri-plugin-window-state = "2.2"
tauri-plugin-positioner = "2.2"
tauri-plugin-autostart = "2.2"
tauri-plugin-updater = "2.2"
tauri-plugin-screenshots = "2"     # community plugin
tauri-plugin-user-input = "0"      # community plugin (enigo + monio)
enigo = "0.3"                       # synthetic input
ort = { version = "2", features = ["ndarray"] }  # openWakeWord ONNX
[target.'cfg(windows)'.dependencies]
uiautomation = "0.16"
[target.'cfg(target_os = "macos")'.dependencies]
accessibility = "0.1"
[target.'cfg(target_os = "linux")'.dependencies]
atspi = "0.25"
```

`tauri.conf.json` — second window for HUD form (transparent, fullscreen,
always-on-top, no decorations, no taskbar) + third window for pet (transparent,
always-on-top, no decorations, click-through toggled at runtime). Updated CSP
to allow the realtime provider hosts (`https://api.openai.com`,
`wss://api.openai.com`, Cartesia, ElevenLabs, Deepgram).

---

## 10. Settings → Presence (web manager UI)

Route: `/settings/presence`

`PageHeader title="Presence" subtitle="Your AI characters and how they appear"`.

Sections (each a `PageSection`):

1. **Active personas** — grid of cards, one per active activation across
   devices. Click to edit form/position. Multi-select for "deactivate all".
2. **Personas library** — built-ins + custom. Each card shows avatar,
   voice sample (play), proactivity dial, default form. Buttons: Activate,
   Edit, Clone, Delete (custom only).
3. **Voice & wake** — global defaults: input/output device, default STT, default
   TTS, default wake word state, hotkeys.
4. **ACL & device** — table of `device.*` tools per workspace with autonomy
   mode dropdowns. Read-only audit log link (last 50 device tool calls).
5. **Sensory persistence** — per-kind retention (ephemeral / 24h ring /
   persisted). Defaults shown in D17.
6. **Provider keys** — link to existing BYOK page; surface which providers are
   ready (badges).

URL state via `nuqs`: `?tab=library&persona=atlas`.

---

## 11. Slice plan (10 slices, each a PR < 400 LOC)

| #       | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Key files                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**   | **Foundation** ✅ — spec, schema, package skeletons, protocol additions, companion capability/Cargo updates, device tool family stubs, Settings → Presence empty page. **Typecheck green, no behavior yet.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `docs/presence.md`, `packages/db/src/schema/presence.ts`, `packages/presence/*`, `packages/voice/*`, `packages/protocol/src/index.ts`, `apps/companion/src-tauri/{capabilities,Cargo}`, `packages/core/src/agent/tools.ts` (device.\* registry), `apps/web/src/app/(app)/settings/presence/page.tsx`                                                                                                                           |
| **2**   | **Persona DB seed + manager CRUD** ✅ — server actions (`seedBuiltInPersonasAction`, `createPersonaAction`, `updatePersonaAction`, `deletePersonaAction`, `listPersonas`); workspace-scoped; built-ins protected from delete; slug uniqueness with auto-suffix. Manager UI lists rows (built-ins first), edits 11 curated fields per row, creates customs, deletes customs. Per-device activations + voice/ACL editor land in 4 + 10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `apps/web/src/app/actions/personas.ts`, `apps/web/src/components/persona-manager.tsx`, `apps/web/src/app/(app)/settings/presence/page.tsx`, `packages/db/drizzle/0009_presence.sql` (applied via `pnpm db:push`)                                                                                                                                                                                                               |
| **3**   | **Companion `tool.invoke` handler + first 4 tools** ✅ web/JS — `open_url`, `open_path`, `notify`, `clipboard_read/write`. End-to-end voice-less proof. Rust plugin wiring done; awaiting `pnpm tauri:dev` smoke test on a connected companion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/web/src/lib/device-bridge.ts` (in-process pending Map), `apps/web/instrumentation.ts` (boot register), `apps/web/src/app/api/internal/hub/tool-result/route.ts` (resolver call), `packages/core/src/agent/{tools,policy,device-tools,index}.ts` (`ToolContext.toolCallId`, dispatcher registry), `apps/companion/src/state/{device-tools,useHubConnection}.ts`, `apps/companion/src-tauri/src/lib.rs` (clipboard plugin) |
| 4       | **Realtime voice (panel form)** ✅ — token broker route, WebRTC adapter, Form A panel UI, push-to-talk hotkey. First spoken interaction. Awaiting smoke test on a paired companion (requires BYOK OpenAI key).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/web/src/app/api/voice/realtime/session/route.ts`, `packages/voice/src/openai-realtime.ts` (subpath export, DOM-only), `apps/companion/src/state/{useVoiceSession,usePushToTalkHotkey}.ts`, `apps/companion/src/forms/Panel.tsx`, `packages/ai/src/registry.ts` (`getProviderCredential` export), `apps/web/src/lib/ratelimit.ts` (`voice-realtime` limiter)                                                              |
| **5**   | **Pipeline voice + provider switching** ✅ — Deepgram STT (WS) + Cartesia/ElevenLabs TTS via server-proxied broker; persona-driven lane dispatch (`useVoiceSession` branches on `persona.voiceProvider`); push-to-talk via mic-track toggle; barge-in via `interrupt()` on speaking. **Voice keys via env-var fallback** (`DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `ELEVENLABS_API_KEY`); DB-backed BYOK is a slice-10 follow-up. Awaiting paired-companion smoke test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `apps/web/src/app/api/voice/{pipeline/session,pipeline/respond,tts/speak}/route.ts`, `apps/web/src/lib/voice-keys.ts`, `packages/voice/src/{deepgram,tts-proxy,pipeline}.ts` (subpath exports), `apps/companion/src/state/useVoiceSession.ts` (persona-aware dispatcher), `apps/companion/src/forms/Panel.tsx` (persona picker)                                                                                                |
| **6**   | **Screenshot + window list + a11y tree (Rust)** ✅ — `xcap`-based screen/window capture (PNG, downscaled to ≤ 1600px, base64 over WS), cross-platform window enumeration, minimum-viable a11y tree (focused/first-non-minimized window + siblings). True per-OS UIA / AX / AT-SPI element walking + reliable focus detection are slice-7+ follow-ups. Three `device.*` tools moved from `stub()` → `bridge()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/companion/src-tauri/src/{screenshot,windowing,a11y}.rs`, `apps/companion/src-tauri/src/lib.rs` (3 `#[tauri::command]` handlers), `apps/companion/src-tauri/Cargo.toml` (xcap, image, base64), `apps/companion/src-tauri/capabilities/default.json` (fs scope typo fix), `apps/companion/src/state/device-tools.ts` (3 invoke routes), `packages/core/src/agent/device-tools.ts` (3 tools → bridge)                       |
| **7**   | **Synthetic input + shell allowlist (Rust)** ✅ — `enigo`-based `type_text` / `send_keys` / `click` with bounded sizes (text ≤ 10k, keys ≤ 8) and a curated key-name allowlist (modifiers/nav/F1-F12). `shell_exec` opt-in via `METU_SHELL_ALLOWLIST` env var (comma-separated basenames; no path/metachars; 32-arg cap; 20s timeout; 64KB stdout / 16KB stderr). 4 `device.*` tools moved from `stub()` → `bridge()`. **Deferred**: `focus_window` / `move_window` (xcap doesn't expose native handles — needs per-OS HWND/AXUIElement work in slice 7b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `apps/companion/src-tauri/src/{input,shell}.rs`, `apps/companion/src-tauri/src/lib.rs` (4 `#[tauri::command]` handlers), `apps/companion/src-tauri/Cargo.toml` (enigo), `apps/companion/src/state/device-tools.ts` (4 invoke routes), `packages/core/src/agent/device-tools.ts` (4 tools → bridge)                                                                                                                             |
| **8**   | **HUD form + Pet form (companion)** ✅ — Two new Tauri windows (`hud`, `pet`) declared in `tauri.conf.json` (transparent, decorations:false, alwaysOnTop, skipTaskbar, hidden by default). Single Vite bundle drives all three windows via URL hash routing in `main.tsx` (`#hud` / `#pet`). HUD: full-screen scrim + centred 720px console with breathing persona orb, live transcript, persona switcher, Esc/scrim-click dismiss, mic auto-arm. Pet: 280×340 transparent window with CSS orb body + speech bubble + drag region; `presence_pet_set_clickthrough` flips `set_ignore_cursor_events` on hover so transparent margin passes clicks through. Global hotkey `Ctrl+Alt+Space` toggles HUD. Live2D loader stubbed in `Pet.tsx` (TODO comment) — `pixi-live2d-display` lazy import lands when `persona.avatarKind==='live2d'` (slice 8b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `apps/companion/src-tauri/tauri.conf.json` (windows[]), `apps/companion/src-tauri/src/forms.rs` (6 commands), `apps/companion/src-tauri/src/lib.rs` (handlers + hotkey), `apps/companion/src/main.tsx` (hash router), `apps/companion/src/forms/{Hud,Pet}.tsx`, `apps/companion/src/styles.css` (HUD + Pet styles)                                                                                                             |
| **9**   | **Mobile presence** ✅ — Bearer-protected SDK trio: `POST /api/sdk/v1/presence/transcribe` (multipart audio → Deepgram Nova-3), `POST /api/sdk/v1/presence/respond` (NDJSON LLM stream with persona system prompt + history), `POST /api/sdk/v1/presence/speak` (Cartesia / ElevenLabs audio passthrough). New `presence:talk` scope registered in `KNOWN_SCOPES` + OIDC discovery. New `apps/mobile/app/presence.tsx` tab with persona chip switcher, push-to-talk button (expo-av record → upload → stream → playback via `Audio.Sound`), live transcript + assistant bubbles, and an always-on wake-word toggle that surfaces a "9b — native binding pending" alert (onnxruntime-react-native lands later). `lib/presence.ts` keeps the talk loop dumb so wake-word can plug in without UI rewrites. Mobile tsconfig switched to `moduleResolution: "bundler"` so workspace `exports.{".":"./src/index.ts"}` resolves.                                                                                                                                                                                                                                                                                                                                                                                                             | `apps/web/src/app/api/sdk/v1/presence/{transcribe,respond,speak}/route.ts`, `apps/mobile/app/presence.tsx`, `apps/mobile/lib/presence.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/package.json` (+ `@metu/presence`), `apps/mobile/tsconfig.json`, `packages/auth/src/oauth.ts` (KNOWN_SCOPES)                                                                                                                            |
| **10**  | **Manager polish + ACL + audit + sensory ring buffer + privacy badge** ✅ — Five new sections on `/settings/presence`: (1) **Active personas** grid joined to `device` with per-row Deactivate, (2) personas library (existing manager from slice 2), (3) **Device tool ACL** editor — one row per `device.*` tool with kind/default/mode dropdown that upserts a workspace-scoped `tool_acl` row (or clears the override) using the partial unique index `(workspaceId, tool) WHERE integrationId IS NULL` via `onConflictDoUpdate({targetWhere})`, (4) **Sensory ring** viewer (last 30 rows by `occurredAt desc`) with a "Clear ephemeral now" action that deletes `retention='ring_24h'` rows older than 24h, (5) **Audit log** of the last 50 `device.*` tool calls with status colour pills + ACL mode + relative timestamps. **Privacy badge** (D16) at the top of the page polls `getPrivacyBadgeState()` every 60s — goes amber when any `personaActivation` exists or any sensory row landed in the last 5min, with the last kind + relative time inline. Server-side ACL enforcement was already wired in slice 1 via `runTool()`; this slice exposes the editor + audit visibility. **Deferred**: companion-side mirror of the privacy badge (10b), BYOK voice keys (5b), focus_window/move_window per-OS HWND work (7b). | `apps/web/src/app/actions/presence.ts` (DEVICE_TOOL_CATALOG + 7 actions), `apps/web/src/components/{presence-acl-editor,presence-audit-log,sensory-ring-viewer,privacy-badge,activations-grid}.tsx`, `apps/web/src/app/(app)/settings/presence/page.tsx` (5-section layout)                                                                                                                                                    |
| **10b** | **Companion privacy badge mirror** ✅ — New bearer-protected `GET /api/sdk/v1/presence/badge` (scope `presence:talk`) returns `{observingActivations, recentSensoryCount, lastSensoryAt, lastSensoryKind}`. New `<ObservingBadge>` companion component polls every 60s and renders a pill in the connected-shell header; goes amber (`--on`) when any persona activation exists or sensory rows landed in the last 5min. Reuses the same 5-minute window as the web badge so both surfaces agree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `apps/web/src/app/api/sdk/v1/presence/badge/route.ts`, `apps/companion/src/ui/{ObservingBadge,Connected}.tsx`, `apps/companion/src/styles.css` (.shell\_\_header / .observing-badge)                                                                                                                                                                                                                                           |
| **5b**  | **BYOK voice keys** ✅ — `aiProviderKind` pgEnum + `aiProviderSchema` zod enum extended with `'deepgram' \| 'cartesia' \| 'elevenlabs'`. `apps/web/src/lib/voice-keys.ts` rewritten async + BYOK-first: queries the workspace's most-recent default `providerCredential`, decrypts via `open()` from `@metu/ai/crypto`, falls back to the env-var trio (`DEEPGRAM_API_KEY` / `CARTESIA_API_KEY` / `ELEVENLABS_API_KEY`) on miss or decrypt failure. All 5 callers (`/api/sdk/v1/presence/{transcribe,speak}`, `/api/voice/{tts/speak,pipeline/session}`) now await it. ProviderCredential form picks up the three voice providers automatically. `MODEL_CATALOG` and `DEFAULTS` in `@metu/ai` now have empty entries for voice providers (no LLM models — they're keyed only to satisfy the `Record<AiProvider, …>` shape). Migration `0010_voice_byok.sql` added the three enum values; the local DB was patched in-place via `ALTER TYPE … ADD VALUE IF NOT EXISTS` since `aiProviderKind` is an enum (not idempotent through `drizzle-kit push` without confirmation).                                                                                                                                                                                                                                                             | `packages/db/src/schema/integrations.ts`, `packages/types/src/index.ts`, `apps/web/src/lib/voice-keys.ts`, `apps/web/src/components/provider-credential-form.tsx`, `packages/ai/src/{models,registry}.ts`, `packages/db/drizzle/0010_voice_byok.sql`                                                                                                                                                                           |
| **7b**  | **Native window focus / move (Windows)** ✅ — `windowing.rs` rewritten to use `xcap::Window::id()` (the HWND on Windows / kCGWindowNumber on macOS / X window id on Linux) as a stable opaque id rather than the enumeration index. New `focus_window` / `move_window` Rust helpers behind `#[cfg(windows)]` use the `windows` 0.56 crate (`SetForegroundWindow` + `ShowWindow(SW_RESTORE)` + `SetWindowPos`) gated by `IsWindow` validation and a 16384 px bounds clamp. macOS / Linux return `unsupported_on_platform: <os>` until AXUIElement / AT-SPI bindings land. Two new Tauri commands (`device_focus_window` / `device_move_window`), companion JS dispatcher cases, and the two `device.*` tools moved from `stub()` → `bridge()` (every `device.*` tool except `observe_window` and `webcam_snapshot` is now wired). HWND constructor in `windows` 0.56 takes `isize` directly — `HWND(raw as isize)`, not a pointer.                                                                                                                                                                                                                                                                                                                                                                                                     | `apps/companion/src-tauri/Cargo.toml` (Windows-only `windows` dep), `apps/companion/src-tauri/src/windowing.rs`, `apps/companion/src-tauri/src/lib.rs` (2 new commands + invoke_handler), `apps/companion/src/state/device-tools.ts` (2 new cases), `packages/core/src/agent/device-tools.ts` (`deviceFocusWindowTool` / `deviceMoveWindowTool` → `bridge()`)                                                                  |
| **8b**  | **Live2D pet loader** ✅ — New `<Live2DAvatar>` component lazy-imports `pixi.js` + `pixi-live2d-display`; if either is missing it logs once and falls back gracefully (returns null → Pet.tsx renders the CSS orb). When present, mounts a Cubism 4 model from `VITE_LIVE2D_MODEL_URL` and drives `ParamMouthOpenY` via a 6 Hz sine while `speaking` is true. Deps stay out of `package.json` (heavy + asset-required); enabling is a 3-step opt-in (install deps, add Cubism Core script tag, set env var) documented in the file header. Pet form picks the URL at render time and dispatches between Live2D canvas and CSS orb without any persona-row plumbing changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `apps/companion/src/ui/Live2DAvatar.tsx`, `apps/companion/src/forms/Pet.tsx` (3-step opt-in dispatch)                                                                                                                                                                                                                                                                                                                          |
| **9b**  | **Mobile wake-word loader** ✅ — New `useWakeWord(onWake)` hook lazy-imports `onnxruntime-react-native` and resolves `EXPO_PUBLIC_WAKEWORD_MODEL_URL`. If both succeed, the hook reports `available: true`, prepares an `expo-av` recording at 16 kHz mono, and exposes `start/stop`. The presence screen's wake-word switch is now disabled when `available` is false (with a "install onnxruntime-react-native + set EXPO_PUBLIC_WAKEWORD_MODEL_URL to enable" hint) and starts/stops the listener otherwise; on detection the existing talk loop's `startRecording()` fires. Real-time PCM frame access is still pending — `expo-av` doesn't expose mid-recording frames, so end-to-end wake detection requires either swapping to `expo-audio-stream` or a custom Expo native module (logged in `wake-word.ts` header). The lifecycle (session create / record / dispose) is fully wired so that follow-up only changes the inference loop.                                                                                                                                                                                                                                                                                                                                                                                       | `apps/mobile/lib/wake-word.ts`, `apps/mobile/app/presence.tsx` (drops `Alert`, instantiates hook, wires switch)                                                                                                                                                                                                                                                                                                                |
| **7c**  | **Native window focus / move (macOS + Linux)** ✅ — Pragmatic shell-out per OS so every platform either succeeds or returns an actionable error. **Linux**: `wmctrl -i -a 0xXID` (focus) and `wmctrl -i -r 0xXID -e 0,x,y,w,h` (move); the XID matches `xcap::Window::id()` exactly. Returns `wmctrl_not_installed` with install instructions if the binary is missing; X11 / XWayland required (native Wayland is intentionally out of scope — no compositor-agnostic protocol exists for foreign window placement). **macOS**: `osascript` driving System Events; the window id is looked up in `xcap` to recover the owning app name, then `tell application "<app>" to activate` (focus) or `tell process "<app>" set position/size of window 1` (move). The macOS path is best-effort: AppleScript can't address a specific window by `kCGWindowNumber`, so `focus_window` should be called before `move_window` when targeting a non-frontmost window. Errors include a hint about granting Accessibility + Automation permission. App name is escaped against quote/backslash injection. Code is `#[cfg]`-gated into `mod linux` / `mod macos`; Windows binary is unchanged from 7b (cargo check 0 warnings).                                                                                                                  | `apps/companion/src-tauri/src/windowing.rs` (per-OS `mod linux` + `mod macos` shell-out, no new Cargo deps)                                                                                                                                                                                                                                                                                                                    |

Each slice ends with: `pnpm typecheck` N/N green, `pnpm lint` 0/0, manual
verify path, and an entry appended to `/memories/repo/metu-master-decisions.md`.

---

## 12. Security notes (apply across all slices)

- All `device.*` tools route through `runTool()` — workspace scoping +
  ACL + audit row + undo payload + depth limit are inherited.
- `device.open_url` calls `assertSafeOutboundUrl()` (existing SSRF guard).
- `device.shell_exec` accepts only commands from a workspace-owned allowlist
  (stored in DB, edited only via web Settings, not via the agent itself).
- Realtime ephemeral tokens have ≤ 60s TTL, scoped to one persona/session,
  never logged.
- BYOK voice keys sealed via `@metu/ai/crypto`, opened lazily per session.
- `device.fs_*` paths normalized + jailed under user-chosen roots; symlink
  escape rejected.
- Webcam capture requires per-session user grant (not blanket ACL).
- Hotkey collisions detected; user can rebind in Settings → Presence.
- Distribution: Tauri updater enforces signature; macOS notarized; Windows
  signed; Linux AppImage with embedded signature manifest.

---

## 13. Open follow-ups (deferred past v1)

- Marketplace for community personas (Live2D / VRM models).
- Multi-modal screen understanding (e.g. SAM-2 segmentation of the focused
  window for "click that button").
- Local LLM inference for fully offline mode (Ollama integration through
  existing `packages/ai` registry).
- Cross-device persona handoff (Atlas walks from desktop to phone).
- Billing tier with managed credits.
