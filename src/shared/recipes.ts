/**
 * Runtime-neutral recipe contracts, bounds, and plain-text normalization.
 *
 * The Worker validates every request with these functions; the client uses the
 * same functions to validate a form before sending it, and the website import
 * adapter uses the truncation helper to fit an extracted draft into the same
 * bounds. The migrations `0003_create_recipes.sql` and
 * `0007_add_recipe_link.sql` enforce the storage bounds with CHECK constraints
 * that must stay in step with these constants.
 *
 * Lengths are counted in Unicode code points, which is what SQLite `length()`
 * counts for TEXT, so a value that passes here also passes the database CHECK.
 */

export const RECIPE_TITLE_MAX_LENGTH = 120;
export const RECIPE_INGREDIENTS_MAX = 100;
export const RECIPE_INGREDIENT_MAX_LENGTH = 300;
export const RECIPE_STEPS_MAX = 50;
export const RECIPE_STEP_MAX_LENGTH = 2000;
export const RECIPE_NOTES_MAX_LENGTH = 4000;
export const RECIPE_SOURCE_URL_MAX_LENGTH = 2048;
export const RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH = 200;

/** Bounds list size and storage cost for one household, like the pantry. */
export const RECIPE_LIMIT = 500;

/** Servings a recipe may record (#84); unset is allowed. */
export const RECIPE_SERVINGS_MIN = 1;
export const RECIPE_SERVINGS_MAX = 50;

/**
 * Reviewed exact-host allowlist from the accepted #31 design. Hostnames are
 * matched exactly after WHATWG URL parsing; there is no suffix matching.
 */
export const RECIPE_IMPORT_HOSTS: readonly string[] = [
  'budgetbytes.com',
  'www.budgetbytes.com',
  'minimalistbaker.com',
  'www.minimalistbaker.com',
  'sallysbakingaddiction.com',
  'www.sallysbakingaddiction.com',
  'justonecookbook.com',
  'www.justonecookbook.com',
  'thewoksoflife.com',
  'www.thewoksoflife.com',
  'kikkoman.co.jp',
  'www.kikkoman.co.jp',
  'recipetineats.com',
  'www.recipetineats.com',
];

export type RecipeSourceKind = 'manual' | 'website';

export type RecipeSource =
  | { kind: 'manual' }
  | {
      kind: 'website';
      /** The URL the member submitted, without its fragment. */
      submittedUrl: string;
      /** The final URL after redirects, or null when it equals submittedUrl. */
      resolvedUrl: string | null;
      /** Host of the page the recipe text was read from. */
      host: string;
      pageTitle: string | null;
      /** Server-assigned time the imported copy was saved. */
      importedAt: string;
    };

/**
 * The short label shown in the library list. A manual recipe carries the host
 * of its recipe link (#113), or null when it has none.
 */
export type RecipeSourceLabel =
  | { kind: 'manual'; linkHost: string | null }
  | { kind: 'website'; host: string };

