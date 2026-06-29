/** Input DTO: the live weight of each emoji emotion (slider positions). */
export interface SetEmotionMixInputDto {
  weights: Array<{ name: string; weight: number }>;
}

/** Output DTO: the weighted prompts actually sent to the model. */
export interface EmotionMixResultDto {
  prompts: Array<{ text: string; weight: number }>;
}
