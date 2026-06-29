import { DomainError } from '@domain/errors/DomainError';
import { MoodInterpreter } from '@domain/services/MoodInterpreter';
import { MusicSessionRepository } from '@domain/repositories/MusicSessionRepository';
import {
  MusicSessionDto,
  SteerMoodInputDto,
  toMusicSessionDto,
} from '../dtos/MusicSessionDto';
import { MusicGenerationPort } from '../ports/MusicGenerationPort';
import { AudioOutputPort } from '../ports/AudioOutputPort';

/**
 * Use Case: steer an existing session toward a new mood without
 * tearing down the stream — the hallmark of Lyria RealTime.
 */
export class SteerMoodUseCase {
  constructor(
    private readonly sessions: MusicSessionRepository,
    private readonly generator: MusicGenerationPort,
    private readonly audioOutput: AudioOutputPort,
    private readonly moodInterpreter: MoodInterpreter = new MoodInterpreter(),
  ) {}

  async execute(dto: SteerMoodInputDto): Promise<MusicSessionDto> {
    const session = await this.sessions.findById(dto.sessionId);
    if (!session) {
      throw new DomainError(`Session "${dto.sessionId}" not found.`);
    }

    const mood = this.moodInterpreter.interpret(dto.moodInput, dto.intensity ?? session.mood.intensity);
    session.steerTo(mood);

    // Optionally clear buffered audio so the new mood is heard sooner.
    this.audioOutput.flush();
    await this.generator.setPrompts(session.prompts);

    await this.sessions.save(session);
    return toMusicSessionDto(session);
  }
}
