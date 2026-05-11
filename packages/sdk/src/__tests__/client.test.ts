import { describe, expect, it, vi } from 'vitest';
import { createClient, MetuApiError } from '../index';

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) =>
    impl(String(url), init ?? {}),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

const baseOpts = {
  baseUrl: 'https://app.metu.test',
  auth: { kind: 'token' as const, accessToken: 'metu_at_TEST' },
};

// Fixtures satisfy z.infer<> output types (defaults become required after
// inference) — runtime defaults still apply when you `.parse(input)`.
const capTextFixture = { kind: 'text' as const, content: 'hi', source: 'sdk', metadata: {} };
const notifyMinFixture = { title: 'hi', urgency: 'normal' as const, source: 'app' };
const intentMinFixture = {
  title: 'Pay invoice',
  sourceEntityRef: {},
  importance: 0.5,
  status: 'inbox' as const,
};

describe('createClient — auth headers', () => {
  it('sends Bearer token for kind=token', async () => {
    const seen: Record<string, string> = {};
    const f = mockFetch((_, init) => {
      Object.assign(seen, init.headers as Record<string, string>);
      return jsonResponse({ id: 'cap_1' });
    });
    const c = createClient({ ...baseOpts, fetch: f });
    await c.capture(capTextFixture);
    expect(seen.authorization).toBe('Bearer metu_at_TEST');
    expect(seen['x-metu-protocol']).toBeTruthy();
  });

  it('sends x-metu-api-key for kind=api_key', async () => {
    const seen: Record<string, string> = {};
    const f = mockFetch((_, init) => {
      Object.assign(seen, init.headers as Record<string, string>);
      return jsonResponse({ id: 'cap_1' });
    });
    const c = createClient({
      ...baseOpts,
      auth: { kind: 'api_key', apiKey: 'ak_123' },
      fetch: f,
    });
    await c.capture(capTextFixture);
    expect(seen['x-metu-api-key']).toBe('ak_123');
    expect(seen.authorization).toBeUndefined();
  });

  it('throws synchronously when constructed with oauth_device_flow + request', async () => {
    const c = createClient({
      ...baseOpts,
      auth: { kind: 'oauth_device_flow', clientId: 'metu_app_test' },
    });
    await expect(c.capture(capTextFixture)).rejects.toThrow(
      /oauth_device_flow is not directly usable/,
    );
  });
});

describe('createClient — request/response shape', () => {
  it('parses input through CaptureCreateSchema before sending', async () => {
    let body: unknown = null;
    const f = mockFetch((_, init) => {
      body = JSON.parse(String(init.body));
      return jsonResponse({ id: 'cap_1' });
    });
    const c = createClient({ ...baseOpts, fetch: f });
    await c.capture({ ...capTextFixture, content: 'hello' });
    expect(body).toMatchObject({ kind: 'text', content: 'hello', source: 'sdk' });
  });

  it('throws zod error for invalid recall input', async () => {
    const f = mockFetch(() => jsonResponse([]));
    const c = createClient({ ...baseOpts, fetch: f });
    // @ts-expect-error — testing runtime rejection of missing field
    await expect(c.recall({})).rejects.toThrow();
  });

  it('hits the right endpoint for each method', async () => {
    const seen: string[] = [];
    const f = mockFetch((url) => {
      seen.push(new URL(url).pathname);
      return jsonResponse({ id: 'x' });
    });
    const c = createClient({ ...baseOpts, fetch: f });
    await c.capture(capTextFixture);
    await c.notify(notifyMinFixture);
    await c.intent(intentMinFixture);
    await c.event('test.kind', { ok: true });
    expect(seen).toEqual([
      '/api/sdk/v1/capture',
      '/api/sdk/v1/notify',
      '/api/sdk/v1/intent',
      '/api/sdk/v1/events',
    ]);
  });

  it('builds query string for timeline()', async () => {
    let captured = '';
    const f = mockFetch((url) => {
      captured = new URL(url).search;
      return jsonResponse({
        ok: true,
        window: { sinceDays: 7, sinceIso: '' },
        items: [],
        nextCursor: null,
      });
    });
    const c = createClient({ ...baseOpts, fetch: f });
    await c.timeline({ kinds: ['a', 'b'], q: 'pricing', limit: 50, since: '14d' });
    expect(captured).toContain('kind=a');
    expect(captured).toContain('kind=b');
    expect(captured).toContain('q=pricing');
    expect(captured).toContain('limit=50');
    expect(captured).toContain('since=14d');
  });
});

describe('createClient — error mapping', () => {
  it('throws MetuApiError with status + code on non-2xx', async () => {
    const f = mockFetch(() =>
      jsonResponse({ code: 'rate_limited', error: 'slow down' }, { status: 429 }),
    );
    const c = createClient({ ...baseOpts, fetch: f });
    await expect(c.capture(capTextFixture)).rejects.toMatchObject({
      name: 'MetuApiError',
      status: 429,
      code: 'rate_limited',
    });
  });

  it('falls back to http_error code when response omits one', async () => {
    const f = mockFetch(() => new Response('', { status: 500 }));
    const c = createClient({ ...baseOpts, fetch: f });
    try {
      await c.notify(notifyMinFixture);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MetuApiError);
      expect((e as MetuApiError).status).toBe(500);
      expect((e as MetuApiError).code).toBe('http_error');
    }
  });
});

describe('createClient — timeout', () => {
  it('aborts after timeoutMs', async () => {
    vi.useFakeTimers();
    const f = mockFetch((_, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new DOMException('aborted', 'AbortError');
          // Swallow the rejection synchronously so vitest doesn't flag a
          // late-handled rejection while we advance fake timers.
          reject(err);
        });
      }).catch((err) => {
        throw err;
      }),
    );
    const c = createClient({ ...baseOpts, fetch: f, timeoutMs: 50 });
    const p = c.capture(capTextFixture).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    const result = await p;
    expect(result).toBeInstanceOf(Error);
    vi.useRealTimers();
  });
});
