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
import {
  DEFAULT_RECONNECTION,
  resolveReconnection,
  type ReconnectionOptions,
} from './reconnectionSchedule';

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

/** One live Lyria connection, tagged so the audio output can tell streams apart. */
interface SessionHandle {
  /** Stable source id used to tag this stream's audio chunks. */
  readonly id: string;
  readonly session: LiveMusicSession;
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
 *
 * ## Transparent reconnection (~10-minute cap)
 * A Lyria session is capped at ~10 minutes. To keep a long demo from cutting
 * out, this adapter opens a REPLACEMENT session before the cap, re-seeds it with
 * the current prompts + config, lets it settle (~5–10s) while the old stream
 * keeps playing, then HANDS OFF by tagging audio chunks with the new session's
 * source id. The audio output crossfades on that id change, so the reconnect is
 * heard as a smooth blend rather than a gap. See `reconnectionSchedule.ts` for
 * the timing policy. This lifecycle management is a transport concern and so
 * lives here, the same way reconnect/retry logic lives in any WebSocket client.
 */
export class LyriaRealtimeMusicGenerator implements MusicGenerationPort {
  /** Log every Nth audio chunk so we confirm flow without spamming the console. */
  private static readonly LOG_EVERY = 25;

  private client: GoogleGenAI | null = null;
  private callbacks: MusicGenerationCallbacks | null = null;

  /** All currently-open sessions (1 normally; 2 briefly during a handoff). */
  private sessions: SessionHandle[] = [];
  /** The session whose chunks are currently forwarded to the audio output. */
  private activeId: string | null = null;
  private sourceSeq = 0;

  /** Last prompts/config applied, replayed onto a freshly-opened session. */
  private lastPrompts: MusicPrompt[] = [];
  private lastConfig: MusicGenerationConfig = {};

  private playing = false;
  /** A reconnect came due while paused; run it as soon as we play again. */
  private reconnectPending = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private chunkCount = 0;
  private formatConfirmed = false;
  private readonly reconnection: ReconnectionOptions;

