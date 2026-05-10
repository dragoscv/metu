/**
 * Client-side instrumentation (Sentry browser bundle).
 *
 * Next.js convention: `apps/web/instrumentation-client.ts` is loaded once
 * in the browser. Mirrors the server-side guarded init in
 * `instrumentation.ts` — Sentry is an optional peer; if the package is
 * not installed or `NEXT_PUBLIC_SENTRY_DSN` is unset, this file is a
 * no-op.
 */
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer
    const Sentry = (await import('@sentry/nextjs').catch(() => null)) as {
      init: (opts: Record<string, unknown>) => void;
      replayIntegration?: () => unknown;
      browserTracingIntegration?: () => unknown;
    } | null;
    if (!Sentry?.init) return;
    const integrations: unknown[] = [];
    if (Sentry.browserTracingIntegration) integrations.push(Sentry.browserTracingIntegration());
    if (Sentry.replayIntegration && process.env.NEXT_PUBLIC_SENTRY_REPLAY === '1') {
      integrations.push(Sentry.replayIntegration());
    }
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.NEXT_PUBLIC_METU_RELEASE_SHA,
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_RATE ?? 0),
      replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ERROR_RATE ?? 0),
      integrations,
      sendDefaultPii: false,
    });
  } catch {
    // Fail-soft: client observability must never break the app.
  }
}

// Required by Next.js 16 client instrumentation contract — fires on every
// nav so we can attach attributes if Sentry is active.
export function onRouterTransitionStart(_href: string, _navigationType: string): void {
  // No-op when Sentry isn't loaded. If you need to thread route changes
  // into a different observability tool, do it here.
}
