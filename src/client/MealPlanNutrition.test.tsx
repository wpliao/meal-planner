import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MONDAY,
  NOW,
  recipeEntry,
  renderPlan,
  textEntry,
  week,
} from '../../test/client/meal-plan';
import { jsonResponse } from '../../test/client/recipes';
import {
  aggregateMealPlanNutrition,
  type PlannedRecipeNutrition,
} from '../shared/meal-plan-nutrition';
import { NUTRIENT_KEYS } from '../shared/nutrition';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const meal = recipeEntry();
const text = textEntry();
const checked: PlannedRecipeNutrition = {
  recipeId: meal.kind === 'recipe' ? (meal.recipeId ?? '') : '',
  servings: 4,
  counted: 1,
  unchecked: 0,
  changed: 0,
  notCounted: 0,
  nutrients: Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, { value: 400, missing: false }]),
  ) as PlannedRecipeNutrition['nutrients'],
};

const nutrition = aggregateMealPlanNutrition(
  MONDAY,
  [meal, text],
  new Map([[checked.recipeId, checked]]),
);

const fetchUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

describe('meal-plan nutrition display', () => {
  it('reserves the week table while nutrition is still loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (fetchUrl(input).includes('/api/meal-plan/nutrition?'))
        return new Promise<Response>(() => undefined);
      return jsonResponse(week([meal, text]));
    });
    renderPlan([`/plan/${MONDAY}`]);
    await screen.findByTestId('plan-days');
    const section = within(screen.getByTestId('plan-nutrition'));
    expect(section.getByText('Checking nutrition…')).toBeInTheDocument();
    expect(section.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(
      section.getByRole('table').querySelectorAll('tbody tr'),
    ).toHaveLength(8);
  });

  it('shows eight week rows, a day disclosure, and an actionable gap', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = fetchUrl(input);
      if (url.includes('/api/meal-plan/nutrition?'))
        return jsonResponse(nutrition);
      return jsonResponse(week([meal, text]));
    });
    renderPlan([`/plan/${MONDAY}`]);

    const section = within(await screen.findByTestId('plan-nutrition'));
    expect(await section.findByText('100 kJ (24 kcal)')).toBeInTheDocument();
    expect(
      section.getByText(/1 of 2 planned entries included/),
    ).toBeInTheDocument();
    expect(within(section.getByRole('table')).getAllByRole('row')).toHaveLength(
      9,
    );
    fireEvent.click(section.getByText('Needs attention (1)'));
    expect(
      section.getByText(/No nutrition for text meals/),
    ).toBeInTheDocument();

    const day = screen.getByTestId('plan-day-nutrition');
    expect(day).toHaveTextContent('100 kJ (24 kcal)');
    fireEvent.click(
      within(day).getByText('Show all nutrients for Thursday 24 September'),
    );
    expect(within(day).getByRole('table')).toBeInTheDocument();
    expect(
      spy.mock.calls.some(([input]) =>
        fetchUrl(input).includes('/api/meal-plan/nutrition?week=2026-09-21'),
      ),
    ).toBe(true);
  });

  it('keeps the plan usable after nutrition fails and can retry', async () => {
    let nutritionCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (fetchUrl(input).includes('/api/meal-plan/nutrition?')) {
        nutritionCalls += 1;
        return nutritionCalls === 1
          ? jsonResponse({ error: { code: 'unavailable' } }, 503)
          : jsonResponse(nutrition);
      }
      return jsonResponse(week([meal, text]));
    });
    renderPlan([`/plan/${MONDAY}`]);
    expect(await screen.findByTestId('plan-days')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'We could not load nutrition. The plan is still available.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Try nutrition again' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('plan-nutrition')).getByText(
          /1 of 2 planned entries included/,
        ),
      ).toBeInTheDocument(),
    );
    expect(nutritionCalls).toBe(2);
  });
});
