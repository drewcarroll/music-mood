import { describe, it, expect } from 'vitest';
import { base64ToUint8Array, decodePcm16 } from './pcm';

/** Encode signed 16-bit samples as little-endian PCM bytes. */
function int16leBytes(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return bytes;
}

/** Base64-encode raw bytes (browser-style, matching what the SDK delivers). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('base64ToUint8Array', () => {
  it('decodes base64 back to the original bytes (AC1)', () => {
    const original = int16leBytes([0, 1, -1, 32767, -32768]);
    const decoded = base64ToUint8Array(toBase64(original));
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('reads little-endian 16-bit samples through to Int16 values (AC1)', () => {
    // 0x0100 LE = 1, 0xFFFF LE = -1.
    const bytes = new Uint8Array([0x01, 0x00, 0xff, 0xff]);
    const [mono] = decodePcm16(bytes, 1);
    expect(mono[0]).toBe(1 / 32768);
    expect(mono[1]).toBe(-1 / 32768);
  });
});

describe('decodePcm16 normalization (AC2)', () => {
  it('maps full-scale samples into [-1, 1] via /32768', () => {
    const [mono] = decodePcm16(int16leBytes([0, 32767, -32768, -16384]), 1);
    expect(mono[0]).toBe(0);
    expect(mono[1]).toBeCloseTo(32767 / 32768, 12); // largest positive < 1
    expect(mono[2]).toBe(-1); // most negative maps to exactly -1
    expect(mono[3]).toBe(-0.5);
    // Every sample stays within range.
    for (const v of mono) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('decodePcm16 stereo de-interleaving (AC3, AC4)', () => {
  it('splits L,R,L,R into separate channel buffers', () => {
    const [left, right] = decodePcm16(int16leBytes([100, -100, 200, -200, 300, -300]), 2);
    expect(Array.from(left)).toEqual([100, 200, 300].map((v) => v / 32768));
    expect(Array.from(right)).toEqual([-100, -200, -300].map((v) => v / 32768));
  });

  it('has no off-by-one: ascending samples land on the expected channel/frame (AC4)', () => {
    // Distinct strictly-increasing values so ANY shift or swap is detectable.
    const interleaved = [1, 2, 3, 4, 5, 6, 7, 8];
    const [left, right] = decodePcm16(int16leBytes(interleaved), 2);

    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    // Even indices -> L (channel 0), odd indices -> R (channel 1).
    interleaved.forEach((sample, i) => {
      const channel = i % 2 === 0 ? left : right;
      const frame = Math.floor(i / 2);
      expect(channel[frame]).toBe(sample / 32768);
    });
  });

  it('drops a trailing incomplete sample instead of misaligning', () => {
    // 5 bytes = 2 whole int16 samples + 1 dangling byte.
    const bytes = new Uint8Array([0x0a, 0x00, 0x14, 0x00, 0x7f]);
    const [left, right] = decodePcm16(bytes, 2);
    expect(Array.from(left)).toEqual([10 / 32768]);
    expect(Array.from(right)).toEqual([20 / 32768]);
  });

  it('decodes a full base64 stereo chunk end-to-end', () => {
    const base64 = toBase64(int16leBytes([1000, -1000, 2000, -2000]));
    const [left, right] = decodePcm16(base64ToUint8Array(base64), 2);
    expect(Array.from(left)).toEqual([1000 / 32768, 2000 / 32768]);
    expect(Array.from(right)).toEqual([-1000 / 32768, -2000 / 32768]);
  });
});
