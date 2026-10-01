import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, recipe, renderRecipes } from '../../test/client/recipes';
import { IMPORT_FAILURE_MESSAGES, setRecipeFlash } from './recipe-client';
import type {
  CreateRecipeRequest,
  RecipeImportPreviewResponse,
} from '../shared/recipes';

afterEach(() => {
  vi.restoreAllMocks();
  setRecipeFlash(null);
});

const page = (slug: string) => `https://www.budgetbytes.com/${slug}/`;

const preview = (
  url: string,
  over: Partial<RecipeImportPreviewResponse> = {},
): RecipeImportPreviewResponse => ({
  draft: {
    title: `Recipe from ${new URL(url).pathname}`,
    ingredients: ['1 cup rice', '2 eggs'],
    steps: ['Cook the rice.', 'Add the eggs.'],
    servings: 4,
  },
  source: {
    submittedUrl: url,
    resolvedUrl: null,
    host: 'www.budgetbytes.com',
    pageTitle: 'A page title',
  },
  notices: [],
  ...over,
});

const LIMIT_MESSAGE =
  'A household library holds at most 500 recipes. Remove one before adding another.';

type Answer = (body: unknown) => Promise<Response>;

/**
 * Answers the two endpoints the batch uses by link, and records every call
 * in order. A link with no preview answer fails the test loudly.
 */
const mockBatch = (
  previews: Record<string, Answer>,
  creates: Record<string, Answer> = {},
) => {
  const calls: { path: string; body: unknown }[] = [];
  let saved = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    // The client always calls with a path string and a JSON string body.
    const path = input as string;
    const body: unknown = JSON.parse(init?.body as string);
    calls.push({ path, body });
    if (path === '/api/recipes/import-preview') {
      const { url } = body as { url: string };
      const answer = previews[url];
      return answer ? answer(body) : Promise.reject(new Error(`no ${url}`));
    }
    const request = body as CreateRecipeRequest;
    const url =
      request.source?.kind === 'website' ? request.source.submittedUrl : '';
    const answer = creates[url];
    if (answer) return answer(body);
    saved += 1;
    return jsonResponse(
      {
        recipe: recipe({ id: `saved-${saved}`, title: request.title }),
      },
      201,
    );
  });
  return calls;
};

const previewOf =
  (url: string, over?: Partial<RecipeImportPreviewResponse>): Answer =>
  () =>
    jsonResponse(preview(url, over));

/** A response the test releases when it chooses. */
const held = () => {
  let release: (response: Response) => void = () => undefined;
  const answer: Answer = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  return {
    answer,
    release: (url: string) =>
      release(
        new Response(JSON.stringify(preview(url)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
  };
};

const links = () => screen.getByRole('textbox', { name: 'Recipe links' });
const paste = (text: string) =>
  fireEvent.change(links(), { target: { value: text } });
const start = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Import links' }));
const status = () => screen.getByTestId('bulk-import-status');
const rows = () => screen.queryAllByTestId('bulk-import-row');
const rowTexts = () => rows().map((row) => row.textContent);

const openScreen = async () => {
  renderRecipes(['/recipes/import/several']);
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Import several links',
    }),
  ).toBeInTheDocument();
};

