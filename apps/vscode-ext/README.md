# metu — VS Code extension

Two-way bridge between VS Code and your second brain.

`metu` is a Personal AI Operating System. This extension lets the metu Conductor:

- **observe** what you're editing (project, file, language) — never sends file contents
- **act** in your editor when you ask: open files, insert text, run a Copilot prompt, capture
  the current selection into your second brain
- **recall** anything from your captured notes, decisions, and timeline

Everything is gated by **autonomy ACL** — a per-tool policy you control on
`/settings/autonomy`. The default is _Ask_, which means every action waits for
your approval before running.

## Setup

1. Sign in with `metu: Sign in` (`Ctrl+Shift+P`).
   - Configure `metu.oauthClientId` for one-tap device-flow sign-in.
   - Or paste an access token from your dashboard.
2. The extension connects to the metu hub and registers as an editor device.
3. Use the keyboard shortcuts (or the `metu:` commands) to capture and recall.

## Commands

| Command                    | Default key  | What it does                                                    |
| -------------------------- | ------------ | --------------------------------------------------------------- |
| `metu: Capture selection`  | `Ctrl+Alt+M` | Send the current selection (or whole file) to your second brain |
| `metu: Recall from memory` | `Ctrl+Alt+R` | Search your memory and insert the result                        |
| `metu: Send notification`  | —            | Push a notification to your devices                             |
| `metu: Sign in`            | —            | Pair this VS Code with your metu workspace                      |
| `metu: Sign out`           | —            | Forget the access token from SecretStorage                      |

## Settings

- `metu.apiUrl` — your metu instance (default `https://app.metu.ro`)
- `metu.hubUrl` — websocket hub (default `wss://hub.metu.ro`)
- `metu.copilotBridge` — let the Conductor invoke your local Copilot (default `true`)
- `metu.oauthClientId` — OAuth client_id for device-flow pairing
- `metu.scopes` — space-separated OAuth scopes requested at sign-in

## Privacy

- File contents are **never** sent to the hub. Only project/file/language
  observations and explicit captures (with your selection) leave your machine.
- Tokens are stored in VS Code's `SecretStorage`.
- Every tool the Conductor invokes is logged in your `/audit` page.

## Links

- Web app: <https://metu.ro>
- Source: <https://github.com/metu-app/metu/tree/main/apps/vscode-ext>
- Issues: <https://github.com/metu-app/metu/issues>
