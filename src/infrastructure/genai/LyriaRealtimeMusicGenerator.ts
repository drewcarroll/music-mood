import { GoogleGenAI, type LiveMusicSession, type LiveMusicServerMessage } from '@google/genai';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { DomainError } from '@domain/errors/DomainError';
import {
  MusicGenerationPort,
  MusicGenerationCallbacks,
  MusicGenerationConfig,
} from '@application/ports/MusicGenerationPort';

/**
 * Configuration seeded onto a freshly-opened session so the stream begins
 * flowing immediately, before any mood-driven steering arrives.
 */
export interface LyriaSessionDefaults {
  /** A single hardcoded weighted prompt sent via setWeightedPrompts. */
  initialPrompt: { text: string; weight: number };
  /** Generation parameters (bpm, guidance, density, brightness). */
  generationConfig: MusicGenerationConfig;
}

/**
 * Infrastructure adapter that implements MusicGenerationPort using
 * Google's Lyria RealTime model via the @google/genai SDK.
 *
 * All SDK-specific knowledge is confined here. Raw SDK errors are caught and
 * re-thrown as DomainError so outer layers never depend on SDK exception types.
 *
 * The Lyria RealTime live-music API lives under `ai.live.music` and is only
 * served on the `v1alpha` API version. It streams 48kHz, 16-bit, stereo PCM
 * audio as a sequence of base64 audioChunks.
 */
export class LyriaRealtimeMusicGenerator implements MusicGenerationPort {
  private static readonly SAMPLE_RATE = 48_000;
  private static readonly CHANNELS = 2;
  /** Log every Nth audio chunk so we confirm flow without spamming the console. */
  private static readonly LOG_EVERY = 25;

  private readonly client: GoogleGenAI;
  private session: LiveMusicSession | null = null;
  private chunkCount = 0;

  constructor(
    apiKey: string,
    private readonly model: string = 'models/lyria-realtime-exp',
    private readonly defaults?: LyriaSessionDefaults,
  ) {
    if (!apiKey) {
      throw new DomainError('A Gemini API key is required to start the music generator.');
    }
    // Lyria RealTime is only exposed on the v1alpha surface.
    this.client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  }

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.chunkCount = 0;
    try {
      this.session = await this.client.live.music.connect({
        model: this.model,
        callbacks: {
          onmessage: (message: LiveMusicServerMessage) => {
            const chunks = message.serverContent?.audioChunks ?? [];
            for (const chunk of chunks) {
              if (!chunk.data) continue;
              this.logChunk(chunk.data);
              callbacks.onAudioChunk({
                data: chunk.data,
                sampleRate: LyriaRealtimeMusicGenerator.SAMPLE_RATE,
                channels: LyriaRealtimeMusicGenerator.CHANNELS,
              });
            }
          },
          onerror: (err) => callbacks.onError(this.toDomainError(err)),
          onclose: () => callbacks.onClosed?.(),
        },
      });
      console.info(`[Lyria] connected to ${this.model} (v1alpha)`);

      // Seed the session so the stream is ready to flow the moment play() is
      // called: a single hardcoded weighted prompt plus the generation config.
      if (this.defaults) {
        await this.setPrompts([
          MusicPrompt.create(this.defaults.initialPrompt.text, this.defaults.initialPrompt.weight),
        ]);
        await this.setGenerationConfig(this.defaults.generationConfig);
      }
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async setPrompts(prompts: readonly MusicPrompt[]): Promise<void> {
    const session = this.ensureSession();
    try {
      await session.setWeightedPrompts({
        weightedPrompts: prompts.map((p) => ({ text: p.text, weight: p.weight })),
      });
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async setGenerationConfig(config: MusicGenerationConfig): Promise<void> {
    const session = this.ensureSession();
    try {
      await session.setMusicGenerationConfig({ musicGenerationConfig: config });
      console.info('[Lyria] generation config applied:', config);
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async play(): Promise<void> {
    const session = this.ensureSession();
    try {
      session.play();
      console.info('[Lyria] play() — stream started');
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async pause(): Promise<void> {
    const session = this.ensureSession();
    try {
      session.pause();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async stop(): Promise<void> {
    if (!this.session) return;
    try {
      this.session.stop();
      this.session.close();
    } catch (err) {
      throw this.toDomainError(err);
    } finally {
      this.session = null;
    }
  }

  /** Confirm the stream is flowing without flooding the console. */
  private logChunk(data: string): void {
    this.chunkCount += 1;
    if (this.chunkCount === 1 || this.chunkCount % LyriaRealtimeMusicGenerator.LOG_EVERY === 0) {
      // base64 length ~ 4/3 of decoded bytes; close enough for a flow indicator.
      const approxBytes = Math.floor((data.length * 3) / 4);
      console.info(
        `[Lyria] audioChunk #${this.chunkCount} (~${approxBytes} bytes PCM) — stream flowing`,
      );
    }
  }

  private ensureSession(): LiveMusicSession {
    if (!this.session) {
      throw new DomainError('Music generation session is not connected. Call connect() first.');
    }
    return this.session;
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Lyria RealTime error: ${message}`);
  }
}
