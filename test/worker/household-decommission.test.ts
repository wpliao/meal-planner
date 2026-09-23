import { beforeEach, describe, expect, it } from 'vitest';

import { runDecommission } from '../../src/operations/household-decommission/procedure';
import { createCloudflareClient } from '../../src/operations/household-decommission/cloudflare-client';
import {
  APPLIED_MIGRATIONS_SQL,
  deletionBatch,
  DELETE_HOUSEHOLD_SQL,
  acceptableDeletionChanges,
  EXPECTED_TABLES,
  householdCountsStatement,
  TABLE_INVENTORY_SQL,
  type BoundStatement,
  type HouseholdCounts,
} from '../../src/operations/household-decommission/sql';
import { createWorker } from '../../src/worker/index';
import {
  ACCESS_APP_ID,
  ACCOUNT_ID,
  API_TOKEN,
  createFakeCloudflare,
} from '../operations/fake-cloudflare';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  seedOtherHousehold,
  seedPantryItem,
  seedRecipe,
  testEnv,
} from './helpers';

const db = () => testEnv.DB;

const prepare = ({ sql, params }: BoundStatement) =>
  db()
    .prepare(sql)
    .bind(...params);

const runBatch = (householdId: string) =>
  db().batch(deletionBatch(householdId).map(prepare));

const countsFor = async (householdId: string): Promise<HouseholdCounts> => {
  const row = await prepare(
    householdCountsStatement(householdId),
  ).first<HouseholdCounts>();
  if (!row) throw new Error('The count query returned no row.');
  return row;
};

/**
 * Bootstraps the installed household through the real API, with pantry rows
 * and a recipe that has lines.
 */
const installHousehold = async (): Promise<string> => {
  const response = await bootstrapOwner();
  expect(response.status).toBe(201);
  const body: { household: { id: string } } = await response.json();
  const householdId = body.household.id;
  await seedPantryItem(householdId, 'rice');
  await seedPantryItem(householdId, 'beans', 'low');
  await seedRecipe(householdId, 'Fried rice', {
    ingredients: ['1 cup rice', '2 eggs'],
    steps: ['Fry everything together.'],
  });
  await fetchWorker(
    new Request(
      'https://example.test/api/household/members',
      mutationInit('POST', { email: 'second@example.test' }),
    ),
  );
  return householdId;
};

