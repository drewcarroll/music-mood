import React from 'react';

interface TransportProps {
  /** Current session status, or undefined when no session exists yet. */
  status?: string;
  busy: boolean;
  /** A fresh stream is still stabilizing — steering is briefly held. */
  settling?: boolean;
  /** Human label for the live blend (e.g. "calm + happy"). */
  label?: string;
  onStart: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

/**
 * The single control surface for launching and transporting the stream. Before
 * playback (or after a stop) it's one Generate button; while a session is live
 * it's a play/pause/stop bar. Holds no business logic.
 */
export function Transport({
  status,
  busy,
  settling = false,
  label,
  onStart,
  onPlay,
  onPause,
  onStop,
}: TransportProps): React.JSX.Element {
  const live = status === 'playing' || status === 'paused';

  if (!live) {
    return (
      <section className="transport transport--launch">
        <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={onStart}>
          {busy ? 'Tuning in…' : status === 'stopped' ? 'Play again' : 'Generate'}
        </button>
        <p className="transport-hint">Shape the blend above, then begin — steer live as it plays.</p>
      </section>
    );
  }

  return (
    <section className="transport" aria-label="Playback">
      <div className="transport-status">
        <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
        <span className="now-playing">{label ?? 'your mix'}</span>
        <span className="status-word">{settling ? 'settling…' : status}</span>
      </div>
      <div className="transport-buttons">
        {status === 'playing' ? (
          <button type="button" className="btn" disabled={busy} onClick={onPause}>
            Pause
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onPlay}>
            Play
          </button>
        )}
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
