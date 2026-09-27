import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { MealPlanNutritionResponse } from '../shared/meal-plan-nutrition';

export type NutritionState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: MealPlanNutritionResponse }
  | { kind: 'unavailable' };

/** Kept independent of the plan read so a nutrition failure cannot hide it. */
export function useMealPlanNutrition(
  weekStart: string,
  active: boolean,
  revision: number,
): { state: NutritionState; retry: () => void } {
  const [state, setState] = useState<NutritionState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void api<MealPlanNutritionResponse>(
      `/api/meal-plan/nutrition?week=${encodeURIComponent(weekStart)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.weekStart !== weekStart || value.days?.length !== 7) {
          setState({ kind: 'unavailable' });
          return;
        }
        setState({ kind: 'ready', value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, [active, attempt, revision, weekStart]);

  return { state, retry };
}
