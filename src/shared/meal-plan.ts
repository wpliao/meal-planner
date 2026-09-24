/**
 * Runtime-neutral meal-plan contracts, bounds, calendar-date arithmetic, and
 * request validation.
 *
 * The Worker validates every request with these functions and the client uses
 * the same ones for its forms and week navigation. The migration
 * `0004_create_meal_plan_entries.sql` enforces the storage bounds with CHECK
 * constraints that must stay in step with these constants.
 *
 * A plan date is a calendar date string `YYYY-MM-DD` with no time and no time
 * zone. Arithmetic below works on whole days counted from 1970-01-01, never on
 * local timestamps, so a daylight-saving change cannot skip or repeat a day.
 */

import { cleanRecipeLine, recipeTextLength } from './recipes';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export const MEAL_PLAN_TITLE_MAX_LENGTH = 120;
export const MEAL_PLAN_NOTE_MAX_LENGTH = 200;

/** Entries one meal of one day may hold. */
export const MEAL_PLAN_SLOT_LIMIT = 6;

/**
 * Entries one household may keep. Entries are kept until removed, so this is
 * also the bound on stored plan history (decision 6 of the #49 design).
 */
export const MEAL_PLAN_HOUSEHOLD_LIMIT = 4000;

/** Entries one week can hold: seven days of every meal, each at its limit. */
export const MEAL_PLAN_WEEK_ENTRY_MAX =
  7 * MEAL_SLOTS.length * MEAL_PLAN_SLOT_LIMIT;

/**
 * From this many entries the plan warns that the household limit is near:
 * 90% of it, about four months' warning at three entries a day (decision 2 of
 * the #56 design).
 */
export const MEAL_PLAN_USAGE_HINT_AT = 3600;

/** The longest inclusive date range one read may cover. */
export const MEAL_PLAN_READ_MAX_DAYS = 42;

/**
 * The write window guards against mistyped dates such as a wrong year. It is
 * not a retention rule. An entry may be created on, or moved to, a date from
 * eight weeks before today to 52 weeks after it.
 */
export const MEAL_PLAN_WINDOW_DAYS_BACK = 8 * 7;
export const MEAL_PLAN_WINDOW_DAYS_AHEAD = 52 * 7;

/**
 * The Worker only knows the UTC date, which differs from a family's local date
 * by at most one day, so it widens the window by one day on each side.
 */
export const MEAL_PLAN_SERVER_SLACK_DAYS = 1;

export type MealPlanEntryKind = 'recipe' | 'text';

interface MealPlanEntryBase {
  id: string;
  date: string;
  slot: MealSlot;
  /** The text, or the recipe's current title (its last title once deleted). */
  title: string;
  note: string | null;
  version: number;
  updatedAt: string;
}

export type MealPlanEntry = MealPlanEntryBase &
  (
    | { kind: 'text' }
    | {
        kind: 'recipe';
        /** Null once the recipe has been deleted from the library. */
        recipeId: string | null;
        recipeRemoved: boolean;
      }
  );

/** How much of the household limit the whole plan uses. */
export interface MealPlanUsage {
  entries: number;
  limit: number;
  /** The earliest planned date, or null when the plan is empty. */
  oldestDate: string | null;
}

export interface MealPlanResponse {
  from: string;
  to: string;
  /** Ordered by date, meal, and placement. */
  entries: MealPlanEntry[];
  usage: MealPlanUsage;
}

export interface MealPlanEntryResponse {
  entry: MealPlanEntry;
}

export type CreateMealPlanEntryRequest = {
  date: string;
  slot: MealSlot;
  note?: string | null;
} & ({ recipeId: string } | { title: string });

/**
 * Update requires the version the member changed plus at least one field.
 * `title` is accepted only for a text entry; `note: null` clears the note.
 */
export interface UpdateMealPlanEntryRequest {
  version: number;
  date?: string;
  slot?: MealSlot;
  title?: string;
  note?: string | null;
}

