import { describe, expect, it, vi } from 'vitest';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { MusicGenerationConfig, MusicGenerationPort } from '../ports/MusicGenerationPort';
import { SteerEmotionMixUseCase } from './SteerEmotionMixUseCase';

/** Minimal fake generator that records prompts and config updates. */
function fakeGenerator() {
  const calls: ReadonlyArray<MusicPrompt>[] = [];
  const configs: MusicGenerationConfig[] = [];
  const port: MusicGenerationPort = {
    connect: vi.fn(),
    setPrompts: vi.fn(async (prompts: readonly MusicPrompt[]) => {
      calls.push([...prompts]);
    }),
    setGenerationConfig: vi.fn(async (config: MusicGenerationConfig) => {
      configs.push(config);
    }),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  return { port, calls, configs };
}

describe('SteerEmotionMixUseCase (one easing tick)', () => {
  it('eases current toward target by the smoothing factor and pushes the eased weight', async () => {
    const { port, calls } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [{ name: 'happy', target: 2, current: 0 }],
      smoothing: 0.5,
    });

    // current += (2 - 0) * 0.5 = 1
    expect(calls[0][0].weight).toBe(1);
    expect(result.weights[0].current).toBe(1);
    expect(result.weights[0].target).toBe(2);
    expect(result.settled).toBe(false); // 1 has not reached 2 yet
  });

  it('sends every active emotion together each tick, dropping zero-weight prompts', async () => {
    const { port, calls } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', target: 1.5, current: 1.5 }, // settled, kept
        { name: 'sad', target: 0, current: 0 }, // dropped
        { name: 'hype', target: 0.5, current: 0.5 }, // settled, kept
      ],
      smoothing: 0.15,
    });

    expect(port.setPrompts).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(2); // sad dropped
    expect(result.prompts.map((p) => p.weight)).toEqual([1.5, 0.5]);
    expect(result.prompts.every((p) => p.weight > 0)).toBe(true);
  });

  it('reports settled once every weight has reached its target', async () => {
    const { port } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', target: 1, current: 1 },
        { name: 'calm', target: 0.999, current: 0.999 }, // within epsilon → snaps
      ],
      smoothing: 0.15,
    });

    expect(result.settled).toBe(true);
  });

  it('morphs only density/brightness — never bpm/scale/guidance — so context is not reset', async () => {
    const { port, configs } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', target: 1, current: 1 },
        { name: 'sad', target: 0.5, current: 0.5 },
      ],
      smoothing: 0.15,
    });

    expect(port.setGenerationConfig).toHaveBeenCalledTimes(1);
    expect(Object.keys(configs[0]).sort()).toEqual(['brightness', 'density']);
    expect(configs[0].bpm).toBeUndefined();
    expect(configs[0].scale).toBeUndefined();
    expect(configs[0].guidance).toBeUndefined();
    expect(result.morph?.density).toBeCloseTo(0.4667, 4);
    expect(result.morph?.brightness).toBeCloseTo(0.55, 4);
  });

  it('never calls the model when every weight is at zero, and reports settled', async () => {
    const { port } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', target: 0, current: 0 },
        { name: 'calm', target: 0, current: 0 },
      ],
    });

    expect(port.setPrompts).not.toHaveBeenCalled();
    expect(port.setGenerationConfig).not.toHaveBeenCalled();
    expect(result.prompts).toHaveLength(0);
    expect(result.morph).toBeUndefined();
    expect(result.settled).toBe(true);
  });
});
