/**
 * Next.js 16 proxy.ts (replaces middleware.ts).
 * Protects all routes except auth + public paths.
 */
import { auth } from '@metu/auth';
import { NextResponse } from 'next/server';

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname === '/') return NextResponse.next();

  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

// Exclude Next internals, static assets, and routes that handle their own auth
// (sign-in page, NextAuth handler, webhooks, Inngest poll endpoint, health).
// The Inngest dev container polls /api/inngest continuously; running the auth
// middleware on every poll is the dominant cost during local development.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sign-in|api/auth|api/webhooks|api/inngest|api/health|api/sdk/v1|api/internal|api/push/vapid-public-key|api/oauth/token|api/oauth/userinfo|api/oauth/revoke|api/oauth/device|api/oauth/jwks|api/oauth/.well-known|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif|woff2?)$).*)',
  ],
};
