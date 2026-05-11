/**
 * Request-id propagation for SDK responses.
 *
 * Reads `x-request-id` from the incoming request (or generates one) and
 * echoes it on the response so external clients — and our logs — can
 * correlate a single bearer call across web, hub, and worker.
 */
import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';

export function requestIdFor(req: Request): string {
  const inbound = req.headers.get(HEADER);
  if (inbound && /^[\w.-]{1,128}$/.test(inbound)) return inbound;
  return randomUUID();
}

/** Attach `x-request-id` to a Response. Returns the same Response. */
export function withRequestId(res: Response, requestId: string): Response {
  res.headers.set(HEADER, requestId);
  return res;
}

/** Convenience wrapper used by SDK route handlers. */
export function trace<T extends Response>(req: Request, res: T): T {
  res.headers.set(HEADER, requestIdFor(req));
  return res;
}
