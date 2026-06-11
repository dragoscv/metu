# metu avatar v2 — a being that lives on your screen

Decisions (2026-06-11, with Dragos):

- **Look**: humanoid robot/synthetic with personality — humanlike motion,
  clearly artificial (no uncanny valley at 200px). Interim model:
  RobotExpressive (CC0, has Idle/Walk/Run/Jump/Wave/Dance/Sitting clips).
  Custom "metu unit" model to be designed in VRoid/Blender as a follow-up —
  per-persona variants (Atlas/Iris/…) share the rig + animation set.
- **Per-persona styling later**: one base rig, palette/attachment variants.
- **Physics scope V1**: full platformer — gravity, walk on taskbar and
  window top edges, jump between platforms, climb window sides, fall when
  a platform disappears.
- **Perf**: adaptive — 60fps while moving/talking, 20fps idle/docked.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ screenWorld.ts   "what can I stand on?"                  │
│  - monitors → floor = work-area bottom (taskbar top)     │
│  - window map (device_list_windows, 1Hz) → platforms     │
│    (top edges) + walls (left/right edges)                │
│  - diffing: platform vanished under feet → fall          │
└────────────────────────┬─────────────────────────────────┘
                         │ platforms/walls (physical px)
┌────────────────────────▼─────────────────────────────────┐
│ avatarPhysics.ts   tiny platformer integrator            │
│  states: grounded | walking | jumping | falling |        │
│          climbing | idle                                 │
│  - gravity (px/s²), jump impulse, walk speed             │
│  - the WINDOW is the body: physics moves the assistant   │
│    window so the character's feet line up with the       │
│    platform (feet anchor = bottom-center of window)      │
│  - climb: when walking into a wall, latch + ascend       │
└────────────────────────┬─────────────────────────────────┘
                         │ position + locomotion state
┌────────────────────────▼─────────────────────────────────┐
│ useAssistantBrain (director v2)                          │
│  intents (dock/approach/point) become NAV GOALS:         │
│  navigate(target) = walk along floor → jump/climb up     │
│  platform chain → arrive. Personality modulates          │
│  walk speed & jump enthusiasm.                           │
└────────────────────────┬─────────────────────────────────┘
                         │ AvatarState + locomotion
┌────────────────────────▼─────────────────────────────────┐
│ GlbStage v2: locomotion-aware clips                      │
│  walking→Walk, jumping→Jump, falling→Jump(frozen),       │
│  climbing→custom, idle→Idle/Wave …                       │
│  + flip (yaw) to face travel direction                   │
└──────────────────────────────────────────────────────────┘
```

## Why "window is the body"

The assistant window stays 380×560 with zone-based click-through (already
shipped). Physics moves the window; the character is rendered at the
bottom-center. No full-screen overlay → no GPU tax on the whole desktop,
no interference with other apps, and the existing interactive-zone watcher
keeps working unchanged.

## V1 deliverables (this slice)

1. `screenWorld.ts` — platform/wall extraction + 1Hz refresh + diffing.
2. `avatarPhysics.ts` — integrator with walk/jump/fall/climb.
3. Brain: glide replaced by physics navigation for dock/approach/point.
4. GlbStage: locomotion-driven clip selection + facing flip.
5. Adaptive frame budget (60fps moving / 20fps idle).

## Follow-ups

- Custom "metu unit" model (VRoid base → Blender: palette variants,
  emissive accents per persona; export VRM + retarget Mixamo walk/run/
  jump/climb via vrm-mixamo-retargeter, bake to VRMA).
- Ledge-hang + vault animations; squash-and-stretch on landing.
- Footstep/landing micro-SFX (optional, off by default).
- Mouse-cursor curiosity (watch cursor when idle; duck when window dragged
  over it).
