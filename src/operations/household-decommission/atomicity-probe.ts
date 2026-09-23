/**
 * Proves whether a D1 REST `batch` request rolls back when a later statement
 * fails, which Cloudflare documents for the Workers binding but not for the
 * REST query endpoint (#32 gate 2). The decommission procedure relies on it:
 * a non-atomic batch could remove the installation pointer and keep the
 * household.
 *
 * One batch inserts a probe household and then inserts the same ID again, so
 * the second statement fails at execution time on the primary key. If the
 * first insert is gone afterwards, the batch rolled back. If it remains, the
 * batch is not atomic and the probe removes its own row. The probe never
 * touches any other row: every statement is bound to a fresh random ID, and
 * the cleanup only removes that ID while it has no members.
 */
import {
  CloudflareApiError,
  type CloudflareClient,
} from './cloudflare-client.ts';
import { redact } from './redact.ts';
import type { BoundStatement } from './sql.ts';

export const PROBE_HOUSEHOLD_NAME = 'D1 batch atomicity probe';

export const INSERT_PROBE_SQL = `INSERT INTO households (id, name, created_at, updated_at)
 VALUES (?1, ?2, ?3, ?3)`;

export const COUNT_PROBE_SQL =
  'SELECT COUNT(*) AS probe_rows FROM households WHERE id = ?1';

export const DELETE_PROBE_SQL = `DELETE FROM households
 WHERE id = ?1
   AND name = ?2
   AND NOT EXISTS (SELECT 1 FROM household_members WHERE household_id = ?1)`;

/** The probe batch: the second insert repeats the first ID and must fail. */
export const probeBatch = (
  probeId: string,
  createdAt: string,
): BoundStatement[] => [
  { sql: INSERT_PROBE_SQL, params: [probeId, PROBE_HOUSEHOLD_NAME, createdAt] },
  { sql: INSERT_PROBE_SQL, params: [probeId, PROBE_HOUSEHOLD_NAME, createdAt] },
];

export interface ProbeConfig {
  readonly databaseId: string;
  readonly databaseName: string;
  readonly apiToken: string;
}

export interface ProbeDependencies {
  readonly client: CloudflareClient;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  readonly newId: () => string;
}

export type ProbeStage = 'preflight' | 'batch' | 'inspect' | 'cleanup';

/** `atomic`: the failed batch left nothing. `not-atomic`: its first insert stayed. */
export type ProbeVerdict = 'atomic' | 'not-atomic';

export class ProbeFailure extends Error {
  readonly stage: ProbeStage;

  constructor(stage: ProbeStage, message: string) {
    super(message);
    this.name = 'ProbeFailure';
    this.stage = stage;
  }
}

interface ProbeLogRecord {
  readonly stage: ProbeStage;
  readonly status: 'started' | 'passed' | 'failed';
  readonly message?: string;
  readonly probeRows?: number;
  readonly verdict?: ProbeVerdict;
}

const probeRowsOf = (rows: readonly Record<string, unknown>[]): number => {
  const [row] = rows;
  const value: unknown = rows.length === 1 ? row.probe_rows : undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('The probe count query returned an unexpected result.');
  }
  return value;
};

/**
 * Runs the probe and returns its verdict. A `not-atomic` verdict is a
 * finding, not an error: the probe cleans up and reports it. It throws a
 * `ProbeFailure` only when it could not reach a verdict or clean up.
 */
export const runAtomicityProbe = async (
  config: ProbeConfig,
  { client, log, now, newId }: ProbeDependencies,
): Promise<ProbeVerdict> => {
  const probeId = newId();
  let stage: ProbeStage = 'preflight';

  const emit = (record: ProbeLogRecord): void => {
    log(
      redact(
        JSON.stringify({
          time: now().toISOString(),
          databaseId: config.databaseId,
          probeId,
          ...record,
        }),
        [config.apiToken],
      ),
    );
  };

  const fail = (message: string): never => {
    throw new ProbeFailure(stage, message);
  };

  const countProbeRows = async (): Promise<number> => {
    try {
      return probeRowsOf(
        await client.readD1(config.databaseId, {
          sql: COUNT_PROBE_SQL,
          params: [probeId],
        }),
      );
    } catch (error) {
      if (error instanceof CloudflareApiError) throw error;
      return fail('The probe count query returned an unexpected result.');
    }
  };

  const removeProbeRow = async (): Promise<void> => {
    stage = 'cleanup';
    emit({ stage, status: 'started' });
    await client.executeD1Batch(
      config.databaseId,
      [{ sql: DELETE_PROBE_SQL, params: [probeId, PROBE_HOUSEHOLD_NAME] }],
      'Probe cleanup',
    );
    const remaining = await countProbeRows();
    if (remaining !== 0) {
      fail(`The probe row could not be removed (${remaining} remain).`);
    }
    emit({ stage, status: 'passed', probeRows: remaining });
  };

  const execute = async (): Promise<ProbeVerdict> => {
    emit({ stage, status: 'started' });
    const database = await client.getD1Database(config.databaseId);
    if (
      database.uuid !== config.databaseId ||
      database.name !== config.databaseName
    ) {
      fail('The D1 database does not match the reviewed environment.');
    }
    if ((await countProbeRows()) !== 0) {
      fail('A row with the fresh probe ID already exists.');
    }
    emit({ stage, status: 'passed', probeRows: 0 });

    stage = 'batch';
    emit({ stage, status: 'started' });
    let batchSucceeded = false;
    try {
      const results = await client.executeD1Batch(
        config.databaseId,
        probeBatch(probeId, now().toISOString()),
        'Probe batch',
      );
      batchSucceeded = results.every(({ success }) => success);
    } catch (error) {
      // Expected: D1 rejects the duplicate insert. Whatever the request's
      // outcome, the inspection below decides what was committed.
      emit({
        stage,
        status: 'passed',
        message:
          error instanceof CloudflareApiError
            ? error.message
            : 'The probe batch was rejected.',
      });
    }

    stage = 'inspect';
    emit({ stage, status: 'started' });
    const probeRows = await countProbeRows();
    if (batchSucceeded) {
      if (probeRows > 0) await removeProbeRow();
      stage = 'batch';
      return fail(
        'The probe batch reported success although its second statement repeats a primary key.',
      );
    }
    if (probeRows === 0) {
      emit({ stage, status: 'passed', probeRows, verdict: 'atomic' });
      return 'atomic';
    }
    emit({ stage, status: 'passed', probeRows, verdict: 'not-atomic' });
    await removeProbeRow();
    return 'not-atomic';
  };

  try {
    return await execute();
  } catch (error) {
    const failure =
      error instanceof ProbeFailure
        ? error
        : new ProbeFailure(
            stage,
            error instanceof CloudflareApiError
              ? error.message
              : 'The probe stopped on an unexpected error.',
          );
    emit({ stage: failure.stage, status: 'failed', message: failure.message });
    throw failure;
  }
};
