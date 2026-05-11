# notai

> A note-taking app where every save flows into your metu second brain.

`notai` is the reference third-party SDK consumer. It demonstrates the full
loop you'd build for any external app:

1. Sign in with metu via OAuth2/OIDC.
2. Read & write app data through metu's SDK.
3. Mirror app artifacts into metu memory so they show up in recall, the
   conductor, and the dashboards.

## Architecture

```
┌─────────────────────┐        OIDC         ┌──────────────────────┐
│   notai (Next.js)   │  ────────────────▶  │    metu app (web)    │
│   port 24896        │  ◀──── access tok ─ │   issues OAuth2      │
│                     │                     │                      │
│  /api/auth/[...]    │                     │  /oauth/authorize    │
│  Auth.js v5         │                     │  /oauth/token        │
│  custom OIDC        │                     │  /.well-known/...    │
│  provider           │                     │                      │
└──────────┬──────────┘                     └──────────┬───────────┘
           │                                            │
           │  Bearer (metu_at_…)                        │
           │                                            │
           ▼                                            ▼
   /api/sdk/v1/notai/notes ──── upserts ──▶  notai_note table
                            └─── mirrors ──▶  capture (metu memory)
                                          ──▶ timeline_event
                                          ──▶ conductor/observe
```

## Data model

Two tables in metu's Postgres (no separate DB):

- `notai_folder` — optional grouping, scoped by `(workspace_id, user_id)`.
- `notai_note` — the actual notes (`title`, `body` markdown, `pinned`).
  - `last_synced_capture_id` back-links to the capture row this note was
    last mirrored into. We update-in-place on subsequent saves to avoid
    cluttering the brain dump with duplicates.

Soft delete via `deleted_at`. Tenancy is enforced at the query layer:
both `workspace_id` AND `user_id` are required filters because notai
notes are personal even within a shared workspace.

## Sync model

When the user saves a note:

1. `PUT /api/sdk/v1/notai/notes?id=…` updates `notai_note`.
2. Same handler upserts a `capture` row:
   - First save → `INSERT capture`, set `notai_note.last_synced_capture_id`.
   - Later saves → `UPDATE capture SET content = …` for the linked row.
3. A `timeline_event` is written and `conductor/observe` is fired so the
   conductor agent sees the change like any other surface.

This means the same content lives in two places: the canonical edit
target (`notai_note`) and the recall index (`capture`). The capture is a
projection — never edited directly. If a note is hard-deleted, the
linked capture stays around as a historical artifact (consistent with
metu's "memory is append-only" stance).

## Auth scopes

The notai OAuth client requests:

- `openid profile email` — identity
- `capture:write` — create notes (server side mirrors to capture)
- `recall:read` — load notes list & future search
- `notify:write` — send notifications back into metu
- `events:write` — emit `app/*` events into the conductor

## Local dev

```pwsh
pnpm --filter @metu/notai dev   # http://localhost:24896
```

Both `apps/web` (port 24890) and `apps/notai` need to be running.
