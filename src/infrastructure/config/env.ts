import type { MusicGenerationConfig } from '@application/ports/MusicGenerationPort';

/**
 * Centralized environment access. Per the layer rules, env vars are read
 * ONLY in infrastructure. Vite exposes variables prefixed with VITE_ via
 * import.meta.env.
 */
/**
 * How the browser authenticates to Gemini / Lyria RealTime.
 *  - `direct`    — uses the raw `VITE_GEMINI_API_KEY` in the browser. LOCAL DEV ONLY.
 *  - `ephemeral` — fetches a short-lived ephemeral token from a backend, so the
 *    real key never ships to the browser. Use this for anything semi-public.
 */
export type AuthMode = 'direct' | 'ephemeral';

export interface AppConfig {
  /** Selected auth strategy. */
  authMode: AuthMode;
  /** Raw API key — only populated/used in `direct` mode. */
  geminiApiKey: string;
  /** Backend endpoint that mints ephemeral tokens — used in `ephemeral` mode. */
  authTokenEndpoint: string;
  lyriaModel: string;
  /**
   * The hardcoded weighted prompt used to seed a freshly-opened session so the
   * stream starts flowing immediately. Mood-driven steering replaces it later.
   */
  initialPrompt: { text: string; weight: number };
  /** Default real-time generation parameters applied on connect. */
  generationConfig: MusicGenerationConfig;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const env = import.meta.env;
  const geminiApiKey = (env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const lyriaModel = (env.VITE_LYRIA_MODEL as string | undefined) ?? 'models/lyria-realtime-exp';
  const authTokenEndpoint =
    (env.VITE_AUTH_TOKEN_ENDPOINT as string | undefined) ?? '/api/auth-token';

  // Explicit mode wins; otherwise infer: a client key present → direct (dev),
  // none present → ephemeral (the secure, semi-public default).
  const explicitMode = env.VITE_AUTH_MODE as AuthMode | undefined;
  const authMode: AuthMode =
    explicitMode === 'direct' || explicitMode === 'ephemeral'
      ? explicitMode
      : geminiApiKey
        ? 'direct'
        : 'ephemeral';

  if (authMode === 'direct' && !geminiApiKey) {
    console.warn(
      '[config] direct auth mode but VITE_GEMINI_API_KEY is not set. Copy .env.example ' +
        'to .env and add your key, or set VITE_AUTH_MODE=ephemeral for semi-public use.',
    );
  }

  return {
    authMode,
    geminiApiKey,
    authTokenEndpoint,
    lyriaModel,
    initialPrompt: {
      text: (env.VITE_LYRIA_INITIAL_PROMPT as string | undefined) ?? 'lush ambient soundscape',
      weight: num(env.VITE_LYRIA_INITIAL_PROMPT_WEIGHT as string | undefined, 1.0),
    },
    // Seeded once on connect. bpm, scale and guidance are PINNED for the whole
    // performance: bpm/scale changes force a reset_context() seam, and a low
    // guidance (~2.5) keeps weighted-prompt blends gentle rather than abrupt.
    // density/brightness are only starting points — steering morphs them live.
    generationConfig: {
      bpm: num(env.VITE_LYRIA_BPM as string | undefined, 110),
      guidance: num(env.VITE_LYRIA_GUIDANCE as string | undefined, 2.5),
      density: num(env.VITE_LYRIA_DENSITY as string | undefined, 0.6),
      brightness: num(env.VITE_LYRIA_BRIGHTNESS as string | undefined, 0.5),
      scale: (env.VITE_LYRIA_SCALE as string | undefined) ?? 'C_MAJOR_A_MINOR',
    },
  };
}
