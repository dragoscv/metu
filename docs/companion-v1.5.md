# Companion v1.5 — design + opt-in matrix

> Status: planned for slice 6. Schema-side gate (`agent_policy.ollama_enabled`)
> already shipped in batch 3. Rust modules land in subsequent batches.

## Goal

Layer five new device-side capabilities on top of the v1 companion
(quick-capture / tray / OAuth-paired / native notifications). Each one
amplifies the supervised-loop signal **without** turning the companion
into a generic spyware client.

## Capability matrix

| Capability     | Crate               | Default | Workspace gate                | Per-call gate           | Local-only data    |
| -------------- | ------------------- | ------- | ----------------------------- | ----------------------- | ------------------ |
| Active-window  | `active-win-pos-rs` | off     | `agent_policy.tracking_level` | redaction rules         | titles → SQLite    |
| Clipboard ring | `arboard`           | off     | none                          | "remember this" promote | SQLite ring 256    |
| File watcher   | `notify`            | off     | none                          | folder allowlist        | events only        |
| Wake-word      | `pv_porcupine`      | off     | none                          | confirm transcript      | audio never leaves |
| Ollama bridge  | `tokio-tungstenite` | off     | `agent_policy.ollama_enabled` | tool ACL                | n/a                |

All five capabilities default to **off**. There is no companion install
flow that flips any of them on automatically.

## Active-window tracking

Goal: emit `device.window_changed` envelopes so the conductor can
correlate context ("you were in VS Code, then in Slack, then closed
both — pick up the slack thread when you're back").

Redaction strategy is **belt and braces** (per round-3 decision):

1. **Allowlist of process names** that emit titles in plain text:
   `code`, `Code.exe`, `WindowsTerminal`, `chrome`, `firefox`,
   `figma`, `slack`, `obsidian`, `notion`. Anything not on the list
   reports `app=…` only with title redacted.
2. **Denylist of patterns** (case-insensitive substring match)
   blocked even on allowlisted apps: `password`, `1password`,
   `bitwarden`, `bank`, `incognito`, `private`, `signin`, `auth`.

The companion ships a settings page that lets the user edit both lists
locally. Defaults baked into the binary; overrides live in the
SQLite store.

## Clipboard ring

256-entry rolling buffer in SQLite. Items expire after 24h or when
ring-evicted. The user can right-click an entry → "Remember this" to
promote it to a `capture` (kind=text, source=clipboard).

No autoupload. The ring lives entirely on device.

## File watcher

Watches user-chosen folders (mandatory consent UI). Emits
`device.file_changed` envelopes with path + mtime. **Never** ships file
contents over the wire — the conductor can ASK for content via
`tool.invoke { kind: 'device.read_file', path }` which the companion
prompts the user to approve.

## Wake-word

Porcupine custom keyword "hey metu" runs entirely locally. On match:

1. Record up to 10s of audio.
2. Show a desktop notification with the recording waveform and
   transcript (via on-device whisper-tiny if the user installs it,
   else upload to `/api/voice/transcribe`).
3. The transcript is shown to the user **before** any cloud call.
4. User confirms → transcript becomes a capture; declines → audio is
   discarded.

Audio never leaves the device until step 4 is confirmed.

## Ollama bridge

See [ADR 001](./adr/001-ollama-bridge-security.md). Three-layer gate:

1. Workspace flag (`agent_policy.ollama_enabled`).
2. Companion device toggle (capability flag in WS handshake).
3. Per-call `tool_call` row with kind=`device.ollama_invoke`.

## Telemetry / observability

Each capability writes a `device_event` (append-only) when it triggers

- a corresponding `timeline_event` when something user-visible happens.
  This means the audit page (`/dashboard/devices/<id>/log`) is the
  authoritative "what did the companion do" trail.
