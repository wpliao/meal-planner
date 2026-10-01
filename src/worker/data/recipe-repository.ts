import {
  RECIPE_LIMIT,
  RECIPE_LINK_IMPORTED_MESSAGE,
  type Recipe,
  type RecipeSource,
  type RecipeSourceKind,
  type RecipeSummary,
  type ValidCreateRecipe,
  type ValidUpdateRecipe,
} from '../../shared/recipes';
import { ApiError, invalidRequest, stateConflict } from '../errors';

interface RecipeRow {
  id: string;
  title: string;
  notes: string | null;
  servings: number | null;
  link_url: string | null;
  version: number;
  source_kind: RecipeSourceKind;
  source_submitted_url: string | null;
  source_resolved_url: string | null;
  source_host: string | null;
  source_page_title: string | null;
  source_imported_at: string | null;
  created_at: string;
  updated_at: string;
}

type SummaryRow = Pick<
  RecipeRow,
  | 'id'
  | 'title'
  | 'version'
  | 'source_kind'
  | 'source_host'
  | 'link_url'
  | 'created_at'
  | 'updated_at'
>;

interface LineRow {
  text: string;
}

type LineTable = 'recipe_ingredients' | 'recipe_steps';

const RECIPE_COLUMNS = `id, title, notes, servings, link_url, version, source_kind,
  source_submitted_url, source_resolved_url, source_host, source_page_title,
  source_imported_at, created_at, updated_at`;

const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'That recipe no longer exists.');

const staleVersion = (current: Recipe): ApiError =>
  new ApiError(
    409,
    'stale_version',
    'Someone else changed this recipe. Review the latest version before saving again.',
    { current },
  );

// The migration's source CHECK guarantees that a website row carries its
// submitted URL, host, and import time, so those casts cannot hide a null.
const toSource = (row: RecipeRow): RecipeSource =>
  row.source_kind === 'website'
    ? {
        kind: 'website',
        submittedUrl: row.source_submitted_url as string,
        resolvedUrl: row.source_resolved_url,
        host: row.source_host as string,
        pageTitle: row.source_page_title,
        importedAt: row.source_imported_at as string,
      }
    : { kind: 'manual' };

const toRecipe = (
  row: RecipeRow,
  ingredients: readonly LineRow[],
  steps: readonly LineRow[],
): Recipe => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  ingredients: ingredients.map((line) => line.text),
  steps: steps.map((line) => line.text),
  servings: row.servings,
  link: row.link_url,
  source: toSource(row),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// The migration's CHECK keeps a stored link an https URL; a value that still
// fails to parse is shown as no link rather than failing the whole list.
const linkHost = (link: string | null): string | null => {
  if (link === null) return null;
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
};

