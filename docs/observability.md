# Observability — Sentry + OpenTelemetry

metu is wired for both Sentry (error tracking) and OpenTelemetry
(distributed tracing), but neither is _enabled_ by default. This is
deliberate — production-grade observability has a real cost (per-event
billing, SDK weight, ingestion latency) and the local dev loop already
has structured logs via `@metu/logger`.

This page tells you exactly what to flip to turn each on.

## Sentry

### What's already in place

- `apps/web/instrumentation.ts → maybeInitSentry()` is called on every
  Node runtime boot. It dynamically imports `@sentry/nextjs` only when
  `SENTRY_DSN` is set.
- The init call uses sane defaults: `tracesSampleRate: 0.1`,
  `beforeSend` strips Authorization headers and any field matching
  `password|secret|token` from request data.
- The structured logger (`@metu/logger`) emits JSON; if Sentry is
  installed it will pick those up via the SDK's automatic console
  integration.

### To enable

1. `@sentry/nextjs` is already installed in `apps/web` (since batch 2,
   commit `91aabe1`). The dynamic imports in `instrumentation.ts`
   (server) and `instrumentation-client.ts` (browser) stay no-ops
   until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set, so dev runs
   without an account.
2. Set the env vars (in `.env.local` for dev, in your secret store for
   production):
   ```env
   # Server (Node runtime)
   SENTRY_DSN=https://abc@o123.ingest.sentry.io/456
   SENTRY_ENVIRONMENT=production           # optional
   SENTRY_TRACES_SAMPLE_RATE=0.1           # optional, 0..1
   SENTRY_PROFILES_SAMPLE_RATE=0           # optional, 0..1
   # Client (browser) — exposed to bundle, must be NEXT_PUBLIC_*
   NEXT_PUBLIC_SENTRY_DSN=https://abc@o123.ingest.sentry.io/456
   NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
   NEXT_PUBLIC_SENTRY_REPLAY=1             # optional, enables Session Replay
   NEXT_PUBLIC_SENTRY_REPLAY_SESSION_RATE=0
   NEXT_PUBLIC_SENTRY_REPLAY_ERROR_RATE=1
   ```
   The browser DSN is typically the same as the server DSN — Sentry
   accepts both ingestion sides on one project.
3. Restart the server. On the next boot you'll see
   `{"event":"sentry.init.ok"}` in stdout. Client init runs silently on
   the first page load; verify in the Sentry UI by triggering a client
   error (e.g. paste `throw new Error('test')` in the devtools console).

### Verifying the wiring (no real DSN required)

The `/api/dev/sample-error` route (Node runtime) intentionally throws
when `?throw=1` is passed. Visit
`http://localhost:24890/api/dev/sample-error?throw=1` and confirm:

- The browser sees a 500 + JSON error envelope.
- stdout shows the `log.error('dev.sample.thrown', …)` line with the
  scrubbed stack trace.
- If `SENTRY_DSN` is set and the package is installed, an event lands
  in Sentry within ~10s.

In `NODE_ENV=production`, the route refuses to run — it's a dev-only
plumbing test.

## OpenTelemetry

### What's already in place

- The Node runtime worker in `apps/worker` and the web Inngest handler
  both wrap their long steps in `step.run('label', …)`, which Inngest
  surfaces as a span on its own internal trace UI.
- We do not currently export OTel traces to a third-party collector.

### To enable

For Cloud Run / GCP destinations:

1. `pnpm --filter @metu/web add @vercel/otel @opentelemetry/api`
2. Add to `next.config.ts`:
   ```ts
   experimental: {
     instrumentationHook: true,  // already on in Next.js 16
   }
   ```
3. Replace the `instrumentation.ts` body with the standard `@vercel/otel`
   `registerOTel({ serviceName: 'metu-web' })` after the existing
   crypto/Sentry setup.

For Honeycomb / Datadog / Grafana Cloud, follow their respective
Next.js OTel guides — the integration point is the same `register()`
function in `instrumentation.ts`.

### What to span

The high-leverage spans are already the right ones:

- Server Actions (Next.js auto-spans them).
- Inngest steps (Inngest's own UI shows them; OTel exporter is duplicate).
- Outbound HTTP — `@vercel/otel` instruments `fetch` automatically.
- DB queries — Drizzle 0.36 doesn't ship with OTel hooks; if you want
  per-query spans you'll need a manual `db.execute` wrapper.

## Logger interaction

Both Sentry and OTel respect the `@metu/logger` redaction guard. Once
`installConsoleRedactor()` runs at boot (it does in
`instrumentation.ts`), every `console.*` arg passed elsewhere in the
process — including any third-party module that breaks our convention
— gets bearer-tokens, JWTs, and `secret=` shapes scrubbed before it
reaches the SDK.

You can verify with:

```ts
console.error('failed', { authorization: 'Bearer secret123456' });
// → console.error sees: 'failed', { authorization: '[redacted]' }
```

## When to flip the switch

- **Sentry**: as soon as you have a non-trivial paying tenant. The free
  tier covers single-product launches; the value/cost ratio of seeing
  every 5xx with stack + breadcrumbs is enormous.
- **OTel**: only when you start seeing latency mysteries that the
  Inngest run viewer + Cloud Run logs can't explain. Below ~50 RPS,
  structured logs win on signal-to-noise.
