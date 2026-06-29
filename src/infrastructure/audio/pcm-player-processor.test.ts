import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * The AudioWorklet processor is a classic script loaded at runtime via
 * `audioWorklet.addModule`, so it can't be imported. We load its source into a
 * stubbed AudioWorkletGlobalScope and exercise the pre-roll / underrun state
 * machine directly on the audio-thread `process()` contract.
 */

interface WorkletMessage {
  type: string;
  channels?: Float32Array[];
}

interface ProcInstance {
  port: { onmessage: ((e: { data: WorkletMessage }) => void) | null };
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
  playing: boolean;
  underruns: number;
}

type ProcCtor = new (opts?: { processorOptions?: Record<string, unknown> }) => ProcInstance;

const CH = 2;
let Processor: ProcCtor;

beforeAll(() => {
  let captured: ProcCtor | undefined;
  Object.assign(globalThis, {
    sampleRate: 48_000,
    AudioWorkletProcessor: class {
      port: { onmessage: ((e: { data: WorkletMessage }) => void) | null } = { onmessage: null };
    },
    registerProcessor: (_name: string, ctor: ProcCtor) => {
      captured = ctor;
    },
  });
  const file = fileURLToPath(
    new URL('../../../public/worklets/pcm-player-processor.js', import.meta.url),
  );
  vm.runInThisContext(readFileSync(file, 'utf8'));
  if (!captured) throw new Error('worklet did not register a processor');
  Processor = captured;
});

function make(prerollChunks: number): ProcInstance {
  return new Processor({ processorOptions: { channelCount: CH, ringSeconds: 8, prerollChunks } });
}

function chunkOf(value: number, frames = 200): Float32Array[] {
  return Array.from({ length: CH }, () => new Float32Array(frames).fill(value));
}

function send(p: ProcInstance, channels: Float32Array[]): void {
  const handler = p.port.onmessage;
  if (!handler) throw new Error('processor has no message handler');
  handler({ data: { type: 'chunk', channels } });
}

function flush(p: ProcInstance): void {
  const handler = p.port.onmessage;
  if (!handler) throw new Error('processor has no message handler');
  handler({ data: { type: 'flush' } });
}

function pull(p: ProcInstance, n = 128): Float32Array[] {
  const out = Array.from({ length: CH }, () => new Float32Array(n));
  p.process([], [out]);
  return out;
}

const isSilent = (out: Float32Array[]): boolean => out.every((c) => c.every((s) => s === 0));

describe('pre-roll buffering (AC1, AC3)', () => {
  it('stays silent until prerollChunks chunks are buffered (default 3)', () => {
    const p = make(3);
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(true); // 1 chunk -> still priming
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(true); // 2 chunks -> still priming
    send(p, chunkOf(0.5));
    expect(p.playing).toBe(false); // not flipped until process() runs
    const out = pull(p); // 3rd chunk present -> playback begins
    expect(p.playing).toBe(true);
    expect(isSilent(out)).toBe(false);
  });

  it('does not drop buffered audio while priming (no leading samples lost)', () => {
    const p = make(3);
    send(p, chunkOf(1)); // chunk A
    pull(p); // silent, must NOT consume chunk A
    send(p, chunkOf(2)); // chunk B
    pull(p); // silent
    send(p, chunkOf(3)); // chunk C -> start
    const out = pull(p);
    // First sample emitted is the very first sample written (chunk A), in order.
    expect(out[0][0]).toBe(1);
  });

  it('honors a configurable pre-roll depth of 2', () => {
    const p = make(2);
    expect(isSilent(pull(p))).toBe(true); // nothing buffered
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(true); // 1 chunk
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(false); // 2 chunks -> play
  });

  it('with prerollChunks=0 starts on the first available chunk', () => {
    const p = make(0);
    expect(isSilent(pull(p))).toBe(true); // empty ring -> silence
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(false);
  });
});

describe('underrun handling (AC2)', () => {
  it('re-primes after the ring drains, instead of dribbling fragments', () => {
    const p = make(2);
    // Two 100-frame chunks => 200 frames buffered, then drain past empty.
    send(p, chunkOf(0.5, 100));
    send(p, chunkOf(0.5, 100));
    expect(isSilent(pull(p, 128))).toBe(false); // reads 128, 72 remain
    pull(p, 128); // reads 72 + 56 silence -> ring empty -> underrun
    expect(p.underruns).toBe(1);
    expect(p.playing).toBe(false); // back to priming

    expect(isSilent(pull(p, 128))).toBe(true); // priming: silent
    send(p, chunkOf(0.5, 100)); // 1 chunk < preroll -> still silent
    expect(isSilent(pull(p, 128))).toBe(true);
    send(p, chunkOf(0.5, 100)); // 2 chunks -> resume
    expect(isSilent(pull(p, 128))).toBe(false);
  });

  it('produces no silent quanta during steady streaming (no audible gaps)', () => {
    const p = make(2);
    send(p, chunkOf(0.5));
    send(p, chunkOf(0.5)); // primed
    let sawSilence = false;
    // Feed one 200-frame chunk per 128-frame quantum: buffer never empties.
    for (let i = 0; i < 200; i++) {
      send(p, chunkOf(0.5));
      if (isSilent(pull(p, 128))) sawSilence = true;
    }
    expect(sawSilence).toBe(false);
    expect(p.underruns).toBe(0);
  });

  it('re-primes after a flush so a steered mood starts cleanly', () => {
    const p = make(2);
    send(p, chunkOf(0.5));
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(false); // playing
    flush(p);
    expect(p.playing).toBe(false);
    expect(isSilent(pull(p))).toBe(true); // re-priming after flush
    send(p, chunkOf(0.5));
    send(p, chunkOf(0.5));
    expect(isSilent(pull(p))).toBe(false); // resumes after re-buffering
  });
});
