import * as Tone from 'tone';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { DomainError } from '@domain/errors/DomainError';
import {
  MusicGenerationCallbacks,
  MusicGenerationConfig,
  MusicGenerationPort,
} from '@application/ports/MusicGenerationPort';
import { buildChord, buildScaleNotes, selectKey, type Mode } from './synthMusic';

/**
 * Infrastructure adapter: a LOCAL Tone.js synthesis engine implementing
 * MusicGenerationPort. It is the offline fallback the {@link ResilientMusicGenerator}
 * engages when the Lyria stream drops or stalls — its job is reliability, not
 * parity. Rather than streaming remote audio chunks, it synthesizes directly
 * into the shared Tone.js audio graph, so when the WebSocket dies the demo
 * degrades to a working instrument instead of going silent.
 *
 * It steers from the SAME emoji-to-parameter mapping as the stream, received
 * through the port's MusicGenerationConfig:
 *   - bpm        → Transport tempo
 *   - scale      → musical key (relative major/minor tonic)
 *   - brightness → major vs. minor mode + low-pass filter cutoff (timbre)
 *   - density    → how many layers play (pad → +bass → +arp)
 *
 * Voices (all gated by density, summed through one filter → reverb → master):
 *   - pad:  sustained tonic triad — the harmonic bed, always on
 *   - bass: root/fifth walk on the beat — joins past a low density threshold
 *   - arp:  scale notes stepping up and back — joins past a higher threshold
 *
 * Prompt text is intentionally ignored: the synth has no language model, so it
 * derives everything musical from the blended numeric parameters.
 */
export class LocalToneMusicGenerator implements MusicGenerationPort {
  /** Master gain while playing. Left a little low so the fallback never clips. */
  private static readonly PLAY_GAIN = 0.7;
  /** Fade applied when engaging/disengaging, so a takeover is smooth, not a click. */
  private static readonly FADE_SECONDS = 1.2;
  /** Density at/above which the bass layer joins. */
  private static readonly BASS_AT = 0.33;
  /** Density at/above which the arp layer joins. */
  private static readonly ARP_AT = 0.6;
  /** Register (octave) the pad's tonic triad sits in. */
  private static readonly PAD_OCTAVE = 3;
  private static readonly BASS_OCTAVE = 2;
  private static readonly ARP_OCTAVE = 4;

  private master: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private reverb: Tone.Reverb | null = null;
  private filter: Tone.Filter | null = null;
  private pad: Tone.PolySynth | null = null;
  private bass: Tone.MonoSynth | null = null;
  private arp: Tone.Synth | null = null;
  private chordLoop: Tone.Loop | null = null;
  private bassLoop: Tone.Loop | null = null;
  private arpLoop: Tone.Loop | null = null;

  private built = false;

  // Live musical state, updated by setGenerationConfig and read by the loops.
  private bpm = 110;
  private density = 0.6;
  private brightness = 0.5;
  private scale = 'C_MAJOR_A_MINOR';
  private rootPc = 0;
  private mode: Mode = 'major';
  private chord: string[] = [];
  private scaleNotes: string[] = [];
  private arpStep = 0;
  private bassStep = 0;

