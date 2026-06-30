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
 * Default smoothing factor applied on each easing tick:
 * `current += (target - current) * factor`. ~0.15 reaches a new target in a
 * gentle ~1–2 s at a 100–150 ms tick, so slider moves morph rather than snap.
 */
export const DEFAULT_EASE_FACTOR = 0.15;

/**
 * Once the remaining gap between current and target falls below this, the
 * current snaps exactly to target. Without it the exponential ease would crawl
 * toward the target forever and never report itself settled.
 */
export const EASE_EPSILON = 0.005;

/**
 * The texture an emotion contributes to the SECONDARY morph controls.
 * `density` (how busy the arrangement is) and `brightness` (tonal lightness)
 * are both in [0, 1] — the same range Lyria's generation config expects. These
 * are blended by slider weight to morph the stream gently alongside the prompt
 * weights; bpm and scale are deliberately NOT part of this (changing them would
 * force a reset_context() seam mid-performance).
 */
export interface EmotionMorph {
  readonly density: number;
  readonly brightness: number;
}

/**
 * A descriptor pairs an emoji emotion with the model-friendly keyword set used
 * to steer the generative music model, plus the texture (density/brightness)
 * it lends to the secondary morph controls. The keyword sets are fixed, curated
 * vocabulary — kept verbatim so prompts stay reproducible.
 *
 * `bpm` and `scale` describe the emotion's TEMPO and KEY. The streaming engine
 * pins these for the whole performance (changing them mid-stream forces a
 * reset_context() seam), but the LOCAL fallback synth — which has no such
 * constraint — blends them so its tempo and key track the mood. Keeping them on
 * the descriptor means both engines steer from one emoji-to-parameter mapping.
 */
export interface EmotionDescriptor {
  readonly name: EmotionName;
  readonly emoji: string;
  readonly keywords: readonly string[];
  readonly morph: EmotionMorph;
  /** Tempo this emotion pulls toward, in BPM. Blended (by weight) across the mix. */
  readonly bpm: number;
  /** Key/scale this emotion suggests (SDK Scale enum name). The dominant emotion sets it. */
  readonly scale: string;
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
    // Bright and moderately busy.
    morph: { density: 0.55, brightness: 0.7 },
    bpm: 118,
    scale: 'G_MAJOR_E_MINOR',
  },
  sad: {
    name: 'sad',
    emoji: '😢',
    keywords: ['melancholy', 'mournful', 'minor key', 'tender solo piano', 'slow and sparse'],
    // Sparse and dim — the texture of grief.
    morph: { density: 0.3, brightness: 0.25 },
    bpm: 64,
    scale: 'D_MAJOR_B_MINOR',
  },
  angry: {
    name: 'angry',
    emoji: '😠',
    keywords: ['aggressive', 'heavy distorted guitars', 'pounding drums', 'dark', 'menacing'],
    // Dense and dark.
    morph: { density: 0.85, brightness: 0.4 },
    bpm: 142,
    scale: 'E_FLAT_MAJOR_C_MINOR',
  },
  calm: {
    name: 'calm',
    emoji: '😌',
    keywords: ['serene', 'peaceful', 'ambient', 'soft warm synth pads', 'spacious'],
    // Very sparse, neutral brightness — restful space.
    morph: { density: 0.2, brightness: 0.5 },
    bpm: 76,
    scale: 'F_MAJOR_D_MINOR',
  },
  hype: {
    name: 'hype',
    emoji: '🔥',
    keywords: ['euphoric', 'driving electronic beat', 'punchy bass', 'fast tempo', 'festival energy'],
    // Maximally busy and bright.
    morph: { density: 0.9, brightness: 0.85 },
    bpm: 152,
    scale: 'A_MAJOR_G_FLAT_MINOR',
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

  get morph(): EmotionMorph {
    return this.descriptor.morph;
  }

  get bpm(): number {
    return this.descriptor.bpm;
  }

  get scale(): string {
    return this.descriptor.scale;
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

  /**
   * Returns a new WeightedEmotion with `current` eased one step toward `target`:
   * `current += (target - current) * factor`. When the remaining gap drops below
   * EASE_EPSILON the current snaps exactly to target, so the ease terminates
   * (and `settled` becomes true) instead of crawling asymptotically.
   */
  easedToward(factor: number = DEFAULT_EASE_FACTOR): WeightedEmotion {
    const delta = this.target - this.current;
    if (Math.abs(delta) <= EASE_EPSILON) {
      return this.settled ? this : this.withCurrent(this.target);
    }
    return this.withCurrent(this.current + delta * factor);
  }

  /** True once `current` has reached `target` — no further easing is needed. */
  get settled(): boolean {
    return this.current === this.target;
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
