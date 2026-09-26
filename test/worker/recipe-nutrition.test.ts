import { beforeEach, describe, expect, it } from 'vitest';

import type {
  FoodSearchResponse,
  NutritionMatchInput,
  RecipeNutrition,
  RecipeNutritionResponse,
} from '../../src/shared/nutrition';
import type { RecipeResponse } from '../../src/shared/recipes';
import type { RecipeDetailResponse } from '../../src/shared/recipe-preferences';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  loadNutritionFixture,
  mutationInit,
  seedIngredientMatch,
  seedOtherHousehold,
  seedRecipe,
  testEnv,
} from './helpers';

const ORIGIN = 'https://example.test';
const RECIPES_URL = `${ORIGIN}/api/recipes`;
const nutritionUrl = (id: string) => `${RECIPES_URL}/${id}/nutrition`;
const searchUrl = (query: string) =>
  `${ORIGIN}/api/nutrition/foods?q=${encodeURIComponent(query)}`;

const NOW = new Date('2026-09-26T08:00:00.000Z');
const worker = createWorker(undefined, undefined, () => NOW);
const call = (request: Request, env: typeof testEnv = testEnv) =>
  worker.fetch(request, env);

// Fixture foods (test/fixtures/nutrition-dataset.json), real USDA values.
const SOY_SAUCE = 174278; // 251 kJ; portions tbsp 18 g, tsp 6 g
const EGG = 171287; // 599 kJ; portion 1 "large" 50 g
const BEEF = 2514744; // no sugars or fibre value, no portions
const OLIVE_OIL = 171413;

const LINES = ['2 tbsp soy sauce', '1 large egg', 'salt and pepper to taste'];

const readNutrition = async (id: string): Promise<RecipeNutrition> => {
  const response = await call(new Request(nutritionUrl(id)));
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json<RecipeNutritionResponse>()).nutrition;
};

const save = (
  id: string,
  recipeVersion: number,
  matches: NutritionMatchInput[],
  env?: typeof testEnv,
) =>
  call(
    new Request(
      nutritionUrl(id),
      mutationInit('PUT', { recipeVersion, matches }),
    ),
    env,
  );

const saveOk = async (
  id: string,
  recipeVersion: number,
  matches: NutritionMatchInput[],
): Promise<RecipeNutrition> => {
  const response = await save(id, recipeVersion, matches);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json<RecipeNutritionResponse>()).nutrition;
};

const readRecipe = async (id: string) => {
  const response = await call(new Request(`${RECIPES_URL}/${id}`));
  expect(response.status).toBe(200);
  return (await response.json<RecipeDetailResponse>()).recipe;
};

const patchRecipe = async (id: string, body: Record<string, unknown>) => {
  const response = await call(
    new Request(`${RECIPES_URL}/${id}`, mutationInit('PATCH', body)),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json<RecipeResponse>()).recipe;
};

