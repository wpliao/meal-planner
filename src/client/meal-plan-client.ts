import { ApiRequestError } from './api';
import {
  addPlanDays,
  isPlanDate,
  localPlanDate,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  planDayNumber,
  planWeekDates,
  planWeekStart,
  planWriteWindow,
  validateMealPlanNote,
  validateMealPlanTitle,
  validatePlanDateInWindow,
  type MealPlanConflictResponse,
  type MealPlanEntry,
  type MealPlanWeekConflictResponse,
  type MealSlot,
  type PlanDateWindow,
} from '../shared/meal-plan';
import type { MealSuggestion } from '../shared/meal-suggestions';

/**
 * Pure helpers for the plan screens. Dates are plan dates (`YYYY-MM-DD`)
 * throughout; nothing here converts a timestamp, so a device's time zone
 * decides only what "today" is.
 */

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const partsOf = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month: MONTHS[month - 1], day };
};

/** Today on this device. */
export const today = (now: Date = new Date()): string => localPlanDate(now);

/** The write window the forms check, from the device's today. */
export const clientWriteWindow = (now: Date = new Date()): PlanDateWindow =>
  planWriteWindow(today(now));

export const weekPath = (weekStart: string): string => `/plan/${weekStart}`;

/**
 * Which week a `/plan/:weekStart` URL shows. A missing or invalid date shows
 * the current week; a date that is not a Monday shows its own week. Either
 * correction replaces the URL, so back never returns to it.
 */
export const resolveWeek = (
  param: string | undefined,
  todayDate: string,
): { weekStart: string; replace: boolean } => {
  if (param === undefined) {
    return { weekStart: planWeekStart(todayDate), replace: false };
  }
  if (!isPlanDate(param)) {
    return { weekStart: planWeekStart(todayDate), replace: true };
  }
  const weekStart = planWeekStart(param);
  return { weekStart, replace: weekStart !== param };
};

/** "Thursday" for a plan date. */
export const weekdayName = (date: string): string =>
  WEEKDAYS[((((planDayNumber(date) ?? 0) + 3) % 7) + 7) % 7];

/** "Thursday 24 September". */
export const dayLabel = (date: string): string => {
  const { month, day } = partsOf(date);
  return `${weekdayName(date)} ${day} ${month}`;
};

/**
 * "21–27 September 2026", "28 September – 4 October 2026", or
 * "29 December 2025 – 4 January 2026".
 */
export const weekHeading = (weekStart: string): string => {
  const first = partsOf(weekStart);
  const last = partsOf(addPlanDays(weekStart, 6));
  if (first.year !== last.year) {
    return `${first.day} ${first.month} ${first.year} – ${last.day} ${last.month} ${last.year}`;
  }
  if (first.month !== last.month) {
    return `${first.day} ${first.month} – ${last.day} ${last.month} ${last.year}`;
  }
  return `${first.day}–${last.day} ${last.month} ${last.year}`;
};

export const slotLabel = (slot: MealSlot): string => MEAL_SLOT_LABELS[slot];

/** "dinner on Thursday 24 September", for messages. */
export const placeLabel = (date: string, slot: MealSlot): string =>
  `${slotLabel(slot).toLowerCase()} on ${dayLabel(date)}`;

/** The read range for a week. */
export const weekRange = (weekStart: string): { from: string; to: string } => ({
  from: weekStart,
  to: addPlanDays(weekStart, 6),
});

export const weekQuery = (weekStart: string): string => {
  const { from, to } = weekRange(weekStart);
  return `/api/meal-plan?from=${from}&to=${to}`;
};

export type WeekEntries = Record<string, Record<MealSlot, MealPlanEntry[]>>;

/**
 * Entries of a week by date and meal. The Worker already orders them by
 * placement; this only files them, and ignores any outside the week.
 */
export const groupWeek = (
  weekStart: string,
  entries: readonly MealPlanEntry[],
): WeekEntries => {
  const week: WeekEntries = {};
  for (const date of planWeekDates(weekStart)) {
    week[date] = { breakfast: [], lunch: [], dinner: [] };
  }
  for (const entry of entries) {
    week[entry.date]?.[entry.slot].push(entry);
  }
  return week;
};

export const MEAL_SLOT_OPTIONS = MEAL_SLOTS.map((slot) => ({
  value: slot,
  label: slotLabel(slot),
}));

// ---------------------------------------------------------------------------
// Responses

/** The current entry from a `409 stale_version`, if this is one. */
export const entryConflictFrom = (error: unknown): MealPlanEntry | null => {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const body = error.body as Partial<MealPlanConflictResponse> | undefined;
  return body?.error?.code === 'stale_version' && body.current
    ? body.current
    : null;
};

