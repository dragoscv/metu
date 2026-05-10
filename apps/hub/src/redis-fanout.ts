/**
 * Multi-instance fanout via Upstash Redis (gated).
 *
 * The hub is single-instance today: each web → hub broadcast hits one
 * Hono server which holds every WS in memory. When we run more than one
 * hub replica behind the load balancer, an envelope arriving at instance
 * A must also reach the WebSockets connected to instance B. This module
 * is the fanout pipe.
 *
 * Implementation strategy when `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are set:
 *
 *   1. On boot, every hub instance subscribes to the channel
 *      `metu.hub.broadcast` via the Upstash SSE transport.
 *   2. `/internal/broadcast` publishes the envelope to that channel and
 *      also forwards it to its own local connections (to keep the
 *      single-instance fast path zero-latency).
 *   3. Subscribers deduplicate by envelope id so the originating
 *      instance doesn't double-deliver.
 *
 * When the env vars are absent (most local-dev), `publish()` and
 * `subscribe()` are no-ops and the registry behaves exactly as before.
 *
 * The `@upstash/redis` package is intentionally NOT pinned yet — adding
 * it requires a deploy-time decision (we'd also wire `redis://` for
 * self-hosted Upstash or for KEDA). The contract here is the stable
 * surface; the implementation lights up the moment we install the dep.
 */

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';
const CHANNEL = 'metu.hub.broadcast';

let configured: boolean | null = null;

export function isFanoutConfigured(): boolean {
  if (configured !== null) return configured;
  configured = !!(process.env[URL_ENV] && process.env[TOKEN_ENV]);
  return configured;
}

export interface FanoutEnvelope {
  /** Stable id used by subscribers to dedupe re-publishes. */
  id: string;
  /** Origin hub instance id; subscribers ignore their own publishes. */
  origin: string;
  workspaceId: string;
  kinds?: string[];
  deviceIds?: string[];
  envelope: unknown;
}

/**
 * Publish an envelope to all hub instances. Returns immediately when
 * fanout is unconfigured. Errors are swallowed to keep the local
 * delivery path unaffected by Redis hiccups.
 */
export async function publish(_msg: FanoutEnvelope): Promise<void> {
  if (!isFanoutConfigured()) return;
  // Implementation lights up when @upstash/redis is added:
  //
  //   const { Redis } = await import('@upstash/redis');
  //   const redis = new Redis({
  //     url: process.env[URL_ENV]!,
  //     token: process.env[TOKEN_ENV]!,
  //   });
  //   await redis.publish(CHANNEL, JSON.stringify(_msg));
  void CHANNEL;
}

export type FanoutHandler = (msg: FanoutEnvelope) => void;

/**
 * Subscribe to envelopes published by other hub instances. Returns an
 * unsubscribe function; no-op when fanout is unconfigured.
 */
export function subscribe(_handler: FanoutHandler): () => void {
  if (!isFanoutConfigured()) return () => {};
  // Implementation lights up when @upstash/redis is added:
  //
  //   const es = new EventSource(
  //     `${process.env[URL_ENV]}/subscribe/${CHANNEL}`,
  //     { headers: { authorization: `Bearer ${process.env[TOKEN_ENV]}` } },
  //   );
  //   es.onmessage = (e) => {
  //     try {
  //       const msg: FanoutEnvelope = JSON.parse(e.data);
  //       if (msg.origin === HUB_INSTANCE_ID) return;
  //       _handler(msg);
  //     } catch { /* malformed — drop */ }
  //   };
  //   return () => es.close();
  return () => {};
}
