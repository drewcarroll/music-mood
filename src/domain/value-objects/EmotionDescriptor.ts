import { DomainError } from '../errors/DomainError';

/**
 * The five emoji emotions the steering surface exposes. These are part of the
 * ubiquitous language, so the canonical list lives in the domain.
 */
export const EMOTION_NAMES = ['happy', 'sad', 'angry', 'calm', 'hype'] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

/**
 * Lower / upper bounds for an emotion's weight. The range is intentionally
 * 0–2 (not 0–1): a weight of 1 is the "neutral" presence of an emotion, and
 * values above 1 let a single emotion dominate the mix.
 */
export const MIN_EMOTION_WEIGHT = 0;
export const MAX_EMOTION_WEIGHT = 2;

/**
 * A descriptor pairs an emoji emotion with the model-friendly keyword set used
 * to steer the generative music model. The keyword sets are fixed, curated
 * vocabulary — kept verbatim so prompts stay reproducible.
 */
export interface EmotionDescriptor {
  readonly name: EmotionName;
  readonly emoji: string;
  readonly keywords: readonly string[];
}

/**
 * The canonical descriptor for each emotion, with its exact keyword set.
 *
 * The keyword sets are tuned so the five emotions are (1) clearly
 * distinguishable when one slider is soloed and (2) blend into recognizable
 * hybrids when sliders overlap. Each set is built from three deliberate parts:
 *
 *   - a leading MOOD word that fixes the emotional valence (joyful vs.
 *     melancholy vs. menacing) — this is what keeps neighbours apart;
 *   - a TONAL / ENERGY anchor (major vs. minor key, slow vs. fast) the model
 *     interpolates between when two emotions are mixed;
 *   - a signature INSTRUMENT / TEXTURE so blends layer instead of mush.
 *
 * The pairs that previously overlapped are now separated on purpose:
 *   - sad vs. calm: sad is `mournful` + `minor key` (sorrow); calm is `serene`
 *     + `peaceful` with no minor tonality (rest, not grief).
 *   - angry vs. hype: angry is `dark` + `menacing` distorted guitars (negative);
 *     hype is `euphoric` festival electronica (positive).
 *   - happy vs. hype: happy is warm `acoustic` `upbeat pop`; hype is `driving
 *     electronic` with `punchy bass` at a faster tempo.
 *
 * Common blends are intentional by construction, e.g. happy + a touch of sad =
 * bittersweet: major/minor tonality becomes ambiguous while the acoustic
 * guitar, solo piano and strings sit in one coherent ensemble.
 *
 * Sets are kept tight (≈5 terms) so no single emotion's joined prompt becomes a
 * word-salad that drowns out the others in a mix.
 */
export const EMOTION_DESCRIPTORS: Record<EmotionName, EmotionDescriptor> = {
  happy: {
    name: 'happy',
    emoji: '😊',
    keywords: ['joyful', 'bright', 'major key', 'warm acoustic guitar', 'upbeat pop'],
  },
  sad: {
    name: 'sad',
    emoji: '😢',
    keywords: ['melancholy', 'mournful', 'minor key', 'tender solo piano', 'slow and sparse'],
  },
  angry: {
    name: 'angry',
    emoji: '😠',
    keywords: ['aggressive', 'heavy distorted guitars', 'pounding drums', 'dark', 'menacing'],
  },
  calm: {
    name: 'calm',
    emoji: '😌',
    keywords: ['serene', 'peaceful', 'ambient', 'soft warm synth pads', 'spacious'],
  },
  hype: {
    name: 'hype',
    emoji: '🔥',
    keywords: ['euphoric', 'driving electronic beat', 'punchy bass', 'fast tempo', 'festival energy'],
  },
};

/**
 * WeightedEmotion is an immutable Value Object describing a single emoji's
 * presence in the mix. It carries:
 *  - `descriptor`: the emoji + its fixed keyword set
 *  - `target`:  the weight the user is steering toward (slider position)
 *  - `current`: the weight currently applied to the model
 *
 * Weights are RELATIVE MAGNITUDES — they are deliberately NOT normalized to
 * sum to 1. Each emotion stands on its own within [0, 2], so two emotions can
 * both sit at 2 (both fully present) or both at 0 (both absent). Equality is
 * by value.
 *
 * Invariants (enforced in `create`):
 *  - the name must be one of the canonical EMOTION_NAMES
 *  - both target and current must be finite numbers within [0, 2]
 */
export class WeightedEmotion {
  private constructor(
    public readonly descriptor: EmotionDescriptor,
    public readonly target: number,
    public readonly current: number,
  ) {
    Object.freeze(this);
  }

  static create(name: string, target = 0, current = target): WeightedEmotion {
    if (!(name in EMOTION_DESCRIPTORS)) {
      throw new DomainError(
        `Unknown emotion "${name}". Expected one of: ${EMOTION_NAMES.join(', ')}.`,
      );
    }
    const descriptor = EMOTION_DESCRIPTORS[name as EmotionName];
    return new WeightedEmotion(
      descriptor,
      WeightedEmotion.assertWeight(target, 'target'),
      WeightedEmotion.assertWeight(current, 'current'),
    );
  }

  get name(): EmotionName {
    return this.descriptor.name;
  }

  get emoji(): string {
    return this.descriptor.emoji;
  }

  get keywords(): readonly string[] {
    return this.descriptor.keywords;
  }

  /** Returns a new WeightedEmotion steered toward a new target weight. */
  withTarget(target: number): WeightedEmotion {
    return new WeightedEmotion(
      this.descriptor,
      WeightedEmotion.assertWeight(target, 'target'),
      this.current,
    );
  }

  /** Returns a new WeightedEmotion with its current (applied) weight updated. */
  withCurrent(current: number): WeightedEmotion {
    return new WeightedEmotion(
      this.descriptor,
      this.target,
      WeightedEmotion.assertWeight(current, 'current'),
    );
  }

  equals(other: WeightedEmotion): boolean {
    return (
      this.name === other.name &&
      this.target === other.target &&
      this.current === other.current
    );
  }

  private static assertWeight(value: number, field: string): number {
    if (!Number.isFinite(value) || value < MIN_EMOTION_WEIGHT || value > MAX_EMOTION_WEIGHT) {
      throw new DomainError(
        `Emotion ${field} weight must be a number between ${MIN_EMOTION_WEIGHT} and ${MAX_EMOTION_WEIGHT}, received "${value}".`,
      );
    }
    return value;
  }
}

/**
 * Builds the full set of five emotions at a baseline weight (0 by default).
 * No normalization is applied — the returned weights are independent.
 */
export function createEmotionSet(initialWeight = 0): WeightedEmotion[] {
  return EMOTION_NAMES.map((name) => WeightedEmotion.create(name, initialWeight));
}
