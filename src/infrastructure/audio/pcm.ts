/**
 * Helpers for decoding the base64 16-bit PCM payload streamed by
 * Lyria RealTime into per-channel Float32 frames suitable for the
 * AudioWorklet ring buffer.
 */

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
 */
export function decodePcm16(bytes: Uint8Array, channels: number): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalSamples = bytes.byteLength / 2;
  const framesPerChannel = Math.floor(totalSamples / channels);

  const output: Float32Array[] = Array.from(
    { length: channels },
    () => new Float32Array(framesPerChannel),
  );

  for (let frame = 0; frame < framesPerChannel; frame++) {
    for (let ch = 0; ch < channels; ch++) {
      const sampleIndex = frame * channels + ch;
      const int16 = view.getInt16(sampleIndex * 2, true);
      output[ch][frame] = int16 / 32768;
    }
  }

  return output;
}