const toSummary = (row: SummaryRow): RecipeSummary => ({
  id: row.id,
  title: row.title,
  source:
    row.source_kind === 'website'
      ? { kind: 'website', host: row.source_host as string }
      : { kind: 'manual', linkHost: linkHost(row.link_url) },
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listRecipes = async (
  db: D1Database,
  householdId: string,
): Promise<RecipeSummary[]> => {
  const result = await db
    .prepare(
      `SELECT id, title, version, source_kind, source_host, link_url,
              created_at, updated_at
         FROM recipes
        WHERE household_id = ?
        ORDER BY updated_at DESC, id DESC`,
    )
    .bind(householdId)
    .all<SummaryRow>();
  return result.results.map(toSummary);
};

/** Ordered lines of one recipe, scoped through the recipe's household. */
const selectLines = (
  db: D1Database,
  table: LineTable,
  householdId: string,
  recipeId: string,
): D1PreparedStatement =>
  db
    .prepare(
      `SELECT line.text
         FROM ${table} AS line
         JOIN recipes AS recipe ON recipe.id = line.recipe_id
        WHERE recipe.household_id = ? AND recipe.id = ?
        ORDER BY line.position`,
    )
    .bind(householdId, recipeId);

/** Reads a recipe and both line lists in one consistent transaction. */
export const getRecipe = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
): Promise<Recipe | null> => {
  const [recipe, ingredients, steps] = await db.batch([
    db
      .prepare(
        `SELECT ${RECIPE_COLUMNS}
           FROM recipes
          WHERE household_id = ? AND id = ?`,
      )
      .bind(householdId, recipeId),
    selectLines(db, 'recipe_ingredients', householdId, recipeId),
    selectLines(db, 'recipe_steps', householdId, recipeId),
  ]);
  const row = (recipe.results as RecipeRow[])[0];
  if (!row) return null;
  return toRecipe(
    row,
    ingredients.results as LineRow[],
    steps.results as LineRow[],
  );
};

/**
 * Inserts an ordered list, 1-based, only while the recipe still carries this
 * write's token. A batch keeps running after a guarded UPDATE matched no row,
 * so the token (not the version) is what stops a losing write's lines.
 */
const insertLines = (
  db: D1Database,
  table: LineTable,
  recipeId: string,
  writeToken: string,
  lines: readonly string[],
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO ${table} (recipe_id, position, text)
       SELECT recipe.id, entry.key + 1, entry.value
         FROM recipes AS recipe, json_each(?) AS entry
        WHERE recipe.id = ? AND recipe.write_token = ?`,
    )
    .bind(JSON.stringify(lines), recipeId, writeToken);

const deleteLines = (
  db: D1Database,
  table: LineTable,
  recipeId: string,
  writeToken: string,
): D1PreparedStatement =>
  db
    .prepare(
      `DELETE FROM ${table}
        WHERE recipe_id = ?
          AND EXISTS (SELECT 1 FROM recipes
                       WHERE id = ? AND write_token = ?)`,
    )
    .bind(recipeId, recipeId, writeToken);

type WebsiteSource = Extract<ValidCreateRecipe['source'], { kind: 'website' }>;

/**
 * A household's website recipe whose submitted or resolved address equals the
 * new import's submitted or resolved address (#116). Bound with
 * {@link sameSourceBindings}; `recipe` is the outer table's alias.
 */
const SAME_SOURCE = `SELECT recipe.id, recipe.title FROM recipes AS recipe
  WHERE recipe.household_id = ?
    AND recipe.source_kind = 'website'
    AND (recipe.source_submitted_url IN (?, ?)
         OR recipe.source_resolved_url IN (?, ?))`;

const sameSourceBindings = (
  householdId: string,
  source: WebsiteSource,
): string[] => {
  const addresses = [
    source.submittedUrl,
    source.resolvedUrl ?? source.submittedUrl,
  ];
  return [householdId, ...addresses, ...addresses];
};

/**
 * Explains a guarded create that inserted nothing, with one read: the same
 * address is already in the library, the library is full, or (when a matching
 * recipe was deleted in between) the library changed and a retry will save.
 */
const createRefusal = async (
  db: D1Database,
  householdId: string,
  onlyIfNew: WebsiteSource | null,
): Promise<ApiError> => {
  const row = onlyIfNew
    ? await db
        .prepare(
          `SELECT existing.id AS id, existing.title AS title,
                  (SELECT COUNT(*) FROM recipes WHERE household_id = ?) AS total
             FROM (SELECT 1) AS one
             LEFT JOIN (${SAME_SOURCE}
                        ORDER BY recipe.created_at, recipe.id LIMIT 1)
                    AS existing ON 1`,
        )
        .bind(householdId, ...sameSourceBindings(householdId, onlyIfNew))
        .first<{ id: string | null; title: string | null; total: number }>()
    : await db
        .prepare(
          `SELECT NULL AS id, NULL AS title, COUNT(*) AS total
             FROM recipes WHERE household_id = ?`,
        )
        .bind(householdId)
        .first<{ id: null; title: null; total: number }>();

  if (row?.id && row.title !== null) {
    return new ApiError(
      409,
      'duplicate_source',
      'A recipe from this link is already in the library.',
      { existing: { id: row.id, title: row.title } },
    );
  }
  if ((row?.total ?? 0) >= RECIPE_LIMIT) {
    return new ApiError(
      400,
      'limit_reached',
      `A household library holds at most ${RECIPE_LIMIT} recipes. Remove one before adding another.`,
    );
  }
  return stateConflict(
    'The recipe library changed while this recipe was being saved. Try again.',
  );
};

export const createRecipe = async (
  db: D1Database,
  householdId: string,
  input: ValidCreateRecipe,
): Promise<Recipe> => {
  const id = crypto.randomUUID();
  const writeToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const website = input.source.kind === 'website' ? input.source : null;
  const onlyIfNew = website && input.onlyIfNewSource ? website : null;

  // The guarded INSERT keeps the per-household cap and, when asked, the
  // one-recipe-per-address rule race-safe, and the whole batch is one
  // transaction, so a recipe never exists without its lines.
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO recipes (
           id, household_id, title, notes, servings, link_url, version,
           write_token, source_kind, source_submitted_url, source_resolved_url,
           source_host, source_page_title, source_imported_at, created_at,
           updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM recipes WHERE household_id = ?)
                < ${RECIPE_LIMIT}
                ${onlyIfNew ? `AND NOT EXISTS (${SAME_SOURCE})` : ''}`,
      )
      .bind(
        id,
        householdId,
        input.title,
        input.notes,
        input.servings,
        input.link,
        writeToken,
        input.source.kind,
        website?.submittedUrl ?? null,
        website?.resolvedUrl ?? null,
        website?.host ?? null,
        website?.pageTitle ?? null,
        website ? now : null,
        now,
        now,
        householdId,
        ...(onlyIfNew ? sameSourceBindings(householdId, onlyIfNew) : []),
      ),
    insertLines(db, 'recipe_ingredients', id, writeToken, input.ingredients),
    insertLines(db, 'recipe_steps', id, writeToken, input.steps),
  ]);

  if (inserted.meta.changes === 0) {
    throw await createRefusal(db, householdId, onlyIfNew);
  }

  return {
    id,
    title: input.title,
    notes: input.notes,
    ingredients: [...input.ingredients],
    steps: [...input.steps],
    servings: input.servings,
    link: input.link,
    source: website
      ? {
          kind: 'website',
          submittedUrl: website.submittedUrl,
          resolvedUrl: website.resolvedUrl,
          host: website.host,
          pageTitle: website.pageTitle,
          importedAt: now,
        }
      : { kind: 'manual' },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
};