export interface RecipeSummary {
  id: string;
  title: string;
  source: RecipeSourceLabel;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe {
  id: string;
  title: string;
  notes: string | null;
  /** Ordered, unstructured plain-text lines. */
  ingredients: string[];
  /** Ordered plain-text steps. */
  steps: string[];
  /** How many servings the recipe makes, or null when not set. */
  servings: number | null;
  /**
   * The page a manually entered recipe comes from (#113), or null. Stored and
   * shown, never fetched. Always null for an imported recipe, whose page is
   * in its source.
   */
  link: string | null;
  source: RecipeSource;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipesResponse {
  recipes: RecipeSummary[];
}

export interface RecipeResponse {
  recipe: Recipe;
}

/** Source metadata a client may supply when saving a new recipe. */
export type RecipeSourceInput =
  | { kind: 'manual' }
  | {
      kind: 'website';
      submittedUrl: string;
      resolvedUrl?: string | null;
      pageTitle?: string | null;
    };

export interface CreateRecipeRequest {
  title: string;
  notes?: string | null;
  ingredients: string[];
  steps: string[];
  /** Omitted means not set. */
  servings?: number | null;
  /** Manual recipes only; omitted, null, or blank means no link. */
  link?: string | null;
  /** Omitted means manual entry. */
  source?: RecipeSourceInput;
  /**
   * Website sources only (#116): save nothing, and answer `409
   * duplicate_source`, when a website recipe in the household already has
   * this submitted or resolved address. Omitted means a copy is always saved.
   */
  onlyIfNewSource?: true;
}

/**
 * Update requires the version the member edited plus at least one field. A
 * supplied ingredient or step list replaces the whole ordered list. Source
 * provenance cannot be changed after creation; only a manual recipe takes a
 * link.
 */
export interface UpdateRecipeRequest {
  version: number;
  title?: string;
  notes?: string | null;
  ingredients?: string[];
  steps?: string[];
  servings?: number | null;
  link?: string | null;
}

export interface DeleteRecipeRequest {
  version: number;
}

/**
 * Body of a `409 duplicate_source` response (#116): the household's recipe
 * that already came from the same address.
 */
export interface RecipeDuplicateSourceResponse {
  error: { code: 'duplicate_source'; message: string };
  existing: { id: string; title: string };
}

/**
 * Body of a `409 stale_version` response for a recipe update or delete. It
 * carries the household's current recipe so the client can offer comparison
 * before a new save.
 */
export interface RecipeConflictResponse {
  error: { code: 'stale_version'; message: string };
  current: Recipe;
}

export type RecipeField =
  | 'request'
  | 'title'
  | 'notes'
  | 'ingredients'
  | 'steps'
  | 'servings'
  | 'link'
  | 'source'
  | 'onlyIfNewSource'
  | 'version';

export interface RecipeFieldError {
  field: RecipeField;
  message: string;
}

export type RecipeValidation<T> =
  { ok: true; value: T } | { ok: false; errors: RecipeFieldError[] };

/** Normalized content fields shared by create and a complete edit. */
export interface RecipeContent {
  title: string;
  notes: string | null;
  ingredients: string[];
  steps: string[];
  servings: number | null;
  link: string | null;
}

export type ValidRecipeSource =
  | { kind: 'manual' }
  | {
      kind: 'website';
      submittedUrl: string;
      resolvedUrl: string | null;
      host: string;
      pageTitle: string | null;
    };

export interface ValidCreateRecipe extends RecipeContent {
  source: ValidRecipeSource;
  /** True only for a website source whose address must be new (#116). */
  onlyIfNewSource: boolean;
}

export interface ValidUpdateRecipe {
  version: number;
  title?: string;
  notes?: string | null;
  ingredients?: string[];
  steps?: string[];
  servings?: number | null;
  link?: string | null;
}

// ---------------------------------------------------------------------------
// Plain-text normalization

// Line separators folded to "\n" in notes and to a space elsewhere: LF, VT,
// FF, CR, NEL, LINE SEPARATOR, and PARAGRAPH SEPARATOR.
const LINE_BREAK_CODE_POINTS = new Set([
  0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029,
]);

const isSurrogate = (codePoint: number): boolean =>
  codePoint >= 0xd800 && codePoint <= 0xdfff;

const isControl = (codePoint: number): boolean =>
  codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);

/**
 * Removes unpaired surrogates (JSON can carry them; no text can display them)
 * and C0/C1 control characters. Tabs become spaces and line separators become
 * "\n" or a space. The result is in NFC form, which keeps the family's
 * spelling and full-width characters, unlike the pantry's NFKC duplicate key.
 */
const toPlainText = (value: string, keepLineBreaks: boolean): string => {
  const kept: string[] = [];
  for (const character of value.replaceAll('\r\n', '\n')) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (LINE_BREAK_CODE_POINTS.has(codePoint)) {
      kept.push(keepLineBreaks ? '\n' : ' ');
    } else if (codePoint === 0x09) {
      kept.push(' ');
    } else if (!isSurrogate(codePoint) && !isControl(codePoint)) {
      kept.push(character);
    }
  }
  return kept.join('').normalize('NFC');
};

/**
 * One-line plain text: controls removed, every whitespace run collapsed to one
 * space, and the ends trimmed. Used for titles, ingredient lines, steps, and
 * the source page title.
 */
