/**
 * The SQL that loads a nutrition dataset into D1 (decision 1 of the #84
 * design). Deploy runs it through Wrangler, and the Workers-runtime tests run
 * the same statements through the D1 binding.
 *
 * Values are written as SQL literals, because a file run by Wrangler has no
 * bound parameters. Every value comes from the committed dataset, never from a
 * request, and strings are quoted by doubling single quotes.
 */

import type { NutritionDataset } from './dataset.ts';

/** Rows per INSERT, keeping each statement far below D1's 100 KB limit. */
const ROWS_PER_INSERT = 200;

const sqlValue = (value: string | number | null): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('A dataset number is not finite.');
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
};

const inserts = (
  table: string,
  columns: string,
  rows: readonly (readonly (string | number | null)[])[],
): string[] => {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const values = rows
      .slice(start, start + ROWS_PER_INSERT)
      .map((row) => `(${row.map(sqlValue).join(', ')})`)
      .join(',\n');
    statements.push(`INSERT INTO ${table} (${columns}) VALUES\n${values};`);
  }
  return statements;
};

/**
 * Replaces the reference rows. It first deletes the dataset row, so a load
 * that stops part-way leaves no version behind and is repeated by the next
 * deploy; {@link finishStatements} writes the version last.
 */
export const dataStatements = (dataset: NutritionDataset): string[] => [
  'DELETE FROM nutrition_dataset;',
  'DELETE FROM nutrition_food_portions;',
  'DELETE FROM nutrition_foods;',
  ...inserts(
    'nutrition_foods',
    'fdc_id, name, data_type, category, release, energy_kj, protein_g, fat_g, saturated_fat_g, carbohydrate_g, sugars_g, fibre_g, sodium_mg, volume_seq',
    dataset.foods,
  ),
  ...inserts(
    'nutrition_food_portions',
    'fdc_id, seq, amount, label, gram_weight',
    dataset.portions,
  ),
];

/** Rebuilds the name index from the foods, then records the version. */
export const finishStatements = (
  dataset: NutritionDataset,
  sha256: string,
  loadedAt: string,
): string[] => [
  "INSERT INTO nutrition_foods_fts (nutrition_foods_fts) VALUES ('rebuild');",
  `INSERT INTO nutrition_dataset (id, version, sha256, food_count, portion_count, loaded_at) VALUES (1, ${sqlValue(dataset.version)}, ${sqlValue(sha256)}, ${dataset.foods.length}, ${dataset.portions.length}, ${sqlValue(loadedAt)});`,
];

/** Reads the loaded version, for deciding whether to load. */
export const LOADED_VERSION_QUERY =
  'SELECT version, sha256 FROM nutrition_dataset WHERE id = 1;';

/**
 * Fails unless the name index matches the foods exactly (FTS5's
 * integrity check, comparing against the external content with rank 1).
 */
export const INDEX_CHECK_STATEMENT =
  "INSERT INTO nutrition_foods_fts (nutrition_foods_fts, rank) VALUES ('integrity-check', 1);";

/** Counts what a load left, for checking it against the dataset. */
export const VERIFY_QUERY = `SELECT
  (SELECT COUNT(*) FROM nutrition_foods) AS foods,
  (SELECT COUNT(*) FROM nutrition_food_portions) AS portions,
  (SELECT version FROM nutrition_dataset WHERE id = 1) AS version,
  (SELECT sha256 FROM nutrition_dataset WHERE id = 1) AS sha256;`;
