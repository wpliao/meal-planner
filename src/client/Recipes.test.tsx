import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  mockFetch,
  noContent,
  notFound,
  RECIPE_ID,
  recipe,
  renderRecipes,
  sent,
  staleVersion,
  summary,
} from '../../test/client/recipes';
import { setRecipeFlash } from './recipe-client';

afterEach(() => {
  vi.restoreAllMocks();
  setRecipeFlash(null);
});

const detailPath = `/recipes/${RECIPE_ID}`;

const location = () => screen.getByTestId('location').textContent;

describe('Recipe library list', () => {
  it('announces loading and then shows a distinct empty state', async () => {
    mockFetch(() => jsonResponse({ recipes: [] }));
    renderRecipes(['/recipes']);

    expect(screen.getByText('Checking your recipes…')).toBeInTheDocument();
    expect(await screen.findByTestId('recipes-empty')).toHaveTextContent(
      'No recipes yet.',
    );
    expect(screen.queryByTestId('recipe-list')).not.toBeInTheDocument();
  });

  it('offers a retry when the library cannot be loaded', async () => {
    const fetchMock = mockFetch(
      () => jsonResponse({}, 503),
      () => jsonResponse({ recipes: [summary()] }),
    );
    renderRecipes(['/recipes']);

    expect(
      await screen.findByText(
        'We could not load the recipes. Please try again.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('link', { name: 'Soy chicken' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lists titles with their source and links each one to its detail', async () => {
    mockFetch(() =>
      jsonResponse({
        recipes: [
          summary({ id: 'a', title: 'Soy chicken' }),
          summary({
            id: 'b',
            title: 'Miso soup',
            source: { kind: 'website', host: 'www.justonecookbook.com' },
          }),
        ],
      }),
    );
    renderRecipes(['/recipes']);

    const items = await screen.findAllByTestId('recipe-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Soy chicken');
    expect(items[0]).toHaveTextContent('Source: Manual');
    expect(items[1]).toHaveTextContent('Source: www.justonecookbook.com');
    expect(
      within(items[1]).getByRole('link', { name: 'Miso soup' }),
    ).toHaveAttribute('href', '/recipes/b');
    expect(screen.getByRole('link', { name: 'Add recipe' })).toHaveAttribute(
      'href',
      '/recipes/new',
    );
  });

  it('shows recipe text literally rather than as markup', async () => {
    mockFetch(() =>
      jsonResponse({ recipes: [summary({ title: '<b>x</b> & <i>y</i>' })] }),
    );
    const { container } = renderRecipes(['/recipes']);

    expect(
      await screen.findByRole('link', { name: '<b>x</b> & <i>y</i>' }),
    ).toBeInTheDocument();
    expect(container.querySelector('b, i')).toBeNull();
  });
});

describe('Recipe detail', () => {
  it('shows ingredients in order, numbered steps, and notes', async () => {
    mockFetch(() =>
      jsonResponse({
        recipe: recipe({
          ingredients: ['rice', 'water', 'salt'],
          steps: ['Rinse.', 'Soak.', 'Cook.'],
          notes: 'Family favourite.\nUse short grain.',
        }),
      }),
    );
    renderRecipes([detailPath]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Soy chicken' }),
    ).toBeInTheDocument();
    const ingredients = screen.getByTestId('recipe-ingredients');
    expect(
      within(ingredients)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['rice', 'water', 'salt']);
    const steps = screen.getByTestId('recipe-steps');
    expect(steps.tagName).toBe('OL');
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Rinse.', 'Soak.', 'Cook.']);
    expect(screen.getByTestId('recipe-notes').textContent).toBe(
      'Family favourite.\nUse short grain.',
    );
    expect(screen.getByText('Entered by hand')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /original recipe/u })).toBeNull();
  });

  it('omits the notes section when a recipe has none', async () => {
    mockFetch(() => jsonResponse({ recipe: recipe({ notes: null }) }));
    renderRecipes([detailPath]);

    await screen.findByRole('heading', { level: 1, name: 'Soy chicken' });
    expect(screen.queryByRole('heading', { name: 'Notes' })).toBeNull();
  });

  it('links a website copy to its source safely and descriptively', async () => {
    mockFetch(() =>
      jsonResponse({
        recipe: recipe({
          source: {
            kind: 'website',
            submittedUrl: 'https://budgetbytes.com/soy-chicken/',
            resolvedUrl: 'https://www.budgetbytes.com/soy-chicken/',
            host: 'www.budgetbytes.com',
            pageTitle: 'Soy Chicken',
            importedAt: '2026-09-20T00:00:00.000Z',
          },
        }),
      }),
    );
    renderRecipes([detailPath]);

    const link = await screen.findByRole('link', {
      name: 'Open the original recipe on www.budgetbytes.com (opens in a new tab)',
    });
    expect(link).toHaveAttribute(
      'href',
      'https://www.budgetbytes.com/soy-chicken/',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByText(/Copied from www\.budgetbytes\.com/u),
    ).toBeVisible();
  });

  it('never turns a non-https stored source into a link', async () => {
    mockFetch(() =>
      jsonResponse({
        recipe: recipe({
          source: {
            kind: 'website',
            submittedUrl: 'javascript:alert(1)',
            resolvedUrl: null,
            host: 'budgetbytes.com',
            pageTitle: null,
            importedAt: '2026-09-20T00:00:00.000Z',
          },
        }),
      }),
    );
    renderRecipes([detailPath]);

    await screen.findByText(/Copied from budgetbytes\.com/u);
    expect(screen.queryByRole('link', { name: /original recipe/u })).toBeNull();
  });

  it('renders markup in every recipe field as plain text', async () => {
    mockFetch(() =>
      jsonResponse({
        recipe: recipe({
          title: '<b>x</b>',
          ingredients: ['<img src=x onerror=alert(1)>'],
          steps: ['<script>alert(1)</script>'],
          notes: '<a href="https://evil.test">click</a>',
        }),
      }),
    );
    const { container } = renderRecipes([detailPath]);

    expect(
      await screen.findByRole('heading', { level: 1, name: '<b>x</b>' }),
    ).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
    expect(
      container.querySelector('b, img, script, a[href*="evil"]'),
    ).toBeNull();
  });

  it('says when a recipe does not exist, without disclosing anything', async () => {
    mockFetch(notFound);
    renderRecipes(['/recipes/not-a-recipe']);

    expect(
      await screen.findByRole('heading', { name: 'Recipe not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All recipes/u })).toHaveAttribute(
      'href',
      '/recipes',
    );
  });

  it('retries a recipe that could not be loaded', async () => {
    const fetchMock = mockFetch(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => jsonResponse({ recipe: recipe() }),
    );
    renderRecipes([detailPath]);

    expect(screen.getByText('Opening the recipe…')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Soy chicken' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('links to the editor for this recipe', async () => {
    mockFetch(() => jsonResponse({ recipe: recipe() }));
    renderRecipes([detailPath]);

    expect(
      await screen.findByRole('link', { name: 'Edit recipe' }),
    ).toHaveAttribute('href', `${detailPath}/edit`);
  });
});

describe('Recipe deletion', () => {
  const openDialog = async () => {
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete recipe' }),
    );
    return screen.findByRole('dialog');
  };

  it('names the recipe in a focus-trapped dialog and cancels without deleting', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ recipe: recipe() }));
    renderRecipes([detailPath]);

    const trigger = await screen.findByRole('button', {
      name: 'Delete recipe',
    });
    const dialog = await openDialog();
    expect(
      within(dialog).getByText('Delete “Soy chicken”?'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without deleting', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ recipe: recipe() }));
    renderRecipes([detailPath]);

    fireEvent.keyDown(await openDialog(), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deletes with the current version and returns to the library', async () => {
    const fetchMock = mockFetch(
      () => jsonResponse({ recipe: recipe({ version: 4 }) }),
      noContent,
      () => jsonResponse({ recipes: [] }),
    );
    renderRecipes(['/recipes', detailPath]);

    const dialog = await openDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete recipe' }),
    );

    expect(
      await screen.findByText('“Soy chicken” was deleted.'),
    ).toBeInTheDocument();
    expect(location()).toBe('/recipes');
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
    expect(sent(fetchMock, 1)).toEqual({
      url: `/api/recipes/${RECIPE_ID}`,
      method: 'DELETE',
      body: { version: 4 },
    });
  });

  it('keeps the recipe and shows the latest version after a stale delete', async () => {
    const newer = recipe({ title: 'Soy chicken (spicy)', version: 2 });
    const fetchMock = mockFetch(
      () => jsonResponse({ recipe: recipe() }),
      () => staleVersion(newer),
      noContent,
      () => jsonResponse({ recipes: [] }),
    );
    renderRecipes([detailPath]);

    fireEvent.click(
      within(await openDialog()).getByRole('button', { name: 'Delete recipe' }),
    );

    expect(
      await screen.findByText(/Another member changed this recipe/u),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Soy chicken (spicy)' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
    expect(location()).toBe(detailPath);

    // Deleting again now names and sends the version the member can see.
    const dialog = await openDialog();
    expect(
      within(dialog).getByText('Delete “Soy chicken (spicy)”?'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete recipe' }),
    );
    await screen.findByText('“Soy chicken (spicy)” was deleted.');
    expect(sent(fetchMock, 2).body).toEqual({ version: 2 });
  });

  it('returns to the library when the recipe was already deleted', async () => {
    mockFetch(
      () => jsonResponse({ recipe: recipe() }),
      notFound,
      () => jsonResponse({ recipes: [] }),
    );
    renderRecipes([detailPath]);

    fireEvent.click(
      within(await openDialog()).getByRole('button', { name: 'Delete recipe' }),
    );

    expect(
      await screen.findByText('“Soy chicken” had already been deleted.'),
    ).toBeInTheDocument();
    expect(location()).toBe('/recipes');
  });

  it('reports a failed delete and keeps the recipe on screen', async () => {
    mockFetch(
      () => jsonResponse({ recipe: recipe() }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );
    renderRecipes([detailPath]);

    fireEvent.click(
      within(await openDialog()).getByRole('button', { name: 'Delete recipe' }),
    );

    expect(
      await screen.findByText(
        'The recipe could not be deleted. Check your connection and try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Soy chicken' }),
    ).toBeInTheDocument();
  });
});

describe('Recipe preferences', () => {
  const favouriteButton = () =>
    screen.getByRole('button', { name: 'Mark as favourite' });
  const preferencesResponse = (
    favourite: boolean,
    notNowUntil: string | null = null,
  ) => jsonResponse({ preferences: { favourite, notNowUntil } });

  it('marks and unmarks a family favourite without touching the recipe', async () => {
    const spy = mockFetch(
      () =>
        jsonResponse({
          recipe: recipe(),
          preferences: { favourite: false, notNowUntil: null },
        }),
      () => preferencesResponse(true),
      () => preferencesResponse(false),
    );
    renderRecipes([detailPath]);
    await screen.findByRole('heading', { level: 1, name: 'Soy chicken' });

    expect(favouriteButton()).toHaveAttribute('aria-pressed', 'false');
    expect(favouriteButton()).toHaveTextContent('Mark as favourite');
    fireEvent.click(favouriteButton());
    await waitFor(() =>
      expect(favouriteButton()).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(favouriteButton()).toHaveTextContent('Favourite');
    expect(sent(spy, 1)).toEqual({
      url: `/api/recipes/${RECIPE_ID}/preferences`,
      method: 'PUT',
      body: { favourite: true },
    });

    fireEvent.click(favouriteButton());
    await waitFor(() =>
      expect(favouriteButton()).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(sent(spy, 2).body).toEqual({ favourite: false });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('keeps the state and says so when a change fails', async () => {
    mockFetch(
      () =>
        jsonResponse({
          recipe: recipe(),
          preferences: { favourite: true, notNowUntil: null },
        }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );
    renderRecipes([detailPath]);
    await screen.findByRole('heading', { level: 1, name: 'Soy chicken' });

    fireEvent.click(favouriteButton());
    expect(await screen.findByTestId('recipe-result')).toHaveTextContent(
      'That could not be saved. Try again.',
    );
    expect(favouriteButton()).toHaveAttribute('aria-pressed', 'true');
    expect(favouriteButton()).toBeEnabled();
  });

  it('says when a recipe is hidden from suggestions and shows it again', async () => {
    const spy = mockFetch(
      () =>
        jsonResponse({
          recipe: recipe(),
          preferences: {
            favourite: false,
            notNowUntil: '2099-01-02T12:00:00.000Z',
          },
        }),
      () => preferencesResponse(false),
    );
    renderRecipes([detailPath]);
    const hidden = await screen.findByTestId('recipe-not-now');
    expect(hidden).toHaveTextContent(
      'Hidden from suggestions until Friday 2 January.',
    );

    fireEvent.click(
      within(hidden).getByRole('button', { name: 'Show in suggestions' }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('recipe-not-now')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1).body).toEqual({ notNow: false });
    expect(
      await screen.findByText('“Soy chicken” can be suggested again.'),
    ).toBeInTheDocument();
  });

  it('shows nothing for a Not now that has already ended', async () => {
    mockFetch(() =>
      jsonResponse({
        recipe: recipe(),
        preferences: {
          favourite: false,
          notNowUntil: '2000-01-01T00:00:00.000Z',
        },
      }),
    );
    renderRecipes([detailPath]);
    await screen.findByRole('heading', { level: 1, name: 'Soy chicken' });
    expect(screen.queryByTestId('recipe-not-now')).not.toBeInTheDocument();
  });
});
