import { EmotionMixer } from '@domain/services/EmotionMixer';
import { DEFAULT_EASE_FACTOR, WeightedEmotion } from '@domain/value-objects/EmotionDescriptor';
import { MusicGenerationPort } from '../ports/MusicGenerationPort';
import { AdvanceEmotionMixInputDto, EmotionMixResultDto } from '../dtos/EmotionMixDto';

/**
 * Use Case: advance the five-emoji mix by ONE easing tick and apply it.
 *
 * The render loop calls this every ~100–150 ms. Each emotion's `current` weight
 * is eased one step toward its slider `target` (via WeightedEmotion.easedToward),
 * then the full prompt set is rebuilt and sent in a single setWeightedPrompts
 * call — the continuity mechanism that turns slider moves into gradual morphs
 * rather than snaps. Emotions at/near zero are dropped by the mixer.
 *
 * Steering morphs along two axes that move together every tick:
 *  - prompt weights (primary) — harmonic / instrumental content;
 *  - the blended synth params (secondary) — tempo, key and the density/
 *    brightness texture, via setGenerationConfig.
 *
 * The config carries bpm + scale alongside density + brightness so the local
 * fallback synth can track the mood's tempo and key. The streaming engine pins
 * bpm/scale for the whole performance (changing them mid-stream forces a
 * reset_context() seam) and so deliberately ignores those two on a live update,
 * applying only density/brightness — that pinning is enforced in the Lyria
 * adapter, not by withholding the fields here.
 *
 * The use case is stateless: the loop owns the live weights and feeds the eased
 * result back in next tick. `settled` lets the loop stop ticking once every
 * weight has reached its target.
 */
export class SteerEmotionMixUseCase {
  constructor(
    private readonly generator: MusicGenerationPort,
    private readonly mixer: EmotionMixer = new EmotionMixer(),
  ) {}

  async execute(dto: AdvanceEmotionMixInputDto): Promise<EmotionMixResultDto> {
    const factor = dto.smoothing ?? DEFAULT_EASE_FACTOR;
    const eased = dto.weights.map((w) =>
      WeightedEmotion.create(w.name, w.target, w.current).easedToward(factor),
    );

    const prompts = this.mixer.toPrompts(eased);
    const synth = this.mixer.toSynthParams(eased);

    // Never send an empty array — the model needs at least one prompt. When every
    // slider sits at/near zero we leave the current blend (and texture) playing
    // untouched rather than snapping back to a default.
    if (prompts.length > 0) {
      await this.generator.setPrompts(prompts);
    }

    // Secondary morph: the full blended tempo/key/texture. The streaming engine
    // applies only density/brightness from this and pins bpm/scale; the local
    // fallback synth follows all four.
    if (synth) {
      await this.generator.setGenerationConfig({
        bpm: synth.bpm,
        scale: synth.scale,
        density: synth.density,
        brightness: synth.brightness,
      });
    }

    return {
      prompts: prompts.map((p) => ({ text: p.text, weight: p.weight })),
      morph: synth ? { density: synth.density, brightness: synth.brightness } : undefined,
      weights: eased.map((e) => ({ name: e.name, target: e.target, current: e.current })),
      settled: eased.every((e) => e.settled),
    };
  }
}
