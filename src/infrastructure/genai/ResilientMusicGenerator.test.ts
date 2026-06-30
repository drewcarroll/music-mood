import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import {
  AudioChunk,
  MusicGenerationCallbacks,
  MusicGenerationConfig,
  MusicGenerationPort,
} from '@application/ports/MusicGenerationPort';
import { ResilientMusicGenerator } from './ResilientMusicGenerator';

/** A recording fake MusicGenerationPort with a hook to fire its callbacks. */
class FakePort implements MusicGenerationPort {
  received: MusicGenerationCallbacks | null = null;
  prompts: MusicPrompt[][] = [];
  configs: MusicGenerationConfig[] = [];
  events: string[] = [];
  connectShouldThrow = false;

  async connect(callbacks: MusicGenerationCallbacks): Promise<void> {
    this.received = callbacks;
    this.events.push('connect');
    if (this.connectShouldThrow) throw new Error('connect failed');
  }
  async setPrompts(prompts: readonly MusicPrompt[]): Promise<void> {
    this.prompts.push([...prompts]);
    this.events.push('setPrompts');
  }
  async setGenerationConfig(config: MusicGenerationConfig): Promise<void> {
    this.configs.push(config);
    this.events.push('setGenerationConfig');
  }
  async play(): Promise<void> {
    this.events.push('play');
  }
  async pause(): Promise<void> {
    this.events.push('pause');
  }
  async stop(): Promise<void> {
    this.events.push('stop');
  }
}

const chunk: AudioChunk = { data: 'AAAA', sampleRate: 48_000, channels: 2 };
const STALL_MS = 4_000;

/** Let the void-returning failover chain settle its microtasks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('ResilientMusicGenerator', () => {
  let primary: FakePort;
  let fallback: FakePort;
  let app: MusicGenerationCallbacks;
  let gen: ResilientMusicGenerator;

  beforeEach(() => {
    vi.useFakeTimers();
    primary = new FakePort();
    fallback = new FakePort();
    app = { onAudioChunk: vi.fn(), onError: vi.fn(), onClosed: vi.fn() };
    gen = new ResilientMusicGenerator(
      primary,
      fallback,
      { bpm: 110, scale: 'C_MAJOR_A_MINOR', density: 0.6, brightness: 0.5 },
      { stallTimeoutMs: STALL_MS },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** connect → setPrompts → play, the order the start use case drives. */
  async function startPlaying(): Promise<void> {
    await gen.connect(app);
    await gen.setPrompts([MusicPrompt.create('lush ambient', 1)]);
    await gen.play();
  }

  it('forwards primary audio chunks to the app while the stream is healthy', async () => {
    await startPlaying();
    primary.received?.onAudioChunk(chunk);
    expect(app.onAudioChunk).toHaveBeenCalledWith(chunk);
    expect(fallback.events).not.toContain('play');
  });

  it('fails over to the local synth when the primary errors', async () => {
    await startPlaying();
    primary.received?.onError(new Error('socket boom'));
    await flush();

    expect(app.onError).toHaveBeenCalledOnce(); // surfaced once
    expect(primary.events).toContain('stop'); // dead primary released
    expect(fallback.events).toEqual(['connect', 'setPrompts', 'setGenerationConfig', 'play']);
  });

  it('fails over when no audio arrives for the stall timeout while playing', async () => {
    await startPlaying();
    expect(fallback.events).not.toContain('play');

    vi.advanceTimersByTime(STALL_MS);
    await flush();

    expect(fallback.events).toContain('play');
  });

  it('does not stall-fail-over while chunks keep arriving', async () => {
    await startPlaying();
    // A chunk just before each deadline keeps petting the watchdog.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(STALL_MS - 1);
      primary.received?.onAudioChunk(chunk);
    }
    await flush();
    expect(fallback.events).not.toContain('play');
  });

  it('fails over on an unexpected close WHILE playing, but not when stopped', async () => {
    await startPlaying();
    primary.received?.onClosed?.();
    await flush();
    expect(fallback.events).toContain('play');
  });

  it('ignores a close that arrives when not playing (e.g. after stop)', async () => {
    await gen.connect(app);
    // never played
    primary.received?.onClosed?.();
    await flush();
    expect(fallback.events).not.toContain('connect');
  });

  it('replays the last prompts and the seeded+steered config onto the fallback', async () => {
    await startPlaying();
    await gen.setGenerationConfig({ bpm: 142, scale: 'E_FLAT_MAJOR_C_MINOR', density: 0.85 });
    primary.received?.onError(new Error('boom'));
    await flush();

    expect(fallback.prompts[0][0].text).toBe('lush ambient');
    // seed (brightness 0.5) merged with the steered update
    expect(fallback.configs[0]).toMatchObject({
      bpm: 142,
      scale: 'E_FLAT_MAJOR_C_MINOR',
      density: 0.85,
      brightness: 0.5,
    });
  });

  it('takes over only once even when error, close and stall all fire', async () => {
    await startPlaying();
    primary.received?.onError(new Error('boom'));
    primary.received?.onClosed?.();
    vi.advanceTimersByTime(STALL_MS * 2);
    await flush();

    expect(fallback.events.filter((e) => e === 'connect')).toHaveLength(1);
    expect(fallback.events.filter((e) => e === 'play')).toHaveLength(1);
  });

  it('routes steering to the fallback after failover, not the dead primary', async () => {
    await startPlaying();
    primary.received?.onError(new Error('boom'));
    await flush();

    const primaryConfigsBefore = primary.configs.length;
    await gen.setGenerationConfig({ density: 0.2, brightness: 0.9 });
    await gen.setPrompts([MusicPrompt.create('calm', 1)]);

    expect(primary.configs.length).toBe(primaryConfigsBefore); // primary untouched
    expect(fallback.configs.at(-1)).toMatchObject({ density: 0.2, brightness: 0.9 });
    expect(fallback.prompts.at(-1)?.[0].text).toBe('calm');
  });
});
