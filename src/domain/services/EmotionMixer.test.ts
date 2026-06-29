import { describe, expect, it } from 'vitest';
import { EmotionMixer, MIN_AUDIBLE_WEIGHT } from './EmotionMixer';
import { EMOTION_DESCRIPTORS, createEmotionSet, WeightedEmotion } from '../value-objects/EmotionDescriptor';

const mixer = new EmotionMixer();

describe('EmotionMixer', () => {
  it('sends every active emotion together as one weighted prompt each', () => {
    const emotions = [
      WeightedEmotion.create('happy', 1.5, 1.5),
      WeightedEmotion.create('hype', 0.8, 0.8),
    ];
    const prompts = mixer.toPrompts(emotions);

    expect(prompts).toHaveLength(2);
    expect(prompts[0].text).toBe(EMOTION_DESCRIPTORS.happy.keywords.join(', '));
    expect(prompts[0].weight).toBe(1.5);
    expect(prompts[1].weight).toBe(0.8);
  });

  it('drops emotions at or below the ~0.02 threshold', () => {
    const emotions = [
      WeightedEmotion.create('happy', 0, 0),
      WeightedEmotion.create('sad', MIN_AUDIBLE_WEIGHT, MIN_AUDIBLE_WEIGHT), // exactly 0.02 → dropped
      WeightedEmotion.create('angry', 0.03, 0.03), // just above → kept
    ];
    const prompts = mixer.toPrompts(emotions);

    expect(prompts).toHaveLength(1);
    expect(prompts[0].text).toBe(EMOTION_DESCRIPTORS.angry.keywords.join(', '));
  });

  it('never emits a prompt with weight 0', () => {
    const prompts = mixer.toPrompts(createEmotionSet(0));
    expect(prompts).toHaveLength(0);
    expect(prompts.every((p) => p.weight > 0)).toBe(true);
  });

  it('does not normalize — relative magnitudes pass through unchanged', () => {
    const emotions = [
      WeightedEmotion.create('happy', 2, 2),
      WeightedEmotion.create('calm', 2, 2),
    ];
    const prompts = mixer.toPrompts(emotions);
    expect(prompts.map((p) => p.weight)).toEqual([2, 2]);
  });
});

describe('EmotionMixer.toMorph', () => {
  it('returns a soloed emotion’s own density/brightness', () => {
    const morph = mixer.toMorph([WeightedEmotion.create('sad', 1, 1)]);
    expect(morph).toEqual(EMOTION_DESCRIPTORS.sad.morph);
  });

  it('weight-blends density/brightness across active emotions (a true 0..1 ratio)', () => {
    // happy {d:0.55,b:0.7} at 1.0 + a touch of sad {d:0.3,b:0.25} at 0.5 → bittersweet.
    const morph = mixer.toMorph([
      WeightedEmotion.create('happy', 1, 1),
      WeightedEmotion.create('sad', 0.5, 0.5),
    ]);
    // density = (0.55*1 + 0.3*0.5) / 1.5 ; brightness = (0.7*1 + 0.25*0.5) / 1.5
    expect(morph?.density).toBeCloseTo(0.4667, 4);
    expect(morph?.brightness).toBeCloseTo(0.55, 4);
  });

  it('ignores emotions at/near zero, matching the prompt threshold', () => {
    const morph = mixer.toMorph([
      WeightedEmotion.create('hype', 1, 1),
      WeightedEmotion.create('calm', MIN_AUDIBLE_WEIGHT, MIN_AUDIBLE_WEIGHT), // dropped
    ]);
    expect(morph).toEqual(EMOTION_DESCRIPTORS.hype.morph);
  });

  it('returns null when nothing is audible so the live texture is left untouched', () => {
    expect(mixer.toMorph(createEmotionSet(0))).toBeNull();
  });
});
