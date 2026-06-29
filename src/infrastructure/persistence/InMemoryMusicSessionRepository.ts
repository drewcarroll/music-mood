import { MusicSession } from '@domain/entities/MusicSession';
import { MusicSessionRepository } from '@domain/repositories/MusicSessionRepository';

/**
 * In-memory implementation of the MusicSessionRepository interface.
 * Suitable for a single-page app session. Swap for IndexedDB / a backend
 * implementation without touching the application or domain layers.
 */
export class InMemoryMusicSessionRepository implements MusicSessionRepository {
  private readonly store = new Map<string, MusicSession>();

  async save(session: MusicSession): Promise<void> {
    this.store.set(session.id, session);
  }

  async findById(id: string): Promise<MusicSession | null> {
    return this.store.get(id) ?? null;
  }

  async findActive(): Promise<MusicSession | null> {
    for (const session of this.store.values()) {
      if (session.status === 'playing' || session.status === 'paused') {
        return session;
      }
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
