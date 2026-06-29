import { StartMusicSessionUseCase } from './use-cases/StartMusicSessionUseCase';
import { SteerMoodUseCase } from './use-cases/SteerMoodUseCase';
import { ControlPlaybackUseCase } from './use-cases/ControlPlaybackUseCase';

/**
 * The application's public use-case surface. The interfaces layer depends on
 * this type (application only); the infrastructure composition root produces
 * a concrete instance of it.
 */
export interface AppUseCases {
  startSession: StartMusicSessionUseCase;
  steerMood: SteerMoodUseCase;
  controlPlayback: ControlPlaybackUseCase;
}