describe('Import several links (#116)', () => {
  it('is reached from the import screen and lists the supported sites', async () => {
    renderRecipes(['/recipes/import']);
    fireEvent.click(
      await screen.findByRole('link', { name: 'Import several links' }),
    );

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Import several links',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/recipes/import/several',
    );
    expect(links()).toHaveAccessibleDescription(
      'One link per line, up to 20. Each recipe is saved without a review step; you can edit it later.',
    );
    expect(screen.getByTestId('import-sites')).toHaveTextContent(
      'recipetineats.com',
    );
    expect(
      screen.getByRole('link', { name: /Import a recipe/u }),
    ).toHaveAttribute('href', '/recipes/import');
  });

  it('refuses an empty paste and more than 20 links before anything starts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await openScreen();

    paste('  \n\n ');
    start();
    expect(links()).toHaveAttribute('aria-invalid', 'true');
    expect(links()).toHaveAccessibleDescription(
      expect.stringContaining('Paste at least one recipe link.'),
    );
    expect(links()).toHaveFocus();

    const many = Array.from({ length: 23 }, (_unused, index) =>
      page(`recipe-${index}`),
    ).join('\n');
    paste(many);
    start();
    expect(links()).toHaveAttribute('aria-invalid', 'true');
    expect(links()).toHaveAccessibleDescription(
      expect.stringContaining('Paste up to 20 links at a time. You pasted 23.'),
    );
    // Nothing is cleared, and nothing was sent.
    expect(links()).toHaveValue(many);
    expect(rows()).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('imports links one at a time, in order, and shows every result', async () => {
    const saved = page('fried-rice');
    const already = page('soup');
    const unreadable = page('not-a-recipe');
    const offline = page('offline');
    const calls = mockBatch(
      {
        [saved]: previewOf(saved, {
          notices: [{ field: 'ingredients', count: 3 }],
        }),
        [already]: previewOf(already),
        [unreadable]: () =>
          jsonResponse(
            {
              error: { code: 'import_failed', message: 'server text' },
              reason: 'unsupported_source',
            },
            422,
          ),
        [offline]: () => Promise.reject(new TypeError('Failed to fetch')),
      },
      {
        [already]: () =>
          jsonResponse(
            {
              error: {
                code: 'duplicate_source',
                message: 'A recipe from this link is already in the library.',
              },
              existing: { id: 'existing-1', title: 'Soup we have' },
            },
            409,
          ),
      },
    );
    await openScreen();

    paste(
      [
        `${saved}#wprm-recipe`,
        'soup',
        'https://example.com/soup',
        saved,
        '',
        already,
        unreadable,
        offline,
      ].join('\n'),
    );
    start();

    await waitFor(() =>
      expect(status()).toHaveTextContent(
        'Saved 1, already in the library 1, failed 4, listed twice 1.',
      ),
    );
    expect(status()).toHaveFocus();

    // One link at a time, in the order pasted; refused lines and the repeat
    // are never sent.
    expect(calls.map(({ path, body }) => [path, body])).toEqual([
      ['/api/recipes/import-preview', { url: saved }],
      [
        '/api/recipes',
        {
          title: 'Recipe from /fried-rice/',
          notes: null,
          ingredients: ['1 cup rice', '2 eggs'],
          steps: ['Cook the rice.', 'Add the eggs.'],
          servings: 4,
          source: {
            kind: 'website',
            submittedUrl: saved,
            resolvedUrl: null,
            pageTitle: 'A page title',
          },
          onlyIfNewSource: true,
        },
      ],
      ['/api/recipes/import-preview', { url: already }],
      ['/api/recipes', expect.objectContaining({ onlyIfNewSource: true })],
      ['/api/recipes/import-preview', { url: unreadable }],
      ['/api/recipes/import-preview', { url: offline }],
    ]);

    expect(rowTexts()).toEqual([
      'www.budgetbytes.com/fried-rice/Saved: Recipe from /fried-rice/Some text was shortened to fit.',
      'soupFailed: this link is not a web address',
      'https://example.com/soupFailed: not a link from a supported site',
      'www.budgetbytes.com/fried-rice/Listed twice',
      'www.budgetbytes.com/soup/Already in the library: Soup we have',
      `www.budgetbytes.com/not-a-recipe/Failed: ${IMPORT_FAILURE_MESSAGES.unsupported_source}`,
      'www.budgetbytes.com/offline/Failed: the app could not be reached',
    ]);
    expect(
      within(rows()[0]).getByRole('link', { name: 'Recipe from /fried-rice/' }),
    ).toHaveAttribute('href', '/recipes/saved-1');
    expect(
      within(rows()[4]).getByRole('link', { name: 'Soup we have' }),
    ).toHaveAttribute('href', '/recipes/existing-1');
    expect(screen.getByTestId('bulk-import-results').tagName).toBe('OL');

    // The box is editable and empty again; only links worth retrying return.
    expect(links()).not.toHaveAttribute('readonly');
    expect(links()).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed links' }));
    expect(links()).toHaveValue(`${unreadable}\n${offline}`);
    expect(links()).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Retry failed links' }),
    ).not.toBeInTheDocument();
  });

  it('shows progress, locks the box, and stops after the link in flight', async () => {
    const first = page('first');
    const second = page('second');
    const third = page('third');
    const pending = held();
    const calls = mockBatch({
      [first]: previewOf(first),
      [second]: pending.answer,
      [third]: previewOf(third),
    });
    await openScreen();

    paste([first, second, third].join('\n'));
    start();

    await waitFor(() => expect(status()).toHaveTextContent('Importing 2 of 3'));
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(links()).toHaveAttribute('readonly');
    expect(
      screen.getByText('Keep this page open until the import finishes.'),
    ).toBeInTheDocument();
    expect(rowTexts()).toEqual([
      'www.budgetbytes.com/first/Saved: Recipe from /first/',
      'www.budgetbytes.com/second/Importing…',
      'www.budgetbytes.com/third/Waiting',
    ]);
    expect(
      screen.queryByRole('button', { name: 'Import links' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    pending.release(second);

    await waitFor(() =>
      expect(status()).toHaveTextContent('Saved 2, not imported 1.'),
    );
    expect(rowTexts()[2]).toBe('www.budgetbytes.com/third/Not imported');
    expect(calls.map(({ body }) => body)).not.toContainEqual({ url: third });
    // Nothing failed, so there is nothing to retry.
    expect(
      screen.queryByRole('button', { name: 'Retry failed links' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import links' })).toBeEnabled();
  });

  it('stops at the library limit and lists the rest as not imported', async () => {
    const first = page('first');
    const full = page('full');
    const later = page('later');
    const calls = mockBatch(
      {
        [first]: previewOf(first),
        [full]: previewOf(full),
        [later]: previewOf(later),
      },
      {
        [full]: () =>
          jsonResponse(
            { error: { code: 'limit_reached', message: LIMIT_MESSAGE } },
            400,
          ),
      },
    );
    await openScreen();

    paste([first, full, later].join('\n'));
    start();

    await waitFor(() =>
      expect(status()).toHaveTextContent('Saved 1, failed 1, not imported 1.'),
    );
    expect(rowTexts()).toEqual([
      'www.budgetbytes.com/first/Saved: Recipe from /first/',
      `www.budgetbytes.com/full/Failed: ${LIMIT_MESSAGE}`,
      'www.budgetbytes.com/later/Not imported',
    ]);
    expect(calls).toHaveLength(4);
    // A full library is not something a retry fixes.
    expect(
      screen.queryByRole('button', { name: 'Retry failed links' }),
    ).not.toBeInTheDocument();
  });

  it('stops after the link in flight when the member leaves the screen', async () => {
    const first = page('first');
    const second = page('second');
    const pending = held();
    const calls = mockBatch({
      [first]: pending.answer,
      [second]: previewOf(second),
    });
    await openScreen();

    paste([first, second].join('\n'));
    start();
    await waitFor(() => expect(status()).toHaveTextContent('Importing 1 of 2'));
    fireEvent.click(screen.getByRole('link', { name: /Import a recipe/u }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/recipes\/import$/u,
    );

    pending.release(first);
    // The link in flight is saved; the next one is never requested.
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map(({ path }) => path)).toEqual([
      '/api/recipes/import-preview',
      '/api/recipes',
    ]);
  });

  it('asks before the page is closed while a batch runs', async () => {
    const only = page('only');
    const pending = held();
    mockBatch({ [only]: pending.answer });
    await openScreen();

    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    paste(only);
    start();
    await waitFor(() => expect(status()).toHaveTextContent('Importing 1 of 1'));
    const busy = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);

    pending.release(only);
    await waitFor(() => expect(status()).toHaveTextContent('Saved 1.'));
    const done = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(done);
    expect(done.defaultPrevented).toBe(false);
  });
});
