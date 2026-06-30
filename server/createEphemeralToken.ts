import { GoogleGenAI } from '@google/genai';

/**
 * Mints a short-lived Gemini ephemeral auth token (`authTokens.create`) using
 * the REAL API key. This runs ONLY on the server — the key never leaves it.
 *
 * The browser uses the returned `token` in place of the API key when opening a
 * Lyria RealTime Live session, so the real key is never bundled into or sent to
 * the client. Tokens are constrained to the Lyria model and default to
 * single-use with a short expiry.
 */

export interface EphemeralTokenResult {
  token: string;
  expireTime?: string;
  newSessionExpireTime?: string;
}

export interface MintTokenOptions {
  /** Real Gemini API key. Kept server-side only. */
  apiKey: string;
  /** Lyria model the token is locked to (defensive scoping). */
  model: string;
  /** Minutes until the token (and any live session using it) expires. Default 30. */
  expiryMinutes?: number;
  /** Minutes within which a NEW session must start. Default 2. */
  newSessionMinutes?: number;
  /** How many times the token may be used. Default 1 (single-use). */
  uses?: number;
  /** Injected for deterministic tests; defaults to the real clock. */
  now?: () => number;
}

export async function createEphemeralToken(opts: MintTokenOptions): Promise<EphemeralTokenResult> {
  if (!opts.apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set on the server. The token endpoint needs the ' +
        'real key (without the VITE_ prefix, so it is never bundled to the browser).',
    );
  }

  const now = opts.now ?? Date.now;
  const expiryMinutes = opts.expiryMinutes ?? 30;
  const newSessionMinutes = opts.newSessionMinutes ?? 2;
  const expireTime = new Date(now() + expiryMinutes * 60_000).toISOString();
  const newSessionExpireTime = new Date(now() + newSessionMinutes * 60_000).toISOString();

  // Ephemeral tokens are only served on the v1alpha surface.
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: { apiVersion: 'v1alpha' },
  });

  const authToken = await ai.authTokens.create({
    config: {
      uses: opts.uses ?? 1,
      expireTime,
      newSessionExpireTime,
      // Lock the token to the Lyria model so a leaked token can't be repurposed.
      liveConnectConstraints: { model: opts.model },
    },
  });

  if (!authToken.name) {
    throw new Error('authTokens.create returned a token without a name.');
  }

  return { token: authToken.name, expireTime, newSessionExpireTime };
}
