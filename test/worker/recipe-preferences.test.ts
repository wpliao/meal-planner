import { beforeEach, describe, expect, it } from 'vitest';

import type { MealSuggestionsResponse } from '../../src/shared/meal-suggestions';
import type {
  RecipeDetailResponse,
  RecipePreferencesResponse,
} from '../../src/shared/recipe-preferences';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  mutationInit,
  seedOtherHousehold,
  seedRecipe,
  seedRecipePreference,
  testEnv,
} from './helpers';

const RECIPES_URL = 'https://example.test/api/recipes';
const preferencesUrl = (id: string) => `${RECIPES_URL}/${id}/preferences`;

/** The Worker's clock, which tests move forward. */
const START = Date.parse('2026-09-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
let now = START;
const worker = createWorker(undefined, undefined, () => new Date(now));
const call = (request: Request, env: typeof testEnv = testEnv) =>
  worker.fetch(request, env);

const put = (id: string, body: unknown, env?: typeof testEnv) =>
  call(new Request(preferencesUrl(id), mutationInit('PUT', body)), env);

const putOk = async (id: string, body: unknown) => {
  const response = await put(id, body);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json<RecipePreferencesResponse>()).preferences;
};

const readRecipe = async (id: string) => {
  const response = await call(new Request(`${RECIPES_URL}/${id}`));
  expect(response.status).toBe(200);
  return response.json<RecipeDetailResponse>();
};

const suggestions = async () => {
  const response = await call(
    new Request(
      'https://example.test/api/meal-plan/suggestions?date=2026-09-24',
    ),
  );
  expect(response.status).toBe(200);
  return (await response.json<MealSuggestionsResponse>()).suggestions;
};

const rows = () =>
  testEnv.DB.prepare(
    `SELECT recipe_id, household_id, favourite, not_now_until
       FROM recipe_preferences ORDER BY recipe_id`,
  ).all<Record<string, unknown>>();

const ownerHouseholdId = async (): Promise<string> => {
  const row = await testEnv.DB.prepare(
    `SELECT household_id FROM household_members WHERE access_subject = 'local-owner'`,
  ).first<{ household_id: string }>();
  return row?.household_id as string;
};

