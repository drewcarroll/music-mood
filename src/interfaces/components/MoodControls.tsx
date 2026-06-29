import React, { useState } from 'react';

interface MoodControlsProps {
  hasSession: boolean;
  busy: boolean;
  onStart: (mood: string, intensity: number) => void;
  onSteer: (mood: string, intensity: number) => void;
}

const SUGGESTIONS = ['calm', 'energetic', 'melancholic', 'euphoric', 'mysterious', 'dreamy'];

/**
 * Presentational component. Collects mood input + intensity and delegates
 * to callbacks. Holds no business logic.
 */
export function MoodControls({
  hasSession,
  busy,
  onStart,
  onSteer,
}: MoodControlsProps): React.JSX.Element {
  const [mood, setMood] = useState('calm');
  const [intensity, setIntensity] = useState(0.6);

  return (
    <section className="mood-controls">
      <label className="field">
        <span>Mood</span>
        <input
          type="text"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="e.g. dreamy, energetic, spooky"
          list="mood-suggestions"
        />
        <datalist id="mood-suggestions">
          {SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span>Intensity: {intensity.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
      </label>

      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => onStart(mood, intensity)}>
          {hasSession ? 'Restart' : 'Generate'}
        </button>
        <button type="button" disabled={busy || !hasSession} onClick={() => onSteer(mood, intensity)}>
          Steer mood
        </button>
      </div>
    </section>
  );
}
