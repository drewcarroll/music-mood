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
      'joyful',
      'bright',
      'major key',
      'warm acoustic guitar',
      'upbeat pop',
    ]);
    expect(EMOTION_DESCRIPTORS.sad.keywords).toEqual([
      'melancholy',
      'mournful',
      'minor key',
      'tender solo piano',
      'slow and sparse',
    ]);
    expect(EMOTION_DESCRIPTORS.angry.keywords).toEqual([
      'aggressive',
      'heavy distorted guitars',
      'pounding drums',
      'dark',
      'menacing',
    ]);
    expect(EMOTION_DESCRIPTORS.calm.keywords).toEqual([
      'serene',
      'peaceful',
      'ambient',
      'soft warm synth pads',
      'spacious',
    ]);
    expect(EMOTION_DESCRIPTORS.hype.keywords).toEqual([
      'euphoric',
      'driving electronic beat',
      'punchy bass',
      'fast tempo',
      'festival energy',
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

  it('eases current toward target by the smoothing factor', () => {
    const happy = WeightedEmotion.create('happy', 2, 0);
    const stepped = happy.easedToward(0.25);
    // current += (2 - 0) * 0.25 = 0.5
    expect(stepped.current).toBe(0.5);
    expect(stepped.target).toBe(2);
    expect(stepped.settled).toBe(false);
  });

  it('eases downward as well as upward', () => {
    const calm = WeightedEmotion.create('calm', 0, 2);
    // current += (0 - 2) * 0.5 = -1 → 1
    expect(calm.easedToward(0.5).current).toBe(1);
  });

  it('snaps to target and reports settled once within the epsilon', () => {
    const hype = WeightedEmotion.create('hype', 1, 0.999); // gap 0.001 < epsilon
    const stepped = hype.easedToward(0.15);
    expect(stepped.current).toBe(1);
    expect(stepped.settled).toBe(true);
  });

  it('is already settled when current equals target', () => {
    expect(WeightedEmotion.create('sad', 0.7, 0.7).settled).toBe(true);
    expect(WeightedEmotion.create('sad', 0.7, 0).settled).toBe(false);
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
