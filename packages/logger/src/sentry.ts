/**
 * Optional Sentry init for Node-runtime services (hub, worker, mcp-server).
 *
 * Dynamic-import-guarded so `@sentry/node` is a true optional peer: the
 * package may be absent in workspaces that don't observe via Sentry,
 * and the call below silently no-ops in that case. When `SENTRY_DSN`
 * (or `service`-scoped `SENTRY_DSN_<SERVICE>`) is set AND the package is
 * installed, the SDK is initialized with our standard PII-off defaults.
 */
import { log } from './index';

type SentryNode = {
  init: (opts: Record<string, unknown>) => void;
};

export interface InitNodeSentryOptions {
  /** Human label like `'hub'`, `'worker'`, `'mcp-server'`. Tagged on every event. */
  service: string;
  /** Override the DSN env var lookup. */
  dsn?: string;
}

/**
 * Initialize `@sentry/node` if available + DSN configured. Idempotent.
 * Safe to call early in process boot.
 */
export async function initNodeSentry(opts: InitNodeSentryOptions): Promise<void> {
  const dsn =
    opts.dsn ??
    process.env[`SENTRY_DSN_${opts.service.toUpperCase().replace(/-/g, '_')}`] ??
    process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // Optional peer dep — dynamic import with bundler-ignore magic comments.
    // Module name is computed so TypeScript does not try to resolve it
    // at type-check time (the package is intentionally not installed in
    // every workspace).
    const sentryModuleName = ['@sentry', 'node'].join('/');
    const Sentry = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ sentryModuleName
    ).catch(() => null)) as SentryNode | null;
    if (!Sentry?.init) {
      log.warn('sentry.init.skipped', {
        service: opts.service,
        reason: 'package_missing',
        hint: 'pnpm add @sentry/node to enable',
      });
      return;
    }
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.METU_RELEASE_SHA,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0),
      sendDefaultPii: false,
      initialScope: { tags: { service: opts.service } },
    });
    log.info('sentry.init.ok', { service: opts.service, env: process.env.NODE_ENV });
  } catch (err) {
    log.warn(
      'sentry.init.failed',
      { service: opts.service },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
