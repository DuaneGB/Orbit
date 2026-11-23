/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public VAPID key for browser push. The private key stays on the server. */
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
