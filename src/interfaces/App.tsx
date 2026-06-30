import React from 'react';
import { useMusicMood } from '@interfaces/hooks/useMusicMood';
import { EmojiMoodBoard } from '@interfaces/components/EmojiMoodBoard';
import { MoodVisualizer } from '@interfaces/components/MoodVisualizer';
import { Transport } from '@interfaces/components/Transport';
import '@interfaces/styles/app.css';

/**
 * Root UI entry point (interfaces layer). Orchestrates presentation only —
 * all behavior flows through the controller via the useMusicMood hook.
 *
 * One instrument: shape the emoji blend, press play, steer live. The blend the
 * sliders describe IS the opening sound, so there's no separate "starter mood".
 */
export function App(): React.JSX.Element {
  const { session, busy, error, settling, start, play, pause, stop, setEmotionMix, getLiveMix } =
    useMusicMood();

  return (
    <main className="app">
      <header className="app-header">
        <span className="app-mark" aria-hidden="true" />
        <h1>Music Mood</h1>
        <p>Shape a feeling. Hear it in real time.</p>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <MoodVisualizer getWeights={getLiveMix} />

      <EmojiMoodBoard disabled={settling} onChange={setEmotionMix} />

      <Transport
        status={session?.status}
        busy={busy}
        settling={settling}
        label={session?.mood}
        onStart={start}
        onPlay={play}
        onPause={pause}
        onStop={stop}
      />

      <footer className="app-footer">
        <small>Generated live by Lyria RealTime · Web Audio · Tone.js</small>
      </footer>
    </main>
  );
}
