# metu — Personal AI Operating System

> **External RAM for AI-native founders.** A digital second brain that externalizes executive function, prioritizes ruthlessly, and keeps context alive across projects, devices, and time.

Not another chatbot. Not another todo app. **metu** is an ambient intelligence layer that knows your projects, energy, decisions, and momentum — and tells you what _not_ to do as much as what to do next.

---

## What's in the box

| Surface                | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Web** (Next.js 16)   | Mission-control dashboard — _What matters now_, Projects, Brain Dump, Focus Engine |
| **Mobile** (Expo)      | Capture-first: voice notes, screenshots, brain dumps from anywhere                 |
| **Worker** (Cloud Run) | Heavy lifts — transcription, embeddings, agentic chains, integration sync          |
| **MCP server**         | Exposes your memory/projects to any MCP client (Claude, Copilot, Cursor)           |
| **VS Code ext**        | Two-way bridge — repo awareness, decision logging, agent launch                    |
| **Browser ext**        | Capture tabs, highlights, AI search across your second brain                       |

## The Four Engines

1. **Memory Engine** — episodic + semantic + timeline memory over Postgres + pgvector. Every commit, message, voice note, decision indexed.
2. **Project Intelligence** — per-project state: stack, decisions, blockers, revenue potential, last-touched, momentum score.
3. **Focus Engine** — strategic prioritizer that _reduces the decision space_. Tells you which 3 projects to ignore this week.
4. **Context Continuity** — pick up where you left off after 3 days, 3 weeks, 3 months. Decision logs, repo state snapshots, conversation indexing.

## Multi-provider AI (BYOK)

Switch between providers per-task, OpenClaw-style:

- **GitHub Copilot** (via VS Code language model API in the extension)
- **Anthropic Claude** (default for agentic/coding)
- **OpenAI / Azure OpenAI** (your Azure resources)
- **Google Vertex / Gemini** (your GCP project)
- **Local** (Ollama for privacy-sensitive embeddings)

Credentials encrypted per-workspace with envelope encryption (KMS).

## Quick start

```powershell
pnpm install
cp .env.example .env.local           # fill in secrets
pnpm db:push                          # apply Drizzle schema to Neon
pnpm dev                              # turbo runs web, worker, mcp-server in parallel
```

See [docs/development.md](docs/development.md) for full setup, [docs/deployment.md](docs/deployment.md) for production.

## Stack

Next.js 16 · React 19.2 · TypeScript 5.9 · Drizzle · Neon Postgres + pgvector · Auth.js v5 · Tailwind v4 · shadcn/ui · Framer Motion · Zod v4 · Vercel AI SDK · Inngest · Upstash Redis · Expo · Turborepo · pnpm catalogs · Terraform · GCP (Cloud Run, GCS, Secret Manager) · Vercel.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design, data flow, and security model.

## Repository layout

```
metu/
├── apps/
│   ├── web/             # Next.js 16 — dashboard, brain dump, projects
│   ├── mobile/          # Expo — capture, dashboard
│   ├── worker/          # Cloud Run — transcription, embeddings, agents
│   ├── mcp-server/      # MCP server exposing memory tools
│   ├── vscode-ext/      # VS Code extension
│   └── browser-ext/     # Chrome/Edge MV3 extension
├── packages/
│   ├── db/              # Drizzle schema + migrations + queries
│   ├── auth/            # Auth.js v5 config (Google + multi-tenant)
│   ├── ai/              # Multi-provider AI SDK abstraction + BYOK
│   ├── core/            # Memory engine, prioritizer, context restore
│   ├── ui/              # shadcn/ui + animated primitives
│   ├── integrations/    # GitHub, Google, Telegram, Stripe, Vercel adapters
│   ├── types/           # Shared TS types + Zod schemas
│   └── config/          # Shared tsconfig, eslint, prettier
├── infra/terraform/     # GCP infra as code
└── docs/                # Architecture, deployment, integrations
```

## License

Private. © Dragos Catalin Vladulescu.