export const cleanRecipeLine = (value: string): string =>
  toPlainText(value, false).replace(/\s+/gu, ' ').trim();

/**
 * Multi-line notes: like {@link cleanRecipeLine}, but line breaks are kept.
 * Each line is collapsed and trimmed, and at most one blank line separates
 * paragraphs.
 */
export const cleanRecipeNotes = (value: string): string =>
  toPlainText(value, true)
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

/** Cleans every line and drops the ones that become empty. */
export const cleanRecipeLines = (values: readonly string[]): string[] =>
  values.map(cleanRecipeLine).filter((line) => line.length > 0);

/** Length in Unicode code points, matching SQLite `length()` on TEXT. */
export const recipeTextLength = (value: string): number =>
  Array.from(value).length;

/** Cuts at a code-point boundary, never inside a surrogate pair. */
export const truncateRecipeText = (value: string, maxLength: number): string =>
  recipeTextLength(value) <= maxLength
    ? value
    : Array.from(value).slice(0, maxLength).join('').trim();

// ---------------------------------------------------------------------------
// Source URL policy

export type RecipeUrlProblem = 'malformed' | 'too_long' | 'not_allowed';

/**
 * Parses a recipe source URL under the accepted destination policy: WHATWG
 * parse, `https:`, no credentials, default port, and a hostname exactly equal
 * to an allowlisted entry. The fragment is removed. Returns the normalized URL
 * or the reason it is refused.
 */
export const parseRecipeSourceUrl = (
  value: string,
): { ok: true; url: URL } | { ok: false; problem: RecipeUrlProblem } => {
  const parsed = parseRecipeLinkUrl(value);
  if (parsed.ok && !isAllowedRecipeHost(parsed.url.hostname)) {
    return { ok: false, problem: 'not_allowed' };
  }
  return parsed;
};

/**
 * Parses a manual recipe's link (#113) under the same structural rules as an
 * import source, but from any host: the Worker stores the link and never
 * fetches it, so the import allowlist does not apply.
 */
export const parseRecipeLinkUrl = (
  value: string,
): { ok: true; url: URL } | { ok: false; problem: RecipeUrlProblem } => {
  if (recipeTextLength(value) > RECIPE_SOURCE_URL_MAX_LENGTH) {
    return { ok: false, problem: 'too_long' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, problem: 'malformed' };
  }
  url.hash = '';
  if (url.href.length > RECIPE_SOURCE_URL_MAX_LENGTH) {
    return { ok: false, problem: 'too_long' };
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return { ok: false, problem: 'not_allowed' };
  }
  return { ok: true, url };
};

export const isAllowedRecipeHost = (hostname: string): boolean =>
  RECIPE_IMPORT_HOSTS.includes(hostname);

// ---------------------------------------------------------------------------
// Field validation

type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({
  ok: false,
  message,
});

export const validateRecipeTitle = (value: unknown): FieldResult<string> => {
  if (typeof value !== 'string') return fail('Title must be text.');
  const title = cleanRecipeLine(value);
  const length = recipeTextLength(title);
  if (length < 1 || length > RECIPE_TITLE_MAX_LENGTH) {
    return fail(
      `Enter a title between 1 and ${RECIPE_TITLE_MAX_LENGTH} characters.`,
    );
  }
  return { ok: true, value: title };
};

/** Empty or whitespace-only notes are stored as no notes. */
export const validateRecipeNotes = (
  value: unknown,
): FieldResult<string | null> => {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('Notes must be text.');
  const notes = cleanRecipeNotes(value);
  if (recipeTextLength(notes) > RECIPE_NOTES_MAX_LENGTH) {
    return fail(
      `Keep notes to ${RECIPE_NOTES_MAX_LENGTH} characters or fewer.`,
    );
  }
  return { ok: true, value: notes.length > 0 ? notes : null };
};

const validateLines = (
  value: unknown,
  label: { one: string; many: string },
  maxCount: number,
  maxLength: number,
): FieldResult<string[]> => {
  if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) {
    return fail(`${label.many} must be a list of text lines.`);
  }
  const lines = cleanRecipeLines(value as string[]);
  if (lines.length < 1 || lines.length > maxCount) {
    return fail(`Enter between 1 and ${maxCount} ${label.many.toLowerCase()}.`);
  }
  const tooLong = lines.findIndex((line) => recipeTextLength(line) > maxLength);
  if (tooLong !== -1) {
    return fail(
      `${label.one} ${tooLong + 1} is longer than ${maxLength} characters.`,
    );
  }
  return { ok: true, value: lines };
};

