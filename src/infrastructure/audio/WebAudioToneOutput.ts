import * as Tone from 'tone';
import { AudioChunk } from '@application/ports/MusicGenerationPort';
import { AudioOutputPort } from '@application/ports/AudioOutputPort';
import { DomainError } from '@domain/errors/DomainError';
import { base64ToUint8Array, decodePcm16 } from './pcm';

/**
 * Lyria RealTime streams 48kHz stereo PCM. The AudioContext is created at this
 * exact rate so samples play at the correct pitch with no resampling — a
 * sample-rate mismatch is the first thing to suspect if pitch sounds wrong.
 */
const STREAM_SAMPLE_RATE = 48000;
const OUTPUT_CHANNELS = 2;
/** Pre-buffer this much audio before playback starts (absorbs jitter). */
const PRIME_SECONDS = 1.5;
/** Ring buffer headroom; bounds how far the producer may run ahead. */
const CAPACITY_SECONDS = 12;

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
  private worklet: AudioWorkletNode | null = null;
  private gain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private initialized = false;

  constructor(private readonly workletUrl = '/worklets/pcm-player-processor.js') {}

  async resume(): Promise<void> {
    try {
      if (!this.initialized) {
        await this.init();
      } else {
        await Tone.getContext().resume();
      }
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  private async init(): Promise<void> {
    // Create the context at the stream's native 48kHz and adopt it into Tone
    // BEFORE any Tone node is built, so the whole graph runs at this rate.
    const rawContext = new AudioContext({
      sampleRate: STREAM_SAMPLE_RATE,
      latencyHint: 'playback',
    });
    Tone.setContext(rawContext);

    // Tone.start() resumes the (suspended) AudioContext after a user gesture.
    await Tone.start();

    if (rawContext.sampleRate !== STREAM_SAMPLE_RATE) {
      // Some platforms refuse a forced rate; the graph still runs, but pitch
      // will be off — make the mismatch loud rather than silently wrong.
      console.warn(
        `AudioContext sample rate is ${rawContext.sampleRate}Hz, expected ` +
          `${STREAM_SAMPLE_RATE}Hz — suspect a sample-rate mismatch first.`,
      );
    }

    await rawContext.audioWorklet.addModule(this.workletUrl);
    this.worklet = new AudioWorkletNode(rawContext, 'pcm-player-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [OUTPUT_CHANNELS],
      processorOptions: {
        channelCount: OUTPUT_CHANNELS,
        primeFrames: Math.floor(rawContext.sampleRate * PRIME_SECONDS),
        capacityFrames: Math.floor(rawContext.sampleRate * CAPACITY_SECONDS),
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
      const rawContext = Tone.getContext().rawContext as unknown as AudioContext;
      await rawContext.suspend();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Audio output error: ${message}`);
  }
}
