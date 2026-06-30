import React, { useEffect, useState } from 'react';
import {
  EmotionName,
  EMOTION_NAMES,
  MAX_EMOTION_WEIGHT,
  MIN_EMOTION_WEIGHT,
  WeightedEmotion,
} from '@domain/value-objects/EmotionDescriptor';

const WEIGHT_STEP = 0.01;

/**
 * A tasteful opening blend the sliders start on, so a fresh launch sounds
 * inviting rather than muddy (all five at once) or silent (all zero). The user
 * adjusts these before hitting play to shape the opening, then steers live.
 */
const DEFAULT_MIX: Partial<Record<EmotionName, number>> = { calm: 1, happy: 0.55 };

/**
 * A characteristic color per emotion — purely presentational, used to tint each
 * slider so the controls echo the visualizer's palette. The canonical emotion
 * list and emoji still come from the domain value object.
 */
const EMOTION_COLOR: Record<EmotionName, string> = {
  happy: '#ffd34d',
  sad: '#5b9dff',
  angry: '#ff5d5d',
  calm: '#2fd3c4',
  hype: '#ff8a3d',
};

function defaultEmotions(): WeightedEmotion[] {
  return EMOTION_NAMES.map((name) => WeightedEmotion.create(name, DEFAULT_MIX[name] ?? 0));
}

interface EmojiMoodBoardProps {
  /** Locks the sliders (e.g. while a fresh stream is still stabilizing). */
  disabled?: boolean;
  /** Notified with the full set whenever a slider moves (and once on mount). */
  onChange?: (emotions: readonly WeightedEmotion[]) => void;
}

/**
 * The five emoji emotions, each an independent slider bound to that emotion's
 * weight. This is the single steering surface: before playback the sliders set
 * the opening blend; during playback they morph the live stream. Holds no
 * business logic — it leans on the WeightedEmotion value object for the
 * canonical set and the 0–2 range, and reports changes via `onChange`.
 */
export function EmojiMoodBoard({
  disabled = false,
  onChange,
}: EmojiMoodBoardProps): React.JSX.Element {
  const [emotions, setEmotions] = useState<WeightedEmotion[]>(defaultEmotions);

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
      className={`emoji-board${disabled ? ' is-disabled' : ''}`}
      aria-label="Emotion mix"
      aria-busy={disabled}
    >
      {emotions.map((emotion) => {
        const sliderId = `emoji-slider-${emotion.name}`;
        const pct = (emotion.target / MAX_EMOTION_WEIGHT) * 100;
        const color = EMOTION_COLOR[emotion.name];
        return (
          <div
            className="emoji-card"
            key={emotion.name}
            style={
              {
                '--emotion-color': color,
                '--fill': `${pct}%`,
                '--glow': emotion.target / MAX_EMOTION_WEIGHT,
              } as React.CSSProperties
            }
          >
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