export const validateRecipeIngredients = (
  value: unknown,
): FieldResult<string[]> =>
  validateLines(
    value,
    { one: 'Ingredient', many: 'Ingredients' },
    RECIPE_INGREDIENTS_MAX,
    RECIPE_INGREDIENT_MAX_LENGTH,
  );

export const validateRecipeSteps = (value: unknown): FieldResult<string[]> =>
  validateLines(
    value,
    { one: 'Step', many: 'Steps' },
    RECIPE_STEPS_MAX,
    RECIPE_STEP_MAX_LENGTH,
  );

/** Servings: a whole number from 1 to 50, or null (or absent) for not set. */
export const validateRecipeServings = (
  value: unknown,
): FieldResult<number | null> => {
  if (value === undefined || value === null) return { ok: true, value: null };
  return Number.isInteger(value) &&
    (value as number) >= RECIPE_SERVINGS_MIN &&
    (value as number) <= RECIPE_SERVINGS_MAX
    ? { ok: true, value: value as number }
    : fail(
        `Servings must be a whole number from ${RECIPE_SERVINGS_MIN} to ${RECIPE_SERVINGS_MAX}.`,
      );
};

const LINK_MESSAGES: Record<RecipeUrlProblem, string> = {
  malformed:
    'The recipe link is not a web address. Paste the whole link, starting with https://.',
  too_long: `The recipe link must be ${RECIPE_SOURCE_URL_MAX_LENGTH} characters or fewer.`,
  not_allowed:
    'The recipe link must be an https web address without a username, password, or port.',
};

/** A manual recipe's link: blank, null, or absent means no link. */
export const validateRecipeLink = (
  value: unknown,
): FieldResult<string | null> => {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('The recipe link must be text.');
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const parsed = parseRecipeLinkUrl(trimmed);
  return parsed.ok
    ? { ok: true, value: parsed.url.href }
    : fail(LINK_MESSAGES[parsed.problem]);
};

/** Shown when a link is sent for a recipe imported from a website. */
export const RECIPE_LINK_IMPORTED_MESSAGE =
  'An imported recipe already links to its page, so it cannot take a recipe link.';

export const validateRecipeVersion = (value: unknown): FieldResult<number> =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? { ok: true, value }
    : fail('Version must be a positive whole number.');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const URL_MESSAGES: Record<RecipeUrlProblem, string> = {
  malformed: 'is not a valid web address.',
  too_long: `must be ${RECIPE_SOURCE_URL_MAX_LENGTH} characters or fewer.`,
  not_allowed: 'must be an https address on a supported recipe site.',
};

const validateSourceUrl = (value: unknown, label: string): FieldResult<URL> => {
  if (typeof value !== 'string') return fail(`${label} must be text.`);
  const parsed = parseRecipeSourceUrl(value);
  return parsed.ok
    ? { ok: true, value: parsed.url }
    : fail(`${label} ${URL_MESSAGES[parsed.problem]}`);
};

/** The final URL, or null when absent or equal to the submitted URL. */
const validateResolvedUrl = (
  value: unknown,
  submitted: URL,
): FieldResult<URL | null> => {
  if (value === undefined || value === null) return { ok: true, value: null };
  const result = validateSourceUrl(value, 'The resolved URL');
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.href === submitted.href ? null : result.value,
  };
};

const validatePageTitle = (value: unknown): FieldResult<string | null> => {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return fail('The source page title must be text.');
  }
  const cleaned = cleanRecipeLine(value);
  if (recipeTextLength(cleaned) > RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH) {
    return fail(
      `The source page title must be ${RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH} characters or fewer.`,
    );
  }
  return { ok: true, value: cleaned.length > 0 ? cleaned : null };
};

/**
 * Validates client-supplied source metadata. The host is always derived from
 * the page the text came from (the resolved URL when present), never taken
 * from the client, and the import time is assigned by the server.
 */
