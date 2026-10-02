import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECIPE_INGREDIENT_MAX_LENGTH,
  RECIPE_INGREDIENTS_MAX,
  RECIPE_LIMIT,
  RECIPE_LINK_IMPORTED_MESSAGE,
  RECIPE_NOTES_MAX_LENGTH,
  RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH,
  RECIPE_STEP_MAX_LENGTH,
  RECIPE_STEPS_MAX,
  RECIPE_TITLE_MAX_LENGTH,
  type Recipe,
  type RecipeConflictResponse,
  type RecipeDuplicateSourceResponse,
  type RecipeSummary,
  validateCreateRecipe,
} from '../../src/shared/recipes';
import {
  createRecipe as createRecipeRow,
  updateRecipe,
} from '../../src/worker/data/recipe-repository';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  seedOtherHousehold,
  seedRecipe,
  testEnv,
} from './helpers';
import { stubOutboundFetch } from './setup';

const RECIPES_URL = 'https://example.test/api/recipes';
const recipeUrl = (id: string) => `${RECIPES_URL}/${id}`;

const manual = {
  title: 'Weeknight Fried Rice',
  ingredients: ['2 cups cooked rice', '2 eggs', '1 tbsp soy sauce'],
  steps: ['Scramble the eggs.', 'Fry the rice.', 'Season and serve.'],
};

const create = (body: unknown): Promise<Response> =>
  fetchWorker(new Request(RECIPES_URL, mutationInit('POST', body)));

const createOk = async (body: unknown = manual): Promise<Recipe> => {
  const response = await create(body);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json<{ recipe: Recipe }>()).recipe;
};

const getOne = (id: string): Promise<Response> =>
  fetchWorker(new Request(recipeUrl(id)));

const getOk = async (id: string): Promise<Recipe> => {
  const response = await getOne(id);
  expect(response.status).toBe(200);
  return (await response.json<{ recipe: Recipe }>()).recipe;
};

const list = async (): Promise<RecipeSummary[]> => {
  const response = await fetchWorker(new Request(RECIPES_URL));
  expect(response.status).toBe(200);
  return (await response.json<{ recipes: RecipeSummary[] }>()).recipes;
};

const patch = (id: string, body: unknown): Promise<Response> =>
  fetchWorker(new Request(recipeUrl(id), mutationInit('PATCH', body)));

const remove = (id: string, body: unknown): Promise<Response> =>
  fetchWorker(new Request(recipeUrl(id), mutationInit('DELETE', body)));

const ownerHouseholdId = async (): Promise<string> => {
  const row = await testEnv.DB.prepare(
    `SELECT household_id FROM household_members WHERE access_subject = 'local-owner'`,
  ).first<{ household_id: string }>();
  return row?.household_id as string;
};

