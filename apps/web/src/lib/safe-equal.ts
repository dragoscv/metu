/**
 * Constant-time secret comparison + SSRF URL guard.
 *
 * `safeEqual` returns false on length mismatch without leaking the prefix
 * via early-exit timing. Use for any user-supplied secret compared against
 * a server-side value (webhook secrets, internal shared secrets, dev tokens).
 */
import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still run a comparison against `ab` to keep the timing roughly constant
    // regardless of which side is wrong.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Reject URLs that point at loopback / link-local / private / metadata
 * services. Used before opening outbound HTTP from a server action where the
 * URL is user-supplied (external MCP, webhook targets).
 *
 * Allows `localhost` only when `NODE_ENV !== 'production'` to keep local dev
 * loops working.
 */
export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${protocol}`);
  }
  if (process.env.NODE_ENV === 'production' && protocol === 'http:') {
    throw new Error('only https:// is allowed in production');
  }
  const host = url.hostname.toLowerCase();
  const allowLocalhost = process.env.NODE_ENV !== 'production';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    if (!allowLocalhost) throw new Error('loopback hosts are not allowed');
    return url;
  }
  // IPv4 literal — block private / link-local / metadata.
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224 // multicast / reserved
    ) {
      throw new Error('private or reserved IP not allowed');
    }
  }
  // IPv6 literal — block loopback, link-local, ULA.
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')) {
      throw new Error('private or reserved IPv6 not allowed');
    }
  }
  return url;
}
