import type { IncomingMessage, ServerResponse } from 'node:http';
import { createEphemeralToken } from './createEphemeralToken';

/**
 * A tiny, framework-agnostic Node request handler that mints a Gemini ephemeral
 * token and returns it as JSON. It reads the REAL key from `process.env` so the
 * key stays server-side and is never bundled into the client.
 *
 * It plugs into:
 *  - the Vite dev/preview server (see `server/viteAuthTokenPlugin.ts`), and
 *  - any Node host (Express, a serverless function, etc.) — the signature is
 *    the standard `(req, res)`.
 *
 * Backend env vars (NO `VITE_` prefix, so Vite never exposes them to the browser):
 *  - `GEMINI_API_KEY`   — the real key (required).
 *  - `LYRIA_MODEL`      — model to lock the token to (optional).
 *  - `AUTH_TOKEN_USES`, `AUTH_TOKEN_EXPIRY_MINUTES` — optional overrides.
 */
export async function handleAuthTokenRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Only POST mints a token; reject everything else so the endpoint isn't a GET.
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed; use POST.' }));
    return;
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const model = process.env.LYRIA_MODEL ?? 'models/lyria-realtime-exp';
    const uses = numEnv(process.env.AUTH_TOKEN_USES);
    const expiryMinutes = numEnv(process.env.AUTH_TOKEN_EXPIRY_MINUTES);

    const result = await createEphemeralToken({ apiKey, model, uses, expiryMinutes });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    // Never let a token linger in a shared cache.
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth-token] failed to mint ephemeral token:', message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to mint ephemeral token.' }));
  }
}

function numEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
