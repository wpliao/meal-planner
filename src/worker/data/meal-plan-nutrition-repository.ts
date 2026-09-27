import { addPlanDays } from '../../shared/meal-plan';
import {
  aggregateMealPlanNutrition,
  type MealPlanNutritionResponse,
  type PlannedRecipeNutrition,
} from '../../shared/meal-plan-nutrition';
import { NUTRIENT_KEYS, type NutrientKey } from '../../shared/nutrition';
import { listMealPlanEntries } from './meal-plan-repository';

const FOOD_COLUMN: Record<NutrientKey, string> = {
  energyKj: 'energy_kj',
  proteinG: 'protein_g',
  fatG: 'fat_g',
  saturatedFatG: 'saturated_fat_g',
  carbohydrateG: 'carbohydrate_g',
  sugarsG: 'sugars_g',
  fibreG: 'fibre_g',
  sodiumMg: 'sodium_mg',
};

/** SQL aggregates each distinct recipe once, returning at most 126 rows. */
const NUTRIENT_SELECT = NUTRIENT_KEYS.flatMap((key) => {
  const column = FOOD_COLUMN[key];
  return [
    `SUM(food.${column} * match.grams / 100.0) AS ${key}_value`,
    `SUM(CASE WHEN food.fdc_id IS NOT NULL AND food.${column} IS NULL
      THEN 1 ELSE 0 END) AS ${key}_missing`,
  ];
}).join(',\n       ');

const RECIPE_TOTALS = `WITH selected AS (
  SELECT DISTINCT recipe.id, recipe.household_id, recipe.servings
    FROM meal_plan_entries AS entry
    JOIN recipes AS recipe
      ON recipe.id = entry.recipe_id
     AND recipe.household_id = entry.household_id
   WHERE entry.household_id = ?
     AND entry.plan_date BETWEEN ? AND ?
     AND entry.kind = 'recipe'
)
SELECT selected.id AS recipe_id, selected.servings,
       SUM(CASE WHEN food.fdc_id IS NOT NULL THEN 1 ELSE 0 END) AS counted,
       SUM(CASE WHEN line.position IS NOT NULL AND
          (match.recipe_id IS NULL OR
           (match.line_text = line.text AND match.fdc_id IS NOT NULL
            AND food.fdc_id IS NULL))
         THEN 1 ELSE 0 END) AS unchecked,
       SUM(CASE WHEN line.position IS NOT NULL AND match.recipe_id IS NOT NULL
          AND match.line_text <> line.text THEN 1 ELSE 0 END) AS changed,
       SUM(CASE WHEN line.position IS NOT NULL AND match.recipe_id IS NOT NULL
          AND match.line_text = line.text AND match.fdc_id IS NULL
         THEN 1 ELSE 0 END) AS not_counted,
       ${NUTRIENT_SELECT}
  FROM selected
  LEFT JOIN recipe_ingredients AS line ON line.recipe_id = selected.id
  LEFT JOIN recipe_ingredient_matches AS match
    ON match.recipe_id = selected.id
   AND match.household_id = selected.household_id
   AND match.position = line.position
  LEFT JOIN nutrition_foods AS food
    ON food.fdc_id = match.fdc_id
   AND match.line_text = line.text
 GROUP BY selected.id, selected.servings`;

type RecipeRow = Record<string, number | string | null> & {
  recipe_id: string;
  servings: number | null;
  counted: number;
  unchecked: number;
  changed: number;
  not_counted: number;
};

const toRecipe = (row: RecipeRow): PlannedRecipeNutrition => ({
  recipeId: row.recipe_id,
  servings: row.servings,
  counted: row.counted,
  unchecked: row.unchecked,
  changed: row.changed,
  notCounted: row.not_counted,
  nutrients: Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [
      key,
      {
        value: row[`${key}_value`] as number | null,
        missing: (row[`${key}_missing`] as number) > 0,
      },
    ]),
  ) as PlannedRecipeNutrition['nutrients'],
});

/** Current plan entries plus current recipe nutrition, with no per-entry read. */
export const readMealPlanNutrition = async (
  db: D1Database,
  householdId: string,
  weekStart: string,
): Promise<MealPlanNutritionResponse> => {
  const end = addPlanDays(weekStart, 6);
  const [entries, recipes] = await Promise.all([
    listMealPlanEntries(db, householdId, weekStart, end),
    db
      .prepare(RECIPE_TOTALS)
      .bind(householdId, weekStart, end)
      .all<RecipeRow>(),
  ]);
  return aggregateMealPlanNutrition(
    weekStart,
    entries,
    new Map(recipes.results.map((row) => [row.recipe_id, toRecipe(row)])),
  );
};
