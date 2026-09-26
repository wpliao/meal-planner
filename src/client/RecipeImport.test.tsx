import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  mockFetch,
  renderRecipes,
  sent,
} from '../../test/client/recipes';
import {
  IMPORT_FAILURE_MESSAGES,
  importFailureMessage,
  setRecipeFlash,
} from './recipe-client';
import type {
  RecipeImportFailure,
  RecipeImportPreviewResponse,
} from '../shared/recipes';

afterEach(() => {
  vi.restoreAllMocks();
  setRecipeFlash(null);
});

const OYAKODON = 'https://www.justonecookbook.com/oyakodon/';

const preview = (
  over: Partial<RecipeImportPreviewResponse> = {},
): RecipeImportPreviewResponse => ({
  draft: {
    title: 'Oyakodon',
    ingredients: ['2 servings cooked rice', '½ onion', '4 large eggs'],
    steps: ['Slice the onion.', 'Simmer and cover.'],
    servings: null,
  },
  source: {
    submittedUrl: OYAKODON,
    resolvedUrl: null,
    host: 'www.justonecookbook.com',
    pageTitle: 'Oyakodon - Just One Cookbook',
  },
  notices: [],
  ...over,
});

const failure = (reason: RecipeImportFailure, status: number) =>
  jsonResponse(
    {
      error: { code: 'import_failed', message: `server text for ${reason}` },
      reason,
    },
    status,
  );

const link = () => screen.getByRole('textbox', { name: 'Recipe page link' });

const typeLink = (value: string) =>
  fireEvent.change(link(), { target: { value } });

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Get the recipe' }));

const openImport = () => renderRecipes(['/recipes/import']);

