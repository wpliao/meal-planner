import { beforeEach, describe, expect, it } from 'vitest';

import {
  PROBE_HOUSEHOLD_NAME,
  runAtomicityProbe,
} from '../../src/operations/household-decommission/atomicity-probe';
import { createCloudflareClient } from '../../src/operations/household-decommission/cloudflare-client';
import type { BoundStatement } from '../../src/operations/household-decommission/sql';
import {
  ACCOUNT_ID,
  API_TOKEN,
  createFakeCloudflare,
  DEVELOPMENT_D1_ID,
  withHttpFailures,
  type D1Handler,
} from '../operations/fake-cloudflare';
import { applyMigrations, bootstrapOwner, testEnv } from './helpers';

const db = () => testEnv.DB;

const prepare = ({ sql, params }: BoundStatement) =>
  db()
    .prepare(sql)
    .bind(...params);

const asRows = (results: readonly D1Result[]) =>
  results.map(({ success, results: rows, meta }) => ({
    success,
    results: rows,
    meta: { changes: meta.changes },
  }));

/** The real binding, whose `batch()` is a documented transaction. */
const transactionalD1: D1Handler = async (statements, isBatch) =>
  asRows(
    isBatch
      ? await db().batch(statements.map(prepare))
      : [await prepare(statements[0]).all()],
  );

/**
 * A non-atomic transport: each statement commits on its own, as it would if
 * the REST API ran a batch without a transaction.
 */
const statementByStatementD1: D1Handler = async (statements) => {
  const results: D1Result[] = [];
  for (const statement of statements) {
    results.push(await prepare(statement).all());
  }
  return asRows(results);
};

const probeWith = (d1: D1Handler) =>
  runAtomicityProbe(
    {
      databaseId: DEVELOPMENT_D1_ID,
      databaseName: 'family-meal-planner-dev-d1',
      apiToken: API_TOKEN,
    },
    {
      client: createCloudflareClient({
        accountId: ACCOUNT_ID,
        apiToken: API_TOKEN,
        fetch: withHttpFailures(createFakeCloudflare({ d1 }).fetch),
        sleep: () => Promise.resolve(),
      }),
      log: () => undefined,
      now: () => new Date(0),
      newId: () => crypto.randomUUID(),
    },
  );

const households = async () =>
  (
    await db()
      .prepare('SELECT id, name FROM households ORDER BY id')
      .all<{ id: string; name: string }>()
  ).results;

describe('D1 batch atomicity probe against the real schema', () => {
  beforeEach(async () => {
    await applyMigrations();
    expect((await bootstrapOwner()).status).toBe(201);
  });

  it('finds a transactional batch atomic and leaves every household alone', async () => {
    const before = await households();
    await expect(probeWith(transactionalD1)).resolves.toBe('atomic');
    expect(await households()).toEqual(before);
  });

  it('detects a batch that commits statement by statement and removes only its own row', async () => {
    const before = await households();
    await expect(probeWith(statementByStatementD1)).resolves.toBe('not-atomic');
    expect(await households()).toEqual(before);
    expect(before.map(({ name }) => name)).not.toContain(PROBE_HOUSEHOLD_NAME);
  });
});
