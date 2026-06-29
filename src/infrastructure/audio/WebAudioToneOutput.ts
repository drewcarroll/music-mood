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

  private worklet: AudioWorkletNode | null = null;
  private gain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private initialized = false;

  constructor(private readonly workletUrl = '/worklets/pcm-player-processor.js') {}

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

    await rawContext.audioWorklet.addModule(this.workletUrl);
    this.worklet = new AudioWorkletNode(rawContext, 'pcm-player-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [WebAudioToneOutput.CHANNELS],
      processorOptions: {
        channelCount: WebAudioToneOutput.CHANNELS,
        ringSeconds: WebAudioToneOutput.RING_SECONDS,
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
    const bytes = base64ToUint8Array(chunk.data);
    const channels = decodePcm16(bytes, chunk.channels);
    // Transfer the underlying buffers to the audio thread to avoid copies.
    const transferables = channels.map((c) => c.buffer);
    this.worklet.port.postMessage({ type: 'chunk', channels }, transferables);
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
