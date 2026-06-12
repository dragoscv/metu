/**
 * Next.js 16 proxy.ts (replaces middleware.ts).
 *
 * Edge-runtime gate: we only check for the presence of the Auth.js session
 * cookie. Authoritative session validation (DB lookup via the Drizzle adapter)
 * happens in server components / server actions through `auth()`.
 *
 * Why not call `auth()` here: Auth.js v5's full config imports the Drizzle
 * adapter + `postgres`, which is not Edge-compatible. Running it in the proxy
 * caused intermittent redirects to `/sign-in` on HMR / RSC pings.
 *
 * Why we only redirect HTML navigations: server-action POSTs (`Next-Action`
 * header) and RSC payload fetches (`RSC` header) follow 307 redirects with
 * the original method. A 307 → `/sign-in` returns HTML, which makes
 * `fetchServerAction` throw "An unexpected response was received from the
 * server." Pages and actions do their own `auth()` checks and return
 * Next-protocol redirects/errors when unauthenticated, so it's safe (and
 * required) to let those requests through.
 */
import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // Legacy Auth.js v4 cookie name — safe to keep so an existing session
  // survives an upgrade. Harmless if absent.
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/') return NextResponse.next();

  // Don't redirect non-HTML requests — they don't render `/sign-in` correctly
  // and break the Next-Action / RSC client. Page-level `auth()` handles them.
  const isAction = req.headers.has('next-action');
  const isRsc = req.headers.get('rsc') === '1' || req.headers.has('next-router-prefetch');
  if (isAction || isRsc) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => Boolean(req.cookies.get(name)?.value));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Exclude Next internals, static assets, and routes that handle their own auth
// (sign-in page, NextAuth handler, webhooks, Inngest poll endpoint, health).
// The Inngest dev container polls /api/inngest continuously; running the auth
// middleware on every poll is the dominant cost during local development.
export const config = {
  matcher: [
    '/((?!_next/|favicon.ico|sign-in|docs|download|\\.well-known|api/auth|api/webhooks|api/inngest|api/health|api/companion|api/sdk/v1|api/internal|api/calendar|api/voice|api/push/vapid-public-key|api/oauth/token|api/oauth/userinfo|api/oauth/revoke|api/oauth/device|api/oauth/jwks|api/oauth/.well-known|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif|woff2?|map)$).*)',
  ],
};
