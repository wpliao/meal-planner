import type { CloudflareClient } from './household-decommission/cloudflare-client.ts';
import {
  ConfigurationError,
  parseJsonc,
  repositoryTargetFor,
  required,
  requirePattern,
  ACCOUNT_ID,
  type Inputs,
} from './household-decommission/config.ts';
import {
  addFixtureDays,
  buildNutritionFixture,
  ENTRY_COUNT,
  fixtureCleanupStatements,
  fixtureSeedStatements,
  INGREDIENT_COUNT,
  MATCH_COUNT,
  RECIPE_COUNT,
  validateFixtureWeek,
  type NutritionFixture,
} from './dev-nutrition-fixture.ts';

type Mode = 'seed' | 'cleanup';
type Counts = {
  recipes: number;
  lines: number;
  matches: number;
  entries: number;
};

export interface FixtureConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly databaseId: string;
  readonly databaseName: string;
  readonly week: string;
  readonly mode: Mode;
}

export const parseFixtureConfig = (
  env: Inputs,
  wranglerText: string,
  now: Date,
): FixtureConfig => {
  if (
    env.GITHUB_REF !== 'refs/heads/main' ||
    required(env, 'NUTRITION_FIXTURE_ENVIRONMENT') !== 'development'
  ) {
    throw new ConfigurationError(
      'The fixture runs only on main in development.',
    );
  }
  const mode = required(env, 'NUTRITION_FIXTURE_MODE');
  if (mode !== 'seed' && mode !== 'cleanup') {
    throw new ConfigurationError('Mode must be seed or cleanup.');
  }
  const confirmation =
    mode === 'seed'
      ? 'SEED_DEVELOPMENT_NUTRITION'
      : 'CLEAN_DEVELOPMENT_NUTRITION';
  if (env.NUTRITION_FIXTURE_CONFIRMATION !== confirmation) {
    throw new ConfigurationError(
      `Confirmation must be exactly ${confirmation}.`,
    );
  }
  const week = required(env, 'NUTRITION_FIXTURE_WEEK_START');
  validateFixtureWeek(week, now, mode === 'seed');
  const target = repositoryTargetFor(parseJsonc(wranglerText), 'development');
  return {
    accountId: requirePattern(
      env,
      'CLOUDFLARE_ACCOUNT_ID',
      ACCOUNT_ID,
      'a 32-character account ID',
    ),
    apiToken: required(env, 'CLOUDFLARE_API_TOKEN'),
    databaseId: target.databaseId,
    databaseName: target.databaseName,
    week,
    mode,
  };
};

const number = (
  row: Record<string, unknown> | undefined,
  key: string,
): number => {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('A count query returned an unexpected result.');
  }
  return value;
};

const readOne = async (
  client: CloudflareClient,
  databaseId: string,
  sql: string,
  params: string[] = [],
): Promise<Record<string, unknown>> => {
  const rows = await client.readD1(databaseId, { sql, params });
  if (rows.length !== 1) throw new Error('Expected one database row.');
  return rows[0];
};

const ids = (
  fixture: NutritionFixture,
): { recipes: string; entries: string } => ({
  recipes: JSON.stringify(fixture.recipes.map(({ id }) => id)),
  entries: JSON.stringify(fixture.entries.map(({ id }) => id)),
});

const fixtureCounts = async (
  client: CloudflareClient,
  databaseId: string,
  householdId: string,
  fixture: NutritionFixture,
): Promise<Counts> => {
  const list = ids(fixture);
  const row = await readOne(
    client,
    databaseId,
    `SELECT
    (SELECT COUNT(*) FROM recipes WHERE household_id = ?1
      AND id IN (SELECT value FROM json_each(?2))) AS recipes,
    (SELECT COUNT(*) FROM recipe_ingredients
      WHERE recipe_id IN (SELECT value FROM json_each(?2))) AS lines,
    (SELECT COUNT(*) FROM recipe_ingredient_matches WHERE household_id = ?1
      AND recipe_id IN (SELECT value FROM json_each(?2))) AS matches,
    (SELECT COUNT(*) FROM meal_plan_entries WHERE household_id = ?1
      AND id IN (SELECT value FROM json_each(?3))) AS entries`,
    [householdId, list.recipes, list.entries],
  );
  return {
    recipes: number(row, 'recipes'),
    lines: number(row, 'lines'),
    matches: number(row, 'matches'),
    entries: number(row, 'entries'),
  };
};

const expected: Counts = {
  recipes: RECIPE_COUNT,
  lines: INGREDIENT_COUNT,
  matches: MATCH_COUNT,
  entries: ENTRY_COUNT,
};

const isCounts = (actual: Counts, target: Counts): boolean =>
  Object.keys(target).every(
    (key) => actual[key as keyof Counts] === target[key as keyof Counts],
  );

export interface FixtureRunDependencies {
  readonly client: CloudflareClient;
  readonly log: (line: string) => void;
  readonly now: () => Date;
}

