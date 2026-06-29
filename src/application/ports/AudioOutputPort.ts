import { AudioChunk } from './MusicGenerationPort';

/**
 * PORT for audio playback. Implemented in infrastructure using the
 * Web Audio API, an AudioWorklet, and Tone.js for effects/transport.
 * The application orchestrates playback through this abstraction only.
 */
export interface AudioOutputPort {
  /** Initialize/resume the audio context (must be triggered by a user gesture). */
  resume(): Promise<void>;

  /** Enqueue a decoded audio chunk for gapless playback. */
  enqueue(chunk: AudioChunk): void;

  /** Master volume in the range [0, 1]. */
  setVolume(level: number): void;

  /** Flush any buffered audio (used when steering to a new mood). */
  flush(): void;

  /** Suspend playback and release resources. */
  suspend(): Promise<void>;
}
