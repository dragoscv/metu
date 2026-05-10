# @metu/browser-ext

## 0.2.0 — 2026-05-10

### Added

- Right-click → "Capture into metu" submenu with project picker (Inbox + top-8 active projects by momentum, refreshed via `/api/sdk/v1/projects`).
- WebStore-ready packaging via `pnpm browser-ext:package` / `:prod` — emits a deterministic ZIP with rasterized icons (16/32/48/128) and SHA-256 sidecar.
- `icons` + `action.default_icon` declared in `manifest.json` (required by Chrome Web Store).

### Changed

- `--prod` packaging strips `http://localhost/*` from `host_permissions` and warns if `popup.js` still references localhost.
