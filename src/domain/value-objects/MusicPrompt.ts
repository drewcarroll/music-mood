import { DomainError } from '../errors/DomainError';

/**
 * A weighted text prompt sent to a generative music model.
 * Immutable Value Object — equality is by value.
 */
export class MusicPrompt {
  private constructor(
    public readonly text: string,
    public readonly weight: number,
  ) {
    Object.freeze(this);
  }

  static create(text: string, weight = 1): MusicPrompt {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new DomainError('A music prompt cannot be empty.');
    }
    if (trimmed.length > 280) {
      throw new DomainError('A music prompt cannot exceed 280 characters.');
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 10) {
      throw new DomainError(
        `Prompt weight must be a number in the range (0, 10], received "${weight}".`,
      );
    }
    return new MusicPrompt(trimmed, weight);
  }

  equals(other: MusicPrompt): boolean {
    return this.text === other.text && this.weight === other.weight;
  }
}
