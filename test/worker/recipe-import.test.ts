import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECIPE_IMPORT_MAX_BYTES,
  RECIPE_IMPORT_MAX_REDIRECTS,
  RECIPE_IMPORT_TIMEOUT_MS,
  RECIPE_INGREDIENTS_MAX,
  RECIPE_STEP_MAX_LENGTH,
  type RecipeImportFailure,
  type RecipeImportPreviewResponse,
} from '../../src/shared/recipes';
import {
  importRecipePreview,
  type ImportFetch,
} from '../../src/worker/import/recipe-import';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  testEnv,
} from './helpers';
import {
  GRAPH_RECIPE_PAGE,
  htmlPage,
  JAPANESE_RECIPE_PAGE,
  NO_RECIPE_PAGE,
  SECTIONED_RECIPE_PAGE,
  SIMPLE_RECIPE_PAGE,
} from './import-pages';

const PREVIEW_URL = 'https://example.test/api/recipes/import-preview';
const OYAKODON = 'https://www.justonecookbook.com/oyakodon/';

interface Call {
  url: string;
  init: RequestInit;
}

/** A page source that never touches the network. */
const html = (body: string, contentType = 'text/html; charset=utf-8') =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });

const redirect = (status: number, location: string | null) =>
  new Response(null, {
    status,
    headers: location === null ? {} : { location },
  });

/**
 * Answers each URL from a local table and records exactly what was sent, so a
 * test can prove the request carried nothing it should not have.
 */
const fakeFetch = (
  pages: Readonly<Record<string, () => Response | Promise<Response>>>,
): { fetcher: ImportFetch; calls: Call[] } => {
  const calls: Call[] = [];
  const fetcher: ImportFetch = async (url, init) => {
    calls.push({ url, init });
    const page = pages[url];
    if (!page) throw new Error(`the test offered no page for ${url}`);
    return await page();
  };
  return { fetcher, calls };
};

const oneOf = (body: string) => ({ [OYAKODON]: () => html(body) });

const headersOf = (call: Call): Record<string, string> =>
  Object.fromEntries(new Headers(call.init.headers).entries());

const importOk = async (
  pages: Readonly<Record<string, () => Response | Promise<Response>>>,
  url = OYAKODON,
): Promise<RecipeImportPreviewResponse> => {
  const result = await importRecipePreview(url, {
    fetcher: fakeFetch(pages).fetcher,
  });
  expect(result.ok, `expected a draft, got ${JSON.stringify(result)}`).toBe(
    true,
  );
  if (!result.ok) throw new Error('unreachable');
  return result.preview;
};

const importFails = async (
  url: string,
  pages: Readonly<Record<string, () => Response | Promise<Response>>> = {},
  options: { timeoutMs?: number } = {},
): Promise<RecipeImportFailure> => {
  const result = await importRecipePreview(url, {
    fetcher: fakeFetch(pages).fetcher,
    ...options,
  });
  expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(
    false,
  );
  if (result.ok) throw new Error('unreachable');
  return result.reason;
};

