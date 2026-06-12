/**
 * Dev-only smoke route for the observability stack.
 *
 * - `?throw=1` — raises an Error so you can see how it surfaces in stdout
 *   (via the structured logger) and Sentry (when configured).
 * - `?warn=1` — emits a warn-level log line carrying a fake bearer token
 *   to confirm the redactor scrubs it.
 * - default — returns a small JSON pong with the runtime + redactor status.
 *
 * Refuses to run in production. This is plumbing, not a feature.
 */
import { log } from '@/lib/logger';

export function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ ok: false, error: 'disabled_in_production' }, { status: 404 });
  }

  const url = new URL(req.url);

  if (url.searchParams.get('warn') === '1') {
    log.warn('dev.sample.redaction', {
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload-12345.signature-67890',
      apiKey: 'metu_at_abcdef1234567890',
      note: 'check stdout — both fields above should be [redacted]',
    });
    return Response.json({ ok: true, emitted: 'warn' });
  }

  if (url.searchParams.get('throw') === '1') {
    const err = new Error('dev.sample.thrown — intentional, ignore');
    log.error('dev.sample.thrown', { route: '/api/dev/sample-error' }, err);
    throw err;
  }

  return Response.json({
    ok: true,
    runtime: process.env.NEXT_RUNTIME ?? 'unknown',
    sentry: Boolean(process.env.SENTRY_DSN),
    hint: 'Append ?throw=1 to test error path, ?warn=1 to test redactor.',
  });
}
