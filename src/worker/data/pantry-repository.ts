import {
  PANTRY_ITEM_LIMIT,
  type PantryItem,
  type PantryStatus,
} from '../../shared/pantry';
import { ApiError } from '../errors';

interface PantryRow {
  id: string;
  display_name: string;
  status: PantryStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `id, display_name, status, version, created_at, updated_at`;

// Needed first, then Low, then Available; alphabetical within each group.
const ORDER_BY = `ORDER BY CASE status
                             WHEN 'needed' THEN 0
                             WHEN 'low' THEN 1
                             ELSE 2
                           END,
                           normalized_name,
                           id`;

const toItem = (row: PantryRow): PantryItem => ({
  id: row.id,
  name: row.display_name,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'That pantry item no longer exists.');

const duplicateName = (): ApiError =>
  new ApiError(
    409,
    'duplicate_name',
    'That item is already in your pantry. Update the existing item instead.',
  );

const staleVersion = (): ApiError =>
  new ApiError(
    409,
    'stale_version',
    'Someone else changed this item. Reload to see the latest version.',
  );

export const listPantryItems = async (
  db: D1Database,
  householdId: string,
): Promise<PantryItem[]> => {
  const result = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM pantry_items
        WHERE household_id = ?
        ${ORDER_BY}`,
    )
    .bind(householdId)
    .all<PantryRow>();
  return result.results.map(toItem);
};

const getScopedItem = (
  db: D1Database,
  householdId: string,
  itemId: string,
): Promise<PantryRow | null> =>
  db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM pantry_items
        WHERE household_id = ? AND id = ?`,
    )
    .bind(householdId, itemId)
    .first<PantryRow>();

/** True when another row in this household already holds the normalized name. */
const nameTaken = async (
  db: D1Database,
  householdId: string,
  normalizedName: string,
  exceptItemId: string | null,
): Promise<boolean> =>
  (await db
    .prepare(
      `SELECT id
         FROM pantry_items
        WHERE household_id = ?
          AND normalized_name = ?
          AND (? IS NULL OR id <> ?)`,
    )
    .bind(householdId, normalizedName, exceptItemId, exceptItemId)
    .first()) !== null;

export const createPantryItem = async (
  db: D1Database,
  householdId: string,
  displayName: string,
  normalizedName: string,
  status: PantryStatus,
): Promise<PantryItem> => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  let changes: number;
  try {
    // The guarded INSERT keeps the per-household cap race-safe instead of
    // counting first and inserting afterwards.
    const result = await db
      .prepare(
        `INSERT INTO pantry_items (
           id, household_id, display_name, normalized_name, status,
           version, created_source, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, 1, 'manual', ?, ?
          WHERE (SELECT COUNT(*) FROM pantry_items WHERE household_id = ?)
                < ${PANTRY_ITEM_LIMIT}`,
      )
      .bind(
        id,
        householdId,
        displayName,
        normalizedName,
        status,
        now,
        now,
        householdId,
      )
      .run();
    changes = result.meta.changes;
  } catch (error) {
    // Only a real duplicate proves a conflict. Any other failure must stay
    // generic rather than blaming the member's input.
    if (
      await nameTaken(db, householdId, normalizedName, null).catch(() => false)
    ) {
      throw duplicateName();
    }
    throw error;
  }

  if (changes === 0) {
    throw new ApiError(
      400,
      'limit_reached',
      `A household pantry holds at most ${PANTRY_ITEM_LIMIT} items. Remove one before adding another.`,
    );
  }

  return {
    id,
    name: displayName,
    status,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
};

export interface PantryItemChange {
  displayName?: string;
  normalizedName?: string;
  status?: PantryStatus;
}

export const updatePantryItem = async (
  db: D1Database,
  householdId: string,
  itemId: string,
  version: number,
  change: PantryItemChange,
): Promise<PantryItem> => {
  const now = new Date().toISOString();

  // A missing item is a 404 even when the requested name collides, so the
  // existence check comes before the duplicate pre-check.
  if (!(await getScopedItem(db, householdId, itemId))) throw notFound();

  // Reject a rename onto another item before touching the row, so the common
  // case returns a precise conflict rather than a constraint failure.
  if (
    change.normalizedName !== undefined &&
    (await nameTaken(db, householdId, change.normalizedName, itemId))
  ) {
    throw duplicateName();
  }

  let changes: number;
  try {
    const result = await db
      .prepare(
        `UPDATE pantry_items
            SET display_name = COALESCE(?, display_name),
                normalized_name = COALESCE(?, normalized_name),
                status = COALESCE(?, status),
                version = version + 1,
                updated_at = ?
          WHERE household_id = ?
            AND id = ?
            AND version = ?`,
      )
      .bind(
        change.displayName ?? null,
        change.normalizedName ?? null,
        change.status ?? null,
        now,
        householdId,
        itemId,
        version,
      )
      .run();
    changes = result.meta.changes;
  } catch (error) {
    if (
      change.normalizedName !== undefined &&
      (await nameTaken(db, householdId, change.normalizedName, itemId).catch(
        () => false,
      ))
    ) {
      throw duplicateName();
    }
    throw error;
  }

  if (changes === 0) {
    // Distinguish "gone" from "changed underneath you": the member needs a
    // different recovery action for each.
    const current = await getScopedItem(db, householdId, itemId);
    if (!current) throw notFound();
    throw staleVersion();
  }

  const updated = await getScopedItem(db, householdId, itemId);
  if (!updated) throw notFound();
  return toItem(updated);
};

export const deletePantryItem = async (
  db: D1Database,
  householdId: string,
  itemId: string,
  version: number,
): Promise<void> => {
  const result = await db
    .prepare(
      `DELETE FROM pantry_items
        WHERE household_id = ?
          AND id = ?
          AND version = ?`,
    )
    .bind(householdId, itemId, version)
    .run();

  if (result.meta.changes === 0) {
    const current = await getScopedItem(db, householdId, itemId);
    if (!current) throw notFound();
    throw staleVersion();
  }
};