describe('recipe import adapter', () => {
  describe('extraction', () => {
    it('reads the title, ingredients, and steps from a page of JSON-LD', async () => {
      const preview = await importOk(oneOf(SIMPLE_RECIPE_PAGE));

      expect(preview.draft).toEqual({
        // The entities in the JSON-LD string are decoded to real characters.
        title: 'Oyakodon – Chicken & Egg Rice Bowl',
        ingredients: [
          // The inline markup is removed, not rendered and not kept.
          '2 servings cooked Japanese short-grain rice',
          '½ onion',
          '2 Tbsp soy sauce',
          '4 large eggs',
        ],
        steps: [
          'Slice the onion thinly.',
          'Simmer the onion in the sauce until translucent.',
          'Pour the beaten eggs over the chicken and cover.',
          'Serve over rice.',
        ],
      });
      expect(preview.notices).toEqual([]);
      expect(preview.source).toEqual({
        submittedUrl: OYAKODON,
        resolvedUrl: null,
        host: 'www.justonecookbook.com',
        pageTitle: 'Oyakodon (Chicken and Egg Rice Bowl) - Just One Cookbook',
      });
    });

    it('ignores yield, times, images, ratings, nutrition, and author', async () => {
      const preview = await importOk(oneOf(SIMPLE_RECIPE_PAGE));
      const everything = JSON.stringify(preview);

      for (const unwanted of [
        '2 donburi bowls',
        'PT15M',
        'oyakodon.jpg',
        '4.8',
        '600 kcal',
        'Namiko Chen',
      ]) {
        expect(everything).not.toContain(unwanted);
      }
    });

    it('finds the recipe inside a @graph beside other page objects', async () => {
      const preview = await importOk(
        {
          'https://www.budgetbytes.com/sheet-pan-gnocchi/': () =>
            html(GRAPH_RECIPE_PAGE),
        },
        'https://www.budgetbytes.com/sheet-pan-gnocchi/',
      );

      expect(preview.draft.title).toBe('Sheet Pan Gnocchi');
      expect(preview.draft.ingredients).toHaveLength(3);
      // A HowToStep uses its text, or its name when it has no text.
      expect(preview.draft.steps).toEqual([
        'Heat the oven to 425°F.',
        'Toss the gnocchi with the oil and tomatoes.',
        'Roast for 25 minutes.',
      ]);
    });

    it('flattens the steps inside every HowToSection in document order', async () => {
      const preview = await importOk(
        {
          'https://sallysbakingaddiction.com/cookies/': () =>
            html(SECTIONED_RECIPE_PAGE),
        },
        'https://sallysbakingaddiction.com/cookies/',
      );

      expect(preview.draft.steps).toEqual([
        'Cream the butter and sugar.',
        'Fold in the flour.',
        'Chill the dough for two hours.',
        'Scoop onto a lined sheet.',
        'Bake for 12 minutes.',
      ]);
      // The section headings are not steps.
      expect(preview.draft.steps).not.toContain('Make the dough');
    });

    it('keeps Japanese text, full-width characters, and 大さじ units', async () => {
      const preview = await importOk(
        {
          'https://www.kikkoman.co.jp/homecook/search/recipe/00001234/': () =>
            html(JAPANESE_RECIPE_PAGE),
        },
        'https://www.kikkoman.co.jp/homecook/search/recipe/00001234/',
      );

      expect(preview.draft.title).toBe('ぶり大根');
      expect(preview.draft.ingredients).toEqual([
        'ぶり ４切れ',
        '大根 １／２本',
        'しょうゆ 大さじ２',
        'みりん 大さじ１と½',
      ]);
      expect(preview.draft.steps[0]).toBe('大根は２cm厚さの半月切りにする。');
      expect(preview.source.pageTitle).toBe('ぶり大根 | キッコーマン');
    });

    it('reports what it had to cut to fit the recipe bounds', async () => {
      const page = htmlPage(
        'Long',
        JSON.stringify({
          '@type': 'Recipe',
          name: 'A'.repeat(200),
          recipeIngredient: Array.from(
            { length: RECIPE_INGREDIENTS_MAX + 5 },
            (_unused, index) => `ingredient ${index + 1}`,
          ),
          recipeInstructions: ['b'.repeat(RECIPE_STEP_MAX_LENGTH + 10)],
        }),
      );
      const preview = await importOk(oneOf(page));

      expect(preview.draft.ingredients).toHaveLength(RECIPE_INGREDIENTS_MAX);
      expect(preview.notices).toEqual([
        { field: 'title', count: 1 },
        { field: 'ingredients', count: 5 },
        { field: 'stepLines', count: 1 },
      ]);
    });

    it('never evaluates a script and reads only the JSON-LD blocks', async () => {
      const page = htmlPage(
        'Scripted',
        JSON.stringify({
          '@type': 'Recipe',
          name: 'Plain rice',
          recipeIngredient: ['1 cup rice'],
          recipeInstructions: ['Cook it.'],
        }),
        `<script type="text/javascript">
           globalThis.__importEscaped = true;
           var recipeIngredient = ['should not be read'];
         </script>`,
      );
      const preview = await importOk(oneOf(page));

      expect(preview.draft.ingredients).toEqual(['1 cup rice']);
      expect('__importEscaped' in globalThis).toBe(false);
    });

    it('skips malformed JSON-LD and uses a later complete recipe', async () => {
      const page = `<!doctype html><html><head><title>Two blocks</title>
        <script type="application/ld+json">{ not json </script>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Recipe',
          name: 'Stub with no lines',
        })}</script>
        <script type="application/ld+json">${JSON.stringify({
          '@type': ['Recipe'],
          name: 'The real one',
          recipeIngredient: ['1 cup rice'],
          recipeInstructions: 'Cook the rice.',
        })}</script>
        </head><body></body></html>`;
      const preview = await importOk(oneOf(page));

      expect(preview.draft).toEqual({
        title: 'The real one',
        ingredients: ['1 cup rice'],
        steps: ['Cook the rice.'],
      });
    });

    it('treats markup in the extracted text as literal text', async () => {
      const page = htmlPage(
        'Injected',
        JSON.stringify({
          '@type': 'Recipe',
          name: '&lt;script&gt;alert(1)&lt;/script&gt; Rice',
          recipeIngredient: ['1 cup\u0000 rice'],
          recipeInstructions: ['Cook  \t it.'],
        }),
      );
      const preview = await importOk(oneOf(page));

      // The page escaped the tags, so they are text, and stay text.
      expect(preview.draft.title).toBe('<script>alert(1)</script> Rice');
      // Control characters are removed and whitespace runs collapse.
      expect(preview.draft.ingredients).toEqual(['1 cup rice']);
      expect(preview.draft.steps).toEqual(['Cook it.']);
    });
  });

  describe('destination policy', () => {
    const refusedBeforeAnyRequest = async (url: string) => {
      const { fetcher, calls } = fakeFetch({});
      const result = await importRecipePreview(url, { fetcher });
      expect(result).toEqual({ ok: false, reason: 'unsafe_destination' });
      expect(calls).toEqual([]);
    };

    it.each([
      ['plain http', 'http://www.justonecookbook.com/oyakodon/'],
      ['a host that is not on the allowlist', 'https://example.com/recipe'],
      [
        'a subdomain of an allowed host',
        'https://recipes.budgetbytes.com/gnocchi/',
      ],
      [
        'a host that merely ends with an allowed one',
        'https://evilbudgetbytes.com/gnocchi/',
      ],
      ['credentials in the URL', 'https://a:b@www.budgetbytes.com/gnocchi/'],
      ['a non-default port', 'https://www.budgetbytes.com:8443/gnocchi/'],
      ['a scheme that is not http(s)', 'javascript:alert(1)'],
      ['a file URL', 'file:///etc/passwd'],
      ['a URL that does not parse', 'not a url'],
      ['an empty string', ''],
    ])('refuses %s before any network request', async (_name, url) => {
      await refusedBeforeAnyRequest(url);
    });

    it('drops the fragment and sends only a fixed Accept and User-Agent', async () => {
      const { fetcher, calls } = fakeFetch(oneOf(SIMPLE_RECIPE_PAGE));
      const result = await importRecipePreview(`${OYAKODON}#recipe-card`, {
        fetcher,
      });

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(OYAKODON);
      expect(calls[0].init.method).toBe('GET');
      expect(calls[0].init.body ?? null).toBeNull();
      expect(calls[0].init.redirect).toBe('manual');
      expect(headersOf(calls[0])).toEqual({
        accept: 'text/html',
        'user-agent':
          'FamilyMealPlanner/1.0 (+private household recipe import)',
      });
    });
  });

  describe('redirects', () => {
    it('follows an allowed hop and records the resolved URL', async () => {
      const final = 'https://justonecookbook.com/oyakodon/';
      const preview = await importOk({
        [OYAKODON]: () => redirect(301, final),
        [final]: () => html(SIMPLE_RECIPE_PAGE),
      });

      expect(preview.source.submittedUrl).toBe(OYAKODON);
      expect(preview.source.resolvedUrl).toBe(final);
      // The host is the page the text was read from, not the one submitted.
      expect(preview.source.host).toBe('justonecookbook.com');
    });

    it('resolves a relative Location against the current URL', async () => {
      const preview = await importOk({
        [OYAKODON]: () => redirect(308, '../gyudon/'),
        'https://www.justonecookbook.com/gyudon/': () =>
          html(SIMPLE_RECIPE_PAGE),
      });

      expect(preview.source.resolvedUrl).toBe(
        'https://www.justonecookbook.com/gyudon/',
      );
      expect(preview.source.host).toBe('www.justonecookbook.com');
    });

    it.each([301, 302, 303, 307, 308])(
      'revalidates a %d hop against the whole destination policy',
      async (status) => {
        for (const location of [
          'https://example.com/recipe',
          'http://www.justonecookbook.com/oyakodon/',
          'https://a:b@www.justonecookbook.com/oyakodon/',
          'https://www.justonecookbook.com:8443/oyakodon/',
        ]) {
          const reason = await importFails(OYAKODON, {
            [OYAKODON]: () => redirect(status, location),
          });
          expect(reason, location).toBe('unsafe_destination');
        }
      },
    );

    it('follows three hops and refuses the fourth', async () => {
      const hop = (index: number) =>
        `https://www.budgetbytes.com/hop-${index}/`;
      const pages: Record<string, () => Response> = {};
      for (let index = 0; index < 5; index += 1) {
        pages[hop(index)] = () => redirect(302, hop(index + 1));
      }

      // Three hops then a page: allowed.
      const within = fakeFetch({
        ...pages,
        [hop(RECIPE_IMPORT_MAX_REDIRECTS)]: () => html(GRAPH_RECIPE_PAGE),
      });
      const allowed = await importRecipePreview(hop(0), {
        fetcher: within.fetcher,
      });
      expect(allowed.ok).toBe(true);
      expect(within.calls).toHaveLength(RECIPE_IMPORT_MAX_REDIRECTS + 1);

      // A fourth redirect: refused, and the fifth request never happens.
      const beyond = fakeFetch(pages);
      const refused = await importRecipePreview(hop(0), {
        fetcher: beyond.fetcher,
      });
      expect(refused).toEqual({ ok: false, reason: 'unsafe_destination' });
      expect(beyond.calls).toHaveLength(RECIPE_IMPORT_MAX_REDIRECTS + 1);
    });

    it('sends the same fixed headers on every hop', async () => {
      const second = 'https://budgetbytes.com/gnocchi/';
      const { fetcher, calls } = fakeFetch({
        'https://www.budgetbytes.com/gnocchi/': () => redirect(301, second),
        [second]: () => html(GRAPH_RECIPE_PAGE),
      });
      await importRecipePreview('https://www.budgetbytes.com/gnocchi/', {
        fetcher,
      });

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(headersOf(call)).toEqual({
          accept: 'text/html',
          'user-agent':
            'FamilyMealPlanner/1.0 (+private household recipe import)',
        });
        expect(call.init.method).toBe('GET');
        expect(call.init.redirect).toBe('manual');
      }
    });

    it('refuses a redirect that carries no Location', async () => {
      const reason = await importFails(OYAKODON, {
        [OYAKODON]: () => redirect(302, null),
      });
      expect(reason).toBe('unsupported_source');
    });
  });

  describe('response limits', () => {
    it.each([400, 403, 404, 429, 500, 503])(
      'reports %d as an unavailable source',
      async (status) => {
        const reason = await importFails(OYAKODON, {
          [OYAKODON]: () =>
            new Response('<html></html>', {
              status,
              headers: { 'content-type': 'text/html' },
            }),
        });
        expect(reason).toBe('source_unavailable');
      },
    );

    it.each([
      ['application/json', 'application/json'],
      ['text/plain', 'text/plain; charset=utf-8'],
      ['nothing at all', ''],
    ])('refuses a body typed %s', async (_name, contentType) => {
      const reason = await importFails(OYAKODON, {
        [OYAKODON]: () =>
          new Response(
            SIMPLE_RECIPE_PAGE,
            contentType === ''
              ? { status: 200, headers: {} }
              : { status: 200, headers: { 'content-type': contentType } },
          ),
      });
      expect(reason).toBe('unsupported_source');
    });

    it('accepts text/html with parameters', async () => {
      const preview = await importOk({
        [OYAKODON]: () => html(SIMPLE_RECIPE_PAGE, 'TEXT/HTML ;charset=UTF-8'),
      });
      expect(preview.draft.ingredients).toHaveLength(4);
    });

    it.each([204, 206, 304])('refuses a %d response', async (status) => {
      const reason = await importFails(OYAKODON, {
        [OYAKODON]: () =>
          new Response(null, {
            status,
            headers: { 'content-type': 'text/html' },
          }),
      });
      expect(reason).toBe('unsupported_source');
    });

    it.each([
      [
        'a page with no JSON-LD at all',
        '<html><head><title>x</title></head><body>Recipe</body></html>',
      ],
      ['JSON-LD that carries no Recipe', NO_RECIPE_PAGE],
    ])('refuses %s', async (_name, body) => {
      expect(await importFails(OYAKODON, oneOf(body))).toBe(
        'unsupported_source',
      );
    });

    it.each([
      ['no ingredients', { name: 'x', recipeInstructions: ['Cook.'] }],
      ['no instructions', { name: 'x', recipeIngredient: ['rice'] }],
      [
        'no usable name',
        { name: '   ', recipeIngredient: ['rice'], recipeInstructions: ['Go'] },
      ],
    ])('refuses a Recipe with %s', async (_name, recipe) => {
      const page = htmlPage(
        'Partial',
        JSON.stringify({ '@type': 'Recipe', ...recipe }),
      );
      expect(await importFails(OYAKODON, oneOf(page))).toBe(
        'unsupported_source',
      );
    });

    it('abandons a body once it passes 2 MiB', async () => {
      const chunk = new TextEncoder().encode('<p>'.padEnd(64 * 1024, 'x'));
      let pulled = 0;
      let cancelled = false;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });

      const reason = await importFails(OYAKODON, {
        [OYAKODON]: () =>
          new Response(endless, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      });

      expect(reason).toBe('too_large');
      expect(cancelled).toBe(true);
      // Far fewer than an unbounded read: the cap is 2 MiB of 64 KiB chunks.
      expect(pulled).toBeLessThan((RECIPE_IMPORT_MAX_BYTES / chunk.length) * 4);
    });

    it('refuses a declared Content-Length over 2 MiB and abandons the body', async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
        },
        cancel() {
          cancelled = true;
        },
      });
      const reason = await importFails(OYAKODON, {
        [OYAKODON]: () =>
          new Response(body, {
            status: 200,
            headers: {
              'content-type': 'text/html',
              'content-length': String(RECIPE_IMPORT_MAX_BYTES + 1),
            },
          }),
      });

      expect(reason).toBe('too_large');
      expect(cancelled).toBe(true);
    });

    it('gives up on a site that never answers', async () => {
      const stalls: ImportFetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });

      const result = await importRecipePreview(OYAKODON, {
        fetcher: stalls,
        timeoutMs: 25,
      });
      expect(result).toEqual({ ok: false, reason: 'timeout' });
    });

    it('gives up on a body that never finishes', async () => {
      const stalling: ImportFetch = (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('<html><head><title>Slow'),
            );
            init.signal?.addEventListener('abort', () =>
              controller.error(new Error('aborted')),
            );
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        );
      };

      const result = await importRecipePreview(OYAKODON, {
        fetcher: stalling,
        timeoutMs: 25,
      });
      expect(result).toEqual({ ok: false, reason: 'timeout' });
    });

    it('bounds every import with the ten-second design limit by default', async () => {
      expect(RECIPE_IMPORT_TIMEOUT_MS).toBe(10_000);
      expect(RECIPE_IMPORT_MAX_BYTES).toBe(2 * 1024 * 1024);

      const { fetcher, calls } = fakeFetch(oneOf(SIMPLE_RECIPE_PAGE));
      await importRecipePreview(OYAKODON, { fetcher });

      const signal = calls[0].init.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    });

    it('reports a connection that fails as an unavailable source', async () => {
      const result = await importRecipePreview(OYAKODON, {
        fetcher: () => Promise.reject(new Error('connection refused')),
      });
      expect(result).toEqual({ ok: false, reason: 'source_unavailable' });
    });
  });
});

