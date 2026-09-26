/**
 * Runtime-neutral contract for recipe nutrition (the #84 design): the label
 * panel's nutrients, the bundled USDA FoodData Central foods, a recipe's
 * confirmed ingredient matches, and the calculation.
 *
 * Every value is calculated here, from USDA values per 100 g and confirmed
 * grams (ADR 0009). Nothing a member or an AI supplies is a nutrient value.
 */

/** The NZ/AU label panel, in display order. Values are per 100 g. */
export const NUTRIENTS = [
  { key: 'energyKj', label: 'Energy', unit: 'kJ', sub: false },
  { key: 'proteinG', label: 'Protein', unit: 'g', sub: false },
  { key: 'fatG', label: 'Fat, total', unit: 'g', sub: false },
  { key: 'saturatedFatG', label: 'Saturated fat', unit: 'g', sub: true },
  { key: 'carbohydrateG', label: 'Carbohydrate', unit: 'g', sub: false },
  { key: 'sugarsG', label: 'Sugars', unit: 'g', sub: true },
  { key: 'fibreG', label: 'Dietary fibre', unit: 'g', sub: false },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', sub: false },
] as const;

export type NutrientKey = (typeof NUTRIENTS)[number]['key'];

/** Per 100 g; `null` where USDA reports no value (never zero). */
export type NutrientValues = Record<NutrientKey, number | null>;

export const NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENTS.map(
  (nutrient) => nutrient.key,
);

export const KJ_PER_KCAL = 4.184;

export type FoodDataType = 'foundation' | 'sr_legacy';

/** One USDA household measure: `amount` of `label` weighs `gramWeight`. */
export interface FoodPortion {
  seq: number;
  amount: number;
  label: string;
  gramWeight: number;
}

/** What converting an amount to grams needs to know about a food. */
export interface FoodMeasures {
  portions: FoodPortion[];
  /** The portion whose volume gives the food's density, or null. */
  volumeSeq: number | null;
}

/** A food as the search and the review list show it. */
export interface FoodChoice extends FoodMeasures {
  fdcId: number;
  name: string;
  category: string;
  dataType: FoodDataType;
}

export interface FoodSearchResponse {
  foods: FoodChoice[];
}

export const FOOD_SEARCH_LIMIT = 20;
export const FOOD_QUERY_MIN_LENGTH = 2;
export const FOOD_QUERY_MAX_LENGTH = 60;

/** The page for a food on FoodData Central. */
export const fdcFoodUrl = (fdcId: number): string =>
  `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`;

export const USDA_CITATION =
  'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.';

// ---------------------------------------------------------------------------
// Amounts

/** Kitchen measures a recipe uses, in NZ metric sizes. */
export const METRIC_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

const GRAMS_PER_UNIT: Partial<Record<MetricUnit, number>> = { g: 1, kg: 1000 };

/** NZ metric measures: a 250 ml cup, a 15 ml tablespoon, a 5 ml teaspoon. */
export const MILLILITRES_PER_UNIT: Partial<Record<MetricUnit, number>> = {
  ml: 1,
  l: 1000,
  tsp: 5,
  tbsp: 15,
  cup: 250,
};

/** A metric unit, or one of the food's USDA portions by its sequence number. */
export type MatchUnit = MetricUnit | `portion:${number}`;

export const MAX_MATCH_QUANTITY = 10_000;
export const MAX_MATCH_GRAMS = 10_000;

const US_VOLUMES: readonly [RegExp, number][] = [
  [/^cups?\b/u, 236.588],
  [/^(?:tbsp|tablespoons?)\b/u, 14.787],
  [/^(?:tsp|teaspoons?)\b/u, 4.929],
  [/^fl\.? ?oz\b/u, 29.574],
  [/^(?:ml|millilit(?:er|re)s?)\b/u, 1],
  [/^(?:l|lit(?:er|re)s?)\b/u, 1000],
  [/^quarts?\b/u, 946.353],
  [/^pints?\b/u, 473.176],
];

/**
 * The volume in millilitres of one USDA portion unit, from its label ("cup,
 * chopped", "tbsp", "fl oz"), or null when the label is not a volume. USDA
 * measures are US sizes.
 */
export const usVolumeMillilitres = (label: string): number | null => {
  const text = label.trim().toLowerCase();
  for (const [pattern, millilitres] of US_VOLUMES) {
    if (pattern.test(text)) return millilitres;
  }
  return null;
};

const portionSeq = (unit: string): number | null => {
  const match = /^portion:([1-9]\d{0,3})$/u.exec(unit);
  return match ? Number(match[1]) : null;
};

