import { Mood } from '../value-objects/Mood';
import { MusicPrompt } from '../value-objects/MusicPrompt';
import { InvalidSessionStateError } from '../errors/DomainError';

export type SessionStatus = 'idle' | 'playing' | 'paused' | 'stopped';

/**
 * MusicSession is an Entity: it has identity (id) and a lifecycle.
 * It protects its own invariants — illegal state transitions throw.
 *
 * The entity holds the *business* state of a generative-music session
 * but knows nothing about audio buffers, web sockets, or the Gemini SDK.
 */
export class MusicSession {
  private _status: SessionStatus = 'idle';
  private _prompts: MusicPrompt[] = [];

  private constructor(
    public readonly id: string,
    private _mood: Mood,
    public readonly createdAt: Date,
  ) {}

  static start(id: string, mood: Mood, now: Date = new Date()): MusicSession {
    const session = new MusicSession(id, mood, now);
    session._prompts = mood ? session.derivePrompts(mood) : [];
    return session;
  }

  get mood(): Mood {
    return this._mood;
  }

  get status(): SessionStatus {
    return this._status;
  }

  get prompts(): readonly MusicPrompt[] {
    return this._prompts;
  }

  /** Begin / resume playback. Valid from idle or paused. */
  play(): void {
    if (this._status === 'stopped') {
      throw new InvalidSessionStateError('Cannot play a stopped session.');
    }
    this._status = 'playing';
  }

  pause(): void {
    if (this._status !== 'playing') {
      throw new InvalidSessionStateError('Only a playing session can be paused.');
    }
    this._status = 'paused';
  }

  stop(): void {
    this._status = 'stopped';
  }

  /** Steer the session toward a new mood, recomputing the prompt set. */
  steerTo(mood: Mood): void {
    if (this._status === 'stopped') {
      throw new InvalidSessionStateError('Cannot steer a stopped session.');
    }
    this._mood = mood;
    this._prompts = this.derivePrompts(mood);
  }

  /**
   * Domain logic: translate a Mood into a set of weighted music prompts.
   * This is the core business rule of the product and therefore lives here.
   */
  private derivePrompts(mood: Mood): MusicPrompt[] {
    const descriptors: Record<string, string[]> = {
      calm: ['ambient pads', 'soft piano', 'gentle reverb'],
      energetic: ['driving drums', 'bright synth lead', 'uplifting tempo'],
      melancholic: ['minor key strings', 'slow cello', 'rain textures'],
      euphoric: ['euphoric trance', 'soaring leads', 'four on the floor'],
      mysterious: ['dark cinematic drones', 'distant bells', 'sparse percussion'],
      romantic: ['warm acoustic guitar', 'lush strings', 'intimate vocals'],
      tense: ['pulsing bass', 'dissonant strings', 'staccato stabs'],
      dreamy: ['shoegaze textures', 'reverb-drenched guitars', 'floating melody'],
    };

    const list = descriptors[mood.name] ?? ['neutral background music'];
    // Intensity scales the weight so stronger moods dominate the mix.
    const weight = Math.max(0.1, Math.min(10, mood.intensity * 4));
    return list.map((text) => MusicPrompt.create(`${mood.name} ${text}`, weight));
  }
}
