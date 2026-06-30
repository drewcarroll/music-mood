import {
  GoogleGenAI,
  Scale,
  type LiveMusicSession,
  type LiveMusicServerMessage,
  type LiveMusicGenerationConfig,
} from '@google/genai';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { DomainError } from '@domain/errors/DomainError';
import {
  MusicGenerationPort,
  MusicGenerationCallbacks,
  MusicGenerationConfig,
} from '@application/ports/MusicGenerationPort';
import { parsePcmMimeType, CANONICAL_PCM_FORMAT, type PcmFormat } from '../audio/pcm';
import type { GeminiAuthProvider } from './auth/GeminiAuthProvider';

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
  /** Log every Nth audio chunk so we confirm flow without spamming the console. */
  private static readonly LOG_EVERY = 25;

  private client: GoogleGenAI | null = null;
  private session: LiveMusicSession | null = null;
  private chunkCount = 0;
  private formatConfirmed = false;

  /**
   * @param authProvider Resolves the credential handed to the SDK — either the
   *   raw API key (local dev) or a freshly minted ephemeral token (semi-public).
   *   The credential is resolved per-connect rather than at construction so
   *   single-use, short-lived ephemeral tokens are always fresh.
   */
  constructor(
    private readonly authProvider: GeminiAuthProvider,
    private readonly model: string = 'models/lyria-realtime-exp',
    private readonly defaults?: LyriaSessionDefaults,
  ) {}

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.chunkCount = 0;
    try {
      // Resolve a fresh credential and (re)build the client. Lyria RealTime is
      // only exposed on the v1alpha surface.
      const credential = await this.authProvider.getCredential();
      this.client = new GoogleGenAI({
        apiKey: credential,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      this.session = await this.client.live.music.connect({
        model: this.model,
        callbacks: {
          onmessage: (message: LiveMusicServerMessage) => {
            const chunks = message.serverContent?.audioChunks ?? [];
            for (const chunk of chunks) {
              if (!chunk.data) continue;
              this.logChunk(chunk.data);
              // Verify the format against the actual chunk metadata rather than
              // assuming it: the de-interleaver and the AudioContext both depend
              // on the true sample rate / channel count.
              const format = this.confirmFormat(chunk.mimeType);
              callbacks.onAudioChunk({
                data: chunk.data,
                sampleRate: format.sampleRate,
                channels: format.channels,
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
      await session.setMusicGenerationConfig({
        musicGenerationConfig: this.toSdkConfig(config),
      });
      console.info('[Lyria] generation config applied:', config);
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  /**
   * Map our plain-number config onto the SDK shape. Only the fields the caller
   * actually set are forwarded, so a steering call carrying just density +
   * brightness never resends bpm/scale (which would reset the model's context).
   * `scale` arrives as a plain string and is mapped onto the SDK's Scale enum.
   */
  private toSdkConfig(config: MusicGenerationConfig): LiveMusicGenerationConfig {
    const sdkConfig: LiveMusicGenerationConfig = {};
    if (config.bpm !== undefined) sdkConfig.bpm = config.bpm;
    if (config.guidance !== undefined) sdkConfig.guidance = config.guidance;
    if (config.density !== undefined) sdkConfig.density = config.density;
    if (config.brightness !== undefined) sdkConfig.brightness = config.brightness;
    if (config.scale !== undefined) sdkConfig.scale = config.scale as Scale;
    return sdkConfig;
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

  /**
   * Resolve the PCM format from the chunk's mime type and, the first time,
   * confirm it in the log — warning if it deviates from the canonical
   * 48 kHz / stereo / 16-bit we treat as the source of truth for pitch.
   */
  private confirmFormat(mimeType: string | null | undefined): PcmFormat {
    const format = parsePcmMimeType(mimeType);
    if (!this.formatConfirmed) {
      this.formatConfirmed = true;
      console.info(
        `[Lyria] audio format: "${mimeType ?? 'unspecified'}" → ${format.sampleRate} Hz, ` +
          `${format.channels}ch, ${format.bitsPerSample}-bit PCM`,
      );
      const c = CANONICAL_PCM_FORMAT;
      if (
        format.sampleRate !== c.sampleRate ||
        format.channels !== c.channels ||
        format.bitsPerSample !== c.bitsPerSample
      ) {
        console.warn(
          `[Lyria] stream format differs from the canonical ${c.sampleRate} Hz / ` +
            `${c.channels}ch / ${c.bitsPerSample}-bit. The AudioContext must run at ` +
            `${format.sampleRate} Hz for correct pitch, and the decoder assumes 16-bit.`,
        );
      }
    }
    return format;
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