/** Explains why a guarded write matched no row: gone, or changed meanwhile. */
const conflictFor = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
): Promise<ApiError> => {
  const current = await getRecipe(db, householdId, recipeId);
  return current ? staleVersion(current) : notFound();
};

/**
 * Refuses a link for an imported recipe (#113) before anything is written.
 * Source kind never changes after creation, so this read cannot race the
 * update. A missing recipe is left for the guarded update to report.
 */
const requireManualRecipe = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
): Promise<void> => {
  const row = await db
    .prepare(
      `SELECT source_kind FROM recipes WHERE household_id = ? AND id = ?`,
    )
    .bind(householdId, recipeId)
    .first<Pick<RecipeRow, 'source_kind'>>();
  if (row?.source_kind === 'website') {
    throw invalidRequest(RECIPE_LINK_IMPORTED_MESSAGE);
  }
};

/**
 * Applies a member's edit made against `change.version`. Each supplied list
 * replaces the whole ordered list. The UPDATE sets a fresh write token, and
 * every later statement in the batch requires that token, so two updates from
 * the same base version cannot mix: the loser changes nothing at all.
 */
export const updateRecipe = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
  change: ValidUpdateRecipe,
): Promise<Recipe> => {
  const writeToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const hasNotes = Object.hasOwn(change, 'notes');
  const hasServings = Object.hasOwn(change, 'servings');
  const hasLink = Object.hasOwn(change, 'link');
  if (change.link) await requireManualRecipe(db, householdId, recipeId);

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE recipes
            SET title = COALESCE(?, title),
                notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
                servings = CASE WHEN ? = 1 THEN ? ELSE servings END,
                link_url = CASE WHEN ? = 1 THEN ? ELSE link_url END,
                version = version + 1,
                write_token = ?,
                updated_at = ?
          WHERE household_id = ?
            AND id = ?
            AND version = ?`,
      )
      .bind(
        change.title ?? null,
        hasNotes ? 1 : 0,
        change.notes ?? null,
        hasServings ? 1 : 0,
        change.servings ?? null,
        hasLink ? 1 : 0,
        change.link ?? null,
        writeToken,
        now,
        householdId,
        recipeId,
        change.version,
      ),
  ];
  if (change.ingredients) {
    statements.push(
      deleteLines(db, 'recipe_ingredients', recipeId, writeToken),
      insertLines(
        db,
        'recipe_ingredients',
        recipeId,
        writeToken,
        change.ingredients,
      ),
    );
  }
  if (change.steps) {
    statements.push(
      deleteLines(db, 'recipe_steps', recipeId, writeToken),
      insertLines(db, 'recipe_steps', recipeId, writeToken, change.steps),
    );
  }
  // Read back inside the same transaction so the response is exactly this
  // write's result, not a later member's.
  statements.push(
    db
      .prepare(
        `SELECT ${RECIPE_COLUMNS}
           FROM recipes
          WHERE household_id = ? AND id = ? AND write_token = ?`,
      )
      .bind(householdId, recipeId, writeToken),
    selectLines(db, 'recipe_ingredients', householdId, recipeId),
    selectLines(db, 'recipe_steps', householdId, recipeId),
  );

  const results = await db.batch(statements);
  if (results[0].meta.changes === 0) {
    throw await conflictFor(db, householdId, recipeId);
  }

  const [recipe, ingredients, steps] = results.slice(-3);
  const row = (recipe.results as RecipeRow[])[0];
  return toRecipe(
    row,
    ingredients.results as LineRow[],
    steps.results as LineRow[],
  );
};

/**
 * Deletes a recipe at its current version; its lines cascade, and its plan
 * entries lose the link (`ON DELETE SET NULL`) but stay. The first statement
 * copies the recipe's last title onto those entries, guarded by the same
 * household, ID, and version as the DELETE, so a stale delete changes
 * nothing at all. Entry versions are not changed: the entry's content is the
 * same, and a member's open edit of it should still save.
 */
export const deleteRecipe = async (
  db: D1Database,
  householdId: string,
  recipeId: string,
  version: number,
): Promise<void> => {
  const [, result] = await db.batch([
    db
      .prepare(
        `UPDATE meal_plan_entries
            SET title = (SELECT title FROM recipes
                          WHERE household_id = ? AND id = ? AND version = ?)
          WHERE household_id = ?
            AND recipe_id = ?
            AND EXISTS (SELECT 1 FROM recipes
                         WHERE household_id = ? AND id = ? AND version = ?)`,
      )
      .bind(
        householdId,
        recipeId,
        version,
        householdId,
        recipeId,
        householdId,
        recipeId,
        version,
      ),
    db
      .prepare(
        `DELETE FROM recipes
          WHERE household_id = ?
            AND id = ?
            AND version = ?`,
      )
      .bind(householdId, recipeId, version),
  ]);

  if (result.meta.changes === 0) {
    throw await conflictFor(db, householdId, recipeId);
  }
};
