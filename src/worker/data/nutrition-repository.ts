import {
  buildRecipeNutrition,
  FOOD_SEARCH_LIMIT,
  MAX_MATCH_GRAMS,
  toGrams,
  type FoodChoice,
  type FoodDataType,
  type FoodPortion,
  type NutritionFood,
  type RecipeNutrition,
  type StoredMatch,
  type ValidSaveNutritionMatches,
} from '../../shared/nutrition';
import type { Recipe } from '../../shared/recipes';
import { ApiError, invalidRequest } from '../errors';
import { getRecipe } from './recipe-repository';

interface FoodRow {
  fdc_id: number;
  name: string;
  data_type: FoodDataType;
  category: string;
  release: string;
  energy_kj: number | null;
  protein_g: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  carbohydrate_g: number | null;
  sugars_g: number | null;
  fibre_g: number | null;
  sodium_mg: number | null;
  volume_seq: number | null;
}

interface PortionRow {
  fdc_id: number;
  seq: number;
  amount: number;
  label: string;
  gram_weight: number;
}

interface MatchRow {
  position: number;
  line_text: string;
  fdc_id: number | null;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
}

const FOOD_COLUMNS = `f.fdc_id, f.name, f.data_type, f.category, f.release,
  f.energy_kj, f.protein_g, f.fat_g, f.saturated_fat_g, f.carbohydrate_g,
  f.sugars_g, f.fibre_g, f.sodium_mg, f.volume_seq`;

const PORTION_COLUMNS = 'p.fdc_id, p.seq, p.amount, p.label, p.gram_weight';

const portionsByFood = (
  rows: readonly PortionRow[],
): Map<number, FoodPortion[]> => {
  const byFood = new Map<number, FoodPortion[]>();
  for (const row of rows) {
    const list = byFood.get(row.fdc_id) ?? [];
    list.push({
      seq: row.seq,
      amount: row.amount,
      label: row.label,
      gramWeight: row.gram_weight,
    });
    byFood.set(row.fdc_id, list);
  }
  return byFood;
};

const toFood = (row: FoodRow, portions: FoodPortion[]): NutritionFood => ({
  fdcId: row.fdc_id,
  name: row.name,
  category: row.category,
  dataType: row.data_type,
  release: row.release,
  portions,
  volumeSeq: row.volume_seq,
  per100g: {
    energyKj: row.energy_kj,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    saturatedFatG: row.saturated_fat_g,
    carbohydrateG: row.carbohydrate_g,
    sugarsG: row.sugars_g,
    fibreG: row.fibre_g,
    sodiumMg: row.sodium_mg,
  },
});

const toFoods = (
  foods: readonly FoodRow[],
  portions: readonly PortionRow[],
): Map<number, NutritionFood> => {
  const byFood = portionsByFood(portions);
  return new Map(
    foods.map((row) => [row.fdc_id, toFood(row, byFood.get(row.fdc_id) ?? [])]),
  );
};

/**
 * Up to 20 foods whose names contain every word of the query as a prefix,
 * best match first. `ftsQuery` comes from `foodSearchQuery`, which leaves no
 * FTS5 syntax in it, and is bound, never interpolated.
 */
export const searchFoods = async (
  db: D1Database,
  ftsQuery: string,
): Promise<FoodChoice[]> => {
  const matches = `SELECT rowid FROM nutrition_foods_fts
                    WHERE nutrition_foods_fts MATCH ?
                    ORDER BY rank LIMIT ${FOOD_SEARCH_LIMIT}`;
  const [foods, portions] = await db.batch([
    db
      .prepare(
        `SELECT ${FOOD_COLUMNS}
           FROM nutrition_foods_fts
           JOIN nutrition_foods AS f ON f.fdc_id = nutrition_foods_fts.rowid
          WHERE nutrition_foods_fts MATCH ?
          ORDER BY rank, length(f.name), f.fdc_id
          LIMIT ${FOOD_SEARCH_LIMIT}`,
      )
      .bind(ftsQuery),
    db
      .prepare(
        `SELECT ${PORTION_COLUMNS}
           FROM nutrition_food_portions AS p
          WHERE p.fdc_id IN (${matches})
          ORDER BY p.fdc_id, p.seq`,
      )
      .bind(ftsQuery),
  ]);
  const byFood = portionsByFood(portions.results as PortionRow[]);
  return (foods.results as FoodRow[]).map((row) => ({
    fdcId: row.fdc_id,
    name: row.name,
    category: row.category,
    dataType: row.data_type,
    portions: byFood.get(row.fdc_id) ?? [],
    volumeSeq: row.volume_seq,
  }));
};

