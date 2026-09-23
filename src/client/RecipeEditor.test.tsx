import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  mockFetch,
  notFound,
  RECIPE_ID,
  recipe,
  renderRecipes,
  sent,
  staleVersion,
} from '../../test/client/recipes';
import { setRecipeFlash } from './recipe-client';
import {
  RECIPE_INGREDIENTS_MAX,
  RECIPE_STEP_MAX_LENGTH,
} from '../shared/recipes';

afterEach(() => {
  vi.restoreAllMocks();
  setRecipeFlash(null);
});

const detailPath = `/recipes/${RECIPE_ID}`;
const editPath = `${detailPath}/edit`;

const location = () => screen.getByTestId('location').textContent;

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), {
    target: { value },
  });

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

const lineValues = (list: 'ingredient' | 'step') =>
  screen
    .getAllByTestId(`${list}-line`)
    .map(
      (line) =>
        (line.querySelector('input, textarea') as HTMLInputElement).value,
    );

const fillMinimalRecipe = () => {
  type('Title', 'Rice');
  type('Ingredient 1', '1 cup rice');
  type('Step 1', 'Cook the rice.');
};

describe('Recipe form validation', () => {
  it('marks every missing field beside its control and sends nothing', async () => {
    const fetchMock = mockFetch();
    renderRecipes(['/recipes/new']);

    click('Save recipe');

    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription(
      /Enter a title between 1 and 120 characters\./u,
    );
    expect(
      screen.getByRole('group', { name: 'Ingredients' }),
    ).toHaveAccessibleDescription('Enter between 1 and 100 ingredients.');
    expect(
      screen.getByRole('group', { name: 'Steps' }),
    ).toHaveAccessibleDescription('Enter between 1 and 50 steps.');
    expect(screen.getByTestId('form-errors')).toHaveTextContent(
      'Check the highlighted fields',
    );
    await waitFor(() => expect(title).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('focuses the first line of a list that is missing', async () => {
    mockFetch();
    renderRecipes(['/recipes/new']);

    type('Title', 'Rice');
    click('Save recipe');

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Ingredient 1' }),
      ).toHaveFocus(),
    );
  });

  it('places a too-long line error on that line and keeps the text', async () => {
    mockFetch();
    renderRecipes(['/recipes/new']);

    fillMinimalRecipe();
    click('Add step');
    const long = 'x'.repeat(RECIPE_STEP_MAX_LENGTH + 1);
    type('Step 2', long);
    click('Save recipe');

    const step = screen.getByRole('textbox', { name: 'Step 2' });
    expect(step).toHaveAttribute('aria-invalid', 'true');
    expect(step).toHaveAccessibleDescription(
      `Step 2 is longer than 2000 characters (it has ${RECIPE_STEP_MAX_LENGTH + 1}).`,
    );
    expect(step).toHaveValue(long);
    // The list-level message would repeat the same problem.
    expect(
      screen.getByRole('group', { name: 'Steps' }),
    ).not.toHaveAccessibleDescription();
    await waitFor(() => expect(step).toHaveFocus());
  });

  it('reports notes over the bound', () => {
    mockFetch();
    renderRecipes(['/recipes/new']);

    fillMinimalRecipe();
    type('Notes', 'n'.repeat(4001));
    click('Save recipe');

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByText('Keep notes to 4000 characters or fewer.', {
        selector: 'p, div',
      }),
    ).toBeInTheDocument();
  });

  it('shows the bounds and how many lines are used', () => {
    mockFetch();
    renderRecipes(['/recipes/new']);

    expect(screen.getByText('Up to 120 characters.')).toBeInTheDocument();
    expect(
      screen.getByText(/Each up to 300 characters\. 1 of 100\./u),
    ).toBeInTheDocument();
    click('Add ingredient');
    expect(
      screen.getByText(/Each up to 300 characters\. 2 of 100\./u),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Optional. Up to 4,000 characters.'),
    ).toBeInTheDocument();
  });

  it('stops adding lines at the bound', () => {
    mockFetch();
    renderRecipes(['/recipes/new'], {
      initialDraft: {
        title: 'Big',
        ingredients: Array.from(
          { length: RECIPE_INGREDIENTS_MAX },
          (_, index) => `item ${index + 1}`,
        ),
        steps: ['Mix.'],
      },
    });

    expect(
      screen.getByRole('button', { name: 'Add ingredient' }),
    ).toBeDisabled();
    expect(
      screen.getByText('A recipe holds at most 100 ingredients.'),
    ).toBeInTheDocument();
  });
});

