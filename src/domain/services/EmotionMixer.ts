import { MusicPrompt } from '../value-objects/MusicPrompt';
import { WeightedEmotion, EmotionMorph } from '../value-objects/EmotionDescriptor';

/**
 * The full set of musical parameters the emoji mix blends into: the secondary
 * morph (density/brightness) plus the TEMPO and KEY of the blend. The streaming
 * engine pins bpm/scale for the whole performance and consumes only the morph;
 * the local fallback synth — free of the reset_context() constraint — follows
 * all four so its tempo and key track the mood. Same mapping, two consumers.
 */
export interface SynthParams extends EmotionMorph {
  /** Blended tempo in BPM (weighted average across the active emotions). */
  readonly bpm: number;
  /** Key/scale (SDK Scale enum name) taken from the dominant active emotion. */
  readonly scale: string;
}

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

  /**
   * Blend the active emotions into the SECONDARY morph controls
   * (density + brightness) that ride alongside the prompt weights.
   *
   * Unlike the prompt weights — which are relative magnitudes sent as-is — these
   * are a true blend ratio in [0, 1], so the per-emotion textures are averaged
   * weighted by each emotion's current weight. As the sliders move, density and
   * brightness drift smoothly between the active emotions' textures, which (with
   * low guidance) is what keeps transitions gentle rather than abrupt.
   *
   * Returns `null` when no emotion is audible: the caller then leaves the live
   * density/brightness untouched rather than snapping the stream to a default.
   * Note that bpm and scale are intentionally never derived here — they stay
   * pinned for the whole performance to avoid reset_context() seams.
   */
  toMorph(emotions: readonly WeightedEmotion[]): EmotionMorph | null {
    const active = emotions.filter((emotion) => emotion.current > MIN_AUDIBLE_WEIGHT);
    const totalWeight = active.reduce((sum, emotion) => sum + emotion.current, 0);
    if (totalWeight === 0) return null;

    const density = active.reduce((s, e) => s + e.morph.density * e.current, 0) / totalWeight;
    const brightness = active.reduce((s, e) => s + e.morph.brightness * e.current, 0) / totalWeight;
    return { density, brightness };
  }

  /**
   * Blend the active emotions into the FULL parameter set — the density/
   * brightness morph plus a blended tempo and a key. Tempo is a weighted average
   * of the per-emotion bpms; the key is the dominant (highest-weight) emotion's
   * scale, because a key can't be meaningfully averaged — you pick one.
   *
   * Returns `null` when nothing is audible (same threshold as the prompts and
   * the morph), so the caller leaves the live parameters untouched rather than
   * snapping to a default.
   */
  toSynthParams(emotions: readonly WeightedEmotion[]): SynthParams | null {
    const morph = this.toMorph(emotions);
    if (!morph) return null;

    const active = emotions.filter((emotion) => emotion.current > MIN_AUDIBLE_WEIGHT);
    const totalWeight = active.reduce((sum, emotion) => sum + emotion.current, 0);
    const bpm = active.reduce((s, e) => s + e.bpm * e.current, 0) / totalWeight;
    const dominant = active.reduce((a, b) => (b.current > a.current ? b : a));

    return { ...morph, bpm: Math.round(bpm), scale: dominant.scale };
  }
}
