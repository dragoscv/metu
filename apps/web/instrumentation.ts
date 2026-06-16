/**
 * Next.js runtime instrumentation hook.
 *
 * Loaded once per server process at boot (Next.js convention). Use this to
 * register long-lived side-effect modules:
 *   - The device bridge that wires `device.*` tools to companion devices.
 *   - The crypto master-key resolver. In production the resolver consults
 *     GCP Secret Manager (when `ENCRYPTION_KEY` starts with `gcp-secret://`);
 *     in dev it falls back to inline base64. Wiring it here means a
 *     misconfigured secret fails the boot rather than the first encryption.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Patch global console first — once installed, every other module's
  // direct console.* call has its args scrubbed of bearer tokens, JWTs,
  // and `secret=...` shapes. Belt-and-braces against the structured
  // logger being bypassed.
  const { installConsoleRedactor } = await import('@metu/logger');
  installConsoleRedactor();

  // Initialize the DB client. When INSTANCE_CONNECTION_NAME is set (Vercel /
  // Cloud Run prod) this awaits the Cloud SQL Connector so the cached client
  // is ready for all subsequent sync getDb() calls. No-op fast path in dev.
  if (process.env.INSTANCE_CONNECTION_NAME) {
    const { initDb } = await import('@metu/db');
    await initDb();
  }

  // Crypto first — device-bridge doesn't need it but other modules might,
  // and an unreachable Secret Manager should fail the boot fast.
  const ref = process.env.ENCRYPTION_KEY ?? '';
  if (ref.startsWith('gcp-secret://')) {
    const [{ initCrypto }, { gcpSecretManagerKeyResolver }] = await Promise.all([
      import('@metu/ai/crypto'),
      import('@metu/integrations/secrets'),
    ]);
    await initCrypto({ resolver: gcpSecretManagerKeyResolver });
  } else if (ref) {
    // Dev / inline base64 — still call initCrypto so a malformed key fails
    // the boot rather than the first seal() call.
    const { initCrypto } = await import('@metu/ai/crypto');
    await initCrypto();
  }

  await import('./src/lib/device-bridge');

  // Optional Sentry init — guarded so the dependency stays optional. When
  // SENTRY_DSN is set, dynamically import the SDK and configure it. When
  // unset (most local-dev), this is a no-op.
  await maybeInitSentry();
}

async function maybeInitSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ '@sentry/nextjs'
    ).catch(() => null)) as { init: (opts: Record<string, unknown>) => void } | null;
    if (!Sentry?.init) {
      const { log } = await import('./src/lib/logger');
      log.warn('sentry.init.skipped', {
        reason: 'package_missing',
        hint: 'pnpm add @sentry/nextjs to enable',
      });
      return;
    }
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.METU_RELEASE_SHA,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0),
      // PII off by default — every event passes through our redactor on
      // the way in via beforeSend.
      sendDefaultPii: false,
      beforeSend(event) {
        // Strip cookies + auth headers as a last line of defence; the
        // logger redactor catches structured fields, this catches the
        // request envelope Sentry attaches automatically.
        if (event.request?.headers) {
          for (const k of Object.keys(event.request.headers)) {
            if (/cookie|auth|token|secret|key/i.test(k)) {
              event.request.headers[k] = '[redacted]';
            }
          }
        }
        return event;
      },
    });
    const { log } = await import('./src/lib/logger');
    log.info('sentry.init.ok', { env: process.env.NODE_ENV });
  } catch (err) {
    const { log } = await import('./src/lib/logger');
    log.error('sentry.init.failed', {}, err);
  }
}
