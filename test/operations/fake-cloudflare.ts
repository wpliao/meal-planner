import type { FetchLike } from '../../src/operations/household-decommission/cloudflare-client.ts';
import {
  APPLIED_MIGRATIONS_SQL,
  HOUSEHOLD_COUNTS_SQL,
  TABLE_INVENTORY_SQL,
  type BoundStatement,
  type HouseholdCounts,
} from '../../src/operations/household-decommission/sql.ts';

export const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
export const API_TOKEN = 'fake-token-3f9c1d7e5b';
export const DEVELOPMENT_D1_ID = '5f5e98ba-7b27-4fcf-8c2b-ab1605461082';
export const HOUSEHOLD_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
export const OTHER_HOUSEHOLD_ID = '1a2b3c4d-5e6f-4a0b-9c1d-2e3f4a5b6c7d';
export const ACCESS_APP_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const WORKER_NAME = 'family-meal-planner-development';
export const ACCOUNT_SUBDOMAIN = 'example-account';
export const WORKER_HOST = `${WORKER_NAME}.${ACCOUNT_SUBDOMAIN}.workers.dev`;
export const WORKER_ID = 'c81a2d22c29840ed9d61681a3270dbff';
export const MIGRATIONS = [
  '0001_create_household_identity.sql',
  '0002_create_pantry_items.sql',
  '0003_create_recipes.sql',
];
export const TABLES = [
  'app_installation',
  'd1_migrations',
  'household_members',
  'households',
  'meal_plan_entries',
  'pantry_items',
  'recipe_ingredients',
  'recipe_preferences',
  'recipe_steps',
  'recipes',
];

export const installedCounts = (
  overrides: Partial<HouseholdCounts> = {},
): HouseholdCounts => ({
  installation_rows: 1,
  target_installation_rows: 1,
  household_rows: 1,
  target_household_rows: 1,
  member_rows: 3,
  target_member_rows: 3,
  pantry_rows: 5,
  target_pantry_rows: 5,
  recipe_rows: 2,
  target_recipe_rows: 2,
  recipe_ingredient_rows: 7,
  target_recipe_ingredient_rows: 7,
  recipe_step_rows: 4,
  target_recipe_step_rows: 4,
  meal_plan_rows: 9,
  target_meal_plan_rows: 9,
  recipe_preference_rows: 2,
  target_recipe_preference_rows: 2,
  ...overrides,
});

export const zeroCounts = (): HouseholdCounts => ({
  installation_rows: 0,
  target_installation_rows: 0,
  household_rows: 0,
  target_household_rows: 0,
  member_rows: 0,
  target_member_rows: 0,
  pantry_rows: 0,
  target_pantry_rows: 0,
  recipe_rows: 0,
  target_recipe_rows: 0,
  recipe_ingredient_rows: 0,
  target_recipe_ingredient_rows: 0,
  recipe_step_rows: 0,
  target_recipe_step_rows: 0,
  meal_plan_rows: 0,
  target_meal_plan_rows: 0,
  recipe_preference_rows: 0,
  target_recipe_preference_rows: 0,
});

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A canned reply: a JSON result, an HTTP failure, or a thrown network error. */
export type Reply =
  | { readonly kind: 'result'; readonly result: unknown }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly body?: unknown;
    }
  | { readonly kind: 'throw'; readonly error: Error };

export type D1Handler = (
  statements: readonly BoundStatement[],
  isBatch: boolean,
) => Promise<unknown>;

export interface FakeState {
  databaseName: string;
  databaseUuid: string;
  migrations: string[];
  tables: string[];
  counts: HouseholdCounts;
  countsAfterDelete: HouseholdCounts;
  deleted: boolean;
  batchChanges: number[];
  workersDevEnabled: boolean;
  previewsEnabled: boolean;
  customDomains: string[];
  accessApp: Record<string, unknown>;
  policies: Record<string, unknown>[];
  /** Page size the fake Access API uses, whatever the client asks for. */
  policyPageSize: number;
  /** Overrides `result_info.total_count`, to model an inconsistent API. */
  reportedPolicyTotal: number | undefined;
}

export const denyEveryonePolicy = (): Record<string, unknown> => ({
  id: 'policy-1',
  decision: 'deny',
  precedence: 1,
  include: [{ everyone: {} }],
  require: [],
  exclude: [],
});

const envelope = (result: unknown, extra: object = {}): Response =>
  Response.json({ success: true, errors: [], messages: [], result, ...extra });

const statementResult = (
  rows: readonly Record<string, unknown>[],
  changes = 0,
): Record<string, unknown> => ({
  success: true,
  results: rows,
  meta: { changes },
});

