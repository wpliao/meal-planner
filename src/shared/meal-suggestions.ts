/**
 * Runtime-neutral meal suggestions: the response contract, and the pure
 * matching and ranking the Worker runs for `GET /api/meal-plan/suggestions`
 * (the #73 design).
 *
 * Everything here is deterministic. The same pantry, recipes, plan, and meal
 * date always give the same suggestions in the same order, in any runtime:
 * text is compared by Unicode code points, never by locale collation.
 *
 * Household text is only ever compared. No regular expression is built from
 * it; the patterns below are fixed.
 */

import {
  planDayNumber,
  serverPlanWriteWindow,
  validatePlanDateInWindow,
  type MealPlanValidation,
} from './meal-plan';
import { normalizePantryName, type PantryStatus } from './pantry';

/** Suggestions returned for one meal. */
export const MEAL_SUGGESTION_LIMIT = 5;

/** Days either side of the meal's date that count as recently planned. */
export const MEAL_SUGGESTION_RECENT_DAYS = 14;

export type HeldPantryStatus = Exclude<PantryStatus, 'needed'>;

/**
 * One suggested recipe with the structured facts behind its reasons. The
 * client words them, so the wording can change without an API change.
 */
export interface MealSuggestion {
  recipeId: string;
  title: string;
  pantry: {
    /** Items at home that its ingredient lines mention, in name order. */
    held: { name: string; status: HeldPantryStatus }[];
    /** Items marked needed that its ingredient lines mention, in name order. */
    needed: string[];
  };
  /** The nearest planned date within the recent window, or null. */
  recent: string | null;
  /** The latest planned date before the meal's date, or null. */
  lastPlanned: string | null;
}

export interface MealSuggestionsResponse {
  suggestions: MealSuggestion[];
}

export interface SuggestionPantryItem {
  name: string;
  status: PantryStatus;
}

export interface SuggestionRecipe {
  id: string;
  title: string;
  ingredients: readonly string[];
}

/** A date a recipe is planned on. Unknown recipes and bad dates are ignored. */
export interface SuggestionPlannedDate {
  recipeId: string;
  date: string;
}

export interface MealSuggestionInput {
  /** The meal's date. */
  date: string;
  pantry: readonly SuggestionPantryItem[];
  recipes: readonly SuggestionRecipe[];
  /**
   * Dates each recipe is planned on. Any superset of "every date within the
   * recent window, plus the latest date before the meal's date" gives the
   * same result, which lets the Worker aggregate in SQL.
   */
  planned: readonly SuggestionPlannedDate[];
}

// ---------------------------------------------------------------------------
// Text

/**
 * Compares by Unicode code point, so every runtime agrees. Where both
 * strings hold the same UTF-16 unit, their code points there are equal too,
 * so the first difference found this way is the first code point difference.
 */
export const compareCodePoints = (a: string, b: string): number => {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.codePointAt(index) ?? 0;
    const right = b.codePointAt(index) ?? 0;
    if (left !== right) return left - right;
  }
  return a.length - b.length;
};

/** A word is a run of letters and digits; everything else separates words. */
const WORD = /[\p{L}\p{N}]+/gu;

/** Scripts written without spaces between words. */
const SPACELESS_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const wordsOf = (normalized: string): string[] => normalized.match(WORD) ?? [];

/**
 * Whether a line's word is `word` or a simple plural or singular of it:
 * `s` or `es` added, or a trailing `s` dropped.
 */
const isWordForm = (candidate: string, word: string): boolean =>
  candidate === word ||
  candidate === `${word}s` ||
  candidate === `${word}es` ||
  (word.length > 1 && word.endsWith('s') && candidate === word.slice(0, -1));

const wordForms = (word: string): string[] => {
  const forms = new Set([word, `${word}s`, `${word}es`]);
  if (word.length > 1 && word.endsWith('s')) forms.add(word.slice(0, -1));
  return [...forms];
};

interface WordName {
  item: number;
  words: string[];
}

interface SpacelessName {
  item: number;
  text: string;
}

interface PantryIndex {
  /** Word-matched names by the word a match must start with. */
  byFirstWord: Map<string, WordName[]>;
  /** Names in a script without spaces, matched as substrings. */
  spaceless: SpacelessName[];
}

