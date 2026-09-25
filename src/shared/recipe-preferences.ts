/**
 * Runtime-neutral contract for a household's preferences about one recipe
 * (the #78 design): a family favourite, and "Not now", which leaves the
 * recipe out of meal suggestions for a while.
 *
 * The Worker validates every change with these functions. Preferences are the
 * household's, not a member's, and are not recipe content: a change never
 * touches the recipe or its version.
 */

import type { Recipe } from './recipes';

/** How long "Not now" leaves a recipe out of suggestions. */
export const RECIPE_NOT_NOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecipePreferences {
  favourite: boolean;
  /** When "Not now" ends, as an ISO instant; null when it is not in effect. */
  notNowUntil: string | null;
}

export const NO_RECIPE_PREFERENCES: Readonly<RecipePreferences> = {
  favourite: false,
  notNowUntil: null,
};

/** `GET /api/recipes/{id}`: the recipe and the household's preferences. */
export interface RecipeDetailResponse {
  recipe: Recipe;
  preferences: RecipePreferences;
}

export interface RecipePreferencesResponse {
  preferences: RecipePreferences;
}

/** Exactly one of the two: set or clear the favourite, or "Not now". */
export type RecipePreferenceChange =
  { favourite: boolean } | { notNow: boolean };

/** When "Not now" chosen at `now` ends. */
export const notNowEnd = (now: Date): string =>
  new Date(now.getTime() + RECIPE_NOT_NOW_DAYS * DAY_MS).toISOString();

/**
 * Whether a stored "Not now" end is still in effect at `now`. An end at or
 * before `now`, or one that is not a valid instant, has no effect.
 */
export const notNowActive = (until: string | null, now: Date): boolean => {
  if (until === null) return false;
  const end = Date.parse(until);
  return Number.isFinite(end) && end > now.getTime();
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validates a change: an object with exactly one field, `favourite` or
 * `notNow`, whose value is a boolean. Anything else is refused rather than
 * ignored.
 */
export const validateRecipePreferenceChange = (
  input: unknown,
):
  | { ok: true; value: RecipePreferenceChange }
  | { ok: false; message: string } => {
  const message = 'Send exactly one of favourite or notNow, as true or false.';
  if (!isPlainObject(input)) return { ok: false, message };
  const keys = Object.keys(input);
  if (keys.length !== 1) return { ok: false, message };
  const [key] = keys;
  const value = input[key];
  if (typeof value !== 'boolean') return { ok: false, message };
  if (key === 'favourite') return { ok: true, value: { favourite: value } };
  if (key === 'notNow') return { ok: true, value: { notNow: value } };
  return { ok: false, message };
};
