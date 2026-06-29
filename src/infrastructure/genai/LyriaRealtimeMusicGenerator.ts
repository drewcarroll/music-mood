import { GoogleGenAI } from '@google/genai';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { DomainError } from '@domain/errors/DomainError';
import {
  MusicGenerationPort,
  MusicGenerationCallbacks,
} from '@application/ports/MusicGenerationPort';

/**
 * Infrastructure adapter that implements MusicGenerationPort using
 * Google's Lyria RealTime model via the @google/genai SDK.
 *
 * All SDK-specific knowledge is confined here. Raw SDK errors are caught and
 * re-thrown as DomainError so outer layers never depend on SDK exception types.
 *
 * Lyria RealTime streams 48kHz, 16-bit, stereo PCM audio over a live session.
 */
export class LyriaRealtimeMusicGenerator implements MusicGenerationPort {
  private static readonly SAMPLE_RATE = 48_000;
  private static readonly CHANNELS = 2;

  private readonly client: GoogleGenAI;
  // The live music session object returned by the SDK is loosely typed across
  // SDK versions; we keep a minimal local shape to avoid leaking `any`.
  private session: LyriaSession | null = null;
  private callbacks: MusicGenerationCallbacks | null = null;

  constructor(
    apiKey: string,
    private readonly model: string = 'models/lyria-realtime-exp',
  ) {
    if (!apiKey) {
      throw new DomainError('A Gemini API key is required to start the music generator.');
    }
    this.client = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
  }

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.callbacks = callbacks;
    try {
      // The live music API surface lives under client.live.music in @google/genai.
      const live = (this.client as unknown as { live: { music: LyriaLiveMusic } }).live.music;
      this.session = await live.connect({
        model: this.model,
        callbacks: {
          onmessage: (message: LyriaServerMessage) => {
            const chunks = message.serverContent?.audioChunks ?? [];
            for (const chunk of chunks) {
              callbacks.onAudioChunk({
                data: chunk.data,
                sampleRate: LyriaRealtimeMusicGenerator.SAMPLE_RATE,
                channels: LyriaRealtimeMusicGenerator.CHANNELS,
              });
            }
          },
          onerror: (err: unknown) => callbacks.onError(this.toDomainError(err)),
          onclose: () => callbacks.onClosed?.(),
        },
      });
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async setPrompts(prompts: readonly MusicPrompt[]): Promise<void> {
    this.ensureSession();
    try {
      await this.session!.setWeightedPrompts({
        weightedPrompts: prompts.map((p) => ({ text: p.text, weight: p.weight })),
      });
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async play(): Promise<void> {
    this.ensureSession();
    try {
      await this.session!.play();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async pause(): Promise<void> {
    this.ensureSession();
    try {
      await this.session!.pause();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async stop(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.stop();
      this.session.close?.();
    } catch (err) {
      throw this.toDomainError(err);
    } finally {
      this.session = null;
      this.callbacks = null;
    }
  }

  private ensureSession(): void {
    if (!this.session) {
      throw new DomainError('Music generation session is not connected. Call connect() first.');
    }
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Lyria RealTime error: ${message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Minimal local typings for the Lyria live-music surface. These keep
 * the adapter strongly typed without leaking SDK internals or `any`.
 * ------------------------------------------------------------------ */

interface WeightedPromptInput {
  weightedPrompts: Array<{ text: string; weight: number }>;
}

interface LyriaServerMessage {
  serverContent?: {
    audioChunks?: Array<{ data: string }>;
  };
}

interface LyriaSession {
  setWeightedPrompts(input: WeightedPromptInput): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  close?(): void;
}

interface LyriaLiveMusic {
  connect(config: {
    model: string;
    callbacks: {
      onmessage: (message: LyriaServerMessage) => void;
      onerror: (err: unknown) => void;
      onclose: () => void;
    };
  }): Promise<LyriaSession>;
}