const matchRows = () =>
  testEnv.DB.prepare(
    `SELECT position, line_text, fdc_id, quantity, unit, grams
       FROM recipe_ingredient_matches ORDER BY recipe_id, position`,
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

const counted = (
  position: number,
  line: string,
  fdcId: number,
  quantity: number,
  unit: NutritionMatchInput['unit'],
): NutritionMatchInput => ({ position, line, fdcId, quantity, unit });

const fullSave = (): NutritionMatchInput[] => [
  counted(1, LINES[0], SOY_SAUCE, 2, 'tbsp'),
  counted(2, LINES[1], EGG, 1, 'portion:1'),
  { position: 3, line: LINES[2], fdcId: null },
];

describe('recipe nutrition API', () => {
  let household: string;
  let recipe: string;

  beforeEach(async () => {
    await applyMigrations();
    await loadNutritionFixture();
    await bootstrapOwner();
    household = await ownerHouseholdId();
    recipe = await seedRecipe(household, 'Egg fried rice', {
      ingredients: LINES,
    });
  });

  describe('food search', () => {
    it('finds foods by every word as a prefix, with their portions', async () => {
      const response = await call(new Request(searchUrl('soy sau')));
      expect(response.status).toBe(200);
      const { foods } = await response.json<FoodSearchResponse>();
      expect(foods[0]).toEqual({
        fdcId: SOY_SAUCE,
        name: 'Soy sauce made from soy (tamari)',
        category: 'Legumes and Legume Products',
        dataType: 'sr_legacy',
        portions: [
          { seq: 1, amount: 1, label: 'tbsp', gramWeight: 18 },
          { seq: 2, amount: 1, label: 'tsp', gramWeight: 6 },
        ],
        volumeSeq: 1,
      });
    });

    it('matches plural and singular forms through stemming', async () => {
      for (const query of ['tomato', 'tomatoes', 'EGGS']) {
        const response = await call(new Request(searchUrl(query)));
        const { foods } = await response.json<FoodSearchResponse>();
        expect(foods.length, query).toBeGreaterThan(0);
      }
    });

    it('treats search syntax as plain words', async () => {
      for (const query of ['egg" OR "x', 'NEAR(egg)', 'egg*', 'name:egg']) {
        const response = await call(new Request(searchUrl(query)));
        expect(response.status, query).toBe(200);
      }
    });

    it.each([
      ['one character', 'e'],
      ['no letters or digits', '!!??'],
      ['more than 60 characters', 'egg '.repeat(16)],
      ['nothing', ''],
    ])('refuses %s', async (_name, query) => {
      const response = await call(new Request(searchUrl(query)));
      expect(response.status).toBe(400);
    });

    it('is for members only', async () => {
      const stranger = createWorker(() =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      );
      const response = await stranger.fetch(
        new Request(searchUrl('egg')),
        testEnv,
      );
      expect(response.status).toBe(403);
    });
  });

  describe('reading and saving', () => {
    it('reports every line unchecked before anything is saved', async () => {
      expect(await readNutrition(recipe)).toEqual({
        recipeVersion: 1,
        servings: null,
        lines: LINES.map((text, index) => ({
          position: index + 1,
          text,
          state: 'unchecked',
          match: null,
        })),
        checked: false,
        needsCheck: 0,
        counted: 0,
        totals: null,
        perServing: null,
        sources: [],
      });
    });

    it('converts amounts with USDA portions and calculates the panel', async () => {
      const nutrition = await saveOk(recipe, 1, fullSave());
      // 2 NZ tablespoons (30 ml) of soy sauce at USDA's 18 g per US
      // tablespoon (14.787 ml) is 36.5 g; one large egg is 50 g.
      expect(
        nutrition.lines.map(({ state, match }) => [
          state,
          match && { ...match, food: [match.food.fdcId, match.food.name] },
        ]),
      ).toEqual([
        [
          'counted',
          {
            food: [SOY_SAUCE, 'Soy sauce made from soy (tamari)'],
            quantity: 2,
            unit: 'tbsp',
            unitLabel: 'tbsp',
            grams: 36.5,
          },
        ],
        [
          'counted',
          {
            food: [EGG, 'Egg, whole, raw, fresh'],
            quantity: 1,
            unit: 'portion:1',
            unitLabel: 'large (50 g each)',
            grams: 50,
          },
        ],
        ['not_counted', null],
      ]);
      expect(nutrition.counted).toBe(2);
      expect(nutrition.checked).toBe(true);
      expect(nutrition.needsCheck).toBe(0);
      expect(nutrition.totals?.energyKj.value).toBeCloseTo(
        (251 * 36.5) / 100 + (599 * 50) / 100,
        6,
      );
      expect(nutrition.totals?.sodiumMg.value).toBeCloseTo(
        (5586 * 36.5) / 100 + (142 * 50) / 100,
        6,
      );
      expect(nutrition.perServing).toBeNull();
      expect(nutrition.sources).toEqual([
        {
          fdcId: SOY_SAUCE,
          name: 'Soy sauce made from soy (tamari)',
          dataType: 'sr_legacy',
          release: '2018-04',
          url: `https://fdc.nal.usda.gov/food-details/${SOY_SAUCE}/nutrients`,
        },
        {
          fdcId: EGG,
          name: 'Egg, whole, raw, fresh',
          dataType: 'sr_legacy',
          release: '2018-04',
          url: `https://fdc.nal.usda.gov/food-details/${EGG}/nutrients`,
        },
      ]);
      expect(await readNutrition(recipe)).toEqual(nutrition);
    });

    it('divides by servings, which a recipe edit sets', async () => {
      await saveOk(recipe, 1, fullSave());
      const updated = await patchRecipe(recipe, { version: 1, servings: 2 });
      expect(updated).toMatchObject({ servings: 2, version: 2 });
      const nutrition = await readNutrition(recipe);
      expect(nutrition.servings).toBe(2);
      expect(nutrition.recipeVersion).toBe(2);
      // Servings don't change the lines, so every match still counts.
      expect(nutrition.counted).toBe(2);
      expect(nutrition.perServing?.energyKj).toBeCloseTo(
        (nutrition.totals?.energyKj.value ?? 0) / 2,
        6,
      );
    });

    it('never changes the recipe, its version, or its update time', async () => {
      const before = await readRecipe(recipe);
      await saveOk(recipe, 1, fullSave());
      expect(await readRecipe(recipe)).toEqual(before);
    });

    it('names the counted foods that report no value for a nutrient', async () => {
      await saveOk(recipe, 1, [
        counted(1, LINES[0], BEEF, 100, 'g'),
        counted(2, LINES[1], EGG, 1, 'portion:1'),
        { position: 3, line: LINES[2], fdcId: null },
      ]);
      const { totals } = await readNutrition(recipe);
      expect(totals?.sugarsG).toEqual({
        value: expect.closeTo((0.37 * 50) / 100, 6) as number,
        missingFrom: ['Beef, ground, 80% lean meat / 20% fat, raw'],
      });
      expect(totals?.energyKj.missingFrom).toEqual([]);
    });

    it('saves some lines and leaves the rest unchecked', async () => {
      const nutrition = await saveOk(recipe, 1, [
        counted(2, LINES[1], EGG, 2, 'portion:1'),
      ]);
      expect(nutrition.lines.map(({ state }) => state)).toEqual([
        'unchecked',
        'counted',
        'unchecked',
      ]);
      expect(nutrition.needsCheck).toBe(2);
    });

    it('replaces a saved match for the same line', async () => {
      await saveOk(recipe, 1, fullSave());
      await saveOk(recipe, 1, [counted(2, LINES[1], OLIVE_OIL, 1, 'tbsp')]);
      const rows = await matchRows();
      expect(rows.results).toHaveLength(3);
      expect(rows.results[1]).toMatchObject({
        fdc_id: OLIVE_OIL,
        unit: 'tbsp',
        // 15 ml at USDA's 13.5 g per US tablespoon.
        grams: 13.7,
      });
    });
  });

  describe('staleness', () => {
    it('stops counting a match whose line changed, and asks for a check', async () => {
      await saveOk(recipe, 1, fullSave());
      await patchRecipe(recipe, {
        version: 1,
        ingredients: ['3 tbsp soy sauce', LINES[1], LINES[2]],
      });
      const nutrition = await readNutrition(recipe);
      expect(nutrition.lines.map(({ state }) => state)).toEqual([
        'changed',
        'counted',
        'not_counted',
      ]);
      expect(nutrition.needsCheck).toBe(1);
      expect(nutrition.counted).toBe(1);
      expect(nutrition.sources.map(({ fdcId }) => fdcId)).toEqual([EGG]);
    });

    it('does not count a match that moved to another position', async () => {
      await saveOk(recipe, 1, fullSave());
      await patchRecipe(recipe, {
        version: 1,
        ingredients: [LINES[1], LINES[0], LINES[2]],
      });
      const nutrition = await readNutrition(recipe);
      expect(nutrition.lines.map(({ state }) => state)).toEqual([
        'changed',
        'changed',
        'not_counted',
      ]);
      expect(nutrition.totals).toBeNull();
    });

    it("deletes a recipe's stale matches on the next save", async () => {
      await saveOk(recipe, 1, fullSave());
      await patchRecipe(recipe, {
        version: 1,
        ingredients: ['3 tbsp soy sauce', '2 large eggs'],
      });
      // Positions 1 and 2 changed, and position 3 is gone.
      expect((await matchRows()).results).toHaveLength(3);
      await saveOk(recipe, 2, [
        counted(1, '3 tbsp soy sauce', SOY_SAUCE, 3, 'tbsp'),
      ]);
      // The saved line replaces its match; the changed line that wasn't
      // saved and the removed line lose theirs.
      expect((await matchRows()).results).toEqual([
        {
          position: 1,
          line_text: '3 tbsp soy sauce',
          fdc_id: SOY_SAUCE,
          quantity: 3,
          unit: 'tbsp',
          grams: 54.8,
        },
      ]);
    });

    it('treats a match for a food missing from the dataset as unchecked', async () => {
      await seedIngredientMatch(household, recipe, 1, LINES[0], 1);
      const nutrition = await readNutrition(recipe);
      expect(nutrition.lines[0].state).toBe('unchecked');
      expect(nutrition.checked).toBe(true);
      expect(nutrition.needsCheck).toBe(3);
    });
  });

  describe('conflicts', () => {
    it('refuses a save for an older recipe version and writes nothing', async () => {
      await patchRecipe(recipe, { version: 1, title: 'Fried rice' });
      const response = await save(recipe, 1, fullSave());
      expect(response.status).toBe(409);
      const body = await response.json<{
        error: { code: string };
        current: { version: number };
      }>();
      expect(body.error.code).toBe('stale_version');
      expect(body.current.version).toBe(2);
      expect((await matchRows()).results).toEqual([]);
    });

    it('writes nothing when any line no longer reads as the member saw it', async () => {
      const response = await save(recipe, 1, [
        counted(1, LINES[0], SOY_SAUCE, 2, 'tbsp'),
        counted(2, '2 large eggs', EGG, 2, 'portion:1'),
      ]);
      expect(response.status).toBe(409);
      expect((await matchRows()).results).toEqual([]);
    });

    it('writes nothing for a position the recipe does not have', async () => {
      const response = await save(recipe, 1, [
        counted(1, LINES[0], SOY_SAUCE, 2, 'tbsp'),
        counted(9, '1 cup milk', EGG, 1, 'portion:1'),
      ]);
      expect(response.status).toBe(409);
      expect((await matchRows()).results).toEqual([]);
    });
  });

  describe('the request', () => {
    it.each<[string, unknown]>([
      ['an empty object', {}],
      ['no matches', { recipeVersion: 1, matches: [] }],
      ['an unknown field', { recipeVersion: 1, matches: [], extra: 1 }],
      [
        'a repeated position',
        {
          recipeVersion: 1,
          matches: [
            { position: 1, line: LINES[0], fdcId: null },
            { position: 1, line: LINES[0], fdcId: null },
          ],
        },
      ],
      [
        'a zero amount',
        { recipeVersion: 1, matches: [counted(1, LINES[0], EGG, 0, 'g')] },
      ],
      [
        'an unknown unit',
        {
          recipeVersion: 1,
          matches: [
            {
              position: 1,
              line: LINES[0],
              fdcId: EGG,
              quantity: 1,
              unit: 'cups',
            },
          ],
        },
      ],
      [
        'an amount on a line that is not counted',
        {
          recipeVersion: 1,
          matches: [
            {
              position: 1,
              line: LINES[0],
              fdcId: null,
              quantity: 1,
              unit: 'g',
            },
          ],
        },
      ],
      [
        'a nutrient value',
        {
          recipeVersion: 1,
          matches: [{ ...counted(1, LINES[0], EGG, 1, 'g'), energyKj: 1 }],
        },
      ],
    ])('refuses %s', async (_name, body) => {
      const response = await call(
        new Request(nutritionUrl(recipe), mutationInit('PUT', body)),
      );
      expect(response.status).toBe(400);
      expect((await matchRows()).results).toEqual([]);
    });

    it.each<[string, NutritionMatchInput, string]>([
      [
        'a food outside the reference data',
        counted(1, LINES[0], 999_999_999, 1, 'g'),
        'Choose a food from the list.',
      ],
      [
        'a volume for a food with no volume portion',
        counted(1, LINES[0], BEEF, 1, 'cup'),
        "That unit can't be used for Beef, ground, 80% lean meat / 20% fat, raw.",
      ],
      [
        'a portion the food does not have',
        counted(1, LINES[0], SOY_SAUCE, 1, 'portion:9'),
        "That unit can't be used for Soy sauce made from soy (tamari).",
      ],
      [
        'more than 10,000 g',
        counted(1, LINES[0], EGG, 11, 'kg'),
        'Each amount must come to more than 0 g and at most 10000 g.',
      ],
    ])('refuses %s', async (_name, match, message) => {
      const response = await save(recipe, 1, [match]);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(message);
      expect((await matchRows()).results).toEqual([]);
    });

    it.each(['POST', 'PATCH', 'DELETE'])(
      'answers %s with not found',
      async (method) => {
        const response = await call(
          new Request(nutritionUrl(recipe), {
            method,
            headers: { 'content-type': 'application/json', origin: ORIGIN },
            body: '{}',
          }),
        );
        expect(response.status).toBe(404);
      },
    );
  });

  describe('retention', () => {
    it('deletes the matches with their recipe', async () => {
      await saveOk(recipe, 1, fullSave());
      const response = await call(
        new Request(
          `${RECIPES_URL}/${recipe}`,
          mutationInit('DELETE', { version: 1 }),
        ),
      );
      expect(response.status).toBe(204);
      expect((await matchRows()).results).toEqual([]);
    });
  });

  describe('authorization and isolation', () => {
    it("answers another household's recipe like a missing one and writes nothing", async () => {
      const other = await seedOtherHousehold();
      const theirs = await seedRecipe(other.householdId, 'Secret paella', {
        ingredients: LINES,
      });
      for (const id of [theirs, crypto.randomUUID()]) {
        const read = await call(new Request(nutritionUrl(id)));
        expect(read.status).toBe(404);
        const written = await save(id, 1, fullSave());
        expect(written.status).toBe(404);
        const body = await written.text();
        expect(body).toContain('That recipe no longer exists.');
        expect(body).not.toContain('Secret');
      }
      expect((await matchRows()).results).toEqual([]);
    });

    it("never reads or changes this household's matches from another household", async () => {
      await seedOtherHousehold();
      await saveOk(recipe, 1, fullSave());
      const stranger = createWorker(
        () =>
          Promise.resolve({
            subject: 'other-subject',
            email: 'other@example.test',
          }),
        undefined,
        () => NOW,
      );
      const read = await stranger.fetch(
        new Request(nutritionUrl(recipe)),
        testEnv,
      );
      expect(read.status).toBe(404);
      expect(await read.text()).not.toContain('soy');
      const written = await stranger.fetch(
        new Request(
          nutritionUrl(recipe),
          mutationInit('PUT', {
            recipeVersion: 1,
            matches: [{ position: 3, line: LINES[2], fdcId: null }],
          }),
        ),
        testEnv,
      );
      expect(written.status).toBe(404);
      expect((await matchRows()).results).toHaveLength(3);
    });

    it('refuses a revoked member before any household statement', async () => {
      await testEnv.DB.prepare(
        `UPDATE household_members SET status = 'revoked', revoked_at = ?`,
      )
        .bind(NOW.toISOString())
        .run();
      const { env, statements } = recordingEnv();
      const read = await call(new Request(nutritionUrl(recipe)), env);
      expect(read.status).toBe(403);
      const written = await save(recipe, 1, fullSave(), env);
      expect(written.status).toBe(403);
      const search = await call(new Request(searchUrl('egg')), env);
      expect(search.status).toBe(403);
      expect(
        statements.filter((sql) =>
          /recipe_ingredient|recipes|nutrition_/u.test(sql),
        ),
      ).toEqual([]);
      expect((await matchRows()).results).toEqual([]);
    });

    it('refuses an identity that belongs to no household', async () => {
      const stranger = createWorker(() =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      );
      const read = await stranger.fetch(
        new Request(nutritionUrl(recipe)),
        testEnv,
      );
      expect(read.status).toBe(403);
      const written = await stranger.fetch(
        new Request(
          nutritionUrl(recipe),
          mutationInit('PUT', { recipeVersion: 1, matches: fullSave() }),
        ),
        testEnv,
      );
      expect(written.status).toBe(403);
      expect((await matchRows()).results).toEqual([]);
    });

    it('refuses a request without a valid Access assertion', async () => {
      const deployed = createWorker();
      const response = await deployed.fetch(new Request(nutritionUrl(recipe)), {
        ...testEnv,
        APP_ENV: 'development',
        CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
        CF_ACCESS_AUD: 'development-audience',
      });
      expect(response.status).toBe(401);
    });

    it('requires a same-origin JSON request to save', async () => {
      const crossSite = await call(
        new Request(nutritionUrl(recipe), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example',
          },
          body: JSON.stringify({ recipeVersion: 1, matches: fullSave() }),
        }),
      );
      expect(crossSite.status).toBe(403);
      const notJson = await call(
        new Request(nutritionUrl(recipe), {
          method: 'PUT',
          headers: { origin: ORIGIN },
          body: 'matches=1',
        }),
      );
      expect(notJson.status).toBe(415);
      expect((await matchRows()).results).toEqual([]);
    });
  });

  it('writes no title, line, or food to the console', async () => {
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
      await saveOk(recipe, 1, fullSave());
      await save(recipe, 1, [counted(1, LINES[0], BEEF, 1, 'cup')]);
      await save(recipe, 7, fullSave());
      await readNutrition(recipe);
      await call(new Request(searchUrl('soy sauce')));
    } finally {
      for (const [level, original] of originals) {
        console[level] = original;
      }
    }
    const output = written.join('\n').toLowerCase();
    expect(output).not.toContain('soy');
    expect(output).not.toContain('egg');
    expect(output).not.toContain('beef');
  });
});

