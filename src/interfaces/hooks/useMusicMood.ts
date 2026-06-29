import { useCallback, useState } from 'react';
import { MusicSessionDto } from '@application/dtos/MusicSessionDto';
import { useMusicSessionController } from '@interfaces/context/UseCasesContext';

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

  return { ...state, start, steer, play, pause, stop };
}
