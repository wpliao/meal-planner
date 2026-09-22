import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, type Notice } from './api';
import {
  cleanRecipeLine,
  recipeTextLength,
  RECIPE_INGREDIENT_MAX_LENGTH,
  RECIPE_STEP_MAX_LENGTH,
  validateRecipeIngredients,
  validateRecipeNotes,
  validateRecipeSteps,
  validateRecipeTitle,
  type Recipe,
  type RecipeConflictResponse,
  type RecipeContent,
  type RecipeResponse,
  type RecipeSource,
  type RecipeSourceInput,
  type RecipeSourceLabel,
  type RecipeTruncationNotice,
} from '../shared/recipes';

/**
 * What the recipe form starts from: empty for a new recipe, the saved recipe
 * when editing, or an extracted website draft when importing.
 */
export interface RecipeEditorDraft {
  title: string;
  ingredients: readonly string[];
  steps: readonly string[];
  notes?: string | null;
}

export type WebsiteSourceInput = Extract<
  RecipeSourceInput,
  { kind: 'website' }
>;

/**
 * Provenance an import preview hands the form. It is shown for review and sent
 * unchanged with the create request; the member cannot edit it.
 */
export interface RecipeImportContext {
  source: WebsiteSourceInput;
  /** Parts of the extracted draft that were cut to fit the recipe bounds. */
  notices: readonly RecipeTruncationNotice[];
}

export const EMPTY_RECIPE_DRAFT: RecipeEditorDraft = {
  title: '',
  ingredients: [''],
  steps: [''],
  notes: '',
};

export const draftFromRecipe = (recipe: Recipe): RecipeEditorDraft => ({
  title: recipe.title,
  ingredients: recipe.ingredients,
  steps: recipe.steps,
  notes: recipe.notes ?? '',
});

/** Keeps a text link at least as tall as the touch-target floor. */
export const touchLink = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--mp-touch-target)',
} as const;

export const RECIPES_BACK_LINK = { to: '/recipes', label: 'All recipes' };

// ---------------------------------------------------------------------------
// Results that outlive a route change

let pendingFlash: Notice = null;

/**
 * A result raised just before leaving a screen — "saved", "deleted" — for the
 * screen being entered to show. It is held in memory, not in history state,
 * so going back later does not replay an old message.
 */
export const setRecipeFlash = (notice: Notice): void => {
  pendingFlash = notice;
};

/**
 * Reads the pending result once per mounted screen. The state initializer only
 * peeks, because React may call it twice; the effect clears it.
 */
export const useRecipeFlash = () => {
  const notice = useState<Notice>(() => pendingFlash);
  useEffect(() => {
    pendingFlash = null;
  }, []);
  return notice;
};

// ---------------------------------------------------------------------------
// Loading one recipe

export type RecipeLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; recipe: Recipe }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

/**
 * Loads one recipe for a route. A missing ID and another household's ID look
 * the same, because the Worker answers both with the same 404.
 */
export const useRecipe = (id: string) => {
  const [state, setState] = useState<RecipeLoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await api<RecipeResponse>(
        `/api/recipes/${encodeURIComponent(id)}`,
      );
      setState({ kind: 'ready', recipe: response.recipe });
    } catch (error: unknown) {
      setState({ kind: isNotFound(error) ? 'not-found' : 'unavailable' });
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return { state, setState, load };
};

// ---------------------------------------------------------------------------
// Source presentation

/** The short list label: "Manual", or the host the text was copied from. */
export const sourceLabel = (
  source: RecipeSourceLabel | RecipeSource,
): string => (source.kind === 'manual' ? 'Manual' : source.host);

/**
 * The page the recipe text came from, only if it is an `https:` URL. The
 * Worker already enforces this; checking again means a bad stored value can
 * never become a `javascript:` or other active link.
 */
