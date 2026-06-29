import { describe, expect, it, vi } from 'vitest';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { MusicGenerationPort } from '../ports/MusicGenerationPort';
import { SteerEmotionMixUseCase } from './SteerEmotionMixUseCase';

/** Minimal fake generator that records the prompts handed to setPrompts. */
function fakeGenerator() {
  const calls: ReadonlyArray<MusicPrompt>[] = [];
  const port: MusicGenerationPort = {
    connect: vi.fn(),
    setPrompts: vi.fn(async (prompts: readonly MusicPrompt[]) => {
      calls.push([...prompts]);
    }),
    setGenerationConfig: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  return { port, calls };
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
