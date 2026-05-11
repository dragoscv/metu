# ADR 001 — Companion-side Ollama bridge security model

## Status

Accepted (slice 6 prep). Implementation lands with the companion v1.5
release. Schema gate already added: `agent_policy.ollama_enabled`
(default `false`). Migration `0023_agent_policy_ollama.sql`.

## Context

The companion (Tauri 2 desktop) can expose the user's local Ollama
instance (`http://localhost:11434`) to the metu cloud over a WS tunnel
so cloud workflows can route `getModel({ intent })` through a local
model when the user is offline-first or wants to keep specific data on
device.

This is a powerful capability and a large blast radius:

- A cloud workflow that picks the local model can exfiltrate the
  prompt content **out of the user's machine** to the model and back —
  the user already trusts the prompt, so this is fine — but the inverse
  is also true: the model output flows **into** cloud logs and
  storage.
- A compromised metu account or a misconfigured tool ACL could route
  every conductor tick through the device, draining its resources or
  using it as a side channel.
- Some users will pair multiple devices; the bridge must clearly
  identify which device's Ollama is serving a given call.

## Decision

The bridge is gated at **three** independent layers:

1. **Workspace gate** (`agent_policy.ollama_enabled`, default `false`).
   When `false`, the conductor's model resolver MUST refuse to route
   any call through a connected device. Flipping it on is an explicit
   "I trust local inference for this workspace" decision the owner
   makes in `/settings/autonomy`.

2. **Device opt-in** (companion capability flag). The companion exposes
   a "Allow metu to use this machine's Ollama" toggle in its settings;
   when off, the device WS handler refuses `tool.invoke {kind: 'ollama'}`
   envelopes. The toggle defaults to **off** even if the workspace flag
   is on.

3. **Per-call audit** (existing `tool_call` row). Every routed call
   writes a `tool_call` with kind=`device.ollama_invoke`, deviceId, the
   model name, and a redacted prompt summary. No raw prompts are
   stored. Surfaced in `/dashboard/tool-calls`.

## Consequences

- The default is "off" at all three layers — paranoid by design.
- Turning the bridge on takes three explicit user actions across two
  surfaces. Annoying for a single dev; correct for everyone else.
- The conductor planner will pick a cloud model whenever the bridge is
  off, transparently. No silent failure path.
- We do NOT support routing **anonymous** or **third-party-app** calls
  through the device — the OAuth scope `device.ollama_invoke` is
  first-party only, never granted to non-metu apps.

## Alternatives considered

- **Per-call user approval (modal each invocation)**: too disruptive
  for the supervised loop. Approved tools must run promptly.
- **Per-session approval**: doesn't compose with conductor durability
  (sessions can outlive a single browser tab).
- **No gate** (just a connected device implicitly opts in): unsafe
  default; one curl-leaked OAuth token would expose a local model.

## Follow-ups

- Companion implementation: `apps/companion/src-tauri` Rust module +
  capability + settings toggle.
- Web settings page: add toggle that flips `agent_policy.ollama_enabled`
  via a server action.
- Planner: when `ollama_enabled === true` AND a `companion_desktop`
  device is online with the capability flag, surface its model name in
  the BYOK provider mesh as a selectable provider id.
