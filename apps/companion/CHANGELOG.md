# Changelog

All notable changes to METU Companion are documented here.
Format: [Keep a Changelog](https://keepachangelog.com), [Conventional Commits](https://www.conventionalcommits.org).

## [0.0.1] - 2026-05-06

### Features

- Initial Tauri 2 desktop shell: tray, global hotkey `Ctrl+Alt+M`, hide-to-tray, deep-link `metu://`, notification + store + shell + os plugins.
- OAuth2 device-flow pairing UI; persisted auth via `tauri-plugin-store`.
- Persistent WebSocket connection to METU hub with reconnect backoff; OS notifications on `event.notification`.

### Build

- GitHub Actions release pipeline producing per-OS installers (Windows NSIS, macOS DMG universal, Linux AppImage + .deb) on `companion-v*` tags.
