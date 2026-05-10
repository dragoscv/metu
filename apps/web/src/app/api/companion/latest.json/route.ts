/**
 * GET /api/companion/latest.json
 *
 * Self-hosted fallback for the Tauri updater manifest. The companion's
 * `tauri.conf.json` points at `https://releases.metu.app/companion/latest.json`
 * (a Cloudflare Worker proxy — see `infra/cloudflare/companion-updater/`),
 * but staging / single-server deployments don't always have CF in front.
 * This route does the same thing: proxy the latest GitHub Release's
 * `latest.json` asset.
 *
 * Cached for 5 minutes via `Cache-Control: public, max-age=300`.
 *
 * NOT bearer-authenticated. The manifest is a public artifact — anyone with
 * the companion installed can already see it. Listed in `proxy.ts`'s
 * unauthenticated allowlist.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIVE_MIN_S = 60 * 5;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface Release {
  assets?: ReleaseAsset[];
}

export async function GET() {
  const repo = process.env.COMPANION_RELEASES_REPO ?? 'metu-app/metu';
  const token = process.env.GITHUB_TOKEN;

  const headers: Record<string, string> = {
    'user-agent': 'metu-web-companion-updater',
    accept: 'application/vnd.github+json',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
    cache: 'no-store',
  });
  if (!releaseRes.ok) {
    return NextResponse.json(
      { ok: false, error: `upstream_${releaseRes.status}` },
      { status: 502 },
    );
  }
  const release = (await releaseRes.json()) as Release;
  const asset = release.assets?.find((a) => a.name === 'latest.json');
  if (!asset) {
    return NextResponse.json({ ok: false, error: 'manifest_not_published_yet' }, { status: 503 });
  }

  const manifestRes = await fetch(asset.browser_download_url, {
    headers,
    cache: 'no-store',
  });
  if (!manifestRes.ok) {
    return NextResponse.json(
      { ok: false, error: `manifest_fetch_${manifestRes.status}` },
      { status: 502 },
    );
  }
  const body = await manifestRes.text();

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${FIVE_MIN_S}, s-maxage=${FIVE_MIN_S}`,
      'access-control-allow-origin': '*',
    },
  });
}
