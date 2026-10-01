/* eslint-disable react-refresh/only-export-components -- a test helper is never hot-reloaded */
import { MantineProvider } from '@mantine/core';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  type InitialEntry,
} from 'react-router-dom';
import { theme } from '../../src/client/theme';
import { Recipes } from '../../src/client/Recipes';
import { RecipeDetail } from '../../src/client/RecipeDetail';
import {
  RecipeCreate,
  RecipeEdit,
  type RecipeCreateProps,
} from '../../src/client/RecipeEditPages';
import { RecipeImport } from '../../src/client/RecipeImport';
import type { Recipe, RecipeSummary } from '../../src/shared/recipes';

export const RECIPE_ID = '11111111-1111-4111-8111-111111111111';

export const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: RECIPE_ID,
  title: 'Soy chicken',
  notes: null,
  ingredients: ['2 tbsp soy sauce', '500 g chicken'],
  steps: ['Marinate the chicken.', 'Grill it.'],
  servings: null,
  link: null,
  source: { kind: 'manual' },
  version: 1,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

export const summary = (over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: RECIPE_ID,
  title: 'Soy chicken',
  source: { kind: 'manual', linkHost: null },
  version: 1,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

export const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

export const noContent = () =>
  Promise.resolve(new Response(null, { status: 204 }));

export const staleVersion = (current: Recipe) =>
  jsonResponse(
    {
      error: {
        code: 'stale_version',
        message:
          'Someone else changed this recipe. Review the latest version before saving again.',
      },
      current,
    },
    409,
  );

export const notFound = () =>
  jsonResponse(
    { error: { code: 'not_found', message: 'That recipe no longer exists.' } },
    404,
  );

/**
 * Answers fetches in order, like the pantry tests, and records every call so
 * a test can assert exactly what was sent.
 */
const spyOnFetch = () => vi.spyOn(globalThis, 'fetch');

export const mockFetch = (
  ...responses: (() => Promise<Response>)[]
): ReturnType<typeof spyOnFetch> => {
  const spy = spyOnFetch();
  for (const response of responses) spy.mockImplementationOnce(response);
  spy.mockImplementation(() =>
    Promise.reject(new Error('unexpected extra fetch')),
  );
  return spy;
};

/** The request a recorded fetch call sent. */
export const sent = (
  spy: ReturnType<typeof mockFetch>,
  index: number,
): { url: string; method: string; body: unknown } => {
  const [input, init] = spy.mock.calls[index];
  const raw = init?.body;
  return {
    url:
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    method: init?.method ?? 'GET',
    body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
  };
};

/** Shows the current path, so a test can assert where navigation landed. */
function Where() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/** The recipe routes as `App.tsx` declares them, in a memory router. */
export const renderRecipes = (
  entries: InitialEntry[],
  createProps: RecipeCreateProps = {},
): RenderResult =>
  render(
    <MantineProvider env="test" theme={theme}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Where />
        <Routes>
          <Route path="/recipes">
            <Route element={<Recipes />} index />
            <Route element={<RecipeCreate {...createProps} />} path="new" />
            <Route element={<RecipeImport />} path="import" />
            <Route element={<RecipeDetail />} path=":id" />
            <Route element={<RecipeEdit />} path=":id/edit" />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
