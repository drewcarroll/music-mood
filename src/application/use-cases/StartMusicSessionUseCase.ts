import { MusicSession } from '@domain/entities/MusicSession';
import { MoodInterpreter } from '@domain/services/MoodInterpreter';
import { EmotionMixer } from '@domain/services/EmotionMixer';
import { WeightedEmotion } from '@domain/value-objects/EmotionDescriptor';
import { MusicPrompt } from '@domain/value-objects/MusicPrompt';
import { MusicSessionRepository } from '@domain/repositories/MusicSessionRepository';
import {
  MusicSessionDto,
  StartSessionInputDto,
  toMusicSessionDto,
} from '../dtos/MusicSessionDto';
import { StartFromMixInputDto } from '../dtos/EmotionMixDto';
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
    private readonly mixer: EmotionMixer = new EmotionMixer(),
  ) {}

  async execute(dto: StartSessionInputDto): Promise<MusicSessionDto> {
    const mood = this.moodInterpreter.interpret(dto.moodInput, dto.intensity ?? 0.6);
    const session = MusicSession.start(this.ids.generate(), mood);
    await this.beginStreaming(session, session.prompts);
    return toMusicSessionDto(session);
  }

  /**
   * Start a session whose opening sound IS the emoji-mix blend. The same mixer
   * the live steering uses builds the seed prompts (and the tempo/key/texture),
   * so there's no throwaway "starter mood" — the stream opens on exactly the mix
   * the sliders describe and then morphs from there.
   */
  async startFromMix(dto: StartFromMixInputDto): Promise<MusicSessionDto> {
    const emotions = dto.weights.map((w) => WeightedEmotion.create(w.name, w.target, w.target));
    const prompts = this.mixer.toPrompts(emotions);
    const synth = this.mixer.toSynthParams(emotions);

    const session = MusicSession.startFromPrompts(
      this.ids.generate(),
      this.describeMix(emotions),
      prompts,
    );

    await this.beginStreaming(session, prompts, synth ?? undefined);
    return toMusicSessionDto(session);
  }

  /** Shared startup: resume audio, open the stream, seed prompts/config, play. */
  private async beginStreaming(
    session: MusicSession,
    prompts: readonly MusicPrompt[],
    synth?: { bpm: number; scale: string; density: number; brightness: number },
  ): Promise<void> {
    await this.audioOutput.resume();

    const callbacks: MusicGenerationCallbacks = {
      onAudioChunk: (chunk) => this.audioOutput.enqueue(chunk),
      onError: (error) => {
        // Surface errors; presentation/interface layer decides how to display.
        console.error('[StartMusicSessionUseCase] generation error:', error.message);
      },
    };

    await this.generator.connect(callbacks);
    if (prompts.length > 0) {
      await this.generator.setPrompts(prompts);
    }
    if (synth) {
      await this.generator.setGenerationConfig(synth);
    }
    await this.generator.play();

    session.play();
    await this.sessions.save(session);
  }

  /** A short human label for a blend: the dominant emotion(s), or "ambient". */
  private describeMix(emotions: readonly WeightedEmotion[]): string {
    const active = emotions
      .filter((e) => e.target > 0.02)
      .sort((a, b) => b.target - a.target);
    if (active.length === 0) return 'ambient';
    return active
      .slice(0, 2)
      .map((e) => e.name)
      .join(' + ');
  }
}
