import { MusicSession } from '../entities/MusicSession';

/**
 * Repository INTERFACE — describes WHAT persistence operations exist,
 * never HOW they are implemented. Implementations live in infrastructure/.
 */
export interface MusicSessionRepository {
  save(session: MusicSession): Promise<void>;
  findById(id: string): Promise<MusicSession | null>;
  findActive(): Promise<MusicSession | null>;
  delete(id: string): Promise<void>;
}
