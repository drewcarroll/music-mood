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
 * Real-time generation knobs understood by Lyria RealTime. All fields are
 * optional so a caller can tweak a single parameter without resending the
 * whole config. The application speaks in plain numbers; mapping them onto the
 * SDK's config shape is an infrastructure concern.
 */
export interface MusicGenerationConfig {
  /**
   * Beats per minute. Pin this for the whole performance — changing bpm
   * mid-stream forces the model to reset_context(), an audible seam.
   */
  bpm?: number;
  /**
   * How strictly the model adheres to the prompts. Higher follows prompts more
   * closely but makes transitions more ABRUPT; keep it low (~2–3) so weighted
   * blends morph gently. Set once at connect.
   */
  guidance?: number;
  /** Density of musical events (0..1). Used as a live secondary morph control. */
  density?: number;
  /** Tonal brightness (0..1). Used as a live secondary morph control. */
  brightness?: number;
  /**
   * Musical scale (key/mode), e.g. "C_MAJOR_A_MINOR". A plain string here; the
   * infrastructure adapter maps it onto the SDK's Scale enum. Like bpm, pin it
   * for the performance — changing scale mid-stream also resets context.
   */
  scale?: string;
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

  /** Update the real-time generation parameters (bpm, guidance, density, ...). */
  setGenerationConfig(config: MusicGenerationConfig): Promise<void>;

  /** Begin / resume streaming generation. */
  play(): Promise<void>;

  /** Pause streaming generation. */
  pause(): Promise<void>;

  /** Stop and tear down the streaming session. */
  stop(): Promise<void>;
}
