import { beforeEach, describe, expect, it } from 'vitest';
import type { MealPlanNutritionResponse } from '../../src/shared/meal-plan-nutrition';
import { createWorker } from '../../src/worker/index';
import {
  buildNutritionFixture,
  ENTRY_COUNT,
  fixtureCleanupStatements,
  fixtureSeedStatements,
  INGREDIENT_COUNT,
  MATCH_COUNT,
  RECIPE_COUNT,
} from '../../src/operations/dev-nutrition-fixture';
import {
  applyMigrations,
  bootstrapOwner,
  loadNutritionFixture,
  testEnv,
} from './helpers';

const WEEK = '2026-11-02';
const fixture = buildNutritionFixture(WEEK);
const worker = createWorker();

describe('development nutrition fixture against migrated D1', () => {
  let householdId: string;

  beforeEach(async () => {
    await applyMigrations();
    await loadNutritionFixture();
    await bootstrapOwner();
    const member = await testEnv.DB.prepare(
      "SELECT household_id FROM household_members WHERE access_subject = 'local-owner'",
    ).first<{ household_id: string }>();
    householdId = member?.household_id as string;
  });

  it('seeds both accepted scenarios and cleans only its rows', async () => {
    const timestamp = '2026-09-27T00:00:00.000Z';
    for (const statement of fixtureSeedStatements(
      fixture,
      householdId,
      timestamp,
    )) {
      await testEnv.DB.prepare(statement.sql)
        .bind(...statement.params)
        .run();
    }
    const count = async (table: string): Promise<number> => {
      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).first<{ count: number }>();
      return row?.count ?? -1;
    };
    expect(await count('recipes')).toBe(RECIPE_COUNT);
    expect(await count('recipe_ingredients')).toBe(INGREDIENT_COUNT);
    expect(await count('recipe_ingredient_matches')).toBe(MATCH_COUNT);
    expect(await count('meal_plan_entries')).toBe(ENTRY_COUNT);

    const read = async (week: string): Promise<MealPlanNutritionResponse> => {
      const response = await worker.fetch(
        new Request(
          `https://example.test/api/meal-plan/nutrition?week=${week}`,
        ),
        testEnv,
      );
      expect(response.status).toBe(200);
      return response.json<MealPlanNutritionResponse>();
    };
    const small = await read(WEEK);
    expect(small.week).toMatchObject({ planned: 6, included: 4 });
    expect(small.week.gaps.flatMap(({ reasons }) => reasons)).toEqual(
      expect.arrayContaining([
        'check_ingredients',
        'text_meal',
        'add_servings',
        'missing_usda_values',
      ]),
    );
    const stress = await read(fixture.stressWeek);
    expect(stress.week).toMatchObject({ planned: 126, included: 126 });
    expect(stress.days.map(({ planned }) => planned)).toEqual(
      Array(7).fill(18),
    );
    expect(stress.week.gaps).toEqual([]);
    expect(
      new Set(fixture.entries.slice(6).map(({ recipeId }) => recipeId)).size,
    ).toBe(42);

    for (const statement of fixtureCleanupStatements(fixture, householdId)) {
      await testEnv.DB.prepare(statement.sql)
        .bind(...statement.params)
        .run();
    }
    expect(await count('meal_plan_entries')).toBe(0);
    expect(await count('recipes')).toBe(0);
    expect(await count('recipe_ingredients')).toBe(0);
    expect(await count('recipe_ingredient_matches')).toBe(0);
    expect(await count('nutrition_foods')).toBeGreaterThan(0);
  });
});
