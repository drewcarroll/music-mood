import { AppUseCases } from '@application/AppUseCases';
import { StartMusicSessionUseCase } from '@application/use-cases/StartMusicSessionUseCase';
import { SteerMoodUseCase } from '@application/use-cases/SteerMoodUseCase';
import { SteerEmotionMixUseCase } from '@application/use-cases/SteerEmotionMixUseCase';
import { ControlPlaybackUseCase } from '@application/use-cases/ControlPlaybackUseCase';

import { loadConfig } from '../config/env';
import { CryptoIdGenerator } from '../id/CryptoIdGenerator';
import { InMemoryMusicSessionRepository } from '../persistence/InMemoryMusicSessionRepository';
import { LyriaRealtimeMusicGenerator } from '../genai/LyriaRealtimeMusicGenerator';
import { WebAudioToneOutput } from '../audio/WebAudioToneOutput';

/**
 * Composition Root.
 *
 * The ONLY place where concrete infrastructure is wired to the application's
 * use cases. It returns an `AppUseCases` typed purely against the application
 * layer, so the interfaces layer never imports infrastructure directly
 * (respecting interfaces -> application -> domain).
 */
export function createContainer(): AppUseCases {
  const config = loadConfig();

  // Shared singletons for the lifetime of the SPA.
  const repository = new InMemoryMusicSessionRepository();
  const idGenerator = new CryptoIdGenerator();
  const generator = new LyriaRealtimeMusicGenerator(config.geminiApiKey, config.lyriaModel, {
    initialPrompt: config.initialPrompt,
    generationConfig: config.generationConfig,
  });
  const audioOutput = new WebAudioToneOutput();

  return {
    startSession: new StartMusicSessionUseCase(repository, generator, audioOutput, idGenerator),
    steerMood: new SteerMoodUseCase(repository, generator, audioOutput),
    steerEmotionMix: new SteerEmotionMixUseCase(generator),
    controlPlayback: new ControlPlaybackUseCase(repository, generator, audioOutput),
  };
}