export interface DeleteMealPlanEntryRequest {
  version: number;
}

/** An entry the member saw, at the version they saw it. */
export interface SeenMealPlanEntry {
  id: string;
  version: number;
}

/** Clears a week: every entry the member saw there, and no other. */
export interface ClearMealPlanWeekRequest {
  entries: SeenMealPlanEntry[];
}

/** Body of a `409 week_changed` response: the week's latest entries. */
export interface MealPlanWeekConflictResponse {
  error: { code: 'week_changed'; message: string };
  current: MealPlanEntry[];
}

/** Body of a `409 stale_version` response for an entry update or delete. */
export interface MealPlanConflictResponse {
  error: { code: 'stale_version'; message: string };
  current: MealPlanEntry;
}

// ---------------------------------------------------------------------------
// Calendar dates

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const pad = (value: number, width: number): string =>
  String(value).padStart(width, '0');

/**
 * Days since 1970-01-01 for a valid plan date, or null. Years 0001–9999 are
 * accepted, which is also the range SQLite's `date()` returns unchanged.
 */
export const planDayNumber = (value: string): number | null => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return Math.round(date.getTime() / DAY_MS);
};

export const isPlanDate = (value: unknown): value is string =>
  typeof value === 'string' && planDayNumber(value) !== null;

/** The plan date for a day number. */
export const planDateFromDayNumber = (dayNumber: number): string => {
  const date = new Date(dayNumber * DAY_MS);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
};

const requireDayNumber = (value: string): number => {
  const dayNumber = planDayNumber(value);
  if (dayNumber === null) throw new RangeError('Not a valid plan date.');
  return dayNumber;
};

export const addPlanDays = (value: string, days: number): string =>
  planDateFromDayNumber(requireDayNumber(value) + days);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const planDaysBetween = (from: string, to: string): number =>
  requireDayNumber(to) - requireDayNumber(from);

/** The Monday that starts the week containing `value`. */
export const planWeekStart = (value: string): string => {
  const dayNumber = requireDayNumber(value);
  // 1970-01-01 was a Thursday, three days after a Monday.
  const sinceMonday = (((dayNumber + 3) % 7) + 7) % 7;
  return planDateFromDayNumber(dayNumber - sinceMonday);
};

/** The seven dates of the week that starts on `weekStart`. */
export const planWeekDates = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_unused, index) => addPlanDays(weekStart, index));

