import { api, jsonMutation } from './api';
import {
  kilocalories,
  MAX_MATCH_GRAMS,
  MAX_MATCH_QUANTITY,
  toGrams,
  type FoodChoice,
  type IngredientProposal,
  type MatchUnit,
  type NutrientKey,
  type NutritionLine,
  type NutritionMatchInput,
  type RecipeNutrition,
  type RecipeNutritionResponse,
  type NutritionProposalsResponse,
} from '../shared/nutrition';

/** Reads a recipe's nutrition on its own, after a save was refused. */
export const fetchNutrition = async (
  recipeId: string,
): Promise<RecipeNutrition> =>
  (
    await api<RecipeNutritionResponse>(
      `/api/recipes/${encodeURIComponent(recipeId)}/nutrition`,
    )
  ).nutrition;

export const fetchProposals = async (
  recipeId: string,
  recipeVersion: number,
  positions: number[],
): Promise<NutritionProposalsResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  try {
    return await api<NutritionProposalsResponse>(
      `/api/recipes/${encodeURIComponent(recipeId)}/nutrition/proposals`,
      {
        ...jsonMutation('POST', { recipeVersion, positions }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Display

const NUMBER = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 0 });
const ONE_PLACE = new Intl.NumberFormat('en-NZ', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * One value as the label shows it: energy in kJ with kcal, grams with one
 * decimal place under 10 g, milligrams whole. USDA's carbohydrate "by
 * difference" can be slightly negative; a total below zero shows as zero.
 */
export const formatNutrient = (key: NutrientKey, value: number): string => {
  const shown = Math.max(0, value);
  if (key === 'energyKj') {
    return `${NUMBER.format(shown)} kJ (${NUMBER.format(kilocalories(shown))} kcal)`;
  }
  if (key === 'sodiumMg') return `${NUMBER.format(shown)} mg`;
  return `${shown < 10 ? ONE_PLACE.format(shown) : NUMBER.format(shown)} g`;
};

export const DATA_TYPE_NAMES = {
  sr_legacy: 'SR Legacy',
  foundation: 'Foundation Foods',
} as const;

// ---------------------------------------------------------------------------
// The review

/** One line being checked in the review. */
export interface ReviewLine {
  position: number;
  text: string;
  food: FoodChoice | null;
  /** As typed. */
  quantity: string;
  unit: MatchUnit;
  dontCount: boolean;
}

/** Which lines a review shows: all of them, or those that need a check. */
export type ReviewMode = 'all' | 'changed';

export const needsCheck = (line: NutritionLine): boolean =>
  line.state === 'unchecked' || line.state === 'changed';

export const reviewLines = (
  nutrition: RecipeNutrition,
  mode: ReviewMode,
): ReviewLine[] =>
  nutrition.lines
    .filter((line) => mode === 'all' || needsCheck(line))
    .map((line) => ({
      position: line.position,
      text: line.text,
      food: line.match?.food ?? null,
      quantity: line.match ? String(line.match.quantity) : '',
      unit: line.match?.unit ?? 'g',
      dontCount: line.state === 'not_counted',
    }));

/** Only proposals for current review lines are used; the review still confirms them. */
export const withProposals = (
  lines: ReviewLine[],
  proposals: readonly IngredientProposal[],
): ReviewLine[] =>
  lines.map((line) => {
    const proposal = proposals.find((item) => item.position === line.position);
    if (!proposal?.food || !proposal.quantity || !proposal.unit) return line;
    return {
      ...line,
      food: proposal.food,
      quantity: String(proposal.quantity),
      unit: proposal.unit,
      dontCount: false,
    };
  });

/**
 * A decimal amount as typed ("1.5" or "1,5"), above 0 and at most the
 * Worker's bound, else null.
 */
export const parseQuantity = (typed: string): number | null => {
  const text = typed.trim().replace(',', '.');
  if (!/^\d{1,5}(?:\.\d{1,3})?$/u.test(text)) return null;
  const value = Number(text);
  return value > 0 && value <= MAX_MATCH_QUANTITY ? value : null;
};

/** The line's grams, or null while it has no food or no usable amount. */
export const reviewGrams = (line: ReviewLine): number | null => {
  const quantity = parseQuantity(line.quantity);
  if (!line.food || quantity === null) return null;
  const grams = toGrams(quantity, line.unit, line.food);
  return grams !== null && grams > 0 && grams <= MAX_MATCH_GRAMS ? grams : null;
};

export const isLineReady = (line: ReviewLine): boolean =>
  line.dontCount || reviewGrams(line) !== null;

export const toMatchInput = (line: ReviewLine): NutritionMatchInput => {
  if (line.dontCount || !line.food) {
    return { position: line.position, line: line.text, fdcId: null };
  }
  return {
    position: line.position,
    line: line.text,
    fdcId: line.food.fdcId,
    quantity: parseQuantity(line.quantity) ?? 0,
    unit: line.unit,
  };
};
