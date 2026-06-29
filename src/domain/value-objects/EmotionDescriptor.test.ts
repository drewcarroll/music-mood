import { describe, expect, it } from 'vitest';
import {
  EMOTION_DESCRIPTORS,
  EMOTION_NAMES,
  MAX_EMOTION_WEIGHT,
  MIN_EMOTION_WEIGHT,
  WeightedEmotion,
  createEmotionSet,
} from './EmotionDescriptor';

describe('EmotionDescriptor', () => {
  it('defines exactly the five emoji emotions', () => {
    expect([...EMOTION_NAMES]).toEqual(['happy', 'sad', 'angry', 'calm', 'hype']);
  });

  it('carries the exact curated keyword sets', () => {
    expect(EMOTION_DESCRIPTORS.happy.keywords).toEqual([
      'uplifting',
      'bright',
      'major key',
      'warm acoustic guitar',
      'lively tempo',
    ]);
    expect(EMOTION_DESCRIPTORS.sad.keywords).toEqual([
      'melancholy',
      'sparse',
      'minor key',
      'slow',
      'soft piano',
    ]);
    expect(EMOTION_DESCRIPTORS.angry.keywords).toEqual([
      'aggressive',
      'distorted',
      'driving drums',
      'dark',
    ]);
    expect(EMOTION_DESCRIPTORS.calm.keywords).toEqual([
      'ambient',
      'gentle',
      'airy synth pads',
      'soft',
    ]);
    expect(EMOTION_DESCRIPTORS.hype.keywords).toEqual([
      'energetic',
      'punchy beat',
      'electronic',
      'confident',
    ]);
  });

  it('uses a 0–2 weight range', () => {
    expect(MIN_EMOTION_WEIGHT).toBe(0);
    expect(MAX_EMOTION_WEIGHT).toBe(2);
  });
});

describe('WeightedEmotion', () => {
  it('exposes descriptor, target, and current weight fields', () => {
    const happy = WeightedEmotion.create('happy', 1.5, 0.5);
    expect(happy.descriptor).toBe(EMOTION_DESCRIPTORS.happy);
    expect(happy.target).toBe(1.5);
    expect(happy.current).toBe(0.5);
  });

  it('defaults current to the target when omitted', () => {
    const hype = WeightedEmotion.create('hype', 2);
    expect(hype.target).toBe(2);
    expect(hype.current).toBe(2);
  });

  it('rejects unknown emotions', () => {
    expect(() => WeightedEmotion.create('excited')).toThrow(/Unknown emotion/);
  });

  it('rejects weights outside the 0–2 range', () => {
    expect(() => WeightedEmotion.create('calm', 2.5)).toThrow(/target/);
    expect(() => WeightedEmotion.create('calm', 1, -0.1)).toThrow(/current/);
  });

  it('is immutable and returns new instances when steered', () => {
    const calm = WeightedEmotion.create('calm', 1, 1);
    const steered = calm.withTarget(2).withCurrent(0);
    expect(calm.target).toBe(1);
    expect(calm.current).toBe(1);
    expect(steered.target).toBe(2);
    expect(steered.current).toBe(0);
    expect(Object.isFrozen(calm)).toBe(true);
  });

  it('builds an un-normalized set of all five emotions', () => {
    const set = createEmotionSet();
    expect(set).toHaveLength(5);
    expect(set.every((e) => e.target === 0 && e.current === 0)).toBe(true);

    // No normalization: two emotions can both sit at full weight.
    const both = [WeightedEmotion.create('happy', 2), WeightedEmotion.create('hype', 2)];
    expect(both[0].target + both[1].target).toBe(4);
  });
});