/** The device's local calendar date. */
export const localPlanDate = (now: Date): string =>
  `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;

/** The UTC calendar date, which is all the Worker knows. */
export const utcPlanDate = (now: Date): string =>
  `${pad(now.getUTCFullYear(), 4)}-${pad(now.getUTCMonth() + 1, 2)}-${pad(now.getUTCDate(), 2)}`;

export interface PlanDateWindow {
  earliest: string;
  latest: string;
}

/** The write window around `today`, widened by `slackDays` on each side. */
export const planWriteWindow = (
  today: string,
  slackDays = 0,
): PlanDateWindow => ({
  earliest: addPlanDays(today, -(MEAL_PLAN_WINDOW_DAYS_BACK + slackDays)),
  latest: addPlanDays(today, MEAL_PLAN_WINDOW_DAYS_AHEAD + slackDays),
});

/** The window the Worker enforces, from the server's UTC date. */
export const serverPlanWriteWindow = (now: Date): PlanDateWindow =>
  planWriteWindow(utcPlanDate(now), MEAL_PLAN_SERVER_SLACK_DAYS);

/**
 * Whether the week that starts on `weekStart` may be cleared: it is a real
 * Monday, and its Sunday is before `today`. The Worker knows only the UTC
 * date, so it passes one day of slack, which also accepts a week whose Sunday
 * is the UTC today; a family ahead of UTC can then clear last week early on
 * Monday.
 */
export const isClearableWeek = (
  weekStart: string,
  today: string,
  slackDays = 0,
): boolean => {
  const start = planDayNumber(weekStart);
  const now = planDayNumber(today);
  if (start === null || now === null) return false;
  return planWeekStart(weekStart) === weekStart && start + 6 < now + slackDays;
};

// Valid plan dates of equal width compare correctly as strings.
export const isWithinPlanWindow = (
  value: string,
  window: PlanDateWindow,
): boolean => value >= window.earliest && value <= window.latest;

// ---------------------------------------------------------------------------
// Validation

export type MealPlanField =
  | 'request'
  | 'date'
  | 'slot'
  | 'recipeId'
  | 'title'
  | 'note'
  | 'version'
  | 'from'
  | 'to'
  | 'weekStart'
  | 'entries';

export interface MealPlanFieldError {
  field: MealPlanField;
  message: string;
}

export type MealPlanValidation<T> =
  { ok: true; value: T } | { ok: false; errors: MealPlanFieldError[] };

export type ValidCreateMealPlanEntry = {
  date: string;
  slot: MealSlot;
  note: string | null;
} & ({ kind: 'recipe'; recipeId: string } | { kind: 'text'; title: string });

export interface ValidUpdateMealPlanEntry {
  version: number;
  date?: string;
  slot?: MealSlot;
  title?: string;
  note?: string | null;
}

export interface ValidClearMealPlanWeek {
  weekStart: string;
  /** Distinct entries, IDs in lower case. */
  entries: SeenMealPlanEntry[];
}

export interface ValidMealPlanRange {
  from: string;
  to: string;
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({
  ok: false,
  message,
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const isMealSlot = (value: unknown): value is MealSlot =>
  typeof value === 'string' &&
  (MEAL_SLOTS as readonly string[]).includes(value);

export const validatePlanDate = (value: unknown): FieldResult<string> =>
  isPlanDate(value)
    ? { ok: true, value }
    : fail('Choose a real date in the form YYYY-MM-DD.');

/** A date inside the write window, for a new entry or a move. */
export const validatePlanDateInWindow = (
  value: unknown,
  window: PlanDateWindow,
): FieldResult<string> => {
  const date = validatePlanDate(value);
  if (!date.ok) return date;
  return isWithinPlanWindow(date.value, window)
    ? date
    : fail(
        `Choose a date from ${window.earliest} to ${window.latest}. Plans reach 8 weeks back and 52 weeks ahead.`,
      );
};

export const validateMealSlot = (value: unknown): FieldResult<MealSlot> =>
  isMealSlot(value)
    ? { ok: true, value }
    : fail('Meal must be breakfast, lunch, or dinner.');

export const validateMealPlanTitle = (value: unknown): FieldResult<string> => {
  if (typeof value !== 'string') return fail('Meal text must be text.');
  const title = cleanRecipeLine(value);
  const length = recipeTextLength(title);
  if (length < 1 || length > MEAL_PLAN_TITLE_MAX_LENGTH) {
    return fail(
      `Enter a meal between 1 and ${MEAL_PLAN_TITLE_MAX_LENGTH} characters.`,
    );
  }
  return { ok: true, value: title };
};

/** One line; empty or whitespace-only notes are stored as no note. */
export const validateMealPlanNote = (
  value: unknown,
): FieldResult<string | null> => {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('Note must be text.');
  const note = cleanRecipeLine(value);
  if (recipeTextLength(note) > MEAL_PLAN_NOTE_MAX_LENGTH) {
    return fail(
      `Keep the note to ${MEAL_PLAN_NOTE_MAX_LENGTH} characters or fewer.`,
    );
  }
  return { ok: true, value: note.length > 0 ? note : null };
};

export const validateMealPlanRecipeId = (
  value: unknown,
): FieldResult<string> =>
  typeof value === 'string' && UUID_PATTERN.test(value)
    ? { ok: true, value: value.toLowerCase() }
    : fail('Choose a recipe from the library.');

export const validateMealPlanVersion = (value: unknown): FieldResult<number> =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? { ok: true, value }
    : fail('Version must be a positive whole number.');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requestError = <T>(message: string): MealPlanValidation<T> => ({
  ok: false,
  errors: [{ field: 'request', message }],
});

const collect = <T>(
  errors: MealPlanFieldError[],
  field: MealPlanField,
  result: FieldResult<T>,
): T | undefined => {
  if (result.ok) return result.value;
  errors.push({ field, message: result.message });
  return undefined;
};

const unexpectedFields = (
  input: Record<string, unknown>,
  allowed: readonly string[],
): string[] => Object.keys(input).filter((key) => !allowed.includes(key));

const CREATE_FIELDS = ['date', 'slot', 'note', 'recipeId', 'title'];
const UPDATE_FIELDS = ['version', 'date', 'slot', 'note', 'title'];

/**
 * Validates and normalizes a create request: a date inside `window`, a meal,
 * an optional note, and exactly one of `recipeId` or `title`. Fields the
 * client may not set are rejected rather than ignored.
 */
export const validateCreateMealPlanEntry = (
  input: unknown,
  window: PlanDateWindow,
): MealPlanValidation<ValidCreateMealPlanEntry> => {
  if (!isPlainObject(input)) return requestError('Send a plan entry object.');
  const unknown = unexpectedFields(input, CREATE_FIELDS);
  if (unknown.length > 0) {
    return requestError(`Unexpected fields: ${unknown.join(', ')}.`);
  }
  const hasRecipe = Object.hasOwn(input, 'recipeId');
  if (hasRecipe === Object.hasOwn(input, 'title')) {
    return requestError('Provide exactly one of recipeId or title.');
  }

  const errors: MealPlanFieldError[] = [];
  const date = collect(
    errors,
    'date',
    validatePlanDateInWindow(input.date, window),
  );
  const slot = collect(errors, 'slot', validateMealSlot(input.slot));
  const note = collect(errors, 'note', validateMealPlanNote(input.note));
  const recipeId = hasRecipe
    ? collect(errors, 'recipeId', validateMealPlanRecipeId(input.recipeId))
    : undefined;
  const title = hasRecipe
    ? undefined
    : collect(errors, 'title', validateMealPlanTitle(input.title));

  if (
    errors.length > 0 ||
    date === undefined ||
    slot === undefined ||
    note === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value:
      recipeId === undefined
        ? { date, slot, note, kind: 'text', title: title as string }
        : { date, slot, note, kind: 'recipe', recipeId },
  };
};

/**
 * Validates an update's shape: version plus at least one field. The write
 * window is not checked here, because it applies only when the date changes,
 * which the Worker knows once it has read the entry.
 */
export const validateUpdateMealPlanEntry = (
  input: unknown,
): MealPlanValidation<ValidUpdateMealPlanEntry> => {
  if (!isPlainObject(input)) {
    return requestError('Send a plan entry change object.');
  }
  const unknown = unexpectedFields(input, UPDATE_FIELDS);
  if (unknown.length > 0) {
    return requestError(`Unexpected fields: ${unknown.join(', ')}.`);
  }
  if (!Object.hasOwn(input, 'version') || Object.keys(input).length < 2) {
    return requestError(
      'Provide version and at least one of date, slot, title, or note.',
    );
  }

  const errors: MealPlanFieldError[] = [];
  const version = collect(
    errors,
    'version',
    validateMealPlanVersion(input.version),
  );
  const change: ValidUpdateMealPlanEntry = { version: version ?? 0 };
  if (Object.hasOwn(input, 'date')) {
    change.date = collect(errors, 'date', validatePlanDate(input.date));
  }
  if (Object.hasOwn(input, 'slot')) {
    change.slot = collect(errors, 'slot', validateMealSlot(input.slot));
  }
  if (Object.hasOwn(input, 'title')) {
    change.title = collect(errors, 'title', validateMealPlanTitle(input.title));
  }
  if (Object.hasOwn(input, 'note')) {
    change.note = collect(errors, 'note', validateMealPlanNote(input.note));
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: change };
};

/**
 * Validates a read range from the query string: `from` and `to` given once
 * each, both real dates, in order, and at most
 * {@link MEAL_PLAN_READ_MAX_DAYS} days inclusive.
 */
export const validateMealPlanRange = (
  params: URLSearchParams,
): MealPlanValidation<ValidMealPlanRange> => {
  const keys = [...params.keys()];
  if (
    keys.length !== 2 ||
    params.getAll('from').length !== 1 ||
    params.getAll('to').length !== 1
  ) {
    return requestError('Provide from and to once each, and nothing else.');
  }
  const errors: MealPlanFieldError[] = [];
  const from = collect(errors, 'from', validatePlanDate(params.get('from')));
  const to = collect(errors, 'to', validatePlanDate(params.get('to')));
  if (from === undefined || to === undefined) return { ok: false, errors };

  const days = planDaysBetween(from, to) + 1;
  if (days < 1) return requestError('The range must not end before it starts.');
  if (days > MEAL_PLAN_READ_MAX_DAYS) {
    return requestError(
      `A range covers at most ${MEAL_PLAN_READ_MAX_DAYS} days.`,
    );
  }
  return { ok: true, value: { from, to } };
};

const isSeenEntry = (
  value: unknown,
): value is { id: string; version: number } =>
  isPlainObject(value) &&
  unexpectedFields(value, ['id', 'version']).length === 0 &&
  typeof value.id === 'string' &&
  UUID_PATTERN.test(value.id) &&
  validateMealPlanVersion(value.version).ok;

/**
 * Validates a request to clear the week starting on `weekStart`: a Monday
 * whose week has ended (see {@link isClearableWeek}), and exactly `entries`,
 * listing 1 to {@link MEAL_PLAN_WEEK_ENTRY_MAX} distinct entries by ID and
 * version.
 */
export const validateClearMealPlanWeek = (
  weekStart: unknown,
  input: unknown,
  today: string,
  slackDays = 0,
): MealPlanValidation<ValidClearMealPlanWeek> => {
  if (
    typeof weekStart !== 'string' ||
    !isPlanDate(weekStart) ||
    planWeekStart(weekStart) !== weekStart
  ) {
    return {
      ok: false,
      errors: [
        {
          field: 'weekStart',
          message: 'Choose the Monday that starts a week.',
        },
      ],
    };
  }
  if (!isClearableWeek(weekStart, today, slackDays)) {
    return {
      ok: false,
      errors: [
        {
          field: 'weekStart',
          message: 'Only a week that has ended can be cleared.',
        },
      ],
    };
  }
  if (!isPlainObject(input)) return requestError('Send a week to clear.');
  const unknown = unexpectedFields(input, ['entries']);
  if (unknown.length > 0) {
    return requestError(`Unexpected fields: ${unknown.join(', ')}.`);
  }

  const fieldError = (message: string): MealPlanValidation<never> => ({
    ok: false,
    errors: [{ field: 'entries', message }],
  });
  const { entries } = input;
  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > MEAL_PLAN_WEEK_ENTRY_MAX
  ) {
    return fieldError(
      `List between 1 and ${MEAL_PLAN_WEEK_ENTRY_MAX} entries to clear.`,
    );
  }
  if (!entries.every(isSeenEntry)) {
    return fieldError('Give each entry only its id and a positive version.');
  }
  const seen = entries.map(({ id, version }) => ({
    id: id.toLowerCase(),
    version,
  }));
  if (new Set(seen.map(({ id }) => id)).size !== seen.length) {
    return fieldError('List each entry once.');
  }
  return { ok: true, value: { weekStart, entries: seen } };
};