describe('Recipe import entry', () => {
  it('says that the site will be contacted and which sites are supported', () => {
    mockFetch();
    openImport();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Import a recipe' }),
    ).toBeVisible();
    expect(screen.getByTestId('recipe-panel')).toHaveTextContent(
      /This app will contact that website/u,
    );
    const sites = within(screen.getByTestId('import-sites')).getAllByRole(
      'listitem',
    );
    expect(sites.map((item) => item.textContent)).toEqual([
      'budgetbytes.com',
      'minimalistbaker.com',
      'sallysbakingaddiction.com',
      'justonecookbook.com',
      'thewoksoflife.com',
      'kikkoman.co.jp',
    ]);
  });

  it('offers manual entry from the entry screen', () => {
    mockFetch();
    openImport();

    expect(
      screen.getByRole('link', { name: 'Enter it by hand' }),
    ).toHaveAttribute('href', '/recipes/new');
  });

  it.each([
    [
      'a site that is not supported',
      'https://example.com/recipe',
      'only with https links',
    ],
    [
      'a plain http link',
      'http://www.justonecookbook.com/a/',
      'only with https links',
    ],
    [
      'a subdomain of a supported site',
      'https://blog.budgetbytes.com/a/',
      'only with https links',
    ],
    [
      'something that is not a link at all',
      'oyakodon',
      'does not look like a web address',
    ],
    ['an empty field', '   ', 'does not look like a web address'],
    [
      'a link that is far too long',
      `https://www.budgetbytes.com/${'a'.repeat(2100)}`,
      'too long to import',
    ],
  ])(
    'refuses %s in the form without asking the server',
    async (_name, value, message) => {
      const fetchMock = mockFetch();
      openImport();

      typeLink(value);
      submit();

      await waitFor(() => {
        expect(link()).toHaveAttribute('aria-invalid', 'true');
      });
      expect(link()).toHaveAccessibleDescription(new RegExp(message, 'u'));
      // Nothing left the browser, and the link stays there to be corrected.
      // A url field trims what it is given, which is why this is not `value`.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(link()).toHaveValue(value.trim());
    },
  );

  it('sends the normalized link to the Worker, never fetching the site itself', async () => {
    const fetchMock = mockFetch(() => jsonResponse(preview()));
    openImport();

    typeLink(`  ${OYAKODON}#recipe-card  `);
    submit();

    await screen.findByRole('heading', {
      level: 1,
      name: 'Review imported recipe',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock, 0)).toEqual({
      url: '/api/recipes/import-preview',
      method: 'POST',
      // Trimmed, and the fragment dropped, exactly as the Worker would.
      body: { url: OYAKODON },
    });
  });

  it('shows a bounded progress state naming the site while it waits', async () => {
    let answer: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    mockFetch(() => pending);
    openImport();

    typeLink(OYAKODON);
    submit();

    const progress = await screen.findByTestId('import-progress');
    expect(progress).toHaveTextContent(
      'Contacting www.justonecookbook.com… This can take up to 10 seconds.',
    );
    expect(
      screen.getByRole('button', { name: 'Contacting the site…' }),
    ).toBeDisabled();

    // A second submission while it waits starts nothing new.
    fireEvent.submit(progress.closest('form') as HTMLFormElement);

    answer(
      new Response(JSON.stringify(preview()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await screen.findByRole('heading', {
      level: 1,
      name: 'Review imported recipe',
    });
  });

  it('opens the editable copy with its draft, provenance, and source link', async () => {
    mockFetch(() => jsonResponse(preview()));
    openImport();

    typeLink(OYAKODON);
    submit();

    await screen.findByRole('heading', {
      level: 1,
      name: 'Review imported recipe',
    });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Oyakodon',
    );
    expect(screen.getAllByTestId('ingredient-line')).toHaveLength(3);
    expect(screen.getAllByTestId('step-line')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('');

    const review = screen.getByTestId('import-review');
    expect(review).toHaveTextContent(
      'The text below was copied from www.justonecookbook.com.',
    );
    expect(
      within(review).getByRole('link', {
        name: /Open the original recipe on www\.justonecookbook\.com/u,
      }),
    ).toHaveAttribute('href', OYAKODON);
  });

  it('carries the truncation notices into the review', async () => {
    mockFetch(() =>
      jsonResponse(
        preview({
          notices: [
            { field: 'ingredients', count: 4 },
            { field: 'stepLines', count: 1 },
          ],
        }),
      ),
    );
    openImport();

    typeLink(OYAKODON);
    submit();

    const review = await screen.findByTestId('import-review');
    expect(review).toHaveTextContent(
      '4 ingredient lines were left out because a recipe holds at most 100.',
    );
    expect(review).toHaveTextContent('1 step was shortened to 2000');
  });

  it('saves the reviewed copy with the source the preview returned', async () => {
    const fetchMock = mockFetch(
      () =>
        jsonResponse(
          preview({
            source: {
              ...preview().source,
              resolvedUrl: 'https://justonecookbook.com/oyakodon/',
            },
          }),
        ),
      () =>
        jsonResponse(
          {
            recipe: {
              id: '11111111-1111-4111-8111-111111111111',
              title: 'Oyakodon',
            },
          },
          201,
        ),
    );
    openImport();

    typeLink(OYAKODON);
    submit();

    await screen.findByRole('heading', {
      level: 1,
      name: 'Review imported recipe',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent(fetchMock, 1).body).toMatchObject({
      title: 'Oyakodon',
      source: {
        kind: 'website',
        submittedUrl: OYAKODON,
        resolvedUrl: 'https://justonecookbook.com/oyakodon/',
        pageTitle: 'Oyakodon - Just One Cookbook',
      },
    });
  });

  it.each([
    ['unsafe_destination', 400],
    ['source_unavailable', 502],
    ['unsupported_source', 422],
    ['too_large', 502],
    ['timeout', 504],
  ] as const)(
    'explains %s in its own words and still offers manual entry',
    async (reason, status) => {
      mockFetch(() => failure(reason, status));
      openImport();

      typeLink(OYAKODON);
      submit();

      const alert = await screen.findByTestId('import-failed');
      expect(alert).toHaveTextContent(IMPORT_FAILURE_MESSAGES[reason]);
      // The screen's own wording, not whatever the server happened to send.
      expect(alert).not.toHaveTextContent('server text for');
      expect(
        screen.getByRole('link', { name: 'Enter it by hand' }),
      ).toHaveAttribute('href', '/recipes/new');
      // The link stays in the field so it can be retried or corrected.
      expect(link()).toHaveValue(OYAKODON);
      expect(link()).toHaveFocus();
    },
  );

  it('falls back to the server message for a failure class it does not know', async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: { code: 'import_failed', message: 'Something new happened.' },
          reason: 'from_the_future',
        },
        400,
      ),
    );
    openImport();

    typeLink(OYAKODON);
    submit();

    expect(await screen.findByTestId('import-failed')).toHaveTextContent(
      'Something new happened.',
    );
  });

  it('explains a network failure without blaming the site', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    openImport();

    typeLink(OYAKODON);
    submit();

    expect(await screen.findByTestId('import-failed')).toHaveTextContent(
      'Check your connection and try again, or enter the recipe yourself.',
    );
  });

  it('lets a second attempt succeed after a failure', async () => {
    mockFetch(
      () => failure('timeout', 504),
      () => jsonResponse(preview()),
    );
    openImport();

    typeLink(OYAKODON);
    submit();
    await screen.findByTestId('import-failed');

    submit();
    await screen.findByRole('heading', {
      level: 1,
      name: 'Review imported recipe',
    });
    expect(screen.queryByTestId('import-failed')).toBeNull();
  });
});

describe('Recipe library', () => {
  it('offers the website import beside adding a recipe by hand', async () => {
    mockFetch(() => jsonResponse({ recipes: [] }));
    renderRecipes(['/recipes']);

    const importLink = await screen.findByRole('link', {
      name: 'Import from a website',
    });
    expect(importLink).toHaveAttribute('href', '/recipes/import');
  });
});

describe('importFailureMessage', () => {
  it('uses the fallback for anything that is not an API failure', () => {
    expect(importFailureMessage(new Error('boom'))).toContain(
      'enter the recipe yourself',
    );
    expect(importFailureMessage('not an error')).toContain(
      'Check your connection',
    );
  });
});
