import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECONNECTION,
  SESSION_CAP_MS,
  fitsBeforeCap,
  handoffCompleteMs,
  resolveReconnection,
  type ReconnectionOptions,
} from './reconnectionSchedule';

describe('reconnectionSchedule', () => {
  it('defaults complete the whole dance before the ~10-min cap', () => {
    expect(handoffCompleteMs(DEFAULT_RECONNECTION)).toBeLessThan(SESSION_CAP_MS);
    expect(fitsBeforeCap(DEFAULT_RECONNECTION)).toBe(true);
  });

  it('defaults open the replacement before the cap with real headroom', () => {
    // The replacement must open before the limit (acceptance #1), and there
    // must be room for the 5–10s settle plus the crossfade afterwards.
    expect(DEFAULT_RECONNECTION.reconnectAfterMs).toBeLessThan(SESSION_CAP_MS);
    expect(DEFAULT_RECONNECTION.settleMs).toBeGreaterThanOrEqual(5_000);
    expect(DEFAULT_RECONNECTION.settleMs).toBeLessThanOrEqual(10_000);
    expect(SESSION_CAP_MS - handoffCompleteMs(DEFAULT_RECONNECTION)).toBeGreaterThanOrEqual(10_000);
  });

  it('flags timings that would overrun the cap', () => {
    const tooLate: ReconnectionOptions = {
      reconnectAfterMs: 9.9 * 60_000,
      settleMs: 7_000,
      crossfadeMs: 2_000,
    };
    expect(fitsBeforeCap(tooLate)).toBe(false);
  });

  it('repairs overrunning timings by opening the replacement earlier', () => {
    const tooLate: ReconnectionOptions = {
      reconnectAfterMs: 9.9 * 60_000,
      settleMs: 7_000,
      crossfadeMs: 2_000,
    };
    const fixed = resolveReconnection(tooLate);
    expect(fixed.reconnectAfterMs).toBeLessThan(tooLate.reconnectAfterMs);
    // Settle and crossfade are preserved (they govern audio quality).
    expect(fixed.settleMs).toBe(tooLate.settleMs);
    expect(fixed.crossfadeMs).toBe(tooLate.crossfadeMs);
    expect(fitsBeforeCap(fixed)).toBe(true);
  });

  it('leaves already-fitting options untouched', () => {
    expect(resolveReconnection(DEFAULT_RECONNECTION)).toBe(DEFAULT_RECONNECTION);
  });
});