export const validateRecipeSource = (
  value: unknown,
): FieldResult<ValidRecipeSource> => {
  if (value === undefined) return { ok: true, value: { kind: 'manual' } };
  if (!isPlainObject(value)) return fail('Source must be an object.');

  if (value.kind === 'manual') {
    return hasOnlyKeys(value, ['kind'])
      ? { ok: true, value: { kind: 'manual' } }
      : fail('A manual source carries no other fields.');
  }
  if (value.kind !== 'website') {
    return fail('Source kind must be manual or website.');
  }
  if (
    !hasOnlyKeys(value, ['kind', 'submittedUrl', 'resolvedUrl', 'pageTitle'])
  ) {
    return fail(
      'A website source accepts only submittedUrl, resolvedUrl, and pageTitle.',
    );
  }

  const submitted = validateSourceUrl(value.submittedUrl, 'The source URL');
  if (!submitted.ok) return submitted;
  const resolved = validateResolvedUrl(value.resolvedUrl, submitted.value);
  if (!resolved.ok) return resolved;
  const title = validatePageTitle(value.pageTitle);
  if (!title.ok) return title;

  return {
    ok: true,
    value: {
      kind: 'website',
      submittedUrl: submitted.value.href,
      resolvedUrl: resolved.value?.href ?? null,
      host: (resolved.value ?? submitted.value).hostname,
      pageTitle: title.value,
    },
  };
};

const CREATE_FIELDS = new Set([
  'title',
  'notes',
  'ingredients',
  'steps',
  'servings',
  'link',
  'source',
  'onlyIfNewSource',
]);
const UPDATE_FIELDS = new Set([
  'version',
  'title',
  'notes',
  'ingredients',
  'steps',
  'servings',
  'link',
]);

const collect = <T>(
  errors: RecipeFieldError[],
  field: RecipeField,
  result: FieldResult<T>,
): T | undefined => {
  if (result.ok) return result.value;
  errors.push({ field, message: result.message });
  return undefined;
};

/**
 * Validates and normalizes a create request. Fields the client may not set
 * (ID, household, version, timestamps, or anything unknown) are rejected
 * rather than ignored, so a mistaken client learns about it immediately.
 */
export const validateCreateRecipe = (
  input: unknown,
): RecipeValidation<ValidCreateRecipe> => {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ field: 'request', message: 'Send a recipe object.' }],
    };
  }
  const unknown = Object.keys(input).filter((key) => !CREATE_FIELDS.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: [
        {
          field: 'request',
          message: `Unexpected fields: ${unknown.join(', ')}.`,
        },
      ],
    };
  }

  const errors: RecipeFieldError[] = [];
  const title = collect(errors, 'title', validateRecipeTitle(input.title));
  const notes = collect(errors, 'notes', validateRecipeNotes(input.notes));
  const ingredients = collect(
    errors,
    'ingredients',
    validateRecipeIngredients(input.ingredients),
  );
  const steps = collect(errors, 'steps', validateRecipeSteps(input.steps));
  const servings = collect(
    errors,
    'servings',
    validateRecipeServings(input.servings),
  );
  const link = collect(errors, 'link', validateRecipeLink(input.link));
  const source = collect(errors, 'source', validateRecipeSource(input.source));
  if (source?.kind === 'website' && link) {
    errors.push({ field: 'link', message: RECIPE_LINK_IMPORTED_MESSAGE });
  }
  const onlyIfNewSource = input.onlyIfNewSource !== undefined;
  if (onlyIfNewSource && input.onlyIfNewSource !== true) {
    errors.push({
      field: 'onlyIfNewSource',
      message: 'onlyIfNewSource must be true when it is sent.',
    });
  } else if (onlyIfNewSource && source?.kind === 'manual') {
    errors.push({
      field: 'onlyIfNewSource',
      message:
        'Only a recipe imported from a website can skip a link already in the library.',
    });
  }

  if (
    errors.length > 0 ||
    title === undefined ||
    notes === undefined ||
    ingredients === undefined ||
    steps === undefined ||
    servings === undefined ||
    link === undefined ||
    source === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title,
      notes,
      ingredients,
      steps,
      servings,
      link,
      source,
      onlyIfNewSource,
    },
  };
};

