import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/operations/household-decommission/cli.ts';
import { createCloudflareClient } from '../../src/operations/household-decommission/cloudflare-client.ts';
import {
  parseDecommissionConfig,
  parseJsonc,
  PRODUCTION_INELIGIBLE_MESSAGE,
} from '../../src/operations/household-decommission/config.ts';
import {
  describeFailure,
  ProcedureFailure,
  runDecommission,
} from '../../src/operations/household-decommission/procedure.ts';
import {
  DELETE_HOUSEHOLD_SQL,
  DELETE_INSTALLATION_POINTER_SQL,
} from '../../src/operations/household-decommission/sql.ts';
import {
  API_TOKEN,
  createFakeCloudflare,
  denyEveryonePolicy,
  HOUSEHOLD_ID,
  installedCounts,
  MIGRATIONS,
  OTHER_HOUSEHOLD_ID,
  TABLES,
  validInputs,
  WORKER_HOST,
  type FakeState,
} from './fake-cloudflare';

const wranglerText = await readFile(
  new URL('../../wrangler.jsonc', import.meta.url),
  'utf8',
);

type Fake = ReturnType<typeof createFakeCloudflare>;

interface LogLine {
  time: string;
  stage?: string;
  status: string;
  message?: string;
  d1?: string;
  counts?: Record<string, number>;
  [key: string]: unknown;
}

const run = async (
  fake: Fake,
  inputs: Record<string, string | undefined> = validInputs(),
) => {
  const lines: string[] = [];
  const exitCode = await runCli({
    env: inputs,
    readWranglerConfig: () => Promise.resolve(wranglerText),
    listMigrationFiles: () => Promise.resolve([...MIGRATIONS, 'README.md']),
    fetch: fake.fetch,
    log: (line) => lines.push(line),
    now: () => new Date('2026-09-22T12:00:00.000Z'),
    sleep: () => Promise.resolve(),
  });
  const records = lines.map((line) => JSON.parse(line) as LogLine);
  return { exitCode, lines, records, output: lines.join('\n') };
};

const withState = (state: Partial<FakeState>) =>
  createFakeCloudflare({ state });

const expectD1Untouched = (fake: Fake) => {
  expect(fake.callsTo('d1-batch')).toHaveLength(0);
};

const failureRecord = (records: LogLine[]) =>
  records.find(({ status, stage }) => status === 'failed' && stage);

/** Keys a log line may carry: environment, opaque IDs, counts, stages, times. */
const ALLOWED_KEYS = new Set([
  'time',
  'environment',
  'householdId',
  'databaseId',
  'approvalReference',
  'stage',
  'status',
  'message',
  'counts',
  'bookmark',
  'd1',
  'changes',
]);

