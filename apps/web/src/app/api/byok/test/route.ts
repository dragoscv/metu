/**
 * POST /api/byok/test
 *
 * "Does this provider key actually work?" — pings the provider's
 * cheapest list/identify endpoint with the workspace's stored
 * credential. Returns `{ ok, latencyMs, message? }`.
 *
 * Auth: cookie session (settings page). No bearer-token entry — this
 * endpoint exists to give the user a green/red dot in the UI, not as
 * an SDK surface.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getProviderCredential, CODAI_BASE_URL } from '@metu/ai';
import { rateLimit } from '@/lib/ratelimit';
import { assertSafeOutboundUrl } from '@/lib/safe-equal';

export const runtime = 'nodejs';

const Body = z.object({
  provider: z.enum([
    'anthropic',
    'openai',
    'azure_openai',
    'google',
    'vertex',
    'ollama',
    'custom',
    'codai',
    'deepgram',
    'cartesia',
    'elevenlabs',
  ]),
});

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  message?: string;
}

async function tryFetch(url: string, init: RequestInit): Promise<Response> {
  assertSafeOutboundUrl(url);
  // 8s ceiling — cheap probes shouldn't take more.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function testProvider(provider: string, key: string, endpoint?: string): Promise<TestResult> {
  const t0 = Date.now();
  try {
    switch (provider) {
      case 'openai': {
        const r = await tryFetch('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${key}` },
        });
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'anthropic': {
        const r = await tryFetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'google': {
        const r = await tryFetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { method: 'GET' },
        );
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'deepgram': {
        const r = await tryFetch('https://api.deepgram.com/v1/projects', {
          headers: { authorization: `Token ${key}` },
        });
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'elevenlabs': {
        const r = await tryFetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': key },
        });
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'ollama': {
        const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const r = await tryFetch(`${base}/api/tags`, {});
        return { ok: r.ok, latencyMs: Date.now() - t0, message: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'custom': {
        // Generic OpenAI-compatible gateway. Probe GET {base}/models.
        if (!endpoint) {
          return { ok: false, message: 'no base URL stored' };
        }
        const base = endpoint.replace(/\/+$/, '');
        const r = await tryFetch(`${base}/models`, {
          headers: { authorization: `Bearer ${key}` },
        });
        return {
          ok: r.ok,
          latencyMs: Date.now() - t0,
          message: r.ok ? undefined : `HTTP ${r.status}`,
        };
      }
      case 'codai': {
        // Native codai gateway — base URL is baked in (cred.endpoint mirrors it).
        const base = (endpoint || CODAI_BASE_URL).replace(/\/+$/, '');
        const r = await tryFetch(`${base}/models`, {
          headers: { authorization: `Bearer ${key}` },
        });
        return {
          ok: r.ok,
          latencyMs: Date.now() - t0,
          message: r.ok ? undefined : `HTTP ${r.status}`,
        };
      }
      default:
        return { ok: false, message: 'no_test_for_provider' };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'request failed' };
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit('byok-test', session.user.id);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const cred = await getProviderCredential(session.user.workspaceId, parsed.data.provider);
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'no_credential', message: 'No workspace credential stored.' },
      { status: 404 },
    );
  }

  const result = await testProvider(parsed.data.provider, cred.apiKey, cred.endpoint ?? undefined);
  return NextResponse.json({ ok: result.ok, latencyMs: result.latencyMs, message: result.message });
}
