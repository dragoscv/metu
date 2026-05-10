/**
 * Cloudflare Worker — proxy releases.metu.app/companion/latest.json
 * to the latest GitHub Release's `latest.json` asset.
 *
 * The manifest is produced by tauri-action (see
 * .github/workflows/release-companion.yml) and signed with the
 * Tauri updater key.
 */

const FIVE_MIN = 60 * 5;

export default {
  /**
   * @param {Request} req
   * @param {{ RELEASES_REPO: string; GITHUB_TOKEN?: string }} env
   * @param {ExecutionContext} ctx
   */
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname !== '/companion/latest.json') {
      return new Response('not found', { status: 404 });
    }

    const cache = caches.default;
    const cached = await cache.match(req);
    if (cached) return cached;

    const repo = env.RELEASES_REPO || 'metu-app/metu';
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

    const headers = {
      'user-agent': 'metu-companion-updater-proxy',
      accept: 'application/vnd.github+json',
    };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

    const release = await fetch(apiUrl, { headers });
    if (!release.ok) {
      return new Response(`upstream ${release.status}`, { status: 502 });
    }
    const data = await release.json();
    const asset = (data.assets || []).find((a) => a.name === 'latest.json');
    if (!asset) {
      return new Response('manifest not published yet', { status: 503 });
    }

    const manifest = await fetch(asset.browser_download_url, { headers });
    if (!manifest.ok) {
      return new Response('manifest fetch failed', { status: 502 });
    }
    const body = await manifest.text();

    const res = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${FIVE_MIN}, s-maxage=${FIVE_MIN}`,
        'access-control-allow-origin': '*',
      },
    });
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  },
};
