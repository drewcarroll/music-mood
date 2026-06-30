/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_LYRIA_MODEL?: string;
  /** 'direct' (raw key, local dev) | 'ephemeral' (backend-minted token). */
  readonly VITE_AUTH_MODE?: string;
  /** Backend endpoint that mints ephemeral tokens (ephemeral mode). */
  readonly VITE_AUTH_TOKEN_ENDPOINT?: string;
  /** Transparent-reconnect timing (ms) ahead of the ~10-min session cap. */
  readonly VITE_RECONNECT_AFTER_MS?: string;
  readonly VITE_RECONNECT_SETTLE_MS?: string;
  readonly VITE_RECONNECT_CROSSFADE_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
