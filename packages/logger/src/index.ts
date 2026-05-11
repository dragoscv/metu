/**
 * Structured JSON logger — uniform across web, hub, worker, integrations.
 *
 * Emits one JSON line per event with timestamp, level, severity (for GCP
 * Cloud Logging), and a redacted payload. Originally lived in
 * apps/web/src/lib/logger.ts; promoted to a shared package so hub/worker
 * stop scattering `console.error('[hub]', err)` calls.
 *
 * Usage:
 *   import { log } from '@metu/logger';
 *   log.info('oauth.token.rotated', { clientId });
 *   log.warn('hub.broadcast.no_devices', { workspaceId, kinds });
 *   log.error('inngest.continuity.failed', { workspaceId, projectId }, err);
 *
 * Conventions:
 *   - Event names are dot-separated noun.verb: `module.subject.action`.
 *   - Never pass raw secrets; the REDACT_KEYS allowlist scrubs common ones.
 */

const REDACT_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'secret',
  'client_secret',
  'webhook_secret',
  'api_key',
  'apikey',
  'encryption_key',
  'iv',
  'tag',
  'ciphertext',
]);

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[depth_limit]';
  if (typeof value === 'string') return value.length > 4096 ? value.slice(0, 4096) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      cause: err.cause ? serializeError(err.cause) : undefined,
    };
  }
  return { value: String(err) };
}

function emit(level: LogLevel, event: string, fields?: Record<string, unknown>, err?: unknown) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  };
  payload.severity = level.toUpperCase();
  const line = JSON.stringify(payload);
  // eslint-disable-next-line no-console
  if (level === 'error') console.error(line);
  // eslint-disable-next-line no-console
  else if (level === 'warn') console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>, err?: unknown) =>
    emit('warn', event, fields, err),
  error: (event: string, fields?: Record<string, unknown>, err?: unknown) =>
    emit('error', event, fields, err),
};

/** Test-only access to the redactor. Not part of the public API. */
export const __internal = { redact };

/**
 * String-level secret scrubber for any text payload that flows through
 * `console.*` directly (e.g. from a third-party module we don't own).
 *
 * Designed to be cheap on the hot path: a small set of regexes, applied
 * only to strings ≤ 16 KB. Longer strings are pass-through (truncating
 * a giant blob risks corrupting structured logs).
 *
 * Patterns covered:
 *   - `Authorization: Bearer <jwt>` and `bearer <jwt>` styles.
 *   - `key=value` / `"key": "value"` for known sensitive keys.
 *   - `metu_at_*` and `metu_rt_*` first-party token shapes.
 *   - Common JWT tri-segment shape `xxx.yyy.zzz`.
 */
const SCRUB_RULES: Array<{ re: RegExp; replace: string }> = [
  // JWT shape first — header.payload.signature, each base64url. Conservative —
  // require ≥ 12 chars per segment to avoid eating short ids. Runs before
  // the generic key=value rule so a `token=<jwt>` shape gets the more
  // specific marker.
  {
    re: /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
    replace: '[redacted-jwt]',
  },
  // First-party token shape — must run before the generic bearer/key rule so
  // a `bearer metu_at_…` payload keeps the `metu_at_[redacted]` marker.
  { re: /\bmetu_(at|rt)_[A-Za-z0-9_-]+/g, replace: 'metu_$1_[redacted]' },
  {
    re: /\b(authorization|bearer)\s*[:=]?\s*(?!metu_(?:at|rt)_)[A-Za-z0-9._\-+/=]{8,}/gi,
    replace: '$1 [redacted]',
  },
  {
    re: /\b(token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|webhook[_-]?secret|client[_-]?secret|encryption[_-]?key|password)(["'\s]*[:=]\s*["']?)([^"'\s,}\[\]]{6,})/gi,
    replace: '$1$2[redacted]',
  },
];

export function scrubString(input: string): string {
  if (input.length > 16_384) return input;
  let out = input;
  for (const rule of SCRUB_RULES) out = out.replace(rule.re, rule.replace);
  return out;
}

function scrubArg(arg: unknown): unknown {
  if (typeof arg === 'string') return scrubString(arg);
  if (arg instanceof Error) {
    const wrapped = new Error(scrubString(arg.message));
    wrapped.name = arg.name;
    wrapped.stack = arg.stack ? scrubString(arg.stack) : undefined;
    return wrapped;
  }
  if (arg && typeof arg === 'object') {
    try {
      const json = JSON.stringify(arg);
      const scrubbed = scrubString(json);
      if (scrubbed === json) return arg;
      return JSON.parse(scrubbed) as unknown;
    } catch {
      return arg;
    }
  }
  return arg;
}

let _installed = false;

/**
 * Wrap the global `console` so direct calls (including from third-party
 * code) get their args scrubbed of common secret shapes before emission.
 *
 * Idempotent: safe to call multiple times. Returns true the first time it
 * actually patches.
 */
export function installConsoleRedactor(): boolean {
  if (_installed) return false;
  _installed = true;
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const m of methods) {
    const orig = console[m].bind(console);
    // eslint-disable-next-line no-console
    console[m] = ((...args: unknown[]) => {
      const safe = args.map(scrubArg);
      orig(...safe);
    }) as (typeof console)[typeof m];
  }
  return true;
}

/** Test-only: reset the install latch. */
export const __testOnlyResetConsoleRedactor = () => {
  _installed = false;
};

export { initNodeSentry } from './sentry';