export const createFakeCloudflare = (
  options: {
    readonly state?: Partial<FakeState>;
    readonly d1?: D1Handler;
  } = {},
) => {
  const state: FakeState = {
    databaseName: 'family-meal-planner-dev-d1',
    databaseUuid: DEVELOPMENT_D1_ID,
    migrations: [...MIGRATIONS],
    tables: [...TABLES],
    counts: installedCounts(),
    countsAfterDelete: zeroCounts(),
    deleted: false,
    batchChanges: [1, 1],
    workersDevEnabled: false,
    previewsEnabled: false,
    customDomains: [],
    accessApp: { id: ACCESS_APP_ID, domain: WORKER_HOST },
    policies: [denyEveryonePolicy()],
    policyPageSize: 50,
    reportedPolicyTotal: undefined,
    ...options.state,
  };
  const calls: RecordedCall[] = [];
  /** Replies queued per route key, consumed before the default behavior. */
  const queued = new Map<string, Reply[]>();

  const inMemoryD1: D1Handler = (statements, isBatch) => {
    if (isBatch) {
      state.deleted = true;
      return Promise.resolve(
        statements.map((_, index) =>
          statementResult([], state.batchChanges[index]),
        ),
      );
    }
    const [statement] = statements;
    if (statement.sql === APPLIED_MIGRATIONS_SQL) {
      return Promise.resolve([
        statementResult(state.migrations.map((name) => ({ name }))),
      ]);
    }
    if (statement.sql === TABLE_INVENTORY_SQL) {
      return Promise.resolve([
        statementResult(state.tables.map((name) => ({ name }))),
      ]);
    }
    if (statement.sql === HOUSEHOLD_COUNTS_SQL) {
      const counts = state.deleted ? state.countsAfterDelete : state.counts;
      return Promise.resolve([statementResult([{ ...counts }])]);
    }
    throw new Error(`Unexpected SQL in fake: ${statement.sql}`);
  };
  const d1 = options.d1 ?? inMemoryD1;

  const routeKey = (method: string, path: string, body: unknown): string => {
    if (path.endsWith('/query')) {
      const record = body as { batch?: unknown };
      return record.batch === undefined ? 'd1-read' : 'd1-batch';
    }
    if (path.endsWith('/time_travel/bookmark')) return 'bookmark';
    if (/\/d1\/database\/[^/]+$/u.test(path)) return 'd1-database';
    if (path.endsWith('/workers/subdomain')) return 'account-subdomain';
    if (path.endsWith('/subdomain')) return 'worker-subdomain';
    if (path.includes('/workers/domains')) return 'custom-domains';
    if (/\/workers\/workers\/[^/?]+$/u.test(path)) return 'worker';
    if (path.split('?')[0].endsWith('/policies')) return 'access-policies';
    if (path.includes('/access/apps/')) return 'access-app';
    return `${method} ${path}`;
  };

  const defaultReply = async (key: string, body: unknown): Promise<unknown> => {
    switch (key) {
      case 'd1-database':
        return { uuid: state.databaseUuid, name: state.databaseName };
      case 'd1-read': {
        const { sql, params } = body as { sql: string; params: string[] };
        return d1([{ sql, params }], false);
      }
      case 'd1-batch':
        return d1((body as { batch: BoundStatement[] }).batch, true);
      case 'bookmark':
        return {
          bookmark:
            '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683',
        };
      case 'account-subdomain':
        return { subdomain: ACCOUNT_SUBDOMAIN };
      case 'worker-subdomain':
        return {
          enabled: state.workersDevEnabled,
          previews_enabled: state.previewsEnabled,
        };
      case 'custom-domains':
        return state.customDomains.map((hostname) => ({
          hostname,
          service: WORKER_NAME,
        }));
      case 'worker':
        return { id: WORKER_ID, name: WORKER_NAME };
      case 'access-app':
        return state.accessApp;
      default:
        throw new Error(`Unexpected request in fake: ${key}`);
    }
  };

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const path = `${url.pathname}${url.search}`;
    const body: unknown =
      init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method: init.method, path, headers: init.headers, body });

    const key = routeKey(init.method, path, body);
    const reply = queued.get(key)?.shift();
    if (reply?.kind === 'throw') throw reply.error;
    if (reply?.kind === 'http') {
      return Response.json(
        reply.body ?? {
          success: false,
          errors: [{ code: 7500, message: 'fake failure' }],
          messages: [],
          result: null,
        },
        { status: reply.status },
      );
    }
    if (reply?.kind === 'result') return envelope(reply.result);
    if (key === 'access-policies') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const size = state.policyPageSize;
      const totalPages = Math.max(1, Math.ceil(state.policies.length / size));
      return envelope(state.policies.slice((page - 1) * size, page * size), {
        result_info: {
          page,
          per_page: size,
          total_pages: totalPages,
          total_count: state.reportedPolicyTotal ?? state.policies.length,
        },
      });
    }
    return envelope(await defaultReply(key, body));
  };

  return {
    state,
    calls,
    fetch,
    /** Queues replies for a route; each one is used by one request. */
    queue(key: string, ...replies: Reply[]): void {
      queued.set(key, [...(queued.get(key) ?? []), ...replies]);
    },
    callsTo(key: string): RecordedCall[] {
      return calls.filter(
        ({ method, path, body }) => routeKey(method, path, body) === key,
      );
    },
  };
};

export const validInputs = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  DECOMMISSION_ENVIRONMENT: 'development',
  DECOMMISSION_EXPECTED_HOUSEHOLD_ID: HOUSEHOLD_ID,
  DECOMMISSION_EXPECTED_D1_DATABASE_ID: DEVELOPMENT_D1_ID,
  DECOMMISSION_APPROVAL_REFERENCE:
    'https://github.com/wpliao/meal-planner/issues/32#issuecomment-5790000001',
  DECOMMISSION_CONFIRMATION: 'DECOMMISSION_DEVELOPMENT_HOUSEHOLD',
  DECOMMISSION_ACCESS_APP_ID: ACCESS_APP_ID,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_DECOMMISSION_API_TOKEN: API_TOKEN,
  GITHUB_REF: 'refs/heads/main',
  ...overrides,
});

/**
 * Turns an error thrown by a fake D1 handler into the HTTP 400 envelope the
 * D1 REST API returns for a failed statement, instead of a network error.
 */
export const withHttpFailures =
  (fetch: FetchLike): FetchLike =>
  async (input, init) => {
    try {
      return await fetch(input, init);
    } catch {
      return Response.json(
        {
          success: false,
          errors: [{ code: 7500, message: 'SQLITE_CONSTRAINT' }],
          messages: [],
          result: null,
        },
        { status: 400 },
      );
    }
  };
