import { DomainError } from '@domain/errors/DomainError';
import type { GeminiAuthProvider } from './GeminiAuthProvider';

/**
 * Shape of the JSON returned by the token-minting backend
 * (see `server/authTokenHandler.ts`). Only `token` is required by the client.
 */
interface AuthTokenResponse {
  token: string;
  expireTime?: string;
  newSessionExpireTime?: string;
}

/**
 * SEMI-PUBLIC auth strategy: fetches a short-lived ephemeral token from a
 * backend endpoint that holds the real API key server-side. The real key is
 * NEVER bundled into or sent to the browser — only the disposable token is.
 *
 * A fresh token is minted on every `connect()`, matching Gemini's ephemeral
 * tokens, which default to single-use and a short expiry.
 */
export class EphemeralTokenAuthProvider implements GeminiAuthProvider {
  /**
   * @param endpoint URL of the token-minting backend (e.g. `/api/auth-token`).
   */
  constructor(private readonly endpoint: string) {}

  async getCredential(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DomainError(
        `Could not reach the auth-token endpoint "${this.endpoint}": ${message}. ` +
          'Is the backend running?',
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new DomainError(
        `Auth-token endpoint "${this.endpoint}" responded ${response.status}` +
          (detail ? `: ${detail}` : ''),
      );
    }

    let body: AuthTokenResponse;
    try {
      body = (await response.json()) as AuthTokenResponse;
    } catch {
      throw new DomainError(`Auth-token endpoint "${this.endpoint}" returned a non-JSON response.`);
    }

    if (!body.token) {
      throw new DomainError(`Auth-token endpoint "${this.endpoint}" returned no token.`);
    }
    return body.token;
  }
}
