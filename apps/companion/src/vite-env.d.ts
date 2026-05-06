/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_METU_API?: string;
  readonly VITE_METU_HUB?: string;
  readonly VITE_METU_COMPANION_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
