import { useCallback, useEffect, useRef, useState } from 'react';
import { MusicSessionDto } from '@application/dtos/MusicSessionDto';
import { WeightedEmotion } from '@domain/value-objects/EmotionDescriptor';
import { useMusicSessionController } from '@interfaces/context/UseCasesContext';

/** Coalesce rapid slider drags into one setWeightedPrompts call per ~120ms. */
const EMOTION_DEBOUNCE_MS = 120;

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

  // Debounced emoji-mix steering. Only meaningful once a stream is live, so it
  // no-ops without an active session (and skips the board's initial mount fire).
  const hasSession = Boolean(state.session);
  const emotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setEmotionMix = useCallback(
    (emotions: readonly WeightedEmotion[]) => {
      if (!hasSession) return;
      const weights = emotions.map((e) => ({ name: e.name, weight: e.target }));
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = setTimeout(() => {
        void controller.setEmotionMix(weights).then((result) => {
          if (!result.ok) setState((s) => ({ ...s, error: result.error }));
        });
      }, EMOTION_DEBOUNCE_MS);
    },
    [controller, hasSession],
  );

  useEffect(
    () => () => {
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
    },
    [],
  );

  return { ...state, start, steer, play, pause, stop, setEmotionMix };
}
