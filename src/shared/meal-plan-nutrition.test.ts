import { describe, expect, it } from 'vitest';
import { NUTRIENT_KEYS, type NutrientKey } from './nutrition';
import type { MealPlanEntry } from './meal-plan';
import {
  aggregateMealPlanNutrition,
  nutritionWeekQuery,
  type PlannedRecipeNutrition,
} from './meal-plan-nutrition';

const MONDAY = '2026-09-21';
const RECIPE_ID = '11111111-1111-4111-8111-111111111111';
const recipeEntry = (
  id: string,
  date: string,
  over: Partial<Extract<MealPlanEntry, { kind: 'recipe' }>> = {},
): MealPlanEntry => ({
  id,
  date,
  slot: 'dinner',
  kind: 'recipe',
  title: 'Soy chicken',
  recipeId: RECIPE_ID,
  recipeRemoved: false,
  note: null,
  version: 1,
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

const recipe = (
  over: Partial<PlannedRecipeNutrition> = {},
): PlannedRecipeNutrition => ({
  recipeId: RECIPE_ID,
  servings: 4,
  counted: 2,
  unchecked: 0,
  changed: 0,
  notCounted: 0,
  nutrients: Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, { value: 40, missing: false }]),
  ) as PlannedRecipeNutrition['nutrients'],
  ...over,
});

describe('meal-plan nutrition week', () => {
  it('accepts exactly one Monday date', () => {
    expect(nutritionWeekQuery(new URLSearchParams('week=2026-09-21'))).toBe(
      MONDAY,
    );
    for (const query of [
      '',
      'week=2026-09-22',
      'week=2026-02-30',
      'week=2026-09-21&week=2026-09-21',
      'week=2026-09-21&extra=1',
    ]) {
      expect(nutritionWeekQuery(new URLSearchParams(query))).toBeNull();
    }
  });

  it('returns seven empty days and no invented zero', () => {
    const summary = aggregateMealPlanNutrition(MONDAY, [], new Map());
    expect(summary.days).toHaveLength(7);
    expect(summary.week.planned).toBe(0);
    expect(summary.week.nutrients.energyKj).toEqual({
      value: null,
      partial: false,
    });
  });

  it('adds one serving for each repeated entry and names exclusions', () => {
    const entries: MealPlanEntry[] = [
      recipeEntry('a', MONDAY),
      recipeEntry('b', '2026-09-22'),
      {
        id: 'c',
        date: MONDAY,
        slot: 'lunch',
        kind: 'text',
        title: 'Leftovers',
        note: null,
        version: 1,
        updatedAt: '2026-09-21T00:00:00.000Z',
      },
      recipeEntry('d', '2026-09-22', {
        recipeId: null,
        recipeRemoved: true,
      }),
    ];
    const summary = aggregateMealPlanNutrition(
      MONDAY,
      entries,
      new Map([[RECIPE_ID, recipe()]]),
    );
    expect(summary.days[0].nutrients.energyKj.value).toBe(10);
    expect(summary.days[1].nutrients.energyKj.value).toBe(10);
    expect(summary.week.nutrients.energyKj).toEqual({
      value: 20,
      partial: true,
    });
    expect(summary.week).toMatchObject({ planned: 4, included: 2 });
    expect(summary.week.gaps.map((gap) => gap.reasons)).toEqual([
      ['text_meal'],
      ['recipe_removed'],
    ]);
  });

  it('keeps known zero separate from gaps and propagates missing USDA values', () => {
    const nutrients = recipe().nutrients;
    nutrients.energyKj = { value: 0, missing: false };
    nutrients.sugarsG = { value: null, missing: true };
    const summary = aggregateMealPlanNutrition(
      MONDAY,
      [recipeEntry('a', MONDAY)],
      new Map([
        [RECIPE_ID, recipe({ nutrients, unchecked: 1, notCounted: 1 })],
      ]),
    );
    expect(summary.week.nutrients.energyKj).toEqual({
      value: 0,
      partial: true,
    });
    expect(summary.week.nutrients.sugarsG).toEqual({
      value: null,
      partial: true,
    });
    expect(summary.week.gaps[0].reasons).toEqual([
      'check_ingredients',
      'not_counted',
      'missing_usda_values',
    ]);
  });

  it('excludes a recipe with no servings while preserving another known amount', () => {
    const otherId = '22222222-2222-4222-8222-222222222222';
    const summary = aggregateMealPlanNutrition(
      MONDAY,
      [
        recipeEntry('a', MONDAY),
        recipeEntry('b', MONDAY, { recipeId: otherId }),
      ],
      new Map([
        [RECIPE_ID, recipe()],
        [otherId, recipe({ recipeId: otherId, servings: null })],
      ]),
    );
    expect(summary.week).toMatchObject({ planned: 2, included: 1 });
    expect(summary.week.nutrients.proteinG).toEqual({
      value: 10,
      partial: true,
    });
    expect(summary.week.gaps[0].reasons).toEqual(['add_servings']);
  });

  it('includes every panel nutrient', () => {
    const summary = aggregateMealPlanNutrition(MONDAY, [], new Map());
    expect(Object.keys(summary.week.nutrients).sort()).toEqual(
      [...NUTRIENT_KEYS].sort(),
    );
    expect(
      (Object.keys(summary.week.nutrients) as NutrientKey[]).every(
        (key) => summary.week.nutrients[key].value === null,
      ),
    ).toBe(true);
  });
});
