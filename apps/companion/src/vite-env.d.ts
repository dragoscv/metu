/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_METU_API?: string;
  readonly VITE_METU_HUB?: string;
  readonly VITE_METU_COMPANION_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Injected by the Tauri runtime; absent in a plain browser tab. */
  __TAURI__?: unknown;
  /**
   * Always present inside a Tauri 2 webview (independent of
   * `withGlobalTauri`). Use {@link isTauri} to detect the runtime.
   */
  __TAURI_INTERNALS__?: unknown;
}
