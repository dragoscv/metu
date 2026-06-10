# Bundled VRM character pack

Drop `.vrm` files here and they ship inside the companion build (Vite serves
`public/` at the app root, so `/avatars/<file>.vrm` works offline in the
Tauri webview).

## Wired slots

The avatar picker already lists these three slots
(`src/avatar/vrmPresets.ts` → `BUNDLED`):

| Slot | Expected file             |
| ---- | ------------------------- |
| Sora | `public/avatars/sora.vrm` |
| Yuki | `public/avatars/yuki.vrm` |
| Kai  | `public/avatars/kai.vrm`  |

Until a file exists, picking its slot falls back to the shader orb (the
`AvatarHost` VRM-error fallback), so empty slots are harmless.

## Adding more characters

1. Copy `mychar.vrm` into this folder.
2. Add one entry to `BUNDLED` in `src/avatar/vrmPresets.ts`:
   ```ts
   { id: 'pack-mychar', name: 'My Char', url: '/avatars/mychar.vrm' },
   ```
3. Done — it appears in Avatar → 3D avatar.

## Where to get free models (check each license!)

- **VRoid Studio** (https://vroid.com/en/studio) — make your own; you own it.
- **VRoid Hub** — filter by "Allow: Use in apps" + CC0/CC-BY conditions.
- **pixiv three-vrm samples** — already wired as the two "Sample" presets.
- **VRM Consortium samples** (https://github.com/vrm-c/vrm-specification) —
  spec sample models.

Prefer VRM 1.0 exports; VRM 0.x also loads (three-vrm handles both).
Keep files < 15 MB each to keep installer size sane.
