import React from 'react';
import { MusicSessionDto } from '@application/dtos/MusicSessionDto';

interface SessionPanelProps {
  session: MusicSessionDto | null;
  busy: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

export function SessionPanel({
  session,
  busy,
  onPlay,
  onPause,
  onStop,
}: SessionPanelProps): React.JSX.Element {
  if (!session) {
    return <p className="empty">No active session yet. Pick a mood and hit Generate.</p>;
  }

  return (
    <section className="session-panel">
      <header>
        <h2>
          {session.mood} <span className="badge">{session.status}</span>
        </h2>
        <p className="intensity">intensity {session.intensity.toFixed(2)}</p>
      </header>

      <ul className="prompts">
        {session.prompts.map((p) => (
          <li key={p.text}>
            <span>{p.text}</span>
            <span className="weight">×{p.weight.toFixed(1)}</span>
          </li>
        ))}
      </ul>

      <div className="button-row">
        <button type="button" disabled={busy} onClick={onPlay}>
          ▶ Play
        </button>
        <button type="button" disabled={busy} onClick={onPause}>
          ⏸ Pause
        </button>
        <button type="button" disabled={busy} onClick={onStop}>
          ⏹ Stop
        </button>
      </div>
    </section>
  );
}