  async connect(_callbacks: MusicGenerationCallbacks): Promise<void> {
    // The synth plays straight into the audio graph, so it never emits chunks or
    // errors through the callbacks — they're accepted only to satisfy the port.
    try {
      this.build();
      this.recomputeKey();
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  /** Build the Tone.js signal graph and the scheduling loops (idempotent). */
  private build(): void {
    if (this.built) return;

    this.master = new Tone.Gain(0);
    this.limiter = new Tone.Limiter(-2);
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.28 });
    this.filter = new Tone.Filter({ frequency: this.cutoff(), type: 'lowpass', rolloff: -24 });
    // filter → reverb → master → limiter → speakers
    this.filter.chain(this.reverb, this.master, this.limiter);
    this.limiter.toDestination();

    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 3 },
      volume: -12,
    }).connect(this.filter);

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.6 },
      filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.6, baseFrequency: 120 },
      volume: -10,
    }).connect(this.filter);

    this.arp = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.4 },
      volume: -14,
    }).connect(this.filter);

    // Pad: re-voice the tonic triad each whole note so its envelope breathes.
    this.chordLoop = new Tone.Loop((time) => {
      if (this.chord.length > 0) this.pad?.triggerAttackRelease(this.chord, '1n', time);
    }, '1n');

    // Bass: walk root → fifth → root → third on the beat, once dense enough.
    this.bassLoop = new Tone.Loop((time) => {
      if (this.density < LocalToneMusicGenerator.BASS_AT || this.scaleNotes.length === 0) return;
      const walk = [0, 4, 0, 2]; // scale-degree indices
      const idx = walk[this.bassStep % walk.length];
      this.bassStep += 1;
      const note = buildScaleNotes(this.rootPc, this.mode, LocalToneMusicGenerator.BASS_OCTAVE)[idx];
      if (note) this.bass?.triggerAttackRelease(note, '8n', time);
    }, '4n');

    // Arp: step up the scale and back down, once dense enough.
    this.arpLoop = new Tone.Loop((time) => {
      if (this.density < LocalToneMusicGenerator.ARP_AT || this.scaleNotes.length === 0) return;
      const len = this.scaleNotes.length;
      const cycle = len * 2 - 2; // up then down without repeating the endpoints
      const pos = this.arpStep % cycle;
      const idx = pos < len ? pos : cycle - pos;
      this.arpStep += 1;
      this.arp?.triggerAttackRelease(this.scaleNotes[idx], '16n', time);
    }, '8n');

    this.built = true;
  }

  async setPrompts(_prompts: readonly MusicPrompt[]): Promise<void> {
    // No language model here — musical content comes from the blended params.
  }

  async setGenerationConfig(config: MusicGenerationConfig): Promise<void> {
    if (config.bpm !== undefined) this.bpm = config.bpm;
    if (config.density !== undefined) this.density = config.density;
    if (config.brightness !== undefined) this.brightness = config.brightness;
    if (config.scale !== undefined) this.scale = config.scale;

    this.recomputeKey();

    try {
      const transport = Tone.getTransport();
      // Ramp tempo so a tempo shift glides rather than jumps.
      transport.bpm.rampTo(this.bpm, 0.5);
      this.filter?.frequency.rampTo(this.cutoff(), 0.3);
    } catch (err) {
      // Never let a steering tick crash the fallback — it exists to keep sound alive.
      console.warn('[local-synth] config apply skipped:', err);
    }
  }

  /** Re-derive key/mode (and the chord + scale note pool) from scale + brightness. */
  private recomputeKey(): void {
    const { rootPc, mode } = selectKey(this.scale, this.brightness);
    this.rootPc = rootPc;
    this.mode = mode;
    this.chord = buildChord(rootPc, mode, LocalToneMusicGenerator.PAD_OCTAVE);
    this.scaleNotes = buildScaleNotes(rootPc, mode, LocalToneMusicGenerator.ARP_OCTAVE);
  }

  /** Low-pass cutoff from brightness: ~350 Hz (dark) → ~7 kHz (bright), log-mapped. */
  private cutoff(): number {
    return 350 * Math.pow(20, Math.max(0, Math.min(1, this.brightness)));
  }

  async play(): Promise<void> {
    try {
      this.build();
      this.recomputeKey();
      const transport = Tone.getTransport();
      transport.bpm.value = this.bpm;
      this.chordLoop?.start(0);
      this.bassLoop?.start(0);
      this.arpLoop?.start(0);
      transport.start();
      // Fade in so engaging the fallback is heard as a swell, not a pop.
      this.master?.gain.rampTo(LocalToneMusicGenerator.PLAY_GAIN, LocalToneMusicGenerator.FADE_SECONDS);
      console.info('[local-synth] playing (fallback engine engaged)');
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async pause(): Promise<void> {
    try {
      this.master?.gain.rampTo(0, 0.3);
      // Let the fade finish before parking the transport.
      Tone.getTransport().pause('+0.35');
    } catch (err) {
      throw this.toDomainError(err);
    }
  }

  async stop(): Promise<void> {
    try {
      this.master?.gain.rampTo(0, 0.3);
    } catch {
      // best-effort
    }
    // Tear the graph down after the fade-out so we don't cut off with a click.
    setTimeout(() => this.dispose(), 400);
  }

  private dispose(): void {
    try {
      this.chordLoop?.stop();
      this.bassLoop?.stop();
      this.arpLoop?.stop();
      Tone.getTransport().stop();
      for (const node of [
        this.chordLoop,
        this.bassLoop,
        this.arpLoop,
        this.pad,
        this.bass,
        this.arp,
        this.filter,
        this.reverb,
        this.master,
        this.limiter,
      ]) {
        node?.dispose();
      }
    } catch (err) {
      console.warn('[local-synth] error disposing nodes:', err);
    }
    this.master = null;
    this.limiter = null;
    this.reverb = null;
    this.filter = null;
    this.pad = null;
    this.bass = null;
    this.arp = null;
    this.chordLoop = null;
    this.bassLoop = null;
    this.arpLoop = null;
    this.built = false;
  }

  private toDomainError(err: unknown): DomainError {
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(`Local synth error: ${message}`);
  }
}
