import React from 'react';
import { useMusicMood } from '@interfaces/hooks/useMusicMood';
import { EmojiMoodBoard } from '@interfaces/components/EmojiMoodBoard';
import { MoodControls } from '@interfaces/components/MoodControls';
import { SessionPanel } from '@interfaces/components/SessionPanel';
import '@interfaces/styles/app.css';

/**
 * Root UI entry point (interfaces layer). Orchestrates presentation only —
 * all behavior flows through the controller via the useMusicMood hook.
 */
export function App(): React.JSX.Element {
  const { session, busy, error, settling, start, steer, play, pause, stop, setEmotionMix } =
    useMusicMood();

  return (
    <main className="app">
      <header className="app-header">
        <h1>🎵 Music Mood</h1>
        <p>Real-time music that follows your mood, powered by Lyria RealTime.</p>
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      <EmojiMoodBoard disabled={!session || settling} settling={settling} onChange={setEmotionMix} />

      <MoodControls
        hasSession={Boolean(session)}
        busy={busy}
        settling={settling}
        onStart={start}
        onSteer={steer}
      />

      <SessionPanel
        session={session}
        busy={busy}
        onPlay={play}
        onPause={pause}
        onStop={stop}
      />

      <footer className="app-footer">
        <small>
          Audio is generated on demand and played back via the Web Audio API,
          an AudioWorklet, and Tone.js.
        </small>
      </footer>
    </main>
  );
}
