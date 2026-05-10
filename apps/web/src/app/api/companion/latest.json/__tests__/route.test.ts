/**
 * Smoke tests for the self-hosted Tauri updater manifest proxy.
 *
 * The route fetches GitHub's "latest release" JSON, finds the `latest.json`
 * asset, then streams its body through with strong cache headers. We stub
 * `global.fetch` so we never touch the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../route';

const REAL_FETCH = global.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  process.env.COMPANION_RELEASES_REPO = 'metu-app/metu';
});

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe('GET /api/companion/latest.json', () => {
  it('returns 502 when GitHub is unreachable', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await GET();
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/upstream_500/);
  });

  it('returns 503 when latest release has no manifest asset yet', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ assets: [] }));
    const res = await GET();
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('manifest_not_published_yet');
  });

  it('streams the manifest with the right cache headers', async () => {
    const manifestBody = JSON.stringify({
      version: '0.1.0',
      notes: 'first release',
      pub_date: '2026-05-10T00:00:00Z',
      platforms: {},
    });
    let call = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) {
        return jsonResponse({
          assets: [
            {
              name: 'latest.json',
              browser_download_url: 'https://example.test/latest.json',
            },
          ],
        });
      }
      return new Response(manifestBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe(manifestBody);
  });

  it('forwards the GITHUB_TOKEN as Bearer auth when set', async () => {
    process.env.GITHUB_TOKEN = 'ghs_secret';
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ assets: [] }));
    global.fetch = fetchSpy;
    await GET();
    const firstCall = fetchSpy.mock.calls[0]!;
    const headers = (firstCall[1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe('Bearer ghs_secret');
  });

  it('honours the COMPANION_RELEASES_REPO override', async () => {
    process.env.COMPANION_RELEASES_REPO = 'someone-else/metu-fork';
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ assets: [] }));
    global.fetch = fetchSpy;
    await GET();
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('someone-else/metu-fork');
  });
});
