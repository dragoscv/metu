/**
 * Lightweight in-memory limits for the hub. Per-instance — single hub today.
 *
 *  - MAX_CONNECTIONS guards against unbounded socket growth (memory exhaustion).
 *  - per-IP token-bucket throttles WS handshakes to stop pre-auth flooding.
 *
 * Replace with Redis-backed buckets when we go horizontally.
 */

const MAX_CONNECTIONS = Number(process.env.HUB_MAX_CONNECTIONS ?? 10_000);
const HANDSHAKE_PER_IP = Number(process.env.HUB_HANDSHAKE_RATE ?? 30); // per minute
const WINDOW_MS = 60_000;

/**
 * Per-connection message rate. Authenticated clients still get throttled
 * to stop a compromised device from flooding `event.app`/`presence` writes
 * (each one is a DB INSERT/UPDATE).
 */
const MESSAGES_PER_CONN = Number(process.env.HUB_MSG_RATE ?? 60); // per 10s
const MESSAGE_WINDOW_MS = 10_000;

/** Max raw frame size accepted before JSON.parse. 64 KB is plenty for envelopes. */
export const MAX_FRAME_BYTES = Number(process.env.HUB_MAX_FRAME_BYTES ?? 64 * 1024);

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

export function ipFromReq(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(',')[0]!.trim();
  const real = headers['x-real-ip'];
  if (typeof real === 'string') return real;
  return 'anon';
}

export function exceedsConnectionCap(current: number): boolean {
  return current >= MAX_CONNECTIONS;
}

export function consumeHandshakeBudget(ip: string): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || b.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  b.count += 1;
  if (ipBuckets.size > 5_000) {
    // GC oldest entries to bound memory.
    for (const [k, v] of ipBuckets) {
      if (v.resetAt < now) ipBuckets.delete(k);
    }
  }
  return b.count <= HANDSHAKE_PER_IP;
}

export const HUB_LIMITS = {
  MAX_CONNECTIONS,
  HANDSHAKE_PER_IP,
  WINDOW_MS,
  MESSAGES_PER_CONN,
  MESSAGE_WINDOW_MS,
  MAX_FRAME_BYTES,
};

/**
 * Per-connection token bucket. Returns true if the message is within budget.
 * Caller passes a small mutable object to hold state across messages.
 */
export interface ConnBudget {
  count: number;
  resetAt: number;
}

export function consumeConnBudget(budget: ConnBudget): boolean {
  const now = Date.now();
  if (budget.resetAt < now) {
    budget.count = 1;
    budget.resetAt = now + MESSAGE_WINDOW_MS;
    return true;
  }
  budget.count += 1;
  return budget.count <= MESSAGES_PER_CONN;
}

export function newConnBudget(): ConnBudget {
  return { count: 0, resetAt: Date.now() + MESSAGE_WINDOW_MS };
}
