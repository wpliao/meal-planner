import { createCloudflareClient, type FetchLike } from './cloudflare-client.ts';
import {
  parseDecommissionConfig,
  parseJsonc,
  type DecommissionConfig,
} from './config.ts';
import { describeFailure, runDecommission } from './procedure.ts';
import { redact } from './redact.ts';

export interface CliDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readWranglerConfig: () => Promise<string>;
  readonly listMigrationFiles: () => Promise<readonly string[]>;
  readonly fetch: FetchLike;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  /** Waits between read retries; tests pass an immediate resolver. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Runs the decommission procedure and returns the process exit code. Every
 * line written is redacted against the API token, including approval-stage
 * failures that happen before any Cloudflare call.
 */
export const runCli = async (deps: CliDependencies): Promise<number> => {
  const secrets = [deps.env.CLOUDFLARE_DECOMMISSION_API_TOKEN ?? ''];
  const logLine = (record: Record<string, unknown>): void => {
    deps.log(
      redact(
        JSON.stringify({ time: deps.now().toISOString(), ...record }),
        secrets,
      ),
    );
  };

  let config: DecommissionConfig;
  try {
    config = parseDecommissionConfig({
      inputs: deps.env,
      wranglerConfig: parseJsonc(await deps.readWranglerConfig()),
      migrationFiles: await deps.listMigrationFiles(),
    });
  } catch (error) {
    logLine({
      stage: 'approval',
      status: 'failed',
      d1: 'untouched',
      message:
        error instanceof Error && error.name === 'ConfigurationError'
          ? redact(error.message, secrets)
          : 'The approval inputs or repository configuration could not be read.',
    });
    return 1;
  }

  logLine({
    stage: 'approval',
    status: 'passed',
    environment: config.environment,
    householdId: config.householdId,
    databaseId: config.databaseId,
    approvalReference: config.approvalReference,
  });

  const client = createCloudflareClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
    fetch: deps.fetch,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });

  try {
    await runDecommission(config, { client, log: deps.log, now: deps.now });
    return 0;
  } catch (error) {
    // runDecommission has already written its own failure record; this line
    // is the one-sentence summary for the job log.
    logLine({ status: 'failed', message: describeFailure(error, secrets) });
    return 1;
  }
};
