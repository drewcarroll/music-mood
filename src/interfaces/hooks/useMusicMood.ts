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

/** Per-emotion live weight: the slider `target` and its last eased `current`. */
interface LiveWeight {
  name: string;
  target: number;
  current: number;
}

interface MusicMoodState {
  session: MusicSessionDto | null;
  busy: boolean;
  error: string | null;
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
  });

  const apply = useCallback(
    async (
      action: () =>
        | Promise<{ ok: true; data: MusicSessionDto } | { ok: false; error: string }>
        | { ok: false; error: string },
    ) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      const result = await action();
      if (result.ok) {
        setState({ session: result.data, busy: false, error: null });
      } else {
        setState((s) => ({ ...s, busy: false, error: result.error }));
      }
    },
    [],
  );

  const start = useCallback(
    (mood: string, intensity: number) => apply(() => controller.start(mood, intensity)),
    [apply, controller],
  );

  const steer = useCallback(
    (mood: string, intensity: number) => {
      const id = state.session?.id;
      if (!id) return apply(() => ({ ok: false, error: 'No active session.' }));
      return apply(() => controller.steer(id, mood, intensity));
    },
    [apply, controller, state.session?.id],
  );

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
    return apply(() => controller.stop(id));
  }, [apply, controller, state.session?.id]);

  // Emoji-mix easing render loop. The board reports slider positions via
  // setEmotionMix; we only record them as `target`s here. A ~120ms tick eases
  // each `current` toward its `target` and pushes the full prompt set, so moves
  // morph gradually. Only meaningful once a stream is live.
  const hasSession = Boolean(state.session);

  // Live weights live in a ref so the high-frequency tick never re-renders.
  const mixRef = useRef<LiveWeight[]>(
    EMOTION_NAMES.map((name) => ({ name, target: 0, current: 0 })),
  );
  // The loop only pushes while there's easing left to do; a slider move re-arms
  // it, and a settled tick disarms it — so a resting mix isn't re-sent forever.
  const easingRef = useRef(false);

  const setEmotionMix = useCallback((emotions: readonly WeightedEmotion[]) => {
    for (const e of emotions) {
      const slot = mixRef.current.find((m) => m.name === e.name);
      if (slot) slot.target = e.target;
    }
    easingRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    let inFlight = false;
    const id = setInterval(() => {
      // Skip while a push is outstanding, and idle once the mix has settled.
      if (!easingRef.current || inFlight) return;
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

  return { ...state, start, steer, play, pause, stop, setEmotionMix };
}