export const isMatchUnit = (unit: unknown): unit is MatchUnit =>
  typeof unit === 'string' &&
  ((METRIC_UNITS as readonly string[]).includes(unit) ||
    portionSeq(unit) !== null);

/** The food's grams per millilitre, from its volume portion, or null. */
export const gramsPerMillilitre = (food: FoodMeasures): number | null => {
  const portion = food.portions.find((entry) => entry.seq === food.volumeSeq);
  if (!portion) return null;
  const millilitres = usVolumeMillilitres(portion.label);
  if (millilitres === null) return null;
  return portion.gramWeight / (portion.amount * millilitres);
};

const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Converts a quantity of a unit of `food` to grams, rounded to 0.1 g, or
 * returns null when it can't: a volume for a food with no volume portion, or
 * a portion the food doesn't have.
 */
export const toGrams = (
  quantity: number,
  unit: MatchUnit,
  food: FoodMeasures,
): number | null => {
  const seq = portionSeq(unit);
  if (seq !== null) {
    const portion = food.portions.find((entry) => entry.seq === seq);
    return portion
      ? roundTo((quantity * portion.gramWeight) / portion.amount, 1)
      : null;
  }
  const mass = GRAMS_PER_UNIT[unit as MetricUnit];
  if (mass !== undefined) return roundTo(quantity * mass, 1);
  const millilitres = MILLILITRES_PER_UNIT[unit as MetricUnit];
  const density = gramsPerMillilitre(food);
  if (millilitres === undefined || density === null) return null;
  return roundTo(quantity * millilitres * density, 1);
};

/** How a unit reads in a list: "tbsp", or "cup, chopped (US, 160 g)". */
export const unitLabel = (unit: MatchUnit, food: FoodMeasures): string => {
  const seq = portionSeq(unit);
  if (seq === null) return unit;
  const portion = food.portions.find((entry) => entry.seq === seq);
  if (!portion) return unit;
  const each = roundTo(portion.gramWeight / portion.amount, 1);
  return `${portion.label} (${each} g each)`;
};

/** The units offered for a food: mass always, volume if it has a density. */
export const unitsFor = (food: FoodMeasures): MatchUnit[] => {
  const metric = METRIC_UNITS.filter(
    (unit) =>
      GRAMS_PER_UNIT[unit] !== undefined || gramsPerMillilitre(food) !== null,
  );
  const portions = food.portions.map(
    (portion): MatchUnit => `portion:${portion.seq}`,
  );
  return [...metric, ...portions];
};

// ---------------------------------------------------------------------------
// A recipe's nutrition

/**
 * A line's state: `counted` (a current match to a food), `not_counted` (a
 * current match marked "Don't count"), `unchecked` (no match), or `changed`
 * (a match saved for text the line no longer has).
 */
export type NutritionLineState =
  'counted' | 'not_counted' | 'unchecked' | 'changed';

export interface NutritionLineMatch {
  /** The food, with its measures, so the review can change the amount. */
  food: FoodChoice;
  quantity: number;
  unit: MatchUnit;
  unitLabel: string;
  grams: number;
}

export interface NutritionLine {
  position: number;
  text: string;
  state: NutritionLineState;
  /** The food and amount, for a counted line. */
  match: NutritionLineMatch | null;
}

/** A total, and the counted foods that report no value for it. */
export interface NutrientAmount {
  value: number | null;
  missingFrom: string[];
}

export interface NutritionSource {
  fdcId: number;
  name: string;
  dataType: FoodDataType;
  release: string;
  url: string;
}

export interface RecipeNutrition {
  recipeVersion: number;
  servings: number | null;
  lines: NutritionLine[];
  /** Whether any match was ever saved for this recipe. */
  checked: boolean;
  /** Lines that are `unchecked` or `changed`, once the recipe was checked. */
  needsCheck: number;
  counted: number;
  /** Whole-recipe totals; null when nothing is counted. */
  totals: Record<NutrientKey, NutrientAmount> | null;
  /** Totals divided by servings; null without servings or counted lines. */
  perServing: Record<NutrientKey, number | null> | null;
  sources: NutritionSource[];
}

export interface RecipeNutritionResponse {
  nutrition: RecipeNutrition;
}

/** A counted line's food values and grams, for the calculation. */
export interface CountedFood {
  name: string;
  grams: number;
  per100g: NutrientValues;
}

/**
 * Sums each nutrient over the counted foods: `per100g × grams / 100`. A food
 * with no value for a nutrient adds nothing to it and is named in
 * `missingFrom`. A nutrient no counted food reports is null. Values are
 * unrounded; the screen rounds them once, for display.
 */