describe('Ordered lines', () => {
  it('adds a line and focuses it', async () => {
    mockFetch();
    renderRecipes(['/recipes/new']);

    click('Add ingredient');

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Ingredient 2' }),
      ).toHaveFocus(),
    );
  });

  it('moves lines with named buttons, keeps focus on the moved line, and announces it', async () => {
    mockFetch();
    renderRecipes(['/recipes/new'], {
      initialDraft: { title: 'T', ingredients: ['a', 'b', 'c'], steps: ['s'] },
    });

    // The first line cannot move up and the last cannot move down, so those
    // controls are not offered at all.
    expect(
      screen.queryByRole('button', { name: 'Move ingredient 1 up' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Move ingredient 3 down' }),
    ).toBeNull();

    click('Move ingredient 3 up');
    expect(lineValues('ingredient')).toEqual(['a', 'c', 'b']);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move ingredient 2 up' }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByText('Moved ingredient to position 2 of 3.'),
    ).toBeInTheDocument();

    // Reaching the top hands focus to the control that still works.
    click('Move ingredient 2 up');
    expect(lineValues('ingredient')).toEqual(['c', 'a', 'b']);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move ingredient 1 down' }),
      ).toHaveFocus(),
    );

    click('Move ingredient 1 down');
    expect(lineValues('ingredient')).toEqual(['a', 'c', 'b']);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move ingredient 2 down' }),
      ).toHaveFocus(),
    );

    click('Move ingredient 2 down');
    expect(lineValues('ingredient')).toEqual(['a', 'b', 'c']);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move ingredient 3 up' }),
      ).toHaveFocus(),
    );
  });

  it('removes a line, focuses its neighbour, and keeps at least one', async () => {
    mockFetch();
    renderRecipes(['/recipes/new'], {
      initialDraft: { title: 'T', ingredients: ['a'], steps: ['one', 'two'] },
    });

    expect(
      screen.queryByRole('button', { name: 'Remove ingredient 1' }),
    ).toBeNull();

    click('Remove step 2');
    expect(lineValues('step')).toEqual(['one']);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Step 1' })).toHaveFocus(),
    );
    expect(screen.getByText('Removed step 2.')).toBeInTheDocument();
  });
});

describe('Creating a recipe', () => {
  it('saves the lines in their order and opens the new recipe', async () => {
    const created = recipe({ title: 'Rice', version: 1 });
    const fetchMock = mockFetch(
      () => jsonResponse({ recipe: created }, 201),
      () => jsonResponse({ recipe: created }),
    );
    renderRecipes([
      '/recipes',
      { pathname: '/recipes/new', state: { from: 'list' } },
    ]);

    fillMinimalRecipe();
    click('Add ingredient');
    type('Ingredient 2', '  2 cups   water ');
    click('Move ingredient 2 up');
    click('Add step');
    type('Notes', 'Soak first.');
    click('Save recipe');

    expect(
      await screen.findByText('“Rice” was saved to the family recipes.'),
    ).toBeInTheDocument();
    expect(location()).toBe(detailPath);
    expect(sent(fetchMock, 0)).toEqual({
      url: '/api/recipes',
      method: 'POST',
      // Normalized by the shared validators; the blank step is dropped.
      body: {
        title: 'Rice',
        notes: 'Soak first.',
        ingredients: ['2 cups water', '1 cup rice'],
        steps: ['Cook the rice.'],
      },
    });
  });

  it('keeps everything typed when the server refuses the save', async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: {
            code: 'limit_reached',
            message:
              'A household library holds at most 500 recipes. Remove one before adding another.',
          },
        },
        400,
      ),
    );
    renderRecipes(['/recipes/new']);

    fillMinimalRecipe();
    click('Save recipe');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      'A household library holds at most 500 recipes.',
    );
    await waitFor(() => expect(status).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Rice');
    expect(lineValues('ingredient')).toEqual(['1 cup rice']);
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeEnabled();
    expect(location()).toBe('/recipes/new');
  });

  it('keeps the draft after a network failure', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderRecipes(['/recipes/new']);

    fillMinimalRecipe();
    click('Save recipe');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The recipe could not be saved. Check your connection and try again; your changes are still here.',
    );
    expect(lineValues('step')).toEqual(['Cook the rice.']);
  });

  it('cancels back to the library it came from', () => {
    mockFetch(() => jsonResponse({ recipes: [] }));
    renderRecipes([
      '/recipes',
      { pathname: '/recipes/new', state: { from: 'list' } },
    ]);

    click('Cancel');

    expect(location()).toBe('/recipes');
  });

  it('cancels to the library when opened directly', () => {
    mockFetch(() => jsonResponse({ recipes: [] }));
    renderRecipes(['/recipes/new']);

    click('Cancel');

    expect(location()).toBe('/recipes');
  });
});

