import { beforeEach, describe, expect, it } from 'vitest';
import type { MealPlanNutritionResponse } from '../../src/shared/meal-plan-nutrition';
import type { RecipeNutritionResponse } from '../../src/shared/nutrition';
import { NUTRIENT_KEYS } from '../../src/shared/nutrition';
import { planWeekDates } from '../../src/shared/meal-plan';
import { createWorker } from '../../src/worker/index';
import { readMealPlanNutrition } from '../../src/worker/data/meal-plan-nutrition-repository';
import {
  applyMigrations,
  bootstrapOwner,
  loadNutritionFixture,
  seedIngredientMatch,
  seedMealPlanEntry,
  seedOtherHousehold,
  seedRecipe,
  testEnv,
} from './helpers';

const ORIGIN = 'https://example.test';
const WEEK = '2026-09-21';
const URL = `${ORIGIN}/api/meal-plan/nutrition?week=${WEEK}`;
const EGG = 171287;
const BEEF = 2514744; // USDA reports no sugars or fibre value.
const worker = createWorker();
const read = (url = URL) => worker.fetch(new Request(url), testEnv);

const householdId = async (): Promise<string> => {
  const row = await testEnv.DB.prepare(
    "SELECT household_id FROM household_members WHERE access_subject = 'local-owner'",
  ).first<{ household_id: string }>();
  return row?.household_id as string;
};

const readOk = async (): Promise<MealPlanNutritionResponse> => {
  const response = await read();
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json<MealPlanNutritionResponse>();
};

