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

describe('SteerEmotionMixUseCase', () => {
  it('sends all non-zero prompts together in one setPrompts call', async () => {
    const { port, calls } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', weight: 1.5 },
        { name: 'sad', weight: 0 },
        { name: 'hype', weight: 0.5 },
      ],
    });

    expect(port.setPrompts).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(2); // sad (0) dropped
    expect(result.prompts.map((p) => p.weight)).toEqual([1.5, 0.5]);
    expect(result.prompts.every((p) => p.weight > 0)).toBe(true);
  });

  it('morphs only density/brightness — never bpm/scale/guidance — so context is not reset', async () => {
    const { port, configs } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', weight: 1 },
        { name: 'sad', weight: 0.5 },
      ],
    });

    expect(port.setGenerationConfig).toHaveBeenCalledTimes(1);
    // Exactly density + brightness, nothing that would force a reset_context().
    expect(Object.keys(configs[0]).sort()).toEqual(['brightness', 'density']);
    expect(configs[0].bpm).toBeUndefined();
    expect(configs[0].scale).toBeUndefined();
    expect(configs[0].guidance).toBeUndefined();
    expect(result.morph?.density).toBeCloseTo(0.4667, 4);
    expect(result.morph?.brightness).toBeCloseTo(0.55, 4);
  });

  it('does not touch generation config when no slider is audible', async () => {
    const { port } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({ weights: [{ name: 'happy', weight: 0 }] });

    expect(port.setGenerationConfig).not.toHaveBeenCalled();
    expect(result.morph).toBeUndefined();
  });

  it('never calls setPrompts with an empty array when all sliders are at zero', async () => {
    const { port } = fakeGenerator();
    const useCase = new SteerEmotionMixUseCase(port);

    const result = await useCase.execute({
      weights: [
        { name: 'happy', weight: 0 },
        { name: 'calm', weight: 0.01 },
      ],
    });

    expect(port.setPrompts).not.toHaveBeenCalled();
    expect(result.prompts).toHaveLength(0);
  });
});