/** Validates an update: version plus at least one editable field. */
export const validateUpdateRecipe = (
  input: unknown,
): RecipeValidation<ValidUpdateRecipe> => {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ field: 'request', message: 'Send a recipe change object.' }],
    };
  }
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !UPDATE_FIELDS.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: [
        {
          field: 'request',
          message: `Unexpected fields: ${unknown.join(', ')}.`,
        },
      ],
    };
  }
  if (!Object.hasOwn(input, 'version') || keys.length < 2) {
    return {
      ok: false,
      errors: [
        {
          field: 'request',
          message:
            'Provide version and at least one of title, notes, ingredients, steps, servings, or link.',
        },
      ],
    };
  }

  const errors: RecipeFieldError[] = [];
  const version = collect(
    errors,
    'version',
    validateRecipeVersion(input.version),
  );
  const change: ValidUpdateRecipe = { version: version ?? 0 };
  if (Object.hasOwn(input, 'title')) {
    change.title = collect(errors, 'title', validateRecipeTitle(input.title));
  }
  if (Object.hasOwn(input, 'notes')) {
    change.notes = collect(errors, 'notes', validateRecipeNotes(input.notes));
  }
  if (Object.hasOwn(input, 'ingredients')) {
    change.ingredients = collect(
      errors,
      'ingredients',
      validateRecipeIngredients(input.ingredients),
    );
  }
  if (Object.hasOwn(input, 'steps')) {
    change.steps = collect(errors, 'steps', validateRecipeSteps(input.steps));
  }
  if (Object.hasOwn(input, 'servings')) {
    change.servings = collect(
      errors,
      'servings',
      validateRecipeServings(input.servings),
    );
  }
  if (Object.hasOwn(input, 'link')) {
    change.link = collect(errors, 'link', validateRecipeLink(input.link));
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: change };
};

// ---------------------------------------------------------------------------
// Import drafts

export type RecipeTruncationField =
  'title' | 'ingredients' | 'ingredientLines' | 'steps' | 'stepLines';

export interface RecipeTruncationNotice {
  /**
   * `ingredients`/`steps`: extra lines were dropped. `ingredientLines`/
   * `stepLines`: one or more lines were cut to the per-line bound.
   */
  field: RecipeTruncationField;
  /** How many lines were dropped or cut; 1 for the title. */
  count: number;
}

export interface RecipeDraft {
  title: string;
  ingredients: string[];
  steps: string[];
  /** From the page's recipe yield, when it gives a servings count (#84). */
  servings: number | null;
}

const truncateLines = (
  lines: readonly string[],
  maxCount: number,
  maxLength: number,
  fields: { dropped: RecipeTruncationField; cut: RecipeTruncationField },
  notices: RecipeTruncationNotice[],
): string[] => {
  const cleaned = cleanRecipeLines(lines);
  const kept = cleaned.slice(0, maxCount);
  if (cleaned.length > kept.length) {
    notices.push({
      field: fields.dropped,
      count: cleaned.length - kept.length,
    });
  }
  let cut = 0;
  const bounded = kept.map((line) => {
    if (recipeTextLength(line) <= maxLength) return line;
    cut += 1;
    return truncateRecipeText(line, maxLength);
  });
  if (cut > 0) notices.push({ field: fields.cut, count: cut });
  return bounded;
};

/**
 * Cleans an extracted draft and fits it into the recipe bounds instead of
 * rejecting it: extra lines are dropped and long lines are cut at a character
 * boundary. Each change is reported so the member reviews it before saving.
 * Missing required content (an empty title or no lines) is left for normal
 * validation to report.
 */
