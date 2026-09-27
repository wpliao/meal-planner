/** Read-only nutrition estimates for one displayed meal-plan week. */
import {
  isPlanDate,
  planWeekDates,
  planWeekStart,
  type MealPlanEntry,
} from './meal-plan';
import { NUTRIENT_KEYS, type NutrientKey } from './nutrition';

export type PlanNutritionGapReason =
  | 'text_meal'
  | 'recipe_removed'
  | 'add_servings'
  | 'work_out_nutrition'
  | 'check_ingredients'
  | 'not_counted'
  | 'missing_usda_values';

export interface PlanNutritionGap {
  entryId: string;
  date: string;
  title: string;
  recipeId: string | null;
  reasons: PlanNutritionGapReason[];
}

export interface PlanNutrientAmount {
  /** Null means no known value; a known zero stays zero. */
  value: number | null;
  partial: boolean;
}

export interface PlanNutritionSummary {
  planned: number;
  included: number;
  nutrients: Record<NutrientKey, PlanNutrientAmount>;
  gaps: PlanNutritionGap[];
}

export interface PlanNutritionDay extends PlanNutritionSummary {
  date: string;
}

export interface MealPlanNutritionResponse {
  weekStart: string;
  days: PlanNutritionDay[];
  week: PlanNutritionSummary;
}

/** A bounded, per-recipe result from D1; every amount is for the whole recipe. */
export interface PlannedRecipeNutrition {
  recipeId: string;
  servings: number | null;
  counted: number;
  unchecked: number;
  changed: number;
  notCounted: number;
  nutrients: Record<NutrientKey, { value: number | null; missing: boolean }>;
}

/** Exactly one Monday date, with no other query parameter. */
export const nutritionWeekQuery = (params: URLSearchParams): string | null => {
  if ([...params.keys()].length !== 1 || params.getAll('week').length !== 1)
    return null;
  const week = params.get('week');
  return week && isPlanDate(week) && planWeekStart(week) === week ? week : null;
};

const emptySummary = (): PlanNutritionSummary => ({
  planned: 0,
  included: 0,
  nutrients: Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, { value: null, partial: false }]),
  ) as Record<NutrientKey, PlanNutrientAmount>,
  gaps: [],
});

const reasonForEntry = (
  entry: MealPlanEntry,
  recipe: PlannedRecipeNutrition | undefined,
): PlanNutritionGapReason[] => {
  if (entry.kind === 'text') return ['text_meal'];
  if (entry.recipeRemoved || !recipe) return ['recipe_removed'];
  const reasons: PlanNutritionGapReason[] = [];
  if (recipe.servings === null) reasons.push('add_servings');
  if (recipe.counted === 0) reasons.push('work_out_nutrition');
  if (recipe.unchecked > 0 || recipe.changed > 0)
    reasons.push('check_ingredients');
  if (recipe.notCounted > 0) reasons.push('not_counted');
  if (
    recipe.counted > 0 &&
    NUTRIENT_KEYS.some(
      (key) =>
        recipe.nutrients[key].missing || recipe.nutrients[key].value === null,
    )
  )
    reasons.push('missing_usda_values');
  return reasons;
};

const addEntry = (
  summary: PlanNutritionSummary,
  entry: MealPlanEntry,
  recipes: ReadonlyMap<string, PlannedRecipeNutrition>,
): void => {
  summary.planned += 1;
  const recipe =
    entry.kind === 'recipe' && entry.recipeId
      ? recipes.get(entry.recipeId)
      : undefined;
  const reasons = reasonForEntry(entry, recipe);
  if (reasons.length > 0) {
    summary.gaps.push({
      entryId: entry.id,
      date: entry.date,
      title: entry.title,
      recipeId:
        entry.kind === 'recipe' && !entry.recipeRemoved ? entry.recipeId : null,
      reasons,
    });
  }
  const included =
    recipe !== undefined && recipe.servings !== null && recipe.counted > 0;
  if (included) summary.included += 1;
  const incompleteLines =
    recipe !== undefined &&
    recipe.unchecked + recipe.changed + recipe.notCounted > 0;
  for (const key of NUTRIENT_KEYS) {
    const amount = summary.nutrients[key];
    if (!included || recipe === undefined || recipe.servings === null) {
      amount.partial = true;
      continue;
    }
    const nutrient = recipe.nutrients[key];
    if (nutrient.value !== null) {
      amount.value = (amount.value ?? 0) + nutrient.value / recipe.servings;
    }
    if (incompleteLines || nutrient.missing || nutrient.value === null)
      amount.partial = true;
  }
};

/** One serving per live, checked recipe entry. Keep full precision until UI. */
export const aggregateMealPlanNutrition = (
  weekStart: string,
  entries: readonly MealPlanEntry[],
  recipes: ReadonlyMap<string, PlannedRecipeNutrition>,
): MealPlanNutritionResponse => {
  const days = planWeekDates(weekStart).map((date): PlanNutritionDay => ({
    date,
    ...emptySummary(),
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const week = emptySummary();
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (!day) continue;
    addEntry(day, entry, recipes);
    addEntry(week, entry, recipes);
  }
  return { weekStart, days, week };
};
