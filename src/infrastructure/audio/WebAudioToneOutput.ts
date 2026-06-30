import * as Tone from 'tone';
import { AudioChunk } from '@application/ports/MusicGenerationPort';
import { AudioOutputPort } from '@application/ports/AudioOutputPort';
import { DomainError } from '@domain/errors/DomainError';
import { base64ToUint8Array, decodePcm16 } from './pcm';

/** One independent playback path (worklet + its own gain) for a single stream. */
interface SourceNode {
  worklet: AudioWorkletNode;
  gain: Tone.Gain;
  /** Chunks received so far (used to gate the crossfade-in until it's flowing). */
  chunks: number;
  state: 'active' | 'pending' | 'retiring';
}

/**
 * Infrastructure implementation of AudioOutputPort.
 *
 * Pipeline (one per source stream):
 *   AudioWorkletNode (pcm-player-processor) -> per-source Tone.Gain
 *     -> master Tone.Gain (volume) -> Tone.Limiter -> AudioContext.destination
 *
 * Tone.js shares the same underlying AudioContext as the Web Audio API, so we
 * mount the raw worklet node into Tone's signal graph for effects + transport.
 *
 * ## Crossfade on reconnect
 * A chunk carries an optional `sourceId`. While it stays the same, all chunks
 * feed one worklet. When the generator transparently reconnects (the ~10-min
 * cap) it tags the new stream with a fresh id; this output then spins up a
 * second worklet and EQUAL-POWER crossfades from the old stream to the new one,
 * so the handoff is heard as a smooth blend instead of a gap or a click. The
 * old stream's already-buffered audio covers the crossfade as its gain ramps to
 * zero, after which its node is retired.
 */
export class WebAudioToneOutput implements AudioOutputPort {
  /** Lyria RealTime streams 48 kHz PCM; the context must match to avoid resampling. */
  private static readonly SAMPLE_RATE = 48_000;
  private static readonly CHANNELS = 2;
  /** Seconds of audio the worklet ring buffer can hold (jitter headroom). */
  private static readonly RING_SECONDS = 8;
  /** Default chunks to pre-roll before playback starts (absorbs jitter). */
  private static readonly PREROLL_CHUNKS = 3;
  /**
   * A crossfade target primes with far fewer chunks than a cold start: the old
   * stream is still playing, so we want the new one audible quickly enough to
   * fade in within the crossfade window.
   */
  private static readonly CROSSFADE_PREROLL_CHUNKS = 1;
  /** Fallback id when a chunk carries no sourceId (single-source playback). */
  private static readonly DEFAULT_SOURCE_ID = 'default';

  private master: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private context: AudioContext | null = null;

  /** Live playback paths keyed by sourceId; normally 1, briefly 2 mid-crossfade. */
  private readonly sources = new Map<string, SourceNode>();
  private currentSourceId: string | null = null;

  private initialized = false;
  /** The rate the AudioContext actually came up at (may differ from requested). */
  private actualSampleRate = WebAudioToneOutput.SAMPLE_RATE;
  private rateMismatchWarned = false;

  constructor(
    private readonly workletUrl = '/worklets/pcm-player-processor.js',
    /** Pre-roll depth: chunks buffered before playback begins (configurable). */
    private readonly prerollChunks: number = WebAudioToneOutput.PREROLL_CHUNKS,
    /** Crossfade duration (seconds) when handing off between source streams. */
    private readonly crossfadeSeconds = 2,
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
    this.context = rawContext;

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

    // Master chain shared by every source: volume -> limiter -> destination.
    this.limiter = new Tone.Limiter(-1);
    this.master = new Tone.Gain(0.8);
    this.master.connect(this.limiter);
    this.limiter.toDestination();

    this.initialized = true;
  }

