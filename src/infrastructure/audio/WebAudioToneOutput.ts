import * as Tone from 'tone';
import { AudioChunk } from '@application/ports/MusicGenerationPort';
import { AudioOutputPort } from '@application/ports/AudioOutputPort';
import { DomainError } from '@domain/errors/DomainError';
import { base64ToUint8Array, decodePcm16 } from './pcm';

/**
 * Infrastructure implementation of AudioOutputPort.
 *
 * Pipeline:
 *   AudioWorkletNode (pcm-player-processor)
 *     -> Tone.js master chain (gain + limiter for safe output)
 *     -> AudioContext.destination
 *
 * Tone.js shares the same underlying AudioContext as the Web Audio API, so we
 * mount the raw worklet node into Tone's signal graph for effects + transport.
 */
export class WebAudioToneOutput implements AudioOutputPort {
  /** Lyria RealTime streams 48 kHz PCM; the context must match to avoid resampling. */
  private static readonly SAMPLE_RATE = 48_000;
  private static readonly CHANNELS = 2;
  /** Seconds of audio the worklet ring buffer can hold (jitter headroom). */
  private static readonly RING_SECONDS = 8;
  /** Default chunks to pre-roll before playback starts (absorbs jitter). */
  private static readonly PREROLL_CHUNKS = 3;

  private worklet: AudioWorkletNode | null = null;
  private gain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private initialized = false;
  /** The rate the AudioContext actually came up at (may differ from requested). */
  private actualSampleRate = WebAudioToneOutput.SAMPLE_RATE;
  private rateMismatchWarned = false;

  constructor(
    private readonly workletUrl = '/worklets/pcm-player-processor.js',
    /** Pre-roll depth: chunks buffered before playback begins (configurable). */
    private readonly prerollChunks: number = WebAudioToneOutput.PREROLL_CHUNKS,
  ) {}

  async resume(): Promise<void> {
    try {
      if (!this.initialized) {
        await this.init();
      }
      // Tone.start() resumes the (suspended) AudioContext after a user gesture.
      await Tone.start();
      await Tone.getContext().resume();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  private async init(): Promise<void> {
    // Pin a dedicated 48 kHz context so playback matches Lyria's 48 kHz PCM
    // sample-for-sample. ContextOptions has no sampleRate field, so we build a
    // native AudioContext with the rate and let Tone wrap it.
    const rawContext = new AudioContext({
      sampleRate: WebAudioToneOutput.SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    Tone.setContext(rawContext);

    // The browser may not honor the requested rate (some hardware forces
    // 44.1 kHz). `context.sampleRate` is the real rate the worklet emits at.
    this.actualSampleRate = rawContext.sampleRate;
    if (this.actualSampleRate !== WebAudioToneOutput.SAMPLE_RATE) {
      console.warn(
        `[audio] requested ${WebAudioToneOutput.SAMPLE_RATE} Hz but the AudioContext ` +
          `came up at ${this.actualSampleRate} Hz; 48 kHz streams will be repitched ` +
          `by the browser's resampler.`,
      );
    }

    await rawContext.audioWorklet.addModule(this.workletUrl);
    this.worklet = new AudioWorkletNode(rawContext, 'pcm-player-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [WebAudioToneOutput.CHANNELS],
      processorOptions: {
        channelCount: WebAudioToneOutput.CHANNELS,
        ringSeconds: WebAudioToneOutput.RING_SECONDS,
        prerollChunks: this.prerollChunks,
      },
    });

    this.limiter = new Tone.Limiter(-1);
    this.gain = new Tone.Gain(0.8);

    // Bridge the raw worklet node into the Tone.js graph.
    Tone.connect(this.worklet, this.gain);
    this.gain.connect(this.limiter);
    this.limiter.toDestination();

    this.initialized = true;
  }

  enqueue(chunk: AudioChunk): void {
    if (!this.worklet) {
      // Silently ignore until the graph is initialized via resume().
      return;
    }
    this.verifySampleRate(chunk.sampleRate);
    const bytes = base64ToUint8Array(chunk.data);
    const channels = decodePcm16(bytes, chunk.channels);
    // Transfer the underlying buffers to the audio thread to avoid copies.
    const transferables = channels.map((c) => c.buffer);
    this.worklet.port.postMessage({ type: 'chunk', channels }, transferables);
  }

  /**
   * Pitch is correct only when the stream's sample rate matches the rate the
   * AudioContext renders at — otherwise playback is sped up (chipmunk) or
   * slowed. Warn once if they diverge.
   *
   * Fallback if Google ever ships a non-48 kHz stream: tear down and recreate
   * the AudioContext at `streamRate` (the browser resamples to the hardware
   * rate), or resample the chunks to `actualSampleRate` before enqueuing.
   */
  private verifySampleRate(streamRate: number): void {
    if (streamRate === this.actualSampleRate || this.rateMismatchWarned) return;
    this.rateMismatchWarned = true;
    const ratio = (streamRate / this.actualSampleRate).toFixed(3);
    console.warn(
      `[audio] sample-rate mismatch: stream is ${streamRate} Hz but the AudioContext ` +
        `runs at ${this.actualSampleRate} Hz — pitch will be off by ${ratio}×. ` +
        `Fallback: recreate the AudioContext at ${streamRate} Hz (or resample the chunks).`,
    );
  }

  setVolume(level: number): void {
    if (this.gain) {
      this.gain.gain.rampTo(Math.max(0, Math.min(1, level)), 0.05);
    }
  }

  flush(): void {
    this.worklet?.port.postMessage({ type: 'flush' });
  }

  async suspend(): Promise<void> {
    try {
      this.flush();
      // rawContext is typed as AudioContext | OfflineAudioContext; only the
      // realtime AudioContext (which this always is) exposes a no-arg suspend().
      await (Tone.getContext().rawContext as AudioContext).suspend();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Audio output error: ${message}`);
  }
}
