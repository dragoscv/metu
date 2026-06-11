# metu agent v2 — embodied professional assistant (master plan)

Decisions (2026-06-11, with Dragos):

1. **Movement**: short distances walk; long/cross-monitor = **teleport
   morph** (dissolve → energy orb → rematerialize with skew/squash).
2. **Positioning**: debug **calibration overlay** (floor line vs feet
   line) + persisted manual fine-tune offset.
3. **Terminal agent**: allowlisted commands run on **autopilot**,
   unknown commands ask, denylist always blocked. Output streams.
4. **Brain**: extend the existing server-side **Conductor** (tools/ACL/
   audit) — companion is body/face; device bridge carries new tools.
5. **Learning V1**: preference/correction memory (pgvector recall),
   habit patterns from sense distiller, skill-outcome feedback
   (accept/dismiss adapts eagerness per category).

## Slices

### A. Body correctness (companion)

- Calibration overlay (`metu://debug-calibrate` event → draw floor +
  feet lines); `footTuneOffset` persisted in localStorage, applied in
  getFootOffsetPhysical().
- Teleport: distance > 600px or different monitor → morph out (shrink
  - skew + fade via root scale/rotation over 280ms), window jumps,
    morph in. New locomotion 'teleport-out'/'teleport-in' poses.

### B. Posture/animation catalog (metuModel)

- point (arm extended toward a screen direction, used with overlay
  highlight), wave (greeting), nod/shake (yes/no on confirmations),
  shrug (errors/refusals), celebrate (task success), typing mime
  (while terminal commands run), look-at-target (head toward
  highlight rect).

### C. Terminal tool (device bridge)

- Rust: `device_shell_exec` exists (allowlisted). Extend to a
  policy file: allowlist (auto), denylist (never), else ask.
- Core: `device.terminal_run` tool def (kind high_risk but allowlist
  short-circuits via local policy); streams output via tool.progress
  envelope (or chunked result for V1).
- Companion: typing mime while running; output into chat/bubble.

### D. Learning loops (web/core)

- `remember_preference` tool + auto-extraction: after each companion
  turn, a cheap classifier checks "did the user state a preference/
  correction?" → store via memory.remember with kind 'preference'.
- Skill outcome feedback: bubble dismiss vs engage events POST to
  /companion/observe → adjusts eagerness per suggestion category
  (stored per workspace).

## Status

- [x] A1 calibration overlay + tune offset
- [x] A2 teleport morph
- [x] B posture catalog (point/wave/nod/shake/shrug/celebrate/typing)
- [x] C terminal tool with policy
- [x] D learning loops — POST /companion/memory (preference/correction →
      workspace memory via indexMemory, recalled by the existing `recall`
      tool); local heuristic classifier (assistant/learning.ts); per-
      category suggestion outcome stats adapt the proactivity cooldown
      (dismissed categories go up to 4× quieter).
