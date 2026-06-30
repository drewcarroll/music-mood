import { useCallback, useEffect, useRef, useState } from 'react';
import { MusicSessionDto } from '@application/dtos/MusicSessionDto';
import { EMOTION_NAMES, WeightedEmotion } from '@domain/value-objects/EmotionDescriptor';
import { useMusicSessionController } from '@interfaces/context/UseCasesContext';

/**
 * Cadence of the easing render loop. Every tick the live `current` weights are
 * eased one step toward the slider `target`s and the whole prompt set is pushed,
 * so slider moves morph gradually rather than snapping. 120ms sits in the
 * 100–150ms sweet spot — smooth to the ear without hammering the model.
 */
const EASE_TICK_MS = 120;

/**
 * A freshly-opened (or restarted) stream spends several seconds settling into a
 * coherent sound. We hold the steering controls in a "settling" state for this
 * long after a start so the opening isn't the wobbly warm-up period and the
 * user's first slider move lands on an already-stable stream.
 */
const SETTLE_MS = 6_000;

/** Per-emotion live weight: the slider `target` and its last eased `current`. */
export interface LiveWeight {
  name: string;
  target: number;
  current: number;
}

interface MusicMoodState {
  session: MusicSessionDto | null;
  busy: boolean;
  error: string | null;
  /** True while a fresh stream stabilizes — controls are held until it clears. */
  settling: boolean;
}

/**
 * Presentation hook that adapts the controller into React state.
 * No business logic — just wiring async calls to component state.
 */
export function useMusicMood() {
  const controller = useMusicSessionController();
  const [state, setState] = useState<MusicMoodState>({
    session: null,
    busy: false,
    error: null,
    settling: false,
  });

  // Live weights live in a ref so the high-frequency tick never re-renders.
  // The emoji board reports slider positions via setEmotionMix (recorded as
  // `target`s); the easing loop eases each `current` toward its `target`.
  const mixRef = useRef<LiveWeight[]>(
    EMOTION_NAMES.map((name) => ({ name, target: 0, current: 0 })),
  );
  // The loop only pushes while there's easing left to do; a slider move re-arms
  // it, and a settled tick disarms it — so a resting mix isn't re-sent forever.
  const easingRef = useRef(false);
  // True once a stream is live. While false (before play / after stop) the
  // sliders mirror straight into `current` so the visualizer previews the blend
  // you're dialing; while true the easing loop owns `current` so live steering
  // morphs gradually instead of snapping.
  const liveRef = useRef(false);

  // While a fresh stream stabilizes we gate the controls. The ref drives the
  // high-frequency easing loop (no re-render); the state flag drives the UI.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settlingRef = useRef(false);

  const clearSettling = useCallback(() => {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    settlingRef.current = false;
  }, []);

  const beginSettling = useCallback(() => {
    clearSettling();
    settlingRef.current = true;
    setState((s) => ({ ...s, settling: true }));
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      settlingRef.current = false;
      setState((s) => ({ ...s, settling: false }));
    }, SETTLE_MS);
  }, [clearSettling]);

  // Drop any pending settle timer on unmount.
  useEffect(() => clearSettling, [clearSettling]);

  const apply = useCallback(
    async (
      action: () =>
        | Promise<{ ok: true; data: MusicSessionDto } | { ok: false; error: string }>
        | { ok: false; error: string },
    ) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      const result = await action();
      if (result.ok) {
        // Any completed action other than a start ends settling — clear the ref
        // and timer too so the easing loop's gate stays in sync with the UI.
        clearSettling();
        setState({ session: result.data, busy: false, error: null, settling: false });
      } else {
        setState((s) => ({ ...s, busy: false, error: result.error }));
      }
    },
    [clearSettling],
  );

  /**
   * Start a stream seeded directly from the current emoji-mix slider positions.
   * The opening sound IS that blend, so we sync each live `current` up to its
   * `target` (no 0→target ramp after settle) and idle the easing loop until the
   * user actually moves a slider.
   */
  const start = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    const mix = mixRef.current.map((m) => ({ ...m }));
    const result = await controller.startFromMix(mix);
    if (result.ok) {
      for (const slot of mixRef.current) slot.current = slot.target;
      liveRef.current = true;
      easingRef.current = false;
      setState({ session: result.data, busy: false, error: null, settling: true });
      beginSettling();
    } else {
      setState((s) => ({ ...s, busy: false, error: result.error }));
    }
  }, [controller, beginSettling]);

  const pause = useCallback(() => {
    const id = state.session?.id;
    if (!id) return;
    return apply(() => controller.pause(id));
  }, [apply, controller, state.session?.id]);

  const play = useCallback(() => {
    const id = state.session?.id;
    if (!id) return;
    return apply(() => controller.play(id));
  }, [apply, controller, state.session?.id]);

  const stop = useCallback(() => {
    const id = state.session?.id;
    if (!id) return;
    clearSettling();
    liveRef.current = false;
    return apply(() => controller.stop(id));
  }, [apply, controller, state.session?.id, clearSettling]);

  // Emoji-mix easing loop. The board reports slider positions via setEmotionMix;
  // we only record them as `target`s here. A ~120ms tick eases each `current`
  // toward its `target` and pushes the full prompt set, so moves morph
  // gradually. Only meaningful once a stream is live.
  const hasSession = Boolean(state.session);

  const setEmotionMix = useCallback((emotions: readonly WeightedEmotion[]) => {
    for (const e of emotions) {
      const slot = mixRef.current.find((m) => m.name === e.name);
      if (slot) {
        slot.target = e.target;
        // Pre-playback: mirror straight to `current` so the visualizer previews
        // the blend. During playback the easing loop owns `current`.
        if (!liveRef.current) slot.current = e.target;
      }
    }
    easingRef.current = true;
  }, []);

  // Stable accessor onto the live eased mix. The visualizer polls this each
  // animation frame, reading the `current` (eased) weights straight from the ref
  // so the morph is reflected without driving React re-renders at 60fps.
  const getLiveMix = useCallback(
    (): LiveWeight[] => mixRef.current.map((m) => ({ ...m })),
    [],
  );

  useEffect(() => {
    if (!hasSession) return;
    let inFlight = false;
    const id = setInterval(() => {
      // Hold off entirely while the fresh stream is still settling, skip while a
      // push is outstanding, and idle once the mix has settled.
      if (settlingRef.current || !easingRef.current || inFlight) return;
      inFlight = true;
      void controller
        .advanceEmotionMix(mixRef.current.map((m) => ({ ...m })))
        .then((result) => {
          if (!result.ok) {
            setState((s) => ({ ...s, error: result.error }));
            return;
          }
          for (const w of result.data.weights) {
            const slot = mixRef.current.find((m) => m.name === w.name);
            if (slot) slot.current = w.current;
          }
          if (result.data.settled) easingRef.current = false;
        })
        .finally(() => {
          inFlight = false;
        });
    }, EASE_TICK_MS);
    return () => clearInterval(id);
  }, [hasSession, controller]);

  return { ...state, start, play, pause, stop, setEmotionMix, getLiveMix };
}
