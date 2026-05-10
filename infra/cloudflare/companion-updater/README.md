# Companion updater proxy (Cloudflare Worker)

Tauri's updater plugin polls a static JSON manifest. We host it on
`releases.metu.app/companion/latest.json` and have a Cloudflare Worker
fetch the live URL from a GitHub Release asset, so cutting a new release
on GitHub auto-publishes to all installed companions without any manual
sync step.

## Files

- `worker.js` — the Worker source. Deploy with `wrangler deploy`.
- `wrangler.toml` — minimal config; set the `RELEASES_REPO` var to the
  repo that publishes the `latest.json` asset (default: `metu-app/metu`).

## How it works

1. `tauri-plugin-updater` GETs `https://releases.metu.app/companion/latest.json`.
2. Cloudflare routes the request to this Worker.
3. The Worker calls the GitHub Releases API for the latest release of
   `RELEASES_REPO`, finds the asset named `latest.json`, fetches it,
   and returns it (cached for 5 minutes at the edge).
4. The JSON has signed download URLs and per-platform signatures
   produced by `tauri-action` when `TAURI_SIGNING_PRIVATE_KEY` is set.

## Setup

```sh
pnpm dlx wrangler@latest deploy
```

Then in the Cloudflare dashboard, add a custom route:
`releases.metu.app/companion/*` → this worker.

## Why a Worker and not a static file?

A static file would require a manual sync step after every release, and
we'd lose the ability to A/B-route updates by user / cohort later.
