import { loadEnv, type Plugin } from 'vite';
import { handleAuthTokenRequest } from './authTokenHandler';

export interface AuthTokenPluginOptions {
  /** Path the endpoint is mounted at. Default `/api/auth-token`. */
  endpoint?: string;
}

/**
 * Vite plugin that serves the ephemeral-token endpoint during `vite dev` and
 * `vite preview`, giving the SPA a "small backend" without a separate process.
 *
 * Crucially it loads the NON-`VITE_`-prefixed env (e.g. `GEMINI_API_KEY`) into
 * `process.env` so the handler can read the real key. Vite never exposes these
 * to `import.meta.env`, so the key stays out of the client bundle.
 *
 * For a real deployment, host `handleAuthTokenRequest` as a serverless function
 * (or behind Express) instead — the SPA only needs the endpoint to exist.
 */
export function authTokenPlugin(options: AuthTokenPluginOptions = {}): Plugin {
  const endpoint = options.endpoint ?? '/api/auth-token';

  return {
    name: 'music-mood:auth-token',
    config(_config, { mode }) {
      // Load ALL env vars (empty prefix) from .env files and surface the
      // server-only ones to process.env without leaking them to the client.
      const env = loadEnv(mode, process.cwd(), '');
      for (const key of [
        'GEMINI_API_KEY',
        'LYRIA_MODEL',
        'AUTH_TOKEN_USES',
        'AUTH_TOKEN_EXPIRY_MINUTES',
      ]) {
        if (process.env[key] === undefined && env[key] !== undefined) {
          process.env[key] = env[key];
        }
      }
    },
    configureServer(server) {
      server.middlewares.use(endpoint, handleAuthTokenRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(endpoint, handleAuthTokenRequest);
    },
  };
}
