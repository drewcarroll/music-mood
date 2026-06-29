import { MusicSession } from '@domain/entities/MusicSession';

/** Input DTO: caller provides a mood description + intensity. */
export interface StartSessionInputDto {
  /** Free-text mood ("calm", "happy", "spooky", ...). */
  moodInput: string;
  /** 0..1, defaults applied in the use case if omitted. */
  intensity?: number;
}

export interface SteerMoodInputDto {
  sessionId: string;
  moodInput: string;
  intensity?: number;
}

export interface SessionControlInputDto {
  sessionId: string;
}

/** Output DTO: never expose the raw entity to the outer layers. */
export interface MusicSessionDto {
  id: string;
  mood: string;
  intensity: number;
  status: string;
  prompts: Array<{ text: string; weight: number }>;
  createdAt: string;
}

export function toMusicSessionDto(session: MusicSession): MusicSessionDto {
  return {
    id: session.id,
    mood: session.mood.name,
    intensity: session.mood.intensity,
    status: session.status,
    prompts: session.prompts.map((p) => ({ text: p.text, weight: p.weight })),
    createdAt: session.createdAt.toISOString(),
  };
}
