import React, { useEffect, useState } from 'react';
import {
  EmotionName,
  MAX_EMOTION_WEIGHT,
  MIN_EMOTION_WEIGHT,
  WeightedEmotion,
  createEmotionSet,
} from '@domain/value-objects/EmotionDescriptor';

const WEIGHT_STEP = 0.01;

interface EmojiMoodBoardProps {
  /** Baseline target weight every emotion starts at (defaults to 1 — neutral). */
  initialWeight?: number;
  /** Disables the sliders (e.g. before a stream is live). */
  disabled?: boolean;
  /**
   * The stream is live but still stabilizing: the sliders are held and a
   * settling indicator is shown until the opening has settled.
   */
  settling?: boolean;
  /** Notified with the full set whenever a slider moves. */
  onChange?: (emotions: readonly WeightedEmotion[]) => void;
}

/**
 * Presentational component: renders the five emoji emotions, each with an
 * independent slider bound to that emotion's target weight. Holds no business
 * logic — it leans on the WeightedEmotion value object for the canonical emoji
 * set and the 0–2 weight range, and reports changes upward via `onChange`.
 */
export function EmojiMoodBoard({
  initialWeight = 1,
  disabled = false,
  settling = false,
  onChange,
}: EmojiMoodBoardProps): React.JSX.Element {
  const [emotions, setEmotions] = useState<WeightedEmotion[]>(() =>
    createEmotionSet(initialWeight),
  );

  useEffect(() => {
    onChange?.(emotions);
  }, [emotions, onChange]);

  const handleTargetChange = (name: EmotionName, target: number): void => {
    setEmotions((prev) =>
      prev.map((emotion) => (emotion.name === name ? emotion.withTarget(target) : emotion)),
    );
  };

  return (
    <section
      className={`emoji-board${disabled ? ' is-disabled' : ''}${settling ? ' is-settling' : ''}`}
      aria-label="Emotion mix"
      aria-busy={settling}
    >
      {settling && (
        <p className="settling-note" role="status">
          <span className="settling-spinner" aria-hidden="true" />
          Letting the stream settle… controls unlock in a moment.
        </p>
      )}
      {emotions.map((emotion) => {
        const sliderId = `emoji-slider-${emotion.name}`;
        return (
          <div className="emoji-card" key={emotion.name}>
            <span className="emoji-glyph" role="img" aria-label={emotion.name}>
              {emotion.emoji}
            </span>
            <div className="emoji-label">
              <label htmlFor={sliderId} className="emoji-name">
                {emotion.name}
              </label>
              <span className="emoji-weight">{emotion.target.toFixed(2)}</span>
            </div>
            <input
              id={sliderId}
              type="range"
              className="emoji-range"
              min={MIN_EMOTION_WEIGHT}
              max={MAX_EMOTION_WEIGHT}
              step={WEIGHT_STEP}
              value={emotion.target}
              disabled={disabled}
              aria-valuetext={`${emotion.target.toFixed(2)} of ${MAX_EMOTION_WEIGHT}`}
              onChange={(e) => handleTargetChange(emotion.name, Number(e.target.value))}
            />
          </div>
        );
      })}
    </section>
  );
}
