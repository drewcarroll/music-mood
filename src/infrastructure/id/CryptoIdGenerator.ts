import { IdGenerator } from '@application/ports/IdGenerator';

/**
 * Infrastructure implementation of the IdGenerator port using the
 * Web Crypto API (available in browsers and modern Node).
 */
export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    // Fallback for very old environments.
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
