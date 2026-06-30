import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import {
  MusicGenerationCallbacks,
  MusicGenerationConfig,
  MusicGenerationPort,
} from '@application/ports/MusicGenerationPort';

/** Failover policy: how long silence is tolerated before the fallback takes over. */
export interface FailoverOptions {
  /**
   * While playing, if no audio chunk arrives from the primary for this long, the
   * stream is declared stalled and the local fallback takes over. Kept above any
   * gap a healthy stream produces (incl. the transparent-reconnect handoff, where
   * the old stream keeps emitting) so it only fires on a genuine outage.
   */
  stallTimeoutMs: number;
}

export const DEFAULT_FAILOVER: FailoverOptions = { stallTimeoutMs: 4_000 };

/**
 * A MusicGenerationPort that wraps a PRIMARY engine (the Lyria stream) and a
 * local FALLBACK engine (the Tone.js synth), and transparently hands off from
 * the primary to the fallback when the stream fails — so an outage mid-demo
 * degrades to a working instrument rather than silence.
 *
 * The application sees a single port and is unaware a failover ever happened;
 * the policy lives here, the same way reconnect/retry logic lives in a transport
 * client. Takeover is triggered by any of:
 *   - onError      — the WebSocket reported an error;
 *   - onClosed      — the socket closed unexpectedly while playing;
 *   - a STALL       — no audio chunk for `stallTimeoutMs` while playing.
 *
 * Takeover is ONE-WAY: once degraded we stay on the local synth for the rest of
 * the session (reliability over a risky flap back to a still-shaky stream). The
 * last prompts/config are replayed onto the fallback so the music continues from
 * the same blend, and steering after failover flows to the synth.
 */
export class ResilientMusicGenerator implements MusicGenerationPort {
  private callbacks: MusicGenerationCallbacks | null = null;
  private active: 'primary' | 'fallback' = 'primary';
  private playing = false;
  private failedOver = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  /** Last prompts/config seen, replayed onto the fallback so it picks up the blend. */
  private lastPrompts: readonly MusicPrompt[] = [];
  private lastConfig: MusicGenerationConfig;

  /**
   * @param primary  The streaming engine (Lyria). Its callbacks are observed for
   *   errors, closes and stalls.
   * @param fallback The local synth engaged on failure.
   * @param seedConfig The connect-time generation config (bpm/scale/density/
   *   brightness). Seeds the fallback so it sounds right even if the outage hits
   *   before any steering has happened.
   * @param options Failover timing policy.
   */
  constructor(
    private readonly primary: MusicGenerationPort,
    private readonly fallback: MusicGenerationPort,
    seedConfig: MusicGenerationConfig = {},
    private readonly options: FailoverOptions = DEFAULT_FAILOVER,
  ) {
    this.lastConfig = { ...seedConfig };
  }

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.callbacks = callbacks;
    // Observe the primary's stream: forward its chunks (and pet the stall
    // watchdog), and treat an error or unexpected close as an outage.
    const observed: MusicGenerationCallbacks = {
      onAudioChunk: (chunk) => {
        if (this.active !== 'primary') return; // drop any late chunks after failover
        this.petWatchdog();
        callbacks.onAudioChunk(chunk);
      },
      onError: (error) => {
        if (this.failedOver) return;
        console.error('[resilient] primary error — engaging local fallback:', error.message);
        callbacks.onError(error);
        void this.failover();
      },
      onClosed: () => {
        if (this.playing && !this.failedOver) {
          console.warn('[resilient] primary closed unexpectedly — engaging local fallback');
          void this.failover();
        }
        callbacks.onClosed?.();
      },
    };
    await this.primary.connect(observed);
  }

  async setPrompts(prompts: readonly MusicPrompt[]): Promise<void> {
    this.lastPrompts = [...prompts];
    await this.current().setPrompts(prompts);
  }

  async setGenerationConfig(config: MusicGenerationConfig): Promise<void> {
    this.lastConfig = { ...this.lastConfig, ...config };
    await this.current().setGenerationConfig(config);
  }

  async play(): Promise<void> {
    this.playing = true;
    await this.current().play();
    if (this.active === 'primary') this.petWatchdog();
  }

  async pause(): Promise<void> {
    this.playing = false;
    this.clearWatchdog();
    await this.current().pause();
  }

  async stop(): Promise<void> {
    this.playing = false;
    this.clearWatchdog();
    await this.current().stop();
  }

  private current(): MusicGenerationPort {
    return this.active === 'primary' ? this.primary : this.fallback;
  }

  // ── Stall detection ─────────────────────────────────────────────────────────

  /** (Re)arm the watchdog; each forwarded chunk calls this to prove liveness. */
  private petWatchdog(): void {
    if (!this.playing || this.active !== 'primary') return;
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      console.warn(
        `[resilient] no audio for ${this.options.stallTimeoutMs}ms — stream stalled; engaging local fallback`,
      );
      void this.failover();
    }, this.options.stallTimeoutMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  // ── Takeover ─────────────────────────────────────────────────────────────────

  private async failover(): Promise<void> {
    if (this.failedOver) return;
    // Flip synchronously so concurrent triggers (error + close + stall) coalesce
    // into a single takeover and no further primary chunks are forwarded.
    this.failedOver = true;
    this.active = 'fallback';
    this.clearWatchdog();

    // Release the dead primary (socket + its reconnect timers). Best-effort: its
    // failure must not stop the fallback from coming up.
    try {
      await this.primary.stop();
    } catch (err) {
      console.warn('[resilient] error stopping failed primary:', err);
    }

    // Bring the local synth up seeded with the last known blend, so the music
    // continues from where the stream left off instead of cutting to silence.
    try {
      await this.fallback.connect(this.callbacks ?? noopCallbacks());
      if (this.lastPrompts.length > 0) await this.fallback.setPrompts(this.lastPrompts);
      await this.fallback.setGenerationConfig(this.lastConfig);
      if (this.playing) await this.fallback.play();
      console.info('[resilient] local Tone.js fallback engine engaged');
    } catch (err) {
      console.error('[resilient] fallback failed to engage:', err);
      this.callbacks?.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

function noopCallbacks(): MusicGenerationCallbacks {
  return { onAudioChunk: () => {}, onError: () => {} };
}
