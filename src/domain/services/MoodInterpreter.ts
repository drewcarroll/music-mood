import { Mood, MOOD_NAMES, MoodName } from '../value-objects/Mood';

/**
 * Domain Service: maps fuzzy, free-text user input onto the canonical
 * Mood vocabulary. This is pure business logic with no I/O, so it belongs
 * in the domain rather than in an LLM client or controller.
 *
 * (An infrastructure adapter could later provide an LLM-backed implementation
 * of a richer interpreter, but this deterministic version keeps the rule
 * inside the domain and dependency-free.)
 */
export class MoodInterpreter {
  private static readonly SYNONYMS: Record<string, MoodName> = {
    relaxed: 'calm',
    peaceful: 'calm',
    chill: 'calm',
    hyped: 'energetic',
    pumped: 'energetic',
    upbeat: 'energetic',
    sad: 'melancholic',
    blue: 'melancholic',
    nostalgic: 'melancholic',
    happy: 'euphoric',
    ecstatic: 'euphoric',
    eerie: 'mysterious',
    spooky: 'mysterious',
    loving: 'romantic',
    intimate: 'romantic',
    anxious: 'tense',
    nervous: 'tense',
    sleepy: 'dreamy',
    floaty: 'dreamy',
  };

  /**
   * Interpret raw input into a Mood. Falls back to a default mood when the
   * input matches nothing in the vocabulary.
   */
  interpret(rawInput: string, intensity = 0.6): Mood {
    const normalized = rawInput.trim().toLowerCase();

    if ((MOOD_NAMES as readonly string[]).includes(normalized)) {
      return Mood.create(normalized, intensity);
    }

    const synonym = MoodInterpreter.SYNONYMS[normalized];
    if (synonym) {
      return Mood.create(synonym, intensity);
    }

    // Last resort: substring match against canonical names.
    const partial = MOOD_NAMES.find((name) => normalized.includes(name));
    return Mood.create(partial ?? 'calm', intensity);
  }
}