/** All preflights are count-only except the opaque installation pointer. */
export const runNutritionFixture = async (
  config: FixtureConfig,
  deps: FixtureRunDependencies,
): Promise<void> => {
  const { client, log } = deps;
  const database = await client.getD1Database(config.databaseId);
  if (
    database.uuid !== config.databaseId ||
    database.name !== config.databaseName
  ) {
    throw new Error('Development D1 does not match wrangler.jsonc.');
  }
  const installed = await readOne(
    client,
    config.databaseId,
    'SELECT household_id FROM app_installation WHERE singleton_id = 1',
  );
  const householdId = installed.household_id;
  if (typeof householdId !== 'string')
    throw new Error('No installed development household.');
  const owner = await readOne(
    client,
    config.databaseId,
    `SELECT COUNT(*) AS owners FROM household_members
      WHERE household_id = ?1 AND role = 'owner' AND status = 'active'`,
    [householdId],
  );
  if (number(owner, 'owners') !== 1)
    throw new Error('Expected one active development owner.');

  const fixture = buildNutritionFixture(config.week);
  const list = ids(fixture);
  const overlap = await readOne(
    client,
    config.databaseId,
    `SELECT
    (SELECT COUNT(*) FROM recipes
      WHERE id IN (SELECT value FROM json_each(?1)) AND household_id <> ?3) AS recipes,
    (SELECT COUNT(*) FROM meal_plan_entries
      WHERE id IN (SELECT value FROM json_each(?2)) AND household_id <> ?3) AS entries`,
    [list.recipes, list.entries, householdId],
  );
  if (number(overlap, 'recipes') !== 0 || number(overlap, 'entries') !== 0) {
    throw new Error('Fixture ID collision outside the installed household.');
  }
  const before = await fixtureCounts(
    client,
    config.databaseId,
    householdId,
    fixture,
  );

  if (config.mode === 'seed') {
    if (!isCounts(before, { recipes: 0, lines: 0, matches: 0, entries: 0 })) {
      throw new Error('Fixture rows already exist; clean up before reseeding.');
    }
    const preflight = await readOne(
      client,
      config.databaseId,
      `SELECT
      (SELECT COUNT(*) FROM recipes WHERE household_id = ?1) AS recipes,
      (SELECT COUNT(*) FROM meal_plan_entries WHERE household_id = ?1) AS entries,
      (SELECT COUNT(*) FROM meal_plan_entries WHERE household_id = ?1
        AND plan_date BETWEEN ?2 AND ?3) AS occupied,
      (SELECT COUNT(*) FROM nutrition_foods WHERE fdc_id IN (171287, 2514744)) AS foods,
      (SELECT COUNT(*) FROM nutrition_dataset WHERE id = 1) AS dataset`,
      [householdId, fixture.smallWeek, addFixtureDays(fixture.stressWeek, 6)],
    );
    if (number(preflight, 'occupied') !== 0) {
      throw new Error(
        'A target week already has plan entries; choose another week.',
      );
    }
    if (
      number(preflight, 'recipes') + RECIPE_COUNT > 500 ||
      number(preflight, 'entries') + ENTRY_COUNT > 4000
    ) {
      throw new Error('Fixture would exceed a household data limit.');
    }
    if (
      number(preflight, 'foods') !== 2 ||
      number(preflight, 'dataset') !== 1
    ) {
      throw new Error('The pinned development nutrition data is incomplete.');
    }
    const statements = fixtureSeedStatements(
      fixture,
      householdId,
      deps.now().toISOString(),
    );
    for (const [index, statement] of statements.entries()) {
      const result = await client.executeD1Batch(
        config.databaseId,
        [statement],
        'Seed nutrition fixture',
      );
      if (result.length !== 1 || result[0].success !== true) {
        throw new Error(
          `Fixture seed stage ${index + 1} failed; run cleanup before retrying.`,
        );
      }
    }
    const after = await fixtureCounts(
      client,
      config.databaseId,
      householdId,
      fixture,
    );
    if (!isCounts(after, expected)) {
      throw new Error(
        'Fixture seed counts are incomplete; run cleanup before retrying.',
      );
    }
    log(
      JSON.stringify({
        status: 'seeded',
        smallWeek: fixture.smallWeek,
        stressWeek: fixture.stressWeek,
        ...after,
      }),
    );
    return;
  }

  const attached = await readOne(
    client,
    config.databaseId,
    `SELECT COUNT(*) AS entries
    FROM meal_plan_entries WHERE household_id = ?1
      AND recipe_id IN (SELECT value FROM json_each(?2))
      AND id NOT IN (SELECT value FROM json_each(?3))`,
    [householdId, list.recipes, list.entries],
  );
  if (number(attached, 'entries') !== 0) {
    throw new Error(
      'A non-fixture plan entry uses a fixture recipe; remove it first.',
    );
  }
  for (const statement of fixtureCleanupStatements(fixture, householdId)) {
    const result = await client.executeD1Batch(
      config.databaseId,
      [statement],
      'Clean nutrition fixture',
    );
    if (result.length !== 1 || result[0].success !== true) {
      throw new Error(
        'Fixture cleanup failed; inspect counts and retry cleanup.',
      );
    }
  }
  const after = await fixtureCounts(
    client,
    config.databaseId,
    householdId,
    fixture,
  );
  if (!isCounts(after, { recipes: 0, lines: 0, matches: 0, entries: 0 })) {
    throw new Error('Fixture cleanup left rows behind; retry cleanup.');
  }
  log(
    JSON.stringify({
      status: 'cleaned',
      smallWeek: fixture.smallWeek,
      stressWeek: fixture.stressWeek,
      ...after,
    }),
  );
};