describe('household decommission procedure', () => {
  it('runs preflight, closure, one deletion batch, and verification in order', async () => {
    const fake = createFakeCloudflare();
    const { exitCode, records } = await run(fake);

    expect(exitCode).toBe(0);
    expect(records.map(({ stage, status }) => `${stage}:${status}`)).toEqual([
      'approval:passed',
      'preflight:started',
      'preflight:passed',
      'close-access:started',
      'close-access:passed',
      'delete:started',
      'delete:passed',
      'verify:started',
      'verify:passed',
    ]);
    expect(records.at(-1)?.counts).toEqual(fake.state.countsAfterDelete);
    expect(records[2]?.counts).toEqual(installedCounts());
    expect(records[2]?.bookmark).toMatch(/^[0-9a-f-]+$/u);

    // Every stage before deletion finished before the one batch request.
    const batchIndex = fake.calls.findIndex(
      ({ body }) => (body as { batch?: unknown } | undefined)?.batch,
    );
    const accessIndex = fake.calls.findIndex(({ path }) =>
      path.endsWith('/policies'),
    );
    expect(accessIndex).toBeGreaterThan(-1);
    expect(accessIndex).toBeLessThan(batchIndex);
  });

  it('sends the exact parameterized batch in a single D1 REST request', async () => {
    const fake = createFakeCloudflare();
    await run(fake);

    const [batch, ...others] = fake.callsTo('d1-batch');
    expect(others).toHaveLength(0);
    expect(batch.method).toBe('POST');
    expect(batch.path).toBe(
      '/client/v4/accounts/0123456789abcdef0123456789abcdef/d1/database/5f5e98ba-7b27-4fcf-8c2b-ab1605461082/query',
    );
    expect(batch.headers).toMatchObject({
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json',
    });
    expect(batch.body).toEqual({
      batch: [
        { sql: DELETE_INSTALLATION_POINTER_SQL, params: [HOUSEHOLD_ID] },
        { sql: DELETE_HOUSEHOLD_SQL, params: [HOUSEHOLD_ID] },
      ],
    });
    const sql = JSON.stringify(batch.body);
    expect(sql).not.toContain(`'${HOUSEHOLD_ID}'`);
  });

  it('prints only environment, opaque IDs, counts, stages, and timestamps', async () => {
    const { records, output } = await run(createFakeCloudflare());
    for (const record of records) {
      for (const key of Object.keys(record))
        expect(ALLOWED_KEYS).toContain(key);
    }
    expect(output).not.toContain(API_TOKEN);
    expect(output).not.toMatch(/@|Bearer|authorization/iu);
  });

  describe('approval', () => {
    it.each([
      ['a missing approval', { DECOMMISSION_APPROVAL_REFERENCE: undefined }],
      [
        'an invalid approval',
        { DECOMMISSION_APPROVAL_REFERENCE: 'https://example.test/approval' },
      ],
      ['a missing confirmation', { DECOMMISSION_CONFIRMATION: undefined }],
      ['a wrong confirmation', { DECOMMISSION_CONFIRMATION: 'yes' }],
      ['a branch other than main', { GITHUB_REF: 'refs/pull/1/merge' }],
    ])('stops on %s before any Cloudflare call', async (_, overrides) => {
      const fake = createFakeCloudflare();
      const { exitCode, records } = await run(fake, validInputs(overrides));
      expect(exitCode).toBe(1);
      expect(fake.calls).toHaveLength(0);
      expect(records).toEqual([
        expect.objectContaining({
          stage: 'approval',
          status: 'failed',
          d1: 'untouched',
        }),
      ]);
    });

    it('refuses production before any Cloudflare call', async () => {
      const fake = createFakeCloudflare();
      const { exitCode, records } = await run(
        fake,
        validInputs({
          DECOMMISSION_ENVIRONMENT: 'production',
          DECOMMISSION_CONFIRMATION: 'DECOMMISSION_PRODUCTION_HOUSEHOLD',
          DECOMMISSION_EXPECTED_D1_DATABASE_ID:
            'd944b652-580f-437e-b7ce-21818525c46c',
        }),
      );
      expect(exitCode).toBe(1);
      expect(fake.calls).toHaveLength(0);
      expect(records[0]?.message).toBe(PRODUCTION_INELIGIBLE_MESSAGE);
    });

    it('stops without detail when the repository configuration is unreadable', async () => {
      const fake = createFakeCloudflare();
      const lines: string[] = [];
      const exitCode = await runCli({
        env: validInputs(),
        readWranglerConfig: () =>
          Promise.reject(new Error(`cannot read ${API_TOKEN}`)),
        listMigrationFiles: () => Promise.resolve(MIGRATIONS),
        fetch: fake.fetch,
        log: (line) => lines.push(line),
        now: () => new Date(0),
      });
      expect(exitCode).toBe(1);
      expect(fake.calls).toHaveLength(0);
      expect(lines.join('\n')).not.toContain(API_TOKEN);
      expect(lines.join('\n')).toContain('could not be read');
    });
  });

  describe('target mismatch', () => {
    it.each<[string, Partial<FakeState>]>([
      [
        'a different D1 database name',
        { databaseName: 'family-meal-planner-prod-d1' },
      ],
      [
        'a different D1 database UUID',
        { databaseUuid: 'd944b652-580f-437e-b7ce-21818525c46c' },
      ],
      ['a missing applied migration', { migrations: [MIGRATIONS[0]] }],
      [
        'an unreviewed applied migration',
        { migrations: [...MIGRATIONS, '0003_create_recipes.sql'] },
      ],
      [
        'migrations applied out of order',
        { migrations: [...MIGRATIONS].reverse() },
      ],
      [
        'an unaccounted table such as recipes',
        {
          tables: [...TABLES, 'recipes'].sort((a, b) =>
            a.localeCompare(b, 'en'),
          ),
        },
      ],
      [
        'a missing table',
        { tables: TABLES.filter((name) => name !== 'pantry_items') },
      ],
      [
        'an installation that points at another household',
        { counts: installedCounts({ target_installation_rows: 0 }) },
      ],
      [
        'no installation pointer',
        {
          counts: installedCounts({
            installation_rows: 0,
            target_installation_rows: 0,
          }),
        },
      ],
      [
        'a second household',
        { counts: installedCounts({ household_rows: 2 }) },
      ],
      [
        'a missing target household',
        {
          counts: installedCounts({
            target_household_rows: 0,
            target_installation_rows: 0,
          }),
        },
      ],
      [
        'members outside the target household',
        { counts: installedCounts({ member_rows: 4 }) },
      ],
      [
        'pantry rows outside the target household',
        { counts: installedCounts({ pantry_rows: 6 }) },
      ],
    ])('stops on %s with D1 untouched', async (_, state) => {
      const fake = withState(state);
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expectD1Untouched(fake);
      expect(failureRecord(records)).toMatchObject({
        stage: 'preflight',
        d1: 'untouched',
      });
      // Closure is not even inspected once preflight has failed.
      expect(fake.callsTo('access-policies')).toHaveLength(0);
    });

    it('stops when the expected household is not the installed one', async () => {
      const fake = withState({
        counts: installedCounts({
          target_installation_rows: 0,
          target_household_rows: 0,
        }),
      });
      const { exitCode, records } = await run(
        fake,
        validInputs({ DECOMMISSION_EXPECTED_HOUSEHOLD_ID: OTHER_HOUSEHOLD_ID }),
      );
      expect(exitCode).toBe(1);
      expectD1Untouched(fake);
      const [read] = fake
        .callsTo('d1-read')
        .filter(({ body }) => (body as { params: string[] }).params.length > 0);
      expect((read.body as { params: string[] }).params).toEqual([
        OTHER_HOUSEHOLD_ID,
      ]);
      expect(failureRecord(records)?.message).toContain(
        'exactly one installed household',
      );
    });

    it.each([
      ['a missing field', [{ installation_rows: 1 }]],
      ['two rows', [installedCounts(), installedCounts()]],
      ['a non-numeric count', [{ ...installedCounts(), household_rows: '1' }]],
      ['a negative count', [{ ...installedCounts(), pantry_rows: -1 }]],
    ])('stops when the count query returns %s', async (_, rows) => {
      const fake = createFakeCloudflare();
      fake.queue('d1-read', {
        kind: 'result',
        result: [
          { success: true, results: MIGRATIONS.map((name) => ({ name })) },
        ],
      });
      fake.queue('d1-read', {
        kind: 'result',
        result: [{ success: true, results: TABLES.map((name) => ({ name })) }],
      });
      fake.queue('d1-read', {
        kind: 'result',
        result: [{ success: true, results: rows }],
      });
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expectD1Untouched(fake);
      expect(failureRecord(records)?.message).toBe(
        'The count query returned an unexpected result.',
      );
    });
  });

  describe('access closure', () => {
    it.each<[string, Partial<FakeState>]>([
      ['the workers.dev route is enabled', { workersDevEnabled: true }],
      ['preview URLs are enabled', { previewsEnabled: true }],
      [
        'a custom domain is attached',
        { customDomains: ['meals.example.test'] },
      ],
      [
        'the Access application protects another host',
        { accessApp: { domain: 'other.example-account.workers.dev' } },
      ],
      ['the Access application lists no host', { accessApp: {} }],
      [
        'an allow policy remains',
        {
          policies: [
            denyEveryonePolicy(),
            {
              decision: 'allow',
              include: [{ email: { email: 'x@example.test' } }],
            },
          ],
        },
      ],
      [
        'a bypass policy remains',
        { policies: [{ decision: 'bypass', include: [{ everyone: {} }] }] },
      ],
      ['there are no policies', { policies: [] }],
      [
        'the deny policy excludes someone',
        {
          policies: [
            {
              ...denyEveryonePolicy(),
              exclude: [{ email: { email: 'x@example.test' } }],
            },
          ],
        },
      ],
      [
        'the deny policy is conditional',
        { policies: [{ ...denyEveryonePolicy(), require: [{ geo: {} }] }] },
      ],
      [
        'the deny policy does not cover everyone',
        {
          policies: [
            { ...denyEveryonePolicy(), include: [{ email_domain: {} }] },
          ],
        },
      ],
    ])('stops with D1 untouched when %s', async (_, state) => {
      const fake = withState(state);
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expectD1Untouched(fake);
      expect(failureRecord(records)).toMatchObject({
        stage: 'close-access',
        d1: 'untouched',
      });
    });

    it('accepts the host from a destinations list or a legacy domain list', async () => {
      const fromDestinations = withState({
        accessApp: {
          destinations: [{ type: 'public', uri: `${WORKER_HOST}/` }],
        },
      });
      expect((await run(fromDestinations)).exitCode).toBe(0);

      const fromLegacyList = withState({
        accessApp: {
          self_hosted_domains: [`https://${WORKER_HOST.toUpperCase()}`],
        },
      });
      expect((await run(fromLegacyList)).exitCode).toBe(0);
    });

    it.each([
      ['the Access API denies the token', 'access-policies', 403],
      ['the Access application is missing', 'access-app', 404],
      ['the Worker state cannot be read', 'worker-subdomain', 403],
    ])('stops with D1 untouched when %s', async (_, key, status) => {
      const fake = createFakeCloudflare();
      fake.queue(key, { kind: 'http', status });
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expectD1Untouched(fake);
      expect(failureRecord(records)).toMatchObject({
        stage: 'close-access',
        d1: 'untouched',
        message: expect.stringContaining(`HTTP ${status}`) as unknown,
      });
    });

    it('fails verification if access reopens after deletion', async () => {
      const fake = createFakeCloudflare();
      fake.queue(
        'worker-subdomain',
        { kind: 'result', result: { enabled: false, previews_enabled: false } },
        { kind: 'result', result: { enabled: true, previews_enabled: false } },
      );
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'verify',
        d1: 'deleted',
      });
    });
  });

  describe('deletion batch', () => {
    it.each([
      ['only the household row', [1, 1]],
      ['the household and its cascaded rows', [1, 9]],
    ])('accepts a batch that reports %s', async (_, changes) => {
      const { exitCode, records } = await run(
        withState({ batchChanges: changes }),
      );
      expect(exitCode).toBe(0);
      expect(
        records.find(
          ({ stage, status }) => stage === 'delete' && status === 'passed',
        )?.changes,
      ).toEqual(changes);
    });

    it.each([
      ['a partial cascade count', [1, 2]],
      ['an extra row', [1, 10]],
      ['two pointer rows', [2, 9]],
    ])('rejects a batch that reports %s', async (_, changes) => {
      const { exitCode, records } = await run(
        withState({ batchChanges: changes }),
      );
      expect(exitCode).toBe(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'delete',
        d1: 'unknown',
      });
    });

    it.each([
      ['a pointer-only result', [1, 0]],
      ['a household-only result', [0, 1]],
      ['no deletions', [0, 0]],
      ['a missing statement result', [1]],
    ])('treats %s as a failure and keeps access closed', async (_, changes) => {
      const fake = withState({ batchChanges: changes });
      if (changes.length === 1) {
        fake.queue('d1-batch', {
          kind: 'result',
          result: [{ success: true, results: [], meta: { changes: 1 } }],
        });
      }
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(fake.callsTo('d1-batch')).toHaveLength(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'delete',
        d1: 'unknown',
      });
      expect(fake.callsTo('access-policies')).toHaveLength(1);
    });

    it('treats a statement that reports no success as a failure', async () => {
      const fake = createFakeCloudflare();
      fake.queue('d1-batch', {
        kind: 'result',
        result: [
          { success: true, meta: { changes: 1 } },
          { success: false, meta: { changes: 1 } },
        ],
      });
      const { exitCode } = await run(fake);
      expect(exitCode).toBe(1);
    });

    it('treats a malformed batch response as a failure', async () => {
      const fake = createFakeCloudflare();
      fake.queue('d1-batch', { kind: 'result', result: { changes: 2 } });
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'delete',
        d1: 'unknown',
      });
    });

    it.each([
      ['a server error', { kind: 'http', status: 503 } as const],
      ['a rate limit', { kind: 'http', status: 429 } as const],
      ['a rejected SQL batch', { kind: 'http', status: 400 } as const],
      [
        'a network error',
        { kind: 'throw', error: new TypeError('fetch failed') } as const,
      ],
    ])('never retries the destructive batch after %s', async (_, reply) => {
      const fake = createFakeCloudflare();
      fake.queue('d1-batch', reply);
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(fake.callsTo('d1-batch')).toHaveLength(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'delete',
        d1: 'unknown',
      });
      // Nothing after the failed batch: no verification, no reopening.
      expect(records.some(({ stage }) => stage === 'verify')).toBe(false);
    });
  });

  describe('verification', () => {
    it.each([
      [
        'a remaining pointer',
        { installation_rows: 1, target_installation_rows: 1 },
      ],
      [
        'a remaining household',
        { household_rows: 1, target_household_rows: 1 },
      ],
      ['remaining members', { member_rows: 1, target_member_rows: 1 }],
      ['remaining pantry rows', { pantry_rows: 2, target_pantry_rows: 2 }],
    ])('fails when verification finds %s', async (_, remaining) => {
      const fake = withState({
        countsAfterDelete: {
          ...installedCounts({
            installation_rows: 0,
            target_installation_rows: 0,
            household_rows: 0,
            target_household_rows: 0,
            member_rows: 0,
            target_member_rows: 0,
            pantry_rows: 0,
            target_pantry_rows: 0,
          }),
          ...remaining,
        },
      });
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(failureRecord(records)).toMatchObject({
        stage: 'verify',
        d1: 'deleted',
        counts: expect.objectContaining(remaining) as unknown,
      });
    });
  });

  describe('retries', () => {
    it('retries a transient read and then succeeds', async () => {
      const fake = createFakeCloudflare();
      fake.queue(
        'd1-database',
        { kind: 'http', status: 503 },
        { kind: 'http', status: 429 },
      );
      fake.queue('access-policies', {
        kind: 'throw',
        error: new TypeError('fetch failed'),
      });
      const { exitCode } = await run(fake);
      expect(exitCode).toBe(0);
      expect(fake.callsTo('d1-database')).toHaveLength(3);
      expect(fake.callsTo('d1-batch')).toHaveLength(1);
    });

    it('stops with D1 untouched when a read keeps failing', async () => {
      const fake = createFakeCloudflare();
      fake.queue(
        'bookmark',
        { kind: 'http', status: 502 },
        { kind: 'http', status: 502 },
        { kind: 'http', status: 502 },
      );
      const { exitCode, records } = await run(fake);
      expect(exitCode).toBe(1);
      expect(fake.callsTo('bookmark')).toHaveLength(3);
      expectD1Untouched(fake);
      expect(failureRecord(records)).toMatchObject({
        stage: 'preflight',
        d1: 'untouched',
      });
    });

    it('does not retry a read that fails permanently', async () => {
      const fake = createFakeCloudflare();
      fake.queue('d1-database', { kind: 'http', status: 403 });
      const { exitCode } = await run(fake);
      expect(exitCode).toBe(1);
      expect(fake.callsTo('d1-database')).toHaveLength(1);
    });

    it('re-runs read-only preflight on a new run after an ambiguous batch failure', async () => {
      const fake = createFakeCloudflare();
      // The batch commits, but its response is lost.
      const committed = fake.fetch;
      let lostResponse = true;
      const lossy: typeof fake.fetch = async (input, init) => {
        const response = await committed(input, init);
        if (lostResponse && init.body?.includes('"batch"')) {
          lostResponse = false;
          throw new TypeError('socket hang up');
        }
        return response;
      };

      const first = await runCli({
        env: validInputs(),
        readWranglerConfig: () => Promise.resolve(wranglerText),
        listMigrationFiles: () => Promise.resolve(MIGRATIONS),
        fetch: lossy,
        log: () => undefined,
        now: () => new Date(0),
        sleep: () => Promise.resolve(),
      });
      expect(first).toBe(1);
      expect(fake.state.deleted).toBe(true);
      const firstRunCalls = fake.calls.length;

      const second = await run(fake);
      expect(second.exitCode).toBe(1);
      const secondRunCalls = fake.calls.slice(firstRunCalls);
      expect(secondRunCalls[0]?.path).toMatch(/\/d1\/database\/[^/]+$/u);
      expect(fake.callsTo('d1-batch')).toHaveLength(1);
      expect(failureRecord(second.records)).toMatchObject({
        stage: 'preflight',
        d1: 'untouched',
        message: expect.stringContaining('previous run') as unknown,
      });
    });
  });

  describe('secret redaction', () => {
    it('keeps the token out of output when fetch throws an error that contains it', async () => {
      const fake = createFakeCloudflare();
      const leaky = new Error(
        `request failed: authorization: Bearer ${API_TOKEN} for ${API_TOKEN}`,
      );
      fake.queue('d1-batch', { kind: 'throw', error: leaky });
      const { exitCode, output } = await run(fake);
      expect(exitCode).toBe(1);
      expect(output).not.toContain(API_TOKEN);
      expect(output).not.toMatch(/Bearer|authorization/iu);
    });

    it('does not print Cloudflare error bodies, which may echo request details', async () => {
      const fake = createFakeCloudflare();
      fake.queue('d1-database', {
        kind: 'http',
        status: 400,
        body: {
          success: false,
          errors: [{ code: 10000, message: `bad token ${API_TOKEN}` }],
          result: null,
        },
      });
      const { output, records } = await run(fake);
      expect(output).not.toContain(API_TOKEN);
      expect(failureRecord(records)?.message).toContain('error codes 10000');
    });

    it('keeps the token out of output for every failure stage', async () => {
      const scenarios: Fake[] = [
        withState({ migrations: [] }),
        withState({ workersDevEnabled: true }),
        withState({ batchChanges: [0, 0] }),
      ];
      for (const fake of scenarios) {
        const { output } = await run(fake);
        expect(output).not.toContain(API_TOKEN);
      }
    });
  });

  describe('unexpected errors', () => {
    const config = parseDecommissionConfig({
      inputs: validInputs(),
      wranglerConfig: parseJsonc(wranglerText),
      migrationFiles: MIGRATIONS,
    });

    it('reports an unexpected error by kind only, with D1 untouched', async () => {
      const fake = createFakeCloudflare();
      const client = {
        ...createCloudflareClient({
          accountId: config.accountId,
          apiToken: config.apiToken,
          fetch: fake.fetch,
        }),
        getD1Database: () =>
          Promise.reject(new TypeError(`leak ${API_TOKEN} x@example.test`)),
      };
      const lines: string[] = [];
      const failure: unknown = await runDecommission(config, {
        client,
        log: (line) => lines.push(line),
        now: () => new Date(0),
      }).catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(ProcedureFailure);
      expect(failure).toMatchObject({ stage: 'preflight', d1: 'untouched' });
      expect(lines.join('\n')).not.toMatch(/leak|@example/u);
      expect(describeFailure(failure, [API_TOKEN])).toBe(
        'Stage preflight failed (D1 untouched): The procedure stopped on an unexpected error.',
      );
    });

    it('describes a foreign error without its text', () => {
      expect(describeFailure(new Error(API_TOKEN), [API_TOKEN])).toBe(
        'The procedure stopped on an unexpected error.',
      );
    });
  });
});