/** The foods with these IDs that exist, with their portions. */
const readFoods = async (
  db: D1Database,
  fdcIds: readonly number[],
): Promise<Map<number, NutritionFood>> => {
  if (fdcIds.length === 0) return new Map();
  const ids = JSON.stringify([...new Set(fdcIds)]);
  const [foods, portions] = await db.batch([
    db
      .prepare(
        `SELECT ${FOOD_COLUMNS} FROM nutrition_foods AS f
          WHERE f.fdc_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT ${PORTION_COLUMNS} FROM nutrition_food_portions AS p
          WHERE p.fdc_id IN (SELECT value FROM json_each(?))
          ORDER BY p.fdc_id, p.seq`,
      )
      .bind(ids),
  ]);
  return toFoods(foods.results as FoodRow[], portions.results as PortionRow[]);
};

const toStoredMatch = (row: MatchRow): StoredMatch => ({
  position: row.position,
  lineText: row.line_text,
  fdcId: row.fdc_id,
  quantity: row.quantity,
  unit: row.unit,
  grams: row.grams,
});

/**
 * The household's nutrition for one of its recipes, or null when the recipe
 * doesn't exist in that household. The recipe, its lines, its matches, and
 * the matched foods are read in one batch, so they are consistent.
 */
export const readRecipeNutrition = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
): Promise<RecipeNutrition | null> => {
  const matched = `SELECT fdc_id FROM recipe_ingredient_matches
                    WHERE household_id = ? AND recipe_id = ?
                      AND fdc_id IS NOT NULL`;
  const [recipe, lines, matches, foods, portions] = await db.batch([
    db
      .prepare(
        'SELECT version, servings FROM recipes WHERE household_id = ? AND id = ?',
      )
      .bind(householdId, recipeId),
    db
      .prepare(
        `SELECT line.position, line.text
           FROM recipe_ingredients AS line
           JOIN recipes AS recipe ON recipe.id = line.recipe_id
          WHERE recipe.household_id = ? AND recipe.id = ?
          ORDER BY line.position`,
      )
      .bind(householdId, recipeId),
    db
      .prepare(
        `SELECT position, line_text, fdc_id, quantity, unit, grams
           FROM recipe_ingredient_matches
          WHERE household_id = ? AND recipe_id = ?
          ORDER BY position`,
      )
      .bind(householdId, recipeId),
    db
      .prepare(
        `SELECT ${FOOD_COLUMNS} FROM nutrition_foods AS f
          WHERE f.fdc_id IN (${matched})`,
      )
      .bind(householdId, recipeId),
    db
      .prepare(
        `SELECT ${PORTION_COLUMNS} FROM nutrition_food_portions AS p
          WHERE p.fdc_id IN (${matched})
          ORDER BY p.fdc_id, p.seq`,
      )
      .bind(householdId, recipeId),
  ]);
  const row = (
    recipe.results as { version: number; servings: number | null }[]
  )[0];
  if (!row) return null;
  return buildRecipeNutrition({
    recipeVersion: row.version,
    servings: row.servings,
    lines: lines.results as { position: number; text: string }[],
    matches: (matches.results as MatchRow[]).map(toStoredMatch),
    foods: toFoods(
      foods.results as FoodRow[],
      portions.results as PortionRow[],
    ),
  });
};

interface MatchWrite {
  position: number;
  line: string;
  fdcId: number | null;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
}

/**
 * Converts each counted match to grams with the food's USDA portions, and
 * refuses a food that isn't in the reference data or an amount that can't
 * be converted or is over the bound.
 */
