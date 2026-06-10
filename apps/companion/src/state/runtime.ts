/**
 * Runtime detection — is the frontend running inside a Tauri webview, or a
 * plain browser tab (used during `pnpm dev` without the desktop shell)?
 *
 * `window.__TAURI__` is ONLY injected when `app.withGlobalTauri` is true, so it
 * is unreliable for detection. `window.__TAURI_INTERNALS__` is always present
 * inside a Tauri 2 webview regardless of that flag — that's what we key on.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined)
  );
}
