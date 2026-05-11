/**
 * Lightweight rate limiting for unauthenticated/credential endpoints.
 *
 * Uses Upstash Ratelimit when `UPSTASH_REDIS_REST_URL` + token are set; falls
 * back to an in-process token bucket so dev/staging never silently disables
 * the limiter. The fallback is per-instance (not cluster-wide) and is fine
 * for local development.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Limiter = {
  limit(key: string): Promise<{ success: boolean; reset: number }>;
};

const memBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryLimiter(max: number, windowMs: number): Limiter {
  return {
    async limit(key: string) {
      const now = Date.now();
      const b = memBuckets.get(key);
      if (!b || b.resetAt < now) {
        memBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { success: true, reset: now + windowMs };
      }
      b.count += 1;
      return { success: b.count <= max, reset: b.resetAt };
    },
  };
}

function buildLimiter(prefix: string, max: number, windowSec: number): Limiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return memoryLimiter(max, windowSec * 1000);
  }
  const rl = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
    prefix,
    analytics: false,
  });
  return {
    async limit(key: string) {
      const r = await rl.limit(key);
      return { success: r.success, reset: r.reset };
    },
  };
}

const limiters: Record<string, Limiter> = {
  'oauth-token': buildLimiter('rl:oauth-token', 30, 60),
  'oauth-device': buildLimiter('rl:oauth-device', 10, 60),
  'oauth-revoke': buildLimiter('rl:oauth-revoke', 30, 60),
  // Consent + auth-code issuance is cheap, but it's a brute-forceable
  // surface (client_id enumeration, redirect_uri probing). Throttle gently.
  'oauth-authorize': buildLimiter('rl:oauth-authorize', 60, 60),
  // Streaming Conductor chat hits a paid LLM provider and can run for
  // ~120s. A single human can't reasonably start more than a few per
  // minute; cap at 20/min/user to absorb retries without enabling abuse.
  'conductor-chat': buildLimiter('rl:conductor-chat', 20, 60),
  'sdk-write': buildLimiter('rl:sdk-write', 120, 60),
  // Voice broker: minting Realtime sessions hits a paid BYOK endpoint and a
  // human can only realistically open ~1 per minute. Cap fairly tightly.
  'voice-realtime': buildLimiter('rl:voice-realtime', 5, 60),
  // Whisper transcription per push-to-talk press. Each call is a paid
  // upstream BYOK request — 30/min is plenty for human pace, low enough
  // to deter accidental loops.
  'voice-transcribe': buildLimiter('rl:voice-transcribe', 30, 60),
  // BYOK key probe — settings page button. One human pressing buttons
  // realistically peaks ~10/min; cap higher to absorb a quick scan
  // across all connected providers.
  'byok-test': buildLimiter('rl:byok-test', 30, 60),
};

export type LimiterKind = keyof typeof limiters;

/** Pull the best client identifier we have. Falls back to "anon". */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'anon';
}

/**
 * Returns a 429 Response if the limit was exceeded, else null.
 */
export async function rateLimit(kind: LimiterKind, key: string): Promise<Response | null> {
  const lim = limiters[kind];
  if (!lim) return null;
  const r = await lim.limit(key);
  if (r.success) return null;
  const retryMs = Math.max(0, r.reset - Date.now());
  return new Response(
    JSON.stringify({ ok: false, error: 'rate_limited', retry_after_ms: retryMs }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil(retryMs / 1000)),
      },
    },
  );
}
