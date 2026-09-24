import {
  addPlanDays,
  MEAL_PLAN_HOUSEHOLD_LIMIT,
  MEAL_PLAN_SLOT_LIMIT,
  type MealPlanEntry,
  type MealPlanEntryKind,
  type MealPlanUsage,
  type MealSlot,
  type ValidClearMealPlanWeek,
  type ValidCreateMealPlanEntry,
  type ValidUpdateMealPlanEntry,
} from '../../shared/meal-plan';
import { ApiError } from '../errors';

interface EntryRow {
  id: string;
  plan_date: string;
  meal_slot: MealSlot;
  kind: MealPlanEntryKind;
  /** The joined recipe's ID: null once deleted, and never another household's. */
  live_recipe_id: string | null;
  /** The live recipe title, or the stored title. */
  display_title: string;
  note: string | null;
  version: number;
  updated_at: string;
}

/**
 * Every read joins the recipe on both its ID and the entry's household, so a
 * recipe from another household can never supply a title or an ID.
 */
const ENTRY_SELECT = `SELECT entry.id, entry.plan_date, entry.meal_slot,
       entry.kind, recipe.id AS live_recipe_id,
       COALESCE(recipe.title, entry.title) AS display_title,
       entry.note, entry.version, entry.updated_at
  FROM meal_plan_entries AS entry
  LEFT JOIN recipes AS recipe
    ON recipe.id = entry.recipe_id
   AND recipe.household_id = entry.household_id`;

const SLOT_ORDER = `CASE entry.meal_slot
    WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 ELSE 3 END`;

/** Entries already in one meal of one day, other than `excludeId`. */
const SLOT_COUNT = `(SELECT COUNT(*) FROM meal_plan_entries
    WHERE household_id = ? AND plan_date = ? AND meal_slot = ? AND id <> ?)`;

const HOUSEHOLD_COUNT = `(SELECT COUNT(*) FROM meal_plan_entries
    WHERE household_id = ?)`;

const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'That plan entry no longer exists.');

const recipeNotFound = (): ApiError =>
  new ApiError(404, 'not_found', 'That recipe no longer exists.');

const staleVersion = (current: MealPlanEntry): ApiError =>
  new ApiError(
    409,
    'stale_version',
    'Someone else changed this plan entry. Review the latest version before saving again.',
    { current },
  );

// Neither message repeats the entry's text, note, date, or meal.
const slotFull = (): ApiError =>
  new ApiError(
    409,
    'limit_reached',
    `A meal holds at most ${MEAL_PLAN_SLOT_LIMIT} entries. Remove one or choose another meal.`,
  );

const householdFull = (): ApiError =>
  new ApiError(
    409,
    'limit_reached',
    `The plan holds at most ${MEAL_PLAN_HOUSEHOLD_LIMIT.toLocaleString('en')} entries. Clear old weeks before adding more.`,
  );

const weekChanged = (current: MealPlanEntry[]): ApiError =>
  new ApiError(
    409,
    'week_changed',
    'This week changed after you opened it, so nothing was removed. Review the latest version before clearing it.',
    { current },
  );

const toEntry = (row: EntryRow): MealPlanEntry => {
  const base = {
    id: row.id,
    date: row.plan_date,
    slot: row.meal_slot,
    title: row.display_title,
    note: row.note,
    version: row.version,
    updatedAt: row.updated_at,
  };
  return row.kind === 'recipe'
    ? {
        ...base,
        kind: 'recipe',
        recipeId: row.live_recipe_id,
        recipeRemoved: row.live_recipe_id === null,
      }
    : { ...base, kind: 'text' };
};

const selectRange = (
  db: D1Database,
  householdId: string,
  from: string,
  to: string,
): D1PreparedStatement =>
  db
    .prepare(
      `${ENTRY_SELECT}
        WHERE entry.household_id = ?
          AND entry.plan_date BETWEEN ? AND ?
        ORDER BY entry.plan_date, ${SLOT_ORDER}, entry.placed_at, entry.rowid`,
    )
    .bind(householdId, from, to);

/** Entries in an inclusive date range, by date, meal, and placement. */
export const listMealPlanEntries = async (
  db: D1Database,
  householdId: string,
  from: string,
  to: string,
): Promise<MealPlanEntry[]> => {
  const result = await selectRange(db, householdId, from, to).all<EntryRow>();
  return result.results.map(toEntry);
};

/**
 * A range of entries and the whole household's usage, read in one batch so
 * the two agree. The usage is served by the `(household_id, plan_date)`
 * index, and the household limit bounds it.
 */
