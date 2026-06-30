import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the SDK so the test never touches the network or needs a real key.
const createMock = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    authTokens = { create: createMock };
  },
}));

import { createEphemeralToken } from './createEphemeralToken';

describe('createEphemeralToken', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ name: 'auth_tokens/abc123' });
  });

  it('throws when no API key is provided (key must stay server-side)', async () => {
    await expect(
      createEphemeralToken({ apiKey: '', model: 'models/lyria-realtime-exp' }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('mints a single-use token locked to the Lyria model with a bounded expiry', async () => {
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    const result = await createEphemeralToken({
      apiKey: 'real-secret-key',
      model: 'models/lyria-realtime-exp',
      now: () => fixedNow,
    });

    expect(result.token).toBe('auth_tokens/abc123');

    const config = createMock.mock.calls[0][0].config;
    expect(config.uses).toBe(1);
    expect(config.liveConnectConstraints).toEqual({ model: 'models/lyria-realtime-exp' });
    // 30-minute default expiry, 2-minute window to open a new session.
    expect(config.expireTime).toBe(new Date(fixedNow + 30 * 60_000).toISOString());
    expect(config.newSessionExpireTime).toBe(new Date(fixedNow + 2 * 60_000).toISOString());
  });

  it('honors uses and expiry overrides', async () => {
    const fixedNow = 0;
    await createEphemeralToken({
      apiKey: 'real-secret-key',
      model: 'models/lyria-realtime-exp',
      uses: 3,
      expiryMinutes: 10,
      now: () => fixedNow,
    });

    const config = createMock.mock.calls[0][0].config;
    expect(config.uses).toBe(3);
    expect(config.expireTime).toBe(new Date(10 * 60_000).toISOString());
  });

  it('rejects when the SDK returns a nameless token', async () => {
    createMock.mockResolvedValue({});
    await expect(
      createEphemeralToken({ apiKey: 'real-secret-key', model: 'm', now: () => 0 }),
    ).rejects.toThrow(/without a name/);
  });
});
