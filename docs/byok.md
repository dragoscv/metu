# metu — BYOK (Bring Your Own Keys)

metu uses an **AI mesh**: every workspace can plug in any combination of
providers, and metu routes each _intent_ (focus reasoning, embeddings,
classification, agentic work) to the best-fit model — with automatic fallback.

## Why BYOK

1. **Sovereignty.** Your API bills, your rate limits, your terms of service.
2. **Cost control.** Use Haiku/Mini for cheap classification, Opus/GPT-5 only when needed.
3. **No vendor lock-in.** metu itself uses zero AI calls without a key.
4. **Privacy.** Keys are encrypted with **AES-256-GCM**; we never log them.

## Supported providers

| Provider       | Default model              | Best for                    |
| -------------- | -------------------------- | --------------------------- |
| `anthropic`    | claude-opus-4-5            | reasoning, focus engine     |
| `openai`       | gpt-5 / gpt-4o-mini        | embeddings, agents, vision  |
| `azure_openai` | (your deployment name)     | enterprise OpenAI           |
| `google`       | gemini-2.5-pro             | long context                |
| `vertex`       | gemini-2.5-pro             | GCP-native deployments      |
| `ollama`       | (your local model)         | offline / private dev       |
| `copilot`      | gpt-5 (via VS Code lm API) | inside the VS Code ext only |
| `custom`       | (OpenAI-compatible)        | any compatible endpoint     |

## How keys are stored

```
plaintext apiKey  ─┐
                   ├──► seal()  ──►  { ciphertext, iv, tag }
masterKey (env)   ─┘
                                          │
                                          ▼
                              providerCredential row
                              (workspaceId, provider, label, ciphertext, iv, tag, keyRef)
```

- **AES-256-GCM** with a unique 12-byte IV per credential.
- `keyRef = 'master'` in V1 — the master key lives in Vercel/Cloud Run env.
- `keyRef = 'kms:projects/.../cryptoKeys/byok-master'` in V2 — Cloud KMS-wrapped DEKs (envelope encryption). The schema already accommodates this; the upgrade is non-breaking.
- We never persist plaintext keys in logs, request bodies, traces, or backups. Keys are decrypted in-memory just-in-time, scoped to a single AI call.

## Routing & fallback

`packages/ai/src/registry.ts` defines:

```ts
DEFAULTS = {
  anthropic: { focus: 'claude-opus-4-5', classify: 'claude-haiku-4', ... },
  openai:    { embed: 'text-embedding-3-small', focus: 'gpt-5', ... },
  ...
}

FALLBACK_CHAIN = {
  focus:    ['anthropic', 'openai', 'google'],
  classify: ['anthropic', 'openai', 'google', 'ollama'],
  embed:    ['openai', 'google'],
  agent:    ['anthropic', 'openai', 'copilot'],
  ...
}
```

Resolution order:

1. **Explicit override** — caller passed `{ provider, model }`.
2. **Workspace policy** — `workspace.providerPolicy` JSONB (set in `/settings`).
3. **Workspace credential** — `providerCredential` row.
4. **Env-level key** — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
5. **Next provider in fallback chain.**
6. If nothing left → throw a typed `NoProviderConfiguredError`.

The dashboard `/settings` shows each provider with a status badge:

- **workspace** (green): credential present in DB
- **env** (amber): only the platform fallback is available
- **not configured** (subtle): unreachable

## Adding a key

`/settings` → **Add provider key (BYOK)**:

1. Pick provider.
2. Label (e.g. `personal`, `team`).
3. Paste key (input is `type=password`, never echoed).
4. For Azure: also paste the endpoint.
5. **Save credential** → server action validates with Zod, encrypts with `seal()`, upserts.

The form is a Server Action — keys never transit any client-side analytics
pipeline; they go straight from the form to the DB over Vercel's TLS.

## Copilot (VS Code)

The `copilot` provider can only be used **from the VS Code extension**, because
its models are accessed via VS Code's `lm` API which requires a logged-in user.
The extension acts as a bridge: web/worker code requests intent `agent` and, if
the workspace policy prefers `copilot`, the request is forwarded over an
authenticated channel to the active VS Code instance. Without VS Code, requests
fall back to the next provider automatically.

## Rotating a key

1. Add a **new** credential with the same provider and a new label (e.g. `personal-2`).
2. Confirm it works (recall, focus recompute).
3. Delete the old one from `/settings`.

## Operational notes

- A workspace can have multiple credentials per provider; `isDefault=1` selects the active one.
- API errors (401, 429) bubble up to a typed error and are rendered as toasts; the next provider in the chain is tried automatically for non-auth errors.
- All AI calls write a row to `agentRun` (audit log) capturing provider, model, tokens, and latency — but never the prompt body for sensitive intents.