const recordingEnv = (): { env: typeof testEnv; statements: string[] } => {
  const statements: string[] = [];
  const db = new Proxy(testEnv.DB, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          statements.push(sql);
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { env: { ...testEnv, DB: db }, statements };
};

describe('recipe preferences API', () => {
  let household: string;
  let recipe: string;

  beforeEach(async () => {
    now = START;
    await applyMigrations();
    await bootstrapOwner();
    household = await ownerHouseholdId();
    recipe = await seedRecipe(household, 'Curry');
  });

  describe('favourite', () => {
    it('sets and clears the favourite, shared through the recipe read', async () => {
      expect((await readRecipe(recipe)).preferences).toEqual({
        favourite: false,
        notNowUntil: null,
      });
      expect(await putOk(recipe, { favourite: true })).toEqual({
        favourite: true,
        notNowUntil: null,
      });
      expect((await readRecipe(recipe)).preferences.favourite).toBe(true);
      // Repeating a request gives the same state.
      expect(await putOk(recipe, { favourite: true })).toEqual({
        favourite: true,
        notNowUntil: null,
      });
      expect((await rows()).results).toHaveLength(1);

      expect(await putOk(recipe, { favourite: false })).toEqual({
        favourite: false,
        notNowUntil: null,
      });
      // A row that holds neither preference is deleted.
      expect((await rows()).results).toEqual([]);
      expect(await putOk(recipe, { favourite: false })).toEqual({
        favourite: false,
        notNowUntil: null,
      });
    });

    it('never changes the recipe, its version, or its update time', async () => {
      const before = (await readRecipe(recipe)).recipe;
      await putOk(recipe, { favourite: true });
      await putOk(recipe, { notNow: true });
      expect((await readRecipe(recipe)).recipe).toEqual(before);
    });
  });

  describe('Not now', () => {
    it('ends exactly seven days after the Worker clock, and restarts', async () => {
      expect(await putOk(recipe, { notNow: true })).toEqual({
        favourite: false,
        notNowUntil: '2026-10-01T12:00:00.000Z',
      });
      now = START + 2 * DAY;
      expect(await putOk(recipe, { notNow: true })).toEqual({
        favourite: false,
        notNowUntil: '2026-10-03T12:00:00.000Z',
      });
      expect(await putOk(recipe, { notNow: false })).toEqual({
        favourite: false,
        notNowUntil: null,
      });
      expect((await rows()).results).toEqual([]);
    });

    it('leaves the recipe out of suggestions until it ends, then brings it back', async () => {
      const other = await seedRecipe(household, 'Soup');
      await putOk(recipe, { notNow: true });
      expect((await suggestions()).map(({ recipeId }) => recipeId)).toEqual([
        other,
      ]);

      now = START + 7 * DAY - 1;
      expect((await suggestions()).map(({ recipeId }) => recipeId)).toEqual([
        other,
      ]);
      // At the end instant it no longer applies.
      now = START + 7 * DAY;
      expect(
        (await suggestions()).map(({ recipeId }) => recipeId).sort(),
      ).toEqual([recipe, other].sort());
      expect((await readRecipe(recipe)).preferences.notNowUntil).toBeNull();
    });

    it('keeps the favourite when Not now is cleared, and Not now when the favourite is', async () => {
      await putOk(recipe, { favourite: true });
      await putOk(recipe, { notNow: true });
      expect(await putOk(recipe, { notNow: false })).toEqual({
        favourite: true,
        notNowUntil: null,
      });
      await putOk(recipe, { notNow: true });
      expect(await putOk(recipe, { favourite: false })).toEqual({
        favourite: false,
        notNowUntil: '2026-10-01T12:00:00.000Z',
      });
      expect((await rows()).results).toHaveLength(1);
    });

    it('prunes expired Not now on the next write in the household', async () => {
      const soup = await seedRecipe(household, 'Soup');
      const stew = await seedRecipe(household, 'Stew');
      await seedRecipePreference(household, soup, {
        favourite: false,
        notNowUntil: '2026-09-20T00:00:00.000Z',
      });
      await seedRecipePreference(household, stew, {
        favourite: true,
        notNowUntil: '2026-09-20T00:00:00.000Z',
      });
      const other = await seedOtherHousehold();
      const theirs = await seedRecipe(other.householdId, 'Theirs');
      await seedRecipePreference(other.householdId, theirs, {
        favourite: false,
        notNowUntil: '2026-09-20T00:00:00.000Z',
      });

      // Expired state is ignored on read before any write.
      expect((await readRecipe(soup)).preferences).toEqual({
        favourite: false,
        notNowUntil: null,
      });
      await putOk(recipe, { favourite: true });

      expect((await rows()).results).toEqual(
        [
          {
            recipe_id: recipe,
            household_id: household,
            favourite: 1,
            not_now_until: null,
          },
          {
            recipe_id: stew,
            household_id: household,
            favourite: 1,
            not_now_until: null,
          },
          {
            recipe_id: theirs,
            household_id: other.householdId,
            favourite: 0,
            not_now_until: '2026-09-20T00:00:00.000Z',
          },
        ].sort((a, b) => a.recipe_id.localeCompare(b.recipe_id)),
      );
    });
  });

  describe('suggestions', () => {
    it('flags favourites and ranks them after recency', async () => {
      const soup = await seedRecipe(household, 'Soup');
      await putOk(soup, { favourite: true });
      expect(await suggestions()).toEqual([
        expect.objectContaining({ recipeId: soup, favourite: true }),
        expect.objectContaining({ recipeId: recipe, favourite: false }),
      ]);
    });
  });

  describe('retention', () => {
    it('deletes the preferences with their recipe', async () => {
      await putOk(recipe, { favourite: true });
      const response = await call(
        new Request(
          `${RECIPES_URL}/${recipe}`,
          mutationInit('DELETE', { version: 1 }),
        ),
      );
      expect(response.status).toBe(204);
      expect((await rows()).results).toEqual([]);
    });

    it('stores no member identity', async () => {
      const columns = await testEnv.DB.prepare(
        `SELECT name FROM pragma_table_info('recipe_preferences') ORDER BY cid`,
      ).all<{ name: string }>();
      expect(columns.results.map(({ name }) => name)).toEqual([
        'recipe_id',
        'household_id',
        'favourite',
        'not_now_until',
        'updated_at',
      ]);
    });
  });

  describe('authorization and isolation', () => {
    it("answers another household's recipe like a missing one and writes nothing", async () => {
      const other = await seedOtherHousehold();
      const theirs = await seedRecipe(other.householdId, 'Secret paella');
      for (const id of [theirs, crypto.randomUUID()]) {
        const response = await put(id, { favourite: true });
        expect(response.status).toBe(404);
        const body = await response.text();
        expect(body).toContain('That recipe no longer exists.');
        expect(body).not.toContain('Secret');
      }
      expect((await rows()).results).toEqual([]);
    });

    it("never reads or changes another household's preferences", async () => {
      const other = await seedOtherHousehold();
      const theirs = await seedRecipe(other.householdId, 'Theirs');
      await seedRecipePreference(other.householdId, theirs);
      const stranger = createWorker(
        () =>
          Promise.resolve({
            subject: 'other-subject',
            email: 'other@example.test',
          }),
        undefined,
        () => new Date(now),
      );
      await putOk(recipe, { favourite: true });
      await putOk(recipe, { notNow: true });
      // The other household can neither set nor clear this household's
      // preferences through a recipe ID it does not own.
      for (const body of [
        { favourite: true },
        { favourite: false },
        { notNow: true },
        { notNow: false },
      ]) {
        const response = await stranger.fetch(
          new Request(preferencesUrl(recipe), mutationInit('PUT', body)),
          testEnv,
        );
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('Curry');
      }
      expect((await readRecipe(recipe)).preferences).toEqual({
        favourite: true,
        notNowUntil: '2026-10-01T12:00:00.000Z',
      });
      expect((await rows()).results).toHaveLength(2);
      expect(
        await testEnv.DB.prepare(
          'SELECT favourite, not_now_until FROM recipe_preferences WHERE recipe_id = ?',
        )
          .bind(theirs)
          .first(),
      ).toEqual({ favourite: 1, not_now_until: null });
    });

    it('refuses a revoked member before any household statement', async () => {
      await testEnv.DB.prepare(
        `UPDATE household_members SET status = 'revoked', revoked_at = ?`,
      )
        .bind(new Date(START).toISOString())
        .run();
      const { env, statements } = recordingEnv();
      const response = await put(recipe, { favourite: true }, env);
      expect(response.status).toBe(403);
      expect(
        statements.filter((sql) => /recipe_preferences|recipes/u.test(sql)),
      ).toEqual([]);
      expect((await rows()).results).toEqual([]);
    });

    it('refuses an identity that belongs to no household', async () => {
      const stranger = createWorker(() =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      );
      const response = await stranger.fetch(
        new Request(
          preferencesUrl(recipe),
          mutationInit('PUT', { favourite: true }),
        ),
        testEnv,
      );
      expect(response.status).toBe(403);
      expect((await rows()).results).toEqual([]);
    });

    it('refuses a request without a valid Access assertion', async () => {
      const deployed = createWorker();
      const response = await deployed.fetch(
        new Request(
          preferencesUrl(recipe),
          mutationInit('PUT', { favourite: true }),
        ),
        {
          ...testEnv,
          APP_ENV: 'development',
          CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
          CF_ACCESS_AUD: 'development-audience',
        },
      );
      expect(response.status).toBe(401);
      expect((await rows()).results).toEqual([]);
    });

    it('requires a same-origin JSON request', async () => {
      const crossSite = await call(
        new Request(preferencesUrl(recipe), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example',
          },
          body: JSON.stringify({ favourite: true }),
        }),
      );
      expect(crossSite.status).toBe(403);
      const notJson = await call(
        new Request(preferencesUrl(recipe), {
          method: 'PUT',
          headers: { origin: 'https://example.test' },
          body: 'favourite=true',
        }),
      );
      expect(notJson.status).toBe(415);
      expect((await rows()).results).toEqual([]);
    });
  });

  describe('the request', () => {
    it.each([
      ['an empty object', {}],
      ['both fields', { favourite: true, notNow: true }],
      ['an unknown field', { star: true }],
      ['a string', { favourite: 'true' }],
      ['a number', { notNow: 1 }],
      ['null', { favourite: null }],
    ])('refuses %s', async (_name, body) => {
      const response = await put(recipe, body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      });
      expect((await rows()).results).toEqual([]);
    });

    it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
      'answers %s with not found',
      async (method) => {
        const response = await call(
          new Request(preferencesUrl(recipe), {
            method,
            headers: {
              'content-type': 'application/json',
              origin: 'https://example.test',
            },
            ...(method === 'GET' ? {} : { body: '{"favourite":true}' }),
          }),
        );
        expect(response.status).toBe(404);
      },
    );
  });

  it('writes no title, preference, or time to the console', async () => {
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
      const saffron = await seedRecipe(household, 'Saffron risotto');
      await putOk(saffron, { favourite: true });
      await putOk(saffron, { notNow: true });
      await put(saffron, { saffron: true });
      await put(crypto.randomUUID(), { favourite: true });
      await readRecipe(saffron);
      await suggestions();
    } finally {
      for (const [level, original] of originals) {
        console[level] = original;
      }
    }
    const output = written.join('\n');
    expect(output).not.toContain('affron');
    expect(output).not.toContain('2026-10-01');
  });
});
