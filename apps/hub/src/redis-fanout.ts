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
 *      `metu.hub.broadcast` via Upstash's SSE-style /subscribe transport.
 *   2. `/internal/broadcast` publishes the envelope to that channel and
 *      also forwards it to its own local connections (to keep the
 *      single-instance fast path zero-latency).
 *   3. Subscribers deduplicate by `origin` so the publishing instance
 *      doesn't double-deliver to its own already-served sockets.
 *
 * No external npm dep — Upstash exposes a plain REST/SSE surface.
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

function baseUrl(): string {
  return process.env[URL_ENV]!.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${process.env[TOKEN_ENV]}` };
}

/**
 * Publish an envelope to all hub instances. Returns immediately when
 * fanout is unconfigured. Errors are logged once and swallowed to keep
 * the local delivery path unaffected by Redis hiccups.
 */
export async function publish(msg: FanoutEnvelope): Promise<void> {
  if (!isFanoutConfigured()) return;
  try {
    // Upstash REST: POST `${base}/publish/${channel}` with the message
    // body. The library version uses the same wire shape.
    const res = await fetch(`${baseUrl()}/publish/${encodeURIComponent(CHANNEL)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      // Don't await reading the body — keep the path fast.
      void res.text().catch(() => undefined);
    }
  } catch {
    // Swallow — local delivery already happened.
  }
}

export type FanoutHandler = (msg: FanoutEnvelope) => void;

/**
 * Subscribe to envelopes published by other hub instances. Returns an
 * unsubscribe function; no-op when fanout is unconfigured.
 *
 * Uses Upstash's SSE transport (`/subscribe/<channel>` streams
 * `data: <payload>` lines). We parse each line and dispatch to the
 * handler. Auto-reconnects with exponential backoff capped at 30s.
 */
export function subscribe(handler: FanoutHandler): () => void {
  if (!isFanoutConfigured()) return () => {};

  const controller = new AbortController();
  let stopped = false;
  let backoff = 500;

  const run = async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${baseUrl()}/subscribe/${encodeURIComponent(CHANNEL)}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`subscribe http ${res.status}`);
        }
        backoff = 500;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // SSE frames are separated by blank lines; payload is on `data:` lines.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (!dataLine) continue;
            try {
              const msg = JSON.parse(dataLine) as FanoutEnvelope;
              handler(msg);
            } catch {
              // Malformed frame — skip.
            }
          }
        }
      } catch {
        if (stopped) return;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  };

  void run();
  return () => {
    stopped = true;
    controller.abort();
  };
}
