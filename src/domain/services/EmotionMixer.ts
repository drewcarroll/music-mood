import { MusicPrompt } from '../value-objects/MusicPrompt';
import { WeightedEmotion } from '../value-objects/EmotionDescriptor';

/**
 * Minimum weight an emotion must carry to be sent to the model. Lyria rejects a
 * weight of exactly 0, and weights at/near zero are inaudible anyway, so any
 * emotion at or below this threshold is dropped from the prompt set entirely
 * rather than floored — a zero weight is never handed to the model.
 */
export const MIN_AUDIBLE_WEIGHT = 0.02;

/**
 * Domain Service: blends a set of WeightedEmotions into the weighted prompts
 * sent to the generative model. Pure business logic — no I/O.
 *
 * Each active emotion contributes ONE weighted prompt (its keyword set joined),
 * carrying that emotion's current weight. Emotions at/near zero are dropped.
 * Weights are NOT normalized: the relative magnitudes are sent as-is so the
 * model hears the blend the sliders describe.
 */
export class EmotionMixer {
  /**
   * Build the weighted prompts for every active emotion. The result is the
   * complete set to send together in a single setWeightedPrompts call.
   */
  toPrompts(emotions: readonly WeightedEmotion[]): MusicPrompt[] {
    return emotions
      .filter((emotion) => emotion.current > MIN_AUDIBLE_WEIGHT)
      .map((emotion) => MusicPrompt.create(emotion.keywords.join(', '), emotion.current));
  }
}