describe('recipe servings', () => {
  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
  });

  const create = (servings: unknown) =>
    call(
      new Request(
        RECIPES_URL,
        mutationInit('POST', {
          title: 'Soup',
          ingredients: ['1 onion'],
          steps: ['Cook.'],
          ...(servings === undefined ? {} : { servings }),
        }),
      ),
    );

  it('stores servings on create and clears them on update', async () => {
    const response = await create(4);
    expect(response.status).toBe(201);
    const { recipe } = await response.json<RecipeResponse>();
    expect(recipe.servings).toBe(4);
    expect((await readRecipe(recipe.id)).servings).toBe(4);
    const cleared = await patchRecipe(recipe.id, {
      version: 1,
      servings: null,
    });
    expect(cleared).toMatchObject({ servings: null, version: 2 });
    // An edit that leaves servings out keeps them.
    await patchRecipe(recipe.id, { version: 2, servings: 6 });
    expect(
      await patchRecipe(recipe.id, { version: 3, title: 'Stew' }),
    ).toMatchObject({
      servings: 6,
    });
  });

  it('leaves servings unset when a create omits them', async () => {
    const response = await create(undefined);
    expect((await response.json<RecipeResponse>()).recipe.servings).toBeNull();
  });

  it.each([0, 51, 2.5, '4', true])('refuses servings of %s', async (value) => {
    expect((await create(value)).status).toBe(400);
  });
});
