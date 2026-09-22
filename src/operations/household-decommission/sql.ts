/**
 * The exact SQL used by the household decommission procedure.
 *
 * Both the operator script (through the D1 REST API) and the Workers-runtime
 * tests (through the D1 binding) execute these statements, so the tests prove
 * the same text that runs against a real database. Every statement binds the
 * household ID as parameter `?1`; nothing is ever interpolated into SQL.
 *
 * Keep this file free of imports so it type-checks in both the Node and the
 * Workers projects.
 */

export interface BoundStatement {
  readonly sql: string;
  readonly params: readonly string[];
}

/**
 * Removes the installation pointer only when it points at the reviewed
 * household. The singleton guard keeps the statement from ever matching more
 * than one row.
 */
export const DELETE_INSTALLATION_POINTER_SQL = `DELETE FROM app_installation
 WHERE singleton_id = 1
   AND household_id = ?1`;

/**
 * Removes the reviewed household, which cascades to its members and pantry
 * rows. It only matches while no installation pointer remains, so it deletes
 * nothing when the first statement matched no row because the pointer names a
 * different household. On its own, the `ON DELETE RESTRICT` foreign key also
 * blocks deleting a household that the pointer still references.
 */
export const DELETE_HOUSEHOLD_SQL = `DELETE FROM households
 WHERE id = ?1
   AND NOT EXISTS (SELECT 1 FROM app_installation)`;

/** The two-statement deletion batch, in execution order. */
export const deletionBatch = (householdId: string): BoundStatement[] => [
  { sql: DELETE_INSTALLATION_POINTER_SQL, params: [householdId] },
  { sql: DELETE_HOUSEHOLD_SQL, params: [householdId] },
];

/**
 * Count-only inventory for preflight and verification. The row contains
 * numbers only; it never returns a name, email, or other record value.
 *
 * The installed household is checked without reading its ID: a matching
 * target installation count of 1 and a total installation count of 1 prove
 * that the singleton pointer names the reviewed household.
 */
export const HOUSEHOLD_COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM app_installation) AS installation_rows,
  (SELECT COUNT(*) FROM app_installation WHERE household_id = ?1) AS target_installation_rows,
  (SELECT COUNT(*) FROM households) AS household_rows,
  (SELECT COUNT(*) FROM households WHERE id = ?1) AS target_household_rows,
  (SELECT COUNT(*) FROM household_members) AS member_rows,
  (SELECT COUNT(*) FROM household_members WHERE household_id = ?1) AS target_member_rows,
  (SELECT COUNT(*) FROM pantry_items) AS pantry_rows,
  (SELECT COUNT(*) FROM pantry_items WHERE household_id = ?1) AS target_pantry_rows`;

export const householdCountsStatement = (
  householdId: string,
): BoundStatement => ({ sql: HOUSEHOLD_COUNTS_SQL, params: [householdId] });

export const COUNT_FIELDS = [
  'installation_rows',
  'target_installation_rows',
  'household_rows',
  'target_household_rows',
  'member_rows',
  'target_member_rows',
  'pantry_rows',
  'target_pantry_rows',
] as const;

export type CountField = (typeof COUNT_FIELDS)[number];
export type HouseholdCounts = Record<CountField, number>;

/**
 * Affected-row counts a successful deletion batch may report, in statement
 * order, given the preflight counts. The pointer delete always changes one
 * row. The Workers-runtime D1 engine counts the rows removed by `ON DELETE
 * CASCADE` in the household delete's `changes`, while SQLite's own
 * `changes()` counts only the household row. Until the development rehearsal
 * shows which one the D1 REST API reports, both exact values are accepted and
 * anything else is a failure. Verification then requires every count to be
 * zero regardless.
 */
export const acceptableDeletionChanges = (
  counts: HouseholdCounts,
): readonly (readonly number[])[] => [
  [1, 1 + counts.target_member_rows + counts.target_pantry_rows],
  [1, 1],
];

/** Names of the applied migrations, in the order they were applied. */
export const APPLIED_MIGRATIONS_SQL =
  'SELECT name FROM d1_migrations ORDER BY id';

/**
 * User tables present in the database. SQLite's internal tables and D1's
 * `_cf_` metadata tables are excluded without LIKE, whose `_` is a wildcard.
 */
export const TABLE_INVENTORY_SQL = `SELECT name FROM sqlite_master
 WHERE type = 'table'
   AND substr(name, 1, 7) <> 'sqlite_'
   AND substr(name, 1, 4) <> '_cf_'
 ORDER BY name`;

/**
 * The only tables the procedure knows how to account for. A migration that
 * adds a table (for example, recipes) makes the preflight refuse until this
 * list and the counts above are extended to cover it. The Workers-runtime
 * tests compare this list with the real migrated schema.
 */
export const EXPECTED_TABLES: readonly string[] = [
  'app_installation',
  'd1_migrations',
  'household_members',
  'households',
  'pantry_items',
];
