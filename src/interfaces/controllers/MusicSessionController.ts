import { AppUseCases } from '@application/AppUseCases';
import { MusicSessionDto } from '@application/dtos/MusicSessionDto';

/**
 * Controller (interface adapter).
 *
 * Thin: validates input -> calls a use case -> returns DTO / normalized error.
 * Contains NO business logic and never touches infrastructure or domain
 * entities directly.
 */
export class MusicSessionController {
  constructor(private readonly useCases: AppUseCases) {}

  async start(moodInput: string, intensity: number): Promise<Result<MusicSessionDto>> {
    if (!moodInput.trim()) {
      return { ok: false, error: 'Please describe a mood first.' };
    }
    return this.run(() =>
      this.useCases.startSession.execute({ moodInput, intensity: this.clamp(intensity) }),
    );
  }

  async steer(
    sessionId: string,
    moodInput: string,
    intensity: number,
  ): Promise<Result<MusicSessionDto>> {
    if (!sessionId) return { ok: false, error: 'No active session to steer.' };
    if (!moodInput.trim()) return { ok: false, error: 'Please describe a mood first.' };
    return this.run(() =>
      this.useCases.steerMood.execute({ sessionId, moodInput, intensity: this.clamp(intensity) }),
    );
  }

  async play(sessionId: string): Promise<Result<MusicSessionDto>> {
    return this.control(sessionId, 'play');
  }

  async pause(sessionId: string): Promise<Result<MusicSessionDto>> {
    return this.control(sessionId, 'pause');
  }

  async stop(sessionId: string): Promise<Result<MusicSessionDto>> {
    return this.control(sessionId, 'stop');
  }

  private control(
    sessionId: string,
    action: 'play' | 'pause' | 'stop',
  ): Promise<Result<MusicSessionDto>> {
    if (!sessionId) return Promise.resolve({ ok: false, error: 'No active session.' });
    return this.run(() => this.useCases.controlPlayback.execute({ sessionId, action }));
  }

  private async run(fn: () => Promise<MusicSessionDto>): Promise<Result<MusicSessionDto>> {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      return { ok: false, error: message };
    }
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) return 0.6;
    return Math.max(0, Math.min(1, value));
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