const lineCount = async (
  table: 'recipe_ingredients' | 'recipe_steps',
  recipeId?: string,
): Promise<number> => {
  const row = await (
    recipeId
      ? testEnv.DB.prepare(
          `SELECT COUNT(*) AS total FROM ${table} WHERE recipe_id = ?`,
        ).bind(recipeId)
      : testEnv.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`)
  ).first<{ total: number }>();
  return row?.total ?? -1;
};

const website = {
  kind: 'website',
  submittedUrl: 'https://www.justonecookbook.com/oyakodon/#recipe',
  pageTitle: '  Oyakodon (Chicken and Egg Rice Bowl)  ',
};

describe('recipe API', () => {
  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
  });

  describe('create, read, update, and delete', () => {
    it('starts empty, creates a manual recipe, and reads it back in order', async () => {
      expect(await list()).toEqual([]);

      const recipe = await createOk({ ...manual, notes: 'Use day-old rice.' });

      expect(recipe).toMatchObject({
        title: manual.title,
        notes: 'Use day-old rice.',
        ingredients: manual.ingredients,
        steps: manual.steps,
        source: { kind: 'manual' },
        version: 1,
      });
      expect(recipe.id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(recipe.createdAt).toBe(recipe.updatedAt);
      expect(Object.keys(recipe).sort()).toEqual([
        'createdAt',
        'id',
        'ingredients',
        'link',
        'notes',
        'servings',
        'source',
        'steps',
        'title',
        'updatedAt',
        'version',
      ]);

      expect(await getOk(recipe.id)).toEqual(recipe);
      expect(await list()).toEqual([
        {
          id: recipe.id,
          title: manual.title,
          source: { kind: 'manual', linkHost: null },
          version: 1,
          createdAt: recipe.createdAt,
          updatedAt: recipe.updatedAt,
        },
      ]);
    });

    it('preserves the entered order of many ingredients and steps', async () => {
      const ingredients = Array.from(
        { length: RECIPE_INGREDIENTS_MAX },
        (_unused, index) => `ingredient ${RECIPE_INGREDIENTS_MAX - index}`,
      );
      const steps = Array.from(
        { length: RECIPE_STEPS_MAX },
        (_unused, index) => `step ${RECIPE_STEPS_MAX - index}`,
      );

      const recipe = await createOk({ title: 'Long', ingredients, steps });
      const stored = await getOk(recipe.id);

      expect(stored.ingredients).toEqual(ingredients);
      expect(stored.steps).toEqual(steps);
    });

    it('accepts a recipe at every bound in a body larger than the default JSON limit', async () => {
      const recipe = await createOk({
        title: 'あ'.repeat(RECIPE_TITLE_MAX_LENGTH),
        notes: '😀'.repeat(RECIPE_NOTES_MAX_LENGTH),
        ingredients: Array.from({ length: RECIPE_INGREDIENTS_MAX }, () =>
          '大'.repeat(RECIPE_INGREDIENT_MAX_LENGTH),
        ),
        steps: Array.from({ length: RECIPE_STEPS_MAX }, () =>
          'x'.repeat(RECIPE_STEP_MAX_LENGTH),
        ),
      });

      const stored = await getOk(recipe.id);
      expect(stored.notes).toHaveLength(RECIPE_NOTES_MAX_LENGTH * 2);
      expect(stored.ingredients).toHaveLength(RECIPE_INGREDIENTS_MAX);
      expect(stored.steps.at(-1)).toHaveLength(RECIPE_STEP_MAX_LENGTH);
    });

    it('normalizes text and drops empty lines before saving', async () => {
      const recipe = await createOk({
        title: '  Cafe\u0301   au\tlait\u0000 ',
        notes: '  first line  \r\n\r\n\r\n\r\n  second\u0007 line ',
        ingredients: ['  1   cup  milk ', '', '   ', '1 shot coffee'],
        steps: ['\n', 'Warm   the milk.', 'Combine.'],
      });

      expect(recipe.title).toBe('Café au lait');
      expect(recipe.notes).toBe('first line\n\nsecond line');
      expect(recipe.ingredients).toEqual(['1 cup milk', '1 shot coffee']);
      expect(recipe.steps).toEqual(['Warm the milk.', 'Combine.']);
      expect(await getOk(recipe.id)).toEqual(recipe);
    });

    it('stores whitespace-only notes as no notes', async () => {
      const recipe = await createOk({ ...manual, notes: ' \n ' });
      expect(recipe.notes).toBeNull();
    });

    it('allows two recipes with the same title', async () => {
      await createOk();
      await createOk();
      expect(await list()).toHaveLength(2);
    });

    it('lists the most recently changed recipe first', async () => {
      const first = await createOk({ ...manual, title: 'First' });
      await createOk({ ...manual, title: 'Second' });
      await testEnv.DB.prepare(
        `UPDATE recipes SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id <> ?`,
      )
        .bind(first.id)
        .run();

      expect((await list()).map((recipe) => recipe.title)).toEqual([
        'First',
        'Second',
      ]);
    });

    it('updates fields and replaces whole ordered lists', async () => {
      const recipe = await createOk({ ...manual, notes: 'old' });

      const response = await patch(recipe.id, {
        version: recipe.version,
        title: 'Better Fried Rice',
        ingredients: ['3 cups rice', '1 tbsp oil'],
        steps: ['Heat the oil.'],
      });
      expect(response.status).toBe(200);
      const updated = (await response.json<{ recipe: Recipe }>()).recipe;

      expect(updated).toMatchObject({
        id: recipe.id,
        title: 'Better Fried Rice',
        notes: 'old',
        ingredients: ['3 cups rice', '1 tbsp oil'],
        steps: ['Heat the oil.'],
        version: 2,
        createdAt: recipe.createdAt,
      });
      expect(updated.updatedAt >= recipe.updatedAt).toBe(true);
      expect(await getOk(recipe.id)).toEqual(updated);
      expect(await lineCount('recipe_ingredients', recipe.id)).toBe(2);
      expect(await lineCount('recipe_steps', recipe.id)).toBe(1);
    });

    it('changes only the supplied fields, and clears notes with null', async () => {
      const recipe = await createOk({ ...manual, notes: 'keep me' });

      const titleOnly = await patch(recipe.id, {
        version: 1,
        title: 'Renamed',
      });
      expect(titleOnly.status).toBe(200);
      const renamed = (await titleOnly.json<{ recipe: Recipe }>()).recipe;
      expect(renamed).toMatchObject({
        title: 'Renamed',
        notes: 'keep me',
        ingredients: manual.ingredients,
        steps: manual.steps,
        version: 2,
      });

      const cleared = await patch(recipe.id, { version: 2, notes: null });
      expect(cleared.status).toBe(200);
      expect((await cleared.json<{ recipe: Recipe }>()).recipe).toMatchObject({
        title: 'Renamed',
        notes: null,
        version: 3,
      });

      const stepsOnly = await patch(recipe.id, {
        version: 3,
        steps: ['Just one step.'],
      });
      expect((await stepsOnly.json<{ recipe: Recipe }>()).recipe).toMatchObject(
        { ingredients: manual.ingredients, steps: ['Just one step.'] },
      );
    });

    it('deletes a recipe with its current version and cascades to its lines', async () => {
      const recipe = await createOk();
      const kept = await createOk({ ...manual, title: 'Kept' });

      const response = await remove(recipe.id, { version: recipe.version });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');

      expect((await getOne(recipe.id)).status).toBe(404);
      expect(await lineCount('recipe_ingredients', recipe.id)).toBe(0);
      expect(await lineCount('recipe_steps', recipe.id)).toBe(0);
      expect(await lineCount('recipe_ingredients', kept.id)).toBe(3);
      expect((await list()).map((summary) => summary.id)).toEqual([kept.id]);

      const again = await remove(recipe.id, { version: recipe.version });
      expect(again.status).toBe(404);
    });

    it('lets a regular member manage the shared library', async () => {
      await testEnv.DB.prepare(
        `UPDATE household_members SET role = 'member'
          WHERE access_subject = 'local-owner'`,
      ).run();

      const recipe = await createOk();
      expect((await patch(recipe.id, { version: 1, title: 'x' })).status).toBe(
        200,
      );
      expect((await remove(recipe.id, { version: 2 })).status).toBe(204);
    });
  });

  describe('manual recipe link', () => {
    const link = 'https://www.kikkoman.com.sg/product_recipes/soy-chicken/';

    const storedLink = async (id: string): Promise<string | null> =>
      (
        await testEnv.DB.prepare(`SELECT link_url FROM recipes WHERE id = ?`)
          .bind(id)
          .first<{ link_url: string | null }>()
      )?.link_url ?? null;

    it('saves a link from any https host, never fetching it, and shows its host in the list', async () => {
      const outbound: unknown[] = [];
      stubOutboundFetch((input) => {
        outbound.push(input);
        return Promise.reject(new Error('The link must not be fetched.'));
      });
      const recipe = await createOk({ ...manual, link: ` ${link}#steps ` });

      expect(recipe.link).toBe(link);
      expect(recipe.source).toEqual({ kind: 'manual' });
      expect(await getOk(recipe.id)).toEqual(recipe);
      expect(await storedLink(recipe.id)).toBe(link);
      expect((await list())[0].source).toEqual({
        kind: 'manual',
        linkHost: 'www.kikkoman.com.sg',
      });
      expect(outbound).toEqual([]);
    });

    it('stores no link when it is absent, null, or blank', async () => {
      for (const body of [
        manual,
        { ...manual, link: null },
        { ...manual, link: '  ' },
      ]) {
        const recipe = await createOk(body);
        expect(recipe.link).toBeNull();
        expect(await storedLink(recipe.id)).toBeNull();
      }
    });

    it('adds, keeps, and clears a link through version-checked edits', async () => {
      const recipe = await createOk(manual);

      const added = await patch(recipe.id, { version: 1, link });
      expect(added.status).toBe(200);
      expect((await added.json<{ recipe: Recipe }>()).recipe).toMatchObject({
        link,
        version: 2,
      });

      const kept = await patch(recipe.id, { version: 2, title: 'Mine' });
      expect((await kept.json<{ recipe: Recipe }>()).recipe.link).toBe(link);

      const stale = await patch(recipe.id, { version: 2, link: null });
      expect(stale.status).toBe(409);
      expect(await storedLink(recipe.id)).toBe(link);

      const cleared = await patch(recipe.id, { version: 3, link: null });
      expect((await cleared.json<{ recipe: Recipe }>()).recipe).toMatchObject({
        link: null,
        version: 4,
      });
      expect(await storedLink(recipe.id)).toBeNull();
    });

    it.each([
      ['an http link', 'http://www.kikkoman.com.sg/a/'],
      ['credentials', 'https://u:p@example.com/a'],
      ['a port', 'https://example.com:8443/a'],
      ['a malformed link', 'kikkoman.com.sg/a'],
      ['a non-string link', 42],
      ['an overlong link', `https://example.com/${'a'.repeat(2048)}`],
    ])('rejects %s and saves nothing', async (_label, value) => {
      const response = await create({ ...manual, link: value });
      expect(response.status).toBe(400);
      expect(await list()).toEqual([]);

      const recipe = await createOk(manual);
      const edit = await patch(recipe.id, { version: 1, link: value });
      expect(edit.status).toBe(400);
      expect((await getOk(recipe.id)).version).toBe(1);
    });

    it('refuses a link for an imported recipe and changes nothing', async () => {
      const refused = await create({ ...manual, source: website, link });
      expect(refused.status).toBe(400);
      await expect(refused.json()).resolves.toMatchObject({
        error: {
          code: 'invalid_request',
          message: RECIPE_LINK_IMPORTED_MESSAGE,
        },
      });
      expect(await list()).toEqual([]);

      const imported = await createOk({ ...manual, source: website });
      expect(imported.link).toBeNull();
      const edit = await patch(imported.id, { version: 1, title: 'X', link });
      expect(edit.status).toBe(400);
      await expect(edit.json()).resolves.toMatchObject({
        error: { message: RECIPE_LINK_IMPORTED_MESSAGE },
      });
      expect(await getOk(imported.id)).toEqual(imported);

      // Clearing a link that is not there is a harmless no-op.
      const cleared = await patch(imported.id, { version: 1, link: null });
      expect(cleared.status).toBe(200);
    });

    it('reports a link edit of another household’s recipe as not found', async () => {
      const { householdId } = await seedOtherHousehold();
      const otherId = await seedRecipe(householdId, 'Theirs');
      const response = await patch(otherId, { version: 1, link });
      expect(response.status).toBe(404);
      expect(await storedLink(otherId)).toBeNull();
    });
  });

  describe('website source metadata', () => {
    it('saves an imported copy with its original link and provenance', async () => {
      const recipe = await createOk({
        ...manual,
        source: {
          ...website,
          resolvedUrl: 'https://justonecookbook.com/oyakodon/',
        },
      });

      expect(recipe.source).toEqual({
        kind: 'website',
        submittedUrl: 'https://www.justonecookbook.com/oyakodon/',
        resolvedUrl: 'https://justonecookbook.com/oyakodon/',
        host: 'justonecookbook.com',
        pageTitle: 'Oyakodon (Chicken and Egg Rice Bowl)',
        importedAt: recipe.createdAt,
      });
      expect(await getOk(recipe.id)).toEqual(recipe);
      expect((await list())[0].source).toEqual({
        kind: 'website',
        host: 'justonecookbook.com',
      });
    });

    it('stores no resolved URL when it equals the submitted URL', async () => {
      const recipe = await createOk({
        ...manual,
        source: {
          kind: 'website',
          submittedUrl: 'https://budgetbytes.com/a/',
          resolvedUrl: 'https://budgetbytes.com/a/#top',
          pageTitle: null,
        },
      });
      expect(recipe.source).toMatchObject({
        submittedUrl: 'https://budgetbytes.com/a/',
        resolvedUrl: null,
        host: 'budgetbytes.com',
        pageTitle: null,
      });
    });

    it('keeps the source unchanged by an edit', async () => {
      const recipe = await createOk({ ...manual, source: website });
      const response = await patch(recipe.id, { version: 1, title: 'Mine' });
      const updated = (await response.json<{ recipe: Recipe }>()).recipe;
      expect(updated.source).toEqual(recipe.source);

      const rejected = await patch(recipe.id, {
        version: 2,
        source: { kind: 'manual' },
      });
      expect(rejected.status).toBe(400);
    });

    it.each([
      [
        'http URL',
        { kind: 'website', submittedUrl: 'http://budgetbytes.com/a' },
      ],
      [
        'unlisted host',
        { kind: 'website', submittedUrl: 'https://example.com/a' },
      ],
      [
        'suffix match',
        { kind: 'website', submittedUrl: 'https://evil.budgetbytes.com/a' },
      ],
      [
        'credentials',
        { kind: 'website', submittedUrl: 'https://u:p@budgetbytes.com/a' },
      ],
      [
        'non-default port',
        { kind: 'website', submittedUrl: 'https://budgetbytes.com:8443/a' },
      ],
      ['malformed URL', { kind: 'website', submittedUrl: 'not a url' }],
      ['missing URL', { kind: 'website' }],
      ['non-string URL', { kind: 'website', submittedUrl: 42 }],
      [
        'overlong URL',
        {
          kind: 'website',
          submittedUrl: `https://budgetbytes.com/${'a'.repeat(2048)}`,
        },
      ],
      [
        'unsafe resolved URL',
        {
          kind: 'website',
          submittedUrl: 'https://budgetbytes.com/a',
          resolvedUrl: 'https://example.com/a',
        },
      ],
      [
        'overlong page title',
        {
          kind: 'website',
          submittedUrl: 'https://budgetbytes.com/a',
          pageTitle: 't'.repeat(RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH + 1),
        },
      ],
      [
        'client-supplied host',
        {
          kind: 'website',
          submittedUrl: 'https://budgetbytes.com/a',
          host: 'budgetbytes.com',
        },
      ],
      [
        'client-supplied import time',
        {
          kind: 'website',
          submittedUrl: 'https://budgetbytes.com/a',
          importedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
      ['manual with a URL', { kind: 'manual', submittedUrl: 'https://x.test' }],
      ['unknown kind', { kind: 'photo' }],
      ['non-object source', 'website'],
    ])('rejects %s and creates nothing', async (_label, source) => {
      const response = await create({ ...manual, source });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      });
      expect(await list()).toEqual([]);
    });
  });

  describe('only if the source is new (#116)', () => {
    const A = 'https://www.budgetbytes.com/soup/';
    const A_ELSEWHERE = 'https://budgetbytes.com/soup/';
    const B = 'https://www.budgetbytes.com/stew/';

    const importBody = (submittedUrl: string, resolvedUrl?: string) => ({
      ...manual,
      title: 'Imported soup',
      source: { kind: 'website', submittedUrl, resolvedUrl },
      onlyIfNewSource: true,
    });

    const expectDuplicate = async (
      response: Response,
      existing: Recipe,
    ): Promise<void> => {
      expect(response.status).toBe(409);
      expect(await response.json<RecipeDuplicateSourceResponse>()).toEqual({
        error: {
          code: 'duplicate_source',
          message: 'A recipe from this link is already in the library.',
        },
        existing: { id: existing.id, title: existing.title },
      });
    };

    it.each([
      ['the same submitted address', [A], [`${A}#comments`]],
      ['its resolved address as the new submitted one', [B, A], [A]],
      ['its submitted address as the new resolved one', [A], [B, A]],
      ['the same resolved address', [B, A], [A_ELSEWHERE, A]],
    ])(
      'refuses a recipe with %s and saves nothing',
      async (
        _case,
        [savedSubmitted, savedResolved],
        [newSubmitted, newResolved],
      ) => {
        const existing = await createOk({
          ...manual,
          source: {
            kind: 'website',
            submittedUrl: savedSubmitted,
            resolvedUrl: savedResolved,
          },
        });
        const ingredientLines = await lineCount('recipe_ingredients');

        await expectDuplicate(
          await create(importBody(newSubmitted, newResolved)),
          existing,
        );
        expect(await list()).toHaveLength(1);
        expect(await lineCount('recipe_ingredients')).toBe(ingredientLines);
      },
    );

    it('saves when no website recipe has either address', async () => {
      await createOk({
        ...manual,
        source: { kind: 'website', submittedUrl: B },
      });
      // A manual recipe never counts, whatever its link.
      await createOk({ ...manual, link: A });

      const saved = await createOk(importBody(A, A_ELSEWHERE));
      expect(saved.source).toMatchObject({
        kind: 'website',
        submittedUrl: A,
        resolvedUrl: A_ELSEWHERE,
      });
      expect(await getOk(saved.id)).toEqual(saved);
      expect(Object.keys(saved)).not.toContain('onlyIfNewSource');
    });

    it('ignores another household’s recipes', async () => {
      const other = await seedOtherHousehold();
      const now = new Date().toISOString();
      await testEnv.DB.prepare(
        `INSERT INTO recipes (
           id, household_id, title, notes, version, write_token, source_kind,
           source_submitted_url, source_host, source_imported_at, created_at,
           updated_at
         ) VALUES (?, ?, 'Theirs', NULL, 1, 'seed', 'website', ?,
                   'www.budgetbytes.com', ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), other.householdId, A, now, now, now)
        .run();

      const saved = await createOk(importBody(A));
      expect(saved.title).toBe('Imported soup');
    });

    it('saves two concurrent imports of the same link once', async () => {
      const responses = await Promise.all([
        create(importBody(A)),
        create(importBody(`${A}#wprm-recipe`)),
      ]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);

      const recipes = await list();
      expect(recipes).toHaveLength(1);
      const loser = responses.find((response) => response.status === 409);
      expect(
        (await loser!.json<RecipeDuplicateSourceResponse>()).existing,
      ).toEqual({ id: recipes[0].id, title: 'Imported soup' });
      expect(await lineCount('recipe_ingredients')).toBe(
        manual.ingredients.length,
      );
    });

    it('still saves a second copy when the request does not ask', async () => {
      await createOk(importBody(A));
      await createOk({ ...importBody(A), onlyIfNewSource: undefined });
      expect(await list()).toHaveLength(2);
    });

    it('refuses the flag for a manual recipe', async () => {
      const response = await create({ ...manual, onlyIfNewSource: true });
      expect(response.status).toBe(400);
      expect(
        (await response.json<{ error: { code: string } }>()).error.code,
      ).toBe('invalid_request');
      expect(await list()).toEqual([]);
    });

    it('asks for a retry when the matching recipe is deleted before the refusal is explained', async () => {
      const existing = await createOk(importBody(A));
      const householdId = await ownerHouseholdId();
      // The guarded insert sees the match; the match is gone by the follow-up
      // read, so neither a duplicate nor the limit explains the refusal.
      const db = {
        prepare: (query: string) => testEnv.DB.prepare(query),
        batch: async (statements: D1PreparedStatement[]) => {
          const results = await testEnv.DB.batch(statements);
          await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
            .bind(existing.id)
            .run();
          return results;
        },
      } as unknown as D1Database;
      const valid = validateCreateRecipe(importBody(A));
      if (!valid.ok) throw new Error('fixture must be valid');

      await expect(
        createRecipeRow(db, householdId, valid.value),
      ).rejects.toMatchObject({ status: 409, code: 'state_conflict' });
      expect(await list()).toEqual([]);
    });

    it('reports the library limit when the address is new', async () => {
      const householdId = await ownerHouseholdId();
      const now = new Date().toISOString();
      await testEnv.DB.batch(
        Array.from({ length: RECIPE_LIMIT }, (_unused, index) =>
          testEnv.DB.prepare(
            `INSERT INTO recipes (
               id, household_id, title, notes, version, write_token,
               source_kind, created_at, updated_at
             ) VALUES (?, ?, ?, NULL, 1, 'seed', 'manual', ?, ?)`,
          ).bind(crypto.randomUUID(), householdId, `recipe ${index}`, now, now),
        ),
      );

      const response = await create(importBody(A));
      expect(response.status).toBe(400);
      expect(
        (await response.json<{ error: { code: string } }>()).error.code,
      ).toBe('limit_reached');
    });
  });

  describe('validation', () => {
    it.each([
      ['missing title', { ingredients: ['a'], steps: ['b'] }],
      ['blank title', { ...manual, title: '   ' }],
      [
        'overlong title',
        { ...manual, title: 'a'.repeat(RECIPE_TITLE_MAX_LENGTH + 1) },
      ],
      ['non-string title', { ...manual, title: 7 }],
      ['missing ingredients', { title: 'a', steps: ['b'] }],
      ['empty ingredients', { ...manual, ingredients: [] }],
      ['only blank ingredients', { ...manual, ingredients: ['', '  '] }],
      [
        'too many ingredients',
        {
          ...manual,
          ingredients: Array.from(
            { length: RECIPE_INGREDIENTS_MAX + 1 },
            () => 'x',
          ),
        },
      ],
      [
        'overlong ingredient',
        {
          ...manual,
          ingredients: ['x'.repeat(RECIPE_INGREDIENT_MAX_LENGTH + 1)],
        },
      ],
      ['non-string ingredient', { ...manual, ingredients: ['a', 2] }],
      ['ingredients as text', { ...manual, ingredients: 'rice' }],
      ['missing steps', { title: 'a', ingredients: ['b'] }],
      ['empty steps', { ...manual, steps: [] }],
      [
        'too many steps',
        {
          ...manual,
          steps: Array.from({ length: RECIPE_STEPS_MAX + 1 }, () => 'x'),
        },
      ],
      [
        'overlong step',
        { ...manual, steps: ['x'.repeat(RECIPE_STEP_MAX_LENGTH + 1)] },
      ],
      [
        'overlong notes',
        { ...manual, notes: 'n'.repeat(RECIPE_NOTES_MAX_LENGTH + 1) },
      ],
      ['non-string notes', { ...manual, notes: ['n'] }],
      ['client-supplied id', { ...manual, id: crypto.randomUUID() }],
      ['client-supplied household', { ...manual, householdId: 'h' }],
      ['client-supplied household_id', { ...manual, household_id: 'h' }],
      ['client-supplied version', { ...manual, version: 9 }],
      ['client-supplied timestamps', { ...manual, createdAt: 'x' }],
      ['unknown field', { ...manual, rating: 4 }],
    ])('rejects %s on create', async (_label, body) => {
      const response = await create(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      });
      expect(await list()).toEqual([]);
    });

    it('rejects a body that is not a JSON object or exceeds the recipe limit', async () => {
      for (const body of ['[]', 'null', '"x"', '{']) {
        const response = await fetchWorker(
          new Request(RECIPES_URL, {
            ...mutationInit('POST'),
            body,
          }),
        );
        expect(response.status, body).toBe(400);
      }

      const huge = await create({
        ...manual,
        notes: 'n'.repeat(1024 * 1024),
      });
      expect(huge.status).toBe(413);
    });

    it('rejects invalid updates and deletes without changing the recipe', async () => {
      const recipe = await createOk();
      const badPatches: unknown[] = [
        { version: 1 },
        { title: 'no version' },
        { version: 0, title: 'x' },
        { version: 1.5, title: 'x' },
        { version: '1', title: 'x' },
        { version: 1, title: '' },
        { version: 1, ingredients: [] },
        { version: 1, steps: ['x'.repeat(RECIPE_STEP_MAX_LENGTH + 1)] },
        { version: 1, notes: 5 },
        { version: 1, title: 'x', id: crypto.randomUUID() },
        { version: 1, title: 'x', updatedAt: 'now' },
      ];
      for (const body of badPatches) {
        const response = await patch(recipe.id, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
      const arrayBody = await fetchWorker(
        new Request(recipeUrl(recipe.id), {
          ...mutationInit('PATCH'),
          body: '[1]',
        }),
      );
      expect(arrayBody.status).toBe(400);

      for (const body of [{}, { version: 0 }, { version: 1, title: 'x' }]) {
        const response = await remove(recipe.id, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }

      expect(await getOk(recipe.id)).toEqual(recipe);
    });

    it('requires same-origin JSON for every recipe mutation', async () => {
      const recipe = await createOk();

      const noOrigin = await fetchWorker(
        new Request(RECIPES_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(manual),
        }),
      );
      expect(noOrigin.status).toBe(403);

      const crossOrigin = await fetchWorker(
        new Request(recipeUrl(recipe.id), {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.test',
          },
          body: JSON.stringify({ version: 1, title: 'x' }),
        }),
      );
      expect(crossOrigin.status).toBe(403);

      const wrongType = await fetchWorker(
        new Request(recipeUrl(recipe.id), {
          method: 'DELETE',
          headers: {
            'content-type': 'text/plain',
            origin: 'https://example.test',
          },
          body: 'version=1',
        }),
      );
      expect(wrongType.status).toBe(415);

      expect(await getOk(recipe.id)).toEqual(recipe);
    });

    it('answers unknown methods, malformed IDs, and unknown recipe paths with 404', async () => {
      const recipe = await createOk();
      const cases: Request[] = [
        new Request(RECIPES_URL, mutationInit('PATCH', {})),
        new Request(recipeUrl(recipe.id), mutationInit('POST', {})),
        new Request(`${RECIPES_URL}/not-a-uuid`),
        // The import preview answers POST only, and nothing hangs off it.
        // Neither case reaches the adapter, so neither can leave the runtime;
        // `test/worker/recipe-import.test.ts` covers the route with a fake
        // fetch instead.
        new Request(`${RECIPES_URL}/import-preview`),
        new Request(
          `${RECIPES_URL}/import-preview/extra`,
          mutationInit('POST', { url: 'https://budgetbytes.com/a' }),
        ),
      ];
      for (const request of cases) {
        const response = await fetchWorker(request);
        expect(response.status, `${request.method} ${request.url}`).toBe(404);
      }
    });
  });

  describe('conflicts', () => {
    it('rejects a stale update with the current recipe for comparison', async () => {
      const recipe = await createOk();
      const first = await patch(recipe.id, {
        version: 1,
        title: 'Winner',
        ingredients: ['winner rice'],
      });
      expect(first.status).toBe(200);
      const winner = (await first.json<{ recipe: Recipe }>()).recipe;

      const stale = await patch(recipe.id, {
        version: 1,
        title: 'Loser',
        ingredients: ['loser rice'],
        steps: ['loser step'],
      });
      expect(stale.status).toBe(409);
      const body = await stale.json<RecipeConflictResponse>();
      expect(body.error.code).toBe('stale_version');
      expect(body.current).toEqual(winner);

      expect(await getOk(recipe.id)).toEqual(winner);
    });

    it('rejects a stale delete with the current recipe and keeps it', async () => {
      const recipe = await createOk();
      const updated = (
        await (
          await patch(recipe.id, { version: 1, notes: 'changed' })
        ).json<{ recipe: Recipe }>()
      ).recipe;

      const stale = await remove(recipe.id, { version: 1 });
      expect(stale.status).toBe(409);
      const body = await stale.json<RecipeConflictResponse>();
      expect(body.error.code).toBe('stale_version');
      expect(body.current).toEqual(updated);
      expect(await getOk(recipe.id)).toEqual(updated);
    });

    // The trap: a D1 batch keeps running after its guarded UPDATE matched no
    // row. The winner moved the recipe to version 2, so child statements
    // guarded only by "version = base + 1" would still match for the loser
    // and replace the winner's lines. The per-write token prevents that.
    it('never lets a losing update from the same version rewrite the winning lines', async () => {
      const recipe = await createOk();
      const householdId = await ownerHouseholdId();

      const winner = await updateRecipe(testEnv.DB, householdId, recipe.id, {
        version: 1,
        ingredients: ['winner ingredient'],
        steps: ['winner step'],
      });
      await expect(
        updateRecipe(testEnv.DB, householdId, recipe.id, {
          version: 1,
          title: 'Loser',
          notes: 'loser',
          ingredients: ['loser ingredient 1', 'loser ingredient 2'],
          steps: ['loser step'],
        }),
      ).rejects.toMatchObject({ status: 409, code: 'stale_version' });

      expect(winner.version).toBe(2);
      expect(await getOk(recipe.id)).toEqual(winner);
      expect(await lineCount('recipe_ingredients', recipe.id)).toBe(1);
      expect(await lineCount('recipe_steps', recipe.id)).toBe(1);
    });

    it('lets exactly one of two concurrent updates win, with its lines intact', async () => {
      for (let round = 0; round < 5; round += 1) {
        const recipe = await createOk();
        const edits = ['A', 'B'].map((name) => ({
          version: 1,
          title: `Edit ${name}`,
          notes: `notes ${name}`,
          ingredients: [`${name} one`, `${name} two`, `${name} three`],
          steps: [`${name} step`],
        }));

        const responses = await Promise.all(
          edits.map((edit) => patch(recipe.id, edit)),
        );
        expect(responses.map((response) => response.status).sort()).toEqual([
          200, 409,
        ]);

        const winningIndex = responses.findIndex(
          (response) => response.status === 200,
        );
        const winner = (
          await responses[winningIndex].json<{ recipe: Recipe }>()
        ).recipe;
        const loser =
          await responses[1 - winningIndex].json<RecipeConflictResponse>();
        const expected = edits[winningIndex];

        const stored = await getOk(recipe.id);
        expect(stored).toEqual(winner);
        expect(loser.current).toEqual(winner);
        expect(stored).toMatchObject({
          title: expected.title,
          notes: expected.notes,
          ingredients: expected.ingredients,
          steps: expected.steps,
          version: 2,
        });
      }
    });

    it('lets only one of an update and a delete from the same version win', async () => {
      const recipe = await createOk();
      const [updated, removed] = await Promise.all([
        patch(recipe.id, { version: 1, ingredients: ['late'] }),
        remove(recipe.id, { version: 1 }),
      ]);
      const statuses = [updated.status, removed.status];

      if (removed.status === 204) {
        // Either the delete won outright, or it ran first and the update then
        // found nothing; lines must not outlive their recipe either way.
        expect([404, 409]).toContain(updated.status);
        expect(await lineCount('recipe_ingredients', recipe.id)).toBe(0);
      } else {
        expect(statuses).toEqual([200, 409]);
        expect((await getOk(recipe.id)).ingredients).toEqual(['late']);
      }
    });
  });

  describe('authorization and household isolation', () => {
    it('never lets one household read or change a recipe from another household', async () => {
      const other = await seedOtherHousehold();
      const foreign = await seedRecipe(other.householdId, 'Secret Family Stew');

      expect(await list()).toEqual([]);

      const responses = [
        await getOne(foreign),
        await patch(foreign, { version: 1, title: 'Mine now' }),
        await remove(foreign, { version: 1 }),
      ];
      for (const response of responses) {
        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain('not_found');
        expect(text).not.toContain('Secret');
      }

      const row = await testEnv.DB.prepare(
        'SELECT title, version FROM recipes WHERE id = ?',
      )
        .bind(foreign)
        .first<{ title: string; version: number }>();
      expect(row).toEqual({ title: 'Secret Family Stew', version: 1 });
      expect(await lineCount('recipe_ingredients', foreign)).toBe(1);
    });

    it('reports a missing recipe as not found for every item method', async () => {
      const missing = crypto.randomUUID();
      expect((await getOne(missing)).status).toBe(404);
      expect((await patch(missing, { version: 1, title: 'x' })).status).toBe(
        404,
      );
      expect((await remove(missing, { version: 1 })).status).toBe(404);
    });

    it('denies a revoked member every recipe route', async () => {
      const recipe = await createOk();
      await testEnv.DB.prepare(
        `UPDATE household_members
            SET status = 'revoked', revoked_at = ?
          WHERE access_subject = 'local-owner'`,
      )
        .bind(new Date().toISOString())
        .run();

      const responses = [
        await fetchWorker(new Request(RECIPES_URL)),
        await getOne(recipe.id),
        await create(manual),
        await patch(recipe.id, { version: 1, title: 'x' }),
        await remove(recipe.id, { version: 1 }),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        const text = await response.text();
        expect(text).toContain('not_a_member');
        expect(text).not.toContain(manual.title);
      }
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS total, MAX(version) AS version FROM recipes',
      ).first<{ total: number; version: number }>();
      expect(count).toEqual({ total: 1, version: 1 });
    });

    it('denies an identity that belongs to no household', async () => {
      const recipe = await createOk();
      const stranger = createWorker(() =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      );

      const requests = [
        new Request(RECIPES_URL),
        new Request(recipeUrl(recipe.id)),
        new Request(RECIPES_URL, mutationInit('POST', manual)),
        new Request(
          recipeUrl(recipe.id),
          mutationInit('PATCH', { version: 1, title: 'x' }),
        ),
        new Request(
          recipeUrl(recipe.id),
          mutationInit('DELETE', { version: 1 }),
        ),
      ];
      for (const request of requests) {
        const response = await stranger.fetch(request, testEnv);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(manual.title);
      }
      expect(await list()).toHaveLength(1);
    });

    it('denies a request without a valid Access assertion', async () => {
      const recipe = await createOk();
      const deployed = createWorker();
      const deployedEnv = {
        ...testEnv,
        APP_ENV: 'development',
        CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
        CF_ACCESS_AUD: 'development-audience',
      } as const;

      for (const request of [
        new Request(RECIPES_URL),
        new Request(recipeUrl(recipe.id)),
        new Request(RECIPES_URL, mutationInit('POST', manual)),
        new Request(
          recipeUrl(recipe.id),
          mutationInit('PATCH', { version: 1, title: 'x' }),
        ),
        new Request(
          recipeUrl(recipe.id),
          mutationInit('DELETE', { version: 1 }),
        ),
      ]) {
        const response = await deployed.fetch(request, deployedEnv);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: 'invalid_identity' },
        });
      }
      expect(await getOk(recipe.id)).toEqual(recipe);
    });
  });

  describe('limits and privacy', () => {
    it('caps the library per household and keeps the message free of recipe text', async () => {
      const householdId = await ownerHouseholdId();
      const now = new Date().toISOString();
      await testEnv.DB.batch(
        Array.from({ length: RECIPE_LIMIT }, (_unused, index) =>
          testEnv.DB.prepare(
            `INSERT INTO recipes (
               id, household_id, title, notes, version, write_token,
               source_kind, created_at, updated_at
             ) VALUES (?, ?, ?, NULL, 1, 'seed', 'manual', ?, ?)`,
          ).bind(crypto.randomUUID(), householdId, `recipe ${index}`, now, now),
        ),
      );

      const response = await create({ ...manual, title: 'One too many' });
      expect(response.status).toBe(400);
      const body = await response.json<{
        error: { code: string; message: string };
      }>();
      expect(body.error.code).toBe('limit_reached');
      expect(body.error.message).not.toContain('One too many');
      expect(await lineCount('recipe_ingredients')).toBe(0);

      // Another household is unaffected by this household's cap.
      const other = await seedOtherHousehold();
      await expect(
        seedRecipe(other.householdId, 'Other'),
      ).resolves.toBeDefined();
    });

    it('writes no recipe text or source URL to the console', async () => {
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
        const recipe = await createOk({
          title: 'Saffron Risotto',
          ingredients: ['saffron threads'],
          steps: ['stir the saffron'],
          source: website,
        });
        await patch(recipe.id, { version: 1, notes: 'saffron notes' });
        await patch(recipe.id, { version: 1, notes: 'saffron stale' });
        await remove(recipe.id, { version: 1 });
        await getOk(recipe.id);
        await list();
        await remove(recipe.id, { version: 2 });
      } finally {
        for (const [level, original] of originals) {
          console[level] = original;
        }
      }

      const output = written.join('\n');
      expect(output).not.toContain('affron');
      expect(output).not.toContain('justonecookbook');
    });
  });

  describe('household deletion', () => {
    it('cascades to recipes and lines when the operator batch removes the household', async () => {
      const householdId = await ownerHouseholdId();
      const other = await seedOtherHousehold();
      await createOk();
      await createOk({ ...manual, source: website });
      const foreign = await seedRecipe(other.householdId, 'Other Family Soup');

      // The #32 operator batch: clear the installation pointer, then delete
      // the household, in one transaction.
      await testEnv.DB.batch([
        testEnv.DB.prepare(
          'DELETE FROM app_installation WHERE household_id = ?',
        ).bind(householdId),
        testEnv.DB.prepare('DELETE FROM households WHERE id = ?').bind(
          householdId,
        ),
      ]);

      const remaining = await testEnv.DB.prepare('SELECT id FROM recipes').all<{
        id: string;
      }>();
      expect(remaining.results.map((row) => row.id)).toEqual([foreign]);
      expect(await lineCount('recipe_ingredients')).toBe(1);
      expect(await lineCount('recipe_steps')).toBe(1);
    });
  });
});