/** The week's latest entries from a `409 week_changed`, if this is one. */
export const weekConflictFrom = (error: unknown): MealPlanEntry[] | null => {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const body = error.body as Partial<MealPlanWeekConflictResponse> | undefined;
  return body?.error?.code === 'week_changed' && Array.isArray(body.current)
    ? body.current
    : null;
};

export const isEntryGone = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.status === 404;

/** The server's own message when there is one; otherwise the fallback. */
export const planFailure = (error: unknown, fallback: string): string =>
  error instanceof ApiRequestError ? error.message : fallback;

/** "1 planned meal", "14 planned meals", "3,650 planned meals". */
export const mealCount = (count: number): string =>
  `${count.toLocaleString('en')} planned ${count === 1 ? 'meal' : 'meals'}`;

/** How an entry reads in a sentence: its title and, if any, its note. */
export const describeEntry = (entry: MealPlanEntry): string =>
  entry.note ? `“${entry.title}” (${entry.note})` : `“${entry.title}”`;

// ---------------------------------------------------------------------------
// Form checks, with the same shared rules the Worker applies

export interface EntryFieldErrors {
  date?: string;
  title?: string;
  note?: string;
  recipe?: string;
}

export const checkDate = (
  date: string,
  window: PlanDateWindow,
): string | undefined => {
  if (!date) return 'Choose a date.';
  const result = validatePlanDateInWindow(date, window);
  return result.ok ? undefined : result.message;
};

/** A moved-to date must be in the window; an unchanged date never is checked. */
export const checkMoveDate = (
  date: string,
  current: string,
  window: PlanDateWindow,
): string | undefined =>
  date === current ? undefined : checkDate(date, window);

export const checkTitle = (title: string): string | undefined => {
  const result = validateMealPlanTitle(title);
  return result.ok ? undefined : result.message;
};

/** Returns the note to send (null for none) or its error. */
export const checkNote = (
  note: string,
): { ok: true; value: string | null } | { ok: false; message: string } =>
  validateMealPlanNote(note);

export const hasErrors = (errors: EntryFieldErrors): boolean =>
  Object.values(errors).some(Boolean);

/** Recipe titles that contain every word typed, ignoring case. */
export const filterRecipes = <T extends { title: string }>(
  recipes: readonly T[],
  query: string,
): T[] => {
  const words = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return recipes.filter((recipe) => {
    const title = recipe.title.toLocaleLowerCase();
    return words.every((word) => title.includes(word));
  });
};

// ---------------------------------------------------------------------------
// Suggestions

export const suggestionsQuery = (date: string): string =>
  `/api/meal-plan/suggestions?date=${encodeURIComponent(date)}`;

/** "Suggested for Thursday dinner". */
export const suggestionsHeading = (date: string, slot: MealSlot): string =>
  `Suggested for ${weekdayName(date)} ${slotLabel(slot).toLowerCase()}`;

/** Names a reason lists before it says how many more there are. */
const REASON_NAME_LIMIT = 4;

/** "chicken, rice (low), garlic", or the first four and "and 2 more". */
const nameList = (names: readonly string[]): string => {
  const shown = names.slice(0, REASON_NAME_LIMIT).join(', ');
  const more = names.length - REASON_NAME_LIMIT;
  return more > 0 ? `${shown} and ${more} more` : shown;
};

/**
 * A suggestion's first reason line: "Family favourite" (#78), then what it
 * uses from the pantry and what it needs; null when it has none of them.
 */
export const leadingReason = (suggestion: MealSuggestion): string | null => {
  const { held, needed } = suggestion.pantry;
  const parts: string[] = [];
  if (suggestion.favourite) parts.push('Family favourite');
  if (held.length > 0) {
    parts.push(
      `Uses what you have: ${nameList(
        held.map(({ name, status }) =>
          status === 'low' ? `${name} (low)` : name,
        ),
      )}`,
    );
  }
  if (needed.length > 0) parts.push(`Needs: ${nameList(needed)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
};

/**
 * Exactly one planning reason for every suggestion, so none is ever shown
 * without a reason (`AC-02` of the #73 design).
 */
export const planningReason = (
  suggestion: MealSuggestion,
  mealDate: string,
): string => {
  if (suggestion.recent === mealDate) return 'Already planned for this day';
  if (suggestion.recent)
    return `Also planned on ${dayLabel(suggestion.recent)}`;
  if (suggestion.lastPlanned) {
    const year = suggestion.lastPlanned.slice(0, 4);
    return `Last planned on ${dayLabel(suggestion.lastPlanned)}${
      year === mealDate.slice(0, 4) ? '' : ` ${Number(year)}`
    }`;
  }
  return 'Not planned before';
};

/** "Friday 2 October": the device's calendar day of an instant. */
export const instantDayLabel = (instant: string): string =>
  dayLabel(localPlanDate(new Date(instant)));
