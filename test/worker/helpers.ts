import {
  applyD1Migrations,
  env,
  SELF,
  type D1Migration,
} from 'cloudflare:test';

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };

export const testEnv = env as TestEnv;

export const applyMigrations = async (): Promise<void> => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM recipe_preferences'),
    testEnv.DB.prepare('DELETE FROM meal_plan_entries'),
    testEnv.DB.prepare('DELETE FROM recipe_steps'),
    testEnv.DB.prepare('DELETE FROM recipe_ingredients'),
    testEnv.DB.prepare('DELETE FROM recipes'),
    testEnv.DB.prepare('DELETE FROM pantry_items'),
    testEnv.DB.prepare('DELETE FROM app_installation'),
    testEnv.DB.prepare('DELETE FROM household_members'),
    testEnv.DB.prepare('DELETE FROM households'),
  ]);
};

/**
 * Seeds a second household with one active member so isolation tests can prove
 * that a foreign ID never escapes the actor's household scope.
 */
export const seedOtherHousehold = async (): Promise<{
  householdId: string;
  memberId: string;
}> => {
  const now = new Date().toISOString();
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Other Family', ?, ?)`,
    ).bind(householdId, now, now),
    testEnv.DB.prepare(
      `INSERT INTO household_members (
         id, household_id, normalized_email, access_subject, role, status,
         invited_at, activated_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, 'other@example.test', ?, 'member', 'active', ?, ?, NULL, ?, ?)`,
    ).bind(memberId, householdId, 'other-subject', now, now, now, now),
  ]);
  return { householdId, memberId };
};

export const seedPantryItem = async (
  householdId: string,
  name: string,
  status: 'available' | 'low' | 'needed' = 'available',
): Promise<string> => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await testEnv.DB.prepare(
    `INSERT INTO pantry_items (
       id, household_id, display_name, normalized_name, status,
       version, created_source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, 'manual', ?, ?)`,
  )
    .bind(id, householdId, name, name.toLowerCase(), status, now, now)
    .run();
  return id;
};

/**
 * Inserts a manual recipe directly, bypassing the API, with one ingredient and
 * one step, so isolation and constraint tests can place rows anywhere.
 */
export const seedRecipe = async (
  householdId: string,
  title: string,
  lines: { ingredients?: string[]; steps?: string[] } = {},
): Promise<string> => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const ingredients = lines.ingredients ?? ['1 cup rice'];
  const steps = lines.steps ?? ['Cook the rice.'];
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO recipes (
         id, household_id, title, notes, version, write_token, source_kind,
         created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 1, ?, 'manual', ?, ?)`,
    ).bind(id, householdId, title, crypto.randomUUID(), now, now),
    ...ingredients.map((text, index) =>
      testEnv.DB.prepare(
        `INSERT INTO recipe_ingredients (recipe_id, position, text)
         VALUES (?, ?, ?)`,
      ).bind(id, index + 1, text),
    ),
    ...steps.map((text, index) =>
      testEnv.DB.prepare(
        `INSERT INTO recipe_steps (recipe_id, position, text)
         VALUES (?, ?, ?)`,
      ).bind(id, index + 1, text),
    ),
  ]);
  return id;
};

/**
 * Inserts a plan entry directly, bypassing the API and its limits, so tests
 * can place rows in any household. A recipe entry copies the recipe's title.
 */
export const seedMealPlanEntry = async (
  householdId: string,
  entry: {
    date: string;
    slot?: 'breakfast' | 'lunch' | 'dinner';
    recipeId?: string;
    title?: string;
  },
): Promise<string> => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await testEnv.DB.prepare(
    `INSERT INTO meal_plan_entries (
       id, household_id, plan_date, meal_slot, kind, recipe_id, title, note,
       placed_at, version, created_at, updated_at
     )
     SELECT ?, ?, ?, ?, ?, ?,
            COALESCE((SELECT title FROM recipes WHERE id = ?), ?),
            NULL, ?, 1, ?, ?`,
  )
    .bind(
      id,
      householdId,
      entry.date,
      entry.slot ?? 'dinner',
      entry.recipeId ? 'recipe' : 'text',
      entry.recipeId ?? null,
      entry.recipeId ?? null,
      entry.title ?? 'Leftovers',
      now,
      now,
      now,
    )
    .run();
  return id;
};

/**
 * Inserts a recipe preference directly, bypassing the API, so tests can place
 * rows in any household and with any end time.
 */
export const seedRecipePreference = async (
  householdId: string,
  recipeId: string,
  preference: { favourite?: boolean; notNowUntil?: string | null } = {},
): Promise<void> => {
  await testEnv.DB.prepare(
    `INSERT INTO recipe_preferences (
       recipe_id, household_id, favourite, not_now_until, updated_at
     ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      recipeId,
      householdId,
      (preference.favourite ?? true) ? 1 : 0,
      preference.notNowUntil ?? null,
      new Date().toISOString(),
    )
    .run();
};

export const mutationInit = (
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'https://example.test',
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const bootstrapOwner = async (): Promise<Response> =>
  fetchWorker(
    new Request(
      'https://example.test/api/bootstrap',
      mutationInit('POST', { householdName: 'Liao Family' }),
    ),
  );

export const fetchWorker = (request: Request): Promise<Response> =>
  SELF.fetch(request);