describe('POST /api/recipes/import-preview', () => {
  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
  });

  const recipeRows = async (): Promise<number> => {
    const row = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS total FROM recipes',
    ).first<{ total: number }>();
    return row?.total ?? -1;
  };

  const previewRequest = (
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(PREVIEW_URL, {
      ...mutationInit('POST', body),
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        ...headers,
      },
    });

  const previewWith = (
    pages: Readonly<Record<string, () => Response | Promise<Response>>>,
    body: unknown = { url: OYAKODON },
    headers: Record<string, string> = {},
  ) => {
    const { fetcher, calls } = fakeFetch(pages);
    const worker = createWorker(undefined, fetcher);
    return {
      calls,
      response: worker.fetch(previewRequest(body, headers), testEnv),
    };
  };

  it('returns a draft and its provenance without writing a recipe', async () => {
    const { response } = previewWith(oneOf(SIMPLE_RECIPE_PAGE));
    const answered = await response;

    expect(answered.status).toBe(200);
    const body = await answered.json<RecipeImportPreviewResponse>();
    expect(body.draft.title).toBe('Oyakodon – Chicken & Egg Rice Bowl');
    expect(body.source.submittedUrl).toBe(OYAKODON);
    expect(body.source.host).toBe('www.justonecookbook.com');
    expect(body.notices).toEqual([]);
    expect(await recipeRows()).toBe(0);
  });

  it('forwards no incoming header, cookie, or Access assertion', async () => {
    const { calls, response } = previewWith(
      oneOf(SIMPLE_RECIPE_PAGE),
      {
        url: OYAKODON,
      },
      {
        cookie: 'session=super-secret',
        'cf-access-jwt-assertion': 'assertion-value',
        authorization: 'Bearer family-token',
        'x-forwarded-for': '203.0.113.9',
        referer: 'https://example.test/recipes/import',
        'accept-language': 'en-GB',
      },
    );
    await response;

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0])).toEqual({
      accept: 'text/html',
      'user-agent': 'FamilyMealPlanner/1.0 (+private household recipe import)',
    });
  });

  it.each([
    ['unsafe_destination', 400, { url: 'https://example.com/recipe' }],
    ['unsupported_source', 422, { url: OYAKODON }],
  ])(
    'answers %s with status %d and no recipe row',
    async (reason, status, body) => {
      const { response } = previewWith(oneOf(NO_RECIPE_PAGE), body);
      const answered = await response;

      expect(answered.status).toBe(status);
      const failure = await answered.json<{
        error: { code: string; message: string };
        reason: string;
      }>();
      expect(failure.reason).toBe(reason);
      expect(failure.error.code).toBe('import_failed');
      expect(failure.error.message.length).toBeGreaterThan(20);
      // No message repeats the link the member submitted.
      expect(failure.error.message).not.toContain('justonecookbook');
      expect(failure.error.message).not.toContain('example.com');
      expect(await recipeRows()).toBe(0);
    },
  );

  it.each([
    ['source_unavailable', 502, 503],
    ['unsupported_source', 422, 200],
  ])('maps %s to %d', async (reason, expected, status) => {
    const { response } = previewWith({
      [OYAKODON]: () =>
        new Response('nope', {
          status,
          headers: { 'content-type': 'text/plain' },
        }),
    });
    const answered = await response;

    expect(answered.status).toBe(expected);
    await expect(answered.json()).resolves.toMatchObject({ reason });
  });

  it('refuses a request that is not same-origin JSON', async () => {
    const { calls, response } = previewWith(
      oneOf(SIMPLE_RECIPE_PAGE),
      { url: OYAKODON },
      { origin: 'https://attacker.test' },
    );
    expect((await response).status).toBe(403);

    const crossType = createWorker(undefined, () => {
      throw new Error('no request may leave for a rejected import');
    });
    const typed = await crossType.fetch(
      new Request(PREVIEW_URL, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          origin: 'https://example.test',
        },
        body: JSON.stringify({ url: OYAKODON }),
      }),
      testEnv,
    );
    expect(typed.status).toBe(415);
    expect(calls).toEqual([]);
  });

  it.each([
    ['no url', {}],
    ['a url that is not text', { url: 42 }],
    ['an unexpected field', { url: OYAKODON, extra: 'x' }],
  ])('rejects a body with %s', async (_name, body) => {
    const { calls, response } = previewWith(oneOf(SIMPLE_RECIPE_PAGE), body);
    expect((await response).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each(['GET', 'PATCH', 'DELETE'])(
    'answers %s on the preview path with 404',
    async (method) => {
      const worker = createWorker(undefined, () => {
        throw new Error('no request may leave for an unrouted method');
      });
      const response = await worker.fetch(
        new Request(PREVIEW_URL, {
          method,
          headers: {
            'content-type': 'application/json',
            origin: 'https://example.test',
          },
          ...(method === 'GET' ? {} : { body: '{}' }),
        }),
        testEnv,
      );
      expect(response.status).toBe(404);
    },
  );

  it('denies a revoked member and an identity in no household', async () => {
    const neverFetches: ImportFetch = () => {
      throw new Error('a denied identity must not cause a request');
    };

    const stranger = createWorker(
      () =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      neverFetches,
    );
    const strangerResponse = await stranger.fetch(
      previewRequest({ url: OYAKODON }),
      testEnv,
    );
    expect(strangerResponse.status).toBe(403);
    await expect(strangerResponse.json()).resolves.toMatchObject({
      error: { code: 'not_a_member' },
    });

    await testEnv.DB.prepare(
      `UPDATE household_members SET status = 'revoked', revoked_at = ?
        WHERE access_subject = 'local-owner'`,
    )
      .bind(new Date().toISOString())
      .run();

    const revoked = createWorker(undefined, neverFetches);
    const revokedResponse = await revoked.fetch(
      previewRequest({ url: OYAKODON }),
      testEnv,
    );
    expect(revokedResponse.status).toBe(403);
    expect(await recipeRows()).toBe(0);
  });

  it('denies a request without a valid Access assertion', async () => {
    const deployed = createWorker(undefined, () => {
      throw new Error('an unauthenticated request must not cause a fetch');
    });
    const response = await deployed.fetch(previewRequest({ url: OYAKODON }), {
      ...testEnv,
      APP_ENV: 'development',
      CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
      CF_ACCESS_AUD: 'development-audience',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_identity' },
    });
  });

  it('refuses an unsupported destination through the deployed worker, which never fetches', async () => {
    // This one goes through SELF, which holds the real `fetch`. It is safe
    // only because the destination is refused before any request is made.
    const response = await fetchWorker(
      new Request(
        PREVIEW_URL,
        mutationInit('POST', { url: 'https://example.com/recipe' }),
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      reason: 'unsafe_destination',
    });
    expect(await recipeRows()).toBe(0);
  });

  it('writes no URL, page text, or family data to the console', async () => {
    const written: string[] = [];
    const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = levels.map(
      (level) => [level, console[level].bind(console)] as const,
    );
    for (const level of levels) {
      console[level] = (...args: unknown[]) => {
        written.push(args.map((arg) => String(arg)).join(' '));
      };
    }

    try {
      await previewWith(oneOf(SIMPLE_RECIPE_PAGE)).response;
      await previewWith(oneOf(NO_RECIPE_PAGE)).response;
      await previewWith({}, { url: 'https://example.com/recipe' }).response;
      await previewWith({
        [OYAKODON]: () => Promise.reject(new Error('connection refused')),
      }).response;
    } finally {
      for (const [level, original] of originals) {
        console[level] = original;
      }
    }

    const output = written.join('\n');
    expect(output).not.toContain('justonecookbook');
    expect(output).not.toContain('Oyakodon');
    expect(output).not.toContain('soy sauce');
    expect(output).not.toContain('owner@example.test');
  });
});
