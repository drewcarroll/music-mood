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

    // Never send an empty array — the model needs at least one prompt. When every
    // slider sits at/near zero we leave the current blend playing untouched.
    if (prompts.length > 0) {
      await this.generator.setPrompts(prompts);
    }

    return { prompts: prompts.map((p) => ({ text: p.text, weight: p.weight })) };
  }
}