const indexPantry = (pantry: readonly SuggestionPantryItem[]): PantryIndex => {
  const byFirstWord = new Map<string, WordName[]>();
  const spaceless: SpacelessName[] = [];
  pantry.forEach((entry, item) => {
    const text = normalizePantryName(entry.name);
    if (SPACELESS_SCRIPT.test(text)) {
      spaceless.push({ item, text });
      return;
    }
    const words = wordsOf(text);
    if (words.length === 0) return;
    // A one-word name may start a match in any of its forms; a longer name
    // starts with its first word exactly and varies only its last.
    const keys = words.length === 1 ? wordForms(words[0]) : [words[0]];
    for (const key of keys) {
      const names = byFirstWord.get(key);
      if (names) names.push({ item, words });
      else byFirstWord.set(key, [{ item, words }]);
    }
  });
  return { byFirstWord, spaceless };
};

/** Whether `words` appear in `lineWords` from `start`, consecutively. */
const matchesAt = (
  lineWords: readonly string[],
  start: number,
  words: readonly string[],
): boolean => {
  const last = words.length - 1;
  if (start + last >= lineWords.length) return false;
  for (let offset = 0; offset < last; offset += 1) {
    if (lineWords[start + offset] !== words[offset]) return false;
  }
  return isWordForm(lineWords[start + last], words[last]);
};

/** Adds every word-matched name that `lineWords` contain to `found`. */
const findWordNames = (
  lineWords: readonly string[],
  byFirstWord: PantryIndex['byFirstWord'],
  found: Set<number>,
): void => {
  for (let start = 0; start < lineWords.length; start += 1) {
    const names = byFirstWord.get(lineWords[start]);
    if (names === undefined) continue;
    for (const name of names) {
      if (!found.has(name.item) && matchesAt(lineWords, start, name.words)) {
        found.add(name.item);
      }
    }
  }
};

/** Adds every spaceless name that `line` contains to `found`. */
const findSpacelessNames = (
  line: string,
  spaceless: readonly SpacelessName[],
  found: Set<number>,
): void => {
  // The full clean-up, spacing included, runs only on the lines that need it.
  const text = normalizePantryName(line);
  for (const name of spaceless) {
    if (!found.has(name.item) && text.includes(name.text)) {
      found.add(name.item);
    }
  }
};

/**
 * Matches pantry names against ingredient lines. Names are indexed by the
 * word a match must start with, so each line is read once, word by word,
 * however large the pantry.
 */
const createPantryMatcher = (
  pantry: readonly SuggestionPantryItem[],
): ((lines: readonly string[]) => Set<number>) => {
  const { byFirstWord, spaceless } = indexPantry(pantry);
  return (lines) => {
    const found = new Set<number>();
    for (const line of lines) {
      if (found.size === pantry.length) break;
      // Words need only NFKC and lower case.
      const text = line.normalize('NFKC').toLowerCase();
      if (byFirstWord.size > 0)
        findWordNames(wordsOf(text), byFirstWord, found);
      if (spaceless.length > 0 && SPACELESS_SCRIPT.test(text)) {
        findSpacelessNames(line, spaceless, found);
      }
    }
    return found;
  };
};

/**
 * The pantry items that ingredient `lines` mention, in the pantry's order.
 * Text is compared in NFKC form and lower case. A name matches whole words,
 * consecutive and in order, and its last word may appear with `s` or `es`
 * added or a trailing `s` dropped. A name in Chinese, Japanese, or Korean
 * script matches anywhere inside a line (decision 2 of the #73 design).
 */
export const pantryMentions = <T extends SuggestionPantryItem>(
  lines: readonly string[],
  pantry: readonly T[],
): T[] => {
  const found = createPantryMatcher(pantry)(lines);
  return pantry.filter((_item, index) => found.has(index));
};

// ---------------------------------------------------------------------------
// Ranking

interface Ranked {
  suggestion: MealSuggestion;
  sortTitle: string;
}

interface PlanFacts {
  recent: string | null;
  recentDistance: number;
  lastPlanned: string | null;
}

