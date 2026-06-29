/**
 * Centralized environment access. Per the layer rules, env vars are read
 * ONLY in infrastructure. Vite exposes variables prefixed with VITE_ via
 * import.meta.env.
 */
interface AppConfig {
  geminiApiKey: string;
  lyriaModel: string;
}

export function loadConfig(): AppConfig {
  const env = import.meta.env;
  const geminiApiKey = (env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const lyriaModel =
    (env.VITE_LYRIA_MODEL as string | undefined) ?? 'models/lyria-realtime-exp';

  if (!geminiApiKey) {
    console.warn(
      '[config] VITE_GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.',
    );
  }

  return { geminiApiKey, lyriaModel };
}
