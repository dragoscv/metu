/**
 * Deep-link → companion bridge.
 *
 * Listens for `metu://` URLs delivered via `tauri-plugin-deep-link` and
 * routes them to the right surface. Today:
 *
 *   metu://hud          \
 *   metu://hud/show     /  → ensure the HUD window is visible
 *   metu://notification/<id> → show HUD + record which notification opened
 *
 * The web-side `notify.ts` already accepts an `actionUrl` on every
 * notification — the moment a server-pushed alert sets actionUrl to
 * `metu://hud/show?notification=<id>`, clicking the toast (web-push or
 * Expo) brings the companion to the foreground.
 *
 * We don't trust the URL beyond its scheme + first path segment; any
 * query string is forwarded to the HUD as-is via custom event so a
 * future surface can act on it.
 */
import { invoke } from '@tauri-apps/api/core';

interface DeepLinkPlugin {
  onOpenUrl: (cb: (urls: string[]) => void) => Promise<() => void>;
  getCurrent: () => Promise<string[] | null>;
}

let unlisten: (() => void) | null = null;

export async function attachDeepLinkBridge(): Promise<void> {
  if (unlisten) return;
  // Optional in browser builds — load lazily.
  const mod = (await import(
    /* @vite-ignore */
    '@tauri-apps/plugin-deep-link'
  ).catch(() => null)) as DeepLinkPlugin | null;
  if (!mod) return;

  const handle = (urls: string[]): void => {
    for (const raw of urls) {
      try {
        const u = new URL(raw);
        if (u.protocol !== 'metu:') continue;
        // host is the first segment after "metu://"
        const target = u.host.toLowerCase();
        if (target === 'hud' || target === 'notification') {
          void invoke('presence_hud_show').catch(() => {});
          window.dispatchEvent(new CustomEvent('metu:deep-link', { detail: { target, url: raw } }));
        }
      } catch {
        // Malformed URLs are ignored — the deep-link plugin can deliver
        // platform-specific shapes during cold-start that aren't worth
        // surfacing.
      }
    }
  };

  // Initial cold-start URL (e.g. user clicked a notification while
  // companion was closed).
  const cold = await mod.getCurrent().catch(() => null);
  if (cold && cold.length > 0) handle(cold);

  unlisten = await mod.onOpenUrl(handle).catch(() => null as never);
}

export function detachDeepLinkBridge(): void {
  if (unlisten) {
    try {
      unlisten();
    } catch {
      // best-effort
    }
    unlisten = null;
  }
}
