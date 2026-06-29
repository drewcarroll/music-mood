/**
 * Helpers for decoding the base64 16-bit PCM payload streamed by
 * Lyria RealTime into per-channel Float32 frames suitable for the
 * AudioWorklet ring buffer.
 */

/** Full-scale divisor for signed 16-bit PCM: -32768 maps to exactly -1.0. */
const INT16_SCALE = 32768;

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert interleaved 16-bit signed PCM into one Float32Array per channel,
 * normalized to the [-1, 1] range expected by the Web Audio graph.
 *
 * The bytes are reinterpreted as little-endian `Int16Array` samples (the format
 * Lyria streams; all target browsers run little-endian) and de-interleaved:
 * for stereo the stream is L,R,L,R,… so even samples feed channel 0 and odd
 * samples feed channel 1.
 */
export function decodePcm16(bytes: Uint8Array, channels: number): Float32Array[] {
  // Int16Array requires a 2-byte-aligned offset. The base64 decoder hands us a
  // fresh offset-0 buffer, but copy into one if a caller passes a misaligned
  // (or odd-length) view so the reinterpretation stays safe.
  const usable = bytes.byteLength - (bytes.byteLength % 2);
  const aligned =
    bytes.byteOffset % 2 === 0 && usable === bytes.byteLength
      ? bytes
      : new Uint8Array(bytes.subarray(0, usable));

  const samples = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 1);
  const framesPerChannel = Math.floor(samples.length / channels);

  const output: Float32Array[] = Array.from(
    { length: channels },
    () => new Float32Array(framesPerChannel),
  );

  for (let frame = 0; frame < framesPerChannel; frame++) {
    const base = frame * channels;
    for (let ch = 0; ch < channels; ch++) {
      output[ch][frame] = samples[base + ch] / INT16_SCALE;
    }
  }

  return output;
}
