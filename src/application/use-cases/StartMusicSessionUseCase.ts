import { MusicSession } from '@domain/entities/MusicSession';
import { MoodInterpreter } from '@domain/services/MoodInterpreter';
import { MusicSessionRepository } from '@domain/repositories/MusicSessionRepository';
import {
  MusicSessionDto,
  StartSessionInputDto,
  toMusicSessionDto,
} from '../dtos/MusicSessionDto';
import { MusicGenerationPort, MusicGenerationCallbacks } from '../ports/MusicGenerationPort';
import { AudioOutputPort } from '../ports/AudioOutputPort';
import { IdGenerator } from '../ports/IdGenerator';

/**
 * Use Case: start a new generative-music session for a given mood.
 *
 * Responsibilities:
 *  - interpret the mood (domain service)
 *  - create the session entity (domain)
 *  - wire the generation engine output to the audio output (ports)
 *  - persist the session (repository interface)
 *
 * It knows WHAT to do, but nothing about HOW prompts reach Google or how
 * audio reaches the speakers.
 */
export class StartMusicSessionUseCase {
  constructor(
    private readonly sessions: MusicSessionRepository,
    private readonly generator: MusicGenerationPort,
    private readonly audioOutput: AudioOutputPort,
    private readonly ids: IdGenerator,
    private readonly moodInterpreter: MoodInterpreter = new MoodInterpreter(),
  ) {}

  async execute(dto: StartSessionInputDto): Promise<MusicSessionDto> {
    const mood = this.moodInterpreter.interpret(dto.moodInput, dto.intensity ?? 0.6);
    const session = MusicSession.start(this.ids.generate(), mood);

    await this.audioOutput.resume();

    const callbacks: MusicGenerationCallbacks = {
      onAudioChunk: (chunk) => this.audioOutput.enqueue(chunk),
      onError: (error) => {
        // Surface errors; presentation/interface layer decides how to display.
        console.error('[StartMusicSessionUseCase] generation error:', error.message);
      },
    };

    await this.generator.connect(callbacks);
    await this.generator.setPrompts(session.prompts);
    await this.generator.play();

    session.play();
    await this.sessions.save(session);

    return toMusicSessionDto(session);
  }
}