  /**
   * @param authProvider Resolves the credential handed to the SDK — either the
   *   raw API key (local dev) or a freshly minted ephemeral token (semi-public).
   *   The credential is resolved per-connect rather than at construction so
   *   single-use, short-lived ephemeral tokens are always fresh.
   * @param reconnection Timing policy for transparent reconnection; clamped so
   *   the whole handoff always finishes before the ~10-minute cap.
   */
  constructor(
    private readonly authProvider: GeminiAuthProvider,
    private readonly model: string = 'models/lyria-realtime-exp',
    private readonly defaults?: LyriaSessionDefaults,
    reconnection: ReconnectionOptions = DEFAULT_RECONNECTION,
  ) {
    this.reconnection = resolveReconnection(reconnection);
  }

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.chunkCount = 0;
    this.callbacks = callbacks;
    try {
      // Resolve a fresh credential and (re)build the client. Lyria RealTime is
      // only exposed on the v1alpha surface.
      const credential = await this.authProvider.getCredential();
      this.client = new GoogleGenAI({
        apiKey: credential,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      const handle = await this.openSession();
      this.sessions = [handle];
      this.activeId = handle.id;
      console.info(`[Lyria] connected to ${this.model} (v1alpha) as source "${handle.id}"`);

      // Seed the session so the stream is ready to flow the moment play() is
      // called: a single hardcoded weighted prompt plus the generation config.
      if (this.defaults) {
        this.lastPrompts = [
          MusicPrompt.create(this.defaults.initialPrompt.text, this.defaults.initialPrompt.weight),
        ];
        this.lastConfig = { ...this.defaults.generationConfig };
        await handle.session.setWeightedPrompts({
          weightedPrompts: this.lastPrompts.map((p) => ({ text: p.text, weight: p.weight })),
        });
        await handle.session.setMusicGenerationConfig({
          musicGenerationConfig: this.toSdkConfig(this.lastConfig),
        });
      }

      this.scheduleReconnect();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  /** Open a new live session, wiring its messages to the chunk forwarder. */
  private async openSession(): Promise<SessionHandle> {
    if (!this.client) {
      throw new DomainError('Music generation client is not initialized.');
    }
    const id = `lyria-${++this.sourceSeq}`;
    const session = await this.client.live.music.connect({
      model: this.model,
      callbacks: {
        onmessage: (message: LiveMusicServerMessage) => this.onMessage(id, message),
        onerror: (err) => this.callbacks?.onError(this.toDomainError(err)),
        onclose: () => this.callbacks?.onClosed?.(),
      },
    });
    return { id, session };
  }

  /** Route one server message's chunks to the audio output — but only if this
   *  source is the active one. A warming-up replacement's chunks are dropped
   *  until the handoff promotes it, so the two streams never double up. */
  private onMessage(sourceId: string, message: LiveMusicServerMessage): void {
    if (sourceId !== this.activeId) return;
    const chunks = message.serverContent?.audioChunks ?? [];
    for (const chunk of chunks) {
      if (!chunk.data) continue;
      this.logChunk(chunk.data);
      // Verify the format against the actual chunk metadata rather than
      // assuming it: the de-interleaver and the AudioContext both depend on
      // the true sample rate / channel count.
      const format = this.confirmFormat(chunk.mimeType);
      this.callbacks?.onAudioChunk({
        data: chunk.data,
        sampleRate: format.sampleRate,
        channels: format.channels,
        sourceId,
      });
    }
  }

  async setPrompts(prompts: readonly MusicPrompt[]): Promise<void> {
    this.ensureLive();
    // Remember so a freshly-opened replacement session sounds identical, and
    // apply to every live session so the incoming one stays in sync.
    this.lastPrompts = [...prompts];
    const weightedPrompts = prompts.map((p) => ({ text: p.text, weight: p.weight }));
    try {
      await Promise.all(
        this.sessions.map((h) => h.session.setWeightedPrompts({ weightedPrompts })),
      );
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async setGenerationConfig(config: MusicGenerationConfig): Promise<void> {
    this.ensureLive();
    // Merge into the remembered config (steers send only density/brightness) so
    // the full config can be replayed onto a replacement session.
    this.lastConfig = { ...this.lastConfig, ...config };
    const musicGenerationConfig = this.toSdkConfig(config);
    try {
      await Promise.all(
        this.sessions.map((h) => h.session.setMusicGenerationConfig({ musicGenerationConfig })),
      );
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
    this.ensureLive();
    this.playing = true;
    try {
      for (const h of this.sessions) h.session.play();
      console.info('[Lyria] play() — stream started');
    } catch (err) {
      throw this.toDomainError(err);
    }
    // A reconnect fell due while paused — run it now that we're playing again.
    if (this.reconnectPending) {
      this.reconnectPending = false;
      this.beginReconnect();
    }
  }

  async pause(): Promise<void> {
    this.ensureLive();
    this.playing = false;
    try {
      for (const h of this.sessions) h.session.pause();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async stop(): Promise<void> {
    this.clearTimers();
    this.playing = false;
    const sessions = this.sessions;
    this.sessions = [];
    this.activeId = null;
    try {
      for (const h of sessions) {
        h.session.stop();
        h.session.close();
      }
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  // ── Transparent reconnection ───────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.clearTimer('reconnectTimer');
    this.reconnectTimer = setTimeout(
      () => this.beginReconnect(),
      this.reconnection.reconnectAfterMs,
    );
  }

  /** Open a replacement session ahead of the cap and warm it up. */
  private beginReconnect(): void {
    // Only one handoff at a time; defer if a reconnect is mid-flight.
    if (this.sessions.length !== 1 || this.activeId === null) return;
    // Don't burn a fresh session while paused — run it on the next play().
    if (!this.playing) {
      this.reconnectPending = true;
      return;
    }

    void (async () => {
      try {
        const incoming = await this.openSession();
        this.sessions.push(incoming);
        // Seed the replacement with the CURRENT prompts/config and start it so it
        // is producing audio by the time we hand off. Its chunks are dropped
        // until promotion (onMessage gates on activeId), so the streams don't
        // double up while it settles.
        await incoming.session.setWeightedPrompts({
          weightedPrompts: this.lastPrompts.map((p) => ({ text: p.text, weight: p.weight })),
        });
        await incoming.session.setMusicGenerationConfig({
          musicGenerationConfig: this.toSdkConfig(this.lastConfig),
        });
        incoming.session.play();
        console.info(
          `[Lyria] replacement source "${incoming.id}" opened; settling ${this.reconnection.settleMs}ms before handoff`,
        );

        // Give the replacement 5–10s to settle into a coherent stream, then hand off.
        this.clearTimer('settleTimer');
        this.settleTimer = setTimeout(() => this.handoff(incoming.id), this.reconnection.settleMs);
      } catch (err) {
        // A failed reconnect must not kill the still-playing current stream.
        console.error('[Lyria] transparent reconnect failed; staying on current session:', err);
        this.rollbackIncoming();
        // Try again shortly so we still beat the cap.
        this.clearTimer('reconnectTimer');
        this.reconnectTimer = setTimeout(() => this.beginReconnect(), this.reconnection.settleMs);
      }
    })();
  }

  /** Promote the replacement to active and retire the old session after the crossfade. */
  private handoff(incomingId: string): void {
    const outgoing = this.sessions.find((h) => h.id === this.activeId);
    const incoming = this.sessions.find((h) => h.id === incomingId);
    if (!incoming || !outgoing || outgoing.id === incomingId) return;

    // Flip the active source: from now on the audio output receives the new
    // stream's chunks (tagged with its id) and crossfades onto it. The old
    // stream stops being forwarded; its already-buffered audio covers the
    // crossfade as the output ramps its gain to zero.
    this.activeId = incomingId;
    console.info(
      `[Lyria] handoff "${outgoing.id}" → "${incomingId}" (crossfade ${this.reconnection.crossfadeMs}ms)`,
    );

    // Close the old session once the crossfade has finished.
    this.clearTimer('closeTimer');
    this.closeTimer = setTimeout(() => {
      this.sessions = this.sessions.filter((h) => h.id !== outgoing.id);
      try {
        outgoing.session.stop();
        outgoing.session.close();
      } catch (err) {
        console.warn('[Lyria] error closing retired session:', err);
      }
      // Schedule the next reconnect relative to the new session's promotion.
      this.scheduleReconnect();
    }, this.reconnection.crossfadeMs + 500);
  }

  /** Tear down a half-opened replacement after a failed reconnect attempt. */
  private rollbackIncoming(): void {
    if (this.activeId === null) return;
    const stale = this.sessions.filter((h) => h.id !== this.activeId);
    this.sessions = this.sessions.filter((h) => h.id === this.activeId);
    for (const h of stale) {
      try {
        h.session.stop();
        h.session.close();
      } catch {
        // best-effort cleanup
      }
    }
  }

  private clearTimers(): void {
    this.clearTimer('reconnectTimer');
    this.clearTimer('settleTimer');
    this.clearTimer('closeTimer');
    this.reconnectPending = false;
  }

  private clearTimer(name: 'reconnectTimer' | 'settleTimer' | 'closeTimer'): void {
    const timer = this[name];
    if (timer !== null) {
      clearTimeout(timer);
      this[name] = null;
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

  private ensureLive(): void {
    if (this.sessions.length === 0) {
      throw new DomainError('Music generation session is not connected. Call connect() first.');
    }
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Lyria RealTime error: ${message}`);
  }
}
