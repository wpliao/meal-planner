import {
  CloudflareApiError,
  type AccessPolicy,
  type CloudflareClient,
} from './cloudflare-client.ts';
import type { DecommissionConfig } from './config.ts';
import { redact } from './redact.ts';
import {
  APPLIED_MIGRATIONS_SQL,
  COUNT_FIELDS,
  deletionBatch,
  acceptableDeletionChanges,
  EXPECTED_TABLES,
  householdCountsStatement,
  TABLE_INVENTORY_SQL,
  type HouseholdCounts,
} from './sql.ts';

export type Stage = 'preflight' | 'close-access' | 'delete' | 'verify';

/**
 * Whether a failed run changed D1. `untouched` means the deletion batch was
 * never sent; `unknown` means it was sent and its outcome is not confirmed.
 */
export type D1State = 'untouched' | 'unknown' | 'deleted';

export class ProcedureFailure extends Error {
  readonly stage: Stage;
  readonly d1: D1State;
  readonly counts: HouseholdCounts | undefined;

  constructor(
    stage: Stage,
    d1: D1State,
    message: string,
    counts?: HouseholdCounts,
  ) {
    super(message);
    this.name = 'ProcedureFailure';
    this.stage = stage;
    this.d1 = d1;
    this.counts = counts;
  }
}

export interface ProcedureDependencies {
  readonly client: CloudflareClient;
  readonly log: (line: string) => void;
  readonly now: () => Date;
}

export interface ProcedureResult {
  readonly preflightCounts: HouseholdCounts;
  readonly finalCounts: HouseholdCounts;
  readonly bookmark: string;
}

/** Everything a log line may contain: no names, emails, or record values. */
interface LogRecord {
  readonly stage: Stage;
  readonly status: 'started' | 'passed' | 'failed';
  readonly message?: string;
  readonly counts?: HouseholdCounts;
  readonly bookmark?: string;
  readonly d1?: D1State;
  /** Affected-row counts reported by the deletion batch. */
  readonly changes?: readonly number[];
}

const sameList = (
  actual: readonly string[],
  expected: readonly string[],
): boolean =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const names = (rows: readonly Record<string, unknown>[]): string[] =>
  rows.map(({ name }) => (typeof name === 'string' ? name : ''));

/**
 * The hostname an Access destination protects in full, or undefined when the
 * destination is limited to a path: `host/app` leaves the rest of the host
 * outside that application.
 */
export const wholeHostOf = (value: string): string | undefined => {
  const withoutScheme = value.replace(/^https?:\/\//u, '');
  const slash = withoutScheme.indexOf('/');
  const host = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  const path = slash === -1 ? '' : withoutScheme.slice(slash);
  return path === '' || path === '/' ? host.toLowerCase() : undefined;
};

const isUnconditionalDenyEveryone = (policy: AccessPolicy): boolean =>
  policy.decision === 'deny' &&
  policy.require.length === 0 &&
  policy.exclude.length === 0 &&
  policy.include.some((rule) => 'everyone' in rule);

export const parseCounts = (
  rows: readonly Record<string, unknown>[],
): HouseholdCounts => {
  const [row] = rows;
  if (rows.length !== 1) {
    throw new Error('The count query did not return exactly one row.');
  }
  const counts = {} as HouseholdCounts;
  for (const field of COUNT_FIELDS) {
    const value = row[field];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(`The count query returned an invalid ${field}.`);
    }
    counts[field] = value;
  }
  return counts;
};

const allZero = (counts: HouseholdCounts): boolean =>
  COUNT_FIELDS.every((field) => counts[field] === 0);

/** Only a Cloudflare client error's own message is written to be printable. */
const safeMessage = (error: unknown): string =>
  error instanceof CloudflareApiError
    ? error.message
    : 'The procedure stopped on an unexpected error.';

