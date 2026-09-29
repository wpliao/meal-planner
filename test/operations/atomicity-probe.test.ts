import { describe, expect, it } from 'vitest';

import {
  COUNT_PROBE_SQL,
  DELETE_PROBE_SQL,
  INSERT_PROBE_SQL,
  PROBE_HOUSEHOLD_NAME,
} from '../../src/operations/household-decommission/atomicity-probe.ts';
import {
  PROBE_CONFIRMATION,
  runProbeCli,
} from '../../src/operations/household-decommission/probe-cli.ts';
import type { BoundStatement } from '../../src/operations/household-decommission/sql.ts';
import {
  ACCOUNT_ID,
  API_TOKEN,
  createFakeCloudflare,
  DEVELOPMENT_D1_ID,
  PRODUCTION_D1_ID,
  withHttpFailures,
  WRANGLER_CONFIG_TEXT,
  type D1Handler,
} from './fake-cloudflare';

const wranglerText = WRANGLER_CONFIG_TEXT;

const PROBE_ID = '0b5b3c1e-2f4d-4a6b-8c9d-0e1f2a3b4c5d';

type Behavior = 'atomic' | 'not-atomic' | 'accepts-duplicates';

/**
 * An in-memory `households` table that models how a batch commits: `atomic`
 * keeps nothing from a failed batch, `not-atomic` keeps the statements before
 * the failure, and `accepts-duplicates` never fails. `keepOnDelete` makes the
 * cleanup statement remove nothing.
 */
const probeDatabase = (
  behavior: Behavior,
  { rows = new Set<string>(), keepOnDelete = false } = {},
) => {
  const handler: D1Handler = (statements) => {
    const staged = new Set(rows);
    const results: Record<string, unknown>[] = [];
    for (const { sql, params } of statements as BoundStatement[]) {
      const [id] = params;
      if (sql === COUNT_PROBE_SQL) {
        results.push({
          success: true,
          results: [{ probe_rows: staged.has(id) ? 1 : 0 }],
          meta: { changes: 0 },
        });
      } else if (sql === INSERT_PROBE_SQL) {
        if (staged.has(id) && behavior !== 'accepts-duplicates') {
          if (behavior === 'not-atomic') staged.forEach((row) => rows.add(row));
          return Promise.reject(new Error('UNIQUE constraint failed'));
        }
        staged.add(id);
        results.push({ success: true, results: [], meta: { changes: 1 } });
      } else if (sql === DELETE_PROBE_SQL) {
        const removed = !keepOnDelete && staged.delete(id);
        results.push({
          success: true,
          results: [],
          meta: { changes: removed ? 1 : 0 },
        });
      } else {
        return Promise.reject(
          new Error(`Unexpected SQL in probe fake: ${sql}`),
        );
      }
    }
    rows.clear();
    staged.forEach((row) => rows.add(row));
    return Promise.resolve(results);
  };
  return { rows, handler };
};

const probeInputs = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  PROBE_ENVIRONMENT: 'development',
  PROBE_EXPECTED_D1_DATABASE_ID: DEVELOPMENT_D1_ID,
  PROBE_CONFIRMATION,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: API_TOKEN,
  GITHUB_REF: 'refs/heads/main',
  ...overrides,
});

const runProbe = async (
  fake: ReturnType<typeof createFakeCloudflare>,
  env = probeInputs(),
) => {
  const lines: string[] = [];
  const exitCode = await runProbeCli({
    env,
    readWranglerConfig: () => Promise.resolve(wranglerText),
    fetch: withHttpFailures(fake.fetch),
    log: (line) => lines.push(line),
    now: () => new Date(0),
    newId: () => PROBE_ID,
    sleep: () => Promise.resolve(),
  });
  const records = lines.map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
  expect(lines.join('\n')).not.toContain(API_TOKEN);
  return { exitCode, records };
};

const fakeWith = (
  behavior: Behavior,
  options: Parameters<typeof probeDatabase>[1] = {},
) => {
  const database = probeDatabase(behavior, options);
  return {
    database,
    fake: createFakeCloudflare({ d1: database.handler }),
  };
};

const batchBodies = (fake: ReturnType<typeof createFakeCloudflare>) =>
  fake
    .callsTo('d1-batch')
    .map(({ body }) => (body as { batch: unknown }).batch);