export const calculateTotals = (
  counted: readonly CountedFood[],
): Record<NutrientKey, NutrientAmount> | null => {
  if (counted.length === 0) return null;
  const totals = {} as Record<NutrientKey, NutrientAmount>;
  for (const key of NUTRIENT_KEYS) {
    let value: number | null = null;
    const missingFrom: string[] = [];
    for (const food of counted) {
      const per100g = food.per100g[key];
      if (per100g === null) {
        if (!missingFrom.includes(food.name)) missingFrom.push(food.name);
      } else {
        value = (value ?? 0) + (per100g * food.grams) / 100;
      }
    }
    totals[key] = { value, missingFrom };
  }
  return totals;
};

export const perServing = (
  totals: Record<NutrientKey, NutrientAmount> | null,
  servings: number | null,
): Record<NutrientKey, number | null> | null => {
  if (totals === null || servings === null) return null;
  const values = {} as Record<NutrientKey, number | null>;
  for (const key of NUTRIENT_KEYS) {
    const total = totals[key].value;
    values[key] = total === null ? null : total / servings;
  }
  return values;
};

/** Energy in kJ as kcal, for the label's "(kcal)". */
export const kilocalories = (kilojoules: number): number =>
  kilojoules / KJ_PER_KCAL;

/** A food with its values, as the Worker reads it from the reference data. */
export interface NutritionFood extends FoodChoice {
  release: string;
  per100g: NutrientValues;
}

/** A saved match, as stored. */
export interface StoredMatch {
  position: number;
  lineText: string;
  fdcId: number | null;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
}

export interface NutritionInput {
  recipeVersion: number;
  servings: number | null;
  lines: readonly { position: number; text: string }[];
  matches: readonly StoredMatch[];
  foods: ReadonlyMap<number, NutritionFood>;
}

const lineState = (
  text: string,
  match: StoredMatch | undefined,
  foods: ReadonlyMap<number, NutritionFood>,
): { state: NutritionLineState; food: NutritionFood | null } => {
  if (match === undefined) return { state: 'unchecked', food: null };
  if (match.lineText !== text) return { state: 'changed', food: null };
  if (match.fdcId === null) return { state: 'not_counted', food: null };
  const food = foods.get(match.fdcId);
  // A food missing from the loaded dataset can't be counted: check it again.
  return food ? { state: 'counted', food } : { state: 'unchecked', food: null };
};

/**
 * A recipe's nutrition from its current lines and saved matches. A match
 * counts only while its line still has exactly the text it was confirmed
 * for; a match whose line changed, moved, or was removed counts for nothing.
 */
export const buildRecipeNutrition = (
  input: NutritionInput,
): RecipeNutrition => {
  const byPosition = new Map(
    input.matches.map((match) => [match.position, match]),
  );
  const counted: CountedFood[] = [];
  const sources = new Map<number, NutritionSource>();
  const lines = input.lines.map((line): NutritionLine => {
    const match = byPosition.get(line.position);
    const { state, food } = lineState(line.text, match, input.foods);
    if (state !== 'counted' || !food || !match) {
      return { position: line.position, text: line.text, state, match: null };
    }
    const grams = match.grams ?? 0;
    const unit = match.unit as MatchUnit;
    counted.push({ name: food.name, grams, per100g: food.per100g });
    if (!sources.has(food.fdcId)) {
      sources.set(food.fdcId, {
        fdcId: food.fdcId,
        name: food.name,
        dataType: food.dataType,
        release: food.release,
        url: fdcFoodUrl(food.fdcId),
      });
    }
    return {
      position: line.position,
      text: line.text,
      state,
      match: {
        food: {
          fdcId: food.fdcId,
          name: food.name,
          category: food.category,
          dataType: food.dataType,
          portions: food.portions,
          volumeSeq: food.volumeSeq,
        },
        quantity: match.quantity ?? 0,
        unit,
        unitLabel: unitLabel(unit, food),
        grams,
      },
    };
  });
  const checked = input.matches.length > 0;
  const totals = calculateTotals(counted);
  return {
    recipeVersion: input.recipeVersion,
    servings: input.servings,
    lines,
    checked,
    needsCheck: checked
      ? lines.filter(
          (line) => line.state === 'unchecked' || line.state === 'changed',
        ).length
      : 0,
    counted: counted.length,
    totals,
    perServing: perServing(totals, input.servings),
    sources: [...sources.values()],
  };
};

// ---------------------------------------------------------------------------
// Saving matches

export interface NutritionMatchInput {
  position: number;
  /** The ingredient line exactly as the member saw it. */
  line: string;
  /** Null marks the line "Don't count". */
  fdcId: number | null;
  quantity?: number;
  unit?: MatchUnit;
}