const allCounts = () =>
  db()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM app_installation) AS installations,
         (SELECT COUNT(*) FROM households) AS households,
         (SELECT COUNT(*) FROM household_members) AS members,
         (SELECT COUNT(*) FROM pantry_items) AS pantry,
         (SELECT COUNT(*) FROM recipes) AS recipes,
         (SELECT COUNT(*) FROM recipe_ingredients) AS ingredients,
         (SELECT COUNT(*) FROM recipe_steps) AS steps`,
    )
    .first<Record<string, number>>();

describe('household decommission statements', () => {
  beforeEach(applyMigrations);

  it('accounts for exactly the tables and migrations of the real schema', async () => {
    const tables = await db()
      .prepare(TABLE_INVENTORY_SQL)
      .all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual(EXPECTED_TABLES);

    const migrations = await db()
      .prepare(APPLIED_MIGRATIONS_SQL)
      .all<{ name: string }>();
    expect(migrations.results.map(({ name }) => name)).toEqual(
      testEnv.TEST_MIGRATIONS.map(({ name }) => name),
    );
  });

  it('counts only the target household rows before deletion', async () => {
    const householdId = await installHousehold();
    const other = await seedOtherHousehold();

    expect(await countsFor(householdId)).toEqual({
      installation_rows: 1,
      target_installation_rows: 1,
      household_rows: 2,
      target_household_rows: 1,
      member_rows: 3,
      target_member_rows: 2,
      pantry_rows: 2,
      target_pantry_rows: 2,
      recipe_rows: 1,
      target_recipe_rows: 1,
      recipe_ingredient_rows: 2,
      target_recipe_ingredient_rows: 2,
      recipe_step_rows: 1,
      target_recipe_step_rows: 1,
    });
    expect(await countsFor(other.householdId)).toMatchObject({
      target_installation_rows: 0,
      target_household_rows: 1,
      target_member_rows: 1,
      target_pantry_rows: 0,
      target_recipe_rows: 0,
      target_recipe_ingredient_rows: 0,
      target_recipe_step_rows: 0,
    });
  });

  it('cannot delete a household while the installation pointer references it', async () => {
    const householdId = await installHousehold();
    const before = await allCounts();

    await expect(
      db()
        .prepare('DELETE FROM households WHERE id = ?1')
        .bind(householdId)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/iu);

    const guarded = await db()
      .prepare(DELETE_HOUSEHOLD_SQL)
      .bind(householdId)
      .run();
    expect(guarded.meta.changes).toBe(0);
    expect(await allCounts()).toEqual(before);
  });

  it('removes the pointer and household and cascades members, pantry, and recipe rows', async () => {
    const householdId = await installHousehold();
    const other = await seedOtherHousehold();
    await seedPantryItem(other.householdId, 'rice');
    await seedRecipe(other.householdId, 'Other Family Soup');

    const preflight = await countsFor(householdId);
    const results = await runBatch(householdId);

    // The Workers-runtime engine includes every cascaded row: 1 household,
    // 2 members, 2 pantry items, 1 recipe, 2 ingredients, and 1 step.
    const [cascadeInclusive] = acceptableDeletionChanges(preflight);
    expect(cascadeInclusive).toEqual([1, 9]);
    expect(results.map(({ meta }) => meta.changes)).toEqual(cascadeInclusive);
    expect(await countsFor(householdId)).toEqual({
      installation_rows: 0,
      target_installation_rows: 0,
      household_rows: 1,
      target_household_rows: 0,
      member_rows: 1,
      target_member_rows: 0,
      pantry_rows: 1,
      target_pantry_rows: 0,
      recipe_rows: 1,
      target_recipe_rows: 0,
      recipe_ingredient_rows: 1,
      target_recipe_ingredient_rows: 0,
      recipe_step_rows: 1,
      target_recipe_step_rows: 0,
    });
    expect(await countsFor(other.householdId)).toMatchObject({
      target_household_rows: 1,
      target_member_rows: 1,
      target_pantry_rows: 1,
      target_recipe_rows: 1,
      target_recipe_ingredient_rows: 1,
      target_recipe_step_rows: 1,
    });
  });

  it('deletes nothing when the reviewed household is not the installed one', async () => {
    const householdId = await installHousehold();
    const other = await seedOtherHousehold();
    const before = await allCounts();

    const results = await runBatch(other.householdId);

    expect(results.map(({ meta }) => meta.changes)).toEqual([0, 0]);
    expect(await allCounts()).toEqual(before);
    expect(await countsFor(householdId)).toMatchObject({
      target_installation_rows: 1,
      target_household_rows: 1,
    });
  });

  it('deletes nothing for an unknown household ID', async () => {
    await installHousehold();
    const before = await allCounts();
    const results = await runBatch(crypto.randomUUID());
    expect(results.map(({ meta }) => meta.changes)).toEqual([0, 0]);
    expect(await allCounts()).toEqual(before);
  });

  it('rolls back the pointer delete when the household delete fails', async () => {
    const householdId = await installHousehold();
    const before = await allCounts();
    await db()
      .prepare(
        `CREATE TRIGGER rehearse_household_delete_failure
           BEFORE DELETE ON households
         BEGIN
           SELECT RAISE(ABORT, 'rehearsed household delete failure');
         END`,
      )
      .run();

    try {
      await expect(runBatch(householdId)).rejects.toThrow(
        /rehearsed household delete failure/u,
      );
      expect(await allCounts()).toEqual(before);
      expect(await countsFor(householdId)).toMatchObject({
        target_installation_rows: 1,
        target_household_rows: 1,
      });
    } finally {
      await db()
        .prepare('DROP TRIGGER IF EXISTS rehearse_household_delete_failure')
        .run();
    }
  });

  it('keeps bootstrap closed to everyone but the configured identity after deletion', async () => {
    const householdId = await installHousehold();
    await runBatch(householdId);

    // A former member, or anyone else Access might let through, is refused.
    const outsider = createWorker(() =>
      Promise.resolve({
        subject: 'former-subject',
        email: 'second@example.test',
      }),
    );
    const session = await outsider.fetch(
      new Request('https://example.test/api/session'),
      testEnv,
    );
    await expect(session.json()).resolves.toEqual({ status: 'not-a-member' });
    const bootstrap = await outsider.fetch(
      new Request(
        'https://example.test/api/bootstrap',
        mutationInit('POST', { householdName: 'Taken Over' }),
      ),
      testEnv,
    );
    expect(bootstrap.status).toBe(403);

    // With no bootstrap secret configured, setup fails closed for everyone.
    const unconfigured = await createWorker(() =>
      Promise.resolve({
        subject: 'owner-subject',
        email: 'owner@example.test',
      }),
    ).fetch(
      new Request(
        'https://example.test/api/bootstrap',
        mutationInit('POST', { householdName: 'Reopened' }),
      ),
      { ...testEnv, APP_ENV: 'development', BOOTSTRAP_OWNER_EMAIL: undefined },
    );
    expect(unconfigured.status).toBe(503);
    expect(await allCounts()).toEqual({
      installations: 0,
      households: 0,
      members: 0,
      pantry: 0,
      recipes: 0,
      ingredients: 0,
      steps: 0,
    });

    // The Worker itself would offer setup again to the configured bootstrap
    // identity, which is why Access and the Worker route must already be
    // closed before the pointer is removed, and must stay closed.
    const setup = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    await expect(setup.json()).resolves.toEqual({ status: 'setup-required' });
  });
});

describe('household decommission procedure against the real schema', () => {
  beforeEach(applyMigrations);

  /** A fake Cloudflare API whose D1 endpoint runs the SQL on the test binding. */
  const cloudflareOnTestD1 = () =>
    createFakeCloudflare({
      d1: async (statements, isBatch) => {
        const results = isBatch
          ? await db().batch(statements.map(prepare))
          : [await prepare(statements[0]).all()];
        return results.map(({ success, results: rows, meta }) => ({
          success,
          results: rows,
          meta: { changes: meta.changes },
        }));
      },
    });

  const configFor = (householdId: string) => ({
    environment: 'development' as const,
    householdId,
    databaseId: '5f5e98ba-7b27-4fcf-8c2b-ab1605461082',
    databaseName: 'family-meal-planner-dev-d1',
    workerName: 'family-meal-planner-development',
    accessAppId: ACCESS_APP_ID,
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    approvalReference:
      'https://github.com/wpliao/meal-planner/issues/32#issuecomment-1',
    expectedMigrations: testEnv.TEST_MIGRATIONS.map(({ name }) => name),
  });

  const run = (householdId: string, fake = cloudflareOnTestD1()) => {
    const lines: string[] = [];
    const result = runDecommission(configFor(householdId), {
      client: createCloudflareClient({
        accountId: ACCOUNT_ID,
        apiToken: API_TOKEN,
        fetch: fake.fetch,
        sleep: () => Promise.resolve(),
      }),
      log: (line) => lines.push(line),
      now: () => new Date(0),
    });
    return { result, lines, fake };
  };

  it('deletes the installed household through the REST request shape', async () => {
    const householdId = await installHousehold();

    const { result, lines } = run(householdId);

    await expect(result).resolves.toMatchObject({
      preflightCounts: {
        target_member_rows: 2,
        target_pantry_rows: 2,
        target_recipe_rows: 1,
        target_recipe_ingredient_rows: 2,
        target_recipe_step_rows: 1,
      },
      finalCounts: {
        installation_rows: 0,
        household_rows: 0,
        member_rows: 0,
        pantry_rows: 0,
        recipe_rows: 0,
        recipe_ingredient_rows: 0,
        recipe_step_rows: 0,
      },
    });
    expect(await allCounts()).toEqual({
      installations: 0,
      households: 0,
      members: 0,
      pantry: 0,
      recipes: 0,
      ingredients: 0,
      steps: 0,
    });
    expect(lines.join('\n')).not.toMatch(
      /@example\.test|Liao Family|rice|eggs|Fry/u,
    );
  });

  it('refuses a household that is not the installed one without deleting anything', async () => {
    await installHousehold();
    const other = await seedOtherHousehold();
    const before = await allCounts();

    const { result, fake } = run(other.householdId);

    await expect(result).rejects.toMatchObject({
      stage: 'preflight',
      d1: 'untouched',
    });
    expect(fake.callsTo('d1-batch')).toHaveLength(0);
    expect(await allCounts()).toEqual(before);
  });

  it('refuses a second run after a completed deletion', async () => {
    const householdId = await installHousehold();
    await expect(run(householdId).result).resolves.toBeDefined();

    const retry = run(householdId);
    await expect(retry.result).rejects.toMatchObject({
      stage: 'preflight',
      message: expect.stringContaining('previous run') as unknown,
    });
    expect(retry.fake.callsTo('d1-batch')).toHaveLength(0);
  });
});