describe('D1 batch atomicity probe', () => {
  it('reports atomic when the failed batch left no row', async () => {
    const { fake, database } = fakeWith('atomic');
    const { exitCode, records } = await runProbe(fake);

    expect(exitCode).toBe(0);
    expect(records.at(-1)).toMatchObject({
      status: 'passed',
      verdict: 'atomic',
    });
    expect(batchBodies(fake)).toEqual([
      [
        {
          sql: INSERT_PROBE_SQL,
          params: [PROBE_ID, PROBE_HOUSEHOLD_NAME, '1970-01-01T00:00:00.000Z'],
        },
        {
          sql: INSERT_PROBE_SQL,
          params: [PROBE_ID, PROBE_HOUSEHOLD_NAME, '1970-01-01T00:00:00.000Z'],
        },
      ],
    ]);
    expect(database.rows.size).toBe(0);
  });

  it('reports not atomic and removes its own row when the first insert stayed', async () => {
    const { fake, database } = fakeWith('not-atomic');
    const { exitCode, records } = await runProbe(fake);

    expect(exitCode).toBe(1);
    expect(records).toContainEqual(
      expect.objectContaining({
        stage: 'inspect',
        probeRows: 1,
        verdict: 'not-atomic',
      }),
    );
    expect(records.at(-1)).toMatchObject({
      status: 'failed',
      verdict: 'not-atomic',
    });
    expect(batchBodies(fake).at(-1)).toEqual([
      { sql: DELETE_PROBE_SQL, params: [PROBE_ID, PROBE_HOUSEHOLD_NAME] },
    ]);
    expect(database.rows.size).toBe(0);
  });

  it('fails and cleans up when a batch with a repeated key reports success', async () => {
    const { fake, database } = fakeWith('accepts-duplicates');
    const { exitCode, records } = await runProbe(fake);

    expect(exitCode).toBe(1);
    expect(records.at(-1)?.message).toContain(
      'Stage batch failed: The probe batch reported success',
    );
    expect(database.rows.size).toBe(0);
  });

  it('refuses to run when a row with the fresh probe ID already exists', async () => {
    const { fake } = fakeWith('atomic', { rows: new Set([PROBE_ID]) });
    const { exitCode, records } = await runProbe(fake);
    expect(exitCode).toBe(1);
    expect(fake.callsTo('d1-batch')).toHaveLength(0);
    expect(records.at(-1)?.message).toContain(
      'Stage preflight failed: A row with the fresh probe ID already exists.',
    );
  });

  it('fails when its own row cannot be removed', async () => {
    const { fake, database } = fakeWith('not-atomic', { keepOnDelete: true });
    const { exitCode, records } = await runProbe(fake);
    expect(exitCode).toBe(1);
    expect(records.at(-1)?.message).toContain(
      'Stage cleanup failed: The probe row could not be removed (1 remain).',
    );
    expect(database.rows).toEqual(new Set([PROBE_ID]));
  });

  it('refuses a database that does not match the reviewed environment', async () => {
    const database = probeDatabase('atomic');
    const fake = createFakeCloudflare({
      d1: database.handler,
      state: { databaseName: 'family-meal-planner-prod-d1' },
    });
    const { exitCode, records } = await runProbe(fake);
    expect(exitCode).toBe(1);
    expect(fake.callsTo('d1-batch')).toHaveLength(0);
    expect(records.at(-1)?.message).toContain('does not match');
  });

  it.each([
    ['production', { PROBE_ENVIRONMENT: 'production' }, 'must be development'],
    ['another branch', { GITHUB_REF: 'refs/heads/feature' }, 'refs/heads/main'],
    [
      'a missing confirmation',
      { PROBE_CONFIRMATION: 'yes' },
      PROBE_CONFIRMATION,
    ],
    [
      'the production database',
      {
        PROBE_EXPECTED_D1_DATABASE_ID: PRODUCTION_D1_ID,
      },
      'does not match the development database',
    ],
    ['a malformed account ID', { CLOUDFLARE_ACCOUNT_ID: 'abc' }, 'account ID'],
    ['no token', { CLOUDFLARE_API_TOKEN: ' ' }, 'CLOUDFLARE_API_TOKEN'],
  ])('refuses %s before any Cloudflare call', async (_, overrides, message) => {
    const { fake } = fakeWith('atomic');
    const { exitCode, records } = await runProbe(fake, probeInputs(overrides));
    expect(exitCode).toBe(1);
    expect(fake.calls).toHaveLength(0);
    expect(records).toEqual([
      expect.objectContaining({
        stage: 'approval',
        status: 'failed',
        message: expect.stringContaining(message) as unknown,
      }),
    ]);
  });

  it('keeps the token out of every line when a request fails with it', async () => {
    const { fake } = fakeWith('atomic');
    fake.queue('d1-database', {
      kind: 'throw',
      error: new Error(`connect failed for Bearer ${API_TOKEN}`),
    });
    const { exitCode } = await runProbe(fake);
    expect(exitCode).toBe(1);
  });
});
