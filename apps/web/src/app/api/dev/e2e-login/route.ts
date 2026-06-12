/**
 * Dev/E2E-only login: mints a database session for the deterministic
 * `e2e@metu.local` user and sets the Auth.js session cookie.
 *
 * Hard-gated: 404 unless NODE_ENV !== 'production' AND E2E_AUTH_SECRET is
 * set AND the caller presents it. Used by the Playwright smoke pack so we
 * don't need a real Google OAuth round-trip in CI/local runs.
 */
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { session, user } from '@metu/db/schema';
import { ensurePersonalWorkspace } from '@metu/db/queries';
import { safeEqual } from '@/lib/safe-equal';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h is plenty for a test run

export async function POST(req: Request) {
  const secret = process.env.E2E_AUTH_SECRET;
  if (process.env.NODE_ENV === 'production' || !secret) {
    return new NextResponse(null, { status: 404 });
  }
  const provided = req.headers.get('x-e2e-secret') ?? '';
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const email = 'e2e@metu.local';
  let [u] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!u) {
    [u] = await db
      .insert(user)
      .values({ email, name: 'E2E User', emailVerified: new Date() })
      .returning();
  }
  if (!u) return NextResponse.json({ ok: false, error: 'user_create_failed' }, { status: 500 });

  await ensurePersonalWorkspace(u.id, 'E2E Workspace', `e2e-${u.id.slice(0, 8)}`);

  const sessionToken = randomUUID();
  await db.insert(session).values({
    sessionToken,
    userId: u.id,
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });

  const res = NextResponse.json({ ok: true, userId: u.id });
  // Local dev is http — no __Secure- prefix.
  res.cookies.set('authjs.session-token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
