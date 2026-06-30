/**
 * Resolves the credential the Lyria generator hands to the @google/genai SDK.
 *
 * Two concrete strategies live alongside this interface:
 *  - {@link DirectKeyAuthProvider}      — the raw API key, for LOCAL DEV only.
 *  - {@link EphemeralTokenAuthProvider} — a short-lived ephemeral token fetched
 *    from a backend, so the real key never reaches the browser.
 *
 * The credential is resolved lazily, on every `connect()`, because ephemeral
 * tokens are single-use and short-lived: a fresh one must be minted each time a
 * session opens. A direct key simply returns the same value.
 */
export interface GeminiAuthProvider {
  /** Resolve a credential (API key or ephemeral token) for a new connection. */
  getCredential(): Promise<string>;
}
