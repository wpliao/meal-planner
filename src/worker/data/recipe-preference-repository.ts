import {
  NO_RECIPE_PREFERENCES,
  notNowActive,
  notNowEnd,
  type RecipePreferenceChange,
  type RecipePreferences,
} from '../../shared/recipe-preferences';
import { ApiError } from '../errors';

interface PreferenceRow {
  favourite: number;
  not_now_until: string | null;
}

const toPreferences = (
  row: PreferenceRow | undefined,
  now: Date,
): RecipePreferences =>
  row
    ? {
        favourite: row.favourite === 1,
        notNowUntil: notNowActive(row.not_now_until, now)
          ? row.not_now_until
          : null,
      }
    : { ...NO_RECIPE_PREFERENCES };

const selectPreferences = (
  db: D1Database,
  householdId: string,
  recipeId: string,
): D1PreparedStatement =>
  db
    .prepare(
      `SELECT favourite, not_now_until
         FROM recipe_preferences
        WHERE household_id = ? AND recipe_id = ?`,
    )
    .bind(householdId, recipeId);

/** The household's preferences for one of its recipes; none when unset. */
export const getRecipePreferences = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
  now: Date,
): Promise<RecipePreferences> =>
  toPreferences(
    (await selectPreferences(
      db,
      householdId,
      recipeId,
    ).first<PreferenceRow>()) ?? undefined,
    now,
  );

/**
 * The statements that apply one change. Setting a preference inserts the row
 * only through the recipe, selected by both ID and household, so a row can
 * never name another household's recipe. Clearing one deletes the row when
 * nothing else would remain, and otherwise clears only that column, so the
 * table's "a row holds a preference" CHECK is never violated.
 */
const changeStatements = (
  db: D1Database,
  householdId: string,
  recipeId: string,
  change: RecipePreferenceChange,
  now: string,
): D1PreparedStatement[] => {
  if ('favourite' in change && change.favourite) {
    return [
      db
        .prepare(
          `INSERT INTO recipe_preferences
             (recipe_id, household_id, favourite, not_now_until, updated_at)
           SELECT id, household_id, 1, NULL, ?
             FROM recipes WHERE id = ? AND household_id = ?
           ON CONFLICT (recipe_id)
           DO UPDATE SET favourite = 1, updated_at = excluded.updated_at`,
        )
        .bind(now, recipeId, householdId),
    ];
  }
  if ('notNow' in change && change.notNow) {
    const until = notNowEnd(new Date(now));
    return [
      db
        .prepare(
          `INSERT INTO recipe_preferences
             (recipe_id, household_id, favourite, not_now_until, updated_at)
           SELECT id, household_id, 0, ?, ?
             FROM recipes WHERE id = ? AND household_id = ?
           ON CONFLICT (recipe_id)
           DO UPDATE SET not_now_until = excluded.not_now_until,
                         updated_at = excluded.updated_at`,
        )
        .bind(until, now, recipeId, householdId),
    ];
  }
  // Clearing. The row goes when the other preference is absent or expired.
  const otherAbsent =
    'favourite' in change
      ? '(not_now_until IS NULL OR not_now_until <= ?)'
      : 'favourite = 0';
  const otherParams = 'favourite' in change ? [now] : [];
  const cleared =
    'favourite' in change ? 'favourite = 0' : 'not_now_until = NULL';
  return [
    db
      .prepare(
        `DELETE FROM recipe_preferences
          WHERE household_id = ? AND recipe_id = ? AND ${otherAbsent}`,
      )
      .bind(householdId, recipeId, ...otherParams),
    db
      .prepare(
        `UPDATE recipe_preferences SET ${cleared}, updated_at = ?
          WHERE household_id = ? AND recipe_id = ?`,
      )
      .bind(now, householdId, recipeId),
  ];
};

/**
 * Removes the household's expired "Not now" state: rows that held nothing
 * else are deleted, and a favourite keeps its row without the end time.
 */
const pruneStatements = (
  db: D1Database,
  householdId: string,
  now: string,
): D1PreparedStatement[] => [
  db
    .prepare(
      `DELETE FROM recipe_preferences
        WHERE household_id = ? AND favourite = 0 AND not_now_until <= ?`,
    )
    .bind(householdId, now),
  db
    .prepare(
      `UPDATE recipe_preferences SET not_now_until = NULL
        WHERE household_id = ? AND favourite = 1 AND not_now_until <= ?`,
    )
    .bind(householdId, now),
];

/**
 * Applies one change and returns the recipe's preferences, in one batch, so
 * the answer is the state the change produced. Concurrent changes are
 * last-write-wins; a preference is a switch, not content, and has no version.
 * A missing recipe and another household's recipe are answered alike, and
 * neither is written.
 */
export const setRecipePreference = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
  change: RecipePreferenceChange,
  now: Date,
): Promise<RecipePreferences> => {
  const timestamp = now.toISOString();
  const results = await db.batch([
    ...changeStatements(db, householdId, recipeId, change, timestamp),
    ...pruneStatements(db, householdId, timestamp),
    db
      .prepare(
        'SELECT COUNT(*) AS found FROM recipes WHERE household_id = ? AND id = ?',
      )
      .bind(householdId, recipeId),
    selectPreferences(db, householdId, recipeId),
  ]);
  const found = (results.at(-2)?.results as { found: number }[])[0]?.found;
  if (found !== 1) {
    throw new ApiError(404, 'not_found', 'That recipe no longer exists.');
  }
  return toPreferences((results.at(-1)?.results as PreferenceRow[])[0], now);
};
