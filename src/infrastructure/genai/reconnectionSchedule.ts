/**
 * Timing policy for transparent session reconnection.
 *
 * Lyria RealTime live sessions are capped at ~10 minutes. To keep a long demo
 * playing without a cutout we open a replacement session BEFORE the cap, let it
 * settle, then crossfade onto it. This module owns the (pure) timing math so the
 * durations can be validated and unit-tested independently of the WebSocket and
 * audio wiring that consume them.
 *
 * The timeline of one reconnect, measured from the current session's connect:
 *
 *   0 ───────────────► reconnectAfterMs ──settleMs──► (handoff) ──crossfadeMs──► done
 *   │                  open replacement   replacement   crossfade old→new   close old
 *   │                  + play + seed      is flowing
 *   └─ must all finish comfortably before SESSION_CAP_MS ─────────────────────┘
 */

/** The provider's hard session cap (~10 min). We must hand off before this. */
export const SESSION_CAP_MS = 10 * 60_000;

export interface ReconnectionOptions {
  /**
   * How long after a session connects to OPEN its replacement. Default leaves
   * ~90s of headroom before the cap for settling + crossfade + slack.
   */
  reconnectAfterMs: number;
  /**
   * How long to let the replacement stream warm up before handing off. Lyria
   * takes ~5–10s to settle into a coherent stream on a fresh connection, so we
   * keep playing the old stream until the new one is actually flowing.
   */
  settleMs: number;
  /** Crossfade duration when blending the old stream out and the new one in. */
  crossfadeMs: number;
}

export const DEFAULT_RECONNECTION: ReconnectionOptions = {
  reconnectAfterMs: 8.5 * 60_000, // 510_000
  settleMs: 7_000,
  crossfadeMs: 2_000,
};

/**
 * The wall-clock offset (from connect) at which the entire reconnect dance is
 * complete and the old session can be closed.
 */
export function handoffCompleteMs(opts: ReconnectionOptions): number {
  return opts.reconnectAfterMs + opts.settleMs + opts.crossfadeMs;
}

/**
 * True when the whole reconnect dance finishes before the session cap (with the
 * given safety margin). If this is false the old session could hit the cap
 * mid-handoff and cut out — exactly what we're preventing.
 */
export function fitsBeforeCap(
  opts: ReconnectionOptions,
  capMs: number = SESSION_CAP_MS,
  marginMs = 10_000,
): boolean {
  return (
    opts.reconnectAfterMs > 0 &&
    opts.settleMs >= 0 &&
    opts.crossfadeMs >= 0 &&
    handoffCompleteMs(opts) + marginMs <= capMs
  );
}

/**
 * Clamp/repair an options set so the dance always fits before the cap. If the
 * requested timings would overrun, the replacement is opened earlier (settle and
 * crossfade are preserved because they govern audio quality, not headroom).
 */
export function resolveReconnection(
  opts: ReconnectionOptions,
  capMs: number = SESSION_CAP_MS,
  marginMs = 10_000,
): ReconnectionOptions {
  if (fitsBeforeCap(opts, capMs, marginMs)) return opts;
  const reserved = opts.settleMs + opts.crossfadeMs + marginMs;
  // Open the replacement as late as possible while still finishing before the cap.
  const reconnectAfterMs = Math.max(1_000, capMs - reserved);
  return { ...opts, reconnectAfterMs };
}
