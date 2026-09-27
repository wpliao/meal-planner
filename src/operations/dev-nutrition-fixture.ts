/** Synthetic, removable development data for issue #98 validation. */

import type { BoundStatement } from './household-decommission/sql.ts';

export const STRESS_RECIPE_COUNT = 42;
export const STRESS_ENTRY_COUNT = 126;
export const SMALL_ENTRY_COUNT = 6;
export const RECIPE_COUNT = STRESS_RECIPE_COUNT + 4;
export const INGREDIENT_COUNT = STRESS_RECIPE_COUNT * 8 + 5;
export const MATCH_COUNT = INGREDIENT_COUNT - 1;
export const ENTRY_COUNT = STRESS_ENTRY_COUNT + SMALL_ENTRY_COUNT;

const EGG = 171287;
const BEEF = 2514744;
const SLOTS = ['breakfast', 'lunch', 'dinner'] as const;

export interface FixtureRow {
  readonly id: string;
  readonly title: string;
  readonly servings: number | null;
}

export interface FixtureLine {
  readonly recipeId: string;
  readonly position: number;
  readonly text: string;
  readonly foodId?: number;
  readonly grams?: number;
}

export interface FixtureEntry {
  readonly id: string;
  readonly date: string;
  readonly slot: (typeof SLOTS)[number];
  readonly recipeId: string | null;
  readonly title: string;
}

export interface NutritionFixture {
  readonly smallWeek: string;
  readonly stressWeek: string;
  readonly recipes: readonly FixtureRow[];
  readonly lines: readonly FixtureLine[];
  readonly entries: readonly FixtureEntry[];
}

/** Valid version-4-shaped IDs make fixture links behave like normal app IDs. */
const fixtureId = (week: string, kind: string, number: number): string => {
  const day = Math.floor(Date.parse(`${week}T00:00:00.000Z`) / 86_400_000);
  const kindCode = kind === 'recipe' ? '8001' : '8002';
  return `${day.toString(16).padStart(8, '0')}-98f1-4000-${kindCode}-${(number + 1).toString(16).padStart(12, '0')}`;
};