export const truncateRecipeDraft = (
  draft: RecipeDraft,
): { draft: RecipeDraft; notices: RecipeTruncationNotice[] } => {
  const notices: RecipeTruncationNotice[] = [];
  const cleanedTitle = cleanRecipeLine(draft.title);
  const title = truncateRecipeText(cleanedTitle, RECIPE_TITLE_MAX_LENGTH);
  if (title !== cleanedTitle) notices.push({ field: 'title', count: 1 });

  return {
    draft: {
      title,
      servings: draft.servings,
      ingredients: truncateLines(
        draft.ingredients,
        RECIPE_INGREDIENTS_MAX,
        RECIPE_INGREDIENT_MAX_LENGTH,
        { dropped: 'ingredients', cut: 'ingredientLines' },
        notices,
      ),
      steps: truncateLines(
        draft.steps,
        RECIPE_STEPS_MAX,
        RECIPE_STEP_MAX_LENGTH,
        { dropped: 'steps', cut: 'stepLines' },
        notices,
      ),
    },
    notices,
  };
};

// ---------------------------------------------------------------------------
// Import preview contract

/**
 * Bounds on one import, from the accepted #31 design. They are shared so the
 * screen can tell the member how long a fetch may take with the same number
 * the Worker enforces.
 */
export const RECIPE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const RECIPE_IMPORT_TIMEOUT_MS = 10_000;
export const RECIPE_IMPORT_MAX_REDIRECTS = 3;

/**
 * Why an import produced no draft. Each class gets its own message; none of
 * them echoes the page, the URL, or anything about the family.
 */
export type RecipeImportFailure =
  | 'unsafe_destination'
  | 'source_unavailable'
  | 'unsupported_source'
  | 'too_large'
  | 'timeout';

export interface RecipeImportPreviewRequest {
  url: string;
}

/** Where the preview's text was read from. No page markup is ever returned. */
export interface RecipeImportPreviewSource {
  /** The submitted URL after normalization, without its fragment. */
  submittedUrl: string;
  /** The final URL after redirects, or null when it equals the submitted one. */
  resolvedUrl: string | null;
  /** Host of the page the text was read from. */
  host: string;
  pageTitle: string | null;
}

export interface RecipeImportPreviewResponse {
  draft: RecipeDraft;
  source: RecipeImportPreviewSource;
  notices: RecipeTruncationNotice[];
}

/** The body of a failed import: an ordinary API error plus its class. */
export interface RecipeImportFailureResponse {
  error: { code: 'import_failed'; message: string };
  reason: RecipeImportFailure;
}

/** The supported sites, once each, for the screen that lists them. */
export const recipeImportSites = (): string[] =>
  RECIPE_IMPORT_HOSTS.filter((host) => !host.startsWith('www.'));

// ---------------------------------------------------------------------------
// Bulk import (#116)

/** The most links one bulk import takes, from the accepted #116 design. */
export const RECIPE_BULK_IMPORT_MAX_LINKS = 20;

/**
 * One pasted line, checked before anything is sent. `import` lines are
 * imported in order; the others already have their result.
 */
export type BulkImportLine =
  | { kind: 'import'; line: string; url: string }
  | { kind: 'refused'; line: string; problem: RecipeUrlProblem }
  | { kind: 'repeat'; line: string; url: string };

export type BulkImportPlan =
  | { ok: true; lines: BulkImportLine[] }
  | { ok: false; problem: 'empty' }
  | { ok: false; problem: 'too_many'; count: number };

/**
 * Splits pasted text into the lines a bulk import shows: blank lines are
 * dropped, each line is checked with the import's own URL policy, and a link
 * that repeats an earlier one once its fragment is removed is marked as a
 * repeat. More than {@link RECIPE_BULK_IMPORT_MAX_LINKS} lines refuses the
 * whole paste, so nothing starts.
 */
export const planBulkImport = (text: string): BulkImportPlan => {
  const pasted = text
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (pasted.length === 0) return { ok: false, problem: 'empty' };
  if (pasted.length > RECIPE_BULK_IMPORT_MAX_LINKS) {
    return { ok: false, problem: 'too_many', count: pasted.length };
  }

  const seen = new Set<string>();
  return {
    ok: true,
    lines: pasted.map((line): BulkImportLine => {
      const parsed = parseRecipeSourceUrl(line);
      if (!parsed.ok) return { kind: 'refused', line, problem: parsed.problem };
      const url = parsed.url.href;
      if (seen.has(url)) return { kind: 'repeat', line, url };
      seen.add(url);
      return { kind: 'import', line, url };
    }),
  };
};
