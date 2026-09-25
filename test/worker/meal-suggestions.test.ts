import { beforeEach, describe, expect, it } from 'vitest';

import { addPlanDays } from '../../src/shared/meal-plan';
import type {
  MealSuggestion,
  MealSuggestionsResponse,
} from '../../src/shared/meal-suggestions';
import { readSuggestionInput } from '../../src/worker/data/meal-suggestion-repository';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  seedMealPlanEntry,
  seedOtherHousehold,
  seedPantryItem,
  seedRecipe,
  testEnv,
} from './helpers';

const SUGGESTIONS_URL = 'https://example.test/api/meal-plan/suggestions';

/** The Worker's clock: 2026-09-24 at noon UTC. */
const TODAY = '2026-09-24';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);
const worker = createWorker(undefined, undefined, () => NOW);

const suggest = (
  query = `date=${TODAY}`,
  env: typeof testEnv = testEnv,
  handler = worker,
): Promise<Response> =>
  handler.fetch(new Request(`${SUGGESTIONS_URL}?${query}`), env);

const suggestOk = async (date = TODAY): Promise<MealSuggestion[]> => {
  const response = await suggest(`date=${date}`);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return (await response.json<MealSuggestionsResponse>()).suggestions;
};

const ownerHouseholdId = async (): Promise<string> => {
  const row = await testEnv.DB.prepare(
    `SELECT household_id FROM household_members WHERE access_subject = 'local-owner'`,
  ).first<{ household_id: string }>();
  return row?.household_id as string;
};

/**
 * The environment with a D1 binding that records every statement prepared,
 * so a test can prove which tables a refused request never reached.
 */