  enqueue(chunk: AudioChunk): void {
    if (!this.initialized || !this.context || !this.master) {
      // Silently ignore until the graph is initialized via resume().
      return;
    }
    this.verifySampleRate(chunk.sampleRate);

    const sourceId = chunk.sourceId ?? WebAudioToneOutput.DEFAULT_SOURCE_ID;
    const source = this.sources.get(sourceId) ?? this.createSource(sourceId);

    const bytes = base64ToUint8Array(chunk.data);
    const channels = decodePcm16(bytes, chunk.channels);
    // Transfer the underlying buffers to the audio thread to avoid copies.
    const transferables = channels.map((c) => c.buffer);
    source.worklet.port.postMessage({ type: 'chunk', channels }, transferables);
    source.chunks += 1;

    // A pending (newly introduced) source crossfades in once it's actually
    // flowing — i.e. it has buffered enough to start emitting samples.
    if (
      source.state === 'pending' &&
      source.chunks >= WebAudioToneOutput.CROSSFADE_PREROLL_CHUNKS
    ) {
      this.beginCrossfade(sourceId);
    }
  }

  /** Build a new playback path. The first ever source plays at full gain; later
   *  ones (reconnect targets) start silent and crossfade in. */
  private createSource(id: string): SourceNode {
    const context = this.context as AudioContext;
    const isFirst = this.sources.size === 0;

    const worklet = new AudioWorkletNode(context, 'pcm-player-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [WebAudioToneOutput.CHANNELS],
      processorOptions: {
        channelCount: WebAudioToneOutput.CHANNELS,
        ringSeconds: WebAudioToneOutput.RING_SECONDS,
        prerollChunks: isFirst ? this.prerollChunks : WebAudioToneOutput.CROSSFADE_PREROLL_CHUNKS,
      },
    });

    const gain = new Tone.Gain(isFirst ? 1 : 0);
    Tone.connect(worklet, gain);
    gain.connect(this.master as Tone.Gain);

    const node: SourceNode = {
      worklet,
      gain,
      chunks: 0,
      state: isFirst ? 'active' : 'pending',
    };
    this.sources.set(id, node);
    if (isFirst) this.currentSourceId = id;
    return node;
  }

  /** Equal-power crossfade from the current source to `incomingId`. */
  private beginCrossfade(incomingId: string): void {
    const incoming = this.sources.get(incomingId);
    if (!incoming || incoming.state !== 'pending') return;

    const outgoingId = this.currentSourceId;
    const outgoing = outgoingId !== null ? this.sources.get(outgoingId) : undefined;

    incoming.state = 'active';
    this.currentSourceId = incomingId;

    const now = Tone.now();
    const dur = this.crossfadeSeconds;
    // Equal-power curves keep total acoustic power ~constant across the blend
    // (a linear fade would dip ~3 dB in the middle).
    incoming.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueCurveAtTime(equalPowerCurve('in'), now, dur);

    if (outgoing && outgoing !== incoming) {
      outgoing.state = 'retiring';
      outgoing.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.setValueCurveAtTime(equalPowerCurve('out'), now, dur);
      // Retire the old node once it has fully faded out.
      setTimeout(() => this.retireSource(outgoingId as string), dur * 1000 + 150);
    }
  }

  private retireSource(id: string): void {
    const node = this.sources.get(id);
    if (!node || node.state !== 'retiring') return;
    this.sources.delete(id);
    try {
      node.worklet.port.postMessage({ type: 'flush' });
      node.worklet.disconnect();
      node.gain.disconnect();
      node.gain.dispose();
    } catch (err) {
      console.warn('[audio] error retiring source node:', err);
    }
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
    if (this.master) {
      this.master.gain.rampTo(Math.max(0, Math.min(1, level)), 0.05);
    }
  }

  flush(): void {
    for (const node of this.sources.values()) {
      node.worklet.port.postMessage({ type: 'flush' });
    }
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

/**
 * Build an equal-power fade curve. `in` rises 0→1 as sin(t·π/2); `out` falls
 * 1→0 as cos(t·π/2). For correlated-ish streams this holds total power steady,
 * avoiding the mid-fade dip a linear crossfade produces.
 */
function equalPowerCurve(direction: 'in' | 'out', points = 64): number[] {
  const curve = new Array<number>(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const angle = t * (Math.PI / 2);
    curve[i] = direction === 'in' ? Math.sin(angle) : Math.cos(angle);
  }
  return curve;
}