export const readMealPlan = async (
  db: D1Database,
  householdId: string,
  from: string,
  to: string,
): Promise<{ entries: MealPlanEntry[]; usage: MealPlanUsage }> => {
  const [range, usage] = await db.batch([
    selectRange(db, householdId, from, to),
    db
      .prepare(
        `SELECT COUNT(*) AS entries, MIN(plan_date) AS oldest
           FROM meal_plan_entries
          WHERE household_id = ?`,
      )
      .bind(householdId),
  ]);
  const totals = (
    usage.results as { entries: number; oldest: string | null }[]
  )[0];
  return {
    entries: (range.results as EntryRow[]).map(toEntry),
    usage: {
      entries: totals?.entries ?? 0,
      limit: MEAL_PLAN_HOUSEHOLD_LIMIT,
      oldestDate: totals?.oldest ?? null,
    },
  };
};

const selectEntry = (
  db: D1Database,
  householdId: string,
  entryId: string,
): D1PreparedStatement =>
  db
    .prepare(`${ENTRY_SELECT} WHERE entry.household_id = ? AND entry.id = ?`)
    .bind(householdId, entryId);

export const getMealPlanEntry = async (
  db: D1Database,
  householdId: string,
  entryId: string,
): Promise<MealPlanEntry | null> => {
  const row = await selectEntry(db, householdId, entryId).first<EntryRow>();
  return row ? toEntry(row) : null;
};

/**
 * Adds an entry last in its meal. The INSERT is guarded by both limits and,
 * for a recipe, by the recipe belonging to the caller's household, so neither
 * a race nor a foreign recipe ID can get past it. The read-back runs in the
 * same transaction.
 */
