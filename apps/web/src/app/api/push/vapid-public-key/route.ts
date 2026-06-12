/**
 * Public endpoint to fetch the VAPID public key the browser must use when
 * calling `pushManager.subscribe({ applicationServerKey })`.
 *
 * Open by design (the public key is intended to be public). Returns 503 if
 * VAPID keys aren't configured so clients can render a graceful "push
 * unavailable" UI.
 */
import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'vapid_unconfigured' }, { status: 503 });
  return NextResponse.json({ ok: true, publicKey: key });
}