describe('Reviewing an imported draft', () => {
  const importContext = {
    source: {
      kind: 'website' as const,
      submittedUrl: 'https://budgetbytes.com/rice/',
      resolvedUrl: 'https://www.budgetbytes.com/rice/',
      pageTitle: 'Rice',
    },
    notices: [
      { field: 'title' as const, count: 1 },
      { field: 'ingredients' as const, count: 3 },
      { field: 'ingredientLines' as const, count: 1 },
      { field: 'steps' as const, count: 1 },
      { field: 'stepLines' as const, count: 2 },
    ],
  };

  it('shows provenance and truncation, then saves with the source', async () => {
    const fetchMock = mockFetch(
      () => jsonResponse({ recipe: recipe({ title: 'Rice' }) }, 201),
      () => jsonResponse({ recipe: recipe({ title: 'Rice' }) }),
    );
    renderRecipes(['/recipes/new'], {
      initialDraft: {
        title: 'Rice',
        ingredients: ['1 cup rice'],
        steps: ['Cook.'],
      },
      importContext,
    });

    expect(
      screen.getByRole('heading', { name: 'Review imported recipe' }),
    ).toBeInTheDocument();
    const review = screen.getByTestId('import-review');
    expect(review).toHaveTextContent('copied from www.budgetbytes.com');
    expect(
      within(review).getByRole('link', {
        name: 'Open the original recipe on www.budgetbytes.com (opens in a new tab)',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    for (const text of [
      'The title was shortened to fit.',
      '3 ingredient lines were left out because a recipe holds at most 100.',
      '1 ingredient line was shortened to 300 characters.',
      '1 step was left out because a recipe holds at most 50.',
      '2 steps were shortened to 2000 characters.',
    ]) {
      expect(within(review).getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Rice');

    click('Save recipe');
    await screen.findByText('“Rice” was saved to the family recipes.');
    expect(sent(fetchMock, 0).body).toEqual({
      title: 'Rice',
      notes: null,
      ingredients: ['1 cup rice'],
      steps: ['Cook.'],
      source: importContext.source,
    });
  });

  it('shows no link for a source that is not https', () => {
    mockFetch();
    renderRecipes(['/recipes/new'], {
      initialDraft: { title: 'Rice', ingredients: ['r'], steps: ['c'] },
      importContext: {
        source: { kind: 'website', submittedUrl: 'not a url' },
        notices: [],
      },
    });

    expect(screen.getByTestId('import-review')).toHaveTextContent(
      'copied from a website',
    );
    expect(screen.queryByRole('link', { name: /original recipe/u })).toBeNull();
  });
});

describe('Editing a recipe', () => {
  const current = recipe({ version: 3, notes: 'Old note' });

  it('pre-fills the form and saves every field with the edited version', async () => {
    const fetchMock = mockFetch(
      () => jsonResponse({ recipe: current }),
      () => jsonResponse({ recipe: { ...current, version: 4 } }),
      () => jsonResponse({ recipe: { ...current, version: 4 } }),
    );
    renderRecipes([
      '/recipes',
      detailPath,
      { pathname: editPath, state: { from: 'detail' } },
    ]);

    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Soy chicken');
    expect(lineValues('ingredient')).toEqual(current.ingredients);
    expect(lineValues('step')).toEqual(current.steps);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
      'Old note',
    );

    type('Title', 'Soy chicken thighs');
    type('Notes', '');
    click('Save changes');

    expect(
      await screen.findByText('Your changes were saved.'),
    ).toBeInTheDocument();
    // Went back to the recipe rather than stacking another copy on history.
    expect(location()).toBe(detailPath);
    expect(sent(fetchMock, 1)).toEqual({
      url: `/api/recipes/${RECIPE_ID}`,
      method: 'PATCH',
      body: {
        version: 3,
        title: 'Soy chicken thighs',
        notes: null,
        ingredients: current.ingredients,
        steps: current.steps,
      },
    });
  });

  it('returns to the recipe when opened directly and cancelled', async () => {
    mockFetch(
      () => jsonResponse({ recipe: current }),
      () => jsonResponse({ recipe: current }),
    );
    renderRecipes([editPath]);

    await screen.findByRole('textbox', { name: 'Title' });
    click('Cancel');

    expect(location()).toBe(detailPath);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Soy chicken' }),
    ).toBeInTheDocument();
  });

  it('says so when the recipe to edit does not exist', async () => {
    mockFetch(notFound);
    renderRecipes([editPath]);

    expect(
      await screen.findByRole('heading', { name: 'Recipe not found' }),
    ).toBeInTheDocument();
  });

  it('keeps the draft when the recipe was deleted meanwhile', async () => {
    mockFetch(() => jsonResponse({ recipe: current }), notFound);
    renderRecipes([editPath]);

    await screen.findByRole('textbox', { name: 'Title' });
    type('Title', 'Mine');
    click('Save changes');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This recipe was deleted by another member',
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Mine');
  });

  it('keeps the draft after another failure', async () => {
    mockFetch(
      () => jsonResponse({ recipe: current }),
      () =>
        jsonResponse(
          { error: { code: 'invalid_request', message: 'Bad title.' } },
          400,
        ),
    );
    renderRecipes([editPath]);

    await screen.findByRole('textbox', { name: 'Title' });
    type('Title', 'Mine');
    click('Save changes');

    expect(await screen.findByRole('status')).toHaveTextContent('Bad title.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Mine');
  });

  describe('when another member saved first', () => {
    const theirs = recipe({
      version: 4,
      title: 'Soy chicken',
      steps: ['Marinate overnight.', 'Grill it.'],
      notes: 'Their note',
    });

    const conflictAfterEdit = async () => {
      const fetchMock = mockFetch(
        () => jsonResponse({ recipe: current }),
        () => staleVersion(theirs),
        () => jsonResponse({ recipe: { ...theirs, version: 5 } }),
        () => jsonResponse({ recipe: { ...theirs, version: 5 } }),
      );
      renderRecipes([
        detailPath,
        { pathname: editPath, state: { from: 'detail' } },
      ]);
      await screen.findByRole('textbox', { name: 'Title' });
      type('Title', 'My chicken');
      click('Save changes');
      const panel = await screen.findByTestId('recipe-conflict');
      return { fetchMock, panel };
    };

    it('explains the conflict, shows the latest version, and blocks saving', async () => {
      const { panel } = await conflictAfterEdit();

      expect(
        within(panel).getByRole('heading', {
          name: 'Another member changed this recipe',
        }),
      ).toBeInTheDocument();
      expect(panel).toHaveTextContent(
        'Your draft differs in its title, steps and notes.',
      );
      expect(
        within(panel).getByText('Marinate overnight.'),
      ).toBeInTheDocument();
      expect(within(panel).getByText('Their note')).toBeInTheDocument();
      await waitFor(() => expect(panel).toHaveFocus());
      // The member's own draft is untouched in the form.
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'My chicken',
      );
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      expect(
        screen.getByText(
          'Choose whether to keep or discard your changes first.',
        ),
      ).toBeInTheDocument();
    });

    it('re-applies the draft on the latest version when the member keeps it', async () => {
      const { fetchMock } = await conflictAfterEdit();

      click('Keep my changes');

      expect(screen.queryByTestId('recipe-conflict')).not.toBeInTheDocument();
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Your changes are kept. Choose Save changes to replace the latest version with them.',
      );
      click('Save changes');

      expect(
        await screen.findByText('Your changes were saved.'),
      ).toBeInTheDocument();
      expect(sent(fetchMock, 2).body).toMatchObject({
        version: 4,
        title: 'My chicken',
      });
      expect(location()).toBe(detailPath);
    });

    it('discards the draft and shows the latest version', async () => {
      const { fetchMock } = await conflictAfterEdit();

      click('Discard my changes');

      expect(
        await screen.findByText(
          'Your changes were discarded. This is the latest version.',
        ),
      ).toBeInTheDocument();
      expect(location()).toBe(detailPath);
      // Nothing more was written: the only calls are load, the refused save,
      // and the detail reload.
      expect(
        fetchMock.mock.calls.map((call) => call[1]?.method ?? 'GET'),
      ).toEqual(['GET', 'PATCH', 'GET']);
    });
  });
});