export const createMealPlanEntry = async (
  db: D1Database,
  householdId: string,
  input: ValidCreateMealPlanEntry,
  now: Date,
): Promise<MealPlanEntry> => {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  const limits = `${SLOT_COUNT} < ${MEAL_PLAN_SLOT_LIMIT}
      AND ${HOUSEHOLD_COUNT} < ${MEAL_PLAN_HOUSEHOLD_LIMIT}`;
  const limitParams = [householdId, input.date, input.slot, id, householdId];
  const columns = `id, household_id, plan_date, meal_slot, kind, recipe_id,
       title, note, placed_at, version, created_at, updated_at`;

  const insert =
    input.kind === 'recipe'
      ? db
          .prepare(
            `INSERT INTO meal_plan_entries (${columns})
             SELECT ?, ?, ?, ?, 'recipe', recipe.id, recipe.title, ?, ?, 1, ?, ?
               FROM recipes AS recipe
              WHERE recipe.id = ? AND recipe.household_id = ?
                AND ${limits}`,
          )
          .bind(
            id,
            householdId,
            input.date,
            input.slot,
            input.note,
            timestamp,
            timestamp,
            timestamp,
            input.recipeId,
            householdId,
            ...limitParams,
          )
      : db
          .prepare(
            `INSERT INTO meal_plan_entries (${columns})
             SELECT ?, ?, ?, ?, 'text', NULL, ?, ?, ?, 1, ?, ?
              WHERE ${limits}`,
          )
          .bind(
            id,
            householdId,
            input.date,
            input.slot,
            input.title,
            input.note,
            timestamp,
            timestamp,
            timestamp,
            ...limitParams,
          );

  const [inserted, readBack] = await db.batch([
    insert,
    selectEntry(db, householdId, id),
  ]);
  const row = (readBack.results as EntryRow[])[0];
  if (inserted.meta.changes === 1 && row) return toEntry(row);

  // Explain the refusal. A recipe that is not the household's comes first, so
  // a foreign ID is answered exactly like a missing one.
  const reasons = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM recipes WHERE id = ? AND household_id = ?)
           AS recipe_rows,
         ${SLOT_COUNT} AS slot_rows`,
    )
    .bind(
      input.kind === 'recipe' ? input.recipeId : '',
      householdId,
      householdId,
      input.date,
      input.slot,
      id,
    )
    .first<{ recipe_rows: number; slot_rows: number }>();
  if (input.kind === 'recipe' && reasons?.recipe_rows === 0) {
    throw recipeNotFound();
  }
  if ((reasons?.slot_rows ?? 0) >= MEAL_PLAN_SLOT_LIMIT) throw slotFull();
  throw householdFull();
};

/** Explains why a version-guarded write matched no row. */
const conflictFor = async (
  db: D1Database,
  householdId: string,
  entryId: string,
): Promise<ApiError> => {
  const current = await getMealPlanEntry(db, householdId, entryId);
  return current ? staleVersion(current) : notFound();
};

/**
 * Applies a change made against `change.version`. The entry is read first so
 * the kind and move rules can be checked; the UPDATE repeats the version
 * guard, so what was read is still what is written. A change of date or meal
 * is a move: the entry goes last in its new meal, which must have room.
 *
 * `inWindow` decides whether a new date may be moved to. The date of an entry
 * that keeps its date is never checked, so an old entry stays editable.
 */
export const updateMealPlanEntry = async (
  db: D1Database,
  householdId: string,
  entryId: string,
  change: ValidUpdateMealPlanEntry,
  inWindow: (date: string) => boolean,
  now: Date,
): Promise<MealPlanEntry> => {
  const current = await getMealPlanEntry(db, householdId, entryId);
  if (!current) throw notFound();
  if (current.version !== change.version) throw staleVersion(current);
  if (change.title !== undefined && current.kind !== 'text') {
    throw new ApiError(
      400,
      'invalid_request',
      "A planned recipe shows the recipe's title. Only a typed meal's text can be changed.",
    );
  }

  const date = change.date ?? current.date;
  const slot = change.slot ?? current.slot;
  if (date !== current.date && !inWindow(date)) {
    throw new ApiError(
      400,
      'invalid_request',
      'Choose a date from 8 weeks ago to 52 weeks ahead.',
    );
  }
  const moved = date !== current.date || slot !== current.slot;
  const hasNote = Object.hasOwn(change, 'note');
  const timestamp = now.toISOString();

  const [updated, readBack] = await db.batch([
    db
      .prepare(
        `UPDATE meal_plan_entries
            SET plan_date = ?,
                meal_slot = ?,
                title = COALESCE(?, title),
                note = CASE WHEN ? = 1 THEN ? ELSE note END,
                placed_at = CASE WHEN ? = 1 THEN ? ELSE placed_at END,
                version = version + 1,
                updated_at = ?
          WHERE household_id = ?
            AND id = ?
            AND version = ?
            AND ${SLOT_COUNT} < ${MEAL_PLAN_SLOT_LIMIT}`,
      )
      .bind(
        date,
        slot,
        change.title ?? null,
        hasNote ? 1 : 0,
        change.note ?? null,
        moved ? 1 : 0,
        timestamp,
        timestamp,
        householdId,
        entryId,
        change.version,
        householdId,
        date,
        slot,
        entryId,
      ),
    selectEntry(db, householdId, entryId),
  ]);

  const row = (readBack.results as EntryRow[])[0];
  if (updated.meta.changes === 1 && row) return toEntry(row);

  const latest = await getMealPlanEntry(db, householdId, entryId);
  if (!latest) throw notFound();
  if (latest.version !== change.version) throw staleVersion(latest);
  // Still at the version this change was made against: the meal was full.
  throw slotFull();
};

/** Removes an entry at its current version. */
export const deleteMealPlanEntry = async (
  db: D1Database,
  householdId: string,
  entryId: string,
  version: number,
): Promise<void> => {
  const result = await db
    .prepare(
      `DELETE FROM meal_plan_entries
        WHERE household_id = ? AND id = ? AND version = ?`,
    )
    .bind(householdId, entryId, version)
    .run();
  if (result.meta.changes === 0) {
    throw await conflictFor(db, householdId, entryId);
  }
};

/** Entries of the household dated in the week, as a subquery's FROM clause. */
const IN_WEEK = `meal_plan_entries AS entry
  WHERE entry.household_id = ? AND entry.plan_date BETWEEN ? AND ?`;

/**
 * Removes every entry of one week, but only while the week holds exactly the
 * entries the member saw, at the versions they saw (decision 1 of the #56
 * design). The check and the delete are one statement, so one transaction:
 * nothing can be added, changed, moved, or removed between them. Otherwise
 * nothing is removed, and the week's latest entries are returned in a
 * `409 week_changed`, so the member can confirm again.
 *
 * Every predicate is scoped to the caller's household, so a foreign ID can
 * never match; it only makes the counts disagree. Returns the number of
 * entries removed, which D1 reports one per row: nothing references a plan
 * entry, so the delete cascades nowhere.
 */
export const clearMealPlanWeek = async (
  db: D1Database,
  householdId: string,
  week: ValidClearMealPlanWeek,
): Promise<number> => {
  const from = week.weekStart;
  const to = addPlanDays(from, 6);
  const expected = week.entries.length;
  const result = await db
    .prepare(
      `DELETE FROM meal_plan_entries
        WHERE household_id = ? AND plan_date BETWEEN ? AND ?
          AND (SELECT COUNT(*) FROM ${IN_WEEK}) = ?
          AND (SELECT COUNT(*) FROM ${IN_WEEK}
                  AND EXISTS (
                    SELECT 1 FROM json_each(?) AS seen
                     WHERE json_extract(seen.value, '$.id') = entry.id
                       AND json_extract(seen.value, '$.version') = entry.version
                  )) = ?`,
    )
    .bind(
      householdId,
      from,
      to,
      householdId,
      from,
      to,
      expected,
      householdId,
      from,
      to,
      JSON.stringify(week.entries),
      expected,
    )
    .run();
  if (result.meta.changes > 0) return result.meta.changes;
  throw weekChanged(await listMealPlanEntries(db, householdId, from, to));
};
