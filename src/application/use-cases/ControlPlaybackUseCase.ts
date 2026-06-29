import { DomainError } from '@domain/errors/DomainError';
import { MusicSessionRepository } from '@domain/repositories/MusicSessionRepository';
import {
  MusicSessionDto,
  SessionControlInputDto,
  toMusicSessionDto,
} from '../dtos/MusicSessionDto';
import { MusicGenerationPort } from '../ports/MusicGenerationPort';
import { AudioOutputPort } from '../ports/AudioOutputPort';

type Action = 'play' | 'pause' | 'stop';

/**
 * Use Case: control playback (play / pause / stop) of an existing session.
 * State transitions are validated by the entity; this use case simply
 * coordinates the entity with the generation + audio ports.
 */
export class ControlPlaybackUseCase {
  constructor(
    private readonly sessions: MusicSessionRepository,
    private readonly generator: MusicGenerationPort,
    private readonly audioOutput: AudioOutputPort,
  ) {}

  async execute(dto: SessionControlInputDto & { action: Action }): Promise<MusicSessionDto> {
    const session = await this.sessions.findById(dto.sessionId);
    if (!session) {
      throw new DomainError(`Session "${dto.sessionId}" not found.`);
    }

    switch (dto.action) {
      case 'play':
        session.play();
        await this.audioOutput.resume();
        await this.generator.play();
        break;
      case 'pause':
        session.pause();
        await this.generator.pause();
        break;
      case 'stop':
        session.stop();
        await this.generator.stop();
        await this.audioOutput.suspend();
        break;
    }

    await this.sessions.save(session);
    return toMusicSessionDto(session);
  }
}