const toWrites = async (
  db: D1Database,
  save: ValidSaveNutritionMatches,
): Promise<MatchWrite[]> => {
  const foods = await readFoods(
    db,
    save.matches.flatMap((match) =>
      match.fdcId === null ? [] : [match.fdcId],
    ),
  );
  return save.matches.map((match) => {
    if (match.fdcId === null) {
      return { ...match, quantity: null, unit: null, grams: null };
    }
    const food = foods.get(match.fdcId);
    if (!food) throw invalidRequest('Choose a food from the list.');
    const grams = toGrams(match.quantity, match.unit, food);
    if (grams === null) {
      throw invalidRequest(`That unit can't be used for ${food.name}.`);
    }
    if (grams <= 0 || grams > MAX_MATCH_GRAMS) {
      throw invalidRequest(
        `Each amount must come to more than 0 g and at most ${MAX_MATCH_GRAMS} g.`,
      );
    }
    return { ...match, grams };
  });
};

/**
 * Whether the recipe is still at the version the member reviewed and every
 * submitted line is still the recipe's line at that position. Every
 * statement of a save carries it, so a save changes everything or nothing.
 */
const SAVE_GUARD = `recipe.household_id = ? AND recipe.id = ? AND recipe.version = ?
  AND NOT EXISTS (
    SELECT 1 FROM json_each(?) AS submitted
      LEFT JOIN recipe_ingredients AS line
        ON line.recipe_id = recipe.id
       AND line.position = json_extract(submitted.value, '$.position')
     WHERE line.text IS NOT json_extract(submitted.value, '$.line'))`;

/**
 * Saves a member's matches for the given lines, replacing any saved for
 * those positions, and deletes the recipe's matches whose lines have since
 * changed or gone. It never changes the recipe or its version. A stale
 * version, or a line that no longer reads as the member saw it, changes
 * nothing and answers 409 with the current recipe.
 */
export const saveRecipeMatches = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
  save: ValidSaveNutritionMatches,
  now: Date,
): Promise<RecipeNutrition> => {
  const writes = await toWrites(db, save);
  const submitted = JSON.stringify(writes);
  const guard = [householdId, recipeId, save.recipeVersion, submitted];
  const [upsert] = await db.batch([
    db
      .prepare(
        `INSERT INTO recipe_ingredient_matches
           (recipe_id, position, household_id, line_text, fdc_id, quantity,
            unit, grams, confirmed_at)
         SELECT recipe.id,
                json_extract(entry.value, '$.position'),
                recipe.household_id,
                json_extract(entry.value, '$.line'),
                json_extract(entry.value, '$.fdcId'),
                json_extract(entry.value, '$.quantity'),
                json_extract(entry.value, '$.unit'),
                json_extract(entry.value, '$.grams'),
                ?
           FROM recipes AS recipe, json_each(?) AS entry
          WHERE ${SAVE_GUARD}
         ON CONFLICT (recipe_id, position) DO UPDATE SET
           line_text = excluded.line_text,
           fdc_id = excluded.fdc_id,
           quantity = excluded.quantity,
           unit = excluded.unit,
           grams = excluded.grams,
           confirmed_at = excluded.confirmed_at`,
      )
      .bind(now.toISOString(), submitted, ...guard),
    db
      .prepare(
        `DELETE FROM recipe_ingredient_matches
          WHERE household_id = ? AND recipe_id = ?
            AND EXISTS (SELECT 1 FROM recipes AS recipe WHERE ${SAVE_GUARD})
            AND NOT EXISTS (
              SELECT 1 FROM recipe_ingredients AS line
               WHERE line.recipe_id = recipe_ingredient_matches.recipe_id
                 AND line.position = recipe_ingredient_matches.position
                 AND line.text = recipe_ingredient_matches.line_text)`,
      )
      .bind(householdId, recipeId, ...guard),
  ]);

  if (upsert.meta.changes !== writes.length) {
    throw await saveConflict(db, householdId, recipeId);
  }
  const nutrition = await readRecipeNutrition(db, householdId, recipeId);
  if (!nutrition) throw notFound();
  return nutrition;
};

const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'That recipe no longer exists.');

const saveConflict = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
): Promise<ApiError> => {
  const current: Recipe | null = await getRecipe(db, householdId, recipeId);
  if (!current) return notFound();
  return new ApiError(
    409,
    'stale_version',
    'Someone else changed this recipe. Check the matches against the latest version.',
    { current },
  );
};
