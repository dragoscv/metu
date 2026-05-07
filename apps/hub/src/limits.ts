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
};
