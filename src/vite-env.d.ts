/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_LYRIA_MODEL?: string;
  /** 'direct' (raw key, local dev) | 'ephemeral' (backend-minted token). */
  readonly VITE_AUTH_MODE?: string;
  /** Backend endpoint that mints ephemeral tokens (ephemeral mode). */
  readonly VITE_AUTH_TOKEN_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
