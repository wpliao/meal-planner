import { addPlanDays } from '../../shared/meal-plan';
import {
  MEAL_SUGGESTION_RECENT_DAYS,
  type MealSuggestionInput,
} from '../../shared/meal-suggestions';
import type { PantryStatus } from '../../shared/pantry';

interface PantryRow {
  display_name: string;
  status: PantryStatus;
}

interface RecipeRow {
  id: string;
  title: string;
}

interface IngredientRow {
  recipe_id: string;
  text: string;
}

interface PlannedRow {
  recipe_id: string;
  plan_date: string;
}

interface PreferenceRow {
  recipe_id: string;
  favourite: number;
  not_now_until: string | null;
}

/**
 * Recipe entries still linked to one of the household's recipes. The join
 * repeats the household on both sides, so a recipe of another household can
 * never count, and a typed meal or an entry whose recipe was deleted
 * (`recipe_id` NULL) plans no recipe.
 */
const LINKED_ENTRIES = `meal_plan_entries AS entry
  JOIN recipes AS recipe
    ON recipe.id = entry.recipe_id
   AND recipe.household_id = entry.household_id
 WHERE entry.household_id = ? AND entry.kind = 'recipe'`;

/**
 * Everything the ranking reads for one meal date, in one batch, so the
 * pantry, the recipes, the plan, and the household's recipe preferences come
 * from one consistent state (the #73 and #78 designs). Nothing is written.
 *
 * The plan is aggregated in SQL: each recipe's latest date before the meal,
 * plus every date it is planned within the recent window. That is all the
 * ranking needs, and at most one row per recipe plus the window's entries.
 */
export const readSuggestionInput = async (
  db: D1Database,
  householdId: string,
  date: string,
  now: Date,
): Promise<MealSuggestionInput> => {
  const [pantry, recipes, ingredients, planned, preferences] = await db.batch([
    db
      .prepare(
        `SELECT display_name, status FROM pantry_items WHERE household_id = ?`,
      )
      .bind(householdId),
    db
      .prepare(`SELECT id, title FROM recipes WHERE household_id = ?`)
      .bind(householdId),
    db
      .prepare(
        `SELECT line.recipe_id, line.text
           FROM recipe_ingredients AS line
           JOIN recipes AS recipe ON recipe.id = line.recipe_id
          WHERE recipe.household_id = ?`,
      )
      .bind(householdId),
    db
      .prepare(
        `SELECT recipe.id AS recipe_id, MAX(entry.plan_date) AS plan_date
           FROM ${LINKED_ENTRIES} AND entry.plan_date < ?
          GROUP BY recipe.id
         UNION
         SELECT recipe.id AS recipe_id, entry.plan_date
           FROM ${LINKED_ENTRIES} AND entry.plan_date BETWEEN ? AND ?`,
      )
      .bind(
        householdId,
        date,
        householdId,
        addPlanDays(date, -MEAL_SUGGESTION_RECENT_DAYS),
        addPlanDays(date, MEAL_SUGGESTION_RECENT_DAYS),
      ),
    db
      .prepare(
        `SELECT recipe_id, favourite, not_now_until
           FROM recipe_preferences
          WHERE household_id = ?`,
      )
      .bind(householdId),
  ]);

  const lines = new Map<string, string[]>();
  for (const row of ingredients.results as IngredientRow[]) {
    const list = lines.get(row.recipe_id);
    if (list) list.push(row.text);
    else lines.set(row.recipe_id, [row.text]);
  }

  return {
    date,
    pantry: (pantry.results as PantryRow[]).map((row) => ({
      name: row.display_name,
      status: row.status,
    })),
    recipes: (recipes.results as RecipeRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      ingredients: lines.get(row.id) ?? [],
    })),
    planned: (planned.results as PlannedRow[]).map((row) => ({
      recipeId: row.recipe_id,
      date: row.plan_date,
    })),
    preferences: (preferences.results as PreferenceRow[]).map((row) => ({
      recipeId: row.recipe_id,
      favourite: row.favourite === 1,
      notNowUntil: row.not_now_until,
    })),
    now,
  };
};
