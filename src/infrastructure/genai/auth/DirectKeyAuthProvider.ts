import { DomainError } from '@domain/errors/DomainError';
import type { GeminiAuthProvider } from './GeminiAuthProvider';

/**
 * LOCAL-DEV auth strategy: hands the SDK the raw API key read from
 * `VITE_GEMINI_API_KEY`.
 *
 * This SHIPS THE REAL KEY TO THE BROWSER and is acceptable only for local
 * development or a throwaway demo. For anything semi-public, use
 * {@link EphemeralTokenAuthProvider} instead so the key stays on the server.
 */
export class DirectKeyAuthProvider implements GeminiAuthProvider {
  constructor(private readonly apiKey: string) {}

  async getCredential(): Promise<string> {
    if (!this.apiKey) {
      throw new DomainError(
        'A Gemini API key is required in direct mode. Set VITE_GEMINI_API_KEY, ' +
          'or switch to ephemeral-token auth (VITE_AUTH_MODE=ephemeral) for semi-public use.',
      );
    }
    return this.apiKey;
  }
}
