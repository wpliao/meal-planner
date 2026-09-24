/* eslint-disable react-refresh/only-export-components -- a test helper is never hot-reloaded */
import { MantineProvider } from '@mantine/core';
import { render, type RenderResult } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  type InitialEntry,
} from 'react-router-dom';
import { theme } from '../../src/client/theme';
import { MealPlan } from '../../src/client/MealPlan';
import { RecipeDetail } from '../../src/client/RecipeDetail';
import type { MealPlanEntry } from '../../src/shared/meal-plan';

/** The device's "now" in plan tests: Thursday 24 September 2026, 10:00. */
export const NOW = new Date(2026, 8, 24, 10, 0);
export const TODAY = '2026-09-24';
export const MONDAY = '2026-09-21';

export const textEntry = (over: Partial<MealPlanEntry> = {}): MealPlanEntry =>
  ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    date: TODAY,
    slot: 'dinner',
    kind: 'text',
    title: 'Leftovers',
    note: null,
    version: 1,
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...over,
  }) as MealPlanEntry;

export const recipeEntry = (
  over: Partial<Extract<MealPlanEntry, { kind: 'recipe' }>> = {},
): MealPlanEntry => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  date: TODAY,
  slot: 'dinner',
  kind: 'recipe',
  title: 'Soy chicken',
  recipeId: '11111111-1111-4111-8111-111111111111',
  recipeRemoved: false,
  note: null,
  version: 1,
  updatedAt: '2026-09-24T00:00:00.000Z',
  ...over,
});

export const week = (entries: MealPlanEntry[], from = MONDAY) => ({
  from,
  to: from === MONDAY ? '2026-09-27' : from,
  entries,
});

function Where() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/** The plan routes, and a recipe's page, as `App.tsx` declares them. */
export const renderPlan = (entries: InitialEntry[]): RenderResult =>
  render(
    <MantineProvider env="test" theme={theme}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Where />
        <Routes>
          <Route path="/plan">
            <Route element={<MealPlan />} index />
            <Route element={<MealPlan />} path=":weekStart" />
          </Route>
          <Route element={<RecipeDetail />} path="/recipes/:id" />
          <Route element={<div>New recipe page</div>} path="/recipes/new" />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