export interface SaveNutritionMatchesRequest {
  /** The recipe version the member reviewed. */
  recipeVersion: number;
  matches: NutritionMatchInput[];
}

export type ValidNutritionMatch =
  | { position: number; line: string; fdcId: null }
  | {
      position: number;
      line: string;
      fdcId: number;
      quantity: number;
      unit: MatchUnit;
    };

export interface ValidSaveNutritionMatches {
  recipeVersion: number;
  matches: ValidNutritionMatch[];
}

const MAX_LINES = 100;
const MAX_LINE_LENGTH = 300;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isPositiveInteger = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;

const codePointLength = (value: string): number => [...value].length;

const MATCH_FIELDS = new Set(['position', 'line', 'fdcId', 'quantity', 'unit']);

const validateMatch = (
  input: unknown,
): ValidNutritionMatch | { error: string } => {
  if (!isPlainObject(input)) return { error: 'Send each match as an object.' };
  if (Object.keys(input).some((key) => !MATCH_FIELDS.has(key))) {
    return { error: 'A match has an unexpected field.' };
  }
  const { position, line, fdcId, quantity, unit } = input;
  if (!isPositiveInteger(position, MAX_LINES)) {
    return { error: 'Each position must be a whole number from 1 to 100.' };
  }
  if (
    typeof line !== 'string' ||
    codePointLength(line) < 1 ||
    codePointLength(line) > MAX_LINE_LENGTH
  ) {
    return { error: 'Each match needs its ingredient line.' };
  }
  if (fdcId === null) {
    if (quantity !== undefined || unit !== undefined) {
      return { error: 'A line that is not counted has no amount.' };
    }
    return { position, line, fdcId: null };
  }
  if (!isPositiveInteger(fdcId, Number.MAX_SAFE_INTEGER)) {
    return { error: 'Choose a food for each counted line.' };
  }
  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > MAX_MATCH_QUANTITY
  ) {
    return {
      error: `Each amount must be above 0 and at most ${MAX_MATCH_QUANTITY}.`,
    };
  }
  if (!isMatchUnit(unit)) return { error: 'Choose a unit for each amount.' };
  return { position, line, fdcId, quantity, unit };
};

/**
 * Validates a save: the recipe version, and 1–100 matches with distinct
 * positions. Each counted match names a food and a positive amount in a
 * known unit; a "Don't count" match has neither. Unknown fields are refused.
 * Whether the food exists and the unit converts is the Worker's check.
 */
export const validateSaveNutritionMatches = (
  input: unknown,
):
  | { ok: true; value: ValidSaveNutritionMatches }
  | { ok: false; message: string } => {
  if (!isPlainObject(input)) {
    return { ok: false, message: 'Send recipeVersion and matches.' };
  }
  const keys = Object.keys(input);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(input, 'recipeVersion') ||
    !Object.hasOwn(input, 'matches')
  ) {
    return { ok: false, message: 'Send exactly recipeVersion and matches.' };
  }
  const { recipeVersion, matches } = input;
  if (!isPositiveInteger(recipeVersion, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, message: 'recipeVersion must be a positive integer.' };
  }
  if (
    !Array.isArray(matches) ||
    matches.length < 1 ||
    matches.length > MAX_LINES
  ) {
    return { ok: false, message: 'Send from 1 to 100 matches.' };
  }
  const valid: ValidNutritionMatch[] = [];
  const positions = new Set<number>();
  for (const entry of matches) {
    const match = validateMatch(entry);
    if ('error' in match) return { ok: false, message: match.error };
    if (positions.has(match.position)) {
      return { ok: false, message: 'Each position may appear once.' };
    }
    positions.add(match.position);
    valid.push(match);
  }
  return { ok: true, value: { recipeVersion, matches: valid } };
};

// ---------------------------------------------------------------------------
// Food search

const WORD = /[\p{L}\p{N}]+/gu;
const MAX_QUERY_WORDS = 6;

/**
 * Validates a search query and turns it into an FTS5 query: its words, in
 * lower case, each as a quoted prefix, all required. Everything that is not a
 * letter or digit separates words, so no FTS5 syntax can reach the index.
 * Returns null for a query outside 2–60 code points or without a word.
 */
export const foodSearchQuery = (query: unknown): string | null => {
  if (typeof query !== 'string') return null;
  const text = query.trim();
  const length = codePointLength(text);
  if (length < FOOD_QUERY_MIN_LENGTH || length > FOOD_QUERY_MAX_LENGTH) {
    return null;
  }
  const words = (text.normalize('NFKC').toLowerCase().match(WORD) ?? []).slice(
    0,
    MAX_QUERY_WORDS,
  );
  if (words.length === 0) return null;
  return words.map((word) => `"${word}"*`).join(' ');
};