export const runDecommission = async (
  config: DecommissionConfig,
  { client, log, now }: ProcedureDependencies,
): Promise<ProcedureResult> => {
  const emit = (record: LogRecord): void => {
    const line = JSON.stringify({
      time: now().toISOString(),
      environment: config.environment,
      householdId: config.householdId,
      databaseId: config.databaseId,
      ...record,
    });
    log(redact(line, [config.apiToken]));
  };

  let stage: Stage = 'preflight';
  let d1: D1State = 'untouched';

  const fail = (message: string, counts?: HouseholdCounts): never => {
    throw new ProcedureFailure(stage, d1, message, counts);
  };

  const readCounts = async (): Promise<HouseholdCounts> => {
    try {
      return parseCounts(
        await client.readD1(
          config.databaseId,
          householdCountsStatement(config.householdId),
        ),
      );
    } catch (error) {
      if (error instanceof CloudflareApiError) throw error;
      return fail('The count query returned an unexpected result.');
    }
  };

  const verifyAccessClosed = async (): Promise<void> => {
    const accountSubdomain = await client.getAccountWorkersSubdomain();
    const workerHost =
      `${config.workerName}.${accountSubdomain}.workers.dev`.toLowerCase();

    const workersDev = await client.getWorkerSubdomainState(config.workerName);
    if (workersDev.enabled || workersDev.previewsEnabled) {
      fail(
        'The Worker is still reachable on workers.dev or through preview URLs. Disable both before deletion.',
      );
    }

    const customDomains = await client.listWorkerCustomDomains(
      config.workerName,
    );
    if (customDomains.length > 0) {
      fail(
        `The Worker still has ${customDomains.length} custom domain(s). Detach them before deletion.`,
      );
    }

    const hosts = (
      await client.getAccessApplicationHosts(config.accessAppId)
    ).map(wholeHostOf);
    if (!hosts.includes(workerHost)) {
      fail(
        "The Access application does not protect this environment's whole Worker hostname.",
      );
    }

    const policies = await client.listAccessPolicies(config.accessAppId);
    if (policies.some(({ decision }) => decision !== 'deny')) {
      fail(
        'The Access application still has a policy that is not a deny policy.',
      );
    }
    if (!policies.some(isUnconditionalDenyEveryone)) {
      fail(
        'The Access application has no unconditional deny policy for everyone.',
      );
    }
  };

  const execute = async (): Promise<ProcedureResult> => {
    // Stage 1: approval and preflight. Read-only.
    emit({ stage, status: 'started' });

    const database = await client.getD1Database(config.databaseId);
    if (
      database.uuid !== config.databaseId ||
      database.name !== config.databaseName
    ) {
      fail('The D1 database does not match the reviewed environment.');
    }

    const applied = names(
      await client.readD1(config.databaseId, {
        sql: APPLIED_MIGRATIONS_SQL,
        params: [],
      }),
    );
    if (!sameList(applied, config.expectedMigrations)) {
      fail(
        `Applied migrations (${applied.length}) do not match the repository migrations (${config.expectedMigrations.length}).`,
      );
    }

    const tables = names(
      await client.readD1(config.databaseId, {
        sql: TABLE_INVENTORY_SQL,
        params: [],
      }),
    );
    if (!sameList(tables, EXPECTED_TABLES)) {
      fail(
        'The table inventory differs from the tables this procedure accounts for.',
      );
    }

    const preflightCounts = await readCounts();
    if (
      preflightCounts.installation_rows === 0 &&
      preflightCounts.household_rows === 0
    ) {
      fail(
        'No installation or household remains. A previous run may already have deleted it; investigate before any further action.',
        preflightCounts,
      );
    }
    const installedAsReviewed =
      preflightCounts.installation_rows === 1 &&
      preflightCounts.target_installation_rows === 1 &&
      preflightCounts.household_rows === 1 &&
      preflightCounts.target_household_rows === 1;
    const noForeignRows =
      preflightCounts.member_rows === preflightCounts.target_member_rows &&
      preflightCounts.pantry_rows === preflightCounts.target_pantry_rows;
    if (!installedAsReviewed || !noForeignRows) {
      fail(
        'The database does not hold exactly one installed household matching the reviewed household ID.',
        preflightCounts,
      );
    }

    const bookmark = await client.getTimeTravelBookmark(config.databaseId);
    emit({ stage, status: 'passed', counts: preflightCounts, bookmark });

    // Stage 2: confirm access is closed. Read-only; D1 is still untouched.
    stage = 'close-access';
    emit({ stage, status: 'started' });
    await verifyAccessClosed();
    emit({ stage, status: 'passed' });

    // Stage 3: the one destructive request. Never retried.
    stage = 'delete';
    emit({ stage, status: 'started' });
    d1 = 'unknown';
    const results = await client.executeD1Batch(
      config.databaseId,
      deletionBatch(config.householdId),
    );
    const changes = results.map((result) => result.changes ?? -1);
    const expected = acceptableDeletionChanges(preflightCounts).map((list) =>
      list.map(String),
    );
    if (
      results.some(({ success }) => !success) ||
      !expected.some((list) => sameList(changes.map(String), list))
    ) {
      fail(
        `The deletion batch reported unexpected affected-row counts [${changes.join(', ')}].`,
      );
    }
    d1 = 'deleted';
    emit({ stage, status: 'passed', changes });

    // Stage 4: verify zero counts and that access is still closed.
    stage = 'verify';
    emit({ stage, status: 'started' });
    const finalCounts = await readCounts();
    if (!allZero(finalCounts)) {
      fail('Rows remain after deletion.', finalCounts);
    }
    await verifyAccessClosed();
    emit({ stage, status: 'passed', counts: finalCounts });

    return { preflightCounts, finalCounts, bookmark };
  };

  try {
    return await execute();
  } catch (error) {
    const failure =
      error instanceof ProcedureFailure
        ? error
        : new ProcedureFailure(stage, d1, safeMessage(error));
    emit({
      stage: failure.stage,
      status: 'failed',
      d1: failure.d1,
      message: failure.message,
      ...(failure.counts ? { counts: failure.counts } : {}),
    });
    throw failure;
  }
};

/**
 * Converts a failure into a single redacted line. `runDecommission` reports
 * every failure as a `ProcedureFailure`; anything else is reported without
 * its text, which was not written to be safe to print.
 */
export const describeFailure = (
  error: unknown,
  secrets: readonly string[],
): string => {
  if (error instanceof ProcedureFailure) {
    return redact(
      `Stage ${error.stage} failed (D1 ${error.d1}): ${error.message}`,
      secrets,
    );
  }
  return 'The procedure stopped on an unexpected error.';
};
