/**
 * Input DTO: one easing tick over the live mix. The caller (the render loop)
 * owns the real-time state and hands back each emotion's slider `target` and its
 * last eased `current`; the use case advances `current` one step toward
 * `target` and returns the new state to feed in on the next tick.
 */
export interface AdvanceEmotionMixInputDto {
  weights: Array<{ name: string; target: number; current: number }>;
  /** Smoothing factor in (0, 1]; how far `current` moves toward `target` this tick. */
  smoothing?: number;
}

/** Output DTO: the result of one easing tick. */
export interface EmotionMixResultDto {
  /** The weighted prompts actually sent to the model this tick (zero dropped). */
  prompts: Array<{ text: string; weight: number }>;
  /**
   * The secondary morph (density/brightness in 0..1) applied this tick, or
   * undefined when no emotion was audible and the live texture was left as-is.
   */
  morph?: { density: number; brightness: number };
  /** The eased weights after this step — feed back in as `current` next tick. */
  weights: Array<{ name: string; target: number; current: number }>;
  /** True once every weight has reached its target, so the loop can idle. */
  settled: boolean;
}
