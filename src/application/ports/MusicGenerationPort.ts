import { MusicPrompt } from '@domain/value-objects/MusicPrompt';

/**
 * A chunk of raw audio emitted by the generative-music engine.
 * The application speaks only in terms of plain numbers / bytes;
 * how it is decoded and played back is an infrastructure concern.
 */
export interface AudioChunk {
  /** Base64-encoded PCM/audio payload as delivered by the model. */
  data: string;
  /** Sample rate in Hz (Lyria RealTime streams 48kHz stereo). */
  sampleRate: number;
  /** Number of interleaved channels. */
  channels: number;
}

export interface MusicGenerationCallbacks {
  onAudioChunk: (chunk: AudioChunk) => void;
  onError: (error: Error) => void;
  onClosed?: () => void;
}

/**
 * PORT (driven interface) for a real-time generative music engine such as
 * Lyria RealTime. The application defines this contract; infrastructure
 * implements it with the @google/genai SDK. The application never imports
 * the SDK directly.
 */
export interface MusicGenerationPort {
  /** Open a streaming session and begin receiving audio chunks. */
  connect(callbacks: MusicGenerationCallbacks): Promise<void>;

  /** Replace the active weighted prompts (steers the generated music). */
  setPrompts(prompts: readonly MusicPrompt[]): Promise<void>;

  /** Begin / resume streaming generation. */
  play(): Promise<void>;

  /** Pause streaming generation. */
  pause(): Promise<void>;

  /** Stop and tear down the streaming session. */
  stop(): Promise<void>;
}