export const safeSourceHref = (
  source: RecipeSource | WebsiteSourceInput,
): string | null => {
  if (source.kind !== 'website') return null;
  const raw = source.resolvedUrl ?? source.submittedUrl;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** Host shown for an import draft, from the page its text was read from. */
export const importHost = (source: WebsiteSourceInput): string | null => {
  const href = safeSourceHref(source);
  return href ? new URL(href).hostname : null;
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const truncationMessage = (notice: RecipeTruncationNotice): string => {
  switch (notice.field) {
    case 'title':
      return 'The title was shortened to fit.';
    case 'ingredients':
      return `${plural(notice.count, 'ingredient line was', 'ingredient lines were')} left out because a recipe holds at most 100.`;
    case 'ingredientLines':
      return `${plural(notice.count, 'ingredient line was', 'ingredient lines were')} shortened to ${RECIPE_INGREDIENT_MAX_LENGTH} characters.`;
    case 'steps':
      return `${plural(notice.count, 'step was', 'steps were')} left out because a recipe holds at most 50.`;
    case 'stepLines':
      return `${plural(notice.count, 'step was', 'steps were')} shortened to ${RECIPE_STEP_MAX_LENGTH} characters.`;
  }
};

// ---------------------------------------------------------------------------
// Failures

/** The server's own message when there is one; otherwise the fallback. */
export const failureMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiRequestError ? error.message : fallback;

export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.status === 404;

/** The household's current recipe from a `409 stale_version`, if this is one. */
export const conflictFrom = (error: unknown): Recipe | null => {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const body = error.body as Partial<RecipeConflictResponse> | undefined;
  return body?.error?.code === 'stale_version' && body.current
    ? body.current
    : null;
};

/** Which parts of a member's draft differ from the current saved recipe. */
export const changedFields = (
  draft: RecipeContent,
  current: Recipe,
): string[] => {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((line, index) => line === b[index]);
  const changed: string[] = [];
  if (draft.title !== current.title) changed.push('title');
  if (!same(draft.ingredients, current.ingredients))
    changed.push('ingredients');
  if (!same(draft.steps, current.steps)) changed.push('steps');
  if ((draft.notes ?? null) !== (current.notes ?? null)) changed.push('notes');
  return changed;
};

// ---------------------------------------------------------------------------
// Form validation

export interface RecipeFormValues {
  title: string;
  ingredients: readonly string[];
  steps: readonly string[];
  notes: string;
}

export interface RecipeFormErrors {
  title?: string;
  notes?: string;
  ingredients?: string;
  steps?: string;
  /** Per visible line, keyed by its position in the form. */
  ingredientLines: Record<number, string>;
  stepLines: Record<number, string>;
}

/**
 * Line errors are placed on the line itself. The shared validator numbers
 * lines after blank ones are dropped, which would not match the form when a
 * blank line sits in between, so the position here is the visible one.
 */
const lineErrors = (
  lines: readonly string[],
  label: string,
  maxLength: number,
): Record<number, string> => {
  const errors: Record<number, string> = {};
  lines.forEach((line, index) => {
    const length = recipeTextLength(cleanRecipeLine(line));
    if (length > maxLength) {
      errors[index] =
        `${label} ${index + 1} is longer than ${maxLength} characters (it has ${length}).`;
    }
  });
  return errors;
};

/**
 * Validates the form with the same shared functions the Worker uses, so a
 * save the form accepts is one the server accepts too.
 */
export const validateRecipeForm = (
  values: RecipeFormValues,
):
  | { ok: true; content: RecipeContent }
  | { ok: false; errors: RecipeFormErrors } => {
  const title = validateRecipeTitle(values.title);
  const notes = validateRecipeNotes(values.notes);
  const ingredients = validateRecipeIngredients(values.ingredients);
  const steps = validateRecipeSteps(values.steps);

  const errors: RecipeFormErrors = {
    ingredientLines: lineErrors(
      values.ingredients,
      'Ingredient',
      RECIPE_INGREDIENT_MAX_LENGTH,
    ),
    stepLines: lineErrors(values.steps, 'Step', RECIPE_STEP_MAX_LENGTH),
  };
  if (!title.ok) errors.title = title.message;
  if (!notes.ok) errors.notes = notes.message;
  // A too-long line is already reported on that line.
  if (!ingredients.ok && Object.keys(errors.ingredientLines).length === 0) {
    errors.ingredients = ingredients.message;
  }
  if (!steps.ok && Object.keys(errors.stepLines).length === 0) {
    errors.steps = steps.message;
  }

  if (title.ok && notes.ok && ingredients.ok && steps.ok) {
    return {
      ok: true,
      content: {
        title: title.value,
        notes: notes.value,
        ingredients: ingredients.value,
        steps: steps.value,
      },
    };
  }
  return { ok: false, errors };
};
