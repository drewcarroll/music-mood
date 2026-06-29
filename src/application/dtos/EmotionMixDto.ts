/** Input DTO: the live weight of each emoji emotion (slider positions). */
export interface SetEmotionMixInputDto {
  weights: Array<{ name: string; weight: number }>;
}

/** Output DTO: the weighted prompts actually sent to the model. */
export interface EmotionMixResultDto {
  prompts: Array<{ text: string; weight: number }>;
  /**
   * The secondary morph (density/brightness in 0..1) applied for this mix, or
   * undefined when no emotion was audible and the live texture was left as-is.
   */
  morph?: { density: number; brightness: number };
}