const planFacts = (
  mealDay: number,
  planned: readonly SuggestionPlannedDate[],
): Map<string, PlanFacts> => {
  const facts = new Map<string, PlanFacts>();
  for (const { recipeId, date } of planned) {
    const day = planDayNumber(date);
    if (day === null) continue;
    let fact = facts.get(recipeId);
    if (!fact) {
      fact = { recent: null, recentDistance: Infinity, lastPlanned: null };
      facts.set(recipeId, fact);
    }
    const distance = Math.abs(day - mealDay);
    // The nearest date wins, and the earlier one on a tie.
    if (
      distance <= MEAL_SUGGESTION_RECENT_DAYS &&
      (distance < fact.recentDistance ||
        (distance === fact.recentDistance &&
          fact.recent !== null &&
          date < fact.recent))
    ) {
      fact.recent = date;
      fact.recentDistance = distance;
    }
    if (
      day < mealDay &&
      (fact.lastPlanned === null || date > fact.lastPlanned)
    ) {
      fact.lastPlanned = date;
    }
  }
  return facts;
};

const byName = (
  a: { key: string; name: string; index: number },
  b: { key: string; name: string; index: number },
): number =>
  compareCodePoints(a.key, b.key) ||
  compareCodePoints(a.name, b.name) ||
  a.index - b.index;

/**
 * Orders recipes by, in turn: more held pantry items (`available` or `low`)
 * mentioned; not planned within {@link MEAL_SUGGESTION_RECENT_DAYS} days
 * either side of the meal's date; least recently planned before it, never
 * planned first; title by code point; and recipe ID. Returns the first
 * `limit`.
 */
export const rankMealSuggestions = (
  input: MealSuggestionInput,
  limit: number = MEAL_SUGGESTION_LIMIT,
): MealSuggestion[] => {
  const mealDay = planDayNumber(input.date);
  if (mealDay === null) throw new RangeError('Not a valid plan date.');

  const matcher = createPantryMatcher(input.pantry);
  const facts = planFacts(mealDay, input.planned);
  const names = input.pantry.map((item, index) => ({
    key: normalizePantryName(item.name),
    name: item.name,
    index,
  }));

  const ranked: Ranked[] = input.recipes.map((recipe) => {
    const found = [...matcher(recipe.ingredients)]
      .map((index) => names[index])
      .sort(byName);
    const held: MealSuggestion['pantry']['held'] = [];
    const needed: string[] = [];
    for (const { index, name } of found) {
      const status = input.pantry[index].status;
      if (status === 'needed') needed.push(name);
      else held.push({ name, status });
    }
    const fact = facts.get(recipe.id);
    return {
      suggestion: {
        recipeId: recipe.id,
        title: recipe.title,
        pantry: { held, needed },
        recent: fact?.recent ?? null,
        lastPlanned: fact?.lastPlanned ?? null,
      },
      sortTitle: normalizePantryName(recipe.title),
    };
  });

  ranked.sort(
    (a, b) =>
      b.suggestion.pantry.held.length - a.suggestion.pantry.held.length ||
      Number(a.suggestion.recent !== null) -
        Number(b.suggestion.recent !== null) ||
      compareLastPlanned(a.suggestion.lastPlanned, b.suggestion.lastPlanned) ||
      compareCodePoints(a.sortTitle, b.sortTitle) ||
      compareCodePoints(a.suggestion.recipeId, b.suggestion.recipeId),
  );
  return ranked
    .slice(0, Math.max(0, limit))
    .map(({ suggestion }) => suggestion);
};

/** Never planned first, then the oldest date first. */
const compareLastPlanned = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
};

// ---------------------------------------------------------------------------
// Request

export interface ValidSuggestionQuery {
  date: string;
}

/**
 * Validates the query of `GET /api/meal-plan/suggestions`: `date` once and
 * nothing else, a real date inside the Worker's write window, since a
 * suggestion helps only for a date that can be planned.
 */
export const validateSuggestionQuery = (
  params: URLSearchParams,
  now: Date,
): MealPlanValidation<ValidSuggestionQuery> => {
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== 'date') {
    return {
      ok: false,
      errors: [
        { field: 'request', message: 'Provide date once, and nothing else.' },
      ],
    };
  }
  const date = validatePlanDateInWindow(
    params.get('date'),
    serverPlanWriteWindow(now),
  );
  return date.ok
    ? { ok: true, value: { date: date.value } }
    : { ok: false, errors: [{ field: 'date', message: date.message }] };
};
