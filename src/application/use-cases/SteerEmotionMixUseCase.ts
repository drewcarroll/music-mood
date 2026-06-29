import { EmotionMixer } from '@domain/services/EmotionMixer';
import { WeightedEmotion } from '@domain/value-objects/EmotionDescriptor';
import { MusicGenerationPort } from '../ports/MusicGenerationPort';
import { EmotionMixResultDto, SetEmotionMixInputDto } from '../dtos/EmotionMixDto';

/**
 * Use Case: apply the five-emoji weight mix to the live stream.
 *
 * Builds the weighted prompts from the current slider weights (via the
 * EmotionMixer domain service, which drops any emotion at/near zero) and
 * replaces the model's active prompts in a single setWeightedPrompts call.
 *
 * Steering morphs the stream along TWO axes that move together:
 *  - prompt weights (primary) — the harmonic / instrumental content;
 *  - density + brightness (secondary) — the texture, pushed via
 *    setGenerationConfig with ONLY those two fields set.
 *
 * bpm, scale and guidance are never sent from here: they are pinned at connect
 * for the whole performance, so steering can never trigger a reset_context()
 * seam. Combined with the low connect-time guidance (~2.5), this keeps
 * transitions gentle rather than abrupt.
 *
 * No easing yet: the slider position is applied directly as the emotion's
 * current weight, so the blend updates statically as sliders move.
 */
export class SteerEmotionMixUseCase {
  constructor(
    private readonly generator: MusicGenerationPort,
    private readonly mixer: EmotionMixer = new EmotionMixer(),
  ) {}

  async execute(dto: SetEmotionMixInputDto): Promise<EmotionMixResultDto> {
    // No easing: the slider value is both the target and the current weight.
    const emotions = dto.weights.map((w) => WeightedEmotion.create(w.name, w.weight, w.weight));
    const prompts = this.mixer.toPrompts(emotions);
    const morph = this.mixer.toMorph(emotions);

    // Never send an empty array — the model needs at least one prompt. When every
    // slider sits at/near zero we leave the current blend (and texture) playing
    // untouched rather than snapping back to a default.
    if (prompts.length > 0) {
      await this.generator.setPrompts(prompts);
    }

    // Secondary morph: nudge only density/brightness so bpm/scale stay fixed.
    if (morph) {
      await this.generator.setGenerationConfig({
        density: morph.density,
        brightness: morph.brightness,
      });
    }

    return {
      prompts: prompts.map((p) => ({ text: p.text, weight: p.weight })),
      morph: morph ?? undefined,
    };
  }
}