const recordingEnv = (): {
  env: typeof testEnv;
  statements: string[];
  batches: number[];
  rowsRead: number[][];
} => {
  const statements: string[] = [];
  const batches: number[] = [];
  const rowsRead: number[][] = [];
  const db = new Proxy(testEnv.DB, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          statements.push(sql);
          return target.prepare(sql);
        };
      }
      if (property === 'batch') {
        return async (list: D1PreparedStatement[]) => {
          batches.push(list.length);
          const results = await target.batch(list);
          rowsRead.push(results.map((result) => result.meta.rows_read));
          return results;
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { env: { ...testEnv, DB: db }, statements, batches, rowsRead };
};

const HOUSEHOLD_TABLES =
  /pantry_items|recipes|recipe_ingredients|meal_plan_entries|recipe_preferences/u;

describe('meal suggestions API', () => {
  let household: string;

  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
    household = await ownerHouseholdId();
  });

  describe('ranking from the household data', () => {
    it('ranks the library by pantry matches, then plans, with structured reasons', async () => {
      await seedPantryItem(household, 'Chicken');
      await seedPantryItem(household, 'rice', 'low');
      await seedPantryItem(household, 'soy sauce', 'needed');
      const curry = await seedRecipe(household, 'Chicken curry', {
        ingredients: ['500 g chicken thighs', '2 cups rice', '1 tbsp curry'],
      });
      const teriyaki = await seedRecipe(household, 'Teriyaki chicken', {
        ingredients: ['4 chicken thighs', '3 tbsp soy sauce'],
      });
      const bread = await seedRecipe(household, 'Bread', {
        ingredients: ['500 g flour', 'water'],
      });
      const soup = await seedRecipe(household, 'Soup', {
        ingredients: ['stock'],
      });
      // Curry was planned on Monday; soup a month ago.
      await seedMealPlanEntry(household, {
        date: '2026-09-21',
        recipeId: curry,
      });
      await seedMealPlanEntry(household, {
        date: '2026-08-20',
        recipeId: soup,
      });

      expect(await suggestOk()).toEqual([
        {
          recipeId: curry,
          title: 'Chicken curry',
          pantry: {
            held: [
              { name: 'Chicken', status: 'available' },
              { name: 'rice', status: 'low' },
            ],
            needed: [],
          },
          recent: '2026-09-21',
          lastPlanned: '2026-09-21',
          favourite: false,
        },
        {
          recipeId: teriyaki,
          title: 'Teriyaki chicken',
          pantry: {
            held: [{ name: 'Chicken', status: 'available' }],
            needed: ['soy sauce'],
          },
          recent: null,
          lastPlanned: null,
          favourite: false,
        },
        {
          recipeId: bread,
          title: 'Bread',
          pantry: { held: [], needed: [] },
          recent: null,
          lastPlanned: null,
          favourite: false,
        },
        {
          recipeId: soup,
          title: 'Soup',
          pantry: { held: [], needed: [] },
          recent: null,
          lastPlanned: '2026-08-20',
          favourite: false,
        },
      ]);
    });

    it('reads the recent window and the latest earlier date from the whole plan', async () => {
      const curry = await seedRecipe(household, 'Curry');
      for (const date of [
        '2026-01-05',
        '2026-06-30',
        '2026-10-08',
        '2026-10-09',
      ]) {
        await seedMealPlanEntry(household, { date, recipeId: curry });
      }
      // 14 days after the meal is recent; 15 is not.
      expect(await suggestOk()).toEqual([
        expect.objectContaining({
          recent: '2026-10-08',
          lastPlanned: '2026-06-30',
          favourite: false,
        }),
      ]);
      expect(await suggestOk('2026-09-23')).toEqual([
        expect.objectContaining({ recent: null, lastPlanned: '2026-06-30' }),
      ]);
      expect(await suggestOk('2026-10-09')).toEqual([
        expect.objectContaining({
          recent: '2026-10-09',
          lastPlanned: '2026-10-08',
          favourite: false,
        }),
      ]);
    });

    it('returns at most five', async () => {
      for (let index = 0; index < 7; index += 1) {
        await seedRecipe(household, `Recipe ${index}`);
      }
      expect((await suggestOk()).map(({ title }) => title)).toEqual([
        'Recipe 0',
        'Recipe 1',
        'Recipe 2',
        'Recipe 3',
        'Recipe 4',
      ]);
    });

    it('answers an empty library with no suggestions', async () => {
      await seedPantryItem(household, 'rice');
      await seedMealPlanEntry(household, { date: TODAY, title: 'Eat out' });
      expect(await suggestOk()).toEqual([]);
    });

    it('still suggests with an empty pantry and no plan history', async () => {
      const id = await seedRecipe(household, 'Pasta');
      expect(await suggestOk()).toEqual([
        {
          recipeId: id,
          title: 'Pasta',
          pantry: { held: [], needed: [] },
          recent: null,
          lastPlanned: null,
          favourite: false,
        },
      ]);
    });

    it('searches ingredient lines only, not titles or steps', async () => {
      await seedPantryItem(household, 'tofu');
      await seedRecipe(household, 'Tofu stir-fry', {
        ingredients: ['greens'],
        steps: ['Add the tofu.'],
      });
      expect(await suggestOk()).toEqual([
        expect.objectContaining({ pantry: { held: [], needed: [] } }),
      ]);
    });

    it('does not count typed meals or entries of a deleted recipe as planning', async () => {
      const old = await seedRecipe(household, 'Curry');
      await seedMealPlanEntry(household, { date: TODAY, recipeId: old });
      const response = await fetchWorker(
        new Request(
          `https://example.test/api/recipes/${old}`,
          mutationInit('DELETE', { version: 1 }),
        ),
      );
      expect(response.status).toBe(204);
      await seedMealPlanEntry(household, { date: TODAY, title: 'Curry' });
      const again = await seedRecipe(household, 'Curry');

      expect(await suggestOk()).toEqual([
        {
          recipeId: again,
          title: 'Curry',
          pantry: { held: [], needed: [] },
          recent: null,
          lastPlanned: null,
          favourite: false,
        },
      ]);
    });
  });

  describe('household isolation', () => {
    it("never shows or counts another household's recipes, pantry, or plan", async () => {
      const other = await seedOtherHousehold();
      await seedPantryItem(other.householdId, 'saffron');
      const theirs = await seedRecipe(other.householdId, 'Secret paella', {
        ingredients: ['saffron', 'rice'],
      });
      const mine = await seedRecipe(household, 'Risotto', {
        ingredients: ['saffron', 'rice'],
      });
      await seedMealPlanEntry(other.householdId, {
        date: TODAY,
        recipeId: theirs,
      });
      // An entry of theirs pointing at my recipe's ID must not plan it.
      await seedMealPlanEntry(other.householdId, {
        date: TODAY,
        recipeId: mine,
      });

      const response = await suggest();
      const raw = await response.text();
      expect(raw).not.toContain('Secret');
      expect(raw).not.toContain('saffron');
      expect(raw).not.toContain(theirs);
      expect((JSON.parse(raw) as MealSuggestionsResponse).suggestions).toEqual([
        {
          recipeId: mine,
          title: 'Risotto',
          pantry: { held: [], needed: [] },
          recent: null,
          lastPlanned: null,
          favourite: false,
        },
      ]);

      // And the other household sees only its own.
      const stranger = createWorker(
        () =>
          Promise.resolve({
            subject: 'other-subject',
            email: 'other@example.test',
          }),
        undefined,
        () => NOW,
      );
      const theirView = await suggest(`date=${TODAY}`, testEnv, stranger);
      expect(
        (await theirView.json<MealSuggestionsResponse>()).suggestions,
      ).toEqual([
        {
          recipeId: theirs,
          title: 'Secret paella',
          pantry: {
            held: [{ name: 'saffron', status: 'available' }],
            needed: [],
          },
          recent: TODAY,
          lastPlanned: null,
          favourite: false,
        },
      ]);
    });

    it("reads no other household's rows, even through a foreign recipe ID", async () => {
      const other = await seedOtherHousehold();
      const theirs = await seedRecipe(other.householdId, 'Secret paella', {
        ingredients: ['saffron'],
      });
      await seedPantryItem(other.householdId, 'saffron');
      // A row the API never writes: an entry of mine naming their recipe.
      await seedMealPlanEntry(household, { date: TODAY, recipeId: theirs });
      const mine = await seedRecipe(household, 'Risotto');

      expect(
        await readSuggestionInput(testEnv.DB, household, TODAY, NOW),
      ).toEqual({
        date: TODAY,
        pantry: [],
        recipes: [{ id: mine, title: 'Risotto', ingredients: ['1 cup rice'] }],
        planned: [],
        preferences: [],
        now: NOW,
      });
    });
  });

  describe('authorization', () => {
    beforeEach(async () => {
      await seedPantryItem(household, 'rice');
      await seedRecipe(household, 'Fried rice');
    });

    const expectNoHouseholdStatement = (statements: string[]) => {
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.filter((sql) => HOUSEHOLD_TABLES.test(sql))).toEqual(
        [],
      );
    };

    it('refuses a revoked member before reading any household data', async () => {
      await testEnv.DB.prepare(
        `UPDATE household_members
            SET status = 'revoked', revoked_at = ?
          WHERE access_subject = 'local-owner'`,
      )
        .bind(NOW.toISOString())
        .run();
      const { env, statements } = recordingEnv();
      const response = await suggest(`date=${TODAY}`, env);
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).toContain('not_a_member');
      expect(body).not.toContain('rice');
      expectNoHouseholdStatement(statements);
    });

    it('refuses an identity that belongs to no household', async () => {
      const stranger = createWorker(
        () =>
          Promise.resolve({
            subject: 'stranger',
            email: 'stranger@example.test',
          }),
        undefined,
        () => NOW,
      );
      const { env, statements } = recordingEnv();
      const response = await suggest(`date=${TODAY}`, env, stranger);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('rice');
      expectNoHouseholdStatement(statements);
    });

    it('refuses a request without a valid Access assertion', async () => {
      const deployed = createWorker(undefined, undefined, () => NOW);
      const { env, statements } = recordingEnv();
      const response = await suggest(
        `date=${TODAY}`,
        {
          ...env,
          APP_ENV: 'development',
          CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
          CF_ACCESS_AUD: 'development-audience',
        },
        deployed,
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_identity' },
      });
      expect(statements).toEqual([]);
    });

    it('reads nothing for a bad query', async () => {
      const { env, statements } = recordingEnv();
      const response = await suggest('date=someday', env);
      expect(response.status).toBe(400);
      expectNoHouseholdStatement(statements);
    });

    it('checks membership before the query', async () => {
      await testEnv.DB.prepare(
        `UPDATE household_members SET status = 'revoked', revoked_at = ?`,
      )
        .bind(NOW.toISOString())
        .run();
      const response = await suggest('date=someday');
      expect(response.status).toBe(403);
    });

    it('reads the pantry, recipes, lines, plan, and preferences in one batch', async () => {
      const { env, statements, batches } = recordingEnv();
      expect((await suggest(`date=${TODAY}`, env)).status).toBe(200);
      expect(
        statements.filter((sql) => HOUSEHOLD_TABLES.test(sql)),
      ).toHaveLength(5);
      expect(batches).toEqual([5]);
    });

    it("never reads another household's ingredient lines", async () => {
      const other = await seedOtherHousehold();
      const lines = Array.from(
        { length: 60 },
        (_unused, index) => `line ${index}`,
      );
      await seedRecipe(other.householdId, 'Long recipe', {
        ingredients: lines,
      });
      await seedRecipe(other.householdId, 'Longer recipe', {
        ingredients: lines,
      });
      const { env, rowsRead } = recordingEnv();
      expect((await suggest(`date=${TODAY}`, env)).status).toBe(200);
      // Only this household's one recipe and its one line are read.
      const [, , ingredientRows] = rowsRead.at(-1) ?? [];
      expect(ingredientRows).toBeLessThan(10);
    });
  });

  describe('the request', () => {
    it.each([
      ['no date', ''],
      ['a malformed date', 'date=24-09-2026'],
      ['an impossible date', 'date=2026-02-30'],
      ['a repeated date', `date=${TODAY}&date=${TODAY}`],
      ['an unknown parameter', `date=${TODAY}&slot=dinner`],
      ['a date before the write window', `date=${addPlanDays(TODAY, -58)}`],
      ['a date after the write window', `date=${addPlanDays(TODAY, 366)}`],
    ])('refuses %s', async (_name, query) => {
      const response = await suggest(query);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      });
    });

    it('accepts the edges of the write window, with a day of slack', async () => {
      await seedRecipe(household, 'Pasta');
      expect(await suggestOk(addPlanDays(TODAY, -57))).toHaveLength(1);
      expect(await suggestOk(addPlanDays(TODAY, 365))).toHaveLength(1);
    });

    it.each(['POST', 'PUT', 'DELETE'])(
      'answers %s with not found',
      async (method) => {
        const response = await worker.fetch(
          new Request(`${SUGGESTIONS_URL}?date=${TODAY}`, {
            method,
            headers: { origin: 'https://example.test' },
          }),
          testEnv,
        );
        expect(response.status).toBe(404);
      },
    );
  });

  it('writes nothing, and no pantry name, ingredient, title, or date to the console', async () => {
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
    const counts = async () =>
      testEnv.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM pantry_items) AS pantry,
                (SELECT COUNT(*) FROM recipes) AS recipes,
                (SELECT COUNT(*) FROM meal_plan_entries) AS entries,
                (SELECT MAX(version) FROM recipes) AS version`,
      ).first();

    let before: unknown;
    try {
      await seedPantryItem(household, 'Saffron');
      const id = await seedRecipe(household, 'Saffron risotto', {
        ingredients: ['a pinch of saffron'],
      });
      await seedMealPlanEntry(household, { date: TODAY, recipeId: id });
      before = await counts();
      await suggestOk();
      await suggest('date=2099-01-01');
      await suggest(`date=${TODAY}&saffron=1`);
    } finally {
      for (const [level, original] of originals) {
        console[level] = original;
      }
    }

    expect(await counts()).toEqual(before);
    const output = written.join('\n');
    expect(output).not.toContain('affron');
    expect(output).not.toContain(TODAY);
  });
});
