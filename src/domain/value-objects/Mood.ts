import { DomainError } from '../errors/DomainError';

/**
 * Canonical set of moods the application understands.
 * Kept in the domain because it is part of the ubiquitous language.
 */
export const MOOD_NAMES = [
  'calm',
  'energetic',
  'melancholic',
  'euphoric',
  'mysterious',
  'romantic',
  'tense',
  'dreamy',
] as const;

export type MoodName = (typeof MOOD_NAMES)[number];

/**
 * Mood is an immutable Value Object. Two Moods are equal when their
 * name and intensity are equal — they have no identity of their own.
 *
 * Invariants (enforced in the constructor):
 *  - name must be one of the canonical MOOD_NAMES
 *  - intensity must be within [0, 1]
 */
export class Mood {
  private constructor(
    public readonly name: MoodName,
    public readonly intensity: number,
  ) {
    Object.freeze(this);
  }

  static create(name: string, intensity = 0.6): Mood {
    if (!MOOD_NAMES.includes(name as MoodName)) {
      throw new DomainError(
        `Unknown mood "${name}". Expected one of: ${MOOD_NAMES.join(', ')}.`,
      );
    }
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new DomainError(
        `Mood intensity must be a number between 0 and 1, received "${intensity}".`,
      );
    }
    return new Mood(name as MoodName, intensity);
  }

  /** Returns a new Mood with adjusted intensity (immutability preserved). */
  withIntensity(intensity: number): Mood {
    return Mood.create(this.name, intensity);
  }

  equals(other: Mood): boolean {
    return this.name === other.name && this.intensity === other.intensity;
  }

  toString(): string {
    return `${this.name}@${this.intensity.toFixed(2)}`;
  }
}
