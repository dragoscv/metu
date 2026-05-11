/**
 * Liveness + dependency probe.
 *
 * `?deep=1` runs a cheap `select 1` and probes the hub `/healthz` so the
 * caller learns whether the worker can actually serve requests, not just
 * whether the Node process is alive. The shallow path stays fast for
 * uptime checkers.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@metu/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

async function probeDb(): Promise<ProbeResult> {
  const t = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message };
  }
}

async function probeHub(): Promise<ProbeResult> {
  const url = process.env.HUB_INTERNAL_URL ?? `http://localhost:${process.env.HUB_PORT ?? 24891}`;
  const t = Date.now();
  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return res.ok
      ? { ok: true, latencyMs: Date.now() - t }
      : { ok: false, latencyMs: Date.now() - t, error: `status_${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('deep') !== '1') {
    return Response.json({ ok: true, ts: Date.now() });
  }
  const [db, hub] = await Promise.all([probeDb(), probeHub()]);
  const ok = db.ok && hub.ok;
  return Response.json({ ok, ts: Date.now(), checks: { db, hub } }, { status: ok ? 200 : 503 });
}