describe('meal-plan nutrition API in Workers runtime', () => {
  let household: string;
  let recipeId: string;

  beforeEach(async () => {
    await applyMigrations();
    await loadNutritionFixture();
    await bootstrapOwner();
    household = await householdId();
    recipeId = await seedRecipe(household, 'Egg and beef', {
      ingredients: ['1 egg', '100 g beef'],
    });
    await testEnv.DB.prepare('UPDATE recipes SET servings = 2 WHERE id = ?')
      .bind(recipeId)
      .run();
    await seedIngredientMatch(household, recipeId, 1, '1 egg', EGG);
    await seedIngredientMatch(household, recipeId, 2, '100 g beef', BEEF);
  });

  it('sums one serving per entry and matches the recipe nutrition formula', async () => {
    await seedMealPlanEntry(household, { date: WEEK, recipeId });
    await seedMealPlanEntry(household, {
      date: '2026-09-22',
      recipeId,
      slot: 'lunch',
    });
    await seedMealPlanEntry(household, { date: WEEK, title: 'Leftovers' });
    await seedMealPlanEntry(household, {
      date: '2026-09-28',
      recipeId,
    });

    const plan = await readOk();
    const nutritionResponse = await worker.fetch(
      new Request(`${ORIGIN}/api/recipes/${recipeId}/nutrition`),
      testEnv,
    );
    const { nutrition } =
      await nutritionResponse.json<RecipeNutritionResponse>();
    expect(plan.week).toMatchObject({ planned: 3, included: 2 });
    for (const key of NUTRIENT_KEYS) {
      const serving = nutrition.perServing?.[key];
      if (serving === null || serving === undefined) {
        expect(plan.days[0].nutrients[key].value).toBeNull();
        expect(plan.week.nutrients[key].value).toBeNull();
      } else {
        expect(plan.days[0].nutrients[key].value).toBeCloseTo(serving, 6);
        expect(plan.week.nutrients[key].value).toBeCloseTo(2 * serving, 6);
      }
    }
    expect(plan.week.nutrients.sugarsG).toMatchObject({ partial: true });
    expect(plan.week.gaps.map((gap) => gap.reasons[0]).sort()).toEqual([
      'missing_usda_values',
      'missing_usda_values',
      'text_meal',
    ]);
  });

  it('drops a changed match and reflects current servings and plan entries', async () => {
    const entryId = await seedMealPlanEntry(household, {
      date: WEEK,
      recipeId,
    });
    const before = await readOk();
    await testEnv.DB.prepare(
      "UPDATE recipe_ingredients SET text = '2 eggs' WHERE recipe_id = ? AND position = 1",
    )
      .bind(recipeId)
      .run();
    const changed = await readOk();
    expect(changed.week.nutrients.energyKj.value).toBeLessThan(
      before.week.nutrients.energyKj.value ?? 0,
    );
    expect(changed.week.gaps[0].reasons).toContain('check_ingredients');

    await testEnv.DB.prepare('UPDATE recipes SET servings = NULL WHERE id = ?')
      .bind(recipeId)
      .run();
    const noServings = await readOk();
    expect(noServings.week).toMatchObject({ planned: 1, included: 0 });
    expect(noServings.week.nutrients.energyKj.value).toBeNull();
    expect(noServings.week.gaps[0].reasons).toContain('add_servings');

    await testEnv.DB.prepare('DELETE FROM meal_plan_entries WHERE id = ?')
      .bind(entryId)
      .run();
    expect((await readOk()).week.planned).toBe(0);
  });

  it('treats removed foods and recipes as gaps without inventing values', async () => {
    await seedMealPlanEntry(household, { date: WEEK, recipeId });
    await testEnv.DB.prepare(
      'UPDATE recipe_ingredient_matches SET fdc_id = ? WHERE recipe_id = ? AND position = 1',
    )
      .bind(999999999, recipeId)
      .run();
    const missingFood = await readOk();
    expect(missingFood.week.gaps[0].reasons).toContain('check_ingredients');
    expect(missingFood.week.nutrients.energyKj.value).not.toBeNull();

    await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
      .bind(recipeId)
      .run();
    const removed = await readOk();
    expect(removed.week).toMatchObject({ planned: 1, included: 0 });
    expect(removed.week.nutrients.energyKj.value).toBeNull();
    expect(removed.week.gaps[0]).toMatchObject({
      recipeId: null,
      reasons: ['recipe_removed'],
    });
  });

  it('reads a full 126-entry week with two prepared queries', async () => {
    for (const date of planWeekDates(WEEK)) {
      for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
        for (let position = 0; position < 6; position += 1) {
          await seedMealPlanEntry(household, { date, slot, recipeId });
        }
      }
    }
    let prepares = 0;
    const db = {
      prepare: (query: string) => {
        prepares += 1;
        return testEnv.DB.prepare(query);
      },
    } as D1Database;
    const plan = await readMealPlanNutrition(db, household, WEEK);
    expect(plan.week).toMatchObject({ planned: 126, included: 126 });
    expect(plan.days.map((day) => day.planned)).toEqual(Array(7).fill(18));
    expect(prepares).toBe(2);
  });

  it('never returns another household’s entries or recipe nutrition', async () => {
    await seedMealPlanEntry(household, { date: WEEK, recipeId });
    const other = await seedOtherHousehold();
    const otherRecipe = await seedRecipe(other.householdId, 'Private dinner');
    await seedMealPlanEntry(other.householdId, {
      date: WEEK,
      recipeId: otherRecipe,
    });
    const ownerPlan = await readOk();
    expect(ownerPlan.week.planned).toBe(1);
    expect(JSON.stringify(ownerPlan)).not.toContain('Private dinner');

    const otherWorker = createWorker(() =>
      Promise.resolve({
        subject: 'other-subject',
        email: 'other@example.test',
      }),
    );
    const response = await otherWorker.fetch(new Request(URL), testEnv);
    expect(response.status).toBe(200);
    const theirPlan = await response.json<MealPlanNutritionResponse>();
    expect(theirPlan.week.planned).toBe(1);
    expect(JSON.stringify(theirPlan)).not.toContain('Egg and beef');
  });

  it('validates one Monday and denies revoked members', async () => {
    for (const query of [
      '',
      '?week=2026-09-22',
      '?week=2026-02-30',
      `?week=${WEEK}&week=${WEEK}`,
      `?week=${WEEK}&extra=1`,
    ]) {
      expect(
        (await read(`${ORIGIN}/api/meal-plan/nutrition${query}`)).status,
      ).toBe(400);
    }
    await testEnv.DB.prepare(
      "UPDATE household_members SET status = 'revoked', revoked_at = ? WHERE access_subject = 'local-owner'",
    )
      .bind(new Date().toISOString())
      .run();
    const response = await read();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Egg and beef');
  });
});