export const addFixtureDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Both fixture weeks must be inside the app's plan write window. */
export const validateFixtureWeek = (
  week: string,
  now: Date,
  requireFuture: boolean,
): void => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(week)) {
    throw new Error('Week start must be a Monday in YYYY-MM-DD form.');
  }
  const date = new Date(`${week}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== week ||
    date.getUTCDay() !== 1
  ) {
    throw new Error('Week start must be a real Monday.');
  }
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const distanceDays = (date.valueOf() - today.valueOf()) / 86_400_000;
  if (requireFuture && (distanceDays < 0 || distanceDays > 49 * 7)) {
    throw new Error('Choose a future Monday within 49 weeks.');
  }
};

export const buildNutritionFixture = (week: string): NutritionFixture => {
  const stressWeek = addFixtureDays(week, 7);
  const recipes: FixtureRow[] = [
    {
      id: fixtureId(week, 'recipe', 0),
      title: '[DEV TEST] Checked egg recipe',
      servings: 2,
    },
    {
      id: fixtureId(week, 'recipe', 1),
      title: '[DEV TEST] Ingredient needs checking',
      servings: 2,
    },
    {
      id: fixtureId(week, 'recipe', 2),
      title: '[DEV TEST] Add servings',
      servings: null,
    },
    {
      id: fixtureId(week, 'recipe', 3),
      title: '[DEV TEST] Missing USDA values',
      servings: 2,
    },
  ];
  const lines: FixtureLine[] = [
    {
      recipeId: recipes[0].id,
      position: 1,
      text: '100 g egg',
      foodId: EGG,
      grams: 100,
    },
    {
      recipeId: recipes[1].id,
      position: 1,
      text: '100 g egg',
      foodId: EGG,
      grams: 100,
    },
    {
      recipeId: recipes[1].id,
      position: 2,
      text: '1 unchecked test ingredient',
    },
    {
      recipeId: recipes[2].id,
      position: 1,
      text: '100 g egg',
      foodId: EGG,
      grams: 100,
    },
    {
      recipeId: recipes[3].id,
      position: 1,
      text: '100 g beef',
      foodId: BEEF,
      grams: 100,
    },
  ];
  const entries: FixtureEntry[] = [
    {
      id: fixtureId(week, 'entry', 0),
      date: week,
      slot: 'breakfast',
      recipeId: recipes[0].id,
      title: recipes[0].title,
    },
    {
      id: fixtureId(week, 'entry', 1),
      date: week,
      slot: 'lunch',
      recipeId: recipes[1].id,
      title: recipes[1].title,
    },
    {
      id: fixtureId(week, 'entry', 2),
      date: week,
      slot: 'dinner',
      recipeId: null,
      title: '[DEV TEST] Text meal with no nutrition',
    },
    {
      id: fixtureId(week, 'entry', 3),
      date: addFixtureDays(week, 1),
      slot: 'dinner',
      recipeId: recipes[0].id,
      title: recipes[0].title,
    },
    {
      id: fixtureId(week, 'entry', 4),
      date: addFixtureDays(week, 2),
      slot: 'lunch',
      recipeId: recipes[2].id,
      title: recipes[2].title,
    },
    {
      id: fixtureId(week, 'entry', 5),
      date: addFixtureDays(week, 3),
      slot: 'dinner',
      recipeId: recipes[3].id,
      title: recipes[3].title,
    },
  ];
  for (let index = 0; index < STRESS_RECIPE_COUNT; index += 1) {
    const number = index + 5;
    const recipe: FixtureRow = {
      id: fixtureId(week, 'recipe', index + 4),
      title: `[DEV TEST] Nutrition load recipe ${String(number).padStart(2, '0')}`,
      servings: 4,
    };
    recipes.push(recipe);
    for (let position = 1; position <= 8; position += 1) {
      lines.push({
        recipeId: recipe.id,
        position,
        text: `${position * 10} g egg, test line ${position}`,
        foodId: EGG,
        grams: position * 10,
      });
    }
  }
  for (let index = 0; index < STRESS_ENTRY_COUNT; index += 1) {
    const recipe = recipes[4 + (index % STRESS_RECIPE_COUNT)];
    entries.push({
      id: fixtureId(week, 'entry', SMALL_ENTRY_COUNT + index),
      date: addFixtureDays(stressWeek, Math.floor(index / 18)),
      slot: SLOTS[Math.floor(index / 6) % 3],
      recipeId: recipe.id,
      title: recipe.title,
    });
  }
  return { smallWeek: week, stressWeek, recipes, lines, entries };
};

const RECIPES_SQL = `INSERT INTO recipes
  (id, household_id, title, notes, servings, version, write_token,
   source_kind, created_at, updated_at)
SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.title'), NULL,
       json_extract(value, '$.servings'), 1, json_extract(value, '$.id'),
       'manual', ?3, ?3
  FROM json_each(?2)`;

const LINES_SQL = `INSERT INTO recipe_ingredients (recipe_id, position, text)
SELECT json_extract(value, '$.recipeId'), json_extract(value, '$.position'),
       json_extract(value, '$.text') FROM json_each(?1)`;

const MATCHES_SQL = `INSERT INTO recipe_ingredient_matches
  (recipe_id, position, household_id, line_text, fdc_id, quantity, unit,
   grams, confirmed_at)
SELECT json_extract(value, '$.recipeId'), json_extract(value, '$.position'),
       ?1, json_extract(value, '$.text'), json_extract(value, '$.foodId'),
       json_extract(value, '$.grams'), 'g', json_extract(value, '$.grams'), ?3
  FROM json_each(?2)`;

const ENTRIES_SQL = `INSERT INTO meal_plan_entries
  (id, household_id, plan_date, meal_slot, kind, recipe_id, title, note,
   placed_at, version, created_at, updated_at)
SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.date'),
       json_extract(value, '$.slot'),
       CASE WHEN json_extract(value, '$.recipeId') IS NULL THEN 'text' ELSE 'recipe' END,
       json_extract(value, '$.recipeId'), json_extract(value, '$.title'), NULL,
       ?3, 1, ?3, ?3 FROM json_each(?2)`;

export const fixtureSeedStatements = (
  fixture: NutritionFixture,
  householdId: string,
  timestamp: string,
): BoundStatement[] => [
  {
    sql: RECIPES_SQL,
    params: [householdId, JSON.stringify(fixture.recipes), timestamp],
  },
  { sql: LINES_SQL, params: [JSON.stringify(fixture.lines)] },
  {
    sql: MATCHES_SQL,
    params: [
      householdId,
      JSON.stringify(fixture.lines.filter((line) => line.foodId !== undefined)),
      timestamp,
    ],
  },
  {
    sql: ENTRIES_SQL,
    params: [householdId, JSON.stringify(fixture.entries), timestamp],
  },
];

export const fixtureCleanupStatements = (
  fixture: NutritionFixture,
  householdId: string,
): BoundStatement[] => [
  {
    sql: `DELETE FROM meal_plan_entries WHERE household_id = ?1
      AND id IN (SELECT value FROM json_each(?2))`,
    params: [householdId, JSON.stringify(fixture.entries.map(({ id }) => id))],
  },
  {
    sql: `DELETE FROM recipes WHERE household_id = ?1
      AND id IN (SELECT value FROM json_each(?2))`,
    params: [householdId, JSON.stringify(fixture.recipes.map(({ id }) => id))],
  },
];
